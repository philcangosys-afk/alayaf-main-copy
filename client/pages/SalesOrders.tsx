import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
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
  Loader2,
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
} from "@/components/SalesPageUI";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabaseClient";
import { nextCompanyNumber } from "@/lib/companyNumbers";
import { dbErrorText } from "@/lib/dbErrors";
import { selectAllRows } from "@/lib/ledgerData";
import { COMPANY_PROFILE } from "@/lib/companyProfile";
import { useI18n } from "@/i18n";
import { ItemLinkButton, ItemPickerDialog, StockHint } from "@/components/ItemPicker";
import { requestedQuantity, useItemCatalog, type CatalogItem } from "@/lib/itemCatalog";

// بند أمر البيع كما يُحفظ في عمود items (jsonb) في قاعدة البيانات
type OrderItem = {
  id: number;
  description: string;
  quantity: number;
  price: number;
  discount: number;
  taxPercent: number;
  // صنف المخزون الذي عُبئ منه الوصف (اختياري؛ الوصف الحر مسموح)
  productId?: string;
};

type SalesOrder = {
  id: string;
  date: string;
  deliveryDate: string;
  customerId: string;
  customer: string;
  total: string;
  quotationId: string;
  status: string;
  statusColor: string;
  subStatus?: string;
  subStatusColor?: string;
  items: OrderItem[];
  warehouseId: string;
  warehouse: string;
  invoiceId: string;
  notes: string;
  // مجاميع تحسبها قاعدة البيانات (trigger) من البنود
  hasDbTotals: boolean;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  grandTotal: number;
};

type CustomerOption = {
  id: string;
  name: string;
  number: string;
  vatNumber: string;
  address: string;
};

type WarehouseOption = { id: string; code: string; name: string };

type ProductOption = { id: string; sku: string; name: string; unit: string };

type QuotationOption = {
  id: string;
  referenceNo: string;
  customer: string;
  total: number;
  status: string;
  items: OrderItem[];
  // بعض بنود العرض بنسبة ضريبة غير 15% و0% (وُحّدت إلى 15%)
  hasOtherTax: boolean;
};

const statusColors: Record<string, string> = {
  confirmed: "bg-slate-600 text-white",
  delivered: "bg-slate-600 text-white",
  invoiced: "bg-emerald-600 text-white",
};

const statusBadgeClasses: Record<string, string> = {
  invoiced: "bg-emerald-50 text-emerald-700 border-emerald-200",
  cancelled: "bg-red-50 text-red-700 border-red-200",
  canceled: "bg-red-50 text-red-700 border-red-200",
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
  "مفوتر": "Invoiced",
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
  "المستودع": "Warehouse",
  "اسم العميل": "Customer name",
  "ملاحظات": "Notes",
  "تم تحديث أمر البيع": "Sales order updated",
  "الأمر": "Order",
  "تعذر تحديث أمر البيع": "Unable to update sales order",
  "يرجى المحاولة لاحقاً": "Please try again later",
  "لا توجد بنود": "No items",
  "حذف": "Delete",
  "تم حفظ أمر البيع": "Sales order saved",
  "تعذر حفظ أمر البيع": "Unable to save sales order",
  "إلغاء": "Cancel",
  "حفظ الأمر": "Save order",
  "إنشاء أمر بيع جديد": "Create new sales order",
  "معلومات الأمر الأساسية": "Basic order information",
  "عرض السعر": "Quotation",
  "المفتوحة والمرسلة فقط": "Open and sent only",
  "تاريخ التسليم المتوقع": "Expected delivery date",
  "ملاحظات...": "Notes...",
  "مرجع الأمر": "Order reference",
  "تلقائي": "Automatic",
  "إضافة بند": "Add item",
  "المجموع": "Total",
  "خصم": "Discount",
  "اكتب وصف البند (اختياري)...": "Enter the item description (optional)...",
  "المجموع الكلي": "Grand total",
  "الكمية يجب أن تكون أكبر من صفر": "Quantity must be above zero",
  "السعر لا يمكن أن يكون سالبًا": "Price cannot be negative",
  "الخصم لا يمكن أن يكون سالبًا": "Discount cannot be negative",
  "الخصم أكبر من قيمة البند (الكمية × السعر)":
    "The discount is larger than the line value (quantity × price)",
  "البند": "Line",
  "نسبة ضريبة القيمة المضافة في بنود الأمر يجب أن تكون 15%":
    "The VAT rate on order lines must be 15%",
  "بنود الأمر غير صالحة؛ أضف بندًا واحدًا على الأقل بكمية وسعر صحيحين":
    "The order lines are invalid; add at least one line with a valid quantity and price",
  "تعذر قبول بيانات أمر البيع؛ راجع البنود والقيم":
    "The sales order data was rejected; review the lines and values",
  "لم يُحدَّث الأمر: ربما فُوتر أو لا تملك صلاحية تعديله":
    "The order was not updated: it may be invoiced or you lack permission to edit it",
  "تعذر تحميل العملاء": "Unable to load customers",
  "اختر العميل": "Select customer",
  "اختر العميل من قائمة العملاء": "Select the customer from the customers list",
  "غير مرتبط بسجل عميل؛ اختر العميل من القائمة":
    "is not linked to a customer record; select the customer from the list",
  "غير نشط": "Inactive",
  "بدون مستودع": "No warehouse",
  "غير مرتبط بمستودع؛ اختر المستودع من القائمة":
    "is not linked to a warehouse; select the warehouse from the list",
  "ابحث واختر عرض السعر...": "Search and select a quotation...",
  "رقم العرض، المرجع، العميل...": "Quotation number, reference, customer...",
  "إزالة الربط بعرض السعر": "Unlink the quotation",
  "لا توجد عروض أسعار مفتوحة مطابقة": "No matching open quotations",
  "مفتوح": "Open",
  "مرسل": "Sent",
  "مغلق": "Closed",
  "سيتم استبدال بنود الأمر الحالية ببنود عرض السعر. متابعة؟":
    "The current order lines will be replaced with the quotation lines. Continue?",
  "عميل عرض السعر غير موجود في قائمة العملاء النشطين":
    "The quotation customer is not in the active customers list",
  "اختر العميل من القائمة": "Select the customer from the list",
  "عرض السعر بلا بنود": "The quotation has no lines",
  "أدخل بنود الأمر يدويًا": "Enter the order lines manually",
  "تم توحيد نسبة الضريبة": "VAT rate unified",
  "بعض بنود عرض السعر بنسبة ضريبة مختلفة؛ أوامر البيع تعتمد 15%":
    "Some quotation lines have a different VAT rate; sales orders use 15%",
  "تم حفظ أمر البيع، وتعذر إغلاق عرض السعر":
    "The sales order was saved, but the quotation could not be closed",
  "لم يُغلق عرض السعر: ربما لا تملك صلاحية تعديل عروض الأسعار؛ أغلقه يدويًا من شاشة عروض الأسعار":
    "The quotation was not closed: you may lack permission to edit quotations; close it manually from the Quotations screen",
  "فواتير المبيعات تعتمد 15%؛ بنود الأمر بنسبة 0% ستظهر في الفاتورة بنسبة 15%":
    "Sales invoices use 15%; order lines at 0% will appear on the invoice at 15%",
  "اختر صنفًا (اختياري)": "Select an item (optional)",
  "أضف بندًا واحدًا على الأقل": "Add at least one line",
  "تاريخ الأمر مطلوب": "Order date is required",
  "تاريخ التسليم غير صحيح": "Invalid delivery date",
  "تاريخ التسليم لا يسبق تاريخ الأمر": "The delivery date cannot be before the order date",
  "جارٍ الحفظ...": "Saving...",
  "تحويل إلى فاتورة": "Convert to invoice",
  "لا توجد بنود لتحويلها": "No lines to convert",
  "أضف بنود الأمر قبل تحويله إلى فاتورة": "Add the order lines before converting it to an invoice",
  "هل تريد حذف أمر البيع؟": "Delete this sales order?",
  "تعذر حذف أمر البيع": "Unable to delete sales order",
  "لم يُحذف الأمر: ربما فُوتر أو لا تملك صلاحية حذفه":
    "The order was not deleted: it may be invoiced or you lack permission to delete it",
  "تم حذف أمر البيع": "Sales order deleted",
  "الفاتورة": "Invoice",
  "رقم الفاتورة": "Invoice number",
  "جارٍ تجهيز أمر البيع للطباعة...": "Preparing the sales order for printing...",
  "الرقم الضريبي": "VAT number",
  "السجل التجاري": "Commercial registration",
  "العنوان": "Address",
  "الهاتف": "Phone",
  "الرقم الضريبي للعميل": "Customer VAT number",
  "عنوان العميل": "Customer address",
  "الصافي قبل الضريبة": "Net before VAT",
  "نسبة الضريبة": "VAT rate",
  "قيمة الضريبة": "VAT amount",
  "ضريبة القيمة المضافة": "VAT",
};

