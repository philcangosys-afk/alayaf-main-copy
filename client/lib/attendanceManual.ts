// التحضير اليدوي من شاشات الإدارة (حساب الدوام / التحضير الفردي والجماعي).
// القاعدة: بصمة الموظف الموثّقة جغرافيًا من بوابة الموظف لا تُستبدل أبدًا من هذه الشاشات.
import { supabase } from "@/lib/supabaseClient";
import { fetchAllRows } from "@/lib/fetchAll";
import { eachDate, riyadhToday } from "@/lib/hrDates";
import { isApprovedStatus } from "@/lib/hrStatus";
import { readUserSession } from "@/lib/authSession";
import { MAX_SHIFT_MINUTES, attendanceSpanSeconds, isScheduledWorkDay, type WorkSchedule } from "@/lib/workSchedule";

export const VERIFIED_ATTENDANCE_SOURCE = "employee_geolocation";
export const MANUAL_ATTENDANCE_SOURCE = "manager_manual";
/** الحالة الوحيدة المسموح تحضيرها لتاريخ مستقبلي */
export const FUTURE_ALLOWED_STATUS = "إجازة";

/**
 * سجل محمي من التعديل الإداري: بصمة من بوابة الموظف، أو سجل يحمل بصمة موثّقة جغرافيًا
 * (حضور أو انصراف بإحداثيات من البوابة، أو علامة "موثّق" في السجلات القديمة).
 * قاعدة البيانات تمنع تعديل ما سجّله الموظف بموقعه، وتسمح بإكمال الانصراف المنسي مع ملاحظة.
 */
export const isProtectedAttendance = (row: { entry_source?: unknown; location_verified?: unknown; check_in_latitude?: unknown; check_out_latitude?: unknown }) =>
  String(row.entry_source ?? "") === VERIFIED_ATTENDANCE_SOURCE || row.location_verified === true
  || (row.check_in_latitude !== null && row.check_in_latitude !== undefined)
  || (row.check_out_latitude !== null && row.check_out_latitude !== undefined);
/** مرشّح PostgREST: السجلات المحمية (للعدّ) */
export const PROTECTED_ATTENDANCE_FILTER = `entry_source.eq.${VERIFIED_ATTENDANCE_SOURCE},location_verified.is.true,check_in_latitude.not.is.null,check_out_latitude.not.is.null`;

export type ManualAttendanceRow = { emp_id: string; date: string } & Record<string, unknown>;
export type ManualAttendanceOptions = {
  /**
   * true: يُحدَّث السجل الموجود غير الموثّق (تعديل فردي صريح لموظف ويوم).
   * false (الافتراضي): تُدرج الأيام الناقصة فقط ولا يُمس أي سجل موجود (يدوي أو قديم أو موثّق).
   */
  overwriteExisting?: boolean;
};
export type ManualAttendanceResult = {
  /** السجلات التي حُفظت فعلًا (إنشاء أو تحديث) */
  saved: number;
  /** بصمات حضور موثّقة أُكمل انصرافها المنسي (ضمن saved) */
  completedCheckout: number;
  /** سجلات المستخدم نفسه: لا يسجّل حضوره بنفسه */
  skippedOwn: number;
  /** سجلات في شهر رواتبه معتمدة أو مرحّلة للموظف */
  skippedLocked: number;
  /** سجلات تُركت لأنها بصمة موثّقة من بوابة الموظف */
  skippedVerified: number;
  /** سجلات موجودة مسبقًا تُركت دون تعديل (التحضير المتعدد يضيف الأيام الناقصة فقط) */
  skippedExisting: number;
  /** سجلات تغيّرت أثناء الحفظ (غالبًا بصمة الموظف) فلم تُستبدل */
  skippedConcurrent: number;
  error: unknown | null;
};

const WRITE_CHUNK = 500;
const ID_CHUNK = 100;
const chunk = <T,>(items: T[], size: number): T[][] => {
  const parts: T[][] = [];
  for (let index = 0; index < items.length; index += size) parts.push(items.slice(index, index + size));
  return parts;
};
const rowKey = (empId: unknown, date: unknown) => `${String(empId ?? "")}:${String(date ?? "").slice(0, 10)}`;

