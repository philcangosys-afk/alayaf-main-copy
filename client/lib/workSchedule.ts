// جداول العمل (إعداد فترات الدوام): فترات الدوام وأيام العمل والاستراحة وفترات السماح.
// مصدرها جدول attendance_schedules، ويُربط الموظف بها بالاسم في employees.work_schedule.
// كل الحسابات هنا دوال صافية ليُستخدم المنطق نفسه في حساب الدوام والتقرير الشهري وكشف الرواتب.
import { supabase } from "@/lib/supabaseClient";
import { isWeekend } from "@/lib/hrDates";

export type SchedulePeriod = { start: string; end: string };

export type WorkSchedule = {
  id: string;
  name: string;
  type: string;
  /** متغير: لا مواعيد ثابتة؛ المطلوب عدد ساعات فقط ولا يُحسب تأخير */
  flexible: boolean;
  periods: SchedulePeriod[];
  /** أيام العمل بترقيم getUTCDay: الأحد 0 … السبت 6 */
  workDays: number[];
  breakMinutes: number;
  lateGraceMinutes: number;
  earlyLeaveGraceMinutes: number;
  /** الدقائق المطلوبة في يوم العمل */
  dailyMinutes: number;
  status: string;
};

export const FIXED_SCHEDULE_TYPE = "جدول عمل ثابت";
export const FLEXIBLE_SCHEDULE_TYPE = "جدول عمل متغير";
/** الأحد إلى الخميس */
export const DEFAULT_WORK_DAYS = [0, 1, 2, 3, 4];
export const WEEKDAY_LABELS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
export const MAX_PERIODS = 4;
export const DEFAULT_DAILY_MINUTES = 8 * 60;

// الثواني قد تحمل كسورًا ("08:05:12.345678") في سجلات بصمة البوابة القديمة (وقت PostgreSQL محفوظ نصًا)
const TIME_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d+)?)?$/;

/** "HH:MM" أو "HH:MM:SS" إلى دقائق من منتصف الليل؛ null إن لم يكن وقتًا صحيحًا */
export const timeToMinutes = (value: unknown): number | null => {
  const match = TIME_PATTERN.exec(String(value ?? "").trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
};

/** مدة الفترة بالدقائق؛ فترة تعبر منتصف الليل (22:00 → 06:00) تُحسب صحيحة، والبداية = النهاية مدة صفر */
export const periodMinutes = (period: SchedulePeriod): number => {
  const start = timeToMinutes(period.start);
  const end = timeToMinutes(period.end);
  if (start === null || end === null || start === end) return 0;
  return end > start ? end - start : 1440 - start + end;
};

/** "09:00:00" أو "9" أو "8.5" إلى دقائق */
export const hoursTextToMinutes = (value: unknown): number | null => {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (text.includes(":")) {
    const [hours, minutes = "0"] = text.split(":");
    const total = Number(hours) * 60 + Number(minutes);
    return Number.isFinite(total) && total > 0 ? total : null;
  }
  const hours = Number(text);
  return Number.isFinite(hours) && hours > 0 ? Math.round(hours * 60) : null;
};

/** دقائق إلى "HH:MM:00" (صيغة عمود hours القديم) */
export const minutesToHoursText = (minutes: number): string => {
  const safe = Math.max(0, Math.round(minutes));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}:00`;
};

const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

const normalizeTime = (value: unknown) => {
  const minutes = timeToMinutes(value);
  return minutes === null ? "" : `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
};

export const parsePeriods = (value: unknown): SchedulePeriod[] => {
  let raw = value;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { raw = []; }
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => ({ start: normalizeTime((item as Record<string, unknown>)?.start), end: normalizeTime((item as Record<string, unknown>)?.end) }))
    .filter((period) => period.start && period.end && periodMinutes(period) > 0)
    .slice(0, MAX_PERIODS);
};

