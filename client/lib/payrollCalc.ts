// حساب الراتب الموحد: يستخدمه "كشف الرواتب" و"التقرير الشامل" وإرسال طلب الاعتماد، فتظهر الأرقام نفسها في كل مكان.
// الغياب يُحسب بقاعدة حساب الدوام نفسها (attendanceRules) وبجدول دوام الموظف (workSchedule)،
// ويُخصم حسب "إعدادات حساب الراتب" المحفوظة (hr_settings / payroll_settings).
import { supabase } from "@/lib/supabaseClient";
import { fetchAllRows } from "@/lib/fetchAll";
import { eachDate, monthRange, riyadhToday } from "@/lib/hrDates";
import { isApprovedStatus } from "@/lib/hrStatus";
import { advanceInstallmentDue, allocateAdvanceRepayments, isCancelledPayrollStatus, parseApprovedAdvance, type AdvanceRecord } from "@/lib/advances";
import { GOSI_EMPLOYEE_RATE_SAUDI, gosiContributionWage, gosiDeductsFromEmployee, gosiSaudiRates, isHousingAllowance } from "@/lib/gosi";
import { classifyAttendanceDay, type DayCategory, type DayRecord } from "@/lib/attendanceRules";
import { effectiveLateMinutes, isScheduledWorkDay, loadWorkSchedules, scheduleForEmployee, type WorkSchedule } from "@/lib/workSchedule";
import { approvedLeaveDatesByEmployee, loadApprovedLeaves, loadOfficialHolidays, officialHolidayDates, type HolidayScope } from "@/lib/attendanceManual";

export const SOCIAL_INSURANCE_RATE = GOSI_EMPLOYEE_RATE_SAUDI;
export const PAYROLL_SETTINGS_KEY = "payroll_settings";
/** حالات صف الرواتب التي ما زالت مفتوحة للتعديل وإعادة الإرسال */
export const OPEN_PAYROLL_STATUSES = ["معلق", "مرفوض", "موقوف"];

export const round2 = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

// ---------------------------------------------------------------------------
// الإعدادات
// ---------------------------------------------------------------------------
export type PayrollPolicy = {
  /** أساس قيمة يوم الغياب: الأساسي فقط، أو الأساسي + البدلات */
  absenceBasis: "basic" | "basic_allowances";
  /** قاسم قيمة اليوم: 30 ثابت أو أيام الشهر الفعلية */
  dayDivisor: "fixed30" | "actual";
  excludeAdvances: boolean;
  /** الراتب المكتسب حسب الحضور: يوم العمل الماضي بلا تسجيل يُعد غيابًا */
  countUnrecordedAsAbsent: boolean;
  /** اتباع حقل التأمينات في ملف الموظف: السعودي المسجّل "لا" لا يُخصم منه (الافتراضي: يُخصم من كل سعودي كما كان) */
  gosiFollowEmployeeFlag: boolean;
  /** أجر الاشتراك = الأساسي + بدل السكن (نظام التأمينات)؛ الافتراضي الأساسي فقط كما كان، حتى يطابق الأجر المسجّل في التأمينات */
  gosiIncludeHousing: boolean;
};

export const DEFAULT_PAYROLL_POLICY: PayrollPolicy = {
  absenceBasis: "basic_allowances",
  dayDivisor: "fixed30",
  excludeAdvances: false,
  countUnrecordedAsAbsent: false,
  gosiFollowEmployeeFlag: false,
  gosiIncludeHousing: false,
};

/** من قيم صفحة "إعدادات حساب الراتب" إلى سياسة الحساب */
export const payrollPolicyFromSettings = (settings: Record<string, unknown> | null | undefined): PayrollPolicy => {
  if (!settings || typeof settings !== "object") return { ...DEFAULT_PAYROLL_POLICY };
  const absenceCalc = String(settings.absenceCalc ?? "");
  const monthDays = String(settings.monthDaysMethod ?? "");
  return {
    absenceBasis: absenceCalc === "basic" ? "basic" : absenceCalc ? "basic_allowances" : DEFAULT_PAYROLL_POLICY.absenceBasis,
    dayDivisor: monthDays.includes("الفعلي") ? "actual" : "fixed30",
    excludeAdvances: settings.excludeAdvances === true,
    // مفتاح جديد عمدًا: القيمة القديمة earnedSalary حُفظت سابقًا "نعم" افتراضيًا ولم تكن مطبّقة،
    // فلا تُفعَّل إلا إذا اختارها مسؤول الرواتب من جديد بعد هذا الإصدار
    countUnrecordedAsAbsent: settings.earnedSalaryApplied === true,
    gosiFollowEmployeeFlag: settings.gosiFollowEmployeeFlag === true,
    gosiIncludeHousing: settings.gosiIncludeHousing === true,
  };
};

/** يقرأ إعدادات الرواتب؛ عند التعذر يعيد الافتراضي مع الخطأ */
export async function loadPayrollPolicy(): Promise<{ policy: PayrollPolicy; error: unknown | null }> {
  try {
    const { data, error } = await supabase.from("hr_settings").select("setting_value").eq("setting_key", PAYROLL_SETTINGS_KEY).maybeSingle();
    if (error) return { policy: { ...DEFAULT_PAYROLL_POLICY }, error };
    return { policy: payrollPolicyFromSettings((data?.setting_value ?? null) as Record<string, unknown> | null), error: null };
  } catch (error) {
    return { policy: { ...DEFAULT_PAYROLL_POLICY }, error };
  }
}

// ---------------------------------------------------------------------------
// البدلات
// ---------------------------------------------------------------------------
type AllowanceItem = { amount?: unknown; value?: unknown; effect?: unknown; from?: unknown; to?: unknown };

/** البدلات السارية في أي يوم من الفترة: المضافة والمخصومة (نفس قاعدة الراتب الإجمالي في ملف الموظف) */
export const allowancesForPeriod = (items: unknown, from: string, to: string): { added: number; deducted: number; housing: number } => {
  const list = Array.isArray(items) ? (items as AllowanceItem[]) : [];
  let added = 0;
  let deducted = 0;
  let housing = 0;
  list.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const start = String(item.from ?? "").slice(0, 10);
    const end = String(item.to ?? "").slice(0, 10);
    if (start && start > to) return;
    if (end && end < from) return;
    const amount = Number(item.amount ?? item.value ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) return;
    if (String(item.effect ?? "").trim() === "مخصوم") deducted += amount;
    else {
      added += amount;
      if (isHousingAllowance((item as { type?: unknown }).type)) housing += amount;
    }
  });
  return { added: round2(added), deducted: round2(deducted), housing: round2(housing) };
};

