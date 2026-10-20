import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import {
  checkPerm, hotelAccessAllowed, permissionForHotelPath, permissionForHRPath, permissionForMainPath, permissionForMainSubPath,
  permissionLevelAny, readUserSession,
} from "@/lib/authSession";
import { useCompany } from "@/lib/companyContext";
import { isSaudiCompany, isSaudiOnlyPath } from "@/lib/companyProfile";
import { buildBusinessSession } from "@/lib/businessSession";
import { entitledPermissionKeys, moduleForPath, hasCompanyModule } from "@/lib/companyModules";
import ModuleNotIncluded from "@/components/ModuleNotIncluded";
import { toast } from "sonner";

/**
 * Route guard: only renders protected routes when a Supabase Auth session exists
 * and the account belongs to an ACTIVE company (multi-company system).
 * - no session            -> /login
 * - no company            -> /register-company
 * - pending / suspended / rejected / disabled / platform admin -> /company-status
 * RLS on the database isolates every company, so pages only run inside the user's company.
 */
export default function RequireAuth() {
  const location = useLocation();
  const company = useCompany();
  const { permissions, ready: permissionsReady } = useRolePermissions();
  const [status, setStatus] = useState<"loading" | "authed" | "guest">("loading");
  // جلسة النظام (الاسم والدور) لهذا الحساب؛ تُجهَّز هنا إن لم تكن موجودة،
  // مثلًا عند تفعيل المنشأة أثناء فتح صفحة الحالة أو بعد مسح بيانات المتصفح
  const [sessionUserId, setSessionUserId] = useState<string | null>(() => readUserSession()?.id ?? null);
  const [sessionFailed, setSessionFailed] = useState(false);
  const [sessionAttempt, setSessionAttempt] = useState(0);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (active) setStatus(data.session ? "authed" : "guest");
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setStatus(session ? "authed" : "guest");
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const companyActive = status === "authed" && !company.loading && company.status === "active";
  useEffect(() => {
    if (!companyActive || !company.userId) return;
    const current = readUserSession();
    if (current && current.id === company.userId) {
      setSessionUserId(current.id);
      return;
    }
    let active = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const user = data.user;
        if (!active || !user || user.id !== company.userId) return;
        const result = await buildBusinessSession(user.id, user.email ?? "");
        if (!active) return;
        if (!result.ok) {
          localStorage.removeItem("user_session");
          toast.error(result.reason === "inactive" ? "حسابك موقوف؛ راجع الموارد البشرية" : "لم يتم العثور على حساب نظام فعال");
          await supabase.auth.signOut();
          return;
        }
        setSessionUserId(user.id);
      } catch {
        if (active) setSessionFailed(true);
      }
    })();
    return () => { active = false; };
  }, [companyActive, company.userId, sessionAttempt]);

  if (status === "loading" || !permissionsReady || (status === "authed" && company.loading)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50" dir="rtl">
        <Loader2 className="h-8 w-8 animate-spin text-[#004e89]" />
      </div>
    );
  }

  if (status === "guest") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (company.status === "error" || (sessionFailed && company.status === "active")) {
    // تعذر التحقق (اتصال/خادم): نعرض إعادة المحاولة ولا نرسل المستخدم لتسجيل منشأة
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gray-50 p-6 text-center" dir="rtl">
        <p className="text-lg font-bold text-slate-800">تعذر التحقق من حساب المنشأة</p>
        <p className="text-sm text-slate-500">تحقق من الاتصال ثم أعد المحاولة.</p>
        <button
          type="button"
          onClick={() => {
            if (sessionFailed) {
              setSessionFailed(false);
              setSessionAttempt((value) => value + 1);
            } else {
              void company.refresh();
            }
          }}
          className="rounded-lg bg-[#004e89] px-5 py-2 text-sm font-bold text-white"
        >
          إعادة المحاولة
        </button>
      </div>
    );
  }

  if (company.status !== "active") {
    const target = company.status === "none" && !company.isPlatformAdmin ? "/register-company" : "/company-status";
    return <Navigate to={target} replace />;
  }

  if (!company.userId || sessionUserId !== company.userId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50" dir="rtl">
        <Loader2 className="h-8 w-8 animate-spin text-[#004e89]" />
      </div>
    );
  }

  // S19: صفحة من قسم غير مشمول في باقة المنشأة (الخادم يحجب بياناته على أي حال)
  const pathModule = moduleForPath(location.pathname);
  if (pathModule && !hasCompanyModule(company.modules, pathModule)) {
    return <ModuleNotIncluded module={pathModule} />;
  }

  // S20: الحجوزات: أي مفتاح يمنح (كما في الخادم)، ولوحة الاستقبال لمن يملك أي صلاحية حجوزات
  if (location.pathname.startsWith("/hotel")) {
    const allowed = location.pathname === "/hotel" || location.pathname === "/hotel/"
      ? hotelAccessAllowed(permissions)
      : permissionLevelAny(permissions, permissionForHotelPath(location.pathname)) !== "none";
    return allowed ? <Outlet /> : <Navigate to="/" replace />;
  }

  // «الطلبات الواردة» لكل مستخدم: تعرض ما وُجّه إليه فقط (المستلم في قاعدة البيانات)، فمعتمد الرواتب
  // أو المدير المباشر يقرر في طلبه ولو لم تكن له صلاحية قسم الطلبات
  if (location.pathname !== "/" && !location.pathname.startsWith("/hr/requests/incoming")) {
    const mainKey = permissionForMainPath(location.pathname);
    // مفاتيح الأقسام غير المشمولة لا تفتح صفحة (سجل النشاط بـ module.hr بلا الموارد البشرية مثلًا)
    const keys = entitledPermissionKeys(company.modules,
      location.pathname.startsWith("/hr") ? permissionForHRPath(location.pathname) : permissionForMainSubPath(location.pathname));
    if (mainKey && !checkPerm(permissions, ...keys)) return <Navigate to="/" replace />;
    // الصفحات السعودية (الهيئة والتأمينات والإقرار الضريبي) لمنشآت السعودية فقط (S14)
    if (isSaudiOnlyPath(location.pathname) && !isSaudiCompany(company.company?.country)) return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
