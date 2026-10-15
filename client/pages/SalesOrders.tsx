import { useEffect, useMemo, useRef, useState } from "react";
import Layout from "@/components/Layout";
import { salesFeatures } from "./Sales";
import {
  Plus,
  Search,
  X,
  Trash2,
  ArrowLeftRight,
  Edit,
  Eye,
  FileText,
  ShoppingCart,
  Download,
  Save,
} from "lucide-react";
import {
  cn,
  escapeHtml,
  riyadhDateString,
  SAUDI_STANDARD_VAT_RATE,
} from "@/lib/utils";
import {
  PageHeader,
  FilterBar,
  FilterInput,
  FilterSelect,
  FilterActions,
  DataTable,
  ActionBtn,
  FormHeaderBar,
  FormCard,
  SectionHeader,
  AddItemBtn,
  TotalsSummary,
  PrimaryBtn,
  SecondaryBtn,
} from "@/components/SalesPageUI";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabaseClient";
import { nextCompanyNumber } from "@/lib/companyNumbers";
import { useI18n } from "@/i18n";

// بند أمر البيع كما يُحفظ في عمود items (jsonb) في قاعدة البيانات
type OrderItem = {
  id: number;
  description: string;
  quantity: number;
  price: number;
  discount: number;
  taxPercent: number;
};

type SalesOrder = {
  id: string;
  date: string;
  deliveryDate: string;
  customer: string;
  total: string;
  quotationId: string;
  status: string;
  statusColor: string;
  subStatus?: string;
  subStatusColor?: string;
  items: OrderItem[];
  warehouse: string;
  notes: string;
  // مجاميع تحسبها قاعدة البيانات (trigger) من البنود
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  grandTotal: number;
};

const statusColors: Record<string, string> = {
  confirmed: "bg-slate-600 text-white",
  delivered: "bg-slate-600 text-white",
};

const salesOrderTranslations: Record<string, string> = {
  "لا يمكن حفظ أمر بإجمالي صفر": "An order cannot be saved with a zero total",
  "أضف بنود الأمر بأسعارها قبل الحفظ": "Add the order lines with prices before saving",
  "بنود هذا الأمر غير محفوظة؛ أعد إدخالها كاملة قبل الحفظ":
    "This order's lines are not saved; re-enter all lines before saving",
  "تحقق من بنود الأمر": "Check the order lines",
  "الكمية يجب أن تكون أكبر من صفر، والسعر والخصم غير سالبين، والخصم لا يتجاوز قيمة البند":
    "Quantity must be above zero, price and discount cannot be negative, and the discount cannot exceed the line value",
  "تعذر تحميل أوامر البيع": "Unable to load sales orders",
  "نسبة ضريبة القيمة المضافة الأساسية": "Standard VAT rate",
  "بيانات الأمر غير مكتملة": "Order data is incomplete",
  "اختر العميل وأضف بندًا واحدًا على الأقل بقيمة أكبر من صفر":
    "Select a customer and add at least one line with a value above zero",
  "أمر بيع": "Sales order",
  "تفاصيل أمر البيع": "Sales order details",
  "رقم الأمر": "Order number",
  "العميل": "Customer",
  "رقم عرض السعر": "Quotation number",
  "تاريخ الأمر": "Order date",
  "تاريخ التسليم": "Delivery date",
  "وصف البند": "Item description",
  "الكمية": "Quantity",
  "السعر": "Price",
  "الخصم": "Discount",
  "الضريبة": "Tax",
  "الإجمالي": "Total",
  "المبيعات": "Sales",
  "أوامر البيع": "Sales orders",
  "إدارة وتتبع جميع أوامر البيع": "Manage and track all sales orders",
  "إضافة أمر بيع جديد": "Add new sales order",
  "البحث": "Search",
  "رقم الأمر، المرجع، اسم العميل...": "Order number, reference, customer name...",
  "الكل": "All",
  "الحالة": "Status",
  "مؤكد": "Confirmed",
  "تم التسليم": "Delivered",
  "مسودة": "Draft",
  "قيد الانتظار": "Pending",
  "ملغي": "Cancelled",
  "الإجراءات": "Actions",
  "عرض": "View",
  "تعديل": "Edit",
  "العودة للقائمة": "Back to list",
  "بيانات الأمر": "Order information",
  "بنود الأمر": "Order items",
  "ريال": "SAR",
  "المجموع الفرعي": "Subtotal",
  "تعديل أمر البيع": "Edit sales order",
  "حفظ التعديلات": "Save changes",
  "معلومات الأمر": "Order information",
  "رقم الفاتورة/الاستعراض": "Invoice/quotation number",
  "أدخل رقم الفاتورة": "Enter invoice number",
  "المستودع": "Warehouse",
  "اختر المستودع": "Select warehouse",
  "اسم العميل": "Customer name",
  "ملاحظات": "Notes",
  "أدخل أي ملاحظات إضافية": "Enter any additional notes",
  "تم تحديث أمر البيع": "Sales order updated",
  "الأمر": "Order",
  "تعذر تحديث أمر البيع": "Unable to update sales order",
  "يرجى المحاولة لاحقاً": "Please try again later",
  "إضافة صنف": "Add item",
  "البنود": "Items",
  "لا توجد بنود": "No items",
  "وصف المنتج": "Product description",
  "حذف": "Delete",
  "الخصم الكلي": "Total discount",
  "الإجمالي النهائي": "Grand total",
  "تم حفظ أمر البيع": "Sales order saved",
  "تعذر حفظ أمر البيع": "Unable to save sales order",
  "إلغاء": "Cancel",
  "حفظ الأمر": "Save order",
  "إنشاء أمر بيع جديد": "Create new sales order",
  "معلومات الأمر الأساسية": "Basic order information",
  "العرض المرجع": "Reference quotation",
  "المفتوحة فقط": "Open only",
  "اكتب رقم عرض السعر...": "Enter the quotation number...",
  "المخزن": "Warehouse",
  "اكتب اسم المخزن...": "Enter the warehouse name...",
  "تاريخ التسليم المتوقع": "Expected delivery date",
  "اكتب اسم العميل...": "Enter the customer name...",
  "ملاحظات...": "Notes...",
  "مرجع الأمر": "Order reference",
  "تلقائي": "Automatic",
  "إضافة بند": "Add item",
  "المجموع": "Total",
  "خصم": "Discount",
  "سعر الوحدة": "Unit price",
  "اختياري": "Optional",
  "اكتب وصف البند (اختياري)...": "Enter the item description (optional)...",
  "المجموع الكلي": "Grand total",
};

const statusLabelKeys: Record<string, string> = {
  confirmed: "مؤكد",
  delivered: "تم التسليم",
  draft: "مسودة",
  pending: "قيد الانتظار",
  cancelled: "ملغي",
  canceled: "ملغي",
};