// ---------------------------------------------------------------------------
// سطر الراتب لموظف واحد (دالة صافية)
// ---------------------------------------------------------------------------
export type PayrollEmployeeInput = {
  id: string;
  empId: string;
  baseSalary: number;
  nationality: string;
  allowances: unknown;
  hireDate: string;
  dailyHours: number;
  attendanceExempt: boolean;
  schedule: WorkSchedule | null;
  /** مشمول بالتأمينات (نعم/لا؛ الفارغ = مشمول) ونوعه (سعودي قابل/غير قابل للخصم) */
  socialInsurance?: string;
  socialInsuranceType?: string;
};

export type PayrollAttendanceRecord = DayRecord & { date: string };

export type PayrollLineInput = {
  employee: PayrollEmployeeInput;
  period: string;
  today: string;
  attendance: PayrollAttendanceRecord[];
  holidays: Set<string>;
  /** أيام الإجازات المعتمدة المدفوعة بالكامل */
  leaveDates: Set<string>;
  /** أيام الإجازات المعتمدة بدون راتب (يُخصم اليوم كاملًا) */
  unpaidLeaveDates?: Set<string>;
  /**
   * أيام الإجازات المعتمدة بأجر ناقص أو بلا أجر: التاريخ ← نسبة ما يُخصم من قيمة اليوم (0 إلى 1).
   * مثل المرضية حسب المادة 117 (0 ثم 0.25 ثم 1)، أو نوع إجازة له "نسبة خصم".
   */
  leaveDeductionFactors?: Map<string, number>;
  /** الجزاءات المعتمدة المستحقة حتى نهاية الشهر ولم تُخصم بعد (يُخصم منها حتى سقف المادة 72) */
  penalties: number;
  overtime: { hours: number; amount: number };
  advanceInstallment: number;
  policy: PayrollPolicy;
};

/** تصنيف كل يوم في الشهر كما حسبه الكشف (لتقرير الموظف الكامل وغيره) */
export type PayrollDay = {
  date: string;
  category: DayCategory;
  deductibleAbsence: boolean;
  unrecorded: boolean;
  workDay: boolean;
  holiday: boolean;
  beforeHire: boolean;
  /** نسبة خصم الإجازة في هذا اليوم (0 مدفوعة، 1 بدون راتب) */
  leaveCut: number;
  status: string;
};

export type PayrollLine = {
  days: PayrollDay[];
  workDays: number;
  presentDays: number;
  absentDays: number;
  unrecordedDays: number;
  leaveDays: number;
  holidayDays: number;
  /** أيام الإجازة المخصومة (موزونة بنسبة الخصم: يوم مرضي بثلاثة أرباع الأجر = 0.25) بالأيام التقويمية */
  unpaidLeaveDays: number;
  /** لم يُستحق أي يوم في فترة خدمته من الشهر (غياب أو إجازة بدون راتب في كل أيام العمل): يُخصم أجر الفترة كاملًا */
  fullPeriodUnearned: boolean;
  /** أيام الشهر قبل تاريخ التعيين (لا يُستحق عنها راتب) */
  notEmployedDays: number;
  /** نسبة استحقاق الشهر (1 = شهر كامل؛ أقل للمعيَّن خلال الشهر) */
  employedFactor: number;
  /** الأساسي والبدلات الشهرية الكاملة قبل التناسب */
  fullBasic: number;
  fullAllowances: number;
  /** الأساسي المستحق (بعد تناسب أيام الخدمة للمعيَّن خلال الشهر) */
  basic: number;
  /** البدلات المستحقة (بعد التناسب) */
  allowances: number;
  overtimeHours: number;
  overtime: number;
  grossEarnings: number;
  dailyRate: number;
  absenceDeduction: number;
  /** خصم الإجازات بدون راتب أو بأجر ناقص */
  unpaidLeaveDeduction: number;
  /** ما لم يُستحق من الأساسي والبدلات لأيام ما قبل التعيين (تخفيض للاستحقاق وليس استقطاعًا) */
  proratedReduction: number;
  socialInsurance: number;
  /** نسبة حصة الموظف في التأمينات المطبّقة (0 إن لم يُخصم) */
  socialInsuranceRate: number;
  penalties: number;
  /** الجزاءات المستحقة قبل السقف، وسقف المادة 72 (أجر 5 أيام)، وما يُرحَّل للشهر التالي */
  penaltiesOutstanding: number;
  penaltyCap: number;
  penaltiesCarried: number;
  /** قسط السلف المستحق قبل الحدود، والمخصوم فعلًا */
  loansDue: number;
  loans: number;
  /** حد المادة 93 (نصف الأجر المستحق) وما خُفّض بسببه من السلف والجزاءات (يبقى مستحقًا للأشهر التالية) */
  halfWageCap: number;
  halfWageReduction: number;
  allowanceDeductions: number;
  totalDeductions: number;
  net: number;
  /** ما خُفّض من الاستقطاعات حتى لا يكون الصافي سالبًا */
  cappedDeductions: number;
};

/**
 * نسبة استحقاق الشهر للمعيَّن خلاله:
 * - أيام الشهر الفعلية: أيام الخدمة ÷ أيام الشهر.
 * - قاسم 30: تُطرح أيام ما قبل التعيين بواقع 1/30 لكل يوم (مثل يوم الغياب)، ولا تقل عن يوم واحد لمن خدم يومًا.
 * من لم يبدأ خدمته في الشهر (تعيينه بعد نهايته) نسبته صفر.
 */
export const employedFactor = (policy: PayrollPolicy, monthDays: number, notEmployedDays: number) => {
  if (notEmployedDays <= 0) return 1;
  const employedDays = Math.max(0, monthDays - notEmployedDays);
  if (employedDays === 0) return 0;
  if (policy.dayDivisor === "actual") return employedDays / monthDays;
  return Math.min(1, Math.max(1 / 30, 1 - notEmployedDays / 30));
};

