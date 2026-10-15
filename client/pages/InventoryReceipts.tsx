import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, Edit3, Loader2, Plus, Save, Send, Trash2, X } from "lucide-react";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { riyadhDateString } from "@/lib/utils";
import { selectAllRows } from "@/lib/ledgerData";
import { inventoryErrorText } from "@/lib/inventoryErrors";

type Product = { id: string; sku: string; name: string; unit: string };
type Warehouse = { id: string; code: string; name: string };
type Vendor = { id: string; name: string };
type ReceiptLine = { id: number; productId: string; quantity: string; unitCost: string };
type Receipt = {
  id: string; number: string; date: string; warehouseId: string; vendorId: string;
  purchaseOrderId: string; reference: string; notes: string; status: "draft" | "posted";
  accountingStatus: string; lines: ReceiptLine[];
};

const today = () => riyadhDateString();
const newLine = (id = Date.now()): ReceiptLine => ({ id, productId: "", quantity: "1", unitCost: "0" });
const numberValue = (value: string) => Number(value) || 0;
const ACCOUNTING_STATUS_LABELS: Record<string, string> = { pending: "مسودة", pending_invoice: "بانتظار الفاتورة (قديم)", posted: "مُرحّل بقيد", not_required: "بدون قيد" };

export default function InventoryReceipts() {
  const { t, direction, formatNumber } = useI18n();
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null | undefined>(undefined);
  const [date, setDate] = useState(today());
  const [warehouseId, setWarehouseId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [purchaseOrderId, setPurchaseOrderId] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<ReceiptLine[]>([newLine()]);

  const load = async () => {
    setLoading(true); setError("");
    const [receiptResult, lineResult, productResult, warehouseResult, vendorResult] = await Promise.all([
      selectAllRows((from, to) => supabase.from("inventory_receipts").select("id, receipt_number, receipt_date, warehouse_id, vendor_id, purchase_order_id, reference, notes, status, accounting_status").order("created_at", { ascending: false }).order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("inventory_receipt_lines").select("id, receipt_id, product_id, quantity, unit_cost").order("created_at").order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("inventory_products").select("id, sku, name_ar, unit").eq("item_type", "product").eq("active", true).order("sku").order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("inventory_warehouses").select("id, code, name_ar").eq("active", true).order("code").order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("vendors").select("id, name").order("name").order("id").range(from, to)),
    ]);
    const firstError = receiptResult.error ?? lineResult.error ?? productResult.error ?? warehouseResult.error ?? vendorResult.error;
    if (firstError) { setError(inventoryErrorText(firstError.message, t)); setLoading(false); return; }
    setProducts((productResult.data ?? []).map((row) => ({ id: String(row.id), sku: String(row.sku), name: String(row.name_ar), unit: String(row.unit) })));
    setWarehouses((warehouseResult.data ?? []).map((row) => ({ id: String(row.id), code: String(row.code), name: String(row.name_ar) })));
    setVendors((vendorResult.data ?? []).map((row) => ({ id: String(row.id), name: String(row.name ?? "") })));
    setReceipts((receiptResult.data ?? []).map((row) => ({
      id: String(row.id), number: String(row.receipt_number), date: String(row.receipt_date), warehouseId: String(row.warehouse_id),
      vendorId: String(row.vendor_id ?? ""), purchaseOrderId: String(row.purchase_order_id ?? ""), reference: String(row.reference ?? ""),
      notes: String(row.notes ?? ""), status: row.status as Receipt["status"], accountingStatus: String(row.accounting_status),
      lines: (lineResult.data ?? []).filter((line) => line.receipt_id === row.id).map((line, index) => ({ id: index + 1, productId: String(line.product_id), quantity: String(line.quantity), unitCost: String(line.unit_cost) })),
    })));
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const total = useMemo(() => lines.reduce((sum, line) => sum + numberValue(line.quantity) * numberValue(line.unitCost), 0), [lines]);
  const reset = () => { setEditingId(undefined); setDate(today()); setWarehouseId(""); setVendorId(""); setPurchaseOrderId(""); setReference(""); setNotes(""); setLines([newLine()]); setError(""); };
  const startNew = () => { reset(); setEditingId(null); };
  const startEdit = (receipt: Receipt) => { if (receipt.status !== "draft") return; setEditingId(receipt.id); setDate(receipt.date); setWarehouseId(receipt.warehouseId); setVendorId(receipt.vendorId); setPurchaseOrderId(receipt.purchaseOrderId); setReference(receipt.reference); setNotes(receipt.notes); setLines(receipt.lines.length ? receipt.lines : [newLine()]); setError(""); };
  const updateLine = (id: number, field: keyof Omit<ReceiptLine, "id">, value: string) => setLines((current) => current.map((line) => line.id === id ? { ...line, [field]: value } : line));

  const save = async () => {
    const productIds = lines.map((line) => line.productId).filter(Boolean);
    if (!date || !warehouseId || lines.length === 0 || productIds.length !== lines.length || new Set(productIds).size !== productIds.length || lines.some((line) => numberValue(line.quantity) <= 0 || numberValue(line.unitCost) < 0)) {
      setError(t("أكمل بيانات الاستلام وتأكد من عدم تكرار الأصناف وصحة الكميات والتكاليف")); return;
    }
    // المورد إلزامي: رصيد 2113 (بضاعة مستلمة لم تصل فواتيرها) يُطابق مع فواتير كل مورد على حدة
    if (!vendorId) { setError(t("اختر المورد: سند الاستلام يُطابق مع فاتورة المورد على الحساب 2113 لكل مورد على حدة.")); return; }
    if (lines.some((line) => numberValue(line.unitCost) <= 0)) { setError(t("تكلفة الوحدة يجب أن تكون أكبر من صفر: أدخل سعر المورد بدون ضريبة القيمة المضافة لكل صنف.")); return; }
    setBusy(true); setError("");
    const { error: saveError } = await supabase.rpc("save_inventory_receipt", { p_id: editingId || null, p_receipt: { receiptDate: date, warehouseId, vendorId: vendorId || null, purchaseOrderId: purchaseOrderId.trim() || null, reference: reference.trim(), notes: notes.trim(), lines: lines.map((line) => ({ productId: line.productId, quantity: numberValue(line.quantity), unitCost: numberValue(line.unitCost) })) } });
    setBusy(false);
    if (saveError) { setError(inventoryErrorText(saveError.message, t)); return; }
    toast({ title: t("تم حفظ سند الاستلام كمسودة") }); reset(); await load();
  };

  const post = async (receipt: Receipt) => {
    if (!confirm(t("هل تريد ترحيل سند الاستلام؟ سيتم إنشاء حركة المخزون والقيد المحاسبي (مدين حساب المخزون / دائن 2113 بضاعة مستلمة لم تصل فواتيرها)، ولن يمكن تعديل السند بعد ذلك."))) return;
    setBusy(true); const { error: postError } = await supabase.rpc("post_inventory_receipt", { p_id: receipt.id }); setBusy(false);
    if (postError) { toast({ title: t("تعذر ترحيل سند الاستلام"), description: inventoryErrorText(postError.message, t), variant: "destructive" }); return; }
    toast({ title: t("تم ترحيل سند الاستلام إلى المخزون") }); await load();
  };

  const remove = async (receipt: Receipt) => {
    if (!confirm(t("هل تريد حذف مسودة سند الاستلام؟"))) return;
    setBusy(true); const { error: deleteError } = await supabase.rpc("delete_inventory_receipt_draft", { p_id: receipt.id }); setBusy(false);
    if (deleteError) { toast({ title: t("تعذر حذف السند"), description: inventoryErrorText(deleteError.message, t), variant: "destructive" }); return; }
    toast({ title: t("تم حذف المسودة") }); await load();
  };

  const warehouseName = (id: string) => warehouses.find((warehouse) => warehouse.id === id)?.name ?? "—";
  const vendorName = (id: string) => vendors.find((vendor) => vendor.id === id)?.name ?? "—";

  return <Layout><main dir={direction} className="space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-5 shadow-sm"><div className="flex items-center gap-3"><div className="rounded-lg bg-sky-50 p-2 text-sky-700"><ClipboardCheck className="h-6 w-6" /></div><div><h1 className="text-2xl font-bold text-slate-900">{t("سندات استلام المخزون")}</h1><p className="mt-1 text-sm text-slate-500">{t("ترحيل السند يضيف الكميات إلى المخزون ويسجّل قيدًا: مدين حساب المخزون / دائن 2113 «بضاعة مستلمة لم تصل فواتيرها». عند تسجيل فاتورة المورد لهذه البضاعة اختر الحساب 2113 لبنودها.")}</p></div></div><button onClick={startNew} className="inline-flex items-center gap-2 rounded bg-sky-700 px-4 py-2 text-sm font-semibold text-white"><Plus className="h-4 w-4" />{t("سند استلام جديد")}</button></header>
    {error && <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

    {editingId !== undefined && <section className="rounded-xl border bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><h2 className="font-bold">{t(editingId ? "تعديل مسودة الاستلام" : "سند استلام جديد")}</h2><button onClick={reset}><X className="h-5 w-5" /></button></div><div className="grid gap-3 md:grid-cols-3"><label className="text-xs text-slate-600">{t("تاريخ الاستلام")}<input type="date" max={today()} value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label><label className="text-xs text-slate-600">{t("المستودع")}<select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} className="mt-1 h-10 w-full rounded border px-2"><option value="">{t("اختر المستودع")}</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} — {warehouse.name}</option>)}</select></label><label className="text-xs text-slate-600">{t("المورد")}<select value={vendorId} onChange={(event) => setVendorId(event.target.value)} className="mt-1 h-10 w-full rounded border px-2"><option value="">{t("اختر المورد")}</option>{vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select></label><label className="text-xs text-slate-600">{t("رقم أمر الشراء — اختياري")}<input value={purchaseOrderId} onChange={(event) => setPurchaseOrderId(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label><label className="text-xs text-slate-600">{t("المرجع")}<input value={reference} onChange={(event) => setReference(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label><label className="text-xs text-slate-600">{t("ملاحظات")}<input value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label></div>
      <div className="mt-5 overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-100"><tr><th className="p-2">{t("الصنف")}</th><th className="p-2">{t("الكمية")}</th><th className="p-2">{t("تكلفة الوحدة دون VAT")}</th><th className="p-2">{t("الإجمالي")}</th><th className="p-2"></th></tr></thead><tbody>{lines.map((line) => <tr key={line.id} className="border-b"><td className="p-2"><select value={line.productId} onChange={(event) => updateLine(line.id, "productId", event.target.value)} className="h-10 w-full min-w-56 rounded border px-2"><option value="">{t("اختر الصنف")}</option>{products.map((product) => <option key={product.id} value={product.id}>{product.sku} — {product.name} ({product.unit})</option>)}</select></td><td className="p-2"><input type="number" min="0.0001" step="0.0001" value={line.quantity} onChange={(event) => updateLine(line.id, "quantity", event.target.value)} className="h-10 w-28 rounded border px-2" /></td><td className="p-2"><input type="number" min="0" step="0.0001" value={line.unitCost} onChange={(event) => updateLine(line.id, "unitCost", event.target.value)} className="h-10 w-32 rounded border px-2" /></td><td className="p-2 text-center font-semibold">{formatNumber(numberValue(line.quantity) * numberValue(line.unitCost), { maximumFractionDigits: 2 })}</td><td className="p-2"><button disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((item) => item.id !== line.id))} className="rounded border border-red-200 p-2 text-red-600 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button></td></tr>)}</tbody></table></div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><button onClick={() => setLines((current) => [...current, newLine(Date.now() + current.length)])} className="rounded border px-3 py-2 text-sm">{t("إضافة صنف")}</button><div className="flex items-center gap-4"><p className="font-bold">{t("إجمالي التكلفة")}: {formatNumber(total, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SAR</p><button disabled={busy} onClick={() => void save()} className="inline-flex items-center gap-2 rounded bg-sky-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{t("حفظ المسودة")}</button></div></div>
    </section>}

    <section className="overflow-hidden rounded-xl border bg-white shadow-sm"><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-100 text-slate-600"><tr><th className="p-3">{t("رقم السند")}</th><th className="p-3">{t("التاريخ")}</th><th className="p-3">{t("المستودع")}</th><th className="p-3">{t("المورد")}</th><th className="p-3">{t("الأصناف")}</th><th className="p-3">{t("القيمة")}</th><th className="p-3">{t("الحالة")}</th><th className="p-3">{t("المحاسبة")}</th><th className="p-3">{t("الإجراءات")}</th></tr></thead><tbody>{loading ? <tr><td colSpan={9} className="py-14 text-center">{t("جاري التحميل...")}</td></tr> : receipts.length === 0 ? <tr><td colSpan={9} className="py-14 text-center text-slate-400">{t("لا توجد سندات استلام")}</td></tr> : receipts.map((receipt) => <tr key={receipt.id} className="border-t"><td className="p-3 font-mono">{receipt.number}</td><td className="p-3 text-center">{receipt.date}</td><td className="p-3 text-center">{warehouseName(receipt.warehouseId)}</td><td className="p-3 text-center">{vendorName(receipt.vendorId)}</td><td className="p-3 text-center">{receipt.lines.length}</td><td className="p-3 text-center font-semibold">{formatNumber(receipt.lines.reduce((sum, line) => sum + numberValue(line.quantity) * numberValue(line.unitCost), 0), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td><td className="p-3 text-center"><span className={`rounded px-2 py-1 text-xs font-semibold ${receipt.status === "posted" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{t(receipt.status === "posted" ? "مرحّل للمخزون" : "مسودة")}</span></td><td className="p-3 text-center text-xs">{t(ACCOUNTING_STATUS_LABELS[receipt.accountingStatus] ?? receipt.accountingStatus)}</td><td className="p-3"><div className="flex justify-center gap-1">{receipt.status === "draft" && <><button onClick={() => startEdit(receipt)} className="rounded border p-1.5"><Edit3 className="h-4 w-4" /></button><button disabled={busy} onClick={() => void post(receipt)} className="rounded border border-emerald-200 p-1.5 text-emerald-700" title={t("ترحيل للمخزون")}><Send className="h-4 w-4" /></button><button disabled={busy} onClick={() => void remove(receipt)} className="rounded border border-red-200 p-1.5 text-red-600"><Trash2 className="h-4 w-4" /></button></>}</div></td></tr>)}</tbody></table></div></section>
  </main></Layout>;
}
