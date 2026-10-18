import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/lib/supabaseClient";
import { useCompany } from "@/lib/companyContext";
import AuthShell, { AUTH_COLORS, authButtonClass, authButtonStyle, authInputClass, authLabelClass, authLinkClass, authNoteClass } from "@/components/AuthShell";
import { COUNTRIES, EMPLOYEE_RANGES, SAUDI_COUNTRY_CODE, isValidPhone, normalizeIdentifier, normalizePhone } from "@/lib/countries";

const REGISTER_ERRORS: Record<string, string> = {
  LOGIN_REQUIRED: "سجّل الدخول أولًا",
  EMAIL_NOT_CONFIRMED: "أكّد بريدك الإلكتروني أولًا من الرسالة المرسلة إليك",
  ALREADY_COMPANY_MEMBER: "حسابك مرتبط بمنشأة بالفعل",
  PLATFORM_ADMIN_CANNOT_REGISTER: "حساب إدارة المنصة لا يسجّل منشأة",
  COMPANY_NAME_REQUIRED: "اسم المنشأة مطلوب",
  COMPANY_VAT_INVALID: "الرقم الضريبي غير صحيح (في السعودية 15 رقمًا يبدأ وينتهي بالرقم 3)",
  COMPANY_CR_INVALID: "السجل التجاري غير صحيح (في السعودية 10 أرقام)",
  COMPANY_PHONE_REQUIRED: "رقم الجوال مطلوب",
  COMPANY_PHONE_INVALID: "رقم الجوال من 8 إلى 15 رقمًا",
  COMPANY_COUNTRY_INVALID: "اختر دولة المنشأة من القائمة",
  COMPANY_EMPLOYEES_INVALID: "اختر عدد الموظفين من القائمة",
  EMAIL_ALREADY_OWNS_COMPANY: "هذا البريد مسجّل لمنشأة أخرى",
  COMPANY_VAT_ALREADY_REGISTERED: "هذا الرقم الضريبي مسجّل لمنشأة أخرى",
};

// صيغ الرقم الضريبي والسجل لمنشأة خارج السعودية (نفس فحص الخادم company_identity_check)
const FOREIGN_ID_ERRORS: Record<string, string> = {
  COMPANY_VAT_INVALID: "الرقم الضريبي حروف لاتينية وأرقام وشرطة، من 3 إلى 20 حرفًا",
  COMPANY_CR_INVALID: "السجل التجاري حروف لاتينية وأرقام (ويُقبل / و-)، حتى 30 حرفًا",
};
const isForeignVat = (value: string) => /^[A-Za-z0-9-]{3,20}$/.test(value) && /[A-Za-z0-9]/.test(value);
const isForeignCr = (value: string) => /^[A-Za-z0-9/-]{1,30}$/.test(value) && /[A-Za-z0-9]/.test(value);

const registerErrorText = (message: string, saudi = true) => {
  const key = Object.keys(REGISTER_ERRORS).find((code) => message.includes(code));
  if (key && !saudi && FOREIGN_ID_ERRORS[key]) return FOREIGN_ID_ERRORS[key];
  return key ? REGISTER_ERRORS[key] : "تعذر تسجيل المنشأة، حاول مرة أخرى";
};

type Form = {
  name_ar: string;
  name_en: string;
  country: string;
  employees_range: string;
  vat_number: string;
  cr_number: string;
  phone: string;
  email: string;
  city: string;
  address_ar: string;
  address_en: string;
  contact_name: string;
};

const emptyForm: Form = {
  name_ar: "", name_en: "", country: SAUDI_COUNTRY_CODE, employees_range: "", vat_number: "", cr_number: "", phone: "",
  email: "", city: "", address_ar: "", address_en: "", contact_name: "",
};

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/**
 * إرسال بيانات المنشأة للموافقة (بعد تأكيد البريد والدخول): تُنشأ بحالة «بانتظار الموافقة».
 * البيانات التي أُدخلت في صفحة التسجيل محفوظة مع الحساب (signup_company) وتُعبّأ هنا تلقائيًا.
 */