/** أيام عمل الموظف في الفترة حسب جدول دوامه؛ من لا جدول له: الأحد إلى الخميس */
export const scheduleWorkDates = (from: string, to: string, schedule: WorkSchedule | null | undefined): string[] =>
  eachDate(from, to).filter((date) => isScheduledWorkDay(date, schedule));

/** أيام التحضير لموظف: يوم واحد يُقبل كما هو، والفترة متعددة الأيام تقتصر على أيام عمله حسب جدول دوامه */
export const manualAttendanceDatesFor = (from: string, to: string, schedule: WorkSchedule | null | undefined): string[] => {
  const dates = eachDate(from, to);
  return dates.length > 1 ? dates.filter((date) => isScheduledWorkDay(date, schedule)) : dates;
};

/** أيام التحضير بلا جدول دوام: يوم واحد يُقبل كما هو، والفترة متعددة الأيام تستثني الجمعة والسبت */
export const manualAttendanceDates = (from: string, to: string): string[] => manualAttendanceDatesFor(from, to, null);

/**
 * يعيد نص الخطأ (قبل الترجمة) أو null إن كانت الأوقات صحيحة.
 * الانصراف قبل الحضور = وردية ليلية تمتد لليوم التالي، وتُقبل ما لم تتجاوز 16 ساعة
 * (مثل حضور 09:00 وانصراف 08:30 = 23.5 ساعة، وهو غالبًا خطأ في الوقتين). ويُرفض تساوي الوقتين.
 */
export const manualAttendanceTimeError = (checkIn: string, checkOut: string, requireCheckIn: boolean): string | null => {
  if (requireCheckIn && !checkIn) return "حدد وقت الحضور";
  if (checkOut && !checkIn) return "لا يمكن تسجيل وقت الانصراف بدون وقت الحضور";
  if (checkIn && checkOut && checkOut.slice(0, 5) === checkIn.slice(0, 5)) return "وقت الانصراف لا يمكن أن يساوي وقت الحضور";
  if (checkIn && checkOut && checkOut.slice(0, 5) < checkIn.slice(0, 5) && attendanceSpanSeconds(checkIn, checkOut) > MAX_SHIFT_MINUTES * 60) {
    return "وقت الانصراف قبل وقت الحضور: يُقبل لوردية ليلية لا تتجاوز 16 ساعة فقط؛ راجع الوقتين";
  }
  return null;
};

/**
 * يفصل سجل المستخدم الحالي عن غيره: لا يسجّل المسؤول حضوره ولا يعدّله بنفسه (قاعدة البيانات ترفضه أيضًا).
 * الرقم الوظيفي قد يتكرر (EMP-030) فيُطابق الاسم معه إن توفر.
 */
export const splitOwnEmployees = <T extends { empId: string; name: string }>(list: T[]): { own: T[]; others: T[] } => {
  const session = readUserSession() as { empId?: unknown; name?: unknown } | null;
  const ownEmpId = String(session?.empId ?? "").trim();
  const ownName = String(session?.name ?? "").trim();
  const own = ownEmpId ? list.filter((employee) => employee.empId.trim() === ownEmpId && (!ownName || employee.name.trim() === ownName)) : [];
  return { own, others: list.filter((employee) => !own.includes(employee)) };
};
export const OWN_ATTENDANCE_NOTE = "لا تسجّل حضورك ولا تعدّله بنفسك؛ يسجّله لك مسؤول آخر";

/** الإجازة اليدوية لا تُخصم من رصيد الإجازات وتمنع احتساب اليوم غيابًا، فيُطلب سببها */
export const isManualLeaveStatus = (status: unknown) => String(status ?? "").trim() === FUTURE_ALLOWED_STATUS;
export const manualLeaveNoteError = (status: unknown, notes: unknown): string | null =>
  isManualLeaveStatus(status) && !String(notes ?? "").trim()
    ? "اكتب سبب الإجازة في الملاحظات: الإجازة المسجلة من هنا لا تُخصم من رصيد الإجازات ولا يُحتسب اليوم غيابًا (الإجازة المعتمدة من طلبات الإجازات تُستثنى تلقائيًا)"
    : null;

