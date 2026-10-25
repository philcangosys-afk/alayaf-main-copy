import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { POS_PERMISSION_KEYS, readUserSession, type PermissionLevel, type PermissionMap } from "@/lib/authSession";
import { USER_SESSION_EVENT } from "@/lib/businessSession";

type PermState = {
  permissions: PermissionMap;
  ready: boolean;
};

const ADMIN_ROLES = ["مدير النظام", "مدير عام", "المدير العام"];
const levelOf = (value: unknown) => (value === true || value === "manage" ? 2 : value === "read" ? 1 : 0);

type GrantRow = { is_employee?: boolean; role_name?: string | null; permissions?: unknown };

/** دمج صلاحيات أكثر من حساب: لكل مفتاح أعلى مستوى */
function mergeGrants(rows: GrantRow[]): PermissionMap {
  if (rows.some((row) => row.is_employee && ADMIN_ROLES.includes(String(row.role_name ?? "")))) return { "*": "manage" };
  const merged: PermissionMap = {};
  const maps = rows.map((row) => (row.permissions && typeof row.permissions === "object" && !Array.isArray(row.permissions)
    ? (row.permissions as Record<string, PermissionLevel>)
    : {}));
  maps.forEach((perms) => {
    Object.entries(perms).forEach(([key, value]) => {
      if (!(key in merged) || levelOf(value) > levelOf(merged[key])) merged[key] = value;
    });
  });
  // S22: نقاط البيع — مستوى كل مفتاح فرعي في كل حساب (المحدد يحسم ولو «بلا وصول»، وغير المحدد يأخذ module.pos)،
  // ثم الأعلى بين الحسابات، كما يحكم الخادم pos_can. يُكتب صريحًا فلا يعود الدمج إلى module.pos
  POS_PERMISSION_KEYS.forEach((key) => {
    let best = -1;
    maps.forEach((perms) => {
      const value = key in perms ? perms[key] : perms["module.pos"];
      if (value !== undefined) best = Math.max(best, levelOf(value));
    });
    if (best >= 0) merged[key] = best === 2 ? "manage" : best === 1 ? "read" : false;
  });
  return merged;
}

/**
 * صلاحيات المستخدم الحالي من قاعدة البيانات عند كل تنقل، فتسري تعديلات الأدوار فورًا دون إعادة دخول.
 * المصدر current_account_grants() (الدور الحالي من سجل الموظف، والموظف غير الفعال بلا صلاحيات)،
 * وإن لم تكن الدالة موجودة (قبل K2) فمن user_roles باسم الدور المحفوظ عند الدخول.
 */
export function useRolePermissions(): PermState {
  const location = useLocation();
  const [state, setState] = useState<PermState>({ permissions: {}, ready: false });
  // جلسة النظام جُهّزت أو تغيّرت: تُعاد قراءة الصلاحيات
  const [sessionVersion, setSessionVersion] = useState(0);
  useEffect(() => {
    const onSessionChanged = () => {
      setState((current) => ({ ...current, ready: false }));
      setSessionVersion((value) => value + 1);
    };
    window.addEventListener(USER_SESSION_EVENT, onSessionChanged);
    return () => window.removeEventListener(USER_SESSION_EVENT, onSessionChanged);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const session = readUserSession();

    const legacy = () => {
      if (!session?.role) {
        setState({ permissions: {}, ready: true });
        return;
      }
      if (session.accountType !== "special" && ADMIN_ROLES.includes(session.role)) {
        setState({ permissions: { "*": "manage" }, ready: true });
        return;
      }
      supabase
        .from("user_roles")
        .select("permissions")
        .eq("name_ar", session.role)
        .eq("status", "فعال")
        .maybeSingle()
        .then(({ data }) => {
          if (cancelled) return;
          const perms =
            data?.permissions && typeof data.permissions === "object" && !Array.isArray(data.permissions)
              ? (data.permissions as PermissionMap)
              : {};
          setState({ permissions: perms, ready: true });
        });
    };

    if (!session) {
      setState({ permissions: {}, ready: true });
      return;
    }
    supabase.rpc("current_account_grants").then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        legacy();
        return;
      }
      setState({ permissions: mergeGrants((data ?? []) as GrantRow[]), ready: true });
    });
    return () => { cancelled = true; };
  // refetch on every route change so role-editor updates are immediate
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, sessionVersion]);

  return state;
}
