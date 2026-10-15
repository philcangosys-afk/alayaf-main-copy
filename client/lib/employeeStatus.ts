// حالات الموظف التي تعني أنه غير فعال (لا دخول ولا صلاحيات).
// نفس قائمة قاعدة البيانات: public.employee_status_active (دفعة الموارد البشرية 6، K2)، وتُقارن دون مسافات وبأحرف صغيرة.
// الحالة الفارغة و"فعال" و"نشط" و"إجازة" كلها فعالة.
export const INACTIVE_EMPLOYEE_STATUSES = ["غير فعال", "غير نشط", "منتهي", "منتهية", "منتهي الخدمة", "مستقيل", "مفصول", "موقوف", "inactive", "terminated"];

export const isEmployeeActive = (status: unknown) =>
  !INACTIVE_EMPLOYEE_STATUSES.includes(String(status ?? "").trim().toLowerCase());
