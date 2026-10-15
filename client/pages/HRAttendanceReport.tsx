import { useEffect, useRef, useState } from "react";
import Layout from "@/components/Layout";
import { ArrowRight, Download, Eye, Printer, RefreshCw, Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { exportReportExcel, printReport, ReportColumn } from "@/lib/reportExport";
import { useI18n } from "@/i18n";
import { fetchAllRows } from "@/lib/fetchAll";
import { monthRange, riyadhMonth } from "@/lib/hrDates";

type Employee = { id: string; empId: string; name: string; branchId: string; branch: string; administrationId: string; administration: string; departmentId: string; department: string; workLocation: string; workSchedule: string; workTime: string; dailyHours: number };
type Attendance = { id: string; empId: string; date: string; checkIn: string; checkOut: string; status: string };
type ScheduleSummary = { key: string; workType: string; schedule: string; employees: Employee[]; startTime: string; endTime: string; hours: string };
type DetailRow = { id: string; employee: Employee; date: string; checkIn: string; checkOut: string };

const ALL = "الكل";
/** الشهر الحالي بتوقيت الرياض (لا بتوقيت جهاز المستخدم) */
const getMonthRange = () => monthRange(riyadhMonth());
const timeToMinutes = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null;
};

function SelectField({ label, value, onChange, options, allLabel, optionLabel = (option) => option }: { label: string; value: string; onChange: (value: string) => void; options: string[]; allLabel: string; optionLabel?: (option: string) => string }) {
  return <div className="space-y-1.5"><label className="block text-xs font-medium text-slate-700">{label}</label><select value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"><option value={ALL}>{allLabel}</option>{options.map((option) => <option key={option} value={option}>{optionLabel(option)}</option>)}</select></div>;
}

