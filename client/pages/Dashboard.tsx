import Layout from "@/components/Layout";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useEffect, useState, useMemo } from "react";
import { checkPerm } from "@/lib/authSession";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import { supabase } from "@/lib/supabaseClient";
import { selectAllRows } from "@/lib/ledgerData";
import { useI18n } from "@/i18n";
import { PENDING_STATUSES } from "@/lib/hrStatus";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  FileText,
  Users,
  ShoppingCart,
  AlertCircle,
  ArrowLeft,
  Plus,
  Sparkles,
  Activity,
  BarChart3,
  Clock,
} from "lucide-react";

/* ── Types ── */
type KpiData = {
  totalSales: number;
  totalPurchases: number;
  invoiceCount: number;
  activeCustomers: number;
};

type InvoiceRow = {
  id: string;
  customer: string;
  total: number;
  status: string;
  date: string;
};

type AlertData = {
  pendingInvoices: number;
  unpaidPurchases: number;
  pendingLeaves: number;
};

const ALL_MODULES = [
  { title: "المبيعات", description: "إدارة عروض الأسعار والفواتير والمردودات", href: "/sales", permKey: "module.sales", icon: FileText, gradient: "from-blue-500 to-indigo-600", shadow: "shadow-blue-500/20" },
  { title: "المشتريات", description: "طلبات الشراء والفواتير والتقارير", href: "/purchases", permKey: "module.purchases", icon: ShoppingCart, gradient: "from-violet-500 to-purple-600", shadow: "shadow-violet-500/20" },
  { title: "الموارد البشرية", description: "إدارة الموظفين والرواتب والحضور", href: "/hr", permKey: "module.hr", icon: Users, gradient: "from-emerald-500 to-teal-600", shadow: "shadow-emerald-500/20" },
  { title: "إدارة العملاء", description: "قاعدة بيانات العملاء والتفاعلات", href: "/crm", permKey: "module.crm", icon: Users, gradient: "from-amber-500 to-orange-600", shadow: "shadow-amber-500/20" },
];

/** قراءة المبالغ المخزنة نصًا مثل "ريال 17.25" مع الإبقاء على الإشارة السالبة. */
const parseAmount = (value: unknown) => Number(String(value ?? "0").replace(/[^0-9.-]/g, "")) || 0;
type AdjustmentNoteRow = { note_type: string | null; subtotal: number | string | null };

/* ── Status badge helper ── */
function statusClasses(status: string) {
  if (status === "مدفوعة بالكامل") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "مدفوعة جزئياً") return "bg-amber-50 text-amber-700 border-amber-200";
  if (status === "مفتوحة") return "bg-blue-50 text-blue-700 border-blue-200";
  return "bg-red-50 text-red-700 border-red-200";
}

