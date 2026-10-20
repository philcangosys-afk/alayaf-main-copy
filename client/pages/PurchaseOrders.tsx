import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import Layout from "@/components/Layout";
import { purchasesFeatures } from "./Purchases";
import {
  Plus,
  X,
  Trash2,
  Eye,
  Edit,
  ClipboardCheck,
  ArrowLeftRight,
  Save,
  Loader2,
  FileText,
  Printer,
  Download,
} from "lucide-react";
import { cn, escapeHtml, riyadhDateString, SAUDI_STANDARD_VAT_RATE } from "@/lib/utils";
import { openDocumentOutput, type DocumentOutputMode } from "@/lib/pdfDownload";
import { useI18n } from "@/i18n";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabaseClient";
import { companyNumberLike, nextCompanyNumber, previewNextNumber } from "@/lib/companyNumbers";
import { COMPANY_PROFILE } from "@/lib/companyProfile";
import { dbErrorOr } from "@/lib/dbErrors";
import { selectAllRows } from "@/lib/ledgerData";
import { canManagePerm } from "@/lib/authSession";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import {
  PageHeader,
  FilterBar,
  FilterInput,
  FilterSelect,
  FilterActions,
  DataTable,
  ActionBtn,
} from "@/components/SalesPageUI";

type OrderItem = {
  id: number;
  description: string;
  unit: string;
  quantity: number;
  price: number;
  discount: number;
  taxPercent: number;
  // صنف من المخزون (اختياري): البند الحر يبقى مسموحًا بوصف إلزامي
  productId?: string;
};

type PurchaseOrderRow = {
  id: string;
  date: string;
  expectedDate: string;
  vendor: string;
  vendorId: string;
  // رقم الأمر الظاهر للمستخدم (1001-PO-000001)؛ المعرّف الداخلي id لا يُعرض
  referenceNo: string;
  notes: string;
  costCenter: string;
  costCenterName: string;
  total: string;
  status: string;
  statusColor: string;
  items: OrderItem[];
  invoiceId: string;
  // أعمدة القاعدة المحسوبة: المجموع بعد الخصم، إجمالي الخصم، الضريبة، الإجمالي
  subtotal: number | null;
  discountTotal: number | null;
  taxTotal: number | null;
  grandTotal: number | null;
};

type VendorOption = {
  id: string;
  name: string;
  vendor_number: string | null;
  currency: string | null;
  tax_number: string | null;
  status: string | null;
};

type ProductOption = {
  id: string;
  sku: string;
  name_ar: string;
  unit: string | null;
  item_type: string | null;
};

/** بيانات أمر الشراء التي تُمرَّر لشاشة فواتير المشتريات عند «تحويل إلى فاتورة» */
export type PurchaseOrderInvoiceSource = {
  id: string;
  referenceNo: string;
  vendorId: string;
  vendor: string;
  costCenter: string;
  costCenterName: string;
  items: Array<{
    description: string;
    unit: string;
    quantity: number;
    price: number;
    discount: number;
    taxPercent: number;
    productId?: string;
  }>;
};

const OPEN_STATUS = "مفتوح";
const CLOSED_STATUS = "مغلق";
const NO_COST_CENTER = "بدون مركز تكلفة";
const MAX_ITEMS = 200;

const statusColors: Record<string, string> = {
  [CLOSED_STATUS]: "bg-green-600 text-white",
  [OPEN_STATUS]: "bg-cyan-500 text-white",
};

// تقريب لخانتين مثل round(x, 2) في القاعدة، بلا "-0"
const round2 = (value: number) => {
  const rounded = Math.round(Number((Math.abs(value) * 100).toFixed(6))) / 100;
  const result = value < 0 ? -rounded : rounded;
  return Object.is(result, -0) || Math.abs(result) < 0.005 ? 0 : result;
};

const numberOrNull = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const sameName = (a: string, b: string) =>
  a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ");

function mapItem(raw: Record<string, unknown>, index: number): OrderItem {
  const productId = String(raw.productId ?? "").trim();
  return {
    id: Number(raw.id) || index + 1,
    description: String(raw.description ?? ""),
    unit: String(raw.unit ?? ""),
    quantity: Number(raw.quantity) || 0,
    price: Number(raw.price) || 0,
    discount: Number(raw.discount) || 0,
    taxPercent: Number(raw.taxPercent) || 0,
    ...(productId ? { productId } : {}),
  };
}

function mapRow(row: Record<string, unknown>): PurchaseOrderRow {
  const status = (row.status as string) || OPEN_STATUS;
  return {
    id: String(row.id ?? ""),
    date: (row.date as string) ?? "",
    expectedDate: (row.expected_date as string) ?? "",
    vendor: (row.vendor as string) ?? "",
    vendorId: String(row.vendor_id ?? ""),
    referenceNo: (row.reference_no as string) ?? "",
    notes: (row.notes as string) ?? "",
    costCenter: (row.cost_center as string) ?? "",
    costCenterName: (row.cost_center_name as string) ?? "",
    total: String(row.total ?? ""),
    status,
    statusColor: statusColors[status] ?? "bg-slate-500 text-white",
    items: Array.isArray(row.items)
      ? (row.items as Record<string, unknown>[]).map(mapItem)
      : [],
    invoiceId: String(row.invoice_id ?? ""),
    subtotal: numberOrNull(row.subtotal),
    discountTotal: numberOrNull(row.discount_total),
    taxTotal: numberOrNull(row.tax_total),
    grandTotal: numberOrNull(row.grand_total),
  };
}

/* ── الحسابات (نفس تقريب القاعدة لكل بند) ── */
type OrderTotals = { gross: number; discount: number; subtotal: number; tax: number; total: number };

const itemAmounts = (item: OrderItem) => {
  const quantity = Number(item.quantity) || 0;
  const price = Number(item.price) || 0;
  const discount = Number(item.discount) || 0;
  const net = round2(quantity * price - discount);
  const tax = round2((net * (Number(item.taxPercent) || 0)) / 100);
  return { discount: round2(discount), net, tax, total: round2(net + tax) };
};

const itemsTotals = (items: OrderItem[]): OrderTotals => {
  const sums = items.reduce(
    (acc, item) => {
      const amounts = itemAmounts(item);
      return {
        discount: round2(acc.discount + amounts.discount),
        subtotal: round2(acc.subtotal + amounts.net),
        tax: round2(acc.tax + amounts.tax),
        total: round2(acc.total + amounts.total),
      };
    },
    { discount: 0, subtotal: 0, tax: 0, total: 0 },
  );
  // الإجمالي قبل الخصم = المجموع بعد الخصم + الخصم، فتبقى المعادلة المعروضة متسقة
  return { ...sums, gross: round2(sums.subtotal + sums.discount) };
};

// أعمدة القاعدة أولًا (يحسبها المشغّل عند الحفظ)، ثم البنود، ثم الإجمالي النصي للأوامر القديمة جدًا
const orderTotals = (order: PurchaseOrderRow): OrderTotals => {
  if (order.grandTotal !== null && order.subtotal !== null) {
    const discount = round2(order.discountTotal ?? 0);
    const subtotal = round2(order.subtotal);
    return {
      gross: round2(subtotal + discount),
      discount,
      subtotal,
      tax: round2(order.taxTotal ?? 0),
      total: round2(order.grandTotal),
    };
  }
  if (order.items.length > 0) return itemsTotals(order.items);
  const total = round2(Number(order.total) || 0);
  return { gross: total, discount: 0, subtotal: total, tax: 0, total };
};

