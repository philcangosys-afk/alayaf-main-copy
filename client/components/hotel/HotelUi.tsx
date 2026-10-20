import { useEffect, type ReactNode } from "react";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { statusOf } from "@/lib/hotel";

/* S20: عناصر مشتركة لصفحات الحجوزات (نفس أسلوب صفحات النظام، بلون قسم الحجوزات) */

export const hotelInput = "mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-[#7a2450] focus:outline-none focus:ring-2 focus:ring-[#7a2450]/15 disabled:bg-slate-50 disabled:text-slate-500";
export const hotelSelect = "mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm focus:border-[#7a2450] focus:outline-none focus:ring-2 focus:ring-[#7a2450]/15 disabled:bg-slate-50";
export const hotelLabel = "block text-xs font-medium text-slate-600";

export function HotelHeader({
  icon: Icon,
  title,
  description,
  actions,
}: {
  icon: typeof X;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-[#f7eef2] p-2.5 text-[#7a2450]"><Icon className="h-6 w-6" /></div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t(title)}</h1>
          {description ? <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">{t(description)}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function HotelButton({
  children,
  onClick,
  variant = "primary",
  disabled,
  busy,
  type = "button",
  title,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "outline" | "danger" | "ghost" | "success";
  disabled?: boolean;
  busy?: boolean;
  type?: "button" | "submit";
  title?: string;
  className?: string;
}) {
  const styles = {
    primary: "bg-[#7a2450] text-white hover:bg-[#641c41] border-[#7a2450]",
    success: "bg-emerald-700 text-white hover:bg-emerald-800 border-emerald-700",
    outline: "bg-white text-slate-700 hover:bg-slate-50 border-slate-300",
    danger: "bg-white text-red-700 hover:bg-red-50 border-red-200",
    ghost: "bg-transparent text-slate-600 hover:bg-slate-100 border-transparent",
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || busy}
      title={title}
      className={cn("inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50", styles, className)}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {children}
    </button>
  );
}

export function ReservationStatusPill({ status }: { status: string }) {
  const { t } = useI18n();
  const info = statusOf(status);
  return <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold", info.className)}>{t(info.label)}</span>;
}

export function HotelCard({ title, actions, children, className }: { title?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  const { t } = useI18n();
  return (
    <section className={cn("rounded-xl border bg-white shadow-sm", className)}>
      {title || actions ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3">
          {title ? <h2 className="font-bold text-slate-900">{t(title)}</h2> : <span />}
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className="p-5">{children}</div>
    </section>
  );
}

/** نافذة بسيطة (Escape يغلقها ما لم تكن عملية جارية) */
export function HotelModal({
  title,
  onClose,
  children,
  footer,
  wide = false,
  busy = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  busy?: boolean;
}) {
  const { t, direction } = useI18n();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-[8vh]" dir={direction} role="dialog" aria-modal="true" aria-label={t(title)}>
      <div className={cn("w-full rounded-2xl bg-white shadow-xl", wide ? "max-w-3xl" : "max-w-lg")}>
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="font-bold text-slate-900">{t(title)}</h2>
          <button type="button" onClick={onClose} disabled={busy} className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-40" aria-label={t("إغلاق")}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2 border-t bg-slate-50 px-5 py-3 rounded-b-2xl">{footer}</div> : null}
      </div>
    </div>
  );
}

/** تأكيد قبل عملية لا تُعكس بسهولة (بدل window.confirm) */
export function HotelConfirm({
  title,
  message,
  confirmLabel,
  danger = false,
  busy = false,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <HotelModal
      title={title}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <HotelButton variant="outline" onClick={onClose} disabled={busy}>{t("رجوع")}</HotelButton>
          <HotelButton variant={danger ? "danger" : "primary"} onClick={onConfirm} busy={busy}>{t(confirmLabel)}</HotelButton>
        </>
      }
    >
      <p className="text-sm leading-7 text-slate-700">{t(message)}</p>
      {children}
    </HotelModal>
  );
}

export function ErrorNote({ message }: { message: string }) {
  if (!message) return null;
  return <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{message}</div>;
}

/** تواريخ الحجوزات بالتقويم الميلادي (التواريخ المجردة YYYY-MM-DD بلا إزاحة منطقة زمنية) */
export function useHotelDate() {
  const { formatDate } = useI18n();
  return (value: Date | string | number, options: Intl.DateTimeFormatOptions = { dateStyle: "medium" }) => {
    if (value === "" || value === null || value === undefined) return "—";
    const dateOnly = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
    return formatDate(dateOnly ? `${value}T00:00:00Z` : value, {
      calendar: "gregory",
      timeZone: dateOnly ? "UTC" : "Asia/Riyadh",
      ...options,
    } as Intl.DateTimeFormatOptions);
  };
}

export function useMoney() {
  const { formatNumber } = useI18n();
  return (value: number) => formatNumber(Math.abs(value) < 0.005 ? 0 : value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
