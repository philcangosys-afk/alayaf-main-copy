import { Fragment, useEffect, useMemo, useState } from "react";
import { Ban, CheckCircle2, Edit3, Loader2, Plus, Route, Save, Search, Trash2, X } from "lucide-react";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { canManagePerm } from "@/lib/authSession";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import { selectAllRows } from "@/lib/ledgerData";
import {
  TRIP_STATUSES, daysUntil, expiryState, fleetErrorText, fleetToday, loadFleetDrivers, loadFleetVehicles, numberOf, optionLabel,
  vehicleLabel, type FleetDriver, type FleetVehicle, type Option,
} from "@/lib/fleet";

type Trip = {
  id: string;
  number: string;
  vehicleId: string;
  driverId: string;
  startAt: string;
  endAt: string;
  startOdometer: number;
  endOdometer: number | null;
  origin: string;
  destination: string;
  purpose: string;
  costCenterId: string;
  status: string;
  notes: string;
};
type Form = {
  vehicleId: string; driverId: string; startAt: string; startOdometer: string; origin: string; destination: string;
  purpose: string; costCenterId: string; notes: string;
};
type CloseForm = { endAt: string; endOdometer: string };

const STATUS_CLASS: Record<string, string> = {
  open: "bg-sky-100 text-sky-700",
  closed: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-slate-200 text-slate-600",
};

/**
 * أوقات الرحلات تُدخل وتُعرض بتوقيت الرياض (UTC+03:00 ثابت بلا توقيت صيفي) أيًا كانت منطقة جهاز المستخدم،
 * حتى يتطابق تاريخ الرحلة مع fleetToday() ومع فحص انتهاء الرخصة في القاعدة.
 */
