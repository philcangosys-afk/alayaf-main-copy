import { useEffect, useState } from "react";
import { Edit3, Loader2, Scale, Send, Settings2, Trash2, X } from "lucide-react";
import { Link } from "react-router-dom";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { selectAllRows } from "@/lib/ledgerData";
import { inventoryErrorText } from "@/lib/inventoryErrors";

type Warehouse = { id: string; name: string };
type Product = { id: string; sku: string; name: string };
type Count = { id: string; number: string; warehouseId: string; status: string };
type AdjustmentLine = { id: string; adjustmentId: string; productId: string; movementType: "adjustment_in" | "adjustment_out"; quantity: number; originalUnitCost: number; unitCost: number; amount: number; overrideReason: string };
type Adjustment = { id: string; number: string; countId: string; date: string; warehouseId: string; status: "draft" | "posted"; accountingStatus: string; journalId: string; lines: AdjustmentLine[] };
type PostingRules = { shortage: string; surplus: string };

export default function InventoryAdjustments() {
  const { t, direction, formatNumber } = useI18n();
  const [counts, setCounts] = useState<Count[]>([]);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [rules, setRules] = useState<PostingRules>({ shortage: "", surplus: "" });
  const [selected, setSelected] = useState<Adjustment | null>(null);
  const [costs, setCosts] = useState<Record<string, { cost: string; reason: string }>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    const [countResult, adjustmentResult, lineResult, warehouseResult, productResult, ruleResult] = await Promise.all([
      selectAllRows((from, to) => supabase.from("inventory_counts").select("id, count_number, warehouse_id, status").eq("status", "finalized").order("created_at", { ascending: false }).order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("inventory_adjustments").select("id, adjustment_number, count_id, adjustment_date, warehouse_id, status, accounting_status, accounting_journal_entry_id").order("created_at", { ascending: false }).order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("inventory_adjustment_lines").select("id, adjustment_id, product_id, movement_type, quantity, original_unit_cost, unit_cost, amount, cost_override_reason").order("created_at").order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("inventory_warehouses").select("id, name_ar").order("code").order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("inventory_products").select("id, sku, name_ar").order("sku").order("id").range(from, to)),
      supabase.from("accounting_posting_rules").select("inventory_shortage_account_code, inventory_surplus_account_code").eq("rule_code", "sales_default").eq("active", true).maybeSingle(),
    ]);
    const firstError = countResult.error ?? adjustmentResult.error ?? lineResult.error ?? warehouseResult.error ?? productResult.error ?? ruleResult.error;
    if (firstError) { setError(inventoryErrorText(firstError.message, t)); setLoading(false); return; }
    setWarehouses((warehouseResult.data ?? []).map((row) => ({ id: String(row.id), name: String(row.name_ar) })));
    setProducts((productResult.data ?? []).map((row) => ({ id: String(row.id), sku: String(row.sku), name: String(row.name_ar) })));
    setRules({ shortage: String(ruleResult.data?.inventory_shortage_account_code ?? ""), surplus: String(ruleResult.data?.inventory_surplus_account_code ?? "") });
    const mappedCounts = (countResult.data ?? []).map((row) => ({ id: String(row.id), number: String(row.count_number), warehouseId: String(row.warehouse_id), status: String(row.status) }));
    const mappedAdjustments = (adjustmentResult.data ?? []).map((row) => ({
      id: String(row.id), number: String(row.adjustment_number), countId: String(row.count_id), date: String(row.adjustment_date), warehouseId: String(row.warehouse_id),
      status: row.status as Adjustment["status"], accountingStatus: String(row.accounting_status), journalId: String(row.accounting_journal_entry_id ?? ""),
      lines: (lineResult.data ?? []).filter((line) => line.adjustment_id === row.id).map((line) => ({
        id: String(line.id), adjustmentId: String(line.adjustment_id), productId: String(line.product_id), movementType: line.movement_type as AdjustmentLine["movementType"],
        quantity: Number(line.quantity), originalUnitCost: Number(line.original_unit_cost), unitCost: Number(line.unit_cost), amount: Number(line.amount), overrideReason: String(line.cost_override_reason ?? ""),
      })),
    }));
    setCounts(mappedCounts);
    setAdjustments(mappedAdjustments);
    setSelected((current) => current ? mappedAdjustments.find((item) => item.id === current.id) ?? null : null);
    setLoading(false);
    return mappedAdjustments;
  };

  useEffect(() => { void load(); }, []);

  const createFromCount = async (count: Count) => {
    if (!confirm(t("هل تريد إنشاء مسودة تسوية من فروقات هذا الجرد؟"))) return;
    setBusy(true);
    const { data, error: createError } = await supabase.rpc("create_inventory_adjustment_from_count", { p_count_id: count.id });
    setBusy(false);
    if (createError) { toast({ title: t("تعذر إنشاء التسوية"), description: inventoryErrorText(createError.message, t), variant: "destructive" }); return; }
    toast({ title: t("تم إنشاء مسودة تسوية المخزون") });
    const refreshed = await load();
    if (data) setSelected(refreshed?.find((item) => item.id === String(data)) ?? null);
  };

  const saveOverride = async (line: AdjustmentLine) => {
    const input = costs[line.id] ?? { cost: String(line.unitCost || ""), reason: line.overrideReason };
    if (Number(input.cost) <= 0 || !input.reason.trim()) { setError(t("أدخل تكلفة موجبة وسبب اعتماد التكلفة")); return; }
    setBusy(true);
    setError("");
    const { error: costError } = await supabase.rpc("set_inventory_adjustment_surplus_cost", { p_line_id: line.id, p_unit_cost: Number(input.cost), p_reason: input.reason.trim() });
    setBusy(false);
    if (costError) { setError(inventoryErrorText(costError.message, t)); return; }
    toast({ title: t("تم اعتماد تكلفة فائض الجرد") });
    await load();
  };

  const post = async (adjustment: Adjustment) => {
    if (!confirm(t("هل تريد ترحيل التسوية؟ ستتغير أرصدة المخزون وسيُنشأ القيد المحاسبي ولن يمكن التعديل بعد ذلك."))) return;
    setBusy(true);
    const { error: postError } = await supabase.rpc("post_inventory_adjustment", { p_id: adjustment.id });
    setBusy(false);
    if (postError) { toast({ title: t("تعذر ترحيل التسوية"), description: inventoryErrorText(postError.message, t), variant: "destructive" }); return; }
    toast({ title: t("تم ترحيل المخزون والقيد المحاسبي") });
    setSelected(null);
    await load();
  };

  const remove = async (adjustment: Adjustment) => {
    if (!confirm(t("هل تريد حذف مسودة التسوية؟"))) return;
    setBusy(true);
    const { error: deleteError } = await supabase.rpc("delete_inventory_adjustment_draft", { p_id: adjustment.id });
    setBusy(false);
    if (deleteError) { toast({ title: t("تعذر حذف التسوية"), description: inventoryErrorText(deleteError.message, t), variant: "destructive" }); return; }
    toast({ title: t("تم حذف مسودة التسوية") });
    setSelected(null);
    await load();
  };

  const warehouseName = (id: string) => warehouses.find((warehouse) => warehouse.id === id)?.name ?? "—";
  const productName = (id: string) => { const product = products.find((item) => item.id === id); return product ? `${product.sku} — ${product.name}` : id; };
  const availableCounts = counts.filter((count) => !adjustments.some((adjustment) => adjustment.countId === count.id));

  return <Layout><main dir={direction} className="space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-5 shadow-sm"><div className="flex items-center gap-3"><div className="rounded-lg bg-rose-50 p-2 text-rose-700"><Scale className="h-6 w-6" /></div><div><h1 className="text-2xl font-bold text-slate-900">{t("تسويات المخزون")}</h1><p className="mt-1 text-sm text-slate-500">{t("تحويل فروقات الجرد المعتمدة إلى حركات مخزون وقيود محاسبية متوازنة.")}</p></div></div></header>
    {(!rules.shortage || !rules.surplus) && <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"><span>{t("يجب تحديد حساب مصروف عجز المخزون وحساب إيراد فائض المخزون قبل ترحيل التسويات.")}</span><Link to="/expenses/settings" className="inline-flex items-center gap-2 rounded bg-amber-700 px-3 py-2 font-semibold text-white"><Settings2 className="h-4 w-4" />{t("فتح إعدادات المحاسبة")}</Link></div>}
    {error && <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

    <section className="rounded-xl border bg-white p-5 shadow-sm"><h2 className="font-bold">{t("عمليات الجرد الجاهزة للتسوية")}</h2><p className="mb-4 text-xs text-slate-500">{t("لا يمكن إنشاء أكثر من تسوية لنفس عملية الجرد.")}</p>{loading ? <div className="py-8 text-center">{t("جاري التحميل...")}</div> : availableCounts.length === 0 ? <div className="py-8 text-center text-slate-400">{t("لا توجد عمليات جرد معتمدة بانتظار التسوية")}</div> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{availableCounts.map((count) => <div key={count.id} className="rounded-lg border p-4"><p className="font-mono font-semibold">{count.number}</p><p className="mt-1 text-sm text-slate-500">{warehouseName(count.warehouseId)}</p><button disabled={busy} onClick={() => void createFromCount(count)} className="mt-3 inline-flex items-center gap-2 rounded bg-rose-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"><Scale className="h-4 w-4" />{t("إنشاء التسوية")}</button></div>)}</div>}</section>

    {selected && <section className="rounded-xl border bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><div><h2 className="font-bold">{t("تفاصيل التسوية")} — {selected.number}</h2><p className="text-xs text-slate-500">{warehouseName(selected.warehouseId)}</p></div><button onClick={() => setSelected(null)}><X className="h-5 w-5" /></button></div>{selected.lines.length === 0 ? <div className="rounded bg-emerald-50 p-4 text-sm text-emerald-800">{t("لا توجد فروقات كمية. يمكن ترحيل المستند دون حركة أو قيد محاسبي.")}</div> : <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-100"><tr><th className="p-2">{t("الصنف")}</th><th className="p-2">{t("نوع الفرق")}</th><th className="p-2">{t("الكمية")}</th><th className="p-2">{t("تكلفة الوحدة")}</th><th className="p-2">{t("القيمة")}</th><th className="p-2">{t("اعتماد تكلفة الفائض")}</th></tr></thead><tbody>{selected.lines.map((line) => { const needsCost = line.movementType === "adjustment_in" && line.originalUnitCost === 0; const input = costs[line.id] ?? { cost: String(line.unitCost || ""), reason: line.overrideReason }; return <tr key={line.id} className="border-b"><td className="p-2 font-medium">{productName(line.productId)}</td><td className={`p-2 text-center font-semibold ${line.movementType === "adjustment_in" ? "text-emerald-700" : "text-red-700"}`}>{t(line.movementType === "adjustment_in" ? "فائض" : "عجز")}</td><td className="p-2 text-center">{formatNumber(line.quantity, { maximumFractionDigits: 4 })}</td><td className="p-2 text-center">{formatNumber(line.unitCost, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} SAR</td><td className="p-2 text-center font-semibold">{formatNumber(line.amount, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SAR</td><td className="p-2">{needsCost ? <div className="flex min-w-[360px] gap-2"><input type="number" min="0.0001" step="0.0001" placeholder={t("التكلفة")} value={input.cost} onChange={(event) => setCosts((current) => ({ ...current, [line.id]: { ...input, cost: event.target.value } }))} className="h-9 w-28 rounded border px-2" /><input placeholder={t("سبب اعتماد التكلفة")} value={input.reason} onChange={(event) => setCosts((current) => ({ ...current, [line.id]: { ...input, reason: event.target.value } }))} className="h-9 flex-1 rounded border px-2" /><button disabled={busy} onClick={() => void saveOverride(line)} className="rounded bg-sky-700 px-3 text-white">{t("اعتماد")}</button></div> : "—"}</td></tr>; })}</tbody></table></div>}<div className="mt-4 flex justify-end gap-2"><button disabled={busy} onClick={() => void remove(selected)} className="inline-flex items-center gap-2 rounded border border-red-200 px-4 py-2 text-sm font-semibold text-red-700"><Trash2 className="h-4 w-4" />{t("حذف المسودة")}</button><button disabled={busy} onClick={() => void post(selected)} className="inline-flex items-center gap-2 rounded bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{t("ترحيل التسوية")}</button></div></section>}

    <section className="overflow-hidden rounded-xl border bg-white shadow-sm"><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-100 text-slate-600"><tr><th className="p-3">{t("رقم التسوية")}</th><th className="p-3">{t("رقم الجرد")}</th><th className="p-3">{t("التاريخ")}</th><th className="p-3">{t("المستودع")}</th><th className="p-3">{t("القيمة")}</th><th className="p-3">{t("المحاسبة")}</th><th className="p-3">{t("الحالة")}</th><th className="p-3">{t("الإجراءات")}</th></tr></thead><tbody>{loading ? <tr><td colSpan={8} className="py-14 text-center">{t("جاري التحميل...")}</td></tr> : adjustments.length === 0 ? <tr><td colSpan={8} className="py-14 text-center text-slate-400">{t("لا توجد تسويات مخزون")}</td></tr> : adjustments.map((adjustment) => <tr key={adjustment.id} className="border-t"><td className="p-3 font-mono">{adjustment.number}</td><td className="p-3 text-center font-mono">{counts.find((count) => count.id === adjustment.countId)?.number ?? "—"}</td><td className="p-3 text-center">{adjustment.date}</td><td className="p-3 text-center">{warehouseName(adjustment.warehouseId)}</td><td className="p-3 text-center font-semibold">{formatNumber(adjustment.lines.reduce((sum, line) => sum + line.amount, 0), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td><td className="p-3 text-center">{t(adjustment.accountingStatus === "posted" ? "مرحّل" : adjustment.accountingStatus === "not_required" ? "غير مطلوب" : "بانتظار الترحيل")}</td><td className="p-3 text-center"><span className={`rounded px-2 py-1 text-xs font-semibold ${adjustment.status === "posted" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{t(adjustment.status === "posted" ? "مرحّل" : "مسودة")}</span></td><td className="p-3"><div className="flex justify-center">{adjustment.status === "draft" && <button onClick={() => { setSelected(adjustment); setError(""); }} className="rounded border p-2 text-sky-700" title={t("فتح")}><Edit3 className="h-4 w-4" /></button>}</div></td></tr>)}</tbody></table></div></section>
  </main></Layout>;
}
