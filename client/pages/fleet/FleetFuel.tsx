import { useEffect, useMemo, useState } from "react";
import { Edit3, Fuel, Loader2, Plus, Save, Search, Trash2, X } from "lucide-react";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { canManagePerm } from "@/lib/authSession";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import { selectAllRows } from "@/lib/ledgerData";
import {
  VEHICLE_STATUSES, fleetErrorText, fleetToday, loadFleetDrivers, loadFleetVehicles, loadPurchaseInvoiceOptions, nullableNumber,
  numberOf, optionLabel, vehicleLabel, type FleetDriver, type FleetVehicle, type PurchaseInvoiceOption,
} from "@/lib/fleet";

type FuelLog = {
  id: string; number: string; vehicleId: string; driverId: string; date: string; liters: number; amount: number;
  odometer: number | null; station: string; fullTank: boolean; invoiceId: string; notes: string;
};
type Form = {
  vehicleId: string; driverId: string; date: string; liters: string; amount: string; odometer: string; station: string;
  fullTank: boolean; invoiceId: string; notes: string;
};

const newForm = (): Form => ({
  vehicleId: "", driverId: "", date: fleetToday(), liters: "", amount: "", odometer: "", station: "", fullTank: true, invoiceId: "", notes: "",
});

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const round2 = (value: number) => Math.round(value * 100) / 100;

const mapLog = (row: Record<string, unknown>): FuelLog => ({
  id: String(row.id),
  number: String(row.fuel_number ?? ""),
  vehicleId: String(row.vehicle_id ?? ""),
  driverId: String(row.driver_id ?? ""),
  date: String(row.fuel_date ?? ""),
  liters: numberOf(row.liters),
  amount: numberOf(row.amount),
  odometer: row.odometer === null || row.odometer === undefined ? null : numberOf(row.odometer),
  station: String(row.station ?? ""),
  fullTank: row.full_tank !== false,
  invoiceId: String(row.purchase_invoice_id ?? ""),
  notes: String(row.notes ?? ""),
});

/**
 * الاستهلاك (كم/لتر) لكل تعبئة كاملة، لكل مركبة بترتيب العداد:
 * المسافة منذ التعبئة الكاملة السابقة ÷ لترات التعبئات بعدها حتى هذه التعبئة (شاملة).
 * لا يُحسب إن لم توجد تعبئة كاملة سابقة، أو وُجدت بينهما تعبئة بلا قراءة عداد (لتراتها لا يمكن ترتيبها فتكون الكمية ناقصة).
 */
function computeConsumption(logs: FuelLog[]): Map<string, number> {
  const result = new Map<string, number>();
  const byVehicle = new Map<string, FuelLog[]>();
  logs.forEach((log) => {
    const list = byVehicle.get(log.vehicleId);
    if (list) list.push(log); else byVehicle.set(log.vehicleId, [log]);
  });
  byVehicle.forEach((vehicleLogs) => {
    const unmeasured = vehicleLogs.filter((log) => log.odometer === null);
    const measured = vehicleLogs
      .filter((log) => log.odometer !== null)
      .sort((a, b) => a.odometer - b.odometer || a.date.localeCompare(b.date) || a.number.localeCompare(b.number) || a.id.localeCompare(b.id));
    let previousFull: FuelLog | null = null;
    let litersSince = 0;
    measured.forEach((log) => {
      litersSince += log.liters;
      if (!log.fullTank) return;
      if (previousFull) {
        const distance = log.odometer - previousFull.odometer;
        const from = previousFull.date;
        const gap = unmeasured.some((other) => other.date >= from && other.date <= log.date);
        if (distance > 0 && litersSince > 0 && !gap) result.set(log.id, distance / litersSince);
      }
      previousFull = log;
      litersSince = 0;
    });
  });
  return result;
}

