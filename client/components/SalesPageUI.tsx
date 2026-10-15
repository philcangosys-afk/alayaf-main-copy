import { Children, cloneElement, isValidElement, ReactNode } from "react";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  Search,
  X,
  Plus,
  ArrowRight,
  Filter,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/* ── Page Header ── */
export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  actionLabel,
  onAction,
  gradient = "from-blue-600 to-indigo-700",
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  gradient?: string;
}) {
  const { t, direction } = useI18n();

  return (
    <div className={cn("relative overflow-hidden rounded-2xl bg-gradient-to-bl p-6 text-white shadow-lg animate-fade-in-up", direction === "ltr" && "bg-gradient-to-br", gradient)}>
      <div className="pointer-events-none absolute -top-10 -start-10 h-32 w-32 rounded-full bg-white/[0.07] blur-2xl" />
      <div className="pointer-events-none absolute bottom-0 end-0 h-24 w-24 rounded-full bg-white/[0.05] blur-2xl" />
      <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm shadow-lg">
            <Icon className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold">{t(title)}</h1>
            {subtitle && <p className="text-sm text-white/70 mt-0.5">{t(subtitle)}</p>}
          </div>
        </div>
        {actionLabel && onAction && (
          <button
            onClick={onAction}
            className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-bold shadow-lg shadow-black/10 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200"
            style={{ color: "hsl(224, 76%, 38%)" }}
          >
            <Plus className="h-4 w-4" />
            {t(actionLabel)}
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Filter Bar ── */
export function FilterBar({ children }: { children: ReactNode }) {
  const { t } = useI18n();

  return (
    <div className="rounded-2xl bg-white border border-border/50 shadow-sm p-5 animate-fade-in-up" style={{ animationDelay: "100ms" }}>
      <div className="flex items-center gap-2 mb-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
          <Filter className="h-4 w-4" />
        </div>
        <h3 className="text-sm font-bold text-foreground">{t("البحث والتصفية")}</h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {children}
      </div>
    </div>
  );
}

// value/onChange اختياريان: الصفحات القديمة تبقى كما هي، والصفحات التي تمررهما تحصل على فلترة فعلية
export function FilterInput({ label, placeholder, colSpan, value, onChange }: { label?: string; placeholder: string; colSpan?: number; value?: string; onChange?: (value: string) => void }) {
  const { t, direction } = useI18n();

  return (
    <div className={cn("space-y-1.5", colSpan && `md:col-span-${colSpan}`)}>
      {label && <label className="text-[12px] font-semibold text-muted-foreground block text-start">{t(label)}</label>}
      <div className="relative">
        <input
          type="text"
          placeholder={t(placeholder)}
          {...(onChange ? { value: value ?? "", onChange: (event: { target: { value: string } }) => onChange(event.target.value) } : {})}
          className="w-full px-4 py-2.5 ps-10 border border-border/60 rounded-xl bg-muted/20 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary text-sm text-start transition-all"
          dir={direction}
        />
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
      </div>
    </div>
  );
}

export function FilterSelect({ label, options, children, value, onChange }: { label: string; options?: string[]; children?: ReactNode; value?: string; onChange?: (value: string) => void }) {
  const { t, direction } = useI18n();

  return (
    <div className="space-y-1.5">
      <label className="text-[12px] font-semibold text-muted-foreground block text-start">{t(label)}</label>
      <select dir={direction} {...(onChange ? { value: value ?? "", onChange: (event: { target: { value: string } }) => onChange(event.target.value) } : {})} className="w-full px-4 py-2.5 border border-border/60 rounded-xl bg-muted/20 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary text-sm text-start appearance-none text-foreground transition-all">
        {options
          ? options.map((opt) => <option key={opt} value={opt}>{t(opt)}</option>)
          : Children.map(children, (child) =>
              isValidElement<{ children?: ReactNode; value?: string | number }>(child) && child.type === "option"
                ? cloneElement(
                    child,
                    { value: child.props.value ?? (typeof child.props.children === "string" ? child.props.children : undefined) },
                    typeof child.props.children === "string" ? t(child.props.children) : child.props.children
                  )
                : child
            )}
      </select>
    </div>
  );
}

export function FilterActions({ onReset, onSearch }: { onReset?: () => void; onSearch?: () => void }) {
  const { t } = useI18n();

  return (
    <div className="md:col-span-4 flex items-center gap-2 pt-1">
      <button onClick={onReset} className="inline-flex items-center gap-2 rounded-xl border border-border/60 bg-white px-4 py-2 text-sm text-muted-foreground hover:bg-muted/30 transition-colors">
        <X className="h-3.5 w-3.5" />
        {t("إعادة تعيين")}
      </button>
      <button onClick={onSearch} className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary/90 shadow-sm shadow-primary/20 transition-all">
        <Search className="h-3.5 w-3.5" />
        {t("بحث")}
      </button>
    </div>
  );
}

/* ── Data Table ── */
export function DataTable({
  headers,
  children,
  gradient = "from-slate-800 to-slate-900",
}: {
  headers: string[];
  children: ReactNode;
  gradient?: string;
}) {
  const { t, direction } = useI18n();

  return (
    <div className="rounded-2xl bg-white border border-border/50 shadow-sm overflow-hidden animate-fade-in-up" style={{ animationDelay: "200ms" }}>
      <div className="overflow-x-auto">
        <table dir={direction} className="w-full min-w-[1450px] text-sm text-start">
          <thead>
            <tr className={cn("bg-gradient-to-l text-white", direction === "ltr" && "bg-gradient-to-r", gradient)}>
              {headers.map((h) => (
                <th key={h} className="px-5 py-3.5 text-[12px] font-bold text-start whitespace-nowrap tracking-normal">
                  {t(h)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">{children}</tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Action Buttons ── */
export function ActionBtn({
  icon: Icon,
  label,
  color = "blue",
  title,
  onClick,
}: {
  icon: LucideIcon;
  label?: string;
  color?: "blue" | "emerald" | "green" | "amber" | "red" | "slate" | "indigo";
  title?: string;
  onClick?: () => void;
}) {
  const { t } = useI18n();
  const colorMap = {
    blue: "text-blue-600 border-blue-200 hover:bg-blue-50",
    green: "text-emerald-600 border-emerald-200 hover:bg-emerald-50",
    emerald: "text-emerald-600 border-emerald-200 hover:bg-emerald-50",
    amber: "text-amber-700 border-amber-200 hover:bg-amber-50",
    red: "text-red-500 border-red-200 hover:bg-red-50",
    slate: "text-slate-600 border-slate-300 hover:bg-slate-100",
    indigo: "text-indigo-600 border-indigo-200 hover:bg-indigo-50",
  };

  return (
    <button
      onClick={onClick}
      title={title ? t(title) : label ? t(label) : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1.5 border rounded-lg transition-colors text-xs font-semibold",
        colorMap[color] || colorMap.blue
      )}
    >
      <Icon className="h-4 w-4" />
      {label && <span>{t(label)}</span>}
    </button>
  );
}

/* ── Status Badge ── */
export function StatusBadge({ status, color }: { status: string; color: string }) {
  const { t } = useI18n();

  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-3 py-0.5 text-[11px] font-bold", color)}>
      {t(status)}
    </span>
  );
}

/* ── Section Header (for forms) ── */
export function SectionHeader({
  icon: Icon,
  title,
  action,
}: {
  icon: LucideIcon;
  title: string;
  action?: ReactNode;
}) {
  const { t } = useI18n();

  return (
    <div className="flex items-center justify-between px-6 py-4 border-b border-border/40 bg-muted/20">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <h2 className="text-sm font-bold text-foreground">{t(title)}</h2>
      </div>
      {action}
    </div>
  );
}

/* ── Form Card ── */
export function FormCard({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-white border border-border/50 shadow-sm overflow-hidden">
      {children}
    </div>
  );
}

/* ── Form Header Bar ── */
export function FormHeaderBar({
  title,
  icon: Icon,
  onBack,
  actions,
}: {
  title: string;
  icon: LucideIcon;
  onBack: () => void;
  actions?: ReactNode;
}) {
  const { t, direction } = useI18n();

  return (
    <div className="flex items-center justify-between rounded-2xl bg-white border border-border/50 shadow-sm px-6 py-4 animate-fade-in-up">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-2 rounded-xl border border-border/60 bg-white px-4 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted/30 transition-colors"
      >
        {t("العودة للقائمة")}
        <ArrowRight className={cn("h-4 w-4", direction === "ltr" && "rotate-180")} />
      </button>
      <div className="flex items-center gap-2.5">
        <h1 className="text-lg font-extrabold text-foreground">{t(title)}</h1>
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-[18px] w-[18px]" />
        </div>
      </div>
      <div className="flex gap-2">{actions}</div>
    </div>
  );
}

/* ── Form Input ── */
export function FormInput({
  label,
  required,
  type = "text",
  value,
  onChange,
  placeholder,
  disabled,
  colSpan,
}: {
  label: string;
  required?: boolean;
  type?: string;
  value?: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  colSpan?: number;
}) {
  const { t, direction } = useI18n();

  return (
    <div className={cn("space-y-1.5", colSpan && `md:col-span-${colSpan}`)}>
      <label className="text-[12px] font-semibold text-muted-foreground block text-start">
        {t(label)} {required && <span className="text-red-500">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        placeholder={placeholder ? t(placeholder) : undefined}
        disabled={disabled}
        dir={direction}
        className={cn(
          "w-full px-4 py-2.5 border border-border/60 rounded-xl text-sm text-start outline-none transition-all",
          disabled
            ? "bg-muted/30 text-muted-foreground"
            : "bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary"
        )}
      />
    </div>
  );
}

/* ── Totals Summary ── */
export function TotalsSummary({ subtotal, discount, tax, total }: {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
}) {
  const { t, direction, formatNumber } = useI18n();
  const formatCurrency = (value: number) => `${formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${t("ر.س")}`;

  return (
    <div className="border-t border-border/40 pt-5 flex justify-end mt-6">
      <div dir={direction} className="w-72 rounded-xl border border-border/50 bg-muted/10 p-4 space-y-2.5">
        <TotalRow label={t("المجموع الفرعي")} value={formatCurrency(subtotal)} />
        <TotalRow label={t("الخصم")} value={formatCurrency(discount)} />
        <TotalRow label={t("الضريبة")} value={formatCurrency(tax)} />
        <div className="flex justify-between items-center pt-2.5 border-t border-border/40">
          <span className="font-extrabold text-primary text-lg">{formatCurrency(total)}</span>
          <span className="font-bold text-foreground text-sm">{t("الإجمالي")}</span>
        </div>
      </div>
    </div>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="font-semibold text-foreground">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

/* ── Primary / Secondary buttons ── */
export function PrimaryBtn({ label, icon: Icon, onClick }: { label: string; icon?: LucideIcon; onClick: () => void }) {
  const { t, direction } = useI18n();

  return (
    <button
      onClick={onClick}
      className={cn("inline-flex items-center gap-2 rounded-xl bg-gradient-to-l from-blue-600 to-blue-500 px-5 py-2.5 text-sm font-bold text-white shadow-md shadow-blue-500/20 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200", direction === "ltr" && "bg-gradient-to-r")}
    >
      {Icon && <Icon className="h-4 w-4" />}
      {t(label)}
    </button>
  );
}

export function SecondaryBtn({ label, icon: Icon, onClick }: { label: string; icon?: LucideIcon; onClick: () => void }) {
  const { t } = useI18n();

  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-xl border-2 border-border/60 bg-white px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-muted/30 transition-all duration-200"
    >
      {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      {t(label)}
    </button>
  );
}

/* ── Add Item button ── */
export function AddItemBtn({ onClick }: { onClick: () => void }) {
  const { t, direction } = useI18n();

  return (
    <button
      onClick={onClick}
      className={cn("inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-l from-emerald-600 to-emerald-500 px-4 py-2 text-[12px] font-bold text-white shadow-sm shadow-emerald-500/20 hover:shadow-md transition-all", direction === "ltr" && "bg-gradient-to-r")}
    >
      <Plus className="h-3.5 w-3.5" />
      {t("إضافة بند")}
    </button>
  );
}
