// تصنيف يوم الحضور لموظف — قاعدة واحدة يستخدمها حساب الدوام والتقرير الشهري وكشف الرواتب،
// حتى يكون عدد أيام الغياب في الكشف هو نفسه الظاهر في حساب الدوام.

export type DayCategory = "present" | "late" | "leave" | "absent" | "weekend" | "holiday" | "none";

export type DayRecord = { status: string; checkIn?: string; lateMinutes?: number };

export type DayContext = {
  date: string;
  record?: DayRecord;
  /** يوم عمل حسب جدول الموظف */
  workDay: boolean;
  /** عطلة رسمية تشمل الموظف */
  holiday: boolean;
  /** ضمن إجازة معتمدة */
  onLeave: boolean;
  hireDate: string;
  today: string;
  /** معفى من الحضور (attendance_exempt) */
  exempt: boolean;
  /** إعداد الرواتب "الراتب المكتسب حسب الحضور": يوم العمل الماضي بلا تسجيل يُعد غيابًا */
  countUnrecordedAsAbsent: boolean;
  /** دقائق التأخير المحسوبة من جدول الدوام (تُضاف إلى المسجلة في السجل) */
  computedLateMinutes?: number;
};

export type DayClassification = {
  category: DayCategory;
  /** يدخل في عدّ الحضور والغياب */
  counted: boolean;
  /** تُطلب فيه ساعات الدوام اليومية */
  requiresHours: boolean;
  /** غياب يُخصم من الراتب */
  deductibleAbsence: boolean;
  /** يوم عمل ماضٍ بلا أي تسجيل (للعلم عند إيقاف إعداد الراتب المكتسب) */
  unrecorded: boolean;
};

const ABSENT_WORDS = ["غائب", "غياب", "absent"];

/** حالة سجل الحضور: حاضر / متأخر / إجازة / غائب؛ الغياب يجب أن يكون مسجلًا صراحة */
export const recordCategory = (record: DayRecord, computedLateMinutes = 0): "present" | "late" | "leave" | "absent" => {
  const status = String(record.status ?? "").trim().toLowerCase();
  if (ABSENT_WORDS.some((word) => status.includes(word))) return "absent";
  if (status.includes("إجاز") || status.includes("اجاز") || status.includes("مأمورية") || status.includes("leave")) return "leave";
  if (Number(record.lateMinutes ?? 0) > 0 || computedLateMinutes > 0 || status.includes("متأخر") || status.includes("late")) return "late";
  // حاضر، عمل عن بعد، أو حالة غير معروفة لسجل موجود: لا يُعد غيابًا إلا إن سُجّل غيابًا صراحة
  return "present";
};

export const isHolidayStatus = (status: unknown) => String(status ?? "").includes("عطلة");

export const classifyAttendanceDay = (ctx: DayContext): DayClassification => {
  const future = ctx.date > ctx.today;
  const base: DayClassification = { category: "none", counted: false, requiresHours: false, deductibleAbsence: false, unrecorded: false };

  // سجل بلا حالة ولا وقت دخول لا يدل على شيء: يُعامل كيوم بلا تسجيل
  const record = ctx.record && (String(ctx.record.status ?? "").trim() || String(ctx.record.checkIn ?? "").trim()) ? ctx.record : undefined;

  if (record) {
    if (isHolidayStatus(record.status)) {
      return { ...base, category: ctx.workDay || String(record.status).includes("رسمية") ? "holiday" : "weekend" };
    }
    const category = recordCategory(record, ctx.computedLateMinutes ?? 0);
    // العمل في يوم راحة أو عطلة: يُعد حضورًا إن عمل، ولا يُطلب فيه دوام ولا يُخصم غياب
    if (!ctx.workDay || ctx.holiday) {
      const worked = category === "present" || category === "late";
      return { ...base, category: worked ? category : ctx.holiday ? "holiday" : "weekend", counted: !future && worked };
    }
    // سجل "غائب" في يوم إجازة معتمدة: الإجازة تغلب
    if (ctx.onLeave && category === "absent") return { ...base, category: "leave", counted: !future };
    if (ctx.hireDate && ctx.date < ctx.hireDate) return { ...base, category: "none" };
    return {
      ...base,
      category,
      counted: !future,
      requiresHours: !future && category !== "leave",
      deductibleAbsence: !future && category === "absent",
    };
  }

  if (!ctx.workDay) return { ...base, category: "weekend" };
  if (ctx.hireDate && ctx.date < ctx.hireDate) return base;
  if (ctx.holiday) return { ...base, category: "holiday" };
  if (ctx.onLeave) return { ...base, category: "leave", counted: !future };
  if (ctx.date >= ctx.today) return base;
  if (ctx.exempt) return base;
  if (ctx.countUnrecordedAsAbsent) {
    return { ...base, category: "absent", counted: true, requiresHours: true, deductibleAbsence: true, unrecorded: true };
  }
  return { ...base, unrecorded: true };
};
