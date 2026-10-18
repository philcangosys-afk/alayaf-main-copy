import { useEffect, useMemo, useState, type ReactNode } from "react";
import { companyStorageKey, isSaudiCompany } from "@/lib/companyProfile";
import Layout from "@/components/Layout";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowRight, CalendarClock, MapPin, Save, Settings2 } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import JobTitlesManager from "@/components/hr/JobTitlesManager";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n";
import { hrRequestErrorText } from "@/lib/hrErrors";

type TabKey = "general" | "recruitment" | "payroll" | "leaves" | "attendance";

type HRSettingsState = {
  general: {
    monthlyHours: number;
    overtimeRateSaudi: number;
    overtimeStartAfterHours: number;
    monthlyOvertimeCap: number;
    currency: string;
    probationMonths: number;
    weekendDay1: string;
    weekendDay2: string;
  };
  recruitment: {
    probationDays: number;
    autoCloseRequisitionDays: number;
    minScreeningScore: number;
    defaultContractType: string;
    defaultContractYears: number;
    weeklyWorkHours: number;
    dailyWorkHours: number;
    annualVacationDays: number;
    allowAutoRenew: string;
  };
  payroll: {
    housingAllowancePct: number;
    transportAllowancePct: number;
    gosiEmployeePct: number;
    gosiEmployerPct: number;
    payrollDay: number;
    transferMethod: string;
    wpsEnabled: string;
    eosAfterYears: number;
    eosFactorFirst5: number;
    eosFactorAfter5: number;
  };
  leaves: {
    annualLeaveDays: number;
    marriageLeaveDays: number;
    maternityLeaveDays: number;
    paternityLeaveDays: number;
    emergencyLeaveDays: number;
    sickLeaveDays: number;
    carryForwardDays: number;
    requestBeforeDays: number;
    unpaidLeaveAllowed: string;
  };
  attendance: {
    workDaysPerWeek: number;
    defaultShiftStart: string;
    defaultShiftEnd: string;
    graceMinutes: number;
    overtimeMinMinutes: number;
    latePenaltyEnabled: string;
    absencePenaltyEnabled: string;
    weekendOvertimeMultiplier: number;
  };
};

const defaultSettings: HRSettingsState = {
  general: {
    monthlyHours: 160,
    overtimeRateSaudi: 150,
    overtimeStartAfterHours: 8,
    monthlyOvertimeCap: 40,
    currency: "ريال سعودي",
    probationMonths: 3,
    weekendDay1: "الجمعة",
    weekendDay2: "السبت",
  },
  recruitment: {
    probationDays: 90,
    autoCloseRequisitionDays: 30,
    minScreeningScore: 60,
    defaultContractType: "سنوي",
    defaultContractYears: 1,
    weeklyWorkHours: 48,
    dailyWorkHours: 8,
    annualVacationDays: 30,
    allowAutoRenew: "إجباري",
  },
  payroll: {
    housingAllowancePct: 25,
    transportAllowancePct: 10,
    gosiEmployeePct: 9.75,
    gosiEmployerPct: 11.75,
    payrollDay: 25,
    transferMethod: "تحويل بنكي",
    wpsEnabled: "مفعل",
    eosAfterYears: 5,
    eosFactorFirst5: 0.5,
    eosFactorAfter5: 1,
  },
  leaves: {
    annualLeaveDays: 21,
    marriageLeaveDays: 5,
    maternityLeaveDays: 70,
    paternityLeaveDays: 3,
    emergencyLeaveDays: 5,
    sickLeaveDays: 30,
    carryForwardDays: 15,
    requestBeforeDays: 30,
    unpaidLeaveAllowed: "مسموح",
  },
  attendance: {
    workDaysPerWeek: 6,
    defaultShiftStart: "08:00",
    defaultShiftEnd: "16:00",
    graceMinutes: 15,
    overtimeMinMinutes: 30,
    latePenaltyEnabled: "مفعل",
    absencePenaltyEnabled: "مفعل",
    weekendOvertimeMultiplier: 1.5,
  },
};

function mergeTab<T extends Record<string, unknown>>(defaults: T, incoming: unknown): T {
  if (!incoming || typeof incoming !== "object") return defaults;
  return { ...defaults, ...(incoming as Partial<T>) };
}

// قيم قديمة كانت تُحفظ على هذا الجهاز فقط قبل نقل الإعدادات إلى قاعدة البيانات
/** مفتاح المتصفح خاص بالمنشأة الحالية */
const localSettingsKey = () => companyStorageKey("hr_settings_local");
const SETTINGS_TABS: TabKey[] = ["general", "recruitment", "payroll", "leaves", "attendance"];