const RIYADH_OFFSET = "+03:00";
const RIYADH_DATE_TIME = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
/** قيمة حقل datetime-local (YYYY-MM-DDTHH:mm) بتوقيت الرياض؛ الافتراضي الآن. */
const riyadhInputValue = (value: Date | string = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = RIYADH_DATE_TIME.formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${pick("year")}-${pick("month")}-${pick("day")}T${pick("hour")}:${pick("minute")}`;
};
const isInputValue = (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value);
const inputToIso = (value: string) => new Date(`${value.length === 16 ? `${value}:00` : value}${RIYADH_OFFSET}`).toISOString();
const riyadhDate = (iso: string) => riyadhInputValue(iso).slice(0, 10);
const displayDateTime = (iso: string) => (iso ? riyadhInputValue(iso).replace("T", " ") : "");

const newForm = (): Form => ({
  vehicleId: "", driverId: "", startAt: riyadhInputValue(), startOdometer: "", origin: "", destination: "", purpose: "", costCenterId: "", notes: "",
});

const mapTrip = (row: Record<string, unknown>): Trip => ({
  id: String(row.id),
  number: String(row.trip_number ?? ""),
  vehicleId: String(row.vehicle_id ?? ""),
  driverId: String(row.driver_id ?? ""),
  startAt: String(row.start_at ?? ""),
  endAt: row.end_at ? String(row.end_at) : "",
  startOdometer: numberOf(row.start_odometer),
  endOdometer: row.end_odometer === null || row.end_odometer === undefined ? null : numberOf(row.end_odometer),
  origin: String(row.origin ?? ""),
  destination: String(row.destination ?? ""),
  purpose: String(row.purpose ?? ""),
  costCenterId: String(row.cost_center_id ?? ""),
  status: String(row.status ?? "open"),
  notes: String(row.notes ?? ""),
});

/** مسافة الرحلة المغلقة فقط (الجارية والملغاة بلا مسافة). */
const distanceOf = (trip: Trip) => (trip.status === "closed" && trip.endOdometer !== null ? Math.max(trip.endOdometer - trip.startOdometer, 0) : null);

export default function FleetTrips() {
  const { t, direction, formatNumber } = useI18n();
  const { permissions } = useRolePermissions();
  const canManage = canManagePerm(permissions, "fleet.trips", "module.fleet");
  const [trips, setTrips] = useState<Trip[]>([]);
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [drivers, setDrivers] = useState<FleetDriver[]>([]);
  const [costCenters, setCostCenters] = useState<Option[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [vehicleFilter, setVehicleFilter] = useState("");
  const [driverFilter, setDriverFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [editingId, setEditingId] = useState<string | null | undefined>(undefined);
  const [form, setForm] = useState<Form>(newForm);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [closeForm, setCloseForm] = useState<CloseForm>({ endAt: "", endOdometer: "" });
  const [closeError, setCloseError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    const [tripResult, vehicleResult, driverResult, centerResult] = await Promise.all([
      selectAllRows((from, to) => supabase.from("fleet_trips").select("*").order("start_at", { ascending: false }).order("id").range(from, to)),
      loadFleetVehicles(),
      loadFleetDrivers(),
      supabase.rpc("fleet_cost_center_options"),
    ]);
    const firstError = tripResult.error ?? vehicleResult.error ?? driverResult.error;
    if (firstError) {
      setError(t(fleetErrorText(firstError.message)));
      setLoading(false);
      return;
    }
    setTrips(tripResult.data.map((row: Record<string, unknown>) => mapTrip(row)));
    setVehicles(vehicleResult.data);
    setDrivers(driverResult.data);
    // مركز التكلفة اختياري في الرحلة؛ تعذر قراءة القائمة لا يمنع عرض الرحلات
    setCostCenters(centerResult.error ? [] : ((centerResult.data ?? []) as Record<string, unknown>[]).map((row) => ({ value: String(row.id), label: `${row.code} — ${row.name_ar}` })));
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const vehicleById = useMemo(() => new Map(vehicles.map((vehicle) => [vehicle.id, vehicle])), [vehicles]);
  const driverById = useMemo(() => new Map(drivers.map((driver) => [driver.id, driver])), [drivers]);
  const costCenterById = useMemo(() => new Map(costCenters.map((option) => [option.value, option.label])), [costCenters]);
  const openTrips = trips.filter((trip) => trip.status === "open");
  const vehiclesOnTrip = new Set(openTrips.map((trip) => trip.vehicleId));
  const driversOnTrip = new Set(openTrips.map((trip) => trip.driverId));
  const month = fleetToday().slice(0, 7);
  const monthTrips = trips.filter((trip) => trip.status !== "cancelled" && riyadhDate(trip.startAt).startsWith(month));
  const monthKm = monthTrips.reduce((sum, trip) => sum + (distanceOf(trip) ?? 0), 0);

  const visibleTrips = trips.filter((trip) => {
    const date = riyadhDate(trip.startAt);
    const text = `${trip.number} ${trip.purpose} ${trip.origin} ${trip.destination} ${vehicleById.get(trip.vehicleId)?.plate ?? ""} ${driverById.get(trip.driverId)?.name ?? ""}`.toLowerCase();
    return (!search.trim() || text.includes(search.trim().toLowerCase()))
      && (!vehicleFilter || trip.vehicleId === vehicleFilter)
      && (!driverFilter || trip.driverId === driverFilter)
      && (!statusFilter || trip.status === statusFilter)
      && (!dateFrom || date >= dateFrom)
      && (!dateTo || date <= dateTo);
  });
  const visibleKm = visibleTrips.reduce((sum, trip) => sum + (distanceOf(trip) ?? 0), 0);
  const hasFilters = Boolean(search || vehicleFilter || driverFilter || statusFilter || dateFrom || dateTo);
  const clearFilters = () => { setSearch(""); setVehicleFilter(""); setDriverFilter(""); setStatusFilter(""); setDateFrom(""); setDateTo(""); };

  const update = (key: keyof Form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  // عداد البداية يُملأ تلقائيًا بعداد المركبة الحالي عند اختيارها
  const selectVehicle = (vehicleId: string) =>
    setForm((current) => ({ ...current, vehicleId, startOdometer: vehicleId ? String(vehicleById.get(vehicleId)?.odometer ?? "") : "" }));
  const reset = () => { setEditingId(undefined); setForm(newForm()); setError(""); };
  const startNew = () => { reset(); setClosingId(null); setEditingId(null); };
  const startEdit = (trip: Trip) => {
    setClosingId(null);
    setEditingId(trip.id);
    setForm({
      vehicleId: trip.vehicleId, driverId: trip.driverId, startAt: riyadhInputValue(trip.startAt), startOdometer: String(trip.startOdometer),
      origin: trip.origin, destination: trip.destination, purpose: trip.purpose, costCenterId: trip.costCenterId, notes: trip.notes,
    });
    setError("");
  };

  const startDate = isInputValue(form.startAt) ? form.startAt.slice(0, 10) : fleetToday();
  const licenseValidOn = (driver: FleetDriver, date: string) => (daysUntil(driver.licenseExpiry, date) ?? -1) >= 0;
  const vehicleChoices = vehicles.filter((vehicle) => vehicle.status === "active");
  const driverChoices = drivers.filter((driver) => driver.status === "active" && licenseValidOn(driver, startDate));
  const selectedVehicle = vehicleById.get(form.vehicleId);
  const selectedDriver = driverById.get(form.driverId);
  const startOdometerValue = form.startOdometer.trim() === "" ? null : Number(form.startOdometer);
  const odometerWarning = !editingId && selectedVehicle && startOdometerValue !== null && Number.isFinite(startOdometerValue) && startOdometerValue < selectedVehicle.odometer;

  const save = async () => {
    if (!editingId) {
      if (!form.vehicleId || !form.driverId) { setError(t("اختر المركبة والسائق")); return; }
      if (!isInputValue(form.startAt)) { setError(t("أدخل تاريخ ووقت بداية الرحلة")); return; }
      const startOdometer = Number(form.startOdometer);
      if (form.startOdometer.trim() === "" || !Number.isFinite(startOdometer) || startOdometer < 0) { setError(t("أدخل قراءة عداد البداية")); return; }
      if (!selectedDriver || selectedDriver.status !== "active" || !licenseValidOn(selectedDriver, startDate)) {
        setError(t("رخصة السائق منتهية في تاريخ الرحلة؛ جدّد الرخصة في شاشة السائقين أولًا."));
        return;
      }
    }
    if (!form.purpose.trim()) { setError(t("أدخل الغرض من الرحلة")); return; }
    const payload: Record<string, unknown> = {
      origin: form.origin.trim() || null, destination: form.destination.trim() || null, purpose: form.purpose.trim(),
      cost_center_id: form.costCenterId || null, notes: form.notes.trim() || null,
    };
    // المركبة والسائق ووقت وعداد البداية تُحدد عند التسجيل فقط؛ رقم الرحلة يولّده النظام
    if (!editingId) {
      payload.vehicle_id = form.vehicleId;
      payload.driver_id = form.driverId;
      payload.start_at = inputToIso(form.startAt);
      payload.start_odometer = Number(form.startOdometer);
    }
    setBusy(true);
    setError("");
    const { error: saveError } = editingId
      ? await supabase.from("fleet_trips").update(payload).eq("id", editingId)
      : await supabase.from("fleet_trips").insert(payload);
    setBusy(false);
    if (saveError) { setError(t(fleetErrorText(saveError.message))); return; }
    toast({ title: t(editingId ? "تم تحديث الرحلة" : "تم تسجيل الرحلة") });
    reset();
    await load();
  };

  const startClose = (trip: Trip) => {
    reset();
    setClosingId(trip.id);
    setCloseForm({ endAt: riyadhInputValue(), endOdometer: "" });
    setCloseError("");
  };

  const closeTrip = async (trip: Trip) => {
    if (!isInputValue(closeForm.endAt)) { setCloseError(t("أدخل تاريخ ووقت نهاية الرحلة")); return; }
    const endAt = inputToIso(closeForm.endAt);
    if (new Date(endAt).getTime() < new Date(trip.startAt).getTime()) { setCloseError(t("تاريخ نهاية الرحلة يجب أن يكون بعد بدايتها")); return; }
    const endOdometer = Number(closeForm.endOdometer);
    if (closeForm.endOdometer.trim() === "" || !Number.isFinite(endOdometer) || endOdometer < trip.startOdometer) {
      setCloseError(t("عداد نهاية الرحلة يجب ألا يقل عن عداد البداية"));
      return;
    }
    setBusy(true);
    setCloseError("");
    const { error: closeFailure } = await supabase.from("fleet_trips").update({ status: "closed", end_at: endAt, end_odometer: endOdometer }).eq("id", trip.id);
    setBusy(false);
    if (closeFailure) { setCloseError(t(fleetErrorText(closeFailure.message))); return; }
    toast({ title: t("تم إغلاق الرحلة"), description: `${t("المسافة")}: ${formatNumber(endOdometer - trip.startOdometer)} ${t("كم")}` });
    setClosingId(null);
    await load();
  };

  const cancelTrip = async (trip: Trip) => {
    if (!confirm(t("هل تريد إلغاء الرحلة؟ الرحلة الملغاة لا يُعاد فتحها ولا تُحتسب مسافتها."))) return;
    setBusy(true);
    const { error: cancelError } = await supabase.from("fleet_trips").update({ status: "cancelled" }).eq("id", trip.id);
    setBusy(false);
    if (cancelError) { toast({ title: t("تعذر إلغاء الرحلة"), description: t(fleetErrorText(cancelError.message)), variant: "destructive" }); return; }
    toast({ title: t("تم إلغاء الرحلة") });
    if (closingId === trip.id) setClosingId(null);
    if (editingId === trip.id) reset();
    await load();
  };

  const remove = async (trip: Trip) => {
    if (!confirm(t("هل تريد حذف الرحلة الملغاة نهائيًا؟"))) return;
    setBusy(true);
    const { error: deleteError } = await supabase.from("fleet_trips").delete().eq("id", trip.id);
    setBusy(false);
    if (deleteError) { toast({ title: t("تعذر حذف الرحلة"), description: t(fleetErrorText(deleteError.message)), variant: "destructive" }); return; }
    toast({ title: t("تم حذف الرحلة") });
    await load();
  };

  const editingTrip = editingId ? trips.find((trip) => trip.id === editingId) : undefined;
  const closeEnd = closeForm.endOdometer.trim() === "" ? null : Number(closeForm.endOdometer);
  const arrow = direction === "rtl" ? "←" : "→";
  const input = "mt-1 h-10 w-full rounded border px-3 text-sm";
  const select = "mt-1 h-10 w-full rounded border bg-white px-2 text-sm";
  const filterControl = "h-9 rounded border bg-white px-2 text-sm";

  return (
    <Layout>
      <main dir={direction} className="space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-teal-50 p-2 text-teal-700"><Route className="h-6 w-6" /></div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{t("سجل الحركة والرحلات")}</h1>
              <p className="mt-1 text-sm text-slate-500">{t("تسجيل رحلات المركبات بالسائق والعداد والغرض، وإغلاقها بعداد النهاية لتحديث عداد المركبة تلقائيًا.")}</p>
            </div>
          </div>
          {canManage && <button onClick={startNew} className="inline-flex items-center gap-2 rounded bg-teal-700 px-4 py-2 text-sm font-semibold text-white"><Plus className="h-4 w-4" />{t("رحلة جديدة")}</button>}
        </header>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <button onClick={() => setStatusFilter((current) => current === "open" ? "" : "open")} className={`rounded-xl border bg-white p-4 text-start shadow-sm ${statusFilter === "open" ? "ring-2 ring-teal-600" : ""}`}>
            <p className="text-xs text-slate-500">{t("رحلات جارية")}</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{formatNumber(openTrips.length)}</p>
          </button>
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500">{t("رحلات هذا الشهر")}</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{formatNumber(monthTrips.length)}</p>
          </div>
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500">{t("كيلومترات هذا الشهر")} <span className="text-[11px] text-slate-400">({t("الرحلات المغلقة")})</span></p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{formatNumber(monthKm)}</p>
          </div>
        </div>

        {error && <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        {editingId !== undefined && (
          <section className="rounded-xl border bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-bold">{editingId ? `${t("تعديل الرحلة")} ${editingTrip?.number ?? ""}` : t("رحلة جديدة")}</h2>
              <button onClick={reset}><X className="h-5 w-5" /></button>
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <label className="text-xs text-slate-600">{t("المركبة")} *
                {editingId
                  ? <input value={vehicleLabel(selectedVehicle)} disabled className={`${input} bg-slate-50`} />
                  : <select value={form.vehicleId} onChange={(event) => selectVehicle(event.target.value)} className={select}>
                      <option value="">{t(vehicleChoices.length ? "اختر المركبة" : "لا توجد مركبات متاحة")}</option>
                      {vehicleChoices.map((vehicle) => (
                        <option key={vehicle.id} value={vehicle.id} disabled={vehiclesOnTrip.has(vehicle.id)}>
                          {vehicleLabel(vehicle)}{vehiclesOnTrip.has(vehicle.id) ? ` (${t("في رحلة جارية")})` : ""}
                        </option>
                      ))}
                    </select>}
              </label>
              <label className="text-xs text-slate-600">{t("السائق")} *
                {editingId
                  ? <input value={selectedDriver?.name ?? "—"} disabled className={`${input} bg-slate-50`} />
                  : <select value={form.driverId} onChange={(event) => update("driverId")(event.target.value)} className={select}>
                      <option value="">{t(driverChoices.length ? "اختر السائق" : "لا يوجد سائقون برخصة سارية")}</option>
                      {driverChoices.map((driver) => (
                        <option key={driver.id} value={driver.id} disabled={driversOnTrip.has(driver.id)}>
                          {driver.name}{driver.employeeNumber ? ` (${driver.employeeNumber})` : ""} — {t("الرخصة حتى")} {driver.licenseExpiry}{driversOnTrip.has(driver.id) ? ` (${t("في رحلة جارية")})` : ""}
                        </option>
                      ))}
                    </select>}
                {!editingId && selectedDriver && (
                  <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${expiryState(selectedDriver.licenseExpiry).className}`}>
                    {t("انتهاء الرخصة")}: {selectedDriver.licenseExpiry} — {t(expiryState(selectedDriver.licenseExpiry).label)}
                  </span>
                )}
              </label>
              <label className="text-xs text-slate-600">{t("بداية الرحلة")} *
                <input type="datetime-local" value={form.startAt} disabled={Boolean(editingId)} onChange={(event) => update("startAt")(event.target.value)} className={`${input} disabled:bg-slate-50`} />
              </label>
              <label className="text-xs text-slate-600">{t("عداد البداية (كم)")} *
                <input type="number" min="0" value={form.startOdometer} disabled={Boolean(editingId)} onChange={(event) => update("startOdometer")(event.target.value)} className={`${input} disabled:bg-slate-50`} />
                {!editingId && selectedVehicle && (
                  <span className={`mt-1 block text-[11px] ${odometerWarning ? "font-semibold text-amber-700" : "text-slate-500"}`}>
                    {odometerWarning ? t("أقل من عداد المركبة الحالي") : t("عداد المركبة الحالي")}: {formatNumber(selectedVehicle.odometer)}
                  </span>
                )}
              </label>
              <label className="text-xs text-slate-600">{t("من (نقطة الانطلاق)")}<input value={form.origin} onChange={(event) => update("origin")(event.target.value)} className={input} /></label>
              <label className="text-xs text-slate-600">{t("إلى (الوجهة)")}<input value={form.destination} onChange={(event) => update("destination")(event.target.value)} className={input} /></label>
              <label className="text-xs text-slate-600">{t("الغرض من الرحلة")} *<input value={form.purpose} onChange={(event) => update("purpose")(event.target.value)} className={input} /></label>
              <label className="text-xs text-slate-600">{t("مركز التكلفة")}
                <select value={form.costCenterId} onChange={(event) => update("costCenterId")(event.target.value)} className={select}>
                  <option value="">{t("بدون")}</option>
                  {costCenters.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label className="text-xs text-slate-600 md:col-span-4">{t("ملاحظات")}<input value={form.notes} onChange={(event) => update("notes")(event.target.value)} className={input} /></label>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              {t(editingId
                ? "تُعدَّل بيانات الوصف فقط؛ المركبة والسائق ووقت وعداد البداية ثابتة بعد التسجيل. لإيقاف رحلة خاطئة ألغِها ثم سجّلها من جديد."
                : "تُسجل الرحلة على مركبة متاحة وسائق نشط رخصته سارية في تاريخ الرحلة، ولا يُسمح بأكثر من رحلة جارية للمركبة أو السائق. إغلاق الرحلة يحدّث عداد المركبة تلقائيًا.")}
            </p>
            <div className="mt-4 flex justify-end">
              <button disabled={busy} onClick={() => void save()} className="inline-flex items-center gap-2 rounded bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{t("حفظ")}</button>
            </div>
          </section>
        )}

        <section className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-2 border-b bg-slate-50 px-4 py-3">
            <div className="relative w-full max-w-xs">
              <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("ابحث برقم الرحلة أو الغرض أو الوجهة")} className="h-9 w-full rounded border bg-white ps-9 pe-3 text-sm" />
            </div>
            <select value={vehicleFilter} onChange={(event) => setVehicleFilter(event.target.value)} className={filterControl}>
              <option value="">{t("كل المركبات")}</option>
              {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicleLabel(vehicle)}</option>)}
            </select>
            <select value={driverFilter} onChange={(event) => setDriverFilter(event.target.value)} className={filterControl}>
              <option value="">{t("كل السائقين")}</option>
              {drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className={filterControl}>
              <option value="">{t("كل الحالات")}</option>
              {TRIP_STATUSES.map((option) => <option key={option.value} value={option.value}>{t(option.label)}</option>)}
            </select>
            <label className="flex items-center gap-1 text-xs text-slate-500">{t("من تاريخ")}<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className={filterControl} /></label>
            <label className="flex items-center gap-1 text-xs text-slate-500">{t("إلى تاريخ")}<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className={filterControl} /></label>
            {hasFilters && <button onClick={clearFilters} className="text-xs font-semibold text-teal-700">{t("مسح الفلاتر")}</button>}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="p-3">{t("الرقم")}</th><th className="p-3">{t("المركبة")}</th><th className="p-3">{t("السائق")}</th><th className="p-3">{t("البداية")}</th>
                  <th className="p-3">{t("النهاية")}</th><th className="p-3">{t("عداد البداية")}</th><th className="p-3">{t("عداد النهاية")}</th><th className="p-3">{t("المسافة (كم)")}</th>
                  <th className="p-3">{t("الغرض")}</th><th className="p-3">{t("الحالة")}</th><th className="p-3">{t("الإجراءات")}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? <tr><td colSpan={11} className="py-14 text-center">{t("جاري التحميل...")}</td></tr>
                  : visibleTrips.length === 0 ? <tr><td colSpan={11} className="py-14 text-center text-slate-400">{t("لا توجد رحلات")}</td></tr>
                  : visibleTrips.map((trip) => {
                    const vehicle = vehicleById.get(trip.vehicleId);
                    const distance = distanceOf(trip);
                    const costCenter = costCenterById.get(trip.costCenterId);
                    return (
                      <Fragment key={trip.id}>
                        <tr className={`border-t ${closingId === trip.id ? "bg-emerald-50/60" : ""}`}>
                          <td className="p-3 font-mono">{trip.number || "—"}</td>
                          <td className="p-3 text-center">
                            <div className="font-semibold">{vehicle?.plate ?? "—"}</div>
                            {vehicle && <div className="text-xs text-slate-500">{vehicle.make} {vehicle.model}</div>}
                          </td>
                          <td className="p-3 text-center">{driverById.get(trip.driverId)?.name ?? "—"}</td>
                          <td className="whitespace-nowrap p-3 text-center"><span dir="ltr">{displayDateTime(trip.startAt) || "—"}</span></td>
                          <td className="whitespace-nowrap p-3 text-center"><span dir="ltr">{displayDateTime(trip.endAt) || "—"}</span></td>
                          <td className="p-3 text-center">{formatNumber(trip.startOdometer)}</td>
                          <td className="p-3 text-center">{trip.endOdometer === null ? "—" : formatNumber(trip.endOdometer)}</td>
                          <td className="p-3 text-center font-semibold">{distance === null ? "—" : formatNumber(distance)}</td>
                          <td className="p-3 text-center" title={trip.notes || undefined}>
                            <div>{trip.purpose || "—"}</div>
                            {(trip.origin || trip.destination) && <div className="text-xs text-slate-500">{trip.origin || "—"} {arrow} {trip.destination || "—"}</div>}
                            {costCenter && <div className="text-[11px] text-slate-400">{t("مركز التكلفة")}: {costCenter}</div>}
                          </td>
                          <td className="p-3 text-center"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${STATUS_CLASS[trip.status] ?? "bg-slate-100"}`}>{t(optionLabel(TRIP_STATUSES, trip.status))}</span></td>
                          <td className="p-3">
                            {canManage && trip.status === "open" && (
                              <div className="flex flex-wrap justify-center gap-1">
                                <button disabled={busy} onClick={() => startClose(trip)} className="inline-flex items-center gap-1 rounded border border-emerald-200 px-2 py-1.5 text-xs font-semibold text-emerald-700 disabled:opacity-50"><CheckCircle2 className="h-4 w-4" />{t("إغلاق الرحلة")}</button>
                                <button disabled={busy} onClick={() => startEdit(trip)} className="rounded border p-2 text-teal-700 disabled:opacity-50" title={t("تعديل")}><Edit3 className="h-4 w-4" /></button>
                                <button disabled={busy} onClick={() => void cancelTrip(trip)} className="rounded border p-2 text-amber-700 disabled:opacity-50" title={t("إلغاء")}><Ban className="h-4 w-4" /></button>
                              </div>
                            )}
                            {canManage && trip.status === "cancelled" && (
                              <div className="flex justify-center">
                                <button disabled={busy} onClick={() => void remove(trip)} className="rounded border p-2 text-red-600 disabled:opacity-50" title={t("حذف")}><Trash2 className="h-4 w-4" /></button>
                              </div>
                            )}
                          </td>
                        </tr>
                        {closingId === trip.id && (
                          <tr className="bg-emerald-50/60">
                            <td colSpan={11} className="px-4 pb-4">
                              <div className="flex flex-wrap items-end gap-3 rounded-lg border border-emerald-200 bg-white p-3">
                                <label className="w-full text-xs text-slate-600 sm:w-56">{t("نهاية الرحلة")} *
                                  <input type="datetime-local" value={closeForm.endAt} onChange={(event) => setCloseForm((current) => ({ ...current, endAt: event.target.value }))} className={input} />
                                </label>
                                <label className="w-full text-xs text-slate-600 sm:w-48">{t("عداد النهاية (كم)")} *
                                  <input type="number" min={trip.startOdometer} value={closeForm.endOdometer} onChange={(event) => setCloseForm((current) => ({ ...current, endOdometer: event.target.value }))} className={input} autoFocus />
                                </label>
                                <div className="pb-2 text-xs text-slate-500">
                                  {t("عداد البداية")}: <b className="text-slate-700">{formatNumber(trip.startOdometer)}</b>
                                  {closeEnd !== null && Number.isFinite(closeEnd) && closeEnd >= trip.startOdometer && <> — {t("المسافة")}: <b className="text-emerald-700">{formatNumber(closeEnd - trip.startOdometer)}</b> {t("كم")}</>}
                                </div>
                                <div className="ms-auto flex gap-2">
                                  <button disabled={busy} onClick={() => { setClosingId(null); setCloseError(""); }} className="rounded border bg-white px-3 py-2 text-sm">{t("تراجع")}</button>
                                  <button disabled={busy} onClick={() => void closeTrip(trip)} className="inline-flex items-center gap-2 rounded bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}{t("تأكيد الإغلاق")}</button>
                                </div>
                              </div>
                              {closeError && <p className="mt-2 text-sm text-red-700">{closeError}</p>}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
              </tbody>
            </table>
          </div>
          {!loading && visibleTrips.length > 0 && (
            <div className="flex flex-wrap justify-end gap-4 border-t bg-slate-50 px-4 py-2 text-xs text-slate-600">
              <span>{t("عدد الرحلات")}: <b>{formatNumber(visibleTrips.length)}</b></span>
              <span>{t("إجمالي المسافة (كم)")}: <b>{formatNumber(visibleKm)}</b></span>
            </div>
          )}
        </section>
      </main>
    </Layout>
  );
}