const statusLabelKeys: Record<string, string> = {
  confirmed: "مؤكد",
  delivered: "تم التسليم",
  invoiced: "مفوتر",
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

const toNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

// لا نعرض "-0.00"
const cleanZero = (value: number) => (Math.abs(value) < 0.005 ? 0 : value);

const ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

// قراءة مبلغ محفوظ كنص: الصيغة الجديدة رقم صريح ("21965.00")، والقديمة «ريال 21965.00»
const parseStoredAmount = (value: unknown): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = String(value ?? "")
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_INDIC_DIGITS.indexOf(digit)))
    .replace(/٫/g, ".")
    .replace(/[,\s٬]/g, "");
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? toNumber(match[0]) : 0;
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
          productId: line.productId ? String(line.productId) : undefined,
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

// مجاميع قاعدة البيانات عند وجودها مع بنود محفوظة فيها، وإلا نحسبها من البنود
const getOrderTotals = (
  order: SalesOrder,
  lines: { items: OrderItem[]; fromDb: boolean },
): OrderTotals | null => {
  if (lines.fromDb && order.hasDbTotals) {
    return {
      subtotal: order.subtotal,
      discount: order.discountTotal,
      tax: order.taxTotal,
      total: order.grandTotal,
    };
  }
  return lines.items.length > 0 ? calcOrderTotals(lines.items) : null;
};

// إجمالي الأمر للقائمة: الأعمدة الرقمية، ثم البنود، ثم عمود total النصي (قديم أو جديد)
const getOrderGrandTotal = (order: SalesOrder) => {
  if (order.hasDbTotals) return order.grandTotal;
  if (order.items.length > 0) return calcOrderTotals(order.items).total;
  return parseStoredAmount(order.total);
};

// نفس قيود الـ trigger حتى يرى المستخدم رسالة واضحة قبل رفض قاعدة البيانات
const lineIssue = (item: LineAmounts): string | null => {
  const quantity = toNumber(item.quantity);
  const price = toNumber(item.price);
  const discount = toNumber(item.discount);
  if (!(quantity > 0)) return "الكمية يجب أن تكون أكبر من صفر";
  if (price < 0) return "السعر لا يمكن أن يكون سالبًا";
  if (discount < 0) return "الخصم لا يمكن أن يكون سالبًا";
  if (discount - quantity * price > 1e-9) return "الخصم أكبر من قيمة البند (الكمية × السعر)";
  return null;
};

// نسبة ضريبة بند أمر البيع: 15% أو 0% (يقبلهما الـ trigger)؛ غيرهما أو الفارغ يصبح 15%
const orderTaxRate = (value: unknown) => {
  if (value === undefined || value === null || String(value).trim() === "") return SAUDI_STANDARD_VAT_RATE;
  return Number(value) === 0 ? 0 : SAUDI_STANDARD_VAT_RATE;
};

// يُرسل للقاعدة الحقول المعتمدة فقط، والضريبة 15% أو 0% (المنسوخة من عرض السعر)
const toItemsPayload = (lines: OrderItem[]) =>
  lines.map((item, index) => ({
    id: toNumber(item.id) || index + 1,
    description: String(item.description ?? ""),
    quantity: toNumber(item.quantity),
    price: toNumber(item.price),
    discount: toNumber(item.discount),
    taxPercent: orderTaxRate(item.taxPercent),
    ...(item.productId ? { productId: item.productId } : {}),
  }));

const salesOrderErrorMessages: Array<[string, string]> = [
  [
    "SALES_ORDER_ITEM_VALUES_INVALID",
    "الكمية يجب أن تكون أكبر من صفر، والسعر والخصم غير سالبين، والخصم لا يتجاوز قيمة البند",
  ],
  ["SALES_ORDER_TAX_RATE_INVALID", "نسبة الضريبة يجب أن تكون 15% أو 0%"],
  [
    "SALES_ORDER_ITEMS_INVALID",
    "بنود الأمر غير صالحة؛ أضف بندًا واحدًا على الأقل بكمية وسعر صحيحين",
  ],
];

// رسالة عربية لأخطاء أوامر البيع (رموز الـ trigger ثم أخطاء القاعدة العامة)
const salesOrderErrorText = (message: unknown): string => {
  const text = String(message ?? "");
  for (const [code, arabic] of salesOrderErrorMessages) {
    if (text.includes(code)) return arabic;
  }
  if (/SALES_ORDER_[A-Z_]+/.test(text)) return "تعذر قبول بيانات أمر البيع؛ راجع البنود والقيم";
  return dbErrorText(text) ?? (text || "يرجى المحاولة لاحقاً");
};

// العنوان الوطني بنفس تنسيق شاشة الفواتير: رقم المبنى والشارع، الحي، المدينة، الرمز البريدي
const formatNationalAddress = (row: Record<string, unknown>) =>
  [
    `${String(row.building_number ?? "").trim()} ${String(row.street ?? "").trim()}`.trim(),
    String(row.district ?? "").trim(),
    String(row.city ?? "").trim(),
    String(row.postal_code ?? "").trim(),
  ]
    .filter(Boolean)
    .join("، ");

const isInvoiced = (order: SalesOrder) =>
  Boolean(order.invoiceId) || order.status === "invoiced";

const canConvertToInvoice = (order: SalesOrder) =>
  !isInvoiced(order) && !["cancelled", "canceled", "draft"].includes(order.status);

const mapSalesOrderRow = (row: Record<string, any>): SalesOrder => {
  const status = String(row.status ?? "") || "confirmed";
  const hasDbTotals =
    row.grand_total !== null && row.grand_total !== undefined && row.grand_total !== "";
  return {
    id: String(row.id ?? ""),
    date: row.date ?? "",
    deliveryDate: row.delivery_date ?? row.deliveryDate ?? "",
    customerId: row.customer_id ? String(row.customer_id) : "",
    customer: row.customer ?? "",
    total: row.total == null ? "" : String(row.total),
    quotationId: row.quotation_id ?? row.quotationId ?? "",
    status,
    statusColor: statusColors[status] ?? "bg-slate-600 text-white",
    subStatus: row.sub_status ?? row.subStatus,
    subStatusColor: row.sub_status_color ?? row.subStatusColor,
    items: normalizeOrderItems(row.items),
    warehouseId: row.warehouse_id ? String(row.warehouse_id) : "",
    warehouse: row.warehouse ?? "",
    invoiceId: row.invoice_id ? String(row.invoice_id) : "",
    notes: row.notes ?? "",
    hasDbTotals,
    subtotal: toNumber(row.subtotal),
    discountTotal: toNumber(row.discount_total),
    taxTotal: toNumber(row.tax_total),
    grandTotal: hasDbTotals ? toNumber(row.grand_total) : parseStoredAmount(row.total),
  };
};