function readLocalSettings(): HRSettingsState | null {
  try {
    const raw = localStorage.getItem(localSettingsKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Record<TabKey, unknown>> | null;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      general: mergeTab(defaultSettings.general, parsed.general),
      recruitment: mergeTab(defaultSettings.recruitment, parsed.recruitment),
      payroll: mergeTab(defaultSettings.payroll, parsed.payroll),
      leaves: mergeTab(defaultSettings.leaves, parsed.leaves),
      attendance: mergeTab(defaultSettings.attendance, parsed.attendance),
    };
  } catch {
    return null;
  }
}

function clearLocalSettings() {
  try {
    localStorage.removeItem(localSettingsKey());
  } catch {
    // التخزين المحلي غير متاح: لا شيء نحذفه
  }
}

export default function HRSettings() {
  const { t, direction } = useI18n();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabKey>("general");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<HRSettingsState>(defaultSettings);
  // عند فشل التحميل لا نسمح بالحفظ حتى لا تُكتب القيم الافتراضية فوق إعدادات قاعدة البيانات
  const [loadError, setLoadError] = useState("");
  // قاعدة البيانات فارغة وعُرضت قيم محلية قديمة: الحفظ التالي ينقل كل الأقسام دفعة واحدة
  const [localPending, setLocalPending] = useState(false);

  const tabLabels: Record<TabKey, string> = {
    general: t("الإعدادات العامة"),
    recruitment: t("التوظيف والعقود"),
    payroll: isSaudiCompany() ? t("الرواتب والتأمينات") : t("الرواتب"),
    leaves: t("الإجازات"),
    attendance: t("الدوام"),
  };

  useEffect(() => {
    void loadSettings();
  }, []);

  async function loadSettings() {
    setLoading(true);
    setLoadError("");
    setLocalPending(false);

    let result: any = { error: null, data: null };
    try {
      result = await supabase
        .from("hr_settings")
        .select("setting_key, setting_value")
        .in("setting_key", ["general", "recruitment", "payroll", "leaves", "attendance"]);
    } catch (e) {
      result = { data: null, error: e };
    }

    if (!result.error && result.data) {
      const dbState: HRSettingsState = {
        general: defaultSettings.general,
        recruitment: defaultSettings.recruitment,
        payroll: defaultSettings.payroll,
        leaves: defaultSettings.leaves,
        attendance: defaultSettings.attendance,
      };

      result.data.forEach((row) => {
        const key = String((row as Record<string, unknown>).setting_key ?? "") as TabKey;
        const value = (row as Record<string, unknown>).setting_value;
        if (key === "general") dbState.general = mergeTab(defaultSettings.general, value);
        if (key === "recruitment") dbState.recruitment = mergeTab(defaultSettings.recruitment, value);
        if (key === "payroll") dbState.payroll = mergeTab(defaultSettings.payroll, value);
        if (key === "leaves") dbState.leaves = mergeTab(defaultSettings.leaves, value);
        if (key === "attendance") dbState.attendance = mergeTab(defaultSettings.attendance, value);
      });

      const local = result.data.length === 0 ? readLocalSettings() : null;
      if (local) {
        setSettings(local);
        setLocalPending(true);
      } else {
        setSettings(dbState);
      }
    } else {
      const message = hrRequestErrorText(result.error, "تعذر تحميل الإعدادات من قاعدة البيانات");
      setLoadError(message);
      toast({ title: t("تعذر تحميل الإعدادات"), description: t(message), variant: "destructive" });
    }

    setLoading(false);
  }

  const saveLabel = useMemo(() => {
    if (activeTab === "general") return t("حفظ الإعدادات العامة");
    if (activeTab === "recruitment") return t("حفظ إعدادات التوظيف والعقود");
    if (activeTab === "payroll") return isSaudiCompany() ? t("حفظ إعدادات الرواتب والتأمينات") : t("حفظ إعدادات الرواتب");
    if (activeTab === "leaves") return t("حفظ إعدادات الإجازات");
    return t("حفظ إعدادات الدوام");
  }, [activeTab, t]);

  async function saveCurrentTab() {
    const updatedAt = new Date().toISOString();
    // القيم المحلية تُنقل كلها حتى لا تضيع الأقسام الأخرى بعد حذفها من الجهاز
    const tabsToSave = localPending ? SETTINGS_TABS : [activeTab];
    const payload = tabsToSave.map((tab) => ({
      setting_key: tab,
      setting_value: settings[tab],
      updated_at: updatedAt,
    }));

    if (loadError) {
      toast({ title: t("لم يتم الحفظ"), description: t("أعد تحميل الإعدادات من قاعدة البيانات أولًا"), variant: "destructive" });
      return;
    }

    setSaving(true);

    let result: any = { error: null, data: null };
    try {
      result = await supabase
        .from("hr_settings")
        .upsert(payload, { onConflict: "company_id,setting_key" })
        .select("setting_key");
    } catch (e) {
      result = { error: e, data: null };
    }

    if (!result.error && (result.data?.length ?? 0) >= payload.length) {
      // قاعدة البيانات هي المرجع بعد أي حفظ ناجح: لا حاجة للنسخة المحلية القديمة
      clearLocalSettings();
      if (localPending) {
        setLocalPending(false);
        toast({ title: t("تم الحفظ"), description: t("تم نقل الإعدادات المحلية إلى قاعدة البيانات") });
      } else {
        toast({ title: t("تم الحفظ"), description: t("تم حفظ الإعدادات في قاعدة البيانات") });
      }
    } else {
      toast({
        title: t("لم يتم الحفظ"),
        description: t(result.error
          ? hrRequestErrorText(result.error, "تعذر حفظ الإعدادات في قاعدة البيانات")
          : "لم يُحفظ شيء: لا تملك صلاحية تعديل هذه الإعدادات"),
        variant: "destructive",
      });
    }

    setSaving(false);
  }

  return (
    <Layout>
      <div dir={direction} className="space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings2 className="h-6 w-6 text-gray-700" />
            <h1 className="text-2xl font-bold">{t("إعدادات الموارد البشرية")}</h1>
          </div>
          <button
            onClick={() => navigate("/hr/dashboard")}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-md border border-gray-300 bg-white text-sm hover:bg-gray-50"
          >
            <ArrowRight className="h-4 w-4" />
            {t("العودة")}
          </button>
        </div>

        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800">
          <AlertTriangle className="h-5 w-5 mt-0.5 flex-shrink-0" />
          <p className="text-sm">{t("تنبيه: هذه الإعدادات تُحفظ في قاعدة البيانات لكنها لا تُستخدم بعد في احتساب الرواتب أو الحضور أو الإجازات.")}</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="border-b border-gray-200 p-2 flex flex-wrap gap-2">
            {(Object.keys(tabLabels) as TabKey[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                  activeTab === tab
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {tabLabels[tab]}
              </button>
            ))}
            <span className="hidden sm:block w-px bg-gray-200 mx-1" />
            <button
              onClick={() => navigate("/hr/organization/work-locations")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-50 text-emerald-700 text-sm font-medium hover:bg-emerald-100 transition"
            >
              <MapPin className="h-4 w-4" />
              {t("مواقع العمل")}
            </button>
            <button
              onClick={() => navigate("/hr/organization/work-schedules")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-50 text-emerald-700 text-sm font-medium hover:bg-emerald-100 transition"
            >
              <CalendarClock className="h-4 w-4" />
              {t("جداول العمل والشركات")}
            </button>
          </div>

          <div className="p-4 space-y-4">
            {loading ? <div className="text-center text-gray-500 py-6">{t("جاري تحميل الإعدادات...")}</div> : null}

            {!loading && loadError ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <span>{t("تعذر تحميل الإعدادات من قاعدة البيانات؛ القيم المعروضة افتراضية والحفظ معطّل.")} {t(loadError)}</span>
                <button onClick={() => void loadSettings()} className="rounded-md border border-red-300 bg-white px-3 py-1.5 font-medium hover:bg-red-100">
                  {t("إعادة المحاولة")}
                </button>
              </div>
            ) : null}

            {!loading && !loadError && localPending ? (
              <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>{t("قيم محلية غير محفوظة على هذا الجهاز — اضغط حفظ لنقلها إلى قاعدة البيانات")}</span>
              </div>
            ) : null}

            {!loading && activeTab === "general" ? (
              <>
                <GeneralSettingsTab
                  value={settings.general}
                  onChange={(next) => setSettings((prev) => ({ ...prev, general: next }))}
                />
                <JobTitlesManager embedded />
              </>
            ) : null}

            {!loading && activeTab === "recruitment" ? (
              <RecruitmentSettingsTab
                value={settings.recruitment}
                onChange={(next) => setSettings((prev) => ({ ...prev, recruitment: next }))}
              />
            ) : null}

            {!loading && activeTab === "payroll" ? (
              <PayrollSettingsTab
                value={settings.payroll}
                onChange={(next) => setSettings((prev) => ({ ...prev, payroll: next }))}
              />
            ) : null}

            {!loading && activeTab === "leaves" ? (
              <LeavesSettingsTab
                value={settings.leaves}
                onChange={(next) => setSettings((prev) => ({ ...prev, leaves: next }))}
              />
            ) : null}

            {!loading && activeTab === "attendance" ? (
              <AttendanceSettingsTab
                value={settings.attendance}
                onChange={(next) => setSettings((prev) => ({ ...prev, attendance: next }))}
              />
            ) : null}

            <div className="pt-2">
              <button
                onClick={saveCurrentTab}
                disabled={saving || loading || !!loadError}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-60"
              >
                <Save className="h-4 w-4" />
                {saving ? t("جاري الحفظ...") : saveLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}

function Section({ title, colorClass, children }: { title: string; colorClass: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <div className={`px-3 py-2 text-white text-sm font-semibold ${colorClass}`}>{title}</div>
      <div className="p-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="text-gray-600 text-xs">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function NumberInput({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => onChange(Number(e.target.value || 0))}
      className="w-full rounded border border-gray-300 px-2 py-2"
    />
  );
}

function TextInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded border border-gray-300 px-2 py-2"
    />
  );
}

function SelectInput({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  const { t } = useI18n();
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded border border-gray-300 px-2 py-2 bg-white"
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {t(option)}
        </option>
      ))}
    </select>
  );
}