/** يعيد نص الخطأ (قبل الترجمة) إن كان التاريخ بعد اليوم (بتوقيت الرياض) والحالة ليست إجازة */
export const manualAttendanceFutureError = (lastDate: string, status: string): string | null =>
  String(lastDate ?? "").slice(0, 10) > riyadhToday() && String(status ?? "").trim() !== FUTURE_ALLOWED_STATUS
    ? "لا يمكن التحضير لتاريخ بعد اليوم إلا بحالة إجازة"
    : null;

/** الاستئذان: الساعات من تفاصيل الطلب (hours أو من/إلى) — القاعدة نفسها في حساب الدوام وبوابة الموظف */
export const permissionHoursFromDetails = (details: Record<string, unknown>) => {
  const hours = Number(details.hours);
  if (Number.isFinite(hours) && hours > 0) return hours;
  const toSeconds = (value: string) => {
    if (!value) return null;
    const [h, m, sec = "0"] = value.split(":");
    const total = Number(h) * 3600 + Number(m) * 60 + Number(sec);
    return Number.isFinite(total) ? total : null;
  };
  const start = toSeconds(String(details.from_time ?? details.from ?? ""));
  const end = toSeconds(String(details.to_time ?? details.to ?? ""));
  return start !== null && end !== null && end > start ? (end - start) / 3600 : 0;
};

/** ما يمنع الكتابة: أرقام المستخدم الوظيفية، و"الرقم|الشهر" للأشهر المقفلة (رواتبها معتمدة أو مرحّلة) */
export type AttendanceWriteBlocks = { own: Set<string>; locked: Set<string> };
const EMPTY_BLOCKS = (): AttendanceWriteBlocks => ({ own: new Set(), locked: new Set() });
export const lockedKey = (empId: unknown, date: unknown) => `${String(empId ?? "").trim()}|${String(date ?? "").slice(0, 7)}`;

/** يقرأ ما يمنع الكتابة من الخادم قبل الحفظ، حتى لا يُرفض أمر كامل بسبب سجل واحد؛ قاعدة بيانات بلا الدالة: لا موانع */
export async function loadAttendanceWriteBlocks(empIds: string[], from: string, to: string): Promise<{ blocks: AttendanceWriteBlocks; error: unknown | null }> {
  if (!empIds.length || !from || !to) return { blocks: EMPTY_BLOCKS(), error: null };
  try {
    const { data, error } = await supabase.rpc("get_attendance_write_blocks", { p_emp_ids: empIds, p_from: from, p_to: to });
    if (error) {
      const code = String((error as { code?: unknown }).code ?? "");
      return code === "PGRST202" || code === "42883" ? { blocks: EMPTY_BLOCKS(), error: null } : { blocks: EMPTY_BLOCKS(), error };
    }
    const payload = (data ?? {}) as { own?: unknown; locked?: unknown };
    const own = new Set((Array.isArray(payload.own) ? payload.own : []).map((value) => String(value ?? "").trim()).filter(Boolean));
    const locked = new Set((Array.isArray(payload.locked) ? payload.locked : []).map((item) => {
      const row = (item ?? {}) as Record<string, unknown>;
      return `${String(row.emp_id ?? "").trim()}|${String(row.month ?? "").slice(0, 7)}`;
    }));
    return { blocks: { own, locked }, error: null };
  } catch (error) {
    return { blocks: EMPTY_BLOCKS(), error };
  }
}

/**
 * يحفظ سجلات التحضير اليدوي دون المساس ببصمات الموظفين الموثّقة:
 * 1) يزيل تكرار (الموظف، التاريخ) داخل الدفعة (الأخير يغلب).
 * 2) يقرأ السجلات الموجودة للموظفين والفترة.
 * 3) يتخطى أي سجل محمي (entry_source = employee_geolocation أو location_verified = true).
 * 4) السجلات الجديدة تُدرج بـ ON CONFLICT DO NOTHING حتى لا تُستبدل بصمة سُجّلت أثناء الحفظ.
 * 5) السجلات الموجودة غير المحمية تُترك كما هي، إلا مع overwriteExisting فتُحدَّث بشرط أنها ما زالت غير موثّقة.
 * 6) سجلات المستخدم نفسه والأشهر المقفلة للموظف تُتخطى قبل الحفظ (قاعدة البيانات ترفضها، فلا يُرفض الأمر كله بسببها).
 * 7) مع overwriteExisting: بصمة حضور موثّقة بلا انصراف يُكمَل انصرافها فقط (مع الملاحظة)، ولا يُمس ما سجّله الموظف.
 * كل سجل يُكتب يحمل entry_source = manager_manual و location_verified = false.
 */
