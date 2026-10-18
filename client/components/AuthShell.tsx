import { useEffect, useId, type ComponentType, type CSSProperties, type ReactNode } from "react";
import { Boxes, Calculator, CircleCheck, ClipboardList, Handshake, ReceiptText, ShoppingCart, Truck, Users } from "lucide-react";
import { PLATFORM_NAME_AR } from "@/lib/companyProfile";

/**
 * إطار صفحات ما قبل الدخول (الدخول، والتسجيل، وإكمال تسجيل المنشأة، وحالتها، وتعيين كلمة المرور).
 * الشاشة الكبيرة: عمود النموذج يمين الشاشة (بطاقة بيضاء)، ولوحة المنصة الزمردية يسارها ثابتة عند التمرير.
 * الجوال: شريط المنصة أعلى الصفحة، ثم البطاقة، ثم أقسام النظام.
 * الزخرفة الوحيدة: النجمة الثمانية بخطوط ذهبية (في اللوحة، وفي شعار المنصة وأرقام أقسام النموذج).
 */

/** ألوان صفحات الدخول والتسجيل */
export const AUTH_COLORS = {
  ink: "#0B3D2E",
  inkDeep: "#082C21",
  emerald: "#127A5A",
  emeraldHover: "#0E6248",
  mint: "#E8F3EE",
  mintLine: "#C7E0D4",
  gold: "#C9A24D",
  goldSoft: "#EBDDB0",
  page: "#F3F6F4",
  text: "#0F2A21",
  muted: "#5E726A",
  line: "#DDE7E2",
  danger: "#C9372C",
} as const;

export const AUTH_BODY_FONT = "'IBM Plex Sans Arabic', 'Tajawal', sans-serif";
export const AUTH_DISPLAY_FONT = "'Noto Kufi Arabic', 'Tajawal', sans-serif";

const FONT_LINK_ID = "auth-fonts";
const FONT_HREF = "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Noto+Kufi+Arabic:wght@600;700;800&display=swap";

/** الخطان يُحمَّلان لصفحات ما قبل الدخول فقط (لا يثقلان صفحات النظام) */
function useAuthFonts() {
  useEffect(() => {
    if (document.getElementById(FONT_LINK_ID)) return;
    const link = document.createElement("link");
    link.id = FONT_LINK_ID;
    link.rel = "stylesheet";
    link.href = FONT_HREF;
    document.head.appendChild(link);
  }, []);
}

/** أيقونة (من lucide-react) كما تستخدمها صفحات ما قبل الدخول */
export type AuthIcon = ComponentType<{ className?: string; style?: CSSProperties; strokeWidth?: number; "aria-hidden"?: boolean | "true" | "false" }>;

/** أقسام النظام كما تراها المنشأة */
const MODULES: Array<{ icon: AuthIcon; name: string; detail: string }> = [
  { icon: ReceiptText, name: "المبيعات والفوترة", detail: "عروض أسعار وأوامر بيع وفواتير وإشعارات" },
  { icon: ShoppingCart, name: "المشتريات", detail: "أوامر شراء وفواتير الموردين والجمارك" },
  { icon: Boxes, name: "المخزون", detail: "أصناف ومستودعات وحركات وجرد" },
  { icon: Calculator, name: "المحاسبة", detail: "قيود تلقائية وقوائم مالية" },
  { icon: Users, name: "الموارد البشرية", detail: "موظفون وحضور وإجازات ورواتب" },
  { icon: Handshake, name: "العملاء والموردون", detail: "أرصدة وكشوف حساب" },
  { icon: Truck, name: "الأسطول", detail: "مركبات وسائقون وصيانة ووقود" },
  { icon: ClipboardList, name: "المهام والمشاريع", detail: "مهام الفرق ومتابعة الإنجاز" },
];

const ASSURANCES = [
  "بيانات كل منشأة معزولة عن غيرها",
  "صلاحيات لكل موظف حسب دوره",
  "فوترة إلكترونية متوافقة مع هيئة الزكاة والضريبة والجمارك",
];