function GeneralSettingsTab({
  value,
  onChange,
}: {
  value: HRSettingsState["general"];
  onChange: (value: HRSettingsState["general"]) => void;
}) {
  const { t } = useI18n();
  return (
    <Section title={t("الإعدادات العامة")} colorClass="bg-blue-600">
      <Field label={t("عدد ساعات العمل الشهرية")}>
        <NumberInput value={value.monthlyHours} onChange={(v) => onChange({ ...value, monthlyHours: v })} />
      </Field>
      <Field label={t("نسبة الأجر الإضافي السعودي (%)")}>
        <NumberInput value={value.overtimeRateSaudi} onChange={(v) => onChange({ ...value, overtimeRateSaudi: v })} />
      </Field>
      <Field label={t("يبدأ الإضافي بعد (ساعات)")}>
        <NumberInput value={value.overtimeStartAfterHours} onChange={(v) => onChange({ ...value, overtimeStartAfterHours: v })} />
      </Field>
      <Field label={t("الحد الأعلى للإضافي الشهري (ساعة)")}>
        <NumberInput value={value.monthlyOvertimeCap} onChange={(v) => onChange({ ...value, monthlyOvertimeCap: v })} />
      </Field>
      <Field label={t("العملة")}>
        <SelectInput value={value.currency} onChange={(v) => onChange({ ...value, currency: v })} options={["ريال سعودي", "دولار", "درهم"]} />
      </Field>
      <Field label={t("فترة التجربة (بالأشهر)")}>
        <NumberInput value={value.probationMonths} onChange={(v) => onChange({ ...value, probationMonths: v })} />
      </Field>
      <Field label={t("الويكند الأول")}>
        <SelectInput value={value.weekendDay1} onChange={(v) => onChange({ ...value, weekendDay1: v })} options={["الجمعة", "السبت", "الأحد"]} />
      </Field>
      <Field label={t("الويكند الثاني")}>
        <SelectInput value={value.weekendDay2} onChange={(v) => onChange({ ...value, weekendDay2: v })} options={["السبت", "الأحد", "لا يوجد"]} />
      </Field>
    </Section>
  );
}

