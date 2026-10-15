import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Edit3, Loader2, Plus, Save, Search, Trash2, Wrench, X } from "lucide-react";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { canManagePerm } from "@/lib/authSession";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import { selectAllRows } from "@/lib/ledgerData";
import {
  MAINTENANCE_STATUSES, MAINTENANCE_TYPES, VEHICLE_STATUSES, daysUntil, expiryState, fleetErrorText, fleetToday, loadFleetVehicles,
  loadPurchaseInvoiceOptions, nullableNumber, numberOf, optionLabel, vehicleLabel, type FleetVehicle, type PurchaseInvoiceOption,
} from "@/lib/fleet";

type MaintenanceRecord = {
  id: string; number: string; vehicleId: string; date: string; type: string; status: string; odometer: number | null;
  description: string; workshop: string; amount: number; invoiceId: string; nextDueDate: string; nextDueOdometer: number | null; notes: string;
};
type Form = {
  vehicleId: string; date: string; type: string; status: string; odometer: string; description: string; workshop: string;
  amount: string; invoiceId: string; nextDueDate: string; nextDueOdometer: string; notes: string;
};

const newForm = (): Form => ({
  vehicleId: "", date: fleetToday(), type: "periodic", status: "completed", odometer: "", description: "", workshop: "",
  amount: "0", invoiceId: "", nextDueDate: "", nextDueOdometer: "", notes: "",
});

const STATUS_CLASS: Record<string, string> = {
  scheduled: "bg-sky-100 text-sky-700",
  completed: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-slate-200 text-slate-600",
};

/** يُنبَّه على الصيانة القادمة بالعداد عندما يتبقى هذا العدد من الكيلومترات أو أقل. */
const KM_WARNING = 1000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const round2 = (value: number) => Math.round(value * 100) / 100;
const nullableValue = (value: unknown) => (value === null || value === undefined ? null : numberOf(value));
const kmClass = (remaining: number) =>
  remaining < 0 ? "bg-red-100 text-red-700" : remaining <= KM_WARNING ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-700";

const mapRecord = (row: Record<string, unknown>): MaintenanceRecord => ({
  id: String(row.id),
  number: String(row.maintenance_number ?? ""),
  vehicleId: String(row.vehicle_id ?? ""),
  date: String(row.maintenance_date ?? ""),
  type: String(row.maintenance_type ?? "other"),
  status: String(row.status ?? "completed"),
  odometer: nullableValue(row.odometer),
  description: String(row.description ?? ""),
  workshop: String(row.workshop ?? ""),
  amount: numberOf(row.amount),
  invoiceId: String(row.purchase_invoice_id ?? ""),
  nextDueDate: String(row.next_due_date ?? ""),
  nextDueOdometer: nullableValue(row.next_due_odometer),
  notes: String(row.notes ?? ""),
});

