/**
 * S17: قائمة الأصناف والخدمات للبنود (list_item_catalog): المبيعات والمشتريات والمخزون.
 * - الكمية المتوفرة لكل مستودع، بلا قيمة ولا تكلفة. سعر الشراء يصل لصاحب المشتريات أو المخزون فقط.
 * - قبل تطبيق S17 (أو بلا صلاحية) تبقى القائمة فارغة، والبنود تعمل نصًا حرًا كما كانت.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export type CatalogItemType = "product" | "service";

export type CatalogItem = {
  id: string;
  sku: string;
  nameAr: string;
  nameEn: string;
  itemType: CatalogItemType;
  unit: string;
  active: boolean;
  description: string;
  barcode: string;
  salePrice: number;
  /** null: سعر الشراء غير ظاهر لهذا المستخدم */
  purchasePrice: number | null;
  reorderLevel: number;
  /** S18: نسبة ضريبة الصنف، وطريقة إدخال سعره في بطاقة الصنف (الأسعار هنا قبل الضريبة دائمًا) */
  vatRate: number;
  pricesIncludeVat: boolean;
  revenueAccountCode: string;
  purchaseAccountCode: string;
  /** مجموع الكمية في كل المستودعات (للمنتج فقط) */
  quantity: number;
  warehouses: Array<{ warehouseId: string; quantity: number }>;
};

export type CatalogWarehouse = { id: string; code: string; nameAr: string };

export type ItemCatalog = {
  items: CatalogItem[];
  warehouses: CatalogWarehouse[];
  costVisible: boolean;
  loaded: boolean;
  /** رسالة الخطأ الخام (فارغة عند النجاح) */
  error: string;
  reload: () => Promise<void>;
};

const toNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function parseCatalog(raw: unknown): Pick<ItemCatalog, "items" | "warehouses" | "costVisible"> {
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const products = Array.isArray(data.products) ? data.products : [];
  const warehouses = Array.isArray(data.warehouses) ? data.warehouses : [];
  return {
    items: products
      .filter((row) => row && typeof row === "object")
      .map((row: Record<string, unknown>) => ({
        id: String(row.id ?? ""),
        sku: String(row.sku ?? ""),
        nameAr: String(row.name_ar ?? "").trim(),
        nameEn: String(row.name_en ?? "").trim(),
        itemType: (row.item_type === "service" ? "service" : "product") as CatalogItemType,
        unit: String(row.unit ?? ""),
        active: row.active !== false,
        description: String(row.description ?? ""),
        barcode: String(row.barcode ?? ""),
        salePrice: toNumber(row.sale_price),
        purchasePrice: row.purchase_price === null || row.purchase_price === undefined ? null : toNumber(row.purchase_price),
        reorderLevel: toNumber(row.reorder_level),
        vatRate: row.vat_rate === null || row.vat_rate === undefined || row.vat_rate === "" ? 15 : toNumber(row.vat_rate),
        pricesIncludeVat: row.prices_include_vat === true,
        revenueAccountCode: String(row.revenue_account_code ?? ""),
        purchaseAccountCode: String(row.purchase_account_code ?? ""),
        quantity: toNumber(row.quantity),
        warehouses: (Array.isArray(row.warehouses) ? row.warehouses : [])
          .filter((entry) => entry && typeof entry === "object")
          .map((entry: Record<string, unknown>) => ({
            warehouseId: String(entry.warehouse_id ?? ""),
            quantity: toNumber(entry.quantity),
          })),
      }))
      .filter((item) => item.id && item.nameAr),
    warehouses: warehouses
      .filter((row) => row && typeof row === "object")
      .map((row: Record<string, unknown>) => ({
        id: String(row.id ?? ""),
        code: String(row.code ?? ""),
        nameAr: String(row.name_ar ?? "").trim(),
      }))
      .filter((row) => row.id),
    costVisible: data.cost_visible === true,
  };
}

export function useItemCatalog(includeInactive = false): ItemCatalog {
  const [state, setState] = useState<Omit<ItemCatalog, "reload">>({
    items: [],
    warehouses: [],
    costVisible: false,
    loaded: false,
    error: "",
  });

  const reload = useCallback(async () => {
    const { data, error } = await supabase.rpc("list_item_catalog", { p_include_inactive: includeInactive });
    if (error) {
      setState({ items: [], warehouses: [], costVisible: false, loaded: true, error: String(error.message ?? "error") });
      return;
    }
    setState({ ...parseCatalog(data), loaded: true, error: "" });
  }, [includeInactive]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, reload };
}

