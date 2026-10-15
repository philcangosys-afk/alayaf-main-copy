import { AlertTriangle, Download, Printer, RefreshCw, ShieldCheck, Tags, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import { supabase } from "@/lib/supabaseClient";
import { riyadhDateString } from "@/lib/utils";
import { COMPANY_REPORT_BRAND, exportReportExcel, printReport, type ReportColumn } from "@/lib/reportExport";

type Item = { description: string; quantity: number; unitPrice: number; discount: number; taxPercent: number; accountCode: string };
// outOfScopeOnly: إشعار على فاتورة مورد غير مقيم — بنوده خارج نطاق الإقرار (القاعدة تفرض ذلك)
type SourceDocument = { table: string; id: string; number: string; date: string; counterparty: string; side: "sales" | "purchases"; items: Item[]; eligible: boolean; outOfScopeOnly?: boolean };
type Classification = { document_table: string; document_id: string; line_index: number };
type SummaryGroup = { document_side: string; tax_category: string; supply_type: string; document_count: number; taxable_amount: number; tax_amount: number };
type DetailLine = { id: string; document_table: string; document_id: string; document_date: string; document_side: string; line_description: string; tax_category: string; supply_type: string; tax_rate: number; taxable_amount: number; tax_amount: number };
type DraftClass = { lineIndex: number; taxCategory: string; supplyType: string };
type ReconciliationRow = { document_table: string; document_id: string; document_number: string; document_date: string; document_side: string; document_type: string; counterparty: string | null; document_subtotal: number; document_total: number; document_tax: number; classified_tax: number; journal_tax: number; journal_status: string | null; item_count: number; classification_count: number; reconciliation_status: string; reconciliation_reason_code: string };
type ReportRow = Record<string, string | number>;

const number = (value: unknown) => Number(value ?? 0) || 0;
const mapItems = (items: unknown): Item[] => Array.isArray(items) ? items.map((item) => { const row = item as Record<string, unknown>; return { description: String(row.description ?? ""), quantity: number(row.quantity), unitPrice: number(row.unitPrice), discount: number(row.discount), taxPercent: number(row.taxPercent), accountCode: String(row.accountCode ?? row.account ?? "") }; }) : [];
// الحساب الوسيط للجمارك المدفوعة نيابة عنا: سطره خارج نطاق الإقرار (ضريبته في البيان الجمركي)
const CUSTOMS_CLEARING_ACCOUNT = "2115";
const categoryNames: Record<string, string> = { standard: "النسبة الأساسية 15%", zero_rated: "نسبة صفر", exempt: "معفى", out_of_scope: "خارج النطاق" };
const supplyNames: Record<string, string> = { domestic: "محلي", export: "تصدير", import: "استيراد", reverse_charge: "احتساب عكسي" };
const documentTypeNames: Record<string, string> = { standard: "فاتورة مبيعات قياسية", simplified: "فاتورة مبيعات مبسطة", sales_invoice: "فاتورة مبيعات", purchase_invoice: "فاتورة مشتريات", sales_credit: "إشعار دائن مبيعات", sales_debit: "إشعار مدين مبيعات", purchase_debit: "إشعار مدين مشتريات", purchase_credit: "إشعار دائن مشتريات", purchase_invoice_reverse_charge: "فاتورة مورد غير مقيم — احتساب عكسي", purchase_invoice_customs_goods: "فاتورة بضاعة مستوردة (خارج الإقرار)", purchase_invoice_not_subject: "فاتورة مورد غير مقيم — غير خاضعة", customs_declaration: "بيان جمركي", customs_declaration_reversal: "عكس بيان جمركي" };
// خانات نموذج إقرار ضريبة القيمة المضافة (الهيئة): المبلغ والضريبة لكل خانة من التصنيفات المرحّلة
type ReturnBox = { box: string; label: string; base: number; tax: number; note?: string };
const reasonNames: Record<string, string> = { missing_journal: "لا يوجد قيد محاسبي مرحّل لهذا المستند", missing_classification: "لم يتم تصنيف أي بند ضريبي", partial_classification: "تم تصنيف جزء من بنود المستند فقط", document_tax_mismatch: "إجمالي الضريبة المصنفة لا يساوي ضريبة المستند", journal_tax_mismatch: "ضريبة القيد المحاسبي لا تساوي ضريبة المستند", matched: "المستند متطابق" };

export default function TaxReports() {
  const { t, direction, formatNumber } = useI18n();
  const [today] = useState(() => riyadhDateString());
  const [dateFrom, setDateFrom] = useState(() => `${today.slice(0, 4)}-01-01`);
  const [dateTo, setDateTo] = useState(today);
  const [mode, setMode] = useState<"summary" | "details" | "reconciliation" | "classification">("summary");
  const [groups, setGroups] = useState<SummaryGroup[]>([]);
  const [details, setDetails] = useState<DetailLine[]>([]);
  const [documents, setDocuments] = useState<SourceDocument[]>([]);
  const [classifications, setClassifications] = useState<Classification[]>([]);
  const [reconciliation, setReconciliation] = useState<ReconciliationRow[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<SourceDocument | null>(null);
  const [draft, setDraft] = useState<DraftClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const invalidRange = dateFrom > dateTo;
  const money = (value: number) => formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const load = async () => {
    if (invalidRange) { setError(t("تاريخ البداية يجب أن يسبق تاريخ النهاية")); return; }
    setLoading(true); setError("");
    const [summaryResult, detailResult, salesResult, purchaseResult, notesResult, classResult, reconciliationResult] = await Promise.all([
      supabase.rpc("get_vat_report_summary", { p_date_from: dateFrom, p_date_to: dateTo }),
      supabase.from("accounting_vat_report_lines").select("*").eq("report_eligible", true).gte("document_date", dateFrom).lte("document_date", dateTo).order("document_date"),
      supabase.from("sales_invoices").select("id, date, customer, items, accounting_status").gte("date", dateFrom).lte("date", dateTo),
      supabase.from("purchase_invoices").select("id, date, vendor, items, accounting_status, accounting_journal_entry_id").eq("accounting_status", "posted").gte("date", dateFrom).lte("date", dateTo),
      supabase.from("invoice_adjustment_notes").select("id, note_number, note_type, issue_date, counterparty, items, tax, status, accounting_status, original_invoice_id").eq("status", "posted").gte("issue_date", dateFrom).lte("issue_date", dateTo),
      supabase.from("accounting_vat_line_classifications").select("document_table, document_id, line_index").gte("document_date", dateFrom).lte("document_date", dateTo),
      supabase.rpc("get_vat_accounting_reconciliation", { p_date_from: dateFrom, p_date_to: dateTo }),
    ]);
    // إشعارات المشتريات على فواتير مورد غير مقيم: بنودها خارج نطاق الإقرار
    const noteInvoiceIds = Array.from(new Set((notesResult.data ?? [])
      .filter((row) => ["purchase_debit", "purchase_credit"].includes(String(row.note_type)))
      .map((row) => String(row.original_invoice_id ?? "")).filter(Boolean)));
    const importInvoicesResult = noteInvoiceIds.length
      ? await supabase.from("purchase_invoices").select("id").in("id", noteInvoiceIds).not("import_treatment", "is", null)
      : { data: [] as { id: string }[] };
    const importInvoiceIds = new Set((importInvoicesResult.data ?? []).map((row) => String(row.id)));
    const firstError = summaryResult.error ?? detailResult.error ?? salesResult.error ?? purchaseResult.error ?? notesResult.error ?? classResult.error ?? reconciliationResult.error;
    if (firstError) { setError(firstError.message); setLoading(false); return; }
    const sourceDocuments: SourceDocument[] = [
      ...(salesResult.data ?? []).map((row) => ({ table: "sales_invoices", id: String(row.id), number: String(row.id), date: String(row.date), counterparty: String(row.customer ?? ""), side: "sales" as const, items: mapItems(row.items), eligible: row.accounting_status === "posted" })),
      ...(purchaseResult.data ?? []).map((row) => ({ table: "purchase_invoices", id: String(row.id), number: String(row.id), date: String(row.date), counterparty: String(row.vendor ?? ""), side: "purchases" as const, items: mapItems(row.items), eligible: row.accounting_status === "posted" && Boolean(row.accounting_journal_entry_id) })),
      ...(notesResult.data ?? []).map((row) => ({ table: "invoice_adjustment_notes", id: String(row.id), number: String(row.note_number), date: String(row.issue_date), counterparty: String(row.counterparty ?? ""), side: (["purchase_debit", "purchase_credit"].includes(String(row.note_type)) ? "purchases" : "sales") as "sales" | "purchases", items: mapItems(row.items).map((item) => ({ ...item, taxPercent: item.taxPercent || (number(row.tax) > 0 ? 15 : 0) })), eligible: row.accounting_status === "posted", outOfScopeOnly: ["purchase_debit", "purchase_credit"].includes(String(row.note_type)) && importInvoiceIds.has(String(row.original_invoice_id ?? "")) })),
    ];
    setGroups((summaryResult.data ?? []) as SummaryGroup[]);
    setDetails((detailResult.data ?? []) as DetailLine[]);
    setDocuments(sourceDocuments.filter((document) => document.items.length > 0).sort((first, second) => first.date.localeCompare(second.date)));
    setClassifications((classResult.data ?? []) as Classification[]);
    setReconciliation((reconciliationResult.data ?? []) as ReconciliationRow[]);
    setLoading(false);
  };

  useEffect(() => { void load(); }, [dateFrom, dateTo]);

  const classifiedCount = useMemo(() => {
    const result = new Map<string, number>();
    classifications.forEach((item) => { const key = `${item.document_table}:${item.document_id}`; result.set(key, (result.get(key) ?? 0) + 1); });
    return result;
  }, [classifications]);
  const unclassified = documents.filter((document) => (classifiedCount.get(`${document.table}:${document.id}`) ?? 0) !== document.items.length);
  // المستندات المرحّلة غير المصنفة تسقط من الإقرار بصمت، لذلك يُحجب صافي الضريبة حتى تُصنَّف.
  const unclassifiedPosted = unclassified.filter((document) => document.eligible);
  const returnBoxes = useMemo<ReturnBox[]>(() => {
    const pick = (side: string, categories: string[], supplies?: string[]) =>
      groups.filter((group) => group.document_side === side && categories.includes(group.tax_category) && (!supplies || supplies.includes(group.supply_type)));
    const sum = (rows: SummaryGroup[]) => ({
      base: Math.round(rows.reduce((total, group) => total + number(group.taxable_amount), 0) * 100) / 100,
      tax: Math.round(rows.reduce((total, group) => total + number(group.tax_amount), 0) * 100) / 100,
    });
    const box1 = sum(pick("sales", ["standard"]));
    const box3 = sum(pick("sales", ["zero_rated"], ["domestic"]));
    const box4 = sum(pick("sales", ["zero_rated"], ["export"]));
    const box5 = sum(pick("sales", ["exempt"]));
    const box7 = sum(pick("purchases", ["standard"], ["domestic"]));
    const box8 = sum(pick("purchases", ["standard"], ["import"]));
    const box9 = sum(pick("purchases", ["standard"], ["reverse_charge"]));
    const box10 = sum(pick("purchases", ["zero_rated"]));
    const box11 = sum(pick("purchases", ["exempt"]));
    const add = (...values: { base: number; tax: number }[]) => ({
      base: Math.round(values.reduce((total, value) => total + value.base, 0) * 100) / 100,
      tax: Math.round(values.reduce((total, value) => total + value.tax, 0) * 100) / 100,
    });
    const box6 = add(box1, box3, box4, box5);
    const box12 = add(box7, box8, box9, box10, box11);
    // ضريبة الاحتساب العكسي (الخانة 9) تُحتسب مخرجات ومدخلات معًا، فأثرها على الصافي صفر
    const net = Math.round((box6.tax + box9.tax - box12.tax) * 100) / 100;
    return [
      { box: "1", label: "المبيعات الخاضعة للنسبة الأساسية", ...box1 },
      { box: "2", label: "المبيعات للعملاء المسجلين في دول مجلس التعاون المطبقة للضريبة", base: 0, tax: 0, note: "لا ينطبق" },
      { box: "3", label: "المبيعات المحلية الخاضعة للنسبة الصفرية", ...box3 },
      { box: "4", label: "الصادرات", ...box4 },
      { box: "5", label: "المبيعات المعفاة", ...box5 },
      { box: "6", label: "إجمالي المبيعات", ...box6 },
      { box: "7", label: "المشتريات الخاضعة للنسبة الأساسية", ...box7 },
      { box: "8", label: "الاستيرادات الخاضعة للضريبة والمدفوعة في الجمارك", ...box8 },
      { box: "9", label: "الاستيرادات الخاضعة للضريبة بآلية الاحتساب العكسي", ...box9, note: "تُحتسب مخرجات ومدخلات معًا" },
      { box: "10", label: "المشتريات الخاضعة للنسبة الصفرية", ...box10 },
      { box: "11", label: "المشتريات المعفاة", ...box11 },
      { box: "12", label: "إجمالي المشتريات", ...box12 },
      { box: "13", label: net < 0 ? "صافي الضريبة القابلة للاسترداد عن الفترة" : "إجمالي ضريبة القيمة المضافة المستحقة عن الفترة", base: 0, tax: net },
    ];
  }, [groups]);
  const summaryRows = useMemo<ReportRow[]>(() => returnBoxes.map((row) => ({
    box: row.box,
    label: t(row.label),
    base: row.box === "13" ? "—" : money(row.base),
    tax: row.box === "13" && unclassifiedPosted.length
      ? `${t("غير مكتمل")} — ${t("مستندات مرحّلة غير مصنفة")}: ${unclassifiedPosted.length}`
      : money(row.tax),
    note: row.note ? t(row.note) : "",
  })), [returnBoxes, formatNumber, t, unclassifiedPosted.length]);
  const groupRows = useMemo<ReportRow[]>(() => {
    const rows = groups.map((group) => ({
      side: t(group.document_side === "sales" ? "مبيعات" : "مشتريات"),
      category: t(categoryNames[group.tax_category] ?? group.tax_category),
      supply: t(supplyNames[group.supply_type] ?? group.supply_type),
      documents: number(group.document_count),
      base: money(number(group.taxable_amount)),
      tax: money(number(group.tax_amount)),
    }));
    // التوريدات خارج نطاق الضريبة تظهر هنا للتفصيل فقط، ولا تدخل في خانات الإقرار.
    return rows;
  }, [groups, formatNumber, t]);

  const statusNames: Record<string, string> = { matched: "متطابق", missing_journal: "قيد محاسبي مفقود", missing_classification: "تصنيف ضريبي مفقود", partial_classification: "تصنيف غير مكتمل", document_tax_mismatch: "التصنيف لا يطابق المستند", journal_tax_mismatch: "القيد لا يطابق المستند" };
  const columns: ReportColumn[] = mode === "details"
    ? [{ key: "date", label: t("التاريخ") }, { key: "document", label: t("المستند") }, { key: "description", label: t("الوصف") }, { key: "side", label: t("النوع") }, { key: "category", label: t("الفئة الضريبية") }, { key: "supply", label: t("نوع التوريد") }, { key: "base", label: t("المبلغ الخاضع") }, { key: "tax", label: t("الضريبة") }]
    : mode === "reconciliation"
      ? [{ key: "date", label: t("التاريخ") }, { key: "document", label: t("المستند") }, { key: "type", label: t("نوع المستند") }, { key: "counterparty", label: t("جهة التعامل") }, { key: "documentTax", label: t("ضريبة المستند SAR") }, { key: "classifiedTax", label: t("ضريبة التقرير SAR") }, { key: "journalTax", label: t("ضريبة القيد SAR") }, { key: "lines", label: t("البنود المصنفة") }, { key: "status", label: t("حالة المطابقة") }, { key: "reason", label: t("سبب عدم المطابقة") }]
      : [{ key: "box", label: t("الخانة") }, { key: "label", label: t("البيان") }, { key: "base", label: t("المبلغ SAR") }, { key: "tax", label: t("ضريبة القيمة المضافة SAR") }, { key: "note", label: t("ملاحظة") }];
  const groupColumns: ReportColumn[] = [{ key: "side", label: t("النوع") }, { key: "category", label: t("الفئة الضريبية") }, { key: "supply", label: t("نوع التوريد") }, { key: "documents", label: t("عدد المستندات") }, { key: "base", label: t("المبلغ الخاضع للضريبة SAR") }, { key: "tax", label: t("مبلغ الضريبة SAR") }];
  // رقم المستند كما يعرفه المستخدم (الإشعارات والبيانات الجمركية معرّفاتها داخلية)
  const documentNumbers = new Map(reconciliation.map((row) => [`${row.document_table}:${row.document_id}`, row.document_number] as [string, string]));
  const detailRows: ReportRow[] = details.map((line) => ({ date: line.document_date, document: documentNumbers.get(`${line.document_table}:${line.document_id}`) ?? line.document_id, description: line.line_description || "—", side: t(line.document_side === "sales" ? "مبيعات" : "مشتريات"), category: t(categoryNames[line.tax_category] ?? line.tax_category), supply: t(supplyNames[line.supply_type] ?? line.supply_type), base: money(number(line.taxable_amount)), tax: money(number(line.tax_amount)) }));
  const reconciliationRows: ReportRow[] = reconciliation.map((row) => ({ date: row.document_date, document: row.document_number, type: t(documentTypeNames[row.document_type] ?? row.document_type), counterparty: row.counterparty || "—", documentTax: money(number(row.document_tax)), classifiedTax: money(number(row.classified_tax)), journalTax: money(number(row.journal_tax)), lines: `${number(row.classification_count)} / ${number(row.item_count)}`, status: t(statusNames[row.reconciliation_status] ?? row.reconciliation_status), reason: t(reasonNames[row.reconciliation_reason_code] ?? row.reconciliation_reason_code ?? row.reconciliation_status) }));
  const exportRows = mode === "details" ? detailRows : mode === "reconciliation" ? reconciliationRows : summaryRows;
  const reportTitle = mode === "details" ? t("تفاصيل ضريبة القيمة المضافة") : mode === "reconciliation" ? t("مطابقة الضريبة والمحاسبة") : t("ملخص ضريبة القيمة المضافة");
  const exportDisclaimer = [`${dateFrom} — ${dateTo}`, t("تقرير داخلي"), `${t("المستندات غير المصنفة")}: ${unclassified.length}`, `${t("منها مرحّلة")}: ${unclassifiedPosted.length}`, t("لا يستخدم كإقرار ضريبي رسمي")].join(" | ");
  const exportOptions = { title: reportTitle, subtitle: exportDisclaimer, columns, rows: exportRows, fileName: reportTitle, landscape: true, brand: COMPANY_REPORT_BRAND };

  const openClassification = (document: SourceDocument) => {
    setSelectedDocument(document);
    setDraft(document.items.map((_, lineIndex) => ({ lineIndex, taxCategory: "", supplyType: "" })));
    setError("");
  };
  const saveClassification = async () => {
    if (!selectedDocument || draft.some((item) => !item.taxCategory || !item.supplyType)) { setError(t("يجب اختيار الفئة الضريبية ونوع التوريد لكل بند")); return; }
    setSaving(true); setError("");
    const { error: saveError } = await supabase.rpc("save_vat_document_classification", { p_document_table: selectedDocument.table, p_document_id: selectedDocument.id, p_lines: draft });
    setSaving(false);
    if (saveError) {
      const message = String(saveError.message ?? "");
      setError(
        message.includes("VAT_LINE_OUT_OF_SCOPE_ONLY") ? t("هذا البند خارج نطاق الإقرار: إشعار على فاتورة مورد غير مقيم أو جمارك مدفوعة نيابة عنا؛ اختر «خارج النطاق»")
        : message.includes("VAT_IMPORT_CLASSIFICATION_AUTOMATIC_ONLY") ? t("الاستيراد والاحتساب العكسي يُصنَّفان تلقائيًا من البيان الجمركي وفاتورة المورد غير المقيم")
        : message.includes("VAT_AUTOMATIC_CLASSIFICATION_LOCKED") ? t("تصنيف هذا المستند تلقائي ولا يُعدَّل يدويًا")
        : message,
      );
      return;
    }
    setSelectedDocument(null); await load();
  };

  return <Layout><main dir={direction} className="min-h-full bg-slate-50 p-4"><div className="mx-auto max-w-[1500px] overflow-hidden rounded border border-slate-200 bg-white shadow-sm">
    <header className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-red-700 px-4 py-3"><div><p className="text-[11px] text-slate-400">{t("التقارير")}</p><h1 className="text-base font-bold">{t("تقارير ضريبة القيمة المضافة")}</h1></div><div className="flex gap-1"><button onClick={() => void load()} className="rounded border p-2"><RefreshCw className="h-4 w-4" /></button>{mode !== "classification" && <><button onClick={() => printReport(exportOptions)} className="rounded border p-2"><Printer className="h-4 w-4" /></button><button onClick={() => exportReportExcel(exportOptions)} className="rounded border p-2"><Download className="h-4 w-4" /></button></>}</div></header>
    <div className="flex flex-wrap items-center justify-between gap-3 border-y bg-slate-50 px-4 py-3"><div className="flex rounded bg-slate-200/60 p-1"><button onClick={() => setMode("summary")} className={`rounded px-3 py-1.5 text-xs ${mode === "summary" ? "bg-white font-bold shadow" : ""}`}>{t("ملخص")}</button><button onClick={() => setMode("details")} className={`rounded px-3 py-1.5 text-xs ${mode === "details" ? "bg-white font-bold shadow" : ""}`}>{t("تفاصيل")}</button><button onClick={() => setMode("reconciliation")} className={`rounded px-3 py-1.5 text-xs ${mode === "reconciliation" ? "bg-white font-bold shadow" : ""}`}><ShieldCheck className="me-1 inline h-3 w-3" />{t("المطابقة")} ({reconciliation.filter((row) => row.reconciliation_status !== "matched").length})</button><button onClick={() => setMode("classification")} className={`rounded px-3 py-1.5 text-xs ${mode === "classification" ? "bg-white font-bold shadow" : ""}`}><Tags className="me-1 inline h-3 w-3" />{t("التصنيف")} ({unclassified.length})</button></div><div className="flex gap-2"><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="rounded border px-2 py-1.5 text-xs" /><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="rounded border px-2 py-1.5 text-xs" /></div></div>
    {error && <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{error}</div>}
    <section className="p-4">{loading ? <p className="py-20 text-center text-sm text-slate-500">{t("جاري التحميل...")}</p> : mode === "classification" ? <div><p className="mb-3 text-xs text-slate-500">{t("لن تُدرج المستندات غير المصنفة في التقرير الرسمي، ولا يتم استنتاج الإعفاء أو التصدير من نسبة الصفر.")}</p><div className="overflow-x-auto"><table className="min-w-full text-xs"><thead className="bg-slate-100"><tr><th className="px-3 py-2">{t("التاريخ")}</th><th className="px-3 py-2">{t("المستند")}</th><th className="px-3 py-2">{t("جهة التعامل")}</th><th className="px-3 py-2">{t("عدد البنود")}</th><th className="px-3 py-2">{t("حالة الترحيل")}</th><th /></tr></thead><tbody>{unclassified.length ? unclassified.map((document) => <tr key={`${document.table}:${document.id}`} className="border-b"><td className="px-3 py-2 text-center">{document.date}</td><td className="px-3 py-2 text-center">{document.number}</td><td className="px-3 py-2">{document.counterparty || "—"}</td><td className="px-3 py-2 text-center">{document.items.length}</td><td className="px-3 py-2 text-center"><span className={`rounded px-2 py-1 ${document.eligible ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{t(document.eligible ? "مرحّل وقابل للإدراج" : "غير مرحّل — غير مدرج")}</span></td><td className="px-3 py-2 text-center"><button onClick={() => openClassification(document)} className="rounded bg-blue-700 px-3 py-1.5 text-white">{t("تصنيف البنود")}</button></td></tr>) : <tr><td colSpan={6} className="py-12 text-center text-slate-400">{t("تم تصنيف جميع المستندات في الفترة")}</td></tr>}</tbody></table></div></div> : <><div className="mb-3 flex items-center gap-2 rounded bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><ShieldCheck className="h-4 w-4" />{t("يعرض التقرير المستندات المصنفة والمرحلة فقط")}</div>{unclassifiedPosted.length > 0 && <div className="mb-3 flex items-start gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{t("يوجد مستندات مرحّلة لم تُصنَّف ضريبيًا ولن تظهر في الأرقام أدناه؛ صافي الضريبة محجوب حتى يكتمل التصنيف")}: {unclassifiedPosted.length} <button onClick={() => setMode("classification")} className="ms-2 underline">{t("فتح التصنيف")}</button></span></div>}<div className="mb-3 rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">{t("تشمل الأرقام فواتير المبيعات والمشتريات والإشعارات والبيانات الجمركية المرحّلة والمصنفة فقط؛ التوريدات خارج النطاق لا تدخل في الإجماليات. ضريبة المدخلات لا تُخصم إلا بفاتورة ضريبية صحيحة من مورد مسجل، أو ببيان جمركي باسم الشركة، أو بالاحتساب العكسي.")}</div><div className="overflow-x-auto"><table className="min-w-full text-xs"><thead className="bg-slate-100"><tr>{columns.map((column) => <th key={column.key} className="px-3 py-2 text-center">{column.label}</th>)}</tr></thead><tbody>{exportRows.length ? exportRows.map((row, index) => <tr key={index} className={`border-b ${mode === "summary" && ["6", "12", "13"].includes(String(row.box)) ? "bg-slate-50 font-bold" : ""}`}>{columns.map((column) => <td key={column.key} className="px-3 py-2 text-center">{row[column.key] ?? "—"}</td>)}</tr>) : <tr><td colSpan={columns.length} className="py-16 text-center text-slate-400">{t("لا توجد بيانات ضريبية مصنفة ومرحلة للفترة")}</td></tr>}</tbody></table></div>{mode === "summary" && <div className="mt-6"><p className="mb-2 text-xs font-semibold text-slate-600">{t("التفصيل حسب الفئة الضريبية ونوع التوريد")}</p><div className="overflow-x-auto"><table className="min-w-full text-xs"><thead className="bg-slate-100"><tr>{groupColumns.map((column) => <th key={column.key} className="px-3 py-2 text-center">{column.label}</th>)}</tr></thead><tbody>{groupRows.length ? groupRows.map((row, index) => <tr key={index} className="border-b">{groupColumns.map((column) => <td key={column.key} className="px-3 py-2 text-center">{row[column.key] ?? "—"}</td>)}</tr>) : <tr><td colSpan={groupColumns.length} className="py-8 text-center text-slate-400">{t("لا توجد بيانات ضريبية مصنفة ومرحلة للفترة")}</td></tr>}</tbody></table></div></div>}</>}</section>
  </div>
  {selectedDocument && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={() => setSelectedDocument(null)}><section className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-xl bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><header className="flex items-center justify-between border-b px-5 py-4"><div><h2 className="font-bold">{t("تصنيف بنود الضريبة")}</h2><p className="text-xs text-slate-500">{selectedDocument.number}</p></div><button onClick={() => setSelectedDocument(null)}><X className="h-5 w-5" /></button></header><div className="overflow-x-auto p-5"><table className="min-w-full text-xs"><thead className="bg-slate-100"><tr><th className="px-3 py-2">{t("البند")}</th><th className="px-3 py-2">{t("نسبة الضريبة")}</th><th className="px-3 py-2">{t("الفئة الضريبية")}</th><th className="px-3 py-2">{t("نوع التوريد")}</th></tr></thead><tbody>{selectedDocument.items.map((item, index) => <tr key={index} className="border-b"><td className="px-3 py-2">{item.description || `#${index + 1}`}</td><td className="px-3 py-2 text-center">{item.taxPercent}%</td><td className="px-3 py-2"><select value={draft[index]?.taxCategory ?? ""} onChange={(event) => setDraft((current) => current.map((value, row) => row === index ? { ...value, taxCategory: event.target.value } : value))} className="w-full rounded border p-2"><option value="">{t("تحديد")}</option>{selectedDocument.side === "purchases" && (selectedDocument.outOfScopeOnly || item.accountCode === CUSTOMS_CLEARING_ACCOUNT) ? <option value="out_of_scope">{t("خارج النطاق")}</option> : <>{item.taxPercent === 15 && <option value="standard">{t("النسبة الأساسية 15%")}</option>}{item.taxPercent === 0 && <><option value="zero_rated">{t("نسبة صفر")}</option><option value="exempt">{t("معفى")}</option><option value="out_of_scope">{t("خارج النطاق")}</option></>}</>}</select></td><td className="px-3 py-2"><select value={draft[index]?.supplyType ?? ""} onChange={(event) => setDraft((current) => current.map((value, row) => row === index ? { ...value, supplyType: event.target.value } : value))} className="w-full rounded border p-2"><option value="">{t("تحديد")}</option><option value="domestic">{t("محلي")}</option>{selectedDocument.side === "sales" && <option value="export">{t("تصدير")}</option>}{/* الاستيراد والاحتساب العكسي (الخانتان 8 و9) يُصنَّفان تلقائيًا فقط من البيان الجمركي وفاتورة المورد غير المقيم */}</select></td></tr>)}</tbody></table></div><footer className="flex justify-end gap-2 border-t px-5 py-4"><button onClick={() => setSelectedDocument(null)} className="rounded border px-4 py-2 text-sm">{t("إلغاء")}</button><button disabled={saving} onClick={() => void saveClassification()} className="rounded bg-blue-700 px-4 py-2 text-sm text-white disabled:opacity-50">{saving ? t("جاري الحفظ...") : t("حفظ التصنيف")}</button></footer></section></div>}
  </main></Layout>;
}
