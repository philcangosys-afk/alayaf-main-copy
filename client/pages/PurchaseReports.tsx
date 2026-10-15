import { useState } from "react";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import { purchasesFeatures } from "./Purchases";
import {
  Search,
  FileText,
  BarChart2,
  BarChart,
  TrendingDown,
  Package,
  ClipboardList,
  ShoppingCart,
  Truck,
  RotateCcw,
  Users,
  Download,
  Printer,
  Filter,
  FileSpreadsheet,
  PieChart,
  Calendar,
  AlertCircle,
  CheckCircle,
  Clock,
  XCircle,
  ArrowUpDown,
  Star,
  CreditCard,
  Receipt,
  BookOpen,
  ShieldAlert,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { PageHeader, FilterInput } from "@/components/SalesPageUI";
import PurchaseReportDetails from "@/components/purchases/PurchaseReportDetails";

/* ── Types ── */
type ReportItem = {
  label: string;
  desc: string;
  icon: React.ReactNode;
  badge?: string;
  badgeColor?: string;
};

type ReportSection = {
  title: string;
  headerBg: string;
  headerText: string;
  icon: React.ReactNode;
  reports: ReportItem[];
};

/* ── Report sections data ── */
const sections: ReportSection[] = [
  {
    title: "تقارير طلبات الشراء",
    headerBg: "bg-green-600",
    headerText: "text-white",
    icon: <ClipboardList className="h-5 w-5" />,
    reports: [
      { label: "تقرير طلبات الشراء", desc: "جميع الطلبات", icon: <FileText className="h-5 w-5 text-green-600" />, badge: "شامل", badgeColor: "bg-green-100 text-green-700" },
      { label: "طلبات الشراء حسب الحالة", desc: "مفتوح / معتمد / مرفوض", icon: <BarChart2 className="h-5 w-5 text-green-500" /> },
      { label: "طلبات الشراء حسب القسم", desc: "تصنيف حسب الأقسام", icon: <PieChart className="h-5 w-5 text-green-500" /> },
      { label: "طلبات الشراء المعلقة", desc: "بانتظار الاعتماد", icon: <Clock className="h-5 w-5 text-yellow-500" />, badge: "تنبيه", badgeColor: "bg-yellow-100 text-yellow-700" },
      { label: "طلبات الشراء المرفوضة", desc: "الطلبات المرفوضة وأسبابها", icon: <XCircle className="h-5 w-5 text-red-500" /> },
    ],
  },
  {
    title: "تقارير أوامر الشراء",
    headerBg: "bg-blue-600",
    headerText: "text-white",
    icon: <ShoppingCart className="h-5 w-5" />,
    reports: [
      { label: "تقرير أوامر الشراء", desc: "جميع الأوامر", icon: <FileText className="h-5 w-5 text-blue-600" />, badge: "شامل", badgeColor: "bg-blue-100 text-blue-700" },
      { label: "أوامر الشراء المتأخرة", desc: "تجاوزت تاريخ الاستلام", icon: <AlertCircle className="h-5 w-5 text-red-500" />, badge: "تنبيه", badgeColor: "bg-red-100 text-red-700" },
      { label: "أوامر الشراء المفتوحة", desc: "قيد التنفيذ", icon: <Clock className="h-5 w-5 text-blue-500" /> },
      { label: "فاتورة التسليم", desc: "تفاصيل التسليم لكل أمر", icon: <Truck className="h-5 w-5 text-blue-500" /> },
      { label: "قائمة التسليم", desc: "جدول استلام البضائع", icon: <CheckCircle className="h-5 w-5 text-green-500" /> },
    ],
  },
  {
    title: "تقارير استلام المشتريات",
    headerBg: "bg-teal-600",
    headerText: "text-white",
    icon: <Package className="h-5 w-5" />,
    reports: [
      { label: "تقرير سندات الاستلام", desc: "جميع سندات الاستلام", icon: <FileText className="h-5 w-5 text-teal-600" />, badge: "شامل", badgeColor: "bg-teal-100 text-teal-700" },
      { label: "الاستلام الجزئي", desc: "بنود لم تُستلم بالكامل", icon: <BarChart className="h-5 w-5 text-orange-500" />, badge: "تنبيه", badgeColor: "bg-orange-100 text-orange-700" },
      { label: "الاستلام حسب المورد", desc: "مقارنة المورّدين", icon: <ArrowUpDown className="h-5 w-5 text-teal-500" /> },
      { label: "المشتريات بالانحراف الاستلام", desc: "الفروق بين المطلوب والمستلم", icon: <TrendingDown className="h-5 w-5 text-red-500" /> },
    ],
  },
  {
    title: "تقارير فواتير المشتريات",
    headerBg: "bg-indigo-600",
    headerText: "text-white",
    icon: <Receipt className="h-5 w-5" />,
    reports: [
      { label: "تقرير فواتير المشتريات", desc: "جميع الفواتير", icon: <FileText className="h-5 w-5 text-indigo-600" />, badge: "شامل", badgeColor: "bg-indigo-100 text-indigo-700" },
      { label: "الفواتير حسب الموردين", desc: "مقارنة فواتير الموردين", icon: <Users className="h-5 w-5 text-indigo-500" /> },
      { label: "الفواتير حسب الدفع", desc: "مدفوعة / جزئي / متأخرة", icon: <CreditCard className="h-5 w-5 text-indigo-500" /> },
      { label: "الفواتير حالة المتأخرة", desc: "فواتير تجاوزت الاستحقاق", icon: <AlertCircle className="h-5 w-5 text-red-500" />, badge: "تنبيه", badgeColor: "bg-red-100 text-red-700" },
      { label: "الفواتير غير المدفوعة", desc: "مستحقة الدفع", icon: <Clock className="h-5 w-5 text-yellow-500" /> },
      { label: "الفواتير إلى المرتجعة", desc: "فواتير بها مردودات", icon: <RotateCcw className="h-5 w-5 text-orange-500" /> },
    ],
  },
  {
    title: "تقارير مردودات المشتريات",
    headerBg: "bg-red-600",
    headerText: "text-white",
    icon: <RotateCcw className="h-5 w-5" />,
    reports: [
      { label: "تقرير مردودات المشتريات", desc: "جميع المردودات", icon: <FileText className="h-5 w-5 text-red-600" />, badge: "شامل", badgeColor: "bg-red-100 text-red-700" },
      { label: "المردودات حسب المورد", desc: "أكثر المورّدين مردوداً", icon: <Users className="h-5 w-5 text-red-500" /> },
      { label: "المردودات حسب السبب", desc: "أسباب الإرجاع", icon: <ShieldAlert className="h-5 w-5 text-red-500" /> },
      { label: "المردودات حسب المنتج", desc: "المنتجات الأكثر إرجاعاً", icon: <Package className="h-5 w-5 text-red-500" /> },
    ],
  },
  {
    title: "تقارير أرصدة الموردين",
    headerBg: "bg-amber-500",
    headerText: "text-white",
    icon: <BookOpen className="h-5 w-5" />,
    reports: [
      { label: "تقييم أداء الموردين", desc: "جودة وسرعة التسليم", icon: <Star className="h-5 w-5 text-amber-500" />, badge: "مميز", badgeColor: "bg-amber-100 text-amber-700" },
      { label: "أفضل الموردين شراءً", desc: "ترتيب حسب الكميات", icon: <BarChart2 className="h-5 w-5 text-amber-500" /> },
      { label: "كشف حساب الموردين", desc: "رصيد وحركات كل مورد", icon: <BookOpen className="h-5 w-5 text-amber-500" /> },
    ],
  },
  {
    title: "تقارير تحليل المشتريات",
    headerBg: "bg-slate-800",
    headerText: "text-white",
    icon: <BarChart2 className="h-5 w-5" />,
    reports: [
      { label: "ملخص أرصدة الموردين", desc: "الأرصدة المستحقة لكل مورد", icon: <BookOpen className="h-5 w-5 text-slate-700" /> },
      { label: "كشف حساب مورد", desc: "حركات مورد محدد", icon: <FileText className="h-5 w-5 text-slate-700" /> },
      { label: "تفاصيل حساب المورد", desc: "تفاصيل الفواتير والإشعارات", icon: <Receipt className="h-5 w-5 text-slate-700" /> },
      { label: "المشتريات بحسب المنتج أو الخدمة", desc: "الكميات والقيم حسب البند", icon: <Package className="h-5 w-5 text-slate-700" /> },
      { label: "المشتريات بحسب مورد", desc: "إجمالي المشتريات لكل مورد", icon: <Users className="h-5 w-5 text-slate-700" /> },
      { label: "المشتريات بحسب العملة", desc: "إجمالي المشتريات حسب العملة", icon: <PieChart className="h-5 w-5 text-slate-700" /> },
    ],
  },
];

/* ── التقارير المنفّذة في PurchaseReportDetails ── */
const IMPLEMENTED_REPORTS = new Set([
  "ملخص أرصدة الموردين",
  "كشف حساب مورد",
  "تفاصيل حساب المورد",
  "المشتريات بحسب المنتج أو الخدمة",
  "المشتريات بحسب مورد",
  "المشتريات بحسب العملة",
]);

/* ── General features ── */
const generalFeatures = [
  { label: "التصفية حسب الفترة", icon: <Calendar className="h-5 w-5 text-blue-500" />, bg: "bg-blue-50" },
  { label: "التصفية حسب المورد", icon: <Truck className="h-5 w-5 text-green-500" />, bg: "bg-green-50" },
  { label: "التصفية حسب البنود", icon: <Filter className="h-5 w-5 text-purple-500" />, bg: "bg-purple-50" },
  { label: "التصفية حسب الحالة", icon: <CheckCircle className="h-5 w-5 text-teal-500" />, bg: "bg-teal-50" },
  { label: "تصدير إلى Excel", icon: <FileSpreadsheet className="h-5 w-5 text-emerald-600" />, bg: "bg-emerald-50" },
  { label: "تصدير PDF", icon: <Download className="h-5 w-5 text-red-500" />, bg: "bg-red-50" },
  { label: "رسوم بيانية", icon: <BarChart2 className="h-5 w-5 text-indigo-500" />, bg: "bg-indigo-50" },
  { label: "طباعة", icon: <Printer className="h-5 w-5 text-slate-600" />, bg: "bg-slate-100" },
];

/* ── Report Preview Modal ── */
function ReportModal({
  report,
  onClose,
}: {
  report: ReportItem | null;
  onClose: () => void;
}) {
  const { t, direction, formatDate, formatNumber } = useI18n();
  const [dateFrom, setDateFrom] = useState(
    new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0]
  );
  const [dateTo, setDateTo] = useState(new Date().toISOString().split("T")[0]);
  const [vendor, setVendor] = useState("الكل");
  const [status, setStatus] = useState("الكل");

  if (!report) return null;

  const handleExport = (type: string) => {
    toast({ title: t(type), description: `${t("جارٍ تصدير")}: ${t(report.label)}` });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div dir={direction} className="bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden">
        {/* Modal header */}
        <div className="bg-slate-800 text-white px-6 py-4 flex items-center justify-between">
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <XCircle className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <span className="font-bold text-lg">{t(report.label)}</span>
            <FileText className="h-5 w-5 text-slate-300" />
          </div>
        </div>

        {/* Filters */}
        <div className="p-6 space-y-4">
          <h3 className="text-sm font-semibold text-slate-700 text-right border-b border-slate-200 pb-2">
            {t("خيارات التقرير")}
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs text-slate-500 text-right block">{t("من تاريخ")}</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-right focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-500 text-right block">{t("إلى تاريخ")}</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-right focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-500 text-right block">{t("المورد")}</label>
              <select
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-right bg-white appearance-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              >
                <option value="الكل">{t("الكل")}</option>
                <option value="مورد 1">{t("مورد 1")}</option>
                <option value="مورد 2">{t("مورد 2")}</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-500 text-right block">{t("الحالة")}</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-right bg-white appearance-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              >
                <option value="الكل">{t("الكل")}</option>
                <option value="مفتوح">{t("مفتوح")}</option>
                <option value="مغلق">{t("مغلق")}</option>
                <option value="ملغي">{t("ملغي")}</option>
              </select>
            </div>
          </div>

          {/* Report preview */}
          <div className="mt-4 border border-slate-200 rounded-lg overflow-hidden">
            <div className="bg-slate-50 px-4 py-2 flex items-center justify-between border-b border-slate-200">
              <span className="text-xs text-slate-500">{t("معاينة البيانات")}</span>
              <span className="text-xs font-semibold text-slate-700">{t(report.label)}</span>
            </div>
            <div className="p-4">
              <table className="w-full text-sm text-right">
                <thead>
                  <tr className="bg-slate-100 text-slate-600">
                    <th className="px-3 py-2 border border-slate-200">{t("الحالة")}</th>
                    <th className="px-3 py-2 border border-slate-200">{t("المبلغ")}</th>
                    <th className="px-3 py-2 border border-slate-200">{t("المورد")}</th>
                    <th className="px-3 py-2 border border-slate-200">{t("التاريخ")}</th>
                    <th className="px-3 py-2 border border-slate-200">#</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { id: 1, date: dateFrom, vendor: "مورد النور للتجارة", amount: 12500, status: "مفتوح" },
                    { id: 2, date: dateTo, vendor: "شركة الخليج التجارية", amount: 8200, status: "مغلق" },
                    { id: 3, date: dateFrom, vendor: "مؤسسة الأمين", amount: 4750, status: "مفتوح" },
                  ].map((row) => (
                    <tr key={row.id} className={row.id % 2 === 0 ? "bg-slate-50" : "bg-white"}>
                      <td className="px-3 py-2 border border-slate-200">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${row.status === "مغلق" ? "bg-green-100 text-green-700" : "bg-cyan-100 text-cyan-700"}`}>
                          {t(row.status)}
                        </span>
                      </td>
                      <td className="px-3 py-2 border border-slate-200 font-medium">{formatNumber(row.amount)} {t("ريال")}</td>
                      <td className="px-3 py-2 border border-slate-200">{t(row.vendor)}</td>
                      <td className="px-3 py-2 border border-slate-200 text-slate-500">{formatDate(row.date)}</td>
                      <td className="px-3 py-2 border border-slate-200 text-slate-500">{row.id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <button onClick={onClose} className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-sm rounded hover:bg-slate-100">
            {t("إغلاق")}
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => handleExport("تصدير Excel")}
              className="px-4 py-2 bg-emerald-600 text-white text-sm rounded hover:bg-emerald-700 flex items-center gap-2"
            >
              <FileSpreadsheet className="h-4 w-4" /> Excel
            </button>
            <button
              onClick={() => handleExport("تصدير PDF")}
              className="px-4 py-2 bg-red-600 text-white text-sm rounded hover:bg-red-700 flex items-center gap-2"
            >
              <Download className="h-4 w-4" /> PDF
            </button>
            <button
              onClick={() => handleExport("طباعة")}
              className="px-4 py-2 bg-slate-600 text-white text-sm rounded hover:bg-slate-700 flex items-center gap-2"
            >
              <Printer className="h-4 w-4" /> {t("طباعة")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Main Page ── */
export default function PurchaseReports() {
  const { t, direction } = useI18n();
  const [search, setSearch] = useState("");
  const [activeReport, setActiveReport] = useState<ReportItem | null>(null);

  // تُعرض فقط التقارير المنفّذة فعلًا؛ البطاقات الأخرى كانت تفتح نفس كشف الحساب بعناوين مختلفة
  const filteredSections = sections.map((section) => ({
    ...section,
    reports: section.reports.filter(
      (r) =>
        IMPLEMENTED_REPORTS.has(r.label) &&
        (search === "" ||
          r.label.includes(search) ||
          r.desc.includes(search) ||
          t(r.label).includes(search) ||
          t(r.desc).includes(search))
    ),
  })).filter((s) => s.reports.length > 0);

  return (
    <Layout subMenu={{ title: t("المشتريات"), items: purchasesFeatures }}>
      <div dir={direction} className="mx-auto max-w-7xl space-y-6 pb-12">
        <PageHeader
          icon={BarChart2}
          title={t("تقارير المشتريات الشاملة")}
          subtitle={t("إحصائيات وتقارير تفصيلية لجميع عمليات المشتريات")}
          actionLabel={t("تحديث البيانات")}
          onAction={() => toast({ title: t("تم تحديث البيانات") })}
          gradient="from-indigo-600 to-purple-700"
        />

        {/* Search */}
        <div className="rounded-2xl bg-white border border-border/50 shadow-sm p-6 animate-fade-in-up">
          <div className="relative max-w-xl mr-auto">
            <Search className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground/50" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("ابحث في التقارير...")}
              className="w-full px-4 py-3 pr-12 border border-border/60 rounded-xl bg-muted/20 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary text-sm text-right transition-all"
            />
          </div>
        </div>

        {/* Report sections - 3 columns */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filteredSections.map((section) => (
            <div
              key={section.title}
              className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden flex flex-col"
            >
              {/* Section header */}
              <div className={`${section.headerBg} ${section.headerText} px-4 py-3 flex items-center justify-between`}>
                <span className="opacity-80">{section.icon}</span>
                <h2 className="font-bold text-sm">{t(section.title)}</h2>
              </div>

              {/* Report items */}
              <div className="divide-y divide-slate-100 flex-1">
                {section.reports.map((report) => (
                  <button
                    key={report.label}
                    onClick={() => setActiveReport(report)}
                    className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50 transition-colors group text-right"
                  >
                    <div className="flex items-center gap-2">
                      {report.badge && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${report.badgeColor}`}>
                          {t(report.badge)}
                        </span>
                      )}
                      <span className="text-xs text-slate-400 group-hover:text-slate-500 transition-colors">
                        {t(report.desc)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-700 group-hover:text-slate-900 transition-colors">
                        {t(report.label)}
                      </span>
                      <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-50 group-hover:bg-white border border-slate-100 group-hover:border-slate-200 transition-all shrink-0">
                        {report.icon}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* General features bar */}
        <div className="bg-[#1e293b] rounded-xl p-5">
          <div className="flex items-center justify-end gap-2 mb-4">
            <h3 className="text-white font-bold text-sm">{t("خصائص عامة للتقارير")}</h3>
            <BarChart2 className="h-5 w-5 text-slate-400" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            {generalFeatures.map((feat) => (
              <button
                key={feat.label}
                onClick={() => toast({ title: t(feat.label), description: t("هذه الخاصية متاحة عند فتح أي تقرير") })}
                className={`${feat.bg} rounded-lg p-3 flex flex-col items-center justify-center gap-2 hover:opacity-90 transition-all hover:scale-105 cursor-pointer border border-white/10`}
              >
                {feat.icon}
                <span className="text-xs font-medium text-slate-700 text-center leading-tight">
                  {t(feat.label)}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Report modal */}
      {activeReport && (
        <PurchaseReportDetails
          report={activeReport.label}
          onClose={() => setActiveReport(null)}
        />
      )}
    </Layout>
  );
}
