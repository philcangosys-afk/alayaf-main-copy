import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { CalendarClock, Info, Lock, Megaphone, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { useCompany } from "@/lib/companyContext";
import { subscriptionNotice, type SubscriptionInfo } from "@/lib/subscription";

const TONES = {
  info: { box: "border-sky-200 bg-sky-50 text-sky-950", icon: "bg-sky-100 text-sky-700", bar: "bg-sky-500", track: "bg-sky-100", link: "bg-sky-700 hover:bg-sky-800" },
  warning: { box: "border-amber-200 bg-amber-50 text-amber-950", icon: "bg-amber-100 text-amber-700", bar: "bg-amber-500", track: "bg-amber-100", link: "bg-amber-700 hover:bg-amber-800" },
  danger: { box: "border-rose-200 bg-rose-50 text-rose-950", icon: "bg-rose-100 text-rose-700", bar: "bg-rose-500", track: "bg-rose-100", link: "bg-rose-700 hover:bg-rose-800" },
} as const;

const ANNOUNCEMENT_TONES = {
  info: "border-indigo-200 bg-indigo-50 text-indigo-950",
  success: "border-emerald-200 bg-emerald-50 text-emerald-950",
  warning: "border-amber-200 bg-amber-50 text-amber-950",
} as const;

/** نسبة ما بقي من الفترة التجريبية (للشريط) */
function trialRemaining(sub: SubscriptionInfo): number | null {
  if (sub.state !== "trial" || !sub.trial_started_at || !sub.trial_ends_at) return null;
  const start = new Date(sub.trial_started_at).getTime();
  const end = new Date(sub.trial_ends_at).getTime();
  if (!(end > start)) return null;
  return Math.min(1, Math.max(0, (end - Date.now()) / (end - start)));
}

const readFlag = (storage: "local" | "session", key: string) => {
  try {
    return (storage === "local" ? localStorage : sessionStorage).getItem(key) === "1";
  } catch {
    return false;
  }
};
const writeFlag = (storage: "local" | "session", key: string) => {
  try {
    (storage === "local" ? localStorage : sessionStorage).setItem(key, "1");
  } catch {
    // التخزين غير متاح: يُخفى في هذه الصفحة فقط
  }
};

/**
 * S15: تنبيه الاشتراك أعلى كل صفحات النظام: الأيام المتبقية من التجربة، والقراءة فقط، ومهلة التجديد،
 * وإعلانات المنصة. تنبيه التجربة العادي يُخفى لليوم الحالي، والتحذيرات لا تُخفى.
 * variant="portal" (بوابة الموظف): تنبيه القراءة فقط وحده، بلا زر الاشتراك ولا إعلانات المنصة.
 */
export default function SubscriptionBanner({ variant = "full" }: { variant?: "full" | "portal" }) {
  const { subscription, company } = useCompany();
  const { t } = useI18n();
  const location = useLocation();
  const [, rerender] = useState(0);
  if (!subscription) return null;

  const portal = variant === "portal";
  const raw = subscriptionNotice(subscription);
  const notice = portal && raw?.tone !== "danger" ? null : raw;
  const noticeKey = `subscription-note-${company?.code ?? ""}-${subscription.state}-${subscription.days_left ?? ""}`;
  const noticeHidden = notice?.tone === "info" && readFlag("session", noticeKey);
  const announcements = portal ? [] : (subscription.announcements ?? []).filter((a) => !readFlag("local", `announcement-hidden-${a.id}`));
  const onSubscriptionPage = portal || location.pathname.startsWith("/subscription");
  const remaining = trialRemaining(subscription);
  const ctaLabel =
    subscription.state === "trial"
      ? "الباقات والأسعار"
      : ["active", "grace", "past_due", "cancelled", "expired"].includes(subscription.state)
        ? "جدّد الاشتراك"
        : subscription.state === "read_only"
          ? "تفاصيل الاشتراك"
          : "فعّل الاشتراك";

  if ((!notice || noticeHidden) && announcements.length === 0) return null;

  return (
    <div className="mx-4 mt-3 space-y-2" dir="rtl">
      {notice && !noticeHidden ? (
        <div role={notice.tone === "danger" ? "alert" : "status"} className={cn("rounded-xl border px-4 py-3", TONES[notice.tone].box)}>
          <div className="flex items-start gap-3">
            <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", TONES[notice.tone].icon)}>
              {notice.tone === "danger" ? <Lock className="h-4 w-4" /> : <CalendarClock className="h-4 w-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-bold leading-6">{t(notice.title)}</p>
              <p className="text-[12.5px] leading-6 opacity-80">
                {t(portal ? "يمكنك استعراض بياناتك، ولا يمكن تسجيل حضور أو إرسال طلبات حتى تفعّل إدارة المنشأة الاشتراك." : notice.body)}
              </p>
              {remaining !== null ? (
                <div className={cn("mt-2 h-1.5 w-full max-w-xs overflow-hidden rounded-full", TONES[notice.tone].track)} aria-hidden>
                  <div className={cn("h-full rounded-full", TONES[notice.tone].bar)} style={{ width: `${Math.round(remaining * 100)}%` }} />
                </div>
              ) : null}
              {!onSubscriptionPage ? (
                <Link
                  to="/subscription"
                  className={cn("mt-2.5 inline-flex rounded-lg px-3.5 py-2 text-[12.5px] font-bold text-white transition-colors sm:hidden", TONES[notice.tone].link)}
                >
                  {t(ctaLabel)}
                </Link>
              ) : null}
            </div>
            {!onSubscriptionPage ? (
              <Link
                to="/subscription"
                className={cn("hidden shrink-0 self-center rounded-lg px-3.5 py-2 text-[12.5px] font-bold text-white transition-colors sm:inline-flex", TONES[notice.tone].link)}
              >
                {t(ctaLabel)}
              </Link>
            ) : null}
            {notice.tone === "info" ? (
              <button
                type="button"
                onClick={() => {
                  writeFlag("session", noticeKey);
                  rerender((n) => n + 1);
                }}
                className="shrink-0 rounded-md p-1 opacity-60 hover:bg-black/5 hover:opacity-100"
                aria-label={t("إخفاء التنبيه")}
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {announcements.map((a) => (
        <div key={a.id} className={cn("flex items-start gap-3 rounded-xl border px-4 py-2.5", ANNOUNCEMENT_TONES[a.level] ?? ANNOUNCEMENT_TONES.info)}>
          {a.level === "warning" ? <Info className="mt-1 h-4 w-4 shrink-0" /> : <Megaphone className="mt-1 h-4 w-4 shrink-0" />}
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-bold leading-6">{a.title}</p>
            {a.body ? <p className="whitespace-pre-line text-[12.5px] leading-6 opacity-80">{a.body}</p> : null}
          </div>
          <button
            type="button"
            onClick={() => {
              writeFlag("local", `announcement-hidden-${a.id}`);
              rerender((n) => n + 1);
            }}
            className="shrink-0 rounded-md p-1 opacity-60 hover:bg-black/5 hover:opacity-100"
            aria-label={t("إخفاء الإعلان")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
