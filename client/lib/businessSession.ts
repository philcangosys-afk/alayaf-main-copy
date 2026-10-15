import { supabase } from "@/lib/supabaseClient";
import { isEmployeeActive } from "@/lib/employeeStatus";
import type { UserSession } from "@/lib/authSession";

/**
 * جلسة بوابة الإدارة بعد الدخول (داخل منشأة فعالة):
 * الحساب موظف في المنشأة (ببريده) أو مستخدم خاص فعال، والصلاحيات من دوره.
 * كل الاستعلامات معزولة بقاعدة البيانات على منشأة المستخدم.
 */
export const USER_SESSION_EVENT = "user-session-changed";

export type BusinessSessionResult = {
  ok: boolean;
  session?: UserSession;
  reason?: "inactive" | "not_found";
};

export async function buildBusinessSession(userId: string, userEmail: string): Promise<BusinessSessionResult> {
  const email = userEmail.trim().toLowerCase();
  const { data: empData, error: empError } = await supabase
    .from("employees")
    .select("id, emp_id, name, employee_role, permissions, status")
    .eq("email", email)
    .maybeSingle();

  if (empData && !isEmployeeActive(empData.status)) return { ok: false, reason: "inactive" };

  let accountName = empData?.name ?? "";
  let accountRole = empData?.employee_role ?? "";
  let accountRoleId = "";
  const accountEmpId = empData?.emp_id ?? "";
  let accountType: "employee" | "special" = "employee";

  if (empError || !empData) {
    const { data: systemUser, error: systemUserError } = await supabase
      .from("system_users")
      .select("full_name, role_id, status")
      .eq("auth_user_id", userId)
      .eq("status", "فعال")
      .maybeSingle();
    if (systemUserError || !systemUser) return { ok: false, reason: "not_found" };
    accountName = String(systemUser.full_name);
    accountRoleId = String(systemUser.role_id);
    accountType = "special";
  }

  let resolvedPermissions: Record<string, boolean> = {};
  if (accountRole || accountRoleId) {
    let roleQuery = supabase.from("user_roles").select("name_ar, permissions").eq("status", "فعال");
    roleQuery = accountRoleId ? roleQuery.eq("id", accountRoleId) : roleQuery.eq("name_ar", accountRole);
    const { data: roleData } = await roleQuery.maybeSingle();
    if (!accountRole) accountRole = String(roleData?.name_ar ?? "");
    if (roleData?.permissions && typeof roleData.permissions === "object" && !Array.isArray(roleData.permissions)) {
      resolvedPermissions = roleData.permissions as Record<string, boolean>;
    }
  }

  const session: UserSession = {
    id: userId,
    email,
    empId: accountEmpId,
    name: accountName,
    role: accountRole,
    permissions: resolvedPermissions,
    portal: "business",
    accountType,
  };
  localStorage.setItem("user_session", JSON.stringify(session));
  // الصلاحيات المعروضة تُعاد قراءتها فورًا بعد تجهيز الجلسة
  window.dispatchEvent(new Event(USER_SESSION_EVENT));
  return { ok: true, session };
}