export async function saveManualAttendance(rows: ManualAttendanceRow[], options: ManualAttendanceOptions = {}): Promise<ManualAttendanceResult> {
  const result: ManualAttendanceResult = { saved: 0, completedCheckout: 0, skippedOwn: 0, skippedLocked: 0, skippedVerified: 0, skippedExisting: 0, skippedConcurrent: 0, error: null };
  // دفعة واحدة لا تحمل المفتاح (emp_id, date) مرتين: الأخير يغلب
  const allRows = [...new Map(rows.map((row) => [rowKey(row.emp_id, row.date), row] as const)).values()];
  if (!allRows.length) return result;
  // حماية إضافية: الصفحات تتحقق قبل الاستدعاء
  const futureRow = allRows.find((row) => manualAttendanceFutureError(String(row.date ?? ""), String(row.status ?? "")));
  if (futureRow) return { ...result, error: new Error(manualAttendanceFutureError(String(futureRow.date ?? ""), String(futureRow.status ?? "")) ?? "") };

  const allDates = allRows.map((row) => String(row.date).slice(0, 10)).sort();
  const { blocks, error: blocksError } = await loadAttendanceWriteBlocks([...new Set(allRows.map((row) => String(row.emp_id)))], allDates[0], allDates[allDates.length - 1]);
  if (blocksError) return { ...result, error: blocksError };
  const uniqueRows = allRows.filter((row) => {
    if (blocks.own.has(String(row.emp_id ?? "").trim())) { result.skippedOwn += 1; return false; }
    if (blocks.locked.has(lockedKey(row.emp_id, row.date))) { result.skippedLocked += 1; return false; }
    return true;
  });
  if (!uniqueRows.length) return result;

  const empIds = [...new Set(uniqueRows.map((row) => row.emp_id))];
  const dates = uniqueRows.map((row) => String(row.date).slice(0, 10)).sort();
  const from = dates[0];
  const to = dates[dates.length - 1];
  /** المفتاح ← هل السجل الموجود محمي، وهل بلا انصراف */
  const existing = new Map<string, { protected: boolean; noCheckOut: boolean; checkIn: string; notes: string }>();
  try {
    for (const ids of chunk(empIds, ID_CHUNK)) {
      const found = await fetchAllRows<{ emp_id: unknown; date: unknown; entry_source: unknown; location_verified: unknown; check_in: unknown; check_out: unknown; notes: unknown; check_in_latitude: unknown; check_out_latitude: unknown }>((start, end) => supabase
        .from("attendance")
        .select("emp_id, date, entry_source, location_verified, check_in, check_out, notes, check_in_latitude, check_out_latitude")
        .in("emp_id", ids)
        .gte("date", from)
        .lte("date", to)
        .order("date")
        .order("emp_id")
        .range(start, end));
      found.forEach((row) => existing.set(rowKey(row.emp_id, row.date), { protected: isProtectedAttendance(row), noCheckOut: !String(row.check_out ?? "").trim(), checkIn: String(row.check_in ?? "").trim(), notes: String(row.notes ?? "").trim() }));
    }
  } catch (error) {
    return { ...result, error };
  }

  const prepared: ManualAttendanceRow[] = uniqueRows.map((row) => ({ ...row, entry_source: MANUAL_ATTENDANCE_SOURCE, location_verified: false }));
  let invalidCompletion: string | null = null;
  const toInsert: typeof prepared = [];
  const toUpdate: typeof prepared = [];
  const toComplete: { row: ManualAttendanceRow; notes: string }[] = [];
  prepared.forEach((row) => {
    const found = existing.get(rowKey(row.emp_id, row.date));
    if (!found) toInsert.push(row);
    else if (found.protected) {
      // بصمة موثّقة بلا انصراف: يُكمَل الانصراف المنسي فقط عند التعديل الصريح
      if (options.overwriteExisting && found.noCheckOut && String(row.check_out ?? "").trim()) {
        // يُتحقق من الانصراف مقابل الدخول المسجل (لا الدخول المكتوب في النموذج، فهو لا يُحفظ)
        const timeError = manualAttendanceTimeError(found.checkIn, String(row.check_out ?? ""), false);
        if (timeError) { invalidCompletion = timeError; return; }
        // السبب يُضاف إلى الملاحظات القائمة (مثل الحالة السابقة التي حفظتها البوابة) ولا يحل محلها
        const reason = `إكمال انصراف منسي: ${String(row.notes ?? "").trim() || "من الإدارة"}`;
        toComplete.push({ row, notes: found.notes ? `${found.notes} — ${reason}` : reason });
      } else result.skippedVerified += 1;
    } else if (options.overwriteExisting) toUpdate.push(row);
    else result.skippedExisting += 1;
  });

  if (invalidCompletion) return { ...result, error: new Error(`${invalidCompletion} (مقارنة بوقت الحضور المسجل في البصمة)`) };

  for (const part of chunk(toInsert, WRITE_CHUNK)) {
    const { data, error } = await supabase.from("attendance").upsert(part, { onConflict: "company_id,emp_id,date", ignoreDuplicates: true }).select("id");
    if (error) return { ...result, error };
    const inserted = data?.length ?? 0;
    result.saved += inserted;
    result.skippedConcurrent += part.length - inserted;
  }
  // التحديث بشرط أن السجل ما زال غير موثّق؛ إن وثّقه الموظف أثناء الحفظ لا يُستبدل
  for (const row of toUpdate) {
    const { data, error } = await supabase
      .from("attendance")
      .update(row)
      .eq("emp_id", row.emp_id)
      .eq("date", row.date)
      .eq("location_verified", false)
      .is("check_in_latitude", null)
      .is("check_out_latitude", null)
      .or(`entry_source.is.null,entry_source.neq.${VERIFIED_ATTENDANCE_SOURCE}`)
      .select("id");
    if (error) return { ...result, error };
    const updated = data?.length ?? 0;
    result.saved += updated;
    if (!updated) result.skippedConcurrent += 1;
  }
  // إكمال الانصراف المنسي: الانصراف والملاحظة فقط (قاعدة البيانات تمنع تعديل ما سجّله الموظف وتطلب الملاحظة)
  for (const { row, notes } of toComplete) {
    const { data, error } = await supabase
      .from("attendance")
      .update({ check_out: row.check_out, notes, updated_at: row.updated_at ?? new Date().toISOString() })
      .eq("emp_id", row.emp_id)
      .eq("date", row.date)
      .or("check_out.is.null,check_out.eq.")
      .select("id");
    if (error) return { ...result, error };
    const updated = data?.length ?? 0;
    result.saved += updated;
    result.completedCheckout += updated;
    if (!updated) result.skippedConcurrent += 1;
  }
  return result;
}