/** النجمة الثمانية: مربعان متراكبان (أحدهما مُدار 45 درجة) */
function StarShape({ size, fill, stroke, strokeWidth = 1.5 }: { size: number; fill: string; stroke?: string; strokeWidth?: number }) {
  const s = size;
  const inset = s * 0.17;
  return (
    <g fill={fill} stroke={stroke} strokeWidth={stroke ? strokeWidth : 0} strokeLinejoin="round">
      <rect x={inset} y={inset} width={s - inset * 2} height={s - inset * 2} rx={s * 0.05} />
      <rect x={inset} y={inset} width={s - inset * 2} height={s - inset * 2} rx={s * 0.05} transform={`rotate(45 ${s / 2} ${s / 2})`} />
    </g>
  );
}

/** شعار المنصة: نجمة ذهبية، في وسطها نجمة زمردية ونقطة */
export function BrandMark({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <StarShape size={size} fill={AUTH_COLORS.gold} />
      <g transform={`translate(${size * 0.2} ${size * 0.2})`}>
        <StarShape size={size * 0.6} fill={AUTH_COLORS.ink} />
      </g>
      <circle cx={size / 2} cy={size / 2} r={size * 0.09} fill={AUTH_COLORS.goldSoft} />
    </svg>
  );
}

/** رقم قسم في النموذج داخل نجمة ثمانية بخط ذهبي */
export function StepStar({ step }: { step: number }) {
  return (
    <span className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center" aria-hidden="true">
      <svg width="32" height="32" viewBox="0 0 32 32" className="absolute inset-0">
        <StarShape size={32} fill={AUTH_COLORS.mint} stroke={AUTH_COLORS.gold} strokeWidth={1.25} />
      </svg>
      <span className="relative text-[13px] font-bold" style={{ color: AUTH_COLORS.ink, fontFamily: AUTH_DISPLAY_FONT }}>{step}</span>
    </span>
  );
}