/* ── مرجع المورد: يُحفظ صراحةً في الملاحظات بسطر أول معنون، لا يختلط بها بصمت ── */
const VENDOR_REF_PREFIX = "مرجع المورد: ";

const splitOrderNotes = (value: string) => {
  const text = String(value ?? "");
  const [first = "", ...rest] = text.split("\n");
  return first.startsWith(VENDOR_REF_PREFIX)
    ? { vendorRef: first.slice(VENDOR_REF_PREFIX.length).trim(), notes: rest.join("\n").trim() }
    : { vendorRef: "", notes: text };
};

const joinOrderNotes = (vendorRef: string, notes: string) =>
  [vendorRef.trim() ? `${VENDOR_REF_PREFIX}${vendorRef.trim()}` : "", notes.trim()]
    .filter(Boolean)
    .join("\n");

/* ── رسائل أخطاء مشغّل أوامر الشراء في القاعدة ── */
const PURCHASE_ORDER_ERRORS: Array<[string, string]> = [
  ["PURCHASE_ORDER_ITEMS_REQUIRED", "أضف بندًا واحدًا على الأقل لأمر الشراء (الحد الأقصى 200 بند)"],
  ["PURCHASE_ORDER_ITEM_DESCRIPTION_REQUIRED", "اكتب وصف البند أو اختر صنفًا من المخزون"],
  ["PURCHASE_ORDER_ITEM_VALUES_INVALID", "قيم البند غير صحيحة: الكمية أكبر من صفر، والسعر والخصم لا يقلان عن صفر، والخصم لا يتجاوز الكمية × السعر"],
  ["PURCHASE_ORDER_TAX_RATE_INVALID", "نسبة الضريبة يجب أن تكون 15% أو 0%"],
  ["PURCHASE_ORDER_TOTAL_INVALID", "إجمالي أمر الشراء يجب أن يكون أكبر من صفر"],
  ["PURCHASE_ORDER_ITEM_PRODUCT_INVALID", "الصنف المختار غير موجود في أصناف المخزون"],
];

const purchaseOrderErrorText = (message: string, t: (value: string) => string) => {
  const text = String(message ?? "");
  const known = PURCHASE_ORDER_ERRORS.find(([code]) => text.includes(code));
  return known ? t(known[1]) : dbErrorOr(text);
};

// نفس قواعد مشغّل القاعدة، برسالة تحدد البند
const validateOrderItems = (items: OrderItem[], t: (value: string) => string): string | null => {
  if (items.length === 0) return t("أضف بندًا واحدًا على الأقل لأمر الشراء");
  if (items.length > MAX_ITEMS) return t("الحد الأقصى 200 بند لأمر الشراء الواحد");
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const prefix = `${t("البند")} ${index + 1}: `;
    const quantity = Number(item.quantity);
    const price = Number(item.price);
    const discount = Number(item.discount);
    if (!item.productId && !String(item.description ?? "").trim()) return prefix + t("اختر صنفًا أو اكتب وصف البند");
    if (!(quantity > 0)) return prefix + t("الكمية يجب أن تكون أكبر من صفر");
    if (!(price >= 0)) return prefix + t("السعر لا يكون سالبًا");
    if (!(discount >= 0)) return prefix + t("الخصم لا يكون سالبًا");
    if (discount > quantity * price + 1e-9) return prefix + t("الخصم لا يتجاوز قيمة البند (الكمية × السعر)");
    if (![0, SAUDI_STANDARD_VAT_RATE].includes(Number(item.taxPercent))) return prefix + t("نسبة الضريبة يجب أن تكون 15% أو 0%");
  }
  if (!(itemsTotals(items).total > 0)) return t("إجمالي أمر الشراء يجب أن يكون أكبر من صفر");
  return null;
};

const toPayloadItem = (item: OrderItem) => ({
  id: item.id,
  description: String(item.description ?? "").trim(),
  unit: String(item.unit ?? "").trim(),
  quantity: Number(item.quantity) || 0,
  price: Number(item.price) || 0,
  discount: Number(item.discount) || 0,
  taxPercent: Number(item.taxPercent) || 0,
  ...(item.productId ? { productId: item.productId } : {}),
});

const newItem = (id: number): OrderItem => ({
  id,
  description: "",
  unit: "",
  quantity: 1,
  price: 0,
  discount: 0,
  taxPercent: SAUDI_STANDARD_VAT_RATE,
});

