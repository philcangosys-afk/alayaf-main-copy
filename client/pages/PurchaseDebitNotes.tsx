import Layout from "@/components/Layout";
import { purchasesFeatures } from "./Purchases";
import { ArrowRight, Eye, Plus, Printer, Save, Trash2 } from "lucide-react";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n";
import { supabase } from "@/lib/supabaseClient";
import { COMPANY_PROFILE, companyDocPrefix } from "@/lib/companyProfile";
import { escapeHtml, riyadhDateString, SAUDI_STANDARD_VAT_RATE } from "@/lib/utils";
import { selectAllRows } from "@/lib/ledgerData";
import { inventoryErrorText } from "@/lib/inventoryErrors";
import { accountingErrorText } from "@/lib/accountingErrors";
import { dbErrorText } from "@/lib/dbErrors";

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
  // بند مرتجع مخزني (اختياري): الصنف والمستودع معًا؛ الكمية تخرج بمتوسط التكلفة
  // والحساب حينها حساب فرق السعر (يُرسل أيضًا accountCode)
  productId?: string;
  warehouseId?: string;
  accountCode?: string;
  discount?: number;
  // للعرض والطباعة فقط
  productSku?: string;
  productName?: string;
  warehouseCode?: string;
  warehouseName?: string;
};

type StockProduct = { id: string; sku: string; name: string; unit: string };
type StockWarehouse = { id: string; code: string; name: string };
type StockBalance = { productId: string; warehouseId: string; quantity: number };

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
  // نقص رصيد البند المخزني (الرسالة تحمل الصنف والمتاح والمطلوب)، وصلاحية حركة المخزون لبنود الأصناف
  if (/_INSUFFICIENT_STOCK/.test(message) || message.includes("INVENTORY_PERMISSION_REQUIRED")) {
    return inventoryErrorText(message, t);
  }
  const map: [string, string][] = [
    ["PURCHASE_CREDIT_NOTE_PRODUCT_INVALID", "الصنف المختار غير صالح: يجب أن يكون صنفًا مخزنيًا نشطًا"],
    ["PURCHASE_CREDIT_NOTE_WAREHOUSE_INVALID", "المستودع المختار غير موجود أو غير نشط"],
    ["PURCHASE_CREDIT_NOTE_STOCK_LINE_AMOUNT_REQUIRED", "البند المخزني يحتاج قيمة أكبر من صفر (الكمية × السعر)"],
    ["PURCHASE_CREDIT_NOTE_DUPLICATE_PRODUCT", "الصنف مكرر في الإشعار: اجمع كميته في بند واحد"],
    ["PURCHASE_CREDIT_NOTE_STOCK_LINE_INVALID", "البند المخزني يحتاج صنفًا ومستودعًا وكمية أكبر من صفر"],
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
  if (hit) return t(hit[1]);
  // الفترات المالية وأخطاء القاعدة العامة؛ ورسائل الخادم العربية تبقى كما هي.
  // القرار على الرسالة الخام (لا المترجمة) حتى لا تصبح الأخطاء المعروفة عامة في الواجهة الإنجليزية
  const text = accountingErrorText(message, t);
  return text !== message || /[\u0600-\u06FF]/.test(message)
    ? text
    : t("تعذّر ترحيل الإشعار. حاول مرة أخرى أو راجع مدير النظام.");
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
  const { t, direction, locale, formatDate, formatNumber } = useI18n();
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
    formatNumber(Math.abs(value) < 0.005 ? 0 : value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const formatQuantity = (value: number) =>
    formatNumber(Math.abs(value) < 0.00005 ? 0 : value, { maximumFractionDigits: 4 });
  const [mode, setMode] = useState<"list" | "create" | "view">("list");
  const [viewNote, setViewNote] = useState<DebitNote | null>(null);
  // أصناف المخزون والمستودعات لبنود المرتجع المخزني (تحتاج صلاحية عرض المخزون)
  const [products, setProducts] = useState<StockProduct[]>([]);
  const [warehouses, setWarehouses] = useState<StockWarehouse[]>([]);
  const [balances, setBalances] = useState<StockBalance[] | null>(null);
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
      const emptyRows = { data: [] as any[], error: null };
      const [notesResult, invoicesResult, accountsResult, ruleResult, productsResult, warehousesResult, balancesResult] =
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
          // البند المخزني: أصناف مخزنية نشطة ومستودعات نشطة، ورصيد كل صنف في كل مستودع
          noteType === "purchase_credit"
            ? selectAllRows((from, to) => supabase.from("inventory_products").select("id, sku, name_ar, unit").eq("item_type", "product").eq("track_inventory", true).eq("active", true).order("sku").order("id").range(from, to))
            : Promise.resolve(emptyRows),
          noteType === "purchase_credit"
            ? selectAllRows((from, to) => supabase.from("inventory_warehouses").select("id, code, name_ar").eq("active", true).order("code").order("id").range(from, to))
            : Promise.resolve(emptyRows),
          noteType === "purchase_credit" ? supabase.rpc("list_inventory_balances") : Promise.resolve(emptyRows),
        ]);

      setLoadError(
        notesResult.error
          ? t(dbErrorText(String(notesResult.error.message ?? "")) ?? "حاول مرة أخرى")
          : "",
      );
      if (!productsResult.error) {
        setProducts((productsResult.data ?? []).map((row: any) => ({
          id: String(row.id),
          sku: String(row.sku ?? ""),
          name: String(row.name_ar ?? ""),
          unit: String(row.unit ?? ""),
        })));
      }
      if (!warehousesResult.error) {
        setWarehouses((warehousesResult.data ?? []).map((row: any) => ({
          id: String(row.id),
          code: String(row.code ?? ""),
          name: String(row.name_ar ?? ""),
        })));
      }
      setBalances(
        balancesResult.error
          ? null
          : (balancesResult.data ?? []).map((row: any) => ({
              productId: String(row.product_id),
              warehouseId: String(row.warehouse_id),
              quantity: Number(row.quantity) || 0,
            })),
      );
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

  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const warehouseById = useMemo(() => new Map(warehouses.map((warehouse) => [warehouse.id, warehouse])), [warehouses]);
  // الرصيد المتاح للعرض فقط (الخادم يتحقق عند الترحيل). بلا صلاحية حركات المخزون تعود القائمة فارغة فلا نعرضه
  const availableFor = (productId?: string, warehouseId?: string) => {
    if (!balances || balances.length === 0 || !productId || !warehouseId) return null;
    return balances
      .filter((balance) => balance.productId === productId && balance.warehouseId === warehouseId)
      .reduce((sum, balance) => sum + balance.quantity, 0);
  };
  const productLabel = (item: DebitNoteItem) => {
    const product = item.productId ? productById.get(item.productId) : undefined;
    if (product) return `${product.sku} — ${product.name}`;
    return [item.productSku, item.productName].filter(Boolean).join(" — ") || t("صنف مخزني");
  };
  const warehouseLabel = (item: DebitNoteItem) => {
    const warehouse = item.warehouseId ? warehouseById.get(item.warehouseId) : undefined;
    if (warehouse) return `${warehouse.code} — ${warehouse.name}`;
    return [item.warehouseCode, item.warehouseName].filter(Boolean).join(" — ") || "-";
  };

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

  // اختيار الصنف يجعل البند مرتجعًا مخزنيًا: الوصف من الصنف، وحساب البند يصبح حساب فرق السعر (الافتراضي حساب المشتريات)
  const selectProduct = (id: string, productId: string) => {
    const product = productById.get(productId);
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((item) => {
        if (item.id !== id) return item;
        if (!product) return { ...item, productId: "", warehouseId: "" };
        return {
          ...item,
          productId: product.id,
          warehouseId: item.warehouseId || (warehouses.length === 1 ? warehouses[0].id : ""),
          description: `${product.sku} — ${product.name}`,
          account: item.productId ? item.account : defaultExpenseAccount,
        };
      }),
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
    if (form.items.some((item) => Boolean(item.productId) !== Boolean(item.warehouseId))) {
      toast({
        title: t("بيانات البند المخزني غير مكتملة"),
        description: t("اختر الصنف والمستودع معًا للبند المخزني، أو اترك الاثنين فارغين"),
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
    // البند المخزني يحمل الصنف والمستودع، وaccountCode = حساب فرق السعر؛ البند العادي كما كان
    const cleanedItems: DebitNoteItem[] = form.items.map(
      ({ productId, warehouseId, accountCode: _accountCode, productSku, productName, warehouseCode, warehouseName, ...item }) => {
        const line = { ...item, taxPercent: noteTaxRate };
        if (!productId || !warehouseId) return line;
        const product = productById.get(productId);
        const warehouse = warehouseById.get(warehouseId);
        return {
          ...line,
          accountCode: item.account,
          productId,
          warehouseId,
          productSku: product?.sku ?? productSku ?? "",
          productName: product?.name ?? productName ?? "",
          warehouseCode: warehouse?.code ?? warehouseCode ?? "",
          warehouseName: warehouse?.name ?? warehouseName ?? "",
        };
      },
    );
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
      if (/_INSUFFICIENT_STOCK/.test(String(error.message ?? ""))) {
        // تحديث الرصيد المعروض بعد رفض الخادم
        supabase.rpc("list_inventory_balances").then(({ data, error: balanceError }) => {
          if (balanceError) return;
          setBalances((data ?? []).map((row: any) => ({
            productId: String(row.product_id),
            warehouseId: String(row.warehouse_id),
            quantity: Number(row.quantity) || 0,
          })));
        });
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
    // الكميات المرتجعة خرجت من المستودع
    setBalances((current) =>
      current
        ? [
            ...current,
            ...cleanedItems
              .filter((item) => item.productId && item.warehouseId)
              .map((item) => ({ productId: item.productId!, warehouseId: item.warehouseId!, quantity: -Number(item.quantity) })),
          ]
        : current,
    );
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

  // بنود الإشعار للعرض والطباعة (البند المخزني يظهر بصنفه ومستودعه)
  const noteLines = (note: DebitNote) =>
    note.items.map((raw) => {
      const item = (raw ?? {}) as DebitNoteItem;
      const quantity = Number(item.quantity) || 0;
      const unitPrice = Number(item.unitPrice) || 0;
      const isStock = Boolean(item.productId);
      return {
        description: String(item.description ?? ""),
        account: String(item.accountCode || item.account || ""),
        quantity,
        unitPrice,
        lineTotal: round2(quantity * unitPrice - (Number(item.discount) || 0)),
        product: isStock ? productLabel(item) : "",
        warehouse: isStock ? warehouseLabel(item) : "",
      };
    });

  const openNote = (note: DebitNote) => {
    setViewNote(note);
    setMode("view");
  };

  const printNote = (note: DebitNote) => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    const lines = noteLines(note);
    const hasStock = lines.some((line) => line.product);
    const title = t(isCredit ? "إشعار دائن مشتريات" : "إشعار مدين مشتريات");
    const sar = escapeHtml(t("ريال"));
    const rowsHtml = lines
      .map(
        (line, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(line.description || "-")}</td>${
          hasStock ? `<td>${escapeHtml(line.product || "-")}</td><td>${escapeHtml(line.warehouse || "-")}</td>` : ""
        }<td>${escapeHtml(line.account || "-")}</td><td>${escapeHtml(formatQuantity(line.quantity))}</td><td>${escapeHtml(formatAmount(line.unitPrice))}</td><td>${escapeHtml(formatAmount(line.lineTotal))}</td></tr>`,
      )
      .join("");
    printWindow.document.write(`
      <html dir="${direction}" lang="${locale}">
        <head>
          <title>${escapeHtml(title)} ${escapeHtml(note.noteNumber)}</title>
          <meta charset="utf-8"/>
          <style>
            @page{size:A4 portrait;margin:10mm}
            body{font-family:Arial,Tahoma,sans-serif;margin:0;color:#111827;background:#fff;font-size:12px}
            .company{display:flex;justify-content:space-between;gap:12px;border-bottom:2px solid #334155;padding-bottom:8px;line-height:1.6}
            .company .en{direction:ltr;text-align:left}
            .title{text-align:center;font-size:20px;font-weight:700;margin:10px 0}
            .grid{display:grid;grid-template-columns:1fr 1fr;border:1px solid #d1d5db;margin-bottom:10px}
            .card{padding:6px 8px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;gap:8px}
            .label{color:#4b5563}.value{font-weight:700}
            table{width:100%;border-collapse:collapse}
            th,td{border:1px solid #d1d5db;padding:6px 4px;text-align:center}
            th{background:#f3f4f6}
            .totals{width:280px;margin-top:10px;margin-inline-start:auto}
            .row{display:flex;justify-content:space-between;margin-bottom:6px}
            .final{font-weight:700;border-top:1px solid #d1d5db;padding-top:6px}
            .hint{margin-top:10px;color:#6b7280;font-size:11px}
          </style>
        </head>
        <body>
          <div class="company">
            <div>
              <strong>${escapeHtml(COMPANY_PROFILE.companyNameAr)}</strong><br>${escapeHtml(COMPANY_PROFILE.addressAr)}<br>
              ${escapeHtml(t("الرقم الضريبي"))} ${escapeHtml(COMPANY_PROFILE.vatNumber)}<br>
              ${escapeHtml(t("السجل التجاري"))} ${escapeHtml(COMPANY_PROFILE.commercialRegistration)}
            </div>
            <div class="en">
              <strong>${escapeHtml(COMPANY_PROFILE.companyNameEn)}</strong><br>${escapeHtml(COMPANY_PROFILE.addressEn)}<br>
              VAT No. ${escapeHtml(COMPANY_PROFILE.vatNumber)}<br>CR No. ${escapeHtml(COMPANY_PROFILE.commercialRegistration)}
            </div>
          </div>
          <div class="title">${escapeHtml(title)}</div>
          <div class="grid">
            <div class="card"><span class="label">${escapeHtml(t("رقم الإشعار"))}</span><span class="value">${escapeHtml(note.noteNumber)}</span></div>
            <div class="card"><span class="label">${escapeHtml(t("التاريخ"))}</span><span class="value">${escapeHtml(note.date ? formatDate(note.date) : "-")}</span></div>
            ${isCredit ? `
            <div class="card"><span class="label">${escapeHtml(t("رقم إشعار المورد"))}</span><span class="value">${escapeHtml(note.supplierDocumentNumber || "-")}</span></div>
            <div class="card"><span class="label">${escapeHtml(t("تاريخ إشعار المورد"))}</span>
              <span class="value">${escapeHtml(note.supplierDocumentDate ? formatDate(note.supplierDocumentDate) : "-")}</span></div>` : ""}
            <div class="card"><span class="label">${escapeHtml(t("الفاتورة الأصلية"))}</span><span class="value">${escapeHtml(note.originalInvoiceId || "-")}</span></div>
            <div class="card"><span class="label">${escapeHtml(t("المورد"))}</span><span class="value">${escapeHtml(note.supplier || "-")}</span></div>
          </div>
          <table>
            <thead><tr>
              <th>#</th><th>${escapeHtml(t("الوصف"))}</th>
              ${hasStock ? `<th>${escapeHtml(t("الصنف"))}</th><th>${escapeHtml(t("المستودع"))}</th>` : ""}
              <th>${escapeHtml(t("الحساب"))}</th><th>${escapeHtml(t("الكمية"))}</th><th>${escapeHtml(t("السعر"))}</th><th>${escapeHtml(t("المجموع"))}</th>
            </tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
          <div class="totals">
            <div class="row"><span>${escapeHtml(t("المجموع الفرعي"))}</span><strong>${escapeHtml(formatAmount(note.subtotal))} ${sar}</strong></div>
            <div class="row"><span>${escapeHtml(t("إجمالي ضريبة القيمة المضافة"))}</span><strong>${escapeHtml(formatAmount(note.tax))} ${sar}</strong></div>
            <div class="row final"><span>${escapeHtml(t("المجموع"))}</span><strong>${escapeHtml(formatAmount(note.total))} ${sar}</strong></div>
          </div>
          ${hasStock ? `<p class="hint">${escapeHtml(t("البنود المخزنية خرجت من المستودع بمتوسط التكلفة، والفرق بين قيمة البند وتكلفته قُيِّد على حساب البند."))}</p>` : ""}
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => printWindow.print(), 150);
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
              {mode === "list" ? t(`عرض ${pluralLabel}`) : mode === "view" ? t("تفاصيل الإشعار") : t(createLabel)}
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
            ) : mode === "view" ? (
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
                {viewNote && (
                  <button
                    onClick={() => printNote(viewNote)}
                    className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white"
                  >
                    <Printer className="h-4 w-4" />
                    {t("طباعة")}
                  </button>
                )}
              </>
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
                      <th className="px-3 py-2">{t("الإجراءات")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className="border-t border-border">
                        <td
                          className="px-3 py-2 font-semibold text-primary cursor-pointer hover:underline"
                          onClick={() => openNote(row)}
                        >
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
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => openNote(row)}
                              className="rounded-md border border-border p-2 hover:bg-muted/40"
                              title={t("عرض")}
                              aria-label={t("عرض")}
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => printNote(row)}
                              className="rounded-md border border-border p-2 hover:bg-muted/40"
                              title={t("طباعة")}
                              aria-label={t("طباعة")}
                            >
                              <Printer className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : mode === "view" ? (
          viewNote && (
            <div className="space-y-4 rounded-xl border border-border bg-card p-4">
              <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                {[
                  { label: t("رقم الإشعار"), value: viewNote.noteNumber },
                  ...(isCredit
                    ? [
                        { label: t("رقم إشعار المورد"), value: viewNote.supplierDocumentNumber || "-" },
                        { label: t("تاريخ إشعار المورد"), value: viewNote.supplierDocumentDate ? formatDate(viewNote.supplierDocumentDate) : "-" },
                      ]
                    : []),
                  { label: t("الفاتورة الأصلية"), value: viewNote.originalInvoiceId || "-" },
                  { label: t("المورد"), value: viewNote.supplier || "-" },
                  { label: t("التاريخ"), value: viewNote.date ? formatDate(viewNote.date) : "-" },
                ].map((field) => (
                  <div key={field.label}>
                    <p className="text-xs text-muted-foreground">{field.label}</p>
                    <p className="font-semibold text-foreground">{field.value}</p>
                  </div>
                ))}
              </div>
              {(() => {
                const lines = noteLines(viewNote);
                const hasStock = lines.some((line) => line.product);
                return (
                  <>
                    <div className="overflow-x-auto">
                      <table className={`w-full min-w-[700px] text-sm ${direction === "rtl" ? "text-right" : "text-left"}`}>
                        <thead>
                          <tr className="bg-muted/40">
                            <th className="px-3 py-2">#</th>
                            <th className="px-3 py-2">{t("الوصف")}</th>
                            {hasStock && <th className="px-3 py-2">{t("الصنف")}</th>}
                            {hasStock && <th className="px-3 py-2">{t("المستودع")}</th>}
                            <th className="px-3 py-2">{t("الحساب")}</th>
                            <th className="px-3 py-2">{t("الكمية")}</th>
                            <th className="px-3 py-2">{t("السعر")}</th>
                            <th className="px-3 py-2">{t("المجموع")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lines.map((line, index) => (
                            <tr key={index} className="border-t border-border">
                              <td className="px-3 py-2">{index + 1}</td>
                              <td className="px-3 py-2">{line.description || "-"}</td>
                              {hasStock && <td className="px-3 py-2">{line.product || "-"}</td>}
                              {hasStock && <td className="px-3 py-2">{line.warehouse || "-"}</td>}
                              <td className="px-3 py-2">{line.account || "-"}</td>
                              <td className="px-3 py-2">{formatQuantity(line.quantity)}</td>
                              <td className="px-3 py-2">{formatAmount(line.unitPrice)}</td>
                              <td className="px-3 py-2 font-semibold">{formatAmount(line.lineTotal)} {t("ريال")}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {hasStock && (
                      <p className="text-xs text-muted-foreground">
                        {t("البنود المخزنية خرجت من المستودع بمتوسط التكلفة، والفرق بين قيمة البند وتكلفته قُيِّد على حساب البند.")}
                      </p>
                    )}
                  </>
                );
              })()}
              <div className="ms-auto max-w-xs space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span>{t("المجموع الفرعي")}</span>
                  <span>{formatAmount(viewNote.subtotal)} {t("ريال")}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>{t("إجمالي ضريبة القيمة المضافة")}</span>
                  <span>{formatAmount(viewNote.tax)} {t("ريال")}</span>
                </div>
                <div className="flex items-center justify-between border-t border-border pt-2 text-base font-semibold">
                  <span>{t("المجموع")}</span>
                  <span>{formatAmount(viewNote.total)} {t("ريال")}</span>
                </div>
              </div>
            </div>
          )
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
              <p className="text-xs text-muted-foreground">
                {t("بند مرتجع مخزني (اختياري): اختر الصنف والمستودع؛ الكمية تخرج من المستودع بمتوسط التكلفة، والفرق بين قيمة البند وتكلفته يُقيَّد على حساب البند.")}
              </p>
              <div className="overflow-x-auto">
                <table
                  className={`w-full min-w-[1100px] text-sm ${direction === "rtl" ? "text-right" : "text-left"}`}
                >
                  <thead>
                    <tr className="bg-muted/40">
                      <th className="px-3 py-2">{t("الوصف*")}</th>
                      <th className="px-3 py-2">{t("الصنف والمستودع (مرتجع مخزني)")}</th>
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
                      const isStockLine = Boolean(item.productId);
                      const available = availableFor(item.productId, item.warehouseId);
                      const productUnit = item.productId ? productById.get(item.productId)?.unit ?? "" : "";
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
                            <div className="space-y-1">
                              <select
                                value={item.productId ?? ""}
                                onChange={(e) => selectProduct(item.id, e.target.value)}
                                className="h-10 w-full min-w-[12rem] rounded-md border border-border bg-background px-3"
                              >
                                <option value="">{t("بدون صنف (مصروف أو خدمة)")}</option>
                                {products.map((product) => (
                                  <option key={product.id} value={product.id}>
                                    {product.sku} — {product.name}
                                  </option>
                                ))}
                              </select>
                              {isStockLine && (
                                <select
                                  value={item.warehouseId ?? ""}
                                  onChange={(e) => updateItem(item.id, "warehouseId", e.target.value)}
                                  className="h-10 w-full rounded-md border border-border bg-background px-3"
                                >
                                  <option value="">{t("اختر المستودع*")}</option>
                                  {warehouses.map((warehouse) => (
                                    <option key={warehouse.id} value={warehouse.id}>
                                      {warehouse.code} — {warehouse.name}
                                    </option>
                                  ))}
                                </select>
                              )}
                              {available !== null && (
                                <p className={`text-xs ${available < item.quantity ? "text-red-600" : "text-muted-foreground"}`}>
                                  {t("المتاح في المستودع")}: {formatQuantity(available)} {productUnit}
                                </p>
                              )}
                            </div>
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
                            {isStockLine && (
                              <p className="mt-1 text-xs text-muted-foreground">{t("حساب فرق السعر")}</p>
                            )}
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