export const computePayrollLine = (input: PayrollLineInput): PayrollLine => {
  const { employee, period, today, policy } = input;
  const { from, to } = monthRange(period);
  const recordsByDate = new Map<string, PayrollAttendanceRecord>();
  input.attendance.forEach((record) => {
    const date = String(record.date ?? "").slice(0, 10);
    // عند تكرار اليوم (غير متوقع) يُقدَّم السجل الذي فيه حضور
    const existing = recordsByDate.get(date);
    if (!existing || (!existing.checkIn && record.checkIn)) recordsByDate.set(date, record);
  });

  let workDays = 0;
  let presentDays = 0;
  let absentDays = 0;
  let unrecordedDays = 0;
  let leaveDays = 0;
  let holidayDays = 0;
  let unpaidLeaveDays = 0;
  let unpaidLeaveWorkDays = 0;
  let notEmployedDays = 0;
  let earnedAnyDay = false;
  const days: PayrollDay[] = [];
  const leaveFactors = new Map<string, number>(input.leaveDeductionFactors ?? []);
  (input.unpaidLeaveDates ?? new Set<string>()).forEach((date) => leaveFactors.set(date, 1));
  eachDate(from, to).forEach((date) => {
    const workDay = isScheduledWorkDay(date, employee.schedule);
    const holiday = input.holidays.has(date);
    const beforeHire = Boolean(employee.hireDate) && date < employee.hireDate;
    if (beforeHire) notEmployedDays += 1;
    if (workDay && !beforeHire) {
      if (holiday) holidayDays += 1;
      else workDays += 1;
    }
    // إن تداخلت إجازة مدفوعة مع غيرها في اليوم نفسه فالمدفوعة أولى (لا خصم عند الشك)
    const leaveCut = input.leaveDates.has(date) ? 0 : Math.min(1, Math.max(0, leaveFactors.get(date) ?? 0));
    const onLeave = input.leaveDates.has(date) || leaveFactors.has(date);
    const record = recordsByDate.get(date);
    // التأخير من جدول الدوام الحالي في أيام العمل (كما في حساب الدوام)؛ لا يؤثر في أي مبلغ
    const lateMinutes = record ? effectiveLateMinutes(record.lateMinutes, record.checkIn, employee.schedule, workDay && !holiday) : 0;
    const day = classifyAttendanceDay({
      date,
      record: record ? { ...record, lateMinutes } : undefined,
      workDay,
      holiday,
      onLeave,
      hireDate: employee.hireDate,
      today,
      exempt: employee.attendanceExempt,
      countUnrecordedAsAbsent: policy.countUnrecordedAsAbsent,
      computedLateMinutes: lateMinutes,
    });
    const attended = day.category === "present" || day.category === "late";
    days.push({ date, category: beforeHire ? "none" : day.category, deductibleAbsence: day.deductibleAbsence, unrecorded: day.unrecorded, workDay, holiday, beforeHire, leaveCut: onLeave && !attended ? leaveCut : 0, status: String(record?.status ?? "") });
    if (day.deductibleAbsence) absentDays += 1;
    else if (day.counted && attended && workDay && !holiday) presentDays += 1;
    if (attended && !beforeHire) earnedAnyDay = true;
    // الإجازة بدون راتب أو بأجر ناقص تُخصم بالأيام التقويمية (عقد العمل موقوف خلالها؛ المادة 116)،
    // حتى المستقبلية في الشهر لأنها معتمدة، إلا يومًا سُجّل فيه حضور فعلي (قطع الإجازة أو عاد مبكرًا)
    if (onLeave && !beforeHire && !attended) {
      if (leaveCut > 0) {
        unpaidLeaveDays += leaveCut;
        if (leaveCut >= 1 && workDay && !holiday) unpaidLeaveWorkDays += 1;
      }
      if (leaveCut < 1) earnedAnyDay = true;
    }
    if (day.category === "leave" && workDay && !holiday && leaveCut < 1) leaveDays += 1;
    if (day.unrecorded && !day.deductibleAbsence) unrecordedDays += 1;
  });

  const fullBasic = round2(Math.max(0, Number(employee.baseSalary) || 0));
  const { added: fullAllowances, deducted: fullAllowanceDeductions, housing: fullHousing } = allowancesForPeriod(employee.allowances, from, to);
  const monthDays = Number(to.slice(8, 10));
  const factor = employedFactor(policy, monthDays, notEmployedDays);
  // المعيَّن خلال الشهر يستحق نصيب أيام خدمته من الأساسي والبدلات؛ يُخفَّض الاستحقاق نفسه
  // (لا يُسجَّل استقطاعًا)، فيبقى مصروف الرواتب في القيد مساويًا لما استُحق فعلًا
  const basic = round2(fullBasic * factor);
  const allowances = round2(fullAllowances * factor);
  const proratedReduction = round2(fullBasic + fullAllowances - basic - allowances);
  const overtime = round2(Math.max(0, input.overtime.amount));
  const grossEarnings = round2(basic + allowances + overtime);

  const divisor = policy.dayDivisor === "actual" ? monthDays : 30;
  // قيمة اليوم من الراتب الشهري الكامل (لا من المستحق بعد التناسب)
  const rateBase = policy.absenceBasis === "basic" ? fullBasic : fullBasic + fullAllowances;
  const dailyRate = round2(rateBase / divisor);
  let absenceDeduction = round2((rateBase / divisor) * absentDays);
  // الإجازة بدون راتب توقف عقد العمل (المادة 116)، فلا يُستحق عنها الأساسي ولا البدلات أيًّا كان أساس قيمة يوم الغياب
  const wageBase = fullBasic + fullAllowances;
  let unpaidLeaveDeduction = round2((wageBase / divisor) * unpaidLeaveDays);
  // لا يتجاوز خصم الغياب أساسه، ولا الغياب والإجازات معًا أجر فترة الخدمة (شهر 31 يومًا بقاسم 30 مثلًا)
  const maxAbsence = round2(rateBase * factor);
  const maxUnearned = round2(wageBase * factor);
  // لم يعمل يومًا ولم يكن في إجازة مدفوعة: كل أيام عمله غياب أو إجازة بدون راتب، فلا أجر للفترة
  // (لا أساسي ولا بدلات؛ أيام الراحة والعطل تابعة لأيام العمل ولا تُستحق وحدها)
  const fullPeriodUnearned = factor > 0 && workDays > 0 && !earnedAnyDay && absentDays + unpaidLeaveWorkDays >= workDays;
  if (fullPeriodUnearned) {
    if (absentDays === 0) {
      unpaidLeaveDeduction = maxUnearned;
      absenceDeduction = 0;
    } else {
      unpaidLeaveDeduction = Math.min(unpaidLeaveDeduction, maxUnearned);
      absenceDeduction = round2(maxUnearned - unpaidLeaveDeduction);
    }
  } else {
    absenceDeduction = Math.min(absenceDeduction, maxAbsence);
    if (absenceDeduction + unpaidLeaveDeduction > maxUnearned) {
      let over = round2(absenceDeduction + unpaidLeaveDeduction - maxUnearned);
      const cutAbsence = Math.min(absenceDeduction, over);
      absenceDeduction = round2(absenceDeduction - cutAbsence);
      over = round2(over - cutAbsence);
      unpaidLeaveDeduction = round2(unpaidLeaveDeduction - Math.min(unpaidLeaveDeduction, over));
    }
  }
  // التأمينات: حصة الموظف السعودي (9.75%، أو نسبة النظام الجديد حسب الشهر) من أجر الاشتراك
  // (الأساسي، أو الأساسي + بدل السكن بإعداد الرواتب؛ بحد 45,000) بنسبة أيام الخدمة
  const socialInsuranceRate = gosiDeductsFromEmployee(employee.nationality, employee.socialInsurance, employee.socialInsuranceType, policy.gosiFollowEmployeeFlag)
    ? gosiSaudiRates(employee.socialInsuranceType, period).employee
    : 0;
  let socialInsurance = round2(gosiContributionWage(fullBasic, policy.gosiIncludeHousing ? fullHousing : 0) * factor * socialInsuranceRate);
  // المادة 72: لا يُقتطع للغرامات أكثر من أجر خمسة أيام في الشهر؛ والباقي يُخصم في الأشهر التالية
  const penaltiesOutstanding = round2(Math.max(0, input.penalties));
  const penaltyCap = round2(((fullBasic + fullAllowances) / 30) * 5);
  let penalties = round2(Math.min(penaltiesOutstanding, penaltyCap));
  let loans = policy.excludeAdvances ? 0 : round2(Math.max(0, input.advanceInstallment));
  let allowanceDeductions = round2(fullAllowanceDeductions * factor);
  // المادة 93: لا تزيد المبالغ المحسومة (التأمينات والبدلات المخصومة والجزاءات والسلف) على نصف الأجر المستحق
  // (الاستحقاقات بعد الغياب والإجازة بدون راتب). يُخفَّض قسط السلفة أولًا ثم الجزاء، والمخفَّض يبقى مستحقًا للأشهر التالية
  const earnedWage = round2(Math.max(0, grossEarnings - absenceDeduction - unpaidLeaveDeduction));
  const halfWageCap = round2(earnedWage / 2);
  let halfWageReduction = 0;
  if (round2(socialInsurance + allowanceDeductions + penalties + loans) > halfWageCap) {
    let over = round2(socialInsurance + allowanceDeductions + penalties + loans - halfWageCap);
    const cutLoans = Math.min(loans, over);
    loans = round2(loans - cutLoans);
    over = round2(over - cutLoans);
    const cutPenalties = Math.min(penalties, over);
    penalties = round2(penalties - cutPenalties);
    halfWageReduction = round2(cutLoans + cutPenalties);
  }

  // لا صافي سالب: تُخفَّض الاستقطاعات بالترتيب (السلف، الجزاءات، البدلات المخصومة، الغياب، الإجازة بدون راتب، التأمينات)
  // حتى تساوي إجمالي الاستحقاقات؛ فيبقى: الاستحقاقات − الاستقطاعات = الصافي (شرط الترحيل المحاسبي)
  let total = round2(absenceDeduction + unpaidLeaveDeduction + socialInsurance + penalties + loans + allowanceDeductions);
  let cappedDeductions = 0;
  if (total > grossEarnings) {
    let excess = round2(total - grossEarnings);
    cappedDeductions = excess;
    const reduce = (value: number) => {
      const cut = Math.min(value, excess);
      excess = round2(excess - cut);
      return round2(value - cut);
    };
    loans = reduce(loans);
    penalties = reduce(penalties);
    allowanceDeductions = reduce(allowanceDeductions);
    absenceDeduction = reduce(absenceDeduction);
    unpaidLeaveDeduction = reduce(unpaidLeaveDeduction);
    socialInsurance = reduce(socialInsurance);
    total = round2(absenceDeduction + unpaidLeaveDeduction + socialInsurance + penalties + loans + allowanceDeductions);
  }
  const net = round2(grossEarnings - total);

  return {
    days,
    workDays,
    presentDays,
    absentDays,
    unrecordedDays,
    leaveDays,
    holidayDays,
    unpaidLeaveDays: round2(unpaidLeaveDays),
    fullPeriodUnearned,
    notEmployedDays,
    employedFactor: factor,
    fullBasic,
    fullAllowances,
    basic,
    allowances,
    overtimeHours: round2(Math.max(0, input.overtime.hours)),
    overtime,
    grossEarnings,
    dailyRate,
    absenceDeduction,
    unpaidLeaveDeduction,
    proratedReduction,
    socialInsurance,
    socialInsuranceRate,
    penalties,
    penaltiesOutstanding,
    penaltyCap,
    penaltiesCarried: round2(penaltiesOutstanding - penalties),
    loansDue: round2(policy.excludeAdvances ? 0 : Math.max(0, input.advanceInstallment)),
    loans,
    halfWageCap,
    halfWageReduction,
    allowanceDeductions,
    totalDeductions: total,
    net,
    cappedDeductions,
  };
};

