/**
 * اشتراك المنشأة في المنصة (S15): الباقة، والفترة التجريبية، والقراءة فقط، وحدود الباقة، وحساب المنشأة لدى المنصة.
 * المصدر: my_subscription() من القاعدة. الحكم النهائي للخادم (مشغّل القراءة فقط وحدود الباقة)، والواجهة تعرض وتنبّه.
 */

export type SubscriptionState =
  | "trial"
  | "trial_expired"
  | "active"
  | "past_due"
  | "grace"
  | "cancelled"
  | "expired"
  | "read_only"
  | "complimentary"
  | "none";

export type SubscriptionPlan = {
  code: string;
  name_ar: string;
  name_en: string;
  description_ar?: string;
  price_monthly: number;
  price_yearly: number;
  max_users: number | null;
  max_employees: number | null;
  max_branches: number | null;
  modules: string[];
  features: string[];
};

export type SubscriptionUsage = { users: number; employees: number; branches: number; sales_invoices: number };

export type SubscriptionAnnouncement = { id: string; title: string; body: string; level: "info" | "success" | "warning" };

export type SubscriptionInfo = {
  status: string;
  state: SubscriptionState;
  access: "full" | "read_only";
  billing_cycle?: "monthly" | "yearly";
  trial_started_at?: string | null;
  trial_ends_at?: string | null;
  current_period_start?: string | null;
  current_period_end?: string | null;
  grace_days?: number;
  ends_at?: string | null;
  days_left?: number | null;
  price_override?: number | null;
  plan?: SubscriptionPlan;
  usage?: SubscriptionUsage;
  open_request?: { id: string; plan_code: string; plan_name: string; billing_cycle: "monthly" | "yearly"; created_at: string } | null;
  announcements?: SubscriptionAnnouncement[];
  support?: { email?: string; phone?: string; whatsapp?: string };
  /** لمدير النظام فقط */
  balance?: number | null;
  payment_instructions?: string | null;
  currency?: string;
  vat_rate?: number;
  can_manage?: boolean;
};

export type PlatformInvoice = {
  id: string;
  number: string;
  description: string;
  period_start: string | null;
  period_end: string | null;
  subtotal: number;
  discount: number;
  vat_rate: number;
  vat_amount: number;
  total: number;
  status: "issued" | "paid" | "void";
  issued_at: string;
  due_at: string | null;
  paid_at: string | null;
  paid_amount: number;
  seller: Record<string, string>;
  buyer: Record<string, string | number>;
};

export type PlatformPayment = {
  id: string;
  amount: number;
  method: string;
  reference: string;
  received_at: string;
  invoice_number: string | null;
};

export type PlatformBilling = {
  balance: number;
  invoices: PlatformInvoice[];
  payments: PlatformPayment[];
  adjustments?: Array<{ id: string; amount: number; reason: string; created_at: string }>;
  issuer: Record<string, string>;
};

export const STATE_LABELS: Record<SubscriptionState, string> = {
  trial: "فترة تجريبية",
  trial_expired: "انتهت الفترة التجريبية",
  active: "مشترك",
  past_due: "مستحق السداد",
  grace: "مهلة التجديد",
  cancelled: "لن يتجدد",
  expired: "منتهٍ",
  read_only: "قراءة فقط",
  complimentary: "مجاني",
  none: "بلا اشتراك",
};

export const MODULE_LABELS: Record<string, string> = {
  sales: "المبيعات",
  purchases: "المشتريات",
  inventory: "المخزون",
  accounting: "المحاسبة",
  crm: "العملاء والموردون",
  hr: "الموارد البشرية",
  payroll: "الرواتب",
  tasks: "المهام والمشاريع",
  fleet: "الأسطول",
  support: "الدعم الفني",
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  bank_transfer: "تحويل بنكي",
  cash: "نقدًا",
  card: "بطاقة",
  online: "دفع إلكتروني",
  other: "أخرى",
};

