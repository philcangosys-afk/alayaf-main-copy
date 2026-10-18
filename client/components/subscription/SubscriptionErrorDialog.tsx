import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Gauge, Lock } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/i18n";
import { useCompany } from "@/lib/companyContext";
import {
  SUBSCRIPTION_ERROR_EVENT,
  SUBSCRIPTION_ERROR_MESSAGES,
  isReadOnlySubscription,
  type SubscriptionErrorCode,
} from "@/lib/subscription";

const TITLES: Record<SubscriptionErrorCode, string> = {
  SUBSCRIPTION_READ_ONLY: "المنشأة في وضع القراءة فقط",
  PLAN_LIMIT_USERS: "بلغت حد المستخدمين في باقتك",
  PLAN_LIMIT_EMPLOYEES: "بلغت حد الموظفين في باقتك",
  PLAN_LIMIT_BRANCHES: "بلغت حد الفروع في باقتك",
};

/**
 * S15: رسالة واحدة واضحة عند رفض الخادم عملية بسبب الاشتراك، أيًّا كانت الصفحة.
 * القراءة فقط والتنبيه ظاهر أصلًا أعلى الصفحة: إشعار قصير بدل النافذة (لا يتكرر خلال 10 ثوانٍ).
 */
export default function SubscriptionErrorDialog() {
  const { subscription } = useCompany();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [code, setCode] = useState<SubscriptionErrorCode | null>(null);
  const readOnlyRef = useRef(false);
  const lastToastRef = useRef(0);
  readOnlyRef.current = isReadOnlySubscription(subscription);

  useEffect(() => {
    const onError = (event: Event) => {
      const next = (event as CustomEvent<SubscriptionErrorCode>).detail;
      if (!next || !(next in TITLES)) return;
      if (next === "SUBSCRIPTION_READ_ONLY" && readOnlyRef.current) {
        if (Date.now() - lastToastRef.current < 10_000) return;
        lastToastRef.current = Date.now();
        toast.error(t(SUBSCRIPTION_ERROR_MESSAGES.SUBSCRIPTION_READ_ONLY));
        return;
      }
      setCode((current) => current ?? next);
    };
    window.addEventListener(SUBSCRIPTION_ERROR_EVENT, onError);
    return () => window.removeEventListener(SUBSCRIPTION_ERROR_EVENT, onError);
  }, [t]);

  return (
    <Dialog open={code !== null} onOpenChange={(open) => (!open ? setCode(null) : undefined)}>
      <DialogContent className="max-w-md" dir="rtl">
        {code ? (
          <div className="space-y-4 text-right">
            <span className={code === "SUBSCRIPTION_READ_ONLY" ? "flex h-11 w-11 items-center justify-center rounded-xl bg-rose-100 text-rose-700" : "flex h-11 w-11 items-center justify-center rounded-xl bg-amber-100 text-amber-700"}>
              {code === "SUBSCRIPTION_READ_ONLY" ? <Lock className="h-5 w-5" /> : <Gauge className="h-5 w-5" />}
            </span>
            <DialogTitle className="text-lg font-extrabold">{t(TITLES[code])}</DialogTitle>
            <DialogDescription className="text-[14px] leading-7 text-muted-foreground">{t(SUBSCRIPTION_ERROR_MESSAGES[code])}</DialogDescription>
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setCode(null);
                  navigate("/subscription");
                }}
                className="rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90"
              >
                {t("عرض الاشتراك والباقات")}
              </button>
              <button type="button" onClick={() => setCode(null)} className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold hover:bg-muted">
                {t("حسنًا")}
              </button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
