import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Clock3, ShieldAlert, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { companyStatusMessage, loadCompanyState, useCompany } from "@/lib/companyContext";
import AuthShell, { AUTH_COLORS, authButtonClass, authButtonStyle, authLinkClass } from "@/components/AuthShell";
import { buildBusinessSession } from "@/lib/businessSession";

/** حالة المنشأة عندما لا تكون فعالة: بانتظار الموافقة، موقوفة، مرفوضة، عضو معطّل، أو حساب إدارة المنصة */
export default function CompanyStatus() {
  const navigate = useNavigate();
  const company = useCompany();
  const [checking, setChecking] = useState(false);

  if (company.status === "active") return <Navigate to="/" replace />;
  if (company.status === "none" && !company.isPlatformAdmin) return <Navigate to="/register-company" replace />;

  const message = companyStatusMessage(company);
  const Icon = company.status === "pending" || company.status === "error" ? Clock3 : ShieldAlert;

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
      title={message.title}
      subtitle={company.company?.name_ar || "حالة المنشأة"}
      footer={<button type="button" onClick={() => void logout()} className={authLinkClass}>تسجيل الخروج</button>}
    >
      <div className="flex items-start gap-4">
        <Icon className={`mt-1 h-9 w-9 shrink-0 ${company.status === "pending" ? "text-[#B54708]" : "text-[#B42318]"}`} aria-hidden="true" />
        <div className="space-y-2">
          <p className="text-[15px] leading-8" style={{ color: AUTH_COLORS.text }}>{message.body}</p>
          {company.company?.code ? (
            <p className="text-[13px]" style={{ color: AUTH_COLORS.muted }}>
              رقم المنشأة: <span className="font-semibold" dir="ltr">{company.company.code}</span>
            </p>
          ) : null}
        </div>
      </div>
      {company.status === "pending" || company.status === "error" ? (
        <button type="button" onClick={() => void recheck()} disabled={checking} className={`${authButtonClass} inline-flex items-center justify-center gap-2`} style={authButtonStyle}>
          <RefreshCw className={`h-4 w-4 ${checking ? "animate-spin" : ""}`} aria-hidden="true" />
          {checking ? "جاري التحقق..." : "تحقق من حالة الطلب"}
        </button>
      ) : null}
    </AuthShell>
  );
}