export const INVOICE_STATUS_LABELS: Record<PlatformInvoice["status"], string> = {
  issued: "غير مدفوعة",
  paid: "مدفوعة",
  void: "ملغاة",
};

export const isReadOnlySubscription = (sub: SubscriptionInfo | null | undefined) => sub?.access === "read_only";

/** العدد مع المعدود بالعربية: 1 «مستخدم واحد»، 2 «مستخدمان»، 3–10 «3 مستخدمين»، 11+ «11 مستخدمًا» */
export function countText(n: number, forms: { one: string; two: string; few: string; many: string }): string {
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  if (n >= 3 && n <= 10) return `${n} ${forms.few}`;
  return `${n} ${forms.many}`;
}

/** عدد الأيام بالعربية (مرفوع): يوم واحد، يومان، 3 أيام، 11 يومًا */
export function daysText(days: number): string {
  const n = Math.max(0, Math.floor(days));
  if (n === 0) return "أقل من يوم";
  if (n === 1) return "يوم واحد";
  if (n === 2) return "يومان";
  if (n <= 10) return `${n} أيام`;
  return `${n} يومًا`;
}

/** بعد حرف جر أو مضاف: «خلال يومين»، «مهلة يومين» */
export const daysTextGen = (days: number) => (Math.max(0, Math.floor(days)) === 2 ? "يومين" : daysText(days));

export function formatMoney(value: number | null | undefined, currency = "SAR"): string {
  const amount = Number(value ?? 0);
  const text = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(amount));
  const unit = currency === "SAR" ? "ر.س" : currency;
  return `${amount < 0 ? "-" : ""}${text} ${unit}`;
}

export function formatDay(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { year: "numeric", month: "long", day: "numeric" }).format(date);
}

/** الأيام المتبقية قبل القراءة فقط في مهلة التجديد */
export function graceDaysLeft(sub: SubscriptionInfo): number {
  if (!sub.current_period_end) return 0;
  const end = new Date(sub.current_period_end).getTime() + (sub.grace_days ?? 0) * 86_400_000;
  return Math.max(0, Math.ceil((end - Date.now()) / 86_400_000));
}

export type SubscriptionNotice = {
  tone: "info" | "warning" | "danger";
  title: string;
  body: string;
};

/** التنبيه أعلى الصفحات حسب حالة الاشتراك (null: لا تنبيه) */
export function subscriptionNotice(sub: SubscriptionInfo | null | undefined): SubscriptionNotice | null {
  if (!sub) return null;
  const days = Number(sub.days_left ?? 0);
  switch (sub.state) {
    case "trial":
      return {
        tone: days <= 2 ? "warning" : "info",
        title: days <= 0 ? "تنتهي الفترة التجريبية المجانية اليوم" : `الفترة التجريبية المجانية: متبقٍ ${daysText(days)}`,
        body: `تنتهي في ${formatDay(sub.trial_ends_at)}. بعدها تصبح المنشأة للقراءة فقط حتى تفعيل الاشتراك؛ تبقى بياناتك كما هي.`,
      };
    case "trial_expired":
      return {
        tone: "danger",
        title: "انتهت الفترة التجريبية: المنشأة للقراءة فقط",
        body: "يمكنك استعراض بياناتك وطباعتها وتصديرها، ولا يمكن الإضافة أو التعديل أو الحذف حتى تفعيل الاشتراك.",
      };
    case "grace": {
      const left = graceDaysLeft(sub);
      return {
        tone: "warning",
        title: `انتهى اشتراكك: مهلة ${daysTextGen(left)} قبل القراءة فقط`,
        body: "جدّد الاشتراك ليستمر العمل دون انقطاع.",
      };
    }
    case "past_due":
      return {
        tone: "warning",
        title: "يوجد مبلغ مستحق على اشتراكك",
        body: "سدّد المستحق لتجنّب تحوّل المنشأة إلى القراءة فقط.",
      };
    case "expired":
      return {
        tone: "danger",
        title: "انتهى الاشتراك: المنشأة للقراءة فقط",
        body: "يمكنك استعراض بياناتك وطباعتها وتصديرها، ولا يمكن الإضافة أو التعديل أو الحذف حتى تجديد الاشتراك.",
      };
    case "read_only":
      return {
        tone: "danger",
        title: "المنشأة في وضع القراءة فقط",
        body: "أوقفت إدارة المنصة الإضافة والتعديل مؤقتًا. تواصل مع الدعم لمعرفة السبب.",
      };
    case "cancelled":
      return {
        tone: "info",
        title: "اشتراكك لن يتجدد",
        body: `يعمل حتى ${formatDay(sub.current_period_end)}، ثم تصبح المنشأة للقراءة فقط.`,
      };
    case "active":
      return days <= 7
        ? { tone: "info", title: `ينتهي اشتراكك خلال ${daysTextGen(days)}`, body: `جدّد قبل ${formatDay(sub.current_period_end)} ليستمر العمل دون انقطاع.` }
        : null;
    default:
      return null;
  }
}

