import type { ReactNode } from "react";
import { Building2 } from "lucide-react";
import { PLATFORM_NAME_AR } from "@/lib/companyProfile";

/** إطار صفحات الدخول والتسجيل وحالة المنشأة (قبل الدخول إلى النظام) */
export default function AuthShell({
  subtitle,
  children,
  wide = false,
}: {
  subtitle: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      dir="rtl"
      style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e293b 40%, #0f2740 70%, #020d1a 100%)" }}
    >
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute top-20 left-1/4 h-72 w-72 rounded-full bg-blue-500/10 blur-[120px]" />
        <div className="absolute bottom-20 right-1/4 h-72 w-72 rounded-full bg-indigo-500/10 blur-[120px]" />
      </div>
      <div className={`relative w-full ${wide ? "max-w-2xl" : "max-w-md"}`}>
        <div className="text-center mb-8">
          <div className="flex justify-center mb-5">
            <div
              className="relative flex h-20 w-20 items-center justify-center rounded-2xl shadow-2xl shadow-blue-500/30"
              style={{ background: "linear-gradient(135deg, #2563eb, #4f46e5)" }}
            >
              <Building2 className="h-10 w-10 text-white" />
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-white/20 to-transparent" />
            </div>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight leading-tight">{PLATFORM_NAME_AR}</h1>
          <p className="mt-2 text-blue-200/70 text-sm">{subtitle}</p>
        </div>
        <div className="rounded-2xl bg-white/[0.04] border border-white/10 backdrop-blur-md shadow-2xl p-8 space-y-6">
          {children}
        </div>
        <p className="text-center mt-6 text-xs text-white/20">© {new Date().getFullYear()} {PLATFORM_NAME_AR} · جميع الحقوق محفوظة</p>
      </div>
    </div>
  );
}

export const authInputClass =
  "w-full h-11 rounded-lg border border-white/10 bg-white/[0.06] px-3 text-white placeholder:text-white/25 text-right focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/60 transition disabled:opacity-60";

export const authLabelClass = "block text-sm font-medium text-white/70 mb-1.5";

export const authButtonStyle = { background: "linear-gradient(135deg, #2563eb, #4f46e5)" };
