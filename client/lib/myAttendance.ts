// حضور الموظف في بوابته: بيانات من الخادم (get_my_attendance_overview / get_my_attendance_state)
// وتصنيف الأيام بالقاعدة نفسها في حساب الدوام وكشف الرواتب (attendanceRules + workSchedule)،
// فيرى الموظف في البوابة الأرقام نفسها التي تراها الموارد البشرية.
import { supabase } from "@/lib/supabaseClient";
import { eachDate } from "@/lib/hrDates";
import { classifyAttendanceDay, type DayCategory } from "@/lib/attendanceRules";
import { effectiveLateMinutes, isScheduledWorkDay, parseSchedule, requiredDailyMinutes, workedSecondsFor, type WorkSchedule } from "@/lib/workSchedule";
import { permissionHoursFromDetails } from "@/lib/attendanceManual";

export type MyAttendanceRecord = {
  date: string;
  checkIn: string;
  checkOut: string;
  status: string;
  lateMinutes: number;
  source: string;
  verified: boolean;
};

export type MyAttendanceDay = {
  date: string;
  category: DayCategory;
  counted: boolean;
  /** يوم عمل ماضٍ بلا تسجيل */
  unrecorded: boolean;
  deductibleAbsence: boolean;
  workDay: boolean;
  holiday: boolean;
  onLeave: boolean;
  record: MyAttendanceRecord | null;
  lateMinutes: number;
  workedSeconds: number;
  requiredSeconds: number;
  /** ساعات الاستئذان المعتمد في اليوم (تُطرح من النقص) */
  permissionSeconds: number;
  deficitSeconds: number;
  overtimeSeconds: number;
};

export type MyAttendanceSummary = {
  present: number;
  late: number;
  absent: number;
  leave: number;
  unrecorded: number;
  workedSeconds: number;
  requiredSeconds: number;
  deficitSeconds: number;
  overtimeSeconds: number;
};

export type MyAttendancePeriod = {
  today: string;
  countUnrecordedAsAbsent: boolean;
  schedule: WorkSchedule | null;
  days: MyAttendanceDay[];
  summary: MyAttendanceSummary;
  /** أحدث سجل في الفترة */
  latest: MyAttendanceRecord | null;
};

/** حالة اليوم في البوابة: سجل اليوم، أو حضور مفتوح من أمس (وردية ليلية) يُسجَّل عليه الانصراف */
export type MyAttendanceState = {
  today: string;
  /** تاريخ السجل المعروض (اليوم، أو أمس إن كان الحضور مفتوحًا منه) */
  date: string | null;
  checkIn: string | null;
  checkOut: string | null;
  status: string;
  /** حضور بلا انصراف يقبل الخادم تسجيل الانصراف عليه الآن */
  open: boolean;
};

const text = (value: unknown) => String(value ?? "").trim();
const dateKey = (value: unknown) => text(value).slice(0, 10);

const toRecord = (row: Record<string, unknown>): MyAttendanceRecord => ({
  date: dateKey(row.date),
  checkIn: text(row.check_in),
  checkOut: text(row.check_out),
  status: text(row.status),
  lateMinutes: Number(row.late_minutes ?? 0) || 0,
  source: text(row.entry_source),
  verified: row.location_verified === true,
});

const isMissingRpc = (error: unknown) => {
  const code = String((error as { code?: unknown } | null)?.code ?? "");
  return code === "PGRST202" || code === "42883";
};

/** خطأ قابل للعرض حين لا تكون دالة الخادم مثبتة بعد (لم يُشغَّل ملف قاعدة البيانات) */
export const MY_ATTENDANCE_UNAVAILABLE = "MY_ATTENDANCE_UNAVAILABLE";

