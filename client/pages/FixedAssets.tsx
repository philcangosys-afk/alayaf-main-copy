import { useEffect, useMemo, useState } from "react";
import { Calculator, Edit3, Eye, FilePlus2, Landmark, Loader2, Save, Trash2, X } from "lucide-react";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";

type Account = { code: string; name_ar: string; parent_code: string | null };
type Asset = {
  id: string; number: string; name: string; category: string; acquisitionDate: string; inServiceDate: string;
  cost: number; residualValue: number; usefulLifeMonths: number; assetAccountCode: string;
  accumulatedAccountCode: string; expenseAccountCode: string; status: "draft" | "active" | "disposed";
  capitalizationJournalId: string; disposalJournalId: string; disposedAt: string; accumulated: number;
};
type ActionMode = "capitalize" | "depreciate" | "dispose";
type AssetAction = { mode: ActionMode; asset: Asset };

const amount = (value: unknown) => Number(value ?? 0) || 0;
const today = () => new Date().toISOString().slice(0, 10);
const previousMonthEnd = () => new Date(new Date().getFullYear(), new Date().getMonth(), 0).toISOString().slice(0, 10);

export default function FixedAssets() {
  const { t, direction, formatDate, formatNumber } = useI18n();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null | undefined>(undefined);
  const [name, setName] = useState(""); const [category, setCategory] = useState("");
  const [acquisitionDate, setAcquisitionDate] = useState(today()); const [inServiceDate, setInServiceDate] = useState(today());
  const [cost, setCost] = useState(""); const [residualValue, setResidualValue] = useState("0"); const [lifeMonths, setLifeMonths] = useState("60");
  const [assetAccount, setAssetAccount] = useState(""); const [accumulatedAccount, setAccumulatedAccount] = useState(""); const [expenseAccount, setExpenseAccount] = useState("");
  const [action, setAction] = useState<AssetAction | null>(null);
  const [actionDate, setActionDate] = useState(previousMonthEnd()); const [actionAccount, setActionAccount] = useState("");
  const [proceeds, setProceeds] = useState("0"); const [gainLossAccount, setGainLossAccount] = useState("");
  const [detail, setDetail] = useState<Asset | null>(null);

  const money = (value: number) => formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const load = async () => {
    setLoading(true); setError("");
    const [accountResult, assetResult, depreciationResult] = await Promise.all([
      supabase.from("accounting_accounts").select("code, name_ar, parent_code").order("code"),
      supabase.from("fixed_assets").select("id, asset_number, name, category, acquisition_date, in_service_date, cost, residual_value, useful_life_months, asset_account_code, accumulated_depreciation_account_code, depreciation_expense_account_code, status, capitalization_journal_entry_id, disposal_journal_entry_id, disposed_at").order("created_at", { ascending: false }),
      supabase.from("fixed_asset_depreciation").select("asset_id, amount"),
    ]);
    const firstError = accountResult.error ?? assetResult.error ?? depreciationResult.error;
    if (firstError) { setError(firstError.message); setLoading(false); return; }
    const allAccounts = (accountResult.data ?? []) as Account[];
    setAccounts(allAccounts.filter((account) => !allAccounts.some((child) => child.parent_code === account.code)));
    setAssets((assetResult.data ?? []).map((row) => ({
      id: String(row.id), number: String(row.asset_number), name: String(row.name), category: String(row.category),
      acquisitionDate: String(row.acquisition_date), inServiceDate: String(row.in_service_date), cost: amount(row.cost),
      residualValue: amount(row.residual_value), usefulLifeMonths: Number(row.useful_life_months), assetAccountCode: String(row.asset_account_code),
      accumulatedAccountCode: String(row.accumulated_depreciation_account_code), expenseAccountCode: String(row.depreciation_expense_account_code),
      status: row.status as Asset["status"], capitalizationJournalId: String(row.capitalization_journal_entry_id ?? ""),
      disposalJournalId: String(row.disposal_journal_entry_id ?? ""), disposedAt: String(row.disposed_at ?? ""),
      accumulated: (depreciationResult.data ?? []).filter((item) => item.asset_id === row.id).reduce((sum, item) => sum + amount(item.amount), 0),
    })));
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);
  const totals = useMemo(() => assets.filter((asset) => asset.status === "active").reduce((sum, asset) => ({ cost: sum.cost + asset.cost, accumulated: sum.accumulated + asset.accumulated }), { cost: 0, accumulated: 0 }), [assets]);
  const accountOptions = (prefixes: string[]) => accounts.filter((account) => prefixes.some((prefix) => account.code.startsWith(prefix)));

  const resetForm = () => { setEditingId(undefined); setName(""); setCategory(""); setAcquisitionDate(today()); setInServiceDate(today()); setCost(""); setResidualValue("0"); setLifeMonths("60"); setAssetAccount(""); setAccumulatedAccount(""); setExpenseAccount(""); };
  const startNew = () => { resetForm(); setEditingId(null); setError(""); };
  const startEdit = (asset: Asset) => { if (asset.status !== "draft") return; setEditingId(asset.id); setName(asset.name); setCategory(asset.category); setAcquisitionDate(asset.acquisitionDate); setInServiceDate(asset.inServiceDate); setCost(String(asset.cost)); setResidualValue(String(asset.residualValue)); setLifeMonths(String(asset.usefulLifeMonths)); setAssetAccount(asset.assetAccountCode); setAccumulatedAccount(asset.accumulatedAccountCode); setExpenseAccount(asset.expenseAccountCode); setError(""); };

  const saveAsset = async () => {
    if (!name.trim() || !category.trim() || !acquisitionDate || !inServiceDate || amount(cost) <= 0 || amount(residualValue) < 0 || Number(lifeMonths) <= 0 || !assetAccount || !accumulatedAccount || !expenseAccount) { setError(t("أكمل بيانات الأصل والحسابات والقيم المطلوبة")); return; }
    setBusy(true); setError("");
    const { error: saveError } = await supabase.rpc("save_fixed_asset", { p_id: editingId || null, p_asset: { name: name.trim(), category: category.trim(), acquisitionDate, inServiceDate, cost: amount(cost), residualValue: amount(residualValue), usefulLifeMonths: Number(lifeMonths), assetAccountCode: assetAccount, accumulatedDepreciationAccountCode: accumulatedAccount, depreciationExpenseAccountCode: expenseAccount } });
    setBusy(false);
    if (saveError) { setError(saveError.message); return; }
    toast({ title: t("تم حفظ الأصل كمسودة") }); resetForm(); await load();
  };

  const deleteDraft = async (asset: Asset) => {
    if (!confirm(t("هل تريد حذف مسودة الأصل؟"))) return;
    setBusy(true); const { error: deleteError } = await supabase.rpc("delete_fixed_asset_draft", { p_id: asset.id }); setBusy(false);
    if (deleteError) { toast({ title: t("تعذر حذف الأصل"), description: deleteError.message, variant: "destructive" }); return; }
    toast({ title: t("تم حذف مسودة الأصل") }); await load();
  };

  const openAction = (mode: ActionMode, asset: Asset) => { setAction({ mode, asset }); setActionDate(mode === "depreciate" ? previousMonthEnd() : today()); setActionAccount(""); setProceeds("0"); setGainLossAccount(""); setError(""); };
  const runAction = async () => {
    if (!action) return;
    setBusy(true); setError("");
    let result;
    if (action.mode === "capitalize") result = await supabase.rpc("capitalize_fixed_asset", { p_id: action.asset.id, p_credit_account_code: actionAccount });
    else if (action.mode === "depreciate") result = await supabase.rpc("post_fixed_asset_depreciation", { p_id: action.asset.id, p_period_end: actionDate });
    else result = await supabase.rpc("dispose_fixed_asset", { p_id: action.asset.id, p_disposal_date: actionDate, p_proceeds: amount(proceeds), p_proceeds_account_code: actionAccount || null, p_gain_loss_account_code: gainLossAccount });
    setBusy(false);
    if (result.error) { setError(result.error.message); return; }
    toast({ title: t(action.mode === "capitalize" ? "تمت رسملة الأصل" : action.mode === "depreciate" ? "تم ترحيل قيد الإهلاك" : "تم استبعاد الأصل") }); setAction(null); await load();
  };

  const SelectAccount = ({ label, value, onChange, prefixes }: { label: string; value: string; onChange: (value: string) => void; prefixes: string[] }) => <label className="text-xs text-slate-600">{t(label)}<select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-10 w-full rounded border px-2 text-sm"><option value="">{t("اختر حسابًا طرفيًا")}</option>{accountOptions(prefixes).map((account) => <option key={account.code} value={account.code}>{account.code} — {account.name_ar}</option>)}</select></label>;

  return <Layout><main dir={direction} className="space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-3"><div className="rounded-lg bg-indigo-50 p-2 text-indigo-700"><Landmark className="h-6 w-6" /></div><div><h1 className="text-2xl font-bold text-slate-900">{t("الأصول الثابتة")}</h1><p className="mt-1 text-sm text-slate-500">{t("سجل الأصول ورسملتها وإهلاكها واستبعادها بقيود محاسبية مستقلة.")}</p></div></div><button onClick={startNew} className="inline-flex items-center gap-2 rounded bg-indigo-700 px-4 py-2 text-sm font-semibold text-white"><FilePlus2 className="h-4 w-4" />{t("أصل ثابت جديد")}</button></header>
    {error && <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
    <section className="grid gap-3 md:grid-cols-3"><div className="rounded-xl border bg-white p-4"><p className="text-xs text-slate-500">{t("إجمالي تكلفة الأصول")}</p><p className="mt-2 text-xl font-bold">{money(totals.cost)} SAR</p></div><div className="rounded-xl border bg-white p-4"><p className="text-xs text-slate-500">{t("مجمع الإهلاك")}</p><p className="mt-2 text-xl font-bold text-amber-700">{money(totals.accumulated)} SAR</p></div><div className="rounded-xl border bg-white p-4"><p className="text-xs text-slate-500">{t("صافي القيمة الدفترية")}</p><p className="mt-2 text-xl font-bold text-emerald-700">{money(totals.cost - totals.accumulated)} SAR</p></div></section>

    {editingId !== undefined && <section className="rounded-xl border bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><h2 className="font-bold">{t(editingId ? "تعديل مسودة الأصل" : "أصل ثابت جديد")}</h2><button onClick={resetForm}><X className="h-5 w-5" /></button></div><div className="grid gap-3 md:grid-cols-3"><label className="text-xs text-slate-600">{t("اسم الأصل")}<input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label><label className="text-xs text-slate-600">{t("التصنيف")}<input value={category} onChange={(event) => setCategory(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label><label className="text-xs text-slate-600">{t("تاريخ الشراء")}<input type="date" value={acquisitionDate} onChange={(event) => setAcquisitionDate(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label><label className="text-xs text-slate-600">{t("تاريخ بدء الاستخدام")}<input type="date" value={inServiceDate} onChange={(event) => setInServiceDate(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label><label className="text-xs text-slate-600">{t("تكلفة الأصل دون ضريبة قابلة للاسترداد")}<input type="number" min="0.01" step="0.01" value={cost} onChange={(event) => setCost(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label><label className="text-xs text-slate-600">{t("القيمة التخريدية")}<input type="number" min="0" step="0.01" value={residualValue} onChange={(event) => setResidualValue(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label><label className="text-xs text-slate-600">{t("العمر الإنتاجي بالأشهر")}<input type="number" min="1" value={lifeMonths} onChange={(event) => setLifeMonths(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label><SelectAccount label="حساب تكلفة الأصل" value={assetAccount} onChange={setAssetAccount} prefixes={["1"]} /><SelectAccount label="حساب مجمع الإهلاك" value={accumulatedAccount} onChange={setAccumulatedAccount} prefixes={["1"]} /><SelectAccount label="حساب مصروف الإهلاك" value={expenseAccount} onChange={setExpenseAccount} prefixes={["5"]} /></div><div className="mt-4 flex justify-end"><button onClick={() => void saveAsset()} disabled={busy} className="inline-flex items-center gap-2 rounded bg-indigo-700 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4" />{t("حفظ المسودة")}</button></div></section>}

    <section className="overflow-hidden rounded-xl border bg-white shadow-sm"><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-100 text-slate-600"><tr><th className="p-3">{t("رقم الأصل")}</th><th className="p-3">{t("الأصل")}</th><th className="p-3">{t("التكلفة")}</th><th className="p-3">{t("مجمع الإهلاك")}</th><th className="p-3">{t("القيمة الدفترية")}</th><th className="p-3">{t("الحالة")}</th><th className="p-3">{t("الإجراءات")}</th></tr></thead><tbody>{loading ? <tr><td colSpan={7} className="py-14 text-center">{t("جاري التحميل...")}</td></tr> : assets.length === 0 ? <tr><td colSpan={7} className="py-14 text-center text-slate-400">{t("لا توجد أصول ثابتة")}</td></tr> : assets.map((asset) => <tr key={asset.id} className="border-t"><td className="p-3 font-mono">{asset.number}</td><td className="p-3"><p className="font-semibold">{asset.name}</p><p className="text-xs text-slate-500">{asset.category}</p></td><td className="p-3 text-center">{money(asset.cost)}</td><td className="p-3 text-center">{money(asset.accumulated)}</td><td className="p-3 text-center font-semibold">{money(asset.cost - asset.accumulated)}</td><td className="p-3 text-center"><span className={`rounded px-2 py-1 text-xs font-semibold ${asset.status === "active" ? "bg-emerald-50 text-emerald-700" : asset.status === "draft" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{t(asset.status === "active" ? "نشط" : asset.status === "draft" ? "مسودة" : "مستبعد")}</span></td><td className="p-3"><div className="flex flex-wrap justify-center gap-1"><button onClick={() => setDetail(asset)} className="rounded border p-2"><Eye className="h-4 w-4" /></button>{asset.status === "draft" && <><button onClick={() => startEdit(asset)} className="rounded border p-2"><Edit3 className="h-4 w-4" /></button><button onClick={() => openAction("capitalize", asset)} className="rounded bg-emerald-700 px-3 py-2 text-xs font-semibold text-white">{t("رسملة")}</button><button onClick={() => void deleteDraft(asset)} className="rounded border border-red-200 p-2 text-red-600"><Trash2 className="h-4 w-4" /></button></>}{asset.status === "active" && <><button onClick={() => openAction("depreciate", asset)} className="rounded bg-indigo-700 px-3 py-2 text-xs font-semibold text-white">{t("ترحيل إهلاك")}</button><button onClick={() => openAction("dispose", asset)} className="rounded border px-3 py-2 text-xs font-semibold">{t("استبعاد")}</button></>}</div></td></tr>)}</tbody></table></div></section>

    {action && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={() => setAction(null)}><section className="w-full max-w-xl rounded-xl bg-white p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><div className="mb-4 flex items-center justify-between"><div><h2 className="font-bold">{t(action.mode === "capitalize" ? "رسملة الأصل" : action.mode === "depreciate" ? "ترحيل إهلاك شهري" : "استبعاد الأصل")}</h2><p className="text-xs text-slate-500">{action.asset.number} — {action.asset.name}</p></div><button onClick={() => setAction(null)}><X className="h-5 w-5" /></button></div>{action.mode === "capitalize" && <SelectAccount label="الحساب الدائن: بنك أو مورد" value={actionAccount} onChange={setActionAccount} prefixes={["1", "2"]} />}{action.mode === "depreciate" && <label className="text-xs text-slate-600">{t("نهاية شهر الإهلاك")}<input type="date" value={actionDate} onChange={(event) => setActionDate(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label>}{action.mode === "dispose" && <div className="space-y-3"><label className="text-xs text-slate-600">{t("تاريخ الاستبعاد")}<input type="date" value={actionDate} onChange={(event) => setActionDate(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label><label className="text-xs text-slate-600">{t("متحصلات البيع")}<input type="number" min="0" step="0.01" value={proceeds} onChange={(event) => setProceeds(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label>{amount(proceeds) > 0 && <SelectAccount label="حساب إيداع المتحصلات" value={actionAccount} onChange={setActionAccount} prefixes={["1"]} />}<SelectAccount label="حساب أرباح أو خسائر الاستبعاد" value={gainLossAccount} onChange={setGainLossAccount} prefixes={["4", "5"]} /></div>}<div className="mt-4 rounded bg-amber-50 p-3 text-xs text-amber-800">{t("سيتم إنشاء قيد محاسبي مرحّل مستقل، ولن يمكن تعديل العملية بعد الترحيل.")}</div><div className="mt-4 flex justify-end"><button onClick={() => void runAction()} disabled={busy || (action.mode === "capitalize" && !actionAccount) || (action.mode === "dispose" && (!gainLossAccount || (amount(proceeds) > 0 && !actionAccount)))} className="inline-flex items-center gap-2 rounded bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}{t("تأكيد وترحيل")}</button></div></section></div>}

    {detail && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={() => setDetail(null)}><section className="w-full max-w-2xl rounded-xl bg-white p-5" onMouseDown={(event) => event.stopPropagation()}><div className="flex items-start justify-between"><div><h2 className="font-bold">{detail.name}</h2><p className="text-xs text-slate-500">{detail.number} — {detail.category}</p></div><button onClick={() => setDetail(null)}><X className="h-5 w-5" /></button></div><dl className="mt-5 grid gap-4 text-sm md:grid-cols-3"><div><dt className="text-slate-500">{t("تاريخ الشراء")}</dt><dd className="font-semibold">{formatDate(detail.acquisitionDate)}</dd></div><div><dt className="text-slate-500">{t("بدء الاستخدام")}</dt><dd className="font-semibold">{formatDate(detail.inServiceDate)}</dd></div><div><dt className="text-slate-500">{t("العمر الإنتاجي")}</dt><dd className="font-semibold">{detail.usefulLifeMonths} {t("شهر")}</dd></div><div><dt className="text-slate-500">{t("حساب الأصل")}</dt><dd className="font-semibold">{detail.assetAccountCode}</dd></div><div><dt className="text-slate-500">{t("حساب مجمع الإهلاك")}</dt><dd className="font-semibold">{detail.accumulatedAccountCode}</dd></div><div><dt className="text-slate-500">{t("حساب مصروف الإهلاك")}</dt><dd className="font-semibold">{detail.expenseAccountCode}</dd></div></dl></section></div>}
  </main></Layout>;
}
