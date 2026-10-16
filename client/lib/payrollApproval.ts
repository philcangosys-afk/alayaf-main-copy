import { supabase } from "@/lib/supabaseClient";

const PENDING = ["", "معلق", "معلقة", "pending"];
const OPEN_PAYROLL = ["معلق", "مرفوض", "موقوف"];

type SubmitOptions = {
  period: string;
  senderName: string;
  senderUserId: string;
  senderEmpId: string;
  activeIds: string[];
  stoppedIds: string[];
  /** موظفون من طلبي السابق المحذوف خارج الإرسال الحالي: يبقون في الطلب الجديد بحالة صفوفهم الحالية */
  carriedIds?: string[];
  /** سبب إيقاف الرواتب (اختياري) يظهر للمعتمد في تفاصيل الطلب */
  stopReason?: string;
  /** سبب الإيقاف في طلبي السابق المحذوف: يُستخدم إن لم يُكتب سبب جديد */
  previousStopReason?: string;
  /** تاريخ "اليوم" الذي حُسبت عليه الأرقام: يتحقق به المعتمد قبل الموافقة */
  computedOn?: string;
};

const requestCodes = (details: unknown): string[] | null => {
  const list = (details as { employee_ids?: unknown } | null)?.employee_ids;
  return Array.isArray(list) ? list.map((code) => String(code ?? "").trim()).filter(Boolean) : null;
};

export type PayrollResendPreparation = {
  /** موظفون كانوا في طلبي المحذوف وليسوا في الإرسال الحالي */
  carried: string[];
  /** عدد طلباتي المعلقة التي حُذفت */
  deleted: number;
  /** سبب الإيقاف في طلبي المحذوف (يُبقى للموقوفين المنقولين إن لم يُكتب سبب جديد) */
  previousStopReason: string;
};

/**
 * قبل حفظ أرقام جديدة لشهر:
 * - لا يُعاد حساب موظف معروض على المعتمد في طلب معلق أرسله مستخدم آخر (وإلا اعتمد أرقامًا لم يرها).
 *   رؤية طلبات المستخدمين الآخرين تعتمد على سياسة القراءة hr_requests_hr_select (دفعة HR-3).
 * - طلبي المعلق الذي يشمل أيًّا من الموظفين المرسلين يُحذف قبل تغيير الأرقام، ومن كان فيه خارج الإرسال الحالي
 *   يُعاد إلى الطلب الجديد (carried) حتى لا يبقى راتبه معلقًا بلا طلب.
 * - الطلبات المعلقة الأخرى التي لا تشمل الموظفين المرسلين (مثل إرسال إدارة أخرى) لا تُمس.
 * - الحذف للمعلق فقط: طلب قرّرته الإدارة في اللحظة نفسها يبقى كما هو (وصفوفه المعتمدة لا تُمس).
 */
export async function preparePayrollResend(period: string, codes: string[]): Promise<PayrollResendPreparation> {
  const sending = new Set(codes.map((code) => String(code ?? "").trim()).filter(Boolean));
  const { data: existing, error } = await supabase
    .from("hr_requests")
    .select("id, status, sender_auth_user_id, details")
    .eq("request_type", "اعتماد رواتب الموظفين")
    .contains("details", { workflow: "payroll_approval", payroll_period: period });
  if (error) throw error;
  const { data: sessionData } = await supabase.auth.getSession();
  const me = sessionData.session?.user?.id ?? "";
  if (!me) throw new Error("PAYROLL_SESSION_MISSING");
  const overlapping = (existing ?? []).filter((request) => {
    if (!PENDING.includes(String(request.status ?? "").trim())) return false;
    const covered = requestCodes(request.details);
    // طلب قديم بلا قائمة موظفين يُعامل كأنه يشمل الشهر كله
    return covered === null || covered.some((code) => sending.has(code));
  });
  if (overlapping.some((request) => request.sender_auth_user_id !== me)) throw new Error("PAYROLL_PENDING_OTHER_SENDER");
  if (overlapping.length === 0) return { carried: [], deleted: 0, previousStopReason: "" };

  // حذف واحد (عملية واحدة) للمعلق فقط
  const ids = overlapping.map((request) => request.id);
  const { data: removed, error: deleteError } = await supabase
    .from("hr_requests")
    .delete()
    .in("id", ids)
    // قيم غير فارغة فقط في الفلتر؛ طلب حالته فارغة لا يُحذف ويُعامل أدناه كمعلق فيوقف الإرسال
    .in("status", PENDING.filter(Boolean))
    .select("id, details");
  if (deleteError) throw deleteError;
  const removedIds = new Set((removed ?? []).map((request) => String(request.id)));
  const carried = new Set<string>();
  let previousStopReason = "";
  (removed ?? []).forEach((request) => {
    (requestCodes(request.details) ?? []).forEach((code) => {
      if (!sending.has(code)) carried.add(code);
    });
    const reason = String((request.details as { stop_reason?: unknown } | null)?.stop_reason ?? "").trim();
    if (reason && !previousStopReason) previousStopReason = reason;
  });

  // ما لم يُحذف: إن قُرّر في اللحظة نفسها فلا بأس، وإن بقي معلقًا (صلاحية أو حالة غير معتادة) فلا تُغيَّر أرقامه
  const notRemoved = ids.filter((id) => !removedIds.has(String(id)));
  if (notRemoved.length) {
    const { data: still, error: stillError } = await supabase.from("hr_requests").select("id, status").in("id", notRemoved);
    if (stillError) throw stillError;
    if ((still ?? []).some((request) => PENDING.includes(String(request.status ?? "").trim()))) {
      const failure = new Error("PAYROLL_PREVIOUS_REQUEST_LOCKED") as Error & { preparation?: PayrollResendPreparation };
      failure.preparation = { carried: [...carried], deleted: removedIds.size, previousStopReason };
      throw failure;
    }
  }
  return { carried: [...carried], deleted: removedIds.size, previousStopReason };
}

