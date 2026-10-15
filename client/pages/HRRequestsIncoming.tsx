import { useEffect, useRef, useState } from "react";
import Layout from "@/components/Layout";
import { Search, CheckCircle, XCircle, Eye, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n";
import { readUserSession } from "@/lib/authSession";
import { hrRequestErrorText } from "@/lib/hrErrors";
import { isPendingStatus, normalizeRequestStatus } from "@/lib/hrStatus";
import { daysInclusive } from "@/lib/hrDates";
import { requestFormSchemas } from "@/components/hr/formSchemas";

type RequestRow = {
  id: string; requestDate: string; empId: string; empName: string;
  moveType: string; requestType: string; status: string; lastUpdate: string;
  adminNote: string; signatureData: string; signedAt: string; source: "leave" | "request";
  details: Record<string, unknown>; senderDepartment: string; senderName: string;
  startDate: string; endDate: string; days: number | null; notes: string;
};

type PayrollDetailRow = {
  id: string;
  empId: string;
  empName: string;
  department: string;
  basicSalary: number;
  allowances: number;
  deductions: number;
  netSalary: number;
  status: string;
  notes: string;
};

// الحالات غير المعروفة تبقى كما هي (لا تُعامل كمعلقة فتظهر أزرار القرار عليها)
const normalizeStatus = (raw: string) =>
  isPendingStatus(raw) || normalizeRequestStatus(raw) !== "معلق" ? normalizeRequestStatus(raw) : raw;

// مفاتيح داخلية في details لا تُعرض كمحتوى للطلب (بيانات الرواتب تُعرض في قسمها الخاص)
const INTERNAL_DETAIL_KEYS = new Set([
  "workflow", "review_decision", "payroll_period", "employee_ids", "active_employee_ids", "stopped_employee_ids", "active_amounts", "stopped_amounts",
  "employee_count", "active_employee_count", "stopped_employee_count", "stop_reason",
]);
const isInternalDetailKey = (key: string) =>
  key.startsWith("reviewed_") || key.startsWith("sender_") || INTERNAL_DETAIL_KEYS.has(key);

const detailValueText = (value: unknown): string => {
  if (value === null || value === undefined || String(value).trim() === "") return "—";
  if (typeof value === "boolean") return value ? "نعم" : "لا";
  if (Array.isArray(value)) return value.map((item) => detailValueText(item)).join("، ") || "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

/** محتوى طلب hr_requests كتسمية/قيمة باستخدام تسميات النموذج إن وُجد */
const requestDetailEntries = (requestType: string, details: Record<string, unknown>) => {
  const schema = Object.values(requestFormSchemas).find((item) => item.title === requestType);
  return Object.entries(details)
    .filter(([key]) => !isInternalDetailKey(key))
    .map(([key, value]) => {
      const field = schema?.fields.find((item) => item.name === key);
      const optionLabel = field?.options?.find((option) => option.value === String(value))?.label;
      return { key, label: field?.label ?? key, value: optionLabel ?? detailValueText(value), isOption: Boolean(optionLabel) };
    });
};

export default function HRRequestsIncoming() {
  const { t, direction, formatDate, formatNumber } = useI18n();
  const [items, setItems] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [detailRequest, setDetailRequest] = useState<RequestRow | null>(null);
  const [payrollDetails, setPayrollDetails] = useState<PayrollDetailRow[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  // التحديث الدوري: لا تداخل بين طلبين، والاستجابة الأقدم من آخر طلب تُهمل، ولا تحديث بعد مغادرة الصفحة
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const loadSeqRef = useRef(0);

  // silent: تحديث دوري في الخلفية بلا مؤشر تحميل ودون مسح القائمة عند الخطأ
  // force: يتجاوز حارس الطلب الجاري (بعد القرار) ويجعل أي استجابة أقدم متقادمة
  const loadData = async (silent = false, force = false) => {
    if (silent && !force && inFlightRef.current) return;
    const seq = ++loadSeqRef.current;
    inFlightRef.current = true;
    const isCurrent = () => mountedRef.current && seq === loadSeqRef.current;
    if (!silent) setLoading(true);
    try {
      const session = readUserSession();
      if (!session?.id) {
        if (isCurrent()) setItems([]);
        return;
      }

      const [leaveRes, reqRes] = await Promise.all([
        supabase.from("leave_requests").select("*").eq("recipient_auth_user_id", session.id).order("created_at", { ascending: false }),
        supabase.from("hr_requests").select("*").eq("recipient_auth_user_id", session.id).order("created_at", { ascending: false }),
      ]);
      if (!isCurrent()) return;
      if (leaveRes.error || reqRes.error) throw leaveRes.error ?? reqRes.error;

      const leaveRows: RequestRow[] = (leaveRes.data ?? []).map((r: any) => ({
        id: String(r.id), requestDate: r.created_at ?? "",
        empId: r.emp_id ?? "", empName: r.emp_name ?? "",
        moveType: "طلب إجازة", requestType: r.leave_type ?? "",
        status: normalizeStatus(String(r.status ?? "").trim()),
        lastUpdate: r.updated_at ?? "",
        adminNote: r.admin_note ?? "", signatureData: r.signature_data ?? "", signedAt: r.signed_at ?? "", source: "leave",
        details: {}, senderDepartment: "", senderName: r.emp_name ?? "",
        startDate: r.start_date ?? "", endDate: r.end_date ?? "",
        days: r.days !== null && r.days !== undefined && r.days !== "" && Number.isFinite(Number(r.days)) ? Number(r.days) : null,
        notes: String(r.notes ?? r.reason ?? ""),
      }));

      const reqRows: RequestRow[] = (reqRes.data ?? []).map((r: any) => {
        const details = r.details && typeof r.details === "object" ? r.details as Record<string, unknown> : {};
        return {
          id: String(r.id), requestDate: r.created_at ?? "",
          empId: r.emp_id ?? "", empName: r.emp_name ?? "",
          moveType: "طلب", requestType: r.request_type ?? "",
          status: normalizeStatus(String(r.status ?? "").trim()),
          lastUpdate: r.updated_at ?? "",
          adminNote: r.admin_note ?? "", signatureData: r.signature_data ?? "", signedAt: r.signed_at ?? "", source: "request" as const,
          details,
          senderDepartment: String(details.sender_department ?? ""),
          senderName: String(details.sender_name ?? r.emp_name ?? ""),
          startDate: r.start_date ?? "", endDate: r.end_date ?? "", days: null, notes: "",
        };
      });

      const rows = [...leaveRows, ...reqRows].sort((a, b) => b.requestDate.localeCompare(a.requestDate));
      setItems(rows);
      // تحديث نافذة التفاصيل المفتوحة بأحدث نسخة من الطلب
      setDetailRequest((prev) => (prev ? rows.find((row) => row.id === prev.id && row.source === prev.source) ?? prev : prev));
    } catch (error) {
      if (!silent && isCurrent()) {
        setItems([]);
        toast({ title: t("تعذر تحميل الطلبات الواردة"), description: t(hrRequestErrorText(error, "حدث خطأ غير متوقع")), variant: "destructive" });
      }
    } finally {
      if (seq === loadSeqRef.current) inFlightRef.current = false;
      if (!silent && mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    void loadData();
    const timer = setInterval(() => void loadData(true), 15000);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, []);

  // القرار أولًا على الطلب (يتحقق الخادم أنك المستلم وأن الطلب معلق)، ثم أثره على الرواتب إن كان طلب اعتماد رواتب
  const updateRequestStatus = async (item: RequestRow, status: "موافق" | "مرفوض") => {
    if (updatingId) return;
    setUpdatingId(item.id);
    try {
      const isPayroll = item.source === "request" && item.details.workflow === "payroll_approval";
      const period = String(item.details.payroll_period ?? "");
      const employeeIds = Array.isArray(item.details.active_employee_ids)
        ? item.details.active_employee_ids.map(String)
        : [];
      const stoppedCount = Array.isArray(item.details.stopped_employee_ids) ? item.details.stopped_employee_ids.length : 0;
      // طلب فيه موقوفون فقط: القرار يعتمد الإيقاف نفسه ولا تتغير حالة صفوف
      if (isPayroll && (!period || (employeeIds.length === 0 && stoppedCount === 0))) throw new Error(t("بيانات طلب اعتماد الرواتب غير مكتملة"));

      // طلب اعتماد الرواتب: القرار وأثره على صفوف الرواتب في عملية واحدة على الخادم (decide_payroll_request)،
      // فلا يبقى الطلب "موافق" وصفوفه معلقة إن لم يكن للمعتمِد صلاحية الرواتب. قبل تطبيق دفعة HR-7 يعود للطريقة السابقة.
      if (isPayroll) {
        const { data: decided, error: decideError } = await supabase.rpc("decide_payroll_request", {
          p_request_id: item.id,
          p_decision: status,
          p_note: reviewNotes[item.id]?.trim() || null,
          // الطلب الذي فتحه المعتمد نفسه (لا طلبًا أُعيد إرساله بالمعرّف نفسه)
          p_created_at: item.requestDate || null,
        });
        const missingRpc = Boolean(decideError && (decideError.code === "PGRST202" || decideError.code === "42883"));
        if (decideError && !missingRpc) throw decideError;
        if (!decideError) {
          const changedRows = Number((decided as { updated_rows?: unknown } | null)?.updated_rows ?? 0);
          const mismatchedRows = Number((decided as { mismatched_rows?: unknown } | null)?.mismatched_rows ?? 0);
          const selfSkipped = Number((decided as { self_skipped?: unknown } | null)?.self_skipped ?? 0);
          if (selfSkipped > 0) {
            toast({ title: t("راتبك ضمن الطلب لم يُعتمد"), description: t("لا يعتمد المعتمد راتبه؛ يعتمده مسؤول آخر"), variant: "destructive" });
          }
          if (mismatchedRows > 0) {
            toast({
              title: t("لم تُعتمد رواتب تغيّرت بعد إرسال الطلب"),
              description: `${formatNumber(mismatchedRows)} ${t("صف تغيّر صافيه عن المعروض عليك فبقي معلقًا؛ اطلب من مسؤول الرواتب إعادة الإرسال")}`,
              variant: "destructive",
            });
          } else if (employeeIds.length > 0 && changedRows === 0) {
            toast({
              title: t("سُجّل القرار لكن لم تتغير صفوف الرواتب"),
              description: t("صفوف الشهر لم تعد معلقة (أُعيد حسابها أو قُرّر فيها)؛ راجع مسؤول الرواتب"),
              variant: "destructive",
            });
          }
          toast({ title: t(status === "موافق" ? "تمت الموافقة على الطلب" : "تم رفض الطلب") });
          if (!mountedRef.current) return;
          const decidedNote = reviewNotes[item.id]?.trim() || item.adminNote || "";
          setItems((prev) => prev.map((row) => (row.id === item.id && row.source === item.source ? { ...row, status, adminNote: decidedNote } : row)));
          setDetailRequest(null);
          await loadData(true, true);
          return;
        }
      }

      const reviewer = readUserSession();
      const requestUpdate = item.source === "request"
        ? {
            status,
            admin_note: reviewNotes[item.id]?.trim() || item.adminNote || null,
            details: {
              ...item.details,
              reviewed_by_name: reviewer?.name ?? "",
              reviewed_by_user_id: reviewer?.id ?? "",
              reviewed_at: new Date().toISOString(),
              review_decision: status,
            },
          }
        : {
            status,
            admin_note: reviewNotes[item.id]?.trim() || item.adminNote || null,
          };
      const { error } = await supabase
        .from(item.source === "leave" ? "leave_requests" : "hr_requests")
        .update(requestUpdate)
        .eq("id", item.id)
        .select("id")
        .single();
      if (error) throw error;

      if (isPayroll && employeeIds.length > 0) {
        const { data: changed, error: payrollError } = await supabase
          .from("payroll")
          .update({ status: status === "موافق" ? "معتمد" : "مرفوض" })
          .eq("month", period)
          .in("emp_id", employeeIds)
          .eq("status", "معلق")
          .select("emp_id");
        if (payrollError) throw payrollError;
        if ((changed ?? []).length === 0) {
          toast({
            title: t("سُجّل القرار لكن لم تتغير صفوف الرواتب"),
            description: t("تأكد أن لديك صلاحية إدارة الرواتب وأن صفوف الشهر ما زالت معلقة"),
            variant: "destructive",
          });
        }
      }

      toast({ title: t(status === "موافق" ? "تمت الموافقة على الطلب" : "تم رفض الطلب") });
      if (!mountedRef.current) return;
      // تحديث فوري للحالة في القائمة، ثم إعادة تحميل تتجاوز التحديث الدوري الجاري (استجابته قد تكون قبل القرار)
      const decidedNote = requestUpdate.admin_note ?? "";
      setItems((prev) => prev.map((row) => (row.id === item.id && row.source === item.source ? { ...row, status, adminNote: decidedNote } : row)));
      setDetailRequest(null);
      await loadData(true, true);
    } catch (error) {
      toast({ title: t("تعذر تحديث الطلب"), description: t(hrRequestErrorText(error, "حدث خطأ غير متوقع")), variant: "destructive" });
    } finally {
      if (mountedRef.current) setUpdatingId(null);
    }
  };

  const openRequestDetails = async (item: RequestRow) => {
    setDetailRequest(item);
    setPayrollDetails([]);
    if (item.details.workflow !== "payroll_approval") return;

    setDetailsLoading(true);
    const period = String(item.details.payroll_period ?? "");
    const employeeIds = Array.isArray(item.details.employee_ids) ? item.details.employee_ids.map(String) : [];
    // صفوف الطلب من دالة الخادم (يراها المستلم ولو لم تكن له صلاحية قراءة الرواتب)؛ وقبل HR-7 من الجدول مباشرة
    const viaRpc = await supabase.rpc("get_payroll_request_rows", { p_request_id: item.id });
    const missingRpc = Boolean(viaRpc.error && (viaRpc.error.code === "PGRST202" || viaRpc.error.code === "42883"));
    const { data, error } = missingRpc
      ? await supabase
          .from("payroll")
          .select("id, emp_id, emp_name, department, basic_salary, allowances, deductions, net_salary, status, notes")
          .eq("month", period)
          .in("emp_id", employeeIds.length ? employeeIds : ["__none__"])
          .order("emp_name")
      : { data: viaRpc.data as Record<string, unknown>[] | null, error: viaRpc.error };
    if (!mountedRef.current) return;
    setDetailsLoading(false);
    if (error) {
      toast({ title: t("تعذر تحميل تفاصيل الطلب"), description: error.message, variant: "destructive" });
      return;
    }
    setPayrollDetails(((data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      empId: String(row.emp_id ?? ""),
      empName: String(row.emp_name ?? ""),
      department: String(row.department ?? ""),
      basicSalary: Number(row.basic_salary ?? 0),
      allowances: Number(row.allowances ?? 0),
      deductions: Number(row.deductions ?? 0),
      netSalary: Number(row.net_salary ?? 0),
      status: String(row.status ?? ""),
      notes: String(row.notes ?? ""),
    })));
  };

  const filtered = items.filter((i) => !search || i.empName.includes(search) || i.empId.includes(search));
  const formatRequestDate = (value: string) => value ? formatDate(value, { dateStyle: "medium" }) : "—";
  const searchIconPosition = direction === "rtl" ? "right-3" : "left-3";
  const searchInputPadding = direction === "rtl" ? "pr-9" : "pl-9";

  return (
    <Layout>
      <div className="space-y-6 w-full" dir={direction}>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">{t("الطلبات الواردة")}</h1>
        </div>

        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
          <div className="p-4 border-b flex justify-between items-center">
            <div className="relative w-72">
              <Search className={`absolute ${searchIconPosition} top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400`} />
              <Input placeholder={t("بحث بالاسم أو الرقم...")} value={search} onChange={(e) => setSearch(e.target.value)} className={searchInputPadding} />
            </div>
            <span className="text-sm text-gray-500">{formatNumber(filtered.length)} {t("طلب")}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-start" dir={direction}>
              <thead className="bg-[#004e89] text-white">
                <tr>
                  <th className="py-3 px-4 font-medium">{t("تاريخ الطلب")}</th>
                  <th className="py-3 px-4 font-medium">{t("المرسل (القسم أو الموظف)")}</th>
                  <th className="py-3 px-4 font-medium">{t("نوع الحركة")}</th>
                  <th className="py-3 px-4 font-medium">{t("نوع الطلب")}</th>
                  <th className="py-3 px-4 font-medium text-center">{t("الحالة")}</th>
                  <th className="py-3 px-4 font-medium text-center">{t("توقيع الموظف")}</th>
                  <th className="py-3 px-4 font-medium">{t("آخر تحديث")}</th>
                  <th className="py-3 px-4 font-medium text-center min-w-64">{t("ملاحظة الإدارة والإجراءات")}</th>
                </tr>
              </thead>
              <tbody className="divide-y bg-white">
                {loading ? (
                  <tr><td colSpan={8} className="text-center py-8 text-gray-400">{t("جاري التحميل...")}</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-8 text-gray-400">{t("لا توجد طلبات واردة")}</td></tr>
                ) : filtered.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50/50">
                    <td className="py-3 px-4">{formatRequestDate(row.requestDate)}</td>
                    <td className="py-3 px-4 font-medium">
                      <div>{row.senderDepartment || row.senderName}</div>
                      {row.senderDepartment && row.senderName && <div className="mt-1 text-xs font-normal text-gray-500">{row.senderName}</div>}
                    </td>
                    <td className="py-3 px-4">{t(row.moveType)}</td>
                    <td className="py-3 px-4">{row.requestType ? t(row.requestType) : "—"}</td>
                    <td className="py-3 px-4 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${row.status === "موافق" ? "bg-emerald-100 text-emerald-800" : row.status === "مرفوض" ? "bg-red-100 text-red-800" : "bg-yellow-100 text-yellow-800"}`}>{t(row.status)}</span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      {row.signatureData ? (
                        <div className="inline-flex flex-col items-center gap-1">
                          <img src={row.signatureData} alt={`${t("توقيع الموظف")} ${row.empName}`} className="h-12 w-28 rounded border bg-white object-contain" />
                          <span className="text-[10px] text-gray-400">{t("موقّع إلكترونيًا")}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">{t("طلب قديم بلا توقيع إلكتروني")}</span>
                      )}
                    </td>
                    <td className="py-3 px-4">{formatRequestDate(row.lastUpdate)}</td>
                    <td className="py-3 px-4">
                      {row.status === "معلق" ? (
                        <div className="space-y-2">
                          <textarea
                            value={reviewNotes[row.id] ?? row.adminNote}
                            onChange={(e) => setReviewNotes((prev) => ({ ...prev, [row.id]: e.target.value }))}
                            placeholder={t("اكتب ملاحظة للموظف (اختياري)")}
                            rows={2}
                            className="w-full resize-none rounded-md border border-gray-200 px-2 py-1.5 text-xs focus:border-blue-500 focus:outline-none"
                          />
                          <div className="flex justify-center gap-3">
                            <button onClick={() => void openRequestDetails(row)} className="text-sky-600 hover:text-sky-800" title={t("عرض التفاصيل")}><Eye className="h-5 w-5" /></button>
                            <button disabled={updatingId === row.id} onClick={() => updateRequestStatus(row, "موافق")} className="text-emerald-500 hover:text-emerald-700 disabled:opacity-40" title={t("موافقة")}><CheckCircle className="h-5 w-5" /></button>
                            <button disabled={updatingId === row.id} onClick={() => updateRequestStatus(row, "مرفوض")} className="text-red-500 hover:text-red-700 disabled:opacity-40" title={t("رفض")}><XCircle className="h-5 w-5" /></button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center gap-2">
                          <span className="text-xs text-gray-600">{row.adminNote || t("لا توجد ملاحظة")}</span>
                          <button onClick={() => void openRequestDetails(row)} className="text-sky-600 hover:text-sky-800" title={t("عرض التفاصيل")}><Eye className="h-5 w-5" /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {detailRequest && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setDetailRequest(null)}>
            <div className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
              <div className="flex items-center justify-between border-b px-5 py-4">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">{t("تفاصيل الطلب")}</h2>
                  <p className="mt-1 text-sm text-gray-500">{t(detailRequest.requestType)} — {detailRequest.senderDepartment || detailRequest.senderName}</p>
                </div>
                <button onClick={() => setDetailRequest(null)} className="rounded-md p-2 text-gray-500 hover:bg-gray-100" title={t("إغلاق")}><X className="h-5 w-5" /></button>
              </div>
              <div className="grid gap-3 border-b bg-gray-50 p-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div><span className="block text-xs text-gray-500">{t("القسم المرسل")}</span><strong>{detailRequest.senderDepartment || "—"}</strong></div>
                <div><span className="block text-xs text-gray-500">{t("المسؤول المرسل")}</span><strong>{detailRequest.senderName || "—"}</strong></div>
                <div><span className="block text-xs text-gray-500">{t("نوع الطلب")}</span><strong>{t(detailRequest.requestType)}</strong></div>
                <div><span className="block text-xs text-gray-500">{t("تاريخ الطلب")}</span><strong>{formatRequestDate(detailRequest.requestDate)}</strong></div>
                <div><span className="block text-xs text-gray-500">{t("الحالة")}</span><strong>{t(detailRequest.status)}</strong></div>
                {detailRequest.details.workflow !== "payroll_approval" && <>
                  <div><span className="block text-xs text-gray-500">{t("الموظف")}</span><strong>{detailRequest.empName || "—"}{detailRequest.empId ? ` (${detailRequest.empId})` : ""}</strong></div>
                  <div><span className="block text-xs text-gray-500">{t("تاريخ البداية")}</span><strong>{detailRequest.startDate || "—"}</strong></div>
                  <div><span className="block text-xs text-gray-500">{t("تاريخ النهاية")}</span><strong>{detailRequest.endDate || "—"}</strong></div>
                </>}
                {detailRequest.source === "leave" && (
                  <div><span className="block text-xs text-gray-500">{t("عدد الأيام")}</span><strong>{detailRequest.days !== null ? formatNumber(detailRequest.days) : detailRequest.startDate && detailRequest.endDate ? formatNumber(daysInclusive(detailRequest.startDate, detailRequest.endDate)) : "—"}</strong></div>
                )}
                {detailRequest.details.workflow === "payroll_approval" && <>
                  <div><span className="block text-xs text-gray-500">{t("فترة الرواتب")}</span><strong>{String(detailRequest.details.payroll_period ?? "—")}</strong></div>
                  <div><span className="block text-xs text-gray-500">{t("عدد الموظفين")}</span><strong>{formatNumber(Number(detailRequest.details.employee_count ?? 0))}</strong></div>
                  <div><span className="block text-xs text-gray-500">{t("رواتب قيد الاعتماد")}</span><strong>{formatNumber(Number(detailRequest.details.active_employee_count ?? 0))}</strong></div>
                  <div><span className="block text-xs text-gray-500">{t("رواتب موقوفة")}</span><strong>{formatNumber(Number(detailRequest.details.stopped_employee_count ?? 0))}</strong></div>
                  {String(detailRequest.details.stop_reason ?? "").trim() && (
                    <div className="sm:col-span-2"><span className="block text-xs text-gray-500">{t("سبب إيقاف الرواتب")}</span><strong>{String(detailRequest.details.stop_reason)}</strong></div>
                  )}
                </>}
              </div>
              <div className="space-y-4 border-b p-5 text-sm">
                {detailRequest.source === "leave" ? (
                  <div>
                    <h3 className="mb-2 font-semibold text-gray-800">{t("ملاحظات الطلب")}</h3>
                    <p className="whitespace-pre-line rounded-lg border bg-white p-3 text-gray-700">{detailRequest.notes ? detailRequest.notes.split(" | ").join("\n") : "—"}</p>
                  </div>
                ) : (() => {
                  const entries = requestDetailEntries(detailRequest.requestType, detailRequest.details);
                  if (entries.length === 0) return detailRequest.details.workflow === "payroll_approval" ? null : <p className="text-gray-400">{t("لا توجد بيانات إضافية في الطلب")}</p>;
                  return (
                    <div>
                      <h3 className="mb-2 font-semibold text-gray-800">{t("بيانات الطلب")}</h3>
                      <dl className="grid gap-3 sm:grid-cols-2">
                        {entries.map((entry) => (
                          <div key={entry.key} className="rounded-lg border bg-white p-3">
                            <dt className="text-xs text-gray-500">{t(entry.label)}</dt>
                            <dd className="mt-1 whitespace-pre-line font-medium text-gray-900">{entry.isOption ? t(entry.value) : entry.value}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  );
                })()}
                <div>
                  <h3 className="mb-2 font-semibold text-gray-800">{t("ملاحظة الإدارة")}</h3>
                  <p className="whitespace-pre-line text-gray-700">{detailRequest.adminNote || t("لا توجد ملاحظة")}</p>
                </div>
                {detailRequest.details.workflow !== "payroll_approval" && <div>
                  <h3 className="mb-2 font-semibold text-gray-800">{t("توقيع الموظف")}</h3>
                  {detailRequest.signatureData ? (
                    <div className="inline-flex flex-col items-start gap-1">
                      <img src={detailRequest.signatureData} alt={`${t("توقيع الموظف")} ${detailRequest.empName}`} className="h-20 w-48 rounded border bg-white object-contain" />
                      {detailRequest.signedAt && <span className="text-xs text-gray-400">{t("وقت التوقيع")}: {formatRequestDate(detailRequest.signedAt)}</span>}
                    </div>
                  ) : (
                    <span className="text-xs text-gray-400">{t("طلب قديم بلا توقيع إلكتروني")}</span>
                  )}
                </div>}
              </div>
              {detailRequest.details.workflow === "payroll_approval" && (
                <div className="p-5">
                  {detailsLoading ? <p className="py-8 text-center text-gray-400">{t("جاري التحميل...")}</p> : (
                    <div className="overflow-x-auto rounded-lg border">
                      <table className="min-w-full text-sm">
                        <thead className="bg-[#075f94] text-white"><tr><th className="px-3 py-3">{t("رقم الموظف")}</th><th className="px-3 py-3">{t("اسم الموظف")}</th><th className="px-3 py-3">{t("القسم")}</th><th className="px-3 py-3">{t("الراتب الأساسي")}</th><th className="px-3 py-3">{t("البدلات")}</th><th className="px-3 py-3">{t("الاستقطاعات")}</th><th className="px-3 py-3">{t("صافي الراتب")}</th><th className="px-3 py-3">{t("الحالة")}</th><th className="px-3 py-3">{t("تفاصيل الحساب")}</th></tr></thead>
                        <tbody>{payrollDetails.map((row) => <tr key={row.id} className="border-b"><td className="px-3 py-3">{row.empId}</td><td className="px-3 py-3 font-medium">{row.empName}</td><td className="px-3 py-3">{row.department || "—"}</td><td className="px-3 py-3">{formatNumber(row.basicSalary, { minimumFractionDigits: 2 })}</td><td className="px-3 py-3">{formatNumber(row.allowances, { minimumFractionDigits: 2 })}</td><td className="px-3 py-3">{formatNumber(row.deductions, { minimumFractionDigits: 2 })}</td><td className="px-3 py-3 font-semibold">{formatNumber(row.netSalary, { minimumFractionDigits: 2 })}</td><td className="px-3 py-3">{t(row.status)}</td><td className="min-w-64 px-3 py-3 text-xs text-gray-600">{row.notes || "—"}</td></tr>)}</tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
              {detailRequest.status === "معلق" && (
                <div className="flex justify-end gap-3 border-t px-5 py-4">
                  <Button variant="outline" disabled={updatingId === detailRequest.id} onClick={() => void updateRequestStatus(detailRequest, "مرفوض")} className="border-red-200 text-red-700">{t("رفض")}</Button>
                  <Button disabled={updatingId === detailRequest.id} onClick={() => void updateRequestStatus(detailRequest, "موافق")} className="bg-emerald-600 hover:bg-emerald-700">{t("موافقة")}</Button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
