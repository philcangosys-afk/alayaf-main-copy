import { useEffect, useState } from "react";
import { Edit3, Loader2, MapPin, Plus, Save, Trash2, Warehouse, X } from "lucide-react";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { selectAllRows } from "@/lib/ledgerData";
import { inventoryErrorText } from "@/lib/inventoryErrors";

type WarehouseRow = { id: string; code: string; name: string; location: string; active: boolean };

export default function InventoryWarehouses() {
  const { t, direction } = useI18n();
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null | undefined>(undefined);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [active, setActive] = useState(true);

  const load = async () => {
    setLoading(true); setError("");
    const { data, error: loadError } = await selectAllRows((from, to) => supabase.from("inventory_warehouses").select("id, code, name_ar, location, active").order("code").order("id").range(from, to));
    if (loadError) { setError(inventoryErrorText(loadError.message, t)); setLoading(false); return; }
    setWarehouses((data ?? []).map((row) => ({ id: String(row.id), code: String(row.code), name: String(row.name_ar), location: String(row.location ?? ""), active: Boolean(row.active) })));
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const reset = () => { setEditingId(undefined); setCode(""); setName(""); setLocation(""); setActive(true); setError(""); };
  const startNew = () => { reset(); setEditingId(null); };
  const startEdit = (warehouse: WarehouseRow) => { setEditingId(warehouse.id); setCode(warehouse.code); setName(warehouse.name); setLocation(warehouse.location); setActive(warehouse.active); setError(""); };

  const save = async () => {
    if (!code.trim() || !name.trim()) { setError(t("أدخل رمز المستودع واسمه")); return; }
    setBusy(true); setError("");
    const { error: saveError } = await supabase.rpc("save_inventory_warehouse", { p_id: editingId || null, p_code: code.trim(), p_name_ar: name.trim(), p_location: location.trim(), p_active: active });
    setBusy(false);
    if (saveError) { setError(inventoryErrorText(saveError.message, t)); return; }
    toast({ title: t(editingId ? "تم تحديث المستودع" : "تم إنشاء المستودع") }); reset(); await load();
  };

  const remove = async (warehouse: WarehouseRow) => {
    if (!confirm(t("هل تريد حذف المستودع؟ لا يمكن حذف مستودع لديه حركات."))) return;
    setBusy(true); const { error: deleteError } = await supabase.rpc("delete_inventory_warehouse", { p_id: warehouse.id }); setBusy(false);
    if (deleteError) { toast({ title: t("تعذر حذف المستودع"), description: inventoryErrorText(deleteError.message, t), variant: "destructive" }); return; }
    toast({ title: t("تم حذف المستودع") }); await load();
  };

  return <Layout><main dir={direction} className="space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-5 shadow-sm"><div className="flex items-center gap-3"><div className="rounded-lg bg-amber-50 p-2 text-amber-700"><Warehouse className="h-6 w-6" /></div><div><h1 className="text-2xl font-bold text-slate-900">{t("المستودعات")}</h1><p className="mt-1 text-sm text-slate-500">{t("تعريف مواقع التخزين التي ستُسجل عليها حركات وكميات المخزون.")}</p></div></div><button onClick={startNew} className="inline-flex items-center gap-2 rounded bg-amber-700 px-4 py-2 text-sm font-semibold text-white"><Plus className="h-4 w-4" />{t("مستودع جديد")}</button></header>
    {error && <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

    {editingId !== undefined && <section className="rounded-xl border bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><h2 className="font-bold">{t(editingId ? "تعديل المستودع" : "مستودع جديد")}</h2><button onClick={reset}><X className="h-5 w-5" /></button></div><div className="grid gap-3 md:grid-cols-3"><label className="text-xs text-slate-600">{t("رمز المستودع")}<input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} className="mt-1 h-10 w-full rounded border px-3" /></label><label className="text-xs text-slate-600">{t("اسم المستودع")}<input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label><label className="text-xs text-slate-600">{t("الموقع")}<input value={location} onChange={(event) => setLocation(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label><label className="flex items-center gap-2 rounded border px-3 py-2 text-sm"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />{t("نشط")}</label></div><div className="mt-4 flex justify-end"><button disabled={busy} onClick={() => void save()} className="inline-flex items-center gap-2 rounded bg-amber-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{t("حفظ")}</button></div></section>}

    <section className="overflow-hidden rounded-xl border bg-white shadow-sm"><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-100 text-slate-600"><tr><th className="p-3">{t("الرمز")}</th><th className="p-3">{t("المستودع")}</th><th className="p-3">{t("الموقع")}</th><th className="p-3">{t("الحالة")}</th><th className="p-3">{t("الإجراءات")}</th></tr></thead><tbody>{loading ? <tr><td colSpan={5} className="py-14 text-center">{t("جاري التحميل...")}</td></tr> : warehouses.length === 0 ? <tr><td colSpan={5} className="py-14 text-center text-slate-400">{t("لا توجد مستودعات")}</td></tr> : warehouses.map((warehouse) => <tr key={warehouse.id} className="border-t"><td className="p-3 text-center font-mono">{warehouse.code}</td><td className="p-3 font-semibold"><div className="flex items-center gap-2"><Warehouse className="h-4 w-4 text-amber-700" />{warehouse.name}</div></td><td className="p-3"><div className="flex items-center justify-center gap-1 text-slate-600"><MapPin className="h-4 w-4" />{warehouse.location || "—"}</div></td><td className="p-3 text-center"><span className={`rounded px-2 py-1 text-xs font-semibold ${warehouse.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{t(warehouse.active ? "نشط" : "غير نشط")}</span></td><td className="p-3"><div className="flex justify-center gap-1"><button onClick={() => startEdit(warehouse)} className="rounded border p-1.5" title={t("تعديل")}><Edit3 className="h-4 w-4" /></button><button onClick={() => void remove(warehouse)} className="rounded border border-red-200 p-1.5 text-red-600" title={t("حذف")}><Trash2 className="h-4 w-4" /></button></div></td></tr>)}</tbody></table></div></section>
  </main></Layout>;
}
