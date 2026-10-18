import { useEffect, type ReactNode } from "react";
import { PLATFORM_NAME_AR } from "@/lib/companyProfile";

/**
 * إطار صفحات ما قبل الدخول (الدخول، والتسجيل، وتسجيل المنشأة، وحالتها، وتعيين كلمة المرور).
 * عمودان على الشاشات الكبيرة: عمود النموذج (يمين الشاشة، أول ما يقرؤه المستخدم) ولوحة المنصة الزمردية (اسم النظام وما تحصل عليه المنشأة).
 * على الجوال: شريط المنصة أعلى الصفحة، ثم النموذج، ثم قائمة الأقسام.
 */

/** ألوان صفحات الدخول والتسجيل */
export const AUTH_COLORS = {
  ink: "#0E3B2E",
  emerald: "#14775A",
  emeraldHover: "#0F5E47",
  mint: "#EAF4EF",
  gold: "#C8A04A",
  goldSoft: "#E9D9A8",
  page: "#F3F7F5",
  text: "#10261E",
  muted: "#5B6F67",
  line: "#D7E3DD",
} as const;

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

export const AUTH_BODY_FONT = "'IBM Plex Sans Arabic', 'Tajawal', sans-serif";
export const AUTH_DISPLAY_FONT = "'Noto Kufi Arabic', 'Tajawal', sans-serif";

/** أقسام النظام كما تراها المنشأة: الاسم وما تحصل عليه منه */
const MODULES: Array<{ name: string; detail: string }> = [
  { name: "المبيعات والفوترة", detail: "عروض الأسعار وأوامر البيع والفواتير وإشعاراتها" },
  { name: "المشتريات", detail: "أوامر الشراء وفواتير الموردين وإشعاراتهم والبيانات الجمركية" },
  { name: "المخزون", detail: "الأصناف والمستودعات والحركات والجرد" },
  { name: "المحاسبة", detail: "دليل الحسابات والقيود التلقائية والقوائم المالية" },
  { name: "الموارد البشرية", detail: "الموظفون والحضور والإجازات والرواتب" },
  { name: "العملاء والموردون", detail: "السجلات والأرصدة وكشوف الحساب" },
  { name: "الأسطول", detail: "المركبات والسائقون والصيانة والوقود" },
  { name: "المهام والمشاريع", detail: "مهام الفرق ومتابعة الإنجاز" },
];

/** نقش هندسي خفيف بخطوط ذهبية (نجمة ثمانية متكررة) خلف لوحة المنصة */
function GeometricPattern() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
      <defs>
        <pattern id="auth-star" width="96" height="96" patternUnits="userSpaceOnUse">
          <g fill="none" stroke={AUTH_COLORS.gold} strokeWidth="0.8" opacity="0.16">
            <rect x="28" y="28" width="40" height="40" />
            <rect x="28" y="28" width="40" height="40" transform="rotate(45 48 48)" />
            <path d="M0 48 H20 M76 48 H96 M48 0 V20 M48 76 V96" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#auth-star)" />
    </svg>
  );
}

