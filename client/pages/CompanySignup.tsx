import { useState } from "react";
import { Link } from "react-router-dom";
import { Eye, EyeOff, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabaseClient";
import AuthShell, { AUTH_COLORS, authButtonClass, authButtonStyle, authInputClass, authLabelClass, authLinkClass, authNoteClass } from "@/components/AuthShell";
import { COUNTRIES, EMPLOYEE_RANGES, SAUDI_COUNTRY_CODE, isValidPhone, normalizeIdentifier, normalizePhone } from "@/lib/countries";

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

type Form = {
  name_ar: string;
  cr_number: string;
  employees_range: string;
  country: string;
  phone: string;
  email: string;
  password: string;
  confirm: string;
};

/** الحقول الإلزامية (تُعلَن لقارئ الشاشة بـ aria-required) */
const REQUIRED_FIELDS: ReadonlyArray<keyof Form> = ["name_ar", "phone", "email", "password", "confirm"];

const emptyForm: Form = {
  name_ar: "", cr_number: "", employees_range: "", country: SAUDI_COUNTRY_CODE, phone: "", email: "", password: "", confirm: "",
};

/** بيانات المنشأة المحفوظة مع الحساب حتى يكتمل التسجيل بعد تأكيد البريد (صفحة تسجيل المنشأة تقرؤها) */
export type SignupCompanyMetadata = {
  name_ar: string;
  cr_number: string;
  employees_range: string;
  country: string;
  phone: string;
};

/**
 * تسجيل منشأة جديدة: بيانات المنشأة وحساب الدخول في صفحة واحدة.
 * يُنشأ حساب ببريد يُؤكَّد برسالة، وتُحفظ بيانات المنشأة معه؛ بعد التأكيد والدخول تُرسل المنشأة للموافقة.
 */
export default function CompanySignup() {
  const [form, setForm] = useState<Form>(emptyForm);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState("");
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});

  const set = (key: keyof Form, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  };
  const isSaudi = form.country === SAUDI_COUNTRY_CODE;
  const dial = COUNTRIES.find((country) => country.code === form.country)?.dial ?? "";

  const validate = (): Partial<Record<keyof Form, string>> => {
    const next: Partial<Record<keyof Form, string>> = {};
    if (!form.name_ar.trim()) next.name_ar = "اكتب اسم المنشأة";
    const cr = normalizeIdentifier(form.cr_number.trim());
    if (cr && isSaudi && !/^\d{10}$/.test(cr)) next.cr_number = "السجل التجاري في السعودية 10 أرقام";
    if (cr && !isSaudi && !(/^[A-Za-z0-9/-]{1,30}$/.test(cr) && /[A-Za-z0-9]/.test(cr))) next.cr_number = "السجل التجاري حروف لاتينية وأرقام (ويُقبل / و-)، حتى 30 حرفًا";
    if (!form.phone.trim()) next.phone = "اكتب رقم الجوال";
    else if (!isValidPhone(form.phone)) next.phone = "رقم الجوال من 8 إلى 15 رقمًا";
    const email = form.email.trim().toLowerCase();
    if (!email) next.email = "اكتب البريد الإلكتروني";
    else if (!EMAIL_PATTERN.test(email)) next.email = "البريد الإلكتروني غير صحيح";
    if (form.password.length < 8) next.password = "كلمة المرور 8 أحرف على الأقل";
    if (form.confirm !== form.password) next.confirm = "كلمتا المرور غير متطابقتين";
    return next;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    const firstKey = (Object.keys(found) as Array<keyof Form>)[0];
    if (firstKey) {
      document.getElementById(`signup-${firstKey}`)?.focus();
      return;
    }
    const cleanEmail = form.email.trim().toLowerCase();
    const company: SignupCompanyMetadata = {
      name_ar: form.name_ar.trim(),
      cr_number: normalizeIdentifier(form.cr_number.trim()),
      employees_range: form.employees_range,
      country: form.country,
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
      <AuthShell title="تحقق من بريدك الإلكتروني" footer={<p><Link to="/login" className={authLinkClass}>الذهاب إلى تسجيل الدخول</Link></p>}>
        <div className="flex items-start gap-4">
          <MailCheck className="mt-1 h-9 w-9 shrink-0" style={{ color: AUTH_COLORS.emerald }} aria-hidden="true" />
          <div className="space-y-3 text-[15px] leading-8" style={{ color: AUTH_COLORS.text }}>
            <p>
              أرسلنا رابط تأكيد إلى <span dir="ltr" className="font-semibold">{sentTo}</span>.
            </p>
            <p style={{ color: AUTH_COLORS.muted }}>
              افتح الرابط ثم سجّل الدخول: ستجد بيانات منشأتك جاهزة لترسلها للموافقة. بعد موافقة إدارة المنصة تبدأ العمل مباشرة.
              إن لم تصلك الرسالة خلال دقائق فراجع البريد غير المرغوب فيه، أو جرّب تسجيل الدخول إن كان البريد مسجّلًا من قبل.
            </p>
          </div>
        </div>
      </AuthShell>
    );
  }

  const fieldError = (key: keyof Form) =>
    errors[key] ? <p id={`signup-${key}-error`} className="mt-1.5 text-[13px] text-[#B42318]">{errors[key]}</p> : null;
  const inputProps = (key: keyof Form) => ({
    id: `signup-${key}`,
    value: form[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => set(key, event.target.value),
    disabled: loading,
    "aria-invalid": errors[key] ? true : undefined,
    "aria-required": REQUIRED_FIELDS.includes(key) ? true : undefined,
    "aria-describedby": errors[key] ? `signup-${key}-error` : undefined,
    className: authInputClass,
    // لون الحد الأحمر بنمط مباشر: صنفان لنفس الخاصية في Tailwind لا يُضمن أيهما يغلب
    style: errors[key] ? { borderColor: "#D92D20" } : undefined,
  });
  const required = <span className="text-[#B42318]" aria-hidden="true"> *</span>;

  return (
    <AuthShell
      wide
      title="سجّل منشأتك"
      subtitle="أدخل بيانات منشأتك وحساب صاحبها. بعد تأكيد البريد وموافقة إدارة المنصة تبدأ العمل."
      footer={
        <p>
          لديك حساب؟{" "}
          <Link to="/login" className={authLinkClass}>تسجيل الدخول</Link>
        </p>
      }
    >
      <form onSubmit={submit} className="space-y-8" noValidate>
        <fieldset className="space-y-4">
          <legend className="mb-1 text-[16px] font-bold" style={{ color: AUTH_COLORS.ink }}>بيانات المنشأة</legend>
          <div>
            <label htmlFor="signup-name_ar" className={authLabelClass}>اسم المنشأة{required}</label>
            <input {...inputProps("name_ar")} autoComplete="organization" placeholder="مثال: مؤسسة الريادة للتجارة" />
            {fieldError("name_ar")}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="signup-country" className={authLabelClass}>الدولة</label>
              <select {...inputProps("country")} autoComplete="country">
                {COUNTRIES.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="signup-employees_range" className={authLabelClass}>عدد الموظفين</label>
              <select {...inputProps("employees_range")}>
                <option value="">اختر العدد التقريبي</option>
                {EMPLOYEE_RANGES.map((range) => <option key={range.value} value={range.value}>{range.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="signup-cr_number" className={authLabelClass}>السجل التجاري</label>
            <input {...inputProps("cr_number")} dir="ltr" inputMode={isSaudi ? "numeric" : "text"} placeholder={isSaudi ? "10 أرقام" : "رقم السجل في دولتك"} />
            {fieldError("cr_number")}
          </div>
          {isSaudi ? (
            <p className="text-[13px] leading-6" style={{ color: AUTH_COLORS.muted }}>
              منشأتك في السعودية: تحصل على الفوترة الإلكترونية المتوافقة مع هيئة الزكاة والضريبة والجمارك، والتأمينات الاجتماعية في الرواتب، والإقرار الضريبي.
            </p>
          ) : (
            <div className={authNoteClass} style={{ background: AUTH_COLORS.mint, borderColor: "#BFDCCD", color: AUTH_COLORS.ink }}>
              منشأتك خارج السعودية: لن تظهر لك الأنظمة السعودية (الفوترة الإلكترونية للهيئة، والتأمينات الاجتماعية، والإقرار الضريبي والزكاة).
              الفوترة (فواتير المبيعات والمشتريات وإشعاراتها) والضريبة بالنسبة التي تحددها حسب دولتك تُفعَّل في تحديث قادم.
              حتى ذلك الحين تعمل الأقسام الأخرى: عروض الأسعار وأوامر البيع والشراء، والمخزون، والقيود المحاسبية، والموارد البشرية والرواتب، والعملاء والموردون.
            </div>
          )}
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="mb-1 text-[16px] font-bold" style={{ color: AUTH_COLORS.ink }}>التواصل وحساب الدخول</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="signup-phone" className={authLabelClass}>رقم الجوال{required}</label>
              <input {...inputProps("phone")} type="tel" dir="ltr" inputMode="tel" autoComplete="tel" placeholder={isSaudi ? "05XXXXXXXX" : `${dial} ...`} />
              {fieldError("phone")}
            </div>
            <div>
              <label htmlFor="signup-email" className={authLabelClass}>البريد الإلكتروني{required}</label>
              <input {...inputProps("email")} type="email" dir="ltr" autoComplete="email" placeholder="owner@company.com" />
              {fieldError("email")}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="signup-password" className={authLabelClass}>كلمة المرور{required}</label>
              <div className="relative">
                <input {...inputProps("password")} type={showPassword ? "text" : "password"} autoComplete="new-password" placeholder="8 أحرف على الأقل" className={`${inputProps("password").className} pl-11`} />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                  className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded text-[#7C918A] hover:text-[#24443A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#14775A]/40"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {fieldError("password")}
            </div>
            <div>
              <label htmlFor="signup-confirm" className={authLabelClass}>تأكيد كلمة المرور{required}</label>
              <input {...inputProps("confirm")} type={showPassword ? "text" : "password"} autoComplete="new-password" />
              {fieldError("confirm")}
            </div>
          </div>
          <p className="text-[13px] leading-6" style={{ color: AUTH_COLORS.muted }}>
            البريد هو حساب دخول صاحب المنشأة ومدير النظام فيها، ويصله رابط تأكيد. الحقول المعلَّمة بنجمة إلزامية.
          </p>
        </fieldset>

        <button type="submit" disabled={loading} className={authButtonClass} style={authButtonStyle}>
          {loading ? "جاري إنشاء الحساب..." : "أنشئ حساب المنشأة"}
        </button>
      </form>
    </AuthShell>
  );
}