/** الكمية المتوفرة للمنتج في مستودع، أو في كل المستودعات إن لم يُحدَّد */
export function stockIn(item: CatalogItem, warehouseId?: string | null): number {
  if (item.itemType !== "product") return 0;
  if (!warehouseId) return item.quantity;
  return item.warehouses.find((entry) => entry.warehouseId === warehouseId)?.quantity ?? 0;
}

/** حالة المخزون: نفد، أو تحت حد إعادة الطلب، أو متوفر */
export function stockLevel(item: CatalogItem, quantity: number): "out" | "low" | "ok" {
  if (quantity <= 0) return "out";
  if (item.reorderLevel > 0 && quantity <= item.reorderLevel) return "low";
  return "ok";
}

export function itemMatches(item: CatalogItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [item.nameAr, item.nameEn, item.sku, item.barcode, item.description]
    .some((part) => part.toLowerCase().includes(needle));
}

/**
 * S18: سعر الوحدة في مستندات المبيعات (العرض والأمر والفاتورة) بخانتين: نموذج حساب الفاتورة وقيدها والهيئة
 * (سعر الوحدة × الكمية، وتقريب البند) لا يحتمل أسعارًا بأربع خانات في أكثر من بند. سعر الصنف نفسه بأربع خانات.
 */
/*
 * S18: حساب عشري دقيق كما تحسبه القاعدة (numeric) من الرقم كما يُرسل في JSON (أقصر نص له)، بلا أخطاء الفاصلة
 * العائمة (مثل 595.5 × 16790.51 = 9998748.705 تقريبه في القاعدة …71 وبالفاصلة العائمة …70).
 */
type Decimal = { units: bigint; scale: number };
const BIG_ZERO = BigInt(0);
const BIG_ONE = BigInt(1);
const BIG_TWO = BigInt(2);
const BIG_TEN = BigInt(10);
const pow10 = (exponent: number) => BIG_TEN ** BigInt(exponent);

function toDecimal(value: unknown): Decimal {
  const number = Number(value);
  if (!Number.isFinite(number)) return { units: BIG_ZERO, scale: 0 };
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(number));
  if (!match) return { units: BIG_ZERO, scale: 0 };
  const fraction = match[3] ?? "";
  let digits = match[2] + fraction;
  let scale = fraction.length - Number(match[4] ?? 0);
  if (scale < 0) {
    digits += "0".repeat(-scale);
    scale = 0;
  }
  const units = BigInt(digits);
  return { units: match[1] ? -units : units, scale };
}

const atScale = (value: Decimal, scale: number) => value.units * pow10(scale - value.scale);
const addDecimals = (a: Decimal, b: Decimal): Decimal => {
  const scale = Math.max(a.scale, b.scale);
  return { units: atScale(a, scale) + atScale(b, scale), scale };
};
const subtractDecimals = (a: Decimal, b: Decimal): Decimal => addDecimals(a, { units: -b.units, scale: b.scale });
const multiplyDecimals = (a: Decimal, b: Decimal): Decimal => ({ units: a.units * b.units, scale: a.scale + b.scale });
const percentOf = (a: Decimal, rate: Decimal): Decimal => {
  const product = multiplyDecimals(a, rate);
  return { units: product.units, scale: product.scale + 2 };
};

/** round(x, 2) في القاعدة (النصف بعيدًا عن الصفر)، بالهللات */
function toHalalas(value: Decimal): bigint {
  if (value.scale <= 2) return atScale(value, 2);
  const divisor = pow10(value.scale - 2);
  const negative = value.units < BIG_ZERO;
  const magnitude = negative ? -value.units : value.units;
  let quotient = magnitude / divisor;
  if ((magnitude % divisor) * BIG_TWO >= divisor) quotient += BIG_ONE;
  return negative ? -quotient : quotient;
}

const halalasToNumber = (halalas: bigint) => Number(halalas) / 100;
const decimalToNumber = (value: Decimal) => Number(`${value.units}e-${value.scale}`);
const isWholeHalalas = (value: Decimal) => value.scale <= 2 || value.units % pow10(value.scale - 2) === BIG_ZERO;
const absoluteDifference = (a: Decimal, b: Decimal) => {
  const difference = subtractDecimals(a, b);
  return { units: difference.units < BIG_ZERO ? -difference.units : difference.units, scale: difference.scale };
};
const atLeastOneHalala = (value: Decimal) => atScale(value, Math.max(value.scale, 2)) >= pow10(Math.max(value.scale, 2) - 2);

