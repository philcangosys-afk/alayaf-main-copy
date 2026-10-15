import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/lib/supabaseClient";
import { useCompany } from "@/lib/companyContext";
import AuthShell, { authButtonStyle, authInputClass, authLabelClass } from "@/components/AuthShell";

const REGISTER_ERRORS: Record<string, string> = {
  LOGIN_REQUIRED: "سجّل الدخول أولًا",
  EMAIL_NOT_CONFIRMED: "أكّد بريدك الإلكتروني أولًا من الرسالة المرسلة إليك",
  ALREADY_COMPANY_MEMBER: "حسابك مرتبط بمنشأة بالفعل",
  PLATFORM_ADMIN_CANNOT_REGISTER: "حساب إدارة المنصة لا يسجّل منشأة",
  COMPANY_NAME_REQUIRED: "اسم المنشأة مطلوب",
  COMPANY_VAT_INVALID: "الرقم الضريبي 15 رقمًا يبدأ وينتهي بالرقم 3",
  COMPANY_CR_INVALID: "السجل التجاري 10 أرقام",
  EMAIL_ALREADY_OWNS_COMPANY: "هذا البريد مسجّل لمنشأة أخرى",
  COMPANY_VAT_ALREADY_REGISTERED: "هذا الرقم الضريبي مسجّل لمنشأة أخرى",
};

const registerErrorText = (message: string) => {
  const key = Object.keys(REGISTER_ERRORS).find((code) => message.includes(code));
  return key ? REGISTER_ERRORS[key] : "تعذر تسجيل المنشأة، حاول مرة أخرى";
};

type Form = {
  name_ar: string;
  name_en: string;
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
  name_ar: "", name_en: "", vat_number: "", cr_number: "", phone: "",
  email: "", city: "", address_ar: "", address_en: "", contact_name: "",
};

/** تسجيل بيانات المنشأة (الخطوة 2): تُنشأ بحالة «بانتظار الموافقة» */
export default function RegisterCompany() {
  const navigate = useNavigate();
  const company = useCompany();
  const [form, setForm] = useState<Form>(emptyForm);
  const [saving, setSaving] = useState(false);

  if (company.status !== "none" || company.isPlatformAdmin) {
    return <Navigate to={company.status === "active" ? "/" : "/company-status"} replace />;
  }

  const set = (key: keyof Form, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const payload = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim()])) as Form;
    if (!payload.name_ar) {
      toast.error("اسم المنشأة بالعربية مطلوب");
      return;
    }
    if (payload.vat_number && !/^3\d{13}3$/.test(payload.vat_number)) {
      toast.error(REGISTER_ERRORS.COMPANY_VAT_INVALID);
      return;
    }
    if (payload.cr_number && !/^\d{10}$/.test(payload.cr_number)) {
      toast.error(REGISTER_ERRORS.COMPANY_CR_INVALID);
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.rpc("register_company", { p: payload });
      if (error) {
        toast.error(registerErrorText(error.message ?? ""));
        return;
      }
      await company.refresh();
      toast.success("تم إرسال طلب تسجيل المنشأة");
      navigate("/company-status", { replace: true });
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof Form, label: string, opts: { ltr?: boolean; placeholder?: string; required?: boolean } = {}) => (
    <div>
      <label className={authLabelClass}>
        {label}
        {opts.required ? <span className="text-rose-400"> *</span> : null}
      </label>
      <input
        value={form[key]}
        onChange={(e) => set(key, e.target.value)}
        className={authInputClass}
        dir={opts.ltr ? "ltr" : "rtl"}
        placeholder={opts.placeholder}
        disabled={saving}
      />
    </div>
  );

  return (
    <AuthShell subtitle="تسجيل منشأة جديدة · الخطوة 2 من 2: بيانات المنشأة" wide>
      {company.lastRejection ? (
        <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm leading-7 text-rose-100">
          لم يُقبل طلبك السابق{company.lastRejection.name_ar ? ` (${company.lastRejection.name_ar})` : ""}
          {company.lastRejection.reason ? `: ${company.lastRejection.reason}` : "."} يمكنك التسجيل من جديد بعد تصحيح البيانات.
        </div>
      ) : null}
      <form onSubmit={submit} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          {field("name_ar", "اسم المنشأة بالعربية", { required: true })}
          {field("name_en", "اسم المنشأة بالإنجليزية", { ltr: true })}
          {field("vat_number", "الرقم الضريبي (لازم لإصدار فواتير المبيعات)", { ltr: true, placeholder: "3XXXXXXXXXXXXX3" })}
          {field("cr_number", "السجل التجاري", { ltr: true, placeholder: "10 أرقام" })}
          {field("contact_name", "اسم المسؤول")}
          {field("phone", "الجوال", { ltr: true, placeholder: "05XXXXXXXX" })}
          {field("email", "بريد المنشأة (اختياري)", { ltr: true })}
          {field("city", "المدينة")}
          {field("address_ar", "العنوان الوطني بالعربية")}
          {field("address_en", "العنوان بالإنجليزية", { ltr: true })}
        </div>
        <p className="text-xs leading-6 text-white/50">
          الاسم والرقم الضريبي والسجل التجاري تظهر على الفواتير الضريبية، ولا تُعدَّل بعد الموافقة إلا عن طريق إدارة المنصة.
        </p>
        <Button type="submit" disabled={saving} className="w-full h-12 text-[15px] font-bold rounded-xl shadow-lg shadow-blue-500/25" style={authButtonStyle}>
          {saving ? "جاري الإرسال..." : "إرسال طلب التسجيل"}
        </Button>
      </form>
      <button
        type="button"
        onClick={() => void supabase.auth.signOut().then(() => navigate("/login", { replace: true }))}
        className="block w-full text-center text-sm text-white/40 hover:text-white/70"
      >
        تسجيل الخروج
      </button>
    </AuthShell>
  );
}
