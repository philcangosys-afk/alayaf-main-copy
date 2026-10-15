import { useEffect, useMemo, useRef, useState } from "react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabaseClient";
import { canManagePerm, readUserSession } from "@/lib/authSession";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import { CheckCheck, Clock3, Loader2, MapPin, Navigation, Search, Users, X } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { daysInclusive, riyadhToday } from "@/lib/hrDates";
import { hrRequestErrorText } from "@/lib/hrErrors";
import { OWN_ATTENDANCE_NOTE, employeeHolidayScope, isManualLeaveStatus, loadAttendanceWriteBlocks, loadOffDates, manualAttendanceDatesFor, manualAttendanceFutureError, manualAttendanceResultText, manualAttendanceTimeError, manualLeaveNoteError, saveManualAttendance, splitOwnEmployees, type HolidayScope } from "@/lib/attendanceManual";
import { loadWorkSchedules, scheduleForEmployee, type WorkSchedule } from "@/lib/workSchedule";

type Employee = { id: string; empId: string; name: string; branchId: string; branch: string; departmentId: string; department: string; sectionId: string; section: string; workLocationId: string; workLocation: string; workSchedule: string; attendanceLocationId: string; attendanceDepartment: string | null;
  /** جدول دوام الموظف (attendance_schedules بالاسم)؛ null = الأحد إلى الخميس */
  schedule: WorkSchedule | null;
  /** نطاق الموظف لمطابقة العطل الرسمية (الأسماء العربية المخزنة) */
  scope: HolidayScope };
type AttendanceLocation = { id: string; name: string; address: string; latitude: number | null; longitude: number | null; radius: number; isDefault: boolean };
type Schedule = { id: string; name: string; hours: string };

const today = riyadhToday;
/** الوقت الحالي بتوقيت الرياض "HH:MM" (لا بتوقيت جهاز المستخدم) */
const currentTime = () => {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "00";
  // بعض المتصفحات تعرض منتصف الليل "24" مع hour12: false
  const hour = part("hour") === "24" ? "00" : part("hour");
  return `${hour.padStart(2, "0")}:${part("minute").padStart(2, "0")}`;
};