/** المبلغ مقرّبًا إلى هللة بتقريب القاعدة (2.175 → 2.18) */
export const roundHalala = (value: number) => halalasToNumber(toHalalas(toDecimal(value)));

export const salesUnitPrice = (value: number) => roundHalala(value);

/** S18: مبلغ بأكثر من خانتين عشريتين (سعر الوحدة في مستندات المبيعات بخانتين؛ بهامش الفاصلة العائمة 0.1 + 0.2) */
export const hasSubHalala = (value: number) => {
  const cents = (Number(value) || 0) * 100;
  return Math.abs(cents - Math.round(cents)) > 1e-6;
};

/** مبلغ بند المبيعات (الكمية × السعر − الخصم) مقرّبًا إلى هللة كما يقرّبه قيد الفاتورة (ولا يقل عن صفر) */
export function salesLineAmount(quantity: number, price: number, discount: number): number {
  const amount = subtractDecimals(multiplyDecimals(toDecimal(quantity), toDecimal(price)), toDecimal(discount));
  return amount.units < BIG_ZERO ? 0 : halalasToNumber(toHalalas(amount));
}

/**
 * S18: مجاميع فاتورة المبيعات كما يرحّلها القيد: القيد يقرّب مبلغ كل بند (الكمية × السعر − الخصم) إلى هللة ويقابل
 * مجموعها بالمجموع الفرعي المحفوظ، فالمجموع الفرعي = مجموع البنود المقرّبة (القيد متوازن دائمًا). الضريبة = مجموع
 * ضريبة البنود الدقيق مقرّبًا (كما يتحقق منه الخادم)، والإجمالي مجموعهما. الحساب عشري دقيق كالقاعدة.
 * issue: حين يبتعد المجموع الفرعي أو الإجمالي عن المجموع الدقيق للبنود هللة أو أكثر (كمية بكسور أو خصم بأكثر من
 * خانتين في أكثر من بند) يرفضه تحقق الفاتورة والهيئة (فرق 0.01): يُعاد أول بند مبلغه بكسور الهللة. بند واحد لا يُرفض.
 */
export function salesInvoiceAmounts<T extends { quantity: number; discount: number; taxPercent: number }>(
  lines: T[],
  priceOf: (line: T) => number,
): {
  subtotal: number;
  tax: number;
  total: number;
  exactSubtotal: number;
  issue: { line: T | null; amount: number } | null;
} {
  let exactSubtotal: Decimal = { units: BIG_ZERO, scale: 0 };
  let exactTax: Decimal = { units: BIG_ZERO, scale: 0 };
  let subtotalHalalas = BIG_ZERO;
  let first: T | null = null;
  let firstAmount = 0;
  for (const line of lines) {
    const amount = subtractDecimals(
      multiplyDecimals(toDecimal(line.quantity), toDecimal(priceOf(line))),
      toDecimal(line.discount),
    );
    const rate = toDecimal(line.taxPercent);
    exactSubtotal = addDecimals(exactSubtotal, amount);
    exactTax = addDecimals(exactTax, percentOf(amount, rate));
    subtotalHalalas += amount.units < BIG_ZERO ? BIG_ZERO : toHalalas(amount);
    if (!first && !isWholeHalalas(amount)) {
      first = line;
      firstAmount = decimalToNumber(amount);
    }
  }
  const taxHalalas = toHalalas(exactTax);
  const subtotal: Decimal = { units: subtotalHalalas, scale: 2 };
  const total: Decimal = { units: subtotalHalalas + taxHalalas, scale: 2 };
  const off =
    atLeastOneHalala(absoluteDifference(subtotal, exactSubtotal)) ||
    atLeastOneHalala(absoluteDifference(total, addDecimals(exactSubtotal, exactTax)));
  return {
    subtotal: halalasToNumber(subtotalHalalas),
    tax: halalasToNumber(taxHalalas),
    total: halalasToNumber(subtotalHalalas + taxHalalas),
    exactSubtotal: decimalToNumber(exactSubtotal),
    issue: off ? { line: first, amount: firstAmount } : null,
  };
}

/** الكميات بأربع خانات كما في القاعدة، فلا يُحسب فرق فاصلة عائمة (0.1 + 0.2) نقصًا أو زيادة */
export const roundQuantity = (value: number) => Math.round((Number(value) || 0) * 10000) / 10000;

