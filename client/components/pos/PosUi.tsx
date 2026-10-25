import { useEffect, useState, type ReactNode } from "react";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

/* S22: عناصر مشتركة لصفحات نقاط البيع (أسلوب صفحات النظام، بلون نقاط البيع) */

export const posInput = "mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-[#0f6b63] focus:outline-none focus:ring-2 focus:ring-[#0f6b63]/15 disabled:bg-slate-50 disabled:text-slate-500";
export const posSelect = "mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm focus:border-[#0f6b63] focus:outline-none focus:ring-2 focus:ring-[#0f6b63]/15 disabled:bg-slate-50";
export const posLabel = "block text-xs font-medium text-slate-600";
/** أرقام بعرض ثابت لتصطف المبالغ */
export const num = "tabular-nums";

/** رقم مستند أو رمز (1001-INV-000012) باتجاه ثابت من اليسار داخل النص العربي */
export function Code({ children, className }: { children: ReactNode; className?: string }) {
  return <bdi dir="ltr" className={cn("tabular-nums", className)}>{children}</bdi>;
}

export function PosHeader({
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
        <div className="rounded-xl bg-[#e6f2f0] p-2.5 text-[#0f6b63]"><Icon className="h-6 w-6" /></div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t(title)}</h1>
          {description ? <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">{t(description)}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function PosButton({
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
  variant?: "primary" | "outline" | "danger" | "ghost" | "dark";
  disabled?: boolean;
  busy?: boolean;
  type?: "button" | "submit";
  title?: string;
  className?: string;
}) {
  const styles = {
    primary: "bg-[#0f6b63] text-white hover:bg-[#0b5751] border-[#0f6b63]",
    dark: "bg-slate-900 text-white hover:bg-slate-800 border-slate-900",
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

export function PosCard({ title, actions, children, className }: { title?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
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

/** النوافذ المفتوحة بترتيبها: Escape يغلق العليا وحدها */
const modalStack: number[] = [];
let modalSeq = 0;

/** نافذة (Escape يغلقها ما لم تكن عملية جارية) */
export function PosModal({
  title,
  onClose,
  children,
  footer,
  size = "md",
  busy = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "md" | "lg" | "xl";
  busy?: boolean;
}) {
  const { t, direction } = useI18n();
  const [modalId] = useState(() => (modalSeq += 1));
  useEffect(() => {
    modalStack.push(modalId);
    return () => {
      const index = modalStack.lastIndexOf(modalId);
      if (index >= 0) modalStack.splice(index, 1);
    };
  }, [modalId]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy && modalStack[modalStack.length - 1] === modalId) {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose, modalId]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/45 p-4 pt-[6vh]" dir={direction} role="dialog" aria-modal="true" aria-label={t(title)}>
      <div className={cn("w-full rounded-2xl bg-white shadow-xl", size === "xl" ? "max-w-5xl" : size === "lg" ? "max-w-3xl" : "max-w-lg")}>
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="font-bold text-slate-900">{t(title)}</h2>
          <button type="button" onClick={onClose} disabled={busy} className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-40" aria-label={t("إغلاق")}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[74vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2 rounded-b-2xl border-t bg-slate-50 px-5 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}

/** تأكيد قبل عملية لا تُعكس بسهولة (بدل window.confirm) */
export function PosConfirm({
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
    <PosModal
      title={title}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <PosButton variant="outline" onClick={onClose} disabled={busy}>{t("رجوع")}</PosButton>
          <PosButton variant={danger ? "danger" : "primary"} onClick={onConfirm} busy={busy}>{t(confirmLabel)}</PosButton>
        </>
      }
    >
      <p className="text-sm leading-7 text-slate-700">{t(message)}</p>
      {children}
    </PosModal>
  );
}

export function ErrorNote({ message }: { message: string }) {
  if (!message) return null;
  return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{message}</div>;
}

export function useMoney() {
  const { formatNumber } = useI18n();
  return (value: number | null | undefined) =>
    formatNumber(Math.abs(Number(value ?? 0)) < 0.005 ? 0 : Number(value ?? 0), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** تاريخ ووقت بالتقويم الميلادي وتوقيت الرياض */
export function usePosDate() {
  const { formatDate } = useI18n();
  return (value: string | null | undefined, options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }) =>
    value ? formatDate(value, { calendar: "gregory", timeZone: "Asia/Riyadh", ...options } as Intl.DateTimeFormatOptions) : "—";
}

export function StatPill({ label, value, tone = "slate" }: { label: string; value: string; tone?: "slate" | "teal" | "amber" | "red" }) {
  const { t } = useI18n();
  const tones = {
    slate: "bg-slate-50 text-slate-800 border-slate-200",
    teal: "bg-[#e6f2f0] text-[#0b5751] border-[#bfe0db]",
    amber: "bg-amber-50 text-amber-900 border-amber-200",
    red: "bg-red-50 text-red-800 border-red-200",
  }[tone];
  return (
    <div className={cn("rounded-lg border px-3 py-2", tones)}>
      <div className="text-[11px] font-medium opacity-80">{t(label)}</div>
      <div className={cn("text-base font-bold", num)}>{value}</div>
    </div>
  );
}