/** نقش لوحة المنصة: شبكة نجوم ثمانية خفيفة، ووردة كبيرة في الزاوية السفلى */
function PanelPattern({ rosette = true }: { rosette?: boolean }) {
  // معرّف لكل نسخة: النقش يظهر في أكثر من مكان، والمرجع لمعرّف مكرر يقع على نسخة مخفية فلا يُرسم
  const patternId = `auth-star-grid-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <>
    <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
      <defs>
        <pattern id={patternId} width="88" height="88" patternUnits="userSpaceOnUse">
          <g fill="none" stroke={AUTH_COLORS.gold} strokeWidth="0.7" opacity="0.13">
            <rect x="26" y="26" width="36" height="36" />
            <rect x="26" y="26" width="36" height="36" transform="rotate(45 44 44)" />
            <path d="M0 44 H18 M70 44 H88 M44 0 V18 M44 70 V88" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} />
    </svg>
    {rosette ? (
      <svg className="pointer-events-none absolute -bottom-44 -left-44 h-[400px] w-[400px]" viewBox="0 0 400 400" aria-hidden="true">
        <g fill="none" stroke={AUTH_COLORS.gold} strokeWidth="1" opacity="0.2">
          <circle cx="200" cy="200" r="190" />
          <rect x="66" y="66" width="268" height="268" />
          <rect x="66" y="66" width="268" height="268" transform="rotate(45 200 200)" />
          <rect x="116" y="116" width="168" height="168" transform="rotate(22.5 200 200)" />
          <rect x="116" y="116" width="168" height="168" transform="rotate(67.5 200 200)" />
          <circle cx="200" cy="200" r="70" />
        </g>
      </svg>
    ) : null}
    </>
  );
}

function BrandName({ light = true }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <BrandMark />
      <div className="leading-tight">
        <span className="block text-[17px] font-bold" style={{ color: light ? "#fff" : AUTH_COLORS.ink, fontFamily: AUTH_DISPLAY_FONT }}>{PLATFORM_NAME_AR}</span>
        <span className="mt-1 block text-[12.5px]" style={{ color: light ? AUTH_COLORS.goldSoft : AUTH_COLORS.muted }}>منصة سحابية لإدارة المنشآت</span>
      </div>
    </div>
  );
}

/** أقسام النظام في شبكة: أيقونة في مربع بإطار ذهبي، والاسم، وما يشمله (يُخفى في اللوحة الضيقة) */
function ModuleGrid({ compact = false, details = true }: { compact?: boolean; details?: boolean }) {
  return (
    <ul className={`grid gap-x-6 ${compact ? "gap-y-4 sm:grid-cols-2" : details ? "grid-cols-2 gap-y-4 xl:gap-y-5" : "grid-cols-1 gap-y-3 xl:grid-cols-2 xl:gap-y-4"}`}>
      {MODULES.map(({ icon: Icon, name, detail }) => (
        <li key={name} className="flex items-start gap-3">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border xl:h-10 xl:w-10"
            style={{ borderColor: "rgba(201,162,77,0.35)", background: "rgba(255,255,255,0.06)" }}
          >
            <Icon className="h-[18px] w-[18px]" style={{ color: AUTH_COLORS.goldSoft }} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <span className="min-w-0 pt-0.5">
            <span className="block text-[14.5px] font-semibold text-white">{name}</span>
            {details ? (
              <span className={`mt-0.5 text-[12.5px] leading-5 text-white/60 ${compact ? "block" : "hidden xl:block [@media(max-height:780px)]:hidden"}`}>{detail}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function AssuranceList() {
  return (
    <ul className="space-y-2.5">
      {ASSURANCES.map((text) => (
        <li key={text} className="flex items-start gap-2.5 text-[13.5px] leading-6 text-white/80">
          <CircleCheck className="mt-0.5 h-[18px] w-[18px] shrink-0" style={{ color: AUTH_COLORS.gold }} strokeWidth={1.75} aria-hidden="true" />
          <span>{text}</span>
        </li>
      ))}
    </ul>
  );
}

const PANEL_BACKGROUND = `linear-gradient(160deg, #0F4A38 0%, ${AUTH_COLORS.ink} 45%, ${AUTH_COLORS.inkDeep} 100%)`;

export default function AuthShell({
  title,
  subtitle,
  children,
  wide = false,
  footer,
  icon,
}: {
  /** عنوان البطاقة */
  title?: string;
  /** سطر تحت العنوان */
  subtitle?: ReactNode;
  children: ReactNode;
  /** نموذج أعرض (التسجيل وبيانات المنشأة) */
  wide?: boolean;
  /** سطر تحت البطاقة (روابط التبديل بين الصفحات) */
  footer?: ReactNode;
  /** أيقونة فوق العنوان (صفحات الحالة) */
  icon?: ReactNode;
}) {
  useAuthFonts();
  const columns = wide ? "minmax(0,1fr) minmax(400px,36%)" : "minmax(0,1fr) minmax(440px,42%)";
  return (
    <div
      dir="rtl"
      className="min-h-screen lg:grid"
      style={{ gridTemplateColumns: columns, background: AUTH_COLORS.page, fontFamily: AUTH_BODY_FONT, color: AUTH_COLORS.text }}
    >
      {/* الجوال: شريط المنصة */}
      <header className="relative overflow-hidden px-5 pb-7 pt-6 sm:px-8 lg:hidden" style={{ background: PANEL_BACKGROUND }}>
        <PanelPattern rosette={false} />
        <div className="relative mx-auto max-w-3xl">
          <BrandName />
          <p className="mt-5 text-[22px] font-bold leading-[1.6] text-white sm:text-[26px]" style={{ fontFamily: AUTH_DISPLAY_FONT }}>
            منشأتك كلها في نظام واحد
          </p>
        </div>
      </header>

      {/* عمود البطاقة */}
      <main className="flex flex-col lg:order-1 lg:min-h-screen">
        <div className="flex flex-1 items-start justify-center px-4 py-8 sm:px-8 lg:items-center lg:py-14">
          <div className={`w-full ${wide ? "max-w-[760px]" : "max-w-[440px]"}`}>
            <div
              className="rounded-2xl border bg-white p-6 sm:p-9"
              style={{ borderColor: AUTH_COLORS.line, boxShadow: "0 1px 2px rgba(11,61,46,0.06), 0 18px 44px -22px rgba(11,61,46,0.28)" }}
            >
              {icon ? <div className="mb-5">{icon}</div> : null}
              {title ? (
                <header className="mb-7">
                  <h1 className="text-[26px] font-bold leading-[1.5] tracking-normal sm:text-[28px]" style={{ fontFamily: AUTH_DISPLAY_FONT, color: AUTH_COLORS.ink }}>
                    {title}
                  </h1>
                  {subtitle ? <p className="mt-2 text-[15px] leading-7" style={{ color: AUTH_COLORS.muted }}>{subtitle}</p> : null}
                </header>
              ) : null}
              <div className="space-y-6">{children}</div>
            </div>
            {footer ? (
              <div className="mt-6 space-y-2 text-center text-[14px]" style={{ color: AUTH_COLORS.muted }}>{footer}</div>
            ) : null}
          </div>
        </div>

        {/* الجوال: أقسام النظام */}
        <section aria-labelledby="auth-modules-mobile" className="px-4 pb-8 sm:px-8 lg:hidden">
          <div className="relative mx-auto max-w-[760px] overflow-hidden rounded-2xl p-6" style={{ background: PANEL_BACKGROUND }}>
            <PanelPattern />
            <div className="relative">
              <h2 id="auth-modules-mobile" className="mb-5 text-[16px] font-bold tracking-normal" style={{ color: AUTH_COLORS.goldSoft, fontFamily: AUTH_DISPLAY_FONT }}>
                ما تحصل عليه منشأتك
              </h2>
              <ModuleGrid compact />
              <div className="mt-6 border-t pt-5" style={{ borderColor: "rgba(201,162,77,0.3)" }}>
                <AssuranceList />
              </div>
            </div>
          </div>
        </section>

        <p className="px-5 pb-6 text-center text-xs" style={{ color: AUTH_COLORS.muted }}>
          © {new Date().getFullYear()} {PLATFORM_NAME_AR}. جميع الحقوق محفوظة
        </p>
      </main>

      {/* الشاشة الكبيرة: لوحة المنصة يسار الشاشة، ثابتة عند التمرير */}
      <aside
        aria-labelledby="auth-modules-desktop"
        className="relative hidden overflow-hidden lg:order-2 lg:sticky lg:top-0 lg:block lg:h-screen lg:self-start"
        style={{ background: PANEL_BACKGROUND }}
      >
        <PanelPattern />
        {/* على الشاشات القصيرة تُخفى الأجزاء الثانوية، وما زاد يُمرَّر داخل اللوحة ولا يُقص */}
        <div className="relative flex h-full flex-col justify-between gap-6 overflow-y-auto px-8 py-8 [scrollbar-width:none] xl:px-12 xl:py-10">
        <div>
          <BrandName />
        </div>
        <div>
          <p className={`font-bold leading-[1.55] text-white ${wide ? "text-[24px] xl:text-[30px]" : "text-[26px] xl:text-[36px]"}`} style={{ fontFamily: AUTH_DISPLAY_FONT }}>
            منشأتك كلها في نظام واحد
          </p>
          <p className="mt-3 hidden max-w-[30rem] text-[15px] leading-8 text-white/75 xl:block [@media(max-height:780px)]:hidden">
            المبيعات والمشتريات والمخزون والمحاسبة والموارد البشرية مترابطة: كل فاتورة وكل راتب يصل إلى قيده المحاسبي دون إدخال مرتين.
          </p>
          <h2 id="auth-modules-desktop" className="mb-4 mt-6 text-[15px] xl:mb-5 xl:mt-9 font-bold tracking-normal" style={{ color: AUTH_COLORS.goldSoft, fontFamily: AUTH_DISPLAY_FONT }}>
            ما تحصل عليه منشأتك
          </h2>
          <ModuleGrid details={!wide} />
        </div>
        <div className="border-t pt-6 [@media(max-height:720px)]:hidden" style={{ borderColor: "rgba(201,162,77,0.3)" }}>
          <AssuranceList />
        </div>
        </div>
      </aside>
    </div>
  );
}
