import { useEffect, useMemo, useRef, useState } from "react";
import Layout from "@/components/Layout";
import { Download, Printer, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabaseClient";
import { exportReportExcel, type ReportColumn } from "@/lib/reportExport";
import { eachDate, monthRange, riyadhMonth, riyadhToday } from "@/lib/hrDates";
import { ACTIVE_EMPLOYEE_STATUSES, isApprovedStatus, isRejectedStatus } from "@/lib/hrStatus";
import { fetchAllRows } from "@/lib/fetchAll";
import { hrRequestErrorText } from "@/lib/hrErrors";
import { readUserSession } from "@/lib/authSession";
import { MANUAL_ATTENDANCE_SOURCE, OWN_ATTENDANCE_NOTE, PROTECTED_ATTENDANCE_FILTER, VERIFIED_ATTENDANCE_SOURCE, approvedLeaveDatesByEmployee, employeeHolidayScope, loadApprovedLeaves, loadAttendanceWriteBlocks, loadOfficialHolidays, lockedKey, manualAttendanceDatesFor, manualAttendanceFutureError, manualAttendanceResultText, manualAttendanceTimeError, officialHolidayDates, permissionHoursFromDetails, saveManualAttendance, scheduleWorkDates, splitOwnEmployees, type ManualAttendanceRow } from "@/lib/attendanceManual";
import { classifyAttendanceDay, type DayCategory, type DayClassification } from "@/lib/attendanceRules";
import { WEEKDAY_LABELS, earlyLeaveMinutesFor, effectiveLateMinutes, isScheduledWorkDay, loadWorkSchedules, requiredDailyMinutes, scheduleForEmployee, workedSecondsFor, type WorkSchedule } from "@/lib/workSchedule";
import { loadPayrollPolicy } from "@/lib/payrollCalc";
import { useI18n } from "@/i18n";
import { COMPANY_PROFILE } from "@/lib/companyProfile";
import { EmployeePhoto } from "@/components/hr/employeeFiles";

const ALL = "all";
type ReportMode = "employees" | "departments";
type StatusFilter = "all" | "present" | "absent" | "late" | "leave";
type AttendanceAction = "punch" | "bulk" | "overtime" | "permission" | "clear-punches" | "delete-bulk";
type DepartmentOption = { id: string; name: string; branchId: string };
type SectionOption = { id: string; name: string; departmentId: string };
type BranchOption = { id: string; name: string };
type Employee = {
  id: string;
  empId: string;
  name: string;
  branchId: string;
  branch: string;
  departmentId: string;
  department: string;
  sectionId: string;
  section: string;
  jobTitle: string;
  workSchedule: string;
  workLocation: string;
  employmentType: string;
  photoUrl: string;
  dailyHours: number;
  baseSalary: number;
  /** إجمالي الراتب (الأساسي + البدلات الفعالة) */
  totalSalary: number;
  hireDate: string;
  /** اسم الإدارة كما يُحفظ في عمود attendance.department (بالعربية، أو null) */
  attendanceDepartment: string | null;
  /** جدول دوام الموظف (attendance_schedules بالاسم)؛ null = الأحد إلى الخميس */
  schedule: WorkSchedule | null;
  /** الموظف مرتبط باسم جدول غير موجود في جداول الدوام */
  scheduleMissing: boolean;
  /** معفى من الحضور (attendance_exempt) */
  attendanceExempt: boolean;
};
type AttendanceRecord = { empId: string; date: string; status: string; checkIn: string; checkOut: string; lateMinutes: number; notes: string };
type OvertimeRecord = { employeeId: string; date: string; hours: number };
type PermissionRecord = { empId: string; date: string; hours: number };
type DailyAttendanceDetail = Employee & { rowId: string; date: string; category: DayCategory; statusLabel: string; checkIn: string; checkOut: string; worked: string; required: string; late: string; earlyLeave: string; permission: string; deficit: string; overtime: string; notes: string; counted: boolean; unrecorded: boolean; hasRecord: boolean; workedSeconds: number; requiredSeconds: number; lateSeconds: number; earlyLeaveSeconds: number; permissionSeconds: number; deficitSeconds: number; overtimeSeconds: number };
type EmployeeSummary = Employee & { present: number; absent: number; late: number; leave: number; unrecordedDays: number; recorded: number; attendanceRate: number };
type DepartmentSummary = { id: string; department: string; employees: number; present: number; absent: number; late: number; leave: number; attendanceRate: number };

const unique = (values: string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar"));
// نظام العمل السعودي (المادة 107): أجر الساعة الإضافية = أجر الساعة الفعلي + 50% من أجر الساعة الأساسي.
// يُحفظ المعامل 1.5 في عمود rate كما في السجلات السابقة؛ المبلغ يُحسب بالمعادلة أعلاه (overtimeAmount).
const OVERTIME_RATE = 1.5;
/** حالات الحضور التي يمسح منها "حذف دخول/خروج" الأوقات (لا الإجازة ولا المأمورية ولا العمل عن بعد ولا العطل) */
const CLEARABLE_ATTENDANCE_STATUSES = ["حاضر", "متأخر", "present", "late"];
const NAME_LIST_LIMIT = 5;
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
type QueryRow = Record<string, any>;
type RowPage = (from: number, to: number) => PromiseLike<{ data: QueryRow[] | null; error: unknown }>;
/** fetchAllRows بصيغة { data, error } مثل استعلامات Supabase العادية */
const fetchPagedRows = (page: RowPage): Promise<{ data: QueryRow[] | null; error: unknown }> =>
  fetchAllRows<QueryRow>(page).then((data) => ({ data, error: null }), (error: unknown) => ({ data: null, error }));
const EMPLOYEE_COLUMNS = "id, emp_id, name, branch_id, branch, department_id, section_id, directorate, department, job_title, work_schedule, work_location, employment_type, photo_url, daily_hours, base_salary, total_salary, hire_date";
const errorCode = (error: unknown) => String((error as { code?: unknown } | null)?.code ?? "");
/** الموظفون النشطون مع عمود الإعفاء من الحضور؛ قاعدة بيانات بلا عمود attendance_exempt (42703) يُعاد الجلب بدونه */
const loadActiveEmployees = async () => {
  const page = (columns: string) => fetchPagedRows((from, to) => supabase.from("employees").select(columns).in("status", ACTIVE_EMPLOYEE_STATUSES).order("name").order("id").range(from, to) as unknown as PromiseLike<{ data: QueryRow[] | null; error: unknown }>);
  const result = await page(`${EMPLOYEE_COLUMNS}, attendance_exempt`);
  return errorCode(result.error) === "42703" ? page(EMPLOYEE_COLUMNS) : result;
};
const formatDuration = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
};
const DAY_LABELS: Record<DayCategory, string> = { present: "حاضر", late: "متأخر", leave: "إجازة", absent: "غائب", weekend: "عطلة نهاية أسبوع", holiday: "عطلة رسمية", none: "لا يوجد تسجيل" };
type DayInput = { today: string; holiday: boolean; onLeave: boolean; countUnrecordedAsAbsent: boolean };
/**
 * تصنيف يوم واحد لموظف بالقاعدة الموحدة مع كشف الرواتب (attendanceRules):
 * - أيام العمل من جدول دوام الموظف (من لا جدول له: الأحد إلى الخميس).
 * - الغياب هو الغياب المسجّل صراحة فقط؛ يوم العمل الماضي بلا تسجيل يظهر "لا يوجد تسجيل"،
 *   إلا إن فُعّل إعداد "الراتب المكتسب حسب الحضور" فيُعد غيابًا ويُخصم.
 * - counted: يدخل في عدّ الحضور/الغياب، requiresHours: تُطلب فيه ساعات الدوام اليومية.
 */
const classifyEmployeeDay = (employee: Employee, date: string, record: AttendanceRecord | undefined, { today, holiday, onLeave, countUnrecordedAsAbsent }: DayInput): DayClassification & { workDay: boolean; computedLateMinutes: number } => {
  const workDay = isScheduledWorkDay(date, employee.schedule);
  // التأخير من جدول الدوام الحالي في أيام العمل فقط (العمل في يوم راحة أو عطلة رسمية لا موعد بداية له)،
  // ومن السجل لمن لا جدول ثابتًا له
  const computedLateMinutes = record ? effectiveLateMinutes(record.lateMinutes, record.checkIn, employee.schedule, workDay && !holiday) : 0;
  const day = classifyAttendanceDay({
    date,
    record: record ? { status: record.status, checkIn: record.checkIn, lateMinutes: computedLateMinutes } : undefined,
    workDay,
    holiday,
    onLeave,
    hireDate: employee.hireDate,
    today,
    exempt: employee.attendanceExempt,
    countUnrecordedAsAbsent,
    computedLateMinutes,
  });
  return { ...day, workDay, computedLateMinutes };
};
/** أيام العمل بأسماء الأيام، والأيام المتتالية (3 فأكثر) كمدى: "الأحد–الخميس" */
const workDaysText = (workDays: number[], t: (text: string) => string) => {
  const runs: number[][] = [];
  [...new Set(workDays)].sort((a, b) => a - b).forEach((day) => {
    const last = runs[runs.length - 1];
    if (last && day === last[last.length - 1] + 1) last.push(day);
    else runs.push([day]);
  });
  return runs.map((run) => run.length >= 3 ? `${t(WEEKDAY_LABELS[run[0]])}–${t(WEEKDAY_LABELS[run[run.length - 1]])}` : run.map((day) => t(WEEKDAY_LABELS[day])).join("، ")).join("، ");
};
/** مبلغ الساعات الإضافية (المادة 107): الساعات × (أجر الساعة الفعلي + 50% من أجر الساعة الأساسي) */
const overtimeAmount = (employee: Employee, hours: number) => {
  // ساعات العمل اليومية من جدول الدوام، وإلا من ملف الموظف، وإلا 8 ساعات
  const dailyHours = requiredDailyMinutes(employee.schedule, employee.dailyHours) / 60;
  const basicHourly = employee.baseSalary / 30 / dailyHours;
  const actualHourly = (employee.totalSalary > 0 ? employee.totalSalary : employee.baseSalary) / 30 / dailyHours;
  return round2(hours * (actualHourly + 0.5 * basicHourly));
};
const ID_CHUNK = 100;
const chunkIds = (ids: string[]) => Array.from({ length: Math.ceil(ids.length / ID_CHUNK) }, (_, index) => ids.slice(index * ID_CHUNK, (index + 1) * ID_CHUNK));
/** ساعات الاستئذان من details.hours أو من وقتي البداية والنهاية */

function FilterSelect({ label, value, onChange, options, allLabel }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; allLabel: string }) {
  return <label className="space-y-1 text-xs font-medium text-slate-600"><span className="block">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800"><option value={ALL}>{allLabel}</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

export default function HRAttendanceCalculate() {
  const { t, locale, direction, formatNumber } = useI18n();
  const initialRange = monthRange(riyadhMonth());
  const [dateFrom, setDateFrom] = useState(initialRange.from);
  const [dateTo, setDateTo] = useState(initialRange.to);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [overtimeRecords, setOvertimeRecords] = useState<OvertimeRecord[]>([]);
  const [permissionRecords, setPermissionRecords] = useState<PermissionRecord[]>([]);
  /** أيام العطل الرسمية وأيام الإجازات المعتمدة لكل موظف (بمعرّف الموظف) داخل الفترة المحمّلة */
  const [holidayDates, setHolidayDates] = useState<Map<string, Set<string>>>(new Map());
  const [leaveDates, setLeaveDates] = useState<Map<string, Set<string>>>(new Map());
  /** تحذيرات لا توقف التقرير (تعذر تحميل الإجازات أو جداول الدوام أو إعدادات الراتب) */
  const [calendarWarnings, setCalendarWarnings] = useState<string[]>([]);
  /** إعداد الرواتب "الراتب المكتسب حسب الحضور": يوم العمل الماضي بلا تسجيل يُعد غيابًا */
  const [countUnrecordedAsAbsent, setCountUnrecordedAsAbsent] = useState(false);
  const loadSeq = useRef(0);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [sections, setSections] = useState<SectionOption[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [jobTitles, setJobTitles] = useState<string[]>([]);
  const [workSchedules, setWorkSchedules] = useState<string[]>([]);
  const [workLocations, setWorkLocations] = useState<string[]>([]);
  const [branch, setBranch] = useState(ALL);
  const [departmentId, setDepartmentId] = useState(ALL);
  const [sectionId, setSectionId] = useState(ALL);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [employeePickerSearch, setEmployeePickerSearch] = useState("");
  const [jobTitle, setJobTitle] = useState(ALL);
  const [workSchedule, setWorkSchedule] = useState(ALL);
  const [workLocation, setWorkLocation] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [mode, setMode] = useState<ReportMode>("employees");
  const [showUnrecordedDays, setShowUnrecordedDays] = useState(true);
  const [showNotes, setShowNotes] = useState(true);
  const [attendanceAction, setAttendanceAction] = useState<AttendanceAction | null>(null);
  const [actionDate, setActionDate] = useState(initialRange.from);
  const [actionDateFrom, setActionDateFrom] = useState(initialRange.from);
  const [actionDateTo, setActionDateTo] = useState(initialRange.to);
  const [actionCheckIn, setActionCheckIn] = useState("08:00");
  const [actionCheckOut, setActionCheckOut] = useState("17:00");
  const [actionHours, setActionHours] = useState("1");
  const [actionReason, setActionReason] = useState("");
  const [actionSaving, setActionSaving] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadData = async () => {
    // رقم تسلسلي: استجابة تحميل أقدم لا تستبدل نتيجة تحميل أحدث (تغيير الفترة بسرعة)
    const seq = ++loadSeq.current;
    if (!dateFrom || !dateTo || dateFrom > dateTo) { setError(t("تاريخ البداية يجب أن يسبق تاريخ النهاية")); setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const [employeeResult, attendanceResult, overtimeResult, permissionResult, departmentResult, sectionResult, branchResult, jobResult, scheduleResult, locationResult, holidayResult, leaveResult, policyResult] = await Promise.all([
        // الجداول التي قد تتجاوز 1000 صف تُجلب على دفعات
        loadActiveEmployees(),
        fetchPagedRows((from, to) => supabase.from("attendance").select("emp_id, date, status, check_in, check_out, late_minutes, notes").gte("date", dateFrom).lte("date", dateTo).order("date").order("emp_id").range(from, to)),
        // الحالة تُقرأ بـ isApprovedStatus (تشمل "موافق") بدل قائمة ثابتة
        fetchPagedRows((from, to) => supabase.from("overtime_records").select("id, employee_id, date, hours, status").gte("date", dateFrom).lte("date", dateTo).order("date").order("id").range(from, to)),
        fetchPagedRows((from, to) => supabase.from("hr_requests").select("id, emp_id, start_date, status, details").eq("request_type", "استئذان").gte("start_date", dateFrom).lte("start_date", dateTo).order("start_date").order("id").range(from, to)),
        supabase.from("departments").select("id, name, name_en, branch_id").eq("status", "فعال").order("name"),
        supabase.from("org_sections").select("id, name, name_en, department_id").eq("status", "فعال").order("name"),
        supabase.from("branches").select("id, name, name_en").eq("status", "فعال").order("name"),
        supabase.from("hr_jobs").select("id, name, name_en").eq("status", "فعال").order("name"),
        // جداول الدوام (الفعالة وغيرها: الموظف المرتبط بجدول معطّل يُحسب بإعداداته)؛ تعذر تحميلها لا يوقف التقرير
        loadWorkSchedules(),
        supabase.from("hr_work_locations").select("id, name, name_en").eq("status", "فعال").order("name"),
        // العطل والإجازات لا توقف التقرير عند الخطأ (تعيد قائمة فارغة مع الخطأ)
        loadOfficialHolidays(dateFrom, dateTo),
        loadApprovedLeaves(dateFrom, dateTo),
        // نفس إعداد كشف الرواتب: هل يُعد يوم العمل بلا تسجيل غيابًا؛ عند التعذر الافتراضي (لا)
        loadPayrollPolicy(),
      ]);
      if (seq !== loadSeq.current) return;
      const firstError = employeeResult.error ?? attendanceResult.error ?? overtimeResult.error ?? permissionResult.error ?? departmentResult.error ?? sectionResult.error ?? branchResult.error ?? jobResult.error ?? locationResult.error;
      if (firstError) { setError(hrRequestErrorText(firstError, t("تعذر تحميل بيانات الحضور"))); return; }
      const localizedName = (row: { name: unknown; name_en?: unknown }) => {
        const arabicName = String(row.name ?? "");
        const englishName = String(row.name_en ?? "").trim();
        return locale === "en" ? englishName || t(arabicName) : arabicName;
      };
      const branchRows: BranchOption[] = (branchResult.data ?? []).map((row) => ({ id: String(row.id), name: localizedName(row) }));
      const branchById = new Map(branchRows.map((item) => [item.id, item.name]));
      const departmentRows: DepartmentOption[] = (departmentResult.data ?? []).map((row) => ({ id: String(row.id), name: localizedName(row), branchId: String(row.branch_id ?? "") }));
      const departmentById = new Map(departmentRows.map((item) => [item.id, item.name]));
      // الأسماء العربية المخزنة (لا المترجمة ولا "غير مرتبط") لعمود attendance.department ولنطاق العطل الرسمية
      const storedNames = (rows: QueryRow[] | null) => new Map<string, string>((rows ?? []).map((row) => [String(row.id), String(row.name ?? "").trim()]));
      const departmentStoredName = storedNames(departmentResult.data);
      const branchStoredName = storedNames(branchResult.data);
      const sectionStoredName = storedNames(sectionResult.data);
      const sectionRows: SectionOption[] = (sectionResult.data ?? []).map((row) => ({ id: String(row.id), name: localizedName(row), departmentId: String(row.department_id ?? "") }));
      const sectionById = new Map(sectionRows.map((item) => [item.id, item.name]));
      const jobByName = new Map((jobResult.data ?? []).map((row) => [String(row.name ?? ""), localizedName(row)]));
      const locationByName = new Map((locationResult.data ?? []).map((row) => [String(row.name ?? ""), localizedName(row)]));
      const loadedEmployees: Employee[] = (employeeResult.data ?? []).map((row) => {
        const scheduleName = String(row.work_schedule ?? "").trim();
        const schedule = scheduleForEmployee(scheduleResult.schedules, scheduleName);
        return {
          id: String(row.id), empId: String(row.emp_id ?? row.id), name: String(row.name ?? "-"), branchId: String(row.branch_id ?? ""), branch: branchById.get(String(row.branch_id ?? "")) || t("غير مرتبط"),
          departmentId: String(row.department_id ?? ""), department: departmentById.get(String(row.department_id ?? "")) || t("غير مرتبط"),
          sectionId: String(row.section_id ?? ""), section: sectionById.get(String(row.section_id ?? "")) || t("غير مرتبط"),
          jobTitle: jobByName.get(String(row.job_title ?? "")) || t(String(row.job_title ?? "")), workSchedule: t(String(row.work_schedule ?? "")), workLocation: locationByName.get(String(row.work_location ?? "")) || t(String(row.work_location ?? "")), employmentType: t(String(row.employment_type ?? "دوام كامل")), photoUrl: String(row.photo_url ?? ""), dailyHours: Number(row.daily_hours ?? 8),
          baseSalary: Number(row.base_salary ?? 0), totalSalary: Number(row.total_salary ?? 0), hireDate: String(row.hire_date ?? "").slice(0, 10),
          // نص إدارة الموظف أولًا (نفس ما تكتبه دالة بصمة البوابة)، ثم اسم الإدارة المرتبطة
          attendanceDepartment: String(row.department ?? "").trim() || departmentStoredName.get(String(row.department_id ?? "")) || null,
          schedule,
          // عند تعذر تحميل الجداول لا يُعد الجدول "غير موجود" (يظهر تحذير التحميل بدلًا منه)
          scheduleMissing: Boolean(scheduleName) && !schedule && !scheduleResult.error,
          attendanceExempt: row.attendance_exempt === true,
        };
      });
      // نطاق العطلة (الفرع/الإدارة/القسم) يُطابق بالأسماء العربية المخزنة أو بنصوص ملف الموظف
      const holidayMap = new Map<string, Set<string>>();
      const orgNames = { branch: branchStoredName, department: departmentStoredName, section: sectionStoredName };
      (employeeResult.data ?? []).forEach((row) => {
        holidayMap.set(String(row.id), officialHolidayDates(holidayResult.holidays, employeeHolidayScope(row, orgNames), dateFrom, dateTo));
      });
      if (holidayResult.error) console.warn("official_holidays could not be loaded; holidays ignored", holidayResult.error);
      setHolidayDates(holidayMap);
      setLeaveDates(approvedLeaveDatesByEmployee(leaveResult.leaves, loadedEmployees, dateFrom, dateTo, leaveResult.codeOwners));
      const warnings: string[] = [];
      if (leaveResult.error) warnings.push(`${t("تعذر تحميل الإجازات المعتمدة؛ قد تظهر أيام الإجازة غيابًا")}: ${hrRequestErrorText(leaveResult.error)}`);
      if (scheduleResult.error) warnings.push(`${t("تعذر تحميل جداول الدوام؛ اعتُبرت أيام العمل من الأحد إلى الخميس وساعات العمل من ملف الموظف")}: ${hrRequestErrorText(scheduleResult.error)}`);
      if (policyResult.error) warnings.push(`${t("تعذر قراءة إعدادات حساب الراتب؛ يُحتسب الغياب المسجّل صراحة فقط")}: ${hrRequestErrorText(policyResult.error)}`);
      const missingSchedules = loadedEmployees.filter((employee) => employee.scheduleMissing).length;
      if (missingSchedules) warnings.push(`${formatNumber(missingSchedules)} ${t("موظف مرتبط بجدول دوام غير موجود؛ اعتُبرت أيام عملهم من الأحد إلى الخميس")}`);
      setCalendarWarnings(warnings);
      setCountUnrecordedAsAbsent(policyResult.policy.countUnrecordedAsAbsent);
      setDepartments(departmentRows);
      setSections(sectionRows);
      setEmployees(loadedEmployees);
      setAttendance((attendanceResult.data ?? []).map((row) => ({ empId: String(row.emp_id ?? ""), date: String(row.date ?? "").slice(0, 10), status: String(row.status ?? ""), checkIn: String(row.check_in ?? ""), checkOut: String(row.check_out ?? ""), lateMinutes: Number(row.late_minutes ?? 0), notes: String(row.notes ?? "") })));
      setOvertimeRecords((overtimeResult.data ?? []).filter((row) => isApprovedStatus(row.status)).map((row) => ({ employeeId: String(row.employee_id ?? ""), date: String(row.date ?? "").slice(0, 10), hours: Number(row.hours ?? 0) })));
      setPermissionRecords((permissionResult.data ?? []).filter((row) => isApprovedStatus(row.status)).map((row) => { const details = row.details && typeof row.details === "object" ? row.details as Record<string, unknown> : {}; return { empId: String(row.emp_id ?? ""), date: String(row.start_date ?? "").slice(0, 10), hours: permissionHoursFromDetails(details) }; }));
      setBranches(branchRows);
      setJobTitles(unique([...(jobResult.data ?? []).map((row) => localizedName(row)), ...loadedEmployees.map((item) => item.jobTitle)]));
      // فلتر جدول العمل: الجداول الفعالة في attendance_schedules + جداول الموظفين الحالية
      setWorkSchedules(unique([...[...scheduleResult.schedules.values()].filter((schedule) => schedule.status === "فعال").map((schedule) => t(schedule.name)), ...loadedEmployees.map((item) => item.workSchedule)]));
      setWorkLocations(unique([...(locationResult.data ?? []).map((row) => localizedName(row)), ...loadedEmployees.map((item) => item.workLocation)]));
    } catch (loadError) {
      if (seq === loadSeq.current) setError(hrRequestErrorText(loadError, t("تعذر تحميل بيانات الحضور")));
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  };

  useEffect(() => { void loadData(); }, [dateFrom, dateTo, locale]);
  useEffect(() => { setPage(1); }, [branch, departmentId, sectionId, selectedEmployeeIds, jobTitle, workSchedule, workLocation, statusFilter, mode, search, pageSize]);

  const employeeSummaries = useMemo<EmployeeSummary[]>(() => {
    const today = riyadhToday();
    const dates = eachDate(dateFrom, dateTo);
    const recordsByEmployee = new Map<string, Map<string, AttendanceRecord>>();
    attendance.forEach((record) => { if (!recordsByEmployee.has(record.empId)) recordsByEmployee.set(record.empId, new Map()); recordsByEmployee.get(record.empId)?.set(record.date, record); });
    return employees.map((employee) => {
      const records = recordsByEmployee.get(employee.empId) ?? new Map<string, AttendanceRecord>();
      const counts = { present: 0, absent: 0, late: 0, leave: 0, unrecordedDays: 0 };
      dates.forEach((date) => {
        const day = classifyEmployeeDay(employee, date, records.get(date), { today, holiday: holidayDates.get(employee.id)?.has(date) ?? false, onLeave: leaveDates.get(employee.id)?.has(date) ?? false, countUnrecordedAsAbsent });
        // الغائب المعدود = غياب يُخصم في كشف الرواتب (deductibleAbsence) بنفس القاعدة
        if (day.counted && (day.category === "present" || day.category === "absent" || day.category === "late" || day.category === "leave")) counts[day.category] += 1;
        if (day.unrecorded && !day.deductibleAbsence) counts.unrecordedDays += 1;
      });
      const worked = counts.present + counts.late;
      const expected = worked + counts.absent;
      return { ...employee, ...counts, recorded: records.size, attendanceRate: expected ? (worked / expected) * 100 : 0 };
    });
  }, [attendance, countUnrecordedAsAbsent, dateFrom, dateTo, employees, holidayDates, leaveDates]);

  const filteredEmployees = employeeSummaries.filter((employee) => {
    const departmentMatches = departmentId === ALL || employee.departmentId === departmentId || (!employee.departmentId && employee.department === departments.find((item) => item.id === departmentId)?.name);
    const sectionMatches = sectionId === ALL || employee.sectionId === sectionId || (!employee.sectionId && employee.section === sections.find((item) => item.id === sectionId)?.name);
    const keyword = search.trim().toLowerCase();
    return selectedEmployeeIds.includes(employee.id) && (branch === ALL || employee.branchId === branch) && departmentMatches && sectionMatches && (jobTitle === ALL || employee.jobTitle === jobTitle) && (workSchedule === ALL || employee.workSchedule === workSchedule) && (workLocation === ALL || employee.workLocation === workLocation) && (statusFilter === "all" || employee[statusFilter] > 0) && (!keyword || [employee.name, employee.empId, employee.department, employee.section, employee.jobTitle, employee.branch].some((value) => value.toLowerCase().includes(keyword)));
  });
  const detailedRows = useMemo<DailyAttendanceDetail[]>(() => {
    const recordsByEmployeeAndDate = new Map(attendance.map((record) => [`${record.empId}:${record.date}`, record]));
    const overtimeByEmployeeAndDate = new Map<string, number>();
    overtimeRecords.forEach((record) => { const key = `${record.employeeId}:${record.date}`; overtimeByEmployeeAndDate.set(key, (overtimeByEmployeeAndDate.get(key) ?? 0) + record.hours * 3600); });
    const permissionByEmployeeAndDate = new Map<string, number>();
    permissionRecords.forEach((record) => { const key = `${record.empId}:${record.date}`; permissionByEmployeeAndDate.set(key, (permissionByEmployeeAndDate.get(key) ?? 0) + record.hours * 3600); });
    const rows: DailyAttendanceDetail[] = [];
    const today = riyadhToday();
    const dates = eachDate(dateFrom, dateTo);
    employeeSummaries.filter((employee) => selectedEmployeeIds.includes(employee.id)).forEach((employee) => {
      // الساعات اليومية المطلوبة من جدول الدوام، وإلا من ملف الموظف، وإلا 8 ساعات
      const dailySeconds = requiredDailyMinutes(employee.schedule, employee.dailyHours) * 60;
      dates.forEach((date) => {
        const record = recordsByEmployeeAndDate.get(`${employee.empId}:${date}`);
        // ساعات العمل الفعلية: المدة بين الدخول والخروج ناقص ما بين فترات الدوام واستراحة الجدول (مثل الساعات المستحقة)
        const workedSeconds = record ? workedSecondsFor(record.checkIn, record.checkOut, employee.schedule) : 0;
        const manualOvertimeSeconds = overtimeByEmployeeAndDate.get(`${employee.id}:${date}`) ?? 0;
        const permissionSeconds = permissionByEmployeeAndDate.get(`${employee.empId}:${date}`) ?? 0;
        const holiday = holidayDates.get(employee.id)?.has(date) ?? false;
        const { category, counted, requiresHours, unrecorded, workDay, computedLateMinutes } = classifyEmployeeDay(employee, date, record, { today, holiday, onLeave: leaveDates.get(employee.id)?.has(date) ?? false, countUnrecordedAsAbsent });
        const requiredSeconds = requiresHours ? dailySeconds : 0;
        const attended = category === "present" || category === "late";
        // التأخير من بداية الدوام وفترة السماح بجدول الموظف الحالي (ومن السجل لمن لا جدول ثابتًا له)
        const lateSeconds = (attended ? computedLateMinutes : 0) * 60;
        // الخروج المبكر: قبل نهاية آخر فترة دوام بأكثر من فترة السماح، في أيام العمل فقط
        const earlyLeaveSeconds = record?.checkOut && attended && workDay && !holiday ? earlyLeaveMinutesFor(record.checkOut, employee.schedule) * 60 : 0;
        const deficitSeconds = requiresHours ? Math.max(requiredSeconds - workedSeconds - permissionSeconds, 0) : 0;
        // العمل في أيام الراحة حسب جدول الموظف والعطل الرسمية كله ساعات إضافية؛ في أيام العمل ما زاد على الساعات اليومية
        const punchOvertimeSeconds = !workDay || holiday ? workedSeconds : Math.max(workedSeconds - dailySeconds, 0);
        // الساعات المسجلة في overtime_records لنفس اليوم غالبًا هي نفس الساعات المحسوبة من البصمة: يؤخذ الأكبر لا المجموع
        const overtimeSeconds = Math.max(punchOvertimeSeconds, manualOvertimeSeconds);
        rows.push({
          ...employee,
          rowId: `${employee.id}:${date}`,
          date,
          category,
          counted,
          unrecorded,
          hasRecord: Boolean(record),
          // يوم بلا تسجيل احتُسب غيابًا بإعداد "الراتب المكتسب حسب الحضور" يُميَّز عن الغياب المسجّل
          statusLabel: category === "absent" && unrecorded ? t("غائب (بلا تسجيل)") : t(DAY_LABELS[category]),
          checkIn: record?.checkIn || "—",
          checkOut: record?.checkOut || "—",
          worked: formatDuration(workedSeconds),
          required: formatDuration(requiredSeconds),
          late: formatDuration(lateSeconds),
          earlyLeave: formatDuration(earlyLeaveSeconds),
          permission: formatDuration(permissionSeconds),
          deficit: formatDuration(deficitSeconds),
          overtime: formatDuration(overtimeSeconds),
          notes: record?.notes || "",
          workedSeconds,
          requiredSeconds,
          lateSeconds,
          earlyLeaveSeconds,
          permissionSeconds,
          deficitSeconds,
          overtimeSeconds,
        });
      });
    });
    return rows;
  }, [attendance, countUnrecordedAsAbsent, dateFrom, dateTo, employeeSummaries, holidayDates, leaveDates, overtimeRecords, permissionRecords, selectedEmployeeIds, t]);

  const departmentSummaries = useMemo<DepartmentSummary[]>(() => {
    const grouped = new Map<string, DepartmentSummary>();
    filteredEmployees.forEach((employee) => {
      const key = employee.departmentId || employee.department || "unassigned";
      const current = grouped.get(key) ?? { id: key, department: employee.department || t("غير محدد"), employees: 0, present: 0, absent: 0, late: 0, leave: 0, attendanceRate: 0 };
      current.employees += 1; current.present += employee.present; current.absent += employee.absent; current.late += employee.late; current.leave += employee.leave;
      grouped.set(key, current);
    });
    return [...grouped.values()].map((item) => ({ ...item, attendanceRate: item.present + item.late + item.absent ? ((item.present + item.late) / (item.present + item.late + item.absent)) * 100 : 0 }));
  }, [filteredEmployees, t]);

  // إخفاء الأيام بدون تسجيل يُبقي كل يوم له سجل حضور وأيام الإجازة والغياب (الغياب المحتسب يظهر دائمًا لأنه يُخصم)
  const visibleDetailedRows = detailedRows.filter((row) => showUnrecordedDays || row.hasRecord || row.category === "leave" || row.category === "absent");
  const allRows = mode === "employees" ? filteredEmployees : departmentSummaries;
  const totalPages = Math.max(1, Math.ceil(allRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedRows = allRows.slice((safePage - 1) * pageSize, safePage * pageSize);
  const columns: ReportColumn[] = mode === "employees"
    ? [{ key: "name", label: t("اسم الموظف") }, { key: "empId", label: t("رقم الموظف") }, { key: "date", label: t("التاريخ") }, { key: "statusLabel", label: t("الحالة") }, { key: "checkIn", label: t("دخول") }, { key: "checkOut", label: t("خروج") }, { key: "worked", label: t("ساعات الحضور") }, { key: "required", label: t("الساعات المستحقة") }, { key: "late", label: t("ساعات التأخير") }, { key: "earlyLeave", label: t("خروج مبكر") }, { key: "permission", label: t("ساعات الاستئذان") }, { key: "deficit", label: t("ساعات النقص") }, { key: "overtime", label: t("الساعات الإضافية") }, ...(showNotes ? [{ key: "notes", label: t("ملاحظات") }] : [])]
    : [{ key: "department", label: t("الإدارة") }, { key: "employees", label: t("عدد الموظفين") }, { key: "present", label: t("حاضر") }, { key: "absent", label: t("غائب") }, { key: "late", label: t("متأخر") }, { key: "leave", label: t("إجازة") }, { key: "attendanceRate", label: t("نسبة الحضور") }];
  // تُستبعد الحقول الداخلية (المنطقية وجدول الدوام) من صفوف التصدير
  const reportRows = mode === "employees" ? visibleDetailedRows.map(({ counted: _counted, unrecorded: _unrecorded, hasRecord: _hasRecord, schedule: _schedule, scheduleMissing: _scheduleMissing, attendanceExempt: _attendanceExempt, ...row }) => row) : departmentSummaries.map((row) => ({ ...row, attendanceRate: `${row.attendanceRate.toFixed(1)}%` }));
  const reportTitle = t(mode === "employees" ? "تقرير حساب دوام الموظفين" : "تقرير ملخص الأقسام");
  const reportOptions = { title: reportTitle, subtitle: `${dateFrom} — ${dateTo}`, columns, rows: reportRows, fileName: `${mode}-attendance-${dateFrom}-${dateTo}`, landscape: true, summary: [{ label: t("عدد السجلات"), value: reportRows.length }] };
  const departmentOptions = departments.filter((item) => branch === ALL || item.branchId === branch).map((item) => ({ value: item.id, label: item.name }));
  const sectionOptions = sections.filter((item) => departmentId === ALL || item.departmentId === departmentId).map((item) => ({ value: item.id, label: item.name }));
  const selectableEmployees = employees.filter((employee) => {
    const keyword = employeePickerSearch.trim().toLowerCase();
    return (branch === ALL || employee.branchId === branch)
      && (departmentId === ALL || employee.departmentId === departmentId)
      && (sectionId === ALL || employee.sectionId === sectionId)
      && (jobTitle === ALL || employee.jobTitle === jobTitle)
      && (workSchedule === ALL || employee.workSchedule === workSchedule)
      && (workLocation === ALL || employee.workLocation === workLocation)
      && (!keyword || [employee.name, employee.empId, employee.department, employee.section, employee.jobTitle].some((value) => value.toLowerCase().includes(keyword)));
  });
  const allSelectableSelected = selectableEmployees.length > 0 && selectableEmployees.every((employee) => selectedEmployeeIds.includes(employee.id));
  const toggleEmployee = (id: string) => setSelectedEmployeeIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const toggleAllSelectable = () => setSelectedEmployeeIds((current) => {
    const selectableIds = selectableEmployees.map((employee) => employee.id);
    return allSelectableSelected ? current.filter((id) => !selectableIds.includes(id)) : [...new Set([...current, ...selectableIds])];
  });
  const actionEmployees = employees.filter((employee) => selectedEmployeeIds.includes(employee.id));
  const rangeActions: AttendanceAction[] = ["bulk", "clear-punches", "delete-bulk"];
  const openAttendanceAction = (action: AttendanceAction) => {
    setAttendanceAction(action);
    setActionDate(dateFrom);
    setActionDateFrom(dateFrom);
    // التحضير لا يقبل أيامًا بعد اليوم: الافتراضي حتى اليوم إن كانت الفترة تمتد بعده
    const today = riyadhToday();
    setActionDateTo((action === "bulk" || action === "clear-punches") && dateTo > today ? (today < dateFrom ? dateFrom : today) : dateTo);
    setActionMessage("");
  };
  // أيام العطلة الرسمية والإجازة المعتمدة لكل موظف (بمعرّفه) لا تُحضَّر ولا تُجعل غيابًا
  const offDatesFor = (employee: Employee) => {
    const off = new Set<string>();
    holidayDates.get(employee.id)?.forEach((date) => off.add(date));
    leaveDates.get(employee.id)?.forEach((date) => off.add(date));
    return off;
  };
  const saveAttendanceAction = async () => {
    if (!attendanceAction || actionEmployees.length === 0) return;
    setActionSaving(true);
    setActionMessage("");
    let message = "";
    let changed = false;
    try {
      if (rangeActions.includes(attendanceAction) && (!actionDateFrom || !actionDateTo || actionDateFrom > actionDateTo)) {
        throw new Error(t("تاريخ البداية يجب أن يسبق تاريخ النهاية"));
      }
      if (!rangeActions.includes(attendanceAction) && !actionDate) throw new Error(t("حدد التاريخ"));
      // سجلات الحضور: لا يسجّل المسؤول حضوره ولا يعدّله ولا يحذفه بنفسه (قاعدة البيانات ترفضه أيضًا)
      const { own: ownTargets, others: attendanceTargets } = splitOwnEmployees(actionEmployees);
      const attendanceAffecting = attendanceAction === "punch" || attendanceAction === "bulk" || attendanceAction === "clear-punches" || attendanceAction === "delete-bulk";
      if (attendanceAffecting && !attendanceTargets.length) throw new Error(t(OWN_ATTENDANCE_NOTE));
      const ownNote = attendanceAffecting && ownTargets.length ? `، ${t(OWN_ATTENDANCE_NOTE)}` : "";
      const empIds = attendanceTargets.map((employee) => employee.empId);
      const updatedAt = new Date().toISOString();
      const nameList = (list: Employee[]) => `${list.slice(0, NAME_LIST_LIMIT).map((employee) => employee.name).join("، ")}${list.length > NAME_LIST_LIMIT ? "…" : ""}`;
      if (attendanceAction === "punch" || attendanceAction === "bulk") {
        let rows: ManualAttendanceRow[];
        let overwriteExisting = false;
        if (attendanceAction === "punch") {
          const timeError = manualAttendanceTimeError(actionCheckIn, actionCheckOut, true);
          if (timeError) throw new Error(t(timeError));
          const futureError = manualAttendanceFutureError(actionDate, "حاضر");
          if (futureError) throw new Error(t(futureError));
          rows = attendanceTargets.map((employee) => ({ emp_id: employee.empId, emp_name: employee.name, department: employee.attendanceDepartment, date: actionDate, check_in: actionCheckIn, check_out: actionCheckOut || null, status: "حاضر", late_minutes: 0, notes: actionReason || "إضافة دخول وخروج من حساب الدوام", prepared_by: "الإدارة", updated_at: updatedAt }));
          // التعديل الصريح لموظف واحد يحدّث سجله غير الموثّق؛ لعدة موظفين تُضاف السجلات الناقصة فقط
          overwriteExisting = attendanceTargets.length === 1;
        } else {
          // التحضير لعدة أيام يقتصر على أيام عمل كل موظف حسب جدول دوامه، ويضيف الأيام غير المسجلة فقط
          const datesByEmployee = attendanceTargets.map((employee) => ({ employee, dates: manualAttendanceDatesFor(actionDateFrom, actionDateTo, employee.schedule) }));
          const allDates = [...new Set(datesByEmployee.flatMap((item) => item.dates))].sort();
          if (!allDates.length) throw new Error(t("لا توجد أيام عمل في الفترة المحددة حسب جداول دوام الموظفين المختارين"));
          const futureError = manualAttendanceFutureError(allDates[allDates.length - 1], "حاضر");
          if (futureError) throw new Error(t(futureError));
          rows = datesByEmployee.flatMap(({ employee, dates }) => {
            const off = offDatesFor(employee);
            return dates.filter((date) => !off.has(date)).map((date) => ({ emp_id: employee.empId, emp_name: employee.name, department: employee.attendanceDepartment, date, check_in: null, check_out: null, status: "حاضر", late_minutes: 0, notes: actionReason || "تحضير متعدد من حساب الدوام", prepared_by: "الإدارة", updated_at: updatedAt }));
          });
          if (!rows.length) throw new Error(t("كل أيام العمل المحددة عطل رسمية أو إجازات معتمدة للموظفين المختارين"));
        }
        // يتخطى بصمات الموظفين الموثّقة جغرافيًا ويكتب الباقي كتحضير إداري
        const result = await saveManualAttendance(rows, { overwriteExisting });
        changed = result.saved > 0;
        if (result.error) {
          message = `${hrRequestErrorText(result.error, t("تعذر حفظ التحضير"))}${result.saved ? ` — ${manualAttendanceResultText(result, t, formatNumber)} ${t("قبل حدوث الخطأ")}` : ""}`;
          return;
        }
        message = `${manualAttendanceResultText(result, t, formatNumber)}${ownNote}`;
      } else if (attendanceAction === "overtime") {
        const hours = Number(actionHours);
        if (!Number.isFinite(hours) || hours <= 0 || hours > 24) throw new Error(t("أدخل عدد ساعات صحيح"));
        if (!actionDate || actionDate > riyadhToday()) throw new Error(t("لا تُسجَّل ساعات إضافية بتاريخ مستقبلي"));
        // لا يسجّل المستخدم ساعات إضافية لنفسه (قاعدة البيانات ترفضها أيضًا)
        const session = readUserSession() as { empId?: unknown; name?: unknown } | null;
        const ownEmpId = String(session?.empId ?? "").trim();
        const ownName = String(session?.name ?? "").trim();
        const selfEmployees = ownEmpId ? actionEmployees.filter((employee) => employee.empId.trim() === ownEmpId && (!ownName || employee.name.trim() === ownName)) : [];
        const otherEmployees = actionEmployees.filter((employee) => !selfEmployees.includes(employee));
        // من لم يُسجَّل راتبه الأساسي يُتخطى ولا يوقف حفظ الباقين
        const withoutSalary = otherEmployees.filter((employee) => !(employee.baseSalary > 0));
        const withSalary = otherEmployees.filter((employee) => employee.baseSalary > 0);
        // لا تكرار: من لديه سجل ساعات إضافية غير مرفوض في نفس التاريخ يُتخطى
        const recordedIds = new Set<string>();
        for (const ids of chunkIds(withSalary.map((employee) => employee.id))) {
          const { data: existingRows, error: existingError } = await supabase.from("overtime_records").select("employee_id, status").eq("date", actionDate).in("employee_id", ids);
          if (existingError) throw existingError;
          (existingRows ?? []).filter((row) => !isRejectedStatus(row.status)).forEach((row) => recordedIds.add(String(row.employee_id ?? "")));
        }
        const alreadyRecorded = withSalary.filter((employee) => recordedIds.has(employee.id));
        const eligible = withSalary.filter((employee) => !recordedIds.has(employee.id));
        const skippedText = [
          selfEmployees.length ? t("لا تسجّل ساعات إضافية لنفسك؛ يسجّلها لك مسؤول آخر") : "",
          withoutSalary.length ? `${t("تم تخطي")} ${formatNumber(withoutSalary.length)} ${t("موظف لعدم تسجيل الراتب الأساسي")}: ${nameList(withoutSalary)}` : "",
          alreadyRecorded.length ? `${t("تم تخطي")} ${formatNumber(alreadyRecorded.length)} ${t("موظف لديه ساعات إضافية مسجلة في هذا التاريخ")}: ${nameList(alreadyRecorded)}` : "",
        ].filter(Boolean).join("، ");
        if (!eligible.length) throw new Error(`${t("لم تُسجَّل أي ساعات إضافية")}${skippedText ? `: ${skippedText}` : ""}`);
        // المادة 107: الساعات × (أجر الساعة الفعلي + 50% من أجر الساعة الأساسي)؛ المبلغ يعيد الخادم حسابه.
        // تُسجَّل "معلقة" وتدخل الراتب بعد اعتمادها من مسؤول آخر في صفحة "اعتماد الساعات الإضافية"
        // كل موظف على حدة: رفض واحد (شهر رواتبه معتمد مثلًا) لا يوقف تسجيل الباقين
        let savedCount = 0;
        const failures: string[] = [];
        for (const employee of eligible) {
          const { error: saveError } = await supabase.from("overtime_records").insert({ employee_id: employee.id, emp_name: employee.name, date: actionDate, hours, rate: OVERTIME_RATE, amount: overtimeAmount(employee, hours), status: "معلق", notes: actionReason || null });
          if (saveError) failures.push(`${employee.name}: ${t(hrRequestErrorText(saveError, "تعذر الحفظ"))}`);
          else savedCount += 1;
        }
        changed = savedCount > 0;
        const failureText = failures.length ? `${t("لم يُسجَّل لـ")} ${formatNumber(failures.length)} ${t("موظف")}: ${failures.slice(0, NAME_LIST_LIMIT).join("، ")}${failures.length > NAME_LIST_LIMIT ? "…" : ""}` : "";
        if (!savedCount) throw new Error(failureText || t("لم تُسجَّل أي ساعات إضافية"));
        message = [`${t("تم تسجيل الساعات الإضافية بانتظار الاعتماد لـ")} ${formatNumber(savedCount)} ${t("موظف")}`, skippedText, failureText].filter(Boolean).join("، ");
      } else if (attendanceAction === "permission") {
        const hours = Number(actionHours);
        if (!Number.isFinite(hours) || hours <= 0) throw new Error(t("أدخل عدد ساعات صحيح"));
        // قاعدة البيانات تجعل طلب المستخدم لنفسه معلقًا؛ لا يُسجَّل من هنا
        const session = readUserSession() as { empId?: unknown; name?: unknown } | null;
        const ownEmpId = String(session?.empId ?? "").trim();
        const ownName = String(session?.name ?? "").trim();
        // الرقم الوظيفي قد يتكرر (EMP-030): نطابق الرقم والاسم معًا إن توفر الاسم
        const selfEmployees = ownEmpId ? actionEmployees.filter((employee) => employee.empId.trim() === ownEmpId && (!ownName || employee.name.trim() === ownName)) : [];
        const targets = actionEmployees.filter((employee) => !selfEmployees.includes(employee));
        const selfNote = t("لا تسجّل استئذانًا لنفسك من هنا؛ أرسله طلبًا من البوابة");
        if (!targets.length) throw new Error(selfNote);
        const { error: saveError } = await supabase.from("hr_requests").insert(targets.map((employee) => ({ emp_id: employee.empId, emp_name: employee.name, request_type: "استئذان", start_date: actionDate, end_date: actionDate, status: "معتمد", details: { hours, reason: actionReason, source: "attendance_calculation" } })));
        if (saveError) throw saveError;
        changed = true;
        message = `${t("تم تسجيل الاستئذان لـ")} ${formatNumber(targets.length)} ${t("موظف")}${selfEmployees.length ? `، ${selfNote}` : ""}`;
      } else if (attendanceAction === "clear-punches") {
        // أيام عمل كل موظف حسب جدول دوامه فقط (لا أيام راحته)، وسجلات الحضور فقط (لا الإجازة والمأمورية والعمل عن بعد والعطل)،
        // ولا تُمس البصمات الموثّقة من البوابة (entry_source أو location_verified)
        // لا تُجعل أيام بعد اليوم غيابًا (قاعدة البيانات ترفضها)، ولا يُمس شهر رواتبه معتمدة أو مرحّلة للموظف
        const clearTo = actionDateTo > riyadhToday() ? riyadhToday() : actionDateTo;
        if (actionDateFrom > clearTo) throw new Error(t("لا يُمسح الحضور لأيام بعد اليوم"));
        const { blocks, error: blocksError } = await loadAttendanceWriteBlocks(attendanceTargets.map((employee) => employee.empId), actionDateFrom, clearTo);
        if (blocksError) throw blocksError;
        let lockedSkipped = 0;
        const workDatesByEmployee = attendanceTargets.filter((employee) => !blocks.own.has(employee.empId.trim())).map((employee) => {
          const all = scheduleWorkDates(actionDateFrom, clearTo, employee.schedule);
          const open = all.filter((date) => !blocks.locked.has(lockedKey(employee.empId, date)));
          lockedSkipped += all.length - open.length;
          return { employee, dates: open };
        });
        if (workDatesByEmployee.every((item) => !item.dates.length)) throw new Error(t(lockedSkipped ? "كل الأيام المحددة في أشهر رواتبها معتمدة أو مرحّلة" : "لا توجد أيام عمل في الفترة المحددة حسب جداول دوام الموظفين المختارين"));
        // أيام العطلة الرسمية والإجازة المعتمدة لكل موظف تُستثنى؛ يُجمع الموظفون ذوو الأيام نفسها في طلب واحد
        const groups = new Map<string, { dates: string[]; empIds: string[] }>();
        workDatesByEmployee.forEach(({ employee, dates: workDates }) => {
          const off = offDatesFor(employee);
          const dates = workDates.filter((date) => !off.has(date));
          if (!dates.length) return;
          const key = dates.join(",");
          const group = groups.get(key) ?? { dates, empIds: [] };
          group.empIds.push(employee.empId);
          groups.set(key, group);
        });
        let verifiedCount = 0;
        let updated = 0;
        for (const group of groups.values()) {
          for (const ids of chunkIds([...new Set(group.empIds)])) {
            const { count, error: countError } = await supabase.from("attendance").select("id", { count: "exact", head: true }).in("emp_id", ids).in("date", group.dates).in("status", CLEARABLE_ATTENDANCE_STATUSES).or(PROTECTED_ATTENDANCE_FILTER);
            if (countError) throw countError;
            verifiedCount += count ?? 0;
            const { data, error: saveError } = await supabase.from("attendance").update({ check_in: null, check_out: null, status: "غائب", notes: actionReason || "حذف الدخول والخروج من حساب الدوام", updated_at: updatedAt }).in("emp_id", ids).in("date", group.dates).in("status", CLEARABLE_ATTENDANCE_STATUSES).eq("location_verified", false).is("check_in_latitude", null).is("check_out_latitude", null).or(`entry_source.is.null,entry_source.neq.${VERIFIED_ATTENDANCE_SOURCE}`).select("id");
            if (saveError) throw saveError;
            updated += data?.length ?? 0;
          }
        }
        changed = updated > 0;
        message = updated ? `${t("تم مسح الدخول والخروج من")} ${formatNumber(updated)} ${t("سجل")}` : t("لم يُعدَّل أي سجل: لا توجد سجلات حضور إدارية في أيام العمل ضمن الفترة أو لا تملك صلاحية التعديل");
        if (verifiedCount) message += `، ${t("وتُرك")} ${formatNumber(verifiedCount)} ${t("سجل بصمة موثّقة من بوابة الموظف دون تعديل")}`;
        if (lockedSkipped) message += `، ${t("ولم تُمس")} ${formatNumber(lockedSkipped)} ${t("يوم في أشهر رواتبها معتمدة أو مرحّلة")}`;
        message += ownNote;
      } else {
        // سجل أنشأه المدير ثم سجّل الموظف عليه انصرافًا موثّقًا من البوابة لا يُحذف
        let keptCount = 0;
        let deleted = 0;
        // الحذف شهرًا بشهر: لا يُمس شهر رواتبه معتمدة أو مرحّلة للموظف (قاعدة البيانات ترفضه فيُرفض الطلب كله)
        const { blocks, error: blocksError } = await loadAttendanceWriteBlocks(empIds, actionDateFrom, actionDateTo);
        if (blocksError) throw blocksError;
        const months: { from: string; to: string; month: string }[] = [];
        for (let month = actionDateFrom.slice(0, 7); month <= actionDateTo.slice(0, 7); ) {
          const range = monthRange(month);
          months.push({ month, from: range.from < actionDateFrom ? actionDateFrom : range.from, to: range.to > actionDateTo ? actionDateTo : range.to });
          const [year, monthNumber] = month.split("-").map(Number);
          month = monthNumber === 12 ? `${year + 1}-01` : `${year}-${String(monthNumber + 1).padStart(2, "0")}`;
        }
        let lockedMonths = 0;
        for (const segment of months) {
          const segmentIds = [...new Set(empIds)].filter((empId) => !blocks.own.has(empId.trim()) && !blocks.locked.has(`${empId.trim()}|${segment.month}`));
          lockedMonths += [...new Set(empIds)].filter((empId) => !blocks.own.has(empId.trim()) && blocks.locked.has(`${empId.trim()}|${segment.month}`)).length;
          for (const ids of chunkIds(segmentIds)) {
            const { count, error: countError } = await supabase.from("attendance").select("id", { count: "exact", head: true }).in("emp_id", ids).gte("date", segment.from).lte("date", segment.to).eq("entry_source", MANUAL_ATTENDANCE_SOURCE).or("location_verified.is.true,check_in_latitude.not.is.null,check_out_latitude.not.is.null");
            if (countError) throw countError;
            keptCount += count ?? 0;
            const { data, error: saveError } = await supabase.from("attendance").delete().in("emp_id", ids).gte("date", segment.from).lte("date", segment.to).eq("entry_source", MANUAL_ATTENDANCE_SOURCE).eq("location_verified", false).is("check_in_latitude", null).is("check_out_latitude", null).select("id");
            if (saveError) throw saveError;
            deleted += data?.length ?? 0;
          }
        }
        changed = deleted > 0;
        message = deleted ? `${t("تم حذف")} ${formatNumber(deleted)} ${t("سجل تحضير إداري")}` : t("لم يُحذف أي سجل: لا توجد سجلات تحضير إداري في الفترة أو لا تملك صلاحية الحذف");
        if (keptCount) message += `، ${t("وتُرك")} ${formatNumber(keptCount)} ${t("سجل يحمل بصمة موثّقة من بوابة الموظف دون حذف")}`;
        if (lockedMonths) message += `، ${t("ولم يُمس")} ${formatNumber(lockedMonths)} ${t("شهر رواتبه معتمدة أو مرحّلة لموظف")}`;
        message += ownNote;
      }
      setAttendanceAction(null);
    } catch (actionError) {
      message = hrRequestErrorText(actionError, t("تعذر تنفيذ العملية"));
    } finally {
      setActionMessage(message);
      setActionSaving(false);
      if (changed) await loadData();
    }
  };
  const selectedEmployeesForDetail = employeeSummaries.filter((employee) => selectedEmployeeIds.includes(employee.id));
  // الملخص الشامل يُجمع من نفس احتساب الأيام التفصيلي حتى تتطابق الأرقام
  const detailRowsByEmployee = new Map<string, DailyAttendanceDetail[]>();
  detailedRows.forEach((row) => { const list = detailRowsByEmployee.get(row.id) ?? []; list.push(row); detailRowsByEmployee.set(row.id, list); });
  const reportToday = riyadhToday();
  const comprehensiveRows = selectedEmployeesForDetail.map((employee) => {
    const days = detailRowsByEmployee.get(employee.id) ?? [];
    const total = (field: "workedSeconds" | "requiredSeconds" | "lateSeconds" | "earlyLeaveSeconds" | "permissionSeconds" | "deficitSeconds" | "overtimeSeconds") => days.reduce((sum, day) => sum + day[field], 0);
    // أيام العمل: أيام عمل الموظف حسب جدول دوامه غير العطل الرسمية، حتى اليوم، ومن تاريخ التعيين
    const employeeHolidays = holidayDates.get(employee.id);
    const expectedWorkDays = days.filter((day) => isScheduledWorkDay(day.date, employee.schedule) && !employeeHolidays?.has(day.date) && day.date <= reportToday && (!employee.hireDate || day.date >= employee.hireDate)).length;
    return {
      empId: employee.empId,
      name: employee.name,
      workTime: employee.employmentType || t("دوام كامل"),
      periodDays: expectedWorkDays,
      presentDays: employee.present + employee.late,
      absentDays: employee.absent,
      unrecordedDays: employee.unrecordedDays,
      overtime: formatDuration(total("overtimeSeconds")),
      required: formatDuration(total("requiredSeconds")),
      worked: formatDuration(total("workedSeconds")),
      late: formatDuration(total("lateSeconds")),
      earlyLeave: formatDuration(total("earlyLeaveSeconds")),
      permission: formatDuration(total("permissionSeconds")),
      deficit: formatDuration(total("deficitSeconds")),
      workSchedule: employee.workSchedule || t("غير محدد"),
    };
  });
  const comprehensiveColumns: ReportColumn[] = [
    { key: "empId", label: t("الرقم الوظيفي"), width: 14 },
    { key: "name", label: t("اسم الموظف"), width: 24 },
    { key: "workTime", label: t("وقت العمل"), width: 15 },
    { key: "periodDays", label: t("أيام العمل في الفترة"), width: 15 },
    { key: "presentDays", label: t("مجموع أيام الحضور"), width: 16 },
    { key: "absentDays", label: t("مجموع أيام الغياب"), width: 16 },
    { key: "unrecordedDays", label: t("أيام عمل بلا تسجيل"), width: 16 },
    { key: "overtime", label: t("إجمالي الساعات الإضافية"), width: 18 },
    { key: "required", label: t("إجمالي الساعات المستحقة في الفترة"), width: 21 },
    { key: "worked", label: t("إجمالي ساعات العمل"), width: 18 },
    { key: "late", label: t("إجمالي ساعات التأخير"), width: 18 },
    { key: "earlyLeave", label: t("إجمالي الخروج المبكر"), width: 18 },
    { key: "permission", label: t("إجمالي ساعات الاستئذان"), width: 18 },
    { key: "deficit", label: t("إجمالي ساعات النقص"), width: 18 },
    { key: "workSchedule", label: t("جدول العمل"), width: 18 },
  ];
  const comprehensiveReportOptions = { title: t("النتائج (تقرير شامل)"), subtitle: `${dateFrom} — ${dateTo}`, columns: comprehensiveColumns, rows: comprehensiveRows, fileName: `comprehensive-attendance-${dateFrom}-${dateTo}`, landscape: true, summary: [{ label: t("عدد الموظفين"), value: comprehensiveRows.length }] };
  /** وصف جدول دوام الموظف: أيام العمل وأوقاتها (أو سبب الاعتماد على الأحد إلى الخميس) */
  const scheduleHint = (employee: Employee) => {
    const schedule = employee.schedule;
    if (!schedule) {
      if (employee.scheduleMissing) return t("الجدول غير موجود في جداول الدوام؛ تُحتسب أيام العمل من الأحد إلى الخميس");
      return employee.workSchedule ? t("تعذر تحميل الجدول؛ تُحتسب أيام العمل من الأحد إلى الخميس") : t("بلا جدول دوام؛ أيام العمل من الأحد إلى الخميس");
    }
    const times = schedule.flexible || !schedule.periods.length
      ? `${t("جدول متغير")}: ${formatNumber(round2(schedule.dailyMinutes / 60))} ${t("ساعة يوميًا")}`
      : schedule.periods.map((period) => `${period.start}–${period.end}`).join("، ");
    return `${workDaysText(schedule.workDays, t)} · ${times}`;
  };
  const printCurrentReport = () => window.print();
  const showDepartmentSummary = () => false;

  return <Layout><main dir={direction} className="space-y-4">
    <style>{`
      .attendance-print-only { display: none; }
      @media print {
        @page { size: A3 landscape; margin: 8mm; }
        body * { visibility: hidden !important; }
        #attendance-print-area, #attendance-print-area * { visibility: visible !important; }
        #attendance-print-area { position: absolute; inset: 0; width: 100%; background: white; }
        .attendance-no-print { display: none !important; }
        .attendance-print-only { display: block !important; }
        .attendance-print-page { break-after: page; box-shadow: none !important; border: 0 !important; }
        .attendance-print-page:last-child { break-after: auto; }
        .attendance-detail-table { font-size: 9px !important; }
        .attendance-detail-table th, .attendance-detail-table td { padding: 5px !important; }
      }
    `}</style>
    <header className="attendance-no-print flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold text-[#004e89]">{t("حساب الدوام")}</h1><p className="mt-1 text-sm text-slate-500">{t("تقرير حضور الموظفين المرتبط بالفروع والإدارات والأقسام المحفوظة")}</p></div><div className="flex gap-2"><Button variant="outline" size="icon" onClick={() => void loadData()} title={t("تحديث")}><RefreshCw className="h-4 w-4" /></Button><Button variant="outline" size="icon" onClick={printCurrentReport} disabled={!reportRows.length} title={t("طباعة / PDF")}><Printer className="h-4 w-4" /></Button><Button variant="outline" size="icon" onClick={() => exportReportExcel(mode === "departments" ? comprehensiveReportOptions : reportOptions)} disabled={mode === "departments" ? !comprehensiveRows.length : !reportRows.length} title={t("تحميل Excel")}><Download className="h-4 w-4" /></Button></div></header>
    <section className="attendance-no-print rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="space-y-1 text-xs font-medium text-slate-600"><span className="block">{t("من تاريخ")}</span><Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
      <label className="space-y-1 text-xs font-medium text-slate-600"><span className="block">{t("إلى تاريخ")}</span><Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
      <FilterSelect label={t("الفرع")} value={branch} onChange={(value) => { setBranch(value); setDepartmentId(ALL); setSectionId(ALL); setSelectedEmployeeIds([]); }} options={branches.map((item) => ({ value: item.id, label: item.name }))} allLabel={t("الكل")} />
      <FilterSelect label={t("الإدارة")} value={departmentId} onChange={(value) => { setDepartmentId(value); setSectionId(ALL); setSelectedEmployeeIds([]); }} options={departmentOptions} allLabel={t("الكل")} />
      <FilterSelect label={t("القسم")} value={sectionId} onChange={(value) => { setSectionId(value); setSelectedEmployeeIds([]); }} options={sectionOptions} allLabel={t("الكل")} />
      <FilterSelect label={t("المسمى الوظيفي")} value={jobTitle} onChange={setJobTitle} options={jobTitles.map((name) => ({ value: name, label: name }))} allLabel={t("الكل")} />
      <FilterSelect label={t("جدول العمل")} value={workSchedule} onChange={setWorkSchedule} options={workSchedules.map((name) => ({ value: name, label: name }))} allLabel={t("الكل")} />
      <FilterSelect label={t("مكان العمل")} value={workLocation} onChange={setWorkLocation} options={workLocations.map((name) => ({ value: name, label: name }))} allLabel={t("الكل")} />
      <FilterSelect label={t("حالة الدوام")} value={statusFilter} onChange={(value) => setStatusFilter(value as StatusFilter)} options={[{ value: "present", label: t("حاضر") }, { value: "absent", label: t("غائب") }, { value: "late", label: t("متأخر") }, { value: "leave", label: t("إجازة") }]} allLabel={t("الكل")} />
      <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
        <Button
          type="button"
          onClick={() => setMode("employees")}
          aria-pressed={mode === "employees"}
          className={mode === "employees" ? "bg-[#075f94] text-white hover:bg-[#064f7b]" : "border border-[#075f94] bg-white text-[#075f94] hover:bg-blue-50"}
        >
          {t("اختيار الموظفين (تفصيلي)")}
        </Button>
        <Button
          type="button"
          onClick={() => setMode("departments")}
          aria-pressed={mode === "departments"}
          className={mode === "departments" ? "bg-[#075f94] text-white hover:bg-[#064f7b]" : "border border-[#075f94] bg-white text-[#075f94] hover:bg-blue-50"}
        >
          {t("تقرير شامل (ملخص)")}
        </Button>
      </div>
    </div></section>
    <section className="attendance-no-print overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="font-bold text-slate-800">{t("الموظفون")}</h2>
          <p className="mt-1 text-xs text-slate-500">{t("حدد موظفًا واحدًا أو عدة موظفين لإنشاء التقرير")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-[#075f94]">{t("المحدد")}: {formatNumber(selectedEmployeeIds.length)}</span>
          <div className="relative w-64 max-w-full"><Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/><Input value={employeePickerSearch} onChange={(event) => setEmployeePickerSearch(event.target.value)} placeholder={t("بحث عن موظف...")} className="pr-9" /></div>
        </div>
      </div>
      <div className="max-h-80 overflow-auto">
        <table className="min-w-full text-xs">
          <thead className="sticky top-0 z-10 bg-[#075f94] text-white"><tr><th className="w-12 px-3 py-3"><input type="checkbox" checked={allSelectableSelected} onChange={toggleAllSelectable} aria-label={t("تحديد الكل")} className="h-4 w-4 accent-blue-600" /></th><th className="px-3 py-3">{t("الصورة")}</th><th className="px-3 py-3 text-right">{t("الاسم")}</th><th className="px-3 py-3 text-right">{t("المسمى الوظيفي")}</th><th className="px-3 py-3 text-right">{t("الإدارة")}</th><th className="px-3 py-3 text-right">{t("القسم")}</th><th className="px-3 py-3 text-right">{t("جدول العمل")}</th><th className="px-3 py-3 text-right">{t("مكان العمل")}</th></tr></thead>
          <tbody>{loading ? <tr><td colSpan={8} className="py-10 text-center text-slate-400">{t("جاري التحميل...")}</td></tr> : selectableEmployees.length === 0 ? <tr><td colSpan={8} className="py-10 text-center text-slate-400">{t("لا يوجد موظفون مرتبطون بالفلاتر المحددة")}</td></tr> : selectableEmployees.map((employee) => {
            const selected = selectedEmployeeIds.includes(employee.id);
            return <tr key={employee.id} onClick={() => toggleEmployee(employee.id)} className={`cursor-pointer border-b transition-colors ${selected ? "bg-blue-50" : "hover:bg-slate-50"}`}><td className="px-3 py-3 text-center"><input type="checkbox" checked={selected} onChange={() => toggleEmployee(employee.id)} onClick={(event) => event.stopPropagation()} aria-label={`${t("تحديد")} ${employee.name}`} className="h-4 w-4 accent-blue-600" /></td><td className="px-3 py-2"><div className="mx-auto flex h-10 w-10 items-center justify-center overflow-hidden rounded-md bg-slate-100 text-sm font-bold text-slate-500"><EmployeePhoto value={employee.photoUrl} name={employee.name} /></div></td><td className="px-3 py-3 font-semibold text-slate-800"><div>{employee.name}</div><div className="mt-0.5 font-normal text-slate-400">{employee.empId}</div></td><td className="px-3 py-3">{employee.jobTitle || "—"}</td><td className="px-3 py-3">{employee.department || "—"}</td><td className="px-3 py-3">{employee.section || "—"}</td><td className="px-3 py-3">{employee.workSchedule || "—"}</td><td className="px-3 py-3">{employee.workLocation || "—"}</td></tr>;
          })}</tbody>
        </table>
      </div>
    </section>
    {selectedEmployeeIds.length === 0 && !loading && <div className="attendance-no-print rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{t("حدد موظفًا واحدًا على الأقل لعرض التقرير وطباعته")}</div>}
    {mode === "employees" && selectedEmployeeIds.length > 0 && <section className="attendance-no-print rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => openAttendanceAction("punch")} className="bg-[#075f94] text-white hover:bg-[#064f7b]">{t("أضف دخول/خروج")}</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => openAttendanceAction("bulk")}>{t("إضافة تحضير متعدد")}</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => openAttendanceAction("overtime")}>{t("أضف ساعات إضافية")}</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => openAttendanceAction("permission")}>{t("أضف ساعات استئذان")}</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => openAttendanceAction("clear-punches")} className="border-red-200 text-red-700 hover:bg-red-50">{t("حذف دخول/خروج")}</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => openAttendanceAction("delete-bulk")} className="border-red-200 text-red-700 hover:bg-red-50">{t("حذف تحضير متعدد")}</Button>
      </div>
      {attendanceAction && <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50/50 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {rangeActions.includes(attendanceAction) ? <>
            <label className="space-y-1 text-xs font-medium text-slate-600"><span className="block">{t("من تاريخ")}</span><Input type="date" min={dateFrom} max={dateTo} value={actionDateFrom} onChange={(event) => setActionDateFrom(event.target.value)} /></label>
            <label className="space-y-1 text-xs font-medium text-slate-600"><span className="block">{t("إلى تاريخ")}</span><Input type="date" min={actionDateFrom || dateFrom} max={dateTo} value={actionDateTo} onChange={(event) => setActionDateTo(event.target.value)} /></label>
          </> : <label className="space-y-1 text-xs font-medium text-slate-600"><span className="block">{t("التاريخ")}</span><Input type="date" min={dateFrom} max={dateTo} value={actionDate} onChange={(event) => setActionDate(event.target.value)} /></label>}
          {attendanceAction === "punch" && <><label className="space-y-1 text-xs font-medium text-slate-600"><span className="block">{t("وقت الدخول")}</span><Input type="time" value={actionCheckIn} onChange={(event) => setActionCheckIn(event.target.value)} /></label><label className="space-y-1 text-xs font-medium text-slate-600"><span className="block">{t("وقت الخروج")}</span><Input type="time" value={actionCheckOut} onChange={(event) => setActionCheckOut(event.target.value)} /></label></>}
          {(attendanceAction === "overtime" || attendanceAction === "permission") && <label className="space-y-1 text-xs font-medium text-slate-600"><span className="block">{t("عدد الساعات")}</span><Input type="number" min="0.25" step="0.25" value={actionHours} onChange={(event) => setActionHours(event.target.value)} /></label>}
          {attendanceAction !== "delete-bulk" && <label className="space-y-1 text-xs font-medium text-slate-600"><span className="block">{t("السبب / الملاحظات")}</span><Input value={actionReason} onChange={(event) => setActionReason(event.target.value)} /></label>}
        </div>
        <p className="mt-3 text-xs text-slate-600">{rangeActions.includes(attendanceAction) ? `${t("سيتم التطبيق على الموظفين المحددين خلال الفترة")}: ${actionDateFrom} — ${actionDateTo}` : `${t("سيتم التطبيق على الموظفين المحددين")}: ${formatNumber(actionEmployees.length)}`}</p>
        {(attendanceAction === "clear-punches" || attendanceAction === "delete-bulk") && <p className="mt-2 text-xs font-semibold text-red-700">{attendanceAction === "delete-bulk" ? t("سيتم حذف سجلات التحضير الإداري فقط ولن تُحذف بصمات الموظفين الجغرافية") : t("سيتم مسح وقت الدخول والخروج من سجلات الحضور (حاضر/متأخر) في أيام عمل كل موظف حسب جدول دوامه فقط، وتتحول حالة اليوم إلى غائب فيُخصم من الراتب؛ لا تُمس أيام الراحة ولا العطل الرسمية ولا الإجازات المعتمدة ولا سجلات الإجازة والمأمورية والعمل عن بعد، ولا بصمات الموظفين الموثّقة من البوابة")}</p>}
        {(attendanceAction === "punch" || attendanceAction === "bulk") && <p className="mt-2 text-xs text-slate-600">{t(attendanceAction === "bulk" ? "تُحضَّر أيام عمل كل موظف حسب جدول دوامه فقط (تُستثنى أيام راحته والعطل الرسمية وإجازاته المعتمدة؛ اليوم الواحد يُقبل كما هو)، وتُضاف الأيام غير المسجلة فقط: لا يُعدَّل أي سجل موجود ولا تُستبدل بصمات الموظفين الموثّقة من بوابة الموظف" : "لن تُستبدل بصمات الموظفين الموثّقة من بوابة الموظف؛ يُحدَّث السجل الموجود عند اختيار موظف واحد فقط، ولعدة موظفين تُضاف السجلات غير المسجلة فقط. وقت انصراف قبل وقت الحضور يُعد وردية ليلية")}</p>}
        {attendanceAction === "overtime" && <p className="mt-2 text-xs text-slate-600">{t("المبلغ = الساعات × (أجر الساعة الفعلي + 50% من أجر الساعة الأساسي) وفق المادة 107 من نظام العمل؛ أجر الساعة الأساسي = الراتب الأساسي ÷ 30 ÷ ساعات العمل اليومية، وأجر الساعة الفعلي = إجمالي الراتب (أو الأساسي إن لم يُسجَّل) ÷ 30 ÷ ساعات العمل اليومية؛ ساعات العمل اليومية من جدول دوام الموظف، وإلا من ملفه. يُتخطى من لم يُسجَّل راتبه الأساسي ومن لديه ساعات إضافية مسجلة في نفس التاريخ")}</p>}
        <div className="mt-4 flex gap-2"><Button type="button" size="sm" onClick={() => void saveAttendanceAction()} disabled={actionSaving}>{actionSaving ? t("جاري الحفظ...") : t("تأكيد العملية")}</Button><Button type="button" variant="outline" size="sm" onClick={() => setAttendanceAction(null)} disabled={actionSaving}>{t("إلغاء")}</Button></div>
      </div>}
      {actionMessage && <p className="mt-3 text-sm text-slate-700">{actionMessage}</p>}
    </section>}
    {error && <div className="attendance-no-print rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
    {calendarWarnings.length > 0 && !error && <div className="attendance-no-print space-y-1 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{calendarWarnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
    {selectedEmployeeIds.length > 0 && !error && !loading && <div className="attendance-no-print rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-xs leading-6 text-sky-800">
      <p className="font-semibold">{countUnrecordedAsAbsent ? t("الأيام بلا تسجيل تُحتسب غيابًا (إعداد الراتب المكتسب حسب الحضور): يوم العمل الماضي بلا أي تسجيل يظهر «غائب (بلا تسجيل)» ويُخصم من الراتب.") : t("الغياب = غياب مسجّل صراحة (حالة غائب) ويُخصم من الراتب؛ يوم العمل الماضي بلا أي تسجيل يظهر «لا يوجد تسجيل» ولا يُحتسب غيابًا ما لم يُفعَّل إعداد «الراتب المكتسب حسب الحضور» في إعدادات حساب الراتب.")}</p>
      <p>{t("أيام العمل والساعات المستحقة والتأخير والخروج المبكر حسب جدول دوام كل موظف (من لا جدول له: الأحد إلى الخميس)، وهي القاعدة نفسها المستخدمة في كشف الرواتب.")}</p>
    </div>}
    {mode === "employees" && selectedEmployeesForDetail.length > 0 && <div id="attendance-print-area" className="space-y-4">
      {selectedEmployeesForDetail.map((employee) => {
        const rows = visibleDetailedRows.filter((row) => row.id === employee.id);
        // الإجماليات من كل أيام الفترة (لا من الصفوف الظاهرة فقط) حتى لا يغيّرها خيار إخفاء الأيام بدون تسجيل
        const employeeDays = detailRowsByEmployee.get(employee.id) ?? [];
        const sumSeconds = (field: "workedSeconds" | "requiredSeconds" | "lateSeconds" | "earlyLeaveSeconds" | "permissionSeconds" | "deficitSeconds" | "overtimeSeconds") => employeeDays.reduce((sum, row) => sum + row[field], 0);
        const presentDays = employeeDays.filter((row) => row.counted && (row.category === "present" || row.category === "late")).length;
        const absentDays = employeeDays.filter((row) => row.counted && row.category === "absent").length;
        const leaveDays = employeeDays.filter((row) => row.counted && row.category === "leave").length;
        const unrecordedDays = employeeDays.filter((row) => row.unrecorded && row.category !== "absent").length;
        return <article key={employee.id} className="attendance-print-page overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="attendance-no-print flex flex-wrap items-center justify-between gap-3 border-b bg-white px-5 py-3">
            <div className="flex flex-wrap items-center gap-5 text-sm">
              <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={showUnrecordedDays} onChange={(event) => setShowUnrecordedDays(event.target.checked)} className="h-4 w-4 accent-[#075f94]" />{t("إظهار الأيام بدون تسجيل")}</label>
              <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={showNotes} onChange={(event) => setShowNotes(event.target.checked)} className="h-4 w-4 accent-[#075f94]" />{t("إظهار الملاحظات")}</label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => void loadData()}><RefreshCw className="ms-1 h-4 w-4" />{t("إعادة احتساب التقرير")}</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => exportReportExcel(reportOptions)} disabled={!reportRows.length}><Download className="ms-1 h-4 w-4" />{t("تحميل Excel")}</Button>
              <Button type="button" size="sm" onClick={() => window.print()} disabled={!reportRows.length} className="bg-[#075f94] text-white hover:bg-[#064f7b]"><Printer className="ms-1 h-4 w-4" />{t("طباعة / حفظ PDF")}</Button>
            </div>
          </div>
          <div className="attendance-print-only border-b-2 border-[#075f94] px-6 py-4 text-center">
            <h1 className="text-2xl font-bold text-[#075f94]">{COMPANY_PROFILE.companyNameAr}</h1>
            <p className="mt-1 text-sm font-semibold text-slate-600">{t("تقرير حساب الدوام التفصيلي")}</p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 border-b bg-slate-50 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-lg border bg-white text-xl font-bold text-slate-500"><EmployeePhoto value={employee.photoUrl} name={employee.name} /></div>
              <div><h2 className="text-lg font-bold text-slate-900">{employee.name}</h2><p className="text-sm text-slate-500">{employee.jobTitle || t("غير محدد")}</p></div>
            </div>
            <div className="attendance-no-print flex flex-wrap gap-2 text-xs"><span className="rounded-md bg-emerald-50 px-3 py-2 text-emerald-700">{t("حاضر")}: {formatNumber(presentDays)}</span><span className="rounded-md bg-red-50 px-3 py-2 text-red-700">{t("غائب")}: {formatNumber(absentDays)}</span><span className="rounded-md bg-sky-50 px-3 py-2 text-sky-700">{t("إجازة")}: {formatNumber(leaveDays)}</span>{unrecordedDays > 0 && <span className="rounded-md bg-slate-100 px-3 py-2 text-slate-600">{t("لا يوجد تسجيل")}: {formatNumber(unrecordedDays)}</span>}{employee.attendanceExempt && <span className="rounded-md bg-amber-50 px-3 py-2 text-amber-700">{t("معفى من تسجيل الحضور")}</span>}</div>
          </div>
          <div className="grid gap-px border-b bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
            {[{ label: t("الرقم الوظيفي"), value: employee.empId }, { label: t("الإدارة"), value: employee.department || "—" }, { label: t("القسم"), value: employee.section || "—" }, { label: t("الفرع"), value: employee.branch || "—" }, { label: t("مكان العمل"), value: employee.workLocation || "—" }, { label: t("جدول العمل"), value: employee.workSchedule || "—", hint: scheduleHint(employee) }, { label: t("من تاريخ"), value: dateFrom }, { label: t("إلى تاريخ"), value: dateTo }].map((item) => <div key={item.label} className="bg-white px-4 py-3"><span className="block text-xs text-slate-500">{item.label}</span><strong className="mt-1 block text-sm text-slate-800">{item.value}</strong>{item.hint && <span className="mt-0.5 block text-[11px] text-slate-500">{item.hint}</span>}</div>)}
          </div>
          <div className="attendance-no-print flex flex-wrap gap-4 border-b px-5 py-3 text-xs"><span className="text-emerald-700">● {t("حاضر")}</span><span className="text-amber-600">● {t("متأخر")}</span><span className="text-red-600">● {t("غائب")}</span><span className="text-sky-600">● {t("إجازة")}</span><span className="text-slate-500">● {t("لا يوجد تسجيل")}</span></div>
          <div className="overflow-x-auto"><table className="attendance-detail-table min-w-full text-xs"><thead className="bg-[#075f94] text-white"><tr><th className="px-3 py-3">{t("التاريخ")}</th><th className="px-3 py-3">{t("الحالة")}</th><th className="px-3 py-3">{t("دخول")}</th><th className="px-3 py-3">{t("خروج")}</th><th className="px-3 py-3">{t("ساعات الحضور")}</th><th className="px-3 py-3">{t("الساعات المستحقة")}</th><th className="px-3 py-3">{t("ساعات التأخير")}</th><th className="px-3 py-3">{t("خروج مبكر")}</th><th className="px-3 py-3">{t("ساعات الاستئذان")}</th><th className="px-3 py-3">{t("ساعات النقص")}</th><th className="px-3 py-3">{t("الساعات الإضافية")}</th>{showNotes && <th className="px-3 py-3">{t("ملاحظات")}</th>}</tr></thead><tbody>{rows.map((row) => <tr key={row.rowId} className="border-b odd:bg-white even:bg-slate-50"><td className="whitespace-nowrap px-3 py-2 text-center">{row.date}</td><td className="px-3 py-2 text-center"><span className={`rounded px-2 py-1 font-semibold ${row.category === "present" ? "bg-emerald-50 text-emerald-700" : row.category === "late" ? "bg-amber-50 text-amber-700" : row.category === "leave" ? "bg-sky-50 text-sky-700" : row.category === "absent" ? "bg-red-50 text-red-700" : row.category === "holiday" ? "bg-violet-50 text-violet-700" : "bg-slate-100 text-slate-500"}`}>{row.statusLabel}</span></td><td className="px-3 py-2 text-center text-emerald-700">{row.checkIn}</td><td className="px-3 py-2 text-center text-red-600">{row.checkOut}</td><td className="px-3 py-2 text-center font-semibold">{row.worked}</td><td className="px-3 py-2 text-center">{row.required}</td><td className="px-3 py-2 text-center text-amber-700">{row.late}</td><td className="px-3 py-2 text-center text-orange-700">{row.earlyLeave}</td><td className="px-3 py-2 text-center text-cyan-700">{row.permission}</td><td className="px-3 py-2 text-center text-red-700">{row.deficit}</td><td className="px-3 py-2 text-center text-blue-700">{row.overtime}</td>{showNotes && <td className="max-w-40 px-3 py-2">{row.notes || "—"}</td>}</tr>)}</tbody></table></div>
          <div className="grid gap-px bg-slate-200 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">{[{ label: t("إجمالي ساعات الحضور"), value: formatDuration(sumSeconds("workedSeconds")) }, { label: t("إجمالي الساعات المستحقة"), value: formatDuration(sumSeconds("requiredSeconds")) }, { label: t("إجمالي ساعات التأخير"), value: formatDuration(sumSeconds("lateSeconds")) }, { label: t("إجمالي الخروج المبكر"), value: formatDuration(sumSeconds("earlyLeaveSeconds")) }, { label: t("إجمالي ساعات الاستئذان"), value: formatDuration(sumSeconds("permissionSeconds")) }, { label: t("إجمالي ساعات النقص"), value: formatDuration(sumSeconds("deficitSeconds")) }, { label: t("إجمالي الساعات الإضافية"), value: formatDuration(sumSeconds("overtimeSeconds")) }, { label: t("أيام الحضور"), value: formatNumber(presentDays) }, { label: t("أيام الغياب"), value: formatNumber(absentDays) }, { label: t("أيام الإجازات"), value: formatNumber(leaveDays) }, { label: t("أيام الفترة"), value: formatNumber(employeeDays.length) }, { label: t("نسبة الحضور"), value: `${formatNumber(employee.attendanceRate, { maximumFractionDigits: 1 })}%` }].map((item) => <div key={item.label} className="bg-white px-3 py-3 text-center"><span className="block text-xs text-slate-500">{item.label}</span><strong className="mt-1 block text-sm text-[#075f94]">{item.value}</strong></div>)}</div>
          <div className="attendance-print-only px-5 py-3 text-left text-[10px] text-slate-400">{t("تاريخ إصدار التقرير")}: {new Date().toLocaleDateString("ar-SA")}</div>
        </article>;
      })}
    </div>}
    {mode === "departments" && selectedEmployeeIds.length > 0 && <section id="attendance-print-area" className="overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm">
      <div className="attendance-no-print flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
        <h2 className="text-lg font-bold text-slate-900">{t("النتائج (تقرير شامل)")}</h2>
        <div className="flex gap-2"><Button type="button" variant="outline" size="sm" onClick={() => exportReportExcel(comprehensiveReportOptions)} disabled={!comprehensiveRows.length}><Download className="ms-1 h-4 w-4" />{t("تصدير إلى ملف Excel")}</Button><Button type="button" variant="outline" size="sm" onClick={() => window.print()} disabled={!comprehensiveRows.length}><Printer className="ms-1 h-4 w-4" />{t("طباعة")}</Button></div>
      </div>
      <div className="border-b border-slate-400 px-5 py-5">
        <div className="flex items-start justify-between gap-6">
          <img src={COMPANY_PROFILE.logoUrl} alt={t("شعار الشركة")} className="h-20 w-28 object-contain" />
          <div className="grid flex-1 gap-x-8 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <span>{t("من تاريخ")}: <b>{dateFrom}</b></span><span>{t("إلى تاريخ")}: <b>{dateTo}</b></span>
            <span>{t("الإدارة")}: <b>{departmentId === ALL ? t("الكل") : departments.find((item) => item.id === departmentId)?.name || t("الكل")}</b></span>
            <span>{t("القسم")}: <b>{sectionId === ALL ? t("الكل") : sections.find((item) => item.id === sectionId)?.name || t("الكل")}</b></span>
            <span>{t("الفرع")}: <b>{branch === ALL ? t("الكل") : branches.find((item) => item.id === branch)?.name || t("الكل")}</b></span>
            <span>{t("مكان العمل")}: <b>{workLocation === ALL ? t("الكل") : workLocation}</b></span>
            <span>{t("عدد الموظفين")}: <b>{formatNumber(comprehensiveRows.length)}</b></span>
          </div>
        </div>
      </div>
      <div className="overflow-x-auto"><table className="min-w-[1700px] border-collapse text-[11px]"><thead className="bg-[#075f94] text-white"><tr>{comprehensiveColumns.map((column) => <th key={column.key} className="border border-white/30 px-3 py-3 text-center font-bold whitespace-normal">{column.label}</th>)}</tr></thead><tbody>{comprehensiveRows.map((row) => <tr key={String(row.empId)} className="border-b odd:bg-white even:bg-slate-50">{comprehensiveColumns.map((column) => <td key={column.key} className="border border-slate-200 px-3 py-3 text-center">{String(row[column.key as keyof typeof row] ?? "")}</td>)}</tr>)}</tbody></table></div>
    </section>}
    {showDepartmentSummary() && <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4"><div className="flex flex-wrap gap-4 text-xs"><span className="text-emerald-700">● {t("حاضر")}</span><span className="text-red-600">● {t("غائب")}</span><span className="text-amber-600">● {t("متأخر")}</span><span className="text-sky-600">● {t("إجازة")}</span></div><div className="flex items-center gap-3"><label className="flex items-center gap-2 text-xs text-slate-500">{t("عرض")}<select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className="rounded border px-2 py-1"><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option></select></label><div className="relative w-64"><Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("بحث...")} className="pr-9" /></div></div></div>
      <div className="overflow-x-auto"><table className="min-w-full text-xs"><thead className="bg-[#075f94] text-white"><tr>{columns.map((column) => <th key={column.key} className="whitespace-nowrap px-3 py-3 text-center font-semibold">{column.label}</th>)}</tr></thead><tbody>{loading ? <tr><td colSpan={columns.length} className="py-16 text-center text-slate-400">{t("جاري التحميل...")}</td></tr> : !pagedRows.length ? <tr><td colSpan={columns.length} className="py-16 text-center text-slate-400">{t("لا توجد بيانات")}</td></tr> : mode === "employees" ? (pagedRows as EmployeeSummary[]).map((row) => <tr key={row.id} className="border-b hover:bg-slate-50"><td className="px-3 py-3 text-center">{row.empId}</td><td className="px-3 py-3 font-semibold">{row.name}</td><td className="px-3 py-3">{row.department || "—"}</td><td className="px-3 py-3">{row.section || "—"}</td><td className="px-3 py-3">{row.jobTitle || "—"}</td><td className="px-3 py-3">{row.branch || "—"}</td><td className="px-3 py-3">{row.workSchedule || "—"}</td><td className="px-3 py-3">{row.workLocation || "—"}</td><td className="px-3 py-3 text-center text-emerald-700">{formatNumber(row.present)}</td><td className="px-3 py-3 text-center text-red-600">{formatNumber(row.absent)}</td><td className="px-3 py-3 text-center text-amber-600">{formatNumber(row.late)}</td><td className="px-3 py-3 text-center text-sky-600">{formatNumber(row.leave)}</td><td className="px-3 py-3 text-center font-bold">{formatNumber(row.attendanceRate, { maximumFractionDigits: 1 })}%</td></tr>) : (pagedRows as DepartmentSummary[]).map((row) => <tr key={row.id} className="border-b hover:bg-slate-50"><td className="px-3 py-3 font-semibold">{row.department}</td><td className="px-3 py-3 text-center">{formatNumber(row.employees)}</td><td className="px-3 py-3 text-center text-emerald-700">{formatNumber(row.present)}</td><td className="px-3 py-3 text-center text-red-600">{formatNumber(row.absent)}</td><td className="px-3 py-3 text-center text-amber-600">{formatNumber(row.late)}</td><td className="px-3 py-3 text-center text-sky-600">{formatNumber(row.leave)}</td><td className="px-3 py-3 text-center font-bold">{formatNumber(row.attendanceRate, { maximumFractionDigits: 1 })}%</td></tr>)}</tbody></table></div>
      <footer className="flex items-center justify-between border-t px-4 py-3 text-xs text-slate-500"><span>{formatNumber(allRows.length)} {t("من السجلات")}</span><div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={safePage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>{t("السابق")}</Button><span>{formatNumber(safePage)} / {formatNumber(totalPages)}</span><Button variant="outline" size="sm" disabled={safePage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>{t("التالي")}</Button></div></footer>
    </section>}
  </main></Layout>;
}
