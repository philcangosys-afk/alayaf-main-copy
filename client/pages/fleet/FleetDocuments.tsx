import { useEffect, useMemo, useState } from "react";
import { Edit3, Loader2, Plus, Save, Search, ShieldCheck, Trash2, X } from "lucide-react";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { canManagePerm } from "@/lib/authSession";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import { selectAllRows } from "@/lib/ledgerData";
import {
  DOCUMENT_TYPES, VEHICLE_STATUSES, daysUntil, documentTrackKey, expiryState, fleetErrorText, loadFleetVehicles, loadPurchaseInvoiceOptions,
  numberOf, optionLabel, vehicleLabel, type FleetVehicle, type Option, type PurchaseInvoiceOption,
} from "@/lib/fleet";

type FleetDocument = {
  id: string; vehicleId: string; type: string; number: string; provider: string; startDate: string; expiryDate: string;
  amount: number; invoiceId: string; notes: string;
};
type Form = {
  vehicleId: string; type: string; number: string; provider: string; startDate: string; expiryDate: string;
  amount: string; invoiceId: string; notes: string;
};
/** حالة الوثيقة في الجدول؛ «مُجددة» = حلّت محلها وثيقة أحدث لنفس المركبة والنوع. */
type RowState = "expired" | "soon" | "valid" | "renewed" | "none";

const emptyForm: Form = { vehicleId: "", type: "insurance", number: "", provider: "", startDate: "", expiryDate: "", amount: "0", invoiceId: "", notes: "" };

const EXPIRY_FILTERS: Option[] = [
  { value: "expired", label: "منتهية" },
  { value: "soon", label: "تنتهي قريبًا" },
  { value: "valid", label: "سارية" },
  { value: "renewed", label: "مُجددة" },
];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const round2 = (value: number) => Math.round(value * 100) / 100;

const mapDocument = (row: Record<string, unknown>): FleetDocument => ({
  id: String(row.id),
  vehicleId: String(row.vehicle_id ?? ""),
  type: String(row.document_type ?? "other"),
  number: String(row.document_number ?? ""),
  provider: String(row.provider ?? ""),
  startDate: String(row.start_date ?? ""),
  expiryDate: String(row.expiry_date ?? ""),
  amount: numberOf(row.amount),
  invoiceId: String(row.purchase_invoice_id ?? ""),
  notes: String(row.notes ?? ""),
});