/** نص الملاحظات المحفوظ مع صف الرواتب (يقرؤه المعتمد في تفاصيل الطلب) */
export const payrollLineNotes = (line: PayrollLine): string => {
  const parts = [`أيام العمل ${line.workDays}`, `حضور ${line.presentDays}`, `غياب ${line.absentDays}`];
  if (line.absentDays) parts.push(`خصم الغياب ${line.absenceDeduction.toFixed(2)}`);
  if (line.unrecordedDays) parts.push(`أيام بلا تسجيل ${line.unrecordedDays} (لم تُخصم)`);
  if (line.leaveDays) parts.push(`إجازة ${line.leaveDays}`);
  if (line.unpaidLeaveDays) parts.push(`إجازة بدون راتب أو بأجر ناقص ${line.unpaidLeaveDays} يوم (خصم ${line.unpaidLeaveDeduction.toFixed(2)})`);
  if (line.fullPeriodUnearned) parts.push("لم يعمل أي يوم في الفترة: خُصم أجرها كاملًا");
  if (line.fullPeriodUnearned && line.socialInsurance > 0) parts.push(`حصة الموظف في التأمينات ${line.socialInsurance.toFixed(2)} تتحملها المنشأة لعدم وجود أجر`);
  if (line.notEmployedDays) parts.push(`قبل التعيين ${line.notEmployedDays} يوم (المستحق ${line.basic.toFixed(2)} أساسي + ${line.allowances.toFixed(2)} بدلات من ${line.fullBasic.toFixed(2)} + ${line.fullAllowances.toFixed(2)})`);
  if (line.penalties) parts.push(`جزاءات ${line.penalties.toFixed(2)}`);
  if (line.penaltiesCarried > 0) parts.push(`جزاءات متبقية تُخصم في الأشهر التالية ${line.penaltiesCarried.toFixed(2)} (لا يُخصم في الشهر أكثر من أجر 5 أيام ${line.penaltyCap.toFixed(2)} — المادة 72)`);
  if (line.loans) parts.push(`سلف ${line.loans.toFixed(2)}`);
  if (line.loansDue > line.loans) parts.push(`لم يُخصم من قسط السلف ${(line.loansDue - line.loans).toFixed(2)}؛ يبقى في رصيد السلفة ويمتد السداد`);
  if (line.halfWageReduction) parts.push(`خُفّضت السلف والجزاءات ${line.halfWageReduction.toFixed(2)} حتى لا يتجاوز المحسوم نصف الأجر المستحق (المادة 93: ${line.halfWageCap.toFixed(2)})`);
  if (line.allowanceDeductions) parts.push(`بدلات مخصومة ${line.allowanceDeductions.toFixed(2)}`);
  if (line.overtime) parts.push(`إضافي ${line.overtime.toFixed(2)}`);
  if (line.cappedDeductions) parts.push(`خُفّضت الاستقطاعات ${line.cappedDeductions.toFixed(2)} حتى لا يكون الصافي سالبًا`);
  return parts.join(" - ");
};

