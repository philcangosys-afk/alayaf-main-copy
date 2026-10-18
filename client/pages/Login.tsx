import { useState } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import { Lock, Mail } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import AuthShell, { AUTH_COLORS } from "@/components/AuthShell";
import { Field, Notice, PasswordInput, TextInput, linkClass, primaryButtonClass, secondaryButtonClass } from "@/components/AuthForm";
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
      subtitle="مرحبًا بعودتك. ادخل إلى حساب منشأتك."
      footer={
        <p>
          موظف في منشأة مسجّلة؟{" "}
          <Link to="/employee/login" className={linkClass}>ادخل من بوابة الموظفين</Link>
        </p>
      }
    >
      {activated ? <Notice tone="success">تم تفعيل منشأتك. سجّل الدخول للبدء.</Notice> : null}
      {passwordReset ? <Notice tone="success">تم تغيير كلمة المرور. سجّل الدخول بكلمة المرور الجديدة.</Notice> : null}
      <form onSubmit={handleLogin} className="space-y-5" noValidate>
        <Field id="login-email" label="البريد الإلكتروني">
          <TextInput
            id="login-email"
            icon={Mail}
            type="email"
            dir="ltr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.com"
            disabled={loading}
            autoComplete="email"
          />
        </Field>
        <Field
          id="login-password"
          label="كلمة المرور"
          aside={
            <button
              type="button"
              onClick={() => void handleForgotPassword()}
              disabled={loading || sendingReset}
              className={`text-[13px] ${linkClass} disabled:opacity-50`}
            >
              {sendingReset ? "جاري الإرسال..." : "نسيت كلمة المرور؟"}
            </button>
          }
        >
          <PasswordInput
            id="login-password"
            icon={Lock}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            disabled={loading}
            autoComplete="current-password"
          />
        </Field>
        <button type="submit" disabled={loading} className={primaryButtonClass}>
          {loading ? "جاري الدخول..." : "دخول"}
        </button>
      </form>
      <div className="flex items-center gap-3 text-[13px]" style={{ color: AUTH_COLORS.muted }}>
        <span className="h-px flex-1" style={{ background: AUTH_COLORS.line }} />
        منشأتك غير مسجّلة؟
        <span className="h-px flex-1" style={{ background: AUTH_COLORS.line }} />
      </div>
      <Link to="/signup" className={secondaryButtonClass}>سجّل منشأتك الآن</Link>
    </AuthShell>
  );
}
