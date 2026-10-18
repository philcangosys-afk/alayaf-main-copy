/**
 * دول التسجيل (رمز ISO 3166-1 من حرفين كما يُحفظ في companies.country).
 * السعودية (SA) تفعّل الأنظمة السعودية: الفوترة الإلكترونية للهيئة، والتأمينات الاجتماعية، والإقرار الضريبي.
 * غيرها تُخفى عنها هذه الأنظمة، والفوترة (فواتير المبيعات والمشتريات وإشعاراتها) متوقفة حتى تُفعَّل الضريبة حسب دولتها في تحديث قادم.
 */
export type Country = { code: string; name: string; dial: string };

export const SAUDI_COUNTRY_CODE = "SA";

export const COUNTRIES: Country[] = [
  { code: "SA", name: "المملكة العربية السعودية", dial: "+966" },
  { code: "AE", name: "الإمارات العربية المتحدة", dial: "+971" },
  { code: "KW", name: "الكويت", dial: "+965" },
  { code: "QA", name: "قطر", dial: "+974" },
  { code: "BH", name: "البحرين", dial: "+973" },
  { code: "OM", name: "عُمان", dial: "+968" },
  { code: "EG", name: "مصر", dial: "+20" },
  { code: "SD", name: "السودان", dial: "+249" },
  { code: "JO", name: "الأردن", dial: "+962" },
  { code: "IQ", name: "العراق", dial: "+964" },
  { code: "YE", name: "اليمن", dial: "+967" },
  { code: "LB", name: "لبنان", dial: "+961" },
  { code: "SY", name: "سوريا", dial: "+963" },
  { code: "PS", name: "فلسطين", dial: "+970" },
  { code: "LY", name: "ليبيا", dial: "+218" },
  { code: "TN", name: "تونس", dial: "+216" },
  { code: "DZ", name: "الجزائر", dial: "+213" },
  { code: "MA", name: "المغرب", dial: "+212" },
  { code: "MR", name: "موريتانيا", dial: "+222" },
  { code: "SO", name: "الصومال", dial: "+252" },
  { code: "DJ", name: "جيبوتي", dial: "+253" },
  { code: "KM", name: "جزر القمر", dial: "+269" },
  { code: "SS", name: "جنوب السودان", dial: "+211" },
  { code: "TR", name: "تركيا", dial: "+90" },
  { code: "PK", name: "باكستان", dial: "+92" },
  { code: "IN", name: "الهند", dial: "+91" },
  { code: "BD", name: "بنغلاديش", dial: "+880" },
  { code: "PH", name: "الفلبين", dial: "+63" },
  { code: "ID", name: "إندونيسيا", dial: "+62" },
  { code: "MY", name: "ماليزيا", dial: "+60" },
  { code: "GB", name: "المملكة المتحدة", dial: "+44" },
  { code: "US", name: "الولايات المتحدة", dial: "+1" },
];

export const countryName = (code: string | null | undefined) =>
  COUNTRIES.find((country) => country.code === String(code ?? "").toUpperCase())?.name ?? String(code ?? "");

/** مناطق المملكة الإدارية الثلاث عشرة (تُحفظ بالاسم في companies.region) */
export const SAUDI_REGIONS: string[] = [
  "منطقة الرياض",
  "منطقة مكة المكرمة",
  "منطقة المدينة المنورة",
  "المنطقة الشرقية",
  "منطقة القصيم",
  "منطقة عسير",
  "منطقة تبوك",
  "منطقة حائل",
  "منطقة الحدود الشمالية",
  "منطقة جازان",
  "منطقة نجران",
  "منطقة الباحة",
  "منطقة الجوف",
];

/** فئات عدد الموظفين كما تُحفظ في companies.employees_range */
export const EMPLOYEE_RANGES: Array<{ value: string; label: string }> = [
  { value: "1-10", label: "من 1 إلى 10" },
  { value: "11-50", label: "من 11 إلى 50" },
  { value: "51-200", label: "من 51 إلى 200" },
  { value: "201-500", label: "من 201 إلى 500" },
  { value: "500+", label: "أكثر من 500" },
];

/**
 * أرقام لاتينية: يحوّل الأرقام العربية (٠-٩) والفارسية/الأردية (۰-۹)، ويحذف علامات الاتجاه غير المرئية
 * التي تأتي مع النسخ واللصق (U+200E وU+200F وU+061C وU+202A-202E وU+2066-2069).
 */
export const latinDigits = (value: string) =>
  value
    .replace(/[\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

/** الجوال: أرقام فقط (ويُقبل + في أوله)، من 8 إلى 15 رقمًا، بعد حذف المسافات والشرطات والأقواس */
export const normalizePhone = (value: string) => latinDigits(value).replace(/[\s()-]/g, "");
export const isValidPhone = (value: string) => /^\+?\d{8,15}$/.test(normalizePhone(value));

/** الرقم الضريبي والسجل: أرقام لاتينية بلا مسافات */
export const normalizeIdentifier = (value: string) => latinDigits(value).replace(/\s/g, "");

/** صيغ الرقم الضريبي والسجل (نفس فحص الخادم company_identity_check) */
export const isSaudiVat = (value: string) => /^3\d{13}3$/.test(value);
export const isSaudiCr = (value: string) => /^\d{10}$/.test(value);
export const isForeignVat = (value: string) => /^[A-Za-z0-9-]{3,20}$/.test(value) && /[A-Za-z0-9]/.test(value);
export const isForeignCr = (value: string) => /^[A-Za-z0-9/-]{1,30}$/.test(value) && /[A-Za-z0-9]/.test(value);

/** رسالة رفض الفوترة لمنشأة خارج السعودية حتى ملف الضريبة حسب الدولة (BILLING_COUNTRY_NOT_READY) */
export const BILLING_COUNTRY_MESSAGE =
  "الفوترة والضريبة لدولة منشأتك تُفعَّل في تحديث قادم؛ حتى ذلك الحين لا تُسجَّل فواتير المبيعات والمشتريات وإشعاراتها ومرتجعاتها ولا البيانات الجمركية.";