// ---------------------------------------------------------------------------
// التحميل من قاعدة البيانات وحساب مجموعة موظفين
// ---------------------------------------------------------------------------
export type PayrollEmployeeRow = {
  id: string;
  empId: string;
  name: string;
  nationality: string;
  baseSalary: number;
  departmentName: string;
  sectionName: string;
  branchName: string;
  workSchedule: string;
  scheduleName: string | null;
};

export type PayrollComputation = {
  period: string;
  policy: PayrollPolicy;
  employees: Map<string, PayrollEmployeeRow>;
  lines: Map<string, PayrollLine>;
  /** تنبيهات لا توقف العرض (مثل موظف مرتبط بجدول غير موجود) */
  warnings: string[];
  /** مدخلات تعذر تحميلها: يُعرض الكشف تقديريًا، ولا يُحفظ ولا يُرسل للاعتماد */
  loadErrors: string[];
  /** موظفون تاريخ تعيينهم بعد نهاية الشهر (بمعرّفاتهم → الرقم الوظيفي): لا سطر ولا صف جديد لهم */
  notStarted: Map<string, string>;
  /** تاريخ "اليوم" الذي حُسب عليه الكشف (الأيام بعده لا تُعد): يُحفظ مع طلب الاعتماد ليتحقق المعتمد بالتاريخ نفسه */
  computedOn: string;
};

/** قيمة "مدفوعة" في نوع الإجازة تساوي لا */
const isUnpaidFlag = (value: unknown) => value === false || ["لا", "false", "no", "0", "f"].includes(String(value ?? "").trim().toLowerCase());
/** اسم نوع الإجازة يدل على أنها بدون راتب */
export const isUnpaidLeaveName = (name: string) => /(بدون|بلا)\s*(راتب|أجر|اجر)|غير\s*مدفوع|unpaid/i.test(String(name ?? ""));
/** الإجازة المرضية (لا إصابة العمل، فلها أحكامها) */
export const isSickLeaveName = (name: string) => {
  const text = String(name ?? "");
  return /مرض|sick/i.test(text) && !/إصاب|اصاب|injur/i.test(text);
};

const nextYearKey = (date: string) => `${Number(date.slice(0, 4)) + 1}${date.slice(4, 10)}`;

/**
 * نسبة الخصم لكل يوم إجازة مرضية حسب المادة 117 من نظام العمل:
 * خلال السنة التي تبدأ من أول يوم إجازة مرضية: 30 يومًا بأجر كامل، ثم 60 يومًا بثلاثة أرباع الأجر،
 * ثم 30 يومًا بلا أجر (وما زاد بلا أجر). الأيام تقويمية، متصلة أو متقطعة.
 */
export const sickLeaveDeductionFactors = (sickDates: Iterable<string>): Map<string, number> => {
  const result = new Map<string, number>();
  let windowEnd = "";
  let index = 0;
  [...new Set(sickDates)].sort().forEach((date) => {
    if (!windowEnd || date >= windowEnd) {
      windowEnd = nextYearKey(date);
      index = 0;
    }
    index += 1;
    result.set(date, index <= 30 ? 0 : index <= 90 ? 0.25 : 1);
  });
  return result;
};

/** قاعدة أجر نوع الإجازة: cut = نسبة ما يُخصم من اليوم، sick = تُحسب بالمادة 117 */
export type LeavePayRule = { cut: number; sick: boolean };
export const leavePayRuleFor = (leaveType: string, typeRow: Record<string, unknown> | undefined): LeavePayRule => {
  const name = String(leaveType ?? "").trim();
  if ((typeRow && (isUnpaidFlag(typeRow.is_paid) || isUnpaidFlag(typeRow.paid))) || isUnpaidLeaveName(name)) return { cut: 1, sick: false };
  if (isSickLeaveName(name)) return { cut: 0, sick: true };
  const percent = Number(typeRow?.deduction_percent ?? 0);
  if (Number.isFinite(percent) && percent > 0) return { cut: Math.min(1, percent / 100), sick: false };
  return { cut: 0, sick: false };
};

/** بداية سجل الإجازات المرضية المقروء (لتحديد سنة المادة 117 بدقة) */
const LEAVE_HISTORY_FROM = "2000-01-01";

const ID_CHUNK = 100;
const chunk = <T,>(items: T[]) => Array.from({ length: Math.ceil(items.length / ID_CHUNK) }, (_, index) => items.slice(index * ID_CHUNK, (index + 1) * ID_CHUNK));
const errorCode = (error: unknown) => String((error as { code?: unknown } | null)?.code ?? "");

const EMPLOYEE_COLUMNS = "id, emp_id, name, nationality, base_salary, allowances, hire_date, daily_hours, work_schedule, branch, branch_id, directorate, department, department_id, section_id, social_insurance, social_insurance_type";

async function loadEmployees(ids: string[]): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (const part of chunk(ids)) {
    let result = await supabase.from("employees").select(`${EMPLOYEE_COLUMNS}, attendance_exempt`).in("id", part);
    // عمود الإعفاء من الحضور قد لا يكون موجودًا في بعض النسخ
    if (result.error && errorCode(result.error) === "42703") result = await supabase.from("employees").select(EMPLOYEE_COLUMNS).in("id", part);
    if (result.error) throw result.error;
    rows.push(...((result.data ?? []) as Record<string, unknown>[]));
  }
  return rows;
}

