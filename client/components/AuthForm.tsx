import { useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { ChevronDown, Eye, EyeOff } from "lucide-react";
import { AUTH_COLORS, AUTH_DISPLAY_FONT, StepStar, type AuthIcon } from "@/components/AuthShell";

/**
 * عناصر نماذج صفحات ما قبل الدخول: الأقسام المرقّمة، والحقل بعنوانه وأيقونته وخطئه،
 * والقائمة، وكلمة المرور، واختيار نعم/لا، والأزرار والتنبيهات. كلها بألوان AUTH_COLORS.
 */

// لون الحد والتركيز في صنف واحد لكل حالة (صنفان لنفس الخاصية في Tailwind لا يُضمن أيهما يغلب)
const FIELD_BASE =
  "h-12 w-full rounded-xl border bg-white text-[15px] text-[#0F2A21] placeholder:text-[#98ACA4] transition-[border-color,box-shadow] focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:bg-[#F3F6F4] disabled:text-[#5E726A]";
const FIELD_OK = "border-[#D3DFD9] hover:border-[#B9CCC3] focus:border-[#127A5A] focus:ring-[#127A5A]/15";
const FIELD_ERROR = "border-[#D9534A] focus:border-[#D9534A] focus:ring-[#D9534A]/15";

export const fieldClass = (hasError: boolean, padding: string) => `${FIELD_BASE} ${hasError ? FIELD_ERROR : FIELD_OK} ${padding}`;

/** قسم مرقّم في النموذج: نجمة الرقم والعنوان وسطر توضيح، ثم الحقول */
export function FormSection({ step, title, hint, children }: { step: number; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="border-t pt-7 first:border-t-0 first:pt-0" style={{ borderColor: AUTH_COLORS.line }} aria-labelledby={`form-step-${step}`}>
      <div className="mb-5 flex items-start gap-3">
        <StepStar step={step} />
        <div className="pt-0.5">
          <h2 id={`form-step-${step}`} className="text-[17px] font-bold leading-7 tracking-normal" style={{ color: AUTH_COLORS.ink, fontFamily: AUTH_DISPLAY_FONT }}>
            {title}
          </h2>
          {hint ? <p className="mt-0.5 text-[13px] leading-6" style={{ color: AUTH_COLORS.muted }}>{hint}</p> : null}
        </div>
      </div>
      <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">{children}</div>
    </section>
  );
}

/** حقل: العنوان (ونجمة الإلزامي)، والعنصر، وتوضيح أو خطأ تحته */
export function Field({
  id,
  label,
  required = false,
  error,
  hint,
  wide = false,
  aside,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  hint?: ReactNode;
  /** يأخذ عرض السطر كاملًا في الشبكة */
  wide?: boolean;
  /** عنصر بجانب العنوان (رابط «نسيت كلمة المرور؟») */
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[14px] font-medium" style={{ color: "#23423A" }}>
          {label}
          {required ? (
            <>
              <span className="text-[#C9372C]" aria-hidden="true"> *</span>
              <span className="sr-only"> (إلزامي)</span>
            </>
          ) : null}
        </label>
        {aside}
      </div>
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-[13px] leading-6 text-[#B42318]">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-[12.5px] leading-6" style={{ color: AUTH_COLORS.muted }}>{hint}</p>
      ) : null}
    </div>
  );
}

const describedBy = (id: string, error?: string, hint?: ReactNode) => (error ? `${id}-error` : hint ? `${id}-hint` : undefined);

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "className"> & {
  id: string;
  icon?: AuthIcon;
  error?: string;
  hint?: ReactNode;
};

