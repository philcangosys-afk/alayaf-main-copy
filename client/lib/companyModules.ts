/**
 * S19: أقسام المنشأة في باقتها (مع استثناء المنشأة من لوحة المنصة).
 *   accounting = المحاسبة والمالية (المبيعات والمشتريات والمخزون والعملاء والموردون والحسابات والضرائب)
 *   hr         = الموارد البشرية (والرواتب وبوابة الموظف)
 *   hotel      = الحجوزات: إضافة على المحاسبة والمالية
 * المتاح للجميع: لوحة التحكم، والإعدادات، والمستخدمون والأدوار وسجلاتهم، والأسطول، والمهام، والمساعد، والاشتراك.
 * الحجب الفعلي في الخادم (دوال الصلاحية)؛ هنا إخفاء القوائم وشاشة «غير مشمول» فقط.
 */
export type CompanyModule = "accounting" | "hr" | "hotel";

export const ALL_COMPANY_MODULES: CompanyModule[] = ["accounting", "hr", "hotel"];

export const COMPANY_MODULE_LABELS: Record<CompanyModule, string> = {
  accounting: "المحاسبة والمالية",
  hr: "الموارد البشرية",
  hotel: "الحجوزات",
};

/** قسم مفتاح الصلاحية (نفس module_of_permission في الخادم)؛ null للمتاح للجميع */
export function moduleOfPermission(key: string): CompanyModule | null {
  if (!key) return null;
  if (key === "module.hotel" || key.startsWith("hotel.")) return "hotel";
  // S22: نقاط البيع جزء من المحاسبة والمالية (دوالها في الخادم تتحقق من القسم نفسها)
  if (key === "module.pos" || key.startsWith("pos.")) return "accounting";
  if (key === "accounting.payroll_posting") return "hr";
  if (key === "hr.permissions" || key.startsWith("hr.permissions.")) return null;
  if (key === "module.hr" || key.startsWith("hr.") || key.startsWith("employees.")) return "hr";
  if (
    ["module.accounting", "module.sales", "module.purchases", "module.inventory", "module.crm"].includes(key) ||
    key.startsWith("accounting.") || key.startsWith("sales.") || key.startsWith("purchases.") ||
    key.startsWith("inventory.") || key.startsWith("crm.")
  ) return "accounting";
  return null;
}

/** قسم صفحة من مسارها؛ null للمتاح للجميع */
export function moduleForPath(path: string): CompanyModule | null {
  if (path.startsWith("/hotel")) return "hotel";
  if (path.startsWith("/pos")) return "accounting";
  // الأدوار والصلاحيات وسجل النشاط تحت الموارد البشرية لكنها للجميع
  if (path.startsWith("/hr/permissions") || path.startsWith("/hr/user-logs")) return null;
  // الفروع: بلا الموارد البشرية يديرها مدير النظام (كما في الخادم)
  if (path.startsWith("/hr/organization/branches")) return null;
  // ترحيل الرواتب من المحاسبة: مع الموارد البشرية (كما في الخادم)
  if (path.startsWith("/expenses/payroll-posting")) return "hr";
  if (path.startsWith("/hr") || path.startsWith("/employee/") || path === "/employee") return "hr";
  if (
    path.startsWith("/sales") || path.startsWith("/purchases") || path.startsWith("/inventory") ||
    path.startsWith("/crm") || path.startsWith("/expenses") || path.startsWith("/zatca")
  ) return "accounting";
  return null;
}

/** null = لم تُقرأ الأقسام (قبل S19 أو تعذر الاتصال): لا إخفاء في الواجهة، والخادم يحجب */
export function hasCompanyModule(modules: CompanyModule[] | null | undefined, module: CompanyModule | null): boolean {
  if (!module || !modules) return true;
  return modules.includes(module);
}

/** مفاتيح الصلاحية التي تمنح شيئًا في أقسام المنشأة (مفتاح قسم غير مشمول لا يمنح، كما في الخادم) */
export function entitledPermissionKeys(modules: CompanyModule[] | null | undefined, keys: readonly string[]): string[] {
  return keys.filter((key) => hasCompanyModule(modules, moduleOfPermission(key)));
}

export function pathAllowedByModules(modules: CompanyModule[] | null | undefined, path: string): boolean {
  return hasCompanyModule(modules, moduleForPath(path));
}

/** قراءة نتيجة my_company_modules() بأمان */
export function parseCompanyModules(value: unknown): CompanyModule[] | null {
  const list = value && typeof value === "object" && !Array.isArray(value) ? (value as { modules?: unknown }).modules : null;
  if (!Array.isArray(list)) return null;
  return ALL_COMPANY_MODULES.filter((module) => list.includes(module));
}