/** قائمة الأقسام: لوحة بإطار ذهبي رفيع تسرد ما تحصل عليه المنشأة */
function ModuleDirectory({ compact = false }: { compact?: boolean }) {
  // تظهر القائمة مرتين (لوحة الشاشة الكبيرة وأسفل الجوال)، فلكل نسخة معرّف عنوان مختلف
  const titleId = compact ? "auth-modules-title-compact" : "auth-modules-title";
  return (
    <section
      aria-labelledby={titleId}
      className={`relative rounded-md border ${compact ? "p-5" : "p-6"}`}
      style={{ borderColor: `${AUTH_COLORS.gold}80`, background: "rgba(255,255,255,0.03)" }}
    >
      <h2 id={titleId} className="text-base font-bold tracking-normal" style={{ color: AUTH_COLORS.goldSoft, fontFamily: AUTH_DISPLAY_FONT }}>
        ما تحصل عليه منشأتك
      </h2>
      <ul className="mt-4">
        {MODULES.map((module) => (
          <li
            key={module.name}
            className={`flex flex-col gap-0.5 border-t py-2.5 first:border-t-0 ${compact ? "sm:flex-row sm:items-baseline sm:gap-3" : "xl:flex-row xl:items-baseline xl:gap-3"}`}
            style={{ borderColor: "rgba(233,217,168,0.14)" }}
          >
            <span className={`shrink-0 text-[15px] font-semibold text-white ${compact ? "sm:w-36" : "xl:w-36"}`}>{module.name}</span>
            <span className="text-[13px] leading-6 text-white/65">{module.detail}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 border-t pt-4 text-[13px] leading-6 text-white/70" style={{ borderColor: `${AUTH_COLORS.gold}55` }}>
        بيانات كل منشأة معزولة عن غيرها، ولكل موظف صلاحيات حسب دوره، وفروعك وأقسامك كلها في حساب واحد.
      </p>
    </section>
  );
}

function BrandMark({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <rect x="1" y="1" width="46" height="46" rx="10" fill={AUTH_COLORS.emerald} stroke={AUTH_COLORS.gold} strokeWidth="1.5" />
      <g fill="none" stroke={AUTH_COLORS.goldSoft} strokeWidth="2" strokeLinejoin="round">
        <path d="M13 35 V19 l11 -6 l11 6 V35" />
        <path d="M19 35 V27 h10 V35" />
        <path d="M10 35 H38" />
      </g>
    </svg>
  );
}

export default function AuthShell({
  title,
  subtitle,
  children,
  wide = false,
  footer,
}: {
  /** عنوان عمود النموذج */
  title?: string;
  /** سطر تحت العنوان */
  subtitle?: string;
  children: ReactNode;
  /** نموذج أعرض (التسجيل وبيانات المنشأة) */
  wide?: boolean;
  /** سطر تحت النموذج (روابط التبديل بين الصفحات) */
  footer?: ReactNode;
}) {
  useAuthFonts();
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,44%)]" dir="rtl" style={{ background: AUTH_COLORS.page, fontFamily: AUTH_BODY_FONT, color: AUTH_COLORS.text }}>
      {/* لوحة المنصة: يسار الشاشة على الكبيرة، وشريط أعلى الصفحة على الجوال */}
      <aside className="relative overflow-hidden lg:order-2 lg:min-h-screen" style={{ background: AUTH_COLORS.ink }}>
        <GeometricPattern />
        <div className="relative mx-auto flex h-full max-w-xl flex-col px-6 py-8 sm:px-10 lg:justify-center lg:py-14">
          <div className="flex items-center gap-3">
            <BrandMark />
            <span className="text-lg font-bold" style={{ color: AUTH_COLORS.goldSoft, fontFamily: AUTH_DISPLAY_FONT }}>{PLATFORM_NAME_AR}</span>
          </div>
          <p className="mt-6 text-[26px] font-bold leading-[1.6] text-white sm:text-[32px]" style={{ fontFamily: AUTH_DISPLAY_FONT }}>
            منشأتك كلها في نظام واحد
          </p>
          <p className="mt-3 max-w-md text-[15px] leading-8 text-white/75">
            المبيعات والمشتريات والمخزون والمحاسبة والموارد البشرية مترابطة: كل فاتورة وكل راتب يصل إلى قيده المحاسبي دون إدخال مرتين.
          </p>
          <div className="mt-8 hidden lg:block">
            <ModuleDirectory />
          </div>
        </div>
      </aside>

      {/* عمود النموذج */}
      <main className="flex flex-col lg:order-1 lg:min-h-screen">
        <div className="flex flex-1 items-start justify-center px-5 py-10 sm:px-8 lg:items-center lg:py-14">
          <div className={`w-full ${wide ? "max-w-2xl" : "max-w-md"}`}>
            {title ? (
              <header className="mb-7">
                <h1 className="text-[28px] font-bold leading-[1.5] tracking-normal" style={{ fontFamily: AUTH_DISPLAY_FONT, color: AUTH_COLORS.ink }}>{title}</h1>
                {subtitle ? <p className="mt-1.5 text-[15px] leading-7" style={{ color: AUTH_COLORS.muted }}>{subtitle}</p> : null}
              </header>
            ) : null}
            <div className="space-y-6">{children}</div>
            {footer ? <div className="mt-8 space-y-2 border-t pt-6 text-[14px]" style={{ borderColor: AUTH_COLORS.line, color: AUTH_COLORS.muted }}>{footer}</div> : null}
          </div>
        </div>
        <div className="px-5 pb-10 sm:px-8 lg:hidden">
          <div className="mx-auto max-w-2xl rounded-lg p-1" style={{ background: AUTH_COLORS.ink }}>
            <ModuleDirectory compact />
          </div>
        </div>
        <p className="px-5 pb-6 text-center text-xs" style={{ color: AUTH_COLORS.muted }}>
          © {new Date().getFullYear()} {PLATFORM_NAME_AR}. جميع الحقوق محفوظة
        </p>
      </main>
    </div>
  );
}

/** حقول النماذج في صفحات ما قبل الدخول */
export const authInputClass =
  "w-full h-12 rounded-md border bg-white px-3.5 text-[15px] text-[#10261E] placeholder:text-[#93A59D] text-right transition focus:outline-none focus:border-[#14775A] focus:ring-2 focus:ring-[#14775A]/20 disabled:opacity-60 border-[#C9D8D1]";

export const authLabelClass = "mb-1.5 block text-[14px] font-medium text-[#24443A]";

/** الزر الرئيسي (تُطبَّق معه className للحجم) */
export const authButtonStyle = { background: AUTH_COLORS.emerald, color: "#fff" };

export const authButtonClass =
  "w-full h-12 rounded-md text-[15px] font-bold text-white transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#14775A] disabled:opacity-60";

/** رابط نصي بلون المنصة */
export const authLinkClass = "font-semibold text-[#14775A] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#14775A]/40 rounded-sm";

/** صندوق تنبيه هادئ (نجاح أو معلومة) */
export const authNoteClass = "rounded-md border px-4 py-3 text-[14px] leading-7";
