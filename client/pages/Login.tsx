import { useState } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eye, EyeOff, Lock, Mail, Building2 } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { PLATFORM_NAME_AR } from "@/lib/companyProfile";
import { companyStatusMessage, loadCompanyState } from "@/lib/companyContext";
import { buildBusinessSession } from "@/lib/businessSession";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = location.state as { activated?: boolean; passwordReset?: boolean } | null;
  const activated = Boolean(routeState?.activated);
  const passwordReset = Boolean(routeState?.passwordReset);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);

  // نسيت كلمة المرور: رابط تعيين بالبريد (لا يكشف هل البريد مسجّل)
  const handleForgotPassword = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
      toast.error("اكتب بريدك الإلكتروني في الحقل أولًا ثم اضغط «نسيت كلمة المرور؟»");
      return;
    }
    setSendingReset(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error && /rate|limit|seconds/i.test(error.message)) {
        toast.error("محاولات كثيرة؛ حاول بعد قليل");
        return;
      }
      if (error) {
        toast.error("تعذر إرسال رابط تعيين كلمة المرور، حاول مرة أخرى");
        return;
      }
      toast.success("إن كان البريد مسجّلًا فستصلك رسالة فيها رابط تعيين كلمة مرور جديدة");
    } finally {
      setSendingReset(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      toast.error("يجب ملء جميع الحقول");
      return;
    }
    setLoading(true);
    try {
      localStorage.removeItem("user_session");
      const { data: authData, error: authError } =
        await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        });
      if (authError) {
        toast.error(/confirm/i.test(authError.message) ? "أكّد بريدك الإلكتروني أولًا من الرسالة المرسلة إليك" : "بيانات الدخول غير صحيحة");
        return;
      }

      // نظام الشركات: الحساب يجب أن يتبع منشأة فعالة
      const company = await loadCompanyState();
      if (company.status === "error") {
        toast.error("تعذر التحقق من حساب المنشأة؛ حاول مرة أخرى");
        await supabase.auth.signOut();
        return;
      }
      if (company.isPlatformAdmin && company.status !== "active") {
        toast.error(companyStatusMessage(company).body);
        await supabase.auth.signOut();
        return;
      }
      if (company.status === "none") {
        navigate("/register-company", { replace: true });
        return;
      }
      if (company.status !== "active") {
        navigate("/company-status", { replace: true });
        return;
      }

      const result = await buildBusinessSession(authData.user.id, authData.user.email ?? email);
      if (!result.ok) {
        toast.error(result.reason === "inactive" ? "حسابك موقوف؛ راجع الموارد البشرية" : "لم يتم العثور على حساب نظام فعال");
        localStorage.removeItem("user_session");
        await supabase.auth.signOut();
        return;
      }

      toast.success(`مرحباً ${result.session?.name ?? ""}`);
      setTimeout(() => navigate("/"), 400);
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
          "linear-gradient(135deg, #0f172a 0%, #1e293b 40%, #0f2740 70%, #020d1a 100%)",
      }}
    >
      {/* Background glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute top-20 left-1/4 h-72 w-72 rounded-full bg-blue-500/10 blur-[120px]" />
        <div className="absolute bottom-20 right-1/4 h-72 w-72 rounded-full bg-indigo-500/10 blur-[120px]" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-5">
            <div
              className="relative flex h-20 w-20 items-center justify-center rounded-2xl shadow-2xl shadow-blue-500/30"
              style={{
                background: "linear-gradient(135deg, #2563eb, #4f46e5)",
              }}
            >
              <Building2 className="h-10 w-10 text-white" />
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-white/20 to-transparent" />
            </div>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight leading-tight">
            {PLATFORM_NAME_AR}
          </h1>
          <p className="mt-2 text-blue-200/70 text-sm">
            تسجيل دخول المنشآت
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl bg-white/[0.04] border border-white/10 backdrop-blur-md shadow-2xl p-8 space-y-6">
          {activated ? (
            <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
              تم تفعيل منشأتك. سجّل الدخول للبدء.
            </div>
          ) : null}
          {passwordReset ? (
            <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
              تم تغيير كلمة المرور. سجّل الدخول بكلمة المرور الجديدة.
            </div>
          ) : null}
          <form onSubmit={handleLogin} className="space-y-5">
            {/* Email */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-white/70">
                البريد الإلكتروني
              </label>
              <div className="relative">
                <Mail className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="pr-10 h-11 bg-white/[0.06] border-white/10 text-white placeholder:text-white/25 focus:border-blue-500/60 focus:ring-blue-500/20"
                  disabled={loading}
                  autoComplete="email"
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
                  className="w-full pr-10 pl-10 h-11 rounded-lg border border-white/10 bg-white/[0.06] text-white placeholder:text-white/25 text-right focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/60 transition"
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
              <div className="text-left">
                <button
                  type="button"
                  onClick={() => void handleForgotPassword()}
                  disabled={loading || sendingReset}
                  className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50"
                >
                  {sendingReset ? "جاري الإرسال..." : "نسيت كلمة المرور؟"}
                </button>
              </div>
            </div>

            {/* Login Button */}
            <Button
              type="submit"
              disabled={loading}
              className="w-full h-12 text-[15px] font-bold rounded-xl transition shadow-lg shadow-blue-500/25"
              style={{
                background: "linear-gradient(135deg, #2563eb, #4f46e5)",
              }}
            >
              {loading ? "جاري الدخول..." : "دخول النظام"}
            </Button>
          </form>

          {/* New company registration */}
          <p className="text-center text-sm text-white/40">
            منشأة جديدة؟{" "}
            <Link
              to="/signup"
              className="text-blue-400 hover:text-blue-300 font-medium"
            >
              سجّل منشأتك
            </Link>
          </p>

          {/* Switch to employee portal */}
          <p className="text-center text-sm text-white/40">
            هل أنت موظف؟{" "}
            <Link
              to="/employee/login"
              className="text-blue-400 hover:text-blue-300 font-medium"
            >
              بوابة الموظفين
            </Link>
          </p>
        </div>

        {/* Footer */}
        <p className="text-center mt-6 text-xs text-white/20">
          © {new Date().getFullYear()} {PLATFORM_NAME_AR} · جميع الحقوق محفوظة
        </p>
      </div>
    </div>
  );
}
