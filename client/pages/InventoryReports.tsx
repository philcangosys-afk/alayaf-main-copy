import { useEffect, useMemo, useState } from "react";
import { Download, Printer, RefreshCw } from "lucide-react";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import { COMPANY_REPORT_BRAND, exportReportExcel, printReport, type ReportColumn } from "@/lib/reportExport";
import { supabase } from "@/lib/supabaseClient";
import { fetchPostedLedger, selectAllRows, type LedgerLine } from "@/lib/ledgerData";
import { riyadhDateString } from "@/lib/utils";

type ReportId = "balances" | "movements" | "monthly" | "issues" | "transfers" | "counts" | "adjustments" | "manufacturing" | "assembly" | "reconciliation";
type Product = { id: string; sku: string; name_ar: string; name_en: string | null; unit: string; inventoryAccount: string };
type Warehouse = { id: string; code: string; name_ar: string };
type Movement = { id: string; number: string; date: string; createdAt: string; type: string; productId: string; warehouseId: string; quantity: number; unitCost: number; sourceTable: string; sourceId: string; journalEntryId: string };
type Transfer = { id: string; number: string; date: string; sourceWarehouseId: string; destinationWarehouseId: string; status: string };
type Count = { id: string; number: string; date: string; warehouseId: string; status: string };
type CountLine = { id: string; countId: string; productId: string; systemQuantity: number; countedQuantity: number | null; varianceQuantity: number; varianceValue: number };
type Adjustment = { id: string; number: string; date: string; warehouseId: string; status: string; accountingStatus: string; journalEntryId: string };
type AdjustmentLine = { id: string; adjustmentId: string; productId: string; type: string; quantity: number; unitCost: number; amount: number };
type JournalLine = { account: string; debit: number; credit: number };
type ProductionOrder = { id: string; number: string; date: string; finishedProductId: string; warehouseId: string; quantity: number; status: string; accountingStatus: string; totalCost: number; journalEntryId: string };
type ReportResult = { columns: ReportColumn[]; rows: Record<string, string | number>[]; summary: Array<{ label: string; value: string | number }> };

const REPORTS: Array<{ id: ReportId; label: string; description: string }> = [
  { id: "balances", label: "أرصدة وقيمة المخزون", description: "الرصيد الكمي والقيمة الدفترية والمتوسط المرجح حتى التاريخ المحدد" },
  { id: "movements", label: "دفتر حركة المخزون", description: "جميع حركات الإدخال والإخراج مع الرصيد المتحرك لكل صنف ومستودع" },
  { id: "monthly", label: "الملخص الشهري للمخزون", description: "الوارد والصادر والرصيد الختامي شهرياً لكل صنف ومستودع" },
  { id: "issues", label: "تكلفة الصرف", description: "تكلفة سندات الصرف وإشعارات التسليم المرحلة خلال الفترة" },
  { id: "transfers", label: "التحويلات بين المستودعات", description: "الكميات والقيم المحولة بين المستودعات خلال الفترة" },
  { id: "counts", label: "نتائج الجرد", description: "الكميات الدفترية والفعلية وفروقات عمليات الجرد" },
  { id: "adjustments", label: "تسويات المخزون", description: "تسويات العجز والفائض وحالة القيد المحاسبي" },
  { id: "manufacturing", label: "أوامر التصنيع", description: "أوامر التصنيع وكميات المنتج النهائي والتكلفة الفعلية وحالة الترحيل المحاسبي" },
  { id: "assembly", label: "أوامر التركيب", description: "أوامر التركيب وكميات المنتج المركب والتكلفة الفعلية وحالة الترحيل المحاسبي" },
  { id: "reconciliation", label: "مطابقة المخزون والمحاسبة", description: "مقارنة قيمة دفتر المخزون برصيد حسابات أصل المخزون في الأستاذ العام حتى التاريخ المحدد" },
];

const INBOUND_TYPES = new Set(["receipt", "transfer_in", "adjustment_in", "opening"]);
const PRODUCTION_SOURCES = new Set(["inventory_manufacturing_orders", "inventory_assembly_orders"]);
const STATUS_LABELS: Record<string, string> = { draft: "مسودة", posted: "مرحّل", finalized: "معتمد", pending: "قيد الانتظار", not_required: "غير مطلوب", pending_invoice: "بانتظار الفاتورة (قديم)" };
/** حساب البضاعة المستلمة التي لم تصل فواتيرها (GRNI). */
const GRNI_ACCOUNT = "2113";
const amount = (value: unknown) => Number(value ?? 0) || 0;
// القيمة الخام دون تقريب؛ التقريب للعرض فقط حتى لا يظهر فرق وهمي عند المطابقة مع الأستاذ العام
const movementValue = (movement: Pick<Movement, "quantity" | "unitCost">) =>
  movement.quantity * movement.unitCost;
