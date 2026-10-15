import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useCompany } from "@/lib/companyContext";

/** صفحات تحتاج دخولًا فقط دون منشأة فعالة: تسجيل منشأة، وحالة المنشأة */
export default function RequireSession() {
  const company = useCompany();
  const [status, setStatus] = useState<"loading" | "authed" | "guest">("loading");

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setStatus(data.session ? "authed" : "guest");
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setStatus(session ? "authed" : "guest");
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (status === "loading" || (status === "authed" && company.loading)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900" dir="rtl">
        <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
      </div>
    );
  }
  if (status === "guest") return <Navigate to="/login" replace />;
  return <Outlet />;
}
