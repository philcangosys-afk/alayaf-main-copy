import { useEffect, useState } from "react";
import { ChevronLeft, AlertTriangle, FileText } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/i18n";

type Props = { empId: string; onBack: () => void };

type Item = {
  id: string;
  kind: "مساءلة" | "إنذار";
  date: string;
  subject: string;
  message: string;
  status: string;
  sender_name: string | null;
};

export default function PenaltiesPage({ empId, onBack }: Props) {
  const { t, direction } = useI18n();
  const [tab, setTab] = useState<"investigations" | "warnings">("investigations");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Item | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      if (tab === "investigations") {
        const { data } = await supabase
          .from("penalty_investigations")
          .select("id, investigation_date, subject, message, status, sender_name")
          .eq("emp_id", empId)
          .order("investigation_date", { ascending: false });
        setItems(
          (data ?? []).map((r: any) => ({
            id: r.id,
            kind: "مساءلة",
            date: r.investigation_date,
            subject: r.subject,
            message: r.message,
            status: r.status,
            sender_name: r.sender_name,
          })),
        );
      } else {
        const { data } = await supabase
          .from("penalty_warnings")
          .select("id, warning_date, subject, message, status, sender_name")
          .eq("emp_id", empId)
          .order("warning_date", { ascending: false });
        setItems(
          (data ?? []).map((r: any) => ({
            id: r.id,
            kind: "إنذار",
            date: r.warning_date,
            subject: r.subject,
            message: r.message,
            status: r.status,
            sender_name: r.sender_name,
          })),
        );
      }
      setLoading(false);
    }
    load();
  }, [tab, empId]);

  if (selected) {
    return (
      <div className="flex flex-col h-full" dir={direction}>
        <div className="flex items-center gap-3 p-4 bg-white border-b sticky top-0 z-10">
          <button onClick={() => setSelected(null)} className="text-[#004e89]"><ChevronLeft className={`h-6 w-6 ${direction === "rtl" ? "rotate-180" : ""}`} /></button>
          <h2 className="font-bold text-lg text-gray-900">{t(selected.kind)} — {selected.date}</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-4 pb-24 bg-gray-50">
          <div className="bg-white rounded-xl shadow-sm p-5">
            <div className={`inline-flex px-3 py-1 rounded-full text-xs font-medium mb-4 ${selected.kind === "إنذار" ? "bg-red-100 text-red-700" : "bg-orange-100 text-orange-700"}`}>{t(selected.kind)}</div>
            <h3 className="font-bold text-gray-900 text-lg mb-2">{selected.subject}</h3>
            <p className="text-gray-600 text-sm leading-relaxed mb-4">{selected.message}</p>
            <div className="border-t border-gray-100 pt-3 space-y-2">
              <div className="flex justify-between text-sm"><span className="text-gray-400">{t("التاريخ")}</span><span className="text-gray-700">{selected.date}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-400">{t("من")}</span><span className="text-gray-700">{selected.sender_name ?? "—"}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-400">{t("الحالة")}</span><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${selected.status === "مرسلة" || selected.status === "مرسل" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-700"}`}>{t(selected.status)}</span></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" dir={direction}>
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="flex items-center gap-3 p-4">
          <button onClick={onBack} className="text-[#004e89]"><ChevronLeft className={`h-6 w-6 ${direction === "rtl" ? "rotate-180" : ""}`} /></button>
          <h2 className="font-bold text-lg text-gray-900">{t("المساءلات والإنذارات")}</h2>
        </div>
        <div className="flex border-b">
          <button onClick={() => setTab("investigations")} className={`flex-1 py-3 text-sm font-semibold border-b-2 transition ${tab === "investigations" ? "border-[#004e89] text-[#004e89]" : "border-transparent text-gray-500"}`}>{t("المساءلات")}</button>
          <button onClick={() => setTab("warnings")} className={`flex-1 py-3 text-sm font-semibold border-b-2 transition ${tab === "warnings" ? "border-[#004e89] text-[#004e89]" : "border-transparent text-gray-500"}`}>{t("الإنذارات")}</button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 pb-24 bg-gray-50">
        {loading ? (
          <div className="text-center py-12 text-gray-400">{t("جاري التحميل...")}</div>
        ) : items.length === 0 ? (
          <div className="text-center py-12 text-gray-400">{t("لا توجد سجلات")}</div>
        ) : (
          items.map((item) => (
            <button key={item.id} onClick={() => setSelected(item)} className="w-full bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-3 flex items-start gap-3 hover:shadow-md transition text-start">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${item.kind === "إنذار" ? "bg-red-100" : "bg-orange-100"}`}>
                <AlertTriangle className={`h-5 w-5 ${item.kind === "إنذار" ? "text-red-600" : "text-orange-600"}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 text-sm truncate">{item.subject}</p>
                <p className="text-xs text-gray-500 mt-0.5">{item.date}</p>
              </div>
              <ChevronLeft className="h-5 w-5 text-gray-400 flex-shrink-0 mt-1" />
            </button>
          ))
        )}
      </div>
    </div>
  );
}
