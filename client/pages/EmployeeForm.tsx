import { useEffect, useRef, useState } from "react";
import Layout from "@/components/Layout";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { INACTIVE_EMPLOYEE_STATUSES, setEmployeeLoginState } from "@/components/hr/employeeActions";
import { employeeErrorText } from "@/components/hr/employeeErrors";
import { GOSI_TYPE_GCC, gosiTypesFor, isGccNationality, isNewSystemType } from "@/lib/gosi";
import { isSaudiNationality } from "@/lib/hrStatus";
import { isSaudiCompany } from "@/lib/companyProfile";

export { employeeErrorText };
import {
  EMPLOYEE_FILE_ACCEPT,
  EmployeePhoto,
  employeeFileName,
  isEmployeeStoragePath,
  openEmployeeFile,
  uploadEmployeeFile,
  validateEmployeeFile,
} from "@/components/hr/employeeFiles";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  RefreshCw,
  Save,
  X,
  Upload,
  FileText,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────
export type Allowance = {
  id: string;
  type: string;
  amount: number;
  from: string;
  to: string;
  effect: string;
};

export type InsuranceItem = {
  id: string;
  type: string;
  value: string;
  notes: string;
};

export type DeptOpt = { id: string; name: string; branchId: string };
export type BranchOpt = { id: string; name: string };
export type SectionOpt = { id: string; name: string; departmentId: string; department: string };

export type EmpFormData = {
  id: string;
  // Step 1: Personal
  name: string; // الاسم الكامل (إجباري)
  firstName: string; // الاسم الكامل (حسبي)
  birthDate: string;
  gender: string;
  email: string;
  phone: string;
  nationality: string;
  address2: string;
  maritalStatus: string;
  nationalId: string;
  workContactType: string;
  idExpiryDate: string;
  passportNumber: string;
  passportExpiryDate: string;
  workPermitNumber: string;
  residencePermitDate: string;
  kafalaNumber: string;
  kafalaExpiryDate: string;
  photoUrl: string;
  // Step 2: Job
  division: string;
  jobTitle: string;
  branchId: string;
  branch: string;
  employmentType: string;
  directorate: string;
  departmentId: string;
  department: string;
  sectionId: string;
  otherWorkLocations: string;
  workLocation: string;
  directManager: string;
  hireDate: string;
  isContractEnd: boolean;
  employeeCategory: string;
  contractEndDate: string;
  workSchedule: string;
  workTime: string;
  attendanceExempt: boolean;
  dailyHours: number;
  allowRemoteUpload: boolean;
  allowRemoteAttendance: boolean;
  managementDaysAfter: number;
  trainingDaysStart: number;
  // Step 3: Financial
  baseSalary: number;
  currency: string;
  allowances: Allowance[];
  socialInsurance: string;
  socialInsuranceType: string;
  socialInsuranceStartDate: string;
  insuranceOther: string;
  bankName: string;
  bankBranch: string;
  bankAccount: string;
  iban: string;
  // Step 4: Permissions
  permissions: string[];
  // Step 5: Insurance
  insuranceItems: InsuranceItem[];
  // Step 6: Documents
  documents: Record<string, string>;
  // Step 7: Account
  username: string;
  accountTitle: string;
  employeeRole: string;
  password: string;
  // Extra
  status: string;
  empId: string;
  costCenter: string;
  notes: string;
  totalSalary: number;
};

export const emptyForm = (): EmpFormData => ({
  id: crypto.randomUUID(),
  name: "",
  firstName: "",
  birthDate: "",
  gender: "",
  email: "",
  phone: "",
  nationality: "",
  address2: "",
  maritalStatus: "",
  nationalId: "",
  workContactType: "",
  idExpiryDate: "",
  passportNumber: "",
  passportExpiryDate: "",
  workPermitNumber: "",
  residencePermitDate: "",
  kafalaNumber: "",
  kafalaExpiryDate: "",
  photoUrl: "",
  division: "",
  jobTitle: "",
  branchId: "",
  branch: "",
  employmentType: "أساسي",
  directorate: "",
  departmentId: "",
  department: "",
  sectionId: "",
  otherWorkLocations: "",
  workLocation: "",
  directManager: "",
  hireDate: "",
  isContractEnd: false,
  employeeCategory: "",
  contractEndDate: "",
  workSchedule: "",
  workTime: "",
  attendanceExempt: false,
  dailyHours: 8,
  allowRemoteUpload: true,
  allowRemoteAttendance: true,
  managementDaysAfter: 0,
  trainingDaysStart: 0,
  baseSalary: 0,
  currency: "SAR",
  allowances: [],
  // جديد: غير محدد حتى يختار المستخدم (لا يُحفظ "لا" تلقائيًا)
  socialInsurance: "",
  socialInsuranceType: "",
  socialInsuranceStartDate: "",
  insuranceOther: "",
  bankName: "",
  bankBranch: "",
  bankAccount: "",
  iban: "",
  permissions: [],
  insuranceItems: [],
  documents: {},
  username: "",
  accountTitle: "",
  employeeRole: "موظف",
  password: "",
  status: "فعال",
  empId: "",
  costCenter: "",
  notes: "",
  totalSalary: 0,
});

export const mapRowToForm = (r: Record<string, unknown>): EmpFormData => ({
  id: String(r.id ?? ""),
  name: String(r.name ?? ""),
  firstName: String(r.first_name ?? ""),
  birthDate: String(r.birth_date ?? ""),
  gender: String(r.gender ?? ""),
  email: String(r.email ?? ""),
  phone: String(r.phone ?? ""),
  nationality: String(r.nationality ?? ""),
  address2: String(r.address2 ?? ""),
  maritalStatus: String(r.marital_status ?? ""),
  nationalId: String(r.national_id ?? ""),
  workContactType: String(r.work_contact_type ?? ""),
  idExpiryDate: String(r.id_expiry_date ?? ""),
  passportNumber: String(r.passport_number ?? ""),
  passportExpiryDate: String(r.passport_expiry_date ?? ""),
  workPermitNumber: String(r.work_permit_number ?? ""),
  residencePermitDate: String(r.residence_permit_date ?? ""),
  kafalaNumber: String(r.kafala_number ?? ""),
  kafalaExpiryDate: String(r.kafala_expiry_date ?? ""),
  photoUrl: String(r.photo_url ?? ""),
  division: String(r.division ?? ""),
  jobTitle: String(r.job_title ?? ""),
  branchId: String(r.branch_id ?? ""),
  branch: String(r.branch ?? ""),
  employmentType: String(r.employment_type ?? "أساسي"),
  directorate: String(r.directorate ?? ""),
  departmentId: String(r.department_id ?? ""),
  department: String(r.department ?? ""),
  sectionId: String(r.section_id ?? ""),
  otherWorkLocations: String(r.other_work_locations ?? ""),
  workLocation: String(r.work_location ?? ""),
  directManager: String(r.direct_manager ?? ""),
  hireDate: String(r.hire_date ?? ""),
  isContractEnd: Boolean(r.is_contract_end ?? false),
  employeeCategory: String(r.employee_category ?? ""),
  contractEndDate: String(r.contract_end_date ?? ""),
  workSchedule: String(r.work_schedule ?? ""),
  workTime: String(r.work_time ?? ""),
  attendanceExempt: Boolean(r.attendance_exempt ?? false),
  dailyHours: Number(r.daily_hours ?? 8),
  allowRemoteUpload: Boolean(r.allow_remote_upload ?? true),
  allowRemoteAttendance: Boolean(r.allow_remote_attendance ?? true),
  managementDaysAfter: Number(r.management_days_after ?? 0),
  trainingDaysStart: Number(r.training_days_start ?? 0),
  baseSalary: Number(r.base_salary ?? 0),
  currency: String(r.currency ?? "SAR"),
  // بعض البدلات القديمة تحفظ القيمة في value بدل amount، وقد لا يكون لها معرّف
  allowances: Array.isArray(r.allowances)
    ? (r.allowances as Record<string, unknown>[]).map((item, index) => ({
        id: String(item.id ?? `legacy-${index}`),
        type: String(item.type ?? ""),
        amount: Number(item.amount ?? item.value ?? 0) || 0,
        from: String(item.from ?? ""),
        to: String(item.to ?? ""),
        effect: String(item.effect ?? ""),
      }))
    : [],
  // الحقل الفارغ في السجلات القديمة يبقى "غير محدد" (لا يتحول إلى "لا" عند الحفظ)؛ مسير الرواتب يعامله مشمولًا للسعودي
  socialInsurance: ["نعم", "مشمول"].includes(String(r.social_insurance ?? "").trim()) ? "نعم" : String(r.social_insurance ?? "").trim() === "" ? "" : "لا",
  socialInsuranceType: String(r.social_insurance_type ?? ""),
  socialInsuranceStartDate: String(r.social_insurance_start_date ?? ""),
  insuranceOther: String(r.insurance_other ?? ""),
  bankName: String(r.bank_name ?? ""),
  bankBranch: String(r.bank_branch ?? ""),
  bankAccount: String(r.bank_account ?? ""),
  iban: String(r.iban ?? ""),
  permissions: Array.isArray(r.permissions) ? (r.permissions as string[]) : [],
  insuranceItems: Array.isArray(r.insurance_items)
    ? (r.insurance_items as InsuranceItem[])
    : [],
  documents: r.documents && typeof r.documents === "object" && !Array.isArray(r.documents)
    ? Object.fromEntries(Object.entries(r.documents as Record<string, unknown>).map(([key, value]) => [key, String(value ?? "")]))
    : {},
  username: String(r.username ?? ""),
  accountTitle: String(r.account_title ?? ""),
  employeeRole: String(r.employee_role ?? ""),
  password: "",
  status: String(r.status ?? "نشط") === "نشط" ? "فعال" : String(r.status ?? "غير نشط") === "غير نشط" ? "غير فعال" : String(r.status ?? "فعال"),
  empId: String(r.emp_id ?? ""),
  costCenter: String(r.cost_center ?? ""),
  notes: String(r.notes ?? ""),
  totalSalary: Number(r.total_salary ?? r.base_salary ?? 0),
});

