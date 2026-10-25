/**
 * استيراد الموظفين من إكسل: الاسم، والهوية، والجوال، والجنسية، والجنس، والراتب الأساسي، والمسمى (اختياري).
 * بيانات العمل المشتركة (الفرع والإدارة والمسمى الافتراضي ونوع التوظيف وتاريخ التعيين والدور) تُختار مرة لكل الصفوف.
 * السجل يُبنى بدالة نموذج الموظف نفسها (buildEmployeePayload مع قيمه الافتراضية) ويُدرج كما في «إضافة موظف»،
 * والرقم الوظيفي يولّده الخادم. البدلات والتأمينات وحساب الدخول تُكمَل من ملف كل موظف.
 */
import { supabase } from "@/lib/supabaseClient";
import { selectAllRows } from "@/lib/ledgerData";
import { isSaudiCompany } from "@/lib/companyProfile";
import { employeeErrorText } from "@/components/hr/employeeErrors";
import { alreadySaved, cleanCell, cleanText, normalizeKey, normalizePhone, parseAmount, pickOption, type ImportSpec, type Translate } from "@/lib/dataImport";
import type { Allowance, EmpFormData } from "@/pages/EmployeeForm";

export type EmployeeFormModule = {
  emptyForm: () => EmpFormData;
  buildEmployeePayload: (form: EmpFormData) => Record<string, unknown>;
  computeTotalSalary: (baseSalary: number, allowances: Allowance[]) => number;
  NATIONALITIES: string[];
  GENDERS: string[];
  EMPLOYMENT_TYPES: string[];
};

export type EmployeeImportSettings = {
  branchId: string;
  branchName: string;
  departmentId: string;
  departmentName: string;
  jobTitle: string;
  employmentType: string;
  hireDate: string;
  role: string;
};

type EmployeeValue = Record<string, unknown>;
type EmployeeContext = { ids: Map<string, string> };

/** أسماء شائعة للجنسيات في الملفات المصدّرة (الصفة والاسم الإنجليزي) */
const NATIONALITY_ALIASES: Record<string, string[]> = {
  "المملكة العربية السعودية": ["السعودية", "سعودي", "سعودية", "saudi", "saudi arabia", "ksa", "sa"],
  "الإمارات العربية المتحدة": ["الامارات", "إماراتي", "uae", "emirates", "emirati"],
  "البحرين": ["بحريني", "bahrain", "bahraini"],
  "الكويت": ["كويتي", "kuwait", "kuwaiti"],
  "عُمان": ["عمان", "عماني", "oman", "omani"],
  "قطر": ["قطري", "qatar", "qatari"],
  "مصر": ["مصري", "مصرية", "egypt", "egyptian"],
  "السودان": ["سوداني", "سودانية", "sudan", "sudanese"],
  "اليمن": ["يمني", "يمنية", "yemen", "yemeni"],
  "الأردن": ["أردني", "اردني", "jordan", "jordanian"],
  "سوريا": ["سوري", "سورية", "syria", "syrian"],
  "لبنان": ["لبناني", "lebanon", "lebanese"],
  "فلسطين": ["فلسطيني", "palestine", "palestinian"],
  "العراق": ["عراقي", "iraq", "iraqi"],
  "تونس": ["تونسي", "tunisia", "tunisian"],
  "المغرب": ["مغربي", "morocco", "moroccan"],
  "الجزائر": ["جزائري", "algeria", "algerian"],
  "الهند": ["هندي", "هندية", "india", "indian"],
  "باكستان": ["باكستاني", "pakistan", "pakistani"],
  "بنغلاديش": ["بنجلاديش", "بنجلاديشي", "بنغالي", "bangladesh", "bangladeshi"],
  "سريلانكا": ["سريلانكي", "sri lanka", "sri lankan"],
  "نيبال": ["نيبالي", "nepal", "nepali", "nepalese"],
  "أفغانستان": ["أفغاني", "افغاني", "afghanistan", "afghan"],
  "الفلبين": ["الفيلبين", "فلبيني", "فلبينية", "philippines", "filipino", "filipina"],
  "إندونيسيا": ["اندونيسيا", "إندونيسي", "اندونيسي", "indonesia", "indonesian"],
  "ميانمار": ["بورما", "myanmar", "burma"],
  "إثيوبيا": ["اثيوبيا", "إثيوبي", "اثيوبي", "ethiopia", "ethiopian"],
  "إريتريا": ["اريتريا", "إريتري", "ارتيري", "eritrea", "eritrean"],
  "كينيا": ["كيني", "kenya", "kenyan"],
  "أوغندا": ["اوغندا", "أوغندي", "uganda", "ugandan"],
  "نيجيريا": ["نيجيري", "nigeria", "nigerian"],
  "الصومال": ["صومالي", "somalia", "somali"],
  "تركيا": ["تركي", "turkey", "turkish", "türkiye"],
  "الولايات المتحدة": ["أمريكي", "امريكي", "usa", "united states", "american"],
  "المملكة المتحدة": ["بريطاني", "uk", "united kingdom", "british", "england"],
};

