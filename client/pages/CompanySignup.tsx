import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { MailCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabaseClient";
import AuthShell, { authButtonStyle, authInputClass, authLabelClass } from "@/components/AuthShell";

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * إنشاء حساب صاحب منشأة جديدة: حساب دخول ببريد يُؤكَّد برسالة،
 * ثم يسجّل الدخول ويملأ بيانات المنشأة (صفحة تسجيل المنشأة)، وتُفعَّل بعد موافقة إدارة المنصة.
 */
export default function CompanySignup() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(cleanEmail)) {
      toast.error("أدخل بريدًا إلكترونيًا صحيحًا");
      return;
    }
    if (password.length < 8) {
      toast.error("كلمة المرور 8 أحرف على الأقل");
      return;
    }
    if (password !== confirm) {
      toast.error("كلمتا المرور غير متطابقتين");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: { emailRedirectTo: `${window.location.origin}/login` },
      });
      if (error) {
        toast.error(/rate|limit/i.test(error.message) ? "محاولات كثيرة؛ حاول بعد قليل" : "تعذر إنشاء الحساب، حاول مرة أخرى");
        return;
      }
      if (data.session) {
        // تأكيد البريد معطّل في المشروع: يجب تفعيله (Confirm email) لأن تسجيل المنشأة يشترط بريدًا مؤكَّدًا
        await supabase.auth.signOut();
      }
      setSentTo(cleanEmail);
    } finally {
      setLoading(false);
    }
  };

  if (sentTo) {
    return (
      <AuthShell subtitle="تسجيل منشأة جديدة">
        <div className="text-center space-y-4 text-white">
          <MailCheck className="mx-auto h-12 w-12 text-emerald-400" />
          <p className="text-lg font-bold">تحقق من بريدك الإلكتروني</p>
          <p className="text-sm text-white/70 leading-7">
            أرسلنا رابط تأكيد إلى <span dir="ltr" className="font-mono">{sentTo}</span>. افتح الرابط ثم سجّل الدخول لإكمال بيانات منشأتك.
            إن لم تصلك الرسالة فقد يكون البريد مسجلًا من قبل؛ جرّب تسجيل الدخول.
          </p>
          <Link to="/login" className="inline-block text-blue-400 hover:text-blue-300 font-medium">الذهاب إلى تسجيل الدخول</Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell subtitle="تسجيل منشأة جديدة · الخطوة 1 من 2: حساب الدخول">
      <form onSubmit={submit} className="space-y-5">
        <div>
          <label className={authLabelClass}>البريد الإلكتروني لصاحب المنشأة</label>
          <input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} className={authInputClass} placeholder="owner@company.com" disabled={loading} autoComplete="email" />
        </div>
        <div>
          <label className={authLabelClass}>كلمة المرور</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={authInputClass} placeholder="8 أحرف على الأقل" disabled={loading} autoComplete="new-password" />
        </div>
        <div>
          <label className={authLabelClass}>تأكيد كلمة المرور</label>
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={authInputClass} disabled={loading} autoComplete="new-password" />
        </div>
        <Button type="submit" disabled={loading} className="w-full h-12 text-[15px] font-bold rounded-xl shadow-lg shadow-blue-500/25" style={authButtonStyle}>
          {loading ? "جاري الإنشاء..." : "إنشاء الحساب"}
        </Button>
      </form>
      <p className="text-center text-sm text-white/40">
        لديك حساب؟{" "}
        <Link to="/login" className="text-blue-400 hover:text-blue-300 font-medium">تسجيل الدخول</Link>
      </p>
    </AuthShell>
  );
}