export default function FleetDocuments() {
  const { t, direction, formatNumber } = useI18n();
  const { permissions } = useRolePermissions();
  const canManage = canManagePerm(permissions, "fleet.insurance", "module.fleet");
  const [documents, setDocuments] = useState<FleetDocument[]>([]);
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [invoices, setInvoices] = useState<PurchaseInvoiceOption[]>([]);
  const [invoiceError, setInvoiceError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [vehicleFilter, setVehicleFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [editingId, setEditingId] = useState<string | null | undefined>(undefined);
  const [form, setForm] = useState<Form>(emptyForm);

  const load = async () => {
    setLoading(true);
    setError("");
    const [documentResult, vehicleResult] = await Promise.all([
      selectAllRows((from, to) => supabase.from("fleet_documents").select("*").order("expiry_date", { ascending: false }).order("id").range(from, to)),
      loadFleetVehicles(),
    ]);
    const firstError = documentResult.error ?? vehicleResult.error;
    if (firstError) { setError(t(fleetErrorText(firstError.message))); setLoading(false); return; }
    setDocuments(documentResult.data.map((row: Record<string, unknown>) => mapDocument(row)));
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
  const vehicleById = useMemo(() => new Map(vehicles.map((vehicle) => [vehicle.id, vehicle])), [vehicles]);
  const editingDocument = editingId ? documents.find((item) => item.id === editingId) : undefined;

  // الوثيقة السارية لكل مركبة ونوع هي الأبعد انتهاءً؛ الأقدم منها مُجددة ولا تُنبّه (انظر documentTrackKey).
  const currentIds = useMemo(() => {
    const latest = new Map<string, FleetDocument>();
    documents.forEach((item) => {
      const key = documentTrackKey(item);
      const current = latest.get(key);
      if (!current || item.expiryDate > current.expiryDate) latest.set(key, item);
    });
    return new Set([...latest.values()].map((item) => item.id));
  }, [documents]);

  const rowState = (item: FleetDocument): RowState => {
    if (!currentIds.has(item.id)) return "renewed";
    const days = daysUntil(item.expiryDate);
    if (days === null) return "none";
    return days < 0 ? "expired" : days <= 30 ? "soon" : "valid";
  };

  // التنبيه على الوثائق السارية للمركبات غير المستبعدة فقط
  const alertDocuments = documents.filter((item) => currentIds.has(item.id) && vehicleById.get(item.vehicleId)?.status !== "disposed");
  const expiredCount = alertDocuments.filter((item) => rowState(item) === "expired").length;
  const soonCount = alertDocuments.filter((item) => rowState(item) === "soon").length;

  const visibleDocuments = documents.filter((item) => {
    const text = `${item.number} ${item.provider} ${item.invoiceId} ${item.notes}`.toLowerCase();
    return (!search.trim() || text.includes(search.trim().toLowerCase()))
      && (!vehicleFilter || item.vehicleId === vehicleFilter)
      && (!typeFilter || item.type === typeFilter)
      && (!stateFilter || rowState(item) === stateFilter);
  });
  const hasFilters = Boolean(search || vehicleFilter || typeFilter || stateFilter);
  const clearFilters = () => { setSearch(""); setVehicleFilter(""); setTypeFilter(""); setStateFilter(""); };

  const update = (key: keyof Form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  const reset = () => { setEditingId(undefined); setForm(emptyForm); setError(""); };
  const startNew = () => { reset(); setEditingId(null); void loadInvoices(); };
  const startEdit = (item: FleetDocument) => {
    setEditingId(item.id);
    setForm({
      vehicleId: item.vehicleId, type: item.type, number: item.number, provider: item.provider,
      startDate: item.startDate, expiryDate: item.expiryDate, amount: String(item.amount), invoiceId: item.invoiceId, notes: item.notes,
    });
    setError("");
    void loadInvoices();
  };

  // المتاح للربط = صافي الفاتورة قبل الضريبة − المربوط سابقًا (+ مبلغ هذه الوثيقة نفسها عند تعديلها على الفاتورة ذاتها)
  const invoiceAvailable = (invoice: PurchaseInvoiceOption) =>
    round2(invoice.subtotal - invoice.linkedAmount + (editingDocument && editingDocument.invoiceId === invoice.id ? editingDocument.amount : 0));
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
    if (!DATE_PATTERN.test(form.expiryDate)) { setError(t("أدخل تاريخ انتهاء الوثيقة")); return; }
    if (form.startDate && form.startDate > form.expiryDate) { setError(t("تاريخ الانتهاء يجب أن يكون بعد تاريخ البداية.")); return; }
    const amount = Number(form.amount || 0);
    if (!Number.isFinite(amount) || amount < 0) { setError(t("التكلفة غير صحيحة")); return; }
    const limitError = invoiceLimitError(round2(amount));
    if (limitError) { setError(limitError); return; }
    const payload: Record<string, unknown> = {
      vehicle_id: form.vehicleId, document_type: form.type, document_number: form.number.trim() || null, provider: form.provider.trim() || null,
      start_date: form.startDate || null, expiry_date: form.expiryDate, amount: round2(amount), purchase_invoice_id: form.invoiceId || null,
      notes: form.notes.trim() || null,
    };
    setBusy(true);
    setError("");
    const { error: saveError } = editingId
      ? await supabase.from("fleet_documents").update(payload).eq("id", editingId)
      : await supabase.from("fleet_documents").insert(payload);
    setBusy(false);
    if (saveError) { setError(t(fleetErrorText(saveError.message))); return; }
    toast({ title: t(editingId ? "تم تحديث الوثيقة" : "تمت إضافة الوثيقة") });
    reset();
    await load();
  };

  const remove = async (item: FleetDocument) => {
    if (!confirm(t("هل تريد حذف الوثيقة؟"))) return;
    setBusy(true);
    const { error: deleteError } = await supabase.from("fleet_documents").delete().eq("id", item.id);
    setBusy(false);
    if (deleteError) { toast({ title: t("تعذر حذف الوثيقة"), description: t(fleetErrorText(deleteError.message)), variant: "destructive" }); return; }
    toast({ title: t("تم حذف الوثيقة") });
    if (editingId === item.id) reset();
    await load();
  };

  // المركبات المستبعدة لا تُسجل عليها وثائق جديدة؛ تظهر فقط إن كانت مركبة الوثيقة الجاري تعديلها
  const vehicleChoices = vehicles.filter((vehicle) => vehicle.status !== "disposed" || vehicle.id === editingDocument?.vehicleId);
  const vehicleOptionLabel = (vehicle: FleetVehicle) =>
    `${vehicleLabel(vehicle)}${vehicle.status !== "active" ? ` (${t(optionLabel(VEHICLE_STATUSES, vehicle.status))})` : ""}`;
  const input = "mt-1 h-10 w-full rounded border px-3 text-sm";
  const select = "mt-1 h-10 w-full rounded border bg-white px-2 text-sm";

  const renderDays = (item: FleetDocument, state: RowState) => {
    const days = daysUntil(item.expiryDate);
    if (state === "renewed" || days === null) return "—";
    if (days < 0) return <span className="text-red-700">{t("منذ")} {formatNumber(-days)} {t("يوم")}</span>;
    return <span className={days <= 30 ? "font-semibold text-amber-800" : ""}>{formatNumber(days)} {t("يوم")}</span>;
  };

  return (
    <Layout>
      <main dir={direction} className="space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-teal-50 p-2 text-teal-700"><ShieldCheck className="h-6 w-6" /></div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{t("التأمين والفحص والاستمارة")}</h1>
              <p className="mt-1 text-sm text-slate-500">{t("وثائق المركبات (التأمين، الفحص الدوري، الاستمارة، بطاقة التشغيل) مع تنبيه انتهائها.")}</p>
            </div>
          </div>
          {canManage && <button onClick={startNew} className="inline-flex items-center gap-2 rounded bg-teal-700 px-4 py-2 text-sm font-semibold text-white"><Plus className="h-4 w-4" />{t("وثيقة جديدة")}</button>}
        </header>

        {(expiredCount > 0 || soonCount > 0) && (
          <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded border px-4 py-3 text-sm ${expiredCount > 0 ? "border-red-200 bg-red-50 text-red-700" : "border-amber-300 bg-amber-50 text-amber-800"}`}>
            {expiredCount > 0 && <button onClick={() => setStateFilter("expired")} className="hover:underline">{t("وثائق منتهية")}: <b>{formatNumber(expiredCount)}</b></button>}
            {soonCount > 0 && <button onClick={() => setStateFilter("soon")} className="text-amber-800 hover:underline">{t("وثائق تنتهي خلال 30 يومًا")}: <b>{formatNumber(soonCount)}</b></button>}
          </div>
        )}

        <p className="rounded border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">{t("التكلفة هنا للمتابعة التشغيلية قبل الضريبة. القيد المحاسبي وضريبة القيمة المضافة يُسجلان مرة واحدة عبر فاتورة المشتريات في وحدة المشتريات، ويُربط السجل بالفاتورة المرحّلة فقط دون قيد مزدوج.")}</p>

        {error && <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        {editingId !== undefined && (
          <section className="rounded-xl border bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-bold">{t(editingId ? "تعديل الوثيقة" : "وثيقة جديدة")}</h2>
              <button onClick={reset}><X className="h-5 w-5" /></button>
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <label className="text-xs text-slate-600 md:col-span-2">{t("المركبة")} *
                <select value={form.vehicleId} onChange={(event) => update("vehicleId")(event.target.value)} className={select}>
                  <option value="">{t("اختر المركبة")}</option>
                  {vehicleChoices.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicleOptionLabel(vehicle)}</option>)}
                </select>
              </label>
              <label className="text-xs text-slate-600">{t("نوع الوثيقة")}<select value={form.type} onChange={(event) => update("type")(event.target.value)} className={select}>{DOCUMENT_TYPES.map((option) => <option key={option.value} value={option.value}>{t(option.label)}</option>)}</select></label>
              <label className="text-xs text-slate-600">{t("رقم الوثيقة")}<input value={form.number} onChange={(event) => update("number")(event.target.value)} className={`${input} font-mono`} /></label>
              <label className="text-xs text-slate-600 md:col-span-2">{t("الجهة المصدرة / شركة التأمين")}<input value={form.provider} onChange={(event) => update("provider")(event.target.value)} className={input} /></label>
              <label className="text-xs text-slate-600">{t("تاريخ البداية")}<input type="date" value={form.startDate} onChange={(event) => update("startDate")(event.target.value)} className={input} /></label>
              <label className="text-xs text-slate-600">{t("تاريخ الانتهاء")} *<input type="date" value={form.expiryDate} onChange={(event) => update("expiryDate")(event.target.value)} className={input} /></label>
              <label className="text-xs text-slate-600">{t("التكلفة قبل الضريبة")}<input type="number" min="0" step="0.01" value={form.amount} onChange={(event) => update("amount")(event.target.value)} className={input} /></label>
              <label className="text-xs text-slate-600 md:col-span-3">{t("فاتورة المشتريات المرحّلة")}
                <select value={form.invoiceId} onChange={(event) => update("invoiceId")(event.target.value)} className={select}>
                  <option value="">{t("غير مربوطة")}</option>
                  {invoiceChoices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
                </select>
                {invoiceError && <span className="mt-1 block text-[11px] text-red-600">{invoiceError}</span>}
              </label>
              <label className="text-xs text-slate-600 md:col-span-4">{t("ملاحظات")}<input value={form.notes} onChange={(event) => update("notes")(event.target.value)} className={input} /></label>
            </div>
            <p className="mt-3 text-xs text-slate-500">{t("عند التجديد أضف وثيقة جديدة بتاريخ الانتهاء الجديد؛ تبقى الوثيقة السابقة في السجل بحالة «مُجددة».")}</p>
            <div className="mt-4 flex justify-end">
              <button disabled={busy} onClick={() => void save()} className="inline-flex items-center gap-2 rounded bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{t("حفظ")}</button>
            </div>
          </section>
        )}

        <section className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-2 border-b bg-slate-50 px-4 py-3">
            <div className="relative w-full max-w-xs">
              <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("ابحث برقم الوثيقة أو الجهة")} className="h-9 w-full rounded border bg-white ps-9 pe-3 text-sm" />
            </div>
            <select value={vehicleFilter} onChange={(event) => setVehicleFilter(event.target.value)} className="h-9 rounded border bg-white px-2 text-sm"><option value="">{t("كل المركبات")}</option>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicleLabel(vehicle)}</option>)}</select>
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="h-9 rounded border bg-white px-2 text-sm"><option value="">{t("كل الأنواع")}</option>{DOCUMENT_TYPES.map((option) => <option key={option.value} value={option.value}>{t(option.label)}</option>)}</select>
            <select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)} className="h-9 rounded border bg-white px-2 text-sm"><option value="">{t("كل حالات الانتهاء")}</option>{EXPIRY_FILTERS.map((option) => <option key={option.value} value={option.value}>{t(option.label)}</option>)}</select>
            {hasFilters && <button onClick={clearFilters} className="h-9 rounded border bg-white px-3 text-xs text-slate-600">{t("مسح الفلاتر")}</button>}
            <span className="ms-auto text-xs text-slate-600">{t("عدد الوثائق")}: <b>{formatNumber(visibleDocuments.length)}</b></span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="p-3">{t("المركبة")}</th><th className="p-3">{t("النوع")}</th><th className="p-3">{t("رقم الوثيقة")}</th><th className="p-3">{t("الجهة")}</th>
                  <th className="p-3">{t("تاريخ البداية")}</th><th className="p-3">{t("تاريخ الانتهاء")}</th><th className="p-3">{t("الحالة")}</th><th className="p-3">{t("الأيام المتبقية")}</th>
                  <th className="p-3">{t("التكلفة قبل الضريبة")}</th><th className="p-3">{t("فاتورة المشتريات")}</th><th className="p-3">{t("الإجراءات")}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? <tr><td colSpan={11} className="py-14 text-center">{t("جاري التحميل...")}</td></tr>
                  : visibleDocuments.length === 0 ? <tr><td colSpan={11} className="py-14 text-center text-slate-400">{t("لا توجد وثائق")}</td></tr>
                  : visibleDocuments.map((item) => {
                    const state = rowState(item);
                    const expiry = state === "renewed" ? { label: "مُجددة", className: "bg-slate-100 text-slate-500" } : expiryState(item.expiryDate);
                    return (
                      <tr key={item.id} className={`border-t ${state === "renewed" ? "text-slate-500" : ""}`}>
                        <td className="p-3 text-center font-semibold">{vehicleLabel(vehicleById.get(item.vehicleId))}</td>
                        <td className="p-3 text-center">{t(optionLabel(DOCUMENT_TYPES, item.type))}</td>
                        <td className="p-3 text-center font-mono">{item.number || "—"}</td>
                        <td className="p-3 text-center">{item.provider || "—"}</td>
                        <td className="p-3 text-center">{item.startDate || "—"}</td>
                        <td className="p-3 text-center">{item.expiryDate}</td>
                        <td className="p-3 text-center"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${expiry.className}`}>{t(expiry.label)}</span></td>
                        <td className="p-3 text-center">{renderDays(item, state)}</td>
                        <td className="p-3 text-center">{money(item.amount)}</td>
                        <td className="p-3 text-center font-mono text-xs">{item.invoiceId || "—"}</td>
                        <td className="p-3">
                          {canManage && <div className="flex justify-center gap-1">
                            <button disabled={busy} onClick={() => startEdit(item)} className="rounded border p-2 text-teal-700" title={t("تعديل")}><Edit3 className="h-4 w-4" /></button>
                            <button disabled={busy} onClick={() => void remove(item)} className="rounded border p-2 text-red-600" title={t("حذف")}><Trash2 className="h-4 w-4" /></button>
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