// بنود عرض السعر (itemLabel/description/unitPrice) → بنود أمر البيع (description/price)
const quotationItemsToOrderItems = (value: unknown): { items: OrderItem[]; hasOtherTax: boolean } => {
  const rows = Array.isArray(value)
    ? (value.filter((row) => row && typeof row === "object") as Record<string, unknown>[])
    : [];
  let hasOtherTax = false;
  const items = rows.map((row, index) => {
    const label = String(row.itemLabel ?? "").trim();
    const detail = String(row.description ?? "").trim();
    const rawTax = row.taxPercent;
    const tax =
      rawTax === undefined || rawTax === null || rawTax === ""
        ? SAUDI_STANDARD_VAT_RATE
        : toNumber(rawTax);
    // 15% و0% تُنسخان كما في العرض؛ غيرهما يُوحَّد إلى 15% مع تنبيه
    if (tax !== SAUDI_STANDARD_VAT_RATE && tax !== 0) hasOtherTax = true;
    return {
      id: index + 1,
      description: label && detail && label !== detail ? `${label} - ${detail}` : label || detail,
      quantity: toNumber(row.quantity),
      price: toNumber(row.unitPrice ?? row.price),
      discount: toNumber(row.discount),
      taxPercent: tax === 0 ? 0 : SAUDI_STANDARD_VAT_RATE,
      // S17: صنف بند العرض ينتقل للأمر
      ...(row.productId ? { productId: String(row.productId) } : {}),
    };
  });
  return { items, hasOtherTax };
};

const emptyLine = (id: number): OrderItem => ({
  id,
  description: "",
  quantity: 1,
  price: 0,
  discount: 0,
  taxPercent: SAUDI_STANDARD_VAT_RATE,
});

const FIELD_CLASS =
  "w-full px-3 py-2 border border-border/60 rounded-xl text-sm text-start bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all";