/** مجموع كميات المنتج في بنود المستند (المنتج نفسه في أكثر من بند) */
export function requestedQuantity(lines: Array<{ productId?: string; quantity: number }>, productId: string): number {
  return roundQuantity(
    lines.reduce((sum, line) => (line.productId === productId ? sum + (Number(line.quantity) || 0) : sum), 0),
  );
}

/** إشعار تسليم يدوي مرحّل للعميل لم يُربط بفاتورة (list_uninvoiced_deliveries) */
export type PriorDelivery = {
  id: string;
  number: string;
  date: string;
  reference: string;
  warehouseName: string;
  lines: Array<{ productId: string; sku: string; nameAr: string; unit: string; quantity: number }>;
};

export function parseDeliveries(raw: unknown): PriorDelivery[] {
  return (Array.isArray(raw) ? raw : [])
    .filter((row) => row && typeof row === "object")
    .map((row: Record<string, unknown>) => ({
      id: String(row.id ?? ""),
      number: String(row.issue_number ?? ""),
      date: String(row.issue_date ?? ""),
      reference: String(row.reference ?? "").trim(),
      warehouseName: String(row.warehouse_name ?? "").trim(),
      lines: (Array.isArray(row.lines) ? row.lines : [])
        .filter((line) => line && typeof line === "object")
        .map((line: Record<string, unknown>) => ({
          productId: String(line.product_id ?? ""),
          sku: String(line.sku ?? ""),
          nameAr: String(line.name_ar ?? "").trim(),
          unit: String(line.unit ?? ""),
          quantity: toNumber(line.quantity),
        })),
    }))
    .filter((delivery) => delivery.id);
}

/**
 * إشعارات التسليم غير المفوترة للعميل (فارغة بلا عميل، أو قبل S17، أو بلا صلاحية).
 * تُفرَّغ عند تغيير العميل فقط؛ إعادة التحميل (بعد خطأ حفظ مثلًا) تُبقي القائمة حتى يصل الجديد،
 * وفشل التحميل يُبقي القائمة السابقة للعميل نفسه
 */
export function useUninvoicedDeliveries(customerId: string) {
  const id = customerId.trim();
  const [state, setState] = useState<{ customerId: string; deliveries: PriorDelivery[] }>({ customerId: "", deliveries: [] });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    setState((current) => (current.customerId === id ? current : { customerId: id, deliveries: [] }));
    if (!id) return;
    let cancelled = false;
    void supabase.rpc("list_uninvoiced_deliveries", { p_customer_id: id }).then(({ data, error }) => {
      if (cancelled || error) return;
      setState({ customerId: id, deliveries: parseDeliveries(data) });
    });
    return () => {
      cancelled = true;
    };
  }, [id, version]);
  const reload = useCallback(() => setVersion((value) => value + 1), []);
  return { deliveries: state.customerId === id ? state.deliveries : [], reload };
}

/** مجموع كمية المنتج في إشعارات التسليم المختارة */
export function deliveredQuantity(deliveries: PriorDelivery[], productId: string): number {
  return roundQuantity(
    deliveries.reduce(
      (sum, delivery) =>
        sum + delivery.lines.reduce((lineSum, line) => (line.productId === productId ? lineSum + line.quantity : lineSum), 0),
      0,
    ),
  );
}

/** لنموذج فاتورة المشتريات: حساب البضاعة المستلمة غير المفوترة، وسندات الاستلام اليدوية المرحّلة لأمر الشراء */
export async function loadPurchaseStockContext(
  purchaseOrderId: string,
  poNumber: string,
): Promise<{ grniAccountCode: string; orderReceipts: string[]; failed: boolean }> {
  const { data, error } = await supabase.rpc("purchase_invoice_stock_context", {
    p_purchase_order_id: purchaseOrderId,
    p_po_number: poNumber,
  });
  if (error || !data || typeof data !== "object") return { grniAccountCode: "", orderReceipts: [], failed: true };
  const row = data as Record<string, unknown>;
  return {
    grniAccountCode: String(row.grni_account_code ?? "").trim(),
    orderReceipts: (Array.isArray(row.order_receipts) ? row.order_receipts : []).map((value) => String(value)),
    failed: false,
  };
}

/** S17 غير مطبّق على القاعدة: الدالة غير موجودة */
export const catalogMissing = (error: string) =>
  /list_item_catalog|Could not find the function|PGRST202/i.test(error);
