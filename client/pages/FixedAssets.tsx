import { useEffect, useMemo, useRef, useState } from "react";
import { Calculator, Edit3, Eye, FilePlus2, Landmark, Loader2, Save, Trash2, X } from "lucide-react";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { accountingErrorText } from "@/lib/accountingErrors";
import { riyadhDateString } from "@/lib/utils";
import { COMPANY_PROFILE } from "@/lib/companyProfile";

type Account = { code: string; name_ar: string; parent_code: string | null };
type Disposal = { date: string; proceeds: number; carryingAmount: number; gainLoss: number; salesInvoiceId: string };
type Asset = {
  id: string; number: string; name: string; category: string; acquisitionDate: string; inServiceDate: string;
  cost: number; residualValue: number; usefulLifeMonths: number; assetAccountCode: string;
  accumulatedAccountCode: string; expenseAccountCode: string; status: "draft" | "active" | "disposed";
  capitalizationJournalId: string; disposalJournalId: string; disposedAt: string; accumulated: number;
  lastPeriodEnd: string; postedCount: number; disposal: Disposal | null;
};
type ActionMode = "capitalize" | "depreciate" | "dispose";
type AssetAction = { mode: ActionMode; asset: Asset };
// invoice: بيع بفاتورة مبيعات (المتحصلات من الفاتورة)، scrap: تلف أو شطب بلا متحصلات، direct: متحصلات مباشرة (منشأة غير مسجلة ضريبيًا فقط)
type DisposalMode = "invoice" | "scrap" | "direct";
type SaleInvoice = { id: string; date: string; customer: string; subtotal: number; journalEntryId: string };
type JournalLine = { accountCode: string; debit: number; credit: number };

const amount = (value: unknown) => Number(value ?? 0) || 0;
const round2 = (value: number) => Math.round(value * 100) / 100;
const pad2 = (value: number) => String(value).padStart(2, "0");
const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
// تواريخ أشهر الإهلاك بحساب السنة والشهر فقط (بلا تحويل Date→ISO بتوقيت محلي يزيح اليوم)
const monthEnd = (year: number, month: number) => `${year}-${pad2(month)}-${pad2(new Date(Date.UTC(year, month, 0)).getUTCDate())}`;
const monthEndOf = (isoDate: string) => { const [year, month] = isoDate.slice(0, 10).split("-").map(Number); return monthEnd(year, month); };
const nextMonthEnd = (isoDate: string) => { const [year, month] = isoDate.slice(0, 10).split("-").map(Number); return month === 12 ? monthEnd(year + 1, 1) : monthEnd(year, month + 1); };
// الشهر المستحق التالي: الشهر بعد آخر إهلاك مرحّل، أو شهر بدء الاستخدام إن لم يُرحَّل شيء (نفس قاعدة الخادم)
const nextDepreciationPeriod = (asset: Asset) => {
  if (asset.lastPeriodEnd && isIsoDate(asset.lastPeriodEnd.slice(0, 10))) return nextMonthEnd(asset.lastPeriodEnd);
  return isIsoDate(asset.inServiceDate.slice(0, 10)) ? monthEndOf(asset.inServiceDate) : "";
};
const fullyDepreciated = (asset: Asset) => asset.postedCount >= asset.usefulLifeMonths || asset.accumulated >= round2(asset.cost - asset.residualValue) - 0.005;
// قسط الشهر التالي كما يحسبه الخادم: القسط الشهري، والشهر الأخير يكمل الباقي
const nextDepreciationAmount = (asset: Asset) => {
  const depreciable = round2(asset.cost - asset.residualValue);
  const remaining = round2(depreciable - asset.accumulated);
  if (asset.postedCount + 1 >= asset.usefulLifeMonths) return Math.max(remaining, 0);
  return Math.max(Math.min(round2(depreciable / asset.usefulLifeMonths), remaining), 0);
};
// القيمة الدفترية: الأصل المستبعد صفر
const carryingValue = (asset: Asset) => asset.status === "disposed" ? 0 : Math.max(round2(asset.cost - asset.accumulated), 0);
const latestDate = (first: string, second: string) => (first > second ? first : second);

