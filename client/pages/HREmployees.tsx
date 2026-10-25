import { Fragment, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Layout from "@/components/Layout";
import { COMPANY_PROFILE, PLATFORM_NAME_EN, isSaudiCompany } from "@/lib/companyProfile";
import {
  Users,
  Search,
  Eye,
  Edit,
  Trash2,
  Download,
  Columns3,
  Printer,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabaseClient";
import { PageHeader } from "@/components/SalesPageUI";
import EmployeeForm, { computeTotalSalary, emptyForm, mapRowToForm } from "./EmployeeForm";
import type { EmpFormData } from "./EmployeeForm";
import { EmployeePhoto, employeeFileName, isEmployeeStoragePath, openEmployeeFile } from "@/components/hr/employeeFiles";
import { printReport } from "@/lib/reportExport";
import { deleteOrDeactivateEmployee } from "@/components/hr/employeeActions";
import EmployeesImportButton from "@/components/hr/EmployeesImportButton";
import { useI18n } from "@/i18n";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import XlsxPopulate from "xlsx-populate/browser/xlsx-populate";

// ─── Constants ───────────────────────────────────────────────────────────────
const STATUSES = ["فعال", "غير فعال", "إجازة", "منتهي"];

type OptionalColumn = "englishName" | "directorate" | "nationality" | "nationalId" | "hireDate" | "phone" | "email";

const OPTIONAL_COLUMNS: { key: OptionalColumn; label: string }[] = [
  { key: "englishName", label: "الاسم بالإنجليزية" },
  { key: "directorate", label: "الإدارة" },
  { key: "nationality", label: "الجنسية" },
  { key: "nationalId", label: "رقم الهوية" },
  { key: "hireDate", label: "تاريخ التعيين" },
  { key: "phone", label: "رقم الجوال" },
  { key: "email", label: "البريد الإلكتروني" },
];

const STATUS_COLORS: Record<string, string> = {
  "فعال": "bg-emerald-50 text-emerald-700 border-emerald-200",
  "نشط": "bg-emerald-50 text-emerald-700 border-emerald-200",
  "غير فعال": "bg-slate-100 text-slate-600 border-slate-200",
  "غير نشط": "bg-slate-100 text-slate-600 border-slate-200",
  "إجازة": "bg-amber-50 text-amber-700 border-amber-200",
  "منتهي": "bg-rose-50 text-rose-700 border-rose-200",
};

const EXPORT_ENGLISH_VALUES: Record<string, string> = {
  "الفرع الرئيسي": "Main Branch",
  "الإدارة العليا": "Executive Management",
  "إدارة الموارد البشرية": "Human Resources Management",
  "قسم الموارد البشرية": "Human Resources Department",
  "الموارد البشرية": "Human Resources",
  "إدارة المالية": "Finance Management",
  "قسم المالية": "Finance Department",
  "المحاسبة": "Accounting",
  "إدارة التشغيل": "Operations Management",
  "الصيانة والتشغيل": "Maintenance and Operations",
  "إدارة المبيعات": "Sales Management",
  "المبيعات": "Sales",
  "تقنية المعلومات": "Information Technology",
  "عامل نظافة": "Cleaner",
  "المملكة العربية السعودية": "Saudi Arabia", "الإمارات العربية المتحدة": "United Arab Emirates",
  "البحرين": "Bahrain", "الكويت": "Kuwait", "عُمان": "Oman", "قطر": "Qatar",
  "مصر": "Egypt", "السودان": "Sudan", "جنوب السودان": "South Sudan", "ليبيا": "Libya",
  "تونس": "Tunisia", "الجزائر": "Algeria", "المغرب": "Morocco", "موريتانيا": "Mauritania",
  "الصومال": "Somalia", "جيبوتي": "Djibouti", "جزر القمر": "Comoros", "سوريا": "Syria",
  "الأردن": "Jordan", "لبنان": "Lebanon", "فلسطين": "Palestine", "العراق": "Iraq", "اليمن": "Yemen",
  "الهند": "India", "باكستان": "Pakistan", "بنغلاديش": "Bangladesh", "سريلانكا": "Sri Lanka",
  "نيبال": "Nepal", "بوتان": "Bhutan", "أفغانستان": "Afghanistan", "المالديف": "Maldives",
  "الفلبين": "Philippines", "إندونيسيا": "Indonesia", "ماليزيا": "Malaysia", "تايلاند": "Thailand",
  "فيتنام": "Vietnam", "ميانمار": "Myanmar", "الصين": "China", "اليابان": "Japan", "كوريا الجنوبية": "South Korea",
  "إثيوبيا": "Ethiopia", "إريتريا": "Eritrea", "كينيا": "Kenya", "أوغندا": "Uganda",
  "تنزانيا": "Tanzania", "نيجيريا": "Nigeria", "غانا": "Ghana", "السنغال": "Senegal",
  "الكاميرون": "Cameroon", "جنوب أفريقيا": "South Africa", "تركيا": "Turkey", "إيران": "Iran",
  "أذربيجان": "Azerbaijan", "أوزبكستان": "Uzbekistan", "كازاخستان": "Kazakhstan",
  "روسيا": "Russia", "أوكرانيا": "Ukraine", "المملكة المتحدة": "United Kingdom", "فرنسا": "France",
  "ألمانيا": "Germany", "إيطاليا": "Italy", "إسبانيا": "Spain", "هولندا": "Netherlands",
  "السويد": "Sweden", "اليونان": "Greece", "الولايات المتحدة": "United States", "كندا": "Canada",
  "المكسيك": "Mexico", "البرازيل": "Brazil", "الأرجنتين": "Argentina", "أستراليا": "Australia",
  "نيوزيلندا": "New Zealand", "أخرى": "Other",
};

// ─── Main Component ──────────────────────────────────────────────────────────
export default function HREmployees() {
  const { t, direction, locale, formatNumber } = useI18n();
  const [employees, setEmployees] = useState<EmpFormData[]>([]);
  const [departmentOptions, setDepartmentOptions] = useState<{ id: string; name: string; nameEn: string }[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const location = useLocation();
  const navigate = useNavigate();
  const isNewRoute = location.pathname.replace(/\/+$/, "").endsWith("/employees/new");
  const [mode, setMode] = useState<"list" | "create" | "edit" | "view">(isNewRoute ? "create" : "list");
  const [selected, setSelected] = useState<EmpFormData | null>(null);
  const [loading, setLoading] = useState(false);

  // Filters
  const [fSearch, setFSearch] = useState("");
  const [fDepartment, setFDepartment] = useState("");
  const [fNationalId, setFNationalId] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [visibleColumns, setVisibleColumns] = useState<Record<OptionalColumn, boolean>>({
    englishName: false,
    directorate: true,
    nationality: true,
    nationalId: true,
    hireDate: true,
    phone: true,
    email: true,
  });

  useEffect(() => {
    if (isNewRoute) setMode("create");
  }, [isNewRoute]);

  const backToList = () => {
    setMode("list");
    if (isNewRoute) navigate("/hr/employees", { replace: true });
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [employeeResult, departmentResult] = await Promise.all([
          supabase.from("employees").select("*").order("created_at", { ascending: false }),
          supabase.from("org_sections").select("id, name, name_en").order("name"),
        ]);
        if (!employeeResult.error && employeeResult.data) setEmployees(employeeResult.data.map(mapRowToForm));
        if (!departmentResult.error) {
          setDepartmentOptions((departmentResult.data ?? []).map((row) => ({
            id: String(row.id),
            name: String(row.name),
            nameEn: String(row.name_en ?? ""),
          })));
        }
      } catch {
        // no-op
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [refreshKey]);

  const filtered = useMemo(() => employees.filter((employee) => {
    const keyword = fSearch.trim().toLowerCase();
    if (keyword && ![employee.name, employee.firstName, employee.empId, employee.accountTitle, employee.phone, employee.email, employee.nationalId]
      .some((value) => value.toLowerCase().includes(keyword))) return false;

    const selectedDepartment = departmentOptions.find((item) => item.id === fDepartment);
    if (
      fDepartment
      && employee.sectionId !== fDepartment
      && employee.department.trim() !== selectedDepartment?.name.trim()
    ) return false;

    const nationalIdKeyword = fNationalId.replace(/\D/g, "");
    const employeeNationalId = employee.nationalId.replace(/\D/g, "");
    if (nationalIdKeyword && !employeeNationalId.includes(nationalIdKeyword)) return false;
    if (fStatus && employee.status !== fStatus) return false;
    return true;
  }), [departmentOptions, employees, fSearch, fDepartment, fNationalId, fStatus]);

  useEffect(() => {
    setPage(1);
  }, [fSearch, fDepartment, fNationalId, fStatus, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const pageData = filtered.slice(pageStart, pageStart + pageSize);
  const visibleColumnCount = 8 + Object.values(visibleColumns).filter(Boolean).length;
  const allPageSelected = pageData.length > 0 && pageData.every((employee) => selectedIds.has(employee.id));

  // التصدير والطباعة: المحددون إن وُجد تحديد، وإلا كل نتائج الفلتر
  const outputRows = selectedIds.size ? filtered.filter((employee) => selectedIds.has(employee.id)) : filtered;

  const printEmployees = () => {
    if (!outputRows.length) {
      toast({ title: t("لا توجد بيانات للطباعة") });
      return;
    }
    const columns = [
      { key: "number", label: t("الرقم الوظيفي") },
      { key: "name", label: t("الاسم") },
      { key: "branch", label: t("الفرع") },
      ...(visibleColumns.directorate ? [{ key: "directorate", label: t("الإدارة") }] : []),
      { key: "department", label: t("القسم") },
      { key: "jobTitle", label: t("المسمى الوظيفي") },
      ...(visibleColumns.nationality ? [{ key: "nationality", label: t("الجنسية") }] : []),
      ...(visibleColumns.nationalId ? [{ key: "nationalId", label: t("رقم الهوية") }] : []),
      ...(visibleColumns.hireDate ? [{ key: "hireDate", label: t("تاريخ التعيين") }] : []),
      ...(visibleColumns.phone ? [{ key: "phone", label: t("رقم الجوال") }] : []),
      { key: "status", label: t("الحالة") },
    ];
    const opened = printReport({
      title: t("قائمة الموظفين"),
      subtitle: selectedIds.size ? `${t("الموظفون المحددون")}: ${outputRows.length}` : `${t("حسب الفلتر الحالي")}: ${outputRows.length}`,
      columns,
      rows: outputRows.map((employee) => ({
        number: employee.accountTitle && employee.accountTitle !== employee.empId ? `${employee.accountTitle} (${employee.empId})` : employee.empId,
        name: employee.name || employee.firstName,
        branch: employee.branch,
        directorate: employee.directorate,
        department: employee.department,
        jobTitle: employee.jobTitle,
        nationality: employee.nationality,
        nationalId: employee.nationalId,
        hireDate: employee.hireDate,
        phone: employee.phone,
        status: t(employee.status),
      })),
      fileName: "employees",
      landscape: true,
    });
    if (!opened) toast({ title: t("تعذر فتح نافذة الطباعة"), description: t("اسمح بالنوافذ المنبثقة لهذا الموقع"), variant: "destructive" });
  };

  const exportSafeEmployeesExcel = async () => {
    if (!outputRows.length) {
      toast({ title: t("لا توجد بيانات للتصدير") });
      return;
    }

    const reportDate = new Date();
    const dateLabel = `${reportDate.getFullYear()}-${String(reportDate.getMonth() + 1).padStart(2, "0")}-${String(reportDate.getDate()).padStart(2, "0")}`;
    const dayName = reportDate.toLocaleDateString("en-US", { weekday: "long" });
    const containsArabic = (value: string) => /[\u0600-\u06ff]/.test(value);
    const englishValue = (value: string | null | undefined, fallback = "-") => {
      const clean = String(value ?? "").trim();
      if (!clean) return fallback;
      return EXPORT_ENGLISH_VALUES[clean] || (!containsArabic(clean) ? clean : fallback);
    };
    const statusInEnglish: Record<string, string> = {
      "فعال": "Active", "نشط": "Active", active: "Active",
      "غير فعال": "Inactive", "غير نشط": "Inactive",
      "إجازة": "On Leave", "منتهي": "Terminated",
    };

    try {
      const [branchResult, departmentResult, jobResult, sectionResult] = await Promise.all([
        supabase.from("branches").select("id, name, name_en"),
        supabase.from("departments").select("id, name, name_en"),
        supabase.from("hr_jobs").select("name, name_en"),
        supabase.from("org_sections").select("id, name, name_en"),
      ]);
      const firstError = branchResult.error ?? departmentResult.error ?? jobResult.error ?? sectionResult.error;
      if (firstError) throw firstError;

      const branchesById = new Map((branchResult.data ?? []).map((row) => [String(row.id), englishValue(String(row.name_en ?? ""), englishValue(String(row.name ?? ""), "Not specified"))]));
      const departmentsById = new Map((departmentResult.data ?? []).map((row) => [String(row.id), englishValue(String(row.name_en ?? ""), englishValue(String(row.name ?? ""), "Not specified"))]));
      const sectionsById = new Map((sectionResult.data ?? []).map((row) => [String(row.id), englishValue(String(row.name_en ?? ""), englishValue(String(row.name ?? ""), "Not specified"))]));
      const jobsByName = new Map((jobResult.data ?? []).map((row) => [String(row.name ?? "").trim(), englishValue(String(row.name_en ?? ""), englishValue(String(row.name ?? ""), "Not specified"))]));
      const headers = ["No.", "Employee ID", "Employee Name", "Status", "Branch", "Management", "Department", "Job Title", "Nationality", "National ID", "Hire Date", "Mobile Number", "Email Address"];
      const workbook = new ExcelJS.Workbook();
      workbook.creator = COMPANY_PROFILE.companyNameEn || COMPANY_PROFILE.companyNameAr || PLATFORM_NAME_EN;
      workbook.created = reportDate;
      workbook.modified = reportDate;
      const worksheet = workbook.addWorksheet("Employees", { views: [{ state: "frozen", ySplit: 5, rightToLeft: false }] });
      const lastColumn = headers.length;

      worksheet.mergeCells(1, 1, 1, lastColumn);
      worksheet.getCell(1, 1).value = `EMPLOYEE LIST — ${dayName.toUpperCase()}`;
      worksheet.mergeCells(2, 1, 2, lastColumn);
      worksheet.getCell(2, 1).value = `${COMPANY_PROFILE.companyNameEn || COMPANY_PROFILE.companyNameAr} | Master employee register`;
      worksheet.mergeCells(3, 1, 3, lastColumn);
      worksheet.getCell(3, 1).value = `Last updated: ${dateLabel} | Use the filter arrows to search and sort records.`;
      worksheet.getRow(4).height = 8;
      worksheet.addRow(headers);

      outputRows.forEach((employee, index) => {
        worksheet.addRow([
          index + 1,
          employee.empId || employee.accountTitle || "-",
          englishValue(employee.firstName, englishValue(employee.name, employee.empId || "-")),
          statusInEnglish[employee.status] || englishValue(employee.status, "Not specified"),
          branchesById.get(employee.branchId) || englishValue(employee.branch, "Not specified"),
          departmentsById.get(employee.departmentId) || englishValue(employee.directorate, "Not specified"),
          sectionsById.get(employee.sectionId) || englishValue(employee.department, "Not specified"),
          jobsByName.get(employee.jobTitle.trim()) || englishValue(employee.jobTitle, "Not specified"),
          englishValue(employee.nationality, "Not specified"),
          employee.nationalId || "-",
          employee.hireDate || "-",
          employee.phone || "-",
          englishValue(employee.email),
        ]);
      });

      worksheet.columns = [8, 16, 28, 14, 22, 24, 24, 26, 18, 18, 16, 18, 30].map((width) => ({ width }));
      worksheet.getRow(1).height = 42;
      worksheet.getRow(2).height = 24;
      worksheet.getRow(3).height = 22;
      worksheet.getRow(5).height = 30;
      worksheet.getCell(1, 1).font = { bold: true, size: 22, color: { argb: "FFFFFFFF" } };
      worksheet.getCell(1, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF12324A" } };
      worksheet.getCell(1, 1).alignment = { horizontal: "left", vertical: "middle" };
      worksheet.getCell(2, 1).font = { italic: true, size: 12, color: { argb: "FF607080" } };
      worksheet.getCell(3, 1).font = { size: 10, color: { argb: "FF607080" } };
      worksheet.getRow(5).eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF087B68" } };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        cell.border = { top: { style: "thin", color: { argb: "FFFFFFFF" } }, bottom: { style: "thin", color: { argb: "FFFFFFFF" } }, left: { style: "thin", color: { argb: "FFFFFFFF" } }, right: { style: "thin", color: { argb: "FFFFFFFF" } } };
      });
      for (let rowNumber = 6; rowNumber <= worksheet.rowCount; rowNumber += 1) {
        const row = worksheet.getRow(rowNumber);
        row.height = 22;
        row.eachCell({ includeEmpty: true }, (cell) => {
          cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowNumber % 2 === 0 ? "FFF1F7F5" : "FFFFFFFF" } };
          cell.border = { bottom: { style: "thin", color: { argb: "FFD9E5E1" } } };
        });
      }
      worksheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: Math.max(5, worksheet.rowCount), column: lastColumn } };
      worksheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

      const output = await workbook.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([output], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `Employee_List_${dateLabel}_${dayName}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      toast({ title: "Excel export failed", description: exportError instanceof Error ? exportError.message : "Unable to generate the employee report", variant: "destructive" });
    }
  };

  const togglePageSelection = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      pageData.forEach((employee) => allPageSelected ? next.delete(employee.id) : next.add(employee.id));
      return next;
    });
  };

  if (mode === "create") {
    return (
      <EmployeeForm
        mode="create"
        initialData={emptyForm()}
        onBack={backToList}
        onSaved={() => { backToList(); setRefreshKey((k) => k + 1); }}
      />
    );
  }

  if (mode === "edit" && selected) {
    return (
      <EmployeeForm
        mode="edit"
        initialData={selected}
        onBack={() => setMode("list")}
        onSaved={() => { setMode("list"); setRefreshKey((k) => k + 1); }}
      />
    );
  }

  if (mode === "view" && selected) {
    return <EmployeeView employee={selected} onBack={() => setMode("list")} onEdit={() => setMode("edit")} />;
  }

  return (
    <Layout>
      <div dir={direction} className="space-y-4">
        {/* ─── Header bar ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <Users className="h-5 w-5 text-blue-600" />
            {t("قائمة الموظفين")}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <EmployeesImportButton onDone={() => setRefreshKey((k) => k + 1)} />
            <button
              onClick={() => setMode("create")}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition shadow"
            >
              + {t("إضافة موظف جديد")}
            </button>
          </div>
        </div>

        {/* ─── Table Card ─────────────────────────────────────────────────── */}
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden" onClick={() => showColumnMenu && setShowColumnMenu(false)}>
          {/* Blue title bar */}
          <div className="bg-blue-700 px-4 py-2.5 flex items-center justify-between text-white">
            <span className="font-semibold text-sm">
              {t("قائمة الموظفين")} — {formatNumber(filtered.length)} {t("موظف")}
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => void exportSafeEmployeesExcel()} title={selectedIds.size ? t("تحميل المحددين Excel") : t("تحميل تقرير الموظفين Excel")} className="p-1.5 rounded hover:bg-white/20 transition"><Download className="h-4 w-4" /></button>
              <button onClick={printEmployees} title={selectedIds.size ? t("طباعة المحددين") : t("طباعة")} className="p-1.5 rounded hover:bg-white/20 transition"><Printer className="h-4 w-4" /></button>
              <button onClick={() => setRefreshKey((k) => k + 1)} title={t("تحديث")} className="p-1.5 rounded hover:bg-white/20 transition"><RefreshCw className="h-4 w-4" /></button>
              <div className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowColumnMenu((v) => !v); }}
                  title={t("إظهار/إخفاء الأعمدة")}
                  className="p-1.5 rounded hover:bg-white/20 transition"
                >
                  <Columns3 className="h-4 w-4" />
                </button>
                {showColumnMenu && (
                  <div
                    className="absolute left-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-50 p-2 space-y-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <p className="text-xs font-semibold text-gray-500 px-2 pb-1">{t("إظهار / إخفاء الأعمدة")}</p>
                    {OPTIONAL_COLUMNS.map(({ key, label }) => (
                      <label key={key} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 cursor-pointer text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={visibleColumns[key]}
                          onChange={() => setVisibleColumns((prev) => ({ ...prev, [key]: !prev[key] }))}
                          className="rounded"
                        />
                        {t(label)}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Filters row */}
          <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
              <input
                type="text"
                placeholder={t("البحث بالاسم أو الرقم الوظيفي...")}
                value={fSearch}
                onChange={(e) => setFSearch(e.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white pe-8 ps-3 py-1.5 text-sm text-start focus:outline-none focus:border-blue-400"
              />
            </div>
            <select
              value={fDepartment}
              onChange={(e) => setFDepartment(e.target.value)}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-right focus:outline-none focus:border-blue-400"
            >
              <option value="">{t("جميع الأقسام")}</option>
              {departmentOptions.map((department) => (
                <option key={department.id} value={department.id}>
                  {locale === "en" && department.nameEn ? department.nameEn : department.name}
                </option>
              ))}
            </select>
            <div className="relative min-w-[170px]">
              <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
              <input
                type="text"
                inputMode="numeric"
                placeholder={t("البحث برقم الهوية...")}
                value={fNationalId}
                onChange={(e) => setFNationalId(e.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white pe-8 ps-3 py-1.5 text-sm text-start focus:outline-none focus:border-blue-400"
              />
            </div>
            <select
              value={fStatus}
              onChange={(e) => setFStatus(e.target.value)}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-right focus:outline-none focus:border-blue-400"
            >
              <option value="">{t("جميع الحالات")}</option>
              {STATUSES.map((s) => <option key={s}>{t(s)}</option>)}
            </select>
            <button
              onClick={() => { setFSearch(""); setFDepartment(""); setFNationalId(""); setFStatus(""); }}
              className="px-3 py-1.5 text-sm rounded-md border border-gray-300 bg-white hover:bg-gray-100 transition text-gray-600"
            >
              {t("مسح")}
            </button>
            {selectedIds.size > 0 && (
              <span className="flex items-center gap-2 text-xs text-blue-700 font-semibold bg-blue-50 border border-blue-200 px-2 py-1 rounded-md">
                {formatNumber(selectedIds.size)} {t("محدد")} — {t("الطباعة والتصدير للمحددين فقط")}
                <button type="button" onClick={() => setSelectedIds(new Set())} className="text-rose-600 hover:underline">{t("إلغاء التحديد")}</button>
              </span>
            )}
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs" dir={direction}>
              <thead>
                <tr className="bg-slate-100 border-b border-gray-200">
                  <th className="px-3 py-2.5 text-center font-semibold text-gray-600 w-8 whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={allPageSelected}
                      onChange={togglePageSelection}
                      className="rounded"
                    />
                  </th>
                  <th className="px-3 py-2.5 text-start font-semibold text-gray-600 whitespace-nowrap">{t("الرقم الوظيفي")}</th>
                  <th className="px-3 py-2.5 text-center font-semibold text-gray-600 whitespace-nowrap">{t("إجراءات")}</th>
                  <th className="px-3 py-2.5 text-start font-semibold text-gray-600 whitespace-nowrap">{t("الاسم")}</th>
                  {visibleColumns.englishName && <th className="px-3 py-2.5 text-start font-semibold text-gray-600 whitespace-nowrap">{t("الاسم بالإنجليزية")}</th>}
                  <th className="px-3 py-2.5 text-start font-semibold text-gray-600 whitespace-nowrap">{t("الفرع")}</th>
                  {visibleColumns.directorate && <th className="px-3 py-2.5 text-start font-semibold text-gray-600 whitespace-nowrap">{t("الإدارة")}</th>}
                  <th className="px-3 py-2.5 text-start font-semibold text-gray-600 whitespace-nowrap">{t("القسم")}</th>
                  <th className="px-3 py-2.5 text-start font-semibold text-gray-600 whitespace-nowrap">{t("المسمى الوظيفي")}</th>
                  {visibleColumns.nationality && <th className="px-3 py-2.5 text-start font-semibold text-gray-600 whitespace-nowrap">{t("الجنسية")}</th>}
                  {visibleColumns.nationalId && <th className="px-3 py-2.5 text-start font-semibold text-gray-600 whitespace-nowrap">{t("رقم الهوية")}</th>}
                  {visibleColumns.hireDate && <th className="px-3 py-2.5 text-start font-semibold text-gray-600 whitespace-nowrap">{t("تاريخ التعيين")}</th>}
                  {visibleColumns.phone && <th className="px-3 py-2.5 text-start font-semibold text-gray-600 whitespace-nowrap">{t("رقم الجوال")}</th>}
                  {visibleColumns.email && <th className="px-3 py-2.5 text-start font-semibold text-gray-600 whitespace-nowrap">{t("البريد الإلكتروني")}</th>}
                  <th className="px-3 py-2.5 text-start font-semibold text-gray-600 whitespace-nowrap">{t("وضع العمل")}</th>
                  <th className="px-3 py-2.5 text-start font-semibold text-gray-600 whitespace-nowrap">{t("الحالة")}</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={visibleColumnCount + 2} className="py-12 text-center text-gray-400 text-sm">{t("جاري التحميل...")}</td>
                  </tr>
                )}
                {!loading && pageData.map((emp, idx) => (
                  <tr
                    key={emp.id}
                    className={cn(
                      "border-b border-gray-100 transition-colors",
                      idx % 2 === 0 ? "bg-white" : "bg-slate-50/60",
                      selectedIds.has(emp.id) && "bg-blue-50",
                      "hover:bg-blue-50/70"
                    )}
                  >
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(emp.id)}
                        onChange={() => setSelectedIds((prev) => {
                          const next = new Set(prev);
                          next.has(emp.id) ? next.delete(emp.id) : next.add(emp.id);
                          return next;
                        })}
                        className="rounded"
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-blue-800 font-semibold whitespace-nowrap">
                      {emp.accountTitle || emp.empId || "—"}
                      {emp.accountTitle && emp.empId && emp.accountTitle !== emp.empId && (
                        <span className="text-[10px] text-gray-400 font-normal block">{emp.empId}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-center gap-0.5">
                        <button onClick={() => { setSelected(emp); setMode("view"); }} className="p-1 text-blue-600 hover:bg-blue-100 rounded" title={t("عرض")}><Eye className="h-3.5 w-3.5" /></button>
                        <button onClick={() => { setSelected(emp); setMode("edit"); }} className="p-1 text-emerald-600 hover:bg-emerald-100 rounded" title={t("تعديل")}><Edit className="h-3.5 w-3.5" /></button>
                        <button onClick={() => handleDelete(emp)} className="p-1 text-rose-600 hover:bg-rose-100 rounded" title={t("حذف")}><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </td>
                    <td className="px-3 py-2 font-semibold text-gray-800 whitespace-nowrap">{locale === "en" ? emp.firstName || emp.name || "—" : emp.name || emp.firstName || "—"}</td>
                    {visibleColumns.englishName && <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{emp.firstName || "—"}</td>}
                    <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{emp.branch || "—"}</td>
                    {visibleColumns.directorate && <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{emp.directorate || "—"}</td>}
                    <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{emp.department || "—"}</td>
                    <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{emp.jobTitle || "—"}</td>
                    {visibleColumns.nationality && <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{emp.nationality || "—"}</td>}
                    {visibleColumns.nationalId && <td className="px-3 py-2 font-mono text-gray-600 whitespace-nowrap">{emp.nationalId || "—"}</td>}
                    {visibleColumns.hireDate && <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{emp.hireDate || "—"}</td>}
                    {visibleColumns.phone && <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{emp.phone || "—"}</td>}
                    {visibleColumns.email && <td className="px-3 py-2 text-gray-500 whitespace-nowrap max-w-[160px] truncate">{emp.email || "—"}</td>}
                    <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{emp.employmentType || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={cn("inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold border", STATUS_COLORS[emp.status] ?? "bg-gray-100 text-gray-600 border-gray-200")}>
                        {emp.status ? t(emp.status) : "—"}
                      </span>
                    </td>
                  </tr>
                ))}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={visibleColumnCount + 2} className="py-14 text-center text-gray-400">{t("لا يوجد موظفون")}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Footer: pagination + page size + count */}
          <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50 flex flex-wrap items-center justify-between gap-3 text-xs text-gray-600">
            <div className="flex items-center gap-2">
              <span>{t("عرض")}</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value) || 10)}
                className="rounded border border-gray-300 bg-white px-2 py-1 text-xs focus:outline-none"
              >
                {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <span>{t("من أصل")} {formatNumber(filtered.length)}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="px-2 text-gray-500">
                {filtered.length > 0
                  ? `${formatNumber(pageStart + 1)} ${t("إلى")} ${formatNumber(Math.min(pageStart + pageSize, filtered.length))} ${t("من")} ${formatNumber(filtered.length)}`
                  : `0 ${t("نتائج")}`}
              </span>
              <button
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="p-1 rounded border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-40 transition"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const pageNumber = safePage <= 3 ? i + 1 : safePage + i - 2;
                if (pageNumber < 1 || pageNumber > totalPages) return null;
                return (
                  <button
                    key={pageNumber}
                    onClick={() => setPage(pageNumber)}
                    className={cn(
                      "w-6 h-6 rounded border text-[11px] transition",
                      pageNumber === safePage
                        ? "bg-blue-700 text-white border-blue-700 font-bold"
                        : "bg-white border-gray-300 hover:bg-gray-100"
                    )}
                  >
                    {pageNumber}
                  </button>
                );
              })}
              <button
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="p-1 rounded border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-40 transition"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-700">{t("العدد")}</span>
              <span className="font-bold text-blue-700">{formatNumber(filtered.length)}</span>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );

  async function handleDelete(emp: EmpFormData) {
    const result = await deleteOrDeactivateEmployee(emp, t);
    if (result === "deleted") {
      setEmployees((prev) => prev.filter((e) => e.id !== emp.id));
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(emp.id); return next; });
    } else if (result === "deactivated") {
      setEmployees((prev) => prev.map((e) => e.id === emp.id ? { ...e, status: "غير فعال" } : e));
    }
  }
}

// ─── Employee View ────────────────────────────────────────────────────────────
function EmployeeView({ employee: emp, onBack, onEdit }: { employee: EmpFormData; onBack: () => void; onEdit: () => void }) {
  const { t, direction, locale, formatNumber } = useI18n();
  const money = (value: number) => `${formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${t("ر.س")}`;
  const total = computeTotalSalary(emp.baseSalary, emp.allowances);
  const documentLabels: Record<string, string> = {
    id_card: "صورة بطاقة الهوية", passport: "صورة جواز السفر", cv: "سيرة ذاتية",
    personal_photo: "صورة شخصية", qualification: "المؤهل العملي", other: "وثائق أخرى",
  };
  const documents = Object.entries(emp.documents).filter(([key, value]) => !key.endsWith("_name") && value);

  return (
    <Layout>
      <div dir={direction} className="space-y-6 w-full">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">{t("بيانات الموظف")}</h1>
          <div className="flex gap-2">
            <button onClick={onBack} className="flex items-center gap-1 px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm hover:bg-gray-50">
              <ArrowRight className="h-4 w-4" /> {t("رجوع")}
            </button>
            <button onClick={onEdit} className="flex items-center gap-1 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">
              <Edit className="h-4 w-4" /> {t("تعديل")}
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow border border-gray-100 p-6 space-y-6">
          {/* Header */}
          <div className="flex items-center gap-4 pb-4 border-b">
            <div className="h-16 w-16 overflow-hidden rounded-full bg-blue-600 flex items-center justify-center text-white text-2xl font-bold">
              <EmployeePhoto value={emp.photoUrl} name={emp.name || emp.firstName} />
            </div>
            <div>
              <div className="text-xl font-bold">{locale === "en" ? emp.firstName || emp.name : emp.name || emp.firstName}</div>
              <div className="text-sm text-gray-500">
                {emp.empId}{emp.accountTitle && emp.accountTitle !== emp.empId ? ` (${emp.accountTitle})` : ""} | {emp.jobTitle || "—"}
              </div>
              <span className={cn("inline-block px-2 py-0.5 rounded-full text-xs font-semibold border mt-1", STATUS_COLORS[emp.status] ?? "bg-gray-100 text-gray-600")}>
                {emp.status ? t(emp.status) : "—"}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <InfoGroup title={t("المعلومات الشخصية")}>
              <InfoRow label={t("الجنسية")} value={emp.nationality} />
              <InfoRow label={t("رقم الهوية / الإقامة")} value={emp.nationalId} />
              <InfoRow label={t("تاريخ انتهاء الهوية")} value={emp.idExpiryDate} />
              <InfoRow label={t("الجنس")} value={emp.gender} />
              <InfoRow label={t("تاريخ الميلاد")} value={emp.birthDate} />
              <InfoRow label={t("الحالة الاجتماعية")} value={emp.maritalStatus} />
              <InfoRow label={t("الجوال")} value={emp.phone} />
              <InfoRow label={t("البريد الإلكتروني")} value={emp.email} />
              <InfoRow label={t("رقم جواز السفر")} value={emp.passportNumber} />
              <InfoRow label={t("انتهاء جواز السفر")} value={emp.passportExpiryDate} />
            </InfoGroup>
            <InfoGroup title={t("المعلومات الوظيفية")}>
              <InfoRow label={t("الفرع")} value={emp.branch} />
              <InfoRow label={t("الإدارة")} value={emp.directorate} />
              <InfoRow label={t("القسم")} value={emp.department} />
              <InfoRow label={t("المسمى الوظيفي")} value={emp.jobTitle} />
              <InfoRow label={t("نوع التوظيف")} value={emp.employmentType} />
              <InfoRow label={t("تاريخ التعيين")} value={emp.hireDate} />
              <InfoRow label={t("عقد محدد المدة")} value={emp.isContractEnd ? `${t("نعم")} — ${emp.contractEndDate || "—"}` : t("لا")} />
              <InfoRow label={t("المدير المباشر")} value={emp.directManager} />
              <InfoRow label={t("مكان العمل")} value={emp.workLocation} />
              <InfoRow label={t("جدول العمل")} value={emp.workSchedule} />
              <InfoRow label={t("الدور في النظام")} value={emp.employeeRole} />
            </InfoGroup>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <InfoGroup title={t("الراتب والبدلات")}>
              <InfoRow label={t("الراتب الأساسي")} value={money(emp.baseSalary)} />
              {emp.allowances.map((allowance) => (
                <Fragment key={allowance.id}><InfoRow
                  label={`${t(allowance.type || "بدل")}${allowance.from || allowance.to ? ` (${allowance.from || "…"} → ${allowance.to || "…"})` : ""}`}
                  value={`${allowance.effect === "مخصوم" ? "−" : "+"} ${money(Number(allowance.amount) || 0)}`}
                /></Fragment>
              ))}
              <InfoRow label={t("إجمالي الراتب الشهري")} value={money(total)} />
              {isSaudiCompany() ? <InfoRow label={t("التأمينات الاجتماعية")} value={emp.socialInsurance === "نعم" ? `${t("نعم")} — ${emp.socialInsuranceType || "—"}` : emp.socialInsurance === "" ? t("غير محدد") : t("لا")} /> : null}
              <InfoRow label={t("البنك")} value={emp.bankName} />
              <InfoRow label={t("الآيبان")} value={emp.iban} />
            </InfoGroup>
            <InfoGroup title={t("الوثائق")}>
              {documents.length === 0 && <p className="text-sm text-gray-400">{t("لا توجد وثائق مرفوعة")}</p>}
              {documents.map(([key, value]) => (
                <div key={key} className="flex justify-between text-sm">
                  <span className="text-gray-500">{t(documentLabels[key] ?? key)}</span>
                  {isEmployeeStoragePath(value) ? (
                    <button
                      type="button"
                      className="font-medium text-blue-600 hover:underline"
                      onClick={async () => {
                        const opened = await openEmployeeFile(value);
                        if (!opened) toast({ title: t("تعذر فتح الملف"), variant: "destructive" });
                      }}
                    >
                      {emp.documents[`${key}_name`] || employeeFileName(value)}
                    </button>
                  ) : (
                    <span className="text-amber-600">{value} — {t("لم يُرفع الملف")}</span>
                  )}
                </div>
              ))}
            </InfoGroup>
          </div>
        </div>
      </div>
    </Layout>
  );
}

function InfoGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-gray-700 mb-3 border-b pb-1">{title}</h4>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-800">{value || "—"}</span>
    </div>
  );
}
