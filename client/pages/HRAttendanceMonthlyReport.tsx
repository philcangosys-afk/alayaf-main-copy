import { useEffect, useMemo, useState } from "react";
import Layout from "@/components/Layout";
import { RefreshCw, Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { exportReportExcel, printReport, type ReportColumn } from "@/lib/reportExport";
import { useI18n } from "@/i18n";
import { isWeekend, monthRange, riyadhMonth, riyadhToday } from "@/lib/hrDates";
import { ACTIVE_EMPLOYEE_STATUSES } from "@/lib/hrStatus";
import { fetchAllRows } from "@/lib/fetchAll";
import { hrRequestErrorText } from "@/lib/hrErrors";
import { approvedLeaveDatesByEmployee, loadApprovedLeaves, loadOfficialHolidays, officialHolidayDates } from "@/lib/attendanceManual";
import { classifyAttendanceDay, type DayCategory } from "@/lib/attendanceRules";
import { effectiveLateMinutes, isScheduledWorkDay, loadWorkSchedules, scheduleForEmployee } from "@/lib/workSchedule";
import { loadPayrollPolicy } from "@/lib/payrollCalc";

/** status: نص الخلية المعروض، category: تصنيف اليوم بالقاعدة الموحدة مع حساب الدوام وكشف الرواتب */
type AttendanceDay = { status: string; notes: string; category: DayCategory; counted?: boolean };
type MonthlyAttendance = {
  empId: string;
  empName: string;
  departmentId: string;
  sectionId: string;
  department: string;
  section: string;
  attendance: Record<number, AttendanceDay>;
};
type OrganizationOption = { id: string; name: string; departmentId?: string };

const ALL = "الكل";
const NONE_STATUS = "لا يوجد تسجيل";
const EMPTY_DAY: AttendanceDay = { status: NONE_STATUS, notes: "", category: "none" };
const WEEKEND_STATUS = "عطلة نهاية أسبوع";
const HOLIDAY_STATUS = "عطلة رسمية";
const LEAVE_STATUS = "إجازة";
const ABSENT_STATUS = "غائب";
const LATE_STATUS = "متأخر";
// حالات الحضور المحفوظة: حاضر | غائب | إجازة | عمل عن بعد ("غياب" صيغة قديمة)
const PRESENT_STATUSES = ["حاضر", "عمل عن بعد"];
const LEAVE_STATUSES = [LEAVE_STATUS, "مأمورية"];
const EMPLOYEE_COLUMNS = "id, emp_id, name, branch_id, branch, department_id, section_id, directorate, department, hire_date, work_schedule";
const errorCode = (error: unknown) => String((error as { code?: unknown } | null)?.code ?? "");
/** الموظفون النشطون مع عمود الإعفاء من الحضور؛ قاعدة بيانات بلا عمود attendance_exempt (42703) يُعاد الجلب بدونه */
const loadActiveEmployees = async () => {
  const page = (columns: string) => fetchAllRows<Record<string, any>>((from, to) => supabase.from("employees").select(columns).in("status", ACTIVE_EMPLOYEE_STATUSES).order("name").order("id").range(from, to) as unknown as PromiseLike<{ data: Record<string, any>[] | null; error: unknown }>);
  try {
    return await page(`${EMPLOYEE_COLUMNS}, attendance_exempt`);
  } catch (error) {
    if (errorCode(error) !== "42703") throw error;
    return page(EMPLOYEE_COLUMNS);
  }
};
/** نص الخلية من تصنيف اليوم: يُبقى نص السجل المحفوظ حين يطابق التصنيف (عمل عن بعد، مأمورية) */
const cellStatus = (category: DayCategory, recordStatus: string) => {
  switch (category) {
    case "present": return PRESENT_STATUSES.includes(recordStatus) ? recordStatus : PRESENT_STATUSES[0];
    case "late": return LATE_STATUS;
    case "leave": return LEAVE_STATUSES.includes(recordStatus) ? recordStatus : LEAVE_STATUS;
    case "absent": return ABSENT_STATUS;
    case "holiday": return HOLIDAY_STATUS;
    case "weekend": return WEEKEND_STATUS;
    default: return NONE_STATUS;
  }
};

export function AttendanceMonthlyReportContent({ embedded = false }: { embedded?: boolean }) {
  const { t, direction, locale, formatNumber } = useI18n();
  const [currentYear, currentMonth] = riyadhMonth().split("-").map(Number);
  const [data, setData] = useState<MonthlyAttendance[]>([]);
  const [departments, setDepartments] = useState<OrganizationOption[]>([]);
  const [sections, setSections] = useState<OrganizationOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(currentMonth);
  const [departmentFilter, setDepartmentFilter] = useState(ALL);
  const [sectionFilter, setSectionFilter] = useState(ALL);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  /** تحذيرات لا توقف التقرير (تعذر تحميل الإجازات أو جداول الدوام أو إعدادات الراتب) */
  const [calendarWarnings, setCalendarWarnings] = useState<string[]>([]);
  /** إعداد الرواتب "الراتب المكتسب حسب الحضور": يوم العمل الماضي بلا تسجيل يُعد غيابًا */
  const [countUnrecordedAsAbsent, setCountUnrecordedAsAbsent] = useState(false);

  const safeYear = Number.isFinite(year) && year > 0 ? year : currentYear;
  const safeMonth = Number.isFinite(month) && month >= 1 && month <= 12 ? month : currentMonth;
  const monthKey = `${safeYear}-${String(safeMonth).padStart(2, "0")}`;
  const dayKey = (day: number) => `${monthKey}-${String(day).padStart(2, "0")}`;
  const isWeekendDay = (day: number) => isWeekend(dayKey(day));
  const daysInMonth = new Date(safeYear, safeMonth, 0).getDate();
  const days = useMemo(() => Array.from({ length: daysInMonth }, (_, index) => index + 1), [daysInMonth]);
  const localeCode = locale === "ar" ? "ar-SA" : "en-US";
  const monthName = (targetMonth: number) => new Date(safeYear, targetMonth - 1).toLocaleString(localeCode, { month: "long" });

  useEffect(() => {
    let cancelled = false;

    const loadData = async () => {
      setLoading(true);
      try {
        const { from: startDate, to: endDate } = monthRange(monthKey);
        const today = riyadhToday();
        // fetchAllRows لتجاوز حد 1000 صف (حضور شهر كامل لكل الموظفين يتجاوزه بسهولة)
        const [employeeRows, attendanceRows, departmentResult, sectionResult, branchResult, holidayResult, leaveResult, scheduleResult, policyResult] = await Promise.all([
          loadActiveEmployees(),
          fetchAllRows<Record<string, any>>((from, to) => supabase.from("attendance").select("emp_id, date, status, check_in, late_minutes, notes").gte("date", startDate).lte("date", endDate).order("date").order("emp_id").range(from, to)),
          supabase.from("departments").select("id, name, name_en").eq("status", "فعال").order("name"),
          supabase.from("org_sections").select("id, name, name_en, department_id").eq("status", "فعال").order("name"),
          // أسماء الفروع لنطاق العطل الرسمية فقط؛ تعذر تحميلها لا يوقف التقرير
          supabase.from("branches").select("id, name"),
          // العطل والإجازات لا توقف التقرير عند الخطأ (تعيد قائمة فارغة مع الخطأ)
          loadOfficialHolidays(startDate, endDate),
          loadApprovedLeaves(startDate, endDate),
          // جداول الدوام وإعداد الراتب المكتسب: نفس قاعدة حساب الدوام وكشف الرواتب؛ تعذر تحميلها لا يوقف التقرير
          loadWorkSchedules(),
          loadPayrollPolicy(),
        ]);

        const firstError = departmentResult.error ?? sectionResult.error;
        if (firstError) throw firstError;
        if (cancelled) return;
        if (holidayResult.error) console.warn("official_holidays could not be loaded; holidays ignored", holidayResult.error);
        const countUnrecorded = policyResult.policy.countUnrecordedAsAbsent;
        const warnings: string[] = [];
        if (leaveResult.error) warnings.push(`${t("تعذر تحميل الإجازات المعتمدة؛ قد تظهر أيام الإجازة غيابًا")}: ${hrRequestErrorText(leaveResult.error)}`);
        if (scheduleResult.error) warnings.push(`${t("تعذر تحميل جداول الدوام؛ اعتُبرت أيام العمل من الأحد إلى الخميس")}: ${hrRequestErrorText(scheduleResult.error)}`);
        if (policyResult.error) warnings.push(`${t("تعذر قراءة إعدادات حساب الراتب؛ يُحتسب الغياب المسجّل صراحة فقط")}: ${hrRequestErrorText(policyResult.error)}`);
        let missingSchedules = 0;
        // الأسماء العربية المخزنة لمطابقة نطاق العطلة (الفرع/الإدارة/القسم)
        const storedNames = (rows: any[] | null) => new Map<string, string>((rows ?? []).map((row: any) => [String(row.id), String(row.name ?? "").trim()]));
        const branchStoredNames = storedNames(branchResult.error ? [] : branchResult.data);
        const departmentStoredNames = storedNames(departmentResult.data);
        const sectionStoredNames = storedNames(sectionResult.data);
        const leaveDates = approvedLeaveDatesByEmployee(leaveResult.leaves, employeeRows.map((employee) => ({ id: String(employee.id), empId: String(employee.emp_id ?? employee.id ?? "") })), startDate, endDate, leaveResult.codeOwners);

        const localizedName = (row: { name?: unknown; name_en?: unknown }) => {
          const englishName = String(row.name_en ?? "").trim();
          return locale === "en" && englishName ? englishName : String(row.name ?? "");
        };
        const departmentOptions = (departmentResult.data ?? []).map((row) => ({ id: String(row.id), name: localizedName(row) }));
        const sectionOptions = (sectionResult.data ?? []).map((row) => ({ id: String(row.id), name: localizedName(row), departmentId: String(row.department_id ?? "") }));
        const departmentNames = new Map(departmentOptions.map((item) => [item.id, item.name]));
        const sectionNames = new Map(sectionOptions.map((item) => [item.id, item.name]));
        type SavedDay = { status: string; checkIn: string; lateMinutes: number; notes: string };
        const attendanceByEmployee = new Map<string, Record<number, SavedDay>>();

        attendanceRows.forEach((record) => {
          const employeeId = String(record.emp_id ?? "");
          const day = Number(String(record.date ?? "").slice(8, 10));
          if (!employeeId || !Number.isInteger(day) || day < 1 || day > daysInMonth) return;
          const employeeDays = attendanceByEmployee.get(employeeId) ?? {};
          employeeDays[day] = { status: String(record.status ?? "").trim(), checkIn: String(record.check_in ?? ""), lateMinutes: Number(record.late_minutes ?? 0), notes: String(record.notes ?? "") };
          attendanceByEmployee.set(employeeId, employeeDays);
        });

        const rows = employeeRows.map((employee) => {
          const empId = String(employee.emp_id ?? employee.id ?? "-");
          const departmentId = String(employee.department_id ?? "");
          const sectionId = String(employee.section_id ?? "");
          const hireDate = String(employee.hire_date ?? "").slice(0, 10);
          const scheduleName = String(employee.work_schedule ?? "").trim();
          const schedule = scheduleForEmployee(scheduleResult.schedules, scheduleName);
          if (scheduleName && !schedule && !scheduleResult.error) missingSchedules += 1;
          const exempt = employee.attendance_exempt === true;
          const savedDays = attendanceByEmployee.get(empId) ?? {};
          const attendance: Record<number, AttendanceDay> = {};
          const holidays = officialHolidayDates(holidayResult.holidays, {
            branch: [branchStoredNames.get(String(employee.branch_id ?? "")) ?? "", String(employee.branch ?? "")],
            department: [departmentStoredNames.get(departmentId) ?? "", String(employee.directorate ?? ""), String(employee.department ?? "")],
            section: [sectionStoredNames.get(sectionId) ?? "", String(employee.department ?? "")],
          }, startDate, endDate);
          const leaves = leaveDates.get(String(employee.id));

          days.forEach((day) => {
            const date = dayKey(day);
            const saved = savedDays[day];
            const workDay = isScheduledWorkDay(date, schedule);
            const holiday = holidays.has(date);
            const onLeave = leaves?.has(date) ?? false;
            // نفس تصنيف حساب الدوام وكشف الرواتب: أيام العمل من جدول الموظف، والغياب المسجّل صراحة فقط
            // (أو يوم العمل الماضي بلا تسجيل إن فُعّل إعداد الراتب المكتسب حسب الحضور)
            // التأخير من جدول الدوام الحالي في أيام العمل (كما في حساب الدوام)، ومن السجل لمن لا جدول ثابتًا له
            const lateMinutes = saved ? effectiveLateMinutes(saved.lateMinutes, saved.checkIn, schedule, workDay && !holiday) : 0;
            const classification = classifyAttendanceDay({
              date,
              record: saved ? { status: saved.status, checkIn: saved.checkIn, lateMinutes } : undefined,
              workDay,
              holiday,
              onLeave,
              hireDate,
              today,
              exempt,
              countUnrecordedAsAbsent: countUnrecorded,
              computedLateMinutes: lateMinutes,
            });
            const { category } = classification;
            const status = cellStatus(category, saved?.status ?? "");
            const noteParts: string[] = [];
            // حالة السجل المحفوظ إن اختلفت عن المعروض (مثل غياب مسجّل في يوم راحة أو قبل التعيين)
            if (saved?.status && saved.status !== status) noteParts.push(`${t("المسجّل")}: ${t(saved.status)}`);
            if (saved?.notes) noteParts.push(saved.notes);
            if (!saved && category === "leave") noteParts.push(t("إجازة معتمدة"));
            if (classification.unrecorded) noteParts.push(category === "absent" ? t("لا يوجد تسجيل — يُحتسب غيابًا (الراتب المكتسب حسب الحضور)") : t("يوم عمل بلا تسجيل — لا يُحتسب غيابًا"));
            if (!saved && exempt && category === "none" && workDay && date < today && (!hireDate || date >= hireDate)) noteParts.push(t("معفى من تسجيل الحضور"));
            attendance[day] = { status, notes: noteParts.join(" — "), category, counted: classification.counted };
          });

          return {
            empId,
            empName: String(employee.name ?? "-"),
            departmentId,
            sectionId,
            department: departmentNames.get(departmentId) || t("غير مرتبط"),
            section: sectionNames.get(sectionId) || t("غير مرتبط"),
            attendance,
          };
        });

        if (missingSchedules) warnings.push(`${formatNumber(missingSchedules)} ${t("موظف مرتبط بجدول دوام غير موجود؛ اعتُبرت أيام عملهم من الأحد إلى الخميس")}`);
        setCalendarWarnings(warnings);
        setCountUnrecordedAsAbsent(countUnrecorded);
        setDepartments(departmentOptions);
        setSections(sectionOptions);
        setData(rows.sort((a, b) => a.empName.localeCompare(b.empName, localeCode)));
      } catch (error) {
        if (!cancelled) {
          setData([]);
          setCalendarWarnings([]);
          toast.error(hrRequestErrorText(error, t("خطأ في تحميل البيانات")));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadData();
    return () => { cancelled = true; };
  }, [safeYear, safeMonth, monthKey, daysInMonth, days, locale, reloadKey, t, formatNumber]);

  const visibleSections = useMemo(
    () => sections.filter((section) => departmentFilter === ALL || section.departmentId === departmentFilter),
    [sections, departmentFilter],
  );

  const visibleData = useMemo(() => {
    const query = employeeSearch.trim().toLowerCase();
    return data.filter((employee) => {
      if (departmentFilter !== ALL && employee.departmentId !== departmentFilter) return false;
      if (sectionFilter !== ALL && employee.sectionId !== sectionFilter) return false;
      return !query || employee.empName.toLowerCase().includes(query) || employee.empId.toLowerCase().includes(query);
    });
  }, [data, departmentFilter, sectionFilter, employeeSearch]);

  const getAttendanceDay = (employee: MonthlyAttendance, day: number): AttendanceDay => employee.attendance?.[day] ?? EMPTY_DAY;
  // الإجماليات تُعدّ من تصنيف الخلية المعروضة نفسها (القاعدة الموحدة مع حساب الدوام وكشف الرواتب):
  // الغائب = غياب مسجّل صراحة (أو يوم بلا تسجيل عند تفعيل الراتب المكتسب حسب الحضور)، و"لا يوجد تسجيل" لا يُعد غيابًا
  const countCategory = (category: DayCategory) => visibleData.reduce(
    // يُعدّ ما يدخل في العدّ فقط (لا الأيام المستقبلية)، كما في حساب الدوام وكشف الرواتب
    (total, employee) => total + days.filter((day) => { const cell = getAttendanceDay(employee, day); return cell.category === category && cell.counted !== false; }).length,
    0,
  );
  const reportColumns: ReportColumn[] = [
    { key: "empId", label: t("رقم الموظف"), width: 15 },
    { key: "empName", label: t("اسم الموظف"), width: 24 },
    { key: "department", label: t("الإدارة"), width: 18 },
    { key: "section", label: t("القسم"), width: 18 },
    ...days.map((day) => ({ key: `day${day}`, label: formatNumber(day), width: 8 })),
  ];
  const reportRows = visibleData.map((employee) => ({
    empId: employee.empId,
    empName: employee.empName,
    department: employee.department,
    section: employee.section,
    ...Object.fromEntries(days.map((day) => [`day${day}`, t(getAttendanceDay(employee, day).status)])),
  }));
  const monthLabel = new Date(safeYear, safeMonth - 1).toLocaleString(localeCode, { month: "long", year: "numeric" });
  const reportSummary = [
    { label: t("عدد الموظفين"), value: formatNumber(visibleData.length) },
    { label: t("إجمالي الحضور"), value: formatNumber(countCategory("present")) },
    { label: t("إجمالي الغياب"), value: formatNumber(countCategory("absent")) },
  ];
  const reportOptions = { title: t("الحضور والغياب للموظفين"), subtitle: monthLabel, columns: reportColumns, rows: reportRows, fileName: `attendance-monthly-${safeYear}-${safeMonth}`, landscape: true, summary: reportSummary };
  const statusClass = (status: string) => ({
    "حاضر": "bg-green-100 text-green-700",
    "عمل عن بعد": "bg-teal-100 text-teal-700",
    "غائب": "bg-red-100 text-red-700",
    "غياب": "bg-red-100 text-red-700",
    "إجازة": "bg-blue-100 text-blue-700",
    "مأمورية": "bg-purple-100 text-purple-700",
    "عطلة رسمية": "bg-violet-100 text-violet-700",
    "متأخر": "bg-yellow-100 text-yellow-700",
    "عطلة نهاية أسبوع": "bg-gray-100 text-gray-700",
    "لا يوجد تسجيل": "bg-white text-gray-300",
  }[status] || "bg-gray-100 text-gray-700");
  const side = direction === "rtl" ? "right" : "left";
  const align = direction === "rtl" ? "text-right" : "text-left";

  const content = (
    <>
      <div className={embedded ? "space-y-5" : "mx-auto max-w-[1800px] space-y-6 p-6"} dir={direction}>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-[#004e89]">{t("الحضور والغياب للموظفين")}</h1>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" onClick={() => setReloadKey((value) => value + 1)} title={t("تحديث")}><RefreshCw className="h-4 w-4" /></Button>
            <Button variant="outline" size="icon" onClick={() => printReport(reportOptions)} disabled={!reportRows.length} title={t("طباعة / PDF")}><Printer className="h-4 w-4" /></Button>
            <Button variant="outline" size="icon" onClick={() => exportReportExcel(reportOptions)} disabled={!reportRows.length} title={t("تحميل Excel")}><Download className="h-4 w-4" /></Button>
          </div>
        </div>

        <div className="space-y-4 rounded-xl border bg-white p-6 shadow-sm">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <label className="space-y-1"><span className="block text-sm font-medium text-gray-700">{t("السنة")}</span><Input type="number" min={2000} max={2100} value={year} onChange={(event) => setYear(Number(event.target.value))} className={align} /></label>
            <label className="space-y-1"><span className="block text-sm font-medium text-gray-700">{t("الشهر")}</span><select value={month} onChange={(event) => setMonth(Number(event.target.value))} className={`h-10 w-full rounded-md border px-3 ${align}`}>{Array.from({ length: 12 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{monthName(value)}</option>)}</select></label>
            <label className="space-y-1"><span className="block text-sm font-medium text-gray-700">{t("الإدارة")}</span><select value={departmentFilter} onChange={(event) => { setDepartmentFilter(event.target.value); setSectionFilter(ALL); }} className={`h-10 w-full rounded-md border px-3 ${align}`}><option value={ALL}>{t(ALL)}</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
            <label className="space-y-1"><span className="block text-sm font-medium text-gray-700">{t("القسم")}</span><select value={sectionFilter} onChange={(event) => setSectionFilter(event.target.value)} className={`h-10 w-full rounded-md border px-3 ${align}`}><option value={ALL}>{t(ALL)}</option>{visibleSections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}</select></label>
            <label className="space-y-1"><span className="block text-sm font-medium text-gray-700">{t("البحث عن موظف")}</span><Input value={employeeSearch} onChange={(event) => setEmployeeSearch(event.target.value)} placeholder={t("ابحث بالاسم أو الرقم الوظيفي")} className={align} /></label>
          </div>
        </div>

        {calendarWarnings.length > 0 && <div className="space-y-1 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{calendarWarnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
        {!loading && <div className="rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-xs leading-6 text-sky-800">{countUnrecordedAsAbsent ? t("الأيام بلا تسجيل تُحتسب غيابًا (إعداد الراتب المكتسب حسب الحضور): يوم العمل الماضي بلا أي تسجيل يظهر «غائب» ويُخصم من الراتب.") : t("الغياب = غياب مسجّل صراحة (حالة غائب) ويُخصم من الراتب؛ يوم العمل الماضي بلا أي تسجيل يظهر «لا يوجد تسجيل» ولا يُحتسب غيابًا ما لم يُفعَّل إعداد «الراتب المكتسب حسب الحضور» في إعدادات حساب الراتب.")} {t("أيام العمل حسب جدول دوام كل موظف (من لا جدول له: الأحد إلى الخميس).")}</div>}

        <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
          {loading ? <div className="p-8 text-center text-gray-400">{t("جاري التحميل...")}</div> : !visibleData.length ? <div className="p-8 text-center text-gray-400">{t("لا توجد بيانات")}</div> : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead><tr className="sticky top-0 z-10 bg-blue-700 font-bold text-white"><th className={`sticky ${side}-0 z-20 min-w-[170px] bg-blue-700 px-2 py-2 ${align}`}>{t("الموظف")}</th><th className={`min-w-[120px] px-2 py-2 ${align}`}>{t("الإدارة")}</th>{days.map((day) => <th key={day} className={`min-w-[40px] px-1 py-2 text-center ${isWeekendDay(day) ? "bg-blue-600" : ""}`}>{formatNumber(day)}</th>)}</tr></thead>
                <tbody>{visibleData.map((employee, index) => <tr key={employee.empId} className={`${index % 2 === 0 ? "bg-white" : "bg-gray-50"} border-b hover:bg-blue-50`}><td className={`sticky ${side}-0 z-10 bg-inherit px-2 py-1.5 font-medium text-gray-800 ${align}`}>{employee.empName}<br /><span className="text-gray-500">{employee.empId}</span></td><td className={`px-2 py-1.5 ${align}`}>{employee.department}</td>{days.map((day) => { const attendanceDay = getAttendanceDay(employee, day); return <td key={day} title={attendanceDay.notes || t(attendanceDay.status)} className={`border-b border-gray-200 px-0.5 py-1.5 text-center font-medium ${attendanceDay.status === WEEKEND_STATUS ? "bg-gray-50" : statusClass(attendanceDay.status)}`}>{t(attendanceDay.status)}</td>; })}</tr>)}</tbody>
              </table>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[
            { label: "إجمالي الحاضرين", value: countCategory("present"), className: "border-green-200 bg-green-50 text-green-700" },
            { label: "إجمالي الغائبين", value: countCategory("absent"), className: "border-red-200 bg-red-50 text-red-700" },
            { label: "إجمالي المتأخرين", value: countCategory("late"), className: "border-yellow-200 bg-yellow-50 text-yellow-700" },
            { label: "إجمالي الإجازات", value: countCategory("leave"), className: "border-blue-200 bg-blue-50 text-blue-700" },
          ].map((summary) => <div key={summary.label} className={`rounded-lg border p-4 ${summary.className}`}><div className="text-sm font-medium">{t(summary.label)}</div><div className="text-2xl font-bold">{formatNumber(summary.value)}</div></div>)}
        </div>
      </div>
      <style>{`@media print { body { margin: 0; } table { font-size: 10px; } th, td { padding: 4px !important; } }`}</style>
    </>
  );

  return embedded ? content : <Layout>{content}</Layout>;
}

export default function HRAttendanceMonthlyReport() {
  return <AttendanceMonthlyReportContent />;
}
