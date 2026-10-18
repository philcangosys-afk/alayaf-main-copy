import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Building2, FileText, Globe, Hash, Mail, MapPin, Phone, UserRound, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabaseClient";
import { useCompany } from "@/lib/companyContext";
import AuthShell, { AUTH_COLORS } from "@/components/AuthShell";
import { ChoiceCards, Field, FormSection, Notice, SelectInput, TextInput, linkClass, primaryButtonClass } from "@/components/AuthForm";
import {
  COUNTRIES, EMPLOYEE_RANGES, SAUDI_COUNTRY_CODE, SAUDI_REGIONS, isForeignCr, isForeignVat, isSaudiCr, isSaudiVat, isValidPhone, normalizeIdentifier, normalizePhone,
} from "@/lib/countries";

const REGISTER_ERRORS: Record<string, string> = {
  LOGIN_REQUIRED: "سجّل الدخول أولًا",
  EMAIL_NOT_CONFIRMED: "أكّد بريدك الإلكتروني أولًا من الرسالة المرسلة إليك",
  ALREADY_COMPANY_MEMBER: "حسابك مرتبط بمنشأة بالفعل",
  PLATFORM_ADMIN_CANNOT_REGISTER: "حساب إدارة المنصة لا يسجّل منشأة",
  COMPANY_NAME_REQUIRED: "اسم المنشأة مطلوب",
  COMPANY_VAT_REQUIRED: "اكتب الرقم الضريبي للمنشأة المسجّلة ضريبيًا",
  COMPANY_VAT_INVALID: "الرقم الضريبي غير صحيح (في السعودية 15 رقمًا يبدأ وينتهي بالرقم 3)",
  COMPANY_CR_INVALID: "السجل التجاري غير صحيح (في السعودية 10 أرقام)",
  COMPANY_PHONE_REQUIRED: "رقم الجوال مطلوب",
  COMPANY_PHONE_INVALID: "رقم الجوال من 8 إلى 15 رقمًا",
  COMPANY_COUNTRY_INVALID: "اختر دولة المنشأة من القائمة",
  COMPANY_REGION_REQUIRED: "المنطقة مطلوبة",
  COMPANY_REGION_INVALID: "المنطقة 100 حرف على الأكثر",
  COMPANY_EMPLOYEES_INVALID: "اختر عدد الموظفين من القائمة",
  EMAIL_ALREADY_OWNS_COMPANY: "هذا البريد مسجّل لمنشأة أخرى",
  COMPANY_VAT_ALREADY_REGISTERED: "هذا الرقم الضريبي مسجّل لمنشأة أخرى",
};

// صيغ الرقم الضريبي والسجل لمنشأة خارج السعودية (نفس فحص الخادم company_identity_check)
const FOREIGN_ID_ERRORS: Record<string, string> = {
  COMPANY_VAT_INVALID: "الرقم الضريبي حروف لاتينية وأرقام وشرطة، من 3 إلى 20 حرفًا",
  COMPANY_CR_INVALID: "السجل التجاري حروف لاتينية وأرقام (ويُقبل / و-)، حتى 30 حرفًا",
};

const registerErrorText = (message: string, saudi = true) => {
  const key = Object.keys(REGISTER_ERRORS).find((code) => message.includes(code));
  if (key && !saudi && FOREIGN_ID_ERRORS[key]) return FOREIGN_ID_ERRORS[key];
  return key ? REGISTER_ERRORS[key] : "تعذر تسجيل المنشأة، حاول مرة أخرى";
};

type YesNo = "yes" | "no";

type Form = {
  name_ar: string;
  name_en: string;
  employees_range: string;
  cr_number: string;
  country: string;
  region: string;
  city: string;
  address_ar: string;
  address_en: string;
  vat_registered: YesNo | null;
  vat_number: string;
  phone: string;
  email: string;
  contact_name: string;
};

type FieldKey = keyof Form;

const FIELD_ORDER: FieldKey[] = ["name_ar", "name_en", "employees_range", "cr_number", "country", "region", "city", "address_ar", "address_en", "vat_registered", "vat_number", "phone", "email", "contact_name"];

const emptyForm: Form = {
  name_ar: "", name_en: "", employees_range: "", cr_number: "", country: SAUDI_COUNTRY_CODE, region: "", city: "", address_ar: "", address_en: "",
  vat_registered: null, vat_number: "", phone: "", email: "", contact_name: "",
};

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/**
 * إكمال تسجيل المنشأة (بعد تأكيد البريد والدخول): تُنشأ بحالة «بانتظار الموافقة».
 * ما أُدخل في صفحة التسجيل محفوظ مع الحساب (signup_company) ويُعبّأ هنا تلقائيًا.
 */