/** بيانات التحضير من نتيجة الدالة أو من خطأ PAYROLL_PREVIOUS_REQUEST_LOCKED (لرسالة الفشل بعد الحذف) */
export const resendPreparationOf = (preparation: PayrollResendPreparation | null, error: unknown): PayrollResendPreparation | null =>
  preparation ?? ((error as { preparation?: PayrollResendPreparation } | null)?.preparation ?? null);

// إرسال (أو إعادة إرسال) كشف رواتب شهر للاعتماد:
// - الرواتب المعتمدة أو المرحّلة لا تُمس ولا تدخل الطلب الجديد.
// - يُستدعى بعد preparePayrollResend (الذي يحذف طلبي المعلق المتداخل)، ثم يُنشأ طلب جديد (لا تعديل لطلب قائم).
// - الموظفون المنقولون من طلبي السابق يدخلون بحالة صفوفهم الحالية (موقوف يبقى موقوفًا).
// - حالات صفوف الرواتب تتغير فقط بعد نجاح إنشاء الطلب.
// - يُحفظ في الطلب صافي كل موظف كما عُرض على المعتمد (active_amounts / stopped_amounts)؛
//   الترحيل المحاسبي يرفض أي راتب تغيّر بعد موافقة الإدارة أو لم يدخل طلبًا موافقًا عليه.
// - طلب فيه موقوفون فقط مسموح (اعتماد إيقافهم بعد أن اعتُمد الباقون).
export async function submitPayrollApprovalRequest({ period, senderName, senderUserId, senderEmpId, activeIds, stoppedIds, carriedIds = [], stopReason, previousStopReason, computedOn }: SubmitOptions) {
  const sendingSet = new Set([...activeIds, ...stoppedIds]);
  const carried = [...new Set(carriedIds)].filter((id) => id && !sendingSet.has(id));
  const targetIds = [...activeIds, ...stoppedIds, ...carried];
  const { data: rows, error: rowsError } = await supabase
    .from("payroll")
    .select("emp_id, status, net_salary")
    .eq("month", period)
    .in("emp_id", targetIds);
  if (rowsError) throw rowsError;
  const statusById = new Map<string, string>((rows ?? []).map((row) => [String(row.emp_id), String(row.status ?? "معلق")] as [string, string]));
  const netById = new Map<string, number>((rows ?? []).map((row) => [String(row.emp_id), Math.round(Number(row.net_salary ?? 0) * 100) / 100] as [string, number]));
  const amountsOf = (codes: string[]) => Object.fromEntries(codes.filter((code) => netById.has(code)).map((code) => [code, netById.get(code)!]));
  const isOpen = (id: string) => OPEN_PAYROLL.includes(statusById.get(id) ?? "معلق");
  // المنقول بلا صف رواتب لا يدخل (لا أرقام يراها المعتمد)
  const carriedOpen = carried.filter((id) => statusById.has(id) && isOpen(id));
  const openActive = [...activeIds.filter(isOpen), ...carriedOpen.filter((id) => statusById.get(id) !== "موقوف")];
  const openStopped = [...stoppedIds.filter(isOpen), ...carriedOpen.filter((id) => statusById.get(id) === "موقوف")];
  if (openActive.length === 0 && openStopped.length === 0) throw new Error("PAYROLL_NOTHING_TO_APPROVE");

  const [year, month] = period.split("-").map(Number);
  const { error: insertError } = await supabase
    .from("hr_requests")
    .insert({
      emp_id: `PAYROLL-${period}`,
      emp_name: `قسم الموارد البشرية — ${senderName}`,
      request_type: "اعتماد رواتب الموظفين",
      start_date: `${period}-01`,
      end_date: `${period}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`,
      status: "معلق",
      details: {
        workflow: "payroll_approval",
        sender_department: "قسم الموارد البشرية",
        sender_name: senderName,
        sender_user_id: senderUserId,
        sender_emp_id: senderEmpId,
        payroll_period: period,
        employee_ids: [...openActive, ...openStopped],
        active_employee_ids: openActive,
        stopped_employee_ids: openStopped,
        active_amounts: amountsOf(openActive),
        stopped_amounts: amountsOf(openStopped),
        employee_count: openActive.length + openStopped.length,
        active_employee_count: openActive.length,
        stopped_employee_count: openStopped.length,
        ...(openStopped.length && (stopReason?.trim() || previousStopReason?.trim()) ? { stop_reason: (stopReason?.trim() || previousStopReason?.trim() || "").slice(0, 300) } : {}),
        ...(computedOn ? { computed_on: computedOn } : {}),
      },
    })
    .select("id")
    .single();
  if (insertError) throw insertError;

  if (openStopped.length > 0) {
    const { error } = await supabase.from("payroll").update({ status: "موقوف" }).eq("month", period).in("emp_id", openStopped).in("status", OPEN_PAYROLL);
    if (error) throw error;
  }
  if (openActive.length > 0) {
    const { error: activeError } = await supabase.from("payroll").update({ status: "معلق" }).eq("month", period).in("emp_id", openActive).in("status", OPEN_PAYROLL);
    if (activeError) throw activeError;
  }

  return { active: openActive.length, stopped: openStopped.length, skipped: targetIds.length - openActive.length - openStopped.length, carried: carriedOpen.length };
}
