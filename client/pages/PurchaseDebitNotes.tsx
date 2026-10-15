import Layout from "@/components/Layout";
import { purchasesFeatures } from "./Purchases";
import { ArrowRight, Plus, Save, Trash2 } from "lucide-react";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n";
import { supabase } from "@/lib/supabaseClient";
import { COMPANY_PROFILE, companyDocPrefix } from "@/lib/companyProfile";
import { riyadhDateString, SAUDI_STANDARD_VAT_RATE } from "@/lib/utils";

// تقريب لخانتين مطابق لـ round(x, 2) في القاعدة: نصف الهللة يُقرَّب بعيدًا عن الصفر،
// والضرب في 100 يُثبَّت أولًا حتى لا تُحوّل أخطاء الفاصلة العائمة 2.175 إلى 2.17
const round2 = (value: number) => {
  const rounded = Math.round(Number((Math.abs(value) * 100).toFixed(6))) / 100;
  return value < 0 ? -rounded : rounded;
};

type DebitNoteItem = {
  id: string;
  description: string;
  account: string;
  quantity: number;
  unitPrice: number;
  taxPercent: number;
};

type ExpenseAccount = {
  code: string;
  nameAr: string;
};

type DebitNote = {
  id: string;
  noteNumber: string;
  // مستند المورد (رقم إشعاره الدائن وتاريخه)
  supplierDocumentNumber: string;
  supplierDocumentDate: string;
  requestId: string;
  originalInvoiceId: string;
  supplier: string;
  currency: string;
  date: string;
  orderRef: string;
  project: string;
  subtotal: number;
  tax: number;
  total: number;
  balanceBefore: number;
  balanceAfter: number;
  items: DebitNoteItem[];
};

type PurchaseInvoiceOption = {
  id: string;
  supplier: string;
  purchaseOrder: string;
  adjustedTotal: number;
  // لإشعار صحيح ضريبيًا: الضريبة تتبع نسبة الفاتورة الأصلية ولا تتجاوز ضريبتها
  date: string;
  totalTax: number;
};

type DebitNoteForm = Omit<
  DebitNote,
  "id" | "subtotal" | "tax" | "total" | "balanceBefore" | "balanceAfter"
>;

type OpenCreditRequest = { id: string; number: string; invoiceId: string; total: number; reason: string };

// رسائل دوال القاعدة لإشعار المورد الدائن
const creditNoteErrorText = (message: string, t: (key: string) => string) => {
  const map: [string, string][] = [
    ["PURCHASE_CREDIT_NOTE_SUPPLIER_DOCUMENT_DUPLICATE", "إشعار المورد هذا مسجل مسبقًا لنفس المورد"],
    ["invoice_adjustment_notes_supplier_document_uidx", "إشعار المورد هذا مسجل مسبقًا لنفس المورد"],
    ["PURCHASE_CREDIT_NOTE_SUPPLIER_DOCUMENT_REQUIRED", "أدخل رقم إشعار المورد وتاريخه كما في مستنده"],
    ["PURCHASE_CREDIT_NOTE_SUPPLIER_DATE_INVALID", "تاريخ إشعار المورد لا يسبق فاتورته ولا يكون في المستقبل"],
    ["PURCHASE_CREDIT_NOTE_DATE_INVALID", "تاريخ التسجيل لا يسبق تاريخ إشعار المورد ولا يكون في المستقبل"],
    ["PURCHASE_CREDIT_REQUEST_INVALID", "الطلب المختار لم يعد مفتوحًا أو يخص فاتورة أخرى"],
    ["PURCHASE_ITEM_ACCOUNT_NOT_ALLOWED", "حساب البند يجب أن يكون من حسابات المصروفات أو البضاعة المستلمة غير المفوترة"],
    ["PURCHASE_NOTE_TAX_EXCEEDS_INVOICE_TAX", "ضريبة الإشعارات تتجاوز ضريبة فاتورة المورد"],
    ["PURCHASE_NOTE_TAX_NOT_ALLOWED", "فاتورة المورد بلا ضريبة، فلا ضريبة في الإشعار"],
    ["ACCOUNTING_MANAGE_PERMISSION_REQUIRED", "تسجيل إشعار المورد يحتاج صلاحية إدارة المحاسبة"],
    ["POSTED_PURCHASE_INVOICE_REQUIRED", "الفاتورة غير مرحّلة محاسبيًا"],
    ["PURCHASE_NOTE_REVERSE_CHARGE_UNSUPPORTED", "الإشعار على فاتورة احتساب عكسي غير مدعوم حاليًا؛ راجع المحاسب"],
  ];
  const hit = map.find(([code]) => message.includes(code));
  return hit ? t(hit[1]) : message;
};

