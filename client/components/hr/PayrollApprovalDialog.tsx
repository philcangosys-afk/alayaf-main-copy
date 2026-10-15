import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Search, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";
import { supabase } from "@/lib/supabaseClient";
import { monthRange, riyadhToday } from "@/lib/hrDates";
import { OPEN_PAYROLL_STATUSES } from "@/lib/payrollCalc";

export type PayrollApprovalEmployee = {
  id: string;
  empId: string;
  name: string;
  department: string;
  absentDays: number;
  net: number;
};

type Props = {
  open: boolean;
  period: string;
  employees: PayrollApprovalEmployee[];
  initialStopped: Set<string>;
  submitting: boolean;
  /** مدخلات تعذر تحميلها: يُمنع الإرسال */
  blockingErrors?: string[];
  onCancel: () => void;
  onSubmit: (stopped: Set<string>, reason: string) => void;
};

/**
 * بطاقة إعدادات طلب اعتماد الرواتب: يحدد فيها مسؤول الموارد البشرية الموظفين الذين يُوقف راتبهم
 * قبل الإرسال للإدارة. الموقوف يُحفظ صفّه في كشف الشهر بحالة "موقوف" ولا يدخل الاعتماد.
 */
export default function PayrollApprovalDialog({ open, period, employees, initialStopped, submitting, blockingErrors = [], onCancel, onSubmit }: Props) {
  const { t, direction, formatNumber, formatDate } = useI18n();
  const [stopped, setStopped] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [onlyStopped, setOnlyStopped] = useState(false);
  const [reason, setReason] = useState("");
  // حالة صف كل موظف في رواتب الشهر (من قاعدة البيانات): الموقوف سابقًا يبقى محددًا، والمعتمد/المرحّل مقفل
  const [savedStatus, setSavedStatus] = useState<Map<string, { status: string; posted: boolean }>>(new Map());
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const ids = new Set(employees.map((employee) => employee.id));
    setStopped(new Set([...initialStopped].filter((id) => ids.has(id))));
    setSearch("");
    setOnlyStopped(false);
    setReason("");
    setSavedStatus(new Map());
    setStatusError("");
    setStatusLoading(true);
    void (async () => {
      // أي خطأ (حتى انقطاع الشبكة) يُظهر رسالة ويوقف الإرسال؛ لا يبقى الزر معلقًا على "جارٍ التحميل"
      try {
        const codes = [...new Set(employees.map((employee) => employee.empId.trim()).filter(Boolean))];
        const statuses = new Map<string, { status: string; posted: boolean }>();
        for (let index = 0; index < codes.length; index += 100) {
          const { data, error } = await supabase.from("payroll").select("emp_id, status, accounting_status").eq("month", period).in("emp_id", codes.slice(index, index + 100));
          if (cancelled) return;
          if (error) throw error;
          (data ?? []).forEach((row: Record<string, unknown>) => statuses.set(String(row.emp_id ?? "").trim(), { status: String(row.status ?? ""), posted: String(row.accounting_status ?? "") === "posted" }));
        }
        if (cancelled) return;
        setSavedStatus(statuses);
        // من أُوقف راتبه سابقًا في هذا الشهر يبقى موقوفًا ما لم يُلغَ إيقافه صراحة
        setStopped((current) => {
          const next = new Set(current);
          employees.forEach((employee) => { if (statuses.get(employee.empId.trim())?.status === "موقوف") next.add(employee.id); });
          return next;
        });
      } catch (error) {
        if (!cancelled) setStatusError(String((error as { message?: unknown } | null)?.message ?? error ?? ""));
      } finally {
        if (!cancelled) setStatusLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // يُعاد التهيئة عند كل فتح فقط
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const isLocked = (employee: PayrollApprovalEmployee) => {
    const saved = savedStatus.get(employee.empId.trim());
    return Boolean(saved && (saved.posted || !OPEN_PAYROLL_STATUSES.includes(saved.status)));
  };

  const visible = useMemo(() => {
    const keyword = search.trim();
    return employees.filter((employee) => {
      if (onlyStopped && !stopped.has(employee.id)) return false;
      if (!keyword) return true;
      return employee.name.includes(keyword) || employee.empId.includes(keyword) || employee.department.includes(keyword);
    });
  }, [employees, search, onlyStopped, stopped]);

  if (!open) return null;

  const sendable = employees.filter((employee) => !isLocked(employee));
  const lockedCount = employees.length - sendable.length;
  // الشهر لم ينتهِ بعد (اليوم الأخير نفسه يُعد مفتوحًا لأن دوامه لم يُسجَّل كاملًا)
  const monthOpen = Boolean(period) && riyadhToday() <= monthRange(period).to;
  const toggle = (id: string) => setStopped((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const stoppedSendable = sendable.filter((employee) => stopped.has(employee.id)).length;
  const activeCount = sendable.length - stoppedSendable;
  const activeNet = sendable.filter((employee) => !stopped.has(employee.id)).reduce((sum, employee) => sum + employee.net, 0);
  const blocked = blockingErrors.length > 0 || statusLoading || Boolean(statusError);
  const money = (value: number) => formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const monthLabel = period ? formatDate(`${period}-01`, { month: "long", year: "numeric" }) : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir={direction}>
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h3 className="text-xl font-bold text-gray-800">{t("إعدادات طلب اعتماد الرواتب")}</h3>
            <p className="mt-1 text-sm text-gray-500">{t("فترة الرواتب")}: {monthLabel}</p>
          </div>
          <button type="button" onClick={onCancel} disabled={submitting} className="text-gray-500 hover:text-gray-800" aria-label={t("إغلاق")}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-xs text-emerald-700">{t("يُرسل للاعتماد")}</p>
              <p className="text-lg font-bold text-emerald-800">{formatNumber(activeCount)} {t("موظف")}</p>
            </div>
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="text-xs text-red-700">{t("رواتب موقوفة")}</p>
              <p className="text-lg font-bold text-red-800">{formatNumber(stoppedSendable)} {t("موظف")}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs text-slate-600">{t("صافي الرواتب المرسلة")}</p>
              <p className="text-lg font-bold text-slate-800">{money(activeNet)} {t("ر.س")}</p>
            </div>
          </div>

          {blockingErrors.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {t("لا يمكن الإرسال: تعذر تحميل بعض بيانات الحساب، فالأرقام المعروضة قد تكون ناقصة")}: {blockingErrors.map((error) => t(error)).join(" | ")}
            </div>
          )}
          {statusError && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{t("تعذر تحميل حالات رواتب الشهر؛ لا يمكن الإرسال الآن")}: {statusError}</div>}
          {lockedCount > 0 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              {formatNumber(lockedCount)} {t("موظف رواتبهم معتمدة أو مرحّلة لهذا الشهر؛ لن يُعاد إرسالها ولا تُوقف من هنا")}
            </div>
          )}
          {monthOpen && (
            <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t("الشهر لم ينتهِ بعد: الغياب الذي يُسجَّل بعد اليوم لن يدخل هذا الكشف إذا اعتُمد الآن")}</span>
            </div>
          )}

          <div className="rounded-lg border border-gray-200">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 bg-gray-50 px-4 py-3">
              <h4 className="font-semibold text-gray-800">{t("إيقاف رواتب الموظفين")}</h4>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-60">
                  <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("بحث بالاسم أو الرقم")} className="h-9 pr-9" />
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600">
                  <input type="checkbox" checked={onlyStopped} onChange={(event) => setOnlyStopped(event.target.checked)} className="h-4 w-4 accent-red-600" />
                  {t("الموقوفون فقط")}
                </label>
                {stopped.size > 0 && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setStopped(new Set())}>{t("إلغاء كل الإيقاف")}</Button>
                )}
              </div>
            </div>
            <div className="max-h-[42vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white text-gray-600 shadow-sm">
                  <tr>
                    <th className="w-24 px-3 py-2 text-center font-medium">{t("إيقاف الراتب")}</th>
                    <th className="px-3 py-2 text-start font-medium">{t("الموظف")}</th>
                    <th className="px-3 py-2 text-start font-medium">{t("القسم")}</th>
                    <th className="px-3 py-2 text-center font-medium">{t("أيام الغياب")}</th>
                    <th className="px-3 py-2 text-center font-medium">{t("صافي الراتب")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {visible.length === 0 ? (
                    <tr><td colSpan={5} className="py-6 text-center text-gray-400">{t("لا يوجد موظفون مطابقون")}</td></tr>
                  ) : visible.map((employee) => {
                    const locked = isLocked(employee);
                    const isStopped = !locked && stopped.has(employee.id);
                    const saved = savedStatus.get(employee.empId.trim());
                    return (
                      <tr key={employee.id} className={locked ? "bg-gray-50 text-gray-400" : isStopped ? "bg-red-50/60" : "hover:bg-gray-50"}>
                        <td className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={isStopped}
                            disabled={locked || statusLoading}
                            onChange={() => toggle(employee.id)}
                            className="h-4 w-4 accent-red-600 disabled:opacity-40"
                            aria-label={`${t("إيقاف راتب")} ${employee.name}`}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <span className="font-medium text-gray-900">{employee.name}</span><span className="ms-2 text-xs text-gray-400">{employee.empId}</span>
                          {saved && <span className={`ms-2 rounded px-1.5 py-0.5 text-[10px] ${locked ? "bg-slate-200 text-slate-700" : saved.status === "موقوف" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700"}`}>{saved.posted ? t("مرحّل") : t(saved.status || "معلق")}</span>}
                        </td>
                        <td className="px-3 py-2 text-gray-600">{employee.department || "—"}</td>
                        <td className={`px-3 py-2 text-center ${employee.absentDays > 0 ? "font-semibold text-red-600" : "text-gray-500"}`}>{formatNumber(employee.absentDays)}</td>
                        <td className={`px-3 py-2 text-center ${isStopped ? "text-gray-400 line-through" : "font-medium text-emerald-700"}`}>{money(employee.net)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {stopped.size > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">{t("سبب الإيقاف (يظهر للإدارة في الطلب)")}</label>
              <Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t("اختياري")} maxLength={300} />
              <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {t("الراتب الموقوف يُحفظ في كشف الشهر بحالة «موقوف» ويُعرض على الإدارة ضمن الطلب. بعد موافقة الإدارة يُرحَّل استحقاقه في قيد الشهر (مصروفًا والتزامًا للموظف) ويُحبس صرفه حتى يُرفع الإيقاف من صفحة الترحيل. لإلغاء الإيقاف قبل الاعتماد: أعد إرسال الطلب دون تحديد الموظف.")}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap justify-start gap-3 border-t border-gray-100 px-5 py-4">
          <Button
            type="button"
            onClick={() => onSubmit(new Set(sendable.filter((employee) => stopped.has(employee.id)).map((employee) => employee.id)), reason.trim())}
            disabled={submitting || blocked || sendable.length === 0}
            className="bg-[#004e89] text-white hover:bg-[#003d6d]"
          >
            <Send className="h-4 w-4" />
            {submitting ? t("جاري الإرسال...") : t("إرسال طلب الاعتماد")}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>{t("إلغاء")}</Button>
          {statusLoading && <span className="self-center text-sm text-gray-500">{t("جاري تحميل حالات رواتب الشهر...")}</span>}
          {!statusLoading && sendable.length === 0 && <span className="self-center text-sm text-red-600">{t("لا يوجد راتب يُرسل للاعتماد (كلها معتمدة أو مرحّلة مسبقًا)")}</span>}
          {!statusLoading && sendable.length > 0 && activeCount === 0 && <span className="self-center text-sm text-amber-700">{t("كل المحددين موقوفون: يُرسل الطلب لاعتماد إيقافهم فقط")}</span>}
        </div>
      </div>
    </div>
  );
}
