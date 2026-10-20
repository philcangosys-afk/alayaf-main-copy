import { useEffect, useState } from "react";
import { BedDouble, Edit3, Plus, Save, Trash2, X } from "lucide-react";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import { permissionLevelAny } from "@/lib/authSession";
import { hotelErrorText, isMoney, loadHotelSetup, type HotelFloor, type HotelSetup, type HotelUnit, type HotelUnitType } from "@/lib/hotel";
import { ErrorNote, HotelButton, HotelConfirm, HotelHeader, hotelInput, hotelLabel, hotelSelect, useMoney } from "@/components/hotel/HotelUi";

type Tab = "units" | "types" | "floors";
type UnitForm = { code: string; name: string; typeId: string; floorId: string; basePrice: string; maxOccupancy: string; active: boolean; notes: string; sortOrder: string };
type TypeForm = { name: string; basePrice: string; maxOccupancy: string; description: string; active: boolean; sortOrder: string };
type FloorForm = { name: string; sortOrder: string };
type Removal = { kind: Tab; id: string; label: string } | null;

const emptyUnit: UnitForm = { code: "", name: "", typeId: "", floorId: "", basePrice: "", maxOccupancy: "", active: true, notes: "", sortOrder: "0" };
const emptyType: TypeForm = { name: "", basePrice: "0", maxOccupancy: "2", description: "", active: true, sortOrder: "0" };
const emptyFloor: FloorForm = { name: "", sortOrder: "0" };

