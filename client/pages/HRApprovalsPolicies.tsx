import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n";

const SETTING_KEY = "approval_policies";

const flatRequestTypes = [
  "الإجازات", "نقل", "صيانة", "التعريف بالراتب", "صرف رواتب الموظفين", "إعادة تقييم", "إخلاء طرف", "اعتماد مبيعات مندوب منطقة", "تجديد عهدة مالية", "اعتماد خطة تدريبية", "جوائز",
  "السلف", "دورة تدريبية", "استئذان", "تصفية مستحقات", "وظيفة شاغرة", "استقالة", "مهمة عمل", "صرف عمولات المندوبين", "إغلاق عهدة مالية", "صرف مستحقات إدارة",
  "صرف", "عمل إضافي", "انتداب", "أخرى", "إقالة موظف", "صرف إمتياز مالي", "صرف عمولة", "صرف عمولة مشرف", "إنهاء خدمة موظف", "صرف المستحقات",
  "شراء", "مباشرة العمل", "الموافقة على تقييم", "اعتماد مخالفة", "تعديل راتب", "عهدة مالية", "مخالصة ذمة موظف",
];

type Policies = {
  eSignature: string;
  autoDelegation: string;
  autoBypass: string;
  relatedRequests: string[];
};

const defaults: Policies = {
  eSignature: "yes",
  autoDelegation: "no",
  autoBypass: "no",
  relatedRequests: [...flatRequestTypes],
};

