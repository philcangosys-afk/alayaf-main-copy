import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Clock3, ShieldAlert, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { companyStatusMessage, loadCompanyState, useCompany } from "@/lib/companyContext";
import AuthShell, { AUTH_COLORS } from "@/components/AuthShell";
import { StatusIcon, linkClass, primaryButtonClass } from "@/components/AuthForm";
import { buildBusinessSession } from "@/lib/businessSession";

/** حالة المنشأة عندما لا تكون فعالة: بانتظار الموافقة، موقوفة، مرفوضة، عضو معطّل، أو حساب إدارة المنصة */
export default function CompanyStatus() {
  const navigate = useNavigate();
  const company = useCompany();
  const [checking, setChecking] = useState(false);

  if (company.status === "active") return <Navigate to="/" replace />;
  if (company.status === "none" && !company.isPlatformAdmin) return <Navigate to="/register-company" replace />;

  const message = companyStatusMessage(company);
  const waiting = company.status === "pending" || company.status === "error";

  const recheck = async () => {
    setChecking(true);
    try {
      // نقرأ الحالة أولًا دون تحديث الصفحة، فإن فُعّلت المنشأة نجهّز جلسة النظام قبل الانتقال
      const next = await loadCompanyState();
      if (next.status === "active") {
        const { data } = await supabase.auth.getUser();
        const result = data.user ? await buildBusinessSession(data.user.id, data.user.email ?? "") : null;
        if (!result?.ok) {
          localStorage.removeItem("user_session");
          await supabase.auth.signOut();
          navigate("/login", { replace: true, state: { activated: true } });
          return;
        }
      }
      await company.refresh();
    } finally {
      setChecking(false);
    }
  };

  const logout = async () => {
    localStorage.removeItem("user_session");
    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  };

  return (
    <AuthShell
      icon={<StatusIcon icon={waiting ? Clock3 : ShieldAlert} tone={waiting ? "warning" : "danger"} />}
      title={message.title}
      subtitle={company.company?.name_ar || "حالة المنشأة"}
      footer={<button type="button" onClick={() => void logout()} className={linkClass}>تسجيل الخروج</button>}
    >
      <p className="text-[15px] leading-8" style={{ color: AUTH_COLORS.text }}>{message.body}</p>
      {company.company?.code ? (
        <div className="flex items-center justify-between rounded-xl border px-4 py-3 text-[14px]" style={{ borderColor: AUTH_COLORS.line, background: "#F6F9F7" }}>
          <span style={{ color: AUTH_COLORS.muted }}>رقم المنشأة</span>
          <span className="font-bold" dir="ltr" style={{ color: AUTH_COLORS.ink }}>{company.company.code}</span>
        </div>
      ) : null}
      {waiting ? (
        <button type="button" onClick={() => void recheck()} disabled={checking} className={primaryButtonClass}>
          <RefreshCw className={`h-4 w-4 ${checking ? "animate-spin" : ""}`} aria-hidden="true" />
          {checking ? "جاري التحقق..." : "تحقق من حالة الطلب"}
        </button>
      ) : null}
    </AuthShell>
  );
}
