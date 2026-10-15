import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/i18n";

type Row = { id: string; requestNumber: string; jobId: string; name: string; reason: string; declaration: string; declarationDate: string; status: string; addedDate: string };

export default function HRTerminationEvacuation() {
  const { t, direction } = useI18n();
  const [items, setItems] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data } = await supabase.from("hr_terminations").select("*").order("created_at", { ascending: false });
        if (data) setItems(data.map((r: any, i: number) => ({
          id: String(r.id), requestNumber: String(1100 + i + 1), jobId: r.job_id ?? "",
          name: r.emp_name ?? "", reason: r.evacuation_reason ?? "خروج نهائي",
          declaration: r.evacuation_declaration ?? "معلق",
          declarationDate: r.evacuation_date ?? "-", status: r.status ?? "معلق",
          addedDate: r.created_at ? new Date(r.created_at).toLocaleString("ar-SA") : "-",
        })));
      } catch { setItems([]); } finally { setLoading(false); }
    })();
  }, []);

  const filtered = items.filter((i) => !search || i.name.includes(search) || i.jobId.includes(search));

  return (
    <Layout>
      <div className="p-6 max-w-[1600px] mx-auto space-y-6" dir={direction}>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">{t("إخلاء الطرف")}</h1>
        </div>
        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
          <div className="p-4 border-b flex justify-between items-center">
            <div className="relative w-72">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input placeholder={t("بحث...")} value={search} onChange={(e) => setSearch(e.target.value)} className="pr-9" />
            </div>
            <span className="text-sm text-gray-500">{filtered.length} {t("سجل")}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right min-w-[1000px]">
              <thead className="bg-[#004e89] text-white">
                <tr>
                  <th className="py-3 px-4 font-medium">{t("رقم الطلب")}</th>
                  <th className="py-3 px-4 font-medium">{t("الرقم الوظيفي")}</th>
                  <th className="py-3 px-4 font-medium">{t("الاسم")}</th>
                  <th className="py-3 px-4 font-medium">{t("سبب الإخلاء")}</th>
                  <th className="py-3 px-4 font-medium text-center">{t("إقرار الموظف")}</th>
                  <th className="py-3 px-4 font-medium">{t("تاريخ الإقرار")}</th>
                  <th className="py-3 px-4 font-medium text-center">{t("الحالة")}</th>
                  <th className="py-3 px-4 font-medium">{t("تاريخ الإضافة")}</th>
                </tr>
              </thead>
              <tbody className="divide-y bg-white">
                {loading ? (
                  <tr><td colSpan={8} className="text-center py-8 text-gray-400">{t("جاري التحميل...")}</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-8 text-gray-400">{t("لا توجد بيانات")}</td></tr>
                ) : filtered.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50/50">
                    <td className="py-3 px-4">{row.requestNumber}</td>
                    <td className="py-3 px-4">{row.jobId}</td>
                    <td className="py-3 px-4 font-medium">{row.name}</td>
                    <td className="py-3 px-4">{t(row.reason)}</td>
                    <td className="py-3 px-4 text-center"><span className={`px-2 py-0.5 rounded-full text-xs ${row.declaration === "تم الإقرار" ? "bg-emerald-100 text-emerald-800" : "bg-yellow-100 text-yellow-800"}`}>{t(row.declaration)}</span></td>
                    <td className="py-3 px-4">{row.declarationDate}</td>
                    <td className="py-3 px-4 text-center"><span className={`px-2 py-0.5 rounded-full text-xs ${row.status === "موافق عليه" ? "bg-emerald-100 text-emerald-800" : "bg-yellow-100 text-yellow-800"}`}>{t(row.status)}</span></td>
                    <td className="py-3 px-4">{row.addedDate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Layout>
  );
}