/** حضور الموظف الحالي من تاريخ إلى تاريخ (حتى 62 يومًا) مصنفًا يومًا بيوم */
export async function loadMyAttendance(from: string, to: string): Promise<{ data: MyAttendancePeriod | null; error: unknown | null }> {
  try {
    const { data, error } = await supabase.rpc("get_my_attendance_overview", { p_from: from, p_to: to });
    if (error) return { data: null, error: isMissingRpc(error) ? new Error(MY_ATTENDANCE_UNAVAILABLE) : error };
    const payload = (data ?? {}) as Record<string, unknown>;
    const employee = (payload.employee ?? {}) as Record<string, unknown>;
    const schedule = payload.schedule && typeof payload.schedule === "object" ? parseSchedule(payload.schedule as Record<string, unknown>) : null;
    const today = dateKey(payload.today);
    const holidays = new Set((Array.isArray(payload.holidays) ? payload.holidays : []).map(dateKey));
    const leaves = new Set((Array.isArray(payload.leaves) ? payload.leaves : []).map(dateKey));
    const countUnrecordedAsAbsent = payload.count_unrecorded_as_absent === true;
    const records = (Array.isArray(payload.records) ? payload.records : []).map((row) => toRecord(row as Record<string, unknown>));
    const byDate = new Map(records.map((record) => [record.date, record] as const));
    const hireDate = dateKey(employee.hire_date);
    const exempt = employee.attendance_exempt === true;
    const dailySeconds = requiredDailyMinutes(schedule, Number(employee.daily_hours ?? 0)) * 60;
    // الاستئذان المعتمد والساعات الإضافية المعتمدة لكل يوم (كما في حساب الدوام)
    const permissionByDate = new Map<string, number>();
    (Array.isArray(payload.permissions) ? payload.permissions : []).forEach((item) => {
      const row = (item ?? {}) as Record<string, unknown>;
      const details = row.details && typeof row.details === "object" ? row.details as Record<string, unknown> : {};
      const key = dateKey(row.date);
      permissionByDate.set(key, (permissionByDate.get(key) ?? 0) + permissionHoursFromDetails(details) * 3600);
    });
    const overtimeByDate = new Map<string, number>();
    (Array.isArray(payload.overtime) ? payload.overtime : []).forEach((item) => {
      const row = (item ?? {}) as Record<string, unknown>;
      const key = dateKey(row.date);
      overtimeByDate.set(key, (overtimeByDate.get(key) ?? 0) + (Number(row.hours) || 0) * 3600);
    });

    const summary: MyAttendanceSummary = { present: 0, late: 0, absent: 0, leave: 0, unrecorded: 0, workedSeconds: 0, requiredSeconds: 0, deficitSeconds: 0, overtimeSeconds: 0 };
    const days: MyAttendanceDay[] = eachDate(from, to).map((date) => {
      const record = byDate.get(date) ?? null;
      const workDay = isScheduledWorkDay(date, schedule);
      const holiday = holidays.has(date);
      const onLeave = leaves.has(date);
      // التأخير من جدول الدوام الحالي في أيام العمل (كما في حساب الدوام)، ومن السجل لمن لا جدول ثابتًا له
      const computedLateMinutes = record ? effectiveLateMinutes(record.lateMinutes, record.checkIn, schedule, workDay && !holiday) : 0;
      const day = classifyAttendanceDay({
        date,
        record: record ? { status: record.status, checkIn: record.checkIn, lateMinutes: computedLateMinutes } : undefined,
        workDay,
        holiday,
        onLeave,
        hireDate,
        today,
        exempt,
        countUnrecordedAsAbsent,
        computedLateMinutes,
      });
      const attended = day.category === "present" || day.category === "late";
      // الأيام بعد اليوم (تحضير مسبق) واليوم الجاري قبل الانصراف لا تُحسب ساعاتها
      const pending = date > today || (date === today && Boolean(record?.checkIn) && !record?.checkOut);
      const workedSeconds = record && !pending ? workedSecondsFor(record.checkIn, record.checkOut, schedule) : 0;
      const requiredSeconds = day.requiresHours && !pending ? dailySeconds : 0;
      const permissionSeconds = pending ? 0 : permissionByDate.get(date) ?? 0;
      const deficitSeconds = requiredSeconds ? Math.max(requiredSeconds - workedSeconds - permissionSeconds, 0) : 0;
      // الساعات الإضافية المسجلة لنفس اليوم غالبًا هي نفسها المحسوبة من البصمة: الأكبر لا المجموع
      const punchOvertime = !workDay || holiday ? workedSeconds : Math.max(workedSeconds - dailySeconds, 0);
      const overtimeSeconds = pending ? 0 : Math.max(punchOvertime, overtimeByDate.get(date) ?? 0);
      const lateMinutes = attended ? computedLateMinutes : 0;
      if (day.counted && day.category === "present") summary.present += 1;
      if (day.counted && day.category === "late") summary.late += 1;
      if (day.counted && day.category === "leave") summary.leave += 1;
      if (day.deductibleAbsence) summary.absent += 1;
      if (day.unrecorded && !day.deductibleAbsence) summary.unrecorded += 1;
      summary.workedSeconds += workedSeconds;
      summary.requiredSeconds += requiredSeconds;
      summary.deficitSeconds += deficitSeconds;
      summary.overtimeSeconds += overtimeSeconds;
      return { date, category: day.category, counted: day.counted, unrecorded: day.unrecorded, deductibleAbsence: day.deductibleAbsence, workDay, holiday, onLeave, record, lateMinutes, workedSeconds, requiredSeconds, permissionSeconds, deficitSeconds, overtimeSeconds };
    });
    // آخر سجل حتى اليوم (لا التحضير المسبق لأيام قادمة)
    const latest = [...records].filter((record) => record.date <= today).sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
    return { data: { today, countUnrecordedAsAbsent, schedule, days, summary, latest }, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

/** حالة حضور اليوم للموظف الحالي بتوقيت الرياض (بالقاعدة نفسها التي يقبل بها الخادم الحضور والانصراف) */
export async function loadMyAttendanceState(): Promise<{ data: MyAttendanceState | null; error: unknown | null }> {
  try {
    const { data, error } = await supabase.rpc("get_my_attendance_state");
    if (error) return { data: null, error: isMissingRpc(error) ? new Error(MY_ATTENDANCE_UNAVAILABLE) : error };
    const payload = (data ?? {}) as Record<string, unknown>;
    return {
      data: {
        today: dateKey(payload.today),
        date: dateKey(payload.date) || null,
        checkIn: text(payload.check_in) || null,
        checkOut: text(payload.check_out) || null,
        status: text(payload.status),
        open: payload.open === true,
      },
      error: null,
    };
  } catch (error) {
    return { data: null, error };
  }
}
