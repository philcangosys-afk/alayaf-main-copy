import Layout from "@/components/Layout";
import { salesFeatures } from "./Sales";
import { Plus, Save, Trash2, ArrowRight, RefreshCw } from "lucide-react";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { riyadhDateString } from "@/lib/utils";
import { canManagePerm } from "@/lib/authSession";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabaseClient";
import ZatcaQrCode from "@/components/ZatcaQrCode";
import { useI18n } from "@/i18n";
import { COMPANY_PROFILE, zatcaDeviceSerialKey, companyDocPrefix, isSaudiCompany } from "@/lib/companyProfile";
import { BILLING_COUNTRY_MESSAGE } from "@/lib/countries";

const zatcaStatusLabels: Record<string, string> = {
  pending: "بانتظار الإرسال",
  cleared: "مصادق من ZATCA",
  reported: "مُبلّغ لـ ZATCA",
  rejected: "مرفوض من ZATCA",
  failed: "فشل الإرسال",
  ambiguous: "يتطلب مراجعة — لا تعد الإرسال",
  // المرحلة الأولى (الإصدار والحفظ): رمز QR من النظام عند الإصدار، ولا إرسال للهيئة
  phase1: "مرحلة أولى — بلا ربط",
};

// إشعار مرحّل لم تقبله الهيئة بعد ولا نتيجة غير محسومة له: تجوز إعادة إرساله
const ZATCA_RESENDABLE_STATUSES = new Set(["pending", "failed", "rejected"]);
// نفس تعبير دالة الهيئة containsSyntheticMarker
const ZATCA_SYNTHETIC_MARKER =
  /(?:^|[^A-Z])(?:TEST(?:ING)?|SIM(?:ULATION|ULATED|ULATOR)?)(?:[^A-Z]|$)|تجريب/i;
const salesNoteErrorMessages: Array<[string, string]> = [
  ["BILLING_COUNTRY_NOT_READY", BILLING_COUNTRY_MESSAGE],
  ["SALES_NOTE_ORIGINAL_NOT_ACCEPTED", "الفاتورة الأصلية لم تقبلها الهيئة بعد؛ لا يُصدر إشعار عليها حتى تُبلَّغ"],
  ["SALES_NOTE_ORIGINAL_PHASE1_AFTER_PHASE2", "الفاتورة الأصلية صدرت في المرحلة الأولى والمنشأة الآن في المرحلة الثانية؛ إشعارها غير متاح حاليًا"],
  ["SALES_NOTE_ORIGINAL_PHASE2_WHILE_PHASE1", "الفاتورة الأصلية صدرت في مسار الربط مع الهيئة والمنشأة الآن في المرحلة الأولى؛ لا يصدر عليها إشعار"],
  ["ZATCA_COMPANY_VAT_REQUIRED", "الرقم الضريبي للمنشأة غير مسجّل؛ لا تصدر الإشعارات حتى تضيفه إدارة المنصة (حدّث الصفحة بعد إضافته). لم يُرحَّل الإشعار"],
  ["SALES_NOTE_ORIGINAL_NOT_POSTED", "الفاتورة الأصلية غير مرحّلة محاسبيًا"],
  ["SALES_NOTE_ORIGINAL_NOT_FOUND", "الفاتورة الأصلية غير موجودة"],
  ["SALES_NOTE_ORIGINAL_BUYER_DATA_INCOMPLETE", "بيانات العميل في الفاتورة الأصلية (العنوان الوطني أو الرقم الضريبي) لا تكفي للهيئة؛ لا يمكن إصدار إشعار عليها"],
  ["SALES_NOTE_SYNTHETIC_TEXT", "نص الإشعار أو الفاتورة الأصلية يحتوي كلمة اختبارية (test أو simulation أو تجريبي) والهيئة ترفضه في الإنتاج"],
  ["SALES_NOTE_REASON_REQUIRED", "سبب الإشعار مطلوب"],
  ["SALES_NOTE_ITEMS_REQUIRED", "أضف بنداً بقيمة أكبر من صفر"],
  ["SALES_NOTE_ITEM_INVALID", "كل بند يحتاج وصفًا وكمية وسعرًا أكبر من صفر"],
  ["SALES_NOTE_TAX_RATE_INVALID", "نسبة الضريبة لكل بند 15%"],
  ["SALES_NOTE_PERMISSION_REQUIRED", "إنشاء الإشعارات يتطلب صلاحية إدارة الإشعارات الدائنة. لم يتم ترحيل أي شيء."],
  ["ACCOUNTING_MANAGE_PERMISSION_REQUIRED", "ترحيل الإشعار يتطلب صلاحية إدارة المحاسبة. لم يتم ترحيل أي شيء."],
  ["SALES_NOTE_REQUEST_REUSED", "أُنشئ إشعار من هذا النموذج في محاولة سابقة؛ حدّث القائمة للاطلاع عليه، ثم ابدأ إشعارًا جديدًا إن احتجت"],
  ["ACCOUNTING_FISCAL_PERIOD_CLOSED", "الفترة المحاسبية لتاريخ اليوم مقفلة"],
  ["SALES_NOTE_REASON_INVALID_CHARS", "سبب الإشعار لا يقبل الرموز < > & ولا محارف التحكم غير المرئية"],
  ["SALES_NOTE_INVALID_CHARS", "وصف أحد البنود يحتوي محارف تحكم غير مرئية لا يقبلها ملف الهيئة؛ أعد كتابة النص"],
  ["ZATCA_RESEND_PERMISSION_REQUIRED", "إعادة الإرسال تتطلب صلاحية إدارة فواتير المبيعات"],
];
// نتيجة zatca_resend_state: متى تجوز إعادة الإرسال
const zatcaResendStateMessages: Record<string, string> = {
  accepted: "المستند مقبول لدى الهيئة؛ لا حاجة لإعادة الإرسال",
  ambiguous: "نتيجة إرسال سابق غير محسومة؛ لا تعد الإرسال قبل المراجعة اليدوية",
  in_progress: "يوجد إرسال سابق لم يكتمل؛ يحتاج مراجعة يدوية قبل أي إعادة إرسال",
  not_posted: "المستند غير مرحّل محاسبيًا",
  not_found: "المستند غير موجود أو لا تملك صلاحية عليه",
};
const salesNoteErrorText = (message: string) =>
  salesNoteErrorMessages.find(([code]) => message.includes(code))?.[1] ?? message;

const accountingStatusLabels: Record<string, string> = {
  unposted: "غير مُرحّل",
  posted: "قيد مُرحّل",
  failed: "فشل الترحيل",
  reversed: "قيد معكوس",
};