export default function FleetFuel() {
  const { t, direction, formatNumber } = useI18n();
  const { permissions } = useRolePermissions();
  const canManage = canManagePerm(permissions, "fleet.fuel", "module.fleet");
  const [logs, setLogs] = useState<FuelLog[]>([]);
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [drivers, setDrivers] = useState<FleetDriver[]>([]);
  const [invoices, setInvoices] = useState<PurchaseInvoiceOption[]>([]);
  const [invoiceError, setInvoiceError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [vehicleFilter, setVehicleFilter] = useState("");
  const [driverFilter, setDriverFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [editingId, setEditingId] = useState<string | null | undefined>(undefined);
  const [form, setForm] = useState<Form>(newForm);

  const load = async () => {
    setLoading(true);
    setError("");
    const [logResult, vehicleResult, driverResult] = await Promise.all([
      selectAllRows((from, to) => supabase.from("fleet_fuel_logs").select("*").order("fuel_date", { ascending: false }).order("id").range(from, to)),
      loadFleetVehicles(),
      loadFleetDrivers(),
    ]);
    const firstError = logResult.error ?? vehicleResult.error ?? driverResult.error;
    if (firstError) { setError(t(fleetErrorText(firstError.message))); setLoading(false); return; }
    setLogs(logResult.data.map((row: Record<string, unknown>) => mapLog(row)));
    setVehicles(vehicleResult.data);
    setDrivers(driverResult.data);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  // فواتير المشتريات المرحّلة تُجلب عند فتح النموذج حتى يكون المتاح للربط محدّثًا
  const loadInvoices = async () => {
    setInvoiceError("");
    const result = await loadPurchaseInvoiceOptions();
    setInvoices(result.data);
    if (result.error) setInvoiceError(t(fleetErrorText(result.error)));
  };

  const money = (value: number) => formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const litersText = (value: number) => formatNumber(value, { maximumFractionDigits: 2 });
  const month = fleetToday().slice(0, 7);
  const vehicleById = useMemo(() => new Map(vehicles.map((vehicle) => [vehicle.id, vehicle])), [vehicles]);
  const driverById = useMemo(() => new Map(drivers.map((driver) => [driver.id, driver])), [drivers]);
  const consumptionById = useMemo(() => computeConsumption(logs), [logs]);
  const editingLog = editingId ? logs.find((log) => log.id === editingId) : undefined;

  const monthLogs = logs.filter((log) => log.date.startsWith(month));
  const monthLiters = monthLogs.reduce((sum, log) => sum + log.liters, 0);
  const monthCost = monthLogs.reduce((sum, log) => sum + log.amount, 0);

  const visibleLogs = logs.filter((log) => {
    const text = `${log.number} ${log.station} ${log.invoiceId} ${log.notes}`.toLowerCase();
    return (!search.trim() || text.includes(search.trim().toLowerCase()))
      && (!vehicleFilter || log.vehicleId === vehicleFilter)
      && (!driverFilter || log.driverId === driverFilter)
      && (!dateFrom || log.date >= dateFrom)
      && (!dateTo || log.date <= dateTo);
  });
  const visibleLiters = visibleLogs.reduce((sum, log) => sum + log.liters, 0);
  const visibleCost = visibleLogs.reduce((sum, log) => sum + log.amount, 0);
  const hasFilters = Boolean(search || vehicleFilter || driverFilter || dateFrom || dateTo);
  const clearFilters = () => { setSearch(""); setVehicleFilter(""); setDriverFilter(""); setDateFrom(""); setDateTo(""); };

  const update = (key: Exclude<keyof Form, "fullTank">) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  // عند اختيار المركبة يُقترح سائقها المعيّن إن كان نشطًا ولم يُختر سائق بعد
  const changeVehicle = (vehicleId: string) => setForm((current) => {
    const assigned = vehicleById.get(vehicleId)?.driverId ?? "";
    const assignedActive = Boolean(assigned) && driverById.get(assigned)?.status === "active";
    return { ...current, vehicleId, driverId: current.driverId || (assignedActive ? assigned : "") };
  });
  const reset = () => { setEditingId(undefined); setForm(newForm()); setError(""); };
  const startNew = () => { reset(); setEditingId(null); void loadInvoices(); };
  const startEdit = (log: FuelLog) => {
    setEditingId(log.id);
    setForm({
      vehicleId: log.vehicleId, driverId: log.driverId, date: log.date, liters: String(log.liters), amount: String(log.amount),
      odometer: log.odometer === null ? "" : String(log.odometer), station: log.station, fullTank: log.fullTank, invoiceId: log.invoiceId, notes: log.notes,
    });
    setError("");
    void loadInvoices();
  };

  // المتاح للربط = صافي الفاتورة قبل الضريبة − المربوط سابقًا (+ مبلغ هذه التعبئة نفسها عند تعديلها على الفاتورة ذاتها)
  const invoiceAvailable = (invoice: PurchaseInvoiceOption) =>
    round2(invoice.subtotal - invoice.linkedAmount + (editingLog && editingLog.invoiceId === invoice.id ? editingLog.amount : 0));
  const invoiceChoices = invoices
    .filter((invoice) => invoiceAvailable(invoice) > 0 || invoice.id === form.invoiceId)
    .map((invoice) => ({ value: invoice.id, label: `${invoice.id} — ${invoice.vendor} — ${t("متاح")} ${money(invoiceAvailable(invoice))}` }));
  if (form.invoiceId && !invoiceChoices.some((choice) => choice.value === form.invoiceId)) invoiceChoices.unshift({ value: form.invoiceId, label: form.invoiceId });
  const invoiceLimitError = (amount: number) => {
    const invoice = form.invoiceId ? invoices.find((item) => item.id === form.invoiceId) : undefined;
    if (!invoice) return "";
    const available = invoiceAvailable(invoice);
    return amount > available + 0.001 ? `${t("التكلفة أكبر من المتاح للربط في فاتورة المشتريات المختارة")} (${money(available)})` : "";
  };

  const save = async () => {
    if (!form.vehicleId) { setError(t("اختر المركبة")); return; }
    if (!DATE_PATTERN.test(form.date)) { setError(t("أدخل تاريخ التعبئة")); return; }
    if (form.date > fleetToday()) { setError(t("لا يمكن تسجيل حركة بتاريخ مستقبلي.")); return; }
    const liters = Number(form.liters);
    if (!form.liters.trim() || !Number.isFinite(liters) || liters <= 0) { setError(t("الكمية باللتر يجب أن تكون أكبر من صفر")); return; }
    const amount = Number(form.amount || 0);
    if (!Number.isFinite(amount) || amount < 0) { setError(t("التكلفة غير صحيحة")); return; }
    const odometer = nullableNumber(form.odometer);
    if (odometer !== null && (!Number.isFinite(odometer) || odometer < 0)) { setError(t("قراءة العداد غير صحيحة")); return; }
    const limitError = invoiceLimitError(round2(amount));
    if (limitError) { setError(limitError); return; }
    const payload: Record<string, unknown> = {
      vehicle_id: form.vehicleId, driver_id: form.driverId || null, fuel_date: form.date, liters, amount: round2(amount), odometer,
      station: form.station.trim() || null, full_tank: form.fullTank, purchase_invoice_id: form.invoiceId || null, notes: form.notes.trim() || null,
    };
    setBusy(true);
    setError("");
    const { error: saveError } = editingId
      ? await supabase.from("fleet_fuel_logs").update(payload).eq("id", editingId)
      : await supabase.from("fleet_fuel_logs").insert(payload);
    setBusy(false);
    if (saveError) { setError(t(fleetErrorText(saveError.message))); return; }
    toast({ title: t(editingId ? "تم تحديث تعبئة الوقود" : "تمت إضافة تعبئة الوقود") });
    reset();
    await load();
  };

  const remove = async (log: FuelLog) => {
    if (!confirm(t("هل تريد حذف تعبئة الوقود؟"))) return;
    setBusy(true);
    const { error: deleteError } = await supabase.from("fleet_fuel_logs").delete().eq("id", log.id);
    setBusy(false);
    if (deleteError) { toast({ title: t("تعذر حذف تعبئة الوقود"), description: t(fleetErrorText(deleteError.message)), variant: "destructive" }); return; }
    toast({ title: t("تم حذف تعبئة الوقود") });
    if (editingId === log.id) reset();
    await load();
  };

  // المركبات المستبعدة لا تُسجل عليها حركات جديدة؛ تظهر فقط إن كانت مركبة التعبئة الجاري تعديلها
  const vehicleChoices = vehicles.filter((vehicle) => vehicle.status !== "disposed" || vehicle.id === editingLog?.vehicleId);
  const vehicleOptionLabel = (vehicle: FleetVehicle) =>
    `${vehicleLabel(vehicle)}${vehicle.status !== "active" ? ` (${t(optionLabel(VEHICLE_STATUSES, vehicle.status))})` : ""}`;
  const activeDrivers = drivers.filter((driver) => driver.status === "active" || driver.id === editingLog?.driverId);
  const driverOptionLabel = (driver: FleetDriver) => `${driver.name}${driver.employeeNumber ? ` (${driver.employeeNumber})` : ""}`;
  const selectedVehicle = vehicleById.get(form.vehicleId);
  const formLiters = Number(form.liters);
  const formAmount = Number(form.amount || 0);
  const formPrice = Number.isFinite(formLiters) && formLiters > 0 && Number.isFinite(formAmount) ? money(formAmount / formLiters) : "—";
  const input = "mt-1 h-10 w-full rounded border px-3 text-sm";
  const select = "mt-1 h-10 w-full rounded border bg-white px-2 text-sm";

  return (
    <Layout>
      <main dir={direction} className="space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-emerald-50 p-2 text-emerald-700"><Fuel className="h-6 w-6" /></div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{t("الوقود")}</h1>
              <p className="mt-1 text-sm text-slate-500">{t("سجل تعبئة الوقود لكل مركبة وسائق، مع سعر اللتر ومعدل الاستهلاك بين التعبئات الكاملة.")}</p>
            </div>
          </div>
          {canManage && <button onClick={startNew} className="inline-flex items-center gap-2 rounded bg-emerald-700 px-4 py-2 text-sm font-semibold text-white"><Plus className="h-4 w-4" />{t("تعبئة جديدة")}</button>}
        </header>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500">{t("اللترات هذا الشهر")}</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{litersText(monthLiters)}</p>
          </div>
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500">{t("تكلفة الوقود هذا الشهر (قبل الضريبة)")}</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{money(monthCost)}</p>
          </div>
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500">{t("متوسط سعر اللتر هذا الشهر")}</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{monthLiters > 0 ? money(monthCost / monthLiters) : "—"}</p>
          </div>
        </div>

        <p className="rounded border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">{t("التكلفة هنا للمتابعة التشغيلية قبل الضريبة. القيد المحاسبي وضريبة القيمة المضافة يُسجلان مرة واحدة عبر فاتورة المشتريات في وحدة المشتريات، ويُربط السجل بالفاتورة المرحّلة فقط دون قيد مزدوج.")}</p>

        {error && <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        {editingId !== undefined && (
          <section className="rounded-xl border bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-bold">{editingId ? `${t("تعديل تعبئة الوقود")} ${editingLog?.number ?? ""}` : t("تعبئة جديدة")}</h2>
              <button onClick={reset}><X className="h-5 w-5" /></button>
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <label className="text-xs text-slate-600 md:col-span-2">{t("المركبة")} *
                <select value={form.vehicleId} onChange={(event) => changeVehicle(event.target.value)} className={select}>
                  <option value="">{t("اختر المركبة")}</option>
                  {vehicleChoices.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicleOptionLabel(vehicle)}</option>)}
                </select>
              </label>
              <label className="text-xs text-slate-600">{t("السائق")}
                <select value={form.driverId} onChange={(event) => update("driverId")(event.target.value)} className={select}>
                  <option value="">{t("بدون")}</option>
                  {activeDrivers.map((driver) => <option key={driver.id} value={driver.id}>{driverOptionLabel(driver)}</option>)}
                </select>
              </label>
              <label className="text-xs text-slate-600">{t("تاريخ التعبئة")} *<input type="date" max={fleetToday()} value={form.date} onChange={(event) => update("date")(event.target.value)} className={input} /></label>
              <label className="text-xs text-slate-600">{t("الكمية (لتر)")} *<input type="number" min="0" step="any" value={form.liters} onChange={(event) => update("liters")(event.target.value)} className={input} /></label>
              <label className="text-xs text-slate-600">{t("التكلفة قبل الضريبة")}<input type="number" min="0" step="0.01" value={form.amount} onChange={(event) => update("amount")(event.target.value)} className={input} /></label>
              <label className="text-xs text-slate-600">{t("سعر اللتر")}<input value={formPrice} readOnly disabled className={`${input} bg-slate-50`} /></label>
              <label className="text-xs text-slate-600">{t("قراءة العداد (كم)")}
                <input type="number" min="0" value={form.odometer} onChange={(event) => update("odometer")(event.target.value)} className={input} placeholder={selectedVehicle ? `${t("العداد الحالي")}: ${formatNumber(selectedVehicle.odometer)}` : ""} />
              </label>
              <label className="text-xs text-slate-600 md:col-span-2">{t("المحطة")}<input value={form.station} onChange={(event) => update("station")(event.target.value)} className={input} /></label>
              <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700 md:col-span-2">
                <input type="checkbox" checked={form.fullTank} onChange={(event) => setForm((current) => ({ ...current, fullTank: event.target.checked }))} className="h-4 w-4" />
                {t("تعبئة كاملة (خزان ممتلئ)")}
              </label>
              <label className="text-xs text-slate-600 md:col-span-2">{t("فاتورة المشتريات المرحّلة")}
                <select value={form.invoiceId} onChange={(event) => update("invoiceId")(event.target.value)} className={select}>
                  <option value="">{t("غير مربوطة")}</option>
                  {invoiceChoices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
                </select>
                {invoiceError && <span className="mt-1 block text-[11px] text-red-600">{invoiceError}</span>}
              </label>
              <label className="text-xs text-slate-600 md:col-span-2">{t("ملاحظات")}<input value={form.notes} onChange={(event) => update("notes")(event.target.value)} className={input} /></label>
            </div>
            <p className="mt-3 text-xs text-slate-500">{t("قراءة العداد تحدّث عداد المركبة تلقائيًا. معدل الاستهلاك يُحسب بين تعبئتين كاملتين لهما قراءة عداد.")}</p>
            <div className="mt-4 flex justify-end">
              <button disabled={busy} onClick={() => void save()} className="inline-flex items-center gap-2 rounded bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{t("حفظ")}</button>
            </div>
          </section>
        )}

        <section className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-2 border-b bg-slate-50 px-4 py-3">
            <div className="relative w-full max-w-xs">
              <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("ابحث بالرقم أو المحطة")} className="h-9 w-full rounded border bg-white ps-9 pe-3 text-sm" />
            </div>
            <select value={vehicleFilter} onChange={(event) => setVehicleFilter(event.target.value)} className="h-9 rounded border bg-white px-2 text-sm"><option value="">{t("كل المركبات")}</option>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicleLabel(vehicle)}</option>)}</select>
            <select value={driverFilter} onChange={(event) => setDriverFilter(event.target.value)} className="h-9 rounded border bg-white px-2 text-sm"><option value="">{t("كل السائقين")}</option>{drivers.map((driver) => <option key={driver.id} value={driver.id}>{driverOptionLabel(driver)}</option>)}</select>
            <label className="flex items-center gap-1 text-xs text-slate-600">{t("من")}<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="h-9 rounded border bg-white px-2 text-sm" /></label>
            <label className="flex items-center gap-1 text-xs text-slate-600">{t("إلى")}<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="h-9 rounded border bg-white px-2 text-sm" /></label>
            {hasFilters && <button onClick={clearFilters} className="h-9 rounded border bg-white px-3 text-xs text-slate-600">{t("مسح الفلاتر")}</button>}
            <span className="ms-auto text-xs text-slate-600">{t("اللترات")}: <b>{litersText(visibleLiters)}</b> — {t("التكلفة")}: <b>{money(visibleCost)}</b></span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="p-3">{t("الرقم")}</th><th className="p-3">{t("التاريخ")}</th><th className="p-3">{t("المركبة")}</th><th className="p-3">{t("السائق")}</th>
                  <th className="p-3">{t("اللترات")}</th><th className="p-3">{t("التكلفة قبل الضريبة")}</th><th className="p-3">{t("سعر اللتر")}</th><th className="p-3">{t("العداد")}</th>
                  <th className="p-3">{t("الاستهلاك")}</th><th className="p-3">{t("فاتورة المشتريات")}</th><th className="p-3">{t("الإجراءات")}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? <tr><td colSpan={11} className="py-14 text-center">{t("جاري التحميل...")}</td></tr>
                  : visibleLogs.length === 0 ? <tr><td colSpan={11} className="py-14 text-center text-slate-400">{t("لا توجد تعبئات وقود")}</td></tr>
                  : visibleLogs.map((log) => {
                    const consumption = consumptionById.get(log.id);
                    return (
                      <tr key={log.id} className="border-t">
                        <td className="p-3 font-mono">{log.number}</td>
                        <td className="p-3 text-center">{log.date}</td>
                        <td className="p-3 text-center">
                          <span className="font-semibold">{vehicleLabel(vehicleById.get(log.vehicleId))}</span>
                          {log.station && <div className="text-xs text-slate-500">{log.station}</div>}
                        </td>
                        <td className="p-3 text-center">{driverById.get(log.driverId)?.name ?? "—"}</td>
                        <td className="p-3 text-center">
                          {litersText(log.liters)}
                          <span className={`ms-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${log.fullTank ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{t(log.fullTank ? "كاملة" : "جزئية")}</span>
                        </td>
                        <td className="p-3 text-center">{money(log.amount)}</td>
                        <td className="p-3 text-center">{log.liters > 0 ? money(log.amount / log.liters) : "—"}</td>
                        <td className="p-3 text-center">{log.odometer === null ? "—" : formatNumber(log.odometer)}</td>
                        <td className="p-3 text-center">{consumption === undefined ? "—" : `${formatNumber(consumption, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${t("كم/لتر")}`}</td>
                        <td className="p-3 text-center font-mono text-xs">{log.invoiceId || "—"}</td>
                        <td className="p-3">
                          {canManage && <div className="flex justify-center gap-1">
                            <button disabled={busy} onClick={() => startEdit(log)} className="rounded border p-2 text-emerald-700" title={t("تعديل")}><Edit3 className="h-4 w-4" /></button>
                            <button disabled={busy} onClick={() => void remove(log)} className="rounded border p-2 text-red-600" title={t("حذف")}><Trash2 className="h-4 w-4" /></button>
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
