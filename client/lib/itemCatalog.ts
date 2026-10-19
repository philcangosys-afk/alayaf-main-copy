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
