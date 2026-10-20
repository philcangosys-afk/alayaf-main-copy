import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BedDouble,
  Brush,
  CalendarPlus,
  CalendarRange,
  ConciergeBell,
  LogOut,
  Menu,
  Settings2,
  UserRound,
  Wallet,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import {
  hotelAccessAllowed,
  permissionForHotelPath,
  permissionLevelAny,
  readUserSession,
} from "@/lib/authSession";

type HotelNavItem = { icon: typeof ConciergeBell; label: string; href: string; manageOnly?: boolean };

/* ── S20: قائمة قسم الحجوزات (لوحة مستقلة مثل الموارد البشرية) ── */
export const hotelNavItems: HotelNavItem[] = [
  { icon: ConciergeBell, label: "لوحة الاستقبال", href: "/hotel" },
  { icon: CalendarRange, label: "الحجوزات", href: "/hotel/reservations" },
  { icon: CalendarPlus, label: "حجز جديد", href: "/hotel/reservations/new", manageOnly: true },
  { icon: UserRound, label: "النزلاء", href: "/hotel/guests" },
  { icon: Wallet, label: "المقبوضات", href: "/hotel/payments" },
  { icon: Brush, label: "التنظيف والصيانة", href: "/hotel/housekeeping" },
  { icon: BedDouble, label: "الوحدات وأنواعها", href: "/hotel/setup" },
  { icon: Settings2, label: "إعدادات الحجوزات", href: "/hotel/settings" },
];

const isItemActive = (pathname: string, href: string) =>
  href === "/hotel"
    ? pathname === "/hotel" || pathname === "/hotel/"
    : href === "/hotel/reservations"
      ? pathname.startsWith("/hotel/reservations") && pathname !== "/hotel/reservations/new"
      : pathname.startsWith(href);

export default function HotelSidebar({
  sidebarOpen,
  setSidebarOpen,
}: {
  sidebarOpen: boolean;
  setSidebarOpen: (value: boolean) => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useI18n();
  const { permissions } = useRolePermissions();
  const userSession = readUserSession();

  const items = useMemo(
    () =>
      hotelNavItems.filter((item) => {
        if (item.href === "/hotel") return hotelAccessAllowed(permissions);
        const level = permissionLevelAny(permissions, permissionForHotelPath(item.href));
        return item.manageOnly ? level === "manage" : level !== "none";
      }),
    [permissions],
  );

  return (
    <aside
      className={cn(
        "relative flex h-full flex-shrink-0 flex-col overflow-hidden transition-all duration-300",
        sidebarOpen ? "w-[260px]" : "w-[72px]",
      )}
      style={{ background: "linear-gradient(180deg, #2a0e1f 0%, #3a1430 45%, #22101f 100%)" }}
    >
      <div className="pointer-events-none absolute -top-20 left-1/2 h-44 w-44 -translate-x-1/2 rounded-full bg-amber-300/[0.08] blur-[80px]" />

      {/* ── العنوان ── */}
      <div className="relative z-10 px-4 pb-4 pt-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-amber-200/30 bg-gradient-to-br from-amber-200 to-amber-500 text-[#3a1430] shadow-lg shadow-amber-500/20">
              <ConciergeBell className="h-5 w-5" />
            </div>
            {sidebarOpen && (
              <div className="flex flex-col">
                <span className="text-[14px] font-extrabold leading-tight text-amber-50">{t("الحجوزات")}</span>
                <span className="text-[10px] font-medium text-amber-200/60">{t("الفنادق والشقق المفروشة")}</span>
              </div>
            )}
          </div>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="rounded-xl p-2 text-amber-50/40 transition hover:bg-white/[0.06] hover:text-amber-50"
            title={t(sidebarOpen ? "تصغير القائمة" : "توسيع القائمة")}
          >
            {sidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div className="relative z-10 mx-4 h-px bg-gradient-to-l from-transparent via-amber-200/20 to-transparent" />

      {/* ── العودة للقائمة الرئيسية ── */}
      <div className="relative z-10 px-3 pb-1 pt-3">
        <button
          onClick={() => navigate("/")}
          className="flex w-full items-center gap-3 rounded-xl border border-amber-200/15 px-3 py-2.5 text-[13px] font-medium text-amber-100/70 transition hover:border-amber-200/30 hover:bg-amber-200/[0.06] hover:text-amber-50"
        >
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-amber-200/10">
            <ArrowRight className="h-4 w-4" />
          </div>
          {sidebarOpen && <span>{t("العودة للقائمة الرئيسية")}</span>}
        </button>
      </div>

      {/* ── القائمة ── */}
      <nav className="main-sidebar-nav relative z-10 flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-3">
        {items.map((item) => {
          const Icon = item.icon;
          const active = isItemActive(location.pathname, item.href);
          return (
            <button
              key={item.href}
              onClick={() => navigate(item.href)}
              title={t(item.label)}
              className={cn(
                "group flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-[13px] font-medium transition",
                active
                  ? "border-amber-200/25 bg-amber-200/[0.12] text-amber-50"
                  : "border-transparent text-amber-50/55 hover:bg-white/[0.04] hover:text-amber-50/90",
              )}
            >
              <div
                className={cn(
                  "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition",
                  active ? "bg-gradient-to-br from-amber-200 to-amber-500 text-[#3a1430]" : "bg-white/[0.05] text-amber-50/50 group-hover:text-amber-50/80",
                )}
              >
                <Icon className="h-4 w-4" />
              </div>
              {sidebarOpen && <span className={cn("flex-1 truncate text-start", active && "font-semibold")}>{t(item.label)}</span>}
            </button>
          );
        })}
      </nav>

      <div className="relative z-10 mx-4 h-px bg-gradient-to-l from-transparent via-amber-200/10 to-transparent" />

      {/* ── المستخدم ── */}
      <div className="relative z-10 p-3">
        <div className={cn("flex items-center gap-3 rounded-2xl border border-amber-200/10 bg-white/[0.03] px-3 py-3", !sidebarOpen && "justify-center px-0")}>
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-200 to-amber-500 text-[12px] font-bold text-[#3a1430]">
            {(userSession?.name || "م").trim().charAt(0)}
          </div>
          {sidebarOpen && (
            <>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-bold text-amber-50/90">{userSession?.name || t("مدير النظام")}</p>
                <p className="truncate text-[10px] text-amber-100/40">{userSession?.role || ""}</p>
              </div>
              <button
                onClick={async () => {
                  localStorage.removeItem("user_session");
                  const { supabase: sb } = await import("@/lib/supabaseClient");
                  await sb.auth.signOut();
                  navigate("/login");
                }}
                className="rounded-lg p-1.5 text-amber-50/30 transition hover:bg-white/[0.06] hover:text-red-300"
                title={t("تسجيل الخروج")}
              >
                <LogOut className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
