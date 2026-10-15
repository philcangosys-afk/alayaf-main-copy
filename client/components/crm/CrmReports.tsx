import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Printer, RefreshCw } from "lucide-react";
import { useI18n } from "@/i18n";
import { supabase } from "@/lib/supabaseClient";
import { selectAllRows } from "@/lib/ledgerData";
import { riyadhDateString } from "@/lib/utils";
import { COMPANY_REPORT_BRAND, exportReportExcel, printReport, type ReportCell, type ReportColumn } from "@/lib/reportExport";

type CrmReportId = "ar_aging" | "customer_statement" | "ap_aging" | "vendor_statement";
type Party = { id: string; number: string; name: string };
type OpenInvoice = { id: string; date: string; dueDate: string; partyId: string; partyName: string; total: number; outstanding: number };
type Movement = { date: string; reference: string; description: string; debit: number; credit: number };
type SourceData = {
  customers: Party[];
  vendors: Party[];
  salesInvoices: OpenInvoice[];
  salesNotes: Array<{ number: string; type: string; date: string; total: number; invoiceId: string }>;
  customerPayments: Array<{ number: string; date: string; amount: number; invoiceId: string; customerId: string }>;
  purchaseInvoices: OpenInvoice[];
  purchaseNotes: Array<{ number: string; type: string; date: string; total: number; invoiceId: string }>;
  // السداد المعكوس يظهر حركتين: السداد بتاريخه، وعكسه بتاريخ العكس (مبلغ سالب)
  vendorPayments: Array<{ number: string; date: string; amount: number; invoiceId: string; vendorId: string }>;
};

const REPORTS: Array<{ id: CrmReportId; label: string; description: string }> = [
  { id: "ar_aging", label: "أعمار ديون العملاء", description: "المتبقي على الفواتير المرحّلة بعد السداد والإشعارات، موزعًا حسب أيام التأخر عن تاريخ الاستحقاق." },
  { id: "customer_statement", label: "كشف حساب عميل", description: "الفواتير والإشعارات والمقبوضات المرحّلة للعميل برصيد أول المدة والرصيد الجاري." },
  { id: "ap_aging", label: "أعمار ديون الموردين", description: "المتبقي على فواتير المشتريات المرحّلة بعد السداد والإشعارات، موزعًا حسب أيام التأخر." },
  { id: "vendor_statement", label: "كشف حساب مورد", description: "فواتير المشتريات والإشعارات والمدفوعات المرحّلة للمورد برصيد أول المدة والرصيد الجاري." },
];

/** القيم المالية في بعض الجداول نصية (مثل "ريال 17.25")؛ نأخذ الرقم فقط. */
const amount = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  return Number(String(value ?? "").replace(/[^0-9.-]/g, "")) || 0;
};
const dateText = (value: unknown) => String(value ?? "").slice(0, 10);
const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const daysBetween = (from: string, to: string) =>
  Math.round((Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10)) - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) / 86400000);
const normalizeName = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
const outstandingOf = (row: Record<string, unknown>) =>
  row.adjusted_remaining === null || row.adjusted_remaining === undefined ? amount(row.remaining) : amount(row.adjusted_remaining);

const AGING_BUCKETS = [
  { key: "current", label: "غير مستحق بعد" },
  { key: "d30", label: "1 - 30 يومًا" },
  { key: "d60", label: "31 - 60 يومًا" },
  { key: "d90", label: "61 - 90 يومًا" },
  { key: "d90plus", label: "أكثر من 90 يومًا" },
] as const;
type BucketKey = (typeof AGING_BUCKETS)[number]["key"];
const bucketFor = (days: number): BucketKey => (days <= 0 ? "current" : days <= 30 ? "d30" : days <= 60 ? "d60" : days <= 90 ? "d90" : "d90plus");