export default function RegisterCompany() {
  const navigate = useNavigate();
  const company = useCompany();
  const [form, setForm] = useState<Form>(emptyForm);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [saving, setSaving] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  useEffect(() => {
    let active = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      const saved = (data.user?.user_metadata?.signup_company ?? null) as Record<string, unknown> | null;
      if (!saved) return;
      const country = text(saved.country).toUpperCase();
      const registered = typeof saved.vat_registered === "boolean" ? saved.vat_registered : text(saved.vat_number) ? true : null;
      setForm((prev) => ({
        ...prev,
        name_ar: prev.name_ar || text(saved.name_ar),
        cr_number: prev.cr_number || text(saved.cr_number),
        employees_range: prev.employees_range || text(saved.employees_range),
        country: COUNTRIES.some((item) => item.code === country) ? country : prev.country,
        region: prev.region || text(saved.region),
        city: prev.city || text(saved.city),
        address_ar: prev.address_ar || text(saved.address_ar),
        vat_registered: prev.vat_registered ?? (registered === null ? null : registered ? "yes" : "no"),
        vat_number: prev.vat_number || text(saved.vat_number),
        phone: prev.phone || text(saved.phone),
      }));
      setPrefilled(true);
    });
    return () => { active = false; };
  }, []);

  if (company.status !== "none" || company.isPlatformAdmin) {
    return <Navigate to={company.status === "active" ? "/" : "/company-status"} replace />;
  }

  const isSaudi = form.country === SAUDI_COUNTRY_CODE;
  const dial = COUNTRIES.find((country) => country.code === form.country)?.dial ?? "";
  const set = <K extends FieldKey>(key: K, value: Form[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  };
  const changeCountry = (country: string) => {
    // تُفرَّغ المنطقة عند الانتقال من السعودية أو إليها فقط (قائمة المناطق ↔ نص)
    setForm((prev) => ({ ...prev, country, region: (country === SAUDI_COUNTRY_CODE) === (prev.country === SAUDI_COUNTRY_CODE) ? prev.region : "" }));
    setErrors((prev) => ({ ...prev, country: undefined, region: undefined, vat_number: undefined, cr_number: undefined }));
  };

  const validate = (): Partial<Record<FieldKey, string>> => {
    const next: Partial<Record<FieldKey, string>> = {};
    if (!form.name_ar.trim()) next.name_ar = "اكتب اسم المنشأة";
    const cr = normalizeIdentifier(form.cr_number.trim());
    if (cr && isSaudi && !isSaudiCr(cr)) next.cr_number = "السجل التجاري في السعودية 10 أرقام";
    if (cr && !isSaudi && !isForeignCr(cr)) next.cr_number = FOREIGN_ID_ERRORS.COMPANY_CR_INVALID;
    if (!form.region.trim()) next.region = isSaudi ? "اختر المنطقة" : "اكتب المنطقة أو الولاية";
    else if (form.region.trim().length > 100) next.region = REGISTER_ERRORS.COMPANY_REGION_INVALID;
    if (!form.vat_registered) next.vat_registered = "حدد هل المنشأة مسجّلة ضريبيًا";
    if (form.vat_registered === "yes") {
      const vat = normalizeIdentifier(form.vat_number.trim());
      if (!vat) next.vat_number = "اكتب الرقم الضريبي";
      else if (isSaudi && !isSaudiVat(vat)) next.vat_number = "الرقم الضريبي 15 رقمًا يبدأ وينتهي بالرقم 3";
      else if (!isSaudi && !isForeignVat(vat)) next.vat_number = FOREIGN_ID_ERRORS.COMPANY_VAT_INVALID;
    }
    if (!form.phone.trim()) next.phone = "اكتب رقم الجوال";
    else if (!isValidPhone(form.phone)) next.phone = REGISTER_ERRORS.COMPANY_PHONE_INVALID;
    if (form.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) next.email = "البريد الإلكتروني غير صحيح";
    return next;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    const firstKey = FIELD_ORDER.find((key) => found[key]);
    if (firstKey) {
      const target = firstKey === "vat_registered"
        ? document.querySelector<HTMLInputElement>('input[name="register-vat_registered"]')
        : document.getElementById(`register-${firstKey}`);
      target?.focus();
      return;
    }
    const registered = form.vat_registered === "yes";
    const payload = {
      name_ar: form.name_ar.trim(),
      name_en: form.name_en.trim(),
      employees_range: form.employees_range,
      cr_number: normalizeIdentifier(form.cr_number.trim()),
      country: form.country,
      region: form.region.trim(),
      city: form.city.trim(),
      address_ar: form.address_ar.trim(),
      address_en: form.address_en.trim(),
      vat_registered: registered,
      vat_number: registered ? normalizeIdentifier(form.vat_number.trim()) : "",
      phone: normalizePhone(form.phone),
      email: form.email.trim(),
      contact_name: form.contact_name.trim(),
    };
    setSaving(true);
    try {
      const { error } = await supabase.rpc("register_company", { p: payload });
      if (error) {
        toast.error(registerErrorText(error.message ?? "", isSaudi));
        return;
      }
      await company.refresh();
      toast.success("تم إرسال طلب تسجيل المنشأة");
      navigate("/company-status", { replace: true });
    } finally {
      setSaving(false);
    }
  };

  const input = (key: Exclude<FieldKey, "vat_registered">) => ({
    id: `register-${key}`,
    value: form[key] as string,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => set(key, event.target.value),
    disabled: saving,
    error: errors[key],
  });

  return (
    <AuthShell
      wide
      title="أكمل تسجيل منشأتك"
      subtitle={prefilled ? "عبّأنا ما أدخلته عند التسجيل. راجعه وأكمل ما ينقص، ثم أرسل الطلب لموافقة إدارة المنصة." : "أدخل بيانات منشأتك ثم أرسل الطلب لموافقة إدارة المنصة."}
      footer={
        <button type="button" onClick={() => void supabase.auth.signOut().then(() => navigate("/login", { replace: true }))} className={linkClass}>
          تسجيل الخروج
        </button>
      }
    >
      {company.lastRejection ? (
        <Notice tone="danger">
          لم يُقبل طلبك السابق{company.lastRejection.name_ar ? ` (${company.lastRejection.name_ar})` : ""}
          {company.lastRejection.reason ? `: ${company.lastRejection.reason}` : "."} يمكنك التسجيل من جديد بعد تصحيح البيانات.
        </Notice>
      ) : null}
      <form onSubmit={submit} className="space-y-7" noValidate>
        <FormSection step={1} title="بيانات المنشأة" hint={isSaudi ? "الاسم والرقم الضريبي والسجل تظهر على الفواتير الضريبية، ولا تُعدَّل بعد الموافقة إلا عن طريق إدارة المنصة" : "كما في السجل التجاري"}>
          <Field id="register-name_ar" label="اسم المنشأة بالعربية" required error={errors.name_ar}>
            <TextInput {...input("name_ar")} icon={Building2} required autoComplete="organization" />
          </Field>
          <Field id="register-name_en" label="اسم المنشأة بالإنجليزية">
            <TextInput {...input("name_en")} icon={Building2} dir="ltr" />
          </Field>
          <Field id="register-employees_range" label="عدد الموظفين">
            <SelectInput {...input("employees_range")} icon={Users}>
              <option value="">اختر العدد التقريبي</option>
              {EMPLOYEE_RANGES.map((range) => <option key={range.value} value={range.value}>{range.label}</option>)}
            </SelectInput>
          </Field>
          <Field id="register-cr_number" label="السجل التجاري" error={errors.cr_number}>
            <TextInput {...input("cr_number")} icon={FileText} dir="ltr" inputMode={isSaudi ? "numeric" : "text"} placeholder={isSaudi ? "10 أرقام" : "رقم السجل في دولتك"} />
          </Field>
        </FormSection>

        <FormSection step={2} title="العنوان" hint="يظهر على فواتير المنشأة ومستنداتها">
          <Field id="register-country" label="الدولة" required>
            <SelectInput id="register-country" value={form.country} onChange={(event) => changeCountry(event.target.value)} disabled={saving} icon={Globe} required autoComplete="country">
              {COUNTRIES.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
            </SelectInput>
          </Field>
          <Field id="register-region" label={isSaudi ? "المنطقة" : "المنطقة / الولاية"} required error={errors.region}>
            {isSaudi ? (
              <SelectInput {...input("region")} icon={MapPin} required>
                <option value="">اختر المنطقة</option>
                {/* قيمة محفوظة من قبل ليست في القائمة تبقى ظاهرة */}
                {form.region && !SAUDI_REGIONS.includes(form.region) ? <option value={form.region}>{form.region}</option> : null}
                {SAUDI_REGIONS.map((region) => <option key={region} value={region}>{region}</option>)}
              </SelectInput>
            ) : (
              <TextInput {...input("region")} icon={MapPin} required autoComplete="address-level1" placeholder="المنطقة أو الولاية أو المحافظة" />
            )}
          </Field>
          <Field id="register-city" label="المدينة">
            <TextInput {...input("city")} icon={MapPin} autoComplete="address-level2" />
          </Field>
          <Field id="register-address_ar" label={isSaudi ? "العنوان الوطني" : "العنوان الداخلي"}>
            <TextInput {...input("address_ar")} autoComplete="street-address" placeholder={isSaudi ? "رقم المبنى، الشارع، الحي، الرمز البريدي" : "الشارع، الحي، الرمز البريدي"} />
          </Field>
          <Field id="register-address_en" label="العنوان بالإنجليزية" wide>
            <TextInput {...input("address_en")} dir="ltr" />
          </Field>
          {!isSaudi ? (
            <div className="sm:col-span-2">
              <Notice tone="success">
                منشأتك خارج السعودية: لن تظهر لك الأنظمة السعودية (الفوترة الإلكترونية للهيئة، والتأمينات الاجتماعية، والإقرار الضريبي والزكاة).
                الفوترة (فواتير المبيعات والمشتريات وإشعاراتها) والضريبة بالنسبة التي تحددها حسب دولتك تُفعَّل في تحديث قادم.
              </Notice>
            </div>
          ) : null}
        </FormSection>

        <FormSection step={3} title="التسجيل الضريبي" hint={isSaudi ? "في هيئة الزكاة والضريبة والجمارك" : "في دولة المنشأة"}>
          <div className="sm:col-span-2">
            <p id="register-vat-question" className="mb-2 text-[14px] font-medium" style={{ color: "#23423A" }}>
              {isSaudi ? "هل المنشأة مسجّلة في هيئة الزكاة والضريبة والجمارك؟" : "هل المنشأة مسجّلة ضريبيًا في دولتها؟"}
              <span className="text-[#C9372C]" aria-hidden="true"> *</span>
              <span className="sr-only"> (إلزامي)</span>
            </p>
            <ChoiceCards<YesNo>
              name="register-vat_registered"
              labelledBy="register-vat-question"
              value={form.vat_registered}
              onChange={(value) => set("vat_registered", value)}
              disabled={saving}
              error={errors.vat_registered}
              options={[
                { value: "yes", label: "نعم، مسجّلة", detail: isSaudi ? "لديها رقم ضريبي من الهيئة" : "لديها رقم تسجيل ضريبي" },
                { value: "no", label: "غير مسجّلة", detail: isSaudi ? "لا تصدر فواتير المبيعات حتى يُضاف الرقم" : "يمكن إضافة الرقم الضريبي لاحقًا" },
              ]}
            />
            {errors.vat_registered ? <p id="register-vat_registered-error" className="mt-1.5 text-[13px] text-[#B42318]">{errors.vat_registered}</p> : null}
          </div>
          {form.vat_registered === "yes" ? (
            <Field id="register-vat_number" label="الرقم الضريبي" required error={errors.vat_number} hint={isSaudi ? "15 رقمًا يبدأ وينتهي بالرقم 3، ولازم لإصدار فواتير المبيعات" : "كما في شهادة التسجيل الضريبي"} wide>
              <TextInput {...input("vat_number")} icon={Hash} required hint="vat" dir="ltr" inputMode={isSaudi ? "numeric" : "text"} placeholder={isSaudi ? "3XXXXXXXXXXXXX3" : ""} />
            </Field>
          ) : form.vat_registered === "no" && isSaudi ? (
            <p className="text-[13px] leading-6 sm:col-span-2" style={{ color: AUTH_COLORS.muted }}>
              لا تصدر فواتير المبيعات وإشعاراتها حتى تضيف إدارة المنصة الرقم الضريبي لمنشأتك بعد تسجيلك في الهيئة.
            </p>
          ) : null}
        </FormSection>

        <FormSection step={4} title="التواصل">
          <Field id="register-phone" label="رقم الجوال" required error={errors.phone}>
            <TextInput {...input("phone")} icon={Phone} required type="tel" dir="ltr" inputMode="tel" autoComplete="tel" placeholder={isSaudi ? "05XXXXXXXX" : `${dial} ...`} />
          </Field>
          <Field id="register-email" label="بريد المنشأة" error={errors.email} hint="اختياري؛ إن تُرك فارغًا يُستخدم بريد حسابك">
            <TextInput {...input("email")} icon={Mail} type="email" dir="ltr" hint="optional" autoComplete="email" />
          </Field>
          <Field id="register-contact_name" label="اسم المسؤول" wide>
            <TextInput {...input("contact_name")} icon={UserRound} autoComplete="name" />
          </Field>
        </FormSection>

        <div className="border-t pt-7" style={{ borderColor: AUTH_COLORS.line }}>
          <button type="submit" disabled={saving} className={primaryButtonClass}>
            {saving ? "جاري الإرسال..." : "أرسل طلب التسجيل"}
          </button>
        </div>
      </form>
    </AuthShell>
  );
}