const creditNoteTranslations: Record<string, string> = {
  "بانتظار الإرسال": "Pending submission",
  "مصادق من ZATCA": "Cleared by ZATCA",
  "مُبلّغ لـ ZATCA": "Reported to ZATCA",
  "مرفوض من ZATCA": "Rejected by ZATCA",
  "غير مُرحّل": "Unposted",
  "قيد مُرحّل": "Posted entry",
  "فشل الترحيل": "Posting failed",
  "قيد معكوس": "Reversed entry",
  "الفاتورة الأصلية مطلوبة": "Original invoice is required",
  "كل إشعار يجب أن يكون مرتبطاً بفاتورة مبيعات":
    "Every note must be linked to a sales invoice",
  "العميل مطلوب": "Customer is required",
  "اختر الفاتورة الأصلية أولاً": "Select the original invoice first",
  "مبلغ الإشعار غير صحيح": "Invalid note amount",
  "أضف بنداً بقيمة أكبر من صفر": "Add an item with a value greater than zero",
  "الحساب المحاسبي مطلوب": "Accounting account is required",
  "سبب الإشعار مطلوب": "Note reason is required",
  "اكتب السبب الحقيقي للإشعار الدائن أو المدين":
    "Enter the actual reason for the credit or debit note",
  "تعذر حفظ سبب الإشعار": "Unable to save the note reason",
  "سبب الإشعار الدائن/المدين*": "Credit/debit note reason*",
  "مثال: إلغاء جزئي، خطأ في السعر، أو تعديل كمية":
    "Example: partial cancellation, pricing error, or quantity adjustment",
  "اختر حساب الإيراد لكل بند من شجرة الحسابات":
    "Select a revenue account from the chart of accounts for each item",
  "تعذر ترحيل الإشعار": "Unable to post the note",
  "تعذر إرسال الإشعار إلى ZATCA": "Unable to submit the note to ZATCA",
  "حدث خطأ غير متوقع": "An unexpected error occurred",
  "تم ترحيل الإشعار الدائن": "Credit note posted",
  "تم ترحيل الإشعار المدين": "Debit note posted",
  "تم ربط": "Linked",
  بالفاتورة: "to invoice",
  "وتسجيل القيد المحاسبي": "and recorded the accounting entry",
  المبيعات: "Sales",
  "إشعارات تعديل المبيعات": "Sales adjustment notes",
  "إشعارات دائنة ومدينة مرتبطة بالفواتير":
    "Credit and debit notes linked to invoices",
  "إنشاء إشعار مرتبط بفاتورة مبيعات": "Create a note linked to a sales invoice",
  "إنشاء إشعار جديد": "Create new note",
  "الرجوع للإشعارات": "Back to notes",
  "حفظ الإشعار": "Save note",
  "عدد الإشعارات المرحلة": "Posted notes",
  "لا يوجد إشعارات محفوظة حالياً.": "No saved notes at this time.",
  "رقم الإشعار": "Note number",
  النوع: "Type",
  "الفاتورة الأصلية": "Original invoice",
  العميل: "Customer",
  التاريخ: "Date",
  الإجمالي: "Total",
  "الرصيد بعد الإشعار": "Balance after note",
  "القيد المحاسبي": "Accounting entry",
  "حالة ZATCA": "ZATCA status",
  دائن: "Credit",
  مدين: "Debit",
  "رجوع للقائمة": "Back to list",
  "إشعار دائن": "Credit note",
  "إشعار مدين": "Debit note",
  "المجموع الفرعي": "Subtotal",
  الضريبة: "Tax",
  "رقم القيد": "Entry number",
  "QR بعد الاعتماد": "QR after approval",
  "يظهر رمز الاستجابة السريعة بعد قبول ZATCA للإشعار.":
    "The QR code appears after ZATCA accepts the note.",
  "الشيخ محمد بن جبير": "Sheikh Mohammed Bin Jubair",
  "مكة المكرمة": "Makkah",
  "المملكة العربية السعودية": "Saudi Arabia",
  "رقم التسجيل الضريبي": "Tax registration number",
  "نوع الإشعار*": "Note type*",
  "إشعار دائن — يخفض رصيد الفاتورة":
    "Credit note — decreases the invoice balance",
  "إشعار مدين — يزيد رصيد الفاتورة":
    "Debit note — increases the invoice balance",
  "الفاتورة الأصلية*": "Original invoice*",
  "اختر الفاتورة": "Select an invoice",
  الرصيد: "Balance",
  "العميل المرتبط بالفاتورة": "Customer linked to the invoice",
  "يُحدد تلقائياً من الفاتورة": "Automatically populated from the invoice",
  "العملة*": "Currency*",
  "التاريخ*": "Date*",
  "أمر الشراء": "Purchase order",
  اختياري: "Optional",
  "مرجع الفاتورة": "Invoice reference",
  "يُحدد من الفاتورة الأصلية": "Populated from the original invoice",
  المشروع: "Project",
  المستودع: "Warehouse",
  "السعر شامل من الضريبة": "Price includes tax",
  "الأسعار غير شاملة الضريبة — تُضاف ضريبة القيمة المضافة 15% تلقائيًا":
    "Prices exclude VAT — 15% VAT is added automatically",
  "بنود الإشعار غير مكتملة": "Note lines are incomplete",
  "لم يُحفظ سبب الإشعار": "The note reason was not saved",
  "سيُرسل الإشعار إلى ZATCA بالسبب الافتراضي «تعديل على المستند الأصلي». راجع صلاحية الإشعارات الدائنة لهذا المستخدم.":
    "The note will be sent to ZATCA with the default reason. Review this user's credit note permission.",
  "صلاحية غير كافية": "Insufficient permission",
  "إنشاء الإشعارات يتطلب صلاحية إدارة الإشعارات الدائنة. لم يتم ترحيل أي شيء.":
    "Creating notes requires credit note management permission. Nothing was posted.",
  "كل بند يحتاج وصفًا وكمية وسعرًا أكبر من صفر":
    "Each line needs a description, quantity and price greater than zero",
  الوصف: "Description",
  "حساب*": "Account*",
  "الكمية*": "Quantity*",
  "السعر*": "Price*",
  المجموع: "Total",
  "مفتاح أو خدمة": "Item or service",
  "إيرادات المبيعات والخدمات": "Sales and service revenue",
  "﷼": "SAR",
  "حذف البند": "Delete item",
  "أضف بند": "Add item",
  "رمز الاستجابة السريعة يظهر لعرض متطلبات هيئة الزكاة والضريبة والجمارك بالفاتورة الإلكترونية.":
    "The QR code displays the Zakat, Tax and Customs Authority requirements for electronic invoices.",
  "إجمالي ضريبة القيمة المضافة": "Total VAT",
  "فشل الإرسال": "Submission failed",
  "يتطلب مراجعة — لا تعد الإرسال": "Needs review — do not resend",
  "إعادة الإرسال للهيئة": "Resend to ZATCA",
  "تم إلغاء إعادة الإرسال": "Resend cancelled",
  "لم يُرسل شيء إلى ZATCA.": "Nothing was sent to ZATCA.",
  "تلقائي عند الحفظ": "Assigned on save",
  "تظهر الفواتير المقبولة لدى الهيئة فقط": "Only invoices accepted by ZATCA are listed",
  "الفاتورة الأصلية لم تقبلها الهيئة بعد؛ لا يُصدر إشعار عليها حتى تُبلَّغ":
    "ZATCA has not accepted the original invoice yet; no note can be issued until it is reported",
  "الفاتورة الأصلية غير مرحّلة محاسبيًا": "The original invoice is not posted",
  "الفاتورة الأصلية غير موجودة": "The original invoice does not exist",
  "بيانات العميل في الفاتورة الأصلية (العنوان الوطني أو الرقم الضريبي) لا تكفي للهيئة؛ لا يمكن إصدار إشعار عليها":
    "The customer data on the original invoice (national address or VAT number) is insufficient for ZATCA; no note can be issued on it",
  "نص الإشعار أو الفاتورة الأصلية يحتوي كلمة اختبارية (test أو simulation أو تجريبي) والهيئة ترفضه في الإنتاج":
    "The note or original invoice text contains a test word (test, simulation, تجريبي); ZATCA production rejects it",
  "نسبة الضريبة لكل بند 15%": "Each line's VAT rate is 15%",
  "ترحيل الإشعار يتطلب صلاحية إدارة المحاسبة. لم يتم ترحيل أي شيء.":
    "Posting the note requires accounting management permission. Nothing was posted.",
  "الفترة المحاسبية لتاريخ اليوم مقفلة": "Today's accounting period is closed",
  "نص اختباري في الإشعار": "Test text in the note",
  "سبب الإشعار لا يقبل الرموز < > & ولا محارف التحكم غير المرئية": "The note reason cannot contain < > & or invisible control characters",
  "وصف أحد البنود يحتوي محارف تحكم غير مرئية لا يقبلها ملف الهيئة؛ أعد كتابة النص":
    "A line description contains invisible control characters that ZATCA XML rejects; retype the text",
  "أُنشئ إشعار من هذا النموذج في محاولة سابقة؛ حدّث القائمة للاطلاع عليه، ثم ابدأ إشعارًا جديدًا إن احتجت":
    "A note was already created from this form in a previous attempt; refresh the list to see it, then start a new note if needed",
  "رموز غير مقبولة في السبب": "Characters not allowed in the reason",
  "إعادة الإرسال تتطلب صلاحية إدارة فواتير المبيعات": "Resending requires sales invoice management permission",
  "تعذر إعادة الإرسال": "Cannot resend",
  "المستند مقبول لدى الهيئة؛ لا حاجة لإعادة الإرسال": "The document is accepted by ZATCA; no resend needed",
  "نتيجة إرسال سابق غير محسومة؛ لا تعد الإرسال قبل المراجعة اليدوية":
    "A previous submission result is unresolved; do not resend before manual review",
  "يوجد إرسال سابق لم يكتمل؛ يحتاج مراجعة يدوية قبل أي إعادة إرسال":
    "A previous submission did not complete; it needs manual review before any resend",
  "المستند غير مرحّل محاسبيًا": "The document is not posted",
  "المستند غير موجود أو لا تملك صلاحية عليه": "The document does not exist or you lack permission",
  "تعذر التأكد من حفظ الإشعار": "Could not confirm the note was saved",
  "انقطع الاتصال قبل وصول الرد. حدّث القائمة؛ إعادة الحفظ من هذا النموذج لن تنشئ إشعارًا مكررًا.":
    "The connection dropped before the reply. Refresh the list; saving again from this form will not create a duplicate note.",
  "الإشعار مسجّل مسبقًا": "Note already recorded",
  "لم يُنشأ إشعار جديد؛ هذا هو الإشعار المسجّل من المحاولة السابقة.":
    "No new note was created; this is the note recorded by the previous attempt.",
  "لا يمكن إصدار الإشعار": "Cannot issue the note",
  "الرقم الضريبي للمنشأة غير مسجّل؛ لا تصدر الإشعارات حتى تضيفه إدارة المنصة":
    "The company VAT number is not registered; notes cannot be issued until the platform admin adds it",
  "الرقم الضريبي للمنشأة غير مسجّل؛ لا تصدر الإشعارات حتى تضيفه إدارة المنصة (حدّث الصفحة بعد إضافته). لم يُرحَّل الإشعار":
    "The company VAT number is not registered; notes cannot be issued until the platform admin adds it (refresh the page afterwards). The note was not posted",
  "الفاتورة الأصلية صدرت في مسار الربط مع الهيئة والمنشأة الآن في المرحلة الأولى؛ لا يصدر عليها إشعار":
    "The original invoice was issued through ZATCA integration and the company is now in Phase 1; no note can be issued on it",
  "تظهر فواتير المرحلة الأولى والفواتير المقبولة لدى الهيئة": "Phase 1 invoices and invoices accepted by ZATCA are listed",
};