/** رسالة عربية موحّدة لنتيجة الحفظ (تُمرَّر دالة الترجمة وتنسيق الأرقام من الصفحة) */
export const manualAttendanceResultText = (result: ManualAttendanceResult, t: (text: string) => string, formatNumber: (value: number) => string, savedSuffix = "") => {
  const parts = [`${t("تم حفظ")} ${formatNumber(result.saved)} ${t("سجل حضور")}${savedSuffix ? ` ${savedSuffix}` : ""}`];
  if (result.skippedExisting) parts.push(`${t("وتُرك")} ${formatNumber(result.skippedExisting)} ${t("سجل موجود مسبقًا دون تعديل")}`);
  if (result.completedCheckout) parts.push(`${t("منها")} ${formatNumber(result.completedCheckout)} ${t("بصمة موثّقة أُكمل انصرافها المنسي")}`);
  if (result.skippedVerified) parts.push(`${t("تم تخطي")} ${formatNumber(result.skippedVerified)} ${t("سجل بصمة موثّقة من بوابة الموظف دون تعديل")}`);
  if (result.skippedLocked) parts.push(`${t("وتُرك")} ${formatNumber(result.skippedLocked)} ${t("سجل في شهر رواتبه معتمدة أو مرحّلة")}`);
  if (result.skippedOwn) parts.push(`${t("وتُرك")} ${formatNumber(result.skippedOwn)} ${t("سجل لك أنت (يسجّله مسؤول آخر)")}`);
  if (result.skippedConcurrent) parts.push(`${t("وتُرك")} ${formatNumber(result.skippedConcurrent)} ${t("سجل تغيّر أثناء الحفظ دون استبدال")}`);
  return parts.join("، ");
};

