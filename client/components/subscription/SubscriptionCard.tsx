import { Link } from "react-router-dom";
import { Building2, GitBranch, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { useCompany } from "@/lib/companyContext";
import { STATE_LABELS, daysText, formatDay, type SubscriptionInfo } from "@/lib/subscription";

export function UsageMeter({ label, used, limit, icon: Icon }: { label: string; used: number; limit: number | null; icon: typeof Users }) {
  const { t } = useI18n();
  const ratio = limit ? Math.min(1, used / limit) : 0;
  const over = limit !== null && used > limit;
  const atLimit = limit !== null && used >= limit;
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-[12.5px]">
        <span className="flex items-center gap-1.5 font-semibold text-foreground">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          {t(label)}
        </span>
        <span className={cn("tabular-nums font-bold", over ? "text-rose-600" : atLimit ? "text-amber-600" : "text-muted-foreground")}>
          {used}
          <span className="font-medium"> / {limit === null ? t("بلا حد") : limit}</span>
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", over ? "bg-rose-500" : atLimit || ratio >= 0.8 ? "bg-amber-500" : "bg-emerald-500")}
          style={{ width: limit === null ? "100%" : `${Math.max(4, Math.round(ratio * 100))}%`, opacity: limit === null ? 0.35 : 1 }}
        />
      </div>
    </div>
  );
}

/** حلقة الأيام المتبقية من التجربة أو الفترة */
function DaysRing({ sub }: { sub: SubscriptionInfo }) {
  const { t } = useI18n();
  const days = Math.max(0, Number(sub.days_left ?? 0));
  const start = sub.state === "trial" ? sub.trial_started_at : sub.current_period_start;
  const end = sub.state === "trial" ? sub.trial_ends_at : sub.current_period_end;
  const total = start && end ? Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000)) : Math.max(days, 1);
  const ratio = Math.min(1, days / total);
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const locked = sub.access === "read_only";
  const color = locked ? "#e11d48" : days <= 2 ? "#d97706" : "#059669";
  return (
    <div className="relative h-[88px] w-[88px] shrink-0">
      <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="40" cy="40" r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth="7" />
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={locked ? circumference : circumference * (1 - ratio)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-[22px] font-extrabold tabular-nums" style={{ color }}>{locked ? 0 : days}</span>
        <span className="mt-1 text-[10.5px] font-semibold text-muted-foreground">{t(days === 1 ? "يوم" : days === 2 ? "يومان" : days <= 10 ? "أيام" : "يومًا")}</span>
      </div>
    </div>
  );
}

function headline(sub: SubscriptionInfo): { title: string; body: string } {
  switch (sub.state) {
    case "trial":
      return {
        title: "أنت في الفترة التجريبية المجانية",
        body: `جرّب كل أقسام النظام حتى ${formatDay(sub.trial_ends_at)} (متبقٍ ${daysText(Number(sub.days_left ?? 0))}). بعدها تصبح المنشأة للقراءة فقط حتى تفعيل الاشتراك.`,
      };
    case "trial_expired":
      return { title: "انتهت الفترة التجريبية", body: "بياناتك محفوظة ويمكنك استعراضها وتصديرها. فعّل الاشتراك لتعود الإضافة والتعديل." };
    case "expired":
      return { title: "انتهى الاشتراك", body: "بياناتك محفوظة ويمكنك استعراضها وتصديرها. جدّد الاشتراك لتعود الإضافة والتعديل." };
    case "read_only":
      return { title: "المنشأة في وضع القراءة فقط", body: "أوقفت إدارة المنصة الإضافة والتعديل مؤقتًا. تواصل مع الدعم." };
    case "grace":
      return { title: "انتهت فترة الاشتراك", body: "أنت في مهلة التجديد؛ جدّد قبل انتهائها لتجنّب القراءة فقط." };
    case "past_due":
      return { title: "يوجد مبلغ مستحق", body: "سدّد المستحق ليستمر الاشتراك." };
    case "cancelled":
      return { title: "الاشتراك لن يتجدد", body: `يعمل حتى ${formatDay(sub.current_period_end)}.` };
    case "complimentary":
      return { title: "اشتراك مجاني من المنصة", body: "كل الأقسام متاحة لمنشأتك." };
    default:
      return { title: "اشتراكك فعّال", body: `الفترة الحالية حتى ${formatDay(sub.current_period_end)}.` };
  }
}

/** S15: بطاقة الاشتراك في الرئيسية: الأيام المتبقية، والباقة، واستخدام الحدود */
export default function SubscriptionCard() {
  const { subscription: sub } = useCompany();
  const { t } = useI18n();
  if (!sub || sub.state === "none") return null;
  const { title, body } = headline(sub);
  const showRing = ["trial", "trial_expired", "active", "cancelled"].includes(sub.state) && sub.days_left !== null && sub.days_left !== undefined;
  const usage = sub.usage ?? { users: 0, employees: 0, branches: 0, sales_invoices: 0 };
  const plan = sub.plan;

  return (
    <section className="mb-8 rounded-2xl border border-border/50 bg-white p-5 shadow-sm animate-fade-in-up" dir="rtl">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          {showRing ? <DaysRing sub={sub} /> : null}
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-[11.5px] font-bold",
                  sub.access === "read_only" ? "bg-rose-100 text-rose-700" : sub.state === "trial" ? "bg-sky-100 text-sky-700" : "bg-emerald-100 text-emerald-700",
                )}
              >
                {t(STATE_LABELS[sub.state])}
              </span>
              {plan ? <span className="text-[12px] font-semibold text-muted-foreground">{t("باقة")} {t(plan.name_ar)}</span> : null}
            </div>
            <h2 className="text-[17px] font-extrabold text-foreground">{t(title)}</h2>
            <p className="mt-1 max-w-xl text-[13px] leading-6 text-muted-foreground">{t(body)}</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3 lg:w-[420px]">
          <UsageMeter label="المستخدمون" used={usage.users} limit={plan?.max_users ?? null} icon={Users} />
          <UsageMeter label="الموظفون" used={usage.employees} limit={plan?.max_employees ?? null} icon={Building2} />
          <UsageMeter label="الفروع" used={usage.branches} limit={plan?.max_branches ?? null} icon={GitBranch} />
        </div>
        <Link
          to="/subscription"
          className="inline-flex shrink-0 items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground shadow-sm hover:bg-primary/90"
        >
          {sub.state === "trial" ? t("الباقات والأسعار") : sub.access === "read_only" ? t("فعّل الاشتراك") : t("تفاصيل الاشتراك")}
        </Link>
      </div>
    </section>
  );
}