function RecruitmentSettingsTab({
  value,
  onChange,
}: {
  value: HRSettingsState["recruitment"];
  onChange: (value: HRSettingsState["recruitment"]) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <Section title={t("إعدادات التوظيف")} colorClass="bg-green-600">
        <Field label={t("فترة التجربة (يوم)")}>
          <NumberInput value={value.probationDays} onChange={(v) => onChange({ ...value, probationDays: v })} />
        </Field>
        <Field label={t("إغلاق الطلب الوظيفي بعد (يوم)")}>
          <NumberInput value={value.autoCloseRequisitionDays} onChange={(v) => onChange({ ...value, autoCloseRequisitionDays: v })} />
        </Field>
        <Field label={t("أدنى تقييم للفرز (%)")}>
          <NumberInput value={value.minScreeningScore} onChange={(v) => onChange({ ...value, minScreeningScore: v })} />
        </Field>
        <Field label={t("تجديد العقد تلقائيًا")}>
          <SelectInput value={value.allowAutoRenew} onChange={(v) => onChange({ ...value, allowAutoRenew: v })} options={["إجباري", "اختياري", "معطل"]} />
        </Field>
      </Section>

      <Section title={t("إعدادات العقود")} colorClass="bg-cyan-500">
        <Field label={t("نوع العقد الافتراضي")}>
          <SelectInput value={value.defaultContractType} onChange={(v) => onChange({ ...value, defaultContractType: v })} options={["سنوي", "محدد المدة", "غير محدد المدة"]} />
        </Field>
        <Field label={t("مدة العقد الافتراضية (سنة)")}>
          <NumberInput value={value.defaultContractYears} onChange={(v) => onChange({ ...value, defaultContractYears: v })} />
        </Field>
        <Field label={t("ساعات العمل الأسبوعية")}>
          <NumberInput value={value.weeklyWorkHours} onChange={(v) => onChange({ ...value, weeklyWorkHours: v })} />
        </Field>
        <Field label={t("ساعات العمل اليومية")}>
          <NumberInput value={value.dailyWorkHours} onChange={(v) => onChange({ ...value, dailyWorkHours: v })} />
        </Field>
        <Field label={t("الإجازة السنوية الافتراضية (يوم)")}>
          <NumberInput value={value.annualVacationDays} onChange={(v) => onChange({ ...value, annualVacationDays: v })} />
        </Field>
      </Section>
    </>
  );
}

