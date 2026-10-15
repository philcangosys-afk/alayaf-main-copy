import { useEffect, useMemo, useState } from "react";
import { Edit3, Loader2, Plus, Save, Search, Trash2, Truck, X } from "lucide-react";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { canManagePerm } from "@/lib/authSession";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import {
  FUEL_TYPES, OWNERSHIP_TYPES, VEHICLE_STATUSES, VEHICLE_TYPES, fleetErrorText, loadFleetDrivers, loadFleetVehicles,
  numberOf, optionLabel, type FleetDriver, type FleetVehicle, type Option,
} from "@/lib/fleet";

type AssetValue = { vehicleId: string; assetNumber: string; status: string; cost: number; accumulated: number; bookValue: number };
type Form = {
  plate: string; make: string; model: string; year: string; vin: string; color: string; type: string; fuelType: string;
  ownership: string; status: string; odometer: string; fuelCapacity: string; branchId: string; costCenterId: string;
  fixedAssetId: string; driverId: string; notes: string;
};

const emptyForm: Form = {
  plate: "", make: "", model: "", year: "", vin: "", color: "", type: "car", fuelType: "petrol91", ownership: "owned",
  status: "active", odometer: "0", fuelCapacity: "", branchId: "", costCenterId: "", fixedAssetId: "", driverId: "", notes: "",
};

const STATUS_CLASS: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700",
  maintenance: "bg-amber-100 text-amber-800",
  out_of_service: "bg-slate-200 text-slate-600",
  disposed: "bg-red-100 text-red-700",
};