export default function HRAttendancePreparation() {
  const { t, direction, locale, formatNumber } = useI18n();
  const session = readUserSession();
  // الصلاحيات الحية من قاعدة البيانات (لا نسخة الدخول المحفوظة في المتصفح)؛ مواقع الحضور لإدارة الحضور كما في القاعدة
  const { permissions: livePerms } = useRolePermissions();
  const canPrepare = canManagePerm(livePerms, "hr.attendance.individual-group", "hr.attendance", "module.hr");
  const canManageLocations = canManagePerm(livePerms, "hr.attendance", "module.hr");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [attendanceLocations, setAttendanceLocations] = useState<AttendanceLocation[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const prepareInFlight = useRef(false);
  const [search, setSearch] = useState("");
  const [branch, setBranch] = useState("الكل");
  const [department, setDepartment] = useState("الكل");
  const [section, setSection] = useState("الكل");
  const [workLocation, setWorkLocation] = useState("الكل");
  const [scheduleId, setScheduleId] = useState("");
  const [fromDate, setFromDate] = useState(today());
  const [toDate, setToDate] = useState(today());
  const [status, setStatus] = useState("حاضر");
  const [checkIn, setCheckIn] = useState(currentTime());
  const [checkOut, setCheckOut] = useState("");
  const [notes, setNotes] = useState("");
  const [savingRecordCount, setSavingRecordCount] = useState(0);
  const [showLocationManager, setShowLocationManager] = useState(false);
  const [locationSaving, setLocationSaving] = useState(false);
  const [mainLocationName, setMainLocationName] = useState("مقر الشركة الرئيسي");
  const [mainLocationAddress, setMainLocationAddress] = useState("");
  const [mainLatitude, setMainLatitude] = useState("");
  const [mainLongitude, setMainLongitude] = useState("");
  const [assignedLocationId, setAssignedLocationId] = useState("");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [employeeResult, scheduleResult, locationResult, branchResult, departmentResult, sectionResult, workScheduleResult] = await Promise.all([
        supabase.from("employees").select("id, emp_id, name, branch_id, branch, department_id, directorate, section_id, department, work_schedule, attendance_location_id").in("status", ["نشط", "فعال", "active"]).order("name"),
        supabase.from("attendance_schedules").select("id, name, hours").eq("status", "فعال").order("name"),
        supabase.from("hr_work_locations").select("id, name, name_en, address, latitude, longitude, attendance_radius_m, is_company_default").eq("status", "فعال").order("name"),
        supabase.from("branches").select("id, name, name_en").order("name"),
        supabase.from("departments").select("id, name, name_en").eq("status", "فعال").order("name"),
        supabase.from("org_sections").select("id, name, name_en, department_id").eq("status", "فعال").order("name"),
        // كل جداول الدوام بإعداداتها (أيام العمل والفترات) لتحديد أيام عمل كل موظف
        loadWorkSchedules(),
      ]);
      if (employeeResult.error || scheduleResult.error || locationResult.error || branchResult.error || departmentResult.error || sectionResult.error) toast.error(t("تعذر تحميل بيانات الموظفين وجداول العمل"));
      else if (workScheduleResult.error) toast.warning(`${t("تعذر تحميل جداول الدوام؛ اعتُبرت أيام العمل من الأحد إلى الخميس")}: ${hrRequestErrorText(workScheduleResult.error)}`);
      const localizedName = (row: any) => locale === "en" && String(row.name_en ?? "").trim() ? String(row.name_en) : String(row.name ?? "");
      const branches = new Map((branchResult.data ?? []).map((row: any) => [String(row.id), localizedName(row)]));
      const departments = new Map((departmentResult.data ?? []).map((row: any) => [String(row.id), localizedName(row)]));
      const sections = new Map((sectionResult.data ?? []).map((row: any) => [String(row.id), localizedName(row)]));
      const locationNames = new Map((locationResult.data ?? []).map((row: any) => [String(row.id), localizedName(row)]));
      // attendance.department: نص إدارة الموظف أولًا (نفس ما تكتبه دالة بصمة البوابة)، ثم الاسم العربي المخزن (لا المترجم ولا "غير مرتبط")
      const storedName = (rows: any[] | null) => new Map<string, string>((rows ?? []).map((row: any) => [String(row.id), String(row.name ?? "").trim()]));
      const departmentStoredNames = storedName(departmentResult.data);
      const sectionStoredNames = storedName(sectionResult.data);
      const orgNames = { branch: storedName(branchResult.data), department: departmentStoredNames, section: sectionStoredNames };
      setEmployees((employeeResult.data ?? []).map((row: any) => {
        const branchId = String(row.branch_id ?? "");
        const departmentId = String(row.department_id ?? "");
        const sectionId = String(row.section_id ?? "");
        const workLocationId = String(row.attendance_location_id ?? "");
        return { id: String(row.id), empId: String(row.emp_id ?? row.id), name: String(row.name ?? "-"), branchId, branch: branches.get(branchId) || t("غير مرتبط"), departmentId, department: departments.get(departmentId) || t("غير مرتبط"), sectionId, section: sections.get(sectionId) || t("غير مرتبط"), workLocationId, workLocation: locationNames.get(workLocationId) || t("غير مرتبط"), workSchedule: String(row.work_schedule ?? t("بدون جدول عمل")), attendanceLocationId: workLocationId, attendanceDepartment: String(row.department ?? "").trim() || sectionStoredNames.get(sectionId) || departmentStoredNames.get(departmentId) || null, schedule: scheduleForEmployee(workScheduleResult.schedules, row.work_schedule), scope: employeeHolidayScope(row, orgNames) };
      }));
      setSchedules((scheduleResult.data ?? []).map((row: any) => ({ id: String(row.id), name: String(row.name), hours: String(row.hours ?? "") })));
      const mappedLocations = (locationResult.data ?? []).map((row: any) => ({ id: String(row.id), name: localizedName(row), address: String(row.address ?? ""), latitude: row.latitude == null ? null : Number(row.latitude), longitude: row.longitude == null ? null : Number(row.longitude), radius: Number(row.attendance_radius_m ?? 10), isDefault: Boolean(row.is_company_default) }));
      setAttendanceLocations(mappedLocations);
      const mainLocation = mappedLocations.find((location) => location.isDefault);
      // اسم الموقع الرئيسي المخزّن (العربي) لا ترجمته، حتى لا يستبدله الحفظ بالاسم الإنجليزي
      const mainLocationRow = (locationResult.data ?? []).find((row: any) => row.is_company_default);
      if (mainLocation) { setMainLocationName(String(mainLocationRow?.name ?? mainLocation.name)); setMainLocationAddress(mainLocation.address); setMainLatitude(mainLocation.latitude == null ? "" : String(mainLocation.latitude)); setMainLongitude(mainLocation.longitude == null ? "" : String(mainLocation.longitude)); }
      setLoading(false);
    };
    void load();
  }, [t, locale]);

  const captureCurrentLocation = () => {
    if (!navigator.geolocation) { toast.error(t("هذا الجهاز لا يدعم تحديد الموقع")); return; }
    setLocationSaving(true);
    navigator.geolocation.getCurrentPosition((position) => { setMainLatitude(position.coords.latitude.toFixed(7)); setMainLongitude(position.coords.longitude.toFixed(7)); setLocationSaving(false); toast.success(t("تم التقاط الموقع الحالي")); }, () => { setLocationSaving(false); toast.error(t("يرجى السماح بالوصول إلى الموقع")); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  };

  const saveMainAttendanceLocation = async () => {
    const latitude = Number(mainLatitude);
    const longitude = Number(mainLongitude);
    if (!mainLocationName.trim() || !Number.isFinite(latitude) || !Number.isFinite(longitude)) { toast.error(t("أدخل اسم الموقع وإحداثيات صحيحة")); return; }
    setLocationSaving(true);
    try {
      const { data, error } = await supabase.rpc("set_company_attendance_location", { p_name: mainLocationName.trim(), p_address: mainLocationAddress.trim(), p_latitude: latitude, p_longitude: longitude });
      if (error) throw error;
      const mainLocation: AttendanceLocation = { id: String(data), name: mainLocationName.trim(), address: mainLocationAddress.trim(), latitude, longitude, radius: 10, isDefault: true };
      setAttendanceLocations((current) => [mainLocation, ...current.filter((location) => !location.isDefault && location.id !== mainLocation.id)]);
      toast.success(t("تم حفظ موقع الشركة الرئيسي وتطبيقه افتراضياً على جميع الموظفين"));
    } catch (saveError) { toast.error(t(hrRequestErrorText(saveError, "تعذر حفظ موقع الشركة"))); } finally { setLocationSaving(false); }
  };

  const assignAttendanceLocation = async () => {
    if (selected.size === 0) { toast.error(t("حدد موظفاً واحداً أو مجموعة موظفين أولاً")); return; }
    // لا يعيّن المسؤول موقع حضوره بنفسه (قاعدة البيانات ترفضه فيُرفض التعيين للجميع)
    const chosen = employees.filter((employee) => selected.has(employee.id));
    // سجلات المستخدم نفسه من الخادم (حساب الدخول المرتبط أو البريد)، ومن الجلسة احتياطًا
    const today = riyadhToday();
    const { blocks } = await loadAttendanceWriteBlocks(chosen.map((employee) => employee.empId), today, today);
    const sessionOwn = new Set(splitOwnEmployees(chosen).own.map((employee) => employee.id));
    const ownSelected = chosen.filter((employee) => sessionOwn.has(employee.id) || blocks.own.has(employee.empId.trim()));
    const employeeIds = chosen.filter((employee) => !ownSelected.includes(employee)).map((employee) => employee.id);
    if (employeeIds.length === 0) { toast.error(t("لا تعيّن موقع حضورك بنفسك؛ يعيّنه لك مسؤول آخر")); return; }
    setLocationSaving(true);
    try {
      const { data, error } = await supabase.rpc("assign_employee_attendance_location", { p_employee_ids: employeeIds, p_location_id: assignedLocationId || null });
      if (error) throw error;
      setEmployees((current) => current.map((employee) => employeeIds.includes(employee.id) ? { ...employee, attendanceLocationId: assignedLocationId } : employee));
      const ownText = ownSelected.length ? `، ${t("ولم يُعيَّن موقعك أنت (يعيّنه لك مسؤول آخر)")}` : "";
      toast.success(`${assignedLocationId ? `${t("تم تعيين الموقع المخصص لـ")} ${formatNumber(Number(data ?? employeeIds.length))} ${t("موظف")}` : `${t("تمت إعادة")} ${formatNumber(Number(data ?? employeeIds.length))} ${t("موظف")} ${t("إلى موقع الشركة الرئيسي")}`}${ownText}`);
    } catch (assignError) { toast.error(t(hrRequestErrorText(assignError, "تعذر تعيين موقع الحضور"))); } finally { setLocationSaving(false); }
  };

  const options = (idField: "branchId" | "departmentId" | "sectionId" | "workLocationId", nameField: "branch" | "department" | "section" | "workLocation") => Array.from(new Map(employees.filter((employee) => employee[idField]).map((employee) => [employee[idField], employee[nameField]])).entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  const filtered = useMemo(() => employees.filter((employee) => {
    const query = search.trim().toLowerCase();
    if (query && !employee.name.toLowerCase().includes(query) && !employee.empId.toLowerCase().includes(query)) return false;
    if (branch !== "الكل" && employee.branchId !== branch) return false;
    if (department !== "الكل" && employee.departmentId !== department) return false;
    if (section !== "الكل" && employee.sectionId !== section) return false;
    if (workLocation !== "الكل" && employee.workLocationId !== workLocation) return false;
    const schedule = schedules.find((item) => item.id === scheduleId);
    return !schedule || employee.workSchedule === schedule.name;
  }), [employees, search, branch, department, section, workLocation, scheduleId, schedules]);
  // الفترة متعددة الأيام تقتصر على أيام عمل كل موظف حسب جدول دوامه (من لا جدول له: الأحد إلى الخميس)
  const selectedEmployees = useMemo(() => employees.filter((employee) => selected.has(employee.id)), [employees, selected]);
  const dayCounts = useMemo(() => selectedEmployees.map((employee) => manualAttendanceDatesFor(fromDate, toDate, employee.schedule).length), [selectedEmployees, fromDate, toDate]);
  const totalRecords = dayCounts.reduce((sum, count) => sum + count, 0);
  const rangeDays = daysInclusive(fromDate, toDate);
  const minDays = dayCounts.length ? Math.min(...dayCounts) : 0;
  const maxDays = dayCounts.length ? Math.max(...dayCounts) : 0;
  const daysText = minDays === maxDays ? formatNumber(maxDays) : `${formatNumber(minDays)}–${formatNumber(maxDays)}`;
  // التحضير الجماعي أو لعدة أيام يضيف الأيام غير المسجلة فقط؛ التحضير الفردي ليوم واحد يحدّث السجل غير الموثّق
  const bulkMode = selected.size > 1 || maxDays > 1;
  // أوقات الدوام الافتراضية: حين يشترك كل المحددين في جدول ثابت واحد (بداية أول فترة ونهاية آخر فترة)
  const commonSchedule = selectedEmployees.length && selectedEmployees.every((employee) => employee.schedule && employee.schedule.id === selectedEmployees[0].schedule?.id) ? selectedEmployees[0].schedule : null;
  const scheduleTimes = commonSchedule && !commonSchedule.flexible && commonSchedule.periods.length ? { start: commonSchedule.periods[0].start, end: commonSchedule.periods[commonSchedule.periods.length - 1].end } : null;
  const allVisibleSelected = filtered.length > 0 && filtered.every((employee) => selected.has(employee.id));
  const toggleAll = () => setSelected((current) => { const next = new Set(current); if (allVisibleSelected) filtered.forEach((employee) => next.delete(employee.id)); else filtered.forEach((employee) => next.add(employee.id)); return next; });
  const toggleEmployee = (id: string) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  const handlePrepare = async () => {
    if (prepareInFlight.current) return;
    if (!canPrepare) return toast.error(t("ليس لديك صلاحية تسجيل حضور الموظفين"));
    const { own: ownChosen, others: chosen } = splitOwnEmployees(employees.filter((employee) => selected.has(employee.id)));
    if (chosen.length === 0) return toast.error(t(ownChosen.length ? OWN_ATTENDANCE_NOTE : "اختر موظفًا واحدًا على الأقل"));
    if (!fromDate || !toDate) return toast.error(t("حدد تاريخ البداية وتاريخ النهاية"));
    if (fromDate > toDate) return toast.error(t("تاريخ البداية يجب أن يكون قبل أو مساويًا لتاريخ النهاية"));
    const withTimes = status !== "غائب";
    const timeError = withTimes ? manualAttendanceTimeError(checkIn, checkOut, status === "حاضر") : null;
    if (timeError) return toast.error(t(timeError));
    const leaveNoteError = manualLeaveNoteError(status, notes);
    if (leaveNoteError) return toast.error(t(leaveNoteError));
    // أيام عمل كل موظف حسب جدول دوامه (اليوم الواحد يُقبل كما هو)
    const scheduledDates = chosen.map((employee) => ({ employee, dates: manualAttendanceDatesFor(fromDate, toDate, employee.schedule) }));
    const allScheduled = [...new Set(scheduledDates.flatMap((item) => item.dates))].sort();
    if (allScheduled.length === 0) return toast.error(t("لا توجد أيام عمل في الفترة المحددة حسب جداول دوام الموظفين المختارين"));
    const futureError = manualAttendanceFutureError(allScheduled[allScheduled.length - 1], status);
    if (futureError) return toast.error(t(futureError));
    prepareInFlight.current = true;
    setSaving(true);
    try {
      // العطل الرسمية والإجازات المعتمدة لكل موظف؛ إن تعذر تحميلها لا يُحفظ شيء
      const { offDates, error: offError } = await loadOffDates(chosen.map((employee) => ({ id: employee.id, empId: employee.empId, scope: employee.scope })), fromDate, toDate);
      if (offError) {
        toast.error(`${t("تعذر تحميل العطل الرسمية والإجازات المعتمدة؛ لم يُحفظ شيء")}: ${hrRequestErrorText(offError)}`);
        return;
      }
      // التعديل الصريح: موظف واحد ليوم واحد (لا فترة يقع فيها يوم عمل واحد)
      const singleDay = chosen.length === 1 && fromDate === toDate && scheduledDates[0].dates.length === 1;
      // يوم واحد لموظف واحد: العمل في عطلة رسمية أو أثناء إجازة معتمدة يُسجَّل حضورًا عند طلبه صراحة،
      // ولا يُسجَّل فيه غياب ولا إجازة. التحضير المتعدد يستثني هذه الأيام لكل موظف دائمًا.
      if (singleDay && offDates.get(chosen[0].id)?.has(scheduledDates[0].dates[0]) && (status === "غائب" || isManualLeaveStatus(status))) {
        toast.error(t("هذا اليوم عطلة رسمية أو ضمن إجازة معتمدة للموظف؛ لا يُسجَّل فيه غياب ولا إجازة"));
        return;
      }
      const datesByEmployee = singleDay
        ? scheduledDates
        : scheduledDates.map(({ employee, dates: employeeDates }) => ({ employee, dates: employeeDates.filter((date) => !offDates.get(employee.id)?.has(date)) }));
      const offSkipped = scheduledDates.reduce((sum, item, index) => sum + item.dates.length - datesByEmployee[index].dates.length, 0);
      const dates = [...new Set(datesByEmployee.flatMap((item) => item.dates))].sort();
      if (dates.length === 0) {
        toast.error(t("كل أيام العمل المحددة عطل رسمية أو إجازات معتمدة للموظفين المختارين"));
        return;
      }
      const withoutDays = datesByEmployee.filter((item) => !item.dates.length).length;
      const preparedCount = chosen.length - withoutDays;
      const overwriteExisting = singleDay;
      const updatedAt = new Date().toISOString();
      const payload = datesByEmployee.flatMap(({ employee, dates: employeeDates }) => employeeDates.map((attendanceDate) => ({ emp_id: employee.empId, emp_name: employee.name, department: employee.attendanceDepartment, date: attendanceDate, check_in: withTimes ? checkIn || null : null, check_out: withTimes ? checkOut || null : null, status, late_minutes: 0, notes: notes.trim() || (chosen.length > 1 ? "تحضير جماعي من الإدارة" : "تحضير فردي من الإدارة"), prepared_by: session?.name || session?.email || "الإدارة", updated_at: updatedAt })));
      setSavingRecordCount(payload.length);
      // لا يُستبدل أي سجل بصمة موثّقة من بوابة الموظف، والتحضير الجماعي لا يعدّل السجلات الموجودة
      const result = await saveManualAttendance(payload, { overwriteExisting });
      if (result.error) {
        toast.error(`${t("تعذر حفظ التحضير")}: ${hrRequestErrorText(result.error)}${result.saved ? ` — ${manualAttendanceResultText(result, t, formatNumber)} ${t("قبل حدوث الخطأ")}` : ""}`);
        return;
      }
      const skippedText = [
        withoutDays ? `${t("ولا أيام عمل لـ")} ${formatNumber(withoutDays)} ${t("موظف في الفترة حسب جدول دوامه أو لأنها عطل وإجازات")}` : "",
        offSkipped ? `${t("واستُثني")} ${formatNumber(offSkipped)} ${t("يوم عطلة رسمية أو إجازة معتمدة")}` : "",
        ownChosen.length ? t(OWN_ATTENDANCE_NOTE) : "",
      ].filter(Boolean).map((text) => `، ${text}`).join("");
      const resultText = `${manualAttendanceResultText(result, t, formatNumber, `${t("لـ")} ${formatNumber(preparedCount)} ${t("موظف")} ${t("خلال")} ${formatNumber(dates.length)} ${t("يوم")}`)}${skippedText}`;
      if (result.saved > 0) toast.success(resultText); else toast.warning(resultText);
      setSelected(new Set()); setNotes("");
    } catch (saveError) { toast.error(hrRequestErrorText(saveError, t("حدث خطأ غير متوقع أثناء حفظ التحضير"))); } finally { prepareInFlight.current = false; setSaving(false); setSavingRecordCount(0); }
  };

  return <Layout><div className="mx-auto max-w-[1800px] space-y-5" dir={direction}>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold text-slate-900">{t("التحضير الفردي والجماعي")}</h1><p className="mt-1 text-sm text-slate-500">{t("تسجيل حضور موظف واحد أو مجموعة موظفين وربطه مباشرة بتقارير الحضور")}</p></div><div className="flex items-center gap-2">{canManageLocations && <Button type="button" variant="outline" onClick={() => setShowLocationManager((current) => !current)} className="gap-2 border-violet-200 text-violet-700 hover:bg-violet-50"><MapPin className="h-4 w-4" />{t("موقع الحضور")}</Button>}<div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-800">{t("المحددون")}: {formatNumber(selected.size)}</div></div></div>
    {showLocationManager && canManageLocations && <section className="rounded-xl border border-violet-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b bg-violet-50 px-5 py-3"><div><h2 className="font-bold text-violet-900">{t("إدارة موقع الحضور")}</h2><p className="text-xs text-violet-700">{t("النطاق الثابت لتسجيل حضور الموظف هو 10 أمتار.")}</p></div><button type="button" onClick={() => setShowLocationManager(false)} title={t("إغلاق")} aria-label={t("إغلاق")} className="rounded-lg p-2 text-violet-700 hover:bg-violet-100"><X className="h-4 w-4" /></button></div><div className="grid gap-5 p-5 lg:grid-cols-2"><div className="space-y-3 rounded-lg border p-4"><h3 className="font-semibold text-slate-900">{t("موقع الشركة الرئيسي")}</h3><p className="text-xs text-slate-500">{t("يغيّره مدير النظام فقط")}</p><Input value={mainLocationName} onChange={(event) => setMainLocationName(event.target.value)} placeholder={t("اسم الموقع")} /><Input value={mainLocationAddress} onChange={(event) => setMainLocationAddress(event.target.value)} placeholder={t("عنوان الشركة")} /><div className="grid grid-cols-2 gap-2"><Input type="number" step="any" value={mainLatitude} onChange={(event) => setMainLatitude(event.target.value)} placeholder={t("خط العرض")} /><Input type="number" step="any" value={mainLongitude} onChange={(event) => setMainLongitude(event.target.value)} placeholder={t("خط الطول")} /></div><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={captureCurrentLocation} disabled={locationSaving} className="gap-2"><Navigation className="h-4 w-4" />{t("استخدام موقعي الحالي")}</Button><Button type="button" onClick={saveMainAttendanceLocation} disabled={locationSaving} className="gap-2 bg-violet-600 hover:bg-violet-700">{locationSaving && <Loader2 className="h-4 w-4 animate-spin" />}{t("حفظ الموقع الرئيسي")}</Button></div></div><div className="space-y-3 rounded-lg border p-4"><h3 className="font-semibold text-slate-900">{t("تعيين موقع لموظفين محددين")}</h3><p className="text-sm text-slate-500">{t("حدد الموظفين من الجدول، ثم اختر موقع الحضور الخاص بهم.")}</p><select value={assignedLocationId} onChange={(event) => setAssignedLocationId(event.target.value)} aria-label={t("موقع الحضور")} className="h-10 w-full rounded-md border bg-white px-3 text-sm"><option value="">{t("موقع الشركة الرئيسي (الافتراضي)")}</option>{attendanceLocations.filter((location) => !location.isDefault && location.latitude != null && location.longitude != null).map((location) => <option key={location.id} value={location.id}>{location.name} — {t("نطاق")} {formatNumber(location.radius)} {t("م")}</option>)}</select><Button type="button" onClick={assignAttendanceLocation} disabled={locationSaving || selected.size === 0} className="gap-2 bg-violet-600 hover:bg-violet-700">{locationSaving && <Loader2 className="h-4 w-4 animate-spin" />}{t("تطبيق الموقع على")} {formatNumber(selected.size)} {t("موظف")}</Button><p className="text-xs text-slate-500">{t("يمكن إضافة المواقع الأخرى وإحداثياتها من صفحة مواقع العمل.")}</p></div></div></section>}
    <section className="rounded-xl border bg-white shadow-sm"><div className="border-b bg-slate-50 px-5 py-3 font-bold text-slate-800">{t("بيانات التحضير")}</div><div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4"><Field label={t("من تاريخ*")}><Input type="date" value={fromDate} max={toDate || undefined} onChange={(e) => setFromDate(e.target.value)} /></Field><Field label={t("إلى تاريخ*")}><Input type="date" value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)} /></Field><Field label={t("حالة الدوام*")}><select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 w-full rounded-md border bg-white px-3 text-sm"><option value="حاضر">{t("حاضر")}</option><option value="غائب">{t("غائب")}</option><option value="إجازة">{t("إجازة")}</option><option value="عمل عن بعد">{t("عمل عن بعد")}</option></select>{isManualLeaveStatus(status) && <p className="mt-1 text-xs text-amber-700">{t("لا تُخصم من رصيد الإجازات؛ اكتب سببها في الملاحظات. الإجازات المعتمدة من طلبات الإجازات تُستثنى تلقائيًا ولا تحتاج تحضيرًا")}</p>}</Field><Field label={t("وقت الحضور")}><Input type="time" value={checkIn} disabled={status === "غائب"} onChange={(e) => setCheckIn(e.target.value)} /></Field><Field label={t("وقت الانصراف")}><Input type="time" value={checkOut} disabled={status === "غائب"} onChange={(e) => setCheckOut(e.target.value)} />{scheduleTimes && status !== "غائب" && <button type="button" onClick={() => { setCheckIn(scheduleTimes.start); setCheckOut(scheduleTimes.end); }} className="mt-1 text-xs font-medium text-sky-700 underline-offset-2 hover:underline">{t("استخدام أوقات جدول الدوام")} ({scheduleTimes.start}–{scheduleTimes.end})</button>}</Field><Field label={t("جدول العمل")}><select value={scheduleId} onChange={(e) => setScheduleId(e.target.value)} className="h-10 w-full rounded-md border bg-white px-3 text-sm"><option value="">{t("كل جداول العمل")}</option>{schedules.map((item) => <option key={item.id} value={item.id}>{item.name}{item.hours ? ` — ${item.hours}` : ""}</option>)}</select></Field><div className="sm:col-span-2"><Field label={t("ملاحظات")}><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("اختياري")} /></Field></div><div className="flex items-center rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-800 sm:col-span-2 lg:col-span-4">{t(bulkMode ? "سيتم إنشاء حتى" : "سيتم إنشاء أو تحديث")} <strong className="mx-1">{formatNumber(totalRecords)}</strong> {t("سجل")}: {formatNumber(selected.size)} {t("موظف")}{dayCounts.length > 0 && <> × {daysText} {t("يوم")}</>}{rangeDays > 1 && (dayCounts.length === 0 || minDays < rangeDays) && <span className="ms-1">({t("أيام الراحة حسب جدول دوام كل موظف مستثناة")})</span>}{bulkMode && <span className="ms-1">— {t("الأيام المسجلة مسبقًا لا تُعدَّل، وتُستثنى العطل الرسمية والإجازات المعتمدة")}</span>}</div></div></section>
    <section className="rounded-xl border bg-white shadow-sm"><div className="grid gap-3 border-b p-4 sm:grid-cols-2 lg:grid-cols-5"><div className="relative"><Search className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 ${direction === "rtl" ? "right-3" : "left-3"}`} /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("بحث بالاسم أو الرقم")} className={direction === "rtl" ? "pr-9" : "pl-9"} /></div><OrganizationFilter value={branch} onChange={(value) => { setBranch(value); setDepartment("الكل"); setSection("الكل"); }} options={options("branchId", "branch")} label={t("كل الفروع")} /><OrganizationFilter value={department} onChange={(value) => { setDepartment(value); setSection("الكل"); }} options={options("departmentId", "department").filter((item) => branch === "الكل" || employees.some((employee) => employee.departmentId === item.id && employee.branchId === branch))} label={t("كل الإدارات")} /><OrganizationFilter value={section} onChange={setSection} options={options("sectionId", "section").filter((item) => department === "الكل" || employees.some((employee) => employee.sectionId === item.id && employee.departmentId === department))} label={t("كل الأقسام")} /><OrganizationFilter value={workLocation} onChange={setWorkLocation} options={options("workLocationId", "workLocation")} label={t("كل مواقع العمل")} /><Button onClick={handlePrepare} disabled={saving || selected.size === 0 || !canPrepare} className="bg-[#0069a8] hover:bg-[#005486]">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : selected.size > 1 ? <Users className="h-4 w-4" /> : <CheckCheck className="h-4 w-4" />} {saving ? `${t("جاري حفظ")} ${formatNumber(savingRecordCount)} ${t("سجل")}...` : selected.size > 1 ? `${t("تحضير جماعي")} (${daysText} ${t("يوم")})` : `${t("تحضير فردي")} (${daysText} ${t("يوم")})`}</Button></div><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-sm"><thead className="bg-[#0069a8] text-white"><tr><th className="w-14 px-4 py-3"><Checkbox checked={allVisibleSelected} onCheckedChange={toggleAll} aria-label={t("تحديد الكل")} className="border-white data-[state=checked]:bg-white data-[state=checked]:text-[#0069a8]" /></th><th className="px-4 py-3">{t("رقم الموظف")}</th><th className="px-4 py-3">{t("اسم الموظف")}</th><th className="px-4 py-3">{t("القسم")}</th><th className="px-4 py-3">{t("الفرع")}</th><th className="px-4 py-3">{t("موقع العمل")}</th><th className="px-4 py-3">{t("جدول العمل")}</th></tr></thead><tbody className="divide-y">{loading ? <tr><td colSpan={7} className="py-12 text-center text-slate-500"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />{t("جاري تحميل الموظفين...")}</td></tr> : filtered.length === 0 ? <tr><td colSpan={7} className="py-12 text-center text-slate-500">{t("لا يوجد موظفون مطابقون")}</td></tr> : filtered.map((employee) => <tr key={employee.id} onClick={() => toggleEmployee(employee.id)} className={`cursor-pointer hover:bg-sky-50 ${selected.has(employee.id) ? "bg-sky-50" : ""}`}><td className="px-4 py-3" onClick={(event) => event.stopPropagation()}><Checkbox checked={selected.has(employee.id)} onCheckedChange={() => toggleEmployee(employee.id)} aria-label={`${t("تحديد")} ${employee.name}`} /></td><td className="px-4 py-3 font-mono text-sky-700">{employee.empId}</td><td className="px-4 py-3 font-semibold">{employee.name}</td><td className="px-4 py-3">{t(employee.department)}</td><td className="px-4 py-3">{t(employee.branch)}</td><td className="px-4 py-3">{t(employee.workLocation)}</td><td className="px-4 py-3"><span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5 text-slate-400" />{t(employee.workSchedule)}</span></td></tr>)}</tbody></table></div></section>
  </div></Layout>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block space-y-1.5"><span className="text-xs font-medium text-slate-700">{label}</span>{children}</label>; }
function OrganizationFilter({ value, onChange, options, label }: { value: string; onChange: (value: string) => void; options: Array<{ id: string; name: string }>; label: string }) { return <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className="h-10 rounded-md border bg-white px-3 text-sm"><option value="الكل">{label}</option>{options.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>; }
