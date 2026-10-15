import { useEffect, useMemo, useState } from "react";
import { Edit3, Factory, Loader2, PackagePlus, Plus, Save, Send, Trash2, X } from "lucide-react";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { riyadhDateString } from "@/lib/utils";
import { selectAllRows } from "@/lib/ledgerData";
import { inventoryErrorText } from "@/lib/inventoryErrors";

type Product = { id: string; sku: string; name: string; unit: string };
type Warehouse = { id: string; code: string; name: string };
type Balance = { productId: string; warehouseId: string; quantity: number; value: number };
type BomLine = { id: number; productId: string; quantity: string };
type Bom = { id: string; number: string; finishedProductId: string; outputQuantity: string; notes: string; active: boolean; lines: BomLine[] };
type OrderLine = { productId: string; quantity: number; unitCost: number; amount: number };
type ManufacturingOrder = { id: string; number: string; date: string; bomId: string; finishedProductId: string; warehouseId: string; quantity: string; reference: string; notes: string; status: "draft" | "posted"; accountingStatus: string; totalCost: number; lines: OrderLine[] };
type FormMode = "bom" | "order" | null;

const today = () => riyadhDateString();
const numberValue = (value: string) => Number(value) || 0;
const newBomLine = (id = Date.now()): BomLine => ({ id, productId: "", quantity: "1" });