/* ── Component ── */
export default function Dashboard() {
  const { permissions: livePerms } = useRolePermissions();
  const { t, formatDate, formatNumber } = useI18n();
  const modules = useMemo(() => {
    return ALL_MODULES.filter((m) => checkPerm(livePerms, m.permKey));
  }, [livePerms]);
  const canViewSales = checkPerm(livePerms, "sales.invoices", "sales.invoices.view", "module.sales");
  const canViewPurchases = checkPerm(livePerms, "purchases.invoices", "purchases.invoices.view", "module.purchases");
  const canViewCustomers = checkPerm(livePerms, "crm.customers", "crm.customers.view", "module.crm");

  const [kpis, setKpis] = useState<KpiData>({ totalSales: 0, totalPurchases: 0, invoiceCount: 0, activeCustomers: 0 });
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [alerts, setAlerts] = useState<AlertData>({ pendingInvoices: 0, unpaidPurchases: 0, pendingLeaves: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        // Load sales invoices
        // كل الصفوف بترقيم صفحات (بدون حد 1000 صف)
        const salesInv = canViewSales
          ? (await selectAllRows((from, to) => supabase.from("sales_invoices").select("id, date, customer, total, subtotal, paid, remaining, status, accounting_status").order("date", { ascending: false }).order("id").range(from, to))).data
          : [];
        const invoiceRows: InvoiceRow[] = (salesInv || []).map((r) => ({
          id: String(r.id),
          customer: String(r.customer ?? ""),
          total: parseAmount(r.total),
          status: String(r.status ?? "مفتوحة"),
          date: String(r.date ?? ""),
        }));
        setInvoices(invoiceRows);

        // الإشعارات الدائنة والمدينة المرحّلة تعدّل صافي المبيعات والمشتريات.
        const { data: notesData } = canViewSales || canViewPurchases
          ? await selectAllRows((from, to) => supabase.from("invoice_adjustment_notes").select("id, note_type, subtotal").eq("status", "posted").eq("accounting_status", "posted").order("id").range(from, to))
          : { data: [] as AdjustmentNoteRow[] };
        const notes = (notesData ?? []) as AdjustmentNoteRow[];
        const notesTotal = (types: string[]) => notes.filter((note) => types.includes(String(note.note_type))).reduce((sum, note) => sum + parseAmount(note.subtotal), 0);

        // صافي المبيعات: الفواتير المرحّلة فقط، بدون ضريبة القيمة المضافة، بعد الإشعارات.
        const postedSales = (salesInv || []).filter((r) => r.accounting_status === "posted");
        const totalSales = postedSales.reduce((sum, r) => sum + parseAmount(r.subtotal), 0) - notesTotal(["sales_credit"]) + notesTotal(["sales_debit"]);

        // صافي المشتريات: الفواتير المرحّلة فقط، بدون ضريبة المدخلات، بعد إشعارات المشتريات.
        const purchInv = canViewPurchases ? (await selectAllRows((from, to) => supabase.from("purchase_invoices").select("id, subtotal, accounting_status").eq("accounting_status", "posted").order("id").range(from, to))).data : [];
        const totalPurchases = (purchInv || []).reduce((sum, r) => sum + parseAmount(r.subtotal), 0) - notesTotal(["purchase_debit", "purchase_credit"]);

        // Load customers count
        const activeCustomers = canViewCustomers
          ? ((await supabase.from("customers").select("id", { count: "exact", head: true }).eq("status", "نشط")).count ?? 0)
          : 0;

        setKpis({
          totalSales,
          totalPurchases,
          invoiceCount: invoiceRows.length,
          activeCustomers,
        });

        // Calculate alerts
        const pendingInvoices = invoiceRows.filter((i) => i.status === "مفتوحة" || i.status === "مدفوعة جزئياً").length;
        const unpaidPurchases = canViewPurchases
          ? ((await supabase.from("purchase_invoices").select("id", { count: "exact", head: true }).in("status", ["مفتوحة", "مدفوعة جزئياً"])).count ?? 0)
          : 0;
        // عدّ فقط بلا تنزيل الصفوف: كل صيغ الحالة المعلقة (فارغة / معلق / معلقة / pending)
        const pendingFilter = `status.is.null,status.eq."",status.in.(${PENDING_STATUSES.map((value) => `"${value}"`).join(",")})`;
        const leavesCount = await supabase
          .from("leave_requests")
          .select("id", { count: "exact", head: true })
          .or(pendingFilter);
        if (leavesCount.error) console.error("Dashboard pending leaves count error:", leavesCount.error);
        const pendingLeaves = leavesCount.error ? 0 : (leavesCount.count ?? 0);

        setAlerts({
          pendingInvoices,
          unpaidPurchases,
          pendingLeaves: pendingLeaves ?? 0,
        });
      } catch (e) {
        console.error("Dashboard load error:", e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [canViewSales, canViewPurchases, canViewCustomers]);

  const kpiCards = [
    {
      label: "صافي المبيعات (بدون ضريبة)",
      value: formatNumber(kpis.totalSales),
      currency: true,
      icon: DollarSign,
      gradient: "from-blue-500 to-blue-600",
      shadow: "shadow-blue-500/25",
    },
    {
      label: "صافي المشتريات (بدون ضريبة)",
      value: formatNumber(kpis.totalPurchases),
      currency: true,
      icon: ShoppingCart,
      gradient: "from-violet-500 to-purple-600",
      shadow: "shadow-violet-500/25",
    },
    {
      label: "عدد الفواتير",
      value: formatNumber(kpis.invoiceCount),
      currency: false,
      icon: FileText,
      gradient: "from-emerald-500 to-teal-600",
      shadow: "shadow-emerald-500/25",
    },
    {
      label: "العملاء النشطين",
      value: formatNumber(kpis.activeCustomers),
      currency: false,
      icon: Users,
      gradient: "from-amber-500 to-orange-600",
      shadow: "shadow-amber-500/25",
    },
  ].filter((_, index) => index === 0 || index === 2 ? canViewSales : index === 1 ? canViewPurchases : canViewCustomers);

  return (
    <Layout subMenu={null}>
      {/* ── Welcome Banner ── */}
      <section className="relative mb-8 overflow-hidden rounded-2xl bg-gradient-to-bl from-[hsl(221,83%,53%)] via-[hsl(224,76%,38%)] to-[hsl(262,83%,40%)] p-8 text-white shadow-xl shadow-primary/15 animate-fade-in-up">
        <div className="pointer-events-none absolute -top-12 -left-12 h-48 w-48 rounded-full bg-white/[0.07] blur-2xl" />
        <div className="pointer-events-none absolute bottom-0 right-0 h-36 w-36 rounded-full bg-white/[0.05] blur-2xl" />
        <div className="pointer-events-none absolute top-6 right-1/3 h-20 w-20 rounded-full bg-secondary/20 blur-xl animate-float" />

        <div className="relative z-10 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="h-5 w-5 text-amber-300" />
              <span className="text-[13px] font-medium text-white/70">{t("مرحباً بعودتك")}</span>
            </div>
            <h1 className="text-3xl font-extrabold leading-tight">{t("أهلاً وسهلاً بك")}</h1>
            <p className="mt-2 max-w-md text-[15px] text-white/70 leading-relaxed">
              {t("إليك ملخص أداء عملك اليوم — تابع المبيعات والمشتريات وحالة الفواتير في مكان واحد.")}
            </p>
          </div>
          <div className="flex gap-3">
            <Link to="/sales/invoices" className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-[hsl(224,76%,38%)] shadow-lg shadow-black/10 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200">
              <Plus className="h-4 w-4" /> {t("فاتورة جديدة")}
            </Link>
            <Link to="/sales" className="inline-flex items-center gap-2 rounded-xl bg-white/15 backdrop-blur-sm border border-white/20 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/25 transition-all duration-200">
              <BarChart3 className="h-4 w-4" /> {t("التقارير")}
            </Link>
          </div>
        </div>
      </section>

      {/* ── KPIs Grid ── */}
      <section className="mb-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4 stagger-children">
        {kpiCards.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div key={kpi.label} className="group relative overflow-hidden rounded-2xl bg-white border border-border/50 p-5 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300 animate-fade-in-up">
              <div className={cn("pointer-events-none absolute -top-8 -left-8 h-24 w-24 rounded-full opacity-[0.07] bg-gradient-to-br", kpi.gradient)} />
              <div className="relative z-10 flex items-start justify-between">
                <div>
                  <p className="text-[13px] font-medium text-muted-foreground mb-1">{t(kpi.label)}</p>
                  <p className="text-[26px] font-extrabold text-foreground leading-none tracking-tight">
                    {kpi.currency && <span className="text-lg ml-0.5">﷼</span>}
                    {loading ? "..." : kpi.value}
                  </p>
                </div>
                <div className={cn("flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-lg", kpi.gradient, kpi.shadow)}>
                  <Icon className="h-5 w-5" />
                </div>
              </div>
            </div>
          );
        })}
      </section>

      {/* ── Main Content Grid ── */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Recent Invoices */}
        {canViewSales && <div className="lg:col-span-2 animate-fade-in-up" style={{ animationDelay: "200ms" }}>
          <div className="rounded-2xl bg-white border border-border/50 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-6 py-5 border-b border-border/40">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                  <Clock className="h-[18px] w-[18px]" />
                </div>
                <h2 className="text-base font-bold text-foreground">{t("آخر الفواتير")}</h2>
              </div>
              <Link to="/sales/invoices" className="flex items-center gap-1.5 text-[13px] font-semibold text-primary hover:text-primary/80 transition-colors">
                {t("عرض الكل")} <ArrowLeft className="h-3.5 w-3.5" />
              </Link>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/30">
                    <th className="px-6 py-3 text-right text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">{t("رقم الفاتورة")}</th>
                    <th className="px-6 py-3 text-right text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">{t("العميل")}</th>
                    <th className="px-6 py-3 text-right text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">{t("المبلغ")}</th>
                    <th className="px-6 py-3 text-right text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">{t("الحالة")}</th>
                    <th className="px-6 py-3 text-right text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">{t("التاريخ")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {loading ? (
                    <tr><td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">{t("جاري التحميل...")}</td></tr>
                  ) : invoices.length === 0 ? (
                    <tr><td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">{t("لا توجد فواتير حالياً")}</td></tr>
                  ) : (
                    invoices.slice(0, 5).map((inv) => (
                      <tr key={inv.id} className="hover:bg-muted/20 transition-colors">
                        <td className="px-6 py-4 font-semibold text-foreground text-[13px]">{inv.id}</td>
                        <td className="px-6 py-4 text-muted-foreground text-[13px]">{inv.customer}</td>
                        <td className="px-6 py-4 font-bold text-primary text-[13px]">﷼{formatNumber(inv.total)}</td>
                        <td className="px-6 py-4">
                          <span className={cn("inline-flex rounded-full border px-3 py-0.5 text-[11px] font-bold", statusClasses(inv.status))}>
                            {t(inv.status)}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-muted-foreground text-[13px]">
                          {inv.date ? formatDate(inv.date, { dateStyle: "medium" }) : "-"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>}

        {/* Sidebar cards */}
        <div className="flex flex-col gap-5 animate-fade-in-up" style={{ animationDelay: "300ms" }}>
          {/* Alerts */}
          <div className="rounded-2xl bg-white border border-border/50 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                <AlertCircle className="h-4 w-4" />
              </div>
              <h3 className="text-sm font-bold text-foreground">{t("التنبيهات")}</h3>
            </div>
            <div className="flex flex-col gap-3">
              {alerts.pendingInvoices > 0 && (
                <AlertItem color="amber" title={t("فواتير غير مكتملة")} desc={`${formatNumber(alerts.pendingInvoices)} ${t("فاتورة بانتظار التحصيل")}`} />
              )}
              {alerts.unpaidPurchases > 0 && (
                <AlertItem color="red" title={t("مشتريات غير مدفوعة")} desc={`${formatNumber(alerts.unpaidPurchases)} ${t("فاتورة شراء غير مدفوعة")}`} />
              )}
              {alerts.pendingLeaves > 0 && (
                <AlertItem color="amber" title={t("طلبات إجازة معلقة")} desc={`${formatNumber(alerts.pendingLeaves)} ${t("طلب بانتظار الموافقة")}`} />
              )}
              {alerts.pendingInvoices === 0 && alerts.unpaidPurchases === 0 && alerts.pendingLeaves === 0 && (
                <p className="text-sm text-muted-foreground text-center py-2">{t("لا توجد تنبيهات حالياً")}</p>
              )}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="rounded-2xl bg-white border border-border/50 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <Activity className="h-4 w-4" />
              </div>
              <h3 className="text-sm font-bold text-foreground">{t("إجراءات سريعة")}</h3>
            </div>
            <div className="flex flex-col gap-2.5">
              <Link to="/sales/invoices" className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-blue-600 to-blue-500 px-4 py-3 text-[13px] font-bold text-white shadow-md shadow-blue-500/20 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200">
                <Plus className="h-4 w-4" /> {t("إنشاء فاتورة جديدة")}
              </Link>
              <Link to="/purchases/orders" className="flex items-center justify-center gap-2 rounded-xl border-2 border-border/60 bg-white px-4 py-3 text-[13px] font-bold text-foreground hover:bg-muted/40 hover:border-border transition-all duration-200">
                <ShoppingCart className="h-4 w-4 text-muted-foreground" /> {t("طلب شراء جديد")}
              </Link>
              <Link to="/hr/employees" className="flex items-center justify-center gap-2 rounded-xl border-2 border-border/60 bg-white px-4 py-3 text-[13px] font-bold text-foreground hover:bg-muted/40 hover:border-border transition-all duration-200">
                <Users className="h-4 w-4 text-muted-foreground" /> {t("إدارة الموظفين")}
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* ── Modules Quick Access ── */}
      <section className="mt-10 animate-fade-in-up" style={{ animationDelay: "400ms" }}>
        <div className="flex items-center gap-3 mb-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-secondary text-white shadow-md shadow-primary/20">
            <Sparkles className="h-[18px] w-[18px]" />
          </div>
          <h2 className="text-xl font-extrabold text-foreground">{t("الوحدات الرئيسية")}</h2>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4 stagger-children">
          {modules.map((mod) => {
            const Icon = mod.icon;
            return (
              <Link key={mod.href} to={mod.href} className="group relative overflow-hidden rounded-2xl bg-white border border-border/50 p-6 shadow-sm hover:shadow-xl hover:-translate-y-1.5 transition-all duration-300 animate-fade-in-up">
                <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br opacity-0 group-hover:opacity-[0.04] transition-opacity duration-300", mod.gradient)} />
                <div className={cn("mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-lg transition-transform duration-300 group-hover:scale-110", mod.gradient, mod.shadow)}>
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="font-bold text-foreground group-hover:text-primary transition-colors text-[15px]">{t(mod.title)}</h3>
                <p className="mt-1.5 text-[13px] text-muted-foreground leading-relaxed">{t(mod.description)}</p>
                <div className="mt-4 flex items-center gap-1.5 text-primary opacity-0 translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300">
                  <span className="text-[13px] font-bold">{t("اذهب")}</span>
                  <ArrowLeft className="h-3.5 w-3.5" />
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </Layout>
  );
}

/* ── Alert Item ── */
function AlertItem({ color, title, desc }: { color: "amber" | "red"; title: string; desc: string }) {
  const colors = color === "amber" ? "border-amber-200 bg-amber-50/60 text-amber-700" : "border-red-200 bg-red-50/60 text-red-700";
  const iconColor = color === "amber" ? "text-amber-500" : "text-red-500";
  return (
    <div className={cn("flex gap-3 rounded-xl border p-3", colors)}>
      <AlertCircle className={cn("h-4 w-4 flex-shrink-0 mt-0.5", iconColor)} />
      <div>
        <p className="text-[13px] font-bold">{title}</p>
        <p className="text-[11px] opacity-75 mt-0.5">{desc}</p>
      </div>
    </div>
  );
}