/** يحسب رواتب الفترة لموظفين محددين (بمعرّفاتهم). أخطاء الحضور والجزاءات والإضافي توقف الحساب؛ لا يُعرض راتب ناقص بصمت. */
export async function computePayroll(employeeIds: string[], period: string, options: { today?: string } = {}): Promise<PayrollComputation> {
  const { from, to } = monthRange(period);
  // اليوم بتوقيت الرياض، أو يوم إرسال طلب الاعتماد عند تحقق المعتمد منه
  const today = /^\d{4}-\d{2}-\d{2}$/.test(String(options.today ?? "")) ? String(options.today) : riyadhToday();
  const warnings: string[] = [];
  const loadErrors: string[] = [];
  const ids = [...new Set(employeeIds.filter(Boolean))];

  const [employeeRows, policyResult, scheduleResult, holidayResult, leaveResult, branchResult, departmentResult, sectionResult, leaveTypeResult] = await Promise.all([
    loadEmployees(ids),
    loadPayrollPolicy(),
    loadWorkSchedules(),
    loadOfficialHolidays(from, to),
    loadApprovedLeaves(LEAVE_HISTORY_FROM, to),
    supabase.from("branches").select("id, name"),
    supabase.from("departments").select("id, name"),
    supabase.from("org_sections").select("id, name"),
    supabase.from("leave_types").select("*"),
  ]);
  if (policyResult.error) loadErrors.push("تعذر قراءة إعدادات حساب الراتب");
  if (scheduleResult.error) loadErrors.push("تعذر تحميل جداول الدوام");
  if (holidayResult.error) loadErrors.push("تعذر تحميل العطل الرسمية");
  if (leaveResult.error) loadErrors.push("تعذر تحميل الإجازات المعتمدة");
  if (leaveTypeResult.error) loadErrors.push("تعذر تحميل تصنيفات الإجازات (أجر كل نوع)");
  const policy = policyResult.policy;

  // أجر كل نوع إجازة من "تصنيفات الإجازات": مدفوعة = لا ← بلا أجر، نسبة الخصم ← أجر ناقص،
  // والمرضية بالمادة 117. وإن تعذر تحميل الأنواع فمن الاسم فقط
  const leaveTypeRows = new Map<string, Record<string, unknown>>();
  ((leaveTypeResult.error ? [] : leaveTypeResult.data) ?? []).forEach((row: Record<string, unknown>) => {
    const name = String(row.name ?? "").trim();
    if (name && !leaveTypeRows.has(name)) leaveTypeRows.set(name, row);
  });
  const ruleCache = new Map<string, LeavePayRule>();
  const ruleOf = (leaveType: string) => {
    const name = leaveType.trim();
    if (!ruleCache.has(name)) ruleCache.set(name, leavePayRuleFor(name, leaveTypeRows.get(name)));
    return ruleCache.get(name)!;
  };

  const names = (result: { data: unknown[] | null; error: unknown }) =>
    new Map(((result.error ? [] : result.data) ?? []).map((row) => [String((row as Record<string, unknown>).id), String((row as Record<string, unknown>).name ?? "").trim()]));
  const branchNames = names(branchResult);
  const departmentNames = names(departmentResult);
  const sectionNames = names(sectionResult);

  const codes = [...new Set(employeeRows.map((row) => String(row.emp_id ?? "").trim()).filter(Boolean))];
  const attendanceByCode = new Map<string, PayrollAttendanceRecord[]>();
  for (const part of chunk(codes)) {
    const rows = await fetchAllRows<Record<string, unknown>>((start, end) => supabase
      .from("attendance")
      .select("id, emp_id, date, status, check_in, late_minutes")
      .in("emp_id", part)
      .gte("date", from)
      .lte("date", to)
      .order("date")
      .order("id")
      .range(start, end));
    rows.forEach((row) => {
      const code = String(row.emp_id ?? "").trim();
      const list = attendanceByCode.get(code) ?? [];
      list.push({ date: String(row.date ?? "").slice(0, 10), status: String(row.status ?? ""), checkIn: String(row.check_in ?? ""), lateMinutes: Number(row.late_minutes ?? 0) });
      attendanceByCode.set(code, list);
    });
  }

  // ما خُصم من الجزاءات والسلف في صفوف الأشهر الأخرى (قبل هذا الشهر وبعده، بأي حالة إلا الملغى):
  // صف معلق أو مرفوض قد يُعاد إرساله بالمبلغ نفسه، وحساب الأشهر بغير ترتيبها لا يكرر الخصم.
  // إن خُصم مبلغ في شهر لاحق فإعادة حساب شهر سابق تخصم أقل، ويُستكمل الباقي في الشهر المفتوح التالي.
  const penaltiesDeductedOther = new Map<string, number>();
  const advanceDeductionsOther = new Map<string, Map<string, number>>();
  // عمود penalty_deduction يضيفه HR-7؛ قبله تُقرأ السلف فقط (لا جزاءات مخصومة سابقًا)
  let historyColumns = "id, emp_id, month, status, penalty_deduction, advance_deduction";
  for (const part of chunk(codes)) {
    const page = (columns: string) => fetchAllRows<Record<string, unknown>>((start, end) => supabase
      .from("payroll")
      .select(columns)
      .in("emp_id", part)
      .neq("month", period)
      .order("month")
      .order("id")
      .range(start, end) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown }>);
    let rows: Record<string, unknown>[];
    try {
      rows = await page(historyColumns);
    } catch (historyError) {
      if (errorCode(historyError) !== "42703" || !historyColumns.includes("penalty_deduction")) throw historyError;
      historyColumns = "id, emp_id, month, status, advance_deduction";
      rows = await page(historyColumns);
    }
    rows.forEach((row) => {
      if (isCancelledPayrollStatus(row.status)) return;
      const code = String(row.emp_id ?? "").trim();
      const month = String(row.month ?? "").slice(0, 7);
      penaltiesDeductedOther.set(code, round2((penaltiesDeductedOther.get(code) ?? 0) + (Number(row.penalty_deduction) || 0)));
      const advance = Number(row.advance_deduction) || 0;
      if (advance > 0 && month) {
        const months = advanceDeductionsOther.get(code) ?? new Map<string, number>();
        months.set(month, round2((months.get(month) ?? 0) + advance));
        advanceDeductionsOther.set(code, months);
      }
    });
  }
  const codeById = new Map(employeeRows.map((row) => [String(row.id), String(row.emp_id ?? "").trim()] as [string, string]));

  const penaltiesById = new Map<string, number>();
  const overtimeById = new Map<string, { hours: number; amount: number }>();
  const advancesById = new Map<string, number>();
  for (const part of chunk(ids)) {
    const [penaltyRows, overtimeResult, advanceResult] = await Promise.all([
      // كل الجزاءات حتى نهاية الشهر: المعتمد منها فقط يُخصم، والمتبقي بعد سقف المادة 72 يُرحَّل
      fetchAllRows<Record<string, unknown>>((start, end) => supabase
        .from("penalties")
        .select("id, employee_id, amount, date, status")
        .lte("date", to)
        .in("employee_id", part)
        .order("date")
        .order("id")
        .range(start, end)),
      // سجلات يومية قد تتجاوز 1000 صف لمئة موظف في شهر: تُجلب على دفعات
      fetchAllRows<Record<string, unknown>>((start, end) => supabase
        .from("overtime_records")
        .select("id, employee_id, hours, amount, status, date")
        .gte("date", from)
        .lte("date", to)
        .in("employee_id", part)
        .order("date")
        .order("id")
        .range(start, end)),
      fetchAllRows<Record<string, unknown>>((start, end) => supabase
        .from("hr_advances")
        .select("*")
        .in("employee_id", part)
        .order("id")
        .range(start, end))
        .then((data) => ({ data, error: null as unknown }), (error: unknown) => ({ data: [] as Record<string, unknown>[], error })),
    ]);
    const approvedPenalties = new Map<string, number>();
    penaltyRows.forEach((row) => {
      // لا يُخصم جزاء معلق أو مرفوض أو ملغى أو بلا قرار
      if (!isApprovedStatus(row.status)) return;
      const id = String(row.employee_id ?? "");
      approvedPenalties.set(id, (approvedPenalties.get(id) ?? 0) + Math.max(0, Number(row.amount) || 0));
    });
    approvedPenalties.forEach((total, id) => {
      const already = penaltiesDeductedOther.get(codeById.get(id) ?? "") ?? 0;
      const outstanding = round2(Math.max(0, total - already));
      if (outstanding > 0) penaltiesById.set(id, outstanding);
    });
    overtimeResult.forEach((row: Record<string, unknown>) => {
      // الإضافي المعتمد فقط (المعلق ينتظر قرار من يعتمده)
      if (!isApprovedStatus(row.status)) return;
      const id = String(row.employee_id ?? "");
      const current = overtimeById.get(id) ?? { hours: 0, amount: 0 };
      current.hours += Number(row.hours) || 0;
      current.amount += Number(row.amount) || 0;
      overtimeById.set(id, current);
    });
    if (advanceResult.error) {
      if (["42P01", "42703"].includes(errorCode(advanceResult.error))) warnings.push("جدول السلف غير متاح؛ لم تُخصم سلف");
      else throw advanceResult.error;
    } else {
      // السلف المعتمدة: المسدَّد من كل سلفة يُعاد توزيعه شهرًا بشهر من أقساط الأشهر الأخرى (lib/advances)،
      // والمستحق هذا الشهر لكل سلفة بدأت فيه أو قبله = الأقل من قسطها ومتبقيها
      const advancesByEmployee = new Map<string, AdvanceRecord[]>();
      (advanceResult.data ?? []).forEach((row: Record<string, unknown>) => {
        const advance = parseApprovedAdvance(row);
        if (!advance) return;
        advancesByEmployee.set(advance.employeeId, [...(advancesByEmployee.get(advance.employeeId) ?? []), advance]);
      });
      advancesByEmployee.forEach((list, id) => {
        const repaid = allocateAdvanceRepayments(list, advanceDeductionsOther.get(codeById.get(id) ?? "") ?? new Map());
        const due = advanceInstallmentDue(list, repaid, period);
        if (due > 0) advancesById.set(id, due);
      });
    }
  }

  const leaveEmployees = employeeRows.map((row) => ({ id: String(row.id), empId: String(row.emp_id ?? "").trim() }));
  const periodLeaves = leaveResult.leaves.filter((leave) => leave.end >= from && leave.start <= to);
  // مدفوعة بالكامل
  const leaveDates = approvedLeaveDatesByEmployee(periodLeaves.filter((leave) => { const rule = ruleOf(leave.leaveType); return !rule.sick && rule.cut === 0; }), leaveEmployees, from, to, leaveResult.codeOwners);
  // بلا أجر أو بأجر ناقص (نسبة خصم النوع): التاريخ ← النسبة، وعند التداخل الأقل خصمًا
  const leaveFactors = new Map<string, Map<string, number>>();
  const setFactor = (id: string, date: string, cut: number) => {
    const dates = leaveFactors.get(id) ?? new Map<string, number>();
    dates.set(date, Math.min(cut, dates.get(date) ?? cut));
    leaveFactors.set(id, dates);
  };
  const cutGroups = new Map<number, typeof periodLeaves>();
  periodLeaves.forEach((leave) => {
    const rule = ruleOf(leave.leaveType);
    if (rule.sick || rule.cut === 0) return;
    cutGroups.set(rule.cut, [...(cutGroups.get(rule.cut) ?? []), leave]);
  });
  cutGroups.forEach((leaves, cut) => {
    approvedLeaveDatesByEmployee(leaves, leaveEmployees, from, to, leaveResult.codeOwners)
      .forEach((dates, id) => dates.forEach((date) => setFactor(id, date, cut)));
  });
  // المرضية: كل سجلها حتى نهاية الشهر لتحديد موضع كل يوم في سنة المادة 117
  const sickHistory = approvedLeaveDatesByEmployee(leaveResult.leaves.filter((leave) => ruleOf(leave.leaveType).sick), leaveEmployees, LEAVE_HISTORY_FROM, to, leaveResult.codeOwners);
  sickHistory.forEach((dates, id) => {
    sickLeaveDeductionFactors(dates).forEach((cut, date) => {
      if (date >= from && date <= to) setFactor(id, date, cut);
    });
  });

  const employees = new Map<string, PayrollEmployeeRow>();
  const lines = new Map<string, PayrollLine>();
  const notStarted = new Map<string, string>();
  employeeRows.forEach((row) => {
    const id = String(row.id);
    const empId = String(row.emp_id ?? "").trim();
    // تاريخ تعيينه بعد نهاية الشهر: لا راتب ولا صف رواتب جديد لهذه الفترة
    if (String(row.hire_date ?? "").slice(0, 10) > to) {
      notStarted.set(id, empId);
      return;
    }
    const schedule = scheduleForEmployee(scheduleResult.schedules, row.work_schedule);
    const scope: HolidayScope = {
      branch: [branchNames.get(String(row.branch_id ?? "")) ?? "", String(row.branch ?? "")],
      department: [departmentNames.get(String(row.department_id ?? "")) ?? "", String(row.directorate ?? ""), String(row.department ?? "")],
      section: [sectionNames.get(String(row.section_id ?? "")) ?? "", String(row.department ?? "")],
    };
    const line = computePayrollLine({
      employee: {
        id,
        empId,
        baseSalary: Number(row.base_salary ?? 0),
        nationality: String(row.nationality ?? ""),
        allowances: row.allowances,
        hireDate: String(row.hire_date ?? "").slice(0, 10),
        dailyHours: Number(row.daily_hours ?? 8),
        attendanceExempt: row.attendance_exempt === true,
        schedule,
        socialInsurance: String(row.social_insurance ?? ""),
        socialInsuranceType: String(row.social_insurance_type ?? ""),
      },
      period,
      today,
      attendance: attendanceByCode.get(empId) ?? [],
      holidays: officialHolidayDates(holidayResult.holidays, scope, from, to),
      leaveDates: leaveDates.get(id) ?? new Set<string>(),
      leaveDeductionFactors: leaveFactors.get(id) ?? new Map<string, number>(),
      penalties: penaltiesById.get(id) ?? 0,
      overtime: overtimeById.get(id) ?? { hours: 0, amount: 0 },
      advanceInstallment: advancesById.get(id) ?? 0,
      policy,
    });
    lines.set(id, line);
    employees.set(id, {
      id,
      empId,
      name: String(row.name ?? ""),
      nationality: String(row.nationality ?? ""),
      baseSalary: Number(row.base_salary ?? 0),
      departmentName: departmentNames.get(String(row.department_id ?? "")) || String(row.directorate ?? ""),
      sectionName: sectionNames.get(String(row.section_id ?? "")) || String(row.department ?? ""),
      branchName: branchNames.get(String(row.branch_id ?? "")) || String(row.branch ?? ""),
      workSchedule: String(row.work_schedule ?? ""),
      scheduleName: schedule?.name ?? null,
    });
  });
  const missingSchedules = [...employees.values()].filter((employee) => employee.workSchedule.trim() && !employee.scheduleName).length;
  if (notStarted.size) warnings.push(`${notStarted.size} موظف تاريخ تعيينه بعد نهاية الشهر؛ لم يُحسب له راتب في هذه الفترة`);
  if (missingSchedules) warnings.push(`${missingSchedules} موظف مرتبط بجدول دوام غير موجود؛ اعتُبرت أيام عملهم من الأحد إلى الخميس`);

  return { period, policy, employees, lines, warnings, loadErrors, notStarted, computedOn: today };
}