export const parseWorkDays = (value: unknown): number[] => {
  let raw = value;
  if (typeof raw === "string") {
    // صيغة مصفوفة PostgreSQL "{0,1,2}" أو JSON "[0,1,2]"
    raw = raw.replace(/[{}[\]\s]/g, "").split(",").filter(Boolean);
  }
  if (!Array.isArray(raw)) return [...DEFAULT_WORK_DAYS];
  const days = [...new Set(raw.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b);
  return days.length ? days : [...DEFAULT_WORK_DAYS];
};

/** مجموع الفترات ناقص الاستراحة */
export const computeDailyMinutes = (periods: SchedulePeriod[], breakMinutes: number): number =>
  Math.max(0, periods.reduce((sum, period) => sum + periodMinutes(period), 0) - Math.max(0, breakMinutes));

/** صف attendance_schedules إلى جدول عمل؛ يتحمل الصفوف القديمة التي ليس لها إلا الاسم وعدد الساعات */
export const parseSchedule = (row: Record<string, unknown>): WorkSchedule => {
  const periods = parsePeriods(row.periods);
  const breakMinutes = clampInt(row.break_minutes, 0, 600, 0);
  const type = String(row.type ?? "").trim() || FIXED_SCHEDULE_TYPE;
  const flexible = type.includes("متغير") || periods.length === 0;
  const fromPeriods = computeDailyMinutes(periods, breakMinutes);
  const fromHours = hoursTextToMinutes(row.hours);
  const dailyMinutes = periods.length && fromPeriods > 0 ? fromPeriods : fromHours ?? DEFAULT_DAILY_MINUTES;
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? "").trim(),
    type,
    flexible,
    periods,
    workDays: parseWorkDays(row.work_days),
    breakMinutes,
    lateGraceMinutes: clampInt(row.late_grace_minutes, 0, 240, 0),
    earlyLeaveGraceMinutes: clampInt(row.early_leave_grace_minutes, 0, 240, 0),
    dailyMinutes,
    status: String(row.status ?? "").trim(),
  };
};

/** رقم يوم الأسبوع لتاريخ "YYYY-MM-DD" (الأحد 0) دون إزاحة منطقة زمنية */
export const dayOfWeek = (dateKey: string): number => new Date(`${dateKey.slice(0, 10)}T00:00:00Z`).getUTCDay();

/** يوم عمل حسب جدول الموظف؛ من لا جدول له: الأحد إلى الخميس */
export const isScheduledWorkDay = (dateKey: string, schedule: WorkSchedule | null | undefined): boolean =>
  schedule ? schedule.workDays.includes(dayOfWeek(dateKey)) : !isWeekend(dateKey);

/** الدقائق المطلوبة يوميًا: من الجدول، وإلا من ساعات الموظف اليومية، وإلا 8 ساعات */
export const requiredDailyMinutes = (schedule: WorkSchedule | null | undefined, employeeDailyHours?: number): number => {
  if (schedule && schedule.dailyMinutes > 0) return schedule.dailyMinutes;
  const hours = Number(employeeDailyHours);
  return Number.isFinite(hours) && hours > 0 ? Math.round(hours * 60) : DEFAULT_DAILY_MINUTES;
};

/** فرق دقيقتين مع مراعاة عبور منتصف الليل (النتيجة بين -720 و 720) */
const signedDiff = (actual: number, expected: number) => {
  let diff = actual - expected;
  if (diff > 720) diff -= 1440;
  if (diff < -720) diff += 1440;
  return diff;
};

/**
 * دقائق التأخير: للجدول الثابت فقط. إن تجاوز الدخول بداية الدوام بأكثر من فترة السماح
 * يُحسب التأخير كاملًا من بداية الدوام؛ ضمن فترة السماح لا تأخير.
 */
export const lateMinutesFor = (checkIn: unknown, schedule: WorkSchedule | null | undefined): number => {
  if (!schedule || schedule.flexible || !schedule.periods.length) return 0;
  const actual = timeToMinutes(checkIn);
  const expected = timeToMinutes(schedule.periods[0].start);
  if (actual === null || expected === null) return 0;
  const diff = signedDiff(actual, expected);
  return diff > schedule.lateGraceMinutes ? diff : 0;
};

/**
 * دقائق التأخير للعرض والتصنيف: من جدول الدوام الثابت الحالي إن وُجد (المخزنة في السجل حُسبت بجدول وقت الحفظ
 * وقد يتغير الجدول بعدها)، وإلا المخزنة. "applies": يوم عمل غير عطلة رسمية.
 */
