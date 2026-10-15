import { useState, useEffect } from "react";
import { ChevronLeft, Building2, MapPin, Phone, Globe } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/i18n";
import { COMPANY_PROFILE } from "@/lib/companyProfile";

type Props = { onBack: () => void };

export default function AboutPage({ onBack }: Props) {
  const { t, direction } = useI18n();
  const [branches, setBranches] = useState<{ id: string; name: string; address?: string; phone?: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from("branches").select("id, name, address, phone").order("name").then(({ data }) => {
      setBranches((data ?? []).map((b: any) => ({ id: String(b.id), name: String(b.name), address: String(b.address || ""), phone: String(b.phone || "") })));
      setLoading(false);
    });
  }, []);

  return (
    <div className="flex flex-col h-full bg-gray-50" dir={direction}>
      <div className="flex items-center gap-3 p-4 bg-white border-b sticky top-0 z-10">
        <button onClick={onBack} className="text-[#004e89]"><ChevronLeft className={`h-6 w-6 ${direction === "rtl" ? "rotate-180" : ""}`} /></button>
        <Building2 className="h-5 w-5 text-[#004e89]" />
        <h2 className="font-bold text-lg text-gray-900">{t("من نحن")}</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4 pb-24 space-y-4">
        {/* Company hero */}
        <div className="bg-gradient-to-r from-[#004e89] to-[#0066b3] rounded-xl p-6 text-white">
          <Building2 className="h-10 w-10 mb-3 text-white/80" />
          <h3 className="text-xl font-bold mb-1">
            {t(COMPANY_PROFILE.companyNameAr)}
          </h3>
          <p className="text-blue-100 text-sm">{t("نظام إدارة الموارد البشرية المتكامل")}</p>
        </div>

        {/* Branches */}
        <div>
          <p className="font-semibold text-gray-700 text-sm mb-2 px-1">{t("مقرات الشركة والفروع")}</p>
          {loading ? (
            <div className="text-center py-8 text-gray-400 text-sm">{t("جاري التحميل...")}</div>
          ) : branches.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 text-center text-gray-400 text-sm">{t("لا توجد فروع مسجلة")}</div>
          ) : branches.map((b) => (
            <div key={b.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#004e89]/10 flex items-center justify-center flex-shrink-0">
                  <MapPin className="h-5 w-5 text-[#004e89]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900">{b.name}</p>
                  {b.address && <p className="text-xs text-gray-500 mt-0.5">{b.address}</p>}
                  {b.phone && <p className="text-xs text-[#004e89] mt-1 flex items-center gap-1"><Phone className="h-3 w-3" />{b.phone}</p>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
