import { useEffect, useMemo, useState } from "react";
import Layout from "@/components/Layout";
import {
  Printer,
  Download,
  Eye,
  FileText,
  XCircle,
  RefreshCw,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { exportReportExcel, printReport, ReportColumn } from "@/lib/reportExport";
import { fetchAllRows } from "@/lib/fetchAll";
import { hrRequestErrorText } from "@/lib/hrErrors";
import { useI18n } from "@/i18n";

type ArchiveRow = {
  id: string;
  month: string;
  empName: string;
  department: string;
  basicSalary: number;
  allowances: number;
  overtime: number;
  bonus: number;
  socialInsurance: number;
  deductions: number;
  netSalary: number;
  status: string;
  paidDate: string;
  notes: string;
};

const ALL = "الكل";
const POSTED = "مرحّل";
// راتب مرحّل محاسبيًا (مستحق في القيد) وصرفه محبوس حتى يُرفع إيقافه من صفحة الترحيل
const HELD_POSTED = "موقوف الصرف";
// الرواتب المعتمدة أو المرحّلة أو المدفوعة لا تُحذف من الأرشيف
// والموقوف لا يُحذف: إيقافه قرار إدارة، وحذفه يُسقط استحقاقه من قيد الشهر
const LOCKED_STATUSES = ["معتمد", POSTED, HELD_POSTED, "مدفوع", "موقوف"];
const canDeletePayroll = (record: { status: string }) => !LOCKED_STATUSES.includes(record.status);
const payrollDeleteErrorText = (error: unknown) => {
  const text = `${(error as { message?: string } | null)?.message ?? ""}`;
  if (text.includes("POSTED_PAYROLL_IMMUTABLE")) return "رواتب الشهر مرحّلة محاسبيًا ولا تُعدَّل";
  return hrRequestErrorText(error, "تعذر الحذف");
};
const parseMonthYear = (month: string) => {
  const [year = "", mon = ""] = String(month ?? "").split("-");
  return { year, mon };
};

export default function HRPayrollArchive() {
  const { t, direction, formatDate, formatNumber } = useI18n();
  const [records, setRecords] = useState<ArchiveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [yearFilter, setYearFilter] = useState(ALL);
  const [monthFilter, setMonthFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [selectedRecord, setSelectedRecord] = useState<ArchiveRow | null>(null);

  const money = (value: number) =>
    `${formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${t("ر.س")}`;
  const formatMonth = (value: string) => {
    const { year, mon } = parseMonthYear(value);
    if (!year || !mon) return value || "-";
    return formatDate(`${year}-${mon}-01`, { year: "numeric", month: "long" });
  };
  const formatStoredDate = (value: string) => (value ? formatDate(value) : "-");

  const loadData = async () => {
    setLoading(true);
    try {
      let data: Record<string, any>[] = [];
      try {
        data = await fetchAllRows<Record<string, any>>((from, to) =>
          supabase.from("payroll").select("*").order("month", { ascending: false }).order("id").range(from, to));
      } catch (error) {
        toast({ title: t("تعذّر تحميل الأرشيف"), description: t(hrRequestErrorText(error)), variant: "destructive" });
        return;
      }
      setRecords(data.map((r) => ({
        id: String(r.id ?? ""), month: String(r.month ?? ""), empName: String(r.emp_name ?? "-"),
        department: String(r.department ?? "-"), basicSalary: Number(r.basic_salary ?? 0), allowances: Number(r.allowances ?? 0),
        overtime: Number((r as Record<string, unknown>).overtime ?? 0), bonus: Number((r as Record<string, unknown>).bonus ?? 0),
        socialInsurance: Number((r as Record<string, unknown>).social_insurance_deduction ?? 0), deductions: Number(r.deductions ?? 0),
        // الراتب المرحّل محاسبيًا يُعرض ويُصفّى بحالة «مرحّل»
        netSalary: Number(r.net_salary ?? 0), status: r.accounting_status === "posted" ? (String(r.status ?? "") === "موقوف" ? HELD_POSTED : POSTED) : String(r.status ?? "معلق"), paidDate: String(r.paid_date ?? ""), notes: String(r.notes ?? ""),
      })));
    } catch {
      toast({ title: t("تعذّر تحميل الأرشيف") });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadData(); }, []);

  const years = useMemo(() => {
    const unique = new Set(records.map((r) => parseMonthYear(r.month).year).filter(Boolean));
    return [ALL, ...Array.from(unique).sort((a, b) => Number(b) - Number(a))];
  }, [records]);
  const months = useMemo(() => {
    const unique = new Set(records.map((r) => parseMonthYear(r.month).mon).filter(Boolean));
    return [ALL, ...Array.from(unique).sort((a, b) => Number(a) - Number(b))];
  }, [records]);
  const filtered = useMemo(() => records.filter((r) => {
    const keyword = search.trim();
    const { year, mon } = parseMonthYear(r.month);
    if (keyword && !r.empName.includes(keyword) && !r.department.includes(keyword) && !r.id.includes(keyword)) return false;
    if (yearFilter !== ALL && year !== yearFilter) return false;
    if (monthFilter !== ALL && mon !== monthFilter) return false;
    if (statusFilter !== ALL && r.status !== statusFilter) return false;
    return true;
  }), [records, search, yearFilter, monthFilter, statusFilter]);

  useEffect(() => { setPage(1); }, [search, yearFilter, monthFilter, statusFilter, pageSize]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const pageData = filtered.slice(pageStart, pageStart + pageSize);
  const totalNet = filtered.reduce((sum, r) => sum + r.netSalary, 0);
  const archiveColumns: ReportColumn[] = [
    { key: "month", label: t("الشهر"), width: 14 }, { key: "empName", label: t("الموظف"), width: 25 },
    { key: "department", label: t("الإدارة"), width: 20 }, { key: "basic", label: t("الراتب الأساسي"), width: 16 },
    { key: "allowances", label: t("البدلات"), width: 14 }, { key: "overtime", label: t("ساعات إضافية"), width: 12 },
    { key: "bonus", label: t("مكافآت"), width: 12 }, { key: "entitlements", label: t("إجمالي الاستحقاقات"), width: 16 },
    { key: "socialInsurance", label: t("التأمينات الاجتماعية (حصة الموظف)"), width: 20 }, { key: "deductions", label: t("إجمالي الاستقطاعات"), width: 18 },
    { key: "net", label: t("صافي الراتب"), width: 16 }, { key: "status", label: t("الحالة"), width: 12 }, { key: "paidDate", label: t("تاريخ الصرف"), width: 16 },
  ];
  const toArchiveRow = (record: ArchiveRow) => ({
    month: formatMonth(record.month), empName: record.empName, department: record.department,
    basic: money(record.basicSalary), allowances: money(record.allowances), overtime: money(record.overtime), bonus: money(record.bonus),
    entitlements: money(record.basicSalary + record.allowances + record.overtime + record.bonus), socialInsurance: money(record.socialInsurance), deductions: money(record.deductions), net: money(record.netSalary), status: t(record.status), paidDate: formatStoredDate(record.paidDate),
  });
  const archiveRows = filtered.map(toArchiveRow);
  const archiveSummary = [{ label: t("عدد السجلات"), value: formatNumber(filtered.length) }, { label: t("إجمالي صافي الرواتب"), value: money(totalNet) }];
  const reportSubtitle = t("السجلات المطابقة لخيارات البحث والتصفية");

  const exportCsv = () => {
    if (!filtered.length) { toast({ title: t("لا توجد بيانات للتصدير") }); return; }
    exportReportExcel({ title: t("أرشيف الرواتب"), subtitle: reportSubtitle, columns: archiveColumns, rows: archiveRows, fileName: `payroll-archive-${new Date().toISOString().slice(0, 10)}`, summary: archiveSummary });
    toast({ title: t("تم تصدير ملف Excel") });
  };
  const printArchive = () => { if (archiveRows.length) printReport({ title: t("أرشيف الرواتب"), subtitle: reportSubtitle, columns: archiveColumns, rows: archiveRows, fileName: "payroll-archive", landscape: true, summary: archiveSummary }); };
  const printSingle = (rec: ArchiveRow) => printReport({ title: `${t("سجل راتب")} — ${rec.empName}`, subtitle: `${t("تفاصيل راتب شهر")} ${formatMonth(rec.month)}`, columns: archiveColumns, rows: [toArchiveRow(rec)], fileName: `payroll-${rec.month}`, landscape: true, summary: [{ label: t("صافي الراتب"), value: money(rec.netSalary) }] });
  const handleDelete = async (rec: ArchiveRow) => {
    if (!canDeletePayroll(rec)) { toast({ title: t("تعذر الحذف"), description: t("لا يُحذف راتب معتمد أو موقوف أو مرحّل أو مدفوع"), variant: "destructive" }); return; }
    if (!confirm(`${t("حذف سجل")} ${rec.empName}؟`)) return;
    const { data, error } = await supabase.from("payroll").delete().eq("id", rec.id).select("id");
    if (error) { toast({ title: t("تعذر الحذف"), description: t(payrollDeleteErrorText(error)), variant: "destructive" }); return; }
    if (!data?.length) { toast({ title: t("تعذر الحذف"), description: t("لم يُحذف شيء: السجل مرحّل أو لا تملك صلاحية حذفه"), variant: "destructive" }); return; }
    setRecords((prev) => prev.filter((r) => r.id !== rec.id));
    toast({ title: t("تم الحذف") });
  };

  const statusOptions = [ALL, "معلق", "معتمد", POSTED, HELD_POSTED, "مدفوع", "موقوف", "مرفوض", "ملغي"];
  return (
    <Layout>
      <div className="p-6 max-w-full mx-auto space-y-4" dir={direction}>
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="bg-[#0a5a92] text-white p-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-lg font-bold">{t("أرشيف الرواتب")}</h2>
              <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} className="h-8 rounded border-0 text-black text-sm px-2"><option value={ALL}>{t("السنة")}: {t(ALL)}</option>{years.slice(1).map((y) => <option key={y} value={y}>{formatNumber(Number(y))}</option>)}</select>
              <select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} className="h-8 rounded border-0 text-black text-sm px-2"><option value={ALL}>{t("الشهر")}: {t(ALL)}</option>{months.slice(1).map((m) => <option key={m} value={m}>{formatNumber(Number(m))}</option>)}</select>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-8 rounded border-0 text-black text-sm px-2">{statusOptions.map((s) => <option key={s} value={s}>{t("الحالة")}: {t(s)}</option>)}</select>
            </div>
            <div className="flex items-center gap-2"><button onClick={loadData} className="p-1.5 hover:bg-white/15 rounded" title={t("تحديث")}><RefreshCw className="h-4 w-4" /></button><button onClick={printArchive} className="p-1.5 hover:bg-white/15 rounded" title={t("طباعة")}><Printer className="h-4 w-4" /></button><button onClick={exportCsv} className="p-1.5 hover:bg-white/15 rounded" title={t("تصدير Excel")}><Download className="h-4 w-4" /></button><span className="bg-white rounded px-2 py-1 text-black text-sm font-semibold">{formatNumber(filtered.length)}</span></div>
          </div>
          <div className="p-3 border-b border-slate-200 bg-slate-50 flex items-center gap-3 flex-wrap"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("بحث بالاسم / الإدارة / رقم السجل")} className="h-9 w-80 max-w-full rounded border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-500" /><div className="ms-auto flex items-center gap-2 text-sm text-slate-600"><span>{t("عدد السجلات في الصفحة")}</span><select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value) || 10)} className="h-8 rounded border border-slate-300 bg-white px-2">{[10, 25, 50, 100].map((size) => <option key={size} value={size}>{formatNumber(size)}</option>)}</select></div></div>
          <div className="overflow-x-auto"><table className="w-full text-xs text-center whitespace-nowrap min-w-[1500px]"><thead className="bg-slate-100 text-slate-700 border-b border-slate-200"><tr>{["الإجراءات", "الحالة", "صافي الراتب", "إجمالي الاستقطاعات", "التأمينات الاجتماعية (حصة الموظف)", "إجمالي الاستحقاقات", "مكافآت", "ساعات إضافية", "البدلات", "الراتب الأساسي", "الإدارة", "الاسم", "الشهر"].map((label) => <th key={label} className="py-2 px-2 font-medium">{t(label)}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">
            {loading ? <tr><td colSpan={13} className="py-10 text-slate-400">{t("جاري التحميل...")}</td></tr> : pageData.length === 0 ? <tr><td colSpan={13} className="py-10 text-slate-400">{t("لا توجد سجلات")}</td></tr> : pageData.map((rec) => { const entitlements = rec.basicSalary + rec.allowances + rec.overtime + rec.bonus; return <tr key={rec.id} className="hover:bg-slate-50 transition-colors"><td className="py-2 px-2"><div className="flex items-center justify-center gap-2"><button onClick={() => setSelectedRecord(rec)} className="text-slate-500 hover:text-[#0a5a92]" title={t("عرض")}><Eye className="h-4 w-4" /></button><button onClick={() => printSingle(rec)} className="text-slate-500 hover:text-indigo-600" title={t("طباعة السجل")}><Printer className="h-4 w-4" /></button>{canDeletePayroll(rec) && <button onClick={() => handleDelete(rec)} className="text-red-400 hover:text-red-600" title={t("حذف")}><XCircle className="h-4 w-4" /></button>}</div></td><td className="py-2 px-2"><span className={`px-2 py-0.5 rounded text-[11px] font-medium ${rec.status === "مدفوع" || rec.status === "معتمد" ? "bg-green-100 text-green-700" : rec.status === POSTED ? "bg-blue-100 text-blue-700" : rec.status === "ملغي" || rec.status === "مرفوض" ? "bg-red-100 text-red-700" : rec.status === HELD_POSTED ? "bg-orange-100 text-orange-700" : rec.status === "موقوف" ? "bg-slate-200 text-slate-700" : "bg-yellow-100 text-yellow-700"}`}>{t(rec.status)}</span></td><td className="py-2 px-2 font-semibold text-green-700">{money(rec.netSalary)}</td><td className="py-2 px-2 font-semibold text-red-600">{money(rec.deductions)}</td><td className="py-2 px-2 font-semibold text-orange-600">{money(rec.socialInsurance)}</td><td className="py-2 px-2 font-semibold text-[#0a5a92]">{money(entitlements)}</td><td className="py-2 px-2">{money(rec.bonus)}</td><td className="py-2 px-2">{money(rec.overtime)}</td><td className="py-2 px-2">{money(rec.allowances)}</td><td className="py-2 px-2">{money(rec.basicSalary)}</td><td className="py-2 px-2 text-slate-700">{rec.department}</td><td className="py-2 px-2 font-medium">{rec.empName}</td><td className="py-2 px-2 text-slate-600">{formatMonth(rec.month)}</td></tr>; })}
          </tbody></table></div>
          <div className="p-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-sm"><div className="text-slate-600">{t("عرض")} {formatNumber(filtered.length === 0 ? 0 : pageStart + 1)} - {formatNumber(Math.min(pageStart + pageSize, filtered.length))} {t("من")} {formatNumber(filtered.length)}</div><div className="flex items-center gap-2"><button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1} className="h-8 w-8 rounded border border-slate-300 bg-white disabled:opacity-40 flex items-center justify-center" title={t("السابق")}><ChevronRight className="h-4 w-4" /></button><span className="px-2 py-1 rounded bg-white border border-slate-300 min-w-[70px] text-center">{formatNumber(safePage)} / {formatNumber(totalPages)}</span><button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages} className="h-8 w-8 rounded border border-slate-300 bg-white disabled:opacity-40 flex items-center justify-center" title={t("التالي")}><ChevronLeft className="h-4 w-4" /></button></div><div className="font-semibold text-slate-800">{t("إجمالي صافي الرواتب")}: {money(totalNet)}</div></div>
        </div>
        {selectedRecord && <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"><div className="w-full max-w-2xl rounded-xl bg-white shadow-xl border border-slate-200"><div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between"><button onClick={() => setSelectedRecord(null)} className="px-3 py-1.5 rounded border border-slate-300 text-sm">{t("إغلاق")}</button><h3 className="font-bold">{t("تفاصيل سجل الراتب")}</h3><button onClick={() => printSingle(selectedRecord)} className="px-3 py-1.5 rounded bg-[#0a5a92] text-white text-sm flex items-center gap-1"><FileText className="h-4 w-4" /> {t("طباعة")}</button></div><div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm"><Detail label={t("الاسم")} value={selectedRecord.empName} /><Detail label={t("الشهر")} value={formatMonth(selectedRecord.month)} /><Detail label={t("الإدارة")} value={selectedRecord.department} /><Detail label={t("الراتب الأساسي")} value={money(selectedRecord.basicSalary)} /><Detail label={t("البدلات")} value={money(selectedRecord.allowances)} /><Detail label={t("ساعات إضافية")} value={money(selectedRecord.overtime)} /><Detail label={t("مكافآت")} value={money(selectedRecord.bonus)} /><Detail label={t("إجمالي الاستحقاقات")} value={money(selectedRecord.basicSalary + selectedRecord.allowances + selectedRecord.overtime + selectedRecord.bonus)} /><Detail label={t("التأمينات الاجتماعية (حصة الموظف)")} value={money(selectedRecord.socialInsurance)} /><Detail label={t("إجمالي الاستقطاعات")} value={money(selectedRecord.deductions)} /><Detail label={t("صافي الراتب")} value={money(selectedRecord.netSalary)} /><Detail label={t("الحالة")} value={t(selectedRecord.status)} /><Detail label={t("تاريخ الصرف")} value={formatStoredDate(selectedRecord.paidDate)} /><div className="md:col-span-2"><div className="text-xs text-slate-500 mb-1">{t("ملاحظات")}</div><div className="rounded border border-slate-200 bg-slate-50 p-2 min-h-[52px]">{selectedRecord.notes || "-"}</div></div></div></div></div>}
      </div>
    </Layout>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><div className="text-xs text-slate-500 mb-1">{label}</div><div className="rounded border border-slate-200 bg-slate-50 px-2.5 py-2 font-medium">{value}</div></div>;
}