const GENDER_ALIASES: Record<string, string[]> = {
  "ذكر": ["ذ", "رجل", "male", "m", "man"],
  "أنثى": ["انثي", "أ", "امرأة", "امراة", "female", "f", "woman"],
};

export function employeesImportSpec(
  lists: EmployeeFormModule,
  jobs: string[],
  settings: EmployeeImportSettings,
  t: Translate,
): ImportSpec<EmployeeValue, EmployeeContext> {
  const nationalityOptions = lists.NATIONALITIES.map((value) => ({ value, labels: [t(value), ...(NATIONALITY_ALIASES[value] ?? [])] }));
  const genderOptions = lists.GENDERS.map((value) => ({ value, labels: [t(value), ...(GENDER_ALIASES[value] ?? [])] }));
  const jobOptions = jobs.map((value) => ({ value, labels: [t(value)] }));
  const saudiCompany = isSaudiCompany();
  // الراتب الأساسي مطلوب أكبر من صفر إلا للمتعاون (كما في نموذج الموظف)
  const salaryRequired = settings.employmentType !== "متعاون";

  return {
    id: "employees",
    title: "الموظفون",
    fileName: "قالب استيراد الموظفين",
    columns: [
      {
        key: "name", label: "الاسم", required: true, width: 32, hint: "الاسم الكامل بالعربي", example: "محمد أحمد علي",
        aliases: ["اسم الموظف", "الاسم الكامل", "الموظف", "name", "employee name", "full name", "employee"],
      },
      {
        key: "nationalId", label: "رقم الهوية أو الإقامة", required: true, kind: "text",
        hint: saudiCompany ? "10 أرقام يبدأ بـ 1 أو 2 أو 3 أو 4، ولا يتكرر" : "من 4 إلى 30 حرفًا لاتينيًا أو رقمًا، ولا يتكرر", example: "2123456789",
        aliases: ["رقم الهوية", "الهوية", "رقم الإقامة", "الإقامة", "رقم الهوية / الإقامة", "national id", "id number", "iqama", "iqama number", "id"],
      },
      {
        key: "phone", label: "الجوال", required: true, kind: "text", hint: "05xxxxxxxx أو رقم دولي، ويُقبل بلا صفر البداية", example: "0501234567",
        aliases: ["رقم الجوال", "الهاتف", "رقم الهاتف", "جوال", "phone", "mobile", "mobile number", "phone number"],
      },
      {
        key: "nationality", label: "الجنسية", required: true, options: lists.NATIONALITIES, dataOptions: true, width: 26,
        hint: "من قائمة الجنسيات في القالب (تُقبل الصيغ الشائعة مثل سعودي أو Indian)", example: "الهند",
        aliases: ["nationality", "country"],
      },
      {
        key: "gender", label: "الجنس", required: true, options: lists.GENDERS, hint: "ذكر أو أنثى", example: "ذكر",
        aliases: ["النوع", "gender", "sex"],
      },
      {
        key: "salary", label: "الراتب الأساسي", required: salaryRequired, kind: "number",
        hint: "شهريًا قبل البدلات، أكبر من صفر؛ يُترك فارغًا للمتعاون فقط", example: "5000",
        aliases: ["الراتب", "الأساسي", "راتب أساسي", "salary", "basic salary", "base salary", "basic"],
      },
      {
        key: "jobTitle", label: "المسمى الوظيفي", options: jobs, dataOptions: true, width: 26,
        hint: "اختياري: مسمى موجود في الهيكل التنظيمي؛ الفارغ يأخذ المسمى المختار في النافذة", example: jobs[0] ?? "محاسب",
        aliases: ["الوظيفة", "المسمى", "المهنة", "job", "job title", "position", "designation", "title"],
      },
    ],
    notes: [
      "الفرع والإدارة ونوع التوظيف وتاريخ التعيين والدور تُختار في نافذة الاستيراد لكل الصفوف.",
      "البدلات والتأمينات والبريد وحساب الدخول تُكمَل من ملف كل موظف بعد الاستيراد.",
      "الرقم الوظيفي يولّده النظام، والموظف الموجود برقم الهوية نفسه لا يتكرر.",
    ],

    prepare: async () => {
      const result = await selectAllRows((from, to) => supabase.from("employees").select("national_id, emp_id, name").order("id").range(from, to));
      if (result.error) throw new Error(t(employeeErrorText(result.error, "تعذر قراءة الموظفين")));
      const ids = new Map<string, string>();
      (result.data as Array<{ national_id?: string | null; emp_id?: string | null; name?: string | null }>).forEach((row) => {
        const id = normalizeKey(String(row.national_id ?? ""));
        if (id) ids.set(id, `${row.emp_id ?? ""} ${row.name ?? ""}`.trim());
      });
      return { ids };
    },

    parse: (values, ctx) => {
      const name = cleanText(values.name);
      if (name.length < 2) return { error: t("الاسم الكامل بالعربي مطلوب") };
      if (name.length > 150) return { error: t("الاسم أطول من 150 حرفًا") };
      const nationalId = cleanCell(values.nationalId).replace(/\s/g, "");
      if (!nationalId) return { error: t("رقم الهوية / الإقامة مطلوب") };
      if (saudiCompany && !/^[1-4]\d{9}$/.test(nationalId)) return { error: t("رقم الهوية / الإقامة / الحدود يجب أن يكون 10 أرقام ويبدأ بـ 1 أو 2 أو 3 أو 4") };
      if (!saudiCompany && !/^[A-Za-z0-9-]{4,30}$/.test(nationalId)) return { error: t("رقم الهوية / الإقامة من 4 إلى 30 حرفًا لاتينيًا أو رقمًا (ويُقبل -، بلا مسافات)") };
      const existing = ctx.ids.get(normalizeKey(nationalId));
      if (existing) return { error: `${t("يوجد موظف برقم الهوية نفسه")}: ${existing}` };
      const phone = normalizePhone(values.phone);
      if (!phone) return { error: t("رقم الجوال مطلوب") };
      if (!/^(05\d{8}|\+?\d{8,15})$/.test(phone)) return { error: t("رقم الجوال غير صحيح (مثال: 05xxxxxxxx أو رقم دولي)") };
      const nationality = pickOption(values.nationality, nationalityOptions);
      if (!nationality) return { error: `${t("الجنسية غير معروفة؛ اختر من قائمة القالب")}: ${cleanCell(values.nationality)}` };
      const gender = pickOption(values.gender, genderOptions);
      if (!gender) return { error: `${t("الجنس غير معروف؛ ذكر أو أنثى")}: ${cleanCell(values.gender)}` };
      const salaryText = cleanCell(values.salary);
      const salary = salaryText ? parseAmount(salaryText) : 0;
      if (salary === null) return { error: t("الراتب الأساسي رقم موجب بخانتين عشريتين على الأكثر") };
      if (salaryRequired && !(salary > 0)) return { error: t("الراتب الأساسي يجب أن يكون أكبر من صفر") };
      let jobTitle = settings.jobTitle;
      if (cleanCell(values.jobTitle)) {
        const picked = pickOption(values.jobTitle, jobOptions);
        if (!picked) return { error: `${t("المسمى غير موجود في الهيكل التنظيمي؛ أضفه أولًا أو اتركه فارغًا")}: ${cleanCell(values.jobTitle)}` };
        jobTitle = picked;
      }

      const form: EmpFormData = {
        ...lists.emptyForm(),
        name,
        gender,
        phone,
        nationality,
        nationalId,
        jobTitle,
        branchId: settings.branchId,
        branch: settings.branchName,
        departmentId: settings.departmentId,
        directorate: settings.departmentName,
        employmentType: settings.employmentType,
        hireDate: settings.hireDate,
        employeeRole: settings.role,
        status: "فعال",
        baseSalary: salary,
      };
      const payload = lists.buildEmployeePayload(form);
      // الصورة والمستندات تُرفع من ملف الموظف (كما في الإضافة اليدوية)
      delete payload.photo_url;
      delete payload.documents;
      return {
        key: `id:${normalizeKey(nationalId)}`,
        value: { ...payload, id: form.id, total_salary: lists.computeTotalSalary(form.baseSalary, form.allowances) },
      };
    },

    save: async (employee) => {
      const { error } = await supabase.from("employees").insert([employee]);
      // إعادة المحاولة بعد انقطاع: السجل نفسه (بالمعرّف نفسه) محفوظ مسبقًا
      if (alreadySaved(error)) return null;
      return error ? t(employeeErrorText(error, "تعذر حفظ الموظف")) : null;
    },
  };
}