export default function FleetMaintenance() {
  const { t, direction, formatNumber } = useI18n();
  const { permissions } = useRolePermissions();
  const canManage = canManagePerm(permissions, "fleet.maintenance", "module.fleet");
  const [records, setRecords] = useState<MaintenanceRecord[]>([]);
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [invoices, setInvoices] = useState<PurchaseInvoiceOption[]>([]);
  const [invoiceError, setInvoiceError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [vehicleFilter, setVehicleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [editingId, setEditingId] = useState<string | null | undefined>(undefined);
  const [form, setForm] = useState<Form>(newForm);

  const load = async () => {
    setLoading(true);
    setError("");
    const [recordResult, vehicleResult] = await Promise.all([
      selectAllRows((from, to) => supabase.from("fleet_maintenance").select("*").order("maintenance_date", { ascending: false }).order("id").range(from, to)),
      loadFleetVehicles(),
    ]);
    const firstError = recordResult.error ?? vehicleResult.error;
    if (firstError) { setError(t(fleetErrorText(firstError.message))); setLoading(false); return; }
    setRecords(recordResult.data.map((row: Record<string, unknown>) => mapRecord(row)));
    setVehicles(vehicleResult.data);
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
  const month = fleetToday().slice(0, 7);
  const vehicleById = useMemo(() => new Map(vehicles.map((vehicle) => [vehicle.id, vehicle])), [vehicles]);
  const editingRecord = editingId ? records.find((record) => record.id === editingId) : undefined;

  // الاستحقاق القادم يُتابع من آخر صيانة منفذة لكل مركبة ونوع؛ السجلات الأقدم تجاوزتها صيانة لاحقة
  const openReminderIds = useMemo(() => {
    const latest = new Map<string, MaintenanceRecord>();
    records.forEach((record) => {
      if (record.status !== "completed") return;
      const key = `${record.vehicleId}|${record.type}`;
      const current = latest.get(key);
      const newer = !current
        || record.date > current.date
        || (record.date === current.date && ((record.odometer ?? -1) > (current.odometer ?? -1)
          || ((record.odometer ?? -1) === (current.odometer ?? -1) && record.number > current.number)));
      if (newer) latest.set(key, record);
    });
    return new Set([...latest.values()].filter((record) => record.nextDueDate || record.nextDueOdometer !== null).map((record) => record.id));
  }, [records]);

  const dueOf = (record: MaintenanceRecord) => {
    const vehicle = vehicleById.get(record.vehicleId);
    const date = record.nextDueDate ? expiryState(record.nextDueDate) : null;
    const kmRemaining = record.nextDueOdometer !== null && vehicle ? record.nextDueOdometer - vehicle.odometer : null;
    const urgent = (date !== null && date.days !== null && date.days <= 30) || (kmRemaining !== null && kmRemaining <= KM_WARNING);
    return { date, kmRemaining, urgent };
  };

  const scheduledCount = records.filter((record) => record.status === "scheduled").length;
  const monthCost = records.filter((record) => record.status === "completed" && record.date.startsWith(month)).reduce((sum, record) => sum + record.amount, 0);
  const scheduledDueSoon = (record: MaintenanceRecord) => record.status === "scheduled" && (daysUntil(record.date) ?? 1e9) <= 30;
  const dueSoonCount = records.filter((record) => vehicleById.get(record.vehicleId)?.status !== "disposed"
    && ((openReminderIds.has(record.id) && dueOf(record).urgent) || scheduledDueSoon(record))).length;

  const visibleRecords = records.filter((record) => {
    const text = `${record.number} ${record.description} ${record.workshop} ${record.invoiceId}`.toLowerCase();
    return (!search.trim() || text.includes(search.trim().toLowerCase()))
      && (!vehicleFilter || record.vehicleId === vehicleFilter)
      && (!statusFilter || record.status === statusFilter)
      && (!dateFrom || record.date >= dateFrom)
      && (!dateTo || record.date <= dateTo);
  });
  const visibleCost = visibleRecords.filter((record) => record.status === "completed").reduce((sum, record) => sum + record.amount, 0);
  const hasFilters = Boolean(search || vehicleFilter || statusFilter || dateFrom || dateTo);
  const clearFilters = () => { setSearch(""); setVehicleFilter(""); setStatusFilter(""); setDateFrom(""); setDateTo(""); };

  const update = (key: keyof Form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  const reset = () => { setEditingId(undefined); setForm(newForm()); setError(""); };
  const startNew = () => { reset(); setEditingId(null); void loadInvoices(); };
  const startEdit = (record: MaintenanceRecord) => {
    setEditingId(record.id);
    setForm({
      vehicleId: record.vehicleId, date: record.date, type: record.type, status: record.status,
      odometer: record.odometer === null ? "" : String(record.odometer), description: record.description, workshop: record.workshop,
      amount: String(record.amount), invoiceId: record.invoiceId, nextDueDate: record.nextDueDate,
      nextDueOdometer: record.nextDueOdometer === null ? "" : String(record.nextDueOdometer), notes: record.notes,
    });
    setError("");
    void loadInvoices();
  };

  // المتاح للربط = صافي الفاتورة قبل الضريبة − المربوط سابقًا (+ مبلغ هذا السجل نفسه عند تعديله على الفاتورة ذاتها)
  const invoiceAvailable = (invoice: PurchaseInvoiceOption) =>
    round2(invoice.subtotal - invoice.linkedAmount
      + (editingRecord && editingRecord.invoiceId === invoice.id && editingRecord.status !== "cancelled" ? editingRecord.amount : 0));
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
    if (!DATE_PATTERN.test(form.date)) { setError(t("أدخل تاريخ الصيانة")); return; }
    if (form.status === "completed" && form.date > fleetToday()) { setError(t("لا يمكن أن يكون تاريخ الصيانة المنفذة في المستقبل؛ اجعل حالتها «مجدولة» للمواعيد القادمة.")); return; }
    if (!form.description.trim()) { setError(t("أدخل وصف الصيانة")); return; }
    const odometer = nullableNumber(form.odometer);
    if (odometer !== null && (!Number.isFinite(odometer) || odometer < 0)) { setError(t("قراءة العداد غير صحيحة")); return; }
    const amount = Number(form.amount || 0);
    if (!Number.isFinite(amount) || amount < 0) { setError(t("التكلفة غير صحيحة")); return; }
    if (form.nextDueDate && form.nextDueDate <= form.date) { setError(t("تاريخ الصيانة القادمة يجب أن يكون بعد تاريخ هذه الصيانة")); return; }
    const nextDueOdometer = nullableNumber(form.nextDueOdometer);
    if (nextDueOdometer !== null && (!Number.isFinite(nextDueOdometer) || nextDueOdometer < 0)) { setError(t("عداد الصيانة القادمة غير صحيح")); return; }
    if (nextDueOdometer !== null && odometer !== null && nextDueOdometer <= odometer) { setError(t("عداد الصيانة القادمة يجب أن يكون أكبر من قراءة العداد الحالية")); return; }
    // الصيانة الملغاة لا تُحتسب على الفاتورة المربوطة (كما في قاعدة البيانات)
    const limitError = form.status === "cancelled" ? "" : invoiceLimitError(round2(amount));
    if (limitError) { setError(limitError); return; }
    const payload: Record<string, unknown> = {
      vehicle_id: form.vehicleId, maintenance_date: form.date, maintenance_type: form.type, status: form.status, odometer,
      description: form.description.trim(), workshop: form.workshop.trim() || null, amount: round2(amount),
      purchase_invoice_id: form.invoiceId || null, next_due_date: form.nextDueDate || null, next_due_odometer: nextDueOdometer,
      notes: form.notes.trim() || null,
    };
    setBusy(true);
    setError("");
    const { error: saveError } = editingId
      ? await supabase.from("fleet_maintenance").update(payload).eq("id", editingId)
      : await supabase.from("fleet_maintenance").insert(payload);
    setBusy(false);
    if (saveError) { setError(t(fleetErrorText(saveError.message))); return; }
    toast({ title: t(editingId ? "تم تحديث سجل الصيانة" : "تمت إضافة سجل الصيانة") });
    reset();
    await load();
  };

  // تسجيل صيانة مجدولة كمنفذة؛ إن كان موعدها في المستقبل يصبح تاريخها اليوم
  const markCompleted = async (record: MaintenanceRecord) => {
    const today = fleetToday();
    const payload: Record<string, unknown> = { status: "completed" };
    if (record.date > today) payload.maintenance_date = today;
    setBusy(true);
    const { error: updateError } = await supabase.from("fleet_maintenance").update(payload).eq("id", record.id);
    setBusy(false);
    if (updateError) { toast({ title: t("تعذر تسجيل الصيانة كمنفذة"), description: t(fleetErrorText(updateError.message)), variant: "destructive" }); return; }
    toast({ title: t("تم تسجيل الصيانة كمنفذة") });
    if (editingId === record.id) reset();
    await load();
  };

  const remove = async (record: MaintenanceRecord) => {
    if (!confirm(t("هل تريد حذف سجل الصيانة؟"))) return;
    setBusy(true);
    const { error: deleteError } = await supabase.from("fleet_maintenance").delete().eq("id", record.id);
    setBusy(false);
    if (deleteError) { toast({ title: t("تعذر حذف سجل الصيانة"), description: t(fleetErrorText(deleteError.message)), variant: "destructive" }); return; }
    toast({ title: t("تم حذف سجل الصيانة") });
    if (editingId === record.id) reset();
    await load();
  };

  // المركبات المستبعدة لا تُسجل عليها حركات جديدة؛ تظهر فقط إن كانت مركبة السجل الجاري تعديله
  const vehicleChoices = vehicles.filter((vehicle) => vehicle.status !== "disposed" || vehicle.id === editingRecord?.vehicleId);
  const vehicleOptionLabel = (vehicle: FleetVehicle) =>
    `${vehicleLabel(vehicle)}${vehicle.status !== "active" ? ` (${t(optionLabel(VEHICLE_STATUSES, vehicle.status))})` : ""}`;
  const selectedVehicle = vehicleById.get(form.vehicleId);
  const input = "mt-1 h-10 w-full rounded border px-3 text-sm";
  const select = "mt-1 h-10 w-full rounded border bg-white px-2 text-sm";
  const badge = "rounded-full px-2 py-0.5 text-[11px] font-semibold";

  const renderDue = (record: MaintenanceRecord) => {
    if (!record.nextDueDate && record.nextDueOdometer === null) return "—";
    const open = openReminderIds.has(record.id);
    const due = dueOf(record);
    return (
      <div className={`flex flex-col items-center gap-1 ${open ? "" : "text-slate-400"}`}>
        {record.nextDueDate && (
          <span>
            {record.nextDueDate}
            {open && due.date && due.date.days !== null && (
              <span className={`ms-1 ${badge} ${due.date.className}`}>
                {due.date.days < 0 ? `${t("متأخرة")} ${formatNumber(-due.date.days)} ${t("يوم")}` : `${t("بعد")} ${formatNumber(due.date.days)} ${t("يوم")}`}
              </span>
            )}
          </span>
        )}
        {record.nextDueOdometer !== null && (
          <span>
            {formatNumber(record.nextDueOdometer)} {t("كم")}
            {open && due.kmRemaining !== null && (
              <span className={`ms-1 ${badge} ${kmClass(due.kmRemaining)}`}>
                {due.kmRemaining < 0 ? `${t("تجاوز")} ${formatNumber(-due.kmRemaining)} ${t("كم")}` : `${t("متبقي")} ${formatNumber(due.kmRemaining)} ${t("كم")}`}
              </span>
            )}
          </span>
        )}
        {!open && record.status === "completed" && <span className="text-[11px]">{t("تجاوزتها صيانة لاحقة")}</span>}
      </div>
    );
  };

  return (
    <Layout>
      <main dir={direction} className="space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-amber-50 p-2 text-amber-700"><Wrench className="h-6 w-6" /></div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{t("صيانة المركبات")}</h1>
              <p className="mt-1 text-sm text-slate-500">{t("سجل الصيانة المنفذة والمجدولة لكل مركبة، مع متابعة موعد الصيانة القادمة بالتاريخ والعداد.")}</p>
            </div>
          </div>
          {canManage && <button onClick={startNew} className="inline-flex items-center gap-2 rounded bg-amber-700 px-4 py-2 text-sm font-semibold text-white"><Plus className="h-4 w-4" />{t("صيانة جديدة")}</button>}
        </header>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <button onClick={() => setStatusFilter((current) => current === "scheduled" ? "" : "scheduled")} className={`rounded-xl border bg-white p-4 text-start shadow-sm ${statusFilter === "scheduled" ? "ring-2 ring-amber-600" : ""}`}>
            <p className="text-xs text-slate-500">{t("صيانات مجدولة")}</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{formatNumber(scheduledCount)}</p>
          </button>
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500">{t("تكلفة الصيانة المنفذة هذا الشهر (قبل الضريبة)")}</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{money(monthCost)}</p>
          </div>
          <div className={`rounded-xl border p-4 shadow-sm ${dueSoonCount > 0 ? "border-amber-300 bg-amber-50" : "bg-white"}`}>
            <p className="text-xs text-slate-500">{t("صيانات مستحقة أو قريبة الاستحقاق")}</p>
            <p className={`mt-1 text-2xl font-bold ${dueSoonCount > 0 ? "text-amber-800" : "text-slate-900"}`}>{formatNumber(dueSoonCount)}</p>
          </div>
        </div>

        <p className="rounded border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">{t("التكلفة هنا للمتابعة التشغيلية قبل الضريبة. القيد المحاسبي وضريبة القيمة المضافة يُسجلان مرة واحدة عبر فاتورة المشتريات في وحدة المشتريات، ويُربط السجل بالفاتورة المرحّلة فقط دون قيد مزدوج.")}</p>

        {error && <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        {editingId !== undefined && (
          <section className="rounded-xl border bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-bold">{editingId ? `${t("تعديل الصيانة")} ${editingRecord?.number ?? ""}` : t("صيانة جديدة")}</h2>
              <button onClick={reset}><X className="h-5 w-5" /></button>
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <label className="text-xs text-slate-600 md:col-span-2">{t("المركبة")} *
                <select value={form.vehicleId} onChange={(event) => update("vehicleId")(event.target.value)} className={select}>
                  <option value="">{t("اختر المركبة")}</option>
                  {vehicleChoices.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicleOptionLabel(vehicle)}</option>)}
                </select>
              </label>
              <label className="text-xs text-slate-600">{t("تاريخ الصيانة")} *<input type="date" value={form.date} onChange={(event) => update("date")(event.target.value)} className={input} /></label>
              <label className="text-xs text-slate-600">{t("الحالة")}<select value={form.status} onChange={(event) => update("status")(event.target.value)} className={select}>{MAINTENANCE_STATUSES.map((option) => <option key={option.value} value={option.value}>{t(option.label)}</option>)}</select></label>
              <label className="text-xs text-slate-600">{t("نوع الصيانة")}<select value={form.type} onChange={(event) => update("type")(event.target.value)} className={select}>{MAINTENANCE_TYPES.map((option) => <option key={option.value} value={option.value}>{t(option.label)}</option>)}</select></label>
              <label className="text-xs text-slate-600">{t("قراءة العداد (كم)")}
                <input type="number" min="0" value={form.odometer} onChange={(event) => update("odometer")(event.target.value)} className={input} placeholder={selectedVehicle ? `${t("العداد الحالي")}: ${formatNumber(selectedVehicle.odometer)}` : ""} />
              </label>
              <label className="text-xs text-slate-600">{t("التكلفة قبل الضريبة")}<input type="number" min="0" step="0.01" value={form.amount} onChange={(event) => update("amount")(event.target.value)} className={input} /></label>
              <label className="text-xs text-slate-600">{t("الورشة")}<input value={form.workshop} onChange={(event) => update("workshop")(event.target.value)} className={input} /></label>
              <label className="text-xs text-slate-600 md:col-span-2">{t("وصف الصيانة")} *<input value={form.description} onChange={(event) => update("description")(event.target.value)} className={input} /></label>
              <label className="text-xs text-slate-600 md:col-span-2">{t("فاتورة المشتريات المرحّلة")}
                <select value={form.invoiceId} onChange={(event) => update("invoiceId")(event.target.value)} className={select}>
                  <option value="">{t("غير مربوطة")}</option>
                  {invoiceChoices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
                </select>
                {invoiceError && <span className="mt-1 block text-[11px] text-red-600">{invoiceError}</span>}
              </label>
              <label className="text-xs text-slate-600">{t("تاريخ الصيانة القادمة")}<input type="date" value={form.nextDueDate} onChange={(event) => update("nextDueDate")(event.target.value)} className={input} /></label>
              <label className="text-xs text-slate-600">{t("عداد الصيانة القادمة (كم)")}<input type="number" min="0" value={form.nextDueOdometer} onChange={(event) => update("nextDueOdometer")(event.target.value)} className={input} /></label>
              <label className="text-xs text-slate-600 md:col-span-2">{t("ملاحظات")}<input value={form.notes} onChange={(event) => update("notes")(event.target.value)} className={input} /></label>
            </div>
            <p className="mt-3 text-xs text-slate-500">{t("قراءة العداد في الصيانة المنفذة تحدّث عداد المركبة تلقائيًا. الصيانة المجدولة يمكن أن يكون تاريخها في المستقبل.")}</p>
            <div className="mt-4 flex justify-end">
              <button disabled={busy} onClick={() => void save()} className="inline-flex items-center gap-2 rounded bg-amber-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{t("حفظ")}</button>
            </div>
          </section>
        )}

        <section className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-2 border-b bg-slate-50 px-4 py-3">
            <div className="relative w-full max-w-xs">
              <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("ابحث بالرقم أو الوصف أو الورشة")} className="h-9 w-full rounded border bg-white ps-9 pe-3 text-sm" />
            </div>
            <select value={vehicleFilter} onChange={(event) => setVehicleFilter(event.target.value)} className="h-9 rounded border bg-white px-2 text-sm"><option value="">{t("كل المركبات")}</option>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicleLabel(vehicle)}</option>)}</select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-9 rounded border bg-white px-2 text-sm"><option value="">{t("كل الحالات")}</option>{MAINTENANCE_STATUSES.map((option) => <option key={option.value} value={option.value}>{t(option.label)}</option>)}</select>
            <label className="flex items-center gap-1 text-xs text-slate-600">{t("من")}<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="h-9 rounded border bg-white px-2 text-sm" /></label>
            <label className="flex items-center gap-1 text-xs text-slate-600">{t("إلى")}<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="h-9 rounded border bg-white px-2 text-sm" /></label>
            {hasFilters && <button onClick={clearFilters} className="h-9 rounded border bg-white px-3 text-xs text-slate-600">{t("مسح الفلاتر")}</button>}
            <span className="ms-auto text-xs text-slate-600">{t("عدد السجلات")}: <b>{formatNumber(visibleRecords.length)}</b> — {t("تكلفة المنفذة")}: <b>{money(visibleCost)}</b></span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="p-3">{t("الرقم")}</th><th className="p-3">{t("التاريخ")}</th><th className="p-3">{t("المركبة")}</th><th className="p-3">{t("النوع")}</th><th className="p-3">{t("الحالة")}</th>
                  <th className="p-3">{t("العداد")}</th><th className="p-3">{t("التكلفة قبل الضريبة")}</th><th className="p-3">{t("فاتورة المشتريات")}</th><th className="p-3">{t("الصيانة القادمة")}</th><th className="p-3">{t("الإجراءات")}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? <tr><td colSpan={10} className="py-14 text-center">{t("جاري التحميل...")}</td></tr>
                  : visibleRecords.length === 0 ? <tr><td colSpan={10} className="py-14 text-center text-slate-400">{t("لا توجد سجلات صيانة")}</td></tr>
                  : visibleRecords.map((record) => (
                    <tr key={record.id} className="border-t">
                      <td className="p-3 font-mono">{record.number}</td>
                      <td className="p-3 text-center">{record.date}</td>
                      <td className="p-3 text-center font-semibold">{vehicleLabel(vehicleById.get(record.vehicleId))}</td>
                      <td className="p-3 text-center">
                        {t(optionLabel(MAINTENANCE_TYPES, record.type))}
                        <div className="mx-auto max-w-[16rem] truncate text-xs text-slate-500" title={record.notes || record.description}>{record.description}{record.workshop ? ` — ${record.workshop}` : ""}</div>
                      </td>
                      <td className="p-3 text-center"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${STATUS_CLASS[record.status] ?? "bg-slate-100"}`}>{t(optionLabel(MAINTENANCE_STATUSES, record.status))}</span></td>
                      <td className="p-3 text-center">{record.odometer === null ? "—" : formatNumber(record.odometer)}</td>
                      <td className="p-3 text-center">{money(record.amount)}</td>
                      <td className="p-3 text-center font-mono text-xs">{record.invoiceId || "—"}</td>
                      <td className="p-3 text-center">{renderDue(record)}</td>
                      <td className="p-3">
                        {canManage && <div className="flex justify-center gap-1">
                          {record.status === "scheduled" && <button disabled={busy} onClick={() => void markCompleted(record)} className="rounded border p-2 text-emerald-700" title={t("تسجيل كمنفذة")}><CheckCircle2 className="h-4 w-4" /></button>}
                          <button disabled={busy} onClick={() => startEdit(record)} className="rounded border p-2 text-amber-700" title={t("تعديل")}><Edit3 className="h-4 w-4" /></button>
                          <button disabled={busy} onClick={() => void remove(record)} className="rounded border p-2 text-red-600" title={t("حذف")}><Trash2 className="h-4 w-4" /></button>
                        </div>}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </Layout>
  );
}
