import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n";
import { isSaudiCompany } from "@/lib/companyProfile";

type PayrollSettings = {
  salaryBasis: string;
  showCooperators: boolean;
  advancePayroll: boolean;
  payDate: string;
  absenceCalc: string;
  normalHourCalc: string;
  otBasic: string;
  otExtra: string;
  overtimeInsurance: boolean;
  excludeAdvances: boolean;
  totalsColumns: string;
  earnedSalary: boolean;
  /** المطبّق فعلًا في كشف الرواتب (مفتاح جديد؛ earnedSalary القديم لم يكن مطبّقًا ولا يُقرأ) */
  earnedSalaryApplied: boolean;
  /** اتباع حقل التأمينات في ملف الموظف عند خصم حصة الموظف (مطبّق) */
  gosiFollowEmployeeFlag: boolean;
  /** أجر الاشتراك في التأمينات يشمل بدل السكن (مطبّق) */
  gosiIncludeHousing: boolean;
  monthDaysMethod: string;
  month31Policy: string;
};

const DEFAULTS: PayrollSettings = {
  salaryBasis: "الأيام",
  showCooperators: false,
  advancePayroll: true,
  payDate: "يوم 30 من الشهر",
  absenceCalc: "basic_allowances",
  normalHourCalc: "basic",
  otBasic: "basic",
  otExtra: "basic",
  overtimeInsurance: false,
  excludeAdvances: false,
  totalsColumns: "الإثنين معاً",
  earnedSalary: false,
  // يُطبَّق في كشف الرواتب: تشغيله يجعل كل يوم عمل بلا تسجيل حضور غيابًا مخصومًا، فالافتراضي إيقافه
  earnedSalaryApplied: false,
  // منذ S11 الافتراضي: الموظف السعودي المسجّل «لا» في ملفه لا يُخصم منه (نموذج الموظف لا يحفظ «لا» إلا باختيار صريح)
  gosiFollowEmployeeFlag: true,
  // منذ S11 الافتراضي: أجر الاشتراك = الأساسي + بدل السكن كما في نظام التأمينات
  gosiIncludeHousing: true,
  monthDaysMethod: "30 يوم ثابت (افتراضي حسب نظام العمل السعودي)",
  month31Policy: "لصالح الموظف (متساهل)",
};

const SETTING_KEY = "payroll_settings";

