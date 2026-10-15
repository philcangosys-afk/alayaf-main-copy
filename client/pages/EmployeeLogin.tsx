import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eye, EyeOff, Lock, User, Users2 } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import type { UserSession } from "@/lib/authSession";
import { PLATFORM_NAME_AR } from "@/lib/companyProfile";
import { companyStatusMessage, loadCompanyState } from "@/lib/companyContext";
import { isEmployeeActive } from "@/lib/employeeStatus";

export default function EmployeeLogin() {
  const navigate = useNavigate();
  const [empId, setEmpId] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!empId.trim() || !password.trim()) {
      toast.error("يجب ملء جميع الحقول");
      return;
    }
    setLoading(true);
    try {
      // البريد لا يُكشف إلا بكلمة المرور الصحيحة (employee_login_email)، مع حد للمحاولات.
      // الرقم الوظيفي يحمل رقم المنشأة (مثل 1001-EMP-0002) فلا يلتبس بين المنشآت.
      localStorage.removeItem("user_session");
      const { data: loginData, error: loginError } = await supabase.rpc("employee_login_email", {
        p_emp_id: empId.trim(),
        p_password: password,
      });
      if (loginError) {
        toast.error("تعذر التحقق من بيانات الدخول، حاول مرة أخرى");
        return;
      }
      const loginResult = (loginData ?? {}) as { status?: string; email?: string; retry_after_minutes?: number };
      if (loginResult.status === "locked") {
        toast.error(`محاولات دخول كثيرة لهذا الرقم؛ حاول بعد ${loginResult.retry_after_minutes ?? 15} دقيقة`);
        return;
      }
      if (loginResult.status === "busy") {
        toast.error("الخادم مشغول بمحاولات دخول كثيرة؛ حاول بعد دقيقة");
        return;
      }
      if (loginResult.status !== "ok" || !loginResult.email) {
        toast.error("بيانات الدخول غير صحيحة");
        return;
      }
      const resolvedEmail = loginResult.email;

      const { data: authData, error: authError } =
        await supabase.auth.signInWithPassword({
          email: resolvedEmail.toLowerCase(),
          password,
        });
      if (authError) {
        toast.error("بيانات الدخول غير صحيحة");
        return;
      }

      // نظام الشركات: الموظف يتبع منشأة فعالة
      const company = await loadCompanyState();
      if (company.status === "error") {
        toast.error("تعذر التحقق من حساب المنشأة؛ حاول مرة أخرى");
        await supabase.auth.signOut();
        return;
      }
      if (company.status !== "active") {
        const message = companyStatusMessage(company);
        toast.error(message.title || "لا يمكن الدخول الآن");
        await supabase.auth.signOut();
        return;
      }

      const { data: empData, error: profileError } = await supabase
        .from("employees")
        .select("id, emp_id, account_title, name, employee_role, permissions, status")
        .ilike("email", resolvedEmail.replace(/[\\%_]/g, (character) => `\\${character}`))
        .maybeSingle();

      if (profileError || !empData) {
        toast.error("لم يتم العثور على بيانات الموظف");
        await supabase.auth.signOut();
        return;
      }
      if (!isEmployeeActive(empData.status)) {
        toast.error("حسابك موقوف؛ راجع الموارد البشرية");
        await supabase.auth.signOut();
        return;
      }

      const session: UserSession = {
        id: authData.user.id,
        email: authData.user.email ?? resolvedEmail.toLowerCase(),
        empId: empData.emp_id || empId,
        name: empData.name,
        role: empData.employee_role ?? "موظف",
        permissions: (Array.isArray(empData.permissions)
          ? {}
          : (empData.permissions ?? {})) as Record<string, boolean>,
        portal: "employee",
      };
      localStorage.setItem("user_session", JSON.stringify(session));

      toast.success(`مرحباً ${empData.name}`);
      setTimeout(() => navigate("/employee/dashboard"), 400);
    } catch {
      toast.error("حدث خطأ ما");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      dir="rtl"
      style={{
        background:
          "linear-gradient(135deg, #052e16 0%, #14532d 40%, #064e3b 70%, #012617 100%)",
      }}
    >
      {/* Background glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute top-20 left-1/4 h-72 w-72 rounded-full bg-emerald-500/10 blur-[120px]" />
        <div className="absolute bottom-20 right-1/4 h-72 w-72 rounded-full bg-teal-500/10 blur-[120px]" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-5">
            <div
              className="relative flex h-20 w-20 items-center justify-center rounded-2xl shadow-2xl shadow-emerald-500/30"
              style={{
                background: "linear-gradient(135deg, #059669, #0d9488)",
              }}
            >
              <Users2 className="h-10 w-10 text-white" />
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-white/20 to-transparent" />
            </div>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight leading-tight">
            بوابة الموظفين
          </h1>
          <p className="mt-2 text-emerald-200/70 text-sm">
            نظام الموارد البشرية · {PLATFORM_NAME_AR}
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl bg-white/[0.04] border border-white/10 backdrop-blur-md shadow-2xl p-8 space-y-6">
          <form onSubmit={handleLogin} className="space-y-5">
            {/* Employee ID */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-white/70">
                الرقم الوظيفي
              </label>
              <div className="relative">
                <User className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                <Input
                  type="text"
                  value={empId}
                  onChange={(e) => setEmpId(e.target.value)}
                  placeholder="مثال: 1002 أو EMP-002"
                  className="pr-10 h-11 bg-white/[0.06] border-white/10 text-white placeholder:text-white/25 focus:border-emerald-500/60 focus:ring-emerald-500/20"
                  disabled={loading}
                  autoComplete="username"
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-white/70">
                كلمة المرور
              </label>
              <div className="relative">
                <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pr-10 pl-10 h-11 rounded-lg border border-white/10 bg-white/[0.06] text-white placeholder:text-white/25 text-right focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/60 transition"
                  disabled={loading}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Login Button */}
            <Button
              type="submit"
              disabled={loading}
              className="w-full h-12 text-[15px] font-bold rounded-xl transition shadow-lg shadow-emerald-500/25"
              style={{
                background: "linear-gradient(135deg, #059669, #0d9488)",
              }}
            >
              {loading ? "جاري الدخول..." : "دخول"}
            </Button>
          </form>

          {/* Switch to admin portal */}
          <p className="text-center text-sm text-white/40">
            هل أنت مدير؟{" "}
            <Link
              to="/login"
              className="text-emerald-400 hover:text-emerald-300 font-medium"
            >
              {PLATFORM_NAME_AR}
            </Link>
          </p>
        </div>

        {/* Footer */}
        <p className="text-center mt-6 text-xs text-white/20">
          © 2026 نظام إدارة الموارد البشرية · جميع الحقوق محفوظة
        </p>
      </div>
    </div>
  );
}