// ─── Constants ──────────────────────────────────────────────────────────────
export const NATIONALITIES = [
  "المملكة العربية السعودية", "الإمارات العربية المتحدة", "البحرين", "الكويت", "عُمان", "قطر",
  "مصر", "السودان", "جنوب السودان", "ليبيا", "تونس", "الجزائر", "المغرب", "موريتانيا", "الصومال", "جيبوتي", "جزر القمر",
  "سوريا", "الأردن", "لبنان", "فلسطين", "العراق", "اليمن",
  "الهند", "باكستان", "بنغلاديش", "سريلانكا", "نيبال", "بوتان", "أفغانستان", "المالديف",
  "الفلبين", "إندونيسيا", "ماليزيا", "تايلاند", "فيتنام", "ميانمار", "الصين", "اليابان", "كوريا الجنوبية",
  "إثيوبيا", "إريتريا", "كينيا", "أوغندا", "تنزانيا", "نيجيريا", "غانا", "السنغال", "الكاميرون", "جنوب أفريقيا",
  "تركيا", "إيران", "أذربيجان", "أوزبكستان", "كازاخستان", "روسيا", "أوكرانيا",
  "المملكة المتحدة", "فرنسا", "ألمانيا", "إيطاليا", "إسبانيا", "هولندا", "السويد", "اليونان",
  "الولايات المتحدة", "كندا", "المكسيك", "البرازيل", "الأرجنتين", "أستراليا", "نيوزيلندا", "أخرى",
];
const DEFAULT_DEPARTMENTS = ["الإدارة العليا", "إدارة الموارد البشرية", "إدارة المالية", "إدارة التشغيل", "إدارة المبيعات"];
const DEFAULT_SECTIONS = ["الموارد البشرية", "المحاسبة", "الصيانة والتشغيل", "المبيعات", "تقنية المعلومات"];
export const GENDERS = ["ذكر", "أنثى"];
const MARITAL_STATUSES = ["أعزب", "متزوج", "مطلق", "أرمل"];
const DEFAULT_JOBS = ["مدير عام", "مدير موارد بشرية", "مدير مالي", "محاسب", "مهندس", "فني صيانة", "مسؤول مبيعات", "مسؤول مشتريات", "أخصائي موارد بشرية", "موظف إداري", "عامل نظافة"];
const CURRENCIES = ["SAR"];
const CURRENCY_LABELS: Record<string, string> = { SAR: "ريال سعودي (SAR)" };
export const EMPLOYMENT_TYPES = ["أساسي", "جزئي", "عقد", "متعاون"];
const EMPLOYEE_STATUSES = ["فعال", "غير فعال", "إجازة", "منتهي"];
const WORK_TIMES = ["صباحي", "مسائي", "كامل", "ورديات"];
const EMPLOYEE_CATEGORIES = ["دوام", "عقد", "جزئي", "مؤقت"];
const DEFAULT_WORK_SCHEDULES = ["جدول الشركة الأساسي", "جدول مرن", "عمل من المنزل", "نظام ورديات"];
const DEFAULT_WORK_LOCATIONS = ["المقر الرئيسي", "فرع التشغيل والصيانة", "فرع المبيعات"];
const ALLOWANCE_TYPES = ["بدل السكن", "بدل النقل", "بدل الأطفال", "بدل الطعام", "بدل الهاتف", "بدل اللباس", "أخرى"];
// أنواع التأمين حسب الجنسية (lib/gosi): للسعودي القابل وغير القابل للخصم بالنظام السابق أو "الجديد" (أول تسجيل للموظف
// في التأمينات من 3 يوليو 2024، ونسبة المعاشات ترتفع كل يوليو)، ولمواطن دول المجلس "مد الحماية التأمينية"،
// ولغيرهم "الأخطار المهنية" فقط
const NEW_SYSTEM_START = "2024-07-03";

type OrganizationOptions = {
  departments: string[];
  sections: string[];
  jobs: string[];
  workLocations: string[];
  workSchedules: string[];
  companies: string[];
};

const DEFAULT_ORGANIZATION_OPTIONS: OrganizationOptions = {
  departments: DEFAULT_DEPARTMENTS,
  sections: DEFAULT_SECTIONS,
  jobs: DEFAULT_JOBS,
  workLocations: DEFAULT_WORK_LOCATIONS,
  workSchedules: DEFAULT_WORK_SCHEDULES,
  companies: ["الشركة الرئيسية"],
};

const PERMISSIONS_COLUMNS = [
  ["صيانة", "الصرف", "السلف", "استئذان", "الإجازات"],
  ["عهدة", "عمل إضافي", "دورة تدريبية", "نقل", "إخلاء طرف"],
  ["شراء", "إضافة طرف", "مباشرة العمل", "انتداب", "استقالة"],
  ["صرف امتياز مالي", "إقالة موظف", "وظيفة شاغرة", "إضافة موظف"],
  ["تعديل راتب", "مهمة عمل", "صرف عمولة", "صرف مستحقات إجازة"],
];

const DOCUMENT_TYPES = [
  { key: "id_card", label: "صورة بطاقة الهوية" },
  { key: "passport", label: "صورة جواز السفر" },
  { key: "cv", label: "سيرة ذاتية" },
  { key: "personal_photo", label: "صورة شخصية" },
  { key: "qualification", label: "المؤهل العملي" },
  { key: "other", label: "وثائق أخرى" },
];

const STEPS = [
  { id: "personal", label: "تفاصيل شخصية" },
  { id: "job", label: "البيانات الوظيفية" },
  { id: "financial", label: "بيانات مالية" },
  { id: "requests", label: "الطلبات الخاصة للموظف" },
  { id: "insurance", label: "التأمين" },
  { id: "documents", label: "وثائق الموظف" },
  { id: "account", label: "معلومات الحساب" },
  { id: "finish", label: "الإنهاء" },
];

// ─── Helpers: salary, validation, payload ────────────────────────────────────
const riyadhToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
const round2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

// الإجمالي الشهري = الأساسي + البدلات المضافة السارية اليوم − البدلات المخصومة السارية اليوم
export const computeTotalSalary = (baseSalary: number, allowances: Allowance[], today = riyadhToday()) => {
  const active = allowances.filter((a) => (!a.from || a.from <= today) && (!a.to || a.to >= today));
  const added = active.filter((a) => a.effect !== "مخصوم").reduce((sum, a) => sum + (Number(a.amount) || 0), 0);
  const deducted = active.filter((a) => a.effect === "مخصوم").reduce((sum, a) => sum + (Number(a.amount) || 0), 0);
  return round2((Number(baseSalary) || 0) + added - deducted);
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const normalizeDigits = (value: string) =>
  value.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));

type FormIssue = { step: number; message: string };

// الإضافة: كل الحقول الإلزامية. التعديل: لا يُسمح بإفراغ حقل إلزامي كان معبأً، وتُفحص صيغة ما تغيّر فقط،
// حتى لا يُمنع تعديل بسيط بسبب نقص قديم في بيانات موظف حالي.
const validateEmployeeForm = (form: EmpFormData, mode: "create" | "edit", initial: EmpFormData): FormIssue[] => {
  const issues: FormIssue[] = [];
  const add = (step: number, message: string) => issues.push({ step, message });
  const isCreate = mode === "create";
  const filled = (value: unknown) => typeof value === "number" ? value > 0 : String(value ?? "").trim() !== "";
  const changed = <K extends keyof EmpFormData>(key: K) => JSON.stringify(form[key]) !== JSON.stringify(initial[key]);
  const need = <K extends keyof EmpFormData>(step: number, key: K, message: string) => {
    if (!filled(form[key]) && (isCreate || filled(initial[key]))) add(step, message);
  };
  const check = <K extends keyof EmpFormData>(key: K) => isCreate || changed(key);
  const nationalId = normalizeDigits(form.nationalId.trim());
  const phone = normalizeDigits(form.phone.replace(/[\s-]/g, ""));
  // صيغ الهوية السعودية والآيبان السعودي والتأمينات الاجتماعية لمنشآت السعودية فقط (S14)
  const saudiCompany = isSaudiCompany();

  need(0, "name", "الاسم الكامل بالعربي مطلوب");
  need(0, "gender", "الجنس مطلوب");
  need(0, "nationality", "الجنسية مطلوبة");
  need(0, "nationalId", "رقم الهوية / الإقامة مطلوب");
  if (saudiCompany && nationalId && check("nationalId") && !/^[1-4]\d{9}$/.test(nationalId)) add(0, "رقم الهوية / الإقامة / الحدود يجب أن يكون 10 أرقام ويبدأ بـ 1 أو 2 أو 3 أو 4");
  if (!saudiCompany && nationalId && check("nationalId") && !/^[A-Za-z0-9-]{4,30}$/.test(nationalId)) add(0, "رقم الهوية / الإقامة من 4 إلى 30 حرفًا لاتينيًا أو رقمًا (ويُقبل -، بلا مسافات)");
  need(0, "phone", "رقم الجوال مطلوب");
  if (phone && check("phone") && !/^(05\d{8}|\+?\d{8,15})$/.test(phone)) add(0, "رقم الجوال غير صحيح (مثال: 05xxxxxxxx أو رقم دولي)");
  if (form.email.trim() && check("email") && !EMAIL_PATTERN.test(form.email.trim())) add(0, "البريد الإلكتروني غير صحيح");
  if (form.birthDate && check("birthDate") && form.birthDate >= riyadhToday()) add(0, "تاريخ الميلاد غير صحيح");
  if (!isCreate && initial.email.trim() && form.email.trim().toLowerCase() !== initial.email.trim().toLowerCase()) {
    add(0, "تغيير البريد لموظف له بريد مسجّل يتم من مدير النظام فقط؛ أعد البريد كما كان");
  }

  need(1, "jobTitle", "المسمى الوظيفي مطلوب");
  need(1, "employmentType", "نوع التوظيف مطلوب");
  need(1, "branchId", "الفرع مطلوب");
  need(1, "status", "الحالة مطلوبة");
  need(1, "departmentId", "الإدارة مطلوبة");
  need(1, "hireDate", "تاريخ التعيين مطلوب");
  if (form.isContractEnd && !form.contractEndDate) add(1, "تاريخ انتهاء العقد مطلوب للعقد محدد المدة");
  if (form.contractEndDate && form.hireDate && (check("contractEndDate") || check("hireDate")) && form.contractEndDate < form.hireDate) {
    add(1, "تاريخ انتهاء العقد قبل تاريخ التعيين");
  }
  if (check("dailyHours") && !(form.dailyHours > 0 && form.dailyHours <= 24)) add(1, "عدد ساعات اليوم يجب أن يكون بين 1 و24");
  if (form.managementDaysAfter < 0) add(1, "أيام الإجازة السنوية لا تكون سالبة");

  if (form.employmentType !== "متعاون") need(2, "baseSalary", "الراتب الأساسي يجب أن يكون أكبر من صفر");
  if (form.baseSalary < 0) add(2, "الراتب الأساسي لا يكون سالبًا");
  if (check("allowances")) {
    form.allowances.forEach((a, index) => {
      const row = index + 1;
      if (!a.type) add(2, `البدل رقم ${row}: نوع البدل مطلوب`);
      if (!(Number(a.amount) > 0)) add(2, `البدل رقم ${row}: القيمة يجب أن تكون أكبر من صفر`);
      if (!a.effect) add(2, `البدل رقم ${row}: حدد الأثر (مضاف أو مخصوم)`);
      if (a.from && a.to && a.to < a.from) add(2, `البدل رقم ${row}: تاريخ النهاية قبل تاريخ البداية`);
    });
  }
  if ((check("allowances") || check("baseSalary")) && computeTotalSalary(form.baseSalary, form.allowances) < 0) {
    add(2, "إجمالي الراتب بعد البدلات المخصومة سالب");
  }
  if (saudiCompany && form.socialInsurance === "نعم" && (check("socialInsurance") || check("socialInsuranceType") || check("socialInsuranceStartDate"))) {
    if (!form.socialInsuranceType) add(2, "نوع التأمينات الاجتماعية مطلوب");
    if (!form.socialInsuranceStartDate) add(2, "تاريخ الاشتراك في التأمينات مطلوب");
  }
  // نوع التأمين يناسب الجنسية (يُفحص عند تغيير الجنسية أو التأمينات أو نوعها، فلا يمنع حفظ سجل قديم لم تُمس هذه الحقول فيه)
  if (saudiCompany && form.socialInsurance === "نعم" && form.socialInsuranceType
      && (check("nationality") || check("socialInsurance") || check("socialInsuranceType"))
      && !gosiTypesFor(form.nationality).includes(form.socialInsuranceType)) {
    add(2, `نوع التأمين لا يناسب الجنسية؛ المتاح لهذه الجنسية: ${gosiTypesFor(form.nationality).map((type) => `«${type}»`).join(" أو ")}`);
  }
  // النظام الجديد لمن سُجّل في التأمينات أول مرة من 3 يوليو 2024؛ الاشتراك قبله يعني النظام السابق
  if (saudiCompany && form.socialInsurance === "نعم" && isNewSystemType(form.socialInsuranceType) && form.socialInsuranceStartDate
      && (check("socialInsuranceType") || check("socialInsuranceStartDate")) && form.socialInsuranceStartDate < NEW_SYSTEM_START) {
    add(2, "النظام الجديد للتأمينات لمن سُجّل أول مرة من 3 يوليو 2024؛ تاريخ الاشتراك قبله يعني النظام السابق (النوع بلا «النظام الجديد»)");
  }
  if (saudiCompany && form.iban && check("iban") && !/^SA\d{22}$/.test(form.iban.toUpperCase().replace(/\s/g, ""))) add(2, "رقم الآيبان يجب أن يبدأ بـ SA ويتبعه 22 رقمًا");
  if (!saudiCompany && form.iban && check("iban") && !/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(form.iban.toUpperCase().replace(/\s/g, ""))) add(2, "رقم الآيبان غير صحيح: حرفان لرمز الدولة ثم رقمان ثم رقم الحساب");

  if (form.password) {
    if (!form.email.trim()) add(6, "إنشاء حساب دخول يتطلب بريدًا إلكترونيًا في الخطوة الأولى");
    if (form.password.length < 8) add(6, "كلمة المرور 8 أحرف على الأقل");
  }
  need(6, "employeeRole", "صلاحية الموظف (الدور) مطلوبة");
  return issues;
};