function useSalesOrdersI18n() {
  const i18n = useI18n();
  return {
    ...i18n,
    t: (value: string) =>
      i18n.locale === "en"
        ? salesOrderTranslations[value] ?? i18n.t(value)
        : i18n.t(value),
  };
}

const getStatusLabel = (status: string, t: (value: string) => string) =>
  t(statusLabelKeys[status] ?? status);

const initialOrders: SalesOrder[] = [];

const parseCurrency = (value: string) => Number(value.replace(/[^0-9.]/g, "")) || 0;

const formatStoredTotal = (
  value: string,
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string,
  t: (value: string) => string
) => {
  if (!value || !/[0-9]/.test(value)) return value;
  return `${formatNumber(parseCurrency(value), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${t("ريال")}`;
};

const toNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

// تقريب لخانتين مطابق لـ round(x, 2) في القاعدة: نصف الهللة يُقرَّب بعيدًا عن الصفر،
// والضرب في 100 يُثبَّت أولًا حتى لا تُحوّل أخطاء الفاصلة العائمة 2.175 إلى 2.17
const round2 = (value: number) => {
  const rounded = Math.round(Number((Math.abs(value) * 100).toFixed(6))) / 100;
  return value < 0 ? -rounded : rounded;
};

const normalizeOrderItems = (value: unknown): OrderItem[] =>
  Array.isArray(value)
    ? value
        .filter((line) => line && typeof line === "object")
        .map((line: Record<string, unknown>, index: number) => ({
          id: toNumber(line.id) || index + 1,
          description: String(line.description ?? ""),
          quantity: toNumber(line.quantity),
          price: toNumber(line.price),
          discount: toNumber(line.discount),
          taxPercent: toNumber(line.taxPercent ?? SAUDI_STANDARD_VAT_RATE),
        }))
    : [];

// قراءة فقط: بنود الأوامر القديمة التي كانت تُحفظ في المتصفح قبل نقلها لقاعدة البيانات
const readLegacyOrderItems = (orderId: string): OrderItem[] => {
  try {
    return normalizeOrderItems(
      JSON.parse(localStorage.getItem(`sales-order-items-${orderId}`) || "null"),
    );
  } catch {
    return [];
  }
};

// بنود قاعدة البيانات أولًا، ثم نسخة المتصفح القديمة للأوامر السابقة فقط
const getOrderLines = (order: SalesOrder): { items: OrderItem[]; fromDb: boolean } => {
  if (Array.isArray(order.items) && order.items.length > 0) {
    return { items: order.items, fromDb: true };
  }
  return { items: readLegacyOrderItems(order.id), fromDb: false };
};

type LineAmounts = { quantity: number; price: number; discount: number; taxPercent: number };

const calcLine = (item: LineAmounts) => {
  const net = round2(toNumber(item.quantity) * toNumber(item.price) - toNumber(item.discount));
  const tax = round2((net * toNumber(item.taxPercent)) / 100);
  return { net, tax, total: round2(net + tax) };
};

type OrderTotals = { subtotal: number; discount: number; tax: number; total: number };

const calcOrderTotals = (lines: LineAmounts[]): OrderTotals =>
  lines.reduce<OrderTotals>(
    (acc, item) => {
      const line = calcLine(item);
      return {
        subtotal: round2(acc.subtotal + line.net),
        discount: round2(acc.discount + toNumber(item.discount)),
        tax: round2(acc.tax + line.tax),
        total: round2(acc.total + line.total),
      };
    },
    { subtotal: 0, discount: 0, tax: 0, total: 0 },
  );

// مجاميع قاعدة البيانات عند وجود بنود محفوظة فيها، وإلا نحسبها من بنود المتصفح القديمة
const getOrderTotals = (
  order: SalesOrder,
  lines: { items: OrderItem[]; fromDb: boolean },
): OrderTotals | null => {
  if (lines.fromDb) {
    return {
      subtotal: order.subtotal,
      discount: order.discountTotal,
      tax: order.taxTotal,
      total: order.grandTotal,
    };
  }
  return lines.items.length > 0 ? calcOrderTotals(lines.items) : null;
};

// نفس قيود الـ trigger حتى يرى المستخدم رسالة واضحة قبل رفض قاعدة البيانات
const hasInvalidLine = (lines: LineAmounts[]) =>
  lines.some((item) => {
    const quantity = toNumber(item.quantity);
    const price = toNumber(item.price);
    const discount = toNumber(item.discount);
    return !(quantity > 0) || price < 0 || discount < 0 || discount - quantity * price > 1e-9;
  });

// يُرسل للقاعدة الحقول المعتمدة فقط، والضريبة ثابتة 15% (S-03)
const toItemsPayload = (lines: Array<LineAmounts & { id: number; description: string }>) =>
  lines.map((item, index) => ({
    id: toNumber(item.id) || index + 1,
    description: String(item.description ?? ""),
    quantity: toNumber(item.quantity),
    price: toNumber(item.price),
    discount: toNumber(item.discount),
    taxPercent: SAUDI_STANDARD_VAT_RATE,
  }));

const mapSalesOrderRow = (row: Record<string, any>): SalesOrder => ({
  id: row.id ?? "",
  date: row.date ?? "",
  deliveryDate: row.delivery_date ?? row.deliveryDate ?? "",
  customer: row.customer ?? "",
  total: row.total ?? "",
  quotationId: row.quotation_id ?? row.quotationId ?? "",
  status: row.status ?? "confirmed",
  statusColor: statusColors[row.status ?? "confirmed"] ?? "bg-slate-600 text-white",
  subStatus: row.sub_status ?? row.subStatus,
  subStatusColor: row.sub_status_color ?? row.subStatusColor,
  items: normalizeOrderItems(row.items),
  warehouse: row.warehouse ?? "",
  notes: row.notes ?? "",
  subtotal: toNumber(row.subtotal),
  discountTotal: toNumber(row.discount_total),
  taxTotal: toNumber(row.tax_total),
  grandTotal: toNumber(row.grand_total),
});

