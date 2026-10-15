import { useEffect, useState } from "react";
import { CheckCircle2, FileCheck2, Link2, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { useCompany } from "@/lib/companyContext";
import type { ZatcaPhase } from "@/lib/companyProfile";

const PHASE_ERRORS: Record<string, string> = {
  COMPANY_ADMIN_REQUIRED: "تغيير المرحلة لمدير النظام فقط",
  ZATCA_PHASE_INVALID: "مرحلة غير صحيحة",
  COMPANY_VAT_REQUIRED: "الرقم الضريبي للمنشأة غير مسجّل؛ اطلب إضافته من إدارة المنصة أولًا",
  ZATCA_PHASE2_REQUIRES_PRODUCTION:
    "أكمل الربط مع الهيئة في الأسفل وفعّل جهاز الإنتاج أولًا، ثم انتقل للمرحلة الثانية",
  ZATCA_PHASE1_NOT_ALLOWED_AFTER_PHASE2:
    "لا يمكن الرجوع للمرحلة الأولى بعد إرسال فواتير للهيئة أو مع جهاز إنتاج مفعّل",
};

const phaseErrorText = (message: string) => {
  const code = Object.keys(PHASE_ERRORS).find((key) => message.includes(key));
  return code ? PHASE_ERRORS[code] : "تعذر تغيير المرحلة، حاول مرة أخرى";
};

const PHASES: Array<{ value: ZatcaPhase; title: string; subtitle: string; points: string[] }> = [
  {
    value: "phase1",
    title: "المرحلة الأولى",
    subtitle: "مرحلة الإصدار والحفظ",
    points: [
      "تصدر الفواتير والإشعارات إلكترونيًا من النظام، ولا تُرسل للهيئة.",
      "رمز QR يُنشأ لحظة الإصدار: اسم المنشأة، الرقم الضريبي، وقت الفاتورة، الإجمالي مع الضريبة، والضريبة.",
      "الفاتورة لا تُحذف ولا تُعدَّل بعد إصدارها؛ التصحيح بإشعار دائن أو مدين.",
      "تتطلب الرقم الضريبي للمنشأة؛ بدونه لا تصدر فواتير المبيعات ولا الإشعارات.",
    ],
  },
  {
    value: "phase2",
    title: "المرحلة الثانية",
    subtitle: "مرحلة الربط والتكامل",
    points: [
      "كل فاتورة تُرسل للهيئة لحظة إصدارها: اعتماد للفواتير الضريبية، وإبلاغ للمبسطة.",
      "رمز QR يأتي من الفاتورة الموقعة رقميًا بعد قبول الهيئة.",
      "تتطلب إكمال الربط في الأسفل وتفعيل جهاز الإنتاج، وتبدأ في موعد إلزام منشأتك الذي تبلغك به الهيئة.",
      "الإشعار على فاتورة صدرت في المرحلة الأولى يُرسل للهيئة، ومرجعه رقم الفاتورة الأصلية.",
    ],
  },
];

/** مرحلة الفوترة الإلكترونية للمنشأة: الأولى (بلا ربط) أو الثانية (الربط مع الهيئة) */
export default function ZatcaPhaseCard() {
  const company = useCompany();
  const record = company.company;
  const current: ZatcaPhase = record?.zatca_phase === "phase1" ? "phase1" : "phase2";
  const supported = Boolean(record && record.zatca_phase);
  const hasVat = Boolean(String(record?.vat_number ?? "").trim());
  const [selected, setSelected] = useState<ZatcaPhase>(current);
  const [isAdmin, setIsAdmin] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => setSelected(current), [current]);

  useEffect(() => {
    let active = true;
    void supabase.rpc("is_main_system_admin").then(({ data, error }) => {
      if (active) setIsAdmin(!error && data === true);
    });
    return () => {
      active = false;
    };
  }, []);

  const save = async () => {
    if (selected === current || saving) return;
    const message =
      selected === "phase2"
        ? "الانتقال للمرحلة الثانية: كل فاتورة وإشعار يصدر بعد الآن يُرسل للهيئة لحظة إصداره.\nالفواتير السابقة تبقى في المرحلة الأولى، وإشعاراتها بعد الانتقال تُرسل للهيئة.\nانتقل فقط في موعد إلزام منشأتك. متابعة؟"
        : "الرجوع للمرحلة الأولى: الفواتير الجديدة لا تُرسل للهيئة. متابعة؟";
    if (!window.confirm(message)) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc("set_company_zatca_phase", { p_phase: selected });
      if (error) {
        toast({ title: "تعذر تغيير المرحلة", description: phaseErrorText(String(error.message ?? "")), variant: "destructive" });
        setSelected(current);
        return;
      }
      await company.refresh();
      toast({
        title: "تم تغيير مرحلة الفوترة",
        description: selected === "phase2" ? "المنشأة الآن في المرحلة الثانية (الربط مع الهيئة)" : "المنشأة الآن في المرحلة الأولى (الإصدار والحفظ)",
      });
    } finally {
      setSaving(false);
    }
  };

  if (!supported) return null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-950">مرحلة الفوترة الإلكترونية للمنشأة</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            المرحلة الأولى إلزامية على كل منشأة مسجّلة في ضريبة القيمة المضافة. المرحلة الثانية تُطبَّق على دفعات
            تحددها الهيئة وتبلغ بها المنشأة قبل موعدها.
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-bold ${
            current === "phase1" ? "bg-sky-50 text-sky-700" : "bg-emerald-50 text-emerald-700"
          }`}
        >
          الحالية: {current === "phase1" ? "المرحلة الأولى" : "المرحلة الثانية"}
        </span>
      </div>

      {current === "phase1" && (
        <div
          className={`mt-4 rounded-xl px-4 py-3 text-sm font-semibold leading-6 ${
            hasVat ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"
          }`}
        >
          {hasVat
            ? "المرحلة الأولى تعمل الآن: كل فاتورة مبيعات وإشعار يصدر من النظام برمز QR مباشرة، دون ربط مع الهيئة ولا OTP."
            : "المرحلة الأولى مختارة، لكن الرقم الضريبي للمنشأة غير مسجّل: فواتير المبيعات والإشعارات موقوفة حتى تضيفه إدارة المنصة."}
        </div>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {PHASES.map((phase) => {
          const active = selected === phase.value;
          const Icon = phase.value === "phase1" ? FileCheck2 : Link2;
          return (
            <label
              key={phase.value}
              className={`flex cursor-pointer gap-3 rounded-xl border-2 p-4 transition ${
                active ? "border-blue-500 bg-blue-50/60" : "border-slate-200 hover:border-slate-300"
              } ${!isAdmin || saving ? "cursor-not-allowed opacity-80" : ""}`}
            >
              <input
                type="radio"
                name="zatca-phase"
                className="mt-1 h-4 w-4 accent-blue-600"
                checked={active}
                disabled={!isAdmin || saving}
                onChange={() => setSelected(phase.value)}
              />
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-blue-700" />
                  <strong className="text-slate-950">{phase.title}</strong>
                  <span className="text-xs text-slate-500">({phase.subtitle})</span>
                </div>
                <ul className="space-y-1 text-xs leading-5 text-slate-600">
                  {phase.points.map((point) => (
                    <li key={point} className="flex gap-1.5">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </label>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs leading-5 text-slate-500">
          {isAdmin
            ? "كل فاتورة تُختم بمرحلة المنشأة لحظة إصدارها ولا تتغير بعد ذلك."
            : "تغيير المرحلة لمدير النظام فقط."}
          {current === "phase1"
            ? " تفعيل جهاز الإنتاج في الأسفل لا ينقل المنشأة للمرحلة الثانية؛ الانتقال يتم من هنا في موعد إلزامك."
            : ""}
        </p>
        {isAdmin && (
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || selected === current}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            حفظ المرحلة
          </button>
        )}
      </div>
    </section>
  );
}