export const buildEmployeePayload = (form: EmpFormData): Record<string, unknown> => ({
  name: form.name.trim(),
  first_name: form.firstName.trim(),
  birth_date: form.birthDate || null,
  gender: form.gender,
  email: form.email.trim() ? form.email.trim().toLowerCase() : null,
  phone: normalizeDigits(form.phone.replace(/[\s-]/g, "")),
  nationality: form.nationality,
  address2: form.address2,
  marital_status: form.maritalStatus,
  national_id: normalizeDigits(form.nationalId.trim()),
  work_contact_type: form.workContactType,
  id_expiry_date: form.idExpiryDate || null,
  passport_number: form.passportNumber,
  passport_expiry_date: form.passportExpiryDate || null,
  work_permit_number: form.workPermitNumber,
  residence_permit_date: form.residencePermitDate || null,
  kafala_number: form.kafalaNumber,
  kafala_expiry_date: form.kafalaExpiryDate || null,
  photo_url: form.photoUrl,
  division: form.division,
  job_title: form.jobTitle,
  branch_id: form.branchId || null,
  branch: form.branch,
  employment_type: form.employmentType,
  directorate: form.directorate,
  department_id: form.departmentId || null,
  department: form.department,
  section_id: form.sectionId || null,
  other_work_locations: form.otherWorkLocations,
  work_location: form.workLocation,
  direct_manager: form.directManager,
  hire_date: form.hireDate || null,
  is_contract_end: form.isContractEnd,
  employee_category: form.employeeCategory,
  contract_end_date: form.isContractEnd ? form.contractEndDate || null : null,
  work_schedule: form.workSchedule,
  work_time: form.workTime,
  attendance_exempt: form.attendanceExempt,
  daily_hours: form.dailyHours,
  allow_remote_upload: form.allowRemoteUpload,
  allow_remote_attendance: form.allowRemoteAttendance,
  management_days_after: form.managementDaysAfter,
  base_salary: round2(form.baseSalary),
  currency: form.currency,
  allowances: form.allowances.map((a) => ({ ...a, amount: round2(Number(a.amount)) })),
  social_insurance: form.socialInsurance,
  social_insurance_type: form.socialInsurance === "لا" ? "" : form.socialInsuranceType,
  social_insurance_start_date: form.socialInsurance === "لا" ? null : form.socialInsuranceStartDate || null,
  insurance_other: form.insuranceOther,
  bank_name: form.bankName,
  bank_branch: form.bankBranch,
  bank_account: form.bankAccount,
  iban: form.iban.toUpperCase().replace(/\s/g, ""),
  permissions: form.permissions,
  insurance_items: form.insuranceItems,
  documents: form.documents,
  account_title: form.accountTitle.trim(),
  employee_role: form.employeeRole,
  status: form.status,
  cost_center: form.costCenter,
  notes: form.notes,
});

// في التعديل نرسل الحقول التي تغيّرت فقط، فلا تُمسّ القيم القديمة التي لم يلمسها المستخدم
const changedFields = (next: Record<string, unknown>, previous: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(next).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(previous[key])));

// جسم رد الدالة حتى مع رمز خطأ (409...)
const readFunctionBody = async (error: unknown, data: unknown): Promise<Record<string, unknown> | null> => {
  if (data && typeof data === "object") return data as Record<string, unknown>;
  const context = (error as { context?: Response } | null)?.context;
  if (context && typeof context.json === "function") {
    try {
      const parsed = await context.clone().json();
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      // ignore
    }
  }
  return null;
};

const readFunctionError = async (error: unknown, data: unknown, fallback = "تعذر إنشاء حساب الدخول") => {
  const body = data as { error?: string } | null;
  if (body?.error) return body.error;
  const context = (error as { context?: Response } | null)?.context;
  if (context && typeof context.json === "function") {
    try {
      const parsed = await context.clone().json();
      if (parsed?.error) return String(parsed.error);
      if (parsed?.message) return String(parsed.message);
    } catch {
      // ignore
    }
  }
  return (error as { message?: string } | null)?.message || fallback;
};

const securePassword = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#$";
  const values = new Uint32Array(12);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => chars[value % chars.length]).join("");
};

type PendingFiles = { photo?: File; docs: Record<string, File> };

