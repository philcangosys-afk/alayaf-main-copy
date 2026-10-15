import { useEffect, useState } from "react";
import { CalendarRange, Edit3, Loader2, Lock, Plus, Save, Settings2, Trash2, Unlock, X } from "lucide-react";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import { canManagePerm } from "@/lib/authSession";

type Account = { code: string; name_ar: string; parent_code: string | null };
type Defaults = {
  receivableAccountCode: string; revenueAccountCode: string; outputVatAccountCode: string;
  payableAccountCode: string; purchaseAccountCode: string; inputVatAccountCode: string;
  inventoryShortageAccountCode: string; inventorySurplusAccountCode: string;
  payrollExpenseAccountCode: string; payrollPayableAccountCode: string;
  payrollSocialInsuranceAccountCode: string; payrollDeductionsAccountCode: string;
};
type FiscalPeriod = { id: string; name: string; dateFrom: string; dateTo: string; status: "open" | "closed"; closedAt: string };

const initialDefaults: Defaults = {
  receivableAccountCode: "", revenueAccountCode: "", outputVatAccountCode: "",
  payableAccountCode: "", purchaseAccountCode: "", inputVatAccountCode: "",
  inventoryShortageAccountCode: "", inventorySurplusAccountCode: "",
  payrollExpenseAccountCode: "", payrollPayableAccountCode: "",
  payrollSocialInsuranceAccountCode: "", payrollDeductionsAccountCode: "",
};

