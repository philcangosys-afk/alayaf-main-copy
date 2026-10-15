import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { purchasesFeatures } from "./Purchases";
import {
  Plus,
  Search,
  X,
  Trash2,
  Eye,
  Edit,
  ClipboardCheck,
  Settings,
  ArrowLeftRight,
  Save,
  Loader2,
} from "lucide-react";
import { cn, escapeHtml } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabaseClient";
import { nextCompanyNumber } from "@/lib/companyNumbers";
import { COMPANY_PROFILE, companyDocPrefix } from "@/lib/companyProfile";
import {
  PageHeader,
  FilterBar,
  FilterInput,
  FilterSelect,
  FilterActions,
  DataTable,
  ActionBtn,
} from "@/components/SalesPageUI";

type PurchaseOrderRow = {
  id: string;
  date: string;
  expectedDate: string;
  vendor: string;
  referenceNo: string;
  notes: string;
  costCenter: string;
  costCenterName: string;
  total: string;
  status: string;
  statusColor: string;
  items: OrderItem[];
};

type OrderItem = {
  id: number;
  description: string;
  unit: string;
  quantity: number;
  price: number;
  discount: number;
  taxPercent: number;
};

const statusColors: Record<string, string> = {
  "مغلق": "bg-green-600 text-white",
  "مفتوح": "bg-cyan-500 text-white",
};

function mapRow(row: Record<string, unknown>): PurchaseOrderRow {
  const status = (row.status as string) ?? "مفتوح";
  return {
    id: (row.id as string) ?? "",
    date: (row.date as string) ?? "",
    expectedDate: (row.expected_date as string) ?? "",
    vendor: (row.vendor as string) ?? "",
    referenceNo: (row.reference_no as string) ?? "",
    notes: (row.notes as string) ?? "",
    costCenter: (row.cost_center as string) ?? "",
    costCenterName: (row.cost_center_name as string) ?? "",
    total: (row.total as string) ?? "",
    status,
    statusColor: statusColors[status] ?? "bg-slate-500 text-white",
    items: Array.isArray(row.items)
      ? (row.items as OrderItem[])
      : [],
  };
}

const formatDecimal = (
  value: number,
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string
) => formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatCurrency = (
  value: number,
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string,
  t: (value: string) => string
) => `${formatDecimal(value, formatNumber)} ${t("ريال")}`;

const formatOrderDate = (
  value: string,
  formatDate: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string
) => (value ? formatDate(value, { dateStyle: "medium" }) : "-");