export default function HRAttendanceReport() {
  const { t, locale, direction, formatDate, formatNumber } = useI18n();
  const initialRange = getMonthRange();
  const [dateFrom, setDateFrom] = useState(initialRange.from);
  const [dateTo, setDateTo] = useState(initialRange.to);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [administrations, setAdministrations] = useState<{ id: string; name: string }[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string; administrationId: string }[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [branch, setBranch] = useState(ALL);
  const [administration, setAdministration] = useState(ALL);
  const [department, setDepartment] = useState(ALL);
  const [workLocation, setWorkLocation] = useState(ALL);
  const [workTime, setWorkTime] = useState(ALL);
  const [attendanceType, setAttendanceType] = useState(ALL);
  const [selectedSchedule, setSelectedSchedule] = useState<string | null>(null);
  const loadSeq = useRef(0);

  const formatHours = (start: string, end: string, fallback: number) => {
    const startMinutes = timeToMinutes(start); const endMinutes = timeToMinutes(end);
    if (startMinutes === null || endMinutes === null) return fallback ? `${formatNumber(fallback)} ${t("ساعات")}` : "-";
    let difference = endMinutes - startMinutes; if (difference < 0) difference += 24 * 60;
    const hours = Math.floor(difference / 60); const minutes = difference % 60;
    return minutes ? `${formatNumber(hours)} ${t("س")} ${formatNumber(minutes)} ${t("د")}` : `${formatNumber(hours)} ${t("ساعات")}`;
  };
  const loadData = async () => {
    // رقم تسلسلي: استجابة تحميل أقدم لا تستبدل نتيجة تحميل أحدث
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      const [{ data: employeeRows, error: employeesError }, attendanceRows, { data: branchRows, error: branchesError }, { data: administrationRows, error: administrationsError }, { data: departmentRows, error: departmentsError }] = await Promise.all([
        supabase.from("employees").select("id, emp_id, name, branch_id, department_id, section_id, work_location, work_schedule, work_time, daily_hours").in("status", ["نشط", "فعال", "active"]).order("name"),
        // على دفعات لتجاوز حد 1000 صف (fetchAllRows يرمي الخطأ فيلتقطه catch)
        fetchAllRows<Record<string, any>>((from, to) => supabase.from("attendance").select("id, emp_id, date, check_in, check_out, status").gte("date", dateFrom).lte("date", dateTo).order("date").order("emp_id").range(from, to)),
        supabase.from("branches").select("id, name, name_en").eq("status", "فعال").order("name"),
        supabase.from("departments").select("id, name, name_en").eq("status", "فعال").order("name"),
        supabase.from("org_sections").select("id, name, name_en, department_id").eq("status", "فعال").order("name"),
      ]);
      if (seq !== loadSeq.current) return;
      if (employeesError) throw employeesError; if (branchesError) throw branchesError; if (administrationsError) throw administrationsError; if (departmentsError) throw departmentsError;
      const localizedName = (row: any) => locale === "en" && String(row.name_en ?? "").trim() ? String(row.name_en) : String(row.name ?? "");
      const branchOptions = (branchRows ?? []).map((row) => ({ id: String(row.id), name: localizedName(row) }));
      const administrationOptions = (administrationRows ?? []).map((row) => ({ id: String(row.id), name: localizedName(row) }));
      const departmentOptions = (departmentRows ?? []).map((row) => ({ id: String(row.id), name: localizedName(row), administrationId: String(row.department_id ?? "") }));
      const branchById = new Map(branchOptions.map((item) => [item.id, item.name]));
      const administrationById = new Map(administrationOptions.map((item) => [item.id, item.name]));
      const departmentById = new Map(departmentOptions.map((item) => [item.id, item.name]));
      setBranches(branchOptions);
      setAdministrations(administrationOptions);
      setDepartments(departmentOptions);
      setEmployees((employeeRows ?? []).map((row: any) => ({ id: String(row.id), empId: String(row.emp_id ?? row.id), name: String(row.name ?? "-"), branchId: String(row.branch_id ?? ""), branch: branchById.get(String(row.branch_id ?? "")) || t("غير مرتبط"), administrationId: String(row.department_id ?? ""), administration: administrationById.get(String(row.department_id ?? "")) || t("غير مرتبط"), departmentId: String(row.section_id ?? ""), department: departmentById.get(String(row.section_id ?? "")) || t("غير مرتبط"), workLocation: String(row.work_location ?? t("غير محدد")), workSchedule: String(row.work_schedule ?? t("بدون جدول عمل")), workTime: String(row.work_time ?? t("دوام كامل")), dailyHours: Number(row.daily_hours ?? 0) })));
      setAttendance(attendanceRows.map((row: any) => ({ id: String(row.id), empId: String(row.emp_id ?? ""), date: String(row.date ?? ""), checkIn: String(row.check_in ?? ""), checkOut: String(row.check_out ?? ""), status: String(row.status ?? "") })));
    } catch (error) {
      if (seq !== loadSeq.current) return;
      console.error("Error loading attendance report:", error);
      toast.error(t("تعذر تحميل تقرير الحضور والانصراف")); setEmployees([]); setAttendance([]);
    } finally { if (seq === loadSeq.current) setLoading(false); }
  };
  useEffect(() => { void loadData(); }, [dateFrom, dateTo, locale]);
  const uniqueValues = (field: keyof Employee) => [...new Set(employees.map((employee) => String(employee[field])).filter(Boolean))].sort();
  const filteredEmployees = employees.filter((employee) => (branch === ALL || employee.branchId === branch) && (administration === ALL || employee.administrationId === administration) && (department === ALL || employee.departmentId === department) && (workLocation === ALL || employee.workLocation === workLocation) && (workTime === ALL || employee.workTime === workTime));
  const filteredEmployeeIds = new Set(filteredEmployees.map((employee) => employee.empId));
  const filteredAttendance = attendance.filter((record) => filteredEmployeeIds.has(record.empId) && !(attendanceType === "حضور فقط" && !record.checkIn) && !(attendanceType === "انصراف فقط" && !record.checkOut) && !(attendanceType === "حضور وانصراف مكتمل" && (!record.checkIn || !record.checkOut)));
  const summaries = filteredEmployees.reduce<Record<string, ScheduleSummary>>((groups, employee) => { const key = `${employee.workSchedule}__${employee.workTime}`; if (!groups[key]) groups[key] = { key, workType: employee.workTime, schedule: employee.workSchedule, employees: [], startTime: "", endTime: "", hours: "-" }; groups[key].employees.push(employee); return groups; }, {});
  const summaryRows = Object.values(summaries).map((summary) => { const ids = new Set(summary.employees.map((employee) => employee.empId)); const records = filteredAttendance.filter((record) => ids.has(record.empId)); const starts = records.map((record) => record.checkIn).filter(Boolean).sort(); const ends = records.map((record) => record.checkOut).filter(Boolean).sort(); const startTime = starts[0] ?? ""; const endTime = ends[ends.length - 1] ?? ""; return { ...summary, startTime, endTime, hours: formatHours(startTime, endTime, summary.employees[0]?.dailyHours ?? 0) }; }).filter((summary) => !search || summary.schedule.includes(search) || summary.workType.includes(search));
  const selectedSummary = summaryRows.find((summary) => summary.key === selectedSchedule) ?? Object.values(summaries).find((summary) => summary.key === selectedSchedule);
  const detailRows: DetailRow[] = selectedSummary ? selectedSummary.employees.flatMap((employee) => filteredAttendance.filter((record) => record.empId === employee.empId).map((record) => ({ id: record.id, employee, date: record.date, checkIn: record.checkIn, checkOut: record.checkOut }))).filter((row) => !search || row.employee.name.includes(search) || row.employee.empId.includes(search)) : [];
  const reportColumns: ReportColumn[] = selectedSchedule ? [{ key: "name", label: t("اسم الموظف"), width: 25 }, { key: "empId", label: t("رقم الموظف"), width: 15 }, { key: "date", label: t("التاريخ"), width: 15 }, { key: "checkIn", label: t("الحضور"), width: 13 }, { key: "checkOut", label: t("الانصراف"), width: 13 }, { key: "workTime", label: t("وقت العمل"), width: 18 }, { key: "schedule", label: t("جدول العمل"), width: 22 }, { key: "administration", label: t("الإدارة"), width: 20 }, { key: "department", label: t("القسم"), width: 20 }] : [{ key: "workType", label: t("نوع العمل"), width: 18 }, { key: "schedule", label: t("جدول العمل"), width: 24 }, { key: "employees", label: t("عدد الموظفين"), width: 14 }, { key: "startTime", label: t("وقت البداية"), width: 14 }, { key: "endTime", label: t("وقت النهاية"), width: 14 }, { key: "hours", label: t("الساعات"), width: 14 }];
  const reportRows = selectedSchedule ? detailRows.map((row) => ({ name: row.employee.name, empId: row.employee.empId, date: formatDate(row.date), checkIn: row.checkIn || "-", checkOut: row.checkOut || "-", workTime: row.employee.workTime, schedule: row.employee.workSchedule, administration: row.employee.administration, department: row.employee.department })) : summaryRows.map((row) => ({ workType: row.workType, schedule: row.schedule, employees: formatNumber(row.employees.length), startTime: row.startTime || "-", endTime: row.endTime || "-", hours: row.hours }));
  const reportTitle = t(selectedSchedule ? "تفاصيل الحضور والانصراف" : "تقرير الحضور والانصراف");
  const reportSubtitle = `${t("الفترة من")} ${formatDate(dateFrom)} ${t("إلى")} ${formatDate(dateTo)}`;
  const printAttendanceReport = () => printReport({ title: reportTitle, subtitle: reportSubtitle, columns: reportColumns, rows: reportRows, fileName: "attendance-report", landscape: true, summary: [{ label: t("عدد السجلات"), value: formatNumber(reportRows.length) }] });
  const exportAttendanceReport = () => exportReportExcel({ title: reportTitle, subtitle: reportSubtitle, columns: reportColumns, rows: reportRows, fileName: `attendance-report-${dateFrom}-${dateTo}` });
  const textAlign = direction === "rtl" ? "text-right" : "text-left";
  const iconEnd = direction === "rtl" ? "ml-2" : "mr-2";
  return <Layout><div className="space-y-5 w-full" dir={direction}>
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3">{selectedSchedule && <Button variant="outline" size="icon" onClick={() => { setSelectedSchedule(null); setSearch(""); }} title={t("العودة للتقارير")}><ArrowRight className={`h-4 w-4 ${direction === "ltr" ? "rotate-180" : ""}`} /></Button>}<div><h1 className="text-xl font-bold text-slate-900 md:text-2xl">{t(selectedSchedule ? "تفاصيل الحضور" : "تقرير الحضور والانصراف")}</h1><p className="mt-1 text-xs text-slate-500">{selectedSchedule ? `${selectedSummary?.workType ?? ""} — ${selectedSummary?.schedule ?? ""}` : t("ملخص جداول العمل وبيانات الحضور المسجلة")}</p></div></div><div className="flex gap-2"><Button variant="outline" size="icon" onClick={loadData} title={t("تحديث")}><RefreshCw className="h-4 w-4" /></Button><Button variant="outline" size="icon" onClick={printAttendanceReport} disabled={!reportRows.length} title={t("طباعة / PDF")}><Printer className="h-4 w-4" /></Button><Button variant="outline" size="icon" onClick={exportAttendanceReport} disabled={!reportRows.length} title={t("تحميل Excel")}><Download className="h-4 w-4" /></Button></div></div>
    {selectedSchedule && <div className="rounded-md border border-slate-200 bg-slate-100 px-4 py-3 text-center text-sm text-slate-700">{t("وردية")} <span className="font-semibold">{selectedSummary?.workType}</span>{selectedSummary?.startTime && <>, {t("وقت البداية")} <span className="font-semibold">{selectedSummary.startTime}</span></>}{selectedSummary?.endTime && <>, {t("وقت النهاية")} <span className="font-semibold">{selectedSummary.endTime}</span></>}</div>}
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5"><div className="space-y-1.5"><label className="block text-xs font-medium text-slate-700">{t("من تاريخ")}</label><Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></div><div className="space-y-1.5"><label className="block text-xs font-medium text-slate-700">{t("إلى تاريخ")}</label><Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></div><SelectField label={t("الفرع")} value={branch} onChange={(value) => { setBranch(value); setAdministration(ALL); setDepartment(ALL); }} options={branches.map((item) => item.id)} allLabel={t(ALL)} optionLabel={(id) => branches.find((item) => item.id === id)?.name ?? id} /><SelectField label={t("الإدارة")} value={administration} onChange={(value) => { setAdministration(value); setDepartment(ALL); }} options={administrations.map((item) => item.id)} allLabel={t(ALL)} optionLabel={(id) => administrations.find((item) => item.id === id)?.name ?? id} /><SelectField label={t("القسم")} value={department} onChange={setDepartment} options={departments.filter((item) => administration === ALL || item.administrationId === administration).map((item) => item.id)} allLabel={t(ALL)} optionLabel={(id) => departments.find((item) => item.id === id)?.name ?? id} /><SelectField label={t("مكان العمل")} value={workLocation} onChange={setWorkLocation} options={uniqueValues("workLocation")} allLabel={t(ALL)} /><SelectField label={t("وقت العمل")} value={workTime} onChange={setWorkTime} options={uniqueValues("workTime")} allLabel={t(ALL)} /><SelectField label={t("نوع البصمة")} value={attendanceType} onChange={setAttendanceType} options={["حضور فقط", "انصراف فقط", "حضور وانصراف مكتمل"]} allLabel={t(ALL)} optionLabel={t} /></div></div>
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">{selectedSchedule && <div className="flex flex-wrap items-center justify-between gap-3 border-t-4 border-t-sky-600 px-5 py-4"><div className="flex items-center gap-2 font-bold text-slate-800"><Users className="h-5 w-5 text-sky-700" />{t("تفاصيل الحضور")}</div><Button onClick={loadData} className="bg-sky-700 hover:bg-sky-800"><RefreshCw className={`${iconEnd} h-4 w-4`} />{t("تحديث")}</Button></div>}<div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4"><div className="relative w-full sm:w-72"><Search className={`absolute ${direction === "rtl" ? "right-3" : "left-3"} top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400`} /><Input placeholder={t("بحث...")} value={search} onChange={(event) => setSearch(event.target.value)} className={direction === "rtl" ? "pr-9" : "pl-9"} /></div><span className="text-xs text-slate-500">{formatNumber(selectedSchedule ? detailRows.length : summaryRows.length)} {t(selectedSchedule ? "سجل حضور" : "جدول عمل")}</span></div><div className="overflow-x-auto">{selectedSchedule ? <table className={`w-full min-w-[1100px] ${textAlign} text-sm`}><thead className="bg-[#075f94] text-white"><tr>{["اسم الموظف", "التاريخ", "وقت الحضور الفعلي", "وقت الانصراف الفعلي", "وقت العمل", "جدول العمل", "الإدارة", "القسم"].map((label) => <th key={label} className="px-4 py-3 font-medium">{t(label)}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{loading ? <tr><td colSpan={8} className="py-10 text-center text-slate-400">{t("جاري تحميل البيانات...")}</td></tr> : !detailRows.length ? <tr><td colSpan={8} className="py-10 text-center text-slate-400">{t("لا توجد سجلات حضور ضمن الفترة المحددة")}</td></tr> : detailRows.map((row, index) => <tr key={row.id} className={index % 2 ? "bg-slate-50/70" : "bg-white"}><td className="px-4 py-3"><div className="font-semibold text-slate-800">{row.employee.name}</div><div className="text-xs text-slate-400">{row.employee.empId}</div></td><td className="px-4 py-3 whitespace-nowrap">{formatDate(row.date)}</td><td className="px-4 py-3 text-center font-mono">{row.checkIn || "-"}</td><td className="px-4 py-3 text-center font-mono">{row.checkOut || "-"}</td><td className="px-4 py-3">{row.employee.workTime}</td><td className="px-4 py-3">{row.employee.workSchedule}</td><td className="px-4 py-3">{row.employee.administration}</td><td className="px-4 py-3">{row.employee.department}</td></tr>)}</tbody></table> : <table className={`w-full min-w-[900px] ${textAlign} text-sm`}><thead className="bg-[#075f94] text-white"><tr>{["نوع العمل", "جدول العمل", "عدد الموظفين", "وقت البداية", "وقت النهاية", "الساعات", "إجراءات"].map((label) => <th key={label} className="px-4 py-3 font-medium">{t(label)}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{loading ? <tr><td colSpan={7} className="py-10 text-center text-slate-400">{t("جاري تحميل البيانات...")}</td></tr> : !summaryRows.length ? <tr><td colSpan={7} className="py-10 text-center text-slate-400">{t("لا توجد جداول عمل مطابقة")}</td></tr> : summaryRows.map((row, index) => <tr key={row.key} className={`${index % 2 ? "bg-slate-50/70" : "bg-white"} hover:bg-sky-50`}><td className="px-4 py-3 font-medium text-slate-800">{row.workType}</td><td className="px-4 py-3">{row.schedule}</td><td className="px-4 py-3 text-center">{formatNumber(row.employees.length)}</td><td className="px-4 py-3 text-center font-mono">{row.startTime || "-"}</td><td className="px-4 py-3 text-center font-mono">{row.endTime || "-"}</td><td className="px-4 py-3 text-center">{row.hours}</td><td className="px-4 py-3 text-center"><Button size="sm" onClick={() => { setSelectedSchedule(row.key); setSearch(""); }} className="h-8 bg-sky-700 px-4 hover:bg-sky-800"><Eye className={`${iconEnd} h-4 w-4`} />{t("عرض")}</Button></td></tr>)}</tbody></table>}</div></div>
  </div></Layout>;
}