// ─── Main EmployeeForm Component ────────────────────────────────────────────
export default function EmployeeForm({
  mode,
  initialData,
  onBack,
  onSaved,
  title,
}: {
  mode: "create" | "edit";
  initialData?: EmpFormData;
  onBack: () => void;
  onSaved: () => void;
  title?: string;
}) {
  const { t, direction } = useI18n();
  const initialRef = useRef<EmpFormData>(initialData ?? emptyForm());
  const [form, setForm] = useState<EmpFormData>(initialRef.current);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [issues, setIssues] = useState<FormIssue[]>([]);
  const [pendingFiles, setPendingFiles] = useState<PendingFiles>({ docs: {} });
  const [showPassword, setShowPassword] = useState(false);
  const [orgDepartments, setOrgDepartments] = useState<DeptOpt[]>([]);
  const [orgSections, setOrgSections] = useState<SectionOpt[]>([]);
  const [orgBranches, setOrgBranches] = useState<BranchOpt[]>([]);
  const [orgWorkLocations, setOrgWorkLocations] = useState<string[]>([]);
  const [orgWorkSchedules, setOrgWorkSchedules] = useState<string[]>([]);
  const [employeeRoles, setEmployeeRoles] = useState<string[]>([]);
  const [jobTitles, setJobTitles] = useState<string[]>([]);
  const [subunits, setSubunits] = useState<string[]>([]);
  const [managerNames, setManagerNames] = useState<string[]>([]);
  // تغيير بريد موظف له بريد مسجّل: مدير النظام فقط، ومن الخادم (يغيّر بريد حساب دخوله معه)
  const [canChangeEmail, setCanChangeEmail] = useState(false);
  const [changingEmail, setChangingEmail] = useState(false);

  useEffect(() => {
    if (mode !== "edit") return;
    let active = true;
    void supabase.rpc("is_main_system_admin").then(({ data, error }) => {
      if (active) setCanChangeEmail(!error && data === true);
    });
    return () => { active = false; };
  }, [mode]);

  useEffect(() => {
    (async () => {
      const [d, s, r, j, b, l, w, dir, su] = await Promise.all([
        supabase.from("departments").select("id, name, branch_id").eq("status", "فعال").order("name"),
        supabase.from("org_sections").select("id, name, department_id, department").order("name"),
        supabase.from("user_roles").select("name_ar").eq("status", "فعال").order("name_ar"),
        supabase.from("hr_jobs").select("name").eq("status", "فعال").order("name"),
        supabase.from("branches").select("id, name").eq("status", "فعال").order("name"),
        supabase.from("hr_work_locations").select("name").eq("status", "فعال").order("name"),
        supabase.from("attendance_schedules").select("name").eq("status", "فعال").order("name"),
        supabase.rpc("list_employee_directory"),
        supabase.from("org_subunits").select("name").order("name"),
      ]);
      setOrgDepartments(
        ((d.data as Record<string, unknown>[]) ?? []).map((x) => ({ id: String(x.id), name: String(x.name ?? ""), branchId: String(x.branch_id ?? "") })),
      );
      setOrgSections(
        ((s.data as Record<string, unknown>[]) ?? []).map((x) => ({
          id: String(x.id),
          name: String(x.name ?? ""),
          departmentId: x.department_id ? String(x.department_id) : "",
          department: String(x.department ?? ""),
        })),
      );
      setEmployeeRoles(
        ((r.data as Record<string, unknown>[]) ?? [])
          .map((x) => String(x.name_ar ?? ""))
          .filter(Boolean),
      );
      const databaseJobs = ((j.data as Record<string, unknown>[]) ?? []).map((x) => String(x.name ?? "")).filter(Boolean);
      const databaseBranches = ((b.data as Record<string, unknown>[]) ?? []).map((x) => ({ id: String(x.id), name: String(x.name ?? "") })).filter((x) => x.id && x.name);
      const databaseLocations = ((l.data as Record<string, unknown>[]) ?? []).map((x) => String(x.name ?? "")).filter(Boolean);
      const databaseSchedules = ((w.data as Record<string, unknown>[]) ?? []).map((x) => String(x.name ?? "")).filter(Boolean);
      setJobTitles(databaseJobs);
      setSubunits(((su.data as Record<string, unknown>[]) ?? []).map((x) => String(x.name ?? "").trim()).filter(Boolean));
      setOrgBranches(databaseBranches);
      setForm((current) => current.branchId || !current.branch
        ? current
        : { ...current, branchId: databaseBranches.find((branch) => branch.name.trim() === current.branch.trim())?.id ?? "" });
      setOrgWorkLocations(databaseLocations);
      setOrgWorkSchedules(databaseSchedules);
      setManagerNames(
        Array.from(new Set(((dir.data as Record<string, unknown>[]) ?? [])
          .map((x) => String(x.name ?? "").trim())
          .filter((name) => name && name !== initialRef.current.name.trim()))),
      );
    })();
  }, []);

  const set = <K extends keyof EmpFormData>(key: K, value: EmpFormData[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const generatePassword = () => {
    set("password", securePassword());
    setShowPassword(true);
  };

  const togglePermission = (perm: string) => {
    set("permissions", form.permissions.includes(perm)
      ? form.permissions.filter((p) => p !== perm)
      : [...form.permissions, perm]);
  };

  // الخادم يقرأ البريد من سجل الموظف نفسه؛ المتصفح يرسل المعرّف وكلمة المرور فقط.
  // حساب قديم بنفس البريد لموظف سابق: يستعيده مدير النظام بعد تأكيده (الحساب يحمل سجل طلبات ذلك الموظف)
  const createLoginAccount = async (adopt = false): Promise<{ ok: boolean; created: boolean; adopted?: boolean; message: string }> => {
    const { data, error } = await supabase.functions.invoke("manage-employee-auth", {
      body: { action: "set-password", employeeId: form.id, password: form.password, ...(adopt ? { adopt: true } : {}) },
    });
    const body = data as { success?: boolean; created?: boolean; adopted?: boolean; error?: string } | null;
    if (error || body?.success !== true) {
      const details = await readFunctionBody(error, data);
      if (!adopt && details?.adoptable === true && confirm(
        `${t(String(details.error ?? ""))}.\n${t("إن كان هو الموظف نفسه وأُعيد تعيينه فاضغط «موافق» لاستعادة حسابه القديم (مع سجل طلباته) بكلمة المرور الجديدة.")}\n${t("إن كان شخصًا آخر فاضغط «إلغاء» واستخدم بريدًا مختلفًا.")}`,
      )) {
        return createLoginAccount(true);
      }
      return { ok: false, created: false, message: await readFunctionError(error, data) };
    }
    return { ok: true, created: Boolean(body.created), adopted: body.adopted === true, message: "" };
  };

  const changeEmail = async () => {
    if (changingEmail || savingRef.current) return;
    const current = initialRef.current.email.trim().toLowerCase();
    const entered = window.prompt(`${t("البريد الجديد للموظف")} (${t("الحالي")}: ${current})`, current);
    if (entered === null) return;
    const next = entered.trim().toLowerCase();
    if (!next || next === current) return;
    if (!EMAIL_PATTERN.test(next)) {
      toast({ title: t("تعذر تغيير البريد"), description: t("البريد الإلكتروني غير صحيح"), variant: "destructive" });
      return;
    }
    if (!confirm(`${t("سيتغيّر بريد الموظف إلى")} ${next}\n${t("وإن كان له حساب دخول فسيدخل بالبريد الجديد بدل القديم. متابعة؟")}`)) return;
    setChangingEmail(true);
    try {
      const { data, error } = await supabase.functions.invoke("manage-employee-auth", {
        body: { action: "change-email", employeeId: form.id, email: next },
      });
      const body = data as { success?: boolean; email?: string; loginUpdated?: boolean } | null;
      if (error || body?.success !== true) {
        toast({ title: t("تعذر تغيير البريد"), description: t(await readFunctionError(error, data, "تعذر تغيير البريد")), variant: "destructive" });
        return;
      }
      const saved = String(body.email ?? next);
      initialRef.current = { ...initialRef.current, email: saved };
      setForm((current) => ({ ...current, email: saved }));
      toast({
        title: t("تم تغيير البريد"),
        description: body.loginUpdated ? `${saved} — ${t("يدخل الموظف بالبريد الجديد")}` : saved,
      });
    } finally {
      setChangingEmail(false);
    }
  };

  const uploadPendingFiles = async (employeeId: string) => {
    const changes: Record<string, unknown> = {};
    const failures: string[] = [];
    if (pendingFiles.photo) {
      try {
        changes.photo_url = await uploadEmployeeFile(employeeId, "photo", pendingFiles.photo);
      } catch {
        failures.push(t("الصورة الشخصية"));
      }
    }
    const docs = { ...form.documents };
    for (const [key, file] of Object.entries(pendingFiles.docs)) {
      try {
        docs[key] = await uploadEmployeeFile(employeeId, `docs/${key}`, file);
        docs[`${key}_name`] = file.name;
      } catch {
        failures.push(t(DOCUMENT_TYPES.find((doc) => doc.key === key)?.label ?? key));
      }
    }
    if (JSON.stringify(docs) !== JSON.stringify(initialRef.current.documents)) changes.documents = docs;
    if (Object.keys(changes).length) {
      const { error } = await supabase.from("employees").update(changes).eq("id", employeeId);
      if (error) failures.push(t("ربط الملفات بسجل الموظف"));
    }
    return failures;
  };

  const handleSave = async () => {
    if (savingRef.current) return;
    const found = validateEmployeeForm(form, mode, initialRef.current);
    setIssues(found);
    if (found.length) {
      setStep(found[0].step);
      toast({
        title: t("أكمل البيانات المطلوبة"),
        description: `${t(found[0].message)}${found.length > 1 ? ` (+${found.length - 1})` : ""}`,
        variant: "destructive",
      });
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const payload = buildEmployeePayload(form);
      // الصورة والمستندات تُرفع بعد الحفظ؛ لا نرسل قيمها هنا
      delete payload.photo_url;
      delete payload.documents;
      let savedEmpId = form.empId;

      if (mode === "create") {
        payload.total_salary = computeTotalSalary(form.baseSalary, form.allowances);
        const { data, error } = await supabase
          .from("employees")
          .insert([{ ...payload, id: form.id }])
          .select("id, emp_id")
          .single();
        if (error) {
          // إعادة المحاولة بعد انقطاع: السجل نفسه (بنفس المعرّف) محفوظ مسبقًا
          const duplicateOfSelf = error.code === "23505" && /employees_pkey/.test(`${error.message} ${error.details ?? ""}`);
          if (!duplicateOfSelf) throw error;
          const { data: existing, error: existingError } = await supabase
            .from("employees").select("id, emp_id").eq("id", form.id).maybeSingle();
          if (existingError || !existing) throw error;
          savedEmpId = String(existing.emp_id ?? "");
          // المحاولة الأولى وصلت؛ نحدّث السجل بقيم هذه المحاولة إن تغيّر شيء
          const { error: retryUpdateError } = await supabase.from("employees").update(payload).eq("id", form.id);
          if (retryUpdateError) throw retryUpdateError;
        } else {
          savedEmpId = String(data?.emp_id ?? "");
        }
      } else {
        const previous = buildEmployeePayload(initialRef.current);
        delete previous.photo_url;
        delete previous.documents;
        const changes = changedFields(payload, previous);
        const total = computeTotalSalary(form.baseSalary, form.allowances);
        if (round2(initialRef.current.totalSalary) !== total) changes.total_salary = total;
        const hasFiles = Boolean(pendingFiles.photo) || Object.keys(pendingFiles.docs).length > 0
          || JSON.stringify(form.documents) !== JSON.stringify(initialRef.current.documents);
        if (!Object.keys(changes).length && !form.password && !hasFiles) {
          toast({ title: t("لا توجد تغييرات للحفظ") });
          return;
        }
        if (Object.keys(changes).length) {
          const { error } = await supabase.from("employees").update(changes).eq("id", form.id).select("id").single();
          if (error) throw error;
        }
      }

      const fileFailures = await uploadPendingFiles(form.id);
      const login = form.password && !INACTIVE_EMPLOYEE_STATUSES.includes(form.status) ? await createLoginAccount() : null;
      // تعطيل الموظف يوقف دخوله، وإعادة تفعيله تعيده
      const wasInactive = INACTIVE_EMPLOYEE_STATUSES.includes(initialRef.current.status);
      const isInactive = INACTIVE_EMPLOYEE_STATUSES.includes(form.status);
      const loginState = mode === "edit" && wasInactive !== isInactive ? await setEmployeeLoginState(form.id, !isInactive) : null;

      toast({
        title: mode === "create" ? t("تم إضافة الموظف") : t("تم تحديث البيانات"),
        description: `${form.name}${savedEmpId ? ` — ${t("الرقم الوظيفي")}: ${savedEmpId}` : ""}${login?.ok ? ` — ${login.created ? t("تم إنشاء حساب الدخول") : login.adopted ? t("تمت استعادة حساب الدخول القديم بكلمة المرور الجديدة") : t("تم تغيير كلمة مرور حساب الدخول")}` : ""}`,
      });
      if (fileFailures.length) {
        toast({ title: t("لم تُرفع بعض الملفات"), description: fileFailures.join("، "), variant: "destructive" });
      }
      if (login && !login.ok) {
        toast({ title: t("حُفظت البيانات لكن لم يُنشأ حساب الدخول"), description: login.message, variant: "destructive" });
      }
      if (loginState && !loginState.ok) {
        toast({
          title: isInactive ? t("عُطّل الموظف لكن لم يُوقف حساب دخوله") : t("فُعّل الموظف لكن لم يُعَد حساب دخوله"),
          description: loginState.message,
          variant: "destructive",
        });
      }
      onSaved();
    } catch (e: unknown) {
      toast({ title: t("خطأ في الحفظ"), description: t(employeeErrorText(e)), variant: "destructive" });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Layout>
      <div dir={direction} className="max-w-6xl mx-auto pb-10">
        {/* Page Title */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-gray-800">
            {title ? t(title) : mode === "create" ? t("إضافة موظف") : t("تعديل موظف")}
            {mode === "edit" && form.empId && <span className="mr-2 font-mono text-sm text-blue-700">{form.empId}</span>}
          </h1>
          <button onClick={onBack} disabled={saving} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 disabled:opacity-40">
            <X className="h-4 w-4" /> {t("إغلاق")}
          </button>
        </div>

        {/* Stepper */}
        <StepperHeader steps={STEPS} current={step} onStepClick={setStep} errorSteps={new Set(issues.map((issue) => issue.step))} />

        {/* Step Content */}
        <div className="bg-white border border-gray-200 rounded-b-xl shadow-sm p-6 mt-0">
          {issues.some((issue) => issue.step === step) && (
            <div className="mb-5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              <ul className="list-disc space-y-1 pr-5">
                {issues.filter((issue) => issue.step === step).map((issue) => <li key={issue.message}>{t(issue.message)}</li>)}
              </ul>
            </div>
          )}
          {step === 0 && (
            <Step1Personal
              form={form}
              set={set}
              mode={mode}
              initialEmail={initialRef.current.email}
              onChangeEmail={canChangeEmail && !saving ? changeEmail : undefined}
              changingEmail={changingEmail}
              pendingPhoto={pendingFiles.photo}
              onPickPhoto={(file) => setPendingFiles((current) => ({ ...current, photo: file }))}
            />
          )}
          {step === 1 && <Step2Job form={form} set={set} departments={orgDepartments} sections={orgSections} jobs={jobTitles} branches={orgBranches} workLocations={orgWorkLocations} workSchedules={orgWorkSchedules} subunits={subunits} managerNames={managerNames} />}
          {step === 2 && <Step3Financial form={form} set={set} />}
          {step === 3 && <Step4Permissions form={form} togglePermission={togglePermission} />}
          {step === 4 && <Step5Insurance form={form} set={set} />}
          {step === 5 && (
            <Step6Documents
              form={form}
              pending={pendingFiles.docs}
              onPick={(key, file) => setPendingFiles((current) => {
                const docs = { ...current.docs };
                if (file) docs[key] = file; else delete docs[key];
                return { ...current, docs };
              })}
              onRemoveSaved={(key) => set("documents", Object.fromEntries(Object.entries(form.documents).filter(([docKey]) => docKey !== key && docKey !== `${key}_name`)))}
            />
          )}
          {step === 6 && <Step7Account form={form} set={set} roles={employeeRoles} mode={mode} showPassword={showPassword} setShowPassword={setShowPassword} generatePassword={generatePassword} />}
          {step === 7 && <Step8Finish saving={saving} onSave={handleSave} issues={issues} onJump={setStep} form={form} />}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="flex items-center gap-1 px-5 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm hover:bg-gray-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronRight className="h-4 w-4" /> {t("السابق")}
          </button>
          <button
            onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
            disabled={step === STEPS.length - 1}
            className="flex items-center gap-1 px-5 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("التالي")} <ChevronLeft className="h-4 w-4" />
          </button>
        </div>
      </div>
    </Layout>
  );
}

// ─── Stepper Header ──────────────────────────────────────────────────────────
function StepperHeader({ steps, current, onStepClick, errorSteps }: { steps: typeof STEPS; current: number; onStepClick: (i: number) => void; errorSteps: Set<number> }) {
  const { t } = useI18n();

  return (
    <div className="bg-white border border-b-0 border-gray-200 rounded-t-xl px-6 py-4">
      <div className="flex items-center justify-between">
        {steps.map((s, i) => (
          <div key={s.id} className="flex items-center flex-1">
            <button
              onClick={() => onStepClick(i)}
              className="flex flex-col items-center gap-1 group"
            >
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all",
                errorSteps.has(i)
                  ? "bg-rose-50 border-rose-500 text-rose-600"
                  : i === current
                    ? "bg-blue-600 border-blue-600 text-white"
                    : i < current
                      ? "bg-blue-100 border-blue-400 text-blue-700"
                      : "bg-white border-gray-300 text-gray-500"
              )}>
                {i + 1}
              </div>
              <span className={cn(
                "text-[10px] text-center leading-tight max-w-[70px] hidden sm:block",
                i === current ? "text-blue-600 font-semibold" : "text-gray-500"
              )}>
                {t(s.label)}
              </span>
            </button>
            {i < steps.length - 1 && (
              <div className={cn(
                "h-0.5 flex-1 mx-1 mb-4",
                i < current ? "bg-blue-400" : "bg-gray-200"
              )} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Step 1: Personal Details ────────────────────────────────────────────────
function Step1Personal({
  form, set, mode, initialEmail, onChangeEmail, changingEmail = false, pendingPhoto, onPickPhoto,
}: {
  form: EmpFormData;
  set: <K extends keyof EmpFormData>(k: K, v: EmpFormData[K]) => void;
  mode: "create" | "edit";
  initialEmail: string;
  onChangeEmail?: () => void;
  changingEmail?: boolean;
  pendingPhoto?: File;
  onPickPhoto: (file: File) => void;
}) {
  const { t } = useI18n();
  const photoInput = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  useEffect(() => {
    if (!pendingPhoto) { setPreviewUrl(""); return; }
    const url = URL.createObjectURL(pendingPhoto);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingPhoto]);
  const emailLocked = mode === "edit" && initialEmail.trim() !== "";

  return (
    <div className="space-y-5">
      {/* Photo Upload */}
      <div className="flex flex-col items-center gap-2 pb-4">
        <div className="w-20 h-20 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden border border-gray-300 text-2xl font-bold text-gray-500">
          {previewUrl ? (
            <img src={previewUrl} alt={t("صورة الموظف")} className="w-full h-full object-cover" />
          ) : form.photoUrl ? (
            <EmployeePhoto value={form.photoUrl} name={form.name} />
          ) : (
            <svg className="w-12 h-12 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
            </svg>
          )}
        </div>
        <input
          ref={photoInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            const problem = validateEmployeeFile(file, true);
            if (problem) {
              toast({ title: t("تعذر اختيار الصورة"), description: t(problem), variant: "destructive" });
              return;
            }
            onPickPhoto(file);
          }}
        />
        <button
          type="button"
          onClick={() => photoInput.current?.click()}
          className="px-4 py-1.5 border border-gray-300 rounded text-sm text-gray-600 hover:bg-gray-50"
        >
          {form.photoUrl || pendingPhoto ? t("تغيير الصورة") : t("صورة")}
        </button>
        {pendingPhoto && <p className="text-xs text-amber-600">{t("ستُرفع الصورة عند الحفظ")}</p>}
      </div>

      {/* Row 1: Names */}
      <div className="grid grid-cols-2 gap-4">
        <FInput label="الاسم كامل عربي *" value={form.name} onChange={(v) => set("name", v)} placeholder="الاسم كامل عربي" />
        <FInput label="الاسم كامل إنجليزي" value={form.firstName} onChange={(v) => set("firstName", v)} placeholder="Full name in English" />
      </div>

      {/* Row 2: Gender / Birthdate */}
      <div className="grid grid-cols-2 gap-4">
        <FSelect label="الجنس *" value={form.gender} onChange={(v) => set("gender", v)} options={GENDERS} placeholder="--" />
        <FInput label="تاريخ الميلاد" value={form.birthDate} onChange={(v) => set("birthDate", v)} type="date" />
      </div>

      {/* Row 3: Email / Phone */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <FInput
            label="البريد الإلكتروني"
            value={form.email}
            onChange={(v) => set("email", v)}
            type="email"
            placeholder="example@email.com"
            disabled={emailLocked}
          />
          <p className="mt-1 text-xs text-gray-400">
            {emailLocked ? t("البريد مرتبط بحساب الدخول؛ تغييره من مدير النظام فقط") : t("مطلوب إذا أردت إنشاء حساب دخول للموظف")}
            {emailLocked && onChangeEmail ? (
              <button
                type="button"
                onClick={onChangeEmail}
                disabled={changingEmail}
                className="mr-2 font-semibold text-blue-600 hover:text-blue-800 disabled:opacity-50"
              >
                {changingEmail ? t("جاري تغيير البريد...") : t("تغيير البريد")}
              </button>
            ) : null}
          </p>
        </div>
        <FInput label="رقم الجوال *" value={form.phone} onChange={(v) => set("phone", v)} placeholder="05xxxxxxxx" />
      </div>

      {/* Row 4: Nationality / Address */}
      <div className="grid grid-cols-2 gap-4">
        <FSelect label="الجنسية *" value={form.nationality} onChange={(v) => set("nationality", v)} options={NATIONALITIES} placeholder="حدد الدولة..." />
        <FInput label="العنوان" value={form.address2} onChange={(v) => set("address2", v)} placeholder="" />
      </div>

      {/* Row 5: Marital / National ID */}
      <div className="grid grid-cols-2 gap-4">
        <FSelect label="الحالة الاجتماعية" value={form.maritalStatus} onChange={(v) => set("maritalStatus", v)} options={MARITAL_STATUSES} placeholder="--" />
        <FInput label="رقم الهوية / الإقامة *" value={form.nationalId} onChange={(v) => set("nationalId", v)} placeholder={isSaudiCompany() ? "1xxxxxxxxx / 2xxxxxxxxx" : ""} />
      </div>

      {/* Row 6: Work Contact Type / ID Expiry */}
      <div className="grid grid-cols-2 gap-4">
        <FSelect label="وسيلة التواصل المفضلة" value={form.workContactType} onChange={(v) => set("workContactType", v)} options={["هاتف", "بريد إلكتروني", "واتساب"]} placeholder="---" />
        <FInput label="تاريخ انتهاء الهوية / الإقامة" value={form.idExpiryDate} onChange={(v) => set("idExpiryDate", v)} type="date" />
      </div>

      {/* Passport */}
      <div className="grid grid-cols-2 gap-4">
        <FInput label="تاريخ انتهاء جواز السفر" value={form.passportExpiryDate} onChange={(v) => set("passportExpiryDate", v)} type="date" />
        <FInput label="رقم جواز السفر" value={form.passportNumber} onChange={(v) => set("passportNumber", v)} placeholder="" />
      </div>

      {/* Work Permit */}
      <div className="grid grid-cols-2 gap-4">
        <FInput label="تاريخ انتهاء رخصة العمل" value={form.residencePermitDate} onChange={(v) => set("residencePermitDate", v)} type="date" />
        <FInput label="رقم رخصة العمل" value={form.workPermitNumber} onChange={(v) => set("workPermitNumber", v)} placeholder="" />
      </div>

      {/* Kafala */}
      <div className="grid grid-cols-2 gap-4">
        <FInput label="تاريخ انتهاء الكفالة" value={form.kafalaExpiryDate} onChange={(v) => set("kafalaExpiryDate", v)} type="date" />
        <FInput label="رقم الكفالة" value={form.kafalaNumber} onChange={(v) => set("kafalaNumber", v)} placeholder="" />
      </div>
    </div>
  );
}

function Step2Job({
  form, set, departments, sections, jobs, branches, workLocations, workSchedules, subunits, managerNames,
}: {
  form: EmpFormData;
  set: <K extends keyof EmpFormData>(k: K, v: EmpFormData[K]) => void;
  departments: DeptOpt[];
  sections: SectionOpt[];
  jobs: string[];
  branches: BranchOpt[];
  workLocations: string[];
  workSchedules: string[];
  subunits: string[];
  managerNames: string[];
}) {
  const { t } = useI18n();
  const availableDepartments = form.branchId
    ? departments.filter((department) => department.branchId === form.branchId || department.id === form.departmentId)
    : departments;
  const availableSections = form.departmentId
    ? sections.filter((s) => s.departmentId === form.departmentId || s.id === form.sectionId)
    : sections;
  const missingDepartment = form.departmentId && !departments.some((d) => d.id === form.departmentId);
  const missingSection = form.sectionId && !sections.some((s) => s.id === form.sectionId);
  const missingBranch = form.branchId && !branches.some((b) => b.id === form.branchId);

  const onBranchChange = (branchId: string) => {
    set("branchId", branchId);
    set("branch", branches.find((branch) => branch.id === branchId)?.name ?? "");
    if (form.departmentId && departments.find((department) => department.id === form.departmentId)?.branchId !== branchId) {
      set("departmentId", "");
      set("directorate", "");
      set("sectionId", "");
      set("department", "");
    }
  };

  const onDirectorateChange = (deptId: string) => {
    set("departmentId", deptId);
    set("directorate", departments.find((d) => d.id === deptId)?.name ?? "");
    set("sectionId", "");
    set("department", "");
  };

  const onSectionChange = (sectionId: string) => {
    set("sectionId", sectionId);
    set("department", sections.find((s) => s.id === sectionId)?.name ?? "");
  };

  return (
    <div className="space-y-5">
      {/* Row 1: Job Title / Division */}
      <div className="grid grid-cols-2 gap-4">
        <FSelect label="المسمى الوظيفي *" value={form.jobTitle} onChange={(v) => set("jobTitle", v)} options={jobs} placeholder={jobs.length ? "--" : "أضف الوظائف من الهيكل التنظيمي"} />
        <FSelect label="الشعبة" value={form.division} onChange={(v) => set("division", v)} options={subunits} placeholder={subunits.length ? "--" : "أضف الشعب من الهيكل التنظيمي"} />
      </div>

      {/* Row 2: Employment Type / Branch */}
      <div className="grid grid-cols-2 gap-4">
        <FSelect label="نوع التوظيف *" value={form.employmentType} onChange={(v) => set("employmentType", v)} options={EMPLOYMENT_TYPES} placeholder="--" />
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t("الفرع")} *</label>
          <select value={form.branchId} onChange={(e) => onBranchChange(e.target.value)} className={inputCls}>
            <option value="">{branches.length ? "--" : t("أضف الفروع من الهيكل التنظيمي")}</option>
            {missingBranch && <option value={form.branchId}>{form.branch || form.branchId} ({t("غير فعال")})</option>}
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        </div>
      </div>

      {/* Status Row */}
      <div className="grid grid-cols-2 gap-4">
        <FSelect label="الحالة *" value={form.status} onChange={(v) => set("status", v)} options={EMPLOYEE_STATUSES} placeholder="--" />
        <FInput label="تاريخ التعيين *" value={form.hireDate} onChange={(v) => set("hireDate", v)} type="date" />
      </div>

      {/* Row 3: Directorate / Department (real FK links) */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t("الإدارة")} *</label>
          <select value={form.departmentId} onChange={(e) => onDirectorateChange(e.target.value)} className={inputCls}>
            <option value="">{availableDepartments.length ? "--" : t("أضف الإدارات من الهيكل التنظيمي")}</option>
            {missingDepartment && <option value={form.departmentId}>{form.directorate || t("إدارة غير فعالة")}</option>}
            {availableDepartments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t("القسم")}</label>
          <select value={form.sectionId} onChange={(e) => onSectionChange(e.target.value)} className={inputCls}>
            <option value="">{availableSections.length ? "--" : t("لا توجد أقسام لهذه الإدارة")}</option>
            {missingSection && <option value={form.sectionId}>{form.department || t("قسم غير موجود")}</option>}
            {availableSections.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Row 4: Work Location / Other Locations */}
      <div className="grid grid-cols-2 gap-4">
        <FSelect label="مكان العمل" value={form.workLocation} onChange={(v) => set("workLocation", v)} options={workLocations} placeholder={workLocations.length ? "--" : "أضف مواقع العمل من الهيكل التنظيمي"} />
        <FInput label="مواقع العمل الأخرى" value={form.otherWorkLocations} onChange={(v) => set("otherWorkLocations", v)} />
      </div>

      {/* Row 5: Direct Manager */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t("المدير المباشر")}</label>
          <input
            list="employee-direct-manager-options"
            value={form.directManager}
            onChange={(e) => set("directManager", e.target.value)}
            placeholder={t("اكتب أو اختر من الموظفين")}
            className={inputCls}
          />
          <datalist id="employee-direct-manager-options">
            {managerNames.map((name) => <option key={name} value={name} />)}
          </datalist>
        </div>
        <FSelect label="فئة الموظف" value={form.employeeCategory} onChange={(v) => set("employeeCategory", v)} options={EMPLOYEE_CATEGORIES} placeholder="--" />
      </div>

      {/* Row 6: Fixed-term contract */}
      <div className="grid grid-cols-2 gap-4 items-end">
        <div className="flex items-center gap-6 h-10">
          <span className="text-sm font-medium text-gray-700">{t("عقد محدد المدة")}</span>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="radio" name="isContractEnd" checked={form.isContractEnd === true} onChange={() => set("isContractEnd", true)} className="accent-blue-600" />
            <span className="text-sm">{t("نعم")}</span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="radio" name="isContractEnd" checked={form.isContractEnd === false} onChange={() => set("isContractEnd", false)} className="accent-blue-600" />
            <span className="text-sm">{t("لا")}</span>
          </label>
        </div>
        {form.isContractEnd ? (
          <FInput label="تاريخ انتهاء العقد *" value={form.contractEndDate} onChange={(v) => set("contractEndDate", v)} type="date" />
        ) : <div />}
      </div>

      {/* Row 7: Work Schedule / Work Time */}
      <div className="grid grid-cols-2 gap-4">
        <FSelect label="جدول العمل" value={form.workSchedule} onChange={(v) => set("workSchedule", v)} options={workSchedules} placeholder={workSchedules.length ? "--" : "أضف فترات الدوام من حساب الدوام"} />
        <FSelect label="وقت العمل" value={form.workTime} onChange={(v) => set("workTime", v)} options={WORK_TIMES} placeholder="--" />
      </div>

      {/* Row 8: Attendance Exempt / Daily Hours */}
      <div className="grid grid-cols-2 gap-4">
        <FSelect label="معفي من الحضور اليومي" value={form.attendanceExempt ? "نعم" : "لا"} onChange={(v) => set("attendanceExempt", v === "نعم")} options={["نعم", "لا"]} />
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t("عدد ساعات اليوم")} *</label>
          <input type="number" value={form.dailyHours} onChange={(e) => set("dailyHours", Number(e.target.value))} min={1} max={24} className={inputCls} />
        </div>
      </div>

      {/* Remote Attendance Radio */}
      <div className="flex items-center gap-4 border rounded-lg p-3 bg-gray-50">
        <span className="text-sm font-medium text-gray-700 flex-1">{t("السماح بتسجيل الحضور من الموقع والتطبيق")}</span>
        <label className="flex items-center gap-1 cursor-pointer">
          <input type="radio" name="allowAttend" checked={form.allowRemoteAttendance} onChange={() => set("allowRemoteAttendance", true)} className="accent-blue-600" />
          <span className="text-sm">{t("نعم")}</span>
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input type="radio" name="allowAttend" checked={!form.allowRemoteAttendance} onChange={() => set("allowRemoteAttendance", false)} className="accent-blue-600" />
          <span className="text-sm">{t("لا")}</span>
        </label>
      </div>

      {/* Remote Upload Radio */}
      <div className="flex items-center gap-4 border rounded-lg p-3 bg-gray-50">
        <span className="text-sm font-medium text-gray-700 flex-1">{t("السماح برفع المرفقات من الموقع والتطبيق")}</span>
        <label className="flex items-center gap-1 cursor-pointer">
          <input type="radio" name="allowUpload" checked={form.allowRemoteUpload} onChange={() => set("allowRemoteUpload", true)} className="accent-blue-600" />
          <span className="text-sm">{t("نعم")}</span>
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input type="radio" name="allowUpload" checked={!form.allowRemoteUpload} onChange={() => set("allowRemoteUpload", false)} className="accent-blue-600" />
          <span className="text-sm">{t("لا")}</span>
        </label>
      </div>

      {/* Annual leave entitlement */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t("أيام الإجازة السنوية حسب العقد")}</label>
          <input type="number" value={form.managementDaysAfter} onChange={(e) => set("managementDaysAfter", Number(e.target.value))} min={0} className={inputCls} />
          <p className="mt-1 text-xs text-gray-400">{t("اتركه 0 لتطبيق نظام العمل: 21 يومًا، و30 يومًا بعد 5 سنوات خدمة")}</p>
        </div>
        <div />
      </div>
    </div>
  );
}

// ─── Step 3: Financial ───────────────────────────────────────────────────────
function Step3Financial({ form, set }: { form: EmpFormData; set: <K extends keyof EmpFormData>(k: K, v: EmpFormData[K]) => void }) {
  const { t } = useI18n();
  const addAllowance = () => {
    const newAllowance: Allowance = { id: crypto.randomUUID(), type: "", amount: 0, from: "", to: "", effect: "مضاف" };
    set("allowances", [...form.allowances, newAllowance]);
  };

  const removeAllowance = (id: string) => set("allowances", form.allowances.filter((a) => a.id !== id));

  const updateAllowance = (id: string, field: keyof Allowance, value: string | number) => {
    set("allowances", form.allowances.map((a) => a.id === id ? { ...a, [field]: value } : a));
  };

  return (
    <div className="space-y-6">
      {/* Base Salary / Currency */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t("الراتب الأساسي *")}</label>
          <input
            type="number"
            value={form.baseSalary}
            onChange={(e) => set("baseSalary", Number(e.target.value))}
            min={0}
            className={inputCls}
            placeholder="0"
          />
        </div>
        <FSelect
          label="العملة"
          value={form.currency || "SAR"}
          onChange={(v) => set("currency", v)}
          options={CURRENCIES}
          labels={CURRENCY_LABELS}
        />
      </div>
      <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm">
        <span className="text-blue-800">{t("إجمالي الراتب الشهري (الأساسي + البدلات السارية اليوم)")}</span>
        <span className="font-bold text-blue-800">{computeTotalSalary(form.baseSalary, form.allowances).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {t("ر.س")}</span>
      </div>

      {/* Allowances Table */}
      <div>
        <div className="bg-blue-600 text-white px-4 py-2 rounded-t-lg flex items-center justify-between">
          <span className="text-sm font-semibold">{t("بدلات")}</span>
          <span className="text-xs opacity-80">{t("النوع، القيمة الشهرية، من، إلى، الأثر")}</span>
        </div>
        <div className="border border-t-0 border-gray-200 rounded-b-lg">
          {form.allowances.map((a) => (
            <div key={a.id} className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 last:border-b-0">
              <button type="button" onClick={() => removeAllowance(a.id)} title={t("حذف البدل")} className="text-red-400 hover:text-red-600 p-0.5">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <select value={a.effect} onChange={(e) => updateAllowance(a.id, "effect", e.target.value)} className="flex-1 border rounded px-2 py-1 text-sm">
                <option value="">{t("الأثر")}</option>
                <option value="مضاف">{t("مضاف")}</option>
                <option value="مخصوم">{t("مخصوم")}</option>
              </select>
              <input type="date" value={a.to} onChange={(e) => updateAllowance(a.id, "to", e.target.value)} title={t("إلى")} aria-label={t("إلى")} className="w-36 border rounded px-2 py-1 text-sm" />
              <input type="date" value={a.from} onChange={(e) => updateAllowance(a.id, "from", e.target.value)} title={t("من")} aria-label={t("من")} className="w-36 border rounded px-2 py-1 text-sm" />
              <input type="number" min={0} value={a.amount} onChange={(e) => updateAllowance(a.id, "amount", Number(e.target.value))} title={t("القيمة الشهرية")} aria-label={t("القيمة الشهرية")} className="w-28 border rounded px-2 py-1 text-sm" placeholder="0" />
              <select value={a.type} onChange={(e) => updateAllowance(a.id, "type", e.target.value)} className="w-32 border rounded px-2 py-1 text-sm">
                <option value="">{t("نوع البدل")}</option>
                {a.type && !ALLOWANCE_TYPES.includes(a.type) && <option value={a.type}>{a.type}</option>}
                {ALLOWANCE_TYPES.map((type) => <option key={type} value={type}>{t(type)}</option>)}
              </select>
            </div>
          ))}
          <div className="px-3 py-2">
            <button type="button" onClick={addAllowance} className="flex items-center gap-1 text-blue-600 text-sm hover:text-blue-700">
              <Plus className="h-4 w-4" /> {t("إضافة بدل")}
            </button>
          </div>
        </div>
      </div>

      {/* Insurance Info: التأمينات الاجتماعية السعودية لمنشآت السعودية فقط (S14) */}
      {isSaudiCompany() ? (
      <div>
        <h3 className="text-sm font-semibold text-gray-800 mb-3">{t("معلومات التأمين")}</h3>
        <div className="space-y-4">
          <div className="flex items-center gap-6">
            <span className="text-sm font-medium text-gray-700">{t("التأمينات الاجتماعية *")}</span>
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="radio" name="socialInsurance" checked={form.socialInsurance === "نعم"} onChange={() => set("socialInsurance", "نعم")} className="accent-blue-600" />
              <span className="text-sm">{t("نعم")}</span>
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="radio" name="socialInsurance" checked={form.socialInsurance === "لا"} onChange={() => set("socialInsurance", "لا")} className="accent-blue-600" />
              <span className="text-sm">{t("لا")}</span>
            </label>
          </div>
          {form.socialInsurance === "لا" && form.nationality.trim() !== "" && (
            <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
              {t(isSaudiNationality(form.nationality)
                ? "الموظف السعودي في القطاع الخاص مشمول إلزاميًا بالتأمينات (المعاشات والأخطار المهنية وساند)؛ اختر «لا» لحالة مستثناة نظامًا فقط. مع «لا» لا تُخصم حصته ولا تُحسب حصة المنشأة ما دام إعداد «اتباع حقل التأمينات» مفعّلًا (الافتراضي)، وإن أُطفئ يُخصم منه كأنه مشمول"
                : isGccNationality(form.nationality)
                  ? "مواطن دول مجلس التعاون مشمول بمد الحماية التأمينية وفق نظام بلده (يُسدَّد عبر التأمينات)؛ اختر «لا» لحالة مستثناة فقط. مع «لا» لا تُحسب له حصة"
                  : "غير السعودي مشمول إلزاميًا بفرع الأخطار المهنية (2% على المنشأة، لا يُخصم من راتبه)؛ اختر «لا» لحالة مستثناة نظامًا فقط. مع «لا» لا تُحسب حصة المنشأة")}
            </p>
          )}
          {form.socialInsurance === "" && isSaudiNationality(form.nationality) && (
            <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
              {t("التأمينات الاجتماعية غير محددة في ملف الموظف؛ اختر نعم أو لا. مسير الرواتب يخصم حصة الموظف من كل سعودي ما لم يُفعَّل إعداد «اتباع حقل التأمينات» في إعدادات حساب الراتب")}
            </p>
          )}
          {form.socialInsurance === "نعم" && (
            <div className="bg-blue-50 rounded-lg p-4 space-y-4 border border-blue-200">
              <FSelect label="نوع التأمين *" value={form.socialInsuranceType} onChange={(v) => set("socialInsuranceType", v)} options={gosiTypesFor(form.nationality)} placeholder="اختر نوع التأمين" />
              {form.socialInsuranceType === GOSI_TYPE_GCC && (
                <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">{t("اشتراك مواطن دول المجلس بنسب نظام بلده (مد الحماية التأمينية). مسير الرواتب لا يحسب نسب بلده بعد، ويحسب له 2% الأخطار المهنية على المنشأة فقط: أضف حصة الموظف بدلًا مخصومًا في بياناته المالية، وقيّد بقية حصة المنشأة بقيد يدوي")}</p>
              )}
              {form.socialInsuranceType && !gosiTypesFor(form.nationality).includes(form.socialInsuranceType) && (
                <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">{t("نوع التأمين المسجّل لا يناسب جنسية الموظف؛ اختر النوع الصحيح")}</p>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("تاريخ الاشتراك (ميلادي) *")}</label>
                <input
                  type="date"
                  value={form.socialInsuranceStartDate}
                  onChange={(e) => set("socialInsuranceStartDate", e.target.value)}
                  className={inputCls}
                />
                {form.socialInsuranceStartDate && (
                  <p className="text-xs text-gray-500 mt-1">
                    {t("التاريخ بالهجري")}: {
                      (() => {
                        try {
                          const d = new Date(form.socialInsuranceStartDate);
                          return d.toLocaleDateString("ar-SA-u-ca-islamic", { year: "numeric", month: "long", day: "numeric" });
                        } catch { return ""; }
                      })()
                    }
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      ) : null}

      {/* Bank Info */}
      <div>
        <h3 className="text-sm font-semibold text-gray-800 mb-3">{t("معلومات البنك")}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FInput label="اسم الحساب البنكي" value={form.bankName} onChange={(v) => set("bankName", v)} />
          <FInput label="اسم الفرع" value={form.bankBranch} onChange={(v) => set("bankBranch", v)} />
          <FInput label="رقم الحساب" value={form.bankAccount} onChange={(v) => set("bankAccount", v)} />
          <FInput label="رقم الآيبان" value={form.iban} onChange={(v) => set("iban", v.toUpperCase().replace(/\s/g, ""))} placeholder={isSaudiCompany() ? "SA0000000000000000000000" : ""} />
        </div>
      </div>
    </div>
  );
}

// ─── Step 4: Permissions ─────────────────────────────────────────────────────
function Step4Permissions({ form, togglePermission }: { form: EmpFormData; togglePermission: (p: string) => void }) {
  const { t } = useI18n();

  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-xs text-blue-800">
        {form.permissions.length
          ? `${t("يظهر للموظف في بوابته هذه الطلبات فقط")}: ${form.permissions.length}`
          : t("لم يُحدَّد أي نوع: تظهر للموظف في بوابته كل أنواع الطلبات")}
      </p>
      <div className="grid grid-cols-5 gap-4">
        {PERMISSIONS_COLUMNS.map((col, ci) => (
          <div key={ci} className="space-y-2">
            {col.map((perm) => (
              <label key={perm} className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={form.permissions.includes(perm)}
                  onChange={() => togglePermission(perm)}
                  className="rounded border-gray-300 accent-blue-600"
                />
                <span className="text-sm text-gray-700 group-hover:text-blue-600">{t(perm)}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Step 5: Insurance ───────────────────────────────────────────────────────
function Step5Insurance({ form, set }: { form: EmpFormData; set: <K extends keyof EmpFormData>(k: K, v: EmpFormData[K]) => void }) {
  const { t } = useI18n();
  const addItem = () => {
    const newItem: InsuranceItem = { id: crypto.randomUUID(), type: "", value: "", notes: "" };
    set("insuranceItems", [...form.insuranceItems, newItem]);
  };
  const removeItem = (id: string) => set("insuranceItems", form.insuranceItems.filter((i) => i.id !== id));
  const updateItem = (id: string, field: keyof InsuranceItem, value: string) => {
    set("insuranceItems", form.insuranceItems.map((i) => i.id === id ? { ...i, [field]: value } : i));
  };

  return (
    <div className="space-y-4">
      {form.insuranceItems.map((item) => (
        <div key={item.id} className="flex items-center gap-3 border rounded-lg p-3">
          <button onClick={() => removeItem(item.id)} className="text-red-400 hover:text-red-600">
            <Trash2 className="h-4 w-4" />
          </button>
          <input value={item.type} onChange={(e) => updateItem(item.id, "type", e.target.value)} placeholder={t("نوع التأمين")} className={cn(inputCls, "flex-1")} />
          <input value={item.value} onChange={(e) => updateItem(item.id, "value", e.target.value)} placeholder={t("القيمة")} className={cn(inputCls, "flex-1")} />
          <input value={item.notes} onChange={(e) => updateItem(item.id, "notes", e.target.value)} placeholder={t("ملاحظات")} className={cn(inputCls, "flex-1")} />
        </div>
      ))}
      <button
        onClick={addItem}
        className="flex items-center gap-2 px-4 py-2 border border-dashed border-blue-400 rounded-lg text-blue-600 hover:bg-blue-50 text-sm"
      >
        <Plus className="h-4 w-4" />
        {t("إضافة")}
      </button>
    </div>
  );
}

// ─── Step 6: Documents ───────────────────────────────────────────────────────
function Step6Documents({
  form, pending, onPick, onRemoveSaved,
}: {
  form: EmpFormData;
  pending: Record<string, File>;
  onPick: (key: string, file: File | null) => void;
  onRemoveSaved: (key: string) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">{t("صور JPG/PNG/WEBP أو PDF، بحد أقصى 5 ميجابايت للملف. تُرفع الملفات عند الحفظ.")}</p>
      <div className="grid grid-cols-2 gap-5">
        {DOCUMENT_TYPES.map((doc) => {
          const saved = form.documents[doc.key] ?? "";
          const savedName = form.documents[`${doc.key}_name`] || employeeFileName(saved);
          const waiting = pending[doc.key];
          return (
            <div key={doc.key}>
              <label className="block text-sm font-medium text-gray-700 mb-2">{t(doc.label)}</label>
              <label className="flex items-center gap-2 px-3 py-2.5 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 text-sm text-gray-600">
                <Upload className="h-4 w-4 text-blue-500" />
                {waiting ? (
                  <span className="text-amber-600 truncate text-xs">{waiting.name} — {t("سيُرفع عند الحفظ")}</span>
                ) : saved ? (
                  <span className="text-blue-600 truncate text-xs">{t("استبدال")}: {savedName}</span>
                ) : (
                  <span>{t("اختر الملف")}</span>
                )}
                <input
                  type="file"
                  accept={EMPLOYEE_FILE_ACCEPT}
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    const problem = validateEmployeeFile(file);
                    if (problem) {
                      toast({ title: t("تعذر اختيار الملف"), description: t(problem), variant: "destructive" });
                      return;
                    }
                    onPick(doc.key, file);
                  }}
                />
              </label>
              <div className="mt-1 flex items-center gap-3 text-xs">
                {saved && isEmployeeStoragePath(saved) && (
                  <button
                    type="button"
                    className="flex items-center gap-1 text-blue-600 hover:underline"
                    onClick={async () => {
                      const opened = await openEmployeeFile(saved);
                      if (!opened) toast({ title: t("تعذر فتح الملف"), variant: "destructive" });
                    }}
                  >
                    <FileText className="h-3.5 w-3.5" /> {t("عرض")}
                  </button>
                )}
                {saved && !isEmployeeStoragePath(saved) && (
                  <span className="text-amber-600">{t("اسم ملف قديم بلا ملف مرفوع؛ ارفع الملف من جديد")}</span>
                )}
                {waiting && (
                  <button type="button" className="text-gray-500 hover:underline" onClick={() => onPick(doc.key, null)}>{t("إلغاء الاختيار")}</button>
                )}
                {saved && !waiting && (
                  <button type="button" className="text-rose-600 hover:underline" onClick={() => onRemoveSaved(doc.key)}>{t("إزالة")}</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Step 7: Account Info ────────────────────────────────────────────────────
function Step7Account({
  form, set, roles, mode, showPassword, setShowPassword, generatePassword,
}: {
  form: EmpFormData;
  set: <K extends keyof EmpFormData>(k: K, v: EmpFormData[K]) => void;
  roles: string[];
  mode: "create" | "edit";
  showPassword: boolean;
  setShowPassword: (v: boolean) => void;
  generatePassword: () => void;
}) {
  const { t } = useI18n();

  return (
    <div className="space-y-5">
      {/* Employee number / alternative number */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t("الرقم الوظيفي")}</label>
          <input value={form.empId || t("يُولَّد تلقائيًا عند الحفظ")} readOnly disabled className={cn(inputCls, "bg-gray-50 font-mono text-gray-600")} />
        </div>
        <div>
          <FInput label="رقم وظيفي بديل (اختياري)" value={form.accountTitle} onChange={(v) => set("accountTitle", v)} placeholder="مثال: 0300" />
          <p className="mt-1 text-xs text-gray-400">{t("يظهر في القوائم ويُبحث به، ولا يغني عن الرقم الوظيفي في الدخول")}</p>
        </div>
      </div>

      {/* Password */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t("كلمة مرور حساب الدخول")}
          {mode === "edit" && <span className="text-xs text-amber-600 mr-2">({t("اتركها فارغة إذا لم تريد تغييرها")})</span>}
        </label>
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <input
              type={showPassword ? "text" : "password"}
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              className={cn(inputCls, "pl-10")}
              autoComplete="new-password"
              placeholder={mode === "edit" ? t("اتركها فارغة للإبقاء على كلمة المرور الحالية") : t("اتركها فارغة إذا لم يحتج الموظف دخولًا")}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              title={showPassword ? t("إخفاء") : t("إظهار")}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <button
            type="button"
            onClick={generatePassword}
            className="flex items-center gap-1 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition"
            title={t("توليد تلقائي")}
          >
            <RefreshCw className="h-4 w-4" />
            {t("توليد تلقائي")}
          </button>
        </div>
        {form.password && (
          <p className={cn("text-xs mt-1", form.email.trim() ? "text-emerald-600" : "text-rose-600")}>
            {form.email.trim()
              ? `${t("سيُنشأ أو يُحدَّث حساب الدخول للبريد")} ${form.email.trim().toLowerCase()} ${t("عند الحفظ. احفظ كلمة المرور وسلّمها للموظف.")}`
              : t("أضف البريد الإلكتروني في الخطوة الأولى؛ حساب الدخول يحتاج بريدًا")}
          </p>
        )}
      </div>

      {/* Employee Role */}
      <div className="grid grid-cols-2 gap-4">
        <FSelect label="صلاحية الموظف (الدور) *" value={form.employeeRole} onChange={(v) => set("employeeRole", v)} options={roles} placeholder="--" />
        <div />
      </div>
      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
        <p className="text-xs text-blue-800 font-medium mb-1">{t("بيانات الدخول للموظف:")}</p>
        <p className="text-xs text-blue-700">{t("الرقم الوظيفي")}: <span className="font-mono font-bold">{form.empId || t("يظهر بعد الحفظ")}</span></p>
        <p className="text-xs text-blue-700 mt-0.5">{t("يدخل الموظف بوابة الموظفين بالرقم الوظيفي وكلمة المرور، ويدخل النظام ببريده وكلمة المرور حسب دوره.")}</p>
      </div>
    </div>
  );
}

// ─── Step 8: Finish ──────────────────────────────────────────────────────────
function Step8Finish({
  saving, onSave, issues, onJump, form,
}: {
  saving: boolean;
  onSave: () => void;
  issues: FormIssue[];
  onJump: (step: number) => void;
  form: EmpFormData;
}) {
  const { t } = useI18n();
  const total = computeTotalSalary(form.baseSalary, form.allowances);

  return (
    <div className="flex flex-col items-center justify-center py-10 gap-6">
      <div className="w-full max-w-xl rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
        <div className="grid grid-cols-2 gap-y-2">
          <span className="text-gray-500">{t("الاسم")}</span><span className="font-medium">{form.name || "—"}</span>
          <span className="text-gray-500">{t("المسمى الوظيفي")}</span><span className="font-medium">{form.jobTitle || "—"}</span>
          <span className="text-gray-500">{t("الإدارة / القسم")}</span><span className="font-medium">{[form.directorate, form.department].filter(Boolean).join(" / ") || "—"}</span>
          <span className="text-gray-500">{t("تاريخ التعيين")}</span><span className="font-medium">{form.hireDate || "—"}</span>
          <span className="text-gray-500">{t("إجمالي الراتب الشهري")}</span><span className="font-medium">{total.toLocaleString("en-US", { minimumFractionDigits: 2 })} {t("ر.س")}</span>
          <span className="text-gray-500">{t("حساب الدخول")}</span><span className="font-medium">{form.password ? t("سيُنشأ / يُحدَّث") : t("بلا تغيير")}</span>
        </div>
      </div>
      {issues.length > 0 && (
        <div className="w-full max-w-xl rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          <p className="mb-2 font-semibold">{t("أكمل البيانات التالية قبل الحفظ")}:</p>
          <ul className="space-y-1">
            {issues.map((issue) => (
              <li key={`${issue.step}-${issue.message}`}>
                <button type="button" className="text-right hover:underline" onClick={() => onJump(issue.step)}>
                  {t(STEPS[issue.step]?.label ?? "")}: {t(issue.message)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="text-center text-gray-500 text-sm">
        {t("تأكد من صحة جميع البيانات قبل الحفظ")}
      </div>
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="flex items-center gap-2 px-10 py-3 bg-blue-600 text-white rounded-lg text-base font-semibold hover:bg-blue-700 transition disabled:opacity-50"
      >
        <Save className="h-5 w-5" />
        {saving ? t("جاري الحفظ...") : t("حفظ")}
      </button>
    </div>
  );
}

// ─── Shared Field Helpers ────────────────────────────────────────────────────
const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-400 outline-none bg-white disabled:bg-gray-50 disabled:text-gray-500";

function FInput({ label, value, onChange, placeholder, type = "text", disabled = false }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
}) {
  const { t } = useI18n();

  return (
    <div>
      {label && <label className="block text-sm font-medium text-gray-700 mb-1">{t(label)}</label>}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ? t(placeholder) : undefined}
        disabled={disabled}
        className={inputCls}
      />
    </div>
  );
}

// القيمة المحفوظة تظهر دائمًا حتى لو لم تعد ضمن القائمة، فلا يظن المستخدم أن الحقل فارغ
function FSelect({ label, value, onChange, options, placeholder, labels }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  labels?: Record<string, string>;
}) {
  const { t } = useI18n();
  const showCurrent = value !== "" && !options.includes(value);

  return (
    <div>
      {label && <label className="block text-sm font-medium text-gray-700 mb-1">{t(label)}</label>}
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
        {placeholder && <option value="">{t(placeholder)}</option>}
        {showCurrent && <option value={value}>{t(labels?.[value] ?? value)}</option>}
        {options.map((o) => <option key={o} value={o}>{t(labels?.[o] ?? o)}</option>)}
      </select>
    </div>
  );
}