export const effectiveLateMinutes = (stored: unknown, checkIn: unknown, schedule: WorkSchedule | null | undefined, applies: boolean): number =>
  schedule && !schedule.flexible && schedule.periods.length
    ? (applies ? lateMinutesFor(checkIn, schedule) : 0)
    : Math.max(0, Math.round(Number(stored) || 0));

/** دقائق الخروج المبكر: قبل نهاية آخر فترة بأكثر من فترة السماح */
export const earlyLeaveMinutesFor = (checkOut: unknown, schedule: WorkSchedule | null | undefined): number => {
  if (!schedule || schedule.flexible || !schedule.periods.length) return 0;
  const actual = timeToMinutes(checkOut);
  const expected = timeToMinutes(schedule.periods[schedule.periods.length - 1].end);
  if (actual === null || expected === null) return 0;
  const diff = signedDiff(expected, actual);
  return diff > schedule.earlyLeaveGraceMinutes ? diff : 0;
};

/** أقصى مدة لحضور يعبر منتصف الليل (وردية ليلية)؛ أطول منها غالبًا خطأ في الوقتين. والخادم يقبل الانصراف من حضور أمس المفتوح خلالها */
export const MAX_SHIFT_MINUTES = 16 * 60;
/** نظام العمل (المادة 101): لا يعمل العامل أكثر من خمس ساعات متتالية دون فترة راحة لا تُحسب من ساعات العمل */
export const CONTINUOUS_WORK_MINUTES = 5 * 60;

/** "HH:MM" أو "HH:MM:SS" إلى ثوانٍ من منتصف الليل؛ null إن لم يكن وقتًا صحيحًا */
export const timeToSeconds = (value: unknown): number | null => {
  const match = TIME_PATTERN.exec(String(value ?? "").trim());
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0);
};

/** المدة بين الدخول والخروج بالثواني؛ الخروج قبل الدخول = حضور يعبر منتصف الليل */
export const attendanceSpanSeconds = (checkIn: unknown, checkOut: unknown): number => {
  const start = timeToSeconds(checkIn);
  const end = timeToSeconds(checkOut);
  if (start === null || end === null) return 0;
  return end >= start ? end - start : 86400 - start + end;
};

/**
 * ساعات العمل الفعلية بالثواني بين الدخول والخروج، بقاعدة الساعات المطلوبة نفسها (الفترات ناقص الاستراحة):
 * - الجدول الثابت متعدد الفترات (وردية مقسمة): الوقت الواقع بين فترتين لا يُحسب عملًا.
 * - استراحة الجدول الثابت: لا تُحسب عملًا متى تجاوز الحضور خمس ساعات (المادة 101)، وبما لا يُنزله عن خمس ساعات.
 * - الجدول المتغير ومن لا جدول له: المدة كما هي (كما كانت).
 */
export const workedSecondsFor = (checkIn: unknown, checkOut: unknown, schedule: WorkSchedule | null | undefined): number => {
  const span = attendanceSpanSeconds(checkIn, checkOut);
  if (!span || !schedule || schedule.flexible || !schedule.periods.length) return span;
  let unpaid = 0;
  if (schedule.periods.length > 1) {
    // الفترات على خط زمني يبدأ من بداية الفترة الأولى (فترة تعبر منتصف الليل تمتد لليوم التالي)
    const intervals: Array<[number, number]> = [];
    let cursor = (timeToMinutes(schedule.periods[0].start) ?? 0) * 60;
    schedule.periods.forEach((period) => {
      let start = (timeToMinutes(period.start) ?? 0) * 60;
      while (start < cursor) start += 86400;
      let end = (timeToMinutes(period.end) ?? 0) * 60;
      while (end <= start) end += 86400;
      intervals.push([start, end]);
      cursor = end;
    });
    // الدخول يُقرَن ببداية الدوام الأقرب إليه (لا يبعد عنها أكثر من 12 ساعة)
    const anchor = intervals[0][0];
    let from = timeToSeconds(checkIn) ?? anchor;
    if (from - anchor > 43200) from -= 86400;
    if (anchor - from > 43200) from += 86400;
    const to = from + span;
    for (let index = 1; index < intervals.length; index += 1) {
      const gapStart = intervals[index - 1][1];
      const gapEnd = intervals[index][0];
      unpaid += Math.max(0, Math.min(to, gapEnd) - Math.max(from, gapStart));
    }
  }
  const worked = Math.max(0, span - unpaid);
  const breakSeconds = Math.max(0, schedule.breakMinutes) * 60;
  return worked - Math.min(breakSeconds, Math.max(0, worked - CONTINUOUS_WORK_MINUTES * 60));
};