// ───────────── أيام لا تُحتسب غيابًا: العطل الرسمية والإجازات المعتمدة ─────────────

/** عطلة رسمية من جدول official_holidays (الفرع/الإدارة/القسم فارغ = تنطبق على الجميع) */
export type OfficialHoliday = { start: string; end: string; branch: string; department: string; section: string };
/** أسماء نطاق الموظف المخزنة (بالعربية) لكل مستوى، لمطابقة نطاق العطلة */
export type HolidayScope = { branch: string[]; department: string[]; section: string[] };
export type ApprovedLeave = { employeeId: string; empId: string; start: string; end: string; leaveType: string };

const dateKey = (value: unknown) => String(value ?? "").slice(0, 10);
const spanEnd = (start: string, end: string) => (end && end >= start ? end : start);

/** يحمل العطل الرسمية المتقاطعة مع الفترة؛ عند الخطأ تُعاد قائمة فارغة مع الخطأ (لا يتوقف التقرير) */
export async function loadOfficialHolidays(from: string, to: string): Promise<{ holidays: OfficialHoliday[]; error: unknown | null }> {
  try {
    const { data, error } = await supabase
      .from("official_holidays")
      .select("start_date, end_date, branch, department, section, team")
      .lte("start_date", to)
      .or(`end_date.gte.${from},end_date.is.null`);
    if (error) return { holidays: [], error };
    const holidays = (data ?? [])
      .map((row: Record<string, unknown>) => {
        const start = dateKey(row.start_date);
        return { start, end: spanEnd(start, dateKey(row.end_date)), branch: String(row.branch ?? "").trim(), department: String(row.department ?? "").trim(), section: String(row.section ?? "").trim(), team: String(row.team ?? "").trim() };
      })
      // عطلة فريق عمل: لا يوجد في سجل الموظف ما يطابق الفريق، فلا تُطبَّق على أحد (مثل لوحة الموارد البشرية)
      .filter((holiday) => holiday.start && !holiday.team && holiday.end >= from && holiday.start <= to)
      .map(({ team: _team, ...holiday }) => holiday);
    return { holidays, error: null };
  } catch (error) {
    return { holidays: [], error };
  }
}

/** يحمل الإجازات المعتمدة المتقاطعة مع الفترة لكل الموظفين،
 * ومعها أرقام كل الموظفين (النشطين وغير النشطين) لمعرفة الأرقام المكررة عند النسب بالرقم */
export async function loadApprovedLeaves(from: string, to: string): Promise<{ leaves: ApprovedLeave[]; codeOwners: { id: string; empId: string }[] | null; error: unknown | null }> {
  try {
    const owners = await fetchAllRows<Record<string, unknown>>((start, end) => supabase
      .from("employees")
      .select("id, emp_id")
      .order("id")
      .range(start, end));
    const codeOwners = owners.map((row) => ({ id: String(row.id ?? ""), empId: String(row.emp_id ?? "").trim() }));
    const rows = await fetchAllRows<Record<string, unknown>>((start, end) => supabase
      .from("leave_requests")
      .select("id, emp_id, employee_id, start_date, end_date, status, leave_type")
      .lte("start_date", to)
      .or(`end_date.gte.${from},end_date.is.null`)
      .order("start_date")
      .order("id")
      .range(start, end));
    const leaves = rows
      .filter((row) => isApprovedStatus(row.status) && row.start_date)
      .map((row) => {
        const start = dateKey(row.start_date);
        return { employeeId: String(row.employee_id ?? "").trim(), empId: String(row.emp_id ?? "").trim(), start, end: spanEnd(start, dateKey(row.end_date)), leaveType: String(row.leave_type ?? "").trim() };
      })
      .filter((leave) => leave.end >= from && leave.start <= to);
    return { leaves, codeOwners, error: null };
  } catch (error) {
    return { leaves: [], codeOwners: null, error };
  }
}

const scopeMatches = (value: string, names: string[]) => !value || names.some((name) => String(name ?? "").trim() === value);

