import { useEffect, useMemo, useState } from "react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Receipt, CheckCircle2, Loader2, Unlock } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n";
import { canManagePerm, readUserSession } from "@/lib/authSession";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import { payrollApprovalErrorText } from "@/lib/hrErrors";
import { riyadhMonth } from "@/lib/hrDates";
import { isSaudiCompany } from "@/lib/companyProfile";

type PayrollRow = {
  id: string;
  empId: string;
  empName: string;
  department: string;
  basic: number;
  allowances: number;
  deductions: number;
  absence: number;
  /** حصة المنشأة في التأمينات (S11): تُقيَّد مصروفًا مع الرواتب ولا تُخصم من الموظف */
  employer: number;
  net: number;
  status: string;
  accountingStatus: string;
  journalEntryId: string;
  /** رقم القيد (1001-JE-…) بعد الترحيل */
  entryNumber: string;
};

const HELD = "موقوف";
const APPROVED = "معتمد";
const POSTED = "مرحّل";

/** رسالة الخطأ مع ما بعد النقطتين (أرقام الموظفين المعنيين) */
const postingErrorText = (t: (text: string) => string, error: unknown) => {
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  const codes = message.includes(": ") ? message.slice(message.indexOf(": ") + 2).trim() : "";
  return `${t(payrollApprovalErrorText(error))}${codes ? ` (${codes})` : ""}`;
};

