import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n";

const SETTING_KEY = "penalties_settings";

type PenaltySettings = {
  applyBeforeResponse: string; // "yes" | "no"
  responseGraceDays: number;
  notifyManager: string; // "yes" | "no"
};

const DEFAULTS: PenaltySettings = {
  applyBeforeResponse: "no",
  responseGraceDays: 3,
  notifyManager: "no",
};

export default function HRPenaltiesSettings() {
  const { t, direction } = useI18n();
  const [s, setS] = useState<PenaltySettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("hr_settings")
        .select("setting_value")
        .eq("setting_key", SETTING_KEY)
        .maybeSingle();
      if (data?.setting_value) setS({ ...DEFAULTS, ...(data.setting_value as Partial<PenaltySettings>) });
      setLoading(false);
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("hr_settings")
      .upsert([{ setting_key: SETTING_KEY, setting_value: s, updated_at: new Date().toISOString() }], { onConflict: "company_id,setting_key" });
    setSaving(false);
    if (error) {
      toast({ title: t("تعذّر الحفظ"), description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: t("تم الحفظ"), description: t("تم حفظ إعدادات المساءلات في قاعدة البيانات") });
  };

  if (loading) {
    return (
      <Layout>
        <div className="p-6 flex items-center justify-center h-64" dir={direction}>
          <Loader2 className="h-8 w-8 animate-spin text-[#004e89]" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-6 max-w-[1200px] mx-auto space-y-6" dir={direction}>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-800">{t("إعدادات المساءلات")}</h2>
          </div>

          <div className="p-8 space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
              <div className="space-y-3">
                <label className="text-sm font-medium text-gray-700 flex items-center gap-1">
                  {t("إمكانية تطبيق جزاء قبل انتهاء الفترة المسموحة لرد الموظف")} <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-6 mt-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="apply_penalty_early"
                      className="text-[#004e89] focus:ring-[#004e89] w-4 h-4"
                      checked={s.applyBeforeResponse === "yes"}
                      onChange={() => setS((p) => ({ ...p, applyBeforeResponse: "yes" }))}
                    />
                    <span className="text-sm text-gray-700">{t("نعم")}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="apply_penalty_early"
                      className="text-[#004e89] focus:ring-[#004e89] w-4 h-4"
                      checked={s.applyBeforeResponse === "no"}
                      onChange={() => setS((p) => ({ ...p, applyBeforeResponse: "no" }))}
                    />
                    <span className="text-sm text-gray-700">{t("لا")}</span>
                  </label>
                </div>
              </div>

              <div className="space-y-3 relative">
                <label className="text-sm font-medium text-gray-700 flex items-center gap-1">
                  {t("الفترة المسموحة لتجاوز رد الموظف")} <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={0}
                    value={s.responseGraceDays}
                    onChange={(e) => setS((p) => ({ ...p, responseGraceDays: Number(e.target.value) }))}
                    className="w-full h-10 border border-gray-300 rounded-md px-3 pl-16 bg-white text-sm focus:ring-2 focus:ring-[#004e89] focus:border-transparent outline-none"
                  />
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{t("يوم/أيام")}</span>
                </div>
              </div>

              <div className="space-y-3 md:col-span-2">
                <label className="text-sm font-medium text-gray-700 flex items-center gap-1">
                  {t("تفعيل إرسال إشعار للمدير المباشر بالمساءلات التي ترسل للموظفين")}
                </label>
                <div className="flex gap-6 mt-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="notify_manager"
                      className="text-[#004e89] focus:ring-[#004e89] w-4 h-4"
                      checked={s.notifyManager === "yes"}
                      onChange={() => setS((p) => ({ ...p, notifyManager: "yes" }))}
                    />
                    <span className="text-sm text-gray-700">{t("نعم")}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="notify_manager"
                      className="text-[#004e89] focus:ring-[#004e89] w-4 h-4"
                      checked={s.notifyManager === "no"}
                      onChange={() => setS((p) => ({ ...p, notifyManager: "no" }))}
                    />
                    <span className="text-sm text-gray-700">{t("لا")}</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="pt-6 border-t border-gray-100 flex justify-end">
              <Button onClick={handleSave} disabled={saving} className="bg-[#004e89] hover:bg-[#003865] text-white px-8 h-10 rounded-md">
                {saving ? t("جاري الحفظ...") : t("حفظ")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