export type ScheduleDraft = {
  name: string;
  type: string;
  periods: SchedulePeriod[];
  workDays: number[];
  breakMinutes: number;
  lateGraceMinutes: number;
  earlyLeaveGraceMinutes: number;
  /** للجدول المتغير: عدد الساعات المطلوبة يوميًا بالدقائق */
  flexibleMinutes: number;
};

/** رسالة الخطأ الأولى في نموذج الجدول، أو null إن كان صحيحًا */
export const scheduleDraftError = (draft: ScheduleDraft): string | null => {
  if (!draft.name.trim()) return "اسم الجدول مطلوب";
  if (!draft.workDays.length) return "اختر يوم عمل واحدًا على الأقل";
  const flexible = draft.type.includes("متغير");
  if (flexible) {
    if (!(draft.flexibleMinutes > 0) || draft.flexibleMinutes > 24 * 60) return "حدد عدد ساعات العمل اليومية (أكثر من صفر وحتى 24 ساعة)";
    return null;
  }
  if (!draft.periods.length) return "أضف فترة دوام واحدة على الأقل";
  if (draft.periods.length > MAX_PERIODS) return `الحد الأقصى ${MAX_PERIODS} فترات`;
  for (const [index, period] of draft.periods.entries()) {
    if (timeToMinutes(period.start) === null || timeToMinutes(period.end) === null) return `أدخل وقتي البداية والنهاية للفترة ${index + 1}`;
    if (periodMinutes(period) === 0) return `بداية الفترة ${index + 1} تساوي نهايتها`;
  }
  // الفترات المتتالية لا تتداخل (تُقارن على خط زمني يبدأ من بداية الفترة الأولى)
  const first = timeToMinutes(draft.periods[0].start) ?? 0;
  let cursor = 0;
  for (const [index, period] of draft.periods.entries()) {
    const startOffset = ((timeToMinutes(period.start) ?? 0) - first + 1440) % 1440;
    if (index > 0 && startOffset < cursor) return `الفترة ${index + 1} تبدأ قبل نهاية الفترة السابقة`;
    cursor = startOffset + periodMinutes(period);
    if (cursor > 1440) return "مجموع الفترات يتجاوز 24 ساعة";
  }
  if (draft.breakMinutes < 0 || draft.breakMinutes >= computeDailyMinutes(draft.periods, 0)) return "الاستراحة يجب أن تكون أقل من مجموع الفترات";
  if (draft.lateGraceMinutes < 0 || draft.lateGraceMinutes > 240) return "فترة السماح للتأخير بين 0 و240 دقيقة";
  if (draft.earlyLeaveGraceMinutes < 0 || draft.earlyLeaveGraceMinutes > 240) return "فترة السماح للخروج المبكر بين 0 و240 دقيقة";
  return null;
};

/** يحمّل كل الجداول (الفعالة وغيرها: الموظف المرتبط بجدول معطّل يبقى يُحسب بإعداداته) مفهرسة بالاسم */
export async function loadWorkSchedules(): Promise<{ schedules: Map<string, WorkSchedule>; error: unknown | null }> {
  try {
    const { data, error } = await supabase.from("attendance_schedules").select("*").order("name").order("id");
    if (error) return { schedules: new Map(), error };
    const schedules = new Map<string, WorkSchedule>();
    (data ?? []).forEach((row) => {
      const schedule = parseSchedule(row as Record<string, unknown>);
      if (schedule.name && !schedules.has(schedule.name)) schedules.set(schedule.name, schedule);
    });
    return { schedules, error: null };
  } catch (error) {
    return { schedules: new Map(), error };
  }
}

export const scheduleForEmployee = (schedules: Map<string, WorkSchedule>, workSchedule: unknown): WorkSchedule | null =>
  schedules.get(String(workSchedule ?? "").trim()) ?? null;