// ---------------------------------------------------------------------------
// حفظ صفوف الرواتب قبل إرسال طلب الاعتماد
// ---------------------------------------------------------------------------
export const payrollRowValues = (line: PayrollLine, employee: PayrollEmployeeRow) => ({
  emp_name: employee.name,
  department: employee.sectionName || employee.departmentName,
  basic_salary: line.basic,
  // عمود allowances في الرواتب = البدلات + الإضافي (كما كان)، فيبقى: الأساسي + البدلات − الاستقطاعات = الصافي
  allowances: round2(line.allowances + line.overtime),
  social_insurance_deduction: line.socialInsurance,
  social_insurance_rate: line.socialInsurance > 0 ? line.socialInsuranceRate : 0,
  nationality_snapshot: employee.nationality,
  deductions: line.totalDeductions,
  // تفصيل للترحيل المحاسبي: الغياب والإجازات غير المدفوعة والبدلات المخصومة تخفّض مصروف الرواتب
  // (لم يُستحق أجرها)، والسلف تُسدِّد حساب سلف الموظفين؛ والجزاءات التزام في حساب الاستقطاعات
  expense_reduction: round2(line.absenceDeduction + line.unpaidLeaveDeduction + line.allowanceDeductions),
  advance_deduction: line.loans,
  penalty_deduction: line.penalties,
  net_salary: line.net,
  notes: payrollLineNotes(line),
});

