import Layout from "@/components/Layout";
import { purchasesFeatures } from "./Purchases";
import { Archive, ArrowRight, Link2, Plus, Printer, Save, Trash2, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n";
import { supabase } from "@/lib/supabaseClient";
import { COMPANY_PROFILE } from "@/lib/companyProfile";
import { escapeHtml, riyadhDateString, SAUDI_STANDARD_VAT_RATE } from "@/lib/utils";
import { canManagePerm } from "@/lib/authSession";
import { useRolePermissions } from "@/hooks/useRolePermissions";

// طلب إشعار دائن من المورد: مستند نرسله للمورد نطلب فيه تخفيضًا أو إرجاعًا.
// لا يُرحَّل ولا يغيّر رصيد المورد أو الضريبة؛ الأثر المحاسبي يأتي فقط من إشعار المورد الدائن عند وصوله.

// تقريب لخانتين مطابق لـ round(x, 2) في القاعدة
const round2 = (value: number) => {
  const rounded = Math.round(Number((Math.abs(value) * 100).toFixed(6))) / 100;
  return value < 0 ? -rounded : rounded;
};

type RequestItem = { id: string; description: string; quantity: number; unitPrice: number };

type CreditRequest = {
  id: string;
  number: string;
  invoiceId: string;
  vendor: string;
  date: string;
  reason: string;
  items: RequestItem[];
  subtotal: number;
  tax: number;
  total: number;
  status: "open" | "fulfilled" | "cancelled";
  noteNumber: string;
  fulfilledNoteId: string;
  cancelledReason: string;
};

// إشعار مورد مسجَّل على فاتورة الطلب ولم يُربط بطلب بعد
type LinkableNote = { id: string; number: string; supplierDocument: string; supplierDate: string; total: number };

type InvoiceOption = { id: string; vendor: string; date: string; totalTax: number; adjustedTotal: number };

const emptyItem = (): RequestItem => ({ id: crypto.randomUUID(), description: "", quantity: 1, unitPrice: 0 });

const requestErrorText = (message: string, t: (key: string) => string) => {
  const map: [string, string][] = [
    ["PURCHASE_CREDIT_REQUEST_PERMISSION_REQUIRED", "إصدار الطلبات يحتاج صلاحية إدارة الإشعارات المدينة للمشتريات"],
    ["PURCHASE_CREDIT_REQUEST_DATE_INVALID", "تاريخ الطلب لا يسبق الفاتورة ولا يكون في المستقبل"],
    ["PURCHASE_CREDIT_REQUEST_REASON_REQUIRED", "اكتب سبب الطلب"],
    ["PURCHASE_CREDIT_REQUEST_AMOUNTS_INVALID", "مبلغ الطلب أو ضريبته يتجاوز الفاتورة"],
    ["PURCHASE_CREDIT_REQUEST_NOT_OPEN", "الطلب لم يعد مفتوحًا"],
    ["POSTED_PURCHASE_INVOICE_REQUIRED", "الفاتورة غير مرحّلة محاسبيًا"],
    ["ACCOUNTING_MANAGE_PERMISSION_REQUIRED", "ربط الطلب بإشعار المورد يحتاج صلاحية إدارة المحاسبة"],
    ["PURCHASE_CREDIT_REQUEST_INVALID", "الطلب لم يعد مفتوحًا"],
    ["PURCHASE_CREDIT_NOTE_LINK_INVALID", "الإشعار المختار ليس إشعار مورد مرحّلًا على فاتورة الطلب نفسها"],
    ["PURCHASE_CREDIT_NOTE_ALREADY_LINKED", "إشعار المورد هذا مربوط بطلب آخر"],
    ["purchase_credit_requests_fulfilled_note_uidx", "إشعار المورد هذا مربوط بطلب آخر"],
  ];
  const hit = map.find(([code]) => message.includes(code));
  return hit ? t(hit[1]) : message;
};

export default function PurchaseCreditRequests() {
  const { t, direction, formatDate, formatNumber } = useI18n();
  const formatAmount = (value: number) => formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const { permissions } = useRolePermissions();
  const canManage = ["purchases.debit_notes", "module.purchases"].some((key) => canManagePerm(permissions, key));
  // ربط الطلب بإشعار المورد للمحاسبة (مثل تسجيل الإشعار نفسه: accounting_access_allowed)
  const canLink = ["accounting.tax_reports", "accounting.accounts", "module.accounting"].some((key) => canManagePerm(permissions, key));
  const today = riyadhDateString();
  const [mode, setMode] = useState<"list" | "create">("list");
  const [rows, setRows] = useState<CreditRequest[]>([]);
  const [invoices, setInvoices] = useState<InvoiceOption[]>([]);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [invoiceId, setInvoiceId] = useState("");
  const [requestDate, setRequestDate] = useState(today);
  const [reason, setReason] = useState("");
  const [items, setItems] = useState<RequestItem[]>([emptyItem()]);
  const [saving, setSaving] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [linkTarget, setLinkTarget] = useState<string | null>(null);
  const [linkNotes, setLinkNotes] = useState<LinkableNote[] | null>(null);
  const [linkNoteId, setLinkNoteId] = useState("");
  // يتجاهل نتيجة تحميل قديمة إذا فُتح الربط لطلب آخر في الأثناء
  const linkRequestRef = useRef<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const [requestsResult, invoicesResult] = await Promise.all([
        supabase
          .from("purchase_credit_requests")
          .select("id, request_number, invoice_id, request_date, reason, items, subtotal, tax, total, status, fulfilled_note_id, cancelled_reason")
          .order("created_at", { ascending: false }),
        supabase
          .from("purchase_invoices")
          .select("id, vendor, date, total_tax, adjusted_total, subtotal")
          .eq("accounting_status", "posted")
          .order("date", { ascending: false }),
      ]);
      if (!active) return;
      if (requestsResult.error || invoicesResult.error) {
        setLoadError((requestsResult.error ?? invoicesResult.error)?.message ?? "");
        return;
      }
      setLoadError("");
      const invoiceRows = (invoicesResult.data ?? []).map((row: any) => ({
        id: String(row.id),
        vendor: String(row.vendor ?? ""),
        date: String(row.date ?? ""),
        totalTax: Number(row.total_tax) || 0,
        adjustedTotal: Number(row.adjusted_total ?? (Number(row.subtotal) || 0) + (Number(row.total_tax) || 0)) || 0,
      }));
      setInvoices(invoiceRows);
      const noteIds = (requestsResult.data ?? []).map((row: any) => row.fulfilled_note_id).filter(Boolean);
      const noteNumbers = new Map<string, string>();
      if (noteIds.length > 0) {
        const { data } = await supabase.from("invoice_adjustment_notes").select("id, note_number").in("id", noteIds);
        (data ?? []).forEach((note: any) => noteNumbers.set(String(note.id), String(note.note_number)));
      }
      if (!active) return;
      const vendorByInvoice = new Map(invoiceRows.map((invoice) => [invoice.id, invoice.vendor]));
      setRows(
        (requestsResult.data ?? []).map((row: any) => ({
          id: String(row.id),
          number: String(row.request_number),
          invoiceId: String(row.invoice_id),
          vendor: vendorByInvoice.get(String(row.invoice_id)) ?? "",
          date: String(row.request_date ?? ""),
          reason: String(row.reason ?? ""),
          items: Array.isArray(row.items) ? row.items : [],
          subtotal: Number(row.subtotal) || 0,
          tax: Number(row.tax) || 0,
          total: Number(row.total) || 0,
          status: row.status === "fulfilled" || row.status === "cancelled" ? row.status : "open",
          noteNumber: noteNumbers.get(String(row.fulfilled_note_id ?? "")) ?? "",
          fulfilledNoteId: String(row.fulfilled_note_id ?? ""),
          cancelledReason: String(row.cancelled_reason ?? ""),
        })),
      );
    };
    void load();
    return () => {
      active = false;
    };
  }, [reload]);

  const selectedInvoice = invoices.find((invoice) => invoice.id === invoiceId);
  // نسبة ضريبة الطلب من الفاتورة: فاتورة بلا ضريبة ⇐ طلب بلا ضريبة
  const taxRate = selectedInvoice && selectedInvoice.totalTax > 0 ? SAUDI_STANDARD_VAT_RATE : 0;
  const subtotal = useMemo(
    () => round2(items.reduce((sum, item) => sum + round2((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0)), 0)),
    [items],
  );
  const tax = round2((subtotal * taxRate) / 100);
  const total = round2(subtotal + tax);

  const resetForm = () => {
    setInvoiceId("");
    setRequestDate(today);
    setReason("");
    setItems([emptyItem()]);
  };

  const handleSave = async () => {
    if (inFlight.current || !canManage) return;
    if (!selectedInvoice) {
      toast({ title: t("اختر فاتورة المورد") });
      return;
    }
    if (!reason.trim()) {
      toast({ title: t("اكتب سبب الطلب") });
      return;
    }
    if (items.some((item) => !item.description.trim() || !(Number(item.quantity) > 0) || !(Number(item.unitPrice) > 0))) {
      toast({ title: t("بنود الطلب غير مكتملة"), description: t("كل بند يحتاج وصفًا وكمية وسعرًا أكبر من صفر") });
      return;
    }
    if (!requestDate || requestDate > today || requestDate < selectedInvoice.date) {
      toast({ title: t("تاريخ الطلب لا يسبق الفاتورة ولا يكون في المستقبل") });
      return;
    }
    if (total <= 0 || total > selectedInvoice.adjustedTotal + 0.01) {
      toast({ title: t("مبلغ الطلب أو ضريبته يتجاوز الفاتورة") });
      return;
    }
    inFlight.current = true;
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("create_purchase_credit_request", {
        p_invoice_id: selectedInvoice.id,
        p_request_date: requestDate,
        p_reason: reason.trim(),
        p_items: items.map((item) => ({
          description: item.description.trim(),
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          taxPercent: taxRate,
        })),
        p_subtotal: subtotal,
        p_tax: tax,
        p_total: total,
      });
      if (error) {
        toast({ title: t("تعذّر حفظ الطلب"), description: requestErrorText(String(error.message ?? ""), t), variant: "destructive" });
        return;
      }
      toast({ title: t("تم حفظ طلب الإشعار"), description: String((data as { request_number?: string } | null)?.request_number ?? "") });
      resetForm();
      setMode("list");
      setReload((value) => value + 1);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  const handleCancel = async () => {
    if (!cancelTarget || inFlight.current || !canManage) return;
    if (!cancelReason.trim()) {
      toast({ title: t("اكتب سبب الإلغاء") });
      return;
    }
    inFlight.current = true;
    setSaving(true);
    try {
      const { error } = await supabase.rpc("cancel_purchase_credit_request", { p_request_id: cancelTarget, p_reason: cancelReason.trim() });
      if (error) {
        toast({ title: t("تعذّر إلغاء الطلب"), description: requestErrorText(String(error.message ?? ""), t), variant: "destructive" });
        return;
      }
      toast({ title: t("تم إلغاء الطلب") });
      setCancelTarget(null);
      setCancelReason("");
      setReload((value) => value + 1);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  const openLink = async (request: CreditRequest) => {
    setCancelTarget(null);
    setLinkTarget(request.id);
    setLinkNoteId("");
    setLinkNotes(null);
    linkRequestRef.current = request.id;
    const { data, error } = await supabase
      .from("invoice_adjustment_notes")
      .select("id, note_number, supplier_document_number, supplier_document_date, total")
      .eq("note_type", "purchase_credit")
      .eq("status", "posted")
      .eq("original_invoice_table", "purchase_invoices")
      .eq("original_invoice_id", request.invoiceId)
      .not("supplier_document_number", "is", null)
      .order("created_at", { ascending: false });
    if (linkRequestRef.current !== request.id) return;
    if (error) {
      toast({ title: t("تعذّر تحميل إشعارات المورد"), description: String(error.message ?? ""), variant: "destructive" });
      setLinkTarget(null);
      return;
    }
    const linked = new Set(rows.map((row) => row.fulfilledNoteId).filter(Boolean));
    setLinkNotes(
      (data ?? [])
        .filter((note: any) => !linked.has(String(note.id)))
        .map((note: any) => ({
          id: String(note.id),
          number: String(note.note_number),
          supplierDocument: String(note.supplier_document_number ?? ""),
          supplierDate: String(note.supplier_document_date ?? ""),
          total: Number(note.total) || 0,
        })),
    );
  };

  const handleLink = async () => {
    if (!linkTarget || !linkNoteId || inFlight.current || !canLink) return;
    inFlight.current = true;
    setSaving(true);
    try {
      const { error } = await supabase.rpc("link_purchase_credit_request", { p_request_id: linkTarget, p_note_id: linkNoteId });
      if (error) {
        toast({ title: t("تعذّر ربط الطلب"), description: requestErrorText(String(error.message ?? ""), t), variant: "destructive" });
        // نغلق لوحة الربط ونعيد تحميل الطلبات حتى لا يُعاد الاختيار من قائمة قديمة
        setLinkTarget(null);
        setLinkNotes(null);
        setLinkNoteId("");
        setReload((value) => value + 1);
        return;
      }
      toast({ title: t("تم ربط الطلب بإشعار المورد") });
      setLinkTarget(null);
      setLinkNotes(null);
      setLinkNoteId("");
      setReload((value) => value + 1);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  const printRequest = (request: CreditRequest) => {
    const win = window.open("", "_blank");
    if (!win) return;
    const lines = request.items
      .map(
        (item, index) =>
          `<tr><td>${index + 1}</td><td>${escapeHtml(item.description)}</td><td>${escapeHtml(formatNumber(Number(item.quantity) || 0))}</td><td>${escapeHtml(formatAmount(Number(item.unitPrice) || 0))}</td><td>${escapeHtml(formatAmount(round2((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0))))}</td></tr>`,
      )
      .join("");
    win.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${escapeHtml(request.number)}</title>
      <style>body{font-family:Tahoma,Arial,sans-serif;padding:32px;color:#1e293b}h1{font-size:20px;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin-top:16px}
      th,td{border:1px solid #cbd5e1;padding:6px 8px;font-size:13px;text-align:right}th{background:#f1f5f9}.muted{color:#64748b;font-size:12px}.totals{margin-top:12px;width:320px}
      .note{margin-top:18px;padding:10px;border:1px dashed #94a3b8;font-size:12px}</style></head><body>
      <h1>${escapeHtml(COMPANY_PROFILE.companyNameAr)}</h1>
      <div class="muted">${escapeHtml(COMPANY_PROFILE.addressAr)} — ${escapeHtml(t("الرقم الضريبي"))}: ${escapeHtml(COMPANY_PROFILE.vatNumber)}</div>
      <h2 style="font-size:18px;margin-top:20px">${escapeHtml(t("طلب إشعار دائن من المورد"))} ${escapeHtml(request.number)}</h2>
      <div>${escapeHtml(t("المورد"))}: <b>${escapeHtml(request.vendor)}</b></div>
      <div>${escapeHtml(t("فاتورة المورد لدينا"))}: ${escapeHtml(request.invoiceId)} — ${escapeHtml(t("تاريخ الطلب"))}: ${escapeHtml(request.date)}</div>
      <div>${escapeHtml(t("السبب"))}: ${escapeHtml(request.reason)}</div>
      <table><thead><tr><th>#</th><th>${escapeHtml(t("الوصف"))}</th><th>${escapeHtml(t("الكمية"))}</th><th>${escapeHtml(t("السعر"))}</th><th>${escapeHtml(t("المجموع"))}</th></tr></thead><tbody>${lines}</tbody></table>
      <table class="totals"><tr><th>${escapeHtml(t("المجموع الفرعي"))}</th><td>${escapeHtml(formatAmount(request.subtotal))}</td></tr>
      <tr><th>${escapeHtml(t("ضريبة القيمة المضافة"))}</th><td>${escapeHtml(formatAmount(request.tax))}</td></tr>
      <tr><th>${escapeHtml(t("الإجمالي المطلوب"))}</th><td><b>${escapeHtml(formatAmount(request.total))} SAR</b></td></tr></table>
      <div class="note">${escapeHtml(t("نرجو إصدار إشعار دائن ضريبي بهذه القيمة على الفاتورة المذكورة. هذا الطلب ليس مستندًا ضريبيًا ولا يُقيَّد في الحسابات."))}</div>
      <script>window.onload=function(){window.print();}</script></body></html>`);
    win.document.close();
  };

  const statusBadge = (request: CreditRequest) =>
    request.status === "fulfilled" ? (
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">
        {t("وصل إشعار المورد")} {request.noteNumber}
      </span>
    ) : request.status === "cancelled" ? (
      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-bold text-slate-700" title={request.cancelledReason}>
        {t("ملغى")}
      </span>
    ) : (
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">{t("بانتظار إشعار المورد")}</span>
    );

  return (
    <Layout subMenu={{ title: t("المشتريات"), items: purchasesFeatures }}>
      <div dir={direction} className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-foreground">{t("طلبات إشعار دائن من الموردين")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("طلب نرسله للمورد ليصدر إشعارًا دائنًا؛ لا يُقيَّد في الحسابات، ويُغلق عند تسجيل إشعار المورد في «الإشعارات الدائنة».")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {mode === "list" ? (
              <>
                <Link
                  to="/purchases/debit-notes/archive"
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium"
                >
                  <Archive className="h-4 w-4" />
                  {t("الإشعارات المدينة السابقة")}
                </Link>
                {canManage && (
                  <button
                    onClick={() => { resetForm(); setMode("create"); }}
                    className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white"
                  >
                    <Plus className="h-4 w-4" />
                    {t("طلب إشعار دائن جديد")}
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  onClick={() => setMode("list")}
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium"
                >
                  <ArrowRight className={`h-4 w-4 ${direction === "ltr" ? "rotate-180" : ""}`} />
                  {t("الرجوع إلى الطلبات")}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  <Save className="h-4 w-4" />
                  {t("حفظ الطلب")}
                </button>
              </>
            )}
          </div>
        </div>

        {loadError && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{loadError}</p>}

        {mode === "list" ? (
          <div className="space-y-4 rounded-xl border border-border bg-card p-4">
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("لا توجد طلبات حاليًا.")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className={`w-full min-w-[820px] text-sm ${direction === "rtl" ? "text-right" : "text-left"}`}>
                  <thead>
                    <tr className="bg-muted/40">
                      <th className="px-3 py-2">{t("رقم الطلب")}</th>
                      <th className="px-3 py-2">{t("الفاتورة")}</th>
                      <th className="px-3 py-2">{t("المورد")}</th>
                      <th className="px-3 py-2">{t("التاريخ")}</th>
                      <th className="px-3 py-2">{t("الإجمالي")}</th>
                      <th className="px-3 py-2">{t("الحالة")}</th>
                      <th className="px-3 py-2">{t("الإجراءات")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((request) => (
                      <tr key={request.id} className="border-t border-border align-top">
                        <td className="px-3 py-2 font-semibold text-primary">{request.number}</td>
                        <td className="px-3 py-2">{request.invoiceId}</td>
                        <td className="px-3 py-2">{request.vendor}</td>
                        <td className="px-3 py-2">{request.date ? formatDate(request.date) : "-"}</td>
                        <td className="px-3 py-2">{formatAmount(request.total)} SAR</td>
                        <td className="px-3 py-2">
                          {statusBadge(request)}
                          <div className="text-xs text-muted-foreground">{request.reason}</div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            <button
                              onClick={() => printRequest(request)}
                              className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs"
                            >
                              <Printer className="h-3 w-3" /> {t("طباعة")}
                            </button>
                            {canLink && request.status === "open" && (
                              <button
                                onClick={() => void openLink(request)}
                                className="inline-flex items-center gap-1 rounded border border-blue-300 px-2 py-1 text-xs text-blue-700"
                              >
                                <Link2 className="h-3 w-3" /> {t("ربط بإشعار المورد")}
                              </button>
                            )}
                            {canManage && request.status === "open" && (
                              <button
                                onClick={() => { setLinkTarget(null); setCancelTarget(request.id); setCancelReason(""); }}
                                className="inline-flex items-center gap-1 rounded border border-red-300 px-2 py-1 text-xs text-red-700"
                              >
                                <XCircle className="h-3 w-3" /> {t("إلغاء الطلب")}
                              </button>
                            )}
                          </div>
                          {cancelTarget === request.id && (
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <input
                                value={cancelReason}
                                onChange={(e) => setCancelReason(e.target.value)}
                                placeholder={t("سبب الإلغاء")}
                                className="h-8 rounded border border-border px-2 text-xs"
                              />
                              <button onClick={handleCancel} disabled={saving} className="rounded bg-red-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-60">
                                {t("تأكيد الإلغاء")}
                              </button>
                              <button onClick={() => setCancelTarget(null)} className="rounded border border-border px-2 py-1 text-xs">
                                {t("تراجع")}
                              </button>
                            </div>
                          )}
                          {linkTarget === request.id && request.status === "open" && (
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              {linkNotes === null ? (
                                <span className="text-xs text-muted-foreground">{t("جاري التحميل...")}</span>
                              ) : linkNotes.length === 0 ? (
                                <span className="text-xs text-muted-foreground">
                                  {t("لا يوجد إشعار مورد غير مربوط على هذه الفاتورة؛ سجّله أولًا من «الإشعارات الدائنة»")}
                                </span>
                              ) : (
                                <>
                                  <select
                                    value={linkNoteId}
                                    onChange={(e) => setLinkNoteId(e.target.value)}
                                    className="h-8 rounded border border-border px-2 text-xs"
                                  >
                                    <option value="">{t("اختر إشعار المورد")}</option>
                                    {linkNotes.map((note) => (
                                      <option key={note.id} value={note.id}>
                                        {note.number} — {note.supplierDocument} — {note.supplierDate ? formatDate(note.supplierDate) : ""} — {formatAmount(note.total)} SAR
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    onClick={handleLink}
                                    disabled={saving || !linkNoteId}
                                    className="rounded bg-blue-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-60"
                                  >
                                    {t("تأكيد الربط")}
                                  </button>
                                </>
                              )}
                              <button onClick={() => { setLinkTarget(null); setLinkNotes(null); }} className="rounded border border-border px-2 py-1 text-xs">
                                {t("تراجع")}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4 rounded-xl border border-border bg-card p-4">
            <div className="grid gap-4 md:grid-cols-3">
              <label className="space-y-1 text-sm md:col-span-2">
                <span className="font-medium">{t("فاتورة المورد*")}</span>
                <select
                  value={invoiceId}
                  onChange={(e) => setInvoiceId(e.target.value)}
                  className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                >
                  <option value="">{t("اختر رقم الفاتورة واسم المورد")}</option>
                  {invoices.map((invoice) => (
                    <option key={invoice.id} value={invoice.id}>
                      {invoice.id} — {invoice.vendor} — {t("الرصيد")}: {formatAmount(invoice.adjustedTotal)} SAR
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">{t("تاريخ الطلب*")}</span>
                <input
                  type="date"
                  value={requestDate}
                  min={selectedInvoice?.date || undefined}
                  max={today}
                  onChange={(e) => setRequestDate(e.target.value)}
                  className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                />
              </label>
              <label className="space-y-1 text-sm md:col-span-3">
                <span className="font-medium">{t("سبب الطلب*")}</span>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t("مثال: بضاعة تالفة، فرق سعر، كمية ناقصة")}
                  className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                />
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              {taxRate > 0
                ? t("الأسعار غير شاملة الضريبة — تُضاف ضريبة القيمة المضافة 15% كما في الفاتورة")
                : t("الفاتورة بلا ضريبة، فالطلب بلا ضريبة")}
            </p>
            <div className="overflow-x-auto">
              <table className={`w-full min-w-[640px] text-sm ${direction === "rtl" ? "text-right" : "text-left"}`}>
                <thead>
                  <tr className="bg-muted/40">
                    <th className="px-3 py-2">{t("الوصف*")}</th>
                    <th className="px-3 py-2">{t("الكمية*")}</th>
                    <th className="px-3 py-2">{t("السعر*")}</th>
                    <th className="px-3 py-2">{t("المجموع")}</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className="border-t border-border">
                      <td className="px-3 py-2">
                        <input
                          value={item.description}
                          onChange={(e) => setItems((current) => current.map((line) => (line.id === item.id ? { ...line, description: e.target.value } : line)))}
                          className="h-9 w-full rounded border border-border px-2"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          value={item.quantity}
                          onChange={(e) => setItems((current) => current.map((line) => (line.id === item.id ? { ...line, quantity: Number(e.target.value) } : line)))}
                          className="h-9 w-24 rounded border border-border px-2"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          value={item.unitPrice}
                          onChange={(e) => setItems((current) => current.map((line) => (line.id === item.id ? { ...line, unitPrice: Number(e.target.value) } : line)))}
                          className="h-9 w-28 rounded border border-border px-2"
                        />
                      </td>
                      <td className="px-3 py-2">{formatAmount(round2((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0)))}</td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => setItems((current) => (current.length > 1 ? current.filter((line) => line.id !== item.id) : current))}
                          className="rounded border border-border p-1.5"
                          aria-label={t("حذف البند")}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                onClick={() => setItems((current) => [...current, emptyItem()])}
                className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <Plus className="h-4 w-4" /> {t("أضف بند")}
              </button>
              <div className="space-y-1 rounded-lg border border-border p-3 text-sm">
                <div className="flex justify-between gap-8"><span>{t("المجموع الفرعي")}</span><span>{formatAmount(subtotal)} SAR</span></div>
                <div className="flex justify-between gap-8"><span>{t("ضريبة القيمة المضافة")}</span><span>{formatAmount(tax)} SAR</span></div>
                <div className="flex justify-between gap-8 border-t pt-1 font-semibold"><span>{t("الإجمالي المطلوب")}</span><span>{formatAmount(total)} SAR</span></div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