const formatDecimal = (
  value: number,
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string
) => formatNumber(Math.abs(value) < 0.005 ? 0 : value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatCurrency = (
  value: number,
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string,
  t: (value: string) => string
) => `${formatDecimal(value, formatNumber)} ${t("ريال")}`;

const formatOrderDate = (
  value: string,
  formatDate: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string
) => (value ? formatDate(value, { dateStyle: "medium" }) : "-");

const orderNumberOf = (order: PurchaseOrderRow) => order.referenceNo || "-";

const vendorNameOf = (order: PurchaseOrderRow, vendors: VendorOption[]) =>
  order.vendor || vendors.find((vendor) => vendor.id === order.vendorId)?.name || "";

const costCenterLabel = (order: PurchaseOrderRow, t: (value: string) => string) =>
  order.costCenterName || (order.costCenter && order.costCenter !== NO_COST_CENTER ? t(order.costCenter) : "-");

const canConvertOrder = (order: PurchaseOrderRow) => order.status === OPEN_STATUS && !order.invoiceId;

export default function PurchaseOrders() {
  const { t, locale, direction, formatDate, formatNumber } = useI18n();
  const navigate = useNavigate();
  const { permissions } = useRolePermissions();
  // التحويل يغيّر الأمر (ربطه وإغلاقه) وينشئ فاتورة: يحتاج صلاحية إدارة أوامر الشراء وفواتير المشتريات معًا
  const canManageOrders = ["purchases.orders", "module.purchases"].some((key) => canManagePerm(permissions, key));
  const canManageInvoices = ["purchases.invoices", "module.purchases"].some((key) => canManagePerm(permissions, key));
  const canCreateInvoice = canManageOrders && canManageInvoices;
  const [view, setView] = useState<"list" | "create" | "details" | "edit">("list");
  const [orders, setOrders] = useState<PurchaseOrderRow[]>([]);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrderRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [converting, setConverting] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [ordersResult, vendorsResult, productsResult] = await Promise.all([
        selectAllRows((from, to) => supabase.from("purchase_orders").select("*").order("date", { ascending: false }).order("id").range(from, to)),
        selectAllRows((from, to) => supabase.from("vendors").select("id, name, vendor_number, currency, tax_number, status").order("name").order("id").range(from, to)),
        selectAllRows((from, to) => supabase.from("inventory_products").select("id, sku, name_ar, unit, item_type, active").eq("active", true).order("sku").order("id").range(from, to)),
      ]);
      if (ordersResult.error) setLoadError(dbErrorOr(ordersResult.error.message));
      else setOrders((ordersResult.data as Record<string, unknown>[]).map(mapRow));
      if (!vendorsResult.error) setVendors(vendorsResult.data as VendorOption[]);
      if (!productsResult.error) setProducts(productsResult.data as ProductOption[]);
      setLoading(false);
    };
    void load();
  }, []);

  const replaceOrder = (updated: PurchaseOrderRow) => {
    setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
    setSelectedOrder((prev) => (prev && prev.id === updated.id ? updated : prev));
  };

  const handleDelete = async (order: PurchaseOrderRow) => {
    if (order.invoiceId) {
      toast({ title: t("لا يمكن حذف أمر شراء محوّل إلى فاتورة") });
      return;
    }
    if (!confirm(`${t("هل تريد حذف هذا الأمر؟")} ${orderNumberOf(order)}`)) return;
    // لا يُحذف أمر رُبط بفاتورة في الأثناء؛ صفر صفوف = لم يُحذف شيء
    const { data: deleted, error } = await supabase
      .from("purchase_orders")
      .delete()
      .eq("id", order.id)
      .is("invoice_id", null)
      .select("id");
    if (error) {
      toast({ title: t("تعذّر الحذف"), description: dbErrorOr(error.message), variant: "destructive" });
    } else if (!deleted || deleted.length === 0) {
      toast({
        title: t("تعذّر الحذف"),
        description: t("لم يُحذف: الأمر حُوّل إلى فاتورة أو حُذف أو لا تملك الصلاحية"),
        variant: "destructive",
      });
    } else {
      setOrders((prev) => prev.filter((o) => o.id !== order.id));
      toast({ title: t("تم الحذف"), description: `${t("رقم الأمر")}: ${orderNumberOf(order)}` });
    }
  };

  // تحويل أمر مفتوح إلى فاتورة مشتريات: تُفتح شاشة الفواتير معبأة ببياناته، ويُغلق الأمر بعد حفظ الفاتورة
  const handleConvert = async (order: PurchaseOrderRow) => {
    if (!canCreateInvoice || !canConvertOrder(order) || converting) return;
    setConverting(true);
    try {
      // تأكيد من القاعدة أن الأمر ما زال مفتوحًا ولم يُحوَّل (منع التحويل مرتين)
      const { data: fresh, error: freshError } = await supabase
        .from("purchase_orders")
        .select("*")
        .eq("id", order.id)
        .maybeSingle();
      if (freshError) {
        toast({ title: t("تعذّر تحويل أمر الشراء"), description: dbErrorOr(freshError.message), variant: "destructive" });
        return;
      }
      const current = fresh ? mapRow(fresh as Record<string, unknown>) : order;
      if (!canConvertOrder(current)) {
        replaceOrder(current);
        toast({ title: t("أمر الشراء مغلق أو محوّل إلى فاتورة مسبقًا") });
        return;
      }
      // فاتورة مسجلة مسبقًا برقم هذا الأمر (ولو لم يُربط الأمر بها) تمنع التحويل مرة ثانية
      if (current.referenceNo) {
        const { data: existingInvoices, error: existingError } = await supabase
          .from("purchase_invoices")
          .select("id")
          .eq("po_number", current.referenceNo)
          .limit(1);
        if (existingError) {
          toast({ title: t("تعذّر تحويل أمر الشراء"), description: dbErrorOr(existingError.message), variant: "destructive" });
          return;
        }
        const existingInvoice = existingInvoices?.[0] as { id?: unknown } | undefined;
        if (existingInvoice) {
          toast({
            title: t("توجد فاتورة مشتريات مسجلة لأمر الشراء هذا مسبقًا"),
            description: `${t("الفاتورة")}: ${String(existingInvoice.id ?? "")} — ${t("لا يُحوَّل أمر الشراء إلى فاتورة مرتين")}`,
            variant: "destructive",
          });
          return;
        }
      }
      // أمر قديم بلا رقم: يُحجز له رقم قبل التحويل حتى يظهر في الفاتورة
      let referenceNo = current.referenceNo;
      if (!referenceNo) {
        referenceNo = await nextCompanyNumber("PO", 6);
        const { error: numberError } = await supabase
          .from("purchase_orders")
          .update({ reference_no: referenceNo })
          .eq("id", current.id);
        if (numberError) {
          toast({ title: t("تعذّر تحويل أمر الشراء"), description: dbErrorOr(numberError.message), variant: "destructive" });
          return;
        }
      }
      const vendorId = current.vendorId || vendors.find((vendor) => sameName(vendor.name, current.vendor))?.id || "";
      const source: PurchaseOrderInvoiceSource = {
        id: current.id,
        referenceNo,
        vendorId,
        vendor: vendorNameOf(current, vendors),
        costCenter: current.costCenter || NO_COST_CENTER,
        costCenterName: current.costCenterName,
        items: current.items.map((item) => ({
          description: item.description || products.find((product) => product.id === item.productId)?.name_ar || "",
          unit: item.unit,
          quantity: Number(item.quantity) || 0,
          price: Number(item.price) || 0,
          discount: Number(item.discount) || 0,
          taxPercent: Number(item.taxPercent) || 0,
          ...(item.productId ? { productId: item.productId } : {}),
        })),
      };
      navigate("/purchases/invoices", { state: { fromPurchaseOrder: source } });
    } catch (convertError) {
      toast({
        title: t("تعذّر تحويل أمر الشراء"),
        description: convertError instanceof Error ? dbErrorOr(convertError.message) : t("حاول مرة أخرى"),
        variant: "destructive",
      });
    } finally {
      setConverting(false);
    }
  };

  // S18: «PDF» يُحمَّل ملفًا مباشرة، و«طباعة» تفتح نافذة الطباعة (المستند نفسه)
  const handlePrintPdf = (order: PurchaseOrderRow, mode: DocumentOutputMode = "download") => {
    const printWindow = openDocumentOutput(mode, order.referenceNo || order.id);
    if (!printWindow) return;

    const vendorInfo = vendors.find((vendor) => vendor.id === order.vendorId);
    const totals = orderTotals(order);
    const { vendorRef, notes } = splitOrderNotes(order.notes);
    const amount = (value: number) => escapeHtml(formatDecimal(value, formatNumber));
    const sar = escapeHtml(t("ريال"));

    const rowsHtml = order.items.length > 0
      ? order.items.map((item, index) => {
          const amounts = itemAmounts(item);
          const sku = products.find((product) => product.id === item.productId)?.sku;
          return `<tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(item.description || "-")}${sku ? `<br><small>${escapeHtml(sku)}</small>` : ""}</td>
        <td>${escapeHtml(item.unit || "-")}</td>
        <td>${escapeHtml(formatNumber(Number(item.quantity) || 0))}</td>
        <td>${amount(Number(item.price) || 0)}</td>
        <td>${amount(amounts.discount)}</td>
        <td>${amount(amounts.tax)}<br><small>${escapeHtml(formatNumber(Number(item.taxPercent) || 0))}%</small></td>
        <td>${amount(amounts.total)}</td>
      </tr>`;
        }).join("")
      : `<tr><td colspan="8">${escapeHtml(t("لا توجد بنود"))}</td></tr>`;

    const card = (label: string, value: string) =>
      `<div class="card"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(value || "-")}</span></div>`;

    printWindow.document.write(`
      <html dir="${direction}" lang="${locale}">
        <head>
          <title>${escapeHtml(t("أمر شراء"))} ${escapeHtml(order.referenceNo)}</title>
          <meta charset="utf-8"/>
          <style>
            @page{size:A4 portrait;margin:10mm}
            *{box-sizing:border-box}
            body{font-family:Arial,Tahoma,sans-serif;margin:0;color:#111827;background:#fff}
            .sheet{max-width:190mm;margin:0 auto;border:1px solid #d1d5db;padding:10px 12px}
            .company-row{display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:center}
            .company-ar,.company-en{font-size:10.5px;line-height:1.55}
            .company-ar{text-align:right}.company-en{text-align:left;direction:ltr}
            .company-logo{width:120px;height:72px;object-fit:contain;display:block;margin:0 auto}
            .title{text-align:center;font-size:23px;font-weight:700;margin:8px 0 10px;color:#1b8c56}
            .meta{border:1px solid #d1d5db;margin-bottom:10px}
            .grid{display:grid;grid-template-columns:1fr 1fr}
            .card{padding:6px 8px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;gap:8px;font-size:11px}
            .card:nth-child(odd){border-left:1px solid #e5e7eb}
            .label{color:#4b5563}.value{font-weight:700;text-align:left}
            table{width:100%;border-collapse:collapse;font-size:11px}
            th,td{border:1px solid #d1d5db;padding:6px 4px;text-align:center;vertical-align:middle}
            th{background:#f3f4f6;font-weight:700}
            .bottom{display:grid;grid-template-columns:1fr 280px;gap:14px;margin-top:12px;align-items:start}
            .notes{font-size:11px;line-height:1.7;border:1px solid #e5e7eb;padding:8px;min-height:78px;white-space:pre-line}
            .totals{font-size:12px;border-top:1px solid #d1d5db;padding-top:6px}
            .totals-row{display:flex;justify-content:space-between;margin-bottom:7px}
            .final{font-size:14px;font-weight:700;border-top:1px solid #d1d5db;padding-top:7px}
            .footer{margin-top:14px;padding-top:8px;border-top:1px solid #d1d5db;text-align:center;color:#6b7280;font-size:9px}
          </style>
        </head>
        <body>
          <main class="sheet">
            <div class="company-row">
              <div class="company-ar"><strong>${escapeHtml(COMPANY_PROFILE.companyNameAr)}</strong><br>${escapeHtml(COMPANY_PROFILE.addressAr)}<br>${escapeHtml(t("الرقم الضريبي"))} ${escapeHtml(COMPANY_PROFILE.vatNumber)}<br>${escapeHtml(t("السجل التجاري"))} ${escapeHtml(COMPANY_PROFILE.commercialRegistration)}</div>
              <img src="${escapeHtml(COMPANY_PROFILE.logoUrl)}" class="company-logo" alt="${escapeHtml(t("شعار الشركة"))}">
              <div class="company-en"><strong>${escapeHtml(COMPANY_PROFILE.companyNameEn)}</strong><br>${escapeHtml(COMPANY_PROFILE.addressEn)}<br>VAT No. ${escapeHtml(COMPANY_PROFILE.vatNumber)}<br>CR No. ${escapeHtml(COMPANY_PROFILE.commercialRegistration)}</div>
            </div>
            <div class="title">${escapeHtml(t("أمر شراء"))} | Purchase Order</div>
            <section class="meta"><div class="grid">
              ${card(`${t("رقم الأمر")} / PO No.`, order.referenceNo)}
              ${card(`${t("الحالة")} / Status`, t(order.status))}
              ${card(`${t("المورد")} / Vendor`, vendorNameOf(order, vendors))}
              ${card(t("الرقم الضريبي للمورد"), vendorInfo?.tax_number ?? "")}
              ${card(t("تاريخ الأمر"), formatOrderDate(order.date, formatDate))}
              ${card(t("تاريخ الاستلام المتوقع"), formatOrderDate(order.expectedDate, formatDate))}
              ${card(t("المشروع / مركز التكلفة"), costCenterLabel(order, t))}
              ${card(t("مرجع المورد"), vendorRef)}
              ${order.invoiceId ? card(t("فاتورة المشتريات"), order.invoiceId) : ""}
            </div></section>
            <table>
              <thead><tr><th>#</th><th>${escapeHtml(t("وصف البند"))}<br>Description</th><th>${escapeHtml(t("الوحدة"))}<br>Unit</th><th>${escapeHtml(t("الكمية"))}<br>Qty</th><th>${escapeHtml(t("السعر"))}<br>Price</th><th>${escapeHtml(t("الخصم"))}<br>Discount</th><th>${escapeHtml(t("الضريبة"))}<br>VAT</th><th>${escapeHtml(t("الإجمالي"))}<br>Total</th></tr></thead>
              <tbody>${rowsHtml}</tbody>
            </table>
            <div class="bottom">
              <div class="notes"><strong>${escapeHtml(t("ملاحظات"))} / Notes</strong><br>${escapeHtml(notes || t("لا توجد ملاحظات"))}</div>
              <div class="totals">
                <div class="totals-row"><span>${escapeHtml(t("الإجمالي قبل الخصم"))}</span><strong>${amount(totals.gross)} ${sar}</strong></div>
                <div class="totals-row"><span>${escapeHtml(t("الخصم"))}</span><strong>${amount(totals.discount)} ${sar}</strong></div>
                <div class="totals-row"><span>${escapeHtml(t("المجموع بعد الخصم"))}</span><strong>${amount(totals.subtotal)} ${sar}</strong></div>
                <div class="totals-row"><span>${escapeHtml(t("ضريبة القيمة المضافة"))}</span><strong>${amount(totals.tax)} ${sar}</strong></div>
                <div class="totals-row final"><span>${escapeHtml(t("الإجمالي"))}</span><strong>${amount(totals.total)} ${sar}</strong></div>
              </div>
            </div>
            <div class="footer">${escapeHtml(COMPANY_PROFILE.companyNameAr)} | ${escapeHtml(COMPANY_PROFILE.companyNameEn)}</div>
          </main>
        </body>
      </html>
    `);
    printWindow.document.close();
    let printed = false;
    const triggerPrint = () => {
      if (printed) return;
      printed = true;
      printWindow.focus();
      printWindow.print();
    };
    const logo = printWindow.document.querySelector(".company-logo") as HTMLImageElement | null;
    if (logo && !logo.complete) {
      logo.addEventListener("load", triggerPrint, { once: true });
      logo.addEventListener("error", triggerPrint, { once: true });
      window.setTimeout(triggerPrint, 3000);
    } else {
      window.setTimeout(triggerPrint, 150);
    }
  };

  return (
    <Layout subMenu={{ title: t("المشتريات"), items: purchasesFeatures }}>
      <div dir={direction} className="mx-auto max-w-7xl">
        {view === "list" && (
          <OrdersList
            orders={orders}
            vendors={vendors}
            loading={loading}
            loadError={loadError}
            canConvert={(order) => canCreateInvoice && canConvertOrder(order)}
            converting={converting}
            onCreateClick={() => setView("create")}
            onView={(order) => { setSelectedOrder(order); setView("details"); }}
            onEdit={(order) => { setSelectedOrder(order); setView("edit"); }}
            onDelete={handleDelete}
            onPrintPdf={(order) => handlePrintPdf(order, "download")}
            onPrint={(order) => handlePrintPdf(order, "print")}
            onConvert={(order) => void handleConvert(order)}
          />
        )}
        {view === "create" && (
          <OrderEditor
            vendors={vendors}
            products={products}
            onBack={() => setView("list")}
            onSaved={(order) => {
              setOrders((prev) => [order, ...prev]);
              toast({ title: t("تم حفظ أمر الشراء"), description: `${t("رقم الأمر")}: ${orderNumberOf(order)}` });
              setView("list");
            }}
          />
        )}
        {view === "details" && selectedOrder && (
          <OrderDetails
            order={selectedOrder}
            vendors={vendors}
            products={products}
            canConvert={canCreateInvoice && canConvertOrder(selectedOrder)}
            converting={converting}
            onBack={() => setView("list")}
            onEdit={() => { if (!selectedOrder.invoiceId) setView("edit"); }}
            onPrintPdf={(order) => handlePrintPdf(order, "download")}
            onPrint={(order) => handlePrintPdf(order, "print")}
            onConvert={(order) => void handleConvert(order)}
          />
        )}
        {view === "edit" && selectedOrder && (
          <OrderEditor
            order={selectedOrder}
            vendors={vendors}
            products={products}
            onBack={() => setView("list")}
            onSaved={(updated) => {
              replaceOrder(updated);
              toast({ title: t("تم تحديث أمر الشراء"), description: `${t("رقم الأمر")}: ${orderNumberOf(updated)}` });
              setView("list");
            }}
          />
        )}
      </div>
    </Layout>
  );
}

