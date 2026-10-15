import { isEmployeeActive } from "./employeeStatus";
// توحيد قراءة حالات الطلبات والإجازات المكتوبة بصيغ مختلفة عبر النظام
const APPROVED = ["موافق", "معتمد", "معتمدة", "مقبول", "approved", "مدفوع"];
const REJECTED = ["مرفوض", "مرفوضة", "rejected"];
const PENDING = ["", "معلق", "معلقة", "pending"];

const clean = (status: unknown) => String(status ?? "").trim();
export const isApprovedStatus = (status: unknown) => APPROVED.includes(clean(status));
export const isRejectedStatus = (status: unknown) => REJECTED.includes(clean(status));
export const isPendingStatus = (status: unknown) => PENDING.includes(clean(status));
export const APPROVED_STATUSES = APPROVED;
export const PENDING_STATUSES = PENDING.filter(Boolean);

/** للعرض: معلق / موافق / مرفوض */
export const normalizeRequestStatus = (status: unknown): "معلق" | "موافق" | "مرفوض" =>
  isApprovedStatus(status) ? "موافق" : isRejectedStatus(status) ? "مرفوض" : "معلق";

/** الجنسية السعودية بأي صيغة مخزنة */
export const isSaudiNationality = (value: unknown) =>
  ["سعودي", "سعودية", "السعودية", "المملكة العربية السعودية", "saudi", "saudi arabia", "sa", "ksa"].includes(clean(value).toLowerCase());

/** حالات الموظف النشط */
export const ACTIVE_EMPLOYEE_STATUSES = ["فعال", "نشط", "active"];

/** حالات الموظف غير النشط (لا يظهر في التنبيهات والقوائم التشغيلية) */
// القائمة نفسها في قاعدة البيانات والدوال الطرفية (employeeStatus.ts)
export { INACTIVE_EMPLOYEE_STATUSES } from "./employeeStatus";
export const isInactiveEmployeeStatus = (status: unknown) => !isEmployeeActive(status);

/** نوع الإجازة السنوية بأي صيغة (إجازة سنوية، الإجازة السنوية، سنوية، annual) */
export const isAnnualLeaveType = (value: unknown) => {
  const text = clean(value).toLowerCase();
  return text.includes("سنوي") || text.includes("annual");
};
