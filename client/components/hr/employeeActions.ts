import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { employeeErrorText } from "@/components/hr/employeeErrors";
import type { EmpFormData } from "@/pages/EmployeeForm";
import { isEmployeeActive } from "@/lib/employeeStatus";

type Translate = (text: string) => string;

const ADMIN_ROLES = ["مدير النظام", "مدير عام", "المدير العام"];
export { INACTIVE_EMPLOYEE_STATUSES } from "@/lib/employeeStatus";

// إيقاف أو إعادة دخول الموظف (حساب Supabase Auth) عند تعطيله أو تفعيله
export async function setEmployeeLoginState(
  employeeId: string,
  enabled: boolean,
): Promise<{ ok: boolean; message: string; previouslyBanned?: boolean }> {
  const { data, error } = await supabase.functions.invoke("manage-employee-auth", {
    body: { action: "set-login-state", employeeId, enabled },
  });
  const body = data as { success?: boolean; error?: string; previouslyBanned?: boolean } | null;
  if (!error && body?.success === true) return { ok: true, message: "", previouslyBanned: body.previouslyBanned === true };
  let message = body?.error || error?.message || "";
  const context = (error as { context?: Response } | null)?.context;
  if (!body?.error && context && typeof context.json === "function") {
    try {
      const parsed = await context.clone().json();
      message = String(parsed?.error ?? parsed?.message ?? message);
    } catch {
      // ignore
    }
  }
  return { ok: false, message: message || "تعذر تحديث حالة حساب الدخول" };
}

// حذف موظف بلا سجلات مرتبطة؛ وإن كانت له سجلات يمنعه الخادم (EMPLOYEE_HAS_RECORDS) ونعرض تعطيله بدل الحذف،
// مع إيقاف حساب دخوله.
export async function deleteOrDeactivateEmployee(emp: EmpFormData, t: Translate): Promise<"deleted" | "deactivated" | "none"> {
  const label = emp.name || emp.firstName;
  if (ADMIN_ROLES.includes(emp.employeeRole)) {
    toast({ title: t("سجل مدير النظام محمي"), description: t("لا يُحذف ولا يُعطّل من هنا"), variant: "destructive" });
    return "none";
  }
  if (!confirm(`${t("هل تريد حذف الموظف")} "${label}"؟\n${t("الحذف متاح فقط لموظف ليس له أي سجلات (حضور، رواتب، طلبات...).")}`)) return "none";
  // موظف دوره فوق صلاحياتك لا يُحذف ولا يُعطَّل (يرفضه الخادم)؛ نتحقق قبل إيقاف دخوله
  const { data: violations, error: ceilingError } = await supabase.rpc("grant_ceiling_violations", {
    p_role: emp.employeeRole ?? "",
    p_permissions: null,
  });
  const ceilingMissing = Boolean(ceilingError && (ceilingError.code === "PGRST202" || ceilingError.code === "42883"));
  if ((ceilingError && !ceilingMissing) || (!ceilingError && violations)) {
    toast({
      title: t("تعذر الحذف"),
      description: ceilingError ? t(employeeErrorText(ceilingError)) : t("دور هذا الموظف فيه صلاحيات أعلى من صلاحياتك؛ يحذفه أو يعطّله مدير النظام"),
      variant: "destructive",
    });
    return "none";
  }

  // حساب الدخول يُوقف قبل الحذف (بعد الحذف لا يُعرف الموظف فيبقى الحساب قادرًا على الدخول)
  const wasActive = isEmployeeActive(emp.status);
  let loginStopped = false;
  let wasBanned = false;
  if (String(emp.email ?? "").trim()) {
    const stop = await setEmployeeLoginState(emp.id, false);
    if (!stop.ok) {
      toast({ title: t("تعذر الحذف"), description: `${t("تعذر إيقاف حساب الدخول أولًا")}: ${t(stop.message)}`, variant: "destructive" });
      return "none";
    }
    loginStopped = true;
    wasBanned = stop.previouslyBanned === true;
  }
  // إن لم يكتمل الحذف ولا التعطيل يُعاد الدخول كما كان (ولا يُفك حظر كان موجودًا قبلنا)
  const restoreLogin = async () => {
    if (!loginStopped || !wasActive || wasBanned) return;
    const restored = await setEmployeeLoginState(emp.id, true);
    if (!restored.ok) {
      toast({ title: t("لم يُعَد حساب دخول الموظف"), description: `${t("أعد تفعيله من نموذج الموظف")}: ${t(restored.message)}`, variant: "destructive" });
    }
  };
  const { error } = await supabase.from("employees").delete().eq("id", emp.id).select("id").single();
  if (!error) {
    toast({ title: t("تم الحذف"), description: `${t("تم حذف الموظف")}: ${label}` });
    return "deleted";
  }
  const hasRecords = /EMPLOYEE_HAS_RECORDS/.test(`${error.message} ${error.details ?? ""}`) || error.code === "23503";
  if (!hasRecords) {
    await restoreLogin();
    toast({ title: t("تعذر الحذف"), description: t(employeeErrorText(error, "فشل حذف الموظف")), variant: "destructive" });
    return "none";
  }
  if (!wasActive) {
    toast({ title: t("لا يمكن حذف الموظف"), description: t("للموظف سجلات مرتبطة، وهو غير فعال أصلًا."), variant: "destructive" });
    return "none";
  }
  if (!confirm(`${t("لا يمكن حذف")} "${label}" ${t("لأن له سجلات مرتبطة.")}\n${t("هل تريد تحويله إلى غير فعال وإيقاف دخوله بدلًا من ذلك؟")}`)) {
    await restoreLogin();
    return "none";
  }
  const { error: statusError } = await supabase.from("employees").update({ status: "غير فعال" }).eq("id", emp.id).select("id").single();
  if (statusError) {
    await restoreLogin();
    toast({ title: t("تعذر التعطيل"), description: t(employeeErrorText(statusError)), variant: "destructive" });
    return "none";
  }
  const login = loginStopped ? { ok: true, message: "" } : await setEmployeeLoginState(emp.id, false);
  toast({ title: t("تم التعطيل"), description: `${label} ${t("أصبح غير فعال ويظهر في صفحة الموظفين غير الفعالين")}` });
  if (!login.ok) {
    toast({ title: t("لم يُوقف حساب الدخول"), description: t(login.message), variant: "destructive" });
  }
  return "deactivated";
}
