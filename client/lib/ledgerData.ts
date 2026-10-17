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
  /** رقم القيد المقروء (مثل 1001-JE-000007)؛ يُعطى عند الترحيل، والمسودة بلا رقم. */
  entry_number?: string | null;
  reference_type?: string | null;
  source_document_table?: string | null;
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
      .select("id, entry_date, created_at, description, source_document_id, entry_number, reference_type, source_document_table")
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

/**
 * أسماء أنواع مراجع القيود (reference_type) وجداول مصادرها (source_document_table) بالعربية،
 * حتى لا تظهر الرموز الإنجليزية الداخلية للمستخدم. النوع غير المعروف يُعرض برمزه.
 */
export const JOURNAL_REFERENCE_LABELS: Record<string, string> = {
  sales_invoice: "فاتورة مبيعات",
  sales_invoices: "فاتورة مبيعات",
  purchase_invoice: "فاتورة شراء",
  purchase_invoices: "فاتورة شراء",
  customs_declaration: "بيان جمركي",
  customs_declarations: "بيان جمركي",
  customs_declaration_reversal: "عكس بيان جمركي",
  customs_declaration_reversals: "عكس بيان جمركي",
  manual_journal: "قيد يدوي",
  manual_journals: "قيد يدوي",
  manual_journal_reversal: "عكس قيد يدوي",
  manual_journal_reversals: "عكس قيد يدوي",
  inventory_issue: "سند صرف مخزون",
  inventory_issues: "سند صرف مخزون",
  inventory_receipt: "سند استلام مخزون",
  inventory_receipts: "سند استلام مخزون",
  inventory_opening: "رصيد افتتاحي للمخزون",
  inventory_opening_balances: "رصيد افتتاحي للمخزون",
  inventory_adjustment: "تسوية جرد",
  inventory_adjustments: "تسوية جرد",
  inventory_assembly: "أمر تركيب",
  inventory_assembly_orders: "أمر تركيب",
  inventory_manufacturing: "أمر تصنيع",
  inventory_manufacturing_orders: "أمر تصنيع",
  inventory_transfer: "تحويل مخزون",
  inventory_transfers: "تحويل مخزون",
  fixed_asset_capitalization: "رسملة أصل ثابت",
  fixed_assets: "رسملة أصل ثابت",
  fixed_asset_disposal: "استبعاد أصل",
  fixed_asset_disposals: "استبعاد أصل",
  fixed_asset_depreciation: "إهلاك أصل",
  sales_credit: "إشعار دائن مبيعات",
  sales_debit: "إشعار مدين مبيعات",
  purchase_credit: "إشعار دائن مورد",
  purchase_debit: "إشعار مدين مورد",
  invoice_adjustment_notes: "إشعار دائن / مدين",
  purchase_payment: "سداد مورد",
  purchase_payments: "سداد مورد",
  purchase_payment_reversal: "عكس سداد مورد",
  purchase_payment_reversals: "عكس سداد مورد",
  purchase_cheque_clearing: "صرف شيك مورد",
  purchase_cheque_clearings: "صرف شيك مورد",
  customer_payment: "تحصيل عميل",
  customer_payments: "تحصيل عميل",
  payroll: "رواتب",
  bulk_reclassification: "إعادة تصنيف",
  accounting_reclassifications: "إعادة تصنيف",
  opening_balance: "رصيد افتتاحي",
  opening_balances: "رصيد افتتاحي",
};

/** اسم نوع المرجع بالعربية (أو بالترجمة إن مُرّرت t)؛ الرمز غير المعروف يُعاد كما هو. */
export function journalReferenceLabel(code: string | null | undefined, t: (source: string) => string = (source) => source): string {
  const key = String(code ?? "").trim();
  if (!key) return "—";
  const label = JOURNAL_REFERENCE_LABELS[key];
  return label ? t(label) : key;
}

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
export const containsUuid = (value: unknown) => UUID_PATTERN.test(String(value ?? ""));

/**
 * الرقم المعروض للقيد: رقم القيد (entry_number) إن وُجد، وإلا مرجع المستند المصدر إن كان مقروءًا،
 * وإلا نوع المرجع مع مختصر قصير — ولا يُعرض المعرّف الداخلي (UUID) كاملًا أبدًا.
 */
export function journalEntryDisplayNumber(
  entry: { id: string; entry_number?: string | null; source_document_id?: string | null; reference_type?: string | null },
  t: (source: string) => string = (source) => source,
): string {
  const number = String(entry.entry_number ?? "").trim();
  if (number) return number;
  const source = String(entry.source_document_id ?? "").trim();
  if (source && !containsUuid(source)) return source;
  const label = entry.reference_type ? journalReferenceLabel(entry.reference_type, t) : t("قيد");
  return `${label} #${String(entry.id ?? "").replace(/-/g, "").slice(0, 8).toUpperCase()}`;
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