export default function RegisterCompany() {
  const navigate = useNavigate();
  const company = useCompany();
  const [form, setForm] = useState<Form>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  useEffect(() => {
    let active = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      const saved = (data.user?.user_metadata?.signup_company ?? null) as Record<string, unknown> | null;
      if (!saved) return;
      const country = text(saved.country).toUpperCase();
      setForm((prev) => ({
        ...prev,
        name_ar: prev.name_ar || text(saved.name_ar),
        cr_number: prev.cr_number || text(saved.cr_number),
        employees_range: prev.employees_range || text(saved.employees_range),
        country: COUNTRIES.some((item) => item.code === country) ? country : prev.country,
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
  const set = (key: keyof Form, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const payload = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim()])) as Form;
    payload.phone = normalizePhone(payload.phone);
    payload.vat_number = normalizeIdentifier(payload.vat_number);
    payload.cr_number = normalizeIdentifier(payload.cr_number);
    if (!payload.name_ar) {
      toast.error("اسم المنشأة مطلوب");
      return;
    }
    if (!payload.phone) {
      toast.error(REGISTER_ERRORS.COMPANY_PHONE_REQUIRED);
      return;
    }
    if (!isValidPhone(payload.phone)) {
      toast.error(REGISTER_ERRORS.COMPANY_PHONE_INVALID);
      return;
    }
    if (isSaudi && payload.vat_number && !/^3\d{13}3$/.test(payload.vat_number)) {
      toast.error(REGISTER_ERRORS.COMPANY_VAT_INVALID);
      return;
    }
    if (isSaudi && payload.cr_number && !/^\d{10}$/.test(payload.cr_number)) {
      toast.error(REGISTER_ERRORS.COMPANY_CR_INVALID);
      return;
    }
    if (!isSaudi && payload.vat_number && !isForeignVat(payload.vat_number)) {
      toast.error(FOREIGN_ID_ERRORS.COMPANY_VAT_INVALID);
      return;
    }
    if (!isSaudi && payload.cr_number && !isForeignCr(payload.cr_number)) {
      toast.error(FOREIGN_ID_ERRORS.COMPANY_CR_INVALID);
      return;
    }
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

  const field = (key: keyof Form, label: string, opts: { ltr?: boolean; placeholder?: string; required?: boolean; type?: string } = {}) => (
    <div>
      <label htmlFor={`register-${key}`} className={authLabelClass}>
        {label}
        {opts.required ? <span className="text-[#B42318]" aria-hidden="true"> *</span> : null}
      </label>
      <input
        id={`register-${key}`}
        type={opts.type ?? "text"}
        value={form[key]}
        onChange={(e) => set(key, e.target.value)}
        className={authInputClass}
        dir={opts.ltr ? "ltr" : "rtl"}
        placeholder={opts.placeholder}
        aria-required={opts.required ? true : undefined}
        disabled={saving}
      />
    </div>
  );

  return (
    <AuthShell
      wide
      title="أكمل تسجيل منشأتك"
      subtitle={prefilled ? "عبّأنا ما أدخلته عند التسجيل. راجعه وأضف ما تريد، ثم أرسل الطلب لموافقة إدارة المنصة." : "أدخل بيانات منشأتك ثم أرسل الطلب لموافقة إدارة المنصة."}
      footer={
        <button type="button" onClick={() => void supabase.auth.signOut().then(() => navigate("/login", { replace: true }))} className={authLinkClass}>
          تسجيل الخروج
        </button>
      }
    >
      {company.lastRejection ? (
        <div className={authNoteClass} style={{ background: "#FEF3F2", borderColor: "#FECDCA", color: "#912018" }}>
          لم يُقبل طلبك السابق{company.lastRejection.name_ar ? ` (${company.lastRejection.name_ar})` : ""}
          {company.lastRejection.reason ? `: ${company.lastRejection.reason}` : "."} يمكنك التسجيل من جديد بعد تصحيح البيانات.
        </div>
      ) : null}
      <form onSubmit={submit} className="space-y-6" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          {field("name_ar", "اسم المنشأة بالعربية", { required: true })}
          {field("name_en", "اسم المنشأة بالإنجليزية", { ltr: true })}
          <div>
            <label htmlFor="register-country" className={authLabelClass}>الدولة</label>
            <select id="register-country" value={form.country} onChange={(e) => set("country", e.target.value)} className={authInputClass} disabled={saving}>
              {COUNTRIES.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="register-employees_range" className={authLabelClass}>عدد الموظفين</label>
            <select id="register-employees_range" value={form.employees_range} onChange={(e) => set("employees_range", e.target.value)} className={authInputClass} disabled={saving}>
              <option value="">اختر العدد التقريبي</option>
              {EMPLOYEE_RANGES.map((range) => <option key={range.value} value={range.value}>{range.label}</option>)}
            </select>
          </div>
          {field("cr_number", "السجل التجاري", { ltr: true, placeholder: isSaudi ? "10 أرقام" : "رقم السجل في دولتك" })}
          {field("vat_number", isSaudi ? "الرقم الضريبي (لازم لإصدار فواتير المبيعات)" : "الرقم الضريبي في دولتك", { ltr: true, placeholder: isSaudi ? "3XXXXXXXXXXXXX3" : "" })}
          {field("phone", "رقم الجوال", { ltr: true, required: true, type: "tel", placeholder: isSaudi ? "05XXXXXXXX" : "" })}
          {field("email", "بريد المنشأة (اختياري)", { ltr: true, type: "email" })}
          {field("contact_name", "اسم المسؤول")}
          {field("city", "المدينة")}
          {field("address_ar", isSaudi ? "العنوان الوطني بالعربية" : "العنوان بالعربية")}
          {field("address_en", "العنوان بالإنجليزية", { ltr: true })}
        </div>
        {isSaudi ? (
          <p className="text-[13px] leading-6" style={{ color: AUTH_COLORS.muted }}>
            الاسم والرقم الضريبي والسجل التجاري تظهر على الفواتير الضريبية، ولا تُعدَّل بعد الموافقة إلا عن طريق إدارة المنصة.
          </p>
        ) : (
          <div className={authNoteClass} style={{ background: AUTH_COLORS.mint, borderColor: "#BFDCCD", color: AUTH_COLORS.ink }}>
            منشأتك خارج السعودية: لن تظهر لك الأنظمة السعودية (الفوترة الإلكترونية للهيئة، والتأمينات الاجتماعية، والإقرار الضريبي والزكاة).
            الفوترة (فواتير المبيعات والمشتريات وإشعاراتها) والضريبة بالنسبة التي تحددها حسب دولتك تُفعَّل في تحديث قادم.
          </div>
        )}
        <button type="submit" disabled={saving} className={authButtonClass} style={authButtonStyle}>
          {saving ? "جاري الإرسال..." : "أرسل طلب التسجيل"}
        </button>
      </form>
    </AuthShell>
  );
}
