// رسائل أخطاء الموظفين القادمة من قاعدة البيانات (رموز المشغّلات) بالعربية
const EMPLOYEE_ERROR_MESSAGES: Record<string, string> = {
  EMPLOYEE_EMAIL_ALREADY_USED: "هذا البريد مسجّل لموظف آخر",
  EMPLOYEE_EMAIL_MATCHES_CURRENT_USER: "لا يمكن استخدام بريد حسابك أنت لموظف جديد",
  EMPLOYEE_EMAIL_CHANGE_REQUIRES_SYSTEM_ADMIN: "تغيير البريد لموظف له بريد مسجّل يتم من مدير النظام فقط",
  ADMIN_ROLE_ASSIGNMENT_REQUIRES_SYSTEM_ADMIN: "منح دور المدير أو سحبه يتم من مدير النظام فقط",
  SYSTEM_ADMIN_RECORD_PROTECTED: "سجل مدير النظام محمي ولا يعدّله إلا مدير النظام",
  CANNOT_CHANGE_OWN_ROLE_OR_PERMISSIONS: "لا يمكنك تغيير دورك أو صلاحياتك بنفسك",
  EMPLOYEE_INSERT_REQUIRES_HR: "إضافة الموظفين تتطلب صلاحية إدارة الموظفين",
  EMPLOYEE_UPDATE_NOT_ALLOWED: "ليست لديك صلاحية تعديل هذا الموظف",
  EMPLOYEE_FIELD_CHANGE_REQUIRES_HR: "تعديل هذه الحقول يتطلب صلاحية الموارد البشرية",
  EMPLOYEE_EMP_ID_TAKEN: "الرقم الوظيفي مستخدم لموظف آخر",
  EMPLOYEE_EMP_ID_IMMUTABLE: "الرقم الوظيفي لا يُعدَّل بعد إنشائه",
  EMPLOYEE_ACCOUNT_TITLE_TAKEN: "الرقم الوظيفي البديل مستخدم لموظف آخر",
  EMPLOYEE_NATIONAL_ID_TAKEN: "رقم الهوية / الإقامة مسجّل لموظف آخر",
  EMPLOYEE_ROLE_ABOVE_CALLER: "دور هذا الموظف أو صلاحياته أعلى من صلاحياتك؛ يسندها أو يعدّلها مدير النظام",
  EMPLOYEE_FINANCIAL_CHANGE_REQUIRES_PAYROLL: "تعديل الراتب والبدلات والحساب البنكي يتطلب صلاحية إدارة الرواتب",
  EMPLOYEE_EMAIL_USED_BY_SPECIAL_USER: "هذا البريد مستخدم لمستخدم خاص",
  EMPLOYEE_EMAIL_LINKED_TO_OTHER_LOGIN: "هذا البريد مرتبط بحساب دخول موظف آخر",
  EMPLOYEE_DELETE_REQUIRES_HR: "حذف الموظفين يتطلب صلاحية إدارة الموظفين",
  EMPLOYEE_OWN_PAY_CHANGE: "لا يمكنك تعديل راتبك أو بدلاتك أو حسابك البنكي بنفسك؛ يعدّلها مسؤول رواتب آخر",
  EMPLOYEE_OWN_ATTENDANCE_SETTINGS: "لا يمكنك تعديل جدول دوامك أو موقع حضورك أو إذن تسجيل الحضور من البوابة في سجلك؛ يعدّلها مسؤول آخر",
  EMPLOYEE_EMAIL_LOCKED_WHILE_LOGIN_LINKED: "البريد مرتبط بحساب دخول الموظف؛ يغيّره مدير النظام من زر «تغيير البريد» في بيانات الموظف",
  EMAIL_NOT_AVAILABLE: "هذا البريد غير متاح؛ استخدم بريدًا مختلفًا للموظف",
  AUTH_LINK_REQUIRES_SERVER: "ربط حساب الدخول يتم من الخادم فقط",
};

export const employeeErrorText = (error: unknown, fallback = "حدث خطأ أثناء الحفظ") => {
  const err = error as { message?: string; code?: string; details?: string } | null;
  const text = `${err?.message ?? ""} ${err?.details ?? ""}`;
  const key = Object.keys(EMPLOYEE_ERROR_MESSAGES).find((code) => text.includes(code));
  if (key) return EMPLOYEE_ERROR_MESSAGES[key];
  if (err?.code === "42501") return "ليست لديك صلاحية لهذه العملية";
  if (err?.code === "23505") return "قيمة مكررة: البيانات مسجّلة لموظف آخر";
  if (err?.code === "PGRST116") return "لم يُحفظ شيء: السجل غير موجود أو ليست لديك صلاحية تعديله";
  if (/failed to fetch|network/i.test(text)) return "تعذر الاتصال بالخادم؛ تحقق من الإنترنت ثم أعد المحاولة";
  return err?.message || fallback;
};

