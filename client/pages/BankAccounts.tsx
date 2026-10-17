import { CheckCircle2, FileUp, Landmark, Link2, Pencil, Plus, Power, RefreshCw, Unlink, WalletCards, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import { supabase } from "@/lib/supabaseClient";
import { accountingErrorText } from "@/lib/accountingErrors";

type AccountKind = "bank" | "cash";
type BankAccount = { id: string; name: string; bank_name: string | null; iban: string | null; account_code: string; currency: string; active: boolean; account_kind: AccountKind };
// نموذج الإضافة والتعديل: id فارغ = حساب جديد ينشئ معه حساب الدليل في الخادم
type BankForm = { id: string | null; kind: AccountKind; name: string; bankName: string; iban: string; currency: string; active: boolean };
type ImportRow = { id: string; bank_account_id: string; file_name: string; statement_from: string; statement_to: string; opening_balance: number | null; closing_balance: number | null; status: string; created_at: string };
type StatementLine = { id: string; import_id: string; bank_account_id: string; transaction_date: string; reference: string | null; description: string; debit: number; credit: number; running_balance: number | null; amount: number; reconciliation_status: string; matched_journal_entry_id: string | null };
type Candidate = { journal_entry_id: string; entry_date: string; reference: string; description: string; ledger_amount: number };
type LedgerBalance = { account_code: string; ledger_balance: number };
type ParsedLine = { date: string; valueDate: string; reference: string; description: string; debit: number; credit: number; balance: number | null };

const numeric = (value: unknown) => Number(String(value ?? "").replace(/,/g, "").trim()) || 0;
const normalizeHeader = (value: string) => value.trim().toLowerCase().replace(/\s+/g, "_");
const latinDigits = (value: string) =>
  value
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));
// الآيبان كما يحفظه الخادم: بلا مسافات أو شرطات وبأحرف كبيرة
const cleanIban = (value: string) => latinDigits(value).replace(/[\s-]/g, "").toUpperCase();
// عرض الآيبان مجمّعًا كل أربعة أحرف لسهولة القراءة
const formatIban = (value: string | null) => (value ?? "").replace(/(.{4})/g, "$1 ").trim();