export default function SalesOrders() {
  const { t, locale, direction, formatDate, formatNumber } = useSalesOrdersI18n();
  const [view, setView] = useState<"list" | "create" | "details" | "edit">("list");
  const [orders, setOrders] = useState<SalesOrder[]>(initialOrders);
  const [selectedOrder, setSelectedOrder] = useState<SalesOrder | null>(null);

  useEffect(() => {
    const loadOrders = async () => {
      const { data, error } = await supabase
        .from("sales_orders")
        .select("*")
        .order("date", { ascending: false });

      if (error) {
        toast({
          title: t("تعذر تحميل أوامر البيع"),
          description: error.message || t("يرجى المحاولة لاحقاً"),
          variant: "destructive",
        });
        return;
      }
      if (data) {
        setOrders(data.map(mapSalesOrderRow));
      }
    };

    loadOrders();
  }, []);

  const handleSaved = (order: SalesOrder) => {
    setOrders((prev) => [order, ...prev]);
  };

  const handleUpdated = (order: SalesOrder) => {
    setOrders((prev) => prev.map((row) => (row.id === order.id ? order : row)));
  };

  const handleDownloadPdf = (order: SalesOrder) => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      return;
    }

    // بنود قاعدة البيانات أولًا؛ لا نخترع بنودًا عند غيابها
    const lines = getOrderLines(order);
    const totals = getOrderTotals(order, lines);
    const money = (value: number) =>
      formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const totalText = totals
      ? `${money(totals.total)} ${t("ريال")}`
      : formatStoredTotal(order.total, formatNumber, t);

    const rowsHtml =
      lines.items.length > 0
        ? lines.items
            .map((item, index) => {
              const line = calcLine(item);
              return `<tr>
          <td>${formatNumber(index + 1)}</td>
          <td>${escapeHtml(item.description || "-")}</td>
          <td>${formatNumber(item.quantity)}</td>
          <td>${money(item.price)}</td>
          <td>${money(item.discount)}</td>
          <td>${formatNumber(item.taxPercent)}%</td>
          <td>${money(line.total)}</td>
        </tr>`;
            })
            .join("")
        : `<tr><td colspan="7" style="text-align:center">${escapeHtml(t("لا توجد بنود"))}</td></tr>`;

    const totalsHtml = totals
      ? `<table class="totals">
              <tbody>
                <tr><th>${t("المجموع الفرعي")}</th><td>${money(totals.subtotal)} ${t("ريال")}</td></tr>
                <tr><th>${t("الخصم")}</th><td>${money(totals.discount)} ${t("ريال")}</td></tr>
                <tr><th>${t("الضريبة")}</th><td>${money(totals.tax)} ${t("ريال")}</td></tr>
                <tr><th>${t("الإجمالي")}</th><td><strong>${money(totals.total)} ${t("ريال")}</strong></td></tr>
              </tbody>
            </table>`
      : "";

    printWindow.document.write(`
      <html dir="${direction}" lang="${locale}">
        <head>
          <title>${t("أمر بيع")} ${escapeHtml(order.id)}</title>
          <meta charset="utf-8" />
          <style>
            body { font-family: 'Cairo', Arial, sans-serif; margin:0; padding:24px; color:#0f172a; }
            .page { border:1px solid #e2e8f0; padding:20px; }
            .header { display:flex; justify-content:space-between; border-bottom:1px solid #e2e8f0; padding-bottom:10px; margin-bottom:12px; }
            .title { font-size:26px; font-weight:700; }
            .meta { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:14px; }
            .card { border:1px solid #e2e8f0; padding:10px; border-radius:8px; }
            .label { color:#64748b; font-size:12px; }
            .value { font-weight:700; font-size:15px; }
            table { width:100%; border-collapse:collapse; }
            th, td { border:1px solid #e2e8f0; padding:8px; text-align:${direction === "rtl" ? "right" : "left"}; font-size:13px; }
            th { background:#f1f5f9; }
            .totals { width:320px; margin-top:14px; margin-${direction === "rtl" ? "right" : "left"}:auto; }
            .notes { white-space:pre-wrap; }
          </style>
        </head>
        <body>
          <div class="page">
            <div class="header">
              <div class="title">${t("تفاصيل أمر البيع")}</div>
              <div>${t("رقم الأمر")}: ${escapeHtml(order.id)}</div>
            </div>
            <div class="meta">
              <div class="card"><div class="label">${t("العميل")}</div><div class="value">${escapeHtml(order.customer || "-")}</div></div>
              <div class="card"><div class="label">${t("رقم عرض السعر")}</div><div class="value">${escapeHtml(order.quotationId || "-")}</div></div>
              <div class="card"><div class="label">${t("تاريخ الأمر")}</div><div class="value">${escapeHtml(order.date ? formatDate(order.date) : "-")}</div></div>
              <div class="card"><div class="label">${t("تاريخ التسليم")}</div><div class="value">${escapeHtml(order.deliveryDate ? formatDate(order.deliveryDate) : "-")}</div></div>
              <div class="card"><div class="label">${t("الحالة")}</div><div class="value">${escapeHtml(getStatusLabel(order.status, t))}</div></div>
              <div class="card"><div class="label">${t("الإجمالي")}</div><div class="value">${escapeHtml(totalText)}</div></div>
              <div class="card"><div class="label">${t("المستودع")}</div><div class="value">${escapeHtml(order.warehouse || "-")}</div></div>
              <div class="card"><div class="label">${t("ملاحظات")}</div><div class="value notes">${escapeHtml(order.notes || "-")}</div></div>
            </div>
            <table>
              <thead>
                <tr><th>#</th><th>${t("وصف البند")}</th><th>${t("الكمية")}</th><th>${t("السعر")}</th><th>${t("الخصم")}</th><th>${t("الضريبة")}</th><th>${t("الإجمالي")}</th></tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>
            ${totalsHtml}
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  return (
    <Layout subMenu={{ title: t("المبيعات"), items: salesFeatures }}>
      <div className="mx-auto max-w-7xl">
        {view === "list" && (
          <OrdersList
            onCreateClick={() => setView("create")}
            onView={(order) => {
              setSelectedOrder(order);
              setView("details");
            }}
            onEdit={(order) => {
              setSelectedOrder(order);
              setView("edit");
            }}
            onDownloadPdf={handleDownloadPdf}
            orders={orders}
          />
        )}
        {view === "create" && (
          <OrderForm onBack={() => setView("list")} onSaved={handleSaved} />
        )}
        {view === "details" && selectedOrder && (
          <OrderDetails order={selectedOrder} onBack={() => setView("list")} />
        )}
        {view === "edit" && selectedOrder && (
          <OrderEdit
            order={selectedOrder}
            onBack={() => setView("list")}
            onUpdated={handleUpdated}
          />
        )}
      </div>
    </Layout>
  );
}

function OrdersList({
  onCreateClick,
  onView,
  onEdit,
  onDownloadPdf,
  orders,
}: {
  onCreateClick: () => void;
  onView: (order: SalesOrder) => void;
  onEdit: (order: SalesOrder) => void;
  onDownloadPdf: (order: SalesOrder) => void;
  orders: SalesOrder[];
}) {
  const { t, direction, formatDate, formatNumber } = useSalesOrdersI18n();
  // فلترة فعلية بدل حقول البحث التي لم تكن موصولة
  const [search, setSearch] = useState("");
  const [customerFilter, setCustomerFilter] = useState("الكل");
  const [statusFilter, setStatusFilter] = useState("");
  const customerNames = useMemo(
    () => Array.from(new Set(orders.map((order) => order.customer).filter(Boolean))),
    [orders],
  );
  const filteredOrders = orders.filter((order) => {
    const term = search.trim().toLowerCase();
    return (
      (!term ||
        `${order.id} ${order.customer} ${order.quotationId ?? ""}`
          .toLowerCase()
          .includes(term)) &&
      (customerFilter === "الكل" || order.customer === customerFilter) &&
      (!statusFilter || order.status === statusFilter)
    );
  });

  return (
    <div className="space-y-6" dir={direction}>
      <PageHeader
        icon={ShoppingCart}
        title={t("أوامر البيع")}
        subtitle={t("إدارة وتتبع جميع أوامر البيع")}
        actionLabel={t("إضافة أمر بيع جديد")}
        onAction={onCreateClick}
        gradient="from-indigo-600 to-violet-700"
      />

      <FilterBar>
        <FilterInput label={t("البحث")} placeholder={t("رقم الأمر، المرجع، اسم العميل...")} colSpan={2} value={search} onChange={setSearch} />
        <FilterSelect label={t("العميل")} options={["الكل", ...customerNames]} value={customerFilter} onChange={setCustomerFilter} />
        <FilterSelect label={t("الحالة")} value={statusFilter} onChange={setStatusFilter}>
          <option value="">الكل</option>
          <option value="confirmed">مؤكد</option>
          <option value="delivered">تم التسليم</option>
        </FilterSelect>
        <FilterActions onReset={() => { setSearch(""); setCustomerFilter("الكل"); setStatusFilter(""); }} />
      </FilterBar>

      <DataTable
        headers={["الإجراءات", "الحالة", "رقم عرض السعر", "الإجمالي", "العميل", "تاريخ التسليم", "تاريخ الأمر", "رقم الأمر"].map(t)}
        gradient="from-[#1e293b] to-[#334155]"
      >
        {filteredOrders.map((order, i) => (
          <tr key={order.id} className={cn("hover:bg-muted/30 transition-colors", i % 2 !== 0 && "bg-muted/10")}>
            <td className="px-5 py-3.5 align-middle">
              <div className="flex items-center gap-1.5 flex-wrap">
                <ActionBtn icon={Eye} label={t("عرض")} color="blue" onClick={() => onView(order)} />
                <ActionBtn icon={Edit} label={t("تعديل")} color="emerald" onClick={() => onEdit(order)} />
                <ActionBtn icon={Download} label="PDF" color="slate" onClick={() => onDownloadPdf(order)} />
              </div>
            </td>
            <td className="px-5 py-3.5 align-middle text-start space-y-1">
              <span className="inline-flex items-center gap-1 rounded-full border px-3 py-0.5 text-[11px] font-bold whitespace-nowrap bg-slate-50 text-slate-700 border-slate-200">
                {getStatusLabel(order.status, t)}
              </span>
              {order.subStatus && (
                <span className={cn("inline-flex items-center gap-1 rounded-full border px-3 py-0.5 text-[11px] font-bold whitespace-nowrap block mt-1", order.subStatusColor)}>
                  {getStatusLabel(order.subStatus, t)}
                </span>
              )}
            </td>
            <td className="px-5 py-3.5 align-middle text-start text-primary hover:underline cursor-pointer font-medium">
              {order.quotationId}
            </td>
            <td className="px-5 py-3.5 align-middle text-start whitespace-nowrap font-bold text-primary">
              {formatStoredTotal(order.total, formatNumber, t)}
            </td>
            <td className="px-5 py-3.5 align-middle text-start text-foreground font-medium">
              {order.customer}
            </td>
            <td className="px-5 py-3.5 align-middle text-start text-muted-foreground text-[13px]">
              {order.deliveryDate ? formatDate(order.deliveryDate) : "-"}
            </td>
            <td className="px-5 py-3.5 align-middle text-start text-muted-foreground text-[13px]">
              {order.date ? formatDate(order.date) : "-"}
            </td>
            <td className="px-5 py-3.5 align-middle text-start font-bold text-primary hover:underline cursor-pointer">
              {order.id}
            </td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}

function OrderDetails({
  order,
  onBack,
}: {
  order: SalesOrder;
  onBack: () => void;
}) {
  const { t, direction, formatDate, formatNumber } = useSalesOrdersI18n();
  // بنود قاعدة البيانات أولًا ثم نسخة المتصفح للأوامر القديمة؛ لا نخترع بنودًا عند غيابها
  const lines = useMemo(() => getOrderLines(order), [order]);
  const items = lines.items;
  const totals = getOrderTotals(order, lines);
  const money = (value: number) =>
    formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="space-y-6 pb-12" dir={direction}>
      <div className="flex justify-between items-center rounded-2xl bg-white border border-border/50 shadow-sm px-6 py-4 animate-fade-in-up">
        <button
          onClick={onBack}
          className="px-5 py-2.5 rounded-xl border-2 border-border/60 bg-white text-sm font-semibold text-muted-foreground hover:bg-muted/30 transition-all flex items-center gap-2"
        >
          {t("العودة للقائمة")}
          <ArrowLeftRight className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-extrabold text-foreground">{t("تفاصيل أمر البيع")}</h1>
          <ShoppingCart className="h-5 w-5 text-blue-600" />
        </div>
      </div>

      <div className="p-4 space-y-6">
        <div className="rounded-2xl bg-white border border-border/50 shadow-sm overflow-hidden animate-fade-in-up">
          <div className="px-6 py-4 border-b border-border/40 bg-muted/20">
            <h2 className="text-sm font-bold text-foreground text-start">{t("بيانات الأمر")}</h2>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-1"><label className="text-[12px] font-semibold text-muted-foreground block text-start">{t("رقم الأمر")}</label><div className="text-start font-semibold">{order.id}</div></div>
            <div className="space-y-1"><label className="text-[12px] font-semibold text-muted-foreground block text-start">{t("العميل")}</label><div className="text-start font-semibold">{order.customer}</div></div>
            <div className="space-y-1"><label className="text-[12px] font-semibold text-muted-foreground block text-start">{t("تاريخ الأمر")}</label><div className="text-start font-semibold">{order.date ? formatDate(order.date) : "-"}</div></div>
            <div className="space-y-1"><label className="text-[12px] font-semibold text-muted-foreground block text-start">{t("تاريخ التسليم")}</label><div className="text-start font-semibold">{order.deliveryDate ? formatDate(order.deliveryDate) : "-"}</div></div>
            <div className="space-y-1"><label className="text-[12px] font-semibold text-muted-foreground block text-start">{t("رقم عرض السعر")}</label><div className="text-start font-semibold">{order.quotationId || "-"}</div></div>
            <div className="space-y-1"><label className="text-[12px] font-semibold text-muted-foreground block text-start">{t("الإجمالي")}</label><div className="text-start font-semibold">{totals ? `${money(totals.total)} ${t("ريال")}` : formatStoredTotal(order.total, formatNumber, t)}</div></div>
            <div className="space-y-1"><label className="text-[12px] font-semibold text-muted-foreground block text-start">{t("المستودع")}</label><div className="text-start font-semibold">{order.warehouse || "-"}</div></div>
            <div className="space-y-1 md:col-span-2"><label className="text-[12px] font-semibold text-muted-foreground block text-start">{t("ملاحظات")}</label><div className="text-start font-semibold whitespace-pre-wrap">{order.notes || "-"}</div></div>
          </div>
        </div>

        <div className="rounded-2xl bg-white border border-border/50 shadow-sm overflow-hidden animate-fade-in-up">
          <div className="px-6 py-4 border-b border-border/40 bg-muted/20">
            <h2 className="text-sm font-bold text-foreground text-start">{t("بنود الأمر")}</h2>
          </div>
          <div className="p-4 overflow-x-auto">
            <table className="w-full text-sm text-start">
              <thead className="bg-slate-100">
                <tr>
                  <th className="px-3 py-2 border border-slate-200">#</th>
                  <th className="px-3 py-2 border border-slate-200">{t("وصف البند")}</th>
                  <th className="px-3 py-2 border border-slate-200">{t("الكمية")}</th>
                  <th className="px-3 py-2 border border-slate-200">{t("السعر")}</th>
                  <th className="px-3 py-2 border border-slate-200">{t("الخصم")}</th>
                  <th className="px-3 py-2 border border-slate-200">{t("الضريبة")}</th>
                  <th className="px-3 py-2 border border-slate-200">{t("الإجمالي")}</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 border border-slate-200 text-center text-muted-foreground">
                      {t("لا توجد بنود")}
                    </td>
                  </tr>
                ) : (
                  items.map((item, index) => (
                    <tr key={`${item.id}-${index}`}>
                      <td className="px-3 py-2 border border-slate-200">{formatNumber(index + 1)}</td>
                      <td className="px-3 py-2 border border-slate-200">{item.description || "-"}</td>
                      <td className="px-3 py-2 border border-slate-200">{formatNumber(item.quantity)}</td>
                      <td className="px-3 py-2 border border-slate-200">{money(item.price)}</td>
                      <td className="px-3 py-2 border border-slate-200">{money(item.discount)}</td>
                      <td className="px-3 py-2 border border-slate-200">{formatNumber(item.taxPercent)}%</td>
                      <td className="px-3 py-2 border border-slate-200">{money(calcLine(item).total)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {totals && (
              <div className="border-t border-slate-200 pt-4 flex justify-end mt-6">
                <div className="w-72 space-y-2 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-bold text-foreground">{money(totals.subtotal)} {t("ريال")}</span>
                    <span className="text-slate-600">{t("المجموع الفرعي")}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-bold text-foreground">{money(totals.discount)} {t("ريال")}</span>
                    <span className="text-slate-600">{t("الخصم")}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-bold text-foreground">{money(totals.tax)} {t("ريال")}</span>
                    <span className="text-slate-600">{t("الضريبة")}</span>
                  </div>
                  <div className="flex justify-between items-center pt-2 border-t border-slate-200">
                    <span className="font-bold text-blue-600">{money(totals.total)} {t("ريال")}</span>
                    <span className="font-bold text-slate-800">{t("الإجمالي")}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function OrderEdit({
  order,
  onBack,
  onUpdated,
}: {
  order: SalesOrder;
  onBack: () => void;
  onUpdated: (order: SalesOrder) => void;
}) {
  const { t, direction, formatNumber } = useSalesOrdersI18n();
  const [deliveryDate, setDeliveryDate] = useState(order.deliveryDate);
  const [orderDate, setOrderDate] = useState(order.date);
  const [customer, setCustomer] = useState(order.customer);
  const [quotationId, setQuotationId] = useState(order.quotationId || "");
  const [warehouse, setWarehouse] = useState(order.warehouse ?? "");
  const [notes, setNotes] = useState(order.notes ?? "");
  // بنود قاعدة البيانات أولًا، ثم نسخة المتصفح القديمة (قراءة فقط) للأوامر السابقة
  const [initialLines] = useState(() => getOrderLines(order));
  const hasSavedLines = initialLines.items.length > 0;
  const [items, setItems] = useState<OrderItem[]>(() =>
    hasSavedLines
      ? initialLines.items.map((line, index) => ({
          id: index + 1,
          description: line.description,
          quantity: line.quantity,
          price: line.price,
          discount: line.discount,
          taxPercent: SAUDI_STANDARD_VAT_RATE,
        }))
      : [
          {
            id: 1,
            description: "",
            quantity: 1,
            price: 0,
            discount: 0,
            taxPercent: SAUDI_STANDARD_VAT_RATE,
          },
        ],
  );

  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      {
        // رقم بند لا يتكرر بعد حذف بنود سابقة
        id: prev.reduce((max, line) => Math.max(max, Number(line.id) || 0), 0) + 1,
        description: "",
        quantity: 1,
        price: 0,
        discount: 0,
        taxPercent: SAUDI_STANDARD_VAT_RATE,
      },
    ]);
  };

  const updateItem = (id: number, changes: Partial<(typeof items)[number]>) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...changes } : item))
    );
  };

  const removeItem = (id: number) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const totals = calcOrderTotals(items);

  const handleSave = async () => {
    // لا نسمح بتصفير إجمالي أمر موجود
    if (!(totals.total > 0)) {
      toast({
        title: t("لا يمكن حفظ أمر بإجمالي صفر"),
        description: hasSavedLines
          ? t("أضف بنود الأمر بأسعارها قبل الحفظ")
          : t("بنود هذا الأمر غير محفوظة؛ أعد إدخالها كاملة قبل الحفظ"),
        variant: "destructive",
      });
      return;
    }
    if (hasInvalidLine(items)) {
      toast({
        title: t("تحقق من بنود الأمر"),
        description: t(
          "الكمية يجب أن تكون أكبر من صفر، والسعر والخصم غير سالبين، والخصم لا يتجاوز قيمة البند",
        ),
        variant: "destructive",
      });
      return;
    }
    // المجاميع وعمود total تحسبها قاعدة البيانات من items
    const payload = {
      date: orderDate,
      delivery_date: deliveryDate,
      customer,
      quotation_id: quotationId,
      items: toItemsPayload(items),
      warehouse,
      notes,
    };

    const { data, error } = await supabase
      .from("sales_orders")
      .update(payload)
      .eq("id", order.id)
      .select()
      .single();

    if (!error && data) {
      onUpdated(mapSalesOrderRow(data));
      toast({ title: t("تم تحديث أمر البيع"), description: `${t("الأمر")}: ${order.id}` });
      onBack();
    } else {
      toast({
        title: t("تعذر تحديث أمر البيع"),
        description: error?.message || t("يرجى المحاولة لاحقاً"),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6 pb-12" dir={direction}>
      <div className="flex justify-between items-center rounded-2xl bg-white border border-border/50 shadow-sm px-6 py-4 animate-fade-in-up">
        <button
          onClick={onBack}
          className="px-5 py-2.5 rounded-xl border-2 border-border/60 bg-white text-sm font-semibold text-muted-foreground hover:bg-muted/30 transition-all flex items-center gap-2"
        >
          {t("العودة للقائمة")}
          <ArrowLeftRight className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-extrabold text-foreground">{t("تعديل أمر البيع")}</h1>
          <Edit className="h-5 w-5 text-emerald-600" />
        </div>
        <button
          onClick={handleSave}
          className="px-5 py-2.5 rounded-xl bg-gradient-to-l from-emerald-600 to-emerald-500 text-sm font-bold text-white shadow-md shadow-emerald-500/20 hover:shadow-lg transition-all"
        >
          {t("حفظ التعديلات")}
        </button>
      </div>

      <div className="p-4 space-y-6">
        <div className="rounded-2xl bg-white border border-border/50 shadow-sm overflow-hidden animate-fade-in-up">
          <div className="px-6 py-4 border-b border-border/40 bg-muted/20">
            <h2 className="text-sm font-bold text-foreground text-start">{t("معلومات الأمر")}</h2>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-1">
              <label className="text-[12px] font-semibold text-muted-foreground block text-start">{t("رقم الفاتورة/الاستعراض")}</label>
              <input
                type="text"
                value={quotationId}
                onChange={(event) => setQuotationId(event.target.value)}
                placeholder={t("أدخل رقم الفاتورة")}
                className="w-full px-3 py-2 border border-border/60 rounded-xl text-sm text-start focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[12px] font-semibold text-muted-foreground block text-start">{t("المستودع")}</label>
              <input
                type="text"
                value={warehouse}
                onChange={(event) => setWarehouse(event.target.value)}
                placeholder={t("اختر المستودع")}
                className="w-full px-3 py-2 border border-border/60 rounded-xl text-sm text-start focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[12px] font-semibold text-muted-foreground block text-start">{t("تاريخ الأمر")}</label>
              <input
                type="date"
                value={orderDate}
                onChange={(event) => setOrderDate(event.target.value)}
                className="w-full px-3 py-2 border border-border/60 rounded-xl text-sm text-start focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[12px] font-semibold text-muted-foreground block text-start">{t("تاريخ التسليم")}</label>
              <input
                type="date"
                value={deliveryDate}
                onChange={(event) => setDeliveryDate(event.target.value)}
                className="w-full px-3 py-2 border border-border/60 rounded-xl text-sm text-start focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-[12px] font-semibold text-muted-foreground block text-start">{t("العميل")}</label>
              <input
                type="text"
                value={customer}
                onChange={(event) => setCustomer(event.target.value)}
                placeholder={t("اسم العميل")}
                className="w-full px-3 py-2 border border-border/60 rounded-xl text-sm text-start focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-[12px] font-semibold text-muted-foreground block text-start">{t("ملاحظات")}</label>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder={t("أدخل أي ملاحظات إضافية")}
                rows={3}
                className="w-full px-3 py-2 border border-border/60 rounded-xl text-sm text-start focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all resize-none"
              />
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-white border border-border/50 shadow-sm overflow-hidden animate-fade-in-up">
          <div className="px-6 py-4 border-b border-border/40 bg-muted/20 flex items-center justify-between">
            <button
              onClick={handleAddItem}
              className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-600 hover:bg-blue-100 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              {t("إضافة صنف")}
            </button>
            <h2 className="text-sm font-bold text-foreground text-start">{t("البنود")}</h2>
          </div>
          <div className="p-6">
            {items.length === 0 ? (
              <div className="text-center text-muted-foreground text-sm py-6">{t("لا توجد بنود")}</div>
            ) : (
              <div className="space-y-4">
                {items.map((item) => (
                  <div key={item.id} className="border border-border/50 rounded-xl p-4 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="md:col-span-2 space-y-1">
                        <label className="text-[12px] font-semibold text-muted-foreground block text-start">{t("وصف البند")}</label>
                        <input
                          type="text"
                          value={item.description}
                          onChange={(e) => updateItem(item.id, { description: e.target.value })}
                          placeholder={t("وصف المنتج")}
                          className="w-full px-3 py-2 border border-border/60 rounded-xl text-sm text-start focus:ring-2 focus:ring-primary/20 outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[12px] font-semibold text-muted-foreground block text-start">{t("الكمية")}</label>
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={(e) => updateItem(item.id, { quantity: Number(e.target.value) })}
                          min="1"
                          className="w-full px-3 py-2 border border-border/60 rounded-xl text-sm text-start focus:ring-2 focus:ring-primary/20 outline-none"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="space-y-1">
                        <label className="text-[12px] font-semibold text-muted-foreground block text-start">{t("السعر")}</label>
                        <input
                          type="number"
                          value={item.price}
                          onChange={(e) => updateItem(item.id, { price: Number(e.target.value) })}
                          min="0"
                          className="w-full px-3 py-2 border border-border/60 rounded-xl text-sm text-start focus:ring-2 focus:ring-primary/20 outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[12px] font-semibold text-muted-foreground block text-start">{t("الخصم")}</label>
                        <input
                          type="number"
                          value={item.discount}
                          onChange={(e) => updateItem(item.id, { discount: Number(e.target.value) })}
                          min="0"
                          className="w-full px-3 py-2 border border-border/60 rounded-xl text-sm text-start focus:ring-2 focus:ring-primary/20 outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[12px] font-semibold text-muted-foreground block text-start">{t("الضريبة")} %</label>
                        {/* النسبة ثابتة 15% مثل الفواتير (S-03) */}
                        <input
                          type="text"
                          value={`${SAUDI_STANDARD_VAT_RATE}%`}
                          readOnly
                          disabled
                          title={t("نسبة ضريبة القيمة المضافة الأساسية")}
                          className="w-full px-3 py-2 border border-border/40 bg-muted/30 rounded-xl text-sm text-start outline-none"
                        />
                      </div>
                      <div className="flex items-end">
                        <button
                          onClick={() => removeItem(item.id)}
                          className="w-full px-3 py-2 rounded-lg border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 transition-colors text-xs font-semibold"
                        >
                          {t("حذف")}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl bg-white border border-border/50 shadow-sm overflow-hidden animate-fade-in-up">
          <div className="px-6 py-4 border-b border-border/40 bg-muted/20">
            <h2 className="text-sm font-bold text-foreground text-start">{t("الإجمالي")}</h2>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-start">
              <div>
                <p className="text-[12px] text-muted-foreground mb-1">{t("المجموع الفرعي")}</p>
                <p className="text-lg font-bold text-foreground">{t("ريال")} {formatNumber(totals.subtotal, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              </div>
              <div>
                <p className="text-[12px] text-muted-foreground mb-1">{t("الخصم الكلي")}</p>
                <p className="text-lg font-bold text-red-600">{t("ريال")} {formatNumber(totals.discount, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              </div>
              <div>
                <p className="text-[12px] text-muted-foreground mb-1">{t("الضريبة")}</p>
                <p className="text-lg font-bold text-orange-600">{t("ريال")} {formatNumber(totals.tax, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              </div>
              <div>
                <p className="text-[12px] text-muted-foreground mb-1">{t("الإجمالي النهائي")}</p>
                <p className="text-lg font-bold text-blue-600">{t("ريال")} {formatNumber(totals.total, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function OrderForm({
  onBack,
  onSaved,
}: {
  onBack: () => void;
  onSaved: (order: SalesOrder) => void;
}) {
  const { t, direction, formatNumber } = useSalesOrdersI18n();
  const [quotationId, setQuotationId] = useState("");
  const [warehouse, setWarehouse] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(() => riyadhDateString(7));
  const [orderDate, setOrderDate] = useState(() => riyadhDateString());
  const [customer, setCustomer] = useState("");
  const [notes, setNotes] = useState("");
  const saveInFlight = useRef(false);
  const [items, setItems] = useState<OrderItem[]>([
    {
      id: 1,
      description: "",
      quantity: 1,
      price: 0,
      discount: 0,
      taxPercent: SAUDI_STANDARD_VAT_RATE,
    },
  ]);

  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      {
        // رقم بند لا يتكرر بعد حذف بنود سابقة
        id: prev.reduce((max, line) => Math.max(max, Number(line.id) || 0), 0) + 1,
        description: "",
        quantity: 1,
        price: 0,
        discount: 0,
        taxPercent: SAUDI_STANDARD_VAT_RATE,
      },
    ]);
  };

  const updateItem = (id: number, changes: Partial<(typeof items)[number]>) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...changes } : item))
    );
  };

  const removeItem = (id: number) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const totals = calcOrderTotals(items);

  const handleSave = async () => {
    // منع إنشاء أمرين عند النقر المزدوج، ومنع حفظ أمر بلا عميل أو بإجمالي صفر
    if (saveInFlight.current) return;
    if (!customer.trim() || !(totals.total > 0)) {
      toast({
        title: t("بيانات الأمر غير مكتملة"),
        description: t("اختر العميل وأضف بندًا واحدًا على الأقل بقيمة أكبر من صفر"),
        variant: "destructive",
      });
      return;
    }
    if (hasInvalidLine(items)) {
      toast({
        title: t("تحقق من بنود الأمر"),
        description: t(
          "الكمية يجب أن تكون أكبر من صفر، والسعر والخصم غير سالبين، والخصم لا يتجاوز قيمة البند",
        ),
        variant: "destructive",
      });
      return;
    }
    saveInFlight.current = true;
    try {
      // رقم أمر البيع لكل منشأة: 1001-SO-000001 (يُحجز عند الحفظ)
      const orderId = await nextCompanyNumber("SO", 6);
      // البنود تُحفظ في قاعدة البيانات؛ المجاميع وعمود total يحسبها الـ trigger
      const payload = {
        id: orderId,
        date: orderDate,
        delivery_date: deliveryDate,
        customer,
        total: `ريال ${totals.total.toFixed(2)}`,
        quotation_id: quotationId,
        status: "confirmed",
        items: toItemsPayload(items),
        warehouse,
        notes,
      };

      const { data, error } = await supabase
        .from("sales_orders")
        .insert(payload)
        .select()
        .single();

      if (!error && data) {
        const saved = mapSalesOrderRow(data);
        onSaved(saved);
        toast({ title: t("تم حفظ أمر البيع"), description: `${t("الأمر")}: ${saved.id || orderId}` });
        onBack();
      } else {
        toast({
          title: t("تعذر حفظ أمر البيع"),
          description: error?.message || t("يرجى المحاولة لاحقاً"),
          variant: "destructive",
        });
      }
    } catch (err) {
      toast({
        title: t("تعذر حفظ أمر البيع"),
        description: (err as Error)?.message || t("يرجى المحاولة لاحقاً"),
        variant: "destructive",
      });
    } finally {
      saveInFlight.current = false;
    }
  };

  return (
    <div className="space-y-6 pb-12" dir={direction}>
      <div className="flex justify-between items-center rounded-2xl bg-white border border-border/50 shadow-sm px-6 py-4 animate-fade-in-up">
        <div className="flex gap-2">
          <button
            onClick={onBack}
            className="px-5 py-2.5 rounded-xl border-2 border-border/60 bg-white text-sm font-semibold text-foreground hover:bg-muted/30 transition-all flex items-center gap-1"
          >
            <X className="h-4 w-4" />
            {t("إلغاء")}
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-l from-blue-600 to-blue-500 text-sm font-bold text-white shadow-md shadow-blue-500/20 hover:shadow-lg transition-all flex items-center gap-2"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"
              />
            </svg>
            {t("حفظ الأمر")}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-extrabold text-foreground">{t("إنشاء أمر بيع جديد")}</h1>
          <ShoppingCart className="h-5 w-5 text-blue-600" />
        </div>
        <button
          onClick={onBack}
          className="px-5 py-2.5 rounded-xl border-2 border-border/60 bg-white text-sm font-semibold text-muted-foreground hover:bg-muted/30 transition-all flex items-center gap-2"
        >
          {t("العودة للقائمة")}
          <ArrowLeftRight className="h-4 w-4" />
        </button>
      </div>

      <div className="p-4 space-y-6">
        <div className="rounded-2xl bg-white border border-border/50 shadow-sm overflow-hidden animate-fade-in-up">
          <div className="px-6 py-4 border-b border-border/40 bg-muted/20 flex items-center justify-end gap-2">
            <h2 className="text-sm font-bold text-foreground">{t("معلومات الأمر الأساسية")}</h2>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="space-y-1">
              <label className="text-[12px] font-semibold text-muted-foreground text-start block">
                {t("العرض المرجع")} <span className="text-slate-400 font-normal">({t("المفتوحة فقط")})</span>
              </label>
              <input
                type="text"
                value={quotationId}
                onChange={(event) => setQuotationId(event.target.value)}
                placeholder={t("اكتب رقم عرض السعر...")}
                className="w-full px-3 py-2 border border-border/60 rounded-xl text-sm text-start focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[12px] font-semibold text-muted-foreground text-start block">
                {t("المخزن")} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={warehouse}
                onChange={(event) => setWarehouse(event.target.value)}
                placeholder={t("اكتب اسم المخزن...")}
                className="w-full px-3 py-2 border border-border/60 rounded-xl text-sm text-start focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[12px] font-semibold text-muted-foreground text-start block">
                {t("تاريخ التسليم المتوقع")}
              </label>
              <input
                type="date"
                value={deliveryDate}
                onChange={(event) => setDeliveryDate(event.target.value)}
                className="w-full px-3 py-2 border border-border/60 rounded-xl text-sm text-start focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[12px] font-semibold text-muted-foreground text-start block">
                {t("تاريخ الأمر")} <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={orderDate}
                onChange={(event) => setOrderDate(event.target.value)}
                className="w-full px-3 py-2 border border-border/60 rounded-xl text-sm text-start focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
              />
            </div>

            <div className="space-y-1 md:col-span-4">
              <label className="text-[12px] font-semibold text-muted-foreground text-start block">
                {t("العميل")} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={customer}
                onChange={(event) => setCustomer(event.target.value)}
                placeholder={t("اكتب اسم العميل...")}
                className="w-full px-3 py-2 border border-border/60 rounded-xl text-sm text-start focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
              />
            </div>

            <div className="space-y-1 md:col-span-3">
              <label className="text-[12px] font-semibold text-muted-foreground text-start block">
                {t("ملاحظات")}
              </label>
              <input
                type="text"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder={t("ملاحظات...")}
                className="w-full px-3 py-2 border border-border/60 rounded-xl text-sm text-start focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
              />
            </div>

            <div className="space-y-1 md:col-start-4">
              <label className="text-[12px] font-semibold text-muted-foreground text-start block">
                {t("مرجع الأمر")}
              </label>
              <input
                type="text"
                placeholder={t("تلقائي")}
                disabled
                className="w-full px-3 py-2 border border-slate-300 bg-slate-50 rounded text-sm text-start outline-none text-slate-500"
              />
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-white border border-border/50 shadow-sm overflow-hidden animate-fade-in-up">
          <div className="px-6 py-4 border-b border-border/40 bg-muted/20 flex items-center justify-between">
            <button
              onClick={handleAddItem}
              className="rounded-xl bg-gradient-to-l from-emerald-600 to-emerald-500 px-4 py-2 text-[12px] font-bold text-white shadow-sm shadow-emerald-500/20 hover:shadow-md transition-all flex items-center gap-1.5"
            >
              <Plus className="h-4 w-4" />
              {t("إضافة بند")}
            </button>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-foreground">{t("بنود الأمر")}</h2>
            </div>
          </div>
          <div className="p-4 overflow-x-auto">
            <table dir="ltr" className="w-full text-sm mb-4 [&_th]:[direction:rtl] [&_td]:[direction:rtl] [&_th]:text-right [&_td]:text-right">
              <thead>
                <tr className="text-slate-600 border-b border-slate-200">
                  <th className="pb-2 font-medium w-16 text-center"></th>
                  <th className="pb-2 font-medium w-24">{t("المجموع")}</th>
                  <th className="pb-2 font-medium w-24">{t("الضريبة")}</th>
                  <th className="pb-2 font-medium w-20">{t("خصم")}</th>
                  <th className="pb-2 font-medium w-24">{t("السعر")} *</th>
                  <th className="pb-2 font-medium w-20">{t("الكمية")} *</th>
                  <th className="pb-2 font-medium">{t("وصف البند")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const lineTotal = calcLine(item).total;

                  return (
                    <tr key={item.id}>
                      <td className="pt-4 align-top">
                        <div className="flex items-center justify-center gap-1 h-10">
                          <button
                            onClick={() => removeItem(item.id)}
                            className="w-8 h-8 flex items-center justify-center bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                      <td className="pt-4 px-1 align-top">
                        <input
                          type="text"
                          value={formatNumber(lineTotal, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          disabled
                          className="w-full px-2 py-2 border border-border/40 bg-muted/30 rounded-xl text-sm text-start outline-none h-10"
                        />
                      </td>
                      <td className="pt-4 px-1 align-top">
                        {/* النسبة ثابتة 15% مثل الفواتير (S-03) */}
                        <input
                          type="text"
                          value={`${SAUDI_STANDARD_VAT_RATE}%`}
                          readOnly
                          disabled
                          title={t("نسبة ضريبة القيمة المضافة الأساسية")}
                          className="w-full px-2 py-2 border border-border/40 bg-muted/30 rounded-xl text-sm text-start outline-none h-10"
                        />
                      </td>
                      <td className="pt-4 px-1 align-top">
                        <input
                          type="number"
                          value={item.discount}
                          onChange={(event) =>
                            updateItem(item.id, {
                              discount: Number(event.target.value) || 0,
                            })
                          }
                          className="w-full px-2 py-2 border border-border/60 rounded-xl text-sm text-start focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all h-10"
                        />
                      </td>
                      <td className="pt-4 px-1 align-top">
                        <input
                          type="number"
                          value={item.price}
                          onChange={(event) =>
                            updateItem(item.id, {
                              price: Number(event.target.value) || 0,
                            })
                          }
                          className="w-full px-2 py-2 border border-border/60 rounded-xl text-sm text-start focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all h-10"
                        />
                      </td>
                      <td className="pt-4 px-1 align-top">
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={(event) =>
                            updateItem(item.id, {
                              quantity: Number(event.target.value) || 0,
                            })
                          }
                          className="w-full px-2 py-2 border border-border/60 rounded-xl text-sm text-start focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all h-10"
                        />
                      </td>
                      <td className="pt-4 pl-1 align-top min-w-[320px]">
                        <textarea
                          rows={3}
                          value={item.description}
                          onChange={(event) =>
                            updateItem(item.id, {
                              description: event.target.value,
                            })
                          }
                          placeholder={t("اكتب وصف البند (اختياري)...")}
                          className="w-full px-2 py-2 border border-border/60 rounded-xl text-sm text-start focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all min-h-[88px] resize-y"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="border-t border-slate-200 pt-4 flex justify-center mt-8">
              <div className="w-96 flex justify-between">
                <div className="space-y-2 text-end">
                  <div className="text-sm">
                    <span className="text-sm font-bold text-foreground">
                      {formatNumber(totals.tax, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {t("ريال")}
                    </span>
                  </div>
                  <div className="text-sm">
                    <span className="font-bold text-blue-600">
                      {formatNumber(totals.total, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {t("ريال")}
                    </span>
                  </div>
                </div>
                <div className="space-y-2 text-start">
                  <div className="text-sm text-slate-600">{t("الضريبة")}</div>
                  <div className="text-sm font-bold text-slate-800">{t("المجموع الكلي")}</div>
                </div>
                <div className="space-y-2 text-end">
                  <div className="text-sm">
                    <span className="text-sm font-bold text-foreground">
                      {formatNumber(totals.subtotal, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {t("ريال")}
                    </span>
                  </div>
                  <div className="text-sm">
                    <span className="text-sm font-bold text-foreground">
                      {formatNumber(totals.discount, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {t("ريال")}
                    </span>
                  </div>
                </div>
                <div className="space-y-2 text-start">
                  <div className="text-sm text-slate-600">{t("المجموع الفرعي")}</div>
                  <div className="text-sm text-slate-600">{t("الخصم")}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
