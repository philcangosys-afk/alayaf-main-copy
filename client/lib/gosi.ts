import { isSaudiNationality } from "@/lib/hrStatus";

// التأمينات الاجتماعية (GOSI): مصدر واحد لمسير الرواتب وصفحة التأمينات.
// أجر الاشتراك = الأساسي + بدل السكن، بحد أعلى 45,000 ريال.
// السعودي (النظام السابق، أول تسجيل قبل 3 يوليو 2024): الموظف 9.75% (معاشات 9% + ساند 0.75%)،
//   والمنشأة 11.75% (معاشات 9% + أخطار مهنية 2% + ساند 0.75%).
// السعودي (النظام الجديد، أول تسجيل في التأمينات من 3 يوليو 2024): نسبة المعاشات على كل طرف
//   9% ثم ترتفع 0.5% كل 1 يوليو من 2025 حتى 11% في 2028؛ ساند والأخطار كما هي.
// غير السعودي: لا شيء على الموظف، وعلى المنشأة 2% (الأخطار المهنية).
// "سعودي غير قابل للخصم": لا يُخصم من الموظف وتتحمل المنشأة الحصتين. وغير المشمول (social_insurance = لا): لا اشتراك.
export const GOSI_EMPLOYEE_RATE_SAUDI = 0.0975;
export const GOSI_EMPLOYER_RATE_SAUDI = 0.1175;
export const GOSI_EMPLOYER_RATE_NON_SAUDI = 0.02;
export const GOSI_WAGE_CAP = 45000;
const SANED_RATE = 0.0075;
const HAZARDS_RATE = 0.02;

/** أنواع التأمين في ملف الموظف */
export const GOSI_TYPE_DEDUCTIBLE = "سعودي قابل للخصم";
export const GOSI_TYPE_NEW_SYSTEM = "سعودي قابل للخصم (النظام الجديد)";
export const GOSI_TYPE_NOT_DEDUCTIBLE = "سعودي غير قابل للخصم";
export const GOSI_INSURANCE_TYPES = [GOSI_TYPE_DEDUCTIBLE, GOSI_TYPE_NEW_SYSTEM, GOSI_TYPE_NOT_DEDUCTIBLE];

const round2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100;
const clean = (value: unknown) => String(value ?? "").trim();

/** بدل السكن: البدل المضاف الذي في نوعه "سكن" أو "إسكان" */
export const isHousingAllowance = (type: unknown) => /سكن|إسكان|اسكان|housing/i.test(clean(type));

export const gosiContributionWage = (basic: number, housing: number) =>
  round2(Math.min(GOSI_WAGE_CAP, Math.max(0, Number(basic) || 0) + Math.max(0, Number(housing) || 0)));

/** غير مشمول صراحة بالتأمينات */
export const gosiExcluded = (socialInsurance: unknown) => ["لا", "غير مشمول"].includes(clean(socialInsurance));

/** نسبة المعاشات لكل طرف في النظام الجديد في شهر "YYYY-MM" (تسري الزيادة من 1 يوليو) */
export const newSystemPensionRate = (month: string) => {
  const key = clean(month).slice(0, 7);
  if (key >= "2028-07") return 0.11;
  if (key >= "2027-07") return 0.105;
  if (key >= "2026-07") return 0.1;
  if (key >= "2025-07") return 0.095;
  return 0.09;
};

/** نسبتا الموظف والمنشأة للسعودي القابل للخصم حسب نظامه والشهر */
export const gosiSaudiRates = (insuranceType: unknown, month: string) => {
  if (clean(insuranceType) !== GOSI_TYPE_NEW_SYSTEM) return { employee: GOSI_EMPLOYEE_RATE_SAUDI, employer: GOSI_EMPLOYER_RATE_SAUDI };
  const pension = newSystemPensionRate(month);
  return { employee: round4(pension + SANED_RATE), employer: round4(pension + HAZARDS_RATE + SANED_RATE) };
};
function round4(value: number) {
  return Math.round(value * 10000) / 10000;
}

/**
 * يُخصم من راتب الموظف: سعودي، ونوعه ليس "غير قابل للخصم"، وغير مستثنى.
 * followFlag (إعداد الرواتب "اتباع حقل التأمينات في ملف الموظف"): إن كان مطفأً (الافتراضي) يُخصم من كل سعودي
 * كما كان قبل HR-7، لأن حقل "لا" كان يُحفظ تلقائيًا من نموذج الموظف؛ وإن كان مفعّلًا فالمسجّل "لا" لا يُخصم منه.
 */
export const gosiDeductsFromEmployee = (nationality: unknown, socialInsurance: unknown, insuranceType: unknown, followFlag = false) =>
  isSaudiNationality(nationality)
  && !(followFlag && gosiExcluded(socialInsurance))
  && clean(insuranceType) !== GOSI_TYPE_NOT_DEDUCTIBLE;

export type GosiShares = { wage: number; employee: number; employer: number; total: number; employeeRate: number; employerRate: number; excluded: boolean };

export const gosiShares = (input: { nationality: unknown; socialInsurance: unknown; insuranceType: unknown; basic: number; housing: number; month: string; followFlag?: boolean }): GosiShares => {
  const wage = gosiContributionWage(input.basic, input.housing);
  const saudi = isSaudiNationality(input.nationality);
  // غير المشمول صراحة: للسعودي يتبع الإعداد، ولغير السعودي يُحترم دائمًا (لا خصم عليه من راتبه في الحالتين)
  if (gosiExcluded(input.socialInsurance) && (!saudi || input.followFlag)) {
    return { wage, employee: 0, employer: 0, total: 0, employeeRate: 0, employerRate: 0, excluded: true };
  }
  if (!saudi) {
    const employer = round2(wage * GOSI_EMPLOYER_RATE_NON_SAUDI);
    return { wage, employee: 0, employer, total: employer, employeeRate: 0, employerRate: GOSI_EMPLOYER_RATE_NON_SAUDI, excluded: false };
  }
  const rates = gosiSaudiRates(input.insuranceType, input.month);
  const deducts = gosiDeductsFromEmployee(input.nationality, input.socialInsurance, input.insuranceType, input.followFlag);
  const employeeRate = deducts ? rates.employee : 0;
  const employerRate = deducts ? rates.employer : round4(rates.employer + rates.employee);
  const employee = round2(wage * employeeRate);
  const employer = round2(wage * employerRate);
  return { wage, employee, employer, total: round2(employee + employer), employeeRate, employerRate, excluded: false };
};