export default function FleetVehicles() {
  const { t, direction, formatNumber } = useI18n();
  const { permissions } = useRolePermissions();
  const canManage = canManagePerm(permissions, "fleet.vehicles", "module.fleet");
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [drivers, setDrivers] = useState<FleetDriver[]>([]);
  const [branches, setBranches] = useState<Option[]>([]);
  const [costCenters, setCostCenters] = useState<Option[]>([]);
  const [assetOptions, setAssetOptions] = useState<Option[]>([]);
  const [assetValues, setAssetValues] = useState<AssetValue[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [editingId, setEditingId] = useState<string | null | undefined>(undefined);
  const [form, setForm] = useState<Form>(emptyForm);

  const load = async () => {
    setLoading(true);
    setError("");
    const [vehicleResult, driverResult, branchResult, centerResult, valueResult] = await Promise.all([
      loadFleetVehicles(),
      loadFleetDrivers(),
      supabase.from("branches").select("id, name").order("name"),
      supabase.rpc("fleet_cost_center_options"),
      supabase.rpc("fleet_vehicle_asset_values"),
    ]);
    // الفروع ومراكز التكلفة والقيم الدفترية قوائم مساندة؛ تعذر قراءتها لا يمنع عرض المركبات
    const firstError = vehicleResult.error ?? driverResult.error;
    if (firstError) {
      setError(t(fleetErrorText(firstError.message)));
      setLoading(false);
      return;
    }
    setVehicles(vehicleResult.data);
    setDrivers(driverResult.data);
    setBranches((branchResult.error ? [] : branchResult.data ?? []).map((row: Record<string, unknown>) => ({ value: String(row.id), label: String(row.name ?? "") })));
    setCostCenters(((centerResult.error ? [] : centerResult.data ?? []) as Record<string, unknown>[]).map((row) => ({ value: String(row.id), label: `${row.code} — ${row.name_ar}` })));
    setAssetValues(((valueResult.error ? [] : valueResult.data ?? []) as Record<string, unknown>[]).map((row) => ({
      vehicleId: String(row.vehicle_id), assetNumber: String(row.asset_number ?? ""), status: String(row.asset_status ?? ""),
      cost: numberOf(row.cost), accumulated: numberOf(row.accumulated_depreciation), bookValue: numberOf(row.book_value),
    })));
    setLoading(false);
  };

  // قائمة الأصول الثابتة غير المربوطة تُجلب عند فتح النموذج (تتطلب صلاحية إدارة المركبات)
  const loadAssetOptions = async () => {
    const { data, error: assetError } = await supabase.rpc("fleet_asset_options");
    if (assetError) {
      setAssetOptions([]);
      return;
    }
    setAssetOptions(((data ?? []) as Record<string, unknown>[]).map((row) => ({ value: String(row.id), label: `${row.asset_number} — ${row.name}` })));
  };

  useEffect(() => { void load(); }, []);

  const driverById = useMemo(() => new Map(drivers.map((driver) => [driver.id, driver])), [drivers]);
  const valueByVehicle = useMemo(() => new Map(assetValues.map((value) => [value.vehicleId, value])), [assetValues]);
  const visibleVehicles = vehicles.filter((vehicle) => {
    const text = `${vehicle.number} ${vehicle.plate} ${vehicle.make} ${vehicle.model} ${vehicle.vin}`.toLowerCase();
    return (!search.trim() || text.includes(search.trim().toLowerCase())) && (!statusFilter || vehicle.status === statusFilter);
  });
  const counts = VEHICLE_STATUSES.map((status) => ({ ...status, count: vehicles.filter((vehicle) => vehicle.status === status.value).length }));

  const update = (key: keyof Form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  const reset = () => { setEditingId(undefined); setForm(emptyForm); setError(""); };
  const startNew = () => { reset(); setEditingId(null); void loadAssetOptions(); };
  const startEdit = (vehicle: FleetVehicle) => {
    setEditingId(vehicle.id);
    setForm({
      plate: vehicle.plate, make: vehicle.make, model: vehicle.model, year: vehicle.year ? String(vehicle.year) : "", vin: vehicle.vin,
      color: vehicle.color, type: vehicle.type, fuelType: vehicle.fuelType, ownership: vehicle.ownership, status: vehicle.status,
      odometer: String(vehicle.openingOdometer), fuelCapacity: vehicle.fuelCapacity === null ? "" : String(vehicle.fuelCapacity),
      branchId: vehicle.branchId, costCenterId: vehicle.costCenterId, fixedAssetId: vehicle.fixedAssetId, driverId: vehicle.driverId, notes: vehicle.notes,
    });
    setError("");
    void loadAssetOptions();
  };

  const save = async () => {
    if (!form.plate.trim() || !form.make.trim()) { setError(t("أدخل رقم اللوحة والشركة المصنعة")); return; }
    const year = form.year.trim() ? Number(form.year) : null;
    if (year !== null && (!Number.isInteger(year) || year < 1950 || year > 2100)) { setError(t("سنة الصنع غير صحيحة")); return; }
    const odometer = Number(form.odometer || 0);
    if (!Number.isFinite(odometer) || odometer < 0) { setError(t("قراءة العداد غير صحيحة")); return; }
    const capacity = form.fuelCapacity.trim() ? Number(form.fuelCapacity) : null;
    if (capacity !== null && !(capacity > 0)) { setError(t("سعة الخزان يجب أن تكون أكبر من صفر")); return; }
    const payload: Record<string, unknown> = {
      plate_number: form.plate.trim(), make: form.make.trim(), model: form.model.trim() || null, manufacture_year: year,
      vin: form.vin.trim() || null, color: form.color.trim() || null, vehicle_type: form.type, fuel_type: form.fuelType,
      ownership: form.ownership, status: form.status, fuel_capacity: capacity, branch_id: form.branchId || null,
      cost_center_id: form.costCenterId || null, fixed_asset_id: form.fixedAssetId || null,
      assigned_driver_id: form.driverId || null, notes: form.notes.trim() || null,
    };
    // العداد الافتتاحي فقط؛ العداد الحالي تحسبه القاعدة = أعلى قيمة بينه وبين قراءات الرحلات والوقود والصيانة
    payload.opening_odometer = odometer;
    setBusy(true);
    setError("");
    const { error: saveError } = editingId
      ? await supabase.from("fleet_vehicles").update(payload).eq("id", editingId)
      : await supabase.from("fleet_vehicles").insert(payload);
    setBusy(false);
    if (saveError) { setError(t(fleetErrorText(saveError.message))); return; }
    toast({ title: t(editingId ? "تم تحديث المركبة" : "تمت إضافة المركبة") });
    reset();
    await load();
  };

  const remove = async (vehicle: FleetVehicle) => {
    if (!confirm(t("هل تريد حذف المركبة؟ المركبة التي لها حركات لا تُحذف، غيّر حالتها إلى «مستبعدة» بدلًا من ذلك."))) return;
    setBusy(true);
    const { error: deleteError } = await supabase.from("fleet_vehicles").delete().eq("id", vehicle.id);
    setBusy(false);
    if (deleteError) { toast({ title: t("تعذر حذف المركبة"), description: t(fleetErrorText(deleteError.message)), variant: "destructive" }); return; }
    toast({ title: t("تم حذف المركبة") });
    if (editingId === vehicle.id) reset();
    await load();
  };

  const currentAsset = editingId ? valueByVehicle.get(editingId) : undefined;
  const assetChoices = currentAsset && form.fixedAssetId && !assetOptions.some((option) => option.value === form.fixedAssetId)
    ? [{ value: form.fixedAssetId, label: currentAsset.assetNumber }, ...assetOptions]
    : assetOptions;
  const activeDrivers = drivers.filter((driver) => driver.status === "active" || driver.id === form.driverId);
  const money = (value: number) => formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const input = "mt-1 h-10 w-full rounded border px-3 text-sm";
  const select = "mt-1 h-10 w-full rounded border bg-white px-2 text-sm";

  return (
    <Layout>
      <main dir={direction} className="space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-sky-50 p-2 text-sky-700"><Truck className="h-6 w-6" /></div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{t("السيارات والمركبات")}</h1>
              <p className="mt-1 text-sm text-slate-500">{t("سجل المركبات وحالتها وعدادها والسائق المعيّن، مع ربطها بالأصل الثابت ومركز التكلفة.")}</p>
            </div>
          </div>
          {canManage && <button onClick={startNew} className="inline-flex items-center gap-2 rounded bg-sky-700 px-4 py-2 text-sm font-semibold text-white"><Plus className="h-4 w-4" />{t("مركبة جديدة")}</button>}
        </header>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {counts.map((status) => (
            <button key={status.value} onClick={() => setStatusFilter((current) => current === status.value ? "" : status.value)} className={`rounded-xl border bg-white p-4 text-start shadow-sm ${statusFilter === status.value ? "ring-2 ring-sky-600" : ""}`}>
              <p className="text-xs text-slate-500">{t(status.label)}</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{formatNumber(status.count)}</p>
            </button>
          ))}
        </div>

        {error && <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        {editingId !== undefined && (
          <section className="rounded-xl border bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-bold">{t(editingId ? "تعديل المركبة" : "مركبة جديدة")}</h2>
              <button onClick={reset}><X className="h-5 w-5" /></button>
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <label className="text-xs text-slate-600">{t("رقم اللوحة")} *<input value={form.plate} onChange={(event) => update("plate")(event.target.value)} className={input} placeholder="أ ب ج 1234" /></label>
              <label className="text-xs text-slate-600">{t("الشركة المصنعة")} *<input value={form.make} onChange={(event) => update("make")(event.target.value)} className={input} /></label>
              <label className="text-xs text-slate-600">{t("الطراز")}<input value={form.model} onChange={(event) => update("model")(event.target.value)} className={input} /></label>
              <label className="text-xs text-slate-600">{t("سنة الصنع")}<input type="number" value={form.year} onChange={(event) => update("year")(event.target.value)} className={input} /></label>
              <label className="text-xs text-slate-600">{t("نوع المركبة")}<select value={form.type} onChange={(event) => update("type")(event.target.value)} className={select}>{VEHICLE_TYPES.map((option) => <option key={option.value} value={option.value}>{t(option.label)}</option>)}</select></label>
              <label className="text-xs text-slate-600">{t("نوع الوقود")}<select value={form.fuelType} onChange={(event) => update("fuelType")(event.target.value)} className={select}>{FUEL_TYPES.map((option) => <option key={option.value} value={option.value}>{t(option.label)}</option>)}</select></label>
              <label className="text-xs text-slate-600">{t("الملكية")}<select value={form.ownership} onChange={(event) => update("ownership")(event.target.value)} className={select}>{OWNERSHIP_TYPES.map((option) => <option key={option.value} value={option.value}>{t(option.label)}</option>)}</select></label>
              <label className="text-xs text-slate-600">{t("الحالة")}<select value={form.status} onChange={(event) => update("status")(event.target.value)} className={select}>{VEHICLE_STATUSES.map((option) => <option key={option.value} value={option.value}>{t(option.label)}</option>)}</select></label>
              <label className="text-xs text-slate-600">{t("العداد عند التسجيل (كم)")}<input type="number" min="0" value={form.odometer} onChange={(event) => update("odometer")(event.target.value)} className={input} />
                {editingId && <span className="mt-1 block text-[11px] text-slate-500">{t("العداد الحالي")}: {formatNumber(vehicles.find((vehicle) => vehicle.id === editingId)?.odometer ?? 0)}</span>}
              </label>
              <label className="text-xs text-slate-600">{t("سعة الخزان (لتر)")}<input type="number" min="0" value={form.fuelCapacity} onChange={(event) => update("fuelCapacity")(event.target.value)} className={input} /></label>
              <label className="text-xs text-slate-600">{t("رقم الهيكل (VIN)")}<input value={form.vin} onChange={(event) => update("vin")(event.target.value)} className={`${input} font-mono`} /></label>
              <label className="text-xs text-slate-600">{t("اللون")}<input value={form.color} onChange={(event) => update("color")(event.target.value)} className={input} /></label>
              <label className="text-xs text-slate-600">{t("الفرع")}<select value={form.branchId} onChange={(event) => update("branchId")(event.target.value)} className={select}><option value="">{t("بدون")}</option>{branches.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <label className="text-xs text-slate-600">{t("مركز التكلفة")}<select value={form.costCenterId} onChange={(event) => update("costCenterId")(event.target.value)} className={select}><option value="">{t("بدون")}</option>{costCenters.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <label className="text-xs text-slate-600">{t("السائق المعيّن")}<select value={form.driverId} onChange={(event) => update("driverId")(event.target.value)} className={select}><option value="">{t("بدون")}</option>{activeDrivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.name} ({driver.employeeNumber})</option>)}</select></label>
              <label className="text-xs text-slate-600">{t("الأصل الثابت (للإهلاك)")}<select value={form.fixedAssetId} onChange={(event) => update("fixedAssetId")(event.target.value)} className={select}><option value="">{t("غير مربوطة")}</option>{assetChoices.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <label className="text-xs text-slate-600 md:col-span-4">{t("ملاحظات")}<input value={form.notes} onChange={(event) => update("notes")(event.target.value)} className={input} /></label>
            </div>
            <p className="mt-3 text-xs text-slate-500">{t("العداد الحالي يُحسب تلقائيًا: أعلى قيمة بين عداد التسجيل وقراءات الرحلات والوقود والصيانة المنفذة؛ تصحيح قراءة خاطئة يكون بتعديل الحركة نفسها. تكلفة المركبة وإهلاكها يُسجلان في وحدة الأصول الثابتة، واربطها هنا بسجل الأصل.")}</p>
            <div className="mt-4 flex justify-end">
              <button disabled={busy} onClick={() => void save()} className="inline-flex items-center gap-2 rounded bg-sky-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{t("حفظ")}</button>
            </div>
          </section>
        )}

        <section className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-2 border-b bg-slate-50 px-4 py-3">
            <div className="relative w-full max-w-xs">
              <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("ابحث باللوحة أو الرقم أو الطراز")} className="h-9 w-full rounded border bg-white ps-9 pe-3 text-sm" />
            </div>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-9 rounded border bg-white px-2 text-sm"><option value="">{t("كل الحالات")}</option>{VEHICLE_STATUSES.map((option) => <option key={option.value} value={option.value}>{t(option.label)}</option>)}</select>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="p-3">{t("الرقم")}</th><th className="p-3">{t("اللوحة")}</th><th className="p-3">{t("المركبة")}</th><th className="p-3">{t("النوع")}</th>
                  <th className="p-3">{t("العداد")}</th><th className="p-3">{t("السائق")}</th><th className="p-3">{t("القيمة الدفترية")}</th><th className="p-3">{t("الحالة")}</th><th className="p-3">{t("الإجراءات")}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? <tr><td colSpan={9} className="py-14 text-center">{t("جاري التحميل...")}</td></tr>
                  : visibleVehicles.length === 0 ? <tr><td colSpan={9} className="py-14 text-center text-slate-400">{t("لا توجد مركبات")}</td></tr>
                  : visibleVehicles.map((vehicle) => {
                    const value = valueByVehicle.get(vehicle.id);
                    return (
                      <tr key={vehicle.id} className="border-t">
                        <td className="p-3 font-mono">{vehicle.number}</td>
                        <td className="p-3 text-center font-semibold">{vehicle.plate}</td>
                        <td className="p-3 text-center">{vehicle.make} {vehicle.model} {vehicle.year ?? ""}</td>
                        <td className="p-3 text-center">{t(optionLabel(VEHICLE_TYPES, vehicle.type))}</td>
                        <td className="p-3 text-center">{formatNumber(vehicle.odometer)}</td>
                        <td className="p-3 text-center">{driverById.get(vehicle.driverId)?.name ?? "—"}</td>
                        <td className="p-3 text-center">{value ? <span title={`${value.assetNumber}: ${t("التكلفة")} ${money(value.cost)} − ${t("مجمع الإهلاك")} ${money(value.accumulated)}`}>{money(value.bookValue)}</span> : "—"}</td>
                        <td className="p-3 text-center"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${STATUS_CLASS[vehicle.status] ?? "bg-slate-100"}`}>{t(optionLabel(VEHICLE_STATUSES, vehicle.status))}</span></td>
                        <td className="p-3">
                          {canManage && <div className="flex justify-center gap-1">
                            <button disabled={busy} onClick={() => startEdit(vehicle)} className="rounded border p-2 text-sky-700" title={t("تعديل")}><Edit3 className="h-4 w-4" /></button>
                            <button disabled={busy} onClick={() => void remove(vehicle)} className="rounded border p-2 text-red-600" title={t("حذف")}><Trash2 className="h-4 w-4" /></button>
                          </div>}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </Layout>
  );
}