export default function HRPayrollTransfer() {
  const { t, direction, formatDate, formatNumber } = useI18n();
  const [period, setPeriod] = useState(riyadhMonth());
  const [rows, setRows] = useState<PayrollRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [releasingId, setReleasingId] = useState<string | null>(null);
  const { permissions } = useRolePermissions();
  // رفع إيقاف الصرف قرار إداري: لمن يدير الرواتب والمحاسبة معًا (كما في الخادم)، لا لصاحب «ترحيل الرواتب» وحده
  const canReleaseHold = canManagePerm(permissions, "hr.payroll", "module.hr")
    && (canManagePerm(permissions, "accounting.tax_reports") || canManagePerm(permissions, "accounting.accounts") || canManagePerm(permissions, "module.accounting"));

  const load = async (p: string): Promise<PayrollRow[] | null> => {
    setLoading(true);
    // S13: صفوف الشهر من دالة الخادم (لصاحب «ترحيل الرواتب» في المحاسبة أو لمن يقرأ الرواتب)، بلا قراءة جدول الرواتب
    let { data, error } = await supabase.rpc("list_payroll_for_posting", { p_period: p });
    // قاعدة لم يُطبَّق عليها S13 بعد: القراءة المباشرة السابقة (لمن يقرأ الرواتب)
    if (error && (error as { code?: string }).code === "PGRST202") {
      ({ data, error } = await supabase
        .from("payroll")
        .select("id, emp_id, emp_name, department, basic_salary, allowances, deductions, expense_reduction, social_insurance_employer, net_salary, status, accounting_status, accounting_journal_entry_id")
        .eq("month", p)
        .order("emp_name"));
    }
    setLoading(false);
    if (error) {
      toast({ title: t("تعذر تحميل كشف الرواتب"), description: t(payrollApprovalErrorText(error)), variant: "destructive" });
      return null;
    }
    const mapped: PayrollRow[] = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        id: String(r.id),
        empId: String(r.emp_id ?? ""),
        empName: String(r.emp_name ?? "-"),
        department: String(r.department ?? "-"),
        basic: Number(r.basic_salary ?? 0),
        allowances: Number(r.allowances ?? 0),
        deductions: Number(r.deductions ?? 0),
        absence: Number(r.expense_reduction ?? 0),
        employer: Number(r.social_insurance_employer ?? 0),
        net: Number(r.net_salary ?? 0),
        status: String(r.status ?? "معلق"),
        accountingStatus: String(r.accounting_status ?? "unposted"),
        journalEntryId: String(r.accounting_journal_entry_id ?? ""),
        entryNumber: String(r.accounting_entry_number ?? ""),
      }));
    setRows(mapped);
    return mapped;
  };

  useEffect(() => {
    void load(period);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          basic: acc.basic + r.basic,
          allowances: acc.allowances + r.allowances,
          absence: acc.absence + r.absence,
          employer: acc.employer + r.employer,
          deductions: acc.deductions + r.deductions,
          net: acc.net + r.net,
          held: acc.held + (r.status === HELD ? r.net : 0),
        }),
        { basic: 0, allowances: 0, absence: 0, employer: 0, deductions: 0, net: 0, held: 0 }
      ),
    [rows]
  );

  const isPosted = (r: PayrollRow) => r.accountingStatus === "posted";
  const unposted = rows.filter((r) => !isPosted(r));
  // المعتمد يُرحَّل ويُصرف، والموقوف (بموافقة الإدارة) يُرحَّل استحقاقه ويُحبس صرفه
  const transferable = unposted.filter((r) => r.status === APPROVED || r.status === HELD);
  const awaitingApproval = unposted.filter((r) => r.status !== APPROVED && r.status !== HELD).length;
  const heldUnposted = unposted.filter((r) => r.status === HELD).length;
  const alreadyTransferred = rows.filter((r) => isPosted(r) && r.journalEntryId).length;
  // شهر رُحّل ثم أُضيفت إليه رواتب: لا تُرحَّل بقيد الشهر نفسه
  const addedAfterPosting = alreadyTransferred > 0 && unposted.length > 0;
  const formattedPeriod = period ? formatDate(`${period}-01`, { month: "long", year: "numeric" }) : "-";
  const money = (value: number) => formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const handleTransfer = async () => {
    if (transferable.length === 0) {
      toast({ title: t("لا يوجد ما يمكن ترحيله"), description: t("يجب اعتماد جميع رواتب الفترة قبل الترحيل المحاسبي"), variant: "destructive" });
      return;
    }
    if (addedAfterPosting) {
      toast({ title: t("الشهر مرحّل مسبقًا"), description: t("أُضيفت رواتب بعد ترحيل الشهر؛ لا تُرحَّل بقيده (احذفها وأضفها في الشهر التالي أو بقيد تسوية)"), variant: "destructive" });
      return;
    }
    if (awaitingApproval > 0) {
      toast({ title: t("لا يُرحَّل الشهر بعد"), description: `${formatNumber(awaitingApproval)} ${t("راتب بانتظار الاعتماد؛ يُرحَّل الشهر كاملًا بعد اعتماد كل رواتبه")}`, variant: "destructive" });
      return;
    }
    const heldNote = heldUnposted > 0 ? ` — ${formatNumber(heldUnposted)} ${t("موقوف يُرحَّل استحقاقه ويُحبس صرفه")}` : "";
    if (!window.confirm(`${t("تأكيد الترحيل")}: ${t("هل تريد ترحيل سجلات الرواتب المحددة إلى النظام المحاسبي؟")} (${formatNumber(transferable.length)})${heldNote}`)) return;
    setTransferring(true);
    const { data: journalEntryId, error } = await supabase.rpc("post_payroll_period_accounting", {
      p_period: period,
    });
    setTransferring(false);
    if (error) {
      toast({ title: t("تعذر الترحيل"), description: postingErrorText(t, error), variant: "destructive" });
      return;
    }
    // رقم القيد (1001-JE-…) من صفوف الشهر بعد الترحيل بدل معرّفه الداخلي؛ إن لم يُعرف يُعرض المعرّف
    const reloaded = await load(period);
    const entryLabel = reloaded?.find((r) => r.journalEntryId === String(journalEntryId) && r.entryNumber)?.entryNumber || String(journalEntryId);
    toast({ title: t("تم الترحيل"), description: `${t("تم إنشاء قيد الرواتب وربطه بالسجلات")}: ${formatNumber(transferable.length)} — ${t("رقم القيد")}: ${entryLabel}` });
  };

  // رفع إيقاف الصرف لراتب مرحّل: لا يتغير القيد ولا المبالغ؛ يصبح الراتب جاهزًا للصرف من الرواتب المستحقة
  const releaseHold = async (row: PayrollRow) => {
    if (!window.confirm(`${t("رفع إيقاف صرف راتب")} ${row.empName} (${money(row.net)} ${t("ر.س")})؟ ${t("يصبح جاهزًا للصرف من حساب الرواتب المستحقة.")}`)) return;
    setReleasingId(row.id);
    const session = readUserSession();
    // الرفع عبر دالة الخادم وحدها (تتطلب صلاحيتي الرواتب والمحاسبة، وتسجّل التاريخ في الملاحظات)
    const { error } = await supabase.rpc("release_payroll_hold", { p_payroll_id: row.id, p_note: session?.name ?? "" });
    setReleasingId(null);
    if (error) {
      toast({ title: t("تعذر رفع الإيقاف"), description: postingErrorText(t, error), variant: "destructive" });
      return;
    }
    toast({ title: t("رُفع إيقاف الصرف"), description: row.empName });
    void load(period);
  };

  const statusLabel = (r: PayrollRow) => (r.status === HELD && isPosted(r) ? t("موقوف الصرف (مرحّل)") : t(r.status));
  const statusClass = (r: PayrollRow) =>
    r.status === POSTED ? "bg-emerald-100 text-emerald-700"
      : r.status === HELD ? (isPosted(r) ? "bg-orange-100 text-orange-700" : "bg-red-100 text-red-700")
        : r.status === APPROVED ? "bg-sky-100 text-sky-700"
          : "bg-yellow-100 text-yellow-700";

  return (
    <Layout>
      <div className="p-6 max-w-[1200px] mx-auto space-y-6" dir={direction}>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-4 flex-wrap">
            <h2 className="text-lg font-bold text-gray-800">{t("ترحيل حساب الراتب إلى النظام المحاسبي")}</h2>
            <div className="flex items-center gap-2">
              <label htmlFor="payroll-period" className="text-sm text-gray-600">{t("الفترة")}</label>
              <input id="payroll-period" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label={t("الفترة")} className="h-10 border border-gray-300 rounded-md px-3 text-sm" />
              <span className="sr-only">{formattedPeriod}</span>
            </div>
          </div>

          <div className="p-6 space-y-6">
            <div className="flex items-start gap-3 bg-[#004e89]/5 rounded-xl p-4">
              <div className="w-12 h-12 bg-[#004e89]/10 rounded-full flex items-center justify-center text-[#004e89] shrink-0">
                <Receipt className="w-6 h-6" aria-hidden="true" />
              </div>
              <div className="space-y-1 text-sm text-gray-600 leading-relaxed">
                <p>{t("ترحيل استحقاقات واستقطاعات رواتب الفترة المحددة إلى النظام المحاسبي بقيد واحد، بعد اعتماد كل رواتب الشهر. بعد الترحيل تتحول حالة السجل إلى «مرحّل» ولا يُرحّل مرة أخرى.")}</p>
                <p>{isSaudiCompany()
                  ? t("مصروف الرواتب = الاستحقاقات بعد خصم الغياب والإجازات غير المدفوعة والبدلات المخصومة. حصة المنشأة في التأمينات تُقيَّد في القيد نفسه مصروفًا على حسابها (أو على مصروف الرواتب إن لم يُضبط حسابها) والتزامًا على حساب التأمينات. الراتب الموقوف (بموافقة الإدارة) يُستحق في القيد ويُحبس صرفه حتى رفع الإيقاف من هذه الصفحة. لا يُرحَّل راتب تغيّر بعد موافقة الإدارة.")
                  : t("مصروف الرواتب = الاستحقاقات بعد خصم الغياب والإجازات غير المدفوعة والبدلات المخصومة. الراتب الموقوف (بموافقة الإدارة) يُستحق في القيد ويُحبس صرفه حتى رفع الإيقاف من هذه الصفحة. لا يُرحَّل راتب تغيّر بعد موافقة الإدارة.")}</p>
              </div>
            </div>

            <div className={`grid grid-cols-2 gap-4 ${isSaudiCompany() ? "md:grid-cols-6" : "md:grid-cols-5"}`}>
              <SummaryCard label="إجمالي الأساسي والبدلات" value={totals.basic + totals.allowances} />
              <SummaryCard label="خصم الغياب والإجازات والبدلات المخصومة" value={totals.absence} tone="red" />
              <SummaryCard label="مصروف الرواتب" value={totals.basic + totals.allowances - totals.absence} />
              {isSaudiCompany() ? <SummaryCard label="حصة المنشأة في التأمينات" value={totals.employer} /> : null}
              <SummaryCard label="صافي للصرف" value={totals.net - totals.held} tone="green" />
              <SummaryCard label="موقوف الصرف" value={totals.held} tone="orange" />
            </div>

            <div className="overflow-x-auto border border-gray-100 rounded-xl">
              <table className="w-full text-sm text-start" dir={direction}>
                <caption className="sr-only">{t("كشف الرواتب")}</caption>
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="py-3 px-4">{t("الموظف")}</th>
                    <th className="py-3 px-4">{t("القسم")}</th>
                    <th className="py-3 px-4">{t("الأساسي")}</th>
                    <th className="py-3 px-4">{t("البدلات")}</th>
                    <th className="py-3 px-4">{t("يخفّض المصروف")}</th>
                    <th className="py-3 px-4">{t("الاستقطاعات")}</th>
                    <th className="py-3 px-4">{t("الصافي")}</th>
                    <th className="py-3 px-4">{t("الحالة")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loading ? (
                    <tr><td colSpan={8} className="py-8 text-center text-gray-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" aria-label={t("جاري التحميل...")} /></td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={8} className="py-8 text-center text-gray-400">{t("لا يوجد كشف رواتب لهذه الفترة")}</td></tr>
                  ) : rows.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="py-2.5 px-4 font-medium">{r.empName}</td>
                      <td className="py-2.5 px-4">{r.department}</td>
                      <td className="py-2.5 px-4">{money(r.basic)}</td>
                      <td className="py-2.5 px-4">{money(r.allowances)}</td>
                      <td className="py-2.5 px-4 text-red-600">{money(r.absence)}</td>
                      <td className="py-2.5 px-4 text-red-600">{money(r.deductions)}</td>
                      <td className="py-2.5 px-4 font-semibold text-emerald-700">{money(r.net)}</td>
                      <td className="py-2.5 px-4">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusClass(r)}`}>{statusLabel(r)}</span>
                          {r.status === HELD && isPosted(r) && canReleaseHold && (
                            <button
                              type="button"
                              onClick={() => void releaseHold(r)}
                              disabled={releasingId === r.id}
                              className="inline-flex items-center gap-1 rounded-md border border-orange-200 px-2 py-0.5 text-xs text-orange-700 hover:bg-orange-50 disabled:opacity-50"
                            >
                              <Unlock className="h-3 w-3" aria-hidden="true" />
                              {releasingId === r.id ? t("جارٍ...") : t("رفع الإيقاف")}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between pt-2 gap-4 flex-wrap">
              <div className="text-sm text-gray-500 flex items-center gap-2 flex-wrap">
                <CheckCircle2 className="w-4 h-4 text-green-500" aria-hidden="true" />
                {formatNumber(alreadyTransferred)} {t("سجل مُرحّل مسبقاً")} • {formatNumber(transferable.length)} {t("جاهز للترحيل")}
                {heldUnposted > 0 && <> ({formatNumber(heldUnposted)} {t("موقوف الصرف")})</>} • {formatNumber(awaitingApproval)} {t("بانتظار الاعتماد")}
              </div>
              {addedAfterPosting && <span className="text-sm text-red-600">{t("أُضيفت رواتب بعد ترحيل الشهر؛ لا تُرحَّل بقيده")}</span>}
              <Button onClick={handleTransfer} disabled={transferring || transferable.length === 0 || awaitingApproval > 0 || addedAfterPosting} aria-label={t("البدء في الترحيل")} className="bg-[#004e89] hover:bg-[#003865] text-white h-11 px-8 rounded-lg">
                {transferring ? t("جاري الترحيل...") : t("البدء في الترحيل")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone?: "red" | "green" | "orange" }) {
  const { t, formatNumber } = useI18n();
  const color = tone === "red" ? "text-red-600" : tone === "green" ? "text-emerald-700" : tone === "orange" ? "text-orange-600" : "text-gray-900";
  return (
    <div className="bg-gray-50 border border-gray-100 rounded-xl p-4">
      <div className="text-xs text-gray-500">{t(label)}</div>
      <div className={`mt-1 text-lg font-bold ${color}`}>{formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {t("ر.س")}</div>
    </div>
  );
}