function PayrollSettingsTab({
  value,
  onChange,
}: {
  value: HRSettingsState["payroll"];
  onChange: (value: HRSettingsState["payroll"]) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <Section title={t("إعدادات الرواتب")} colorClass="bg-yellow-500">
        <Field label={t("بدل السكن (%)")}>
          <NumberInput value={value.housingAllowancePct} onChange={(v) => onChange({ ...value, housingAllowancePct: v })} />
        </Field>
        <Field label={t("بدل النقل (%)")}>
          <NumberInput value={value.transportAllowancePct} onChange={(v) => onChange({ ...value, transportAllowancePct: v })} />
        </Field>
        <Field label={t("تاريخ صرف الراتب")}>
          <NumberInput value={value.payrollDay} onChange={(v) => onChange({ ...value, payrollDay: v })} />
        </Field>
        <Field label={t("طريقة صرف الراتب")}>
          <SelectInput value={value.transferMethod} onChange={(v) => onChange({ ...value, transferMethod: v })} options={["تحويل بنكي", "نقدي", "شيك"]} />
        </Field>
        <Field label={t("WPS نظام حماية الأجور")}>
          <SelectInput value={value.wpsEnabled} onChange={(v) => onChange({ ...value, wpsEnabled: v })} options={["مفعل", "معطل"]} />
        </Field>
      </Section>

      {/* نسب التأمينات الاجتماعية لمنشآت السعودية فقط (S14)؛ إعدادات نهاية الخدمة تبقى للجميع */}
      <Section title={isSaudiCompany() ? t("إعدادات التأمينات الاجتماعية") : t("إعدادات نهاية الخدمة")} colorClass="bg-red-600">
        {isSaudiCompany() ? (
          <>
            <Field label={t("نسبة التأمينات على الموظف (%)")}>
              <NumberInput value={value.gosiEmployeePct} onChange={(v) => onChange({ ...value, gosiEmployeePct: v })} />
            </Field>
            <Field label={t("نسبة التأمينات على صاحب العمل (%)")}>
              <NumberInput value={value.gosiEmployerPct} onChange={(v) => onChange({ ...value, gosiEmployerPct: v })} />
            </Field>
          </>
        ) : null}
        <Field label={t("احتساب نهاية الخدمة بعد (سنة)")}>
          <NumberInput value={value.eosAfterYears} onChange={(v) => onChange({ ...value, eosAfterYears: v })} />
        </Field>
        <Field label={t("معامل نهاية الخدمة أول 5 سنوات")}>
          <NumberInput value={value.eosFactorFirst5} onChange={(v) => onChange({ ...value, eosFactorFirst5: v })} />
        </Field>
        <Field label={t("معامل نهاية الخدمة بعد 5 سنوات")}>
          <NumberInput value={value.eosFactorAfter5} onChange={(v) => onChange({ ...value, eosFactorAfter5: v })} />
        </Field>
      </Section>
    </>
  );
}

