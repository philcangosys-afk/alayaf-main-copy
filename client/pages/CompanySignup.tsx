import { useState } from "react";
import { Link } from "react-router-dom";
import { Building2, FileText, Globe, Hash, Lock, Mail, MailCheck, MapPin, Phone, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabaseClient";
import AuthShell, { AUTH_COLORS } from "@/components/AuthShell";
import { ChoiceCards, Field, FormSection, Notice, PasswordInput, SelectInput, StatusIcon, TextInput, linkClass, primaryButtonClass } from "@/components/AuthForm";
import {
  COUNTRIES, EMPLOYEE_RANGES, SAUDI_COUNTRY_CODE, SAUDI_REGIONS, isForeignCr, isForeignVat, isSaudiCr, isSaudiVat, isValidPhone, normalizeIdentifier, normalizePhone,
} from "@/lib/countries";

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// سبب رفض التسجيل من Supabase Auth بالعربية (الرمز أولًا ثم نص الرسالة)
const signupErrorText = (error: { message?: string; code?: string; status?: number }) => {
  const text = `${error.code ?? ""} ${error.message ?? ""}`;
  if (/already.?registered|user.?already.?exists/i.test(text)) {
    return "هذا البريد مسجّل من قبل؛ سجّل الدخول، أو استعد كلمة المرور من «نسيت كلمة المرور؟»";
  }
  // بريد Supabase الافتراضي يرسل لأعضاء المشروع فقط حتى يُضبط SMTP خاص (السبب التقني في سجل المتصفح)
  if (/not.?authorized/i.test(text)) return "تعذر إرسال رسالة التأكيد إلى هذا البريد؛ تواصل مع إدارة المنصة";
  if (/rate|limit/i.test(text)) return "محاولات كثيرة؛ حاول بعد قليل";
  if (/signup.?disabled|signups not allowed/i.test(text)) return "التسجيل مغلق حاليًا؛ تواصل مع إدارة المنصة";
  if (/weak|pwned/i.test(text)) return "كلمة المرور ضعيفة؛ اختر كلمة أطول فيها حروف وأرقام";
  if (/email/i.test(text) && /invalid|validation/i.test(text)) return "البريد الإلكتروني غير صالح أو نطاقه غير مقبول";
  if (/sending|smtp|confirmation/i.test(text) || error.status === 500) return "تعذر إرسال رسالة التأكيد؛ حاول بعد قليل";
  if (/fetch|network/i.test(text)) return "تعذر الاتصال بالخادم؛ تحقق من الإنترنت";
  return "تعذر إنشاء الحساب، حاول مرة أخرى";
};

type YesNo = "yes" | "no";

type Form = {
  name_ar: string;
  employees_range: string;
  cr_number: string;
  country: string;
  region: string;
  city: string;
  address_ar: string;
  vat_registered: YesNo | null;
  vat_number: string;
  phone: string;
  email: string;
  password: string;
  confirm: string;
};

type FieldKey = keyof Form;

/** ترتيب الحقول في الصفحة (المؤشر ينتقل لأول حقل خاطئ) */
const FIELD_ORDER: FieldKey[] = ["name_ar", "employees_range", "cr_number", "country", "region", "city", "address_ar", "vat_registered", "vat_number", "phone", "email", "password", "confirm"];

const emptyForm: Form = {
  name_ar: "", employees_range: "", cr_number: "", country: SAUDI_COUNTRY_CODE, region: "", city: "", address_ar: "",
  vat_registered: null, vat_number: "", phone: "", email: "", password: "", confirm: "",
};

/** بيانات المنشأة المحفوظة مع الحساب حتى يكتمل التسجيل بعد تأكيد البريد (صفحة إكمال التسجيل تقرؤها) */
export type SignupCompanyMetadata = {
  name_ar: string;
  cr_number: string;
  employees_range: string;
  country: string;
  region: string;
  city: string;
  address_ar: string;
  vat_registered: boolean;
  vat_number: string;
  phone: string;
};

/**
 * تسجيل منشأة جديدة: بيانات المنشأة وعنوانها وتسجيلها الضريبي وحساب صاحبها في صفحة واحدة.
 * يُنشأ حساب ببريد يُؤكَّد برسالة، وتُحفظ بيانات المنشأة معه؛ بعد التأكيد والدخول تُرسل المنشأة للموافقة.
 */
export default function CompanySignup() {
  const [form, setForm] = useState<Form>(emptyForm);
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState("");
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});

  const set = <K extends FieldKey>(key: K, value: Form[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  };
  const isSaudi = form.country === SAUDI_COUNTRY_CODE;
  const dial = COUNTRIES.find((country) => country.code === form.country)?.dial ?? "";

  const changeCountry = (country: string) => {
    // مناطق السعودية قائمة، وغيرها نص؛ والصيغ تختلف، فتُفرَّغ المنطقة وتُمسح أخطاء الرقمين
    // تُفرَّغ المنطقة عند الانتقال من السعودية أو إليها فقط (قائمة المناطق ↔ نص)
    setForm((prev) => ({ ...prev, country, region: (country === SAUDI_COUNTRY_CODE) === (prev.country === SAUDI_COUNTRY_CODE) ? prev.region : "" }));
    setErrors((prev) => ({ ...prev, country: undefined, region: undefined, vat_number: undefined, cr_number: undefined }));
  };

  const validate = (): Partial<Record<FieldKey, string>> => {
    const next: Partial<Record<FieldKey, string>> = {};
    if (!form.name_ar.trim()) next.name_ar = "اكتب اسم المنشأة";
    const cr = normalizeIdentifier(form.cr_number.trim());
    if (cr && isSaudi && !isSaudiCr(cr)) next.cr_number = "السجل التجاري في السعودية 10 أرقام";
    if (cr && !isSaudi && !isForeignCr(cr)) next.cr_number = "السجل التجاري حروف لاتينية وأرقام (ويُقبل / و-)، حتى 30 حرفًا";
    if (!form.country) next.country = "اختر الدولة";
    if (!form.region.trim()) next.region = isSaudi ? "اختر المنطقة" : "اكتب المنطقة أو الولاية";
    else if (form.region.trim().length > 100) next.region = "المنطقة 100 حرف على الأكثر";
    if (!form.vat_registered) next.vat_registered = "حدد هل المنشأة مسجّلة ضريبيًا";
    if (form.vat_registered === "yes") {
      const vat = normalizeIdentifier(form.vat_number.trim());
      if (!vat) next.vat_number = "اكتب الرقم الضريبي";
      else if (isSaudi && !isSaudiVat(vat)) next.vat_number = "الرقم الضريبي 15 رقمًا يبدأ وينتهي بالرقم 3";
      else if (!isSaudi && !isForeignVat(vat)) next.vat_number = "الرقم الضريبي حروف لاتينية وأرقام وشرطة، من 3 إلى 20 حرفًا";
    }
    if (!form.phone.trim()) next.phone = "اكتب رقم الجوال";
    else if (!isValidPhone(form.phone)) next.phone = "رقم الجوال من 8 إلى 15 رقمًا";
    const email = form.email.trim().toLowerCase();
    if (!email) next.email = "اكتب البريد الإلكتروني";
    else if (!EMAIL_PATTERN.test(email)) next.email = "البريد الإلكتروني غير صحيح";
    if (form.password.length < 8) next.password = "كلمة المرور 8 أحرف على الأقل";
    if (form.confirm !== form.password) next.confirm = "كلمتا المرور غير متطابقتين";
    return next;
  };

  const focusField = (key: FieldKey) => {
    const target = key === "vat_registered"
      ? document.querySelector<HTMLInputElement>('input[name="signup-vat_registered"]')
      : document.getElementById(`signup-${key}`);
    target?.focus();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    const firstKey = FIELD_ORDER.find((key) => found[key]);
    if (firstKey) {
      focusField(firstKey);
      return;
    }
    const cleanEmail = form.email.trim().toLowerCase();
    const registered = form.vat_registered === "yes";
    const company: SignupCompanyMetadata = {
      name_ar: form.name_ar.trim(),
      cr_number: normalizeIdentifier(form.cr_number.trim()),
      employees_range: form.employees_range,
      country: form.country,
      region: form.region.trim(),
      city: form.city.trim(),
      address_ar: form.address_ar.trim(),
      vat_registered: registered,
      vat_number: registered ? normalizeIdentifier(form.vat_number.trim()) : "",
      phone: normalizePhone(form.phone),
    };
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password: form.password,
        options: { emailRedirectTo: `${window.location.origin}/login`, data: { signup_company: company } },
      });
      if (error) {
        console.error("signup failed", error.status, (error as { code?: string }).code, error.message);
        toast.error(signupErrorText(error as { message?: string; code?: string; status?: number }), { duration: 10000 });
        return;
      }
      if (data.session) {
        // تأكيد البريد معطّل في المشروع: يجب تفعيله (Confirm email) لأن تسجيل المنشأة يشترط بريدًا مؤكَّدًا
        await supabase.auth.signOut();
      }
      setSentTo(cleanEmail);
    } finally {
      setLoading(false);
    }
  };

  if (sentTo) {
    return (
      <AuthShell
        icon={<StatusIcon icon={MailCheck} />}
        title="تحقق من بريدك الإلكتروني"
        subtitle={<>أرسلنا رابط تأكيد إلى <span dir="ltr" className="font-semibold" style={{ color: AUTH_COLORS.text }}>{sentTo}</span></>}
        footer={<p><Link to="/login" className={linkClass}>الذهاب إلى تسجيل الدخول</Link></p>}
      >
        <ol className="space-y-3 text-[14.5px] leading-7" style={{ color: AUTH_COLORS.text }}>
          <li className="flex gap-3"><span className="font-bold" style={{ color: AUTH_COLORS.emerald }}>1.</span>افتح الرابط في الرسالة لتأكيد بريدك.</li>
          <li className="flex gap-3"><span className="font-bold" style={{ color: AUTH_COLORS.emerald }}>2.</span>سجّل الدخول: ستجد بيانات منشأتك جاهزة، فراجعها وأرسلها للموافقة.</li>
          <li className="flex gap-3"><span className="font-bold" style={{ color: AUTH_COLORS.emerald }}>3.</span>بعد موافقة إدارة المنصة تبدأ العمل مباشرة.</li>
        </ol>
        <Notice>إن لم تصلك الرسالة خلال دقائق فراجع البريد غير المرغوب فيه، أو جرّب تسجيل الدخول إن كان البريد مسجّلًا من قبل.</Notice>
      </AuthShell>
    );
  }

  const input = (key: Exclude<FieldKey, "vat_registered">) => ({
    id: `signup-${key}`,
    value: form[key] as string,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => set(key, event.target.value),
    disabled: loading,
    error: errors[key],
  });

  return (
    <AuthShell
      wide
      title="سجّل منشأتك"
      subtitle="أنشئ حساب منشأتك في دقائق. بعد تأكيد بريدك ومراجعة إدارة المنصة تبدأ العمل."
      footer={
        <p>
          لديك حساب؟{" "}
          <Link to="/login" className={linkClass}>تسجيل الدخول</Link>
        </p>
      }
    >
      <form onSubmit={submit} className="space-y-7" noValidate>
        <FormSection step={1} title="بيانات المنشأة" hint="كما في السجل التجاري">
          <Field id="signup-name_ar" label="اسم المنشأة" required error={errors.name_ar} wide>
            <TextInput {...input("name_ar")} icon={Building2} required autoComplete="organization" placeholder="مثال: مؤسسة الريادة للتجارة" />
          </Field>
          <Field id="signup-employees_range" label="عدد الموظفين">
            <SelectInput {...input("employees_range")} icon={Users}>
              <option value="">اختر العدد التقريبي</option>
              {EMPLOYEE_RANGES.map((range) => <option key={range.value} value={range.value}>{range.label}</option>)}
            </SelectInput>
          </Field>
          <Field id="signup-cr_number" label="السجل التجاري" error={errors.cr_number}>
            <TextInput {...input("cr_number")} icon={FileText} dir="ltr" inputMode={isSaudi ? "numeric" : "text"} placeholder={isSaudi ? "10 أرقام" : "رقم السجل في دولتك"} />
          </Field>
        </FormSection>

        <FormSection step={2} title="العنوان" hint="يظهر على فواتير المنشأة ومستنداتها">
          <Field
            id="signup-country"
            label="الدولة"
            required
            error={errors.country}
            hint={isSaudi ? "تُفعَّل لمنشأتك الفوترة الإلكترونية للهيئة والتأمينات الاجتماعية والإقرار الضريبي." : undefined}
          >
            <SelectInput id="signup-country" value={form.country} onChange={(event) => changeCountry(event.target.value)} disabled={loading} error={errors.country} hint={isSaudi ? "country" : undefined} icon={Globe} required autoComplete="country">
              {COUNTRIES.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
            </SelectInput>
          </Field>
          <Field id="signup-region" label={isSaudi ? "المنطقة" : "المنطقة / الولاية"} required error={errors.region}>
            {isSaudi ? (
              <SelectInput {...input("region")} icon={MapPin} required>
                <option value="">اختر المنطقة</option>
                {SAUDI_REGIONS.map((region) => <option key={region} value={region}>{region}</option>)}
              </SelectInput>
            ) : (
              <TextInput {...input("region")} icon={MapPin} required autoComplete="address-level1" placeholder="المنطقة أو الولاية أو المحافظة" />
            )}
          </Field>
          <Field id="signup-city" label="المدينة">
            <TextInput {...input("city")} icon={MapPin} autoComplete="address-level2" placeholder={isSaudi ? "مثال: الرياض" : "المدينة"} />
          </Field>
          <Field id="signup-address_ar" label={isSaudi ? "العنوان الوطني" : "العنوان الداخلي"}>
            <TextInput {...input("address_ar")} autoComplete="street-address" placeholder={isSaudi ? "رقم المبنى، الشارع، الحي، الرمز البريدي" : "الشارع، الحي، الرمز البريدي"} />
          </Field>
          {!isSaudi ? (
            <div className="sm:col-span-2">
              <Notice tone="success">
                منشأتك خارج السعودية: لن تظهر لك الأنظمة السعودية (الفوترة الإلكترونية للهيئة، والتأمينات الاجتماعية، والإقرار الضريبي والزكاة).
                الفوترة (فواتير المبيعات والمشتريات وإشعاراتها) والضريبة بالنسبة التي تحددها حسب دولتك تُفعَّل في تحديث قادم.
                حتى ذلك الحين تعمل الأقسام الأخرى: عروض الأسعار وأوامر البيع والشراء، والمخزون، والقيود المحاسبية، والموارد البشرية والرواتب، والعملاء والموردون.
              </Notice>
            </div>
          ) : null}
        </FormSection>

        <FormSection step={3} title="التسجيل الضريبي" hint={isSaudi ? "في هيئة الزكاة والضريبة والجمارك" : "في دولة المنشأة"}>
          <div className="sm:col-span-2">
            <p id="signup-vat-question" className="mb-2 text-[14px] font-medium" style={{ color: "#23423A" }}>
              {isSaudi ? "هل المنشأة مسجّلة في هيئة الزكاة والضريبة والجمارك؟" : "هل المنشأة مسجّلة ضريبيًا في دولتها؟"}
              <span className="text-[#C9372C]" aria-hidden="true"> *</span>
              <span className="sr-only"> (إلزامي)</span>
            </p>
            <ChoiceCards<YesNo>
              name="signup-vat_registered"
              labelledBy="signup-vat-question"
              value={form.vat_registered}
              onChange={(value) => set("vat_registered", value)}
              disabled={loading}
              error={errors.vat_registered}
              options={[
                { value: "yes", label: "نعم، مسجّلة", detail: isSaudi ? "لديها رقم ضريبي من الهيئة" : "لديها رقم تسجيل ضريبي" },
                { value: "no", label: "غير مسجّلة", detail: isSaudi ? "لا تصدر فواتير المبيعات حتى يُضاف الرقم" : "يمكن إضافة الرقم الضريبي لاحقًا" },
              ]}
            />
            {errors.vat_registered ? <p id="signup-vat_registered-error" className="mt-1.5 text-[13px] text-[#B42318]">{errors.vat_registered}</p> : null}
          </div>
          {form.vat_registered === "yes" ? (
            <Field
              id="signup-vat_number"
              label="الرقم الضريبي"
              required
              error={errors.vat_number}
              hint={isSaudi ? "15 رقمًا يبدأ وينتهي بالرقم 3، كما في شهادة التسجيل" : "كما في شهادة التسجيل الضريبي"}
              wide
            >
              <TextInput
                {...input("vat_number")}
                icon={Hash}
                required
                hint={isSaudi ? "15 رقمًا" : "شهادة التسجيل"}
                dir="ltr"
                inputMode={isSaudi ? "numeric" : "text"}
                placeholder={isSaudi ? "3XXXXXXXXXXXXX3" : ""}
              />
            </Field>
          ) : form.vat_registered === "no" && isSaudi ? (
            <p className="text-[13px] leading-6 sm:col-span-2" style={{ color: AUTH_COLORS.muted }}>
              لا تصدر فواتير المبيعات وإشعاراتها حتى تضيف إدارة المنصة الرقم الضريبي لمنشأتك بعد تسجيلك في الهيئة.
            </p>
          ) : null}
        </FormSection>

        <FormSection step={4} title="حساب الدخول" hint="حساب صاحب المنشأة ومدير النظام فيها">
          <Field id="signup-phone" label="رقم الجوال" required error={errors.phone}>
            <TextInput {...input("phone")} icon={Phone} required type="tel" dir="ltr" inputMode="tel" autoComplete="tel" placeholder={isSaudi ? "05XXXXXXXX" : `${dial} ...`} />
          </Field>
          <Field id="signup-email" label="البريد الإلكتروني" required error={errors.email}>
            <TextInput {...input("email")} icon={Mail} required type="email" dir="ltr" autoComplete="email" placeholder="owner@company.com" />
          </Field>
          <Field id="signup-password" label="كلمة المرور" required error={errors.password} hint="8 أحرف على الأقل">
            <PasswordInput {...input("password")} icon={Lock} required hint="8 أحرف على الأقل" autoComplete="new-password" />
          </Field>
          <Field id="signup-confirm" label="تأكيد كلمة المرور" required error={errors.confirm}>
            <PasswordInput {...input("confirm")} icon={Lock} required autoComplete="new-password" />
          </Field>
        </FormSection>

        <div className="space-y-3 border-t pt-7" style={{ borderColor: AUTH_COLORS.line }}>
          <button type="submit" disabled={loading} className={primaryButtonClass}>
            {loading ? "جاري إنشاء الحساب..." : "أنشئ حساب المنشأة"}
          </button>
          <p className="text-center text-[13px] leading-6" style={{ color: AUTH_COLORS.muted }}>
            سنرسل رابط تأكيد إلى بريدك. الحقول المعلّمة بنجمة إلزامية.
          </p>
        </div>
      </form>
    </AuthShell>
  );
}