export default function CrmReports() {
  const { t, direction, formatNumber } = useI18n();
  const today = riyadhDateString();
  const [view, setView] = useState<CrmReportId>("ar_aging");
  const [dateFrom, setDateFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [dateTo, setDateTo] = useState(today);
  const [customerId, setCustomerId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [data, setData] = useState<SourceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestId = useRef(0);

  const load = async () => {
    const current = ++requestId.current;
    setLoading(true);
    setError("");
    const [customers, vendors, salesInvoices, salesNotes, customerPayments, purchaseInvoices, purchaseNotes, vendorPayments] = await Promise.all([
      selectAllRows((from, to) => supabase.from("customers").select("id, customer_number, name").order("customer_number").order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("vendors").select("id, vendor_number, name").order("vendor_number").order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("sales_invoices").select("id, date, due_date, customer, customer_id, total, remaining, adjusted_remaining").eq("accounting_status", "posted").order("date").order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("invoice_adjustment_notes").select("id, note_number, note_type, issue_date, total, original_invoice_id").in("note_type", ["sales_credit", "sales_debit"]).eq("status", "posted").eq("accounting_status", "posted").order("issue_date").order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("customer_payments").select("id, payment_number, payment_date, amount, invoice_id, customer_id").order("payment_date").order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("purchase_invoices").select("id, date, due_date, vendor, vendor_id, total, remaining, adjusted_remaining").eq("accounting_status", "posted").order("date").order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("invoice_adjustment_notes").select("id, note_number, note_type, issue_date, total, original_invoice_id").in("note_type", ["purchase_debit", "purchase_credit"]).eq("status", "posted").eq("accounting_status", "posted").order("issue_date").order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("purchase_payments").select("id, payment_number, payment_date, amount, invoice_id, vendor_id, status, reversed_on").order("payment_date").order("id").range(from, to)),
    ]);
    if (current !== requestId.current) return;
    const firstError = customers.error ?? vendors.error ?? salesInvoices.error ?? salesNotes.error ?? customerPayments.error ?? purchaseInvoices.error ?? purchaseNotes.error ?? vendorPayments.error;
    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }
    const mapNotes = (rows: Record<string, unknown>[]) => rows.map((row) => ({ number: String(row.note_number ?? row.id), type: String(row.note_type), date: dateText(row.issue_date), total: amount(row.total), invoiceId: String(row.original_invoice_id ?? "") }));
    setData({
      customers: customers.data.map((row: Record<string, unknown>) => ({ id: String(row.id), number: String(row.customer_number ?? ""), name: String(row.name ?? "") })),
      vendors: vendors.data.map((row: Record<string, unknown>) => ({ id: String(row.id), number: String(row.vendor_number ?? ""), name: String(row.name ?? "") })),
      salesInvoices: salesInvoices.data.map((row: Record<string, unknown>) => ({ id: String(row.id), date: dateText(row.date), dueDate: dateText(row.due_date), partyId: String(row.customer_id ?? ""), partyName: String(row.customer ?? ""), total: amount(row.total), outstanding: outstandingOf(row) })),
      salesNotes: mapNotes(salesNotes.data),
      customerPayments: customerPayments.data.map((row: Record<string, unknown>) => ({ number: String(row.payment_number ?? row.id), date: dateText(row.payment_date), amount: amount(row.amount), invoiceId: String(row.invoice_id ?? ""), customerId: String(row.customer_id ?? "") })),
      purchaseInvoices: purchaseInvoices.data.map((row: Record<string, unknown>) => ({ id: String(row.id), date: dateText(row.date), dueDate: dateText(row.due_date), partyId: String(row.vendor_id ?? ""), partyName: String(row.vendor ?? ""), total: amount(row.total), outstanding: outstandingOf(row) })),
      purchaseNotes: mapNotes(purchaseNotes.data),
      vendorPayments: vendorPayments.data.flatMap((row: Record<string, unknown>) => {
        const payment = { number: String(row.payment_number ?? row.id), date: dateText(row.payment_date), amount: amount(row.amount), invoiceId: String(row.invoice_id ?? ""), vendorId: String(row.vendor_id ?? "") };
        return row.status === "reversed" && row.reversed_on
          ? [payment, { ...payment, number: `${payment.number} ↩`, date: dateText(row.reversed_on), amount: -payment.amount }]
          : [payment];
      }),
    });
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const money = (value: number) => formatNumber(Math.abs(value) < 0.005 ? 0 : value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const summaryCards = useMemo(() => {
    if (!data) return [];
    const overdue = (invoices: OpenInvoice[]) => invoices.filter((invoice) => invoice.outstanding > 0.005 && daysBetween(isDate(invoice.dueDate) ? invoice.dueDate : invoice.date, today) > 0);
    const sum = (invoices: OpenInvoice[]) => invoices.reduce((total, invoice) => total + Math.max(invoice.outstanding, 0), 0);
    return [
      { label: t("إجمالي ذمم العملاء"), value: money(sum(data.salesInvoices)) },
      { label: t("ذمم عملاء متأخرة"), value: `${money(sum(overdue(data.salesInvoices)))} (${formatNumber(overdue(data.salesInvoices).length)})` },
      { label: t("إجمالي المستحق للموردين"), value: money(sum(data.purchaseInvoices)) },
      { label: t("مستحقات موردين متأخرة"), value: `${money(sum(overdue(data.purchaseInvoices)))} (${formatNumber(overdue(data.purchaseInvoices).length)})` },
    ];
  }, [data, today, t, formatNumber]);

  const report = useMemo<{ columns: ReportColumn[]; rows: Record<string, ReportCell>[]; summary: Array<{ label: string; value: ReportCell }>; notice?: string }>(() => {
    if (!data) return { columns: [], rows: [], summary: [] };

    if (view === "ar_aging" || view === "ap_aging") {
      const isCustomer = view === "ar_aging";
      const parties = isCustomer ? data.customers : data.vendors;
      const partyById = new Map(parties.map((party) => [party.id, party]));
      const groups = new Map<string, { name: string; number: string; count: number } & Record<BucketKey, number>>();
      (isCustomer ? data.salesInvoices : data.purchaseInvoices)
        .filter((invoice) => invoice.outstanding > 0.005 && invoice.date <= today)
        .forEach((invoice) => {
          const party = partyById.get(invoice.partyId);
          const key = party ? party.id : `name:${normalizeName(invoice.partyName)}`;
          const group = groups.get(key) ?? { name: party?.name || invoice.partyName || "—", number: party?.number ?? "", count: 0, current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 };
          const due = isDate(invoice.dueDate) ? invoice.dueDate : invoice.date;
          group[bucketFor(daysBetween(due, today))] += invoice.outstanding;
          group.count += 1;
          groups.set(key, group);
        });
      const rows = [...groups.values()]
        .sort((first, second) => first.name.localeCompare(second.name))
        .map((group) => {
          const total = AGING_BUCKETS.reduce((sum, bucket) => sum + group[bucket.key], 0);
          return { party: group.number ? `${group.number} — ${group.name}` : group.name, count: group.count, ...Object.fromEntries(AGING_BUCKETS.map((bucket) => [bucket.key, money(group[bucket.key])])), total: money(total) };
        });
      const totals = AGING_BUCKETS.map((bucket) => ({ label: t(bucket.label), value: money([...groups.values()].reduce((sum, group) => sum + group[bucket.key], 0)) }));
      return {
        columns: [
          { key: "party", label: t(isCustomer ? "العميل" : "المورد") },
          { key: "count", label: t("عدد الفواتير") },
          ...AGING_BUCKETS.map((bucket) => ({ key: bucket.key, label: t(bucket.label) })),
          { key: "total", label: t("الإجمالي") },
        ],
        rows,
        summary: [...totals, { label: t("الإجمالي"), value: money([...groups.values()].reduce((sum, group) => sum + AGING_BUCKETS.reduce((inner, bucket) => inner + group[bucket.key], 0), 0)) }],
        notice: t("المتبقي على كل فاتورة حسب آخر سداد وإشعار مسجل، والتأخر محسوب من تاريخ الاستحقاق حتى اليوم."),
      };
    }

    const isCustomer = view === "customer_statement";
    const selectedId = isCustomer ? customerId : vendorId;
    const party = (isCustomer ? data.customers : data.vendors).find((item) => item.id === selectedId);
    if (!party) {
      return { columns: [], rows: [], summary: [], notice: t(isCustomer ? "اختر العميل لعرض كشف حسابه." : "اختر المورد لعرض كشف حسابه.") };
    }
    const partyName = normalizeName(party.name);
    const invoices = (isCustomer ? data.salesInvoices : data.purchaseInvoices).filter((invoice) => invoice.partyId === party.id || (!invoice.partyId && normalizeName(invoice.partyName) === partyName));
    const invoiceIds = new Set(invoices.map((invoice) => invoice.id));
    const movements: Movement[] = [];
    if (isCustomer) {
      invoices.forEach((invoice) => movements.push({ date: invoice.date, reference: invoice.id, description: t("فاتورة مبيعات"), debit: invoice.total, credit: 0 }));
      data.salesNotes.filter((note) => invoiceIds.has(note.invoiceId)).forEach((note) => movements.push(
        note.type === "sales_debit"
          ? { date: note.date, reference: note.number, description: `${t("إشعار مدين")} — ${note.invoiceId}`, debit: note.total, credit: 0 }
          : { date: note.date, reference: note.number, description: `${t("إشعار دائن")} — ${note.invoiceId}`, debit: 0, credit: note.total },
      ));
      // السند مرتبط دائمًا بفاتورة؛ نأخذ سندات الفواتير الظاهرة فقط حتى لا يختل الرصيد
      data.customerPayments.filter((payment) => invoiceIds.has(payment.invoiceId)).forEach((payment) =>
        movements.push({ date: payment.date, reference: payment.number, description: `${t("سند قبض")} — ${payment.invoiceId}`, debit: 0, credit: payment.amount }));
    } else {
      invoices.forEach((invoice) => movements.push({ date: invoice.date, reference: invoice.id, description: t("فاتورة مشتريات"), debit: 0, credit: invoice.total }));
      data.purchaseNotes.filter((note) => invoiceIds.has(note.invoiceId)).forEach((note) =>
        movements.push({ date: note.date, reference: note.number, description: `${t(note.type === "purchase_credit" ? "إشعار دائن مشتريات" : "إشعار مدين مشتريات")} — ${note.invoiceId}`, debit: note.total, credit: 0 }));
      data.vendorPayments.filter((payment) => invoiceIds.has(payment.invoiceId)).forEach((payment) =>
        movements.push(payment.amount >= 0
          ? { date: payment.date, reference: payment.number, description: `${t("سداد مورد")} — ${payment.invoiceId}`, debit: payment.amount, credit: 0 }
          : { date: payment.date, reference: payment.number, description: `${t("عكس سداد مورد")} — ${payment.invoiceId}`, debit: 0, credit: -payment.amount }));
    }
    movements.sort((first, second) => first.date.localeCompare(second.date) || first.reference.localeCompare(second.reference));
    // رصيد العميل = مدين − دائن، ورصيد المورد = دائن − مدين (المستحق له)
    const effect = (movement: Movement) => (isCustomer ? movement.debit - movement.credit : movement.credit - movement.debit);
    const opening = movements.filter((movement) => movement.date < dateFrom).reduce((sum, movement) => sum + effect(movement), 0);
    const periodMovements = movements.filter((movement) => movement.date >= dateFrom && movement.date <= dateTo);
    let running = opening;
    const rows: Record<string, ReportCell>[] = [
      { date: dateFrom, reference: "—", description: t("رصيد أول المدة"), debit: "", credit: "", balance: money(opening) },
      ...periodMovements.map((movement) => {
        running += effect(movement);
        return { date: movement.date, reference: movement.reference, description: movement.description, debit: movement.debit ? money(movement.debit) : "", credit: movement.credit ? money(movement.credit) : "", balance: money(running) };
      }),
    ];
    const totalDebit = periodMovements.reduce((sum, movement) => sum + movement.debit, 0);
    const totalCredit = periodMovements.reduce((sum, movement) => sum + movement.credit, 0);
    const openInvoices = invoices.filter((invoice) => invoice.date <= dateTo).reduce((sum, invoice) => sum + invoice.outstanding, 0);
    return {
      columns: [
        { key: "date", label: t("التاريخ") },
        { key: "reference", label: t("الرقم") },
        { key: "description", label: t("البيان") },
        { key: "debit", label: t("مدين") },
        { key: "credit", label: t("دائن") },
        { key: "balance", label: t("الرصيد") },
      ],
      rows,
      summary: [
        { label: t("رصيد أول المدة"), value: money(opening) },
        { label: t("مجموع المدين"), value: money(totalDebit) },
        { label: t("مجموع الدائن"), value: money(totalCredit) },
        { label: t("الرصيد الختامي"), value: money(running) },
        ...(dateTo >= today ? [{ label: t("المتبقي على الفواتير المفتوحة"), value: money(openInvoices) }] : []),
      ],
      notice: t("الكشف مبني على المستندات المرحّلة التي تسمح صلاحياتك برؤيتها. الرصيد الختامي حتى اليوم يجب أن يساوي المتبقي على الفواتير المفتوحة."),
    };
  }, [data, view, dateFrom, dateTo, customerId, vendorId, today, t, formatNumber]);

  const current = REPORTS.find((item) => item.id === view) ?? REPORTS[0];
  const isAging = view === "ar_aging" || view === "ap_aging";
  const invalidRange = !isAging && dateFrom > dateTo;
  const selectedParty = view === "customer_statement" ? data?.customers.find((item) => item.id === customerId) : view === "vendor_statement" ? data?.vendors.find((item) => item.id === vendorId) : undefined;
  const subtitle = `${isAging
    ? `${t("حتى تاريخ")} ${today}`
    : `${selectedParty ? `${selectedParty.number} — ${selectedParty.name} — ` : ""}${t("من تاريخ")} ${dateFrom} ${t("إلى تاريخ")} ${dateTo}`}${report.notice ? ` — ${report.notice}` : ""}`;
  const exportOptions = { title: t(current.label), subtitle, columns: report.columns, rows: report.rows, summary: report.summary, fileName: t(current.label), landscape: true, brand: COMPANY_REPORT_BRAND };
  const canExport = !loading && !error && !invalidRange && report.rows.length > 0;

  return (
    <div dir={direction} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {summaryCards.map((card) => (
          <div key={card.label} className="rounded-lg border border-border bg-card p-3">
            <p className="text-xs text-muted-foreground">{card.label}</p>
            <p className="mt-2 text-sm font-semibold text-foreground">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="grid grid-cols-2 border-b border-border md:grid-cols-4">
          {REPORTS.map((item) => (
            <button key={item.id} onClick={() => setView(item.id)} className={`px-3 py-3 text-xs font-semibold ${view === item.id ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-50"}`}>
              {t(item.label)}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border bg-slate-50 px-4 py-3">
          <div className="flex flex-wrap gap-2">
            {isAging ? (
              <p className="text-xs text-slate-500">{t("حتى تاريخ")}: <b className="text-slate-700">{today}</b></p>
            ) : (
              <>
                <label className="text-xs text-slate-500">
                  {t(view === "customer_statement" ? "العميل" : "المورد")}
                  <select
                    value={view === "customer_statement" ? customerId : vendorId}
                    onChange={(event) => (view === "customer_statement" ? setCustomerId(event.target.value) : setVendorId(event.target.value))}
                    className="mt-1 block min-w-[220px] rounded border border-slate-200 bg-white px-2 py-1.5 text-xs"
                  >
                    <option value="">{t(view === "customer_statement" ? "اختر العميل" : "اختر المورد")}</option>
                    {(view === "customer_statement" ? data?.customers : data?.vendors)?.slice().sort((first, second) => first.name.localeCompare(second.name)).map((party) => (
                      <option key={party.id} value={party.id}>{party.number ? `${party.number} — ` : ""}{party.name}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-slate-500">{t("من تاريخ")}<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="mt-1 block rounded border border-slate-200 bg-white px-2 py-1.5 text-xs" /></label>
                <label className="text-xs text-slate-500">{t("إلى تاريخ")}<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="mt-1 block rounded border border-slate-200 bg-white px-2 py-1.5 text-xs" /></label>
              </>
            )}
          </div>
          <div className="flex gap-1">
            <button onClick={() => void load()} className="rounded border border-slate-200 bg-white p-1.5" title={t("تحديث")}><RefreshCw className="h-3.5 w-3.5" /></button>
            <button disabled={!canExport} onClick={() => printReport(exportOptions)} className="rounded border border-slate-200 bg-white p-1.5 disabled:opacity-40" title={t("طباعة")}><Printer className="h-3.5 w-3.5" /></button>
            <button disabled={!canExport} onClick={() => exportReportExcel(exportOptions)} className="rounded border border-slate-200 bg-white p-1.5 disabled:opacity-40" title={t("تصدير Excel")}><Download className="h-3.5 w-3.5" /></button>
          </div>
        </div>

        <section className="p-4">
          <p className="mb-2 text-xs text-slate-500">{t(current.description)}</p>
          {report.notice && <p className="mb-3 text-xs text-amber-700">{report.notice}</p>}
          {loading ? (
            <p className="py-16 text-center text-sm text-slate-500">{t("جاري التحميل...")}</p>
          ) : error ? (
            <p className="py-16 text-center text-sm text-red-600">{error}</p>
          ) : invalidRange ? (
            <p className="py-16 text-center text-sm text-red-600">{t("تاريخ البداية يجب أن يسبق تاريخ النهاية")}</p>
          ) : report.columns.length === 0 ? null : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead className="bg-slate-100 text-slate-600">
                    <tr>{report.columns.map((column) => <th key={column.key} className="border-b px-3 py-2 text-center font-semibold">{column.label}</th>)}</tr>
                  </thead>
                  <tbody>
                    {report.rows.length ? report.rows.map((row, index) => (
                      <tr key={`${index}-${String(row.reference ?? row.party ?? "row")}`} className="border-b border-slate-100">
                        {report.columns.map((column) => <td key={column.key} className="px-3 py-2 text-center text-slate-700">{row[column.key] === "" || row[column.key] === undefined ? "—" : row[column.key]}</td>)}
                      </tr>
                    )) : (
                      <tr><td colSpan={report.columns.length} className="px-3 py-12 text-center text-slate-400">{t("لا توجد بيانات للفترة المحددة")}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex flex-wrap justify-end gap-4 border-t border-slate-100 pt-3 text-xs">
                {report.summary.map((item) => <span key={item.label} className="font-semibold text-slate-700">{item.label}: <b className="text-indigo-700">{item.value}</b></span>)}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
