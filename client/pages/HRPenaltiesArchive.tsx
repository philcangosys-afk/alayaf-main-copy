import { useEffect, useMemo, useState } from "react";
import Layout from "@/components/Layout";
import { Printer, FileText, Download, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n";
import { hrRequestErrorText } from "@/lib/hrErrors";
import { isApprovedStatus } from "@/lib/hrStatus";

type PenaltyRow = {
  id: string;
  employee_id: string | null;
  emp_name: string | null;
  penalty_type: string | null;
  amount: number | null;
  reason: string | null;
  date: string | null;
  status: string | null;
  created_at: string | null;
};

// رواتب الشهر المعتمدة أو المرحّلة أو المدفوعة (أو المرحّلة محاسبيًا) مقفلة
const LOCKED_PAYROLL_FILTER = "status.in.(معتمد,مرحّل,مدفوع),accounting_status.eq.posted";

// هل دخل هذا الجزاء في رواتب شهر مقفل؟ مسير الرواتب يخصم الجزاء المعتمد من شهر تاريخه (penalties.date)
// وما زاد على سقف المادة 72 يُرحَّل للأشهر التالية، فيُفحص شهره وما بعده.
// يربطه بالموظف بمعرّفه (penalties.employee_id = employees.id)، بينما payroll.emp_id هو الرقم الوظيفي.
// الجزاء غير المعتمد (معلق أو مرفوض) لم يُخصم قط، فيُحذف بلا فحص.
const isPenaltyPayrollLocked = async (row: PenaltyRow): Promise<boolean> => {
  if (!isApprovedStatus(row.status)) return false;
  const date = String(row.date ?? "").slice(0, 10);
  // الجزاء بلا تاريخ لا يدخل أي مسير رواتب
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const month = date.slice(0, 7);
  let empCode = "";
  const employeeId = String(row.employee_id ?? "").trim();
  if (employeeId) {
    const { data, error } = await supabase.from("employees").select("emp_id").eq("id", employeeId).maybeSingle();
    // 22P02: المعرّف المخزن ليس uuid صالحًا؛ نعامله كموظف غير محدد
    if (error && (error as { code?: string }).code !== "22P02") throw error;
    empCode = String(data?.emp_id ?? "").trim();
  }
  let query = supabase.from("payroll").select("id", { count: "exact", head: true }).gte("month", month).or(LOCKED_PAYROLL_FILTER);
  // إن تعذر تحديد الموظف نمنع الحذف إذا كان أي راتب في ذلك الشهر مقفلًا
  if (empCode) query = query.eq("emp_id", empCode);
  const { count, error } = await query;
  if (error) throw error;
  return (count ?? 0) > 0;
};

// منع حقن الصيغ عند فتح الملف في Excel: الخلية التي تبدأ بـ = + - @ تُسبق بفاصلة عليا
const csvCell = (value: unknown) => {
  const text = String(value ?? "");
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

export default function HRPenaltiesArchive() {
  const { t, direction } = useI18n();
  const [rows, setRows] = useState<PenaltyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("الكل");
  const [typeFilter, setTypeFilter] = useState("الكل");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("penalties")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      toast({ title: t("خطأ في التحميل"), description: error.message, variant: "destructive" });
    } else {
      setRows((data as PenaltyRow[]) ?? []);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const penaltyTypes = useMemo(
    () => Array.from(new Set(rows.map((r) => r.penalty_type).filter(Boolean))) as string[],
    [rows],
  );

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (statusFilter !== "الكل" && (r.status ?? "") !== statusFilter) return false;
        if (typeFilter !== "الكل" && (r.penalty_type ?? "") !== typeFilter) return false;
        return true;
      }),
    [rows, statusFilter, typeFilter],
  );

  const handleDelete = async (row: PenaltyRow) => {
    const id = row.id;
    if (!confirm(t("هل تريد حذف هذا الجزاء من الأرشيف؟"))) return;
    try {
      if (await isPenaltyPayrollLocked(row)) {
        toast({ title: t("تعذّر الحذف"), description: t("رواتب هذا الشهر معتمدة أو مرحّلة؛ لا يُحذف جزاء خُصم منها"), variant: "destructive" });
        return;
      }
    } catch (error) {
      toast({ title: t("تعذّر التحقق من رواتب الشهر"), description: t(hrRequestErrorText(error)), variant: "destructive" });
      return;
    }
    const { data, error } = await supabase.from("penalties").delete().eq("id", id).select("id");
    if (error) {
      toast({ title: t("تعذّر الحذف"), description: t(hrRequestErrorText(error)), variant: "destructive" });
      return;
    }
    if (!data?.length) {
      toast({ title: t("تعذّر الحذف"), description: t("لم يُحذف شيء: السجل غير موجود أو لا تملك صلاحية حذفه"), variant: "destructive" });
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== id));
    toast({ title: t("تم الحذف") });
  };

  const handlePrint = () => window.print();

  const handleExport = () => {
    const header = [t("رقم المساءلة"), t("إسم الموظف"), t("المخالفة"), t("الجزاء"), t("المبلغ"), t("الحالة"), t("التاريخ")];
    const lines = filtered.map((r) =>
      [r.id, r.emp_name ?? "", r.reason ?? "", r.penalty_type ?? "", r.amount ?? 0, r.status ?? "", r.date ?? ""]
        .map(csvCell)
        .join(","),
    );
    const csv = "\uFEFF" + [header.map(csvCell).join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "penalties-archive.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Layout>
      <div className="p-6 max-w-[1600px] mx-auto space-y-6" dir={direction}>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="bg-[#004e89] text-white p-3 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-4 w-full md:w-auto">
              <h2 className="text-lg font-bold whitespace-nowrap hidden sm:block">{t("ارشيف الجزاءات")}</h2>
              <div className="flex gap-2 text-black w-full sm:w-auto">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="h-8 rounded px-2 text-sm bg-white border-none outline-none flex-1 sm:w-[120px]"
                >
                  <option value="الكل">{t("الكل")}</option>
                  <option value="معتمد">{t("معتمد")}</option>
                  <option value="معلق">{t("معلق")}</option>
                  <option value="مرفوض">{t("مرفوض")}</option>
                </select>
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="h-8 rounded px-2 text-sm bg-white border-none outline-none flex-1 sm:w-[180px]"
                >
                  <option value="الكل">{t("الكل")}</option>
                  {penaltyTypes.map((pt) => (
                    <option key={pt} value={pt}>{pt}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-end">
              <h2 className="text-lg font-bold sm:hidden">{t("ارشيف الجزاءات")}</h2>
              <div className="flex items-center gap-2">
                <button onClick={handleExport} className="p-1.5 hover:bg-white/10 rounded transition-colors text-white" title={t("تصدير")} aria-label={t("تصدير")}>
                  <Download className="h-4 w-4" />
                </button>
                <button onClick={load} className="p-1.5 hover:bg-white/10 rounded transition-colors text-white" title={t("تحديث")} aria-label={t("تحديث")}>
                  <FileText className="h-4 w-4" />
                </button>
                <button onClick={handlePrint} className="p-1.5 hover:bg-white/10 rounded transition-colors text-white" title={t("طباعة")} aria-label={t("طباعة")}>
                  <Printer className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm text-center whitespace-nowrap">
              <thead className="bg-gray-50 text-gray-700 border-b border-gray-200">
                <tr>
                  <th className="py-3 px-2 font-medium">{t("رقم المساءلة")}</th>
                  <th className="py-3 px-2 font-medium min-w-[150px]">{t("إسم الموظف")}</th>
                  <th className="py-3 px-2 font-medium">{t("رقم الموظف")}</th>
                  <th className="py-3 px-2 font-medium min-w-[160px]">{t("المخالفة")}</th>
                  <th className="py-3 px-2 font-medium">{t("الجزاء")}</th>
                  <th className="py-3 px-2 font-medium">{t("المبلغ")}</th>
                  <th className="py-3 px-2 font-medium">{t("الحالة")}</th>
                  <th className="py-3 px-2 font-medium">{t("تاريخ الإضافة")}</th>
                  <th className="py-3 px-2 font-medium">{t("الإجراءات")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-gray-500">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto text-[#004e89]" />
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-gray-500">
                      <div className="flex flex-col items-center justify-center gap-3">
                        <FileText className="h-10 w-10 text-gray-300" />
                        <p>{t("لا توجد بيانات في الجدول")}</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="py-2.5 px-2 text-gray-500">{r.id.slice(0, 8)}</td>
                      <td className="py-2.5 px-2 font-medium text-gray-800">{r.emp_name || "-"}</td>
                      <td className="py-2.5 px-2 text-gray-600">{r.employee_id || "-"}</td>
                      <td className="py-2.5 px-2 text-gray-600">{r.reason || "-"}</td>
                      <td className="py-2.5 px-2 text-gray-600">{r.penalty_type || "-"}</td>
                      <td className="py-2.5 px-2 text-red-600 font-medium">{Number(r.amount ?? 0).toLocaleString()}</td>
                      <td className="py-2.5 px-2">
                        <span
                          className={
                            "px-2 py-0.5 rounded-full text-xs " +
                            ((r.status ?? "") === "معتمد"
                              ? "bg-green-100 text-green-700"
                              : (r.status ?? "") === "مرفوض"
                                ? "bg-red-100 text-red-700"
                                : "bg-amber-100 text-amber-700")
                          }
                        >
                          {t(r.status || "معلق")}
                        </span>
                      </td>
                      <td className="py-2.5 px-2 text-gray-500">
                        {r.date || (r.created_at ? new Date(r.created_at).toLocaleDateString("ar-EG") : "-")}
                      </td>
                      <td className="py-2.5 px-2">
                        <button onClick={() => handleDelete(r)} className="text-red-500 hover:text-red-700" title={t("حذف")} aria-label={t("حذف")}>
                          <Trash2 className="h-4 w-4 mx-auto" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="bg-gray-50 p-4 border-t border-gray-100 flex items-center justify-between text-sm">
            <span className="text-gray-500">{t("يعرض")} {filtered.length} {t("من أصل")} {rows.length} {t("سجل")}</span>
            <div className="flex gap-1 opacity-50 pointer-events-none">
              <Button variant="outline" size="sm" className="h-8 px-3">{t("السابق")}</Button>
              <Button variant="outline" size="sm" className="h-8 px-3">{t("التالي")}</Button>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