export default function FixedAssets() {
  const { t, direction, formatDate, formatNumber } = useI18n();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null | undefined>(undefined);
  const [name, setName] = useState(""); const [category, setCategory] = useState("");
  const [acquisitionDate, setAcquisitionDate] = useState(riyadhDateString()); const [inServiceDate, setInServiceDate] = useState(riyadhDateString());
  const [cost, setCost] = useState(""); const [residualValue, setResidualValue] = useState("0"); const [lifeMonths, setLifeMonths] = useState("60");
  const [assetAccount, setAssetAccount] = useState(""); const [accumulatedAccount, setAccumulatedAccount] = useState(""); const [expenseAccount, setExpenseAccount] = useState("");
  const [action, setAction] = useState<AssetAction | null>(null);
  const [actionDate, setActionDate] = useState(riyadhDateString()); const [actionAccount, setActionAccount] = useState("");
  const [proceeds, setProceeds] = useState("0"); const [gainLossAccount, setGainLossAccount] = useState("");
  const [disposalMode, setDisposalMode] = useState<DisposalMode>("invoice");
  const [saleInvoices, setSaleInvoices] = useState<SaleInvoice[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [usedInvoiceIds, setUsedInvoiceIds] = useState<Set<string>>(new Set());
  const [saleInvoiceId, setSaleInvoiceId] = useState("");
  const [clearingAccount, setClearingAccount] = useState("");
  // حسابات قاعدة الترحيل الافتراضية (الإيراد العام، الضريبة، الذمم...) لا تصلح حسابًا وسيطًا (FIXED_ASSET_PROCEEDS_ACCOUNT_RESERVED)
  const [postingRuleAccounts, setPostingRuleAccounts] = useState<Set<string>>(new Set());
  const [invoiceLines, setInvoiceLines] = useState<JournalLine[] | null>(null);
  const linesRequest = useRef(0);
  const [detail, setDetail] = useState<Asset | null>(null);

  const money = (value: number) => formatNumber(Math.abs(value) < 0.005 ? 0 : value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const errorText = (message: string) => accountingErrorText(message, t);
  // تاريخ فارغ أو غير صالح لا يمر إلى formatDate (يرمي خطأ مع Invalid Date)
  const showDate = (value: string) => (isIsoDate(String(value ?? "").slice(0, 10)) ? formatDate(String(value).slice(0, 10)) : value || "—");
  const hasVatNumber = Boolean(String(COMPANY_PROFILE.vatNumber ?? "").trim());

  const load = async () => {
    setLoading(true); setError("");
    const [accountResult, assetResult, depreciationResult, disposalResult, ruleResult] = await Promise.all([
      supabase.from("accounting_accounts").select("code, name_ar, parent_code").order("code"),
      supabase.from("fixed_assets").select("id, asset_number, name, category, acquisition_date, in_service_date, cost, residual_value, useful_life_months, asset_account_code, accumulated_depreciation_account_code, depreciation_expense_account_code, status, capitalization_journal_entry_id, disposal_journal_entry_id, disposed_at").order("created_at", { ascending: false }),
      supabase.from("fixed_asset_depreciation").select("asset_id, amount, period_end"),
      supabase.from("fixed_asset_disposals").select("asset_id, disposal_date, proceeds, carrying_amount, gain_loss, sales_invoice_id"),
      supabase.from("accounting_posting_rules").select("*").eq("rule_code", "sales_default").eq("active", true).maybeSingle(),
    ]);
    const firstError = accountResult.error ?? assetResult.error ?? depreciationResult.error ?? disposalResult.error;
    if (firstError) { setError(errorText(firstError.message)); setLoading(false); return; }
    const allAccounts = (accountResult.data ?? []) as Account[];
    setAccounts(allAccounts.filter((account) => !allAccounts.some((child) => child.parent_code === account.code)));
    // كل أعمدة *_account_code في القاعدة؛ إن تعذرت قراءتها تبقى قائمة الحساب الوسيط بلا تصفية
    const rule = ruleResult.error ? null : (ruleResult.data as Record<string, unknown> | null);
    setPostingRuleAccounts(new Set(
      Object.entries(rule ?? {})
        .filter(([column, value]) => column.endsWith("_account_code") && value != null && String(value).trim() !== "")
        .map(([, value]) => String(value).trim()),
    ));
    const depreciationRows = (depreciationResult.data ?? []) as Array<{ asset_id: string; amount: unknown; period_end: string | null }>;
    const disposalRows = (disposalResult.data ?? []) as Array<{ asset_id: string; disposal_date: string | null; proceeds: unknown; carrying_amount: unknown; gain_loss: unknown; sales_invoice_id: string | null }>;
    setUsedInvoiceIds(new Set(disposalRows.map((row) => String(row.sales_invoice_id ?? "")).filter(Boolean)));
    setAssets((assetResult.data ?? []).map((row: Record<string, unknown>) => {
      const rows = depreciationRows.filter((item) => item.asset_id === row.id);
      const disposalRow = disposalRows.find((item) => item.asset_id === row.id);
      return {
        id: String(row.id), number: String(row.asset_number), name: String(row.name), category: String(row.category),
        acquisitionDate: String(row.acquisition_date), inServiceDate: String(row.in_service_date), cost: amount(row.cost),
        residualValue: amount(row.residual_value), usefulLifeMonths: Number(row.useful_life_months), assetAccountCode: String(row.asset_account_code),
        accumulatedAccountCode: String(row.accumulated_depreciation_account_code), expenseAccountCode: String(row.depreciation_expense_account_code),
        status: row.status as Asset["status"], capitalizationJournalId: String(row.capitalization_journal_entry_id ?? ""),
        disposalJournalId: String(row.disposal_journal_entry_id ?? ""), disposedAt: String(row.disposed_at ?? ""),
        accumulated: round2(rows.reduce((sum, item) => sum + amount(item.amount), 0)),
        postedCount: rows.length,
        lastPeriodEnd: rows.reduce((latest, item) => latestDate(latest, String(item.period_end ?? "").slice(0, 10)), ""),
        disposal: disposalRow ? {
          date: String(disposalRow.disposal_date ?? row.disposed_at ?? ""), proceeds: amount(disposalRow.proceeds), carryingAmount: amount(disposalRow.carrying_amount),
          gainLoss: amount(disposalRow.gain_loss), salesInvoiceId: String(disposalRow.sales_invoice_id ?? ""),
        } : null,
      };
    }));
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);
  const totals = useMemo(() => assets.filter((asset) => asset.status === "active").reduce((sum, asset) => ({ cost: sum.cost + asset.cost, accumulated: sum.accumulated + asset.accumulated }), { cost: 0, accumulated: 0 }), [assets]);
  const accountOptions = (prefixes: string[]) => accounts.filter((account) => prefixes.some((prefix) => account.code.startsWith(prefix)));
  const hasLeafAccount = (code: string) => accounts.some((account) => account.code === code);

  const resetForm = () => { setEditingId(undefined); setName(""); setCategory(""); setAcquisitionDate(riyadhDateString()); setInServiceDate(riyadhDateString()); setCost(""); setResidualValue("0"); setLifeMonths("60"); setAssetAccount(""); setAccumulatedAccount(""); setExpenseAccount(""); };
  // مصروف الإهلاك الافتراضي 519 «مصروف الإهلاك» إن وُجد في الدليل
  const startNew = () => { resetForm(); setExpenseAccount(hasLeafAccount("519") ? "519" : ""); setEditingId(null); setError(""); };
  const startEdit = (asset: Asset) => { if (asset.status !== "draft") return; setEditingId(asset.id); setName(asset.name); setCategory(asset.category); setAcquisitionDate(asset.acquisitionDate); setInServiceDate(asset.inServiceDate); setCost(String(asset.cost)); setResidualValue(String(asset.residualValue)); setLifeMonths(String(asset.usefulLifeMonths)); setAssetAccount(asset.assetAccountCode); setAccumulatedAccount(asset.accumulatedAccountCode); setExpenseAccount(asset.expenseAccountCode); setError(""); };

  const saveAsset = async () => {
    if (!name.trim() || !category.trim() || !acquisitionDate || !inServiceDate || amount(cost) <= 0 || amount(residualValue) < 0 || Number(lifeMonths) <= 0 || !assetAccount || !accumulatedAccount || !expenseAccount) { setError(t("أكمل بيانات الأصل والحسابات والقيم المطلوبة")); return; }
    setBusy(true); setError("");
    const { error: saveError } = await supabase.rpc("save_fixed_asset", { p_id: editingId || null, p_asset: { name: name.trim(), category: category.trim(), acquisitionDate, inServiceDate, cost: amount(cost), residualValue: amount(residualValue), usefulLifeMonths: Number(lifeMonths), assetAccountCode: assetAccount, accumulatedDepreciationAccountCode: accumulatedAccount, depreciationExpenseAccountCode: expenseAccount } });
    setBusy(false);
    if (saveError) { setError(errorText(saveError.message)); return; }
    toast({ title: t("تم حفظ الأصل كمسودة") }); resetForm(); await load();
  };

  const deleteDraft = async (asset: Asset) => {
    if (!confirm(t("هل تريد حذف مسودة الأصل؟"))) return;
    setBusy(true); const { error: deleteError } = await supabase.rpc("delete_fixed_asset_draft", { p_id: asset.id }); setBusy(false);
    if (deleteError) { toast({ title: t("تعذر حذف الأصل"), description: errorText(deleteError.message), variant: "destructive" }); return; }
    toast({ title: t("تم حذف مسودة الأصل") }); await load();
  };

  // فواتير المبيعات المرحّلة محاسبيًا (غير المستخدمة تُصفّى عند العرض)
  const loadSaleInvoices = async () => {
    setInvoicesLoading(true); setSaleInvoices([]);
    const { data, error: invoiceError } = await supabase.from("sales_invoices").select("id, date, customer, subtotal, accounting_journal_entry_id").not("accounting_journal_entry_id", "is", null).eq("accounting_status", "posted").order("created_at", { ascending: false }).limit(300);
    setInvoicesLoading(false);
    if (invoiceError) { setError(errorText(invoiceError.message)); return; }
    setSaleInvoices(((data ?? []) as Array<Record<string, unknown>>).map((row) => ({ id: String(row.id), date: String(row.date ?? ""), customer: String(row.customer ?? ""), subtotal: amount(row.subtotal), journalEntryId: String(row.accounting_journal_entry_id) })));
  };

  const minDisposalDate = (asset: Asset) => latestDate(asset.inServiceDate.slice(0, 10), asset.lastPeriodEnd);

  // اختيار الفاتورة: نقرأ أسطر قيدها لنعرض المتحصلات المقيّدة على الحساب الوسيط قبل الترحيل
  const selectSaleInvoice = async (invoiceId: string) => {
    setSaleInvoiceId(invoiceId); setInvoiceLines(null); setError("");
    const requestId = linesRequest.current + 1;
    linesRequest.current = requestId;
    const invoice = saleInvoices.find((item) => item.id === invoiceId);
    if (!invoice) return;
    const invoiceDate = invoice.date.slice(0, 10);
    if (action && isIsoDate(invoiceDate) && invoiceDate >= minDisposalDate(action.asset) && invoiceDate <= riyadhDateString()) setActionDate(invoiceDate);
    const { data, error: linesError } = await supabase.from("accounting_journal_lines").select("account_code, debit, credit").eq("journal_entry_id", invoice.journalEntryId);
    if (linesRequest.current !== requestId) return;
    if (linesError) { setError(errorText(linesError.message)); setInvoiceLines([]); return; }
    setInvoiceLines(((data ?? []) as Array<Record<string, unknown>>).map((row) => ({ accountCode: String(row.account_code), debit: amount(row.debit), credit: amount(row.credit) })));
  };

  const openAction = (mode: ActionMode, asset: Asset) => {
    setAction({ mode, asset }); setActionAccount(""); setProceeds("0"); setGainLossAccount(""); setError("");
    setActionDate(mode === "depreciate" ? nextDepreciationPeriod(asset) : riyadhDateString());
    if (mode === "dispose") {
      linesRequest.current += 1;
      setDisposalMode("invoice"); setSaleInvoiceId(""); setInvoiceLines(null);
      setClearingAccount(hasLeafAccount("423") && !postingRuleAccounts.has("423") ? "423" : "");
      void loadSaleInvoices();
    }
  };
  const closeAction = () => { linesRequest.current += 1; setAction(null); setError(""); };

  // معاينة الاستبعاد
  const invoiceProceeds = invoiceLines == null ? null : round2(invoiceLines.filter((line) => line.accountCode === clearingAccount).reduce((sum, line) => sum + line.credit - line.debit, 0));
  const invoiceCredits = (invoiceLines ?? []).filter((line) => line.credit > 0).reduce<Record<string, number>>((sum, line) => ({ ...sum, [line.accountCode]: round2((sum[line.accountCode] ?? 0) + line.credit) }), {});
  const disposalProceeds = disposalMode === "invoice" ? Math.max(invoiceProceeds ?? 0, 0) : disposalMode === "direct" ? round2(amount(proceeds)) : 0;
  const actionCarrying = action ? carryingValue(action.asset) : 0;
  const disposalGainLoss = round2(disposalProceeds - actionCarrying);
  const availableInvoices = saleInvoices.filter((invoice) => !usedInvoiceIds.has(invoice.id));
  const todayRiyadh = riyadhDateString();
  const actionNextPeriod = action ? nextDepreciationPeriod(action.asset) : "";
  const actionFullyDepreciated = action ? fullyDepreciated(action.asset) : false;
  const actionDepreciationDue = Boolean(actionNextPeriod) && actionNextPeriod <= todayRiyadh;
  const disposeReady = Boolean(gainLossAccount) && Boolean(actionDate) && (
    disposalMode === "scrap"
    || (disposalMode === "direct" && !hasVatNumber && amount(proceeds) > 0 && Boolean(actionAccount))
    || (disposalMode === "invoice" && Boolean(saleInvoiceId) && Boolean(clearingAccount) && (invoiceProceeds ?? 0) > 0)
  );
  const actionReady = action == null ? false
    : action.mode === "capitalize" ? Boolean(actionAccount)
    : action.mode === "depreciate" ? actionDepreciationDue && !actionFullyDepreciated && Boolean(actionDate)
    : disposeReady;

  const runAction = async () => {
    if (!action) return;
    setBusy(true); setError("");
    let result;
    if (action.mode === "capitalize") result = await supabase.rpc("capitalize_fixed_asset", { p_id: action.asset.id, p_credit_account_code: actionAccount });
    else if (action.mode === "depreciate") result = await supabase.rpc("post_fixed_asset_depreciation", { p_id: action.asset.id, p_period_end: actionDate });
    else {
      const sale = disposalMode === "invoice";
      const direct = disposalMode === "direct";
      result = await supabase.rpc("dispose_fixed_asset", {
        p_id: action.asset.id, p_disposal_date: actionDate,
        p_proceeds: direct ? amount(proceeds) : 0,
        p_proceeds_account_code: sale ? clearingAccount : direct ? actionAccount || null : null,
        p_gain_loss_account_code: gainLossAccount,
        p_sales_invoice_id: sale ? saleInvoiceId : null,
      });
    }
    setBusy(false);
    if (result.error) { setError(errorText(result.error.message)); return; }
    toast({ title: t(action.mode === "capitalize" ? "تمت رسملة الأصل" : action.mode === "depreciate" ? "تم ترحيل قيد الإهلاك" : "تم استبعاد الأصل") }); setAction(null); await load();
  };

  const SelectAccount = ({ label, value, onChange, prefixes, exclude }: { label: string; value: string; onChange: (value: string) => void; prefixes: string[]; exclude?: Set<string> }) => <label className="block text-xs text-slate-600">{t(label)}<select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-10 w-full rounded border px-2 text-sm"><option value="">{t("اختر حسابًا طرفيًا")}</option>{accountOptions(prefixes).filter((account) => !exclude?.has(account.code)).map((account) => <option key={account.code} value={account.code}>{account.code} — {account.name_ar}</option>)}</select></label>;
  const modeButton = (mode: DisposalMode, title: string, hint: string) => <button type="button" onClick={() => setDisposalMode(mode)} className={`rounded border p-3 text-start text-xs ${disposalMode === mode ? "border-emerald-600 bg-emerald-50 ring-1 ring-emerald-200" : "border-slate-200 hover:bg-slate-50"}`}><b className="block text-sm text-slate-800">{t(title)}</b><span className="text-slate-500">{t(hint)}</span></button>;

  return <Layout><main dir={direction} className="space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-3"><div className="rounded-lg bg-indigo-50 p-2 text-indigo-700"><Landmark className="h-6 w-6" /></div><div><h1 className="text-2xl font-bold text-slate-900">{t("الأصول الثابتة")}</h1><p className="mt-1 text-sm text-slate-500">{t("سجل الأصول ورسملتها وإهلاكها واستبعادها بقيود محاسبية مستقلة.")}</p></div></div><button onClick={startNew} className="inline-flex items-center gap-2 rounded bg-indigo-700 px-4 py-2 text-sm font-semibold text-white"><FilePlus2 className="h-4 w-4" />{t("أصل ثابت جديد")}</button></header>
    {error && !action && <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
    <section className="grid gap-3 md:grid-cols-3"><div className="rounded-xl border bg-white p-4"><p className="text-xs text-slate-500">{t("إجمالي تكلفة الأصول")}</p><p className="mt-2 text-xl font-bold">{money(totals.cost)} SAR</p></div><div className="rounded-xl border bg-white p-4"><p className="text-xs text-slate-500">{t("مجمع الإهلاك")}</p><p className="mt-2 text-xl font-bold text-amber-700">{money(totals.accumulated)} SAR</p></div><div className="rounded-xl border bg-white p-4"><p className="text-xs text-slate-500">{t("صافي القيمة الدفترية")}</p><p className="mt-2 text-xl font-bold text-emerald-700">{money(totals.cost - totals.accumulated)} SAR</p></div></section>

    {editingId !== undefined && <section className="rounded-xl border bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><h2 className="font-bold">{t(editingId ? "تعديل مسودة الأصل" : "أصل ثابت جديد")}</h2><button onClick={resetForm}><X className="h-5 w-5" /></button></div><div className="grid gap-3 md:grid-cols-3"><label className="text-xs text-slate-600">{t("اسم الأصل")}<input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label><label className="text-xs text-slate-600">{t("التصنيف")}<input value={category} onChange={(event) => setCategory(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label><label className="text-xs text-slate-600">{t("تاريخ الشراء")}<input type="date" value={acquisitionDate} max={todayRiyadh} onChange={(event) => setAcquisitionDate(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label><label className="text-xs text-slate-600">{t("تاريخ بدء الاستخدام")}<input type="date" value={inServiceDate} max={todayRiyadh} onChange={(event) => setInServiceDate(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label><label className="text-xs text-slate-600">{t("تكلفة الأصل دون ضريبة قابلة للاسترداد")}<input type="number" min="0.01" step="0.01" value={cost} onChange={(event) => setCost(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label><label className="text-xs text-slate-600">{t("القيمة التخريدية")}<input type="number" min="0" step="0.01" value={residualValue} onChange={(event) => setResidualValue(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label><label className="text-xs text-slate-600">{t("العمر الإنتاجي بالأشهر")}<input type="number" min="1" value={lifeMonths} onChange={(event) => setLifeMonths(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label><SelectAccount label="حساب تكلفة الأصل" value={assetAccount} onChange={setAssetAccount} prefixes={["1"]} /><SelectAccount label="حساب مجمع الإهلاك" value={accumulatedAccount} onChange={setAccumulatedAccount} prefixes={["1"]} /><SelectAccount label="حساب مصروف الإهلاك" value={expenseAccount} onChange={setExpenseAccount} prefixes={["5"]} /></div><div className="mt-4 flex justify-end"><button onClick={() => void saveAsset()} disabled={busy} className="inline-flex items-center gap-2 rounded bg-indigo-700 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4" />{t("حفظ المسودة")}</button></div></section>}

    <section className="overflow-hidden rounded-xl border bg-white shadow-sm"><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-100 text-slate-600"><tr><th className="p-3">{t("رقم الأصل")}</th><th className="p-3">{t("الأصل")}</th><th className="p-3">{t("التكلفة")}</th><th className="p-3">{t("مجمع الإهلاك")}</th><th className="p-3">{t("القيمة الدفترية")}</th><th className="p-3">{t("الحالة")}</th><th className="p-3">{t("الإجراءات")}</th></tr></thead><tbody>{loading ? <tr><td colSpan={7} className="py-14 text-center">{t("جاري التحميل...")}</td></tr> : assets.length === 0 ? <tr><td colSpan={7} className="py-14 text-center text-slate-400">{t("لا توجد أصول ثابتة")}</td></tr> : assets.map((asset) => <tr key={asset.id} className="border-t"><td className="p-3 font-mono">{asset.number}</td><td className="p-3"><p className="font-semibold">{asset.name}</p><p className="text-xs text-slate-500">{asset.category}</p></td><td className="p-3 text-center">{money(asset.cost)}</td><td className="p-3 text-center">{money(asset.accumulated)}</td><td className="p-3 text-center font-semibold">{money(carryingValue(asset))}{asset.status === "disposed" && <p className="text-[11px] font-normal text-slate-500">{t("استُبعد")} {showDate(asset.disposal?.date || asset.disposedAt)}{asset.disposal && asset.disposal.proceeds > 0 ? ` · ${t("المتحصلات")} ${money(asset.disposal.proceeds)}` : ""}</p>}</td><td className="p-3 text-center"><span className={`rounded px-2 py-1 text-xs font-semibold ${asset.status === "active" ? "bg-emerald-50 text-emerald-700" : asset.status === "draft" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{t(asset.status === "active" ? "نشط" : asset.status === "draft" ? "مسودة" : "مستبعد")}</span></td><td className="p-3"><div className="flex flex-wrap justify-center gap-1"><button onClick={() => setDetail(asset)} className="rounded border p-2" title={t("عرض")}><Eye className="h-4 w-4" /></button>{asset.status === "draft" && <><button onClick={() => startEdit(asset)} className="rounded border p-2" title={t("تعديل")}><Edit3 className="h-4 w-4" /></button><button onClick={() => openAction("capitalize", asset)} className="rounded bg-emerald-700 px-3 py-2 text-xs font-semibold text-white">{t("رسملة")}</button><button onClick={() => void deleteDraft(asset)} className="rounded border border-red-200 p-2 text-red-600" title={t("حذف")}><Trash2 className="h-4 w-4" /></button></>}{asset.status === "active" && <><button onClick={() => openAction("depreciate", asset)} className="rounded bg-indigo-700 px-3 py-2 text-xs font-semibold text-white">{t("ترحيل إهلاك")}</button><button onClick={() => openAction("dispose", asset)} className="rounded border px-3 py-2 text-xs font-semibold">{t("استبعاد")}</button></>}</div></td></tr>)}</tbody></table></div></section>

    {action && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={closeAction}><section className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
      <div className="mb-4 flex items-center justify-between"><div><h2 className="font-bold">{t(action.mode === "capitalize" ? "رسملة الأصل" : action.mode === "depreciate" ? "ترحيل إهلاك شهري" : "استبعاد الأصل")}</h2><p className="text-xs text-slate-500">{action.asset.number} — {action.asset.name}</p></div><button onClick={closeAction}><X className="h-5 w-5" /></button></div>
      {action.mode === "capitalize" && <SelectAccount label="الحساب الدائن: بنك أو مورد" value={actionAccount} onChange={setActionAccount} prefixes={["1", "2"]} />}
      {action.mode === "depreciate" && <div className="space-y-2">
        <label className="block text-xs text-slate-600">{t("نهاية شهر الإهلاك")}<input type="date" value={actionDate} max={todayRiyadh} disabled={!actionDepreciationDue || actionFullyDepreciated} onChange={(event) => setActionDate(event.target.value)} className="mt-1 h-10 w-full rounded border px-3 disabled:bg-slate-100 disabled:text-slate-500" /></label>
        {actionFullyDepreciated
          ? <p className="rounded bg-slate-100 p-2 text-xs text-slate-600">{errorText("FIXED_ASSET_FULLY_DEPRECIATED")}</p>
          : !actionDepreciationDue
            ? <p className="rounded bg-amber-50 p-2 text-xs text-amber-800">{t("لم يحن بعد إهلاك الشهر التالي")} ({actionNextPeriod || "—"}). {t("يُرحَّل إهلاك الشهر بعد انتهائه بتوقيت الرياض.")}</p>
            : <p className="rounded bg-slate-50 p-2 text-xs text-slate-600">{t("الشهر المستحق التالي")}: <b>{actionNextPeriod}</b>{action.asset.lastPeriodEnd ? ` · ${t("آخر إهلاك مرحّل")}: ${action.asset.lastPeriodEnd}` : ""} · {t("القسط")}: <b>{money(nextDepreciationAmount(action.asset))}</b> SAR. {t("يُرحَّل الإهلاك شهرًا بعد شهر بالترتيب.")}</p>}
      </div>}
      {action.mode === "dispose" && <div className="space-y-3">
        <div className={`grid gap-2 ${hasVatNumber ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
          {modeButton("invoice", "بيع بفاتورة مبيعات", "المتحصلات وضريبتها من فاتورة مبيعات مرحّلة")}
          {modeButton("scrap", "استبعاد بلا متحصلات (تلف/شطب)", "القيمة الدفترية كلها خسارة استبعاد")}
          {!hasVatNumber && modeButton("direct", "بيع بمتحصلات مباشرة", "منشأة غير مسجلة ضريبيًا: المتحصلات إلى نقدية أو بنك")}
        </div>
        <label className="block text-xs text-slate-600">{t("تاريخ الاستبعاد")}<input type="date" value={actionDate} min={minDisposalDate(action.asset)} max={todayRiyadh} onChange={(event) => setActionDate(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label>
        {disposalMode === "invoice" && <>
          <p className="rounded bg-blue-50 p-2 text-xs leading-relaxed text-blue-800">{t("أصدر فاتورة مبيعات للمشتري ببند على حساب متحصلات بيع الأصول (423) ثم اخترها هنا")}</p>
          <label className="block text-xs text-slate-600">{t("فاتورة المبيعات")}<select value={saleInvoiceId} onChange={(event) => void selectSaleInvoice(event.target.value)} className="mt-1 h-10 w-full rounded border px-2 text-sm"><option value="">{invoicesLoading ? t("جاري التحميل...") : t("اختر فاتورة مبيعات مرحّلة")}</option>{availableInvoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.id} — {invoice.customer || "—"} — {invoice.date || "—"} — {money(invoice.subtotal)} {t("قبل الضريبة")}</option>)}</select></label>
          {!invoicesLoading && availableInvoices.length === 0 && <p className="text-xs text-slate-500">{t("لا توجد فواتير مبيعات مرحّلة غير مستخدمة في استبعاد سابق.")}</p>}
          <SelectAccount label="حساب متحصلات بيع الأصول (الحساب الوسيط في بند الفاتورة)" value={clearingAccount} onChange={setClearingAccount} prefixes={["4", "2"]} exclude={postingRuleAccounts} />
          {saleInvoiceId && invoiceLines === null && <p className="text-xs text-slate-500"><Loader2 className="me-1 inline h-3 w-3 animate-spin" />{t("جاري قراءة قيد الفاتورة...")}</p>}
          {saleInvoiceId && invoiceLines !== null && (invoiceProceeds ?? 0) <= 0 && <p className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">{errorText("FIXED_ASSET_SALE_INVOICE_ACCOUNT_MISMATCH")}{Object.keys(invoiceCredits).length ? ` ${t("الحسابات الدائنة في قيد الفاتورة")}: ${Object.entries(invoiceCredits).map(([code, value]) => `${code} (${money(value)})`).join("، ")}` : ""}</p>}
        </>}
        {disposalMode === "direct" && !hasVatNumber && <>
          <label className="block text-xs text-slate-600">{t("متحصلات البيع")}<input type="number" min="0" step="0.01" value={proceeds} onChange={(event) => setProceeds(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label>
          <SelectAccount label="حساب إيداع المتحصلات" value={actionAccount} onChange={setActionAccount} prefixes={["1"]} />
        </>}
        <SelectAccount label="حساب أرباح أو خسائر الاستبعاد" value={gainLossAccount} onChange={setGainLossAccount} prefixes={["4", "5"]} />
        <div className="grid gap-2 rounded border border-slate-200 bg-slate-50 p-3 text-xs sm:grid-cols-3"><div><p className="text-slate-500">{t("القيمة الدفترية الحالية")}</p><p className="font-bold">{money(actionCarrying)} SAR</p></div><div><p className="text-slate-500">{t("المتحصلات")}</p><p className="font-bold">{disposalMode === "invoice" && invoiceProceeds == null ? "—" : `${money(disposalProceeds)} SAR`}</p></div><div><p className="text-slate-500">{t(disposalGainLoss >= 0 ? "ربح الاستبعاد" : "خسارة الاستبعاد")}</p><p className={`font-bold ${disposalGainLoss > 0 ? "text-emerald-700" : disposalGainLoss < 0 ? "text-red-700" : ""}`}>{disposalMode === "invoice" && invoiceProceeds == null ? "—" : `${money(Math.abs(disposalGainLoss))} SAR`}</p></div></div>
      </div>}
      {error && <div className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
      <div className="mt-4 rounded bg-amber-50 p-3 text-xs text-amber-800">{t("سيتم إنشاء قيد محاسبي مرحّل مستقل، ولن يمكن تعديل العملية بعد الترحيل.")}</div>
      <div className="mt-4 flex justify-end"><button onClick={() => void runAction()} disabled={busy || !actionReady} className="inline-flex items-center gap-2 rounded bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}{t("تأكيد وترحيل")}</button></div>
    </section></div>}

    {detail && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={() => setDetail(null)}><section className="w-full max-w-2xl rounded-xl bg-white p-5" onMouseDown={(event) => event.stopPropagation()}><div className="flex items-start justify-between"><div><h2 className="font-bold">{detail.name}</h2><p className="text-xs text-slate-500">{detail.number} — {detail.category}</p></div><button onClick={() => setDetail(null)}><X className="h-5 w-5" /></button></div><dl className="mt-5 grid gap-4 text-sm md:grid-cols-3"><div><dt className="text-slate-500">{t("تاريخ الشراء")}</dt><dd className="font-semibold">{formatDate(detail.acquisitionDate)}</dd></div><div><dt className="text-slate-500">{t("بدء الاستخدام")}</dt><dd className="font-semibold">{formatDate(detail.inServiceDate)}</dd></div><div><dt className="text-slate-500">{t("العمر الإنتاجي")}</dt><dd className="font-semibold">{detail.usefulLifeMonths} {t("شهر")}</dd></div><div><dt className="text-slate-500">{t("حساب الأصل")}</dt><dd className="font-semibold">{detail.assetAccountCode}</dd></div><div><dt className="text-slate-500">{t("حساب مجمع الإهلاك")}</dt><dd className="font-semibold">{detail.accumulatedAccountCode}</dd></div><div><dt className="text-slate-500">{t("حساب مصروف الإهلاك")}</dt><dd className="font-semibold">{detail.expenseAccountCode}</dd></div><div><dt className="text-slate-500">{t("مجمع الإهلاك")}</dt><dd className="font-semibold">{money(detail.accumulated)} SAR</dd></div><div><dt className="text-slate-500">{t("القيمة الدفترية")}</dt><dd className="font-semibold">{money(carryingValue(detail))} SAR</dd></div><div><dt className="text-slate-500">{t("آخر إهلاك مرحّل")}</dt><dd className="font-semibold">{showDate(detail.lastPeriodEnd)}</dd></div>{detail.status === "disposed" && <><div><dt className="text-slate-500">{t("تاريخ الاستبعاد")}</dt><dd className="font-semibold">{showDate(detail.disposal?.date || detail.disposedAt)}</dd></div>{detail.disposal && <><div><dt className="text-slate-500">{t("المتحصلات")}</dt><dd className="font-semibold">{money(detail.disposal.proceeds)} SAR</dd></div><div><dt className="text-slate-500">{t("القيمة الدفترية عند الاستبعاد")}</dt><dd className="font-semibold">{money(detail.disposal.carryingAmount)} SAR</dd></div><div><dt className="text-slate-500">{t(detail.disposal.gainLoss >= 0 ? "ربح الاستبعاد" : "خسارة الاستبعاد")}</dt><dd className={`font-semibold ${detail.disposal.gainLoss > 0 ? "text-emerald-700" : detail.disposal.gainLoss < 0 ? "text-red-700" : ""}`}>{money(Math.abs(detail.disposal.gainLoss))} SAR</dd></div><div><dt className="text-slate-500">{t("فاتورة المبيعات")}</dt><dd className="font-semibold font-mono">{detail.disposal.salesInvoiceId || "—"}</dd></div></>}</>}</dl></section></div>}
  </main></Layout>;
}
