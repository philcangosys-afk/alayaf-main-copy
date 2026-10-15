import { useEffect, useMemo, useState } from "react";
import { Edit3, IdCard, Loader2, Plus, Save, Search, Trash2, X } from "lucide-react";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { canManagePerm } from "@/lib/authSession";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import { LICENSE_TYPES, expiryState, fleetErrorText, loadFleetDrivers, loadFleetVehicles, optionLabel, type FleetDriver, type FleetVehicle } from "@/lib/fleet";

type Candidate = { id: string; empId: string; name: string; department: string };
type Form = { employeeId: string; licenseNumber: string; licenseType: string; licenseExpiry: string; phone: string; status: string; notes: string };
const emptyForm: Form = { employeeId: "", licenseNumber: "", licenseType: "private", licenseExpiry: "", phone: "", status: "active", notes: "" };

export default function FleetDrivers() {
  const { t, direction, formatNumber } = useI18n();
  const { permissions } = useRolePermissions();
  const canManage = canManagePerm(permissions, "fleet.drivers", "module.fleet");
  const [drivers, setDrivers] = useState<FleetDriver[]>([]);
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null | undefined>(undefined);
  const [form, setForm] = useState<Form>(emptyForm);

  const load = async () => {
    setLoading(true);
    setError("");
    const [driverResult, vehicleResult] = await Promise.all([loadFleetDrivers(), loadFleetVehicles()]);
    const firstError = driverResult.error ?? vehicleResult.error;
    if (firstError) { setError(t(fleetErrorText(firstError.message))); setLoading(false); return; }
    setDrivers(driverResult.data);
    setVehicles(vehicleResult.data);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const loadCandidates = async () => {
    const { data, error: candidateError } = await supabase.rpc("fleet_driver_candidates");
    if (candidateError) { setError(t(fleetErrorText(candidateError.message))); return; }
    setCandidates(((data ?? []) as Record<string, unknown>[]).map((row) => ({ id: String(row.id), empId: String(row.emp_id ?? ""), name: String(row.name ?? ""), department: String(row.department ?? "") })));
  };

  const vehiclesByDriver = useMemo(() => {
    const map = new Map<string, FleetVehicle[]>();
    vehicles.forEach((vehicle) => { if (vehicle.driverId) map.set(vehicle.driverId, [...(map.get(vehicle.driverId) ?? []), vehicle]); });
    return map;
  }, [vehicles]);
  const registeredEmployees = new Set(drivers.map((driver) => driver.employeeId));
  const availableCandidates = candidates.filter((candidate) => !registeredEmployees.has(candidate.id) || candidate.id === form.employeeId);
  const visibleDrivers = drivers.filter((driver) => !search.trim() || `${driver.name} ${driver.employeeNumber} ${driver.licenseNumber} ${driver.phone}`.toLowerCase().includes(search.trim().toLowerCase()));
  const expiringCount = drivers.filter((driver) => driver.status === "active" && (expiryState(driver.licenseExpiry).days ?? 999) <= 30).length;

  const update = (key: keyof Form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  const reset = () => { setEditingId(undefined); setForm(emptyForm); setError(""); };
  const startNew = () => { reset(); setEditingId(null); void loadCandidates(); };
  const startEdit = (driver: FleetDriver) => {
    setEditingId(driver.id);
    setForm({ employeeId: driver.employeeId, licenseNumber: driver.licenseNumber, licenseType: driver.licenseType, licenseExpiry: driver.licenseExpiry, phone: driver.phone, status: driver.status, notes: driver.notes });
    setError("");
  };

  const save = async () => {
    if (!editingId && !form.employeeId) { setError(t("اختر الموظف")); return; }
    if (!form.licenseNumber.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(form.licenseExpiry)) { setError(t("أدخل رقم الرخصة وتاريخ انتهائها")); return; }
    const payload: Record<string, unknown> = {
      license_number: form.licenseNumber.trim(), license_type: form.licenseType, license_expiry: form.licenseExpiry,
      phone: form.phone.trim() || null, status: form.status, notes: form.notes.trim() || null,
    };
    if (!editingId) {
      const candidate = candidates.find((item) => item.id === form.employeeId);
      payload.employee_id = form.employeeId;
      payload.driver_name = candidate?.name ?? "—";
    }
    setBusy(true);
    setError("");
    const { error: saveError } = editingId
      ? await supabase.from("fleet_drivers").update(payload).eq("id", editingId)
      : await supabase.from("fleet_drivers").insert(payload);
    setBusy(false);
    if (saveError) { setError(t(fleetErrorText(saveError.message))); return; }
    toast({ title: t(editingId ? "تم تحديث السائق" : "تمت إضافة السائق") });
    reset();
    await load();
  };

  const remove = async (driver: FleetDriver) => {
    if (!confirm(t("هل تريد حذف السائق؟ السائق الذي له رحلات أو تعبئة وقود لا يُحذف، غيّر حالته إلى غير نشط."))) return;
    setBusy(true);
    const { error: deleteError } = await supabase.from("fleet_drivers").delete().eq("id", driver.id);
    setBusy(false);
    if (deleteError) { toast({ title: t("تعذر حذف السائق"), description: t(fleetErrorText(deleteError.message)), variant: "destructive" }); return; }
    toast({ title: t("تم حذف السائق") });
    if (editingId === driver.id) reset();
    await load();
  };

  const input = "mt-1 h-10 w-full rounded border px-3 text-sm";
  const select = "mt-1 h-10 w-full rounded border bg-white px-2 text-sm";

  return (
    <Layout>
      <main dir={direction} className="space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-indigo-50 p-2 text-indigo-700"><IdCard className="h-6 w-6" /></div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{t("السائقون")}</h1>
              <p className="mt-1 text-sm text-slate-500">{t("السائقون من موظفي الشركة، مع بيانات الرخصة وتنبيه انتهائها.")}</p>
            </div>
          </div>
          {canManage && <button onClick={startNew} className="inline-flex items-center gap-2 rounded bg-indigo-700 px-4 py-2 text-sm font-semibold text-white"><Plus className="h-4 w-4" />{t("سائق جديد")}</button>}
        </header>

        {expiringCount > 0 && <div className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">{t("رخص سائقين منتهية أو تنتهي خلال 30 يومًا")}: <b>{formatNumber(expiringCount)}</b></div>}
        {error && <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        {editingId !== undefined && (
          <section className="rounded-xl border bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-bold">{t(editingId ? "تعديل السائق" : "سائق جديد")}</h2>
              <button onClick={reset}><X className="h-5 w-5" /></button>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="text-xs text-slate-600">{t("الموظف")} *
                {editingId
                  ? <input value={drivers.find((driver) => driver.id === editingId)?.name ?? ""} disabled className={`${input} bg-slate-50`} />
                  : <select value={form.employeeId} onChange={(event) => update("employeeId")(event.target.value)} className={select}>
                      <option value="">{t("اختر الموظف")}</option>
                      {availableCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.empId} — {candidate.name}{candidate.department ? ` (${candidate.department})` : ""}</option>)}
                    </select>}
              </label>
              <label className="text-xs text-slate-600">{t("رقم الرخصة")} *<input value={form.licenseNumber} onChange={(event) => update("licenseNumber")(event.target.value)} className={`${input} font-mono`} /></label>
              <label className="text-xs text-slate-600">{t("نوع الرخصة")}<select value={form.licenseType} onChange={(event) => update("licenseType")(event.target.value)} className={select}>{LICENSE_TYPES.map((option) => <option key={option.value} value={option.value}>{t(option.label)}</option>)}</select></label>
              <label className="text-xs text-slate-600">{t("تاريخ انتهاء الرخصة")} *<input type="date" value={form.licenseExpiry} onChange={(event) => update("licenseExpiry")(event.target.value)} className={input} /></label>
              <label className="text-xs text-slate-600">{t("الجوال")}<input value={form.phone} onChange={(event) => update("phone")(event.target.value)} className={input} /></label>
              <label className="text-xs text-slate-600">{t("الحالة")}<select value={form.status} onChange={(event) => update("status")(event.target.value)} className={select}><option value="active">{t("نشط")}</option><option value="inactive">{t("غير نشط")}</option></select></label>
              <label className="text-xs text-slate-600 md:col-span-3">{t("ملاحظات")}<input value={form.notes} onChange={(event) => update("notes")(event.target.value)} className={input} /></label>
            </div>
            <div className="mt-4 flex justify-end">
              <button disabled={busy} onClick={() => void save()} className="inline-flex items-center gap-2 rounded bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{t("حفظ")}</button>
            </div>
          </section>
        )}

        <section className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <div className="border-b bg-slate-50 px-4 py-3">
            <div className="relative w-full max-w-xs">
              <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("ابحث بالاسم أو الرقم الوظيفي أو الرخصة")} className="h-9 w-full rounded border bg-white ps-9 pe-3 text-sm" />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="p-3">{t("السائق")}</th><th className="p-3">{t("الرقم الوظيفي")}</th><th className="p-3">{t("رقم الرخصة")}</th><th className="p-3">{t("نوع الرخصة")}</th>
                  <th className="p-3">{t("انتهاء الرخصة")}</th><th className="p-3">{t("الجوال")}</th><th className="p-3">{t("المركبات المعيّنة")}</th><th className="p-3">{t("الحالة")}</th><th className="p-3">{t("الإجراءات")}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? <tr><td colSpan={9} className="py-14 text-center">{t("جاري التحميل...")}</td></tr>
                  : visibleDrivers.length === 0 ? <tr><td colSpan={9} className="py-14 text-center text-slate-400">{t("لا يوجد سائقون")}</td></tr>
                  : visibleDrivers.map((driver) => {
                    const expiry = expiryState(driver.licenseExpiry);
                    return (
                      <tr key={driver.id} className="border-t">
                        <td className="p-3 font-semibold">{driver.name}</td>
                        <td className="p-3 text-center font-mono">{driver.employeeNumber || "—"}</td>
                        <td className="p-3 text-center font-mono">{driver.licenseNumber}</td>
                        <td className="p-3 text-center">{t(optionLabel(LICENSE_TYPES, driver.licenseType))}</td>
                        <td className="p-3 text-center">{driver.licenseExpiry} <span className={`ms-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${expiry.className}`}>{t(expiry.label)}</span></td>
                        <td className="p-3 text-center">{driver.phone || "—"}</td>
                        <td className="p-3 text-center">{(vehiclesByDriver.get(driver.id) ?? []).map((vehicle) => vehicle.plate).join("، ") || "—"}</td>
                        <td className="p-3 text-center"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${driver.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>{t(driver.status === "active" ? "نشط" : "غير نشط")}</span></td>
                        <td className="p-3">
                          {canManage && <div className="flex justify-center gap-1">
                            <button disabled={busy} onClick={() => startEdit(driver)} className="rounded border p-2 text-indigo-700" title={t("تعديل")}><Edit3 className="h-4 w-4" /></button>
                            <button disabled={busy} onClick={() => void remove(driver)} className="rounded border p-2 text-red-600" title={t("حذف")}><Trash2 className="h-4 w-4" /></button>
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
