import { useState, useEffect } from "react";
import { ChevronLeft, Settings, Moon, Sun, Globe, Bell, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { useI18n } from "@/i18n";

type Props = { empId: string; empName: string; empRole: string; onBack: () => void };

type Prefs = { lang: "ar" | "en"; darkMode: boolean; notifications: boolean };

const DEFAULT_PREFS: Prefs = { lang: "ar", darkMode: false, notifications: true };

export default function EmployeeSettingsPage({ empId, empName, empRole, onBack }: Props) {
  const { t, locale, setLocale } = useI18n();
  const [prefs, setPrefs] = useState<Prefs>({ ...DEFAULT_PREFS, lang: locale });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("user_preferences").select("preferences").eq("emp_id", empId).maybeSingle().then(({ data }) => {
      if (data?.preferences && typeof data.preferences === "object") {
        setPrefs({ ...DEFAULT_PREFS, ...(data.preferences as Partial<Prefs>) });
      }
      setLoading(false);
    });
  }, [empId]);

  const save = async (next: Prefs) => {
    setPrefs(next);
    setSaving(true);
    const { error } = await supabase.from("user_preferences").upsert({ emp_id: empId, preferences: next, updated_at: new Date().toISOString() }, { onConflict: "company_id,emp_id" });
    setSaving(false);
    if (error) toast.error(t("تعذر حفظ الإعدادات"));
    else {
      if (next.lang !== locale) await setLocale(next.lang);
      toast.success(t("تم حفظ الإعدادات"));
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <div className="flex items-center gap-3 p-4 bg-white border-b sticky top-0 z-10">
        <button onClick={onBack} className="text-[#004e89]"><ChevronLeft className="h-6 w-6 rotate-180" /></button>
        <Settings className="h-5 w-5 text-[#004e89]" />
        <h2 className="font-bold text-lg text-gray-900">{t("الإعدادات")}</h2>
        {saving && <Loader2 className="h-4 w-4 animate-spin text-gray-400 mr-auto" />}
      </div>
      <div className="flex-1 overflow-y-auto p-4 pb-24 space-y-4">
        {/* Profile summary */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-[#004e89] flex items-center justify-center text-white font-bold text-xl">
            {empName.charAt(0)}
          </div>
          <div>
            <p className="font-semibold text-gray-900">{empName}</p>
            <p className="text-xs text-gray-500">{empRole}</p>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-400">{t("جاري تحميل الإعدادات...")}</div>
        ) : (
          <>
            {/* Language */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <p className="font-semibold text-gray-800 mb-3 flex items-center gap-2"><Globe className="h-4 w-4 text-[#004e89]" /> {t("اللغة")}</p>
              <div className="flex gap-3">
                <button onClick={() => save({ ...prefs, lang: "ar" })} className={`flex-1 py-2.5 rounded-lg text-sm font-semibold border transition ${prefs.lang === "ar" ? "bg-[#004e89] text-white border-[#004e89]" : "border-gray-200 text-gray-600"}`}>{t("العربية")}</button>
                <button onClick={() => save({ ...prefs, lang: "en" })} className={`flex-1 py-2.5 rounded-lg text-sm font-semibold border transition ${prefs.lang === "en" ? "bg-[#004e89] text-white border-[#004e89]" : "border-gray-200 text-gray-600"}`}>{t("English")}</button>
              </div>
            </div>

            {/* Theme */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-gray-800 flex items-center gap-2">
                  {prefs.darkMode ? <Moon className="h-4 w-4 text-indigo-500" /> : <Sun className="h-4 w-4 text-amber-400" />}
                  {t("الوضع")} {prefs.darkMode ? t("الليلي") : t("النهاري")}
                </p>
                <button onClick={() => save({ ...prefs, darkMode: !prefs.darkMode })} className={`w-12 h-6 rounded-full transition-colors relative ${prefs.darkMode ? "bg-[#004e89]" : "bg-gray-200"}`}>
                  <span className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-all ${prefs.darkMode ? "right-0.5" : "left-0.5"}`} />
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-2">{t("تغيير مظهر التطبيق")}</p>
            </div>

            {/* Notifications */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-gray-800 flex items-center gap-2"><Bell className="h-4 w-4 text-orange-500" /> {t("الإشعارات")}</p>
                <button onClick={() => save({ ...prefs, notifications: !prefs.notifications })} className={`w-12 h-6 rounded-full transition-colors relative ${prefs.notifications ? "bg-[#004e89]" : "bg-gray-200"}`}>
                  <span className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-all ${prefs.notifications ? "right-0.5" : "left-0.5"}`} />
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-2">{prefs.notifications ? t("الإشعارات مفعّلة") : t("الإشعارات متوقفة")}</p>
            </div>
          </>
        )}

        {/* App info */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 text-center text-gray-400 text-xs">
          {t("نظام الموارد البشرية — بوابة الموظفين")}<br />{t("الإصدار 1.0")}
        </div>
      </div>
    </div>
  );
}