export default function SalesOrders() {
  const { t, locale, direction, formatDate, formatNumber } = useSalesOrdersI18n();
  const navigate = useNavigate();
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
          description: t(salesOrderErrorText(error.message)),
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

  const handleDelete = async (order: SalesOrder) => {
    if (isInvoiced(order)) return;
    if (!window.confirm(`${t("هل تريد حذف أمر البيع؟")}\n${order.id}`)) return;
    // لا يُحذف أمر مرتبط بفاتورة حتى لو تغيرت حالته بعد تحميل القائمة
    const { data, error } = await supabase
      .from("sales_orders")
      .delete()
      .eq("id", order.id)
      .is("invoice_id", null)
      .select("id");
    if (error) {
      toast({
        title: t("تعذر حذف أمر البيع"),
        description: t(salesOrderErrorText(error.message)),
        variant: "destructive",
      });
      return;
    }
    if (!data || data.length === 0) {
      toast({
        title: t("تعذر حذف أمر البيع"),
        description: t("لم يُحذف الأمر: ربما فُوتر أو لا تملك صلاحية حذفه"),
        variant: "destructive",
      });
      return;
    }
    setOrders((prev) => prev.filter((row) => row.id !== order.id));
    toast({ title: t("تم حذف أمر البيع"), description: `${t("الأمر")}: ${order.id}` });
  };

  // تحويل الأمر إلى فاتورة: نموذج الفاتورة يُعبأ من الأمر ويربط الفاتورة به بعد حفظها
  const handleConvertToInvoice = (order: SalesOrder) => {
    if (!canConvertToInvoice(order)) return;
    const { items } = getOrderLines(order);
    if (items.length === 0) {
      toast({
        title: t("لا توجد بنود لتحويلها"),
        description: t("أضف بنود الأمر قبل تحويله إلى فاتورة"),
        variant: "destructive",
      });
      return;
    }
    if (items.some((item) => orderTaxRate(item.taxPercent) !== SAUDI_STANDARD_VAT_RATE)) {
      toast({
        title: t("تم توحيد نسبة الضريبة"),
        description: t("فواتير المبيعات تعتمد 15%؛ بنود الأمر بنسبة 0% ستظهر في الفاتورة بنسبة 15%"),
      });
    }
    navigate("/sales/invoices", {
      state: {
        fromSalesOrder: {
          id: order.id,
          customerId: order.customerId,
          customer: order.customer,
          // S17: مستودع الأمر وأصنافه: المنتجات المخزنية تُصرف منه مع الفاتورة
          warehouseId: order.warehouseId,
          items: items.map((item) => ({
            description: String(item.description ?? ""),
            quantity: toNumber(item.quantity),
            unitPrice: toNumber(item.price),
            discount: toNumber(item.discount),
            // الفواتير تقبل 15% فقط
            taxPercent: SAUDI_STANDARD_VAT_RATE,
            ...(item.productId ? { productId: item.productId } : {}),
          })),
        },
      },
    });
  };

  const handleDownloadPdf = async (order: SalesOrder) => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      return;
    }
    printWindow.document.write(
      `<html dir="${direction}" lang="${locale}"><meta charset="utf-8"><body style="font-family:Arial;padding:32px;text-align:center">${escapeHtml(t("جارٍ تجهيز أمر البيع للطباعة..."))}</body></html>`,
    );

    // الرقم الضريبي والعنوان من سجل العميل
    let customerVat = "";
    let customerAddress = "";
    if (order.customerId) {
      try {
        const { data } = await supabase
          .from("customers")
          .select("tax_number, building_number, street, district, city, postal_code")
          .eq("id", order.customerId)
          .maybeSingle();
        if (data) {
          customerVat = String(data.tax_number ?? "").trim();
          customerAddress = formatNationalAddress(data);
        }
      } catch {
        // الطباعة تكمل دون بيانات العميل الإضافية
      }
    }

    // بنود قاعدة البيانات أولًا؛ لا نخترع بنودًا عند غيابها
    const lines = getOrderLines(order);
    const totals = getOrderTotals(order, lines);
    const money = (value: number) =>
      formatNumber(cleanZero(value), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const grandTotal = totals ? totals.total : parseStoredAmount(order.total);
    const isEnglish = locale === "en";
    const companyName = isEnglish
      ? COMPANY_PROFILE.companyNameEn || COMPANY_PROFILE.companyNameAr
      : COMPANY_PROFILE.companyNameAr || COMPANY_PROFILE.companyNameEn;
    const companyOtherName = isEnglish ? COMPANY_PROFILE.companyNameAr : COMPANY_PROFILE.companyNameEn;
    const companyAddressBase = isEnglish
      ? COMPANY_PROFILE.addressEn || COMPANY_PROFILE.addressAr
      : COMPANY_PROFILE.addressAr || COMPANY_PROFILE.addressEn;
    const companyAddress =
      COMPANY_PROFILE.city && !companyAddressBase.includes(COMPANY_PROFILE.city)
        ? [companyAddressBase, COMPANY_PROFILE.city].filter(Boolean).join("، ")
        : companyAddressBase;
    const startAlign = direction === "rtl" ? "right" : "left";
    const endAlign = direction === "rtl" ? "left" : "right";

    const rowsHtml =
      lines.items.length > 0
        ? lines.items
            .map((item, index) => {
              const line = calcLine(item);
              return `<tr>
          <td>${formatNumber(index + 1)}</td>
          <td class="desc">${escapeHtml(item.description || "-")}</td>
          <td>${formatNumber(item.quantity)}</td>
          <td>${money(item.price)}</td>
          <td>${money(item.discount)}</td>
          <td>${money(line.net)}</td>
          <td>${formatNumber(item.taxPercent)}%</td>
          <td>${money(line.tax)}</td>
          <td>${money(line.total)}</td>
        </tr>`;
            })
            .join("")
        : `<tr><td colspan="9" style="text-align:center">${escapeHtml(t("لا توجد بنود"))}</td></tr>`;

    const totalsHtml = `<table class="totals">
              <tbody>
                ${totals ? `<tr><th>${escapeHtml(t("المجموع الفرعي"))}</th><td>${money(totals.subtotal)} ${escapeHtml(t("ريال"))}</td></tr>
                <tr><th>${escapeHtml(t("الخصم"))}</th><td>${money(totals.discount)} ${escapeHtml(t("ريال"))}</td></tr>
                <tr><th>${escapeHtml(t("ضريبة القيمة المضافة"))}${lines.items.every((item) => orderTaxRate(item.taxPercent) === SAUDI_STANDARD_VAT_RATE) ? ` (${formatNumber(SAUDI_STANDARD_VAT_RATE)}%)` : ""}</th><td>${money(totals.tax)} ${escapeHtml(t("ريال"))}</td></tr>` : ""}
                <tr class="grand"><th>${escapeHtml(t("الإجمالي"))}</th><td>${money(grandTotal)} ${escapeHtml(t("ريال"))}</td></tr>
              </tbody>
            </table>`;

    const metaCard = (label: string, value: string) =>
      `<div class="card"><div class="label">${escapeHtml(t(label))}</div><div class="value">${escapeHtml(value || "-")}</div></div>`;

    const html = `
      <html dir="${direction}" lang="${locale}">
        <head>
          <title>${escapeHtml(t("أمر بيع"))} ${escapeHtml(order.id)}</title>
          <meta charset="utf-8" />
          <style>
            @page { size: A4; margin: 10mm; }
            * { box-sizing:border-box; }
            body { font-family: 'Cairo', Arial, sans-serif; margin:0; padding:16px; color:#0f172a; font-size:12px; }
            .page { border:1px solid #e2e8f0; padding:18px; }
            .header { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; border-bottom:2px solid #4f46e5; padding-bottom:12px; margin-bottom:12px; }
            .company { line-height:1.7; }
            .company-name { font-size:20px; font-weight:700; }
            .company-sub { color:#475569; }
            .logo { width:110px; height:72px; object-fit:contain; }
            .doc-title { text-align:center; margin:6px 0 14px; }
            .doc-title .title { font-size:24px; font-weight:700; }
            .doc-title .number { font-size:14px; font-weight:700; color:#4f46e5; }
            .meta { display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; margin-bottom:14px; }
            .card { border:1px solid #e2e8f0; padding:8px 10px; border-radius:8px; }
            .label { color:#64748b; font-size:11px; }
            .value { font-weight:700; font-size:13px; overflow-wrap:anywhere; }
            .party { border:1px solid #c7d2fe; background:#f8fafc; border-radius:8px; padding:10px 12px; margin-bottom:14px; line-height:1.8; }
            table { width:100%; border-collapse:collapse; }
            th, td { border:1px solid #e2e8f0; padding:6px; text-align:center; font-size:12px; }
            td.desc { text-align:${startAlign}; }
            th { background:#f1f5f9; }
            .totals { width:340px; margin-top:14px; margin-${startAlign}:auto; }
            .totals th { text-align:${startAlign}; }
            .totals td { text-align:${endAlign}; white-space:nowrap; }
            .totals .grand th, .totals .grand td { background:#eef2ff; font-weight:700; font-size:13px; }
            .notes { margin-top:14px; white-space:pre-wrap; border-top:1px solid #e2e8f0; padding-top:10px; }
            @media print { body { -webkit-print-color-adjust:exact; print-color-adjust:exact; } }
          </style>
        </head>
        <body>
          <div class="page">
            <div class="header">
              <div class="company">
                <div class="company-name">${escapeHtml(companyName || "-")}</div>
                ${companyOtherName ? `<div class="company-sub">${escapeHtml(companyOtherName)}</div>` : ""}
                <div>${escapeHtml(t("الرقم الضريبي"))}: ${escapeHtml(COMPANY_PROFILE.vatNumber || "-")}</div>
                <div>${escapeHtml(t("السجل التجاري"))}: ${escapeHtml(COMPANY_PROFILE.commercialRegistration || "-")}</div>
                <div>${escapeHtml(t("العنوان"))}: ${escapeHtml(companyAddress || "-")}</div>
                ${COMPANY_PROFILE.phone ? `<div>${escapeHtml(t("الهاتف"))}: ${escapeHtml(COMPANY_PROFILE.phone)}</div>` : ""}
              </div>
              ${COMPANY_PROFILE.logoUrl ? `<img class="logo" src="${escapeHtml(COMPANY_PROFILE.logoUrl)}" alt="" />` : ""}
            </div>
            <div class="doc-title">
              <div class="title">${escapeHtml(t("أمر بيع"))}</div>
              <div class="number">${escapeHtml(order.id)}</div>
            </div>
            <div class="party">
              <div><strong>${escapeHtml(t("العميل"))}:</strong> ${escapeHtml(order.customer || "-")}</div>
              <div><strong>${escapeHtml(t("الرقم الضريبي للعميل"))}:</strong> ${escapeHtml(customerVat || "-")}</div>
              <div><strong>${escapeHtml(t("عنوان العميل"))}:</strong> ${escapeHtml(customerAddress || "-")}</div>
            </div>
            <div class="meta">
              ${metaCard("رقم الأمر", order.id)}
              ${metaCard("تاريخ الأمر", order.date ? formatDate(order.date) : "")}
              ${metaCard("تاريخ التسليم", order.deliveryDate ? formatDate(order.deliveryDate) : "")}
              ${metaCard("المستودع", order.warehouse)}
              ${metaCard("رقم عرض السعر", order.quotationId)}
              ${metaCard("الحالة", getStatusLabel(order.status, t))}
              ${order.invoiceId ? metaCard("رقم الفاتورة", order.invoiceId) : ""}
            </div>
            <table>
              <thead>
                <tr><th>#</th><th>${escapeHtml(t("وصف البند"))}</th><th>${escapeHtml(t("الكمية"))}</th><th>${escapeHtml(t("السعر"))}</th><th>${escapeHtml(t("الخصم"))}</th><th>${escapeHtml(t("الصافي قبل الضريبة"))}</th><th>${escapeHtml(t("نسبة الضريبة"))}</th><th>${escapeHtml(t("قيمة الضريبة"))}</th><th>${escapeHtml(t("الإجمالي"))}</th></tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>
            ${totalsHtml}
            ${order.notes ? `<div class="notes"><strong>${escapeHtml(t("ملاحظات"))}:</strong><br/>${escapeHtml(order.notes)}</div>` : ""}
          </div>
        </body>
      </html>
    `;

    if (printWindow.closed) return;
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    // مهلة قصيرة حتى يُحمَّل الشعار قبل نافذة الطباعة
    window.setTimeout(() => {
      if (!printWindow.closed) printWindow.print();
    }, 300);
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
              if (isInvoiced(order)) return;
              setSelectedOrder(order);
              setView("edit");
            }}
            onDelete={handleDelete}
            onConvert={handleConvertToInvoice}
            onDownloadPdf={handleDownloadPdf}
            orders={orders}
          />
        )}
        {view === "create" && (
          <OrderEditor mode="create" onBack={() => setView("list")} onSaved={handleSaved} />
        )}
        {view === "details" && selectedOrder && (
          <OrderDetails order={selectedOrder} onBack={() => setView("list")} />
        )}
        {view === "edit" && selectedOrder && (
          <OrderEditor
            key={selectedOrder.id}
            mode="edit"
            order={selectedOrder}
            onBack={() => setView("list")}
            onSaved={handleUpdated}
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
  onDelete,
  onConvert,
  onDownloadPdf,
  orders,
}: {
  onCreateClick: () => void;
  onView: (order: SalesOrder) => void;
  onEdit: (order: SalesOrder) => void;
  onDelete: (order: SalesOrder) => void;
  onConvert: (order: SalesOrder) => void;
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
        `${order.id} ${order.customer} ${order.quotationId ?? ""} ${order.invoiceId}`
          .toLowerCase()
          .includes(term)) &&
      (customerFilter === "الكل" || order.customer === customerFilter) &&
      (!statusFilter ||
        (statusFilter === "invoiced" ? isInvoiced(order) : order.status === statusFilter))
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
          <option value="">{t("الكل")}</option>
          <option value="confirmed">{t("مؤكد")}</option>
          <option value="delivered">{t("تم التسليم")}</option>
          <option value="invoiced">{t("مفوتر")}</option>
        </FilterSelect>
        <FilterActions onReset={() => { setSearch(""); setCustomerFilter("الكل"); setStatusFilter(""); }} />
      </FilterBar>

      <DataTable
        headers={["الإجراءات", "الحالة", "رقم عرض السعر", "الإجمالي", "العميل", "تاريخ التسليم", "تاريخ الأمر", "رقم الأمر"].map(t)}
        gradient="from-[#1e293b] to-[#334155]"
      >
        {filteredOrders.map((order, i) => {
          const invoiced = isInvoiced(order);
          const statusKey = invoiced ? "invoiced" : order.status;
          return (
            <tr key={order.id} className={cn("hover:bg-muted/30 transition-colors", i % 2 !== 0 && "bg-muted/10")}>
              <td className="px-5 py-3.5 align-middle">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <ActionBtn icon={Eye} label={t("عرض")} color="blue" onClick={() => onView(order)} />
                  {!invoiced && (
                    <ActionBtn icon={Edit} label={t("تعديل")} color="emerald" onClick={() => onEdit(order)} />
                  )}
                  <ActionBtn icon={Download} label="PDF" color="slate" onClick={() => void onDownloadPdf(order)} />
                  {canConvertToInvoice(order) && (
                    <ActionBtn icon={FileText} label={t("تحويل إلى فاتورة")} color="indigo" onClick={() => onConvert(order)} />
                  )}
                  {!invoiced && (
                    <ActionBtn icon={Trash2} label={t("حذف")} color="red" onClick={() => void onDelete(order)} />
                  )}
                </div>
              </td>
              <td className="px-5 py-3.5 align-middle text-start space-y-1">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-3 py-0.5 text-[11px] font-bold whitespace-nowrap",
                    statusBadgeClasses[statusKey] ?? "bg-slate-50 text-slate-700 border-slate-200",
                  )}
                >
                  {getStatusLabel(statusKey, t)}
                </span>
                {order.invoiceId && (
                  <span className="block text-[11px] font-semibold text-emerald-700 whitespace-nowrap">
                    {t("الفاتورة")}: {order.invoiceId}
                  </span>
                )}
                {order.subStatus && (
                  <span className={cn("inline-flex items-center gap-1 rounded-full border px-3 py-0.5 text-[11px] font-bold whitespace-nowrap block mt-1", order.subStatusColor)}>
                    {getStatusLabel(order.subStatus, t)}
                  </span>
                )}
              </td>
              <td className="px-5 py-3.5 align-middle text-start text-primary font-medium">
                {order.quotationId || "-"}
              </td>
              <td className="px-5 py-3.5 align-middle text-start whitespace-nowrap font-bold text-primary">
                {order.hasDbTotals || order.items.length > 0 || /[0-9٠-٩]/.test(order.total)
                  ? `${formatNumber(cleanZero(getOrderGrandTotal(order)), {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })} ${t("ريال")}`
                  : "-"}
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
              <td className="px-5 py-3.5 align-middle text-start font-bold text-primary hover:underline cursor-pointer" onClick={() => onView(order)}>
                {order.id}
              </td>
            </tr>
          );
        })}
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
    formatNumber(cleanZero(value), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const statusKey = isInvoiced(order) ? "invoiced" : order.status;

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
            <div className="space-y-1"><label className="text-[12px] font-semibold text-muted-foreground block text-start">{t("العميل")}</label><div className="text-start font-semibold">{order.customer || "-"}</div></div>
            <div className="space-y-1"><label className="text-[12px] font-semibold text-muted-foreground block text-start">{t("تاريخ الأمر")}</label><div className="text-start font-semibold">{order.date ? formatDate(order.date) : "-"}</div></div>
            <div className="space-y-1"><label className="text-[12px] font-semibold text-muted-foreground block text-start">{t("تاريخ التسليم")}</label><div className="text-start font-semibold">{order.deliveryDate ? formatDate(order.deliveryDate) : "-"}</div></div>
            <div className="space-y-1"><label className="text-[12px] font-semibold text-muted-foreground block text-start">{t("رقم عرض السعر")}</label><div className="text-start font-semibold">{order.quotationId || "-"}</div></div>
            <div className="space-y-1"><label className="text-[12px] font-semibold text-muted-foreground block text-start">{t("الإجمالي")}</label><div className="text-start font-semibold">{`${money(totals ? totals.total : parseStoredAmount(order.total))} ${t("ريال")}`}</div></div>
            <div className="space-y-1"><label className="text-[12px] font-semibold text-muted-foreground block text-start">{t("المستودع")}</label><div className="text-start font-semibold">{order.warehouse || "-"}</div></div>
            <div className="space-y-1"><label className="text-[12px] font-semibold text-muted-foreground block text-start">{t("الحالة")}</label><div className="text-start font-semibold">{getStatusLabel(statusKey, t)}{order.invoiceId ? ` — ${t("الفاتورة")}: ${order.invoiceId}` : ""}</div></div>
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

// القوائم المرجعية لنموذج الأمر: العملاء والمستودعات والأصناف النشطة، وعروض الأسعار المفتوحة/المرسلة
function useOrderReferenceData(t: (value: string) => string) {
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [quotations, setQuotations] = useState<QuotationOption[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const [customerResult, warehouseResult, productResult, quotationResult] = await Promise.all([
        selectAllRows((from, to) =>
          supabase
            .from("customers")
            .select("id, name, customer_number, tax_number, building_number, street, district, city, postal_code")
            .eq("status", "نشط")
            .order("name")
            .order("id")
            .range(from, to),
        ),
        selectAllRows((from, to) =>
          supabase
            .from("inventory_warehouses")
            .select("id, code, name_ar")
            .eq("active", true)
            .order("code")
            .order("id")
            .range(from, to),
        ),
        selectAllRows((from, to) =>
          supabase
            .from("inventory_products")
            .select("id, sku, name_ar, unit")
            .eq("active", true)
            .order("sku")
            .order("id")
            .range(from, to),
        ),
        selectAllRows((from, to) =>
          supabase
            .from("sales_quotations")
            .select("id, reference_no, customer, grand_total, total, status, items")
            .in("status", ["مفتوح", "مرسل"])
            .order("created_at", { ascending: false })
            .order("id")
            .range(from, to),
        ),
      ]);
      if (!active) return;

      if (customerResult.error) {
        toast({
          title: t("تعذر تحميل العملاء"),
          description: t(salesOrderErrorText(customerResult.error.message)),
          variant: "destructive",
        });
      }
      setCustomers(
        customerResult.data
          .map((row: Record<string, unknown>) => ({
            id: String(row.id ?? ""),
            name: String(row.name ?? "").trim(),
            number: String(row.customer_number ?? "").trim(),
            vatNumber: String(row.tax_number ?? "").trim(),
            address: formatNationalAddress(row),
          }))
          .filter((row) => row.id && row.name),
      );
      // المستودعات والأصناف اختيارية (منشأة بلا وحدة مخزون تبقى قوائمها فارغة)
      setWarehouses(
        warehouseResult.data
          .map((row: Record<string, unknown>) => ({
            id: String(row.id ?? ""),
            code: String(row.code ?? ""),
            name: String(row.name_ar ?? "").trim(),
          }))
          .filter((row) => row.id),
      );
      setProducts(
        productResult.data
          .map((row: Record<string, unknown>) => ({
            id: String(row.id ?? ""),
            sku: String(row.sku ?? ""),
            name: String(row.name_ar ?? "").trim(),
            unit: String(row.unit ?? ""),
          }))
          .filter((row) => row.id && row.name),
      );
      setQuotations(
        quotationResult.data
          .map((row: Record<string, unknown>) => {
            const mapped = quotationItemsToOrderItems(row.items);
            return {
              id: String(row.id ?? ""),
              referenceNo: String(row.reference_no ?? "").trim(),
              customer: String(row.customer ?? "").trim(),
              total: parseStoredAmount(row.grand_total ?? row.total),
              status: String(row.status ?? ""),
              items: mapped.items,
              hasOtherTax: mapped.hasOtherTax,
            };
          })
          .filter((row) => row.id),
      );
      setLoaded(true);
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  return { customers, warehouses, products, quotations, loaded };
}

function QuotationPicker({
  value,
  options,
  onSelect,
}: {
  value: string;
  options: QuotationOption[];
  onSelect: (option: QuotationOption | null) => void;
}) {
  const { t, formatNumber } = useSalesOrdersI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointer);
    return () => document.removeEventListener("mousedown", handlePointer);
  }, [open]);

  const selected = options.find((option) => option.id === value);
  const term = query.trim().toLowerCase();
  const filtered = options.filter(
    (option) =>
      !term ||
      `${option.id} ${option.referenceNo} ${option.customer}`.toLowerCase().includes(term),
  );
  const label = (option: QuotationOption) =>
    `${option.id}${option.referenceNo ? ` (${option.referenceNo})` : ""}`;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={cn(FIELD_CLASS, "flex items-center justify-between gap-2")}
      >
        <span className={cn("truncate", !value && "text-slate-400")}>
          {selected
            ? `${label(selected)} — ${selected.customer || "-"}`
            : value || t("ابحث واختر عرض السعر...")}
        </span>
        <Search className="h-4 w-4 shrink-0 text-slate-400" />
      </button>
      {open && (
        <div className="absolute start-0 z-30 mt-1 w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-border/60 bg-white p-2 shadow-lg">
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("رقم العرض، المرجع، العميل...")}
            className={cn(FIELD_CLASS, "mb-2")}
          />
          <div className="max-h-64 space-y-0.5 overflow-y-auto">
            {value && (
              <button
                type="button"
                onClick={() => {
                  onSelect(null);
                  setOpen(false);
                }}
                className="w-full rounded-lg px-3 py-2 text-start text-xs font-semibold text-red-600 hover:bg-red-50"
              >
                {t("إزالة الربط بعرض السعر")}
              </button>
            )}
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                {t("لا توجد عروض أسعار مفتوحة مطابقة")}
              </div>
            ) : (
              filtered.map((option) => (
                <button
                  type="button"
                  key={option.id}
                  onClick={() => {
                    onSelect(option);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={cn(
                    "w-full rounded-lg px-3 py-2 text-start hover:bg-slate-100",
                    option.id === value && "bg-blue-50",
                  )}
                >
                  <div className="flex items-center justify-between gap-2 text-sm font-semibold text-foreground">
                    <span className="truncate">{label(option)}</span>
                    <span className="shrink-0 rounded-full border border-slate-200 px-2 text-[10px] text-slate-600">
                      {t(option.status)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="truncate">{option.customer || "-"}</span>
                    <span className="shrink-0 whitespace-nowrap font-bold text-primary">
                      {formatNumber(cleanZero(option.total), {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{" "}
                      {t("ريال")}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function OrderEditor({
  mode,
  order,
  onBack,
  onSaved,
}: {
  mode: "create" | "edit";
  order?: SalesOrder;
  onBack: () => void;
  onSaved: (order: SalesOrder) => void;
}) {
  const { t, direction, formatNumber } = useSalesOrdersI18n();
  const { customers, warehouses, quotations, loaded } = useOrderReferenceData(t);
  // S17: الأصناف والخدمات بأسعارها وكمياتها (لمن يملك المبيعات ولو بلا صلاحية المخزون)
  const catalog = useItemCatalog();
  const catalogById = useMemo(
    () => new Map(catalog.items.map((item) => [item.id, item] as const)),
    [catalog.items],
  );
  const [pickerLineId, setPickerLineId] = useState<number | null>(null);
  const [quotationId, setQuotationId] = useState(order?.quotationId ?? "");
  const [customerId, setCustomerId] = useState(order?.customerId ?? "");
  const [customer, setCustomer] = useState(order?.customer ?? "");
  const [warehouseId, setWarehouseId] = useState(order?.warehouseId ?? "");
  const [warehouse, setWarehouse] = useState(order?.warehouse ?? "");
  const [deliveryDate, setDeliveryDate] = useState(() =>
    order ? order.deliveryDate : riyadhDateString(7),
  );
  const [orderDate, setOrderDate] = useState(() => (order ? order.date : riyadhDateString()));
  const [notes, setNotes] = useState(order?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);
  // بنود قاعدة البيانات أولًا، ثم نسخة المتصفح القديمة (قراءة فقط) للأوامر السابقة
  const [initialLines] = useState(() =>
    order ? getOrderLines(order) : { items: [] as OrderItem[], fromDb: false },
  );
  const hasSavedLines = initialLines.items.length > 0;
  const [items, setItems] = useState<OrderItem[]>(() =>
    hasSavedLines
      ? initialLines.items.map((line, index) => ({
          ...line,
          id: index + 1,
          taxPercent: orderTaxRate(line.taxPercent),
        }))
      : [emptyLine(1)],
  );

  // الأوامر القديمة حُفظ فيها اسم العميل/المستودع نصًا: نربطها بالسجل المطابق عند التحميل
  const legacyLinked = useRef(false);
  useEffect(() => {
    if (!loaded || legacyLinked.current) return;
    legacyLinked.current = true;
    if (!customerId && customer.trim()) {
      const match = customers.find((row) => row.name === customer.trim());
      if (match) {
        setCustomerId(match.id);
        setCustomer(match.name);
      }
    }
    if (!warehouseId && warehouse.trim()) {
      const name = warehouse.trim();
      const match = warehouses.find((row) => row.name === name || row.code === name);
      if (match) {
        setWarehouseId(match.id);
        setWarehouse(match.name);
      }
    }
  }, [loaded]);

  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      // رقم بند لا يتكرر بعد حذف بنود سابقة
      emptyLine(prev.reduce((max, line) => Math.max(max, Number(line.id) || 0), 0) + 1),
    ]);
  };

  const updateItem = (id: number, changes: Partial<OrderItem>) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...changes } : item))
    );
  };

  const removeItem = (id: number) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  // S17: اختيار صنف للبند يعبّئ الوصف وسعر البيع (قابلان للتعديل)؛ «بند حر» يفك الربط
  const pickItem = (lineId: number, product: CatalogItem | null) => {
    setPickerLineId(null);
    if (!product) {
      updateItem(lineId, { productId: undefined });
      return;
    }
    setItems((prev) =>
      prev.map((item) =>
        item.id === lineId
          ? {
              ...item,
              productId: product.id,
              description: product.nameAr,
              price: product.salePrice > 0 ? product.salePrice : item.price,
            }
          : item,
      ),
    );
  };

  const chooseCustomer = (id: string) => {
    const match = customers.find((row) => row.id === id);
    setCustomerId(match ? match.id : id);
    setCustomer(match ? match.name : id ? customer : "");
  };

  const chooseWarehouse = (id: string) => {
    const match = warehouses.find((row) => row.id === id);
    setWarehouseId(match ? match.id : id);
    setWarehouse(match ? match.name : id ? warehouse : "");
  };

  // اختيار عرض سعر: يعبئ العميل وينسخ البنود ويربط الأمر بالعرض
  const applyQuotation = (quotation: QuotationOption | null) => {
    if (!quotation) {
      setQuotationId("");
      return;
    }
    const hasEnteredLines = items.some(
      (item) => item.description.trim() || toNumber(item.price) > 0,
    );
    if (
      quotation.items.length > 0 &&
      hasEnteredLines &&
      !window.confirm(t("سيتم استبدال بنود الأمر الحالية ببنود عرض السعر. متابعة؟"))
    ) {
      return;
    }
    setQuotationId(quotation.id);
    const match = customers.find((row) => row.name === quotation.customer);
    if (match) {
      setCustomerId(match.id);
      setCustomer(match.name);
    } else if (quotation.customer) {
      setCustomerId("");
      setCustomer(quotation.customer);
      toast({
        title: t("عميل عرض السعر غير موجود في قائمة العملاء النشطين"),
        description: `${quotation.customer} — ${t("اختر العميل من القائمة")}`,
        variant: "destructive",
      });
    }
    if (quotation.items.length > 0) {
      setItems(quotation.items.map((line, index) => ({ ...line, id: index + 1 })));
    } else {
      toast({ title: t("عرض السعر بلا بنود"), description: t("أدخل بنود الأمر يدويًا") });
    }
    if (quotation.hasOtherTax) {
      toast({
        title: t("تم توحيد نسبة الضريبة"),
        description: t("بعض بنود عرض السعر بنسبة ضريبة مختلفة؛ أوامر البيع تعتمد 15%"),
      });
    }
  };

  const totals = calcOrderTotals(items);

  // يعيد نص التنبيه عند تعذر الإغلاق (يُعرض مع تنبيه الحفظ؛ التنبيهات واحد في كل مرة)
  const closeQuotation = async (id: string): Promise<string | null> => {
    const { data, error } = await supabase
      .from("sales_quotations")
      .update({ status: "مغلق" })
      .eq("id", id)
      .select("id");
    if (error) return `${id}: ${t(salesOrderErrorText(error.message))}`;
    // صفر صفوف = لم يُغلق (غالبًا لا صلاحية تعديل عروض الأسعار)
    if (!data || data.length === 0) {
      return `${id}: ${t("لم يُغلق عرض السعر: ربما لا تملك صلاحية تعديل عروض الأسعار؛ أغلقه يدويًا من شاشة عروض الأسعار")}`;
    }
    return null;
  };

  const savedToast = (title: string, orderId: string, quotationWarning: string | null) =>
    toast(
      quotationWarning
        ? {
            title: t("تم حفظ أمر البيع، وتعذر إغلاق عرض السعر"),
            description: `${t("الأمر")}: ${orderId} — ${t("عرض السعر")} ${quotationWarning}`,
            variant: "destructive",
          }
        : { title: t(title), description: `${t("الأمر")}: ${orderId}` },
    );

  const handleSave = async () => {
    // منع إنشاء أمرين عند النقر المزدوج
    if (saveInFlight.current) return;
    if (items.length === 0) {
      toast({
        title: t("بيانات الأمر غير مكتملة"),
        description: t("أضف بندًا واحدًا على الأقل"),
        variant: "destructive",
      });
      return;
    }
    const invalidIndex = items.findIndex((item) => lineIssue(item) !== null);
    if (invalidIndex >= 0) {
      toast({
        title: t("تحقق من بنود الأمر"),
        description: `${t("البند")} ${formatNumber(invalidIndex + 1)}: ${t(lineIssue(items[invalidIndex]) ?? "")}`,
        variant: "destructive",
      });
      return;
    }
    if (!customerId) {
      toast({
        title: t("بيانات الأمر غير مكتملة"),
        description: t("اختر العميل من قائمة العملاء"),
        variant: "destructive",
      });
      return;
    }
    if (!(totals.total > 0)) {
      toast(
        mode === "create"
          ? {
              title: t("بيانات الأمر غير مكتملة"),
              description: t("اختر العميل وأضف بندًا واحدًا على الأقل بقيمة أكبر من صفر"),
              variant: "destructive",
            }
          : {
              // لا نسمح بتصفير إجمالي أمر موجود
              title: t("لا يمكن حفظ أمر بإجمالي صفر"),
              description: hasSavedLines
                ? t("أضف بنود الأمر بأسعارها قبل الحفظ")
                : t("بنود هذا الأمر غير محفوظة؛ أعد إدخالها كاملة قبل الحفظ"),
              variant: "destructive",
            },
      );
      return;
    }
    if (!orderDate) {
      toast({ title: t("بيانات الأمر غير مكتملة"), description: t("تاريخ الأمر مطلوب"), variant: "destructive" });
      return;
    }
    if (deliveryDate && deliveryDate < orderDate) {
      toast({
        title: t("تاريخ التسليم غير صحيح"),
        description: t("تاريخ التسليم لا يسبق تاريخ الأمر"),
        variant: "destructive",
      });
      return;
    }

    saveInFlight.current = true;
    setSaving(true);
    // المجاميع وعمود total تحسبها قاعدة البيانات من items
    const common = {
      date: orderDate,
      delivery_date: deliveryDate,
      customer_id: customerId,
      customer,
      quotation_id: quotationId,
      items: toItemsPayload(items),
      warehouse_id: warehouseId || null,
      // اسم المستودع المختار، أو النص القديم للأوامر السابقة إلى أن يُختار مستودع
      warehouse,
      notes,
    };
    // إغلاق عرض السعر المفتوح/المرسل الذي بُني عليه الأمر (لا يُعاد استخدامه في أمر آخر)
    const quotationToClose =
      quotationId &&
      quotations.some((row) => row.id === quotationId) &&
      (mode === "create" || quotationId !== (order?.quotationId ?? ""))
        ? quotationId
        : "";

    try {
      if (mode === "create") {
        // رقم أمر البيع لكل منشأة: 1001-SO-000001 (يُحجز عند الحفظ)
        const orderId = await nextCompanyNumber("SO", 6);
        const { data, error } = await supabase
          .from("sales_orders")
          .insert({
            id: orderId,
            ...common,
            total: totals.total.toFixed(2),
            status: "confirmed",
          })
          .select()
          .single();

        if (error || !data) {
          toast({
            title: t("تعذر حفظ أمر البيع"),
            description: t(salesOrderErrorText(error?.message)),
            variant: "destructive",
          });
          return;
        }
        const saved = mapSalesOrderRow(data);
        const quotationWarning = quotationToClose ? await closeQuotation(quotationToClose) : null;
        onSaved(saved);
        savedToast("تم حفظ أمر البيع", saved.id || orderId, quotationWarning);
        onBack();
        return;
      }

      if (!order) return;
      // لا يُعدَّل أمر مفوتر حتى لو فُوتر بعد فتح النموذج
      const { data, error } = await supabase
        .from("sales_orders")
        .update(common)
        .eq("id", order.id)
        .is("invoice_id", null)
        .select()
        .single();

      if (error || !data) {
        toast({
          title: t("تعذر تحديث أمر البيع"),
          description:
            error?.code === "PGRST116"
              ? t("لم يُحدَّث الأمر: ربما فُوتر أو لا تملك صلاحية تعديله")
              : t(salesOrderErrorText(error?.message)),
          variant: "destructive",
        });
        return;
      }
      const quotationWarning = quotationToClose ? await closeQuotation(quotationToClose) : null;
      onSaved(mapSalesOrderRow(data));
      savedToast("تم تحديث أمر البيع", order.id, quotationWarning);
      onBack();
    } catch (err) {
      toast({
        title: t(mode === "create" ? "تعذر حفظ أمر البيع" : "تعذر تحديث أمر البيع"),
        description: t(salesOrderErrorText((err as Error)?.message)),
        variant: "destructive",
      });
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };

  const customerLinked = customers.some((row) => row.id === customerId);
  const warehouseLinked = warehouses.some((row) => row.id === warehouseId);
  const money = (value: number) =>
    formatNumber(cleanZero(value), { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="space-y-6 pb-12" dir={direction}>
      <div className="flex justify-between items-center rounded-2xl bg-white border border-border/50 shadow-sm px-6 py-4 animate-fade-in-up">
        <div className="flex gap-2">
          <button
            onClick={onBack}
            disabled={saving}
            className="px-5 py-2.5 rounded-xl border-2 border-border/60 bg-white text-sm font-semibold text-foreground hover:bg-muted/30 transition-all flex items-center gap-1 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
            {t("إلغاء")}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-l from-blue-600 to-blue-500 text-sm font-bold text-white shadow-md shadow-blue-500/20 hover:shadow-lg transition-all flex items-center gap-2 disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
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
            )}
            {saving ? t("جارٍ الحفظ...") : mode === "create" ? t("حفظ الأمر") : t("حفظ التعديلات")}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-extrabold text-foreground">
            {mode === "create" ? t("إنشاء أمر بيع جديد") : t("تعديل أمر البيع")}
          </h1>
          {mode === "create" ? (
            <ShoppingCart className="h-5 w-5 text-blue-600" />
          ) : (
            <Edit className="h-5 w-5 text-emerald-600" />
          )}
        </div>
        <button
          onClick={onBack}
          disabled={saving}
          className="px-5 py-2.5 rounded-xl border-2 border-border/60 bg-white text-sm font-semibold text-muted-foreground hover:bg-muted/30 transition-all flex items-center gap-2 disabled:opacity-50"
        >
          {t("العودة للقائمة")}
          <ArrowLeftRight className="h-4 w-4" />
        </button>
      </div>

      <div className="p-4 space-y-6">
        {/* بلا overflow-hidden حتى لا تُقص قائمة عروض الأسعار المنسدلة */}
        <div className="rounded-2xl bg-white border border-border/50 shadow-sm animate-fade-in-up">
          <div className="px-6 py-4 border-b border-border/40 bg-muted/20 rounded-t-2xl flex items-center justify-end gap-2">
            <h2 className="text-sm font-bold text-foreground">{t("معلومات الأمر الأساسية")}</h2>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="space-y-1">
              <label className="text-[12px] font-semibold text-muted-foreground text-start block">
                {t("عرض السعر")} <span className="text-slate-400 font-normal">({t("المفتوحة والمرسلة فقط")})</span>
              </label>
              <QuotationPicker value={quotationId} options={quotations} onSelect={applyQuotation} />
            </div>

            <div className="space-y-1">
              <label className="text-[12px] font-semibold text-muted-foreground text-start block">
                {t("المستودع")}
              </label>
              <select
                value={warehouseId}
                onChange={(event) => chooseWarehouse(event.target.value)}
                className={FIELD_CLASS}
              >
                <option value="">{t("بدون مستودع")}</option>
                {warehouseId && !warehouseLinked && (
                  <option value={warehouseId}>{warehouse || warehouseId}</option>
                )}
                {warehouses.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.code ? `${row.code} - ${row.name}` : row.name}
                  </option>
                ))}
              </select>
              {!warehouseId && warehouse.trim() && loaded && (
                <p className="text-[11px] text-amber-700 text-start">
                  «{warehouse}» {t("غير مرتبط بمستودع؛ اختر المستودع من القائمة")}
                </p>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-[12px] font-semibold text-muted-foreground text-start block">
                {t("تاريخ التسليم المتوقع")}
              </label>
              <input
                type="date"
                value={deliveryDate}
                onChange={(event) => setDeliveryDate(event.target.value)}
                className={FIELD_CLASS}
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
                className={FIELD_CLASS}
              />
            </div>

            <div className="space-y-1 md:col-span-4">
              <label className="text-[12px] font-semibold text-muted-foreground text-start block">
                {t("العميل")} <span className="text-red-500">*</span>
              </label>
              <select
                value={customerId}
                onChange={(event) => chooseCustomer(event.target.value)}
                className={FIELD_CLASS}
              >
                <option value="">{t("اختر العميل")}</option>
                {customerId && !customerLinked && (
                  <option value={customerId}>
                    {customer || customerId}
                    {loaded ? ` (${t("غير نشط")})` : ""}
                  </option>
                )}
                {customers.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.number ? `${row.name} (${row.number})` : row.name}
                  </option>
                ))}
              </select>
              {!customerId && customer.trim() && loaded && (
                <p className="text-[11px] text-amber-700 text-start">
                  «{customer}» {t("غير مرتبط بسجل عميل؛ اختر العميل من القائمة")}
                </p>
              )}
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
                className={FIELD_CLASS}
              />
            </div>

            <div className="space-y-1 md:col-start-4">
              <label className="text-[12px] font-semibold text-muted-foreground text-start block">
                {t("مرجع الأمر")}
              </label>
              <input
                type="text"
                value={order?.id ?? ""}
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
                {items.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-muted-foreground">
                      {t("لا توجد بنود")}
                    </td>
                  </tr>
                )}
                {items.map((item) => {
                  const lineTotal = calcLine(item).total;
                  const issue = lineIssue(item);
                  const quantityInvalid = !(toNumber(item.quantity) > 0);
                  const priceInvalid = toNumber(item.price) < 0;
                  const discountInvalid =
                    toNumber(item.discount) < 0 ||
                    toNumber(item.discount) - toNumber(item.quantity) * toNumber(item.price) > 1e-9;

                  return (
                    <tr key={item.id}>
                      <td className="pt-4 align-top">
                        <div className="flex items-center justify-center gap-1 h-10">
                          <button
                            onClick={() => removeItem(item.id)}
                            title={t("حذف")}
                            aria-label={t("حذف")}
                            className="w-8 h-8 flex items-center justify-center bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                      <td className="pt-4 px-1 align-top">
                        <input
                          type="text"
                          value={money(lineTotal)}
                          disabled
                          className={cn(
                            "w-full px-2 py-2 border border-border/40 bg-muted/30 rounded-xl text-sm text-start outline-none h-10",
                            issue && "text-red-600",
                          )}
                        />
                      </td>
                      <td className="pt-4 px-1 align-top">
                        {/* النسبة 15% (أو 0% منسوخة من عرض السعر) ولا تُعدَّل يدويًا */}
                        <input
                          type="text"
                          value={`${orderTaxRate(item.taxPercent)}%`}
                          readOnly
                          disabled
                          title={t("نسبة ضريبة القيمة المضافة الأساسية")}
                          className="w-full px-2 py-2 border border-border/40 bg-muted/30 rounded-xl text-sm text-start outline-none h-10"
                        />
                      </td>
                      <td className="pt-4 px-1 align-top">
                        <input
                          type="number"
                          min="0"
                          value={item.discount}
                          onChange={(event) =>
                            updateItem(item.id, {
                              discount: Number(event.target.value) || 0,
                            })
                          }
                          className={cn(
                            "w-full px-2 py-2 border border-border/60 rounded-xl text-sm text-start focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all h-10",
                            discountInvalid && "border-red-500 bg-red-50",
                          )}
                        />
                      </td>
                      <td className="pt-4 px-1 align-top">
                        <input
                          type="number"
                          min="0"
                          value={item.price}
                          onChange={(event) =>
                            updateItem(item.id, {
                              price: Number(event.target.value) || 0,
                            })
                          }
                          className={cn(
                            "w-full px-2 py-2 border border-border/60 rounded-xl text-sm text-start focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all h-10",
                            priceInvalid && "border-red-500 bg-red-50",
                          )}
                        />
                      </td>
                      <td className="pt-4 px-1 align-top">
                        <input
                          type="number"
                          min="0"
                          value={item.quantity}
                          onChange={(event) =>
                            updateItem(item.id, {
                              quantity: Number(event.target.value) || 0,
                            })
                          }
                          className={cn(
                            "w-full px-2 py-2 border border-border/60 rounded-xl text-sm text-start focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all h-10",
                            quantityInvalid && "border-red-500 bg-red-50",
                          )}
                        />
                      </td>
                      <td className="pt-4 pl-1 align-top min-w-[320px] space-y-1.5">
                        {(catalog.items.length > 0 || item.productId) && (
                          <ItemLinkButton
                            item={item.productId ? catalogById.get(item.productId) : undefined}
                            linkedId={item.productId}
                            onOpen={() => setPickerLineId(item.id)}
                          />
                        )}
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
                        <StockHint
                          item={item.productId ? catalogById.get(item.productId) : undefined}
                          warehouseId={warehouseId}
                          requested={item.productId ? requestedQuantity(items.map((line) => ({ productId: line.productId, quantity: line.quantity })), item.productId) : 0}
                        />
                        {issue && (
                          <p className="text-[11px] font-semibold text-red-600">{t(issue)}</p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {pickerLineId !== null && (
              <ItemPickerDialog
                items={catalog.items}
                warehouses={catalog.warehouses}
                warehouseId={warehouseId}
                priceKind="sale"
                selectedId={items.find((line) => line.id === pickerLineId)?.productId}
                onSelect={(product) => pickItem(pickerLineId, product)}
                onClose={() => setPickerLineId(null)}
              />
            )}

            <div className="border-t border-slate-200 pt-4 flex justify-center mt-8">
              <div className="w-96 flex justify-between">
                <div className="space-y-2 text-end">
                  <div className="text-sm">
                    <span className="text-sm font-bold text-foreground">
                      {money(totals.tax)} {t("ريال")}
                    </span>
                  </div>
                  <div className="text-sm">
                    <span className={cn("font-bold", totals.total < 0 ? "text-red-600" : "text-blue-600")}>
                      {money(totals.total)} {t("ريال")}
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
                      {money(totals.subtotal)} {t("ريال")}
                    </span>
                  </div>
                  <div className="text-sm">
                    <span className="text-sm font-bold text-foreground">
                      {money(totals.discount)} {t("ريال")}
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
