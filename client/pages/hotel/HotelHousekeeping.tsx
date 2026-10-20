import { useEffect, useMemo, useState } from "react";
import { Brush, RefreshCw, Wrench } from "lucide-react";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import { permissionLevelAny } from "@/lib/authSession";
import {
  HOUSEKEEPING, hotelErrorText, hotelToday, loadHotelSetup, loadReservations, addDays, unitStates, UNIT_STATE_LABELS,
  type HotelSetup, type HotelUnit, type HousekeepingStatus, type HotelReservation,
} from "@/lib/hotel";
import { ErrorNote, HotelButton, HotelHeader, HotelModal, hotelInput, hotelLabel } from "@/components/hotel/HotelUi";

/** التنظيف والصيانة: حالة تنظيف كل وحدة، وإخراجها من الخدمة وإعادتها */
export default function HotelHousekeeping() {
  const { t, direction, formatNumber } = useI18n();
  const { permissions } = useRolePermissions();
  const canClean = permissionLevelAny(permissions, ["hotel.housekeeping", "hotel.reservations", "module.hotel"]) === "manage";
  const canService = permissionLevelAny(permissions, ["hotel.setup", "hotel.housekeeping", "module.hotel"]) === "manage";
  const [setup, setSetup] = useState<HotelSetup>({ types: [], floors: [], units: [] });
  const [reservations, setReservations] = useState<HotelReservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<HousekeepingStatus | "out" | "">("");
  const [busyId, setBusyId] = useState("");
  const [serviceUnit, setServiceUnit] = useState<HotelUnit | null>(null);
  const [note, setNote] = useState("");

  const load = async () => {
    setLoading(true);
    const today = hotelToday();
    const [setupResult, reservationResult] = await Promise.all([loadHotelSetup(), loadReservations({ from: addDays(today, -1), to: addDays(today, 1) })]);
    setLoading(false);
    setSetup(setupResult.data);
    setReservations(reservationResult.data);
    const firstError = setupResult.error ?? reservationResult.error;
    setError(firstError ? hotelErrorText(firstError.message, t) : "");
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, []);

  const units = setup.units.filter((u) => u.active);
  const states = useMemo(() => unitStates(units, reservations, hotelToday()), [units, reservations]);
  const typeName = new Map(setup.types.map((type) => [type.id, type.name]));
  const floorName = new Map(setup.floors.map((floor) => [floor.id, floor.name]));
  const visible = units.filter((u) => !filter || (filter === "out" ? u.outOfService : u.housekeeping === filter && !u.outOfService));

  const setStatus = async (unit: HotelUnit, status: HousekeepingStatus) => {
    setBusyId(unit.id);
    const { error: statusError } = await supabase.rpc("hotel_set_unit_housekeeping", { p_id: unit.id, p_status: status });
    setBusyId("");
    if (statusError) { toast({ title: t("تعذر تغيير الحالة"), description: hotelErrorText(statusError.message, t), variant: "destructive" }); return; }
    setSetup((current) => ({ ...current, units: current.units.map((u) => (u.id === unit.id ? { ...u, housekeeping: status } : u)) }));
  };

  const setService = async (unit: HotelUnit, out: boolean, serviceNote: string) => {
    setBusyId(unit.id);
    const { error: serviceError } = await supabase.rpc("hotel_set_unit_service", { p_id: unit.id, p_out_of_service: out, p_note: serviceNote || null });
    setBusyId("");
    if (serviceError) { toast({ title: t("تعذر تغيير حالة الوحدة"), description: hotelErrorText(serviceError.message, t), variant: "destructive" }); return; }
    toast({ title: t(out ? "أُخرجت الوحدة من الخدمة" : "أُعيدت الوحدة للخدمة") });
    setServiceUnit(null);
    setNote("");
    await load();
  };

  const counts = {
    clean: units.filter((u) => u.housekeeping === "clean" && !u.outOfService).length,
    dirty: units.filter((u) => u.housekeeping === "dirty" && !u.outOfService).length,
    inspected: units.filter((u) => u.housekeeping === "inspected" && !u.outOfService).length,
    out: units.filter((u) => u.outOfService).length,
  };

  return (
    <Layout>
      <main dir={direction} className="space-y-5">
        <HotelHeader icon={Brush} title="التنظيف والصيانة" description="المغادرة تجعل الوحدة «تحتاج تنظيفًا». سجّل التنظيف والفحص هنا، وأخرج الوحدة من الخدمة للصيانة فلا تُحجز."
          actions={<HotelButton variant="outline" onClick={() => void load()} busy={loading}><RefreshCw className="h-4 w-4" />{t("تحديث")}</HotelButton>} />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {([...HOUSEKEEPING.map((h) => ({ value: h.value as HousekeepingStatus | "out", label: h.label })), { value: "out" as const, label: "خارج الخدمة" }]).map((item) => (
            <button key={item.value} onClick={() => setFilter((current) => current === item.value ? "" : item.value)}
              className={`rounded-xl border bg-white p-4 text-start shadow-sm ${filter === item.value ? "ring-2 ring-[#7a2450]" : ""}`}>
              <p className="text-xs text-slate-500">{t(item.label)}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{formatNumber(counts[item.value])}</p>
            </button>
          ))}
        </div>
        <ErrorNote message={error} />
        {loading ? <div className="rounded-xl border bg-white p-10 text-center text-slate-500">{t("جاري التحميل...")}</div> : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {visible.map((unit) => {
              const state = states.get(unit.id)?.state ?? "vacant";
              return (
                <div key={unit.id} className={cn("rounded-xl border bg-white p-4 shadow-sm", unit.outOfService && "border-red-200 bg-red-50/40")}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xl font-extrabold tabular-nums text-slate-900">{unit.code}</p>
                      <p className="text-xs text-slate-500">{typeName.get(unit.typeId) ?? ""}{unit.floorId ? `، ${floorName.get(unit.floorId) ?? ""}` : ""}</p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-xs text-slate-600"><span className={cn("h-2.5 w-2.5 rounded-full", UNIT_STATE_LABELS[state].dot)} />{t(UNIT_STATE_LABELS[state].label)}</span>
                  </div>
                  {unit.outOfService ? (
                    <div className="mt-3 rounded-lg bg-red-100/70 px-3 py-2 text-xs text-red-800">{t("خارج الخدمة")}{unit.outOfServiceNote ? `: ${unit.outOfServiceNote}` : ""}</div>
                  ) : (
                    <div className="mt-3 grid grid-cols-3 gap-1" role="group" aria-label={t("حالة التنظيف")}>
                      {HOUSEKEEPING.map((h) => (
                        <button key={h.value} disabled={!canClean || busyId === unit.id} onClick={() => void setStatus(unit, h.value)}
                          className={cn("rounded-lg border px-1 py-1.5 text-[11px] font-semibold transition disabled:cursor-not-allowed",
                            unit.housekeeping === h.value ? cn(h.className, "border-transparent") : "border-slate-200 text-slate-500 hover:bg-slate-50")}>
                          {t(h.label)}
                        </button>
                      ))}
                    </div>
                  )}
                  {/* الوحدة المشغولة بنزيل لا تُخرج من الخدمة (يرفضها الخادم) */}
                  {canService && (unit.outOfService || (state !== "occupied" && state !== "departing")) && (
                    <button disabled={busyId === unit.id} onClick={() => (unit.outOfService ? void setService(unit, false, "") : (setServiceUnit(unit), setNote("")))}
                      className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[#7a2450] disabled:opacity-50">
                      <Wrench className="h-3.5 w-3.5" />{t(unit.outOfService ? "إعادة للخدمة" : "إخراج من الخدمة")}
                    </button>
                  )}
                </div>
              );
            })}
            {visible.length === 0 && <p className="col-span-full rounded-xl border bg-white p-10 text-center text-slate-400">{t("لا توجد وحدات")}</p>}
          </div>
        )}
        {serviceUnit && (
          <HotelModal title={`${t("إخراج الوحدة")} ${serviceUnit.code} ${t("من الخدمة")}`} onClose={() => setServiceUnit(null)} busy={busyId === serviceUnit.id}
            footer={<>
              <HotelButton variant="outline" onClick={() => setServiceUnit(null)}>{t("رجوع")}</HotelButton>
              <HotelButton onClick={() => void setService(serviceUnit, true, note.trim())} busy={busyId === serviceUnit.id}>{t("إخراج من الخدمة")}</HotelButton>
            </>}>
            <p className="text-sm text-slate-600">{t("لا تُحجز الوحدة ولا يُسجَّل الدخول إليها حتى إعادتها. الوحدة المشغولة بنزيل لا تُخرج.")}</p>
            <label className={`${hotelLabel} mt-3`}>{t("السبب")}<input value={note} onChange={(e) => setNote(e.target.value)} className={hotelInput} maxLength={300} placeholder={t("مثل: صيانة التكييف")} /></label>
          </HotelModal>
        )}
      </main>
    </Layout>
  );
}
