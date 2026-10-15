import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, Edit3, Loader2, Plus, Save, Send, Trash2, X } from "lucide-react";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { selectAllRows } from "@/lib/ledgerData";
import { inventoryErrorText } from "@/lib/inventoryErrors";

type Product = { id: string; sku: string; name: string; unit: string };
type Warehouse = { id: string; code: string; name: string };
type CountLine = {
  id: string;
  productId: string;
  systemQuantity: number;
  systemValue: number;
  unitCost: number;
  countedQuantity: string;
  varianceQuantity: number | null;
  varianceValue: number | null;
  notes: string;
};
type InventoryCount = {
  id: string;
  number: string;
  date: string;
  warehouseId: string;
  snapshotAt: string;
  notes: string;
  status: "draft" | "finalized";
  lines: CountLine[];
};

export default function InventoryCounts() {
  const { t, direction, formatNumber } = useI18n();
  const [counts, setCounts] = useState<InventoryCount[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [newWarehouseId, setNewWarehouseId] = useState("");
  const [editing, setEditing] = useState<InventoryCount | null>(null);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<CountLine[]>([]);

  const load = async () => {
    setLoading(true);
    setError("");
    const [countResult, lineResult, productResult, warehouseResult] = await Promise.all([
      selectAllRows((from, to) => supabase.from("inventory_counts").select("id, count_number, count_date, warehouse_id, snapshot_at, notes, status").order("created_at", { ascending: false }).order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("inventory_count_lines").select("id, count_id, product_id, system_quantity, system_value, unit_cost, counted_quantity, variance_quantity, variance_value, notes").order("created_at").order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("inventory_products").select("id, sku, name_ar, unit").eq("item_type", "product").eq("active", true).order("sku").order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("inventory_warehouses").select("id, code, name_ar").eq("active", true).order("code").order("id").range(from, to)),
    ]);
    const firstError = countResult.error ?? lineResult.error ?? productResult.error ?? warehouseResult.error;
    if (firstError) {
      setError(inventoryErrorText(firstError.message, t));
      setLoading(false);
      return;
    }
    setProducts((productResult.data ?? []).map((row) => ({ id: String(row.id), sku: String(row.sku), name: String(row.name_ar), unit: String(row.unit) })));
    setWarehouses((warehouseResult.data ?? []).map((row) => ({ id: String(row.id), code: String(row.code), name: String(row.name_ar) })));
    setCounts((countResult.data ?? []).map((row) => ({
      id: String(row.id),
      number: String(row.count_number),
      date: String(row.count_date),
      warehouseId: String(row.warehouse_id),
      snapshotAt: String(row.snapshot_at),
      notes: String(row.notes ?? ""),
      status: row.status as InventoryCount["status"],
      lines: (lineResult.data ?? []).filter((line) => line.count_id === row.id).map((line) => ({
        id: String(line.id),
        productId: String(line.product_id),
        systemQuantity: Number(line.system_quantity) || 0,
        systemValue: Number(line.system_value) || 0,
        unitCost: Number(line.unit_cost) || 0,
        countedQuantity: line.counted_quantity === null ? "" : String(line.counted_quantity),
        varianceQuantity: line.variance_quantity === null ? null : Number(line.variance_quantity),
        varianceValue: line.variance_value === null ? null : Number(line.variance_value),
        notes: String(line.notes ?? ""),
      })),
    })));
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const startCount = async () => {
    if (!newWarehouseId) { setError(t("اختر المستودع المراد جرده")); return; }
    setBusy(true);
    setError("");
    const { error: startError } = await supabase.rpc("start_inventory_count", { p_warehouse_id: newWarehouseId, p_notes: "" });
    setBusy(false);
    if (startError) { setError(inventoryErrorText(startError.message, t)); return; }
    toast({ title: t("تم إنشاء مسودة الجرد وتثبيت الرصيد الدفتري") });
    setShowNew(false);
    setNewWarehouseId("");
    await load();
  };

  const startEdit = (count: InventoryCount) => {
    if (count.status !== "draft") return;
    setEditing(count);
    setNotes(count.notes);
    setLines(count.lines.map((line) => ({ ...line })));
    setError("");
  };

  const updateLine = (id: string, field: "countedQuantity" | "notes", value: string) => setLines((current) => current.map((line) => line.id === id ? { ...line, [field]: value } : line));

  const save = async (closeAfter = true) => {
    if (lines.some((line) => line.countedQuantity !== "" && (!Number.isFinite(Number(line.countedQuantity)) || Number(line.countedQuantity) < 0))) {
      setError(t("تأكد من صحة الكميات الفعلية"));
      return false;
    }
    if (!editing) return false;
    setBusy(true);
    setError("");
    const { error: saveError } = await supabase.rpc("save_inventory_count", {
      p_id: editing.id,
      p_count: {
        notes: notes.trim(),
        lines: lines.map((line) => ({ productId: line.productId, countedQuantity: line.countedQuantity === "" ? null : Number(line.countedQuantity), notes: line.notes.trim() })),
      },
    });
    setBusy(false);
    if (saveError) { setError(inventoryErrorText(saveError.message, t)); return false; }
    toast({ title: t("تم حفظ كميات الجرد") });
    if (closeAfter) setEditing(null);
    await load();
    return true;
  };

  const finalize = async () => {
    if (!editing || lines.some((line) => line.countedQuantity === "")) {
      setError(t("أدخل الكمية الفعلية لجميع الأصناف قبل اعتماد الجرد"));
      return;
    }
    if (!confirm(t("هل تريد اعتماد الجرد؟ ستُثبت الفروقات ولن تتغير أرصدة المخزون حتى إنشاء تسوية مستقلة."))) return;
    const saved = await save(false);
    if (!saved) return;
    setBusy(true);
    const { error: finalizeError } = await supabase.rpc("finalize_inventory_count", { p_id: editing.id });
    setBusy(false);
    if (finalizeError) {
      toast({ title: t("تعذر اعتماد الجرد"), description: inventoryErrorText(finalizeError.message, t), variant: "destructive" });
      return;
    }
    toast({ title: t("تم اعتماد الجرد وتثبيت الفروقات") });
    setEditing(null);
    await load();
  };

  const remove = async (count: InventoryCount) => {
    if (!confirm(t("هل تريد حذف مسودة الجرد؟"))) return;
    setBusy(true);
    const { error: deleteError } = await supabase.rpc("delete_inventory_count_draft", { p_id: count.id });
    setBusy(false);
    if (deleteError) {
      toast({ title: t("تعذر حذف الجرد"), description: inventoryErrorText(deleteError.message, t), variant: "destructive" });
      return;
    }
    toast({ title: t("تم حذف مسودة الجرد") });
    await load();
  };

  const productFor = (id: string) => products.find((product) => product.id === id);
  const warehouseName = (id: string) => warehouses.find((warehouse) => warehouse.id === id)?.name ?? "—";
  const draftVariance = useMemo(() => lines.reduce((total, line) => {
    if (line.countedQuantity === "") return total;
    return total + (Number(line.countedQuantity) - line.systemQuantity) * line.unitCost;
  }, 0), [lines]);

  return (
    <Layout>
      <main dir={direction} className="space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-violet-50 p-2 text-violet-700"><ClipboardCheck className="h-6 w-6" /></div>
            <div><h1 className="text-2xl font-bold text-slate-900">{t("عمليات جرد المخزون")}</h1><p className="mt-1 text-sm text-slate-500">{t("مقارنة الكميات الفعلية بالأرصدة الدفترية وتثبيت الفروقات للمراجعة.")}</p></div>
          </div>
          <button onClick={() => { setShowNew(true); setEditing(null); setError(""); }} className="inline-flex items-center gap-2 rounded bg-violet-700 px-4 py-2 text-sm font-semibold text-white"><Plus className="h-4 w-4" />{t("جرد جديد")}</button>
        </header>

        <div className="rounded border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">{t("اعتماد الجرد يثبت الفروقات فقط. لن تتغير كميات أو قيمة المخزون حتى اعتماد مستند تسوية المخزون في المرحلة التالية.")}</div>
        {error && <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        {showNew && (
          <section className="rounded-xl border bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between"><h2 className="font-bold">{t("بدء جرد جديد")}</h2><button onClick={() => setShowNew(false)}><X className="h-5 w-5" /></button></div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-72 text-xs text-slate-600">{t("المستودع")}<select value={newWarehouseId} onChange={(event) => setNewWarehouseId(event.target.value)} className="mt-1 h-10 w-full rounded border px-2"><option value="">{t("اختر المستودع")}</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} — {warehouse.name}</option>)}</select></label>
              <button disabled={busy} onClick={() => void startCount()} className="inline-flex h-10 items-center gap-2 rounded bg-violet-700 px-4 text-sm font-semibold text-white disabled:opacity-60">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}{t("تثبيت الرصيد وبدء الجرد")}</button>
            </div>
          </section>
        )}

        {editing && (
          <section className="rounded-xl border bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-bold">{t("إدخال الكميات الفعلية")} — {editing.number}</h2><p className="text-xs text-slate-500">{t("وقت تثبيت الرصيد")}: {new Date(editing.snapshotAt).toLocaleString()}</p></div><button onClick={() => setEditing(null)}><X className="h-5 w-5" /></button></div>
            <label className="block text-xs text-slate-600">{t("ملاحظات عامة")}<input value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label>
            <div className="mt-4 overflow-x-auto"><table className="min-w-full text-sm">
              <thead className="bg-slate-100"><tr><th className="p-2">{t("الصنف")}</th><th className="p-2">{t("الكمية الدفترية")}</th><th className="p-2">{t("الكمية الفعلية")}</th><th className="p-2">{t("الفرق")}</th><th className="p-2">{t("قيمة الفرق")}</th><th className="p-2">{t("ملاحظات")}</th></tr></thead>
              <tbody>{lines.map((line) => {
                const product = productFor(line.productId);
                const variance = line.countedQuantity === "" ? null : Number(line.countedQuantity) - line.systemQuantity;
                return <tr key={line.id} className="border-b"><td className="p-2 font-medium">{product ? `${product.sku} — ${product.name} (${product.unit})` : line.productId}</td><td className="p-2 text-center">{formatNumber(line.systemQuantity, { maximumFractionDigits: 4 })}</td><td className="p-2"><input type="number" min="0" step="0.0001" value={line.countedQuantity} onChange={(event) => updateLine(line.id, "countedQuantity", event.target.value)} className="h-10 w-28 rounded border px-2" /></td><td className={`p-2 text-center font-semibold ${variance === null || variance === 0 ? "text-slate-600" : variance > 0 ? "text-emerald-700" : "text-red-600"}`}>{variance === null ? "—" : formatNumber(variance, { maximumFractionDigits: 4 })}</td><td className="p-2 text-center">{variance === null ? "—" : `${formatNumber(variance * line.unitCost, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SAR`}</td><td className="p-2"><input value={line.notes} onChange={(event) => updateLine(line.id, "notes", event.target.value)} className="h-10 min-w-40 rounded border px-2" /></td></tr>;
              })}</tbody>
            </table></div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="font-bold">{t("صافي قيمة الفروقات")}: {formatNumber(draftVariance, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SAR</p><div className="flex gap-2"><button disabled={busy} onClick={() => void save()} className="inline-flex items-center gap-2 rounded border border-violet-300 px-4 py-2 text-sm font-semibold text-violet-700 disabled:opacity-60"><Save className="h-4 w-4" />{t("حفظ")}</button><button disabled={busy} onClick={() => void finalize()} className="inline-flex items-center gap-2 rounded bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"><Send className="h-4 w-4" />{t("اعتماد الجرد")}</button></div></div>
          </section>
        )}

        <section className="overflow-hidden rounded-xl border bg-white shadow-sm"><div className="overflow-x-auto"><table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-slate-600"><tr><th className="p-3">{t("رقم الجرد")}</th><th className="p-3">{t("التاريخ")}</th><th className="p-3">{t("المستودع")}</th><th className="p-3">{t("عدد الأصناف")}</th><th className="p-3">{t("صافي الفروقات")}</th><th className="p-3">{t("الحالة")}</th><th className="p-3">{t("الإجراءات")}</th></tr></thead>
          <tbody>{loading ? <tr><td colSpan={7} className="py-14 text-center">{t("جاري التحميل...")}</td></tr> : counts.length === 0 ? <tr><td colSpan={7} className="py-14 text-center text-slate-400">{t("لا توجد عمليات جرد")}</td></tr> : counts.map((count) => <tr key={count.id} className="border-t"><td className="p-3 font-mono">{count.number}</td><td className="p-3 text-center">{count.date}</td><td className="p-3 text-center">{warehouseName(count.warehouseId)}</td><td className="p-3 text-center">{count.lines.length}</td><td className="p-3 text-center font-semibold">{count.status === "finalized" ? formatNumber(count.lines.reduce((sum, line) => sum + (line.varianceValue ?? 0), 0), { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}</td><td className="p-3 text-center"><span className={`rounded px-2 py-1 text-xs font-semibold ${count.status === "finalized" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{t(count.status === "finalized" ? "معتمد" : "مسودة")}</span></td><td className="p-3"><div className="flex justify-center gap-1">{count.status === "draft" && <><button disabled={busy} onClick={() => startEdit(count)} className="rounded border p-2 text-sky-700" title={t("إدخال الجرد")}><Edit3 className="h-4 w-4" /></button><button disabled={busy} onClick={() => void remove(count)} className="rounded border p-2 text-red-600" title={t("حذف")}><Trash2 className="h-4 w-4" /></button></>}</div></td></tr>)}</tbody>
        </table></div></section>
      </main>
    </Layout>
  );
}