// تاريخ الحركة كما في كشف البنك: يوم/شهر/سنة (صيغة البنوك السعودية) أو سنة-شهر-يوم، ويُرسل بصيغة ISO.
// لا يُترك للقاعدة تفسيره (قد تقرأ 05/10/2026 على أنه 10 مايو). تاريخ غير صالح يعيد نصًا فارغًا.
function normalizeStatementDate(raw: string | undefined) {
  const value = latinDigits(String(raw ?? "").trim()).split(/[\sT]/)[0];
  let parts = value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  let year: number;
  let month: number;
  let day: number;
  if (parts) {
    year = Number(parts[1]); month = Number(parts[2]); day = Number(parts[3]);
  } else {
    parts = value.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (!parts) return "";
    day = Number(parts[1]); month = Number(parts[2]); year = Number(parts[3]);
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// رسائل الاستيراد بالعربية بدل رموز الخطأ
function importErrorText(message: string) {
  const row = message.match(/BANK_STATEMENT_ROW_INVALID:(\d+)/);
  if (row) return `السطر ${row[1]} في الملف: التاريخ غير صحيح (المقبول يوم/شهر/سنة أو سنة-شهر-يوم)، أو الحركة ليست مدينة فقط أو دائنة فقط`;
  if (message.includes("BANK_STATEMENT_CSV_EMPTY")) return "الملف فارغ أو ليس فيه أسطر حركات";
  if (message.includes("BANK_STATEMENT_COLUMNS_INVALID")) return "أعمدة الملف غير معروفة: يلزم عمود التاريخ (date أو التاريخ) وعمود مدين/دائن أو المبلغ";
  if (message.includes("file_hash") || message.includes("duplicate key")) return "هذا الكشف مستورد من قبل لهذا الحساب";
  if (message.includes("BANK_LINE_DATE_OUTSIDE_STATEMENT")) return "في الملف حركة تاريخها خارج فترة الكشف المحددة";
  if (message.includes("BANK_LINE_DEBIT_CREDIT_INVALID")) return "كل حركة يجب أن تكون مدينة فقط أو دائنة فقط";
  if (message.includes("BANK_STATEMENT_DATE_RANGE_INVALID")) return "فترة الكشف غير صحيحة";
  if (message.includes("BANK_ACCOUNT_NOT_FOUND_OR_INACTIVE")) return "الحساب البنكي غير موجود أو موقوف";
  if (message.includes("ACCOUNTING_MANAGE_PERMISSION_REQUIRED")) return "الاستيراد يتطلب صلاحية إدارة المحاسبة";
  if (message.includes("statement timeout")) return "الملف كبير؛ قسّمه إلى ملفات أصغر ثم استوردها";
  return message;
}

function parseCsvRow(row: string) {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < row.length; index += 1) {
    const character = row[index];
    if (character === '"' && row[index + 1] === '"' && quoted) { value += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { values.push(value.trim()); value = ""; }
    else value += character;
  }
  values.push(value.trim());
  return values;
}

function parseStatementCsv(text: string): ParsedLine[] {
  const rows = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((row) => row.trim());
  if (rows.length < 2) throw new Error("BANK_STATEMENT_CSV_EMPTY");
  const headers = parseCsvRow(rows[0]).map(normalizeHeader);
  const indexOf = (...names: string[]) => headers.findIndex((header) => names.includes(header));
  const dateIndex = indexOf("date", "transaction_date", "التاريخ");
  const valueDateIndex = indexOf("value_date", "تاريخ_القيمة");
  const referenceIndex = indexOf("reference", "ref", "المرجع");
  const descriptionIndex = indexOf("description", "details", "البيان", "الوصف");
  const debitIndex = indexOf("debit", "مدين", "سحب");
  const creditIndex = indexOf("credit", "دائن", "إيداع");
  const amountIndex = indexOf("amount", "المبلغ");
  const balanceIndex = indexOf("balance", "الرصيد");
  if (dateIndex < 0 || (debitIndex < 0 && creditIndex < 0 && amountIndex < 0)) throw new Error("BANK_STATEMENT_COLUMNS_INVALID");

  return rows.slice(1).map((row, index) => {
    const cells = parseCsvRow(row);
    const signedAmount = amountIndex >= 0 ? numeric(cells[amountIndex]) : 0;
    const debit = debitIndex >= 0 ? numeric(cells[debitIndex]) : signedAmount < 0 ? Math.abs(signedAmount) : 0;
    const credit = creditIndex >= 0 ? numeric(cells[creditIndex]) : signedAmount > 0 ? signedAmount : 0;
    const date = normalizeStatementDate(cells[dateIndex]);
    if (!date || !((debit > 0 && credit === 0) || (credit > 0 && debit === 0))) throw new Error(`BANK_STATEMENT_ROW_INVALID:${index + 2}`);
    return { date, valueDate: valueDateIndex >= 0 ? normalizeStatementDate(cells[valueDateIndex]) : "", reference: referenceIndex >= 0 ? cells[referenceIndex] ?? "" : "", description: descriptionIndex >= 0 ? cells[descriptionIndex] ?? "" : "", debit, credit, balance: balanceIndex >= 0 && cells[balanceIndex] ? numeric(cells[balanceIndex]) : null };
  });
}

export default function BankAccounts() {
  const { t, direction, formatNumber } = useI18n();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [lines, setLines] = useState<StatementLine[]>([]);
  const [ledgerBalances, setLedgerBalances] = useState<Record<string, number>>({});
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [importAccountId, setImportAccountId] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [statementFrom, setStatementFrom] = useState("");
  const [statementTo, setStatementTo] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");
  const [closingBalance, setClosingBalance] = useState("");
  const [matchingLine, setMatchingLine] = useState<StatementLine | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [chartNames, setChartNames] = useState<Record<string, string>>({});
  const [form, setForm] = useState<BankForm | null>(null);
  const [formError, setFormError] = useState("");
  const candidateRequest = useRef(0);
  const money = (value: number) => formatNumber(Math.abs(value) < 0.005 ? 0 : value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const load = async () => {
    setLoading(true); setError("");
    const [accountResult, importResult, lineResult, balanceResult, chartResult] = await Promise.all([
      // كل الحسابات (النشطة والموقوفة) لجدول الإدارة؛ البطاقات والتسوية للنشطة فقط
      supabase.from("accounting_bank_accounts").select("id, name, bank_name, iban, account_code, currency, active, account_kind").order("active", { ascending: false }).order("name"),
      supabase.from("accounting_bank_statement_imports").select("*").order("statement_to", { ascending: false }).order("created_at", { ascending: false }),
      supabase.from("accounting_bank_statement_lines").select("*").order("transaction_date", { ascending: false }).order("id"),
      supabase.rpc("get_accounting_bank_ledger_balances"),
      supabase.from("accounting_accounts").select("code, name_ar"),
    ]);
    const firstError = accountResult.error ?? importResult.error ?? lineResult.error ?? balanceResult.error ?? chartResult.error;
    if (firstError) { setError(accountingErrorText(firstError.message, t)); setLoading(false); return; }
    const bankAccounts = ((accountResult.data ?? []) as BankAccount[]).map((account) => ({ ...account, account_kind: account.account_kind === "cash" ? "cash" as const : "bank" as const }));
    const balances: Record<string, number> = {};
    ((balanceResult.data ?? []) as LedgerBalance[]).forEach((row) => { balances[String(row.account_code)] = numeric(row.ledger_balance); });
    const names: Record<string, string> = {};
    ((chartResult.data ?? []) as Array<{ code: string; name_ar: string }>).forEach((row) => { names[String(row.code)] = String(row.name_ar ?? ""); });
    setAccounts(bankAccounts);
    setChartNames(names);
    setImports((importResult.data ?? []) as ImportRow[]);
    setLines((lineResult.data ?? []) as StatementLine[]);
    setLedgerBalances(balances);
    setSelectedAccountId((current) => bankAccounts.some((account) => account.id === current && account.active) ? current : (bankAccounts.find((account) => account.active)?.id ?? ""));
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const latestImportByAccount = useMemo(() => {
    const result = new Map<string, ImportRow>();
    imports.forEach((item) => { if (!result.has(item.bank_account_id)) result.set(item.bank_account_id, item); });
    return result;
  }, [imports]);
  const selectedLines = lines.filter((line) => line.bank_account_id === selectedAccountId);
  const activeAccounts = accounts.filter((account) => account.active);

  const openNew = (kind: AccountKind) => {
    setForm({ id: null, kind, name: "", bankName: "", iban: "", currency: "SAR", active: true }); setFormError(""); setNotice("");
  };
  const openEdit = (account: BankAccount) => {
    setForm({ id: account.id, kind: account.account_kind, name: account.name, bankName: account.bank_name ?? "", iban: formatIban(account.iban), currency: account.currency || "SAR", active: account.active }); setFormError(""); setNotice("");
  };

  // الإضافة والتعديل عبر save_accounting_bank_account: الإضافة تنشئ حساب الدليل تحت 1113 (بنك)، أو بجانبه تحت 111
  // إن كان 1113 نفسه عليه قيود أو مسجلًا كبنك، وتحت 111 (صندوق). الرمز الفعلي يُعرض بعد الحفظ.
  // التعديل يرسل كل الحقول لأن الخادم يستبدلها كلها (العملة الفارغة تعود SAR والآيبان الفارغ يُمسح).
  const saveForm = async () => {
    if (!form) return;
    const name = form.name.trim().replace(/\s+/g, " ");
    const iban = form.kind === "bank" ? cleanIban(form.iban) : "";
    const bankName = form.kind === "bank" ? form.bankName.trim() : "";
    const currency = (form.currency.trim() || "SAR").toUpperCase();
    if (!name) { setFormError(accountingErrorText("BANK_ACCOUNT_NAME_REQUIRED", t)); return; }
    if (iban && !/^SA[0-9]{22}$/.test(iban)) { setFormError(accountingErrorText("BANK_ACCOUNT_IBAN_INVALID", t)); return; }
    if (!/^[A-Z]{3}$/.test(currency)) { setFormError(accountingErrorText("BANK_ACCOUNT_CURRENCY_INVALID", t)); return; }
    const payload = form.id
      ? { id: form.id, name, bankName, iban, currency, active: form.active }
      : { kind: form.kind, name, bankName, iban, currency, active: true };
    setSaving(true); setFormError("");
    const { data, error: saveError } = await supabase.rpc("save_accounting_bank_account", { p_account: payload });
    setSaving(false);
    if (saveError) { setFormError(accountingErrorText(saveError.message, t)); return; }
    const saved = (data ?? {}) as Partial<BankAccount>;
    const code = String(saved.account_code ?? "");
    setNotice(form.id
      ? `${t("تم حفظ الحساب")}: ${name}`
      : `${t(form.kind === "bank" ? "تم إنشاء الحساب البنكي" : "تم إنشاء الصندوق")} «${name}» — ${t("رمزه في شجرة الحسابات")}: ${code}`);
    setForm(null);
    if (!form.id && saved.id) setSelectedAccountId(String(saved.id));
    await load();
  };

  const toggleActive = async (account: BankAccount) => {
    if (account.active && !confirm(t("إيقاف الحساب يخفيه من اختيارات الدفع والتحصيل والتسوية، ويبقى حساب الدليل وقيوده كما هي. هل تريد المتابعة؟"))) return;
    setSaving(true); setError(""); setNotice("");
    const { error: toggleError } = await supabase.rpc("save_accounting_bank_account", { p_account: { id: account.id, name: account.name, bankName: account.bank_name ?? "", iban: account.iban ?? "", currency: account.currency || "SAR", active: !account.active } });
    setSaving(false);
    if (toggleError) { setError(accountingErrorText(toggleError.message, t)); return; }
    setNotice(`${t(account.active ? "تم إيقاف الحساب" : "تم تفعيل الحساب")}: ${account.name}`);
    await load();
  };

  const openImport = (account: BankAccount) => {
    setImportAccountId(account.id); setFile(null); setOpeningBalance(""); setClosingBalance(""); setStatementFrom(""); setStatementTo(""); setError(""); setShowImport(true);
  };

  const importStatement = async () => {
    if (!file || !importAccountId || !statementFrom || !statementTo) { setError(t("اختر الحساب والملف والفترة")); return; }
    setSaving(true); setError("");
    try {
      const parsed = parseStatementCsv(await file.text());
      const { error: importError } = await supabase.rpc("import_accounting_bank_statement", { p_bank_account_id: importAccountId, p_file_name: file.name, p_statement_from: statementFrom, p_statement_to: statementTo, p_opening_balance: openingBalance === "" ? null : numeric(openingBalance), p_closing_balance: closingBalance === "" ? null : numeric(closingBalance), p_lines: parsed });
      if (importError) throw importError;
      setShowImport(false); setSelectedAccountId(importAccountId); await load();
    } catch (caught) {
      const message = String((caught as { message?: unknown } | null)?.message ?? "");
      setError(message ? t(importErrorText(message)) : t("تعذر استيراد كشف الحساب"));
    }
    finally { setSaving(false); }
  };

  const openCandidates = async (line: StatementLine) => {
    const requestId = candidateRequest.current + 1;
    candidateRequest.current = requestId;
    setMatchingLine(line); setCandidates([]); setError("");
    const { data, error: candidateError } = await supabase.rpc("get_bank_reconciliation_candidates", { p_line_id: line.id });
    if (candidateRequest.current !== requestId) return;
    if (candidateError) { setError(accountingErrorText(candidateError.message, t)); return; }
    setCandidates((data ?? []) as Candidate[]);
  };

  const closeMatching = () => {
    candidateRequest.current += 1;
    setMatchingLine(null);
  };

  const match = async (candidate: Candidate) => {
    if (!matchingLine) return;
    setSaving(true);
    const { error: matchError } = await supabase.rpc("match_bank_statement_line", { p_line_id: matchingLine.id, p_journal_entry_id: candidate.journal_entry_id, p_note: null });
    setSaving(false);
    if (matchError) { setError(accountingErrorText(matchError.message, t)); return; }
    closeMatching(); await load();
  };

  const unmatch = async (line: StatementLine) => {
    setSaving(true);
    const { error: unmatchError } = await supabase.rpc("unmatch_bank_statement_line", { p_line_id: line.id });
    setSaving(false);
    if (unmatchError) { setError(accountingErrorText(unmatchError.message, t)); return; }
    await load();
  };

  return <Layout><main dir={direction} className="min-h-full bg-slate-50 p-4"><div className="mx-auto max-w-7xl overflow-hidden rounded border border-slate-200 bg-white shadow-sm">
    <header className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-red-700 px-5 py-3"><div><p className="text-[11px] text-slate-400">{t("المحاسبة والمالية")}</p><h1 className="text-base font-bold text-slate-800">{t("الحسابات البنكية والتسوية")}</h1></div><div className="flex items-center gap-2"><button onClick={() => openNew("bank")} className="inline-flex items-center gap-1 rounded bg-blue-700 px-3 py-2 text-xs font-semibold text-white"><Plus className="h-3.5 w-3.5" />{t("حساب بنكي جديد")}</button><button onClick={() => openNew("cash")} className="inline-flex items-center gap-1 rounded border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700"><Plus className="h-3.5 w-3.5" />{t("صندوق جديد")}</button><button onClick={() => void load()} className="rounded border border-slate-200 p-2" title={t("تحديث")}><RefreshCw className="h-4 w-4" /></button></div></header>
    {error && <div className="border-y border-red-200 bg-red-50 px-5 py-2 text-xs text-red-700">{error}</div>}
    {notice && <div className="flex items-center justify-between gap-2 border-y border-emerald-200 bg-emerald-50 px-5 py-2 text-xs text-emerald-800"><span><CheckCircle2 className="me-1 inline h-3.5 w-3.5" />{notice}</span><button onClick={() => setNotice("")} title={t("إغلاق")}><X className="h-3.5 w-3.5" /></button></div>}
    {loading ? <p className="py-20 text-center text-sm text-slate-500">{t("جاري التحميل...")}</p> : <>{activeAccounts.length === 0 && <section className="p-5"><div className="rounded border border-dashed border-slate-300 bg-slate-50 p-6 text-center"><p className="text-sm font-semibold text-slate-700">{t("لا توجد حسابات بنكية أو صناديق نشطة")}</p><p className="mt-1 text-xs text-slate-500">{t("أضف حسابًا بنكيًا أو صندوقًا ليظهر في سداد فواتير المشتريات وتحصيل المبيعات وسندات الصرف.")}</p><div className="mt-3 flex justify-center gap-2"><button onClick={() => openNew("bank")} className="inline-flex items-center gap-1 rounded bg-blue-700 px-3 py-2 text-xs font-semibold text-white"><Plus className="h-3.5 w-3.5" />{t("حساب بنكي جديد")}</button><button onClick={() => openNew("cash")} className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700"><Plus className="h-3.5 w-3.5" />{t("صندوق جديد")}</button></div></div></section>}<section className={`grid gap-4 p-5 lg:grid-cols-3 ${activeAccounts.length === 0 ? "hidden" : ""}`}>{activeAccounts.map((account) => { const latest = latestImportByAccount.get(account.id); const ledger = ledgerBalances[account.account_code] ?? 0; const statement = latest?.closing_balance == null ? null : numeric(latest.closing_balance); const difference = statement == null ? null : statement - ledger; const Icon = account.account_kind === "cash" ? WalletCards : Landmark; return <article key={account.id} className={`cursor-pointer rounded border bg-white p-4 shadow-sm ${selectedAccountId === account.id ? "border-blue-500 ring-1 ring-blue-200" : "border-slate-200"}`} onClick={() => setSelectedAccountId(account.id)}><div className="flex items-start justify-between gap-3"><div className="flex items-center gap-2"><span className="rounded-full bg-slate-100 p-2"><Icon className="h-4 w-4" /></span><div><h2 className="text-sm font-bold">{account.name}</h2><p className="text-[10px] text-slate-400">{t(account.account_kind === "cash" ? "صندوق" : "بنك")} · {account.account_code}{account.bank_name ? ` · ${account.bank_name}` : ""}</p></div></div>{account.account_kind === "bank" && <button onClick={(event) => { event.stopPropagation(); openImport(account); }} className="rounded border border-slate-200 px-2 py-1 text-[11px]"><FileUp className="me-1 inline h-3 w-3" />{t("استيراد كشف")}</button>}</div><div className="mt-4 grid gap-2 text-xs"><div className="flex justify-between"><span>{t("رصيد الدفتر")}</span><b>{money(ledger)} {account.currency}</b></div><div className="flex justify-between"><span>{t("رصيد آخر كشف")}</span><b>{statement == null ? t("غير متوفر") : `${money(statement)} ${account.currency}`}</b></div><div className="flex justify-between border-t pt-2"><span>{t("الفرق")}</span><b className={difference == null ? "text-slate-400" : Math.abs(difference) <= 0.01 ? "text-emerald-600" : "text-red-600"}>{difference == null ? t("غير محسوب") : `${money(difference)} ${account.currency}`}</b></div></div></article>; })}</section>
    <section className="border-t border-slate-200 p-5"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-bold text-slate-800">{t("الحسابات البنكية والصناديق")}</h2><span className="text-[11px] text-slate-400">{t("كل حساب مربوط بحساب طرفي في شجرة الحسابات تحت «النقد وما يعادله» (111)")}</span></div><div className="overflow-x-auto"><table className="min-w-full text-xs"><thead className="bg-slate-100"><tr><th className="px-3 py-2">{t("النوع")}</th><th className="px-3 py-2">{t("الاسم")}</th><th className="px-3 py-2">{t("حساب الدليل")}</th><th className="px-3 py-2">{t("البنك")}</th><th className="px-3 py-2">{t("الآيبان")}</th><th className="px-3 py-2">{t("العملة")}</th><th className="px-3 py-2">{t("الحالة")}</th><th className="px-3 py-2">{t("الإجراءات")}</th></tr></thead><tbody>{accounts.length ? accounts.map((account) => <tr key={account.id} className={`border-b ${account.active ? "" : "bg-slate-50 text-slate-400"}`}><td className="px-3 py-2 text-center"><span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold ${account.account_kind === "cash" ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700"}`}>{account.account_kind === "cash" ? <WalletCards className="h-3 w-3" /> : <Landmark className="h-3 w-3" />}{t(account.account_kind === "cash" ? "صندوق" : "بنك")}</span></td><td className="px-3 py-2 font-semibold">{account.name}</td><td className="px-3 py-2"><span className="font-mono">{account.account_code}</span>{chartNames[account.account_code] ? <span className="text-slate-500"> — {chartNames[account.account_code]}</span> : null}</td><td className="px-3 py-2">{account.bank_name || "—"}</td><td className="px-3 py-2 text-center font-mono" dir="ltr">{account.iban ? formatIban(account.iban) : "—"}</td><td className="px-3 py-2 text-center">{account.currency}</td><td className="px-3 py-2 text-center"><span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${account.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>{t(account.active ? "نشط" : "موقوف")}</span></td><td className="px-3 py-2"><div className="flex justify-center gap-1"><button onClick={() => openEdit(account)} disabled={saving} className="rounded border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50" title={t("تعديل")}><Pencil className="h-3.5 w-3.5" /></button><button onClick={() => void toggleActive(account)} disabled={saving} className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] ${account.active ? "border-red-200 text-red-600 hover:bg-red-50" : "border-emerald-200 text-emerald-700 hover:bg-emerald-50"}`} title={t(account.active ? "إيقاف" : "تفعيل")}><Power className="h-3 w-3" />{t(account.active ? "إيقاف" : "تفعيل")}</button></div></td></tr>) : <tr><td colSpan={8} className="py-10 text-center text-slate-400">{t("لا توجد حسابات بنكية أو صناديق بعد")}</td></tr>}</tbody></table></div></section>
    <section className="border-t border-slate-200 p-5"><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-bold text-slate-800">{t("حركات كشف الحساب")}</h2><span className="text-[11px] text-slate-400">{t("الاستيراد لا ينشئ قيودًا محاسبية")}</span></div><div className="overflow-x-auto"><table className="min-w-full text-xs"><thead className="bg-slate-100"><tr><th className="px-3 py-2">{t("التاريخ")}</th><th className="px-3 py-2">{t("المرجع")}</th><th className="px-3 py-2">{t("البيان")}</th><th className="px-3 py-2">{t("مدين البنك")}</th><th className="px-3 py-2">{t("دائن البنك")}</th><th className="px-3 py-2">{t("الرصيد")}</th><th className="px-3 py-2">{t("المطابقة")}</th></tr></thead><tbody>{selectedLines.length ? selectedLines.map((line) => <tr key={line.id} className="border-b"><td className="px-3 py-2 text-center">{line.transaction_date}</td><td className="px-3 py-2 text-center">{line.reference || "—"}</td><td className="px-3 py-2">{line.description || "—"}</td><td className="px-3 py-2 text-center">{money(numeric(line.debit))}</td><td className="px-3 py-2 text-center">{money(numeric(line.credit))}</td><td className="px-3 py-2 text-center">{line.running_balance == null ? "—" : money(numeric(line.running_balance))}</td><td className="px-3 py-2 text-center">{line.reconciliation_status === "matched" ? <button disabled={saving} onClick={() => void unmatch(line)} className="rounded bg-emerald-50 px-2 py-1 text-emerald-700"><CheckCircle2 className="me-1 inline h-3 w-3" />{t("مطابق")} <Unlink className="ms-1 inline h-3 w-3" /></button> : <button onClick={() => void openCandidates(line)} className="rounded bg-blue-50 px-2 py-1 text-blue-700"><Link2 className="me-1 inline h-3 w-3" />{t("مطابقة")}</button>}</td></tr>) : <tr><td colSpan={7} className="py-12 text-center text-slate-400">{t("لا توجد حركات مستوردة لهذا الحساب")}</td></tr>}</tbody></table></div></section></>}
  </div>
  {showImport && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={() => setShowImport(false)}><section className="w-full max-w-xl rounded-xl bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><header className="flex items-center justify-between border-b px-5 py-4"><h2 className="font-bold">{t("استيراد كشف حساب CSV")}</h2><button onClick={() => setShowImport(false)}><X className="h-5 w-5" /></button></header><div className="grid gap-3 p-5 md:grid-cols-2"><label className="text-xs">{t("من تاريخ")}<input type="date" value={statementFrom} onChange={(event) => setStatementFrom(event.target.value)} className="mt-1 block w-full rounded border p-2" /></label><label className="text-xs">{t("إلى تاريخ")}<input type="date" value={statementTo} onChange={(event) => setStatementTo(event.target.value)} className="mt-1 block w-full rounded border p-2" /></label><label className="text-xs">{t("الرصيد الافتتاحي")}<input type="number" step="0.01" value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} className="mt-1 block w-full rounded border p-2" /></label><label className="text-xs">{t("الرصيد الختامي")}<input type="number" step="0.01" value={closingBalance} onChange={(event) => setClosingBalance(event.target.value)} className="mt-1 block w-full rounded border p-2" /></label><label className="col-span-full text-xs">{t("ملف CSV")}<input type="file" accept=".csv,text/csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="mt-1 block w-full rounded border p-2" /></label><p className="col-span-full text-[11px] text-slate-400">date, value_date, reference, description, debit, credit, balance</p>{error && <p className="col-span-full rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}</div><footer className="flex justify-end gap-2 border-t px-5 py-4"><button onClick={() => setShowImport(false)} className="rounded border px-4 py-2 text-sm">{t("إلغاء")}</button><button disabled={saving} onClick={() => void importStatement()} className="rounded bg-blue-700 px-4 py-2 text-sm text-white disabled:opacity-50">{saving ? t("جاري الاستيراد...") : t("استيراد دون ترحيل")}</button></footer></section></div>}
  {matchingLine && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={closeMatching}><section className="w-full max-w-3xl rounded-xl bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><header className="flex items-center justify-between border-b px-5 py-4"><div><h2 className="font-bold">{t("مطابقة حركة كشف البنك")}</h2><p className="text-xs text-slate-500">{matchingLine.transaction_date} · {money(matchingLine.amount)} SAR</p></div><button onClick={closeMatching}><X className="h-5 w-5" /></button></header><div className="max-h-96 overflow-y-auto p-5">{candidates.length ? candidates.map((candidate) => <button key={candidate.journal_entry_id} disabled={saving} onClick={() => void match(candidate)} className="mb-2 flex w-full items-center justify-between rounded border border-slate-200 p-3 text-start hover:bg-blue-50"><span><b className="block text-sm">{candidate.reference}</b><span className="text-xs text-slate-500">{candidate.entry_date} · {candidate.description}</span></span><b className="text-sm text-blue-700">{money(candidate.ledger_amount)} SAR</b></button>) : <p className="py-10 text-center text-sm text-slate-400">{t("لا توجد قيود مرحّلة مطابقة في المبلغ ضمن سبعة أيام")}</p>}</div></section></div>}
  {form && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={() => setForm(null)}><section className="w-full max-w-lg rounded-xl bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><header className="flex items-center justify-between border-b px-5 py-4"><div><h2 className="font-bold">{t(form.id ? (form.kind === "cash" ? "تعديل الصندوق" : "تعديل الحساب البنكي") : (form.kind === "cash" ? "صندوق جديد" : "حساب بنكي جديد"))}</h2><p className="text-xs text-slate-500">{form.id ? t("نوع الحساب وحساب الدليل المربوط به لا يتغيران") : t(form.kind === "cash" ? "يُنشأ معه حساب فرعي جديد في شجرة الحسابات تحت «النقد وما يعادله» (111)" : "يُنشأ حساب فرعي جديد في دليل الحسابات تحت الحسابات البنكية (1113) أو النقد وما يعادله (111)")}</p></div><button onClick={() => setForm(null)}><X className="h-5 w-5" /></button></header><div className="grid gap-3 p-5 md:grid-cols-2"><label className="col-span-full text-xs">{t(form.kind === "cash" ? "اسم الصندوق" : "اسم الحساب")}<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder={t(form.kind === "cash" ? "مثال: صندوق الفرع" : "مثال: البنك الأهلي - الجاري")} className="mt-1 block w-full rounded border p-2" autoFocus /></label>{form.kind === "bank" && <><label className="text-xs">{t("اسم البنك")}<input value={form.bankName} onChange={(event) => setForm({ ...form, bankName: event.target.value })} className="mt-1 block w-full rounded border p-2" /></label><label className="text-xs">{t("العملة")}<input value={form.currency} maxLength={3} onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })} className="mt-1 block w-full rounded border p-2 font-mono" dir="ltr" /></label><label className="col-span-full text-xs">{t("الآيبان (اختياري)")}<input value={form.iban} onChange={(event) => setForm({ ...form, iban: event.target.value })} placeholder="SA00 0000 0000 0000 0000 0000" className="mt-1 block w-full rounded border p-2 font-mono" dir="ltr" /><span className="mt-1 block text-[11px] text-slate-400">{t("يبدأ بـ SA ويليه 22 رقمًا، والمسافات مسموحة")}</span></label></>}{form.kind === "cash" && <label className="text-xs">{t("العملة")}<input value={form.currency} maxLength={3} onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })} className="mt-1 block w-full rounded border p-2 font-mono" dir="ltr" /></label>}{form.id && <label className="col-span-full flex items-center gap-2 text-xs"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} />{t("الحساب نشط (يظهر في الدفع والتحصيل)")}</label>}{formError && <p className="col-span-full rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{formError}</p>}</div><footer className="flex justify-end gap-2 border-t px-5 py-4"><button onClick={() => setForm(null)} className="rounded border px-4 py-2 text-sm">{t("إلغاء")}</button><button disabled={saving} onClick={() => void saveForm()} className="rounded bg-blue-700 px-4 py-2 text-sm text-white disabled:opacity-50">{saving ? t("جاري الحفظ...") : t(form.id ? "حفظ التعديلات" : "إنشاء الحساب")}</button></footer></section></div>}
  </main></Layout>;
}