export default function HRPayrollSettings() {
  const { t, direction } = useI18n();
  const [s, setS] = useState<PayrollSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // إن تعذر التحميل لا يُسمح بالحفظ، حتى لا تُستبدل الإعدادات المحفوظة بالقيم الافتراضية
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from("hr_settings")
          .select("setting_value")
          .eq("setting_key", SETTING_KEY)
          .maybeSingle();
        if (error) throw error;
        if (data?.setting_value) {
          setS({ ...DEFAULTS, ...(data.setting_value as Partial<PayrollSettings>) });
        }
      } catch (error) {
        setLoadError(String((error as { message?: string } | null)?.message ?? "") || "تعذر تحميل الإعدادات");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const set = <K extends keyof PayrollSettings>(key: K, value: PayrollSettings[K]) =>
    setS((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    if (loadError) return;
    setSaving(true);
    const { error } = await supabase
      .from("hr_settings")
      .upsert([{ setting_key: SETTING_KEY, setting_value: s, updated_at: new Date().toISOString() }], { onConflict: "company_id,setting_key" });
    setSaving(false);
    if (error) {
      toast({ title: t("تعذر الحفظ"), description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: t("تم الحفظ"), description: t("تم حفظ إعدادات حساب الراتب؛ تُطبَّق على الكشوف التي تُحسب أو يُعاد إرسالها بعد الآن") });
  };

  const Radio = ({ name, checked, onChange, label }: { name: string; checked: boolean; onChange: () => void; label: string }) => (
    <label className="flex items-center gap-2 cursor-pointer">
      <input type="radio" name={name} checked={checked} onChange={onChange} className="text-[#004e89] focus:ring-[#004e89] w-4 h-4" />
      <span className="text-sm text-gray-700">{t(label)}</span>
    </label>
  );

  const YesNo = ({ name, value, onChange }: { name: string; value: boolean; onChange: (v: boolean) => void }) => (
    <div className="flex gap-6 mt-2">
      <Radio name={name} checked={value} onChange={() => onChange(true)} label="نعم" />
      <Radio name={name} checked={!value} onChange={() => onChange(false)} label="لا" />
    </div>
  );

  if (loading) {
    return (
      <Layout>
        <div className="p-6 text-center text-gray-400" dir={direction}>{t("جاري تحميل الإعدادات...")}</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-6 max-w-[1200px] mx-auto space-y-8" dir={direction}>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-4 border-b border-gray-100">
            <h2 className="text-lg font-bold text-gray-800">{t("إعدادات حساب الراتب")}</h2>
          </div>

          <div className="mx-8 mt-6 space-y-1 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
            <p className="font-semibold">{t("المطبّق في كشف الرواتب وحساب الدوام:")}</p>
            <p>{t("طريقة احتساب قيمة أيام الغياب، وطريقة حساب أيام الشهر، واستثناء السلف من الاقتطاعات، ونظام الراتب المكتسب حسب الحضور. الحقول المعلَّمة «مطبّق» تغيّر الأرقام مباشرة؛ الباقي يُحفظ ولا يُستخدم بعد.")}</p>
            <p className="text-xs text-sky-700">{t("خيار «البدلات + الامتيازات» يُحسب حاليًا كالبدلات لعدم وجود امتيازات مسجلة للموظفين.")}</p>
            <p className="text-xs text-sky-700">{t("الإجازات: نوع «مدفوعة = لا» يُخصم يومه كاملًا، ونسبة الخصم في تصنيفات الإجازات تُطبّق، والمرضية حسب المادة 117 (30 يومًا كاملة، ثم 60 بثلاثة أرباع، ثم 30 بلا أجر)، بالأيام التقويمية. من لم يعمل أي يوم في الشهر (غياب أو إجازة بدون راتب في كل أيام عمله) لا يُستحق له أجر الشهر.")}</p>
          </div>

          <div className="p-8 space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-8">
                <div className="space-y-3">
                  <label className="text-sm font-medium text-gray-700 flex items-center gap-1">{t("حساب الراتب")} <span className="text-red-500">*</span></label>
                  <select value={s.salaryBasis} onChange={(e) => set("salaryBasis", e.target.value)} className="w-full h-10 border border-gray-300 rounded-md px-3 bg-white text-sm focus:ring-2 focus:ring-[#004e89] outline-none">
                    <option value="الأيام">{t("الأيام")}</option>
                    <option value="الساعات">{t("الساعات")}</option>
                  </select>
                  <p className="text-xs text-gray-400">{t("اختر طريقة حساب قيمة الراتب للحضور والغياب")}</p>
                </div>

                <div className="space-y-3">
                  <label className="text-sm font-medium text-gray-700">{t("عرض المتعاونين في كشف الراتب")}</label>
                  <YesNo name="cooperators" value={s.showCooperators} onChange={(v) => set("showCooperators", v)} />
                </div>

                <div className="space-y-3">
                  <label className="text-sm font-medium text-gray-700">{t("تفعيل إمكانية اصدار حساب الراتب مقدما")}</label>
                  <YesNo name="advance_payroll" value={s.advancePayroll} onChange={(v) => set("advancePayroll", v)} />
                </div>

                <div className="space-y-3">
                  <label className="text-sm font-medium text-gray-700 flex items-center gap-1">{t("حدد تاريخ صرف الراتب")} <span className="text-red-500">*</span></label>
                  <select value={s.payDate} onChange={(e) => set("payDate", e.target.value)} className="w-full h-10 border border-gray-300 rounded-md px-3 bg-white text-sm focus:ring-2 focus:ring-[#004e89] outline-none">
                    <option value="يوم 25 من الشهر">{t("يوم 25 من الشهر")}</option>
                    <option value="يوم 27 من الشهر">{t("يوم 27 من الشهر")}</option>
                    <option value="يوم 30 من الشهر">{t("يوم 30 من الشهر")}</option>
                    <option value="آخر يوم في الشهر">{t("آخر يوم في الشهر")}</option>
                  </select>
                </div>
              </div>

              <div className="space-y-8">
                <div className="space-y-3">
                  <label className="text-sm font-medium text-gray-700 flex items-center gap-1">{t("طريقة احتساب قيمة أيام الغياب")} <span className="text-red-500">*</span> <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">{t("مطبّق")}</span></label>
                  <div className="space-y-3 mt-2">
                    <Radio name="absence_calc" checked={s.absenceCalc === "basic"} onChange={() => set("absenceCalc", "basic")} label="من الراتب الأساسي" />
                    <Radio name="absence_calc" checked={s.absenceCalc === "basic_allowances"} onChange={() => set("absenceCalc", "basic_allowances")} label="من إجمالي الراتب الأساسي + البدلات (الافتراضي)" />
                    <Radio name="absence_calc" checked={s.absenceCalc === "basic_allowances_privileges"} onChange={() => set("absenceCalc", "basic_allowances_privileges")} label="من إجمالي الراتب الأساسي + البدلات + الإمتيازات" />
                  </div>
                </div>

                <div className="space-y-3 pt-2">
                  <label className="text-sm font-medium text-gray-700 flex items-center gap-1">{t("احتساب قيمة الساعة العادية للموظف")} <span className="text-red-500">*</span></label>
                  <div className="space-y-3 mt-2">
                    <Radio name="normal_hour_calc" checked={s.normalHourCalc === "basic"} onChange={() => set("normalHourCalc", "basic")} label="من الراتب الأساسي / 30 يوم / على عدد ساعات الدوام" />
                    <Radio name="normal_hour_calc" checked={s.normalHourCalc === "basic_allowances"} onChange={() => set("normalHourCalc", "basic_allowances")} label="من (الأساسي + البدلات) / 30 يوم / على عدد ساعات الدوام" />
                    <Radio name="normal_hour_calc" checked={s.normalHourCalc === "basic_allowances_privileges"} onChange={() => set("normalHourCalc", "basic_allowances_privileges")} label="من (الأساسي + البدلات + الإمتيازات) / 30 يوم / على ساعات الدوام" />
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-6 border-t border-gray-100">
              <div className="space-y-3">
                <label className="text-sm font-medium text-gray-700 flex items-center gap-1">{t("احتساب الساعة الإضافية حتى 100%")} <span className="text-red-500">*</span></label>
                <div className="space-y-3 mt-2">
                  <Radio name="ot_basic" checked={s.otBasic === "basic"} onChange={() => set("otBasic", "basic")} label="من الراتب الأساسي (الافتراضي)" />
                  <Radio name="ot_basic" checked={s.otBasic === "basic_allowances"} onChange={() => set("otBasic", "basic_allowances")} label="من إجمالي الراتب الأساسي + البدلات" />
                  <Radio name="ot_basic" checked={s.otBasic === "basic_allowances_privileges"} onChange={() => set("otBasic", "basic_allowances_privileges")} label="من إجمالي الراتب الأساسي + البدلات + الإمتيازات" />
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-sm font-medium text-gray-700 flex items-center gap-1">{t("احتساب الساعة الإضافية فوق 100%")} <span className="text-red-500">*</span></label>
                <div className="space-y-3 mt-2">
                  <Radio name="ot_extra" checked={s.otExtra === "basic"} onChange={() => set("otExtra", "basic")} label="من الراتب الأساسي (الافتراضي)" />
                  <Radio name="ot_extra" checked={s.otExtra === "basic_allowances"} onChange={() => set("otExtra", "basic_allowances")} label="من إجمالي الراتب الأساسي + البدلات" />
                  <Radio name="ot_extra" checked={s.otExtra === "basic_allowances_privileges"} onChange={() => set("otExtra", "basic_allowances_privileges")} label="من إجمالي الراتب الأساسي + البدلات + الإمتيازات" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-6 border-t border-gray-100">
              {isSaudiCompany() ? (
                <div className="space-y-3">
                  <label className="text-sm font-medium text-gray-700 flex items-center gap-1">{t("تفعيل التأمين على الساعات الإضافية")} <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{t("غير مطبّق")}</span></label>
                  <select value={s.overtimeInsurance ? "نعم" : "لا"} onChange={(e) => set("overtimeInsurance", e.target.value === "نعم")} className="w-full h-10 border border-gray-300 rounded-md px-3 bg-white text-sm focus:ring-2 focus:ring-[#004e89] outline-none">
                    <option value="لا">{t("لا")}</option>
                    <option value="نعم">{t("نعم")}</option>
                  </select>
                </div>
              ) : null}

              <div className="space-y-3">
                <label className="text-sm font-medium text-gray-700 flex items-center gap-1">{t("استثناء السلف من الاقتطاعات")} <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">{t("مطبّق")}</span></label>
                <YesNo name="exclude_advances" value={s.excludeAdvances} onChange={(v) => set("excludeAdvances", v)} />
              </div>

              <div className="space-y-3">
                <label className="text-sm font-medium text-gray-700">{t("أعمدة الإجماليات في كشف الراتب")}</label>
                <select value={s.totalsColumns} onChange={(e) => set("totalsColumns", e.target.value)} className="w-full h-10 border border-gray-300 rounded-md px-3 bg-white text-sm focus:ring-2 focus:ring-[#004e89] outline-none">
                  <option value="الإثنين معاً">{t("الإثنين معاً")}</option>
                  <option value="الإجمالي فقط">{t("الإجمالي فقط")}</option>
                  <option value="الصافي فقط">{t("الصافي فقط")}</option>
                </select>
              </div>
            </div>

            <div className="pt-6 border-t border-gray-100">
              <h3 className="text-[#004e89] font-bold text-base mb-6 border-s-4 border-[#004e89] ps-3">{t("إعدادات طريقة احتساب الراتب")}</h3>
              <div className="space-y-3">
                <label className="text-sm font-medium text-gray-700 flex items-center gap-1">{t("تفعيل نظام الراتب المكتسب حسب الحضور")} <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">{t("مطبّق")}</span></label>
                <YesNo name="earned_salary" value={s.earnedSalaryApplied} onChange={(v) => set("earnedSalaryApplied", v)} />
                <p className="text-xs text-gray-500 mt-2">{t("لا: يُخصم الغياب المسجَّل في الحضور فقط (حالة «غائب»). نعم: كل يوم عمل ماضٍ ليس فيه تسجيل حضور ولا إجازة معتمدة ولا عطلة يُحتسب غيابًا ويُخصم، إلا للموظف المعفى من الحضور.")}</p>
                {s.earnedSalaryApplied && <p className="mt-1 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{t("تنبيه: فعّله فقط إذا كان كل الموظفين يسجلون حضورهم يوميًا؛ وإلا خُصمت أيام موظفين لا يستخدمون البصمة.")}</p>}
              </div>
              {/* إعدادات التأمينات الاجتماعية لمنشآت السعودية فقط (S14) */}
              {isSaudiCompany() ? (
                <>
                  <div className="space-y-3 mt-6">
                    <label className="text-sm font-medium text-gray-700 flex items-center gap-1">{t("اتباع حقل التأمينات الاجتماعية في ملف الموظف")} <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">{t("مطبّق")}</span></label>
                    <YesNo name="gosi_follow_flag" value={s.gosiFollowEmployeeFlag} onChange={(v) => set("gosiFollowEmployeeFlag", v)} />
                    <p className="text-xs text-gray-500 mt-2">{t("نعم (الافتراضي): الموظف السعودي المسجّل في ملفه «غير مشمول» لا يُخصم منه ولا تُحسب عليه حصة المنشأة. لا: تُخصم حصة الموظف من كل موظف سعودي، إلا نوع «سعودي غير قابل للخصم».")}</p>
                    {s.gosiFollowEmployeeFlag && <p className="mt-1 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{t("تنبيه: الموظف السعودي المسجّل «لا» في ملفه لا يُخصم منه ولا تُحسب عليه حصة المنشأة. راجع صفحة التأمينات الاجتماعية وتأكد من ملفات السعوديين.")}</p>}
                  </div>
                  <div className="space-y-3 mt-6">
                    <label className="text-sm font-medium text-gray-700 flex items-center gap-1">{t("أجر الاشتراك في التأمينات يشمل بدل السكن")} <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">{t("مطبّق")}</span></label>
                    <YesNo name="gosi_include_housing" value={s.gosiIncludeHousing} onChange={(v) => set("gosiIncludeHousing", v)} />
                    <p className="text-xs text-gray-500 mt-2">{t("نعم (الافتراضي): حصة الموظف وحصة المنشأة من الأساسي + بدل السكن بحد 45,000 كما في نظام التأمينات. لا: من الراتب الأساسي فقط. اختر ما يطابق الأجر المسجّل لموظفيك في التأمينات الاجتماعية، فالخصم يجب أن يساوي ما تطالب به التأمينات.")}</p>
                  </div>
                </>
              ) : null}
            </div>

            <div className="pt-6 border-t border-gray-100">
              <h3 className="text-[#004e89] font-bold text-base mb-6 border-s-4 border-[#004e89] ps-3">{t("إعدادات أيام الشهر")}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-3">
                  <label className="text-sm font-medium text-gray-700 flex items-center gap-1">{t("طريقة حساب أيام الشهر")} <span className="text-red-500">*</span> <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">{t("مطبّق")}</span></label>
                  <select value={s.monthDaysMethod} onChange={(e) => set("monthDaysMethod", e.target.value)} className="w-full h-10 border border-gray-300 rounded-md px-3 bg-white text-sm focus:ring-2 focus:ring-[#004e89] outline-none">
                    <option value="30 يوم ثابت (افتراضي حسب نظام العمل السعودي)">{t("30 يوم ثابت (افتراضي حسب نظام العمل السعودي)")}</option>
                    <option value="عدد أيام الشهر الفعلي">{t("عدد أيام الشهر الفعلي")}</option>
                  </select>
                </div>

                <div className="space-y-3">
                  <label className="text-sm font-medium text-gray-700 flex items-center gap-1">{t("سياسة الأشهر ذات 31 يوم")} <span className="text-red-500">*</span></label>
                  <select value={s.month31Policy} onChange={(e) => set("month31Policy", e.target.value)} className="w-full h-10 border border-gray-300 rounded-md px-3 bg-white text-sm focus:ring-2 focus:ring-[#004e89] outline-none">
                    <option value="لصالح الموظف (متساهل)">{t("لصالح الموظف (متساهل)")}</option>
                    <option value="لصالح الشركة">{t("لصالح الشركة")}</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="pt-6 border-t border-gray-100 flex justify-end">
              {loadError && <p className="me-4 self-center text-sm text-red-600">{t("تعذر تحميل الإعدادات المحفوظة؛ الحفظ معطّل حتى لا تُستبدل بالقيم الافتراضية")}: {loadError}</p>}
              <Button onClick={handleSave} disabled={saving || Boolean(loadError)} className="bg-[#004e89] hover:bg-[#003865] text-white px-8 h-10 rounded-md">
                {saving ? t("جاري الحفظ...") : t("حفظ")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