/** الوحدات وأنواعها والطوابق. السعر والسعة في الوحدة يتقدمان على نوعها إن حُددا */
export default function HotelSetupPage() {
  const { t, direction, formatNumber } = useI18n();
  const money = useMoney();
  const { permissions } = useRolePermissions();
  const canManage = permissionLevelAny(permissions, ["hotel.setup", "module.hotel"]) === "manage";
  const [tab, setTab] = useState<Tab>("units");
  const [setup, setSetup] = useState<HotelSetup>({ types: [], floors: [], units: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [unitEdit, setUnitEdit] = useState<{ id: string | null; form: UnitForm } | null>(null);
  const [typeEdit, setTypeEdit] = useState<{ id: string | null; form: TypeForm } | null>(null);
  const [floorEdit, setFloorEdit] = useState<{ id: string | null; form: FloorForm } | null>(null);
  const [removal, setRemoval] = useState<Removal>(null);

  const load = async () => {
    setLoading(true);
    const result = await loadHotelSetup();
    setLoading(false);
    setSetup(result.data);
    setError(result.error ? hotelErrorText(result.error.message, t) : "");
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, []);

  const typeById = new Map(setup.types.map((type) => [type.id, type]));
  const floorById = new Map(setup.floors.map((floor) => [floor.id, floor]));
  const intText = (value: string) => /^\d{1,6}$/.test(value.trim());

  const call = async (fn: string, args: Record<string, unknown>, success: string) => {
    setBusy(true);
    const { error: callError } = await supabase.rpc(fn, args);
    setBusy(false);
    if (callError) { setError(hotelErrorText(callError.message, t)); return false; }
    setError("");
    toast({ title: t(success) });
    await load();
    return true;
  };

  const saveUnit = async () => {
    if (!unitEdit) return;
    const f = unitEdit.form;
    if (!f.code.trim()) { setError(t("رقم الوحدة مطلوب")); return; }
    if (!f.typeId) { setError(t("اختر نوع الوحدة")); return; }
    if (f.basePrice.trim() && !isMoney(f.basePrice)) { setError(t("السعر رقم موجب بخانتين عشريتين على الأكثر")); return; }
    if (f.maxOccupancy.trim() && (!intText(f.maxOccupancy) || Number(f.maxOccupancy) < 1 || Number(f.maxOccupancy) > 50)) { setError(t("السعة من 1 إلى 50")); return; }
    const ok = await call("hotel_save_unit", {
      p_id: unitEdit.id,
      p: {
        code: f.code.trim(), name: f.name.trim() || null, type_id: f.typeId, floor_id: f.floorId || null,
        base_price: f.basePrice.trim() ? Number(f.basePrice) : null, max_occupancy: f.maxOccupancy.trim() ? Number(f.maxOccupancy) : null,
        active: f.active, notes: f.notes.trim() || null, sort_order: intText(f.sortOrder) ? Number(f.sortOrder) : 0,
      },
    }, unitEdit.id ? "حُفظت الوحدة" : "أُضيفت الوحدة");
    if (ok) setUnitEdit(null);
  };

  const saveType = async () => {
    if (!typeEdit) return;
    const f = typeEdit.form;
    if (!f.name.trim()) { setError(t("الاسم مطلوب")); return; }
    if (!isMoney(f.basePrice || "0")) { setError(t("السعر رقم موجب بخانتين عشريتين على الأكثر")); return; }
    if (!intText(f.maxOccupancy) || Number(f.maxOccupancy) < 1 || Number(f.maxOccupancy) > 50) { setError(t("السعة من 1 إلى 50")); return; }
    const ok = await call("hotel_save_unit_type", {
      p_id: typeEdit.id,
      p: {
        name: f.name.trim(), base_price: Number(f.basePrice || 0), max_occupancy: Number(f.maxOccupancy), description: f.description.trim() || null,
        active: f.active, sort_order: intText(f.sortOrder) ? Number(f.sortOrder) : 0,
      },
    }, typeEdit.id ? "حُفظ النوع" : "أُضيف النوع");
    if (ok) setTypeEdit(null);
  };

  const saveFloor = async () => {
    if (!floorEdit) return;
    if (!floorEdit.form.name.trim()) { setError(t("الاسم مطلوب")); return; }
    const ok = await call("hotel_save_floor", {
      p_id: floorEdit.id, p: { name: floorEdit.form.name.trim(), sort_order: intText(floorEdit.form.sortOrder) ? Number(floorEdit.form.sortOrder) : 0 },
    }, floorEdit.id ? "حُفظ الطابق" : "أُضيف الطابق");
    if (ok) setFloorEdit(null);
  };

  const remove = async () => {
    if (!removal) return;
    const fn = removal.kind === "units" ? "hotel_delete_unit" : removal.kind === "types" ? "hotel_delete_unit_type" : "hotel_delete_floor";
    const ok = await call(fn, { p_id: removal.id }, "تم الحذف");
    // عند الرفض تُغلق نافذة التأكيد فتظهر الرسالة في الصفحة
    setRemoval(null);
    if (!ok) window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const tabs: Array<{ id: Tab; label: string; count: number }> = [
    { id: "units", label: "الوحدات", count: setup.units.length },
    { id: "types", label: "أنواع الوحدات", count: setup.types.length },
    { id: "floors", label: "الطوابق", count: setup.floors.length },
  ];

  return (
    <Layout>
      <main dir={direction} className="space-y-5">
        <HotelHeader
          icon={BedDouble}
          title="الوحدات وأنواعها"
          description="ابدأ بأنواع الوحدات (غرفة مفردة، مزدوجة، جناح، شقة...) وسعر الليلة وسعتها، ثم الطوابق، ثم الوحدات. الأسعار قبل الضريبة."
          actions={canManage ? (
            tab === "units" ? <HotelButton onClick={() => { setError(""); setUnitEdit({ id: null, form: { ...emptyUnit, typeId: setup.types.find((type) => type.active)?.id ?? "" } }); }} disabled={!setup.types.length}><Plus className="h-4 w-4" />{t("وحدة جديدة")}</HotelButton>
              : tab === "types" ? <HotelButton onClick={() => { setError(""); setTypeEdit({ id: null, form: emptyType }); }}><Plus className="h-4 w-4" />{t("نوع جديد")}</HotelButton>
              : <HotelButton onClick={() => { setError(""); setFloorEdit({ id: null, form: emptyFloor }); }}><Plus className="h-4 w-4" />{t("طابق جديد")}</HotelButton>
          ) : undefined}
        />
        <nav className="flex gap-2 border-b" aria-label={t("أقسام الإعداد")}>
          {tabs.map((item) => (
            <button key={item.id} onClick={() => setTab(item.id)}
              className={cn("-mb-px border-b-2 px-4 py-2 text-sm font-semibold", tab === item.id ? "border-[#7a2450] text-[#7a2450]" : "border-transparent text-slate-500 hover:text-slate-800")}>
              {t(item.label)} <span className="text-xs font-normal text-slate-400">({formatNumber(item.count)})</span>
            </button>
          ))}
        </nav>
        <ErrorNote message={error} />
        {tab === "units" && !setup.types.length && !loading && <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{t("أضف نوع وحدة واحدًا على الأقل قبل الوحدات.")}</p>}

        {/* نموذج الوحدة */}
        {unitEdit && (
          <section className="rounded-xl border bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between"><h2 className="font-bold">{t(unitEdit.id ? "تعديل الوحدة" : "وحدة جديدة")}</h2><button onClick={() => setUnitEdit(null)} aria-label={t("إغلاق")}><X className="h-5 w-5" /></button></div>
            <div className="grid gap-3 md:grid-cols-4">
              <label className={hotelLabel}>{t("رقم الوحدة")} *<input value={unitEdit.form.code} onChange={(e) => setUnitEdit({ ...unitEdit, form: { ...unitEdit.form, code: e.target.value } })} className={hotelInput} maxLength={30} placeholder="101" /></label>
              <label className={hotelLabel}>{t("الاسم (اختياري)")}<input value={unitEdit.form.name} onChange={(e) => setUnitEdit({ ...unitEdit, form: { ...unitEdit.form, name: e.target.value } })} className={hotelInput} maxLength={100} /></label>
              <label className={hotelLabel}>{t("النوع")} *
                <select value={unitEdit.form.typeId} onChange={(e) => setUnitEdit({ ...unitEdit, form: { ...unitEdit.form, typeId: e.target.value } })} className={hotelSelect}>
                  <option value="">{t("اختر")}</option>
                  {setup.types.filter((type) => type.active || type.id === unitEdit.form.typeId).map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
                </select>
              </label>
              <label className={hotelLabel}>{t("الطابق")}
                <select value={unitEdit.form.floorId} onChange={(e) => setUnitEdit({ ...unitEdit, form: { ...unitEdit.form, floorId: e.target.value } })} className={hotelSelect}>
                  <option value="">{t("بدون")}</option>
                  {setup.floors.map((floor) => <option key={floor.id} value={floor.id}>{floor.name}</option>)}
                </select>
              </label>
              <label className={hotelLabel}>{t("سعر الليلة (فارغ = سعر النوع)")}<input value={unitEdit.form.basePrice} onChange={(e) => setUnitEdit({ ...unitEdit, form: { ...unitEdit.form, basePrice: e.target.value } })} className={`${hotelInput} text-left`} dir="ltr" inputMode="decimal"
                placeholder={typeById.get(unitEdit.form.typeId) ? money(typeById.get(unitEdit.form.typeId)!.basePrice) : ""} /></label>
              <label className={hotelLabel}>{t("السعة (فارغ = سعة النوع)")}<input value={unitEdit.form.maxOccupancy} onChange={(e) => setUnitEdit({ ...unitEdit, form: { ...unitEdit.form, maxOccupancy: e.target.value } })} className={`${hotelInput} text-left`} dir="ltr" inputMode="numeric"
                placeholder={typeById.get(unitEdit.form.typeId) ? String(typeById.get(unitEdit.form.typeId)!.maxOccupancy) : ""} /></label>
              <label className={hotelLabel}>{t("الترتيب")}<input value={unitEdit.form.sortOrder} onChange={(e) => setUnitEdit({ ...unitEdit, form: { ...unitEdit.form, sortOrder: e.target.value } })} className={`${hotelInput} text-left`} dir="ltr" inputMode="numeric" /></label>
              <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={unitEdit.form.active} onChange={(e) => setUnitEdit({ ...unitEdit, form: { ...unitEdit.form, active: e.target.checked } })} />{t("فعّالة (تظهر للحجز)")}</label>
              <label className={`${hotelLabel} md:col-span-4`}>{t("ملاحظات")}<input value={unitEdit.form.notes} onChange={(e) => setUnitEdit({ ...unitEdit, form: { ...unitEdit.form, notes: e.target.value } })} className={hotelInput} maxLength={500} /></label>
            </div>
            <div className="mt-4 flex justify-end"><HotelButton onClick={() => void saveUnit()} busy={busy}><Save className="h-4 w-4" />{t("حفظ الوحدة")}</HotelButton></div>
          </section>
        )}
        {typeEdit && (
          <section className="rounded-xl border bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between"><h2 className="font-bold">{t(typeEdit.id ? "تعديل النوع" : "نوع جديد")}</h2><button onClick={() => setTypeEdit(null)} aria-label={t("إغلاق")}><X className="h-5 w-5" /></button></div>
            <div className="grid gap-3 md:grid-cols-4">
              <label className={`${hotelLabel} md:col-span-2`}>{t("الاسم")} *<input value={typeEdit.form.name} onChange={(e) => setTypeEdit({ ...typeEdit, form: { ...typeEdit.form, name: e.target.value } })} className={hotelInput} maxLength={100} placeholder={t("مثل: غرفة مزدوجة")} /></label>
              <label className={hotelLabel}>{t("سعر الليلة (قبل الضريبة)")}<input value={typeEdit.form.basePrice} onChange={(e) => setTypeEdit({ ...typeEdit, form: { ...typeEdit.form, basePrice: e.target.value } })} className={`${hotelInput} text-left`} dir="ltr" inputMode="decimal" /></label>
              <label className={hotelLabel}>{t("السعة (نزلاء)")}<input value={typeEdit.form.maxOccupancy} onChange={(e) => setTypeEdit({ ...typeEdit, form: { ...typeEdit.form, maxOccupancy: e.target.value } })} className={`${hotelInput} text-left`} dir="ltr" inputMode="numeric" /></label>
              <label className={`${hotelLabel} md:col-span-2`}>{t("الوصف")}<input value={typeEdit.form.description} onChange={(e) => setTypeEdit({ ...typeEdit, form: { ...typeEdit.form, description: e.target.value } })} className={hotelInput} maxLength={500} /></label>
              <label className={hotelLabel}>{t("الترتيب")}<input value={typeEdit.form.sortOrder} onChange={(e) => setTypeEdit({ ...typeEdit, form: { ...typeEdit.form, sortOrder: e.target.value } })} className={`${hotelInput} text-left`} dir="ltr" inputMode="numeric" /></label>
              <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={typeEdit.form.active} onChange={(e) => setTypeEdit({ ...typeEdit, form: { ...typeEdit.form, active: e.target.checked } })} />{t("فعّال (يظهر لوحدة جديدة)")}</label>
            </div>
            <div className="mt-4 flex justify-end"><HotelButton onClick={() => void saveType()} busy={busy}><Save className="h-4 w-4" />{t("حفظ النوع")}</HotelButton></div>
          </section>
        )}
        {floorEdit && (
          <section className="rounded-xl border bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between"><h2 className="font-bold">{t(floorEdit.id ? "تعديل الطابق" : "طابق جديد")}</h2><button onClick={() => setFloorEdit(null)} aria-label={t("إغلاق")}><X className="h-5 w-5" /></button></div>
            <div className="grid gap-3 md:grid-cols-4">
              <label className={`${hotelLabel} md:col-span-2`}>{t("الاسم")} *<input value={floorEdit.form.name} onChange={(e) => setFloorEdit({ ...floorEdit, form: { ...floorEdit.form, name: e.target.value } })} className={hotelInput} maxLength={50} placeholder={t("مثل: الطابق الأول أو المبنى ب")} /></label>
              <label className={hotelLabel}>{t("الترتيب")}<input value={floorEdit.form.sortOrder} onChange={(e) => setFloorEdit({ ...floorEdit, form: { ...floorEdit.form, sortOrder: e.target.value } })} className={`${hotelInput} text-left`} dir="ltr" inputMode="numeric" /></label>
            </div>
            <div className="mt-4 flex justify-end"><HotelButton onClick={() => void saveFloor()} busy={busy}><Save className="h-4 w-4" />{t("حفظ الطابق")}</HotelButton></div>
          </section>
        )}

        <section className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <div className="overflow-x-auto">
            {loading ? <p className="py-14 text-center text-slate-500">{t("جاري التحميل...")}</p> : tab === "units" ? (
              <table className="min-w-full text-sm">
                <thead className="bg-slate-100 text-slate-600"><tr><th className="p-3 text-start">{t("الوحدة")}</th><th className="p-3">{t("النوع")}</th><th className="p-3">{t("الطابق")}</th><th className="p-3">{t("سعر الليلة")}</th><th className="p-3">{t("السعة")}</th><th className="p-3">{t("الحالة")}</th><th className="p-3" /></tr></thead>
                <tbody>
                  {setup.units.length === 0 ? <tr><td colSpan={7} className="py-14 text-center text-slate-400">{t("لا توجد وحدات")}</td></tr> : setup.units.map((unit: HotelUnit) => {
                    const type = typeById.get(unit.typeId);
                    return (
                      <tr key={unit.id} className="border-t">
                        <td className="p-3"><span className="font-bold tabular-nums">{unit.code}</span>{unit.name ? <span className="ms-2 text-xs text-slate-500">{unit.name}</span> : null}</td>
                        <td className="p-3 text-center">{type?.name ?? "—"}</td>
                        <td className="p-3 text-center">{floorById.get(unit.floorId)?.name ?? "—"}</td>
                        <td className="p-3 text-center tabular-nums">{money(unit.basePrice ?? type?.basePrice ?? 0)}{unit.basePrice === null ? <span className="block text-[10px] text-slate-400">{t("من النوع")}</span> : null}</td>
                        <td className="p-3 text-center tabular-nums">{formatNumber(unit.maxOccupancy ?? type?.maxOccupancy ?? 1)}</td>
                        <td className="p-3 text-center text-xs">{!unit.active ? <span className="rounded-full bg-slate-200 px-2 py-0.5 text-slate-600">{t("معطّلة")}</span> : unit.outOfService ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-700">{t("خارج الخدمة")}</span> : <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">{t("فعّالة")}</span>}</td>
                        <td className="p-3">{canManage && <div className="flex justify-center gap-1">
                          <button onClick={() => { setError(""); setUnitEdit({ id: unit.id, form: { code: unit.code, name: unit.name, typeId: unit.typeId, floorId: unit.floorId, basePrice: unit.basePrice === null ? "" : unit.basePrice.toFixed(2), maxOccupancy: unit.maxOccupancy === null ? "" : String(unit.maxOccupancy), active: unit.active, notes: unit.notes, sortOrder: String(unit.sortOrder) } }); }} className="rounded border p-2 text-[#7a2450]" title={t("تعديل")}><Edit3 className="h-4 w-4" /></button>
                          <button onClick={() => setRemoval({ kind: "units", id: unit.id, label: unit.code })} className="rounded border p-2 text-red-600" title={t("حذف")}><Trash2 className="h-4 w-4" /></button>
                        </div>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : tab === "types" ? (
              <table className="min-w-full text-sm">
                <thead className="bg-slate-100 text-slate-600"><tr><th className="p-3 text-start">{t("النوع")}</th><th className="p-3">{t("سعر الليلة")}</th><th className="p-3">{t("السعة")}</th><th className="p-3">{t("الوحدات")}</th><th className="p-3">{t("الحالة")}</th><th className="p-3" /></tr></thead>
                <tbody>
                  {setup.types.length === 0 ? <tr><td colSpan={6} className="py-14 text-center text-slate-400">{t("لا توجد أنواع")}</td></tr> : setup.types.map((type: HotelUnitType) => (
                    <tr key={type.id} className="border-t">
                      <td className="p-3"><span className="font-semibold">{type.name}</span>{type.description ? <span className="block text-xs text-slate-500">{type.description}</span> : null}</td>
                      <td className="p-3 text-center tabular-nums">{money(type.basePrice)}</td>
                      <td className="p-3 text-center tabular-nums">{formatNumber(type.maxOccupancy)}</td>
                      <td className="p-3 text-center tabular-nums">{formatNumber(setup.units.filter((u) => u.typeId === type.id).length)}</td>
                      <td className="p-3 text-center text-xs">{type.active ? t("فعّال") : t("معطّل")}</td>
                      <td className="p-3">{canManage && <div className="flex justify-center gap-1">
                        <button onClick={() => { setError(""); setTypeEdit({ id: type.id, form: { name: type.name, basePrice: type.basePrice.toFixed(2), maxOccupancy: String(type.maxOccupancy), description: type.description, active: type.active, sortOrder: String(type.sortOrder) } }); }} className="rounded border p-2 text-[#7a2450]" title={t("تعديل")}><Edit3 className="h-4 w-4" /></button>
                        <button onClick={() => setRemoval({ kind: "types", id: type.id, label: type.name })} className="rounded border p-2 text-red-600" title={t("حذف")}><Trash2 className="h-4 w-4" /></button>
                      </div>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="min-w-full text-sm">
                <thead className="bg-slate-100 text-slate-600"><tr><th className="p-3 text-start">{t("الطابق")}</th><th className="p-3">{t("الترتيب")}</th><th className="p-3">{t("الوحدات")}</th><th className="p-3" /></tr></thead>
                <tbody>
                  {setup.floors.length === 0 ? <tr><td colSpan={4} className="py-14 text-center text-slate-400">{t("لا توجد طوابق")}</td></tr> : setup.floors.map((floor: HotelFloor) => (
                    <tr key={floor.id} className="border-t">
                      <td className="p-3 font-semibold">{floor.name}</td>
                      <td className="p-3 text-center tabular-nums">{formatNumber(floor.sortOrder)}</td>
                      <td className="p-3 text-center tabular-nums">{formatNumber(setup.units.filter((u) => u.floorId === floor.id).length)}</td>
                      <td className="p-3">{canManage && <div className="flex justify-center gap-1">
                        <button onClick={() => { setError(""); setFloorEdit({ id: floor.id, form: { name: floor.name, sortOrder: String(floor.sortOrder) } }); }} className="rounded border p-2 text-[#7a2450]" title={t("تعديل")}><Edit3 className="h-4 w-4" /></button>
                        <button onClick={() => setRemoval({ kind: "floors", id: floor.id, label: floor.name })} className="rounded border p-2 text-red-600" title={t("حذف")}><Trash2 className="h-4 w-4" /></button>
                      </div>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {removal && (
          <HotelConfirm
            title="تأكيد الحذف"
            message={`${t("حذف")} «${removal.label}»؟ ${t(removal.kind === "units" ? "الوحدة التي لها حجوزات لا تُحذف؛ عطّلها بدلًا من ذلك." : "لا يُحذف ما تستخدمه وحدات.")}`}
            confirmLabel="حذف"
            danger
            busy={busy}
            onClose={() => setRemoval(null)}
            onConfirm={() => void remove()}
          />
        )}
      </main>
    </Layout>
  );
}