/** أيام العطل الرسمية التي تنطبق على نطاق موظف داخل الفترة */
export const officialHolidayDates = (holidays: OfficialHoliday[], scope: HolidayScope, from: string, to: string): Set<string> => {
  const dates = new Set<string>();
  holidays.forEach((holiday) => {
    if (!scopeMatches(holiday.branch, scope.branch) || !scopeMatches(holiday.department, scope.department) || !scopeMatches(holiday.section, scope.section)) return;
    eachDate(holiday.start > from ? holiday.start : from, holiday.end < to ? holiday.end : to).forEach((date) => dates.add(date));
  });
  return dates;
};

/** أسماء الفروع والإدارات والأقسام العربية المخزنة (بالمعرّف)، لمطابقة نطاق العطلة */
export type StoredOrgNames = { branch: Map<string, string>; department: Map<string, string>; section: Map<string, string> };

/** نطاق الموظف لمطابقة العطل الرسمية: الأسماء العربية المخزنة لفرعه وإدارته وقسمه، أو نصوص ملفه */
export const employeeHolidayScope = (row: Record<string, unknown>, names: StoredOrgNames): HolidayScope => ({
  branch: [names.branch.get(String(row.branch_id ?? "")) ?? "", String(row.branch ?? "")],
  department: [names.department.get(String(row.department_id ?? "")) ?? "", String(row.directorate ?? ""), String(row.department ?? "")],
  section: [names.section.get(String(row.section_id ?? "")) ?? "", String(row.department ?? "")],
});

/**
 * أيام العطل الرسمية والإجازات المعتمدة لكل موظف (بمعرّفه) في الفترة.
 * إن تعذر تحميل العطل أو الإجازات يُعاد الخطأ ولا تُعاد أيام، حتى لا يُحفظ تحضير دون معرفتها.
 */
export async function loadOffDates(
  employees: { id: string; empId: string; scope: HolidayScope }[],
  from: string,
  to: string,
): Promise<{ offDates: Map<string, Set<string>>; error: unknown | null }> {
  const [holidayResult, leaveResult] = await Promise.all([loadOfficialHolidays(from, to), loadApprovedLeaves(from, to)]);
  const error = holidayResult.error ?? leaveResult.error;
  if (error) return { offDates: new Map(), error };
  const leaves = approvedLeaveDatesByEmployee(leaveResult.leaves, employees, from, to, leaveResult.codeOwners);
  const offDates = new Map<string, Set<string>>();
  employees.forEach((employee) => {
    const off = officialHolidayDates(holidayResult.holidays, employee.scope, from, to);
    leaves.get(employee.id)?.forEach((date) => off.add(date));
    offDates.set(employee.id, off);
  });
  return { offDates, error: null };
}

/**
 * أيام الإجازات المعتمدة لكل موظف (بمعرّف الموظف uuid) داخل الفترة.
 * المطابقة بـ employee_id أولًا؛ وإن لم يُسجَّل فبالرقم الوظيفي فقط إن كان لموظف واحد
 * (توجد أرقام وظيفية مكررة مثل EMP-030 فلا تُنسب الإجازة لغير صاحبها).
 */
export const approvedLeaveDatesByEmployee = (
  leaves: ApprovedLeave[],
  employees: { id: string; empId: string }[],
  from: string,
  to: string,
  // كل الموظفين (وليس النشطين فقط) حتى لا يُنسب رقم مكرر لموظف نشط وهو لغيره
  codeOwners?: { id: string; empId: string }[] | null,
): Map<string, Set<string>> => {
  const ids = new Set(employees.map((employee) => employee.id));
  const idsByCode = new Map<string, string[]>();
  (codeOwners && codeOwners.length ? codeOwners : employees).forEach((employee) => {
    const code = employee.empId.trim();
    if (code) idsByCode.set(code, [...(idsByCode.get(code) ?? []), employee.id]);
  });
  const result = new Map<string, Set<string>>();
  leaves.forEach((leave) => {
    let owner = "";
    if (leave.employeeId) owner = ids.has(leave.employeeId) ? leave.employeeId : "";
    else {
      const matches = idsByCode.get(leave.empId) ?? [];
      if (matches.length === 1 && ids.has(matches[0])) owner = matches[0];
    }
    if (!owner) return;
    const dates = result.get(owner) ?? new Set<string>();
    eachDate(leave.start > from ? leave.start : from, leave.end < to ? leave.end : to).forEach((date) => dates.add(date));
    result.set(owner, dates);
  });
  return result;
};
