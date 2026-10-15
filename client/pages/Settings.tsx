import Layout from "@/components/Layout";
import { useEffect, useState } from "react";
import { Building2, Landmark, Languages, Save, Settings as SettingsIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { supabase } from "@/lib/supabaseClient";
import { useCompany } from "@/lib/companyContext";
import DocumentTemplateWorkspace from "@/components/document-templates/DocumentTemplateWorkspace";

type EditableProfile = {
  phone: string;
  email: string;
  city: string;
  address_ar: string;
  address_en: string;
  bank_name: string;
  iban: string;
  logo_url: string;
};

const IBAN_PATTERN = /^SA\d{22}$/;
// نفس شرط قاعدة البيانات: رابط https أو مسار داخل الموقع، بلا مسافات أو علامات اقتباس أو أقواس
const LOGO_PATTERN = /^(https:\/\/[^\s"'<>`\\]+|\/[^/\s"'<>`\\][^\s"'<>`\\]*)$/;
const PROFILE_ERRORS: Record<string, string> = {
  COMPANY_ADMIN_REQUIRED: "تعديل بيانات المنشأة لمدير النظام فقط",
  COMPANY_LOGO_URL_INVALID: "رابط الشعار يبدأ بـ https:// (أو مسار داخل الموقع يبدأ بـ /)",
  COMPANY_IBAN_INVALID: "الآيبان السعودي يبدأ بـ SA ويتبعه 22 رقمًا",
};

/**
 * بيانات المنشأة (نظام الشركات): مصدرها جدول المنشآت.
 * الاسم والرقم الضريبي والسجل التجاري مرتبطة بالفواتير وشهادة ZATCA، وتعدّلها إدارة المنصة فقط.
 * مدير النظام في المنشأة يعدّل التواصل والعنوان والحساب البنكي والشعار (update_company_profile).
 */
export default function Settings() {
  const { locale, setLocale, t, direction } = useI18n();
  const company = useCompany();
  const record = company.company;
  const [activeSection, setActiveSection] = useState<"company" | "templates">("company");
  const [draft, setDraft] = useState<EditableProfile>({ phone: "", email: "", city: "", address_ar: "", address_en: "", bank_name: "", iban: "", logo_url: "" });
  const [saving, setSaving] = useState(false);

  const recordKey = JSON.stringify(record ?? null);
  useEffect(() => {
    setDraft({
      phone: record?.phone ?? "",
      email: record?.email ?? "",
      city: record?.city ?? "",
      address_ar: record?.address_ar ?? "",
      address_en: record?.address_en ?? "",
      bank_name: record?.bank_name ?? "",
      iban: record?.iban ?? "",
      logo_url: record?.logo_url ?? "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordKey]);

  const companyFields: Array<{ label: string; value: string; mono?: boolean }> = [
    { label: "رقم المنشأة في المنصة", value: record?.code ? String(record.code) : "", mono: true },
    { label: "اسم الشركة", value: record?.name_ar ?? "" },
    { label: "الاسم بالإنجليزية", value: record?.name_en ?? "" },
    { label: "الرقم الضريبي", value: record?.vat_number ?? "", mono: true },
    { label: "رقم السجل التجاري", value: record?.cr_number ?? "", mono: true },
  ];

  const setField = (key: keyof EditableProfile, value: string) => setDraft((prev) => ({ ...prev, [key]: value }));

  const saveProfile = async () => {
    const iban = draft.iban.replace(/\s+/g, "").toUpperCase();
    if (iban && !IBAN_PATTERN.test(iban)) {
      toast.error(t(PROFILE_ERRORS.COMPANY_IBAN_INVALID));
      return;
    }
    const logoUrl = draft.logo_url.trim();
    if (logoUrl && !LOGO_PATTERN.test(logoUrl)) {
      toast.error(t(PROFILE_ERRORS.COMPANY_LOGO_URL_INVALID));
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.rpc("update_company_profile", { p: { ...draft, iban, logo_url: logoUrl } });
      if (error) {
        const code = Object.keys(PROFILE_ERRORS).find((key) => String(error.message ?? "").includes(key));
        toast.error(t(code ? PROFILE_ERRORS[code] : "تعذر حفظ بيانات المنشأة"));
        return;
      }
      await company.refresh();
      toast.success(t("تم حفظ بيانات المنشأة"));
    } finally {
      setSaving(false);
    }
  };

  const editField = (key: keyof EditableProfile, label: string, ltr = false) => (
    <div key={key}>
      <p className="mb-1 text-xs font-semibold text-muted-foreground">{t(label)}</p>
      <input
        value={draft[key]}
        onChange={(e) => setField(key, e.target.value)}
        dir={ltr ? "ltr" : undefined}
        disabled={saving}
        className={cn("w-full rounded-xl border border-border/50 bg-white px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/20", ltr && "font-mono")}
      />
    </div>
  );

  const renderField = (field: { label: string; value: string; mono?: boolean }) => (
    <div key={field.label}>
      <p className="mb-1 text-xs font-semibold text-muted-foreground">{t(field.label)}</p>
      <p className={cn("rounded-xl border border-border/50 bg-slate-50 px-4 py-2.5 text-sm text-foreground", field.mono && "font-mono")}>{field.value || "—"}</p>
    </div>
  );

  return (
    <Layout subMenu={null}>
      <div className="space-y-6" dir={direction}>
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{t("الإعدادات")}</span>
            <span>/</span>
            <span>{t(activeSection === "templates" ? "قوالب المستندات" : "إعدادات الشركة")}</span>
          </div>
          <h1 className="mt-2 text-3xl font-bold text-foreground">
            {t(activeSection === "templates" ? "قوالب المستندات" : "إعدادات الشركة")}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button onClick={() => setActiveSection("company")} className={cn("rounded-xl px-5 py-2.5 font-bold transition-all duration-200", activeSection === "company" ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/20" : "border border-border/50 bg-white text-foreground hover:bg-muted/50")}>
            {t("معلومات الشركة")}
          </button>
          <a href="/zatca/settings" className="inline-flex rounded-xl border border-border/50 bg-white px-5 py-2.5 font-bold text-foreground transition-colors hover:bg-muted/50">
            {t("إعدادات ZATCA")}
          </a>
          <a href="/expenses/settings" className="inline-flex rounded-xl border border-border/50 bg-white px-5 py-2.5 font-bold text-foreground transition-colors hover:bg-muted/50">
            {t("إعدادات المحاسبة")}
          </a>
          <button onClick={() => setActiveSection("templates")} className={cn("rounded-xl px-5 py-2.5 font-bold transition-all duration-200", activeSection === "templates" ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/20" : "border border-border/50 bg-white text-foreground hover:bg-muted/50")}>
            {t("قوالب المستندات")}
          </button>
        </div>

        {activeSection === "templates" ? <DocumentTemplateWorkspace /> : (
          <div className="space-y-6">
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {t("الاسم والرقم الضريبي والسجل التجاري مطبوعة على الفواتير ومسجلة لدى هيئة الزكاة والضريبة (ZATCA)، وتعديلها عن طريق إدارة المنصة. بيانات التواصل والعنوان والحساب البنكي والشعار يعدّلها مدير النظام هنا.")}
            </div>

            <div className="overflow-hidden rounded-2xl border border-border/50 bg-white shadow-sm">
              <div className="flex items-center gap-2 bg-gradient-to-l from-blue-800 to-blue-900 px-6 py-4 text-sm font-bold text-white">
                <Building2 className="h-4 w-4" />
                {t("معلومات الشركة")}
              </div>
              <div className="grid gap-5 p-6 sm:grid-cols-2">
                {companyFields.map(renderField)}
                {editField("phone", "الجوال", true)}
                {editField("email", "بريد المنشأة", true)}
                {editField("city", "المدينة")}
                {editField("address_ar", "العنوان الوطني")}
                {editField("address_en", "العنوان بالإنجليزية", true)}
                {editField("logo_url", "رابط الشعار", true)}
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-border/50 bg-white shadow-sm">
              <div className="flex items-center gap-2 bg-emerald-700 px-6 py-4 text-sm font-bold text-white">
                <Landmark className="h-4 w-4" />
                {t("الحساب البنكي المطبوع على الفواتير")}
              </div>
              <div className="grid gap-5 p-6 sm:grid-cols-2">
                {renderField({ label: "اسم المستفيد", value: record?.name_ar ?? "" })}
                {editField("bank_name", "البنك")}
                {editField("iban", "الآيبان", true)}
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void saveProfile()}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-500/20 disabled:opacity-60"
              >
                <Save className="h-4 w-4" />
                {t(saving ? "جاري الحفظ..." : "حفظ بيانات المنشأة")}
              </button>
            </div>

            <div className="overflow-hidden rounded-2xl border border-border/50 bg-white shadow-sm">
              <div className="flex items-center gap-2 bg-slate-700 px-6 py-4 text-sm font-bold text-white">
                <Languages className="h-4 w-4" />
                {t("لغة النظام")}
              </div>
              <div className="flex flex-wrap items-center gap-2 p-6">
                <button
                  type="button"
                  onClick={() => void setLocale("ar")}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${locale === "ar" ? "bg-primary text-primary-foreground" : "border border-border bg-card text-foreground"}`}
                >
                  العربية
                </button>
                <button
                  type="button"
                  onClick={() => void setLocale("en")}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${locale === "en" ? "bg-primary text-primary-foreground" : "border border-border bg-card text-foreground"}`}
                >
                  English
                </button>
                <span className="ms-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <SettingsIcon className="h-3.5 w-3.5" />
                  {t("تُحفظ اللغة لحسابك ولا تؤثر على المستخدمين الآخرين.")}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
