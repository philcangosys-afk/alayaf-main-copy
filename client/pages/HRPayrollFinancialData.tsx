import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { Printer, Download } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { exportReportExcel, printReport, ReportColumn } from "@/lib/reportExport";
import { useI18n } from "@/i18n";
import { fetchAllRows } from "@/lib/fetchAll";
import { hrRequestErrorText } from "@/lib/hrErrors";
import { ACTIVE_EMPLOYEE_STATUSES } from "@/lib/hrStatus";

type EmpRow = { id: string; name: string; jobTitle: string; department: string; branch: string; workTime: string; baseSalary: number; status: string };

// على رأس العمل: فعال/نشط أو في إجازة (الحالة الفارغة تُعامل كفعال كما في ملف الموظف)
const isOnPayroll = (status: string) => !status || ACTIVE_EMPLOYEE_STATUSES.includes(status) || status === "إجازة";

export default function HRPayrollFinancialData() {
  const { t, direction, formatNumber } = useI18n();
  const [employees, setEmployees] = useState<EmpRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        // كل الموظفين على دفعات (لا يتوقف عند حد 1000 صف)
        const data = await fetchAllRows<Record<string, any>>((from, to) =>
          supabase.from("employees").select("id, name, job_title, department, branch, work_time, base_salary, total_salary, status").order("created_at", { ascending: false }).order("id").range(from, to));
        setEmployees(data.map((r) => ({
          id: String(r.id), name: String(r.name ?? ""), jobTitle: String(r.job_title ?? ""),
          department: String(r.department ?? ""), branch: String(r.branch ?? ""),
          workTime: r.work_time == null ? "" : String(r.work_time), baseSalary: Number(r.base_salary ?? 0),
          status: String(r.status ?? "").trim(),
        })));
      } catch (error) {
        setEmployees([]);
        toast({ title: t("تعذر تحميل البيانات"), description: t(hrRequestErrorText(error)), variant: "destructive" });
      } finally { setLoading(false); }
    };
    load();
  }, []);

  const reportColumns: ReportColumn[] = [
    { key: "name", label: "الاسم", width: 26 },
    { key: "jobTitle", label: "المسمى الوظيفي", width: 22 },
    { key: "department", label: "القسم", width: 20 },
    { key: "branch", label: "الفرع", width: 18 },
    { key: "baseSalary", label: "الراتب الأساسي", width: 16 },
    { key: "workTime", label: "وقت العمل", width: 14 },
    { key: "status", label: "الحالة", width: 12 },
  ];
  const reportRows = () => employees.map((emp) => ({
    name: emp.name,
    jobTitle: emp.jobTitle || "-",
    department: emp.department || "-",
    branch: emp.branch || "-",
    baseSalary: emp.baseSalary,
    workTime: emp.workTime || "كامل",
    status: emp.status || "فعال",
  }));
  // الإجمالي للموظفين على رأس العمل فقط (فعال أو في إجازة)؛ المنتهية خدمتهم وغير الفعالين لا يدخلون
  const reportSummary = () => {
    const onPayroll = employees.filter((emp) => isOnPayroll(emp.status));
    return [
      { label: "عدد الموظفين", value: employees.length },
      { label: "الموظفون على رأس العمل (فعال أو في إجازة)", value: onPayroll.length },
      { label: "إجمالي الرواتب الأساسية", value: onPayroll.reduce((sum, emp) => sum + emp.baseSalary, 0) },
    ];
  };
  const handleExport = () => {
    if (!employees.length) { toast({ title: t("لا توجد بيانات للتصدير") }); return; }
    exportReportExcel({ title: "البيانات المالية للموظفين", columns: reportColumns, rows: reportRows(), fileName: "employees-financial-data", summary: reportSummary() });
  };
  const handlePrint = () => {
    if (!employees.length) { toast({ title: t("لا توجد بيانات للتصدير") }); return; }
    if (!printReport({ title: "البيانات المالية للموظفين", columns: reportColumns, rows: reportRows(), fileName: "employees-financial-data", summary: reportSummary(), landscape: true })) {
      toast({ title: t("تعذر فتح نافذة الطباعة"), description: t("اسمح بالنوافذ المنبثقة ثم أعد المحاولة"), variant: "destructive" });
    }
  };

  return (
    <Layout>
      <div className="p-6 max-w-[1600px] mx-auto space-y-6" dir={direction}>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="bg-[#004e89] text-white p-3 flex items-center justify-between gap-4">
            <h2 className="text-lg font-bold">{t("البيانات المالية للموظفين")}</h2>
            <div className="flex items-center gap-2">
              <button onClick={handleExport} disabled={loading} className="p-1.5 hover:bg-white/10 rounded transition-colors text-white disabled:opacity-50" title={t("تصدير Excel")} aria-label={t("تصدير Excel")}><Download className="h-4 w-4" /></button>
              <button onClick={handlePrint} disabled={loading} className="p-1.5 hover:bg-white/10 rounded transition-colors text-white disabled:opacity-50" title={t("طباعة")} aria-label={t("طباعة")}><Printer className="h-4 w-4" /></button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-start whitespace-nowrap">
              <thead className="bg-gray-50 text-gray-700 border-b border-gray-200">
                <tr>
                  <th className="py-3 px-4 font-medium text-center w-16">{t("الصورة")}</th>
                  <th className="py-3 px-4 font-medium">{t("الاسم")}</th>
                  <th className="py-3 px-4 font-medium">{t("المسمى الوظيفي")}</th>
                  <th className="py-3 px-4 font-medium">{t("القسم")}</th>
                  <th className="py-3 px-4 font-medium">{t("الفرع")}</th>
                  <th className="py-3 px-4 font-medium">{t("الراتب الأساسي")}</th>
                  <th className="py-3 px-4 font-medium">{t("وقت العمل")}</th>
                  <th className="py-3 px-4 font-medium">{t("الحالة")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr><td colSpan={8} className="py-8 text-center text-gray-400">{t("جاري التحميل...")}</td></tr>
                ) : employees.length === 0 ? (
                  <tr><td colSpan={8} className="py-8 text-center text-gray-500">{t("لا يوجد موظفون")}</td></tr>
                ) : employees.map((emp) => (
                  <tr key={emp.id} className="hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-4 flex justify-center">
                      <Avatar className="h-8 w-8"><AvatarFallback className="bg-[#004e89] text-white text-xs">{emp.name.charAt(0)}</AvatarFallback></Avatar>
                    </td>
                    <td className="py-3 px-4 font-medium text-gray-900">{emp.name}</td>
                    <td className="py-3 px-4">{emp.jobTitle || t("—")}</td>
                    <td className="py-3 px-4">{emp.department || t("—")}</td>
                    <td className="py-3 px-4">{emp.branch || t("—")}</td>
                    <td className="py-3 px-4 font-semibold text-emerald-700">{formatNumber(emp.baseSalary, { style: "currency", currency: "SAR", minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                    <td className="py-3 px-4">{emp.workTime || t("كامل")}</td>
                    <td className="py-3 px-4">{t(emp.status || "فعال")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Layout>
  );
}
