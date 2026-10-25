/**
 * بيانات المنشأة الحالية (نظام الشركات):
 * المصدر جدول companies عبر الدالة my_company() بعد تسجيل الدخول، ولا توجد بيانات منشأة ثابتة في الكود.
 * الكائن COMPANY_PROFILE يبقى بنفس الشكل القديم حتى تعمل الصفحات والقوالب كما هي، وتُملأ قيمه عند الدخول.
 * اسم المنشأة ورقمها الضريبي وسجلها التجاري تعدّلها إدارة المنصة فقط (مرتبطة بشهادة الربط مع الهيئة).
 */

/** اسم المنصة قبل الدخول (صفحات الدخول والتسجيل) */
export const PLATFORM_NAME_AR = "نظام إدارة المنشآت";
export const PLATFORM_NAME_EN = "Business Management System";

/** شعار افتراضي محايد عند عدم رفع شعار للمنشأة */
export const DEFAULT_LOGO_URL = "/company-logo-placeholder.svg";

/** error: تعذر التحقق (اتصال/خادم) — لا تُفسَّر كحساب بلا منشأة */
export type CompanyStatus = "anonymous" | "none" | "pending" | "active" | "suspended" | "rejected" | "disabled" | "error";

/** شكل الشركة كما تعيده my_company() */
export type CompanyRecord = {
  id: string;
  code: number;
  prefix: string;
  name_ar: string;
  name_en: string;
  vat_number: string;
  cr_number: string;
  phone: string;
  email: string;
  city: string;
  address_ar: string;
  address_en: string;
  bank_name: string;
  iban: string;
  logo_url: string;
  employee_email_domain: string;
  status_reason: string;
  /** مرحلة الفوترة الإلكترونية (S6): phase1 الإصدار والحفظ، phase2 الربط مع الهيئة */
  zatca_phase?: ZatcaPhase;
  zatca_phase_changed_at?: string | null;
  /** دولة المنشأة (S14، رمز ISO من حرفين؛ بلا قيمة = SA) */
  country?: string;
  /** فئة عدد الموظفين من التسجيل (S14) */
  employees_range?: string | null;
  /** المنطقة / الولاية (S14) */
  region?: string;
};

export type ZatcaPhase = "phase1" | "phase2";

/** آخر طلب تسجيل مرفوض لنفس البريد (يظهر لصاحبه عند التسجيل من جديد) */
export type LastRejection = { name_ar: string; reason: string; at: string };

export type MyCompanyResult = {
  status: CompanyStatus;
  is_platform_admin?: boolean;
  member_role?: "owner" | "member";
  company?: CompanyRecord;
  last_rejection?: LastRejection | null;
};

type CompanyProfile = {
  programNameAr: string;
  logoUrl: string;
  companyNameAr: string;
  companyNameEn: string;
  vatNumber: string;
  commercialRegistration: string;
  addressAr: string;
  addressEn: string;
  phone: string;
  email: string;
  city: string;
  /** رقم المنشأة في المنصة (1001...) */
  code: string;
  /** بادئة أرقام المستندات: "1001-" */
  docPrefix: string;
  /** مرحلة الفوترة الإلكترونية للمنشأة (بلا قيمة من القاعدة = المرحلة الثانية كما كان) */
  zatcaPhase: ZatcaPhase;
  /** دولة المنشأة (S14): SA تفعّل الأنظمة السعودية */
  country: string;
  bank: {
    beneficiaryAr: string;
    beneficiaryEn: string;
    nameAr: string;
    nameEn: string;
    accountNumber: string;
    iban: string;
    branchCode: string;
    branchNameAr: string;
    branchNameEn: string;
  };
};

const emptyProfile = (): CompanyProfile => ({
  programNameAr: PLATFORM_NAME_AR,
  logoUrl: DEFAULT_LOGO_URL,
  companyNameAr: "",
  companyNameEn: "",
  vatNumber: "",
  commercialRegistration: "",
  addressAr: "",
  addressEn: "",
  phone: "",
  email: "",
  city: "",
  code: "",
  docPrefix: "",
  zatcaPhase: "phase2",
  country: "SA",
  bank: {
    beneficiaryAr: "",
    beneficiaryEn: "",
    nameAr: "",
    nameEn: "",
    accountNumber: "",
    iban: "",
    branchCode: "",
    branchNameAr: "",
    branchNameEn: "",
  },
});

/** يُقرأ وقت العرض (لا تنسخ قيمه في ثوابت على مستوى الملف) */
export const COMPANY_PROFILE: CompanyProfile = emptyProfile();