export default function HRApprovalsPolicies() {
  const { t, direction } = useI18n();
  const [policies, setPolicies] = useState<Policies>(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("hr_settings")
        .select("setting_value")
        .eq("setting_key", SETTING_KEY)
        .maybeSingle();
      if (error) {
        toast({ title: t("تعذر تحميل السياسات المحفوظة"), description: error.message, variant: "destructive" });
      }
      if (data?.setting_value) {
        setPolicies({ ...defaults, ...(data.setting_value as Partial<Policies>) });
      }
      setLoading(false);
    })();
  }, []);

  const toggleType = (type: string) => {
    setPolicies((p) => ({
      ...p,
      relatedRequests: p.relatedRequests.includes(type)
        ? p.relatedRequests.filter((t) => t !== type)
        : [...p.relatedRequests, type],
    }));
  };

  const toggleAll = (checked: boolean) => {
    setPolicies((p) => ({ ...p, relatedRequests: checked ? [...flatRequestTypes] : [] }));
  };

  const handleSave = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("hr_settings")
      .upsert(
        [{ setting_key: SETTING_KEY, setting_value: policies, updated_at: new Date().toISOString() }],
        { onConflict: "company_id,setting_key" },
      );
    setSaving(false);
    if (error) {
      toast({ title: t("تعذّر الحفظ"), description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: t("تم حفظ سياسات الموافقات بنجاح") });
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

  const allSelected = policies.relatedRequests.length === flatRequestTypes.length;

  return (
    <Layout>
      <div className="p-6 max-w-[1600px] mx-auto space-y-6" dir={direction}>
        <div className="bg-white rounded-lg border shadow-sm p-6">
          <div className="text-right font-semibold text-lg text-gray-800 border-b pb-4 mb-6">
            {t("سياسات الموافقات والتوقيع الالكتروني")}
          </div>
          <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
            {t("هذه السياسات محفوظة لكنها لا تُطبّق تلقائيًا بعد")}
          </div>

          <div className="space-y-8">
            <div className="space-y-3">
              <Label className="text-sm font-medium">{t("تفعيل التوقيع الالكتروني في معالجة الطلبات")}</Label>
              <RadioGroup
                value={policies.eSignature}
                onValueChange={(v) => setPolicies((p) => ({ ...p, eSignature: v }))}
                className="flex gap-6 mt-2"
              >
                <div className="flex items-center space-x-2 space-x-reverse">
                  <RadioGroupItem value="yes" id="e_sig_yes" />
                  <Label htmlFor="e_sig_yes" className="font-normal cursor-pointer">{t("نعم")}</Label>
                </div>
                <div className="flex items-center space-x-2 space-x-reverse">
                  <RadioGroupItem value="no" id="e_sig_no" />
                  <Label htmlFor="e_sig_no" className="font-normal cursor-pointer">{t("لا")}</Label>
                </div>
              </RadioGroup>
              <div className="p-3 bg-gray-50 border rounded-md text-sm text-gray-600 mt-2">
                {t("في حال تفعيل التوقيع الالكتروني على معالجة الطلبات لن يسمح باستكمال الموافقة على الطلب في حال كان المستخدم لم يقوم برفع توقيعه الالكتروني")}
              </div>
            </div>

            <div className="space-y-4">
              <Label className="text-sm font-bold text-gray-800 border-b pb-2 block">{t("الطلبات المرتبطة")}</Label>

              <div className="flex items-center space-x-2 space-x-reverse mb-4">
                <Checkbox id="select_all" checked={allSelected} onCheckedChange={(c) => toggleAll(Boolean(c))} />
                <Label htmlFor="select_all" className="font-medium cursor-pointer">{t("اختيار الكل")}</Label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-y-3 gap-x-8">
                {flatRequestTypes.map((type, index) => (
                  <div key={index} className="flex items-center space-x-2 space-x-reverse">
                    <Checkbox
                      id={`type_${index}`}
                      checked={policies.relatedRequests.includes(type)}
                      onCheckedChange={() => toggleType(type)}
                    />
                    <Label htmlFor={`type_${index}`} className="font-normal cursor-pointer text-sm">{t(type)}</Label>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3 pt-4 border-t">
              <Label className="text-sm font-medium">{t("تفعيل التفويض التلقائي للموظف البديل لمعالجة الطلبات")}</Label>
              <RadioGroup
                value={policies.autoDelegation}
                onValueChange={(v) => setPolicies((p) => ({ ...p, autoDelegation: v }))}
                className="flex gap-6 mt-2"
              >
                <div className="flex items-center space-x-2 space-x-reverse">
                  <RadioGroupItem value="yes" id="auto_del_yes" />
                  <Label htmlFor="auto_del_yes" className="font-normal cursor-pointer">{t("نعم")}</Label>
                </div>
                <div className="flex items-center space-x-2 space-x-reverse">
                  <RadioGroupItem value="no" id="auto_del_no" />
                  <Label htmlFor="auto_del_no" className="font-normal cursor-pointer">{t("لا")}</Label>
                </div>
              </RadioGroup>
              <div className="p-3 bg-gray-50 border rounded-md text-sm text-gray-600 mt-2">
                {t("تفويض تلقائي للموظف البديل لمعالجة الطلبات في حال كان الموظف المسؤول في إجازة معتمدة يتم تفويض الموظف البديل لمعالجة الطلبات في فترة إجازة الموظف")}
              </div>
            </div>

            <div className="space-y-3 pt-4 border-t">
              <Label className="text-sm font-medium">{t("تفعيل تجاوز معالجة الطلب التلقائي على الطلب")}</Label>
              <RadioGroup
                value={policies.autoBypass}
                onValueChange={(v) => setPolicies((p) => ({ ...p, autoBypass: v }))}
                className="flex gap-6 mt-2"
              >
                <div className="flex items-center space-x-2 space-x-reverse">
                  <RadioGroupItem value="yes" id="bypass_yes" />
                  <Label htmlFor="bypass_yes" className="font-normal cursor-pointer">{t("نعم")}</Label>
                </div>
                <div className="flex items-center space-x-2 space-x-reverse">
                  <RadioGroupItem value="no" id="bypass_no" />
                  <Label htmlFor="bypass_no" className="font-normal cursor-pointer">{t("لا")}</Label>
                </div>
              </RadioGroup>
              <div className="p-3 bg-gray-50 border rounded-md text-sm text-gray-600 mt-2">
                {t("تفعيل تجاوز الموافقة التلقائي على الطلبات سيتم نقل الطلب المعلق من شخص في سلسلة الاعتماد للشخص التالي إذا تجاوز المهلة المحددة للموافقة أو الرفض")}
              </div>
            </div>

            <div className="flex justify-end pt-6">
              <Button onClick={handleSave} disabled={saving} className="bg-[#004e89] hover:bg-[#003d6d] text-white px-8">
                {saving ? t("جاري الحفظ...") : t("حفظ")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