type PurchaseAdjustmentNoteType = "purchase_debit" | "purchase_credit";

const START_NUMBER = 100;

const emptyItem = (): DebitNoteItem => ({
  id: crypto.randomUUID(),
  description: "",
  account: "511",
  quantity: 1,
  unitPrice: 0,
  taxPercent: 15,
});

// عرض فقط: الرقم الفعلي تحدده قاعدة البيانات (1001-PCN-000001 لكل منشأة)
const buildNumber = (num: number, noteType: PurchaseAdjustmentNoteType) =>
  `${companyDocPrefix()}${noteType === "purchase_credit" ? "PCN" : "DN"}-${String(num).padStart(6, "0")}`;
const extractNumber = (noteNumber: string) => {
  const match = String(noteNumber ?? "").match(/-(\d+)$/);
  return match ? Number(match[1]) : START_NUMBER;
};

const createEmptyForm = (
  num: number,
  noteType: PurchaseAdjustmentNoteType,
): DebitNoteForm => ({
  noteNumber: buildNumber(num, noteType),
  supplierDocumentNumber: "",
  supplierDocumentDate: riyadhDateString(),
  requestId: "",
  originalInvoiceId: "",
  supplier: "",
  currency: "SAR",
  date: riyadhDateString(),
  orderRef: "",
  project: "",
  items: [emptyItem()],
});

