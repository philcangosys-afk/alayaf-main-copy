import { useState } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import AuthShell, { AUTH_COLORS, authButtonClass, authButtonStyle, authInputClass, authLabelClass, authLinkClass, authNoteClass } from "@/components/AuthShell";
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
    <AuthShell
      title="تسجيل الدخول"
      subtitle="ادخل إلى حساب منشأتك"
      footer={
        <>
          <p>
            منشأتك غير مسجّلة؟{" "}
            <Link to="/signup" className={authLinkClass}>سجّل منشأتك الآن</Link>
          </p>
          <p>
            موظف في منشأة مسجّلة؟{" "}
            <Link to="/employee/login" className={authLinkClass}>بوابة الموظفين</Link>
          </p>
        </>
      }
    >
      {activated ? (
        <div className={authNoteClass} style={{ background: AUTH_COLORS.mint, borderColor: "#BFDCCD", color: AUTH_COLORS.ink }}>
          تم تفعيل منشأتك. سجّل الدخول للبدء.
        </div>
      ) : null}
      {passwordReset ? (
        <div className={authNoteClass} style={{ background: AUTH_COLORS.mint, borderColor: "#BFDCCD", color: AUTH_COLORS.ink }}>
          تم تغيير كلمة المرور. سجّل الدخول بكلمة المرور الجديدة.
        </div>
      ) : null}
      <form onSubmit={handleLogin} className="space-y-5" noValidate>
        <div>
          <label htmlFor="login-email" className={authLabelClass}>البريد الإلكتروني</label>
          <div className="relative">
            <Mail className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7C918A]" aria-hidden="true" />
            <input
              id="login-email"
              type="email"
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              className={`${authInputClass} pr-10`}
              disabled={loading}
              autoComplete="email"
            />
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <label htmlFor="login-password" className="text-[14px] font-medium text-[#24443A]">كلمة المرور</label>
            <button
              type="button"
              onClick={() => void handleForgotPassword()}
              disabled={loading || sendingReset}
              className={`text-[13px] ${authLinkClass} disabled:opacity-50`}
            >
              {sendingReset ? "جاري الإرسال..." : "نسيت كلمة المرور؟"}
            </button>
          </div>
          <div className="relative">
            <Lock className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7C918A]" aria-hidden="true" />
            <input
              id="login-password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className={`${authInputClass} pr-10 pl-11`}
              disabled={loading}
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
              className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded text-[#7C918A] hover:text-[#24443A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#14775A]/40"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <button type="submit" disabled={loading} className={authButtonClass} style={authButtonStyle}>
          {loading ? "جاري الدخول..." : "دخول"}
        </button>
      </form>
    </AuthShell>
  );
}