function LeavesSettingsTab({
  value,
  onChange,
}: {
  value: HRSettingsState["leaves"];
  onChange: (value: HRSettingsState["leaves"]) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <Section title={t("إعدادات الإجازات")} colorClass="bg-slate-600">
        <Field label={t("إجازة سنوية (يوم)")}>
          <NumberInput value={value.annualLeaveDays} onChange={(v) => onChange({ ...value, annualLeaveDays: v })} />
        </Field>
        <Field label={t("إجازة زواج (يوم)")}>
          <NumberInput value={value.marriageLeaveDays} onChange={(v) => onChange({ ...value, marriageLeaveDays: v })} />
        </Field>
        <Field label={t("إجازة أمومة (يوم)")}>
          <NumberInput value={value.maternityLeaveDays} onChange={(v) => onChange({ ...value, maternityLeaveDays: v })} />
        </Field>
        <Field label={t("إجازة أبوة (يوم)")}>
          <NumberInput value={value.paternityLeaveDays} onChange={(v) => onChange({ ...value, paternityLeaveDays: v })} />
        </Field>
        <Field label={t("إجازة طارئة (يوم)")}>
          <NumberInput value={value.emergencyLeaveDays} onChange={(v) => onChange({ ...value, emergencyLeaveDays: v })} />
        </Field>
        <Field label={t("إجازة مرضية (يوم)")}>
          <NumberInput value={value.sickLeaveDays} onChange={(v) => onChange({ ...value, sickLeaveDays: v })} />
        </Field>
        <Field label={t("ترحيل الإجازات (يوم)")}>
          <NumberInput value={value.carryForwardDays} onChange={(v) => onChange({ ...value, carryForwardDays: v })} />
        </Field>
        <Field label={t("الطلب قبل الإجازة (يوم)")}>
          <NumberInput value={value.requestBeforeDays} onChange={(v) => onChange({ ...value, requestBeforeDays: v })} />
        </Field>
      </Section>

      <Section title={t("الإجازات غير المدفوعة")} colorClass="bg-gray-900">
        <Field label={t("الإجازة غير المدفوعة")}>
          <SelectInput value={value.unpaidLeaveAllowed} onChange={(v) => onChange({ ...value, unpaidLeaveAllowed: v })} options={["مسموح", "غير مسموح"]} />
        </Field>
      </Section>
    </>
  );
}

function AttendanceSettingsTab({
  value,
  onChange,
}: {
  value: HRSettingsState["attendance"];
  onChange: (value: HRSettingsState["attendance"]) => void;
}) {
  const { t } = useI18n();
  return (
    <Section title={t("إعدادات الدوام")} colorClass="bg-indigo-700">
      <Field label={t("عدد أيام العمل بالأسبوع")}>
        <NumberInput value={value.workDaysPerWeek} onChange={(v) => onChange({ ...value, workDaysPerWeek: v })} />
      </Field>
      <Field label={t("بداية الدوام الافتراضية")}>
        <TextInput value={value.defaultShiftStart} onChange={(v) => onChange({ ...value, defaultShiftStart: v })} />
      </Field>
      <Field label={t("نهاية الدوام الافتراضية")}>
        <TextInput value={value.defaultShiftEnd} onChange={(v) => onChange({ ...value, defaultShiftEnd: v })} />
      </Field>
      <Field label={t("فترة السماح (دقيقة)")}>
        <NumberInput value={value.graceMinutes} onChange={(v) => onChange({ ...value, graceMinutes: v })} />
      </Field>
      <Field label={t("الحد الأدنى للإضافي (دقيقة)")}>
        <NumberInput value={value.overtimeMinMinutes} onChange={(v) => onChange({ ...value, overtimeMinMinutes: v })} />
      </Field>
      <Field label={t("خصم التأخير")}>
        <SelectInput value={value.latePenaltyEnabled} onChange={(v) => onChange({ ...value, latePenaltyEnabled: v })} options={["مفعل", "معطل"]} />
      </Field>
      <Field label={t("خصم الغياب")}>
        <SelectInput value={value.absencePenaltyEnabled} onChange={(v) => onChange({ ...value, absencePenaltyEnabled: v })} options={["مفعل", "معطل"]} />
      </Field>
      <Field label={t("معامل إضافي أيام الراحة")}>
        <NumberInput value={value.weekendOvertimeMultiplier} onChange={(v) => onChange({ ...value, weekendOvertimeMultiplier: v })} />
      </Field>
    </Section>
  );
}
