import { useEffect, useMemo, useState } from "react";
import Layout from "@/components/Layout";
import { ArrowRight, Download, Printer, Search, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { exportReportExcel, printReport, ReportColumn } from "@/lib/reportExport";
import { useI18n } from "@/i18n";
import { useNavigate } from "react-router-dom";
import { readUserSession } from "@/lib/authSession";
import { preparePayrollResend, resendPreparationOf, submitPayrollApprovalRequest, type PayrollResendPreparation } from "@/lib/payrollApproval";
import { payrollApprovalErrorText } from "@/lib/hrErrors";
import { computePayroll, savePayrollRows, type PayrollComputation, type PayrollLine } from "@/lib/payrollCalc";
import PayrollApprovalDialog from "@/components/hr/PayrollApprovalDialog";

type EmpLite = {
  id: string;
  empId: string;
  name: string;
  jobTitle: string;
  departmentId: string;
  department: string;
  sectionId: string;
  section: string;
  branchId: string;
  branch: string;
  workLocationId: string;
  workLocation: string;
  workTime: string;
  employeeType: string;
  status: string;
  nationality: string;
  baseSalary: number;
};

const monthNames: Record<string, string> = {
  "01": "يناير",
  "02": "فبراير",
  "03": "مارس",
  "04": "أبريل",
  "05": "مايو",
  "06": "يونيو",
  "07": "يوليو",
  "08": "أغسطس",
  "09": "سبتمبر",
  "10": "أكتوبر",
  "11": "نوفمبر",
  "12": "ديسمبر",
};

const current = new Date();
const defaultYear = String(current.getFullYear());
const defaultMonth = String(current.getMonth() + 1).padStart(2, "0");

export default function HRPayrollStatement() {
  const { t, locale, direction, formatNumber, formatDate } = useI18n();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [employees, setEmployees] = useState<EmpLite[]>([]);
  const [organizationBranches, setOrganizationBranches] = useState<{ id: string; name: string }[]>([]);
  const [organizationDepartments, setOrganizationDepartments] = useState<{ id: string; name: string; branchId: string }[]>([]);
  const [organizationSections, setOrganizationSections] = useState<{ id: string; name: string; departmentId: string }[]>([]);
  const [organizationLocations, setOrganizationLocations] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);

  const [yearFilter, setYearFilter] = useState(defaultYear);
  const [monthFilter, setMonthFilter] = useState(defaultMonth);
  const [branchFilter, setBranchFilter] = useState("الكل");
  const [departmentFilter, setDepartmentFilter] = useState("الكل");
  const [sectionFilter, setSectionFilter] = useState("الكل");
  const [locationFilter, setLocationFilter] = useState("الكل");
  const [typeFilter, setTypeFilter] = useState("الكل");
  const [statusFilter, setStatusFilter] = useState("نشط");

  const [pageMode, setPageMode] = useState<"setup" | "report">("setup");
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [approvalStep, setApprovalStep] = useState<1 | 2>(1);
  const [approvalScope, setApprovalScope] = useState<"all" | "partial">("all");
  const [approvalSubmitting, setApprovalSubmitting] = useState(false);

  const [stopDialogOpen, setStopDialogOpen] = useState(false);
  const [computing, setComputing] = useState(false);
  const [computation, setComputation] = useState<PayrollComputation | null>(null);

  const [approvalDepartment, setApprovalDepartment] = useState("الكل");
  const [approvalSection, setApprovalSection] = useState("الكل");
  const [approvalBranch, setApprovalBranch] = useState("الكل");
  const [approvalLocation, setApprovalLocation] = useState("الكل");
  const [approvalStopKeyword, setApprovalStopKeyword] = useState("");
  const [stoppedEmployeeIds, setStoppedEmployeeIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [employeeResult, departmentResult, sectionResult, branchResult, locationResult, jobResult] = await Promise.all([
          supabase.from("employees").select("id, emp_id, name, job_title, department_id, section_id, branch_id, attendance_location_id, work_time, work_schedule, employment_type, status, nationality, base_salary").order("name"),
          supabase.from("departments").select("id, name, name_en, branch_id").eq("status", "فعال"),
          supabase.from("org_sections").select("id, name, name_en, department_id").eq("status", "فعال"),
          supabase.from("branches").select("id, name, name_en").eq("status", "فعال"),
          supabase.from("hr_work_locations").select("id, name, name_en").eq("status", "فعال"),
          supabase.from("hr_jobs").select("name, name_en").eq("status", "فعال"),
        ]);
        const firstError = employeeResult.error ?? departmentResult.error ?? sectionResult.error ?? branchResult.error ?? locationResult.error ?? jobResult.error;
        if (firstError) {
          toast({ title: t("تعذر تحميل الموظفين"), description: firstError.message });
          return;
        }

        const localizedName = (row: { name?: unknown; name_en?: unknown }) => locale === "en" && String(row.name_en ?? "").trim() ? String(row.name_en) : String(row.name ?? "");
        const departmentOptions = (departmentResult.data ?? []).map((row) => ({ id: String(row.id), name: localizedName(row), branchId: String(row.branch_id ?? "") }));
        const sectionOptions = (sectionResult.data ?? []).map((row) => ({ id: String(row.id), name: localizedName(row), departmentId: String(row.department_id ?? "") }));
        const branchOptions = (branchResult.data ?? []).map((row) => ({ id: String(row.id), name: localizedName(row) }));
        const locationOptions = (locationResult.data ?? []).map((row) => ({ id: String(row.id), name: localizedName(row) }));
        const departmentById = new Map(departmentOptions.map((row) => [row.id, row.name]));
        const sectionById = new Map(sectionOptions.map((row) => [row.id, row.name]));
        const branchById = new Map(branchOptions.map((row) => [row.id, row.name]));
        const locationById = new Map(locationOptions.map((row) => [row.id, row.name]));
        setOrganizationDepartments(departmentOptions);
        setOrganizationSections(sectionOptions);
        setOrganizationBranches(branchOptions);
        setOrganizationLocations(locationOptions);
        const jobByName = new Map((jobResult.data ?? []).map((row) => [String(row.name), localizedName(row)]));
        setEmployees(
          (employeeResult.data ?? []).map((r) => ({
            id: String(r.id ?? ""),
            empId: String(r.emp_id ?? r.id ?? ""),
            name: String(r.name ?? ""),
            jobTitle: jobByName.get(String(r.job_title ?? "")) || t("غير مرتبط"),
            departmentId: String(r.department_id ?? ""),
            department: departmentById.get(String(r.department_id ?? "")) || t("غير مرتبط"),
            sectionId: String(r.section_id ?? ""),
            section: sectionById.get(String(r.section_id ?? "")) || t("غير مرتبط"),
            branchId: String(r.branch_id ?? ""),
            branch: branchById.get(String(r.branch_id ?? "")) || t("غير مرتبط"),
            workLocationId: String(r.attendance_location_id ?? ""),
            workLocation: locationById.get(String(r.attendance_location_id ?? "")) || t("غير مرتبط"),
            workTime: String(r.work_time ?? r.work_schedule ?? t("غير مرتبط")),
            employeeType: String(r.employment_type ?? "أساسي"),
            status: String(r.status ?? "نشط"),
            nationality: String(r.nationality ?? ""),
            baseSalary: Number(r.base_salary ?? 0),
          }))
        );
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [locale]);

  const options = useMemo(() => {
    const uniq = (list: string[]) => ["الكل", ...Array.from(new Set(list.filter(Boolean)))];

    return {
      years: Array.from({ length: 6 }, (_, idx) => {
        const value = String(Number(defaultYear) - 2 + idx);
        return { value, label: `${value} ${t("ميلادي")}` };
      }),
      months: Object.entries(monthNames).map(([value, label]) => ({ value, label: t(label) })),
      branches: uniq(employees.map((e) => e.branch)),
      departments: uniq(employees.map((e) => e.department)),
      sections: uniq(employees.map((e) => e.section)),
      locations: uniq(employees.map((e) => e.workLocation)),
      types: uniq(employees.map((e) => e.employeeType)),
      statuses: ["الكل", "نشط", "موقوف", "غير فعال"],
    };
  }, [employees, t]);

  const period = `${yearFilter}-${monthFilter}`;

  const filtered = useMemo(() => {
    return employees.filter((e) => {
      const keyword = search.trim();

      if (keyword && !e.name.includes(keyword) && !e.department.includes(keyword) && !e.branch.includes(keyword)) {
        return false;
      }

      if (branchFilter !== "الكل" && e.branch !== branchFilter) return false;
      if (departmentFilter !== "الكل" && e.department !== departmentFilter) return false;
      if (sectionFilter !== "الكل" && e.section !== sectionFilter) return false;
      if (locationFilter !== "الكل" && e.workLocation !== locationFilter) return false;
      if (typeFilter !== "الكل" && e.employeeType !== typeFilter) return false;
      if (statusFilter !== "الكل") {
        const isActiveFilter = statusFilter === "نشط";
        const isActiveEmployee = e.status === "نشط" || e.status === "فعال";
        if (isActiveFilter ? !isActiveEmployee : e.status !== statusFilter) return false;
      }

      return true;
    });
  }, [employees, search, branchFilter, departmentFilter, sectionFilter, locationFilter, typeFilter, statusFilter]);

  useEffect(() => {
    setSelected(new Set());
  }, [search, branchFilter, departmentFilter, sectionFilter, locationFilter, typeFilter, statusFilter]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (filtered.length === 0) return;
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((e) => e.id)));
  };

  const selectedEmployees = useMemo(() => filtered.filter((e) => selected.has(e.id)), [filtered, selected]);

  // حساب الراتب من الحضور (بجدول دوام كل موظف) والإجازات والعطل والجزاءات والسلف والإضافي وإعدادات الراتب
  const calc: Record<string, PayrollLine> = useMemo(
    () => (computation && computation.period === period ? Object.fromEntries(computation.lines) : {}),
    [computation, period],
  );

  // "اختيار الموظفين (تفصيلي)": يحسب ويعرض الكشف فقط؛ لا يُكتب شيء في الرواتب قبل إرسال طلب الاعتماد
  const handleGenerate = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) {
      toast({ title: t("تنبيه"), description: t("اختر موظفاً واحداً على الأقل"), variant: "destructive" });
      return;
    }
    setGenerating(true);
    try {
      const result = await computePayroll(ids, period);
      setComputation(result);
      setPageMode("report");
      const notices = [...result.loadErrors, ...result.warnings];
      if (notices.length) toast({ title: t("تنبيه"), description: notices.map((notice) => t(notice)).join(" | "), variant: result.loadErrors.length ? "destructive" : undefined });
    } catch (error) {
      toast({ title: t("تعذر حساب الرواتب"), description: t(payrollApprovalErrorText(error)), variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const handleFullReport = () => {
    if (selectedEmployees.length === 0) {
      toast({ title: t("تنبيه"), description: t("اختر الموظفين أولاً لعرض التقرير الكامل"), variant: "destructive" });
      return;
    }
    sessionStorage.setItem("payroll_full_report", JSON.stringify({
      period,
      employeeIds: selectedEmployees.map((employee) => employee.id),
      stoppedEmployeeIds: selectedEmployees.filter((employee) => stoppedEmployeeIds.has(employee.id)).map((employee) => employee.id),
      filters: {
        branch: branchFilter,
        department: departmentFilter,
        section: sectionFilter,
        location: locationFilter,
      },
    }));
    navigate("/hr/payroll/statement/full-report");
  };

  const moneyText = (value: number) => formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const payrollColumns: ReportColumn[] = [
    { key: "empId", label: t("رقم الموظف"), width: 13 }, { key: "name", label: t("الموظف"), width: 24 },
    { key: "department", label: t("القسم"), width: 18 }, { key: "branch", label: t("الفرع"), width: 16 },
    { key: "workDays", label: t("أيام الحضور/العمل"), width: 14 }, { key: "absentDays", label: t("أيام الغياب"), width: 11 },
    { key: "basic", label: t("الراتب الأساسي"), width: 15 }, { key: "allowances", label: t("البدلات"), width: 13 },
    { key: "overtime", label: t("الإضافي"), width: 12 }, { key: "absenceDeduction", label: t("خصم الغياب والإجازات غير المدفوعة"), width: 16 },
    { key: "socialInsurance", label: t("التأمينات الاجتماعية (حصة الموظف)"), width: 18 }, { key: "otherDeductions", label: t("جزاءات وسلف وأخرى"), width: 16 },
    { key: "deductions", label: t("إجمالي الاستقطاعات"), width: 17 }, { key: "net", label: t("صافي الراتب"), width: 15 },
  ];
  const reportEmployees = selectedEmployees.filter((employee) => calc[employee.id]);
  const payrollRows = reportEmployees.map((employee) => {
    const c = calc[employee.id];
    return {
      empId: employee.empId, name: employee.name, department: employee.section || t("غير متوفر"), branch: employee.branch || t("غير متوفر"),
      workDays: `${formatNumber(c.presentDays)}/${formatNumber(c.workDays)}`, absentDays: formatNumber(c.absentDays),
      basic: moneyText(c.basic), allowances: moneyText(c.allowances), overtime: moneyText(c.overtime), absenceDeduction: moneyText(c.absenceDeduction + c.unpaidLeaveDeduction),
      socialInsurance: moneyText(c.socialInsurance), otherDeductions: moneyText(c.penalties + c.loans + c.allowanceDeductions),
      deductions: moneyText(c.totalDeductions), net: moneyText(c.net),
    };
  });
  const payrollTotal = reportEmployees.reduce((total, employee) => total + (calc[employee.id]?.net ?? 0), 0);
  const totalAbsentDays = reportEmployees.reduce((total, employee) => total + (calc[employee.id]?.absentDays ?? 0), 0);
  const totalAbsenceDeduction = reportEmployees.reduce((total, employee) => total + (calc[employee.id]?.absenceDeduction ?? 0) + (calc[employee.id]?.unpaidLeaveDeduction ?? 0), 0);
  const payrollSubtitle = `${t("كشف الرواتب")} ${formatDate(`${period}-01`, { month: "long", year: "numeric" })}`;
  const reportSummary = [
    { label: t("عدد الموظفين"), value: formatNumber(payrollRows.length) },
    { label: t("مجموع أيام الغياب"), value: formatNumber(totalAbsentDays) },
    { label: t("مجموع خصم الغياب"), value: `${moneyText(totalAbsenceDeduction)} ${t("ر.س")}` },
    { label: t("إجمالي صافي الرواتب"), value: `${moneyText(payrollTotal)} ${t("ر.س")}` },
  ];
  const printPayroll = () => printReport({ title: t("كشف الرواتب"), subtitle: payrollSubtitle, columns: payrollColumns, rows: payrollRows, fileName: `payroll-${period}`, landscape: true, summary: reportSummary });
  const exportPayroll = () => exportReportExcel({ title: t("كشف الرواتب"), subtitle: payrollSubtitle, columns: payrollColumns, rows: payrollRows, fileName: `كشف-الرواتب-${period}`, summary: reportSummary });

  const handleOpenApproval = () => {
    setApprovalScope("all");
    setApprovalStep(1);
    setApprovalDepartment("الكل");
    setApprovalSection("الكل");
    setApprovalBranch("الكل");
    setApprovalLocation("الكل");
    setApprovalStopKeyword("");
    setApprovalOpen(true);
  };

  const getApprovalEmployees = () => {
    if (approvalScope === "all") return selectedEmployees;

    return selectedEmployees.filter((e) => {
      if (approvalDepartment !== "الكل" && e.departmentId !== approvalDepartment) return false;
      if (approvalSection !== "الكل" && e.sectionId !== approvalSection) return false;
      if (approvalBranch !== "الكل" && e.branchId !== approvalBranch) return false;
      if (approvalLocation !== "الكل" && e.workLocationId !== approvalLocation) return false;
      return true;
    });
  };

  const stopSuggestions = useMemo(() => {
    const keyword = approvalStopKeyword.trim();
    if (!keyword) return [];

    return (approvalOpen ? getApprovalEmployees() : filtered)
      .filter((e) => !stoppedEmployeeIds.has(e.id) && e.name.includes(keyword))
      .slice(0, 6);
  }, [approvalStopKeyword, approvalOpen, filtered, selectedEmployees, approvalScope, approvalDepartment, approvalSection, approvalBranch, approvalLocation, stoppedEmployeeIds]);

  const addStoppedEmployee = (employee: EmpLite) => {
    setStoppedEmployeeIds((prev) => new Set(prev).add(employee.id));
    setApprovalStopKeyword("");
  };

  const removeStoppedEmployee = (employeeId: string) => {
    setStoppedEmployeeIds((prev) => {
      const next = new Set(prev);
      next.delete(employeeId);
      return next;
    });
  };

  // الخطوة الأولى (النطاق) ثم بطاقة الإعدادات: تحديد الموظفين الموقوفة رواتبهم
  const openStopSettings = () => {
    const target = getApprovalEmployees().filter((employee) => calc[employee.id]);
    if (target.length === 0) {
      toast({ title: t("لا يوجد موظفون"), description: t("لا يوجد موظفون مطابقون للاختيار الحالي"), variant: "destructive" });
      return;
    }
    setApprovalOpen(false);
    setStopDialogOpen(true);
  };

  const handleSendApproval = async (stopped: Set<string>, reason: string) => {
    // من لم يبدأ خدمته في الشهر يُمرَّر أيضًا حتى يُصفَّر صفه القديم إن وُجد
    const target = getApprovalEmployees().filter((employee) => calc[employee.id] || (computation?.period === period && computation.notStarted.has(employee.id)));
    if (!target.some((employee) => calc[employee.id])) {
      toast({ title: t("لا يوجد موظفون"), description: t("لا يوجد موظفون مطابقون للاختيار الحالي"), variant: "destructive" });
      return;
    }

    setApprovalSubmitting(true);
    // بعد حذف طلبي السابق: أي فشل لاحق يترك رواتب الشهر بلا طلب، فيُطلب إعادة الإرسال مع تسمية من كانوا فيه
    let preparation: PayrollResendPreparation | null = null;
    try {
      // يُعاد الحساب لحظة الإرسال حتى يدخل أي غياب أو جزاء سُجّل بعد عرض الكشف
      const ids = target.map((employee) => employee.id);
      const fresh = await computePayroll(ids, period);
      setComputation((current) => {
        if (!current || current.period !== period) return fresh;
        // أرقام الإرسال تحل محل المعروض لهؤلاء الموظفين، ومن لم يعد له سطر (تعيينه بعد الشهر) يُزال
        const lines = new Map(current.lines);
        const employees = new Map(current.employees);
        const notStarted = new Map(current.notStarted);
        ids.forEach((id) => {
          const line = fresh.lines.get(id);
          const employee = fresh.employees.get(id);
          if (line && employee) {
            lines.set(id, line);
            employees.set(id, employee);
            notStarted.delete(id);
          } else {
            lines.delete(id);
            const code = fresh.notStarted.get(id);
            if (code !== undefined) notStarted.set(id, code);
          }
        });
        return { ...current, policy: fresh.policy, lines, employees, notStarted, warnings: fresh.warnings, loadErrors: fresh.loadErrors };
      });
      if (fresh.loadErrors.length) throw new Error(`PAYROLL_INPUTS_INCOMPLETE: ${fresh.loadErrors.join(" | ")}`);
      const codeOf = (id: string) => fresh.employees.get(id)?.empId.trim() ?? "";
      const stoppedIds = ids.filter((id) => stopped.has(id)).map(codeOf).filter(Boolean);
      const activeIds = ids.filter((id) => !stopped.has(id)).map(codeOf).filter(Boolean);
      // من تعيينه بعد نهاية الشهر: لا سطر له، لكن صفه المفتوح القديم (إن وُجد) يُصفَّر ويدخل الطلب
      const notStartedCodes = ids.map((id) => fresh.notStarted.get(id) ?? "").filter(Boolean);
      // طلبي المعلق المتداخل يُحذف قبل تغيير الأرقام، ولا يُعاد الحساب على موظف في طلب معلق لمستخدم آخر
      preparation = await preparePayrollResend(period, [...activeIds, ...stoppedIds, ...notStartedCodes]);
      const saved = await savePayrollRows(fresh, ids, stopped);

      const session = readUserSession();
      const senderName = session?.name?.trim() || t("مسؤول الموارد البشرية");
      const sent = await submitPayrollApprovalRequest({
        period,
        senderName,
        senderUserId: session?.id ?? "",
        senderEmpId: session?.empId ?? "",
        activeIds: [...activeIds, ...saved.zeroed.filter((code) => !activeIds.includes(code))],
        stoppedIds,
        carriedIds: preparation.carried,
        stopReason: reason,
        previousStopReason: preparation.previousStopReason,
      });

      toast({
        title: t("تم إرسال طلب الاعتماد"),
        description: `${t("أُرسل")} ${formatNumber(sent.active)} ${t("موظف")}، ${t("وأُوقف راتب")} ${formatNumber(sent.stopped)} ${t("موظف")}${sent.skipped ? ` — ${formatNumber(sent.skipped)} ${t("معتمد أو مرحّل مسبقًا لم يُعَد إرساله")}` : ""}${sent.carried ? ` — ${formatNumber(sent.carried)} ${t("من طلبك المعلق السابق ضُمّوا للطلب الجديد")}` : ""}`,
      });
      setStopDialogOpen(false);
      setSelected(new Set());
      setStoppedEmployeeIds(new Set());
      setPageMode("setup");
    } catch (error) {
      const failureHint = (cause: unknown) => {
        const done = resendPreparationOf(preparation, cause);
        if (!done || done.deleted === 0) return "";
        const list = done.carried.length ? ` ${t("ومعهم من طلبك السابق")}: ${done.carried.slice(0, 15).join("، ")}${done.carried.length > 15 ? " …" : ""}` : "";
        return ` — ${t("حُذف طلبك المعلق السابق؛ أعد الإرسال لإكمال الطلب")}${list}`;
      };
      toast({ title: t("تعذر إرسال طلب الاعتماد"), description: `${t(payrollApprovalErrorText(error))}${failureHint(error)}`, variant: "destructive" });
    } finally {
      setApprovalSubmitting(false);
    }
  };

  return (
    <Layout>
      <div className="p-6 max-w-[1600px] mx-auto space-y-6" dir={direction}>
        <div className="overflow-visible rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-5 py-4">
            <h2 className="text-lg font-bold text-gray-800">{t("حساب الراتب")}</h2>
          </div>

          <div className="space-y-5 p-5">
            <div className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-3">
              <FilterSelect t={t} label="السنة" value={yearFilter} onChange={setYearFilter} options={options.years} />
              <FilterSelect t={t} label="شهر" value={monthFilter} onChange={setMonthFilter} options={options.months.map((m) => ({ value: m.value, label: m.label }))} />
              <FilterSelect t={t} label="الفرع" value={branchFilter} onChange={setBranchFilter} options={options.branches} />

              <FilterSelect t={t} label="مكان العمل" value={locationFilter} onChange={setLocationFilter} options={options.locations} />
              <FilterSelect t={t} label="الإدارة" value={departmentFilter} onChange={setDepartmentFilter} options={options.departments} />
              <FilterSelect t={t} label="القسم" value={sectionFilter} onChange={setSectionFilter} options={options.sections} />

              <div className="relative space-y-2 md:col-span-2">
                <label className="text-sm font-medium text-gray-700">{t("إيقاف رواتب الموظفين")}</label>
                <div className="flex min-h-10 flex-wrap items-center gap-2 rounded-md border border-gray-300 bg-white px-2 py-1">
                  {filtered.filter((employee) => stoppedEmployeeIds.has(employee.id)).map((employee) => (
                    <span key={employee.id} className="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-1 text-xs text-gray-700">
                      {employee.name}
                      <button type="button" onClick={() => removeStoppedEmployee(employee.id)} aria-label={`${t("إلغاء إيقاف راتب")} ${employee.name}`}><X className="h-3 w-3" /></button>
                    </span>
                  ))}
                  <input value={approvalStopKeyword} onChange={(event) => setApprovalStopKeyword(event.target.value)} placeholder={t("ابدأ بكتابة اسم الموظف")} className="min-w-48 flex-1 border-0 bg-transparent px-1 py-1 text-sm outline-none" />
                </div>
                {stopSuggestions.length > 0 && !approvalOpen && (
                  <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg">
                    {stopSuggestions.map((employee) => <button key={employee.id} type="button" onClick={() => addStoppedEmployee(employee)} className="block w-full border-b px-4 py-2 text-start text-sm last:border-0 hover:bg-gray-50"><span className="font-medium">{employee.name}</span><span className="ms-2 text-xs text-gray-400">{employee.section}</span></button>)}
                  </div>
                )}
              </div>
              <FilterSelect t={t} label="نوع الموظفين" value={typeFilter} onChange={setTypeFilter} options={options.types} />
            </div>

            <div className="flex flex-wrap justify-end gap-3 pt-1">
              <Button onClick={handleGenerate} disabled={generating || selected.size === 0} className="bg-[#075f94] text-white hover:bg-[#064f7b]">
                {generating ? t("جاري المعالجة...") : t("اختيار الموظفين (تفصيلي)")}
              </Button>
              <Button variant="outline" onClick={handleFullReport}>{t("تقرير شامل (ملخص)")}</Button>
            </div>
          </div>
        </div>

        {pageMode === "setup" ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="space-y-4 border-b border-gray-100 p-4">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-lg font-bold text-gray-800">{t("الموظفون")}</h2>
                <div className="text-sm text-gray-500">{t("فترة المسير")}: {period}</div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="relative w-full sm:w-80">
                  <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <Input placeholder={t("بحث")} value={search} onChange={(event) => setSearch(event.target.value)} className="h-10 pr-9" />
                </div>
                <span className="text-xs text-gray-500">{formatNumber(filtered.length)} {t("من السجلات")}</span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm text-right">
                <thead className="bg-[#004e89] text-white">
                  <tr>
                    <th className="py-3 px-4 w-12 text-center">
                      <Checkbox
                        checked={selected.size === filtered.length && filtered.length > 0}
                        onCheckedChange={selectAll}
                        className="border-white/50 data-[state=checked]:bg-white data-[state=checked]:text-[#004e89]"
                      />
                    </th>
                    <th className="py-3 px-4 font-medium">{t("الصورة")}</th>
                    <th className="py-3 px-4 font-medium">{t("الاسم")}</th>
                    <th className="py-3 px-4 font-medium">{t("المسمى الوظيفي")}</th>
                    <th className="py-3 px-4 font-medium">{t("الإدارة")}</th>
                    <th className="py-3 px-4 font-medium">{t("القسم")}</th>
                    <th className="py-3 px-4 font-medium">{t("مكان العمل")}</th>
                    <th className="py-3 px-4 font-medium">{t("وقت العمل")}</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-gray-100">
                  {loading ? (
                    <tr><td colSpan={8} className="py-8 text-center text-gray-400">{t("جاري التحميل...")}</td></tr>
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={8} className="py-8 text-center text-gray-500">{t("لا يوجد موظفون مطابقون للفلاتر")}</td></tr>
                  ) : (
                    filtered.map((emp) => (
                      <tr key={emp.id} className="hover:bg-gray-50 transition-colors">
                        <td className="py-3 px-4 text-center">
                          <Checkbox checked={selected.has(emp.id)} onCheckedChange={() => toggleSelect(emp.id)} />
                        </td>
                        <td className="py-3 px-4">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="bg-[#004e89] text-white text-xs">{emp.name.charAt(0)}</AvatarFallback>
                          </Avatar>
                        </td>
                        <td className="py-3 px-4 font-medium text-gray-900">{emp.name}</td>
                        <td className="py-3 px-4">{emp.jobTitle || t("غير متوفر")}</td>
                        <td className="py-3 px-4">{emp.department || t("غير متوفر")}</td>
                        <td className="py-3 px-4">{emp.section || t("غير متوفر")}</td>
                        <td className="py-3 px-4">{emp.workLocation || t("غير متوفر")}</td>
                        <td className="py-3 px-4">{emp.workTime || t("غير متوفر")}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex justify-between items-center gap-4">
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => setPageMode("setup")}>
                  <><ArrowRight className="h-4 w-4" /> {t("رجوع")}</>
                </Button>
                <h2 className="text-lg font-bold text-gray-800">{t("النتائج (تقرير شامل)")}</h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={printPayroll} disabled={payrollRows.length === 0}><><Printer className="h-4 w-4" /> {t("طباعة / PDF")}</></Button>
                <Button variant="outline" onClick={exportPayroll} disabled={payrollRows.length === 0}><><Download className="h-4 w-4" /> {t("Excel")}</></Button>
                <Button onClick={handleOpenApproval} className="bg-[#004e89] hover:bg-[#003d6d] text-white">
                  <><Send className="h-4 w-4" /> {t("إرسال طلب اعتماد رواتب الموظفين")}</>
                </Button>
              </div>
            </div>

            <div className="space-y-2 border-b border-gray-100 p-4 text-sm text-gray-700">
              <div>
                {t("الشهر")}: {t(monthNames[monthFilter])} | {t("السنة")}: {yearFilter} | {t("عدد الموظفين")}: {formatNumber(reportEmployees.length)} | {t("مجموع أيام الغياب")}: <b className="text-red-600">{formatNumber(totalAbsentDays)}</b> | {t("مجموع خصم الغياب")}: <b className="text-red-600">{moneyText(totalAbsenceDeduction)}</b> | {t("إجمالي صافي الرواتب")}: <b className="text-emerald-700">{moneyText(payrollTotal)}</b>
              </div>
              {computation && (
                <p className="text-xs text-gray-500">
                  {computation.policy.absenceBasis === "basic" ? t("قيمة يوم الغياب = الراتب الأساسي") : t("قيمة يوم الغياب = الراتب الأساسي + البدلات")}
                  {" ÷ "}{computation.policy.dayDivisor === "actual" ? t("أيام الشهر الفعلية") : "30"}
                  {" — "}{computation.policy.countUnrecordedAsAbsent ? t("أيام العمل بلا تسجيل حضور تُحتسب غيابًا (الراتب المكتسب حسب الحضور)") : t("يُخصم الغياب المسجّل في الحضور فقط")}
                  {" — "}{t("تُغيَّر من إعدادات حساب الراتب")}
                </p>
              )}
              {computation && computation.loadErrors.length > 0 && (
                <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{t("الكشف تقديري ولا يمكن إرساله: تعذر تحميل")} {computation.loadErrors.map((error) => t(error)).join(" | ")}</p>
              )}
              {computation && computation.warnings.length > 0 && (
                <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{computation.warnings.map((warning) => t(warning)).join(" | ")}</p>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1400px] text-right text-xs">
                <thead className="bg-[#0a5a92] text-white">
                  <tr>
                    <th className="px-2 py-2">#</th>
                    <th className="px-2 py-2">{t("الموظف")}</th>
                    <th className="px-2 py-2">{t("القسم")}</th>
                    <th className="px-2 py-2">{t("الفرع")}</th>
                    <th className="px-2 py-2">{t("أيام الحضور/العمل")}</th>
                    <th className="px-2 py-2">{t("أيام الغياب")}</th>
                    <th className="px-2 py-2">{t("الراتب الأساسي")}</th>
                    <th className="px-2 py-2">{t("البدلات")}</th>
                    <th className="px-2 py-2">{t("إضافي")}</th>
                    <th className="px-2 py-2">{t("خصم الغياب والإجازات غير المدفوعة")}</th>
                    <th className="px-2 py-2">{t("التأمينات الاجتماعية (حصة الموظف)")}</th>
                    <th className="px-2 py-2">{t("جزاءات وسلف وأخرى")}</th>
                    <th className="px-2 py-2">{t("إجمالي الاستقطاعات")}</th>
                    <th className="px-2 py-2">{t("صافي الراتب")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {reportEmployees.length === 0 ? (
                    <tr><td colSpan={14} className="py-8 text-center text-gray-400">{t("لا توجد نتائج؛ ارجع واختر الموظفين ثم اضغط اختيار الموظفين (تفصيلي)")}</td></tr>
                  ) : reportEmployees.map((emp, idx) => {
                    const c = calc[emp.id];
                    return (
                      <tr key={emp.id} className="hover:bg-gray-50">
                        <td className="px-2 py-2">{formatNumber(idx + 1)}</td>
                        <td className="px-2 py-2 font-medium">{emp.name}</td>
                        <td className="px-2 py-2">{emp.section || t("غير متوفر")}</td>
                        <td className="px-2 py-2">{emp.branch || t("غير متوفر")}</td>
                        <td className="px-2 py-2">{`${formatNumber(c.presentDays)}/${formatNumber(c.workDays)}`}{c.unrecordedDays > 0 && <span className="ms-1 text-[10px] text-gray-400" title={t("أيام عمل بلا تسجيل حضور (لم تُخصم)")}>({formatNumber(c.unrecordedDays)} {t("بلا تسجيل")})</span>}</td>
                        <td className={`px-2 py-2 ${c.absentDays > 0 ? "font-semibold text-red-600" : ""}`}>{formatNumber(c.absentDays)}</td>
                        <td className="px-2 py-2" title={c.notEmployedDays ? `${t("معيَّن خلال الشهر")}: ${t("أيام قبل التعيين")} ${formatNumber(c.notEmployedDays)} — ${t("الأساسي الكامل")} ${moneyText(c.fullBasic)}` : undefined}>{moneyText(c.basic)}{c.notEmployedDays > 0 && <span className="ms-1 text-[10px] text-amber-600">*</span>}</td>
                        <td className="px-2 py-2" title={c.notEmployedDays ? `${t("البدلات الكاملة")} ${moneyText(c.fullAllowances)}` : undefined}>{moneyText(c.allowances)}</td>
                        <td className="px-2 py-2">{moneyText(c.overtime)}</td>
                        <td className="px-2 py-2 text-red-600" title={[c.unpaidLeaveDays ? `${t("أيام إجازة مخصومة")}: ${formatNumber(c.unpaidLeaveDays)}` : "", c.fullPeriodUnearned ? t("لم يعمل أي يوم في الفترة: خُصم أجرها كاملًا") : ""].filter(Boolean).join(" — ") || undefined}>{moneyText(c.absenceDeduction + c.unpaidLeaveDeduction)}</td>
                        <td className="px-2 py-2 text-orange-600">{moneyText(c.socialInsurance)}</td>
                        <td className="px-2 py-2 text-red-600">{moneyText(c.penalties + c.loans + c.allowanceDeductions)}</td>
                        <td className="px-2 py-2 text-red-600">{moneyText(c.totalDeductions)}</td>
                        <td className="px-2 py-2 font-semibold text-emerald-700" title={c.cappedDeductions > 0 ? t("خُفّضت الاستقطاعات حتى لا يكون الصافي سالبًا") : undefined}>{moneyText(c.net)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {approvalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir={direction}>
            <div className="w-full max-w-3xl overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
                <h3 className="text-xl font-bold text-gray-800">{t("إرسال طلب اعتماد رواتب الموظفين")}</h3>
                <button onClick={() => setApprovalOpen(false)} className="text-gray-500 hover:text-gray-800" aria-label={t("إغلاق")}>
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-4 p-5">
                <div className="space-y-2">
                  <label className="text-base font-semibold text-gray-800">{t("كشف الرواتب")}</label>
                  <select
                    value={approvalScope}
                    onChange={(e) => setApprovalScope(e.target.value as "all" | "partial")}
                    className="h-11 w-full rounded-md border border-gray-300 px-3"
                  >
                    <option value="all">{t("لجميع الموظفين")}</option>
                    <option value="partial">{t("لجزء من الموظفين")}</option>
                  </select>
                </div>

                {approvalScope === "partial" && (
                  <div className="grid grid-cols-1 gap-4 pt-1 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-gray-700">{t("اختر الفرع")}</label>
                      <select value={approvalBranch} onChange={(e) => { setApprovalBranch(e.target.value); setApprovalDepartment("الكل"); setApprovalSection("الكل"); }} className="h-11 w-full rounded-md border border-gray-300 px-3">
                        <option value="الكل">{t("الكل")}</option>
                        {organizationBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-gray-700">{t("اختر الإدارة")}</label>
                      <select value={approvalDepartment} onChange={(e) => { setApprovalDepartment(e.target.value); setApprovalSection("الكل"); }} className="h-11 w-full rounded-md border border-gray-300 px-3">
                        <option value="الكل">{t("الكل")}</option>
                        {organizationDepartments.filter((department) => approvalBranch === "الكل" || department.branchId === approvalBranch).map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-gray-700">{t("اختر القسم")}</label>
                      <select value={approvalSection} onChange={(e) => setApprovalSection(e.target.value)} className="h-11 w-full rounded-md border border-gray-300 px-3">
                        <option value="الكل">{t("الكل")}</option>
                        {organizationSections.filter((section) => approvalDepartment === "الكل" || section.departmentId === approvalDepartment).map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-gray-700">{t("اختر موقع العمل")}</label>
                      <select value={approvalLocation} onChange={(e) => setApprovalLocation(e.target.value)} className="h-11 w-full rounded-md border border-gray-300 px-3">
                        <option value="الكل">{t("الكل")}</option>
                        {organizationLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                      </select>
                    </div>
                  </div>
                )}
                <p className="text-sm text-gray-600">
                  {t("الموظفون في هذا الطلب")}: <b>{formatNumber(getApprovalEmployees().filter((employee) => calc[employee.id]).length)}</b>. {t("في الخطوة التالية تحدد الموظفين الموقوفة رواتبهم.")}
                </p>
              </div>

              <div className="flex justify-start gap-3 border-t border-gray-100 px-5 py-4">
                <Button onClick={openStopSettings} className="bg-[#004e89] text-white hover:bg-[#003d6d]">{t("التالي: إعدادات الإيقاف")}</Button>
                <Button variant="outline" onClick={() => setApprovalOpen(false)}>{t("إلغاء")}</Button>
              </div>
            </div>
          </div>
        )}

        <PayrollApprovalDialog
          open={stopDialogOpen}
          period={period}
          employees={getApprovalEmployees().filter((employee) => calc[employee.id]).map((employee) => ({
            id: employee.id,
            empId: employee.empId,
            name: employee.name,
            department: employee.section,
            absentDays: calc[employee.id].absentDays,
            net: calc[employee.id].net,
          }))}
          initialStopped={stoppedEmployeeIds}
          submitting={approvalSubmitting}
          blockingErrors={computation?.loadErrors ?? []}
          onCancel={() => setStopDialogOpen(false)}
          onSubmit={(stopped, reason) => void handleSendApproval(stopped, reason)}
        />
      </div>
    </Layout>
  );
}

function FilterSelect({
  t,
  label,
  value,
  onChange,
  options,
}: {
  t: (value: string) => string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[] | Array<{ value: string; label: string }>;
}) {
  const normalized = options.map((op) =>
    typeof op === "string" ? { value: op, label: t(op) } : op
  );

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-gray-700">{t(label)}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-10 border border-gray-300 rounded-md px-3 bg-white text-sm focus:ring-2 focus:ring-[#004e89] outline-none"
      >
        {normalized.map((op) => (
          <option key={op.value} value={op.value}>{op.label}</option>
        ))}
      </select>
    </div>
  );
}