const text = (value: unknown) => (value === null || value === undefined ? "" : String(value).trim());

/** تعبئة بيانات المنشأة بعد الدخول، أو تفريغها عند الخروج */
export function applyCompanyProfile(company: CompanyRecord | null | undefined) {
  const next = emptyProfile();
  if (company) {
    const nameAr = text(company.name_ar);
    const nameEn = text(company.name_en);
    next.logoUrl = text(company.logo_url) || DEFAULT_LOGO_URL;
    next.companyNameAr = nameAr;
    next.companyNameEn = nameEn;
    next.vatNumber = text(company.vat_number);
    next.commercialRegistration = text(company.cr_number);
    next.addressAr = text(company.address_ar);
    next.addressEn = text(company.address_en);
    next.phone = text(company.phone);
    next.email = text(company.email);
    next.city = text(company.city);
    next.code = text(company.code);
    next.docPrefix = text(company.prefix) || (next.code ? `${next.code}-` : "");
    next.zatcaPhase = company.zatca_phase === "phase1" ? "phase1" : "phase2";
    next.country = text(company.country).toUpperCase() || "SA";
    next.bank.beneficiaryAr = nameAr;
    next.bank.beneficiaryEn = nameEn;
    next.bank.nameAr = text(company.bank_name);
    next.bank.nameEn = text(company.bank_name);
    next.bank.iban = text(company.iban);
  }
  const { bank, ...rest } = next;
  Object.assign(COMPANY_PROFILE, rest);
  Object.assign(COMPANY_PROFILE.bank, bank);
}

/**
 * الأنظمة السعودية (الفوترة الإلكترونية للهيئة، والتأمينات الاجتماعية، والإقرار الضريبي) لمنشآت السعودية فقط (S14).
 * غيرها تُخفى عنها هذه الصفحات، والفوترة والضريبة حسب دولتها تُفعَّل في تحديث قادم.
 */
export function isSaudiCompany(country: string | null | undefined = COMPANY_PROFILE.country): boolean {
  return (String(country ?? "").trim().toUpperCase() || "SA") === "SA";
}

/** صفحات سعودية فقط: تُخفى من القوائم وتُمنع بالرابط المباشر لمنشأة خارج السعودية */
export const SAUDI_ONLY_PATHS = ["/zatca", "/hr/insurance/social", "/hr/insurance/list", "/expenses/tax", "/expenses/tax-reports"];

// مطابقة بلا حساسية لحالة الأحرف، كما يطابق React Router المسارات (/ZATCA = /zatca)
const matchesPrefix = (path: string, prefix: string) => {
  const lower = path.toLowerCase();
  return lower === prefix || lower.startsWith(`${prefix}/`);
};

export function isSaudiOnlyPath(path: string): boolean {
  return SAUDI_ONLY_PATHS.some((prefix) => matchesPrefix(path, prefix));
}

/** صفحات المستندات التي يرفضها الخادم لمنشأة خارج السعودية حتى ملف الضريبة حسب الدولة (BILLING_COUNTRY_NOT_READY) */
export const BILLING_PATHS = ["/sales/invoices", "/sales/credit-note", "/purchases/invoices", "/purchases/debit-notes", "/purchases/credit-notes", "/purchases/customs-declarations", "/pos"];

export function isBillingPath(path: string): boolean {
  return BILLING_PATHS.some((prefix) => matchesPrefix(path, prefix));
}

/** بادئة أرقام المستندات للمنشأة الحالية ("1001-")، أو نص فارغ قبل الدخول */
export function companyDocPrefix(): string {
  return COMPANY_PROFILE.docPrefix;
}

/** هل الرقم يخص المنشأة الحالية (يبدأ ببادئتها) */
export function isCompanyNumber(value: string | null | undefined): boolean {
  const prefix = companyDocPrefix();
  return Boolean(prefix && value && String(value).toUpperCase().startsWith(prefix.toUpperCase()));
}

/** مفتاح تخزين في المتصفح خاص بالمنشأة الحالية (لا تختلط بيانات منشأتين على نفس الجهاز) */
export function companyStorageKey(base: string): string {
  return `${base}:${COMPANY_PROFILE.code || "none"}`;
}

/** مفتاح الرقم التسلسلي لوحدة إصدار الفواتير المعتمدة لدى الهيئة (لكل منشأة) */
export const zatcaDeviceSerialKey = () => companyStorageKey("zatca-active-production-device-serial");
