import { supabase } from "@/lib/supabaseClient";

/**
 * قراءة دفتر الأستاذ المرحّل كاملًا للتقارير المالية.
 * - ترقيم صفحات حتى لا تُقطع النتائج بصمت عند حد واجهة البيانات (يتوقف عند أول صفحة فارغة،
 *   فيبقى صحيحًا حتى لو كان حد الخادم أقل من حجم الصفحة المطلوب).
 * - أسطر القيود تُطلب على دفعات من المعرّفات حتى لا يطول رابط الطلب، وبعدة طلبات متوازية محدودة.
 */

export type LedgerAccount = { code: string; name_ar: string; name_en: string | null };
export type LedgerEntry = {
  id: string;
  entry_date: string;
  created_at: string | null;
  description: string | null;
  source_document_id: string | null;
};
export type LedgerLine = {
  id: string;
  journal_entry_id: string;
  account_code: string;
  debit: number;
  credit: number;
  counterparty: string | null;
};

const PAGE_SIZE = 1000;
const ID_CHUNK = 150;
const PARALLEL_REQUESTS = 4;

async function fetchAllPages<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; ) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    if (page.length === 0) break;
    rows.push(...page);
    from += page.length;
  }
  return rows;
}

/**
 * نفس fetchAllPages لكن بشكل نتيجة Supabase المعتاد { data, error } حتى تبقى الشاشات كما هي.
 * الاستعلام يجب أن يكون مرتبًا ترتيبًا ثابتًا (مثلًا ينتهي بـ .order("id")) ثم .range(from, to).
 */
export async function selectAllRows<T = any>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ data: T[]; error: { message: string } | null }> {
  try {
    return { data: await fetchAllPages<T>(build), error: null };
  } catch (loadError) {
    return { data: [], error: { message: loadError instanceof Error ? loadError.message : String(loadError) } };
  }
}

export async function fetchPostedLedger(dateTo: string) {
  const accounts = await fetchAllPages<LedgerAccount>((from, to) =>
    supabase
      .from("accounting_accounts")
      .select("code, name_ar, name_en")
      .order("code")
      .range(from, to),
  );
  const entries = await fetchAllPages<LedgerEntry>((from, to) =>
    supabase
      .from("accounting_journal_entries")
      .select("id, entry_date, created_at, description, source_document_id")
      .eq("status", "posted")
      .lte("entry_date", dateTo)
      .order("entry_date")
      .order("created_at")
      .order("id")
      .range(from, to),
  );
  const ids = entries.map((entry) => entry.id);
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += ID_CHUNK) chunks.push(ids.slice(index, index + ID_CHUNK));
  const fetchChunk = (chunk: string[]) =>
    fetchAllPages<LedgerLine>((from, to) =>
      supabase
        .from("accounting_journal_lines")
        .select("id, journal_entry_id, account_code, debit, credit, counterparty")
        .in("journal_entry_id", chunk)
        .order("id")
        .range(from, to),
    );
  const chunkResults: LedgerLine[][] = [];
  for (let index = 0; index < chunks.length; index += PARALLEL_REQUESTS) {
    chunkResults.push(...(await Promise.all(chunks.slice(index, index + PARALLEL_REQUESTS).map(fetchChunk))));
  }
  const lines: LedgerLine[] = chunkResults.flat().map((line) => ({
    ...line,
    debit: Number(line.debit) || 0,
    credit: Number(line.credit) || 0,
  }));
  return { accounts, entries, lines };
}

/** السنة المالية تقويمية (الفترات الشهرية من يناير إلى ديسمبر). */
export const fiscalYearStart = (date: string) => `${date.slice(0, 4)}-01-01`;

/** فئة الحساب من أول رقم في الكود (1 أصول، 2 خصوم، 3 حقوق ملكية، 4 إيرادات، 5 مصروفات). */
export const accountClass = (code: string) => String(code ?? "").charAt(0);
export const isIncomeStatementAccount = (code: string) =>
  ["4", "5"].includes(accountClass(code));

/**
 * حسابات الرقابة: تُغذّى فقط من المستندات (الفواتير والإشعارات والسداد وحركات المخزون)
 * حتى تبقى أرصدة العملاء والموردين والمخزون والإقرار الضريبي مطابقة للأستاذ العام.
 * القيم الثابتة هي حسابات قاعدة الترحيل الحالية، وتُضاف إليها أي حسابات مهيأة في
 * قاعدة الترحيل أو المنتجات إن أمكن قراءتها.
 */
// 2114: الشيكات الصادرة المؤجلة — تُغذّى فقط من سداد الموردين بشيك مؤجل وتأكيد صرفه أو عكسه
// 2115: جمارك وضريبة استيراد دفعها المخلّص — تُغذّى من البيان الجمركي وتُغلق بفاتورة المخلّص
export const DEFAULT_CONTROL_ACCOUNT_CODES = ["112", "2112", "219", "2111", "1151", "2114", "2115"] as const;

export async function fetchControlAccountCodes(): Promise<Set<string>> {
  const codes = new Set<string>(DEFAULT_CONTROL_ACCOUNT_CODES);
  const [rules, products] = await Promise.all([
    supabase
      .from("accounting_posting_rules")
      .select("receivable_account_code, payable_account_code, output_vat_account_code, input_vat_account_code")
      .eq("active", true),
    supabase.from("inventory_products").select("inventory_account_code"),
  ]);
  (rules.data ?? []).forEach((rule) => {
    [rule.receivable_account_code, rule.payable_account_code, rule.output_vat_account_code, rule.input_vat_account_code]
      .filter(Boolean)
      .forEach((code) => codes.add(String(code)));
  });
  (products.data ?? []).forEach((product) => {
    if (product.inventory_account_code) codes.add(String(product.inventory_account_code));
  });
  return codes;
}