/** رسائل الخادم الخاصة بالاشتراك (تُعرض بدل الرمز) */
export const SUBSCRIPTION_ERROR_MESSAGES: Record<string, string> = {
  SUBSCRIPTION_READ_ONLY: "المنشأة في وضع القراءة فقط حتى تفعيل الاشتراك؛ لا يمكن الإضافة أو التعديل أو الحذف. راجع صفحة «الاشتراك».",
  PLAN_LIMIT_USERS: "بلغت المنشأة حد المستخدمين في باقتها؛ رقِّ الباقة من صفحة «الاشتراك» أو عطّل حسابًا آخر.",
  PLAN_LIMIT_EMPLOYEES: "بلغت المنشأة حد الموظفين الفعّالين في باقتها؛ رقِّ الباقة من صفحة «الاشتراك» أو عطّل موظفًا.",
  PLAN_LIMIT_BRANCHES: "بلغت المنشأة حد الفروع في باقتها؛ رقِّ الباقة من صفحة «الاشتراك».",
  SUBSCRIPTION_LAST_ADMIN: "لا يُعطَّل آخر مدير نظام فعّال والمنشأة للقراءة فقط؛ يحتاجه طلب الاشتراك.",
  COMPANY_ADMIN_REQUIRED: "هذا الإجراء لمدير النظام فقط.",
  PLAN_NOT_FOUND: "الباقة غير متاحة.",
  BILLING_CYCLE_INVALID: "اختر الدفع الشهري أو السنوي.",
  REQUEST_RATE_LIMIT: "أرسلت طلبات كثيرة اليوم؛ طلبك الأخير قيد المراجعة، أو تواصل مع الدعم.",
};

export function subscriptionErrorText(message: unknown): string | null {
  const text = String(message ?? "");
  const key = Object.keys(SUBSCRIPTION_ERROR_MESSAGES).find((code) => text.includes(code));
  return key ? SUBSCRIPTION_ERROR_MESSAGES[key] : null;
}

/** حدث عام عند رفض الخادم عملية بسبب الاشتراك (يُطلقه عميل Supabase) */
export const SUBSCRIPTION_ERROR_EVENT = "app:subscription-error";

export type SubscriptionErrorCode = "SUBSCRIPTION_READ_ONLY" | "PLAN_LIMIT_USERS" | "PLAN_LIMIT_EMPLOYEES" | "PLAN_LIMIT_BRANCHES";

const EVENT_CODES: SubscriptionErrorCode[] = ["SUBSCRIPTION_READ_ONLY", "PLAN_LIMIT_USERS", "PLAN_LIMIT_EMPLOYEES", "PLAN_LIMIT_BRANCHES"];

export function subscriptionErrorCode(text: string): SubscriptionErrorCode | null {
  return EVENT_CODES.find((code) => text.includes(code)) ?? null;
}
