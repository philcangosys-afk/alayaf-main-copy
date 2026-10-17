/**
 * رسائل عربية لأخطاء القاعدة العامة التي لا تخص شاشة بعينها:
 * التكرار (قيد فريد)، والارتباط (مفتاح خارجي)، والصلاحية، وبادئة المنشأة.
 * تعيد null إن لم تُعرف الرسالة، ليقرر المستدعي ما يعرضه.
 */
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
];

export function dbErrorText(message: string): string | null {
  const text = String(message ?? "");
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
  if (/row-level security|permission denied/i.test(text)) return "لا تملك صلاحية تنفيذ هذا الإجراء.";
  if (/Failed to fetch|NetworkError|network/i.test(text)) return "تعذر الاتصال بالخادم. تحقق من الاتصال وحاول مرة أخرى.";
  return null;
}

/** الرسالة العربية إن عُرفت، وإلا الرسالة كما هي */
export function dbErrorOr(message: string): string {
  return dbErrorText(message) ?? String(message ?? "");
}