/** قيم صف رواتب لموظف لم يبدأ خدمته في الشهر (صف قديم أُنشئ قبل هذا الإصدار) */
const NOT_STARTED_ROW_VALUES = {
  basic_salary: 0,
  allowances: 0,
  social_insurance_deduction: 0,
  social_insurance_rate: 0,
  deductions: 0,
  expense_reduction: 0,
  advance_deduction: 0,
  penalty_deduction: 0,
  net_salary: 0,
  notes: "تاريخ التعيين بعد نهاية الشهر؛ لا راتب لهذه الفترة",
};

/**
 * يُنشئ صفوف الرواتب الناقصة، ويحدّث قيم الصفوف المفتوحة (معلق/مرفوض/موقوف وغير المرحّلة) بالحساب الحالي،
 * فلا يبقى صف قديم بلا خصم غياب سُجّل بعد إنشائه. المعتمد والمرحّل والمدفوع لا يُمس.
 * الموظف الذي تعيينه بعد نهاية الشهر: لا يُنشأ له صف، وصفه المفتوح القديم (إن وُجد) يُصفَّر ويُعاد في zeroed
 * ليدخل طلب الاعتماد (وإلا بقي معلقًا ومنع ترحيل الشهر).
 */
export async function savePayrollRows(computation: PayrollComputation, employeeIds: string[], stoppedIds: Set<string>) {
  // لا تُحفظ أرقام حُسبت بمدخلات ناقصة (إعدادات أو جداول أو عطل أو إجازات تعذر تحميلها)
  if (computation.loadErrors.length) throw new Error(`PAYROLL_INPUTS_INCOMPLETE: ${computation.loadErrors.join(" | ")}`);
  const targets = employeeIds.filter((id) => computation.lines.has(id) && computation.employees.has(id));
  const codes = targets.map((id) => computation.employees.get(id)!.empId).filter(Boolean);
  const notStartedCodes = [...new Set(employeeIds.map((id) => computation.notStarted?.get(id) ?? "").filter(Boolean))];
  const existing = new Map<string, { status: string; accountingStatus: string }[]>();
  for (const part of chunk(codes)) {
    const { data, error } = await supabase.from("payroll").select("emp_id, status, accounting_status").eq("month", computation.period).in("emp_id", part);
    if (error) throw error;
    (data ?? []).forEach((row: Record<string, unknown>) => {
      const code = String(row.emp_id ?? "");
      existing.set(code, [...(existing.get(code) ?? []), { status: String(row.status ?? "معلق"), accountingStatus: String(row.accounting_status ?? "") }]);
    });
  }

  const inserts: Record<string, unknown>[] = [];
  const updates: { code: string; values: Record<string, unknown> }[] = [];
  let locked = 0;
  targets.forEach((id) => {
    const employee = computation.employees.get(id)!;
    const line = computation.lines.get(id)!;
    if (!employee.empId) return;
    const values = payrollRowValues(line, employee);
    const rows = existing.get(employee.empId);
    if (!rows) {
      inserts.push({ ...values, emp_id: employee.empId, month: computation.period, status: stoppedIds.has(id) ? "موقوف" : "معلق" });
      return;
    }
    if (rows.some((row) => OPEN_PAYROLL_STATUSES.includes(row.status) && row.accountingStatus !== "posted")) updates.push({ code: employee.empId, values });
    else locked += 1;
  });

  if (inserts.length) {
    for (const part of chunk(inserts)) {
      const { error } = await supabase.from("payroll").insert(part);
      // مستخدم آخر أنشأ صفوف الشهر في اللحظة نفسها
      if (error && errorCode(error) === "23505") throw new Error("PAYROLL_ROWS_CHANGED");
      if (error) throw error;
    }
  }
  let updated = 0;
  for (const update of updates) {
    const { data, error } = await supabase
      .from("payroll")
      .update(update.values)
      .eq("month", computation.period)
      .eq("emp_id", update.code)
      .in("status", OPEN_PAYROLL_STATUSES)
      .neq("accounting_status", "posted")
      .select("emp_id");
    if (error) throw error;
    updated += (data ?? []).length ? 1 : 0;
  }
  const zeroed: string[] = [];
  for (const part of chunk(notStartedCodes)) {
    const { data, error } = await supabase
      .from("payroll")
      .update(NOT_STARTED_ROW_VALUES)
      .eq("month", computation.period)
      .in("emp_id", part)
      .in("status", OPEN_PAYROLL_STATUSES)
      .neq("accounting_status", "posted")
      .select("emp_id");
    if (error) throw error;
    (data ?? []).forEach((row: Record<string, unknown>) => {
      const code = String(row.emp_id ?? "").trim();
      if (code && !zeroed.includes(code)) zeroed.push(code);
    });
  }
  return { inserted: inserts.length, updated, locked, zeroed };
}
