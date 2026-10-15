import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabaseClient";
import AuthShell, { authButtonStyle, authInputClass, authLabelClass } from "@/components/AuthShell";

type Phase = "checking" | "ready" | "invalid";

// يُقرأ عند تحميل الموقع، قبل أن تزيل مكتبة الدخول رموز الرابط من العنوان:
//  - هل الرابط رابط استعادة كلمة مرور؟ (الصفحة لا تقبل جلسة دخول عادية)
//  - هل فيه خطأ (منتهي أو مستخدم من قبل)؟
const startHash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
const startQuery = new URLSearchParams(window.location.search);
const LINK_ERROR = Boolean(startHash.get("error") || startHash.get("error_code") || startQuery.get("error") || startQuery.get("error_code"));
let recoveryLink = startHash.get("type") === "recovery";
supabase.auth.onAuthStateChange((event) => {
  if (event === "PASSWORD_RECOVERY") recoveryLink = true;
});

/**
 * تعيين كلمة مرور جديدة من رابط «نسيت كلمة المرور» المرسل بالبريد.
 * الرابط يفتح جلسة استعادة؛ بعد الحفظ تُغلق الجلسة ويعود المستخدم لتسجيل الدخول بكلمة المرور الجديدة.
 */
export default function ResetPassword() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>(() => (LINK_ERROR ? "invalid" : "checking"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (phase !== "checking") return;
    let active = true;
    // جلسة استعادة فقط (من رابط البريد)، لا جلسة دخول عادية
    const accept = (sessionEmail: string | undefined) => {
      if (!active || !recoveryLink) return;
      setEmail(String(sessionEmail ?? ""));
      setPhase("ready");
    };
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN" || event === "INITIAL_SESSION")) {
        accept(session.user.email);
      }
    });
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) accept(session.user.email);
    });
    // لا جلسة خلال ثوانٍ: الرابط غير صالح أو انتهت صلاحيته
    const timer = window.setTimeout(() => {
      if (active) setPhase((current) => (current === "checking" ? "invalid" : current));
    }, 8000);
    return () => {
      active = false;
      window.clearTimeout(timer);
      data.subscription.unsubscribe();
    };
  }, [phase]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < 8) {
      toast.error("كلمة المرور 8 أحرف على الأقل");
      return;
    }
    if (new TextEncoder().encode(password).length > 72) {
      toast.error("كلمة المرور طويلة جدًا");
      return;
    }
    if (password !== confirm) {
      toast.error("كلمتا المرور غير متطابقتين");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        const text = `${error.message ?? ""} ${(error as { code?: string }).code ?? ""}`;
        toast.error(
          /same_password|different from the old/i.test(text)
            ? "كلمة المرور الجديدة مطابقة للقديمة؛ اختر كلمة مختلفة"
            : /weak|pwned|characters/i.test(text)
            ? "كلمة المرور ضعيفة؛ اختر كلمة أقوى"
            : /session|expired|jwt/i.test(text)
            ? "انتهت صلاحية الرابط؛ اطلب رابطًا جديدًا من صفحة الدخول"
            : "تعذر تغيير كلمة المرور، حاول مرة أخرى",
        );
        return;
      }
      recoveryLink = false;
      localStorage.removeItem("user_session");
      await supabase.auth.signOut();
      navigate("/login", { replace: true, state: { passwordReset: true } });
    } finally {
      setSaving(false);
    }
  };

  if (phase === "invalid") {
    return (
      <AuthShell subtitle="تعيين كلمة مرور جديدة">
        <div className="text-center space-y-4 text-white">
          <KeyRound className="mx-auto h-12 w-12 text-rose-300" />
          <p className="text-lg font-bold">الرابط غير صالح أو انتهت صلاحيته</p>
          <p className="text-sm text-white/70 leading-7">
            اطلب رابطًا جديدًا من صفحة الدخول بالضغط على «نسيت كلمة المرور؟»، واستخدم أحدث رسالة تصلك.
          </p>
          <Link to="/login" className="inline-block text-blue-400 hover:text-blue-300 font-medium">الذهاب إلى تسجيل الدخول</Link>
        </div>
      </AuthShell>
    );
  }

  if (phase === "checking") {
    return (
      <AuthShell subtitle="تعيين كلمة مرور جديدة">
        <p className="text-center text-sm text-white/70">جاري التحقق من الرابط...</p>
      </AuthShell>
    );
  }

  return (
    <AuthShell subtitle="تعيين كلمة مرور جديدة">
      {email ? (
        <p className="text-center text-sm text-white/60">
          الحساب: <span dir="ltr" className="font-mono text-white/80">{email}</span>
        </p>
      ) : null}
      <form onSubmit={submit} className="space-y-5">
        <div>
          <label className={authLabelClass}>كلمة المرور الجديدة</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={authInputClass} placeholder="8 أحرف على الأقل" disabled={saving} autoComplete="new-password" />
        </div>
        <div>
          <label className={authLabelClass}>تأكيد كلمة المرور</label>
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={authInputClass} disabled={saving} autoComplete="new-password" />
        </div>
        <Button type="submit" disabled={saving} className="w-full h-12 text-[15px] font-bold rounded-xl shadow-lg shadow-blue-500/25" style={authButtonStyle}>
          {saving ? "جاري الحفظ..." : "حفظ كلمة المرور"}
        </Button>
      </form>
    </AuthShell>
  );
}