export default function InventoryManufacturing() {
  const { t, direction, formatNumber } = useI18n();
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [boms, setBoms] = useState<Bom[]>([]);
  const [orders, setOrders] = useState<ManufacturingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<FormMode>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [finishedProductId, setFinishedProductId] = useState("");
  const [outputQuantity, setOutputQuantity] = useState("1");
  const [bomNotes, setBomNotes] = useState("");
  const [bomActive, setBomActive] = useState(true);
  const [bomLines, setBomLines] = useState<BomLine[]>([newBomLine()]);

  const [orderDate, setOrderDate] = useState(today());
  const [bomId, setBomId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [orderQuantity, setOrderQuantity] = useState("1");
  const [reference, setReference] = useState("");
  const [orderNotes, setOrderNotes] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    const [productResult, warehouseResult, balanceResult, bomResult, bomLineResult, orderResult, orderLineResult] = await Promise.all([
      selectAllRows((from, to) => supabase.from("inventory_products").select("id, sku, name_ar, unit").eq("item_type", "product").eq("track_inventory", true).eq("active", true).order("sku").order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("inventory_warehouses").select("id, code, name_ar").eq("active", true).order("code").order("id").range(from, to)),
      supabase.rpc("list_inventory_balances"),
      selectAllRows((from, to) => supabase.from("inventory_boms").select("id, bom_number, finished_product_id, output_quantity, notes, active").order("created_at", { ascending: false }).order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("inventory_bom_lines").select("id, bom_id, component_product_id, quantity").order("created_at").order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("inventory_manufacturing_orders").select("id, order_number, order_date, bom_id, finished_product_id, warehouse_id, quantity, reference, notes, status, accounting_status, total_cost").order("created_at", { ascending: false }).order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("inventory_manufacturing_order_lines").select("id, order_id, component_product_id, quantity, unit_cost, amount").order("created_at").order("id").range(from, to)),
    ]);
    const firstError = productResult.error ?? warehouseResult.error ?? balanceResult.error ?? bomResult.error ?? bomLineResult.error ?? orderResult.error ?? orderLineResult.error;
    if (firstError) { setError(inventoryErrorText(firstError.message, t)); setLoading(false); return; }
    setProducts((productResult.data ?? []).map((row) => ({ id: String(row.id), sku: String(row.sku), name: String(row.name_ar), unit: String(row.unit ?? "") })));
    setWarehouses((warehouseResult.data ?? []).map((row) => ({ id: String(row.id), code: String(row.code), name: String(row.name_ar) })));
    setBalances((balanceResult.data ?? []).map((row) => ({ productId: String(row.product_id), warehouseId: String(row.warehouse_id), quantity: Number(row.quantity) || 0, value: Number(row.inventory_value) || 0 })));
    const loadedBoms: Bom[] = (bomResult.data ?? []).map((row) => ({
      id: String(row.id), number: String(row.bom_number), finishedProductId: String(row.finished_product_id), outputQuantity: String(row.output_quantity), notes: String(row.notes ?? ""), active: Boolean(row.active),
      lines: (bomLineResult.data ?? []).filter((line) => line.bom_id === row.id).map((line, index) => ({ id: index + 1, productId: String(line.component_product_id), quantity: String(line.quantity) })),
    }));
    setBoms(loadedBoms);
    setOrders((orderResult.data ?? []).map((row) => ({
      id: String(row.id), number: String(row.order_number), date: String(row.order_date), bomId: String(row.bom_id), finishedProductId: String(row.finished_product_id), warehouseId: String(row.warehouse_id), quantity: String(row.quantity), reference: String(row.reference ?? ""), notes: String(row.notes ?? ""), status: row.status as ManufacturingOrder["status"], accountingStatus: String(row.accounting_status), totalCost: Number(row.total_cost) || 0,
      lines: (orderLineResult.data ?? []).filter((line) => line.order_id === row.id).map((line) => ({ productId: String(line.component_product_id), quantity: Number(line.quantity) || 0, unitCost: Number(line.unit_cost) || 0, amount: Number(line.amount) || 0 })),
    })));
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const productName = (id: string) => { const product = products.find((item) => item.id === id); return product ? `${product.sku} — ${product.name}` : "—"; };
  const warehouseName = (id: string) => { const warehouse = warehouses.find((item) => item.id === id); return warehouse ? `${warehouse.code} — ${warehouse.name}` : "—"; };
  const selectedBom = boms.find((bom) => bom.id === bomId);
  const requiredComponents = useMemo(() => {
    if (!selectedBom || numberValue(selectedBom.outputQuantity) <= 0) return [];
    return selectedBom.lines.map((line) => ({ productId: line.productId, quantity: numberValue(line.quantity) * numberValue(orderQuantity) / numberValue(selectedBom.outputQuantity) }));
  }, [selectedBom, orderQuantity]);
  const estimatedCost = useMemo(() => requiredComponents.reduce((sum, line) => {
    const balance = balances.find((item) => item.productId === line.productId && item.warehouseId === warehouseId);
    return sum + line.quantity * (balance && balance.quantity > 0 ? balance.value / balance.quantity : 0);
  }, 0), [requiredComponents, balances, warehouseId]);

  const closeForm = () => { setMode(null); setEditingId(null); setError(""); };
  const startBom = () => { setMode("bom"); setEditingId(null); setFinishedProductId(""); setOutputQuantity("1"); setBomNotes(""); setBomActive(true); setBomLines([newBomLine()]); setError(""); };
  const editBom = (bom: Bom) => { setMode("bom"); setEditingId(bom.id); setFinishedProductId(bom.finishedProductId); setOutputQuantity(bom.outputQuantity); setBomNotes(bom.notes); setBomActive(bom.active); setBomLines(bom.lines.length ? bom.lines : [newBomLine()]); setError(""); };
  const startOrder = () => { setMode("order"); setEditingId(null); setOrderDate(today()); setBomId(""); setWarehouseId(""); setOrderQuantity("1"); setReference(""); setOrderNotes(""); setError(""); };
  const editOrder = (order: ManufacturingOrder) => { if (order.status !== "draft") return; setMode("order"); setEditingId(order.id); setOrderDate(order.date); setBomId(order.bomId); setWarehouseId(order.warehouseId); setOrderQuantity(order.quantity); setReference(order.reference); setOrderNotes(order.notes); setError(""); };

  const saveBom = async () => {
    const componentIds = bomLines.map((line) => line.productId).filter(Boolean);
    if (!finishedProductId || numberValue(outputQuantity) <= 0 || componentIds.length !== bomLines.length || new Set(componentIds).size !== componentIds.length || componentIds.includes(finishedProductId) || bomLines.some((line) => numberValue(line.quantity) <= 0)) {
      setError(t("أكمل بيانات قائمة المكونات وتأكد من عدم تكرار المواد أو استخدام المنتج النهائي كمكوّن")); return;
    }
    setBusy(true); setError("");
    const { error: saveError } = await supabase.rpc("save_inventory_bom", { p_id: editingId, p_bom: { finishedProductId, outputQuantity: numberValue(outputQuantity), notes: bomNotes.trim(), active: bomActive, lines: bomLines.map((line) => ({ productId: line.productId, quantity: numberValue(line.quantity) })) } });
    setBusy(false);
    if (saveError) { setError(inventoryErrorText(saveError.message, t)); return; }
    toast({ title: t("تم حفظ قائمة المكونات") }); closeForm(); await load();
  };

  const saveOrder = async () => {
    if (!orderDate || !bomId || !warehouseId || numberValue(orderQuantity) <= 0) { setError(t("أكمل بيانات أمر التصنيع")); return; }
    setBusy(true); setError("");
    const { error: saveError } = await supabase.rpc("save_inventory_manufacturing_order", { p_id: editingId, p_order: { orderDate, bomId, warehouseId, quantity: numberValue(orderQuantity), reference: reference.trim(), notes: orderNotes.trim() } });
    setBusy(false);
    if (saveError) { setError(inventoryErrorText(saveError.message, t)); return; }
    toast({ title: t("تم حفظ أمر التصنيع كمسودة") }); closeForm(); await load();
  };

  const postOrder = async (order: ManufacturingOrder) => {
    if (!confirm(t("هل تريد ترحيل أمر التصنيع؟ سيتم صرف المكونات واستلام المنتج النهائي وإنشاء القيد المحاسبي، ولن يمكن تعديل الأمر بعد ذلك."))) return;
    setBusy(true);
    const { error: postError } = await supabase.rpc("post_inventory_manufacturing_order", { p_id: order.id });
    setBusy(false);
    if (postError) { toast({ title: t("تعذر ترحيل أمر التصنيع"), description: inventoryErrorText(postError.message, t), variant: "destructive" }); return; }
    toast({ title: t("تم ترحيل أمر التصنيع والمخزون والمحاسبة") }); await load();
  };

  const removeOrder = async (order: ManufacturingOrder) => {
    if (!confirm(t("هل تريد حذف مسودة أمر التصنيع؟"))) return;
    setBusy(true);
    const { error: deleteError } = await supabase.rpc("delete_inventory_manufacturing_order_draft", { p_id: order.id });
    setBusy(false);
    if (deleteError) { toast({ title: t("تعذر حذف أمر التصنيع"), description: inventoryErrorText(deleteError.message, t), variant: "destructive" }); return; }
    toast({ title: t("تم حذف المسودة") }); await load();
  };

  return <Layout><main dir={direction} className="space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-5 shadow-sm"><div className="flex items-center gap-3"><div className="rounded-lg bg-indigo-50 p-2 text-indigo-700"><Factory className="h-6 w-6" /></div><div><h1 className="text-2xl font-bold text-slate-900">{t("أوامر التصنيع")}</h1><p className="mt-1 text-sm text-slate-500">{t("صرف مكونات الإنتاج واستلام المنتج النهائي بالتكلفة الفعلية مع قيد إعادة تصنيف متوازن.")}</p></div></div><div className="flex gap-2"><button onClick={startBom} className="inline-flex items-center gap-2 rounded border border-indigo-200 px-4 py-2 text-sm font-semibold text-indigo-700"><PackagePlus className="h-4 w-4" />{t("قائمة مكونات جديدة")}</button><button onClick={startOrder} className="inline-flex items-center gap-2 rounded bg-indigo-700 px-4 py-2 text-sm font-semibold text-white"><Plus className="h-4 w-4" />{t("أمر تصنيع جديد")}</button></div></header>
    {error && <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

    {mode === "bom" && <section className="rounded-xl border bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><h2 className="font-bold">{t(editingId ? "تعديل قائمة المكونات" : "قائمة مكونات جديدة")}</h2><button onClick={closeForm}><X className="h-5 w-5" /></button></div><div className="grid gap-3 md:grid-cols-3"><label className="text-xs text-slate-600">{t("المنتج النهائي")}<select value={finishedProductId} onChange={(event) => setFinishedProductId(event.target.value)} className="mt-1 h-10 w-full rounded border px-2"><option value="">{t("اختر المنتج النهائي")}</option>{products.map((product) => <option key={product.id} value={product.id}>{productName(product.id)} ({product.unit})</option>)}</select></label><label className="text-xs text-slate-600">{t("كمية الإنتاج القياسية")}<input type="number" min="0.0001" step="0.0001" value={outputQuantity} onChange={(event) => setOutputQuantity(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label><label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={bomActive} onChange={(event) => setBomActive(event.target.checked)} />{t("قائمة نشطة")}</label><label className="text-xs text-slate-600 md:col-span-3">{t("ملاحظات")}<input value={bomNotes} onChange={(event) => setBomNotes(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label></div><div className="mt-5 overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-100"><tr><th className="p-2">{t("المكوّن")}</th><th className="p-2">{t("الكمية المطلوبة")}</th><th className="p-2" /></tr></thead><tbody>{bomLines.map((line) => <tr key={line.id} className="border-b"><td className="p-2"><select value={line.productId} onChange={(event) => setBomLines((current) => current.map((item) => item.id === line.id ? { ...item, productId: event.target.value } : item))} className="h-10 w-full min-w-64 rounded border px-2"><option value="">{t("اختر المكوّن")}</option>{products.filter((product) => product.id !== finishedProductId).map((product) => <option key={product.id} value={product.id}>{productName(product.id)} ({product.unit})</option>)}</select></td><td className="p-2"><input type="number" min="0.0001" step="0.0001" value={line.quantity} onChange={(event) => setBomLines((current) => current.map((item) => item.id === line.id ? { ...item, quantity: event.target.value } : item))} className="h-10 w-32 rounded border px-2" /></td><td className="p-2"><button disabled={bomLines.length === 1} onClick={() => setBomLines((current) => current.filter((item) => item.id !== line.id))} className="rounded border border-red-200 p-2 text-red-600 disabled:opacity-40"><Trash2 className="h-4 w-4" /></button></td></tr>)}</tbody></table></div><div className="mt-4 flex justify-between"><button onClick={() => setBomLines((current) => [...current, newBomLine(Date.now() + current.length)])} className="rounded border px-3 py-2 text-sm">{t("إضافة مكوّن")}</button><button disabled={busy} onClick={() => void saveBom()} className="inline-flex items-center gap-2 rounded bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{t("حفظ قائمة المكونات")}</button></div></section>}

    {mode === "order" && <section className="rounded-xl border bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><h2 className="font-bold">{t(editingId ? "تعديل مسودة أمر التصنيع" : "أمر تصنيع جديد")}</h2><button onClick={closeForm}><X className="h-5 w-5" /></button></div><div className="grid gap-3 md:grid-cols-3"><label className="text-xs text-slate-600">{t("تاريخ التصنيع")}<input type="date" max={today()} value={orderDate} onChange={(event) => setOrderDate(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label><label className="text-xs text-slate-600">{t("قائمة المكونات")}<select value={bomId} onChange={(event) => setBomId(event.target.value)} className="mt-1 h-10 w-full rounded border px-2"><option value="">{t("اختر قائمة المكونات")}</option>{boms.filter((bom) => bom.active || bom.id === bomId).map((bom) => <option key={bom.id} value={bom.id}>{bom.number} — {productName(bom.finishedProductId)}</option>)}</select></label><label className="text-xs text-slate-600">{t("المستودع")}<select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} className="mt-1 h-10 w-full rounded border px-2"><option value="">{t("اختر المستودع")}</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouseName(warehouse.id)}</option>)}</select></label><label className="text-xs text-slate-600">{t("الكمية المطلوب إنتاجها")}<input type="number" min="0.0001" step="0.0001" value={orderQuantity} onChange={(event) => setOrderQuantity(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label><label className="text-xs text-slate-600">{t("المرجع")}<input value={reference} onChange={(event) => setReference(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label><label className="text-xs text-slate-600">{t("ملاحظات")}<input value={orderNotes} onChange={(event) => setOrderNotes(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label></div>{selectedBom && <div className="mt-5 overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-100"><tr><th className="p-2">{t("المكوّن")}</th><th className="p-2">{t("المطلوب")}</th><th className="p-2">{t("المتاح")}</th><th className="p-2">{t("متوسط التكلفة")}</th></tr></thead><tbody>{requiredComponents.map((line) => { const balance = balances.find((item) => item.productId === line.productId && item.warehouseId === warehouseId) ?? { quantity: 0, value: 0 }; const average = balance.quantity > 0 ? balance.value / balance.quantity : 0; return <tr key={line.productId} className="border-b"><td className="p-2">{productName(line.productId)}</td><td className="p-2 text-center font-semibold">{formatNumber(line.quantity, { maximumFractionDigits: 4 })}</td><td className={`p-2 text-center font-semibold ${balance.quantity < line.quantity ? "text-red-600" : "text-emerald-700"}`}>{formatNumber(balance.quantity, { maximumFractionDigits: 4 })}</td><td className="p-2 text-center">{formatNumber(average, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} SAR</td></tr>; })}</tbody></table></div>}<div className="mt-4 flex items-center justify-end gap-5"><p className="font-bold">{t("التكلفة التقديرية")}: {formatNumber(estimatedCost, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SAR</p><button disabled={busy} onClick={() => void saveOrder()} className="inline-flex items-center gap-2 rounded bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{t("حفظ المسودة")}</button></div></section>}

    <section className="overflow-hidden rounded-xl border bg-white shadow-sm"><div className="border-b px-4 py-3"><h2 className="font-bold">{t("قوائم المكونات")}</h2></div><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-100 text-slate-600"><tr><th className="p-3">{t("الرقم")}</th><th className="p-3">{t("المنتج النهائي")}</th><th className="p-3">{t("كمية الإنتاج")}</th><th className="p-3">{t("عدد المكونات")}</th><th className="p-3">{t("الحالة")}</th><th className="p-3">{t("الإجراءات")}</th></tr></thead><tbody>{loading ? <tr><td colSpan={6} className="py-10 text-center">{t("جاري التحميل...")}</td></tr> : boms.length === 0 ? <tr><td colSpan={6} className="py-10 text-center text-slate-400">{t("لا توجد قوائم مكونات")}</td></tr> : boms.map((bom) => <tr key={bom.id} className="border-t"><td className="p-3 font-mono">{bom.number}</td><td className="p-3">{productName(bom.finishedProductId)}</td><td className="p-3 text-center">{formatNumber(numberValue(bom.outputQuantity), { maximumFractionDigits: 4 })}</td><td className="p-3 text-center">{bom.lines.length}</td><td className="p-3 text-center"><span className={`rounded px-2 py-1 text-xs font-semibold ${bom.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{t(bom.active ? "نشطة" : "موقوفة")}</span></td><td className="p-3 text-center"><button disabled={busy} onClick={() => editBom(bom)} className="rounded border p-2 text-indigo-700" title={t("تعديل")}><Edit3 className="h-4 w-4" /></button></td></tr>)}</tbody></table></div></section>

    <section className="overflow-hidden rounded-xl border bg-white shadow-sm"><div className="border-b px-4 py-3"><h2 className="font-bold">{t("أوامر التصنيع")}</h2></div><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-100 text-slate-600"><tr><th className="p-3">{t("رقم الأمر")}</th><th className="p-3">{t("التاريخ")}</th><th className="p-3">{t("المنتج النهائي")}</th><th className="p-3">{t("المستودع")}</th><th className="p-3">{t("الكمية")}</th><th className="p-3">{t("التكلفة")}</th><th className="p-3">{t("الحالة")}</th><th className="p-3">{t("الإجراءات")}</th></tr></thead><tbody>{loading ? <tr><td colSpan={8} className="py-14 text-center">{t("جاري التحميل...")}</td></tr> : orders.length === 0 ? <tr><td colSpan={8} className="py-14 text-center text-slate-400">{t("لا توجد أوامر تصنيع")}</td></tr> : orders.map((order) => <tr key={order.id} className="border-t"><td className="p-3 font-mono">{order.number}</td><td className="p-3 text-center">{order.date}</td><td className="p-3">{productName(order.finishedProductId)}</td><td className="p-3">{warehouseName(order.warehouseId)}</td><td className="p-3 text-center">{formatNumber(numberValue(order.quantity), { maximumFractionDigits: 4 })}</td><td className="p-3 text-center font-semibold">{formatNumber(order.status === "posted" ? order.totalCost : order.lines.reduce((sum, line) => sum + line.amount, 0), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SAR</td><td className="p-3 text-center"><span className={`rounded px-2 py-1 text-xs font-semibold ${order.status === "posted" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{t(order.status === "posted" ? "مرحّل" : "مسودة")}</span></td><td className="p-3"><div className="flex justify-center gap-1">{order.status === "draft" && <><button disabled={busy} onClick={() => editOrder(order)} className="rounded border p-2 text-indigo-700" title={t("تعديل")}><Edit3 className="h-4 w-4" /></button><button disabled={busy} onClick={() => void postOrder(order)} className="rounded border p-2 text-emerald-700" title={t("ترحيل")}><Send className="h-4 w-4" /></button><button disabled={busy} onClick={() => void removeOrder(order)} className="rounded border p-2 text-red-600" title={t("حذف")}><Trash2 className="h-4 w-4" /></button></>}</div></td></tr>)}</tbody></table></div></section>
  </main></Layout>;
}
