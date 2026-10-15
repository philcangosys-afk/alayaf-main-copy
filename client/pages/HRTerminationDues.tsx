import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/i18n";

type Row = { id: string; name: string; clearanceDate: string; paymentDate: string; duesAmount: string; leaveAmount: string; paidAmount: string; remaining: string; status: string };

export default function HRTerminationDues() {
  const { t, direction } = useI18n();
  const [items, setItems] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data } = await supabase.from("hr_terminations").select("*").order("created_at", { ascending: false });
        if (data) setItems(data.map((r: any) => ({
          id: String(r.id), name: r.emp_name ?? "",
          clearanceDate: r.termination_date ?? "-", paymentDate: r.payment_date ?? "-",
          duesAmount: String(r.total ?? "0.00"), leaveAmount: String(r.leave_value ?? "0.00"),
          paidAmount: String(r.paid_amount ?? "0.00"),
          remaining: ((r.total ?? 0) - (r.paid_amount ?? 0)).toFixed(2),
          status: r.status ?? "معلق",
        })));
      } catch { setItems([]); } finally { setLoading(false); }
    })();
  }, []);

  const filtered = items.filter((i) => !search || i.name.includes(search));

  return (
    <Layout>
      <div className="p-6 max-w-[1600px] mx-auto space-y-6" dir={direction}>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">{t("تقرير المستحقات")}</h1>
        </div>
        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
          <div className="p-4 border-b flex justify-between items-center">
            <div className="relative w-72">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input placeholder={t("بحث باسم الموظف...")} value={search} onChange={(e) => setSearch(e.target.value)} className="pr-9" />
            </div>
            <span className="text-sm text-gray-500">{filtered.length} {t("سجل")}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="bg-[#004e89] text-white">
                <tr>
                  <th className="py-3 px-4 font-medium">{t("اسم الموظف")}</th>
                  <th className="py-3 px-4 font-medium">{t("تاريخ التصفية")}</th>
                  <th className="py-3 px-4 font-medium">{t("تاريخ الدفع")}</th>
                  <th className="py-3 px-4 font-medium">{t("مبلغ المستحقات")}</th>
                  <th className="py-3 px-4 font-medium">{t("رصيد الإجازات")}</th>
                  <th className="py-3 px-4 font-medium">{t("المبلغ المدفوع")}</th>
                  <th className="py-3 px-4 font-medium">{t("المتبقي")}</th>
                  <th className="py-3 px-4 font-medium text-center">{t("الحالة")}</th>
                </tr>
              </thead>
              <tbody className="divide-y bg-white">
                {loading ? (
                  <tr><td colSpan={8} className="text-center py-8 text-gray-400">{t("جاري التحميل...")}</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-8 text-gray-400">{t("لا توجد بيانات")}</td></tr>
                ) : filtered.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50/50">
                    <td className="py-3 px-4 font-medium">{row.name}</td>
                    <td className="py-3 px-4">{row.clearanceDate}</td>
                    <td className="py-3 px-4">{row.paymentDate}</td>
                    <td className="py-3 px-4">{row.duesAmount}</td>
                    <td className="py-3 px-4">{row.leaveAmount}</td>
                    <td className="py-3 px-4">{row.paidAmount}</td>
                    <td className="py-3 px-4">{row.remaining}</td>
                    <td className="py-3 px-4 text-center">
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${row.status === "موافق عليه" ? "bg-emerald-100 text-emerald-800" : "bg-yellow-100 text-yellow-800"}`}>{t(row.status)}</span>
                    </td>
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
