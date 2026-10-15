import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Edit3, Loader2, Plus, Save, Send, Trash2, X } from "lucide-react";
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
type TransferLine = { id: number; productId: string; quantity: string; unitCost: string };
type InventoryTransfer = {
  id: string;
  number: string;
  date: string;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  reference: string;
  notes: string;
  status: "draft" | "posted";
  lines: TransferLine[];
};

const today = () => riyadhDateString();
const newLine = (id = Date.now()): TransferLine => ({ id, productId: "", quantity: "1", unitCost: "" });
const numberValue = (value: string) => Number(value) || 0;

export default function InventoryTransfers() {
  const { t, direction, formatNumber } = useI18n();
  const [transfers, setTransfers] = useState<InventoryTransfer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null | undefined>(undefined);
  const [date, setDate] = useState(today());
  const [sourceWarehouseId, setSourceWarehouseId] = useState("");
  const [destinationWarehouseId, setDestinationWarehouseId] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<TransferLine[]>([newLine()]);

  const load = async () => {
    setLoading(true);
    setError("");
    const [transferResult, lineResult, productResult, warehouseResult, balanceResult] = await Promise.all([
      selectAllRows((from, to) => supabase.from("inventory_transfers").select("id, transfer_number, transfer_date, source_warehouse_id, destination_warehouse_id, reference, notes, status").order("created_at", { ascending: false }).order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("inventory_transfer_lines").select("id, transfer_id, product_id, quantity, unit_cost").order("created_at").order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("inventory_products").select("id, sku, name_ar, unit").eq("item_type", "product").eq("active", true).order("sku").order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("inventory_warehouses").select("id, code, name_ar").eq("active", true).order("code").order("id").range(from, to)),
      supabase.rpc("list_inventory_balances"),
    ]);
    const firstError = transferResult.error ?? lineResult.error ?? productResult.error ?? warehouseResult.error ?? balanceResult.error;
    if (firstError) {
      setError(inventoryErrorText(firstError.message, t));
      setLoading(false);
      return;
    }
    setProducts((productResult.data ?? []).map((row) => ({ id: String(row.id), sku: String(row.sku), name: String(row.name_ar), unit: String(row.unit) })));
    setWarehouses((warehouseResult.data ?? []).map((row) => ({ id: String(row.id), code: String(row.code), name: String(row.name_ar) })));
    setBalances((balanceResult.data ?? []).map((row) => ({ productId: String(row.product_id), warehouseId: String(row.warehouse_id), quantity: Number(row.quantity) || 0, value: Number(row.inventory_value) || 0 })));
    setTransfers((transferResult.data ?? []).map((row) => ({
      id: String(row.id),
      number: String(row.transfer_number),
      date: String(row.transfer_date),
      sourceWarehouseId: String(row.source_warehouse_id),
      destinationWarehouseId: String(row.destination_warehouse_id),
      reference: String(row.reference ?? ""),
      notes: String(row.notes ?? ""),
      status: row.status as InventoryTransfer["status"],
      lines: (lineResult.data ?? []).filter((line) => line.transfer_id === row.id).map((line, index) => ({
        id: index + 1,
        productId: String(line.product_id),
        quantity: String(line.quantity),
        unitCost: String(line.unit_cost ?? ""),
      })),
    })));
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const reset = () => {
    setEditingId(undefined);
    setDate(today());
    setSourceWarehouseId("");
    setDestinationWarehouseId("");
    setReference("");
    setNotes("");
    setLines([newLine()]);
    setError("");
  };
  const startNew = () => { reset(); setEditingId(null); };
  const startEdit = (transfer: InventoryTransfer) => {
    if (transfer.status !== "draft") return;
    setEditingId(transfer.id);
    setDate(transfer.date);
    setSourceWarehouseId(transfer.sourceWarehouseId);
    setDestinationWarehouseId(transfer.destinationWarehouseId);
    setReference(transfer.reference);
    setNotes(transfer.notes);
    setLines(transfer.lines.length ? transfer.lines : [newLine()]);
    setError("");
  };
  const updateLine = (id: number, field: "productId" | "quantity", value: string) => setLines((current) => current.map((line) => line.id === id ? { ...line, [field]: value } : line));
  const balanceFor = (productId: string) => balances.find((balance) => balance.productId === productId && balance.warehouseId === sourceWarehouseId) ?? { quantity: 0, value: 0 };
  const estimatedValue = useMemo(() => lines.reduce((sum, line) => {
    const balance = balanceFor(line.productId);
    const average = balance.quantity > 0 ? balance.value / balance.quantity : 0;
    return sum + numberValue(line.quantity) * average;
  }, 0), [lines, sourceWarehouseId, balances]);

  const save = async () => {
    const productIds = lines.map((line) => line.productId).filter(Boolean);
    if (!date || !sourceWarehouseId || !destinationWarehouseId || sourceWarehouseId === destinationWarehouseId || productIds.length !== lines.length || new Set(productIds).size !== productIds.length || lines.some((line) => numberValue(line.quantity) <= 0)) {
      setError(t("أكمل بيانات التحويل وتأكد من اختلاف المستودعين وعدم تكرار الأصناف وصحة الكميات"));
      return;
    }
    setBusy(true);
    setError("");
    const { error: saveError } = await supabase.rpc("save_inventory_transfer", {
      p_id: editingId || null,
      p_transfer: {
        transferDate: date,
        sourceWarehouseId,
        destinationWarehouseId,
        reference: reference.trim(),
        notes: notes.trim(),
        lines: lines.map((line) => ({ productId: line.productId, quantity: numberValue(line.quantity) })),
      },
    });
    setBusy(false);
    if (saveError) { setError(inventoryErrorText(saveError.message, t)); return; }
    toast({ title: t("تم حفظ تحويل المخزون كمسودة") });
    reset();
    await load();
  };

  const post = async (transfer: InventoryTransfer) => {
    if (!confirm(t("هل تريد ترحيل التحويل؟ ستنتقل الكميات والقيمة بين المستودعين ولن يمكن تعديل المستند بعد ذلك."))) return;
    setBusy(true);
    const { error: postError } = await supabase.rpc("post_inventory_transfer", { p_id: transfer.id });
    setBusy(false);
    if (postError) {
      toast({ title: t("تعذر ترحيل تحويل المخزون"), description: inventoryErrorText(postError.message, t), variant: "destructive" });
      return;
    }
    toast({ title: t("تم ترحيل التحويل بين المستودعين") });
    await load();
  };

  const remove = async (transfer: InventoryTransfer) => {
    if (!confirm(t("هل تريد حذف مسودة التحويل؟"))) return;
    setBusy(true);
    const { error: deleteError } = await supabase.rpc("delete_inventory_transfer_draft", { p_id: transfer.id });
    setBusy(false);
    if (deleteError) {
      toast({ title: t("تعذر حذف التحويل"), description: inventoryErrorText(deleteError.message, t), variant: "destructive" });
      return;
    }
    toast({ title: t("تم حذف المسودة") });
    await load();
  };

  const warehouseName = (id: string) => warehouses.find((warehouse) => warehouse.id === id)?.name ?? "—";

  return (
    <Layout>
      <main dir={direction} className="space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-sky-50 p-2 text-sky-700"><ArrowLeftRight className="h-6 w-6" /></div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{t("التحويل بين المستودعات")}</h1>
              <p className="mt-1 text-sm text-slate-500">{t("نقل الكميات والقيمة بين المستودعات بنفس متوسط التكلفة دون إنشاء قيد محاسبي.")}</p>
            </div>
          </div>
          <button onClick={startNew} className="inline-flex items-center gap-2 rounded bg-sky-700 px-4 py-2 text-sm font-semibold text-white"><Plus className="h-4 w-4" />{t("تحويل جديد")}</button>
        </header>

        {error && <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        {editingId !== undefined && (
          <section className="rounded-xl border bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-bold">{t(editingId ? "تعديل مسودة التحويل" : "تحويل مخزون جديد")}</h2>
              <button onClick={reset}><X className="h-5 w-5" /></button>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="text-xs text-slate-600">{t("تاريخ التحويل")}<input type="date" max={today()} value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label>
              <label className="text-xs text-slate-600">{t("المستودع المصدر")}<select value={sourceWarehouseId} onChange={(event) => setSourceWarehouseId(event.target.value)} className="mt-1 h-10 w-full rounded border px-2"><option value="">{t("اختر المستودع المصدر")}</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id} disabled={warehouse.id === destinationWarehouseId}>{warehouse.code} — {warehouse.name}</option>)}</select></label>
              <label className="text-xs text-slate-600">{t("المستودع الوجهة")}<select value={destinationWarehouseId} onChange={(event) => setDestinationWarehouseId(event.target.value)} className="mt-1 h-10 w-full rounded border px-2"><option value="">{t("اختر المستودع الوجهة")}</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id} disabled={warehouse.id === sourceWarehouseId}>{warehouse.code} — {warehouse.name}</option>)}</select></label>
              <label className="text-xs text-slate-600">{t("المرجع")}<input value={reference} onChange={(event) => setReference(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label>
              <label className="text-xs text-slate-600 md:col-span-2">{t("ملاحظات")}<input value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label>
            </div>

            <div className="mt-5 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-100"><tr><th className="p-2">{t("الصنف")}</th><th className="p-2">{t("الرصيد في المصدر")}</th><th className="p-2">{t("الكمية")}</th><th className="p-2">{t("متوسط التكلفة")}</th><th className="p-2" /></tr></thead>
                <tbody>{lines.map((line) => {
                  const balance = balanceFor(line.productId);
                  const average = balance.quantity > 0 ? balance.value / balance.quantity : 0;
                  return <tr key={line.id} className="border-b">
                    <td className="p-2"><select value={line.productId} onChange={(event) => updateLine(line.id, "productId", event.target.value)} className="h-10 w-full min-w-56 rounded border px-2"><option value="">{t("اختر الصنف")}</option>{products.map((product) => <option key={product.id} value={product.id}>{product.sku} — {product.name} ({product.unit})</option>)}</select></td>
                    <td className={`p-2 text-center font-semibold ${balance.quantity < numberValue(line.quantity) ? "text-red-600" : "text-emerald-700"}`}>{formatNumber(balance.quantity, { maximumFractionDigits: 4 })}</td>
                    <td className="p-2"><input type="number" min="0.0001" step="0.0001" value={line.quantity} onChange={(event) => updateLine(line.id, "quantity", event.target.value)} className="h-10 w-28 rounded border px-2" /></td>
                    <td className="p-2 text-center">{formatNumber(average, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} SAR</td>
                    <td className="p-2"><button disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((item) => item.id !== line.id))} className="rounded border border-red-200 p-2 text-red-600 disabled:opacity-40"><Trash2 className="h-4 w-4" /></button></td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <button onClick={() => setLines((current) => [...current, newLine(Date.now() + current.length)])} className="rounded border px-3 py-2 text-sm">{t("إضافة صنف")}</button>
              <div className="flex items-center gap-4"><p className="font-bold">{t("القيمة التقديرية للتحويل")}: {formatNumber(estimatedValue, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SAR</p><button disabled={busy} onClick={() => void save()} className="inline-flex items-center gap-2 rounded bg-sky-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{t("حفظ المسودة")}</button></div>
            </div>
          </section>
        )}

        <section className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <div className="overflow-x-auto"><table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-slate-600"><tr><th className="p-3">{t("رقم التحويل")}</th><th className="p-3">{t("التاريخ")}</th><th className="p-3">{t("من مستودع")}</th><th className="p-3">{t("إلى مستودع")}</th><th className="p-3">{t("القيمة")}</th><th className="p-3">{t("الحالة")}</th><th className="p-3">{t("الإجراءات")}</th></tr></thead>
            <tbody>{loading ? <tr><td colSpan={7} className="py-14 text-center">{t("جاري التحميل...")}</td></tr> : transfers.length === 0 ? <tr><td colSpan={7} className="py-14 text-center text-slate-400">{t("لا توجد تحويلات مخزون")}</td></tr> : transfers.map((transfer) => <tr key={transfer.id} className="border-t">
              <td className="p-3 font-mono">{transfer.number}</td><td className="p-3 text-center">{transfer.date}</td><td className="p-3 text-center">{warehouseName(transfer.sourceWarehouseId)}</td><td className="p-3 text-center">{warehouseName(transfer.destinationWarehouseId)}</td><td className="p-3 text-center font-semibold">{formatNumber(transfer.lines.reduce((sum, line) => sum + numberValue(line.quantity) * numberValue(line.unitCost), 0), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td><td className="p-3 text-center"><span className={`rounded px-2 py-1 text-xs font-semibold ${transfer.status === "posted" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{t(transfer.status === "posted" ? "مرحّل" : "مسودة")}</span></td>
              <td className="p-3"><div className="flex justify-center gap-1">{transfer.status === "draft" && <><button disabled={busy} onClick={() => startEdit(transfer)} className="rounded border p-2 text-sky-700" title={t("تعديل")}><Edit3 className="h-4 w-4" /></button><button disabled={busy} onClick={() => void post(transfer)} className="rounded border p-2 text-emerald-700" title={t("ترحيل")}><Send className="h-4 w-4" /></button><button disabled={busy} onClick={() => void remove(transfer)} className="rounded border p-2 text-red-600" title={t("حذف")}><Trash2 className="h-4 w-4" /></button></>}</div></td>
            </tr>)}</tbody>
          </table></div>
        </section>
      </main>
    </Layout>
  );
}