/** حقل نص بأيقونة في بدايته (يمين الحقل) */
export function TextInput({ id, icon: Icon, error, hint, required, ...rest }: InputProps) {
  return (
    <div className="relative">
      {Icon ? <Icon className="pointer-events-none absolute right-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#8AA097]" strokeWidth={1.75} aria-hidden="true" /> : null}
      <input
        id={id}
        {...rest}
        aria-required={required ? true : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={fieldClass(Boolean(error), Icon ? "pr-11 pl-4" : "px-4")}
      />
    </div>
  );
}

/** كلمة المرور مع زر الإظهار والإخفاء */
export function PasswordInput({ id, icon: Icon, error, hint, required, ...rest }: InputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      {Icon ? <Icon className="pointer-events-none absolute right-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#8AA097]" strokeWidth={1.75} aria-hidden="true" /> : null}
      <input
        id={id}
        {...rest}
        type={visible ? "text" : "password"}
        aria-required={required ? true : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={fieldClass(Boolean(error), `${Icon ? "pr-11" : "pr-4"} pl-12`)}
      />
      <button
        type="button"
        onClick={() => setVisible((value) => !value)}
        aria-label={visible ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
        className="absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-[#7C918A] transition-colors hover:bg-[#F3F6F4] hover:text-[#23423A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#127A5A]/40"
      >
        {visible ? <EyeOff className="h-[18px] w-[18px]" strokeWidth={1.75} /> : <Eye className="h-[18px] w-[18px]" strokeWidth={1.75} />}
      </button>
    </div>
  );
}

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "className"> & {
  id: string;
  icon?: AuthIcon;
  error?: string;
  hint?: ReactNode;
};

/** قائمة اختيار بشكل الحقول نفسه وسهم مرسوم */
export function SelectInput({ id, icon: Icon, error, hint, required, children, ...rest }: SelectProps) {
  return (
    <div className="relative">
      {Icon ? <Icon className="pointer-events-none absolute right-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#8AA097]" strokeWidth={1.75} aria-hidden="true" /> : null}
      <select
        id={id}
        {...rest}
        aria-required={required ? true : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={`${fieldClass(Boolean(error), Icon ? "pr-11 pl-10" : "pr-4 pl-10")} cursor-pointer appearance-none`}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#5E726A]" strokeWidth={1.75} aria-hidden="true" />
    </div>
  );
}

/** اختيار من خيارين أو أكثر بشكل بطاقات (أزرار راديو حقيقية) */
export function ChoiceCards<T extends string>({
  name,
  value,
  onChange,
  options,
  error,
  disabled,
  labelledBy,
}: {
  name: string;
  value: T | null;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; detail?: string }>;
  error?: string;
  disabled?: boolean;
  labelledBy?: string;
}) {
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} aria-invalid={error ? true : undefined} aria-describedby={error ? `${name}-error` : undefined} className="grid gap-3 sm:grid-cols-2">
      {options.map((option) => {
        const checked = value === option.value;
        return (
          <label
            key={option.value}
            className={`flex items-start gap-3 rounded-xl border px-4 py-3.5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#127A5A] has-[:focus-visible]:ring-offset-2 ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
            style={{
              borderColor: checked ? AUTH_COLORS.emerald : error ? "#D9534A" : "#D3DFD9",
              background: checked ? AUTH_COLORS.mint : "#fff",
              boxShadow: checked ? `0 0 0 1px ${AUTH_COLORS.emerald}` : undefined,
            }}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={checked}
              onChange={() => onChange(option.value)}
              disabled={disabled}
              className="peer sr-only"
            />
            <span
              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2"
              style={{ borderColor: checked ? AUTH_COLORS.emerald : "#B9CCC3" }}
              aria-hidden="true"
            >
              {checked ? <span className="h-2.5 w-2.5 rounded-full" style={{ background: AUTH_COLORS.emerald }} /> : null}
            </span>
            <span className="min-w-0">
              <span className="block text-[14.5px] font-semibold" style={{ color: AUTH_COLORS.text }}>{option.label}</span>
              {option.detail ? <span className="mt-0.5 block text-[12.5px] leading-5" style={{ color: AUTH_COLORS.muted }}>{option.detail}</span> : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}

/** الزر الرئيسي */
export const primaryButtonClass =
  "inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#127A5A] px-5 text-[15px] font-bold text-white shadow-[0_10px_24px_-12px_rgba(18,122,90,0.9)] transition-colors hover:bg-[#0E6248] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#127A5A]/25 disabled:cursor-not-allowed disabled:opacity-60";

/** زر ثانوي بإطار */
export const secondaryButtonClass =
  "inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#C7E0D4] bg-white px-5 text-[15px] font-bold text-[#0B3D2E] transition-colors hover:border-[#127A5A] hover:bg-[#E8F3EE] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#127A5A]/20 disabled:opacity-60";

/** رابط نصي بلون المنصة */
export const linkClass =
  "rounded-sm font-semibold text-[#127A5A] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#127A5A]/40";

/** تنبيه داخل النموذج */
export function Notice({ tone = "info", children }: { tone?: "info" | "success" | "danger"; children: ReactNode }) {
  const palette =
    tone === "danger"
      ? { background: "#FEF3F2", border: "#FECDCA", color: "#912018" }
      : tone === "success"
      ? { background: AUTH_COLORS.mint, border: AUTH_COLORS.mintLine, color: AUTH_COLORS.ink }
      : { background: "#F6F9F7", border: AUTH_COLORS.line, color: "#2C4A40" };
  return (
    <div role={tone === "danger" ? "alert" : "note"} className="rounded-xl border px-4 py-3 text-[13.5px] leading-7" style={{ background: palette.background, borderColor: palette.border, color: palette.color }}>
      {children}
    </div>
  );
}

/** أيقونة صفحات الحالة: مربع ملون فيه الأيقونة */
export function StatusIcon({ icon: Icon, tone = "success" }: { icon: AuthIcon; tone?: "success" | "warning" | "danger" }) {
  const colors =
    tone === "danger" ? { bg: "#FEF3F2", fg: "#B42318" } : tone === "warning" ? { bg: "#FFF6E5", fg: "#B54708" } : { bg: AUTH_COLORS.mint, fg: AUTH_COLORS.emerald };
  return (
    <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: colors.bg }} aria-hidden="true">
      <Icon className="h-7 w-7" style={{ color: colors.fg }} strokeWidth={1.75} />
    </span>
  );
}