const isEmpty = (value: unknown) => value === null || value === undefined || value === "";

export default function InventoryReports() {
  const { t, direction, locale, formatNumber } = useI18n();
  const today = riyadhDateString();
  const [view, setView] = useState<ReportId>("balances");
  const [dateFrom, setDateFrom] = useState(() => `${today.slice(0, 4)}-01-01`);
  const [dateTo, setDateTo] = useState(today);
  const [productFilter, setProductFilter] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [counts, setCounts] = useState<Count[]>([]);
  const [countLines, setCountLines] = useState<CountLine[]>([]);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [adjustmentLines, setAdjustmentLines] = useState<AdjustmentLine[]>([]);
  const [journalLines, setJournalLines] = useState<JournalLine[]>([]);
  const [manufacturingOrders, setManufacturingOrders] = useState<ProductionOrder[]>([]);
  const [assemblyOrders, setAssemblyOrders] = useState<ProductionOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const invalidRange = view !== "reconciliation" && dateFrom > dateTo;

  const load = async () => {
    if (invalidRange) {
      setError(t("تاريخ البداية يجب أن يسبق تاريخ النهاية"));
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const [productsResult, warehousesResult, movementsResult, transfersResult, countsResult, countLinesResult, adjustmentsResult, adjustmentLinesResult, ledgerResult, manufacturingResult, assemblyResult] = await Promise.all([
      selectAllRows((from, to) => supabase.from("inventory_products").select("id, sku, name_ar, name_en, unit, inventory_account_code").eq("track_inventory", true).order("sku").order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("inventory_warehouses").select("id, code, name_ar").order("code").order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("inventory_stock_movements").select("id, movement_number, movement_date, created_at, movement_type, product_id, warehouse_id, quantity, unit_cost, source_table, source_id, journal_entry_id").lte("movement_date", dateTo).order("movement_date").order("created_at").order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("inventory_transfers").select("id, transfer_number, transfer_date, source_warehouse_id, destination_warehouse_id, status").lte("transfer_date", dateTo).order("transfer_date").order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("inventory_counts").select("id, count_number, count_date, warehouse_id, status").lte("count_date", dateTo).order("count_date").order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("inventory_count_lines").select("id, count_id, product_id, system_quantity, counted_quantity, variance_quantity, variance_value").order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("inventory_adjustments").select("id, adjustment_number, adjustment_date, warehouse_id, status, accounting_status, accounting_journal_entry_id").lte("adjustment_date", dateTo).order("adjustment_date").order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("inventory_adjustment_lines").select("id, adjustment_id, product_id, movement_type, quantity, unit_cost, amount").order("id").range(from, to)),
      // أرصدة الأستاذ العام من القيود المرحّلة حتى تاريخ النهاية (مرقّمة دون حد 1000 سطر)
      fetchPostedLedger(dateTo).then(
        (ledger) => ({ data: ledger.lines, error: null as { message: string } | null }),
        (ledgerError) => ({ data: [] as LedgerLine[], error: { message: ledgerError instanceof Error ? ledgerError.message : String(ledgerError) } }),
      ),
      selectAllRows((from, to) => supabase.from("inventory_manufacturing_orders").select("id, order_number, order_date, finished_product_id, warehouse_id, quantity, status, accounting_status, total_cost, accounting_journal_entry_id").lte("order_date", dateTo).order("order_date").order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("inventory_assembly_orders").select("id, order_number, order_date, finished_product_id, warehouse_id, quantity, status, accounting_status, total_cost, accounting_journal_entry_id").lte("order_date", dateTo).order("order_date").order("id").range(from, to)),
    ]);
    const loadError = productsResult.error ?? warehousesResult.error ?? movementsResult.error ?? transfersResult.error ?? countsResult.error ?? countLinesResult.error ?? adjustmentsResult.error ?? adjustmentLinesResult.error ?? ledgerResult.error ?? manufacturingResult.error ?? assemblyResult.error;
    if (loadError) {
      setError(loadError.message);
      setLoading(false);
      return;
    }
    setProducts((productsResult.data ?? []).map((item) => ({ id: String(item.id), sku: String(item.sku), name_ar: String(item.name_ar), name_en: item.name_en ? String(item.name_en) : null, unit: String(item.unit ?? ""), inventoryAccount: String(item.inventory_account_code ?? "") })));
    setWarehouses((warehousesResult.data ?? []).map((item) => ({ id: String(item.id), code: String(item.code), name_ar: String(item.name_ar) })));
    setMovements((movementsResult.data ?? []).map((item) => ({ id: String(item.id), number: String(item.movement_number), date: String(item.movement_date), createdAt: String(item.created_at ?? ""), type: String(item.movement_type), productId: String(item.product_id), warehouseId: String(item.warehouse_id), quantity: amount(item.quantity), unitCost: amount(item.unit_cost), sourceTable: String(item.source_table ?? ""), sourceId: String(item.source_id ?? ""), journalEntryId: String(item.journal_entry_id ?? "") })));
    setTransfers((transfersResult.data ?? []).map((item) => ({ id: String(item.id), number: String(item.transfer_number), date: String(item.transfer_date), sourceWarehouseId: String(item.source_warehouse_id), destinationWarehouseId: String(item.destination_warehouse_id), status: String(item.status) })));
    setCounts((countsResult.data ?? []).map((item) => ({ id: String(item.id), number: String(item.count_number), date: String(item.count_date), warehouseId: String(item.warehouse_id), status: String(item.status) })));
    setCountLines((countLinesResult.data ?? []).map((item) => ({ id: String(item.id), countId: String(item.count_id), productId: String(item.product_id), systemQuantity: amount(item.system_quantity), countedQuantity: item.counted_quantity === null ? null : amount(item.counted_quantity), varianceQuantity: amount(item.variance_quantity), varianceValue: amount(item.variance_value) })));
    setAdjustments((adjustmentsResult.data ?? []).map((item) => ({ id: String(item.id), number: String(item.adjustment_number), date: String(item.adjustment_date), warehouseId: String(item.warehouse_id), status: String(item.status), accountingStatus: String(item.accounting_status), journalEntryId: String(item.accounting_journal_entry_id ?? "") })));
    setAdjustmentLines((adjustmentLinesResult.data ?? []).map((item) => ({ id: String(item.id), adjustmentId: String(item.adjustment_id), productId: String(item.product_id), type: String(item.movement_type), quantity: amount(item.quantity), unitCost: amount(item.unit_cost), amount: amount(item.amount) })));
    setJournalLines(ledgerResult.data.map((line) => ({ account: String(line.account_code), debit: amount(line.debit), credit: amount(line.credit) })));
    setManufacturingOrders((manufacturingResult.data ?? []).map((item) => ({ id: String(item.id), number: String(item.order_number), date: String(item.order_date), finishedProductId: String(item.finished_product_id), warehouseId: String(item.warehouse_id), quantity: amount(item.quantity), status: String(item.status), accountingStatus: String(item.accounting_status), totalCost: amount(item.total_cost), journalEntryId: String(item.accounting_journal_entry_id ?? "") })));
    setAssemblyOrders((assemblyResult.data ?? []).map((item) => ({ id: String(item.id), number: String(item.order_number), date: String(item.order_date), finishedProductId: String(item.finished_product_id), warehouseId: String(item.warehouse_id), quantity: amount(item.quantity), status: String(item.status), accountingStatus: String(item.accounting_status), totalCost: amount(item.total_cost), journalEntryId: String(item.accounting_journal_entry_id ?? "") })));
    setLoading(false);
  };

  useEffect(() => { void load(); }, [dateTo]);

  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const warehouseById = useMemo(() => new Map(warehouses.map((warehouse) => [warehouse.id, warehouse])), [warehouses]);
  const transferById = useMemo(() => new Map(transfers.map((transfer) => [transfer.id, transfer])), [transfers]);
  const countById = useMemo(() => new Map(counts.map((count) => [count.id, count])), [counts]);
  const adjustmentById = useMemo(() => new Map(adjustments.map((adjustment) => [adjustment.id, adjustment])), [adjustments]);
  const currentReport = REPORTS.find((item) => item.id === view) ?? REPORTS[0];
  const productName = (id: string) => { const product = productById.get(id); return product ? `${product.sku} - ${locale === "en" && product.name_en ? product.name_en : product.name_ar}` : id; };
  const warehouseName = (id: string) => { const warehouse = warehouseById.get(id); return warehouse ? `${warehouse.code} - ${warehouse.name_ar}` : id; };
  const money = (value: number) => formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const quantity = (value: number) => formatNumber(value, { minimumFractionDigits: 0, maximumFractionDigits: 4 });

  const report = useMemo<ReportResult>(() => {
    const matches = (productId: string, warehouseId: string) => (!productFilter || productId === productFilter) && (!warehouseFilter || warehouseId === warehouseFilter);
    const movementTypeLabel = (movement: Movement) => movement.type === "receipt" && PRODUCTION_SOURCES.has(movement.sourceTable) ? t("استلام إنتاج") : t(({ receipt: "استلام مخزون", issue: "صرف مخزون", transfer_in: "تحويل وارد", transfer_out: "تحويل صادر", adjustment_in: "تسوية فائض", adjustment_out: "تسوية عجز", opening: "رصيد افتتاحي" } as Record<string, string>)[movement.type] ?? movement.type);
    const statusText = (status: string) => t(STATUS_LABELS[status] ?? status);
    const periodMovements = movements.filter((movement) => movement.date >= dateFrom && movement.date <= dateTo && matches(movement.productId, movement.warehouseId));
    const openingByKey = new Map<string, { quantity: number; value: number }>();
    movements.filter((movement) => movement.date < dateFrom && matches(movement.productId, movement.warehouseId)).forEach((movement) => {
      const key = `${movement.productId}::${movement.warehouseId}`;
      const current = openingByKey.get(key) ?? { quantity: 0, value: 0 };
      const sign = INBOUND_TYPES.has(movement.type) ? 1 : -1;
      current.quantity += sign * movement.quantity;
      current.value += sign * movementValue(movement);
      openingByKey.set(key, current);
    });

    if (view === "balances") {
      const grouped = new Map<string, { productId: string; warehouseId: string; quantity: number; value: number }>();
      movements.filter((movement) => matches(movement.productId, movement.warehouseId)).forEach((movement) => {
        const key = `${movement.productId}::${movement.warehouseId}`;
        const current = grouped.get(key) ?? { productId: movement.productId, warehouseId: movement.warehouseId, quantity: 0, value: 0 };
        const sign = INBOUND_TYPES.has(movement.type) ? 1 : -1;
        current.quantity += sign * movement.quantity;
        current.value += sign * movementValue(movement);
        grouped.set(key, current);
      });
      const balances = [...grouped.values()].filter((item) => Math.abs(item.quantity) > 0.0001 || Math.abs(item.value) > 0.005).sort((a, b) => productName(a.productId).localeCompare(productName(b.productId)) || warehouseName(a.warehouseId).localeCompare(warehouseName(b.warehouseId)));
      return {
        columns: [{ key: "item", label: t("الصنف") }, { key: "warehouse", label: t("المستودع") }, { key: "unit", label: t("الوحدة") }, { key: "quantity", label: t("الرصيد") }, { key: "average", label: t("متوسط التكلفة SAR") }, { key: "value", label: t("قيمة المخزون SAR") }],
        rows: balances.map((item) => ({ item: productName(item.productId), warehouse: warehouseName(item.warehouseId), unit: productById.get(item.productId)?.unit || "—", quantity: quantity(item.quantity), average: money(item.quantity ? item.value / item.quantity : 0), value: money(item.value) })),
        summary: [{ label: t("إجمالي قيمة المخزون"), value: money(balances.reduce((sum, item) => sum + item.value, 0)) }, { label: t("عدد الأصناف والمستودعات"), value: balances.length }],
      };
    }

    if (view === "movements") {
      const runningByKey = new Map([...openingByKey.entries()].map(([key, value]) => [key, value.quantity]));
      const rows = periodMovements.map((movement) => {
        const key = `${movement.productId}::${movement.warehouseId}`;
        const inbound = INBOUND_TYPES.has(movement.type);
        const balance = (runningByKey.get(key) ?? 0) + (inbound ? movement.quantity : -movement.quantity);
        runningByKey.set(key, balance);
        return { date: movement.date, number: movement.number, type: movementTypeLabel(movement), item: productName(movement.productId), warehouse: warehouseName(movement.warehouseId), inbound: inbound ? quantity(movement.quantity) : "—", outbound: inbound ? "—" : quantity(movement.quantity), unitCost: money(movement.unitCost), value: money(movementValue(movement)), balance: quantity(balance) };
      });
      return {
        columns: [{ key: "date", label: t("التاريخ") }, { key: "number", label: t("رقم الحركة") }, { key: "type", label: t("نوع الحركة") }, { key: "item", label: t("الصنف") }, { key: "warehouse", label: t("المستودع") }, { key: "inbound", label: t("وارد") }, { key: "outbound", label: t("صادر") }, { key: "unitCost", label: t("تكلفة الوحدة SAR") }, { key: "value", label: t("القيمة SAR") }, { key: "balance", label: t("الرصيد") }],
        rows,
        summary: [{ label: t("إجمالي الوارد"), value: quantity(periodMovements.filter((item) => INBOUND_TYPES.has(item.type)).reduce((sum, item) => sum + item.quantity, 0)) }, { label: t("إجمالي الصادر"), value: quantity(periodMovements.filter((item) => !INBOUND_TYPES.has(item.type)).reduce((sum, item) => sum + item.quantity, 0)) }, { label: t("عدد الحركات"), value: rows.length }],
      };
    }

    if (view === "monthly") {
      const runningByKey = new Map([...openingByKey.entries()].map(([key, value]) => [key, value.quantity]));
      const grouped = new Map<string, { month: string; productId: string; warehouseId: string; inbound: number; outbound: number; closing: number }>();
      periodMovements.forEach((movement) => {
        const balanceKey = `${movement.productId}::${movement.warehouseId}`;
        const sign = INBOUND_TYPES.has(movement.type) ? 1 : -1;
        const balance = (runningByKey.get(balanceKey) ?? 0) + sign * movement.quantity;
        runningByKey.set(balanceKey, balance);
        const month = movement.date.slice(0, 7);
        const key = `${month}::${balanceKey}`;
        const current = grouped.get(key) ?? { month, productId: movement.productId, warehouseId: movement.warehouseId, inbound: 0, outbound: 0, closing: balance };
        if (sign > 0) current.inbound += movement.quantity; else current.outbound += movement.quantity;
        current.closing = balance;
        grouped.set(key, current);
      });
      const rows = [...grouped.values()].map((item) => ({ month: item.month, item: productName(item.productId), warehouse: warehouseName(item.warehouseId), inbound: quantity(item.inbound), outbound: quantity(item.outbound), closing: quantity(item.closing) }));
      return { columns: [{ key: "month", label: t("الشهر") }, { key: "item", label: t("الصنف") }, { key: "warehouse", label: t("المستودع") }, { key: "inbound", label: t("إجمالي الوارد") }, { key: "outbound", label: t("إجمالي الصادر") }, { key: "closing", label: t("الرصيد الختامي") }], rows, summary: [{ label: t("عدد السجلات"), value: rows.length }] };
    }

    if (view === "issues") {
      // سندات الصرف وإشعارات التسليم فقط؛ صرف مكونات التصنيع والتركيب لا يدخل هنا
      const issueMovements = periodMovements.filter((movement) => movement.type === "issue" && movement.sourceTable === "inventory_issues");
      return {
        columns: [{ key: "date", label: t("التاريخ") }, { key: "number", label: t("رقم الحركة") }, { key: "item", label: t("الصنف") }, { key: "warehouse", label: t("المستودع") }, { key: "quantity", label: t("الكمية") }, { key: "unitCost", label: t("متوسط التكلفة SAR") }, { key: "cost", label: t("تكلفة الصرف SAR") }, { key: "journal", label: t("القيد المحاسبي") }],
        rows: issueMovements.map((item) => ({ date: item.date, number: item.number, item: productName(item.productId), warehouse: warehouseName(item.warehouseId), quantity: quantity(item.quantity), unitCost: money(item.unitCost), cost: money(movementValue(item)), journal: item.journalEntryId || t("غير مطلوب") })),
        summary: [{ label: t("إجمالي تكلفة الصرف"), value: money(issueMovements.reduce((sum, item) => sum + movementValue(item), 0)) }, { label: t("عدد الحركات"), value: issueMovements.length }],
      };
    }

    if (view === "transfers") {
      const transferMovements = periodMovements.filter((movement) => movement.type === "transfer_out");
      return {
        columns: [{ key: "date", label: t("التاريخ") }, { key: "number", label: t("رقم التحويل") }, { key: "item", label: t("الصنف") }, { key: "source", label: t("المستودع المصدر") }, { key: "destination", label: t("المستودع الوجهة") }, { key: "quantity", label: t("الكمية") }, { key: "unitCost", label: t("تكلفة الوحدة SAR") }, { key: "value", label: t("القيمة المحولة SAR") }],
        rows: transferMovements.map((item) => { const transfer = transferById.get(item.sourceId); return { date: item.date, number: transfer?.number ?? item.number, item: productName(item.productId), source: warehouseName(transfer?.sourceWarehouseId ?? item.warehouseId), destination: warehouseName(transfer?.destinationWarehouseId ?? ""), quantity: quantity(item.quantity), unitCost: money(item.unitCost), value: money(movementValue(item)) }; }),
        summary: [{ label: t("إجمالي قيمة التحويلات"), value: money(transferMovements.reduce((sum, item) => sum + movementValue(item), 0)) }, { label: t("عدد أسطر التحويل"), value: transferMovements.length }],
      };
    }

    if (view === "counts") {
      const countRows = countLines.flatMap((line) => { const count = countById.get(line.countId); if (!count || count.date < dateFrom || count.date > dateTo || !matches(line.productId, count.warehouseId)) return []; return [{ count, line }]; });
      const rows = countRows.map(({ count, line }) => ({ date: count.date, number: count.number, item: productName(line.productId), warehouse: warehouseName(count.warehouseId), status: statusText(count.status), system: quantity(line.systemQuantity), counted: line.countedQuantity === null ? "—" : quantity(line.countedQuantity), variance: quantity(line.varianceQuantity), value: money(line.varianceValue) }));
      return { columns: [{ key: "date", label: t("التاريخ") }, { key: "number", label: t("رقم الجرد") }, { key: "item", label: t("الصنف") }, { key: "warehouse", label: t("المستودع") }, { key: "status", label: t("الحالة") }, { key: "system", label: t("الكمية الدفترية") }, { key: "counted", label: t("الكمية الفعلية") }, { key: "variance", label: t("فرق الكمية") }, { key: "value", label: t("قيمة الفرق SAR") }], rows, summary: [{ label: t("صافي قيمة الفروقات"), value: money(countRows.reduce((sum, { line }) => sum + line.varianceValue, 0)) }, { label: t("عدد الأسطر"), value: rows.length }] };
    }

    if (view === "adjustments") {
      const rawAdjustmentRows = adjustmentLines.flatMap((line) => { const adjustment = adjustmentById.get(line.adjustmentId); if (!adjustment || adjustment.date < dateFrom || adjustment.date > dateTo || !matches(line.productId, adjustment.warehouseId)) return []; return [{ adjustment, line }]; });
      return {
        columns: [{ key: "date", label: t("التاريخ") }, { key: "number", label: t("رقم التسوية") }, { key: "item", label: t("الصنف") }, { key: "warehouse", label: t("المستودع") }, { key: "type", label: t("نوع التسوية") }, { key: "quantity", label: t("الكمية") }, { key: "unitCost", label: t("تكلفة الوحدة SAR") }, { key: "amount", label: t("القيمة SAR") }, { key: "accounting", label: t("حالة المحاسبة") }],
        rows: rawAdjustmentRows.map(({ adjustment, line }) => ({ date: adjustment.date, number: adjustment.number, item: productName(line.productId), warehouse: warehouseName(adjustment.warehouseId), type: line.type === "adjustment_in" ? t("فائض") : t("عجز"), quantity: quantity(line.quantity), unitCost: money(line.unitCost), amount: money(line.amount), accounting: statusText(adjustment.accountingStatus) })),
        summary: [{ label: t("إجمالي العجز"), value: money(rawAdjustmentRows.filter(({ line }) => line.type === "adjustment_out").reduce((sum, { line }) => sum + line.amount, 0)) }, { label: t("إجمالي الفائض"), value: money(rawAdjustmentRows.filter(({ line }) => line.type === "adjustment_in").reduce((sum, { line }) => sum + line.amount, 0)) }, { label: t("عدد الأسطر"), value: rawAdjustmentRows.length }],
      };
    }

    if (view === "manufacturing" || view === "assembly") {
      const sourceOrders = view === "manufacturing" ? manufacturingOrders : assemblyOrders;
      const periodOrders = sourceOrders.filter((order) => order.date >= dateFrom && order.date <= dateTo && matches(order.finishedProductId, order.warehouseId));
      return {
        columns: [{ key: "date", label: t("التاريخ") }, { key: "number", label: t("رقم الأمر") }, { key: "item", label: t(view === "manufacturing" ? "المنتج النهائي" : "المنتج المركب") }, { key: "warehouse", label: t("المستودع") }, { key: "quantity", label: t("الكمية") }, { key: "cost", label: t("التكلفة الفعلية SAR") }, { key: "status", label: t("حالة الأمر") }, { key: "accounting", label: t("حالة المحاسبة") }, { key: "journal", label: t("القيد المحاسبي") }],
        rows: periodOrders.map((order) => ({ date: order.date, number: order.number, item: productName(order.finishedProductId), warehouse: warehouseName(order.warehouseId), quantity: quantity(order.quantity), cost: order.status === "posted" ? money(order.totalCost) : "—", status: statusText(order.status), accounting: statusText(order.accountingStatus), journal: order.journalEntryId || t(order.status === "posted" ? "غير مطلوب" : "لم يرحل") })),
        summary: [{ label: t("إجمالي التكلفة المرحلة"), value: money(periodOrders.filter((order) => order.status === "posted").reduce((sum, order) => sum + order.totalCost, 0)) }, { label: t("الأوامر المرحلة"), value: periodOrders.filter((order) => order.status === "posted").length }, { label: t("المسودات"), value: periodOrders.filter((order) => order.status === "draft").length }, { label: t("إجمالي الأوامر"), value: periodOrders.length }],
      };
    }

    const inventoryByAccount = new Map<string, number>();
    movements.forEach((movement) => {
      const account = productById.get(movement.productId)?.inventoryAccount || "__unconfigured__";
      const sign = INBOUND_TYPES.has(movement.type) ? 1 : -1;
      inventoryByAccount.set(account, (inventoryByAccount.get(account) ?? 0) + sign * movementValue(movement));
    });
    const accountingByAccount = new Map<string, number>();
    journalLines.forEach((line) => accountingByAccount.set(line.account, (accountingByAccount.get(line.account) ?? 0) + line.debit - line.credit));
    const inventoryAccounts = new Set(products.map((product) => product.inventoryAccount || "__unconfigured__"));
    const reconciliation = [...inventoryAccounts].map((account) => {
      const inventoryValue = inventoryByAccount.get(account) ?? 0;
      const accountingValue = account === "__unconfigured__" ? 0 : accountingByAccount.get(account) ?? 0;
      const difference = inventoryValue - accountingValue;
      return { account, inventoryValue, accountingValue, difference };
    }).filter((item) => Math.abs(item.inventoryValue) > 0.005 || Math.abs(item.accountingValue) > 0.005 || item.account === "__unconfigured__").sort((a, b) => a.account.localeCompare(b.account));
    const totalInventory = reconciliation.reduce((sum, item) => sum + item.inventoryValue, 0);
    const totalAccounting = reconciliation.reduce((sum, item) => sum + item.accountingValue, 0);
    // رصيد 2113 (مدين − دائن): السالب = رصيد دائن (بضاعة مستلمة لم تصل فواتيرها)، الموجب = رصيد مدين (فواتير لبضاعة لم تُستلم)
    const grniBalance = accountingByAccount.get(GRNI_ACCOUNT) ?? 0;
    const grniSide = grniBalance < -0.005 ? t("دائن") : grniBalance > 0.005 ? t("مدين") : "";
    const grniMeaning = grniBalance < -0.005 ? t("بضاعة مستلمة لم تُسجل فواتيرها بعد") : grniBalance > 0.005 ? t("فواتير مسجلة لبضاعة لم تُستلم بعد") : t("لا يوجد رصيد معلق");
    return {
      columns: [{ key: "account", label: t("حساب أصل المخزون") }, { key: "inventory", label: t("قيمة دفتر المخزون SAR") }, { key: "accounting", label: t("رصيد الأستاذ العام SAR") }, { key: "difference", label: t("الفرق SAR") }, { key: "status", label: t("حالة المطابقة") }],
      rows: reconciliation.map((item) => ({ account: item.account === "__unconfigured__" ? t("منتجات دون حساب مخزون") : item.account, inventory: money(item.inventoryValue), accounting: money(item.accountingValue), difference: money(item.difference), status: Math.abs(item.difference) <= 0.01 ? t("متطابق") : t("يوجد فرق") })),
      summary: [{ label: t("إجمالي دفتر المخزون"), value: money(totalInventory) }, { label: t("إجمالي الأستاذ العام"), value: money(totalAccounting) }, { label: t("صافي الفرق"), value: money(totalInventory - totalAccounting) }, { label: t("حسابات غير متطابقة"), value: reconciliation.filter((item) => Math.abs(item.difference) > 0.01).length }, { label: t("رصيد 2113 بضاعة مستلمة لم تصل فواتيرها"), value: grniSide ? `${money(Math.abs(grniBalance))} ${grniSide}` : money(0) }, { label: t("دلالة رصيد 2113"), value: grniMeaning }],
    };
  }, [adjustmentById, adjustmentLines, assemblyOrders, countById, countLines, dateFrom, dateTo, journalLines, manufacturingOrders, movements, productById, productFilter, products, transferById, warehouseById, warehouseFilter, locale, formatNumber, t, view]);

  const exportOptions = { title: t(currentReport.label), subtitle: view === "reconciliation" ? `${t("حتى تاريخ")} ${dateTo}` : `${t("من تاريخ")} ${dateFrom} ${t("إلى تاريخ")} ${dateTo}`, columns: report.columns, rows: report.rows, fileName: currentReport.label, summary: report.summary, landscape: true, brand: COMPANY_REPORT_BRAND };

  return <Layout><main dir={direction} className="min-h-full bg-slate-50 p-4"><div className="mx-auto max-w-[1600px] overflow-hidden rounded border border-slate-200 bg-white shadow-sm">
    <header className="border-t-2 border-red-700 px-4 py-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[11px] text-slate-400">{t("المخزون")} / {t("التقارير")}</p><h1 className="text-base font-bold text-slate-800">{t(currentReport.label)}</h1></div><div className="flex gap-1"><button onClick={() => void load()} className="rounded border border-slate-200 p-2" title={t("تحديث")}><RefreshCw className="h-4 w-4" /></button><button onClick={() => printReport(exportOptions)} disabled={invalidRange || loading || Boolean(error)} className="rounded border border-slate-200 p-2 disabled:opacity-40" title={t("طباعة")}><Printer className="h-4 w-4" /></button><button onClick={() => exportReportExcel(exportOptions)} disabled={invalidRange || loading || Boolean(error)} className="rounded border border-slate-200 p-2 disabled:opacity-40" title={t("تصدير Excel")}><Download className="h-4 w-4" /></button></div></div></header>
    <div className="grid grid-cols-2 border-b border-slate-100 md:grid-cols-4 xl:grid-cols-10">{REPORTS.map((item) => <button key={item.id} onClick={() => setView(item.id)} className={`border-s border-b border-slate-100 px-3 py-3 text-xs font-semibold ${view === item.id ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-50"}`}>{t(item.label)}</button>)}</div>
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3"><div className="flex flex-wrap gap-2"><label className="text-xs text-slate-500">{t("من تاريخ")}<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} disabled={view === "reconciliation"} className={`mt-1 block rounded border bg-white px-2 py-1.5 text-xs disabled:opacity-40 ${invalidRange ? "border-red-400" : "border-slate-200"}`} /></label><label className="text-xs text-slate-500">{t("إلى تاريخ")}<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className={`mt-1 block rounded border bg-white px-2 py-1.5 text-xs ${invalidRange ? "border-red-400" : "border-slate-200"}`} /></label><label className="text-xs text-slate-500">{t("الصنف")}<select value={productFilter} onChange={(event) => setProductFilter(event.target.value)} disabled={view === "reconciliation"} className="mt-1 block max-w-64 rounded border border-slate-200 bg-white px-2 py-1.5 text-xs disabled:opacity-40"><option value="">{t("كل الأصناف")}</option>{products.map((product) => <option key={product.id} value={product.id}>{productName(product.id)}</option>)}</select></label><label className="text-xs text-slate-500">{t("المستودع")}<select value={warehouseFilter} onChange={(event) => setWarehouseFilter(event.target.value)} disabled={view === "reconciliation"} className="mt-1 block max-w-64 rounded border border-slate-200 bg-white px-2 py-1.5 text-xs disabled:opacity-40"><option value="">{t("كل المستودعات")}</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouseName(warehouse.id)}</option>)}</select></label></div><span className="rounded bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">{t("بيانات فعلية من دفتر المخزون")}</span></div>
    <section className="p-4"><p className="mb-3 text-xs text-slate-500">{t(currentReport.description)}</p>{view === "reconciliation" && <p className="mb-3 text-xs text-slate-500">{t("حساب 2113: الرصيد الدائن يمثل بضاعة استُلمت بسندات استلام ولم تُسجل فواتير مورديها بعد، والرصيد المدين يمثل فواتير موردين سُجلت على 2113 لبضاعة لم تُستلم بعد.")}</p>}{invalidRange ? <p className="py-16 text-center text-sm text-red-600">{t("تاريخ البداية يجب أن يسبق تاريخ النهاية")}</p> : loading ? <p className="py-16 text-center text-sm text-slate-500">{t("جاري التحميل...")}</p> : error ? <p className="py-16 text-center text-sm text-red-600">{error}</p> : <><div className="overflow-x-auto"><table className="min-w-full text-[11px]"><thead className="bg-slate-100 text-slate-700"><tr>{report.columns.map((column) => <th key={column.key} className="border-b px-3 py-2 text-center">{column.label}</th>)}</tr></thead><tbody>{report.rows.length ? report.rows.map((row, index) => <tr key={`${index}-${row.number ?? row.item ?? "row"}`} className="border-b border-slate-100 hover:bg-slate-50">{report.columns.map((column) => <td key={column.key} className="whitespace-nowrap px-3 py-2 text-center">{isEmpty(row[column.key]) ? "—" : row[column.key]}</td>)}</tr>) : <tr><td colSpan={report.columns.length} className="py-16 text-center text-sm text-slate-400">{t("لا توجد بيانات في الفترة المحددة")}</td></tr>}</tbody></table></div>{report.summary.length > 0 && <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{report.summary.map((item) => <div key={item.label} className="rounded border border-slate-200 bg-slate-50 px-3 py-2"><p className="text-[10px] text-slate-500">{item.label}</p><p className="mt-1 text-sm font-bold text-slate-800">{item.value}</p></div>)}</div>}</>}
    </section>
  </div></main></Layout>;
}