/* ── رابط فاتورة المشتريات للأمر المحوّل ── */
function InvoiceLink({ invoiceId }: { invoiceId: string }) {
  const { t } = useI18n();
  return (
    <Link
      to="/purchases/invoices"
      state={{ openInvoiceId: invoiceId }}
      className="inline-flex items-center gap-1 text-xs font-semibold text-purple-700 hover:underline"
    >
      <FileText className="h-3.5 w-3.5" />
      {t("فاتورة")} {invoiceId}
    </Link>
  );
}

/* ── List ── */
function OrdersList({
  orders,
  vendors,
  loading,
  loadError,
  canConvert,
  converting,
  onCreateClick,
  onView,
  onEdit,
  onDelete,
  onPrintPdf,
  onPrint,
  onConvert,
}: {
  orders: PurchaseOrderRow[];
  vendors: VendorOption[];
  loading: boolean;
  loadError: string;
  canConvert: (o: PurchaseOrderRow) => boolean;
  converting: boolean;
  onCreateClick: () => void;
  onView: (o: PurchaseOrderRow) => void;
  onEdit: (o: PurchaseOrderRow) => void;
  onDelete: (o: PurchaseOrderRow) => void;
  onPrintPdf: (o: PurchaseOrderRow) => void;
  onPrint: (o: PurchaseOrderRow) => void;
  onConvert: (o: PurchaseOrderRow) => void;
}) {
  const { t, formatDate, formatNumber } = useI18n();
  const [search, setSearch] = useState("");
  const [vendorFilter, setVendorFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const vendorNames = useMemo(
    () =>
      Array.from(new Set(orders.map((order) => vendorNameOf(order, vendors).trim()).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b, "ar")),
    [orders, vendors],
  );
  const statuses = useMemo(
    () => Array.from(new Set([OPEN_STATUS, CLOSED_STATUS, ...orders.map((order) => order.status).filter(Boolean)])),
    [orders],
  );

  const query = search.trim().toLowerCase();
  const filteredOrders = orders.filter((order) => {
    const matchesSearch =
      !query ||
      [order.referenceNo, vendorNameOf(order, vendors), order.notes, order.costCenterName, order.invoiceId]
        .join(" ")
        .toLowerCase()
        .includes(query);
    return (
      matchesSearch &&
      (!vendorFilter || vendorNameOf(order, vendors).trim() === vendorFilter) &&
      (!statusFilter || order.status === statusFilter)
    );
  });

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
        <FilterInput
          placeholder={t("رقم أمر الشراء، المرجع، اسم المورد...")}
          value={search}
          onChange={setSearch}
        />
        <FilterSelect label={t("المورد")} value={vendorFilter} onChange={setVendorFilter}>
          <option value="">{t("الكل")}</option>
          {vendorNames.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </FilterSelect>
        <FilterSelect label={t("الحالة")} value={statusFilter} onChange={setStatusFilter}>
          <option value="">{t("الكل")}</option>
          {statuses.map((status) => (
            <option key={status} value={status}>{t(status)}</option>
          ))}
        </FilterSelect>
        <FilterActions onReset={() => { setSearch(""); setVendorFilter(""); setStatusFilter(""); }} />
      </FilterBar>

      {loadError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm text-right">
          {t("تعذر تحميل أوامر الشراء")}: {loadError}
        </div>
      )}

      <DataTable
        headers={[t("الإجراءات"), t("الحالة"), t("المجموع"), t("المورد"), t("تاريخ الأمر"), t("رقم الأمر")]}
        gradient="from-violet-800 to-purple-900"
      >
        {filteredOrders.map((order) => (
          <tr key={order.id} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
            <td className="px-5 py-3.5 align-middle">
              <div className="flex items-center gap-1">
                <ActionBtn icon={Eye} label={t("عرض")} color="blue" onClick={() => onView(order)} />
                {!order.invoiceId && <ActionBtn icon={Edit} label={t("تعديل")} color="emerald" onClick={() => onEdit(order)} />}
                {!order.invoiceId && <ActionBtn icon={Trash2} label={t("حذف")} color="red" onClick={() => onDelete(order)} />}
                <button
                  title={t("تحميل PDF")}
                  onClick={() => onPrintPdf(order)}
                  className="px-2.5 py-1.5 text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors text-xs font-semibold"
                >
                  PDF
                </button>
                <button
                  title={t("طباعة")}
                  aria-label={t("طباعة")}
                  onClick={() => onPrint(order)}
                  className="px-2 py-1.5 text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors"
                >
                  <Printer className="h-3.5 w-3.5" />
                </button>
                {canConvert(order) && (
                  <ActionBtn
                    icon={FileText}
                    label={converting ? t("جارٍ التحويل...") : t("تحويل إلى فاتورة")}
                    color="indigo"
                    onClick={() => { if (!converting) onConvert(order); }}
                  />
                )}
              </div>
            </td>
            <td className="px-5 py-3.5 align-middle">
              <div className="flex flex-col items-start gap-1">
                <span className={cn("inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold", order.statusColor)}>
                  {t(order.status)}
                </span>
                {order.invoiceId && <InvoiceLink invoiceId={order.invoiceId} />}
              </div>
            </td>
            <td className="px-5 py-3.5 align-middle font-medium whitespace-nowrap">{formatCurrency(orderTotals(order).total, formatNumber, t)}</td>
            <td className="px-5 py-3.5 align-middle">{vendorNameOf(order, vendors) || "-"}</td>
            <td className="px-5 py-3.5 align-middle text-muted-foreground">{formatOrderDate(order.date, formatDate)}</td>
            <td
              className="px-5 py-3.5 align-middle font-semibold text-violet-600 hover:underline cursor-pointer whitespace-nowrap"
              onClick={() => onView(order)}
            >
              {orderNumberOf(order)}
            </td>
          </tr>
        ))}
        {filteredOrders.length === 0 && (
          <tr>
            <td colSpan={6} className="px-5 py-12 text-center text-muted-foreground">
              {loading ? t("جاري التحميل...") : t("لا توجد أوامر شراء")}
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
  vendors,
  products,
  canConvert,
  converting,
  onBack,
  onEdit,
  onPrintPdf,
  onPrint,
  onConvert,
}: {
  order: PurchaseOrderRow;
  vendors: VendorOption[];
  products: ProductOption[];
  canConvert: boolean;
  converting: boolean;
  onBack: () => void;
  onEdit: () => void;
  onPrintPdf: (o: PurchaseOrderRow) => void;
  onPrint: (o: PurchaseOrderRow) => void;
  onConvert: (o: PurchaseOrderRow) => void;
}) {
  const { t, direction, formatDate, formatNumber } = useI18n();
  const totals = orderTotals(order);
  const vendorInfo = vendors.find((vendor) => vendor.id === order.vendorId);
  const { vendorRef, notes } = splitOrderNotes(order.notes);

  const fields: Array<{ label: string; value: ReactNode }> = [
    { label: t("رقم الأمر"), value: orderNumberOf(order) },
    { label: t("المورد"), value: vendorNameOf(order, vendors) || "-" },
    { label: t("الرقم الضريبي للمورد"), value: vendorInfo?.tax_number || "-" },
    { label: t("تاريخ الأمر"), value: formatOrderDate(order.date, formatDate) },
    { label: t("تاريخ الاستلام المتوقع"), value: formatOrderDate(order.expectedDate, formatDate) },
    { label: t("المشروع / مركز التكلفة"), value: costCenterLabel(order, t) },
    { label: t("مرجع المورد"), value: vendorRef || "-" },
    { label: t("الإجمالي"), value: formatCurrency(totals.total, formatNumber, t) },
    { label: t("الحالة"), value: t(order.status) },
  ];
  if (order.invoiceId) fields.push({ label: t("فاتورة المشتريات"), value: <InvoiceLink invoiceId={order.invoiceId} /> });

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
            <Download className="h-4 w-4" /> {t("تحميل PDF")}
          </button>
          <button onClick={() => onPrint(order)} className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-sm rounded hover:bg-slate-50 flex items-center gap-2">
            <Printer className="h-4 w-4" /> {t("طباعة")}
          </button>
          {canConvert && (
            <button
              onClick={() => onConvert(order)}
              disabled={converting}
              className="px-4 py-2 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 flex items-center gap-2 disabled:opacity-60"
            >
              {converting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              {t("تحويل إلى فاتورة")}
            </button>
          )}
          {!order.invoiceId && (
            <button onClick={onEdit} className="px-4 py-2 bg-emerald-600 text-white text-sm rounded hover:bg-emerald-700 flex items-center gap-2">
              <Edit className="h-4 w-4" /> {t("تعديل")}
            </button>
          )}
        </div>
      </div>

      <div className="p-4 space-y-6">
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
            <h2 className="font-semibold text-slate-800 text-right">{t("بيانات الأمر")}</h2>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
            {fields.map(({ label, value }) => (
              <div key={label} className="space-y-1">
                <div className="text-xs text-slate-500 text-right">{label}</div>
                <div className="text-sm font-semibold text-right">{value}</div>
              </div>
            ))}
            {notes && (
              <div className="md:col-span-3 space-y-1">
                <div className="text-xs text-slate-500 text-right">{t("ملاحظات")}</div>
                <div className="text-sm text-right whitespace-pre-line">{notes}</div>
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
                  <th className="px-3 py-2 border border-slate-200">#</th>
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
                {order.items.map((item, idx) => {
                  const amounts = itemAmounts(item);
                  const product = products.find((option) => option.id === item.productId);
                  return (
                    <tr key={idx}>
                      <td className="px-3 py-2 border border-slate-200">{idx + 1}</td>
                      <td className="px-3 py-2 border border-slate-200">
                        {item.description || product?.name_ar || "-"}
                        {product && <div className="text-xs text-slate-500">{product.sku}</div>}
                      </td>
                      <td className="px-3 py-2 border border-slate-200">{item.unit || "-"}</td>
                      <td className="px-3 py-2 border border-slate-200">{formatNumber(Number(item.quantity) || 0)}</td>
                      <td className="px-3 py-2 border border-slate-200">{formatCurrency(Number(item.price) || 0, formatNumber, t)}</td>
                      <td className="px-3 py-2 border border-slate-200">{formatCurrency(amounts.discount, formatNumber, t)}</td>
                      <td className="px-3 py-2 border border-slate-200">{formatCurrency(amounts.tax, formatNumber, t)} ({formatNumber(Number(item.taxPercent) || 0)}%)</td>
                      <td className="px-3 py-2 border border-slate-200">{formatCurrency(amounts.total, formatNumber, t)}</td>
                    </tr>
                  );
                })}
                {order.items.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 border border-slate-200 text-center text-slate-500">{t("لا توجد بنود")}</td>
                  </tr>
                )}
              </tbody>
            </table>

            <OrderTotalsBox totals={totals} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── ملخص الإجماليات: قبل الخصم ← الخصم ← بعد الخصم ← الضريبة ← الإجمالي ── */
function OrderTotalsBox({ totals }: { totals: OrderTotals }) {
  const { t, formatNumber } = useI18n();
  const rows = [
    { label: t("الإجمالي قبل الخصم"), value: totals.gross },
    { label: t("الخصم"), value: totals.discount },
    { label: t("المجموع بعد الخصم"), value: totals.subtotal },
    { label: t("الضريبة"), value: totals.tax },
  ];
  return (
    <div className="flex justify-end mt-6">
      <div className="w-72 space-y-2 text-sm">
        {rows.map(({ label, value }) => (
          <div key={label} className="flex justify-between">
            <span className="font-semibold">{formatCurrency(value, formatNumber, t)}</span>
            <span className="text-slate-600">{label}</span>
          </div>
        ))}
        <div className="flex justify-between border-t border-slate-200 pt-2">
          <span className="font-bold text-blue-600">{formatCurrency(totals.total, formatNumber, t)}</span>
          <span className="font-bold text-slate-800">{t("الإجمالي")}</span>
        </div>
      </div>
    </div>
  );
}

/* ── Create / Edit Form ── */
function OrderEditor({
  order,
  vendors,
  products,
  onBack,
  onSaved,
}: {
  order?: PurchaseOrderRow;
  vendors: VendorOption[];
  products: ProductOption[];
  onBack: () => void;
  onSaved: (order: PurchaseOrderRow) => void;
}) {
  const { t, direction, formatNumber } = useI18n();
  const isEdit = Boolean(order);
  const accent = isEdit ? "focus:border-emerald-500 focus:ring-emerald-500" : "focus:border-blue-500 focus:ring-blue-500";
  const inputClass = `w-full px-3 py-2 border border-slate-300 rounded text-sm text-right ${accent} focus:ring-1 outline-none`;
  const cellInputClass = `w-full px-2 py-1 border border-slate-300 rounded text-xs text-right ${accent} outline-none`;

  const [form, setForm] = useState(() => {
    const parsedNotes = splitOrderNotes(order?.notes ?? "");
    return {
      vendorId: order?.vendorId ?? "",
      vendor: order?.vendor ?? "",
      // التواريخ الافتراضية بتوقيت الرياض
      date: order?.date || riyadhDateString(),
      expectedDate: order ? order.expectedDate : riyadhDateString(7),
      vendorRef: parsedNotes.vendorRef,
      notes: parsedNotes.notes,
      costCenter: order?.costCenter || NO_COST_CENTER,
      costCenterName: order?.costCenterName ?? "",
      status: order?.status || OPEN_STATUS,
    };
  });

  const [items, setItems] = useState<OrderItem[]>(
    order && order.items.length > 0
      ? order.items.map((item, idx) => ({ ...item, id: idx + 1 }))
      : [newItem(1)]
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [numberPreview, setNumberPreview] = useState("");
  const [costCenterNames, setCostCenterNames] = useState<string[]>([]);

  const activeVendors = vendors.filter((vendor) => !vendor.status || vendor.status === "نشط");

  useEffect(() => {
    const loadExtras = async () => {
      // عرض فقط: الرقم الفعلي يُحجز عند الحفظ
      if (!order?.referenceNo) {
        const { data } = await supabase
          .from("purchase_orders")
          .select("reference_no")
          .like("reference_no", companyNumberLike("PO"))
          .order("reference_no", { ascending: false })
          .limit(1);
        setNumberPreview(previewNextNumber(data?.[0]?.reference_no, "PO", 6));
      }
      // اقتراحات المشروع/مركز التكلفة من مراكز التكلفة النشطة (يبقى الإدخال الحر ممكنًا)
      const { data: centers } = await supabase
        .from("cost_centers")
        .select("code, name_ar, active")
        .eq("active", true)
        .order("code");
      setCostCenterNames(
        Array.from(new Set(((centers ?? []) as { name_ar: string | null }[]).map((center) => String(center.name_ar ?? "").trim()).filter(Boolean)))
      );
    };
    void loadExtras();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // أمر قديم بلا مورد مربوط: يُربط تلقائيًا بالمورد المسجل بنفس الاسم إن وُجد
  useEffect(() => {
    if (form.vendorId || !form.vendor.trim()) return;
    const match = activeVendors.find((vendor) => sameName(vendor.name, form.vendor));
    if (match) setForm((prev) => ({ ...prev, vendorId: match.id, vendor: match.name }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendors]);

  const setField = (field: keyof typeof form, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const chooseVendor = (vendorId: string) => {
    const vendor = vendors.find((option) => option.id === vendorId);
    setForm((prev) => ({ ...prev, vendorId: vendor?.id ?? "", vendor: vendor?.name ?? (vendorId ? prev.vendor : "") }));
  };

  const addItem = () => {
    if (items.length >= MAX_ITEMS) {
      setError(t("الحد الأقصى 200 بند لأمر الشراء الواحد"));
      return;
    }
    setItems((prev) => [...prev, newItem(Date.now())]);
  };

  const updateItem = (id: number, changes: Partial<OrderItem>) =>
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...changes } : item)));

  // اختيار صنف من المخزون يملأ الوصف والوحدة؛ "بند حر" يلغي الربط ويُبقي الوصف للتعديل
  const chooseProduct = (id: number, productId: string) => {
    const product = products.find((option) => option.id === productId);
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        if (!product) {
          const { productId: _removed, ...rest } = item;
          return rest;
        }
        return { ...item, productId: product.id, description: product.name_ar, unit: product.unit ?? item.unit };
      })
    );
  };

  const removeItem = (id: number) =>
    setItems((prev) => prev.filter((item) => item.id !== id));

  const totals = itemsTotals(items);

  const handleSave = async () => {
    if (saving) return;
    if (order?.invoiceId) { setError(t("لا يمكن تعديل أمر شراء محوّل إلى فاتورة")); return; }
    if (!form.date) { setError(t("يرجى إدخال تاريخ أمر الشراء")); return; }
    if (form.expectedDate && form.expectedDate < form.date) { setError(t("تاريخ الاستلام المتوقع يجب ألا يسبق تاريخ الأمر")); return; }
    // المورد من قائمة الموردين؛ الأمر القديم بمورد نصي فقط يبقى كما هو إن لم يُختر مورد
    if (!form.vendorId && !(isEdit && form.vendor.trim())) { setError(t("يرجى اختيار المورد")); return; }
    const itemsError = validateOrderItems(items, t);
    if (itemsError) { setError(itemsError); return; }

    setSaving(true);
    setError(null);
    try {
      // رقم الأمر يُحجز تلقائيًا عند الحفظ (1001-PO-000001)، ولا يُعدَّل يدويًا
      let referenceNo = order?.referenceNo ?? "";
      if (!referenceNo) {
        try {
          referenceNo = await nextCompanyNumber("PO", 6);
        } catch {
          setError(t("تعذر حجز رقم أمر الشراء، حاول مرة أخرى"));
          return;
        }
      }

      const vendor = vendors.find((option) => option.id === form.vendorId);
      const fields = {
        vendor_id: form.vendorId || null,
        vendor: (vendor?.name ?? form.vendor).trim(),
        date: form.date,
        expected_date: form.expectedDate || null,
        reference_no: referenceNo,
        notes: joinOrderNotes(form.vendorRef, form.notes) || null,
        cost_center: form.costCenter || NO_COST_CENTER,
        cost_center_name: form.costCenterName.trim() || null,
        total: totals.total.toFixed(2),
        items: items.map(toPayloadItem),
      };

      const id = order?.id ?? crypto.randomUUID();
      const status = isEdit ? form.status : OPEN_STATUS;
      // التعديل لا يمس أمرًا رُبط بفاتورة في الأثناء
      const result = order
        ? await supabase
            .from("purchase_orders")
            .update({ ...fields, status })
            .eq("id", order.id)
            .is("invoice_id", null)
            .select("*")
            .maybeSingle()
        : await supabase.from("purchase_orders").insert([{ id, ...fields, status }]).select("*").maybeSingle();

      if (result.error) {
        setError(`${t(isEdit ? "تعذّر التحديث" : "حدث خطأ أثناء الحفظ")}: ${purchaseOrderErrorText(result.error.message, t)}`);
        return;
      }
      // صفر صفوف محدَّثة = لم يُحفظ شيء (لا يُعرض نجاح)
      if (order && !result.data) {
        setError(t("لم يُحفظ: الأمر حُوّل إلى فاتورة أو حُذف أو لا تملك الصلاحية"));
        return;
      }

      const savedItems = items.map((item) => ({ ...item, description: item.description.trim(), unit: item.unit.trim() }));
      onSaved(
        result.data
          ? mapRow(result.data as Record<string, unknown>)
          : {
              id,
              date: form.date,
              expectedDate: form.expectedDate,
              vendor: fields.vendor,
              vendorId: form.vendorId,
              referenceNo,
              notes: fields.notes ?? "",
              costCenter: fields.cost_center,
              costCenterName: fields.cost_center_name ?? "",
              total: fields.total,
              status,
              statusColor: statusColors[status] ?? "bg-slate-500 text-white",
              items: savedItems,
              invoiceId: order?.invoiceId ?? "",
              subtotal: totals.subtotal,
              discountTotal: totals.discount,
              taxTotal: totals.tax,
              grandTotal: totals.total,
            }
      );
    } catch (saveError) {
      setError(
        `${t(isEdit ? "تعذّر التحديث" : "حدث خطأ أثناء الحفظ")}: ${
          saveError instanceof Error ? purchaseOrderErrorText(saveError.message, t) : t("حاول مرة أخرى")
        }`
      );
    } finally {
      setSaving(false);
    }
  };

  const legacyVendorOnly = !form.vendorId && Boolean(form.vendor.trim());
  const selectedVendorMissing = Boolean(form.vendorId) && !activeVendors.some((vendor) => vendor.id === form.vendorId);

  return (
    <div dir={direction} className="mx-auto max-w-5xl">
      <div className="space-y-6 bg-white min-h-screen pb-12">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-slate-200">
          <div className="flex gap-2">
            <button onClick={onBack} disabled={saving} className="px-4 py-2 bg-slate-500 text-white text-sm rounded hover:bg-slate-600 flex items-center gap-1 disabled:opacity-50">
              <X className="h-4 w-4" /> {t("إلغاء")}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className={cn(
                "px-4 py-2 text-white text-sm rounded flex items-center gap-2 disabled:opacity-60",
                isEdit ? "bg-emerald-600 hover:bg-emerald-700" : "bg-blue-600 hover:bg-blue-700"
              )}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? t("جارٍ الحفظ...") : isEdit ? t("حفظ التعديلات") : t("حفظ أمر الشراء")}
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
              <div className="text-xs opacity-75">{t("الرقم الضريبي")}</div>
              <div className="text-sm font-medium">{COMPANY_PROFILE.vatNumber}</div>
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
                <label className="text-sm font-medium text-slate-700 text-right block">{t("رقم امر الشراء")}</label>
                <input
                  type="text"
                  value={order?.referenceNo || numberPreview || t("يُحجز عند الحفظ")}
                  readOnly
                  disabled
                  className="w-full px-3 py-2 border border-slate-200 bg-slate-100 rounded text-sm text-right outline-none text-slate-500"
                />
                {!order?.referenceNo && (
                  <p className="text-xs text-slate-500 text-right">{t("يُحجز الرقم تلقائيًا عند الحفظ")}</p>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-slate-700 text-right block">{t("المورد")} *</label>
                <select
                  value={form.vendorId}
                  onChange={(e) => chooseVendor(e.target.value)}
                  className={cn(inputClass, "bg-white")}
                >
                  <option value="">{t("اختر المورد")}</option>
                  {selectedVendorMissing && <option value={form.vendorId}>{form.vendor}</option>}
                  {activeVendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {vendor.vendor_number ? `${vendor.vendor_number} - ` : ""}{vendor.name}
                    </option>
                  ))}
                </select>
                {legacyVendorOnly && (
                  <p className="text-xs text-amber-700 text-right">
                    {t("المورد المسجل في الأمر")}: {form.vendor} — {t("اختر المورد من القائمة لربطه")}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium text-slate-700 text-right block">{t("العملة")} *</label>
                <input
                  type="text"
                  value="SAR"
                  readOnly
                  className={inputClass}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-slate-700 text-right block">{t("التاريخ")} *</label>
                <input
                  type="date"
                  value={form.date ?? ""}
                  onChange={(e) => setField("date", e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium text-slate-700 text-right block">{t("المشروع / مركز التكلفة")}</label>
                <input
                  value={form.costCenterName}
                  onChange={(e) => setField("costCenterName", e.target.value)}
                  placeholder={t("اختياري")}
                  list="purchase-order-cost-centers"
                  className={inputClass}
                />
                <datalist id="purchase-order-cost-centers">
                  {costCenterNames.map((name) => <option key={name} value={name} />)}
                </datalist>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-slate-700 text-right block">{t("تاريخ الاستلام المتوقع")}</label>
                <input
                  type="date"
                  value={form.expectedDate ?? ""}
                  min={form.date || undefined}
                  onChange={(e) => setField("expectedDate", e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium text-slate-700 text-right block">{t("مرجع المورد")}</label>
                <input
                  value={form.vendorRef}
                  onChange={(e) => setField("vendorRef", e.target.value)}
                  placeholder={t("اختياري — مثل رقم عرض السعر")}
                  className={inputClass}
                />
                <p className="text-xs text-slate-500 text-right">{t("يُحفظ في الملاحظات بعنوان «مرجع المورد»")}</p>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-slate-700 text-right block">{t("ملاحظات")}</label>
                <input
                  value={form.notes}
                  onChange={(e) => setField("notes", e.target.value)}
                  placeholder={t("اختياري")}
                  className={inputClass}
                />
              </div>
            </div>

            {isEdit && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700 text-right block">{t("الحالة")}</label>
                  <select value={form.status} onChange={(e) => setField("status", e.target.value)} className={cn(inputClass, "bg-white")}>
                    <option value={OPEN_STATUS}>{t(OPEN_STATUS)}</option>
                    <option value={CLOSED_STATUS}>{t(CLOSED_STATUS)}</option>
                  </select>
                </div>
              </div>
            )}

            {/* Items Section */}
            <div className="mt-8 space-y-4">
              <div className="flex justify-between items-center">
                <button
                  onClick={addItem}
                  className="bg-[#1b8c56] text-white px-3 py-2 rounded text-sm font-medium hover:bg-[#157347] flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" /> {t("إضافة بند")}
                </button>
                <h3 className="text-sm font-semibold text-slate-800">{t("بنود الأمر")}</h3>
              </div>
              <p className="text-xs text-slate-500 text-right">
                {t("اختر صنفًا من المخزون أو اكتب وصفًا لبند حر. الأسعار غير شاملة الضريبة.")}
              </p>

              <div className="overflow-x-auto">
                <table dir="ltr" className="w-full text-sm [&_th]:[direction:rtl] [&_td]:[direction:rtl] [&_th]:text-right [&_td]:text-right">
                  <thead className="bg-slate-100 border border-slate-300">
                    <tr>
                      <th className="px-3 py-2 border border-slate-300"></th>
                      <th className="px-3 py-2 border border-slate-300">{t("المجموع")}</th>
                      <th className="px-3 py-2 border border-slate-300">{t("الضريبة %")}</th>
                      <th className="px-3 py-2 border border-slate-300">{t("الخصم")}</th>
                      <th className="px-3 py-2 border border-slate-300">{t("السعر")} *</th>
                      <th className="px-3 py-2 border border-slate-300">{t("الوحدة")}</th>
                      <th className="px-3 py-2 border border-slate-300">{t("الكمية")} *</th>
                      <th className="px-3 py-2 border border-slate-300">{t("الوصف")} *</th>
                      <th className="px-3 py-2 border border-slate-300">{t("الصنف")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => {
                      const lineTotal = itemAmounts(item).total;
                      const productMissing = Boolean(item.productId) && !products.some((product) => product.id === item.productId);
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
                            <select
                              value={String(item.taxPercent)}
                              onChange={(e) => updateItem(item.id, { taxPercent: Number(e.target.value) === SAUDI_STANDARD_VAT_RATE ? SAUDI_STANDARD_VAT_RATE : 0 })}
                              aria-label={t("الضريبة %")}
                              className={cn(cellInputClass, "bg-white")}
                            >
                              <option value={String(SAUDI_STANDARD_VAT_RATE)}>{SAUDI_STANDARD_VAT_RATE}%</option>
                              <option value="0">0%</option>
                            </select>
                          </td>
                          <td className="px-3 py-2 border border-slate-300">
                            <input type="number" min={0} step="0.01" value={item.discount ?? 0} onChange={(e) => updateItem(item.id, { discount: Number(e.target.value) || 0 })} className={cellInputClass} />
                          </td>
                          <td className="px-3 py-2 border border-slate-300">
                            <input type="number" min={0} step="0.01" value={item.price ?? 0} onChange={(e) => updateItem(item.id, { price: Number(e.target.value) || 0 })} className={cellInputClass} />
                          </td>
                          <td className="px-3 py-2 border border-slate-300">
                            <input type="text" value={item.unit ?? ""} onChange={(e) => updateItem(item.id, { unit: e.target.value })} className={cellInputClass} />
                          </td>
                          <td className="px-3 py-2 border border-slate-300">
                            <input type="number" min={0} value={item.quantity ?? 0} onChange={(e) => updateItem(item.id, { quantity: Number(e.target.value) || 0 })} className={cellInputClass} />
                          </td>
                          <td className="px-3 py-2 border border-slate-300 min-w-[180px]">
                            <input
                              type="text"
                              value={item.description ?? ""}
                              onChange={(e) => updateItem(item.id, { description: e.target.value })}
                              placeholder={item.productId ? "" : t("مطلوب")}
                              className={cellInputClass}
                            />
                          </td>
                          <td className="px-3 py-2 border border-slate-300 min-w-[180px]">
                            <select
                              value={item.productId ?? ""}
                              onChange={(e) => chooseProduct(item.id, e.target.value)}
                              aria-label={t("الصنف")}
                              className={cn(cellInputClass, "bg-white")}
                            >
                              <option value="">{t("بند حر (بدون صنف)")}</option>
                              {productMissing && <option value={item.productId}>{item.description || t("صنف غير نشط")}</option>}
                              {products.map((product) => (
                                <option key={product.id} value={product.id}>
                                  {product.sku} - {product.name_ar}{product.item_type === "service" ? ` (${t("خدمة")})` : ""}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <OrderTotalsBox totals={totals} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