export default function PurchaseOrders() {
  const { t, locale, direction, formatDate, formatNumber } = useI18n();
  const [view, setView] = useState<"list" | "create" | "details" | "edit">("list");
  const [orders, setOrders] = useState<PurchaseOrderRow[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrderRow | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from("purchase_orders")
        .select("*")
        .order("date", { ascending: false });
      if (!error && data) {
        setOrders(data.map(mapRow));
      }
    };
    load();
  }, [refreshKey]);

  const refresh = () => setRefreshKey((k) => k + 1);

  const handleDelete = async (id: string) => {
    if (!confirm(t("هل تريد حذف هذا الأمر؟"))) return;
    const { error } = await supabase.from("purchase_orders").delete().eq("id", id);
    if (!error) {
      setOrders((prev) => prev.filter((o) => o.id !== id));
      toast({ title: t("تم الحذف"), description: `${t("الأمر")}: ${id}` });
    } else {
      toast({ title: t("تعذّر الحذف"), description: error.message });
    }
  };

  const handlePrintPdf = (order: PurchaseOrderRow) => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const items: OrderItem[] = order.items.length > 0
      ? order.items
      : [{ id: 1, description: "-", unit: "", quantity: 1, price: Number(order.total) || 0, discount: 0, taxPercent: 0 }];

    const rowsHtml = items.map((item) => {
      const sub = item.quantity * item.price - item.discount;
      const tax = (sub * item.taxPercent) / 100;
      return `<tr>
        <td>${escapeHtml(item.description || "-")}</td>
        <td>${escapeHtml(item.unit || "-")}</td>
        <td>${formatNumber(item.quantity)}</td>
        <td>${formatCurrency(item.price, formatNumber, t)}</td>
        <td>${formatCurrency(item.discount, formatNumber, t)}</td>
        <td>${formatNumber(item.taxPercent)}%</td>
        <td>${formatCurrency(sub + tax, formatNumber, t)}</td>
      </tr>`;
    }).join("");

    printWindow.document.write(`
      <html dir="${direction}" lang="${locale}">
        <head>
          <title>${t("أمر شراء")} ${escapeHtml(order.id)}</title>
          <meta charset="utf-8"/>
          <style>
            body{font-family:Arial,sans-serif;margin:0;padding:24px;color:#0f172a}
            .header{display:flex;justify-content:space-between;border-bottom:2px solid #1b8c56;padding-bottom:12px;margin-bottom:16px}
            .title{font-size:24px;font-weight:700;color:#1b8c56}
            .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px}
            .card{border:1px solid #e2e8f0;padding:10px;border-radius:6px}
            .label{color:#64748b;font-size:12px}
            .value{font-weight:700;font-size:14px;margin-top:2px}
            table{width:100%;border-collapse:collapse;font-size:13px}
            th,td{border:1px solid #e2e8f0;padding:8px;text-align:right}
            th{background:#f8fafc;font-weight:600}
          </style>
        </head>
        <body>
          <div class="header">
            <div class="title">${t("أمر الشراء")}</div>
            <div>${t("رقم الأمر")}: <strong>${escapeHtml(order.id)}</strong></div>
          </div>
          <div class="grid">
            <div class="card"><div class="label">${t("المورد")}</div><div class="value">${escapeHtml(order.vendor || "-")}</div></div>
            <div class="card"><div class="label">${t("تاريخ الأمر")}</div><div class="value">${formatOrderDate(order.date, formatDate)}</div></div>
            <div class="card"><div class="label">${t("تاريخ الاستلام المتوقع")}</div><div class="value">${order.expectedDate ? formatOrderDate(order.expectedDate, formatDate) : "-"}</div></div>
            <div class="card"><div class="label">${t("مرجع الأمر")}</div><div class="value">${escapeHtml(order.referenceNo || "-")}</div></div>
            <div class="card"><div class="label">${t("مركز التكلفة")}</div><div class="value">${escapeHtml(order.costCenter ? t(order.costCenter) : "-")}</div></div>
            <div class="card"><div class="label">${t("الإجمالي")}</div><div class="value">${formatCurrency(Number(order.total) || 0, formatNumber, t)}</div></div>
          </div>
          <table>
            <thead><tr><th>${t("وصف البند")}</th><th>${t("الوحدة")}</th><th>${t("الكمية")}</th><th>${t("السعر")}</th><th>${t("الخصم")}</th><th>${t("الضريبة")}</th><th>${t("الإجمالي")}</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
          ${order.notes ? `<p style="margin-top:16px;font-size:13px"><strong>${t("ملاحظات")}:</strong> ${escapeHtml(order.notes)}</p>` : ""}
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  return (
    <Layout subMenu={{ title: t("المشتريات"), items: purchasesFeatures }}>
      <div dir={direction} className="mx-auto max-w-7xl">
        {view === "list" && (
          <OrdersList
            orders={orders}
            onCreateClick={() => setView("create")}
            onView={(order) => { setSelectedOrder(order); setView("details"); }}
            onEdit={(order) => { setSelectedOrder(order); setView("edit"); }}
            onDelete={handleDelete}
            onPrintPdf={handlePrintPdf}
          />
        )}
        {view === "create" && (
          <OrderForm
            onBack={() => setView("list")}
            onSaved={(order) => {
              setOrders((prev) => [order, ...prev]);
              toast({ title: t("تم حفظ أمر الشراء"), description: `${t("الأمر")}: ${order.id}` });
              setView("list");
            }}
          />
        )}
        {view === "details" && selectedOrder && (
          <OrderDetails order={selectedOrder} onBack={() => setView("list")} onEdit={() => setView("edit")} onPrintPdf={handlePrintPdf} />
        )}
        {view === "edit" && selectedOrder && (
          <OrderEdit
            order={selectedOrder}
            onBack={() => setView("list")}
            onUpdated={(updated) => {
              setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
              setSelectedOrder(updated);
              toast({ title: t("تم تحديث أمر الشراء") });
              setView("list");
            }}
          />
        )}
      </div>
    </Layout>
  );
}

/* ── List ── */
function OrdersList({
  orders,
  onCreateClick,
  onView,
  onEdit,
  onDelete,
  onPrintPdf,
}: {
  orders: PurchaseOrderRow[];
  onCreateClick: () => void;
  onView: (o: PurchaseOrderRow) => void;
  onEdit: (o: PurchaseOrderRow) => void;
  onDelete: (id: string) => void;
  onPrintPdf: (o: PurchaseOrderRow) => void;
}) {
  const { t, formatDate, formatNumber } = useI18n();

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ClipboardCheck}
        title={t("أوامر الشراء")}
        subtitle={t("إدارة وتتبع جميع أوامر الشراء من الموردين")}
        actionLabel={t("إنشاء أمر شراء جديد")}
        onAction={onCreateClick}
        gradient="from-violet-600 to-purple-700"
      />

      <FilterBar>
        <FilterInput placeholder={t("رقم أمر الشراء، المرجع، اسم المورد...")} />
        <FilterSelect label={t("المورد")}>
          <option>{t("الكل")}</option>
        </FilterSelect>
        <FilterSelect label={t("الحالة")}>
          <option>{t("الكل")}</option>
        </FilterSelect>
        <FilterActions onReset={() => {}} onSearch={() => {}} />
      </FilterBar>

      <DataTable
        headers={[t("الإجراءات"), t("الحالة"), t("المجموع"), t("المورد"), t("تاريخ الأمر"), t("رقم الأمر")]}
        gradient="from-violet-800 to-purple-900"
      >
        {orders.map((order) => (
          <tr key={order.id} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
            <td className="px-5 py-3.5 align-middle">
              <div className="flex items-center gap-1">
                <ActionBtn icon={Eye} label={t("عرض")} color="blue" onClick={() => onView(order)} />
                <ActionBtn icon={Edit} label={t("تعديل")} color="emerald" onClick={() => onEdit(order)} />
                <ActionBtn icon={Trash2} label={t("حذف")} color="red" onClick={() => onDelete(order.id)} />
                <button
                  title={t("طباعة PDF")}
                  onClick={() => onPrintPdf(order)}
                  className="px-2.5 py-1.5 text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors text-xs font-semibold"
                >
                  PDF
                </button>
              </div>
            </td>
            <td className="px-5 py-3.5 align-middle">
              <span className={cn("inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold", order.statusColor)}>
                {t(order.status)}
              </span>
            </td>
            <td className="px-5 py-3.5 align-middle font-medium whitespace-nowrap">{formatCurrency(Number(order.total) || 0, formatNumber, t)}</td>
            <td className="px-5 py-3.5 align-middle">{order.vendor}</td>
            <td className="px-5 py-3.5 align-middle text-muted-foreground">{formatOrderDate(order.date, formatDate)}</td>
            <td
              className="px-5 py-3.5 align-middle font-semibold text-violet-600 hover:underline cursor-pointer"
              onClick={() => onView(order)}
            >
              {order.id}
            </td>
          </tr>
        ))}
        {orders.length === 0 && (
          <tr>
            <td colSpan={6} className="px-5 py-12 text-center text-muted-foreground">
              {t("لا توجد أوامر شراء")}
            </td>
          </tr>
        )}
      </DataTable>
    </div>
  );
}

/* ── Details ── */
function OrderDetails({
  order,
  onBack,
  onEdit,
  onPrintPdf,
}: {
  order: PurchaseOrderRow;
  onBack: () => void;
  onEdit: () => void;
  onPrintPdf: (o: PurchaseOrderRow) => void;
}) {
  const { t, direction, formatDate, formatNumber } = useI18n();
  const items: OrderItem[] = order.items.length > 0
    ? order.items
    : [{ id: 1, description: "-", unit: "", quantity: 1, price: Number(order.total) || 0, discount: 0, taxPercent: 0 }];

  const totals = items.reduce(
    (acc, item) => {
      const sub = item.quantity * item.price - item.discount;
      const tax = (sub * item.taxPercent) / 100;
      return { subtotal: acc.subtotal + sub, discount: acc.discount + item.discount, tax: acc.tax + tax, total: acc.total + sub + tax };
    },
    { subtotal: 0, discount: 0, tax: 0, total: 0 }
  );

  return (
    <div dir={direction} className="space-y-6 bg-slate-50 min-h-screen pb-12">
      <div className="flex justify-between items-center bg-white p-4 border-b border-slate-200 shadow-sm">
        <button onClick={onBack} className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-sm font-medium rounded hover:bg-slate-50 flex items-center gap-2">
          {t("العودة للقائمة")} <ArrowLeftRight className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-slate-800">{t("تفاصيل أمر الشراء")}</h1>
          <ClipboardCheck className="h-5 w-5 text-blue-600" />
        </div>
        <div className="flex gap-2">
          <button onClick={() => onPrintPdf(order)} className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-sm rounded hover:bg-slate-50 flex items-center gap-2">
            {t("طباعة PDF")}
          </button>
          <button onClick={onEdit} className="px-4 py-2 bg-emerald-600 text-white text-sm rounded hover:bg-emerald-700 flex items-center gap-2">
            <Edit className="h-4 w-4" /> {t("تعديل")}
          </button>
        </div>
      </div>

      <div className="p-4 space-y-6">
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
            <h2 className="font-semibold text-slate-800 text-right">{t("بيانات الأمر")}</h2>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { label: t("رقم الأمر"), value: order.id },
              { label: t("المورد"), value: order.vendor },
              { label: t("تاريخ الأمر"), value: formatOrderDate(order.date, formatDate) },
              { label: t("تاريخ الاستلام المتوقع"), value: order.expectedDate ? formatOrderDate(order.expectedDate, formatDate) : "-" },
              { label: t("مرجع الأمر"), value: order.referenceNo || "-" },
              { label: t("مركز التكلفة"), value: order.costCenter ? t(order.costCenter) : "-" },
              { label: t("الإجمالي"), value: formatCurrency(Number(order.total) || 0, formatNumber, t) },
              { label: t("الحالة"), value: t(order.status) },
            ].map(({ label, value }) => (
              <div key={label} className="space-y-1">
                <div className="text-xs text-slate-500 text-right">{label}</div>
                <div className="text-sm font-semibold text-right">{value}</div>
              </div>
            ))}
            {order.notes && (
              <div className="md:col-span-3 space-y-1">
                <div className="text-xs text-slate-500 text-right">{t("ملاحظات")}</div>
                <div className="text-sm text-right">{order.notes}</div>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
            <h2 className="font-semibold text-slate-800 text-right">{t("بنود الأمر")}</h2>
          </div>
          <div className="p-4 overflow-x-auto">
            <table dir={direction} className="w-full text-sm text-right">
              <thead className="bg-slate-100">
                <tr>
                  <th className="px-3 py-2 border border-slate-200">{t("وصف البند")}</th>
                  <th className="px-3 py-2 border border-slate-200">{t("الوحدة")}</th>
                  <th className="px-3 py-2 border border-slate-200">{t("الكمية")}</th>
                  <th className="px-3 py-2 border border-slate-200">{t("السعر")}</th>
                  <th className="px-3 py-2 border border-slate-200">{t("الخصم")}</th>
                  <th className="px-3 py-2 border border-slate-200">{t("الضريبة")}</th>
                  <th className="px-3 py-2 border border-slate-200">{t("الإجمالي")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => {
                  const sub = item.quantity * item.price - item.discount;
                  const tax = (sub * item.taxPercent) / 100;
                  return (
                    <tr key={idx}>
                      <td className="px-3 py-2 border border-slate-200">{item.description || "-"}</td>
                      <td className="px-3 py-2 border border-slate-200">{item.unit || "-"}</td>
                      <td className="px-3 py-2 border border-slate-200">{formatNumber(item.quantity)}</td>
                      <td className="px-3 py-2 border border-slate-200">{formatCurrency(item.price, formatNumber, t)}</td>
                      <td className="px-3 py-2 border border-slate-200">{formatCurrency(item.discount, formatNumber, t)}</td>
                      <td className="px-3 py-2 border border-slate-200">{formatNumber(item.taxPercent)}%</td>
                      <td className="px-3 py-2 border border-slate-200">{formatCurrency(sub + tax, formatNumber, t)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="flex justify-end mt-6">
              <div className="w-72 space-y-2 text-sm">
                {[
                  { label: t("المجموع الفرعي"), value: totals.subtotal },
                  { label: t("الخصم"), value: totals.discount },
                  { label: t("الضريبة"), value: totals.tax },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between">
                    <span className="font-semibold">{formatCurrency(value, formatNumber, t)}</span>
                    <span className="text-slate-600">{label}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-slate-200 pt-2">
                  <span className="font-bold text-blue-600">{formatCurrency(totals.total, formatNumber, t)}</span>
                  <span className="font-bold text-slate-800">{t("الإجمالي الكلي")}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Edit ── */
function OrderEdit({
  order,
  onBack,
  onUpdated,
}: {
  order: PurchaseOrderRow;
  onBack: () => void;
  onUpdated: (o: PurchaseOrderRow) => void;
}) {
  const { t, direction, formatNumber } = useI18n();
  const [form, setForm] = useState({
    vendor: order.vendor,
    date: order.date,
    expectedDate: order.expectedDate,
    referenceNo: order.referenceNo,
    notes: order.notes,
    costCenter: order.costCenter || "بدون مركز تكلفة",
    costCenterName: order.costCenterName,
    status: order.status,
    category: "مشتريات",
    project: "",
    budget: "",
  });

  const [items, setItems] = useState<OrderItem[]>(
    order.items.length > 0
      ? order.items.map((item, idx) => ({ ...item, id: idx + 1 }))
      : [{ id: 1, description: "", unit: "", quantity: 1, price: 0, discount: 0, taxPercent: 15 }]
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setField = (field: keyof typeof form, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const addItem = () =>
    setItems((prev) => [
      ...prev,
      { id: Date.now(), description: "", unit: "", quantity: 1, price: 0, discount: 0, taxPercent: 15 },
    ]);

  const updateItem = (id: number, changes: Partial<OrderItem>) =>
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...changes } : item)));

  const removeItem = (id: number) =>
    setItems((prev) => prev.filter((item) => item.id !== id));

  const totals = items.reduce(
    (acc, item) => {
      const sub = item.quantity * item.price - item.discount;
      const tax = (sub * item.taxPercent) / 100;
      return { subtotal: acc.subtotal + sub, discount: acc.discount + item.discount, tax: acc.tax + tax, total: acc.total + sub + tax };
    },
    { subtotal: 0, discount: 0, tax: 0, total: 0 }
  );

  const handleSave = async () => {
    if (saving) return;
    // حماية: أمر قديم بلا بنود كان يُحفظ بإجمالي صفر فيمسح قيمته
    if (!(totals.total > 0) || items.some((item) => !String(item.description ?? "").trim() || !(Number(item.quantity) > 0) || Number(item.price) < 0 || Number(item.discount) < 0)) {
      setError(t("أدخل بنود الأمر بوصف وكمية وسعر صحيحة قبل الحفظ (لا يُحفظ أمر بإجمالي صفر)"));
      return;
    }
    setSaving(true);
    setError(null);
    const { error: updateError } = await supabase
      .from("purchase_orders")
      .update({
        vendor: form.vendor,
        date: form.date,
        expected_date: form.expectedDate || null,
        reference_no: form.referenceNo || null,
        notes: form.notes || null,
        cost_center: form.costCenter,
        cost_center_name: form.costCenterName || null,
        status: form.status,
        total: totals.total.toFixed(2),
        items: items.map((item) => ({
          id: item.id,
          description: item.description,
          unit: item.unit,
          quantity: item.quantity,
          price: item.price,
          discount: item.discount,
          taxPercent: item.taxPercent,
        })),
      })
      .eq("id", order.id);

    setSaving(false);
    if (!updateError) {
      onUpdated({
        ...order,
        ...form,
        total: totals.total.toFixed(2),
        statusColor: statusColors[form.status] ?? "bg-slate-500 text-white",
        items,
      });
    } else {
      setError(`${t("تعذّر التحديث")}: ${updateError.message}`);
    }
  };


  return (
    <div dir={direction} className="mx-auto max-w-5xl">
      <div className="space-y-6 bg-white min-h-screen pb-12">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-slate-200">
          <div className="flex gap-2">
            <button onClick={onBack} disabled={saving} className="px-4 py-2 bg-slate-500 text-white text-sm rounded hover:bg-slate-600 flex items-center gap-1 disabled:opacity-50">
              <X className="h-4 w-4" /> {t("إلغاء")}
            </button>
            <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-emerald-600 text-white text-sm rounded flex items-center gap-2 hover:bg-emerald-700 disabled:opacity-60">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? t("جارٍ الحفظ...") : t("حفظ التعديلات")}
              </button>
            </div>
            <h1 className="text-2xl font-bold text-slate-800 text-right">{t("أمر شراء")}</h1>
          </div>

          {error && (
            <div className="mx-6 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm text-right">{error}</div>
          )}

          <div className="px-6 space-y-6">
            {/* Company Info Section */}
            <div className="rounded-lg border border-slate-200 p-4 flex justify-between items-start bg-white">
              <div className="text-right space-y-1 text-slate-700">
                <div className="text-xs opacity-75">{t("رقم السجل التجاري")}</div>
                <div className="text-sm font-medium">{COMPANY_PROFILE.commercialRegistration}</div>
              </div>
              <div className="text-right space-y-2 text-slate-900">
                <div className="font-semibold text-2xl leading-tight">{t(COMPANY_PROFILE.companyNameAr)}</div>
                <div className="text-xs opacity-75">{t("المملكة العربية السعودية")}</div>
              </div>
            </div>

            {/* Form Fields */}
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700 text-right block">{t("رقم امر الشراء")} *</label>
                  <input
                    type="text"
                    value={form.referenceNo ?? ""}
                    onChange={(e) => setField("referenceNo", e.target.value)}
                    placeholder="PO-000100"
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-right focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700 text-right block">{t("المورد")} *</label>
                  <input
                    type="text"
                    value={form.vendor ?? ""}
                    onChange={(e) => setField("vendor", e.target.value)}
                    placeholder={t("مطلوب")}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-right focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700 text-right block">{t("العملة")} *</label>
                  <input
                    type="text"
                    value="SAR"
                    readOnly
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-right focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700 text-right block">{t("التاريخ")} *</label>
                  <input
                    type="date"
                    value={form.date ?? ""}
                    onChange={(e) => setField("date", e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-right focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700 text-right block">{t("المشروع")}</label>
                  <input
                    value={form.project ?? ""}
                    onChange={(e) => setField("project", e.target.value)}
                    placeholder={t("اختياري")}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-right focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700 text-right block">{t("المرجع")}</label>
                  <input
                    value={form.notes ?? ""}
                    onChange={(e) => setField("notes", e.target.value)}
                    placeholder={t("اختياري")}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-right focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                  />
                </div>
              </div>

              {/* Items Section */}
              <div className="mt-8 space-y-4">
                <div className="flex justify-between items-center">
                  <button
                    onClick={addItem}
                    className="bg-[#1b8c56] text-white px-3 py-2 rounded text-sm font-medium hover:bg-[#157347] flex items-center gap-2"
                  >
                    <Plus className="h-4 w-4" /> {t("إضافة بند")}
                  </button>
                  <h3 className="text-sm font-semibold text-slate-800">{t("مثال وصف الخدمة")}</h3>
                </div>

                <div className="overflow-x-auto">
                  <table dir="ltr" className="w-full text-sm [&_th]:[direction:rtl] [&_td]:[direction:rtl] [&_th]:text-right [&_td]:text-right">
                    <thead className="bg-slate-100 border border-slate-300">
                      <tr>
                        <th className="px-3 py-2 border border-slate-300"></th>
                        <th className="px-3 py-2 border border-slate-300">{t("المجموع")}</th>
                        <th className="px-3 py-2 border border-slate-300">{t("الضريبة %")}</th>
                        <th className="px-3 py-2 border border-slate-300">{t("الخصم")}</th>
                        <th className="px-3 py-2 border border-slate-300">{t("السعر")}</th>
                        <th className="px-3 py-2 border border-slate-300">{t("الوحدة")}</th>
                        <th className="px-3 py-2 border border-slate-300">{t("الكمية")}</th>
                        <th className="px-3 py-2 border border-slate-300">{t("الوصف")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => {
                        const sub = item.quantity * item.price - item.discount;
                        const tax = (sub * item.taxPercent) / 100;
                        const lineTotal = sub + tax;
                        return (
                          <tr key={item.id} className="border border-slate-300">
                            <td className="px-3 py-2 border border-slate-300 text-center">
                              <button aria-label={t("حذف البند")} onClick={() => removeItem(item.id)} className="w-6 h-6 flex items-center justify-center bg-red-500 text-white rounded hover:bg-red-600 text-xs">
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </td>
                            <td className="px-3 py-2 border border-slate-300">
                              <input type="text" value={formatDecimal(lineTotal, formatNumber)} readOnly disabled className="w-full px-2 py-1 border border-slate-200 bg-slate-100 rounded text-xs text-right outline-none" />
                            </td>
                            <td className="px-3 py-2 border border-slate-300">
                              <input type="number" value={item.taxPercent ?? 0} onChange={(e) => updateItem(item.id, { taxPercent: Number(e.target.value) || 0 })} className="w-full px-2 py-1 border border-slate-300 rounded text-xs text-right focus:border-emerald-500 outline-none" />
                            </td>
                            <td className="px-3 py-2 border border-slate-300">
                              <input type="number" value={item.discount ?? 0} onChange={(e) => updateItem(item.id, { discount: Number(e.target.value) || 0 })} className="w-full px-2 py-1 border border-slate-300 rounded text-xs text-right focus:border-emerald-500 outline-none" />
                            </td>
                            <td className="px-3 py-2 border border-slate-300">
                              <input type="number" value={item.price ?? 0} onChange={(e) => updateItem(item.id, { price: Number(e.target.value) || 0 })} className="w-full px-2 py-1 border border-slate-300 rounded text-xs text-right focus:border-emerald-500 outline-none" />
                            </td>
                            <td className="px-3 py-2 border border-slate-300">
                              <input type="text" value={item.unit ?? ""} onChange={(e) => updateItem(item.id, { unit: e.target.value })} className="w-full px-2 py-1 border border-slate-300 rounded text-xs text-right focus:border-emerald-500 outline-none" />
                            </td>
                            <td className="px-3 py-2 border border-slate-300">
                              <input type="number" value={item.quantity ?? 0} onChange={(e) => updateItem(item.id, { quantity: Number(e.target.value) || 0 })} className="w-full px-2 py-1 border border-slate-300 rounded text-xs text-right focus:border-emerald-500 outline-none" />
                            </td>
                            <td className="px-3 py-2 border border-slate-300">
                              <input type="text" value={item.description ?? ""} onChange={(e) => updateItem(item.id, { description: e.target.value })} className="w-full px-2 py-1 border border-slate-300 rounded text-xs text-right focus:border-emerald-500 outline-none" />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

              <div className="flex justify-end pt-4">
                <div className="w-64 space-y-2 text-sm border-t border-slate-200 pt-4">
                  <div className="flex justify-between text-right">
                    <span>{formatCurrency(totals.total, formatNumber, t)}</span>
                    <span className="text-slate-600">{t("المجموع الكلي")}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Create Form ── */
function OrderForm({
  onBack,
  onSaved,
}: {
  onBack: () => void;
  onSaved: (order: PurchaseOrderRow) => void;
}) {
  const { t, direction, formatNumber } = useI18n();
  const today = new Date().toISOString().split("T")[0];
  const defaultExpected = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];

  const [form, setForm] = useState({
    vendor: "",
    date: today,
    expectedDate: defaultExpected,
    referenceNo: "",
    notes: "",
    costCenter: "بدون مركز تكلفة",
    costCenterName: "",
    category: "مشتريات",
    project: "",
    budget: "",
  });

  const [items, setItems] = useState<OrderItem[]>([
    { id: 1, description: "", unit: "", quantity: 1, price: 0, discount: 0, taxPercent: 15 },
  ]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setField = (field: keyof typeof form, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const addItem = () =>
    setItems((prev) => [
      ...prev,
      { id: Date.now(), description: "", unit: "", quantity: 1, price: 0, discount: 0, taxPercent: 15 },
    ]);

  const updateItem = (id: number, changes: Partial<OrderItem>) =>
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...changes } : item)));

  const removeItem = (id: number) =>
    setItems((prev) => prev.filter((item) => item.id !== id));

  const totals = items.reduce(
    (acc, item) => {
      const sub = item.quantity * item.price - item.discount;
      const tax = (sub * item.taxPercent) / 100;
      return { subtotal: acc.subtotal + sub, discount: acc.discount + item.discount, tax: acc.tax + tax, total: acc.total + sub + tax };
    },
    { subtotal: 0, discount: 0, tax: 0, total: 0 }
  );

  const handleSave = async () => {
    if (!form.date) { setError(t("يرجى إدخال تاريخ أمر الشراء")); return; }
    setSaving(true);
    setError(null);

    // رقم أمر الشراء: إن تُرك فارغًا يُحجز رقم المنشأة التالي (1001-PO-000001)
    let referenceNo = (form.referenceNo ?? "").trim();
    if (!referenceNo) {
      try {
        referenceNo = await nextCompanyNumber("PO", 6);
      } catch {
        setSaving(false);
        setError(t("تعذر حجز رقم أمر الشراء، حاول مرة أخرى"));
        return;
      }
    }

    const newId = crypto.randomUUID();
    const payload = {
      id: newId,
      vendor: form.vendor,
      date: form.date,
      expected_date: form.expectedDate || null,
      reference_no: referenceNo,
      notes: form.notes || null,
      cost_center: form.costCenter,
      cost_center_name: form.costCenterName || null,
      total: totals.total.toFixed(2),
      status: "مفتوح",
      items: items.map((item) => ({
        id: item.id,
        description: item.description,
        unit: item.unit,
        quantity: item.quantity,
        price: item.price,
        discount: item.discount,
        taxPercent: item.taxPercent,
      })),
    };

    const { error: insertError } = await supabase.from("purchase_orders").insert([payload]);
    setSaving(false);

    if (insertError) {
      setError(`${t("حدث خطأ أثناء الحفظ")}: ${insertError.message}`);
      return;
    }

    onSaved({
      id: newId,
      date: form.date,
      expectedDate: form.expectedDate,
      vendor: form.vendor,
      referenceNo,
      notes: form.notes,
      costCenter: form.costCenter,
      costCenterName: form.costCenterName,
      total: totals.total.toFixed(2),
      status: "مفتوح",
      statusColor: "bg-cyan-500 text-white",
      items,
    });
  };


  return (
    <div dir={direction} className="mx-auto max-w-5xl">
      <div className="space-y-6 bg-white min-h-screen pb-12">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-slate-200">
          <div className="flex gap-2">
            <button onClick={onBack} disabled={saving} className="px-4 py-2 bg-slate-500 text-white text-sm rounded hover:bg-slate-600 flex items-center gap-1 disabled:opacity-50">
              <X className="h-4 w-4" /> {t("إلغاء")}
            </button>
            <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-blue-600 text-white text-sm rounded flex items-center gap-2 hover:bg-blue-700 disabled:opacity-60">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? t("جارٍ الحفظ...") : t("حفظ أمر الشراء")}
              </button>
            </div>
            <h1 className="text-2xl font-bold text-slate-800 text-right">{t("أمر شراء")}</h1>
          </div>

          {error && (
            <div className="mx-6 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm text-right">{error}</div>
          )}

          <div className="px-6 space-y-6">
            {/* Company Info Section */}
            <div className="rounded-lg border border-slate-200 p-4 flex justify-between items-start bg-white">
              <div className="text-right space-y-1 text-slate-700">
                <div className="text-xs opacity-75">{t("رقم السجل التجاري")}</div>
                <div className="text-sm font-medium">{COMPANY_PROFILE.commercialRegistration}</div>
              </div>
              <div className="text-right space-y-2 text-slate-900">
                <div className="font-semibold text-2xl leading-tight">{t(COMPANY_PROFILE.companyNameAr)}</div>
                <div className="text-xs opacity-75">{t("المملكة العربية السعودية")}</div>
              </div>
            </div>

            {/* Form Fields */}
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700 text-right block">{t("رقم امر الشراء")} *</label>
                  <input
                    type="text"
                    value={form.referenceNo ?? ""}
                    onChange={(e) => setField("referenceNo", e.target.value)}
                    placeholder={`${companyDocPrefix()}PO-000001 — ${t("يُولَّد تلقائيًا إن تُرك فارغًا")}`}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-right focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700 text-right block">{t("المورد")} *</label>
                  <input
                    type="text"
                    value={form.vendor ?? ""}
                    onChange={(e) => setField("vendor", e.target.value)}
                    placeholder={t("مطلوب")}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-right focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700 text-right block">{t("العملة")} *</label>
                  <input
                    type="text"
                    value="SAR"
                    readOnly
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-right focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700 text-right block">{t("التاريخ")} *</label>
                  <input
                    type="date"
                    value={form.date ?? ""}
                    onChange={(e) => setField("date", e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-right focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700 text-right block">{t("المشروع")}</label>
                  <input
                    value={form.project ?? ""}
                    onChange={(e) => setField("project", e.target.value)}
                    placeholder={t("اختياري")}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-right focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700 text-right block">{t("المرجع")}</label>
                  <input
                    value={form.notes ?? ""}
                    onChange={(e) => setField("notes", e.target.value)}
                    placeholder={t("اختياري")}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-right focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                  />
                </div>
              </div>

              {/* Items Section */}
              <div className="mt-8 space-y-4">
                <div className="flex justify-between items-center">
                  <button
                    onClick={addItem}
                    className="bg-[#1b8c56] text-white px-3 py-2 rounded text-sm font-medium hover:bg-[#157347] flex items-center gap-2"
                  >
                    <Plus className="h-4 w-4" /> {t("إضافة بند")}
                  </button>
                  <h3 className="text-sm font-semibold text-slate-800">{t("مثال وصف الخدمة")}</h3>
                </div>

                <div className="overflow-x-auto">
                  <table dir="ltr" className="w-full text-sm [&_th]:[direction:rtl] [&_td]:[direction:rtl] [&_th]:text-right [&_td]:text-right">
                    <thead className="bg-slate-100 border border-slate-300">
                      <tr>
                        <th className="px-3 py-2 border border-slate-300"></th>
                        <th className="px-3 py-2 border border-slate-300">{t("المجموع")}</th>
                        <th className="px-3 py-2 border border-slate-300">{t("الضريبة %")}</th>
                        <th className="px-3 py-2 border border-slate-300">{t("الخصم")}</th>
                        <th className="px-3 py-2 border border-slate-300">{t("السعر")}</th>
                        <th className="px-3 py-2 border border-slate-300">{t("الوحدة")}</th>
                        <th className="px-3 py-2 border border-slate-300">{t("الكمية")}</th>
                        <th className="px-3 py-2 border border-slate-300">{t("الوصف")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => {
                        const sub = item.quantity * item.price - item.discount;
                        const tax = (sub * item.taxPercent) / 100;
                        const lineTotal = sub + tax;
                        return (
                          <tr key={item.id} className="border border-slate-300">
                            <td className="px-3 py-2 border border-slate-300 text-center">
                              <button aria-label={t("حذف البند")} onClick={() => removeItem(item.id)} className="w-6 h-6 flex items-center justify-center bg-red-500 text-white rounded hover:bg-red-600 text-xs">
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </td>
                            <td className="px-3 py-2 border border-slate-300">
                              <input type="text" value={formatDecimal(lineTotal, formatNumber)} readOnly disabled className="w-full px-2 py-1 border border-slate-200 bg-slate-100 rounded text-xs text-right outline-none" />
                            </td>
                            <td className="px-3 py-2 border border-slate-300">
                              <input type="number" value={item.taxPercent ?? 0} onChange={(e) => updateItem(item.id, { taxPercent: Number(e.target.value) || 0 })} className="w-full px-2 py-1 border border-slate-300 rounded text-xs text-right focus:border-blue-500 outline-none" />
                            </td>
                            <td className="px-3 py-2 border border-slate-300">
                              <input type="number" value={item.discount ?? 0} onChange={(e) => updateItem(item.id, { discount: Number(e.target.value) || 0 })} className="w-full px-2 py-1 border border-slate-300 rounded text-xs text-right focus:border-blue-500 outline-none" />
                            </td>
                            <td className="px-3 py-2 border border-slate-300">
                              <input type="number" value={item.price ?? 0} onChange={(e) => updateItem(item.id, { price: Number(e.target.value) || 0 })} className="w-full px-2 py-1 border border-slate-300 rounded text-xs text-right focus:border-blue-500 outline-none" />
                            </td>
                            <td className="px-3 py-2 border border-slate-300">
                              <input type="text" value={item.unit ?? ""} onChange={(e) => updateItem(item.id, { unit: e.target.value })} className="w-full px-2 py-1 border border-slate-300 rounded text-xs text-right focus:border-blue-500 outline-none" />
                            </td>
                            <td className="px-3 py-2 border border-slate-300">
                              <input type="number" value={item.quantity ?? 0} onChange={(e) => updateItem(item.id, { quantity: Number(e.target.value) || 0 })} className="w-full px-2 py-1 border border-slate-300 rounded text-xs text-right focus:border-blue-500 outline-none" />
                            </td>
                            <td className="px-3 py-2 border border-slate-300">
                              <input type="text" value={item.description ?? ""} onChange={(e) => updateItem(item.id, { description: e.target.value })} className="w-full px-2 py-1 border border-slate-300 rounded text-xs text-right focus:border-blue-500 outline-none" />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

              <div className="flex justify-end pt-4">
                <div className="w-64 space-y-2 text-sm border-t border-slate-200 pt-4">
                  <div className="flex justify-between text-right">
                    <span>{formatCurrency(totals.total, formatNumber, t)}</span>
                    <span className="text-slate-600">{t("المجموع")}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