type AccountingAccount = {
  code: string;
  nameAr: string;
};

type CreditNoteItem = {
  id: string;
  description: string;
  account: string;
  quantity: number;
  unitPrice: number;
  taxPercent: number;
};

type SavedCreditNote = {
  id: string;
  noteNumber: string;
  noteType: "sales_credit" | "sales_debit";
  originalInvoiceId: string;
  customer: string;
  reason: string;
  currency: string;
  date: string;
  orderRef: string;
  reference: string;
  project: string;
  warehouse: string;
  subtotal: number;
  tax: number;
  total: number;
  balanceBefore: number;
  balanceAfter: number;
  items: CreditNoteItem[];
  zatcaStatus: string;
  qrCodeData: string;
  accountingStatus: string;
  accountingJournalEntryId: string;
};

type OriginalInvoice = {
  id: string;
  customer: string;
  total: number;
  adjustedTotal: number;
  zatcaStatus: string;
};

type CreditNoteForm = {
  noteNumber: string;
  noteType: "sales_credit" | "sales_debit";
  originalInvoiceId: string;
  customer: string;
  reason: string;
  currency: string;
  date: string;
  orderRef: string;
  reference: string;
  project: string;
  warehouse: string;
  items: CreditNoteItem[];
};

const STORAGE_KEY = "sales-credit-notes";
const START_NUMBER = 100;

const emptyItem = (): CreditNoteItem => ({
  id: crypto.randomUUID(),
  description: "",
  account: "411",
  quantity: 1,
  unitPrice: 0,
  taxPercent: 15,
});

// عرض فقط: رقم الإشعار تحدده قاعدة البيانات عند الترحيل (1001-CN-000001 لكل منشأة)
const buildNoteNumber = (sequence: number) =>
  `${companyDocPrefix()}CN-${String(sequence).padStart(6, "0")}`;

const extractSequence = (noteNumber: string) => {
  const match = String(noteNumber ?? "").match(/(?:^|-)(?:CN|DN)-(\d+)$/i);
  const parsed = match ? Number(match[1]) : NaN;
  return Number.isFinite(parsed) ? parsed : START_NUMBER;
};

