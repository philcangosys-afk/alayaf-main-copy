import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Clock3, ShieldAlert, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { companyStatusMessage, loadCompanyState, useCompany } from "@/lib/companyContext";
import AuthShell, { authButtonStyle } from "@/components/AuthShell";
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
    <AuthShell subtitle={company.company?.name_ar || "حالة المنشأة"}>
      <div className="text-center space-y-4 text-white">
        <Icon className={`mx-auto h-12 w-12 ${company.status === "pending" ? "text-amber-400" : "text-rose-400"}`} />
        <p className="text-lg font-bold">{message.title}</p>
        <p className="text-sm text-white/70 leading-7">{message.body}</p>
        {company.company?.code ? (
          <p className="text-xs text-white/50">
            رقم المنشأة: <span className="font-mono" dir="ltr">{company.company.code}</span>
          </p>
        ) : null}
      </div>
      {company.status === "pending" || company.status === "error" ? (
        <Button type="button" onClick={() => void recheck()} disabled={checking} className="w-full h-11 font-bold rounded-xl" style={authButtonStyle}>
          <RefreshCw className={`ml-2 h-4 w-4 ${checking ? "animate-spin" : ""}`} />
          {checking ? "جاري التحقق..." : "تحقق من حالة الطلب"}
        </Button>
      ) : null}
      <button type="button" onClick={() => void logout()} className="block w-full text-center text-sm text-white/40 hover:text-white/70">
        تسجيل الخروج
      </button>
    </AuthShell>
  );
}
