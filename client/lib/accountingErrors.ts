/**
 * ترجمة رموز أخطاء المحاسبة (الفترات، الأصول الثابتة، القيود اليدوية، الحسابات البنكية، الدليل، إعادة التصنيف)
 * إلى رسائل عربية. المطابقة بجزء من النص لأن رسالة القاعدة قد تحمل تفاصيل بعد الرمز
 * (مثل: DEPRECIATION_PERIOD_OUT_OF_SEQUENCE: expected 2026-10-31).
 * إن لم يُعرف الرمز تُعاد رسالة الأخطاء العامة (التكرار، الارتباط، الصلاحية) أو الرسالة كما هي.
 * المعامل t اختياري لترجمة الجمل عند اختيار اللغة الإنجليزية.
 */
import { dbErrorText } from "@/lib/dbErrors";

type Translate = (source: string) => string;
const keepSource: Translate = (source) => source;

const ACCOUNTING_ERRORS: Array<[string, string]> = [
  // الفترات المالية
  ["FISCAL_PERIOD_OVERLAP", "الفترة تتداخل مع فترة مالية أخرى. عدّل تاريخ البداية أو النهاية."],
  ["FISCAL_PERIOD_DATES_INVALID", "تاريخ نهاية الفترة يجب أن يكون بعد تاريخ بدايتها."],
  ["FISCAL_PERIOD_NAME_REQUIRED", "اكتب اسم الفترة المالية."],
  ["FISCAL_PERIOD_HAS_DRAFT_JOURNALS", "في الفترة قيود مسودة؛ رحّلها أو احذفها قبل إقفال الفترة."],
  ["FISCAL_PERIOD_HAS_JOURNALS", "لا تُحذف فترة عليها قيود."],
  ["CLOSED_FISCAL_PERIOD_IMMUTABLE", "الفترة مقفلة ولا تُعدَّل. افتحها أولًا."],
  ["FISCAL_PERIOD_NOT_FOUND", "الفترة المالية غير موجودة."],
  ["FISCAL_PERIOD_STATUS_INVALID", "حالة الفترة غير صالحة."],
  ["ACCOUNTING_FISCAL_PERIOD_CLOSED", "الفترة المالية لهذا التاريخ مقفلة ولا يمكن الترحيل فيها."],
  ["ACCOUNTING_FISCAL_PERIOD_REQUIRED", "لا توجد فترة مالية مفتوحة تغطي هذا التاريخ. أنشئها من إعدادات المحاسبة."],
  ["ACCOUNTING_SETTINGS_PERMISSION_REQUIRED", "لا تملك صلاحية تعديل إعدادات المحاسبة."],
  ["ACCOUNTING_MANAGE_PERMISSION_REQUIRED", "لا تملك صلاحية إدارة المحاسبة."],
  // الأصول الثابتة
  ["DEPRECIATION_PERIOD_MUST_BE_MONTH_END", "تاريخ الإهلاك يجب أن يكون آخر يوم في الشهر."],
  ["FUTURE_DEPRECIATION_NOT_ALLOWED", "لا يُرحَّل إهلاك شهر لم ينتهِ بعد."],
  ["DEPRECIATION_PERIOD_OUT_OF_SEQUENCE", "الإهلاك يُرحَّل شهرًا بعد شهر بالترتيب."],
  ["DEPRECIATION_AMOUNT_INVALID", "مبلغ الإهلاك غير صحيح."],
  ["FIXED_ASSET_FULLY_DEPRECIATED", "الأصل مُهلك بالكامل."],
  ["ONLY_ACTIVE_FIXED_ASSET_DEPRECIABLE", "يُهلك الأصل النشط فقط."],
  ["ONLY_ACTIVE_FIXED_ASSET_DISPOSABLE", "يُستبعد الأصل النشط فقط."],
  ["ONLY_DRAFT_FIXED_ASSET_CAPITALIZABLE", "تُرسمل مسودة الأصل فقط."],
  ["ONLY_DRAFT_FIXED_ASSET_EDITABLE", "تُعدَّل مسودة الأصل فقط."],
  ["ONLY_DRAFT_FIXED_ASSET_DELETABLE", "تُحذف مسودة الأصل فقط."],
  ["FIXED_ASSET_DISPOSAL_DATE_INVALID", "تاريخ الاستبعاد غير صالح: بين تاريخ بدء الاستخدام واليوم."],
  ["DISPOSAL_DATE_BEFORE_LAST_DEPRECIATION", "تاريخ الاستبعاد قبل آخر إهلاك مرحّل."],
  ["FIXED_ASSET_SALE_INVOICE_REQUIRED", "بيع الأصل لمنشأة مسجلة ضريبيًا يكون بفاتورة مبيعات: أصدر فاتورة على حساب متحصلات بيع الأصول ثم اخترها هنا."],
  ["FIXED_ASSET_SALE_INVOICE_NOT_FOUND", "فاتورة المبيعات غير موجودة."],
  ["FIXED_ASSET_SALE_INVOICE_NOT_POSTED", "فاتورة المبيعات غير مرحّلة محاسبيًا."],
  ["FIXED_ASSET_SALE_INVOICE_ALREADY_USED", "هذه الفاتورة مستخدمة لاستبعاد أصل آخر."],
  ["FIXED_ASSET_SALE_INVOICE_ACCOUNT_MISMATCH", "الفاتورة لم تقيّد مبلغًا على حساب المتحصلات المختار. اختر الحساب الذي استُخدم في بند الفاتورة."],
  ["FIXED_ASSET_PROCEEDS_ACCOUNT_RESERVED", "هذا الحساب من حسابات قواعد الترحيل (الإيراد العام أو الضريبة أو الذمم)، فلا يكون حسابًا وسيطًا. استخدم «متحصلات بيع الأصول الثابتة» (423) في بند الفاتورة."],
  ["FIXED_ASSET_PROCEEDS_ACCOUNT_REQUIRED", "اختر حساب المتحصلات."],
  ["FIXED_ASSET_PROCEEDS_ACCOUNT_CLASS_INVALID", "حساب المتحصلات غير مناسب (بالفاتورة: حساب إيراد أو التزام وسيط، وبدونها: نقدية أو بنك)."],
  ["FIXED_ASSET_PROCEEDS_INVALID", "مبلغ المتحصلات غير صحيح."],
  ["FIXED_ASSET_GAIN_LOSS_ACCOUNT_REQUIRED", "اختر حساب أرباح وخسائر الاستبعاد."],
  ["FIXED_ASSET_GAIN_LOSS_ACCOUNT_CLASS_INVALID", "حساب الأرباح والخسائر يجب أن يكون إيرادًا (4) أو مصروفًا (5)."],
  ["FIXED_ASSET_CAPITALIZATION_ACCOUNTS_MUST_DIFFER", "حساب الأصل وحساب الدفع يجب أن يختلفا."],
  ["FIXED_ASSET_CREDIT_ACCOUNT_CLASS_INVALID", "حساب الدفع يجب أن يكون نقدية أو بنكًا أو التزامًا."],
  ["FIXED_ASSET_ACCOUNTS_MUST_DIFFER", "حسابات الأصل ومجمع الإهلاك ومصروف الإهلاك يجب أن تختلف."],
  ["FIXED_ASSET_ACCOUNT_CLASS_INVALID", "فئة أحد حسابات الأصل غير صحيحة."],
  ["FIXED_ASSET_CATEGORY_REQUIRED", "اختر فئة الأصل."],
  ["FIXED_ASSET_NAME_REQUIRED", "اكتب اسم الأصل."],
  ["FIXED_ASSET_SERVICE_DATE_INVALID", "تاريخ بدء الاستخدام لا يسبق تاريخ الشراء ولا يكون في المستقبل."],
  ["FIXED_ASSET_VALUES_NON_FINITE", "قيم الأصل غير صحيحة."],
  ["FIXED_ASSET_VALUES_INVALID", "قيم الأصل غير صحيحة: التكلفة أكبر من القيمة المتبقية، والعمر بالأشهر أكبر من صفر."],
  ["FIXED_ASSET_NOT_FOUND", "الأصل غير موجود."],
  ["FIXED_ASSET_PERMISSION_REQUIRED", "لا تملك صلاحية إدارة الأصول الثابتة."],
  // القيود اليدوية
  ["MANUAL_JOURNAL_ALREADY_REVERSED", "هذا القيد عُكس من قبل."],
  ["MANUAL_JOURNAL_REVERSAL_DATE_INVALID", "تاريخ العكس بين تاريخ القيد واليوم."],
  ["MANUAL_JOURNAL_REVERSAL_REASON_REQUIRED", "اكتب سبب عكس القيد."],
  ["ONLY_POSTED_MANUAL_JOURNAL_REVERSIBLE", "يُعكس القيد المرحّل فقط."],
  ["ONLY_DRAFT_MANUAL_JOURNAL_POSTABLE", "يُرحَّل قيد المسودة فقط."],
  ["ONLY_DRAFT_MANUAL_JOURNAL_EDITABLE", "يُعدَّل قيد المسودة فقط."],
  ["ONLY_DRAFT_MANUAL_JOURNAL_DELETABLE", "يُحذف قيد المسودة فقط."],
  ["POSTED_JOURNAL_NOT_BALANCED", "القيد غير متوازن: المدين لا يساوي الدائن."],
  ["POSTED_JOURNAL_REQUIRES_TWO_LINES", "القيد يحتاج سطرين على الأقل."],
  ["MANUAL_JOURNAL_REQUIRES_TWO_LINES", "القيد يحتاج سطرين على الأقل."],
  ["MANUAL_JOURNAL_LINE_REQUIRES_ONE_SIDE", "كل سطر مدين أو دائن، لا الاثنان ولا صفر."],
  ["MANUAL_JOURNAL_LINE_AMOUNT_NON_FINITE", "مبلغ سطر غير صحيح."],
  ["MANUAL_JOURNAL_LINE_AMOUNT_INVALID", "مبلغ سطر غير صحيح."],
  ["MANUAL_JOURNAL_DESCRIPTION_REQUIRED", "اكتب بيان القيد."],
  ["MANUAL_JOURNAL_DATE_INVALID", "تاريخ القيد غير صالح."],
  ["MANUAL_JOURNAL_NOT_FOUND", "القيد غير موجود."],
  ["NOT_A_MANUAL_JOURNAL", "هذا ليس قيدًا يدويًا."],
  ["MANUAL_JOURNAL_MANAGE_PERMISSION_REQUIRED", "لا تملك صلاحية القيود اليدوية."],
  // الحسابات البنكية والصناديق
  ["BANK_ACCOUNT_IBAN_INVALID", "الآيبان يبدأ بـ SA ويليه 22 رقمًا."],
  ["BANK_ACCOUNT_NAME_REQUIRED", "اكتب اسم الحساب."],
  ["BANK_ACCOUNT_KIND_INVALID", "اختر نوع الحساب: بنك أو صندوق."],
  ["BANK_ACCOUNT_PARENT_INVALID", "الحساب الأب يجب أن يكون تحت «النقد وما يعادله» (111)، وليس تحت الشيكات."],
  ["BANK_ACCOUNT_CODE_EXHAUSTED", "لا رموز متاحة تحت الحساب الأب."],
  ["BANK_ACCOUNT_CURRENCY_INVALID", "رمز العملة ثلاثة أحرف (SAR)."],
  ["BANK_ACCOUNT_VALUES_INVALID", "قيم الحساب غير صحيحة."],
  ["BANK_ACCOUNT_NOT_FOUND_OR_INACTIVE", "الحساب البنكي غير موجود أو موقوف."],
  ["BANK_ACCOUNT_NOT_FOUND", "الحساب البنكي غير موجود."],
  // استيراد كشف البنك ومطابقته
  ["BANK_LINE_DATE_OUTSIDE_STATEMENT", "تاريخ حركة خارج فترة الكشف."],
  ["BANK_LINE_DEBIT_CREDIT_INVALID", "كل حركة في الكشف مدينة أو دائنة بمبلغ أكبر من صفر، لا الاثنان."],
  ["BANK_STATEMENT_DATE_RANGE_INVALID", "فترة الكشف غير صحيحة."],
  ["BANK_STATEMENT_LINES_REQUIRED", "الكشف بلا حركات."],
  ["BANK_JOURNAL_ALREADY_MATCHED", "القيد مطابق مع حركة أخرى."],
  ["BANK_LINE_NOT_AVAILABLE", "الحركة غير متاحة للمطابقة (مطابقة أو غير موجودة)."],
  ["BANK_MATCH_AMOUNT_MISMATCH", "مبلغ القيد لا يساوي مبلغ الحركة."],
  ["BANK_MATCH_CANDIDATE_NOT_FOUND", "القيد المختار غير موجود في حساب البنك."],
  ["BANK_LINE_NOT_MATCHED", "الحركة غير مطابقة."],
  // قواعد الترحيل (الأطول قبل الأقصر لأن المطابقة بجزء من النص)
  ["PAYROLL_PAYABLE_ACCOUNT_CLASS_INVALID", "حساب الرواتب المستحقة يجب أن يكون من الالتزامات (يبدأ بـ 2)."],
  ["PAYROLL_EXPENSE_ACCOUNT_CLASS_INVALID", "حساب مصروف الرواتب يجب أن يكون من المصروفات (يبدأ بـ 5)."],
  ["PAYROLL_SOCIAL_ACCOUNT_CLASS_INVALID", "حساب التأمينات الاجتماعية المستحقة يجب أن يكون من الالتزامات (يبدأ بـ 2)."],
  ["PAYROLL_DEDUCTIONS_ACCOUNT_CLASS_INVALID", "حساب استقطاعات الموظفين المستحقة يجب أن يكون من الالتزامات (يبدأ بـ 2)."],
  ["RECEIVABLE_ACCOUNT_CLASS_INVALID", "حساب ذمم العملاء يجب أن يكون من الأصول (يبدأ بـ 1)."],
  ["REVENUE_ACCOUNT_CLASS_INVALID", "حساب إيرادات المبيعات يجب أن يكون من الإيرادات (يبدأ بـ 4)."],
  ["OUTPUT_VAT_ACCOUNT_CLASS_INVALID", "حساب ضريبة المخرجات يجب أن يكون من الالتزامات (يبدأ بـ 2)."],
  ["INPUT_VAT_ACCOUNT_CLASS_INVALID", "حساب ضريبة المدخلات يجب أن يبدأ بـ 2."],
  ["PAYABLE_ACCOUNT_CLASS_INVALID", "حساب ذمم الموردين يجب أن يكون من الالتزامات (يبدأ بـ 2)."],
  ["PURCHASE_ACCOUNT_CLASS_INVALID", "حساب المشتريات والمصروفات يجب أن يكون من المصروفات (يبدأ بـ 5)."],
  ["INVENTORY_SHORTAGE_ACCOUNT_CLASS_INVALID", "حساب عجز المخزون يجب أن يكون من المصروفات (يبدأ بـ 5)."],
  ["INVENTORY_SURPLUS_ACCOUNT_CLASS_INVALID", "حساب فائض المخزون يجب أن يكون من الإيرادات (يبدأ بـ 4)."],
  ["ACCOUNTING_POSTING_RULE_NOT_FOUND", "قاعدة الترحيل الافتراضية غير موجودة أو غير مفعّلة لهذه المنشأة."],
  // الدليل
  ["POSTED_OR_CONFIGURED_ACCOUNT_CANNOT_BECOME_GROUP", "الحساب الأب عليه قيود أو مربوط بإعداد، فلا يصبح حسابًا تجميعيًا."],
  ["REFERENCED_ACCOUNT_CLASSIFICATION_IMMUTABLE", "الحساب مستخدم، فلا يتغير أبوه ولا تصنيفه."],
  ["SYSTEM_ACCOUNT_PARENT_IMMUTABLE", "حساب نظامي: لا يتغير أبوه."],
  ["SYSTEM_ACCOUNT_IMMUTABLE", "حساب نظامي: لا يُحذف."],
  ["ACCOUNT_HAS_CHILDREN", "للحساب فروع؛ احذفها أولًا."],
  ["ACCOUNT_HAS_JOURNAL_ACTIVITY", "على الحساب قيود؛ لا يُحذف."],
  ["ACCOUNT_LINKED_TO_BANK", "الحساب مربوط بحساب بنكي أو صندوق؛ أوقفه من الحسابات البنكية بدل حذفه."],
  ["ACCOUNT_LINKED_TO_COST_CENTER", "الحساب مربوط بمركز تكلفة."],
  ["ACCOUNT_USED_BY_EXPENSE_VOUCHER", "الحساب مستخدم في سند صرف."],
  ["ACCOUNT_USED_IN_POSTING_RULE", "الحساب مستخدم في قواعد الترحيل."],
  ["ACCOUNT_PARENT_CYCLE", "لا يكون الحساب أبًا لأحد أجداده."],
  ["ACCOUNT_CANNOT_PARENT_ITSELF", "لا يكون الحساب أبًا لنفسه."],
  ["ACCOUNT_PARENT_NOT_FOUND", "الحساب الأب غير موجود."],
  ["ACCOUNT_CODE_INVALID", "رمز الحساب أرقام فقط (حتى 12 رقمًا)."],
  ["ACCOUNT_ARABIC_NAME_REQUIRED", "اكتب اسم الحساب بالعربية."],
  ["NEW_ROOT_ACCOUNT_NOT_ALLOWED", "اختر حسابًا أبًا للحساب الجديد."],
  ["ACCOUNT_NOT_FOUND", "الحساب غير موجود."],
  // إعادة التصنيف
  ["RECLASSIFICATION_ACCOUNTS_MUST_DIFFER", "الحساب الجديد يجب أن يختلف عن الحساب الحالي."],
  ["RECLASSIFICATION_LINE_ALREADY_USED", "أحد الأسطر أُعيد تصنيفه من قبل."],
  ["RECLASSIFICATION_REQUIRES_ONE_SOURCE_ACCOUNT", "اختر أسطرًا من حساب واحد."],
  ["RECLASSIFICATION_REQUIRES_POSTED_LINES", "تُصنَّف الأسطر المرحّلة فقط."],
  ["RECLASSIFICATION_LINES_REQUIRED", "اختر سطرًا واحدًا على الأقل."],
  ["RECLASSIFICATION_DESTINATION_REQUIRED", "اختر الحساب الجديد."],
  ["RECLASSIFICATION_DESCRIPTION_REQUIRED", "اكتب البيان."],
  ["RECLASSIFICATION_DATE_REQUIRED", "اختر التاريخ."],
  ["RECLASSIFICATION_AMOUNT_REQUIRED", "المبلغ مطلوب."],
  ["RECLASSIFICATION_DATE_RANGE_INVALID", "نطاق التاريخ غير صحيح."],
  ["RECLASSIFICATION_LINE_LIMIT_EXCEEDED", "عدد الأسطر أكبر من المسموح."],
  ["RECLASSIFICATION_MANAGE_PERMISSION_REQUIRED", "لا تملك صلاحية إعادة التصنيف."],
];

export function accountingErrorText(message: string, t: Translate = keepSource): string {
  const raw = String(message ?? "");
  const expected = raw.match(/OUT_OF_SEQUENCE:\s*expected\s*([0-9-]{10})/)?.[1];
  for (const [code, text] of ACCOUNTING_ERRORS) {
    if (raw.includes(code)) {
      return expected && code === "DEPRECIATION_PERIOD_OUT_OF_SEQUENCE"
        ? `${t(text)} ${t("الشهر التالي")}: ${expected}`
        : t(text);
    }
  }
  const generic = dbErrorText(raw);
  return generic ? t(generic) : raw;
}
