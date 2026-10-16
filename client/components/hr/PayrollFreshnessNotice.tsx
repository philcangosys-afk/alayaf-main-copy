import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import type { PayrollAmountDiff, PayrollFreshness } from "@/lib/payrollFreshness";

type Props = {
  /** sender: مسؤول الرواتب، approver: المعتمد في الوارد */
  mode: "sender" | "approver";
  checking: boolean;
  error: string;
  freshness: PayrollFreshness | null;
  /** لمسؤول الرواتب: فتح نافذة إعادة الإرسال للاعتماد */
  onResend?: () => void;
  resendDisabled?: boolean;
};

type Section = { key: string; severe: boolean; title: string; explanation: string; diffs: PayrollAmountDiff[]; resend: boolean };

/** تنبيه: صافٍ محفوظ (في طلب الاعتماد أو معتمد) يختلف عن الحساب بعد إدخال حضور أو غياب أو جزاء */
export default function PayrollFreshnessNotice({ mode, checking, error, freshness, onResend, resendDisabled }: Props) {
  const { t, formatNumber } = useI18n();
  const money = (value: number) => formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (checking) {
    return (
      <p className="payroll-no-print flex items-center gap-2 text-xs text-slate-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {t("جارٍ التحقق من أن الرواتب المحفوظة تطابق الحضور والغياب الحالي...")}
      </p>
    );
  }
  if (error) {
    return (
      <p className="payroll-no-print rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        {t("تعذر التحقق من مطابقة الرواتب المحفوظة للحساب الحالي")}: {error}
      </p>
    );
  }
  const later = freshness?.laterDiffs ?? [];
  if (!freshness || (freshness.diffs.length === 0 && later.length === 0 && freshness.unverified.length === 0)) return null;

  const sections: Section[] = (
    mode === "approver"
      ? [
          {
            key: "approver",
            severe: true,
            title: t("أرقام هذا الطلب قديمة: لا تعتمده"),
            explanation: t("أُدخل حضور أو غياب أو جزاء بعد إرسال الطلب، فالصافي المعروض عليك لم يعد صحيحًا ولو اعتُمد لصُرف الصافي القديم. ارفض الطلب ليعيد مسؤول الرواتب إرساله بالأرقام الحالية."),
            diffs: freshness.diffs,
            resend: false,
          },
          {
            key: "later",
            severe: false,
            title: t("حضور أو غياب لأيام بعد يوم إرسال الطلب"),
            explanation: t("سُجّلت أيام بعد يوم إرسال الطلب تغيّر صافي هؤلاء. الأفضل رفض الطلب ليعيد مسؤول الرواتب إرساله؛ وإن اعتمدته يُصرف الصافي كما أُرسل."),
            diffs: later,
            resend: false,
          },
        ]
      : [
          {
            key: "mine",
            severe: true,
            title: t("طلب الاعتماد فيه أرقام قديمة"),
            explanation: t("حُفظت هذه الرواتب للاعتماد قبل آخر إدخال للحضور أو الغياب أو الجزاءات، ولو اعتُمدت لصُرف الصافي القديم. أعد إرسال الكشف للاعتماد: يحل الطلب الجديد محل طلبك المعلق بالأرقام الحالية."),
            diffs: freshness.diffs.filter((diff) => diff.kind === "pending-mine"),
            resend: true,
          },
          {
            key: "other",
            severe: true,
            title: t("طلب اعتماد لمستخدم آخر فيه أرقام قديمة"),
            explanation: t("هذه الرواتب في طلب اعتماد معلق أرسله مستخدم آخر، فلا يمكنك إعادة إرسالها. اطلب من المعتمد رفض ذلك الطلب، ثم أعد إرسال الكشف."),
            diffs: freshness.diffs.filter((diff) => diff.kind === "pending-other"),
            resend: false,
          },
          {
            key: "decided",
            severe: false,
            title: t("رواتب مقرَّرة بأرقام تختلف عن الحساب الحالي"),
            explanation: t("اعتُمدت هذه الرواتب أو رُحّلت أو قُرّر إيقافها بأرقام تختلف عن الحساب الحالي، ولا تتغير بإعادة الإرسال؛ راجعها مع المحاسبة (قيد تسوية)."),
            diffs: freshness.diffs.filter((diff) => diff.kind === "decided"),
            resend: false,
          },
        ]
  ).filter((section) => section.diffs.length > 0);

  return (
    <div className="payroll-no-print space-y-2">
      {sections.map((section) => (
        <div key={section.key} className={`space-y-2 rounded-lg border px-3 py-3 text-xs ${section.severe ? "border-red-300 bg-red-50 text-red-900" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="text-sm font-bold">{section.title}</p>
                <p className="mt-1 leading-5">{section.explanation}</p>
              </div>
            </div>
            {section.resend && onResend && (
              <Button size="sm" onClick={onResend} disabled={resendDisabled} className="bg-red-700 text-white hover:bg-red-800">
                <RefreshCw className="h-3.5 w-3.5" />
                {t("إعادة الإرسال للاعتماد بالأرقام الحالية")}
              </Button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse bg-white/70 text-start">
              <thead>
                <tr className="border-b border-black/15">
                  <th className="px-2 py-1.5">{t("الرقم الوظيفي")}</th>
                  <th className="px-2 py-1.5">{t("الموظف")}</th>
                  <th className="px-2 py-1.5">{t("الحالة")}</th>
                  <th className="px-2 py-1.5">{mode === "approver" ? t("الصافي في الطلب") : t("الصافي المحفوظ")}</th>
                  <th className="px-2 py-1.5">{t("الصافي الآن")}</th>
                  <th className="px-2 py-1.5">{t("تفاصيل الحساب الآن")}</th>
                </tr>
              </thead>
              <tbody>
                {section.diffs.map((diff) => (
                  <tr key={diff.empId} className="border-b border-black/10 align-top">
                    <td className="px-2 py-1.5 font-mono">{diff.empId}</td>
                    <td className="px-2 py-1.5 font-semibold">{diff.name}</td>
                    <td className="px-2 py-1.5">{t(diff.status)}</td>
                    <td className="px-2 py-1.5 line-through decoration-red-500">{money(diff.savedNet)}</td>
                    <td className="px-2 py-1.5 font-bold">{money(diff.currentNet)}</td>
                    <td className="px-2 py-1.5 text-[11px] leading-5">{diff.currentNotes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {freshness.unverified.length > 0 && (
        <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          {t("تعذر التحقق من")}: {freshness.unverified.slice(0, 20).join("، ")}
          {freshness.unverified.length > 20 ? " …" : ""} — {t("لا ملف موظف بهذا الرقم، أو أكثر من ملف بالرقم نفسه")}
        </p>
      )}
    </div>
  );
}