export default function AccountingSettings() {
  const { t, direction, formatDate } = useI18n();
  const { permissions } = useRolePermissions();
  const canManage = canManagePerm(permissions, "accounting.settings");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [defaults, setDefaults] = useState<Defaults>(initialDefaults);
  const [periods, setPeriods] = useState<FiscalPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null | undefined>(undefined);
  const [periodName, setPeriodName] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const load = async () => {
    setLoading(true); setError("");
    const [accountResult, ruleResult, periodResult] = await Promise.all([
      supabase.from("accounting_accounts").select("code, name_ar, parent_code").order("code"),
      supabase.from("accounting_posting_rules").select("receivable_account_code, revenue_account_code, output_vat_account_code, payable_account_code, purchase_account_code, input_vat_account_code, inventory_shortage_account_code, inventory_surplus_account_code, payroll_expense_account_code, payroll_payable_account_code, payroll_social_insurance_account_code, payroll_deductions_account_code").eq("rule_code", "sales_default").eq("active", true).maybeSingle(),
      supabase.from("accounting_fiscal_periods").select("id, name, date_from, date_to, status, closed_at").order("date_from", { ascending: false }),
    ]);
    const firstError = accountResult.error ?? ruleResult.error ?? periodResult.error;
    if (firstError) { setError(firstError.message); setLoading(false); return; }
    const allAccounts = (accountResult.data ?? []) as Account[];
    setAccounts(allAccounts.filter((account) => !allAccounts.some((child) => child.parent_code === account.code)));
    if (ruleResult.data) setDefaults({
      receivableAccountCode: String(ruleResult.data.receivable_account_code), revenueAccountCode: String(ruleResult.data.revenue_account_code),
      outputVatAccountCode: String(ruleResult.data.output_vat_account_code), payableAccountCode: String(ruleResult.data.payable_account_code),
      purchaseAccountCode: String(ruleResult.data.purchase_account_code), inputVatAccountCode: String(ruleResult.data.input_vat_account_code),
      inventoryShortageAccountCode: String(ruleResult.data.inventory_shortage_account_code ?? ""), inventorySurplusAccountCode: String(ruleResult.data.inventory_surplus_account_code ?? ""),
      payrollExpenseAccountCode: String(ruleResult.data.payroll_expense_account_code ?? ""), payrollPayableAccountCode: String(ruleResult.data.payroll_payable_account_code ?? ""),
      payrollSocialInsuranceAccountCode: String(ruleResult.data.payroll_social_insurance_account_code ?? ""), payrollDeductionsAccountCode: String(ruleResult.data.payroll_deductions_account_code ?? ""),
    });
    setPeriods((periodResult.data ?? []).map((period) => ({
      id: String(period.id), name: String(period.name), dateFrom: String(period.date_from), dateTo: String(period.date_to),
      status: period.status as FiscalPeriod["status"], closedAt: String(period.closed_at ?? ""),
    })));
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const accountOptions = (prefix: string) => accounts.filter((account) => account.code.startsWith(prefix));
  const setDefault = (key: keyof Defaults, value: string) => setDefaults((current) => ({ ...current, [key]: value }));

  const saveDefaults = async () => {
    if (Object.values(defaults).some((value) => !value)) { setError(t("اختر جميع حسابات الترحيل الافتراضية")); return; }
    setBusy(true); setError("");
    const { error: saveError } = await supabase.rpc("save_accounting_posting_defaults", { p_defaults: defaults });
    setBusy(false);
    if (saveError) { setError(saveError.message); return; }
    toast({ title: t("تم حفظ حسابات الترحيل الافتراضية") });
    await load();
  };

  const startNew = () => { setEditingId(null); setPeriodName(""); setDateFrom(""); setDateTo(""); setError(""); };
  const startEdit = (period: FiscalPeriod) => {
    if (period.status === "closed") return;
    setEditingId(period.id); setPeriodName(period.name); setDateFrom(period.dateFrom); setDateTo(period.dateTo); setError("");
  };
  const closeForm = () => setEditingId(undefined);

  const savePeriod = async () => {
    if (!periodName.trim() || !dateFrom || !dateTo || dateFrom > dateTo) { setError(t("أدخل اسم الفترة ونطاق تاريخ صحيح")); return; }
    setBusy(true); setError("");
    const { error: saveError } = await supabase.rpc("save_accounting_fiscal_period", {
      p_id: editingId || null, p_name: periodName.trim(), p_date_from: dateFrom, p_date_to: dateTo,
    });
    setBusy(false);
    if (saveError) { setError(saveError.message); return; }
    toast({ title: t("تم حفظ الفترة المالية") }); closeForm(); await load();
  };

  const changeStatus = async (period: FiscalPeriod) => {
    const nextStatus = period.status === "open" ? "closed" : "open";
    const message = nextStatus === "closed"
      ? t("سيتم منع ترحيل القيود وحركات المخزون داخل هذه الفترة، مع بقاء المسودات قابلة للحفظ. هل تريد إغلاقها؟")
      : t("سيتم السماح بالترحيل داخل هذه الفترة مجددًا. هل تريد فتحها؟");
    if (!confirm(message)) return;
    setBusy(true);
    const { error: statusError } = await supabase.rpc("set_accounting_fiscal_period_status", { p_id: period.id, p_status: nextStatus });
    setBusy(false);
    if (statusError) { toast({ title: t("تعذر تغيير حالة الفترة"), description: statusError.message, variant: "destructive" }); return; }
    toast({ title: t(nextStatus === "closed" ? "تم إغلاق الفترة المالية" : "تم فتح الفترة المالية") }); await load();
  };

  const removePeriod = async (period: FiscalPeriod) => {
    if (period.status !== "open" || !confirm(t("يمكن حذف الفترة فقط إذا لم تحتوِ على قيود. هل تريد المتابعة؟"))) return;
    setBusy(true);
    const { error: deleteError } = await supabase.rpc("delete_accounting_fiscal_period", { p_id: period.id });
    setBusy(false);
    if (deleteError) { toast({ title: t("تعذر حذف الفترة"), description: deleteError.message, variant: "destructive" }); return; }
    toast({ title: t("تم حذف الفترة المالية") }); await load();
  };

  const AccountSelect = ({ label, field, prefix }: { label: string; field: keyof Defaults; prefix: string }) => (
    <label className="text-xs text-slate-600">{t(label)}<select value={defaults[field]} onChange={(event) => setDefault(field, event.target.value)} disabled={!canManage} className="mt-1 h-10 w-full rounded border px-2 text-sm disabled:bg-slate-100"><option value="">{t("اختر حسابًا طرفيًا")}</option>{accountOptions(prefix).map((account) => <option key={account.code} value={account.code}>{account.code} — {account.name_ar}</option>)}</select></label>
  );

  return (
    <Layout>
      <main dir={direction} className="space-y-5">
        <header className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-3"><div className="rounded-lg bg-indigo-50 p-2 text-indigo-700"><Settings2 className="h-6 w-6" /></div><div><h1 className="text-2xl font-bold text-slate-900">{t("إعدادات المحاسبة")}</h1><p className="mt-1 text-sm text-slate-500">{t("إدارة حسابات الترحيل والفترات المالية من مكان محمي واحد.")}</p></div></div></header>
        {error && <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold">{t("حسابات الترحيل الافتراضية")}</h2><p className="text-xs text-slate-500">{t("تستخدمها قيود المبيعات والمشتريات والضريبة وتسويات المخزون. الحسابات التجميعية غير متاحة.")}</p></div><div className="rounded bg-slate-100 px-3 py-2 text-xs font-semibold">{t("العملة الأساسية")}: SAR — {t("ريال سعودي")}</div></div>
          {loading ? <div className="py-10 text-center">{t("جاري التحميل...")}</div> : <><div className="grid gap-4 md:grid-cols-3"><AccountSelect label="ذمم العملاء" field="receivableAccountCode" prefix="1" /><AccountSelect label="إيرادات المبيعات" field="revenueAccountCode" prefix="4" /><AccountSelect label="ضريبة المخرجات" field="outputVatAccountCode" prefix="2" /><AccountSelect label="ذمم الموردين" field="payableAccountCode" prefix="2" /><AccountSelect label="المشتريات والمصروفات" field="purchaseAccountCode" prefix="5" /><AccountSelect label="ضريبة المدخلات" field="inputVatAccountCode" prefix="2" /><AccountSelect label="مصروف عجز المخزون" field="inventoryShortageAccountCode" prefix="5" /><AccountSelect label="إيراد فائض المخزون" field="inventorySurplusAccountCode" prefix="4" /><AccountSelect label="مصروف الرواتب والأجور" field="payrollExpenseAccountCode" prefix="5" /><AccountSelect label="رواتب مستحقة غير مدفوعة" field="payrollPayableAccountCode" prefix="2" /><AccountSelect label="التأمينات الاجتماعية المستحقة" field="payrollSocialInsuranceAccountCode" prefix="2" /><AccountSelect label="استقطاعات الموظفين المستحقة" field="payrollDeductionsAccountCode" prefix="2" /></div><div className="mt-4 flex justify-end"><button onClick={() => void saveDefaults()} disabled={busy || !canManage} className="inline-flex items-center gap-2 rounded bg-indigo-700 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{t("حفظ إعدادات الترحيل")}</button></div></>}
        </section>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4"><div><h2 className="font-bold">{t("الفترات المالية")}</h2><p className="text-xs text-slate-500">{t("الترحيل المحاسبي وحركات المخزون متاحان فقط داخل فترة مفتوحة. إغلاق الفترة لا يمنع حفظ مسودات القيود.")}</p></div>{canManage && <button onClick={startNew} className="inline-flex items-center gap-2 rounded bg-indigo-700 px-4 py-2 text-sm font-semibold text-white"><Plus className="h-4 w-4" />{t("فترة مالية جديدة")}</button>}</div>
          {canManage && editingId !== undefined && <div className="border-b bg-slate-50 p-4"><div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">{t(editingId ? "تعديل الفترة المالية" : "فترة مالية جديدة")}</h3><button onClick={closeForm}><X className="h-5 w-5" /></button></div><div className="grid gap-3 md:grid-cols-[1fr_200px_200px_auto]"><label className="text-xs text-slate-600">{t("اسم الفترة")}<input value={periodName} onChange={(event) => setPeriodName(event.target.value)} className="mt-1 h-10 w-full rounded border px-3 text-sm" /></label><label className="text-xs text-slate-600">{t("من تاريخ")}<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="mt-1 h-10 w-full rounded border px-3 text-sm" /></label><label className="text-xs text-slate-600">{t("إلى تاريخ")}<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="mt-1 h-10 w-full rounded border px-3 text-sm" /></label><button onClick={() => void savePeriod()} disabled={busy} className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded bg-emerald-700 px-4 text-sm font-semibold text-white"><Save className="h-4 w-4" />{t("حفظ الفترة")}</button></div></div>}
          <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-100 text-slate-600"><tr><th className="p-3">{t("الفترة")}</th><th className="p-3">{t("من تاريخ")}</th><th className="p-3">{t("إلى تاريخ")}</th><th className="p-3">{t("الحالة")}</th><th className="p-3">{t("الإجراءات")}</th></tr></thead><tbody>{loading ? <tr><td colSpan={5} className="py-12 text-center">{t("جاري التحميل...")}</td></tr> : periods.length === 0 ? <tr><td colSpan={5} className="py-12 text-center text-slate-400">{t("لا توجد فترات مالية معرفة")}</td></tr> : periods.map((period) => <tr key={period.id} className="border-t"><td className="p-3 font-semibold">{period.name}</td><td className="p-3 text-center">{formatDate(period.dateFrom)}</td><td className="p-3 text-center">{formatDate(period.dateTo)}</td><td className="p-3 text-center"><span className={`rounded px-2 py-1 text-xs font-semibold ${period.status === "open" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{t(period.status === "open" ? "مفتوحة" : "مغلقة")}</span></td><td className="p-3"><div className="flex justify-center gap-2">{canManage && period.status === "open" && <button onClick={() => startEdit(period)} className="rounded border p-2" title={t("تعديل")}><Edit3 className="h-4 w-4" /></button>}<button onClick={() => void changeStatus(period)} disabled={busy || !canManage} className="rounded border p-2" title={t(period.status === "open" ? "إغلاق الفترة" : "فتح الفترة")}>{period.status === "open" ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}</button>{canManage && period.status === "open" && <button onClick={() => void removePeriod(period)} disabled={busy} className="rounded border border-red-200 p-2 text-red-600" title={t("حذف")}><Trash2 className="h-4 w-4" /></button>}</div></td></tr>)}</tbody></table></div>
        </section>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"><div className="flex gap-2"><CalendarRange className="mt-0.5 h-4 w-4 shrink-0" /><p>{t("يجب أن يقع تاريخ أي ترحيل محاسبي أو حركة مخزون داخل فترة مالية مفتوحة. يمكن حفظ مسودة القيد خارج الفترة المفتوحة، لكن لا يمكن ترحيلها حتى فتح الفترة المناسبة.")}</p></div></div>
      </main>
    </Layout>
  );
}
