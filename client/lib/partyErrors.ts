/**
 * العملاء والموردون: توحيد الاسم للمقارنة ورسائل أخطاء القاعدة.
 * الاسم مفتاح كشف الحساب في القيود (counterparty)، لذلك تمنع القاعدة تكراره وتغييره بعد وجود مستندات.
 */

/** توحيد الاسم للمقارنة: نفس قاعدة الفهرس الفريد في القاعدة (المسافات وحالة الأحرف). */
export const normalizePartyName = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

/** ترجمة أخطاء القاعدة الخاصة بالعملاء والموردين إلى نص عربي (مفتاح ترجمة). */
export function partyErrorText(message: string, isVendor: boolean): string {
  const text = String(message ?? "");
  if (text.includes("PARTY_RENAME_BLOCKED")) {
    return isVendor
      ? "لا يمكن تغيير اسم المورد لأن له فواتير أو سندات أو قيودًا؛ الاسم مرتبط بكشف حسابه في الدفاتر."
      : "لا يمكن تغيير اسم العميل لأن له فواتير أو سندات أو قيودًا؛ الاسم مرتبط بكشف حسابه في الدفاتر.";
  }
  if (text.includes("PARTY_HAS_DOCUMENTS")) {
    return isVendor
      ? "لا يمكن حذف مورد مرتبط بمستندات، لذلك تم تحويله إلى غير نشط"
      : "لا يمكن حذف عميل مرتبط بمستندات، لذلك تم تحويله إلى غير نشط";
  }
  if (text.includes("name_normalized_uidx")) return isVendor ? "يوجد مورد آخر بنفس الاسم." : "يوجد عميل آخر بنفس الاسم.";
  if (text.includes("tax_number_uidx")) return isVendor ? "الرقم الضريبي مسجل لمورد آخر." : "الرقم الضريبي مسجل لعميل آخر.";
  if (text.includes("building_number_check") || text.includes("postal_code_check")) return "رقم المبنى 4 أرقام والرمز البريدي 5 أرقام";
  if (text.includes("commercial_registration_check")) return "السجل التجاري يجب أن يتكون من 10 إلى 15 رقمًا";
  if (text.includes("tax_number_check")) return "الرقم الضريبي السعودي 15 رقمًا يبدأ وينتهي بالرقم 3";
  if (/row-level security|permission denied/i.test(text)) return "لا تملك صلاحية تنفيذ هذا الإجراء.";
  return text;
}
