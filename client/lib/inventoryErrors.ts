/**
 * ترجمة رموز أخطاء إجراءات المخزون (RPC) إلى رسائل عربية مفهومة.
 * المطابقة بجزء من النص لأن رسالة قاعدة البيانات قد تحمل تفاصيل بعد الرمز
 * (مثل: INVENTORY_ISSUE_INSUFFICIENT_STOCK: product=ITM-000001, available=3, requested=5).
 * إن لم يُعرف الرمز تُعاد الرسالة الأصلية كما هي.
 * المعامل t اختياري لترجمة الجمل عند اختيار اللغة الإنجليزية.
 */
type Translate = (source: string) => string;

const keepSource: Translate = (source) => source;

const detail = (message: string, key: string) =>
  message.match(new RegExp(`${key}=([^,]+)`))?.[1]?.trim() ?? "";

export function inventoryErrorText(message: string, t: Translate = keepSource): string {
  const raw = String(message ?? "");
  const has = (code: string) => raw.includes(code);

  if (has("INVENTORY_PERMISSION_REQUIRED")) return t("ليست لديك صلاحية تنفيذ عمليات المخزون. تواصل مع مدير النظام.");

  if (/[A-Z]+_INSUFFICIENT_STOCK/.test(raw)) {
    const product = detail(raw, "product");
    const available = detail(raw, "available");
    const requested = detail(raw, "requested") || detail(raw, "required");
    const details = [
      product && `${t("الصنف")}: ${product}`,
      available && `${t("المتاح")}: ${available}`,
      requested && `${t("المطلوب")}: ${requested}`,
    ].filter(Boolean).join(" — ");
    return `${t("الرصيد المتاح في المستودع غير كافٍ لإتمام العملية.")}${details ? ` (${details})` : ""}`;
  }

  if (/[A-Z]+_DATE_INVALID/.test(raw)) {
    return t("التاريخ غير صالح: لا يمكن أن يكون تاريخ المستند في المستقبل. ملاحظة: الخادم يعتمد توقيت UTC، لذلك بين الساعة 00:00 و03:00 بتوقيت الرياض اختر تاريخ الأمس.");
  }

  if (has("INVENTORY_ISSUE_SALES_INVOICE_NOT_POSTED")) return t("لا يمكن ربط إشعار التسليم إلا بفاتورة مبيعات مرحّلة. رحّل الفاتورة أولًا أو احفظ الإشعار دون ربط.");
  if (has("INVENTORY_DELIVERY_CUSTOMER_REQUIRED")) return t("إشعار التسليم يتطلب تحديد العميل.");
  if (has("INVENTORY_ISSUE_INVOICE_CUSTOMER_MISMATCH")) return t("فاتورة المبيعات المختارة تخص عميلًا آخر غير العميل المحدد في السند.");
  if (has("INVENTORY_GRNI_ACCOUNT_REQUIRED")) return t("الحساب 2113 «بضاعة مستلمة لم تصل فواتيرها» غير موجود أو غير نشط في دليل الحسابات. أضفه قبل ترحيل سند الاستلام.");

  if (has("INVENTORY_OPENING_REQUIRES_EMPTY_STOCK_LEDGER")) {
    const product = detail(raw, "product");
    return `${t("لا يمكن إدخال رصيد افتتاحي لصنف ومستودع توجد لهما حركات مخزون سابقة.")}${product ? ` (${t("الصنف")}: ${product})` : ""}`;
  }

  if (has("INVENTORY_COUNT_STALE_SNAPSHOT")) return t("حدثت حركات مخزون على المستودع بعد تثبيت رصيد الجرد، فلم يعد الرصيد الدفتري صالحًا. احذف مسودة الجرد وابدأ جردًا جديدًا.");
  if (has("INVENTORY_PRODUCT_POSTING_CLASS_IMMUTABLE")) return t("لا يمكن تغيير نوع الصنف أو وحدته أو حساب المخزون أو حساب التكلفة بعد تسجيل حركات مخزون عليه.");
  if (has("INVENTORY_PRODUCT_SKU_INVALID")) return t("رمز الصنف غير صالح: استخدم أحرفًا إنجليزية كبيرة وأرقامًا والرموز . _ - فقط، أو اتركه فارغًا ليُنشأ تلقائيًا.");

  if (/[A-Z]+_DUPLICATE_PRODUCT/.test(raw)) return t("لا يمكن تكرار الصنف نفسه في أكثر من سطر؛ اجمع الكمية في سطر واحد.");
  if (/[A-Z]+_LINES_REQUIRED/.test(raw)) return t("أضف سطرًا واحدًا على الأقل إلى المستند.");
  if (/[A-Z]+_LINES_LIMIT/.test(raw)) return t("عدد الأسطر يتجاوز الحد المسموح به في المستند الواحد؛ وزّع الأصناف على أكثر من مستند.");

  const periodDate = raw.match(/ACCOUNTING_FISCAL_PERIOD_(?:CLOSED|REQUIRED):\s*([0-9-]+)/)?.[1] ?? "";
  const periodSuffix = periodDate ? ` (${periodDate})` : "";
  if (has("ACCOUNTING_FISCAL_PERIOD_CLOSED")) return `${t("الفترة المالية لهذا التاريخ مقفلة ولا يمكن الترحيل فيها. اختر تاريخًا في فترة مفتوحة أو تواصل مع المحاسب.")}${periodSuffix}`;
  if (has("ACCOUNTING_FISCAL_PERIOD_REQUIRED")) return `${t("لا توجد فترة مالية مفتوحة تغطي هذا التاريخ. أنشئ الفترة المالية من إعدادات المحاسبة أولًا.")}${periodSuffix}`;

  return raw;
}