export default function PurchaseDebitNotes({
  noteType = "purchase_credit",
}: {
  noteType?: PurchaseAdjustmentNoteType;
}) {
  const { t, direction, formatDate, formatNumber } = useI18n();
  const isCredit = noteType === "purchase_credit";
  // الإشعار المدين للمورد صار طلبًا لا يُرحَّل؛ الإشعارات المدينة السابقة للاطلاع فقط
  const readOnly = !isCredit;
  const singularLabel = isCredit ? "إشعار دائن مشتريات" : "الإشعارات المدينة السابقة";
  const pluralLabel = isCredit
    ? "الإشعارات الدائنة للمشتريات"
    : "الإشعارات المدينة";
  const createLabel = isCredit
    ? "إنشاء إشعار دائن مشتريات جديد"
    : "إنشاء إشعار مدين جديد";
  const formatAmount = (value: number) =>
    formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const [mode, setMode] = useState<"list" | "create">("list");
  const [rows, setRows] = useState<DebitNote[]>([]);
  const [invoices, setInvoices] = useState<PurchaseInvoiceOption[]>([]);
  const [expenseAccounts, setExpenseAccounts] = useState<ExpenseAccount[]>([]);
  const [defaultExpenseAccount, setDefaultExpenseAccount] = useState("511");
  const [nextNumber, setNextNumber] = useState(START_NUMBER);
  const [form, setForm] = useState<DebitNoteForm>(() =>
    createEmptyForm(START_NUMBER, noteType),
  );
  // يمنع ترحيل الإشعار مرتين عند النقر المتكرر
  const saveInFlight = useRef(false);
  const [saving, setSaving] = useState(false);
  // ضريبة الإشعارات المُصدَرة سابقًا (مدينة ودائنة) على الفاتورة المختارة: الإشعارات معًا لا تعكس أكثر من ضريبة الفاتورة
  const [usedTax, setUsedTax] = useState<{ invoiceId: string; amount: number } | null>(null);
  const [openRequests, setOpenRequests] = useState<OpenCreditRequest[]>([]);
  const [requestsReload, setRequestsReload] = useState(0);
  const [usedTaxReload, setUsedTaxReload] = useState(0);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    const load = async () => {
      const [notesResult, invoicesResult, accountsResult, ruleResult] =
        await Promise.all([
          supabase
            .from("invoice_adjustment_notes")
            .select(
              "id, note_number, original_invoice_id, counterparty, currency, issue_date, subtotal, tax, total, balance_before, balance_after, items, supplier_document_number, supplier_document_date",
            )
            .eq("note_type", noteType)
            .order("created_at", { ascending: false }),
          // الإشعار يُنشأ على فاتورة مرحّلة فقط (القاعدة ترفض غيرها)
          supabase
            .from("purchase_invoices")
            .select("id, vendor, po_number, total, adjusted_total, total_tax, date, accounting_status")
            .eq("accounting_status", "posted")
            .order("date", { ascending: false }),
          supabase
            .from("accounting_accounts")
            .select("code, name_ar, parent_code")
            .like("code", "5%")
            .order("code"),
          supabase
            .from("accounting_posting_rules")
            .select("purchase_account_code")
            .eq("rule_code", "sales_default")
            .maybeSingle(),
        ]);

      setLoadError(notesResult.error ? String(notesResult.error.message ?? "") : "");
      if (!notesResult.error) {
        const parsed = (notesResult.data ?? []).map((row: any) => ({
          id: String(row.id),
          noteNumber: String(row.note_number),
          supplierDocumentNumber: String(row.supplier_document_number ?? ""),
          supplierDocumentDate: String(row.supplier_document_date ?? ""),
          requestId: "",
          originalInvoiceId: String(row.original_invoice_id),
          supplier: String(row.counterparty),
          currency: String(row.currency),
          date: String(row.issue_date),
          orderRef: "",
          project: "",
          subtotal: Number(row.subtotal),
          tax: Number(row.tax),
          total: Number(row.total),
          balanceBefore: Number(row.balance_before),
          balanceAfter: Number(row.balance_after),
          items: Array.isArray(row.items) ? row.items : [],
        }));
        setRows(parsed);
        const sequence =
          parsed.reduce(
            (max, note) => Math.max(max, extractNumber(note.noteNumber)),
            START_NUMBER - 1,
          ) + 1;
        setNextNumber(sequence);
        setForm(createEmptyForm(sequence, noteType));
      }

      if (!invoicesResult.error) {
        setInvoices(
          (invoicesResult.data ?? []).map((row: any) => ({
            id: String(row.id),
            supplier: String(row.vendor || t("مورد غير محدد")),
            purchaseOrder: String(row.po_number || ""),
            adjustedTotal:
              Number(
                row.adjusted_total ??
                  String(row.total || "0").replace(/[^0-9.-]/g, ""),
              ) || 0,
            date: String(row.date || ""),
            totalTax: Number(row.total_tax) || 0,
          })),
        );
      }
      if (!accountsResult.error) {
        const accountRows = accountsResult.data ?? [];
        setExpenseAccounts(
          accountRows
            .filter(
              (account: any) =>
                !accountRows.some(
                  (child: any) => child.parent_code === account.code,
                ),
            )
            .map((account: any) => ({
              code: String(account.code),
              nameAr: String(account.name_ar),
            })),
        );
      }
      if (!ruleResult.error && ruleResult.data?.purchase_account_code) {
        const configuredAccount = String(ruleResult.data.purchase_account_code);
        setDefaultExpenseAccount(configuredAccount);
        setForm((current) => ({
          ...current,
          items: current.items.map((item) => ({
            ...item,
            account: configuredAccount,
          })),
        }));
      }
    };
    load();
  }, [noteType]);

  const selectedInvoice = invoices.find(
    (item) => item.id === form.originalInvoiceId,
  );

  // طلبات الإشعار الدائن المفتوحة (تُغلق عند تسجيل إشعار المورد المرتبط بها)
  useEffect(() => {
    if (!isCredit) return;
    let active = true;
    supabase
      .from("purchase_credit_requests")
      .select("id, request_number, invoice_id, total, reason")
      .eq("status", "open")
      .order("request_date", { ascending: false })
      .then(({ data }) => {
        if (!active) return;
        setOpenRequests(
          (data ?? []).map((row: any) => ({
            id: String(row.id),
            number: String(row.request_number),
            invoiceId: String(row.invoice_id),
            total: Number(row.total) || 0,
            reason: String(row.reason ?? ""),
          })),
        );
      });
    return () => {
      active = false;
    };
  }, [isCredit, requestsReload]);
  const invoiceRequests = openRequests.filter((request) => request.invoiceId === form.originalInvoiceId);

  useEffect(() => {
    const invoiceId = form.originalInvoiceId;
    // القيمة غير معروفة حتى تصل من قاعدة البيانات، والحفظ ينتظرها
    setUsedTax(null);
    if (!invoiceId) return;
    let active = true;
    supabase
      .from("invoice_adjustment_notes")
      .select("tax")
      .eq("original_invoice_table", "purchase_invoices")
      .eq("original_invoice_id", invoiceId)
      .in("note_type", ["purchase_debit", "purchase_credit"])
      .eq("status", "posted")
      .then(({ data, error }) => {
        if (!active) return;
        // تعذّر التحميل: لا نمنع الحفظ؛ قاعدة البيانات تفرض السقف على أي حال
        const used = error
          ? 0
          : round2(
              (data ?? []).reduce((sum: number, row: any) => sum + (Number(row.tax) || 0), 0),
            );
        setUsedTax({ invoiceId, amount: used });
      });
    return () => {
      active = false;
    };
  }, [form.originalInvoiceId, usedTaxReload]);
  // نسبة ضريبة الإشعار من الفاتورة الأصلية: فاتورة بلا ضريبة ⇐ إشعار بلا ضريبة
  const noteTaxRate =
    selectedInvoice && selectedInvoice.totalTax <= 0 ? 0 : SAUDI_STANDARD_VAT_RATE;
  const subtotal = useMemo(
    () =>
      round2(
        form.items.reduce(
          (sum, item) => sum + round2(item.quantity * item.unitPrice),
          0,
        ),
      ),
    [form.items],
  );
  // المتبقي من ضريبة الفاتورة بعد الإشعارات السابقة (null إن لم يُحمَّل بعد)
  const remainingInvoiceTax =
    selectedInvoice && usedTax?.invoiceId === selectedInvoice.id
      ? Math.max(round2(selectedInvoice.totalTax - usedTax.amount), 0)
      : null;
  const calculatedTax = useMemo(
    () => round2((subtotal * noteTaxRate) / 100),
    [subtotal, noteTaxRate],
  );
  // تقريب كل إشعار جزئي قد يجعل ضريبة آخر إشعار أكبر ببضع هللات من المتبقي؛
  // الإشعار لا يعكس أكثر مما بقي من ضريبة الفاتورة
  const taxCapped = remainingInvoiceTax !== null && calculatedTax > remainingInvoiceTax;
  const tax = taxCapped ? remainingInvoiceTax : calculatedTax;
  const total = useMemo(() => round2(subtotal + tax), [subtotal, tax]);

  const updateItem = (
    id: string,
    key: keyof DebitNoteItem,
    value: string | number,
  ) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((item) =>
        item.id === id ? { ...item, [key]: value } : item,
      ),
    }));
  };

  const addItem = () =>
    setForm((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        { ...emptyItem(), account: defaultExpenseAccount },
      ],
    }));

  const removeItem = (id: string) =>
    setForm((prev) => ({
      ...prev,
      items:
        prev.items.length > 1
          ? prev.items.filter((item) => item.id !== id)
          : prev.items,
    }));

  const createNew = () => {
    if (readOnly) return;
    const nextForm = createEmptyForm(nextNumber, noteType);
    nextForm.items = nextForm.items.map((item) => ({
      ...item,
      account: defaultExpenseAccount,
    }));
    setForm(nextForm);
    setMode("create");
  };

  const handleSave = async () => {
    if (readOnly) return;
    if (!form.originalInvoiceId) {
      toast({
        title: t("الفاتورة الأصلية مطلوبة"),
        description: t(
          isCredit
            ? "كل إشعار دائن للمشتريات يجب أن يرتبط بفاتورة مشتريات"
            : "كل إشعار مدين يجب أن يرتبط بفاتورة مشتريات",
        ),
      });
      return;
    }
    if (!form.supplier.trim()) {
      toast({
        title: t("المورد مطلوب"),
        description: t("اختر الفاتورة الأصلية أولاً"),
      });
      return;
    }
    if (total <= 0) {
      toast({
        title: t("مبلغ الإشعار غير صحيح"),
        description: t("أضف بنداً بقيمة أكبر من صفر"),
      });
      return;
    }
    if (form.items.some((item) => !item.account)) {
      toast({
        title: t("الحساب المحاسبي مطلوب"),
        description: t("اختر حساب المصروف لكل بند من شجرة الحسابات"),
      });
      return;
    }
    if (
      form.items.some(
        (item) =>
          !item.description.trim() ||
          !(Number(item.quantity) > 0) ||
          !(Number(item.unitPrice) > 0),
      )
    ) {
      toast({
        title: t("بنود الإشعار غير مكتملة"),
        description: t("كل بند يحتاج وصفًا وكمية وسعرًا أكبر من صفر"),
      });
      return;
    }
    // تاريخ الإشعار: لا يسبق الفاتورة الأصلية ولا يكون في المستقبل
    if (
      !form.date ||
      form.date > riyadhDateString() ||
      (selectedInvoice?.date && form.date < selectedInvoice.date)
    ) {
      toast({
        title: t("تاريخ الإشعار غير صحيح"),
        description: t("تاريخ الإشعار لا يسبق تاريخ الفاتورة الأصلية ولا يكون في المستقبل"),
      });
      return;
    }
    if (isCredit) {
      const supplierDate = form.supplierDocumentDate;
      if (!form.supplierDocumentNumber.trim() || !supplierDate) {
        toast({ title: t("أدخل رقم إشعار المورد وتاريخه كما في مستنده") });
        return;
      }
      if (supplierDate > form.date || supplierDate > riyadhDateString() || (selectedInvoice?.date && supplierDate < selectedInvoice.date)) {
        toast({
          title: t("تاريخ إشعار المورد غير صحيح"),
          description: t("لا يسبق فاتورة المورد، ولا يتأخر عن تاريخ التسجيل، ولا يكون في المستقبل"),
        });
        return;
      }
    }
    if (remainingInvoiceTax === null) {
      toast({
        title: t("جارٍ تحميل ضريبة الإشعارات السابقة"),
        description: t("انتظر لحظة ثم أعد المحاولة"),
      });
      return;
    }
    // الضريبة المعكوسة لا تتجاوز ضريبة الفاتورة الأصلية
    if (selectedInvoice && tax > selectedInvoice.totalTax + 0.01) {
      toast({
        title: t("ضريبة الإشعار أكبر من ضريبة الفاتورة"),
        description: t("لا يمكن عكس ضريبة مدخلات أكثر مما سُجّل في الفاتورة الأصلية"),
      });
      return;
    }
    if (saveInFlight.current) return;

    // البنود بنفس نسبة ضريبة الإشعار (للتوثيق داخل الإشعار)
    const cleanedItems = form.items.map((item) => ({
      ...item,
      taxPercent: noteTaxRate,
    }));
    saveInFlight.current = true;
    setSaving(true);
    let data: { id?: string; note_number?: string } | null = null;
    let error: { message?: string } | null = null;
    try {
      // رقم إشعارنا تولّده القاعدة؛ ومستند المورد إلزامي
      const response = await supabase.rpc("post_purchase_credit_note", {
        p_original_invoice_id: form.originalInvoiceId,
        p_issue_date: form.date,
        p_subtotal: subtotal,
        p_tax: tax,
        p_total: total,
        p_items: cleanedItems,
        p_supplier_document_number: form.supplierDocumentNumber.trim(),
        p_supplier_document_date: form.supplierDocumentDate,
        p_request_id: form.requestId || null,
      });
      data = (response.data ?? null) as { id?: string; note_number?: string } | null;
      error = response.error;
    } catch (rpcError) {
      error = { message: rpcError instanceof Error ? rpcError.message : String(rpcError) };
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
    if (error) {
      // إشعار آخر رُحِّل على الفاتورة نفسها في الأثناء: نعيد تحميل المتبقي من ضريبتها
      if (String(error.message ?? "").includes("PURCHASE_NOTE_TAX")) {
        setUsedTaxReload((value) => value + 1);
      }
      if (String(error.message ?? "").includes("PURCHASE_CREDIT_REQUEST_INVALID")) {
        // الطلب المختار أُغلق أو أُلغي في الأثناء: نفرّغ الاختيار ونعيد تحميل المفتوح
        setForm((current) => ({ ...current, requestId: "" }));
        setRequestsReload((value) => value + 1);
      }
      toast({
        title: t("تعذر ترحيل الإشعار"),
        description: creditNoteErrorText(String(error.message ?? ""), t),
        variant: "destructive",
      });
      return;
    }
    if (form.requestId) setRequestsReload((value) => value + 1);

    const invoice = invoices.find(
      (item) => item.id === form.originalInvoiceId,
    )!;
    const payload: DebitNote = {
      ...form,
      id: String(data?.id ?? ""),
      noteNumber: String(data?.note_number ?? ""),
      supplierDocumentNumber: form.supplierDocumentNumber.trim(),
      currency: "SAR",
      subtotal,
      tax,
      total,
      balanceBefore: invoice.adjustedTotal,
      balanceAfter: invoice.adjustedTotal - total,
      items: cleanedItems,
    };
    setRows((current) => [payload, ...current]);
    setInvoices((current) =>
      current.map((item) =>
        item.id === form.originalInvoiceId
          ? { ...item, adjustedTotal: payload.balanceAfter }
          : item,
      ),
    );

    const sequence = extractNumber(payload.noteNumber) + 1;
    setNextNumber(sequence);
    const nextForm = createEmptyForm(sequence, noteType);
    nextForm.items = nextForm.items.map((item) => ({
      ...item,
      account: defaultExpenseAccount,
    }));
    setForm(nextForm);
    setMode("list");
    toast({
      title: t(isCredit ? "تم ترحيل إشعار دائن مشتريات" : "تم ترحيل إشعار مدين"),
      description: `${t("تم ربط")} ${payload.noteNumber} ${t("بالفاتورة")} ${payload.originalInvoiceId} ${t("وتسجيل القيد المحاسبي")}`,
    });
  };

  return (
    <Layout subMenu={{ title: t("المشتريات"), items: purchasesFeatures }}>
      <div dir={direction} className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-foreground">
              {t(singularLabel)}
            </h1>
            <p className="text-sm text-muted-foreground">
              {mode === "list" ? t(`عرض ${pluralLabel}`) : t(createLabel)}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {mode === "list" ? (
              !readOnly && (
                <button
                  onClick={createNew}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white"
                >
                  <Plus className="h-4 w-4" />
                  {t(createLabel)}
                </button>
              )
            ) : (
              <>
                <button
                  onClick={() => setMode("list")}
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium"
                >
                  <ArrowRight
                    className={`h-4 w-4 ${direction === "ltr" ? "rotate-180" : ""}`}
                  />
                  {t(`الرجوع إلى ${pluralLabel}`)}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <Save className="h-4 w-4" />
                  {t(isCredit ? "حفظ إشعار دائن المشتريات" : "حفظ إشعار المدين")}
                </button>
              </>
            )}
          </div>
        </div>

        {loadError && (
          <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {t("تعذّر تحميل الإشعارات")}: {loadError}
          </p>
        )}
        {readOnly && (
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            {t("أرشيف للاطلاع فقط: الإشعار المدين للمورد أصبح «طلب إشعار دائن» لا يُرحَّل، والأثر المحاسبي يأتي من إشعار المورد الدائن عند تسجيله.")}
          </p>
        )}
        {mode === "list" ? (
          <div className="space-y-4 rounded-xl border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">
              {t(`عدد ${pluralLabel}`)}:{" "}
              <span className="font-semibold text-foreground">
                {formatNumber(rows.length)}
              </span>
            </p>
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("لا توجد إشعارات محفوظة حالياً.")}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table
                  className={`w-full min-w-[700px] text-sm ${direction === "rtl" ? "text-right" : "text-left"}`}
                >
                  <thead>
                    <tr className="bg-muted/40">
                      <th className="px-3 py-2">{t("رقم الإشعار")}</th>
                      {isCredit && <th className="px-3 py-2">{t("إشعار المورد")}</th>}
                      <th className="px-3 py-2">{t("الفاتورة الأصلية")}</th>
                      <th className="px-3 py-2">{t("المورد")}</th>
                      <th className="px-3 py-2">{t("التاريخ")}</th>
                      <th className="px-3 py-2">{t("الإجمالي")}</th>
                      <th className="px-3 py-2">{t("الرصيد بعد الإشعار")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className="border-t border-border">
                        <td className="px-3 py-2 font-semibold text-primary">
                          {row.noteNumber}
                        </td>
                        {isCredit && (
                          <td className="px-3 py-2">
                            {row.supplierDocumentNumber || "-"}
                            {row.supplierDocumentDate && (
                              <div className="text-xs text-muted-foreground">{formatDate(row.supplierDocumentDate)}</div>
                            )}
                          </td>
                        )}
                        <td className="px-3 py-2 font-medium">
                          {row.originalInvoiceId}
                        </td>
                        <td className="px-3 py-2">{row.supplier}</td>
                        <td className="px-3 py-2">{formatDate(row.date)}</td>
                        <td className="px-3 py-2">
                          {formatAmount(row.total)} {row.currency}
                        </td>
                        <td className="px-3 py-2 font-semibold">
                          {formatAmount(row.balanceAfter)} {row.currency}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
              <div className="space-y-3 rounded-xl border border-border bg-card p-4">
                <div className="flex h-14 w-36 items-center justify-center rounded-md bg-slate-700 text-xs font-semibold text-white">
                  {COMPANY_PROFILE.programNameAr}
                </div>
                <h2 className="text-xl font-bold text-foreground">
                  {COMPANY_PROFILE.companyNameAr}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {COMPANY_PROFILE.addressAr}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t("رقم التسجيل الضريبي:")} {COMPANY_PROFILE.vatNumber}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t("رقم السجل التجاري")}:{" "}
                  {COMPANY_PROFILE.commercialRegistration}
                </p>
              </div>

              <div className="space-y-3 rounded-xl border border-border bg-card p-4">
                <Field label={t("رقم الإشعار")}>
                  <input
                    value=""
                    placeholder={t("يُولَّد تلقائيًا عند الحفظ")}
                    readOnly
                    className="h-10 w-full rounded-md border border-border bg-muted/30 px-3 text-sm"
                  />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t("رقم إشعار المورد*")}>
                    <input
                      value={form.supplierDocumentNumber}
                      onChange={(e) => setForm({ ...form, supplierDocumentNumber: e.target.value })}
                      placeholder={t("كما هو مطبوع على إشعار المورد")}
                      className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                    />
                  </Field>
                  <Field label={t("تاريخ إشعار المورد*")}>
                    <input
                      type="date"
                      value={form.supplierDocumentDate}
                      min={selectedInvoice?.date || undefined}
                      max={form.date || riyadhDateString()}
                      onChange={(e) => setForm({ ...form, supplierDocumentDate: e.target.value })}
                      className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                    />
                  </Field>
                </div>
                <Field label={t("الفاتورة الأصلية*")}>
                  <select
                    value={form.originalInvoiceId}
                    onChange={(e) => {
                      const invoice = invoices.find(
                        (item) => item.id === e.target.value,
                      );
                      setForm({
                        ...form,
                        originalInvoiceId: e.target.value,
                        supplier: invoice?.supplier || "",
                        requestId: "",
                      });
                    }}
                    className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                  >
                    <option value="">
                      {t("اختر رقم الفاتورة واسم المورد")}
                    </option>
                    {invoices.map((invoice) => (
                      <option key={invoice.id} value={invoice.id}>
                        {t("فاتورة")} {invoice.id} — {t("المورد")}:{" "}
                        {invoice.supplier || t("مورد غير محدد")}
                        {invoice.purchaseOrder
                          ? ` — ${t("أمر الشراء")}: ${invoice.purchaseOrder}`
                          : ""}{" "}
                        — {t("الرصيد")}: {formatAmount(invoice.adjustedTotal)}{" "}
                        SAR
                      </option>
                    ))}
                  </select>
                </Field>
                {invoiceRequests.length > 0 && (
                  <Field label={t("طلب الإشعار المرتبط")}>
                    <select
                      value={form.requestId}
                      onChange={(e) => setForm({ ...form, requestId: e.target.value })}
                      className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                    >
                      <option value="">{t("بدون طلب")}</option>
                      {invoiceRequests.map((request) => (
                        <option key={request.id} value={request.id}>
                          {request.number} — {formatAmount(request.total)} SAR — {request.reason}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                <Field label={t("المورد المرتبط بالفاتورة")}>
                  <input
                    value={form.supplier}
                    readOnly
                    placeholder={t("يُحدد تلقائياً من الفاتورة")}
                    className="h-10 w-full rounded-md border border-border bg-muted/30 px-3 text-sm"
                  />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  {/* القيد بالريال دائمًا، فالعملة للعرض فقط */}
                  <Field label={t("العملة*")}>
                    <input
                      value="SAR"
                      readOnly
                      disabled
                      className="h-10 w-full rounded-md border border-border bg-muted/30 px-3 text-sm"
                    />
                  </Field>
                  <Field label={t("التاريخ*")}>
                    <input
                      type="date"
                      value={form.date}
                      min={selectedInvoice?.date || undefined}
                      max={riyadhDateString()}
                      onChange={(e) =>
                        setForm({ ...form, date: e.target.value })
                      }
                      className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                    />
                  </Field>
                </div>
                {/* أمر الشراء والمشروع أُزيلا: لم يكونا يُحفظان */}
              </div>
            </div>

            <div className="space-y-3 rounded-xl border border-border bg-card p-4">
              <p className="text-sm font-semibold text-foreground">
                {noteTaxRate > 0
                  ? t("الأسعار غير شاملة الضريبة — تُضاف ضريبة القيمة المضافة 15% تلقائيًا")
                  : t("الفاتورة الأصلية بلا ضريبة، فالإشعار بلا ضريبة (0%)")}
              </p>
              <div className="overflow-x-auto">
                <table
                  className={`w-full min-w-[900px] text-sm ${direction === "rtl" ? "text-right" : "text-left"}`}
                >
                  <thead>
                    <tr className="bg-muted/40">
                      <th className="px-3 py-2">{t("الوصف*")}</th>
                      <th className="px-3 py-2">{t("حساب*")}</th>
                      <th className="px-3 py-2">{t("الكمية*")}</th>
                      <th className="px-3 py-2">{t("السعر*")}</th>
                      <th className="px-3 py-2">{t("المجموع")}</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {form.items.map((item) => {
                      const lineTotal = item.quantity * item.unitPrice;
                      return (
                        <tr key={item.id} className="border-t border-border">
                          <td className="px-3 py-2">
                            <input
                              value={item.description}
                              onChange={(e) =>
                                updateItem(
                                  item.id,
                                  "description",
                                  e.target.value,
                                )
                              }
                              placeholder={t("مطلوب")}
                              className="h-10 w-full rounded-md border border-border bg-background px-3"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={item.account}
                              onChange={(e) =>
                                updateItem(item.id, "account", e.target.value)
                              }
                              className="h-10 w-full rounded-md border border-border bg-background px-3"
                            >
                              {(expenseAccounts.length
                                ? expenseAccounts
                                : [
                                    {
                                      code: "511",
                                      nameAr: "المشتريات والمصروفات",
                                    },
                                  ]
                              ).map((account) => (
                                <option key={account.code} value={account.code}>
                                  {account.code} — {t(account.nameAr)}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min={1}
                              value={item.quantity}
                              onChange={(e) =>
                                updateItem(
                                  item.id,
                                  "quantity",
                                  Number(e.target.value) || 1,
                                )
                              }
                              className="h-10 w-24 rounded-md border border-border bg-background px-3"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min={0}
                              value={item.unitPrice}
                              onChange={(e) =>
                                updateItem(
                                  item.id,
                                  "unitPrice",
                                  Number(e.target.value) || 0,
                                )
                              }
                              className="h-10 w-32 rounded-md border border-border bg-background px-3"
                            />
                          </td>
                          <td className="px-3 py-2 font-semibold">
                            {formatAmount(lineTotal)} {t("ريال")}
                          </td>
                          <td className="px-3 py-2">
                            <button
                              onClick={() => removeItem(item.id)}
                              className="rounded-md border border-red-200 px-3 py-2 text-red-600 hover:bg-red-50"
                              aria-label={t("حذف البند")}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={addItem}
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium"
                >
                  <Plus className="h-4 w-4" />
                  {t("أضف بند")}
                </button>
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
              <div className="rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground">
                {t(
                  "يتم توليد البيانات لعرض متطلبات ضريبة القيمة المضافة في الإشعار.",
                )}
              </div>

              <div className="space-y-2 rounded-xl border border-border bg-card p-4 text-sm">
                <div className="flex items-center justify-between">
                  <span>{t("المجموع الفرعي")}</span>
                  <span>
                    {formatAmount(subtotal)} {t("ريال")}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>{t("إجمالي ضريبة القيمة المضافة")}</span>
                  <span>
                    {formatAmount(tax)} {t("ريال")}
                  </span>
                </div>
                {taxCapped && (
                  <p className="text-xs text-amber-700">
                    {t("قُصرت الضريبة على المتبقي من ضريبة الفاتورة بعد الإشعارات السابقة")}
                  </p>
                )}
                <div className="flex items-center justify-between border-t border-border pt-2 text-base font-semibold">
                  <span>{t("المجموع")}</span>
                  <span>
                    {formatAmount(total)} {t("ريال")}
                  </span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid items-center gap-2 sm:grid-cols-[140px_1fr]">
      <label className="text-sm font-medium text-foreground">{label}</label>
      {children}
    </div>
  );
}
