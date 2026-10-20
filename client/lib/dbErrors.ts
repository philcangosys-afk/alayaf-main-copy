/**
 * رسائل عربية لأخطاء القاعدة العامة التي لا تخص شاشة بعينها:
 * التكرار (قيد فريد)، والارتباط (مفتاح خارجي)، والصلاحية، وبادئة المنشأة.
 * تعيد null إن لم تُعرف الرسالة، ليقرر المستدعي ما يعرضه.
 */
import { BILLING_COUNTRY_MESSAGE } from "@/lib/countries";
import { SUBSCRIPTION_ERROR_MESSAGES, subscriptionErrorCode } from "@/lib/subscription";

const UNIQUE_MESSAGES: Array<[string, string]> = [
  ["inventory_warehouses_code_key", "رمز المستودع مستخدم لمستودع آخر في المنشأة."],
  ["inventory_products_sku_key", "رمز الصنف مستخدم لصنف آخر في المنشأة."],
  ["fleet_vehicles", "رقم اللوحة أو المركبة مستخدم لمركبة أخرى في المنشأة."],
  ["accounting_accounts_pkey", "رمز الحساب مستخدم لحساب آخر."],
  ["accounting_bank_accounts_account_code_key", "حساب الدليل مربوط بحساب بنكي آخر."],
  ["cost_centers", "رمز مركز التكلفة مستخدم."],
  ["name_normalized_uidx", "الاسم مستخدم لسجل آخر."],
  ["customer_number_uidx", "رقم العميل مستخدم."],
  ["vendor_number_uidx", "رقم المورد مستخدم."],
  ["vendor_reference_uidx", "رقم فاتورة المورد مسجل من قبل لهذا المورد."],
  // S18: عرض السعر يُحوَّل إلى فاتورة واحدة
  ["sales_invoices_quotation_uidx", "عرض السعر هذا محوّل إلى فاتورة مسبقًا."],
];

export function dbErrorText(message: string): string | null {
  const text = String(message ?? "");
  // S15: القراءة فقط وحدود الباقة
  const subscription = subscriptionErrorCode(text);
  if (subscription) return SUBSCRIPTION_ERROR_MESSAGES[subscription];
  if (/duplicate key value|unique constraint/i.test(text)) {
    for (const [key, value] of UNIQUE_MESSAGES) if (text.includes(key)) return value;
    return "القيمة مستخدمة لسجل آخر في المنشأة.";
  }
  if (/violates foreign key constraint/i.test(text)) {
    return /(update or )?delete on table/i.test(text)
      ? "لا يمكن الحذف: السجل مرتبط بمستندات أخرى."
      : "أحد الحقول يشير إلى سجل غير موجود.";
  }
  if (/COMPANY_PREFIX_REQUIRED/.test(text)) return "الرقم يجب أن يبدأ ببادئة المنشأة (مثل 1001-).";
  // S18: عرض السعر المحوّل إلى فاتورة
  if (/QUOTATION_INVOICED_READ_ONLY/.test(text)) return "عرض السعر محوّل إلى فاتورة؛ لا يُعدَّل ولا يُحذف.";
  if (/QUOTATION_INVOICE_LINK_READ_ONLY/.test(text)) return "ربط عرض السعر بالفاتورة يتم عند حفظ الفاتورة فقط.";
  if (/sales_invoices_quotation_fkey/.test(text)) {
    return /(update or )?delete on table/i.test(text)
      ? "لا يُحذف عرض سعر محوّل إلى فاتورة."
      : "عرض السعر غير موجود.";
  }
  if (/BILLING_COUNTRY_NOT_READY/.test(text)) return BILLING_COUNTRY_MESSAGE;
  if (/row-level security|permission denied/i.test(text)) return "لا تملك صلاحية تنفيذ هذا الإجراء.";
  if (/Failed to fetch|NetworkError|network/i.test(text)) return "تعذر الاتصال بالخادم. تحقق من الاتصال وحاول مرة أخرى.";
  return null;
}

/** الرسالة العربية إن عُرفت، وإلا الرسالة كما هي */
export function dbErrorOr(message: string): string {
  return dbErrorText(message) ?? String(message ?? "");
}