const createEmptyForm = (sequence: number): CreditNoteForm => ({
  noteNumber: buildNoteNumber(sequence),
  noteType: "sales_credit",
  originalInvoiceId: "",
  customer: "",
  reason: "",
  currency: "SAR",
  date: riyadhDateString(),
  orderRef: "",
  reference: "",
  project: "",
  warehouse: "",
  items: [emptyItem()],
});

export default function SalesCreditNote() {
  const {
    t: translate,
    locale,
    direction,
    formatDate,
    formatNumber,
  } = useI18n();
  const t = (value: string) =>
    locale === "en"
      ? (creditNoteTranslations[value] ?? translate(value))
      : translate(value);
  const [savedNotes, setSavedNotes] = useState<SavedCreditNote[]>([]);
  const [invoices, setInvoices] = useState<OriginalInvoice[]>([]);
  const [revenueAccounts, setRevenueAccounts] = useState<AccountingAccount[]>(
    [],
  );
  const [defaultRevenueAccount, setDefaultRevenueAccount] = useState("411");
  const [nextSequence, setNextSequence] = useState(START_NUMBER);
  // يمنع ترحيل/إرسال الإشعار مرتين عند النقر المتكرر
  const saveInFlight = useRef(false);
  const [saving, setSaving] = useState(false);
  // معرّف الطلب يمنع إنشاء الإشعار مرتين: يبقى كما هو حتى ينجح الحفظ أو يُبدأ إشعار جديد،
  // فإعادة المحاولة بعد انقطاع الاتصال تعيد الإشعار المسجّل بدل إنشاء آخر
  const requestIdRef = useRef<string>(crypto.randomUUID());
  const resendInFlight = useRef<Set<string>>(new Set());
  const { permissions, ready: permissionsReady } = useRolePermissions();
  const [mode, setMode] = useState<"list" | "create" | "details">("list");
  const [selectedNote, setSelectedNote] = useState<SavedCreditNote | null>(
    null,
  );
  const [form, setForm] = useState<CreditNoteForm>(() =>
    createEmptyForm(START_NUMBER),
  );

  useEffect(() => {
    const load = async () => {
      const [notesResult, invoicesResult, accountsResult, ruleResult] =
        await Promise.all([
          supabase
            .from("invoice_adjustment_notes")
            .select(
              "id, note_number, note_type, original_invoice_id, counterparty, reason, currency, issue_date, subtotal, tax, total, balance_before, balance_after, items, zatca_status, qr_code_data, accounting_status, accounting_journal_entry_id",
            )
            .in("note_type", ["sales_credit", "sales_debit"])
            .order("created_at", { ascending: false }),
          supabase
            .from("sales_invoices")
            .select("id, customer, total, adjusted_total, accounting_status, zatca_status, uuid, zatca_phase")
            .eq("accounting_status", "posted")
            .order("date", { ascending: false }),
          supabase
            .from("accounting_accounts")
            .select("code, name_ar, parent_code")
            .like("code", "4%")
            .order("code"),
          supabase
            .from("accounting_posting_rules")
            .select("revenue_account_code")
            .eq("rule_code", "sales_default")
            .maybeSingle(),
        ]);

      if (!notesResult.error) {
        const parsed = (notesResult.data ?? []).map((row: any) => ({
          id: String(row.id),
          noteNumber: String(row.note_number),
          noteType: row.note_type as "sales_credit" | "sales_debit",
          originalInvoiceId: String(row.original_invoice_id),
          customer: String(row.counterparty),
          reason: String(row.reason ?? ""),
          currency: String(row.currency),
          date: String(row.issue_date),
          orderRef: "",
          reference: String(row.original_invoice_id),
          project: "",
          warehouse: "",
          subtotal: Number(row.subtotal),
          tax: Number(row.tax),
          total: Number(row.total),
          balanceBefore: Number(row.balance_before),
          balanceAfter: Number(row.balance_after),
          items: Array.isArray(row.items) ? row.items : [],
          zatcaStatus: String(row.zatca_status ?? "pending"),
          qrCodeData: String(row.qr_code_data ?? ""),
          accountingStatus: String(row.accounting_status ?? "unposted"),
          accountingJournalEntryId: String(
            row.accounting_journal_entry_id ?? "",
          ),
        }));
        setSavedNotes(parsed);
        const sequence =
          parsed.reduce(
            (max, note) => Math.max(max, extractSequence(note.noteNumber)),
            START_NUMBER - 1,
          ) + 1;
        setNextSequence(sequence);
        setForm(createEmptyForm(sequence));
      }

      if (!invoicesResult.error) {
        setInvoices(
          (invoicesResult.data ?? [])
            // القاعدة ترفض الإشعار على فاتورة لم تقبلها الهيئة؛ نعرض المقبولة فقط،
            // وفواتير المرحلة الأولى في المرحلتين (لم تُرسل للهيئة فلا قبول لها؛
            // في المرحلة الثانية يُرسل إشعارها للهيئة بمرجع رقم الفاتورة فقط)
            .filter(
              (row: any) =>
                (["reported", "cleared"].includes(String(row.zatca_status ?? "")) &&
                  String(row.uuid ?? "").trim() !== "") ||
                row.zatca_phase === "phase1",
            )
            .map((row: any) => ({
            id: String(row.id),
            customer: String(row.customer || ""),
            zatcaStatus: String(row.zatca_status ?? ""),
            total:
              Number(String(row.total || "0").replace(/[^0-9.-]/g, "")) || 0,
            adjustedTotal:
              Number(
                row.adjusted_total ??
                  String(row.total || "0").replace(/[^0-9.-]/g, ""),
              ) || 0,
          })),
        );
      }

      if (!accountsResult.error) {
        const accountRows = accountsResult.data ?? [];
        setRevenueAccounts(
          accountRows
            .filter(
              (account: any) =>
                !accountRows.some(
                  (child: any) => child.parent_code === account.code,
                ),
            )
            .map((row: any) => ({
              code: String(row.code),
              nameAr: String(row.name_ar),
            })),
        );
      }
      if (!ruleResult.error && ruleResult.data?.revenue_account_code) {
        const configuredRevenue = String(ruleResult.data.revenue_account_code);
        setDefaultRevenueAccount(configuredRevenue);
        setForm((current) => ({
          ...current,
          items: current.items.map((item) => ({
            ...item,
            account: configuredRevenue,
          })),
        }));
      }
    };
    load();
  }, []);

  const subtotal = useMemo(
    () =>
      form.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0),
    [form.items],
  );
  const tax = useMemo(() => subtotal * 0.15, [subtotal]);
  const total = useMemo(() => subtotal + tax, [subtotal, tax]);

  const updateItem = (
    id: string,
    key: keyof CreditNoteItem,
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
        { ...emptyItem(), account: defaultRevenueAccount },
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

  const createNewNote = () => {
    requestIdRef.current = crypto.randomUUID();
    const nextForm = createEmptyForm(nextSequence);
    nextForm.items = nextForm.items.map((item) => ({
      ...item,
      account: defaultRevenueAccount,
    }));
    setForm(nextForm);
    setMode("create");
  };

  const handleSave = async () => {
    if (!form.originalInvoiceId) {
      toast({
        title: t("الفاتورة الأصلية مطلوبة"),
        description: t("كل إشعار يجب أن يكون مرتبطاً بفاتورة مبيعات"),
      });
      return;
    }
    if (!form.customer.trim()) {
      toast({
        title: t("العميل مطلوب"),
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
    if (!form.reason.trim()) {
      toast({
        title: t("سبب الإشعار مطلوب"),
        description: t("اكتب السبب الحقيقي للإشعار الدائن أو المدين"),
        variant: "destructive",
      });
      return;
    }
    if (/[<>&]/.test(form.reason)) {
      toast({
        title: t("رموز غير مقبولة في السبب"),
        description: t("سبب الإشعار لا يقبل الرموز < > & ولا محارف التحكم غير المرئية"),
        variant: "destructive",
      });
      return;
    }
    if (form.items.some((item) => !item.account)) {
      toast({
        title: t("الحساب المحاسبي مطلوب"),
        description: t("اختر حساب الإيراد لكل بند من شجرة الحسابات"),
      });
      return;
    }
    // نفس شروط دالة ZATCA قبل الإرسال: وصف وكمية وسعر أكبر من صفر لكل بند
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
        variant: "destructive",
      });
      return;
    }
    if (
      form.items.some((item) => ZATCA_SYNTHETIC_MARKER.test(item.description))
    ) {
      toast({
        title: t("نص اختباري في الإشعار"),
        description: t(salesNoteErrorText("SALES_NOTE_SYNTHETIC_TEXT")),
        variant: "destructive",
      });
      return;
    }
    if (saveInFlight.current) return;
    if (permissionsReady && !canManagePerm(permissions, "sales.credit_notes")) {
      toast({
        title: t("صلاحية غير كافية"),
        description: t(
          "إنشاء الإشعارات يتطلب صلاحية إدارة الإشعارات الدائنة. لم يتم ترحيل أي شيء.",
        ),
        variant: "destructive",
      });
      return;
    }

    // منشأة خارج السعودية (S14): الخادم يرفض الإشعارات حتى الضريبة حسب الدولة
    if (!isSaudiCompany()) {
      toast({ title: t("لا يمكن إصدار الإشعار"), description: t(BILLING_COUNTRY_MESSAGE), variant: "destructive" });
      return;
    }
    // المرحلة الأولى: الإشعار لا يُرسل للهيئة، فلا يُطلب تأكيد الإرسال الحقيقي
    const companyInPhase1 = COMPANY_PROFILE.zatcaPhase === "phase1";
    // ورمز QR فيها إلزامي وفيه الرقم الضريبي، والقاعدة ترفض الإشعار دونه
    if (companyInPhase1 && !COMPANY_PROFILE.vatNumber.trim()) {
      toast({
        title: t("لا يمكن إصدار الإشعار"),
        description: t(salesNoteErrorText("ZATCA_COMPANY_VAT_REQUIRED")),
        variant: "destructive",
      });
      return;
    }
    const productionConfirmation = companyInPhase1
      ? ""
      : window.prompt(
          "هذا إشعار إنتاج حقيقي وملزم قانونيًا لدى ZATCA. اكتب SUBMIT_REAL_ZATCA_INVOICE للمتابعة:",
        );
    if (!companyInPhase1 && productionConfirmation?.trim() !== "SUBMIT_REAL_ZATCA_INVOICE") {
      toast({
        title: t("تم إلغاء الإرسال الحقيقي"),
        description: t("لم يتم إنشاء أو إرسال الإشعار إلى ZATCA."),
        variant: "destructive",
      });
      return;
    }

    const cleanedItems = form.items.filter(
      (item) =>
        item.description.trim() || item.account.trim() || item.unitPrice > 0,
    );
    const requestId = requestIdRef.current;

    saveInFlight.current = true;
    setSaving(true);
    try {
      // الرقم والتاريخ (اليوم بتوقيت الرياض) والإجماليات من القاعدة، والسبب يُحفظ مع الترحيل نفسه
      const { data: result, error } = await supabase.rpc(
        "post_sales_adjustment_note",
        {
          p_request_id: requestId,
          p_note_type: form.noteType,
          p_original_invoice_id: form.originalInvoiceId,
          p_reason: form.reason.trim(),
          p_items: cleanedItems,
        },
      );

      if (error || !result?.id) {
        if (error && !error.code) {
          // خطأ اتصال لا رد من القاعدة: قد يكون الإشعار حُفظ. نُبقي معرّف الطلب نفسه لإعادة المحاولة
          toast({
            title: t("تعذر التأكد من حفظ الإشعار"),
            description: t(
              "انقطع الاتصال قبل وصول الرد. حدّث القائمة؛ إعادة الحفظ من هذا النموذج لن تنشئ إشعارًا مكررًا.",
            ),
            variant: "destructive",
          });
          return;
        }
        toast({
          title: t("تعذر ترحيل الإشعار"),
          description: t(salesNoteErrorText(String(error?.message ?? ""))),
          variant: "destructive",
        });
        return;
      }
      if (result.existing) {
        toast({
          title: t("الإشعار مسجّل مسبقًا"),
          description: `${String(result.noteNumber)} — ${t("لم يُنشأ إشعار جديد؛ هذا هو الإشعار المسجّل من المحاولة السابقة.")}`,
        });
      }
      const data = String(result.id);
      const issueDate = String(result.issueDate ?? riyadhDateString());
      const savedSubtotal = Number(result.subtotal ?? subtotal);
      const savedTax = Number(result.tax ?? tax);
      const savedTotal = Number(result.total ?? total);

      // بيانات الإشعار كما حُفظت في القاعدة (قد يكون مسجّلًا من محاولة سابقة)
      const { data: postedNote } = await supabase
        .from("invoice_adjustment_notes")
        .select("accounting_status, accounting_journal_entry_id, reason, items, balance_before, balance_after, zatca_phase, zatca_status, qr_code_data")
        .eq("id", String(data))
        .single();

      // مرحلة الإشعار تحددها القاعدة عند الإصدار: المرحلة الأولى لا تُرسل للهيئة.
      // وإن ظنت الصفحة أن المنشأة في المرحلة الأولى (بلا تأكيد إرسال) فلا إرسال الآن؛ يُرسل من زر إعادة الإرسال
      const notePhase1 = postedNote?.zatca_phase === "phase1";
      const skipZatcaSubmit = notePhase1 || companyInPhase1;
      if (!notePhase1 && companyInPhase1) {
        toast({
          title: t("المنشأة الآن في المرحلة الثانية"),
          description: t("حُفظ الإشعار؛ أرسله للهيئة من زر إعادة الإرسال في القائمة."),
        });
      }
      const zatca = skipZatcaSubmit
        ? ({
            data: {
              status: String(postedNote?.zatca_status ?? (notePhase1 ? "phase1" : "pending")),
              qrCodeData: String(postedNote?.qr_code_data ?? ""),
            },
            error: null,
          } as Awaited<ReturnType<typeof supabase.functions.invoke>>)
        : await supabase.functions.invoke("zatca-invoice", {
            body: {
              noteId: String(data),
              mode: "production",
              deviceSerial: localStorage.getItem(zatcaDeviceSerialKey()),
              productionConfirmation: (productionConfirmation ?? "").trim(),
            },
          });
      // الحالة الفعلية من رد الدالة (مثل ambiguous) بدل افتراض "مرفوض" عند أي خطأ
      let zatcaFailureStatus = "rejected";
      if (zatca.error || zatca.data?.error) {
        const context = (zatca.error as { context?: Response } | null)?.context;
        const payload = context
          ? await context
              .clone()
              .json()
              .catch(() => null)
          : null;
        if (
          payload?.status === "ambiguous" ||
          zatca.data?.status === "ambiguous"
        ) {
          zatcaFailureStatus = "ambiguous";
        }
        toast({
          title: t("تعذر إرسال الإشعار إلى ZATCA"),
          description: String(
            payload?.error ??
              zatca.data?.error ??
              zatca.error?.message ??
              t("حدث خطأ غير متوقع"),
          ),
          variant: "destructive",
        });
      } else if (!skipZatcaSubmit) {
        toast({ title: "ZATCA", description: String(zatca.data.message) });
      }

      const invoice = invoices.find(
        (item) => item.id === form.originalInvoiceId,
      )!;
      const signedAmount =
        form.noteType === "sales_credit" ? -savedTotal : savedTotal;
      const payload: SavedCreditNote = {
        id: String(data),
        noteNumber: String(result.noteNumber),
        noteType: form.noteType,
        originalInvoiceId: form.originalInvoiceId,
        customer: form.customer,
        reason: String(postedNote?.reason ?? form.reason.trim()),
        currency: "SAR",
        date: issueDate,
        orderRef: form.orderRef,
        reference: form.originalInvoiceId,
        project: form.project,
        warehouse: form.warehouse,
        subtotal: savedSubtotal,
        tax: savedTax,
        total: savedTotal,
        balanceBefore: Number(postedNote?.balance_before ?? invoice.adjustedTotal),
        balanceAfter: Number(
          postedNote?.balance_after ?? invoice.adjustedTotal + signedAmount,
        ),
        items: Array.isArray(postedNote?.items)
          ? postedNote.items
          : cleanedItems.length > 0
            ? cleanedItems
            : [emptyItem()],
        zatcaStatus: String(
          zatca.error || zatca.data?.error
            ? zatcaFailureStatus
            : (zatca.data?.status ?? "pending"),
        ),
        qrCodeData: String(zatca.data?.qrCodeData ?? ""),
        accountingStatus: String(postedNote?.accounting_status ?? "posted"),
        accountingJournalEntryId: String(
          postedNote?.accounting_journal_entry_id ?? "",
        ),
      };
      setSavedNotes((current) => [
        payload,
        ...current.filter((note) => note.id !== payload.id),
      ]);
      setInvoices((current) =>
        current.map((item) =>
          item.id === form.originalInvoiceId
            ? { ...item, adjustedTotal: payload.balanceAfter }
            : item,
        ),
      );

      requestIdRef.current = crypto.randomUUID();
      const sequence = extractSequence(payload.noteNumber) + 1;
      setNextSequence(sequence);
      const nextForm = createEmptyForm(sequence);
      nextForm.items = nextForm.items.map((item) => ({
        ...item,
        account: defaultRevenueAccount,
      }));
      setForm(nextForm);
      setMode("list");
      toast({
        title:
          form.noteType === "sales_credit"
            ? t("تم ترحيل الإشعار الدائن")
            : t("تم ترحيل الإشعار المدين"),
        description: `${t("تم ربط")} ${payload.noteNumber} ${t("بالفاتورة")} ${payload.originalInvoiceId} ${t("وتسجيل القيد المحاسبي")}`,
      });
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };

  // إعادة إرسال إشعار مرحّل لم تقبله الهيئة بعد (نفس الدالة ونفس مفتاح عدم التكرار)
  const resendNote = async (note: SavedCreditNote) => {
    if (
      note.accountingStatus !== "posted" ||
      !ZATCA_RESENDABLE_STATUSES.has(note.zatcaStatus) ||
      resendInFlight.current.has(note.id)
    ) {
      return;
    }
    // القاعدة تحسم: لا إعادة أثناء إرسال لم يكتمل أو نتيجة غير محسومة أو بعد القبول
    const { data: resendState, error: resendStateError } = await supabase.rpc(
      "zatca_resend_state",
      { p_table: "invoice_adjustment_notes", p_id: note.id },
    );
    if (resendStateError || resendState !== "allowed") {
      toast({
        title: t("تعذر إعادة الإرسال"),
        description: t(
          zatcaResendStateMessages[String(resendState ?? "")] ??
            salesNoteErrorText(String(resendStateError?.message ?? resendState ?? "")),
        ),
        variant: "destructive",
      });
      return;
    }
    const confirmation = window.prompt(
      `إعادة إرسال الإشعار ${note.noteNumber} إلى ZATCA (إنتاج حقيقي وملزم قانونيًا). اكتب SUBMIT_REAL_ZATCA_INVOICE للمتابعة:`,
    );
    if (confirmation?.trim() !== "SUBMIT_REAL_ZATCA_INVOICE") {
      toast({
        title: t("تم إلغاء إعادة الإرسال"),
        description: t("لم يُرسل شيء إلى ZATCA."),
        variant: "destructive",
      });
      return;
    }
    resendInFlight.current.add(note.id);
    try {
      const zatca = await supabase.functions.invoke("zatca-invoice", {
        body: {
          noteId: note.id,
          mode: "production",
          deviceSerial: localStorage.getItem(zatcaDeviceSerialKey()),
          productionConfirmation: confirmation.trim(),
        },
      });
      if (zatca.error || zatca.data?.error) {
        const context = (zatca.error as { context?: Response } | null)?.context;
        const errorPayload = context
          ? await context
              .clone()
              .json()
              .catch(() => null)
          : null;
        toast({
          title: t("تعذر إرسال الإشعار إلى ZATCA"),
          description: String(
            errorPayload?.error ??
              zatca.data?.error ??
              zatca.error?.message ??
              t("حدث خطأ غير متوقع"),
          ),
          variant: "destructive",
        });
      } else {
        toast({ title: "ZATCA", description: String(zatca.data.message) });
      }
      // الحالة الفعلية من القاعدة بعد المحاولة
      const { data: fresh } = await supabase
        .from("invoice_adjustment_notes")
        .select("zatca_status, qr_code_data")
        .eq("id", note.id)
        .maybeSingle();
      if (fresh) {
        setSavedNotes((current) =>
          current.map((item) =>
            item.id === note.id
              ? {
                  ...item,
                  zatcaStatus: String(fresh.zatca_status ?? item.zatcaStatus),
                  qrCodeData: String(fresh.qr_code_data ?? item.qrCodeData ?? ""),
                }
              : item,
          ),
        );
      }
    } finally {
      resendInFlight.current.delete(note.id);
    }
  };

  return (
    <Layout subMenu={{ title: t("المبيعات"), items: salesFeatures }}>
      <div dir={direction} className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-foreground">
              {t("إشعارات تعديل المبيعات")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {mode === "list"
                ? t("إشعارات دائنة ومدينة مرتبطة بالفواتير")
                : t("إنشاء إشعار مرتبط بفاتورة مبيعات")}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {mode === "list" ? (
              <button
                onClick={createNewNote}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white"
              >
                <Plus className="h-4 w-4" />
                {t("إنشاء إشعار جديد")}
              </button>
            ) : (
              <>
                <button
                  onClick={() => setMode("list")}
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium"
                >
                  <ArrowRight
                    className={`h-4 w-4 ${direction === "ltr" ? "rotate-180" : ""}`}
                  />
                  {t("الرجوع للإشعارات")}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <Save className="h-4 w-4" />
                  {t("حفظ الإشعار")}
                </button>
              </>
            )}
          </div>
        </div>

        {mode === "list" ? (
          <div className="space-y-4 rounded-xl border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">
              {t("عدد الإشعارات المرحلة")}:{" "}
              <span className="font-semibold text-foreground">
                {formatNumber(savedNotes.length)}
              </span>
            </p>

            {savedNotes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("لا يوجد إشعارات محفوظة حالياً.")}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table
                  className={`w-full min-w-[700px] text-sm ${direction === "rtl" ? "text-right" : "text-left"}`}
                >
                  <thead>
                    <tr className="bg-muted/40">
                      <th className="px-3 py-2">{t("رقم الإشعار")}</th>
                      <th className="px-3 py-2">{t("النوع")}</th>
                      <th className="px-3 py-2">{t("الفاتورة الأصلية")}</th>
                      <th className="px-3 py-2">{t("العميل")}</th>
                      <th className="px-3 py-2">{t("التاريخ")}</th>
                      <th className="px-3 py-2">{t("الإجمالي")}</th>
                      <th className="px-3 py-2">{t("الرصيد بعد الإشعار")}</th>
                      <th className="px-3 py-2">{t("القيد المحاسبي")}</th>
                      <th className="px-3 py-2">{t("حالة ZATCA")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {savedNotes.map((note) => (
                      <tr key={note.id} className="border-t border-border">
                        <td className="px-3 py-2">
                          <button
                            onClick={() => {
                              setSelectedNote(note);
                              setMode("details");
                            }}
                            className="font-semibold text-primary underline-offset-2 hover:underline"
                          >
                            {note.noteNumber}
                          </button>
                        </td>
                        <td className="px-3 py-2">
                          {note.noteType === "sales_credit"
                            ? `${t("دائن")} −`
                            : `${t("مدين")} +`}
                        </td>
                        <td className="px-3 py-2 font-medium">
                          {note.originalInvoiceId}
                        </td>
                        <td className="px-3 py-2">{note.customer}</td>
                        <td className="px-3 py-2">{formatDate(note.date)}</td>
                        <td className="px-3 py-2">
                          {formatNumber(note.total, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}{" "}
                          {note.currency}
                        </td>
                        <td className="px-3 py-2 font-semibold">
                          {formatNumber(note.balanceAfter, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}{" "}
                          {note.currency}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`rounded-full px-2 py-1 text-xs font-semibold ${
                              note.accountingStatus === "posted"
                                ? "bg-blue-100 text-blue-700"
                                : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {t(
                              accountingStatusLabels[note.accountingStatus] ??
                                note.accountingStatus,
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`rounded-full px-2 py-1 text-xs font-semibold ${
                              note.zatcaStatus === "cleared" ||
                              note.zatcaStatus === "reported"
                                ? "bg-emerald-100 text-emerald-700"
                                : note.zatcaStatus === "rejected"
                                  ? "bg-rose-100 text-rose-700"
                                  : note.zatcaStatus === "phase1"
                                    ? "bg-sky-100 text-sky-700"
                                    : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {t(
                              zatcaStatusLabels[note.zatcaStatus] ??
                                note.zatcaStatus,
                            )}
                          </span>
                          {note.accountingStatus === "posted" &&
                            ZATCA_RESENDABLE_STATUSES.has(note.zatcaStatus) && (
                              <button
                                onClick={() => resendNote(note)}
                                className="ms-2 inline-flex items-center gap-1 rounded-md border border-amber-200 px-2 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-50"
                              >
                                <RefreshCw className="h-3 w-3" />
                                {t("إعادة الإرسال للهيئة")}
                              </button>
                            )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : mode === "details" && selectedNote ? (
          <div className="space-y-4 rounded-xl border border-border bg-card p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-bold text-foreground">
                {selectedNote.noteNumber}
              </h2>
              <button
                onClick={() => setMode("list")}
                className="rounded-md border border-border px-4 py-2 text-sm font-semibold"
              >
                {t("رجوع للقائمة")}
              </button>
            </div>
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <p>
                {t("النوع")}:{" "}
                {selectedNote.noteType === "sales_credit"
                  ? t("إشعار دائن")
                  : t("إشعار مدين")}
              </p>
              <p>
                {t("الفاتورة الأصلية")}: {selectedNote.originalInvoiceId}
              </p>
              <p>
                {t("العميل")}: {selectedNote.customer}
              </p>
              <p>
                {t("التاريخ")}: {formatDate(selectedNote.date)}
              </p>
              <p>
                {t("المجموع الفرعي")}:{" "}
                {formatNumber(selectedNote.subtotal, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{" "}
                {selectedNote.currency}
              </p>
              <p>
                {t("الضريبة")}:{" "}
                {formatNumber(selectedNote.tax, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{" "}
                {selectedNote.currency}
              </p>
              <p>
                {t("الإجمالي")}:{" "}
                {formatNumber(selectedNote.total, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{" "}
                {selectedNote.currency}
              </p>
              <p>
                {t("حالة ZATCA")}:{" "}
                {t(
                  zatcaStatusLabels[selectedNote.zatcaStatus] ??
                    selectedNote.zatcaStatus,
                )}
              </p>
              <p>
                {t("القيد المحاسبي")}:{" "}
                {t(
                  accountingStatusLabels[selectedNote.accountingStatus] ??
                    selectedNote.accountingStatus,
                )}
              </p>
              {selectedNote.accountingJournalEntryId && (
                <p>
                  {t("رقم القيد")}: {selectedNote.accountingJournalEntryId}
                </p>
              )}
            </div>
            <div className="flex items-center gap-4 border-t border-border pt-4">
              {selectedNote.qrCodeData ? (
                <ZatcaQrCode value={selectedNote.qrCodeData} size={112} />
              ) : (
                <div className="flex h-28 w-28 items-center justify-center rounded border border-dashed border-border text-xs text-muted-foreground">
                  {t(selectedNote.zatcaStatus === "phase1" ? "لا يوجد رقم ضريبي للمنشأة" : "QR بعد الاعتماد")}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {selectedNote.zatcaStatus === "phase1"
                  ? t("المرحلة الأولى: يُنشأ رمز الاستجابة السريعة عند إصدار الإشعار، ولا يُرسل للهيئة.")
                  : t("يظهر رمز الاستجابة السريعة بعد قبول ZATCA للإشعار.")}
              </p>
            </div>
          </div>
        ) : (
          <>
            {COMPANY_PROFILE.zatcaPhase === "phase1" && !COMPANY_PROFILE.vatNumber.trim() ? (
              <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                {t("الرقم الضريبي للمنشأة غير مسجّل؛ لا تصدر الإشعارات حتى تضيفه إدارة المنصة")}
              </div>
            ) : null}
            <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
              <div className="space-y-3 rounded-xl border border-border bg-card p-4">
                <img
                  src={COMPANY_PROFILE.logoUrl}
                  alt={COMPANY_PROFILE.companyNameAr}
                  className="h-20 w-40 object-contain"
                />
                <h2 className="text-xl font-bold text-foreground">
                  {COMPANY_PROFILE.companyNameAr}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {COMPANY_PROFILE.addressAr}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t("رقم التسجيل الضريبي")}: {COMPANY_PROFILE.vatNumber}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t("رقم السجل التجاري")}:{" "}
                  {COMPANY_PROFILE.commercialRegistration}
                </p>
              </div>

              <div className="space-y-3 rounded-xl border border-border bg-card p-4">
                <Field label={t("رقم الإشعار")}>
                  <input
                    value={t("تلقائي عند الحفظ")}
                    readOnly
                    className="h-10 w-full rounded-md border border-border bg-muted/30 px-3 text-sm"
                  />
                </Field>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t("نوع الإشعار*")}>
                    <select
                      value={form.noteType}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          noteType: e.target.value as
                            | "sales_credit"
                            | "sales_debit",
                        })
                      }
                      className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                    >
                      <option value="sales_credit">
                        {t("إشعار دائن — يخفض رصيد الفاتورة")}
                      </option>
                      <option value="sales_debit">
                        {t("إشعار مدين — يزيد رصيد الفاتورة")}
                      </option>
                    </select>
                  </Field>
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
                          customer: invoice?.customer || "",
                          reference: e.target.value,
                        });
                      }}
                      className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                    >
                      <option value="">
                        {t("اختر الفاتورة")} —{" "}
                        {t("تظهر فواتير المرحلة الأولى والفواتير المقبولة لدى الهيئة")}
                      </option>
                      {invoices.map((invoice) => (
                        <option key={invoice.id} value={invoice.id}>
                          {invoice.id} — {invoice.customer} — {t("الرصيد")}{" "}
                          {formatNumber(invoice.adjustedTotal, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}{" "}
                          SAR
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                <Field label={t("سبب الإشعار الدائن/المدين*")}>
                  <textarea
                    value={form.reason}
                    onChange={(e) =>
                      setForm({ ...form, reason: e.target.value })
                    }
                    rows={3}
                    placeholder={t(
                      "مثال: إلغاء جزئي، خطأ في السعر، أو تعديل كمية",
                    )}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  />
                </Field>

                <Field label={t("العميل المرتبط بالفاتورة")}>
                  <input
                    value={form.customer}
                    readOnly
                    placeholder={t("يُحدد تلقائياً من الفاتورة")}
                    className="h-10 w-full rounded-md border border-border bg-muted/30 px-3 text-sm"
                  />
                </Field>

                <div className="grid gap-3 sm:grid-cols-2">
                  {/* القيد وملف ZATCA بالريال دائمًا، فالعملة للعرض فقط */}
                  <Field label={t("العملة*")}>
                    <input
                      value="SAR"
                      readOnly
                      disabled
                      className="h-10 w-full rounded-md border border-border bg-muted/30 px-3 text-sm"
                    />
                  </Field>
                  {/* تاريخ الإصدار = اليوم بتوقيت الرياض ولا يُعدَّل للمستند الإلكتروني */}
                  <Field label={t("التاريخ*")}>
                    <input
                      type="date"
                      value={form.date}
                      readOnly
                      disabled
                      className="h-10 w-full rounded-md border border-border bg-muted/30 px-3 text-sm"
                    />
                  </Field>
                </div>

                {/* أمر الشراء والمشروع والمستودع أُزيلت: لم تكن تُحفظ في أي مكان */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t("مرجع الفاتورة")}>
                    <input
                      value={form.reference}
                      readOnly
                      placeholder={t("يُحدد من الفاتورة الأصلية")}
                      className="h-10 w-full rounded-md border border-border bg-muted/30 px-3 text-sm"
                    />
                  </Field>
                </div>
              </div>
            </div>

            <div className="space-y-3 rounded-xl border border-border bg-card p-4">
              <p className="text-sm font-semibold text-foreground">
                {t(
                  "الأسعار غير شاملة الضريبة — تُضاف ضريبة القيمة المضافة 15% تلقائيًا",
                )}
              </p>

              <div className="overflow-x-auto">
                <table
                  className={`w-full min-w-[900px] text-sm ${direction === "rtl" ? "text-right" : "text-left"}`}
                >
                  <thead>
                    <tr className="bg-muted/40">
                      <th className="px-3 py-2">{t("الوصف")}</th>
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
                              placeholder={t("مفتاح أو خدمة")}
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
                              {(revenueAccounts.length
                                ? revenueAccounts
                                : [
                                    {
                                      code: "411",
                                      nameAr: "إيرادات المبيعات والخدمات",
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
                            {formatNumber(lineTotal, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}{" "}
                            {t("﷼")}
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
                  "رمز الاستجابة السريعة يظهر لعرض متطلبات هيئة الزكاة والضريبة والجمارك بالفاتورة الإلكترونية.",
                )}
              </div>

              <div className="space-y-2 rounded-xl border border-border bg-card p-4 text-sm">
                <div className="flex items-center justify-between">
                  <span>{t("المجموع الفرعي")}</span>
                  <span>
                    {formatNumber(subtotal, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{" "}
                    {t("﷼")}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>{t("إجمالي ضريبة القيمة المضافة")}</span>
                  <span>
                    {formatNumber(tax, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{" "}
                    {t("﷼")}
                  </span>
                </div>
                <div className="flex items-center justify-between border-t border-border pt-2 text-base font-semibold">
                  <span>{t("المجموع")}</span>
                  <span>
                    {formatNumber(total, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{" "}
                    {t("﷼")}
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
