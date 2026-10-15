import { useEffect, useState } from "react";
import { Search, ChevronLeft, Filter, Phone, Mail, Briefcase } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/i18n";
import { EmployeePhoto } from "@/components/hr/employeeFiles";

type Emp = {
  id: string;
  emp_id: string | null;
  name: string;
  job_title: string | null;
  department: string | null;
  branch: string | null;
  status: string | null;
  phone: string | null;
  email: string | null;
  photo_url: string | null;
};

type Props = { onBack: () => void };

export default function EmployeeListPage({ onBack }: Props) {
  const { t, direction } = useI18n();
  const [tab, setTab] = useState<"active" | "inactive" | "cooperative">("active");
  const [employees, setEmployees] = useState<Emp[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Emp | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const statusMap: Record<string, string[]> = {
        active: ["نشط", "فعال"],
        inactive: ["موقوف", "غير فعال", "منتهي"],
        cooperative: ["متعاون"],
      };
      const statuses = statusMap[tab];
      const { data } = await supabase
        .from("employees")
        .select("id, emp_id, name, job_title, department, branch, status, phone, email, photo_url")
        .in("status", statuses)
        .order("name");
      setEmployees((data ?? []) as Emp[]);
      setLoading(false);
    }
    load();
  }, [tab]);

  const filtered = employees.filter(
    (e) =>
      !search ||
      e.name.toLowerCase().includes(search.toLowerCase()) ||
      (e.job_title ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (e.department ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  if (selected) {
    return (
      <div className="flex flex-col h-full" dir={direction}>
        <div className="flex items-center gap-3 p-4 bg-white border-b sticky top-0 z-10">
          <button onClick={() => setSelected(null)} className="text-[#004e89]">
            <ChevronLeft className={`h-6 w-6 ${direction === "rtl" ? "rotate-180" : ""}`} />
          </button>
          <h2 className="font-bold text-lg text-gray-900">{selected.name}</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
          <div className="bg-white rounded-xl shadow-sm p-6 mb-4">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-20 h-20 rounded-full bg-[#004e89] flex items-center justify-center text-white text-3xl font-bold overflow-hidden">
                <EmployeePhoto value={selected.photo_url} name={selected.name} />
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900">{selected.name}</h3>
                <p className="text-gray-500">{selected.job_title ?? "-"}</p>
                <span className="inline-block mt-1 px-3 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-medium">{t(selected.status ?? "نشط")}</span>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3">
              {[
                { label: "الرقم الوظيفي", value: selected.emp_id },
                { label: "القسم", value: selected.department },
                { label: "الفرع", value: selected.branch },
                { label: "الهاتف", value: selected.phone },
                { label: "البريد الإلكتروني", value: selected.email },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between border-b border-gray-100 pb-3">
                  <span className="text-gray-500 text-sm">{t(label)}</span>
                  <span className="font-medium text-gray-800">{value ?? "—"}</span>
                </div>
              ))}
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
          <h2 className="font-bold text-lg text-gray-900">{t("قائمة الموظفين")}</h2>
        </div>
        <div className="flex border-b">
          {(["active", "inactive", "cooperative"] as const).map((tabKey) => (
            <button key={tabKey} onClick={() => setTab(tabKey)} className={`flex-1 py-3 text-sm font-semibold border-b-2 transition ${tab === tabKey ? "border-[#004e89] text-[#004e89]" : "border-transparent text-gray-500"}`}>
              {t(tabKey === "active" ? "فعال" : tabKey === "inactive" ? "غير فعال" : "متعاون")}
            </button>
          ))}
        </div>
        <div className="p-3 flex gap-2">
          <div className="flex-1 relative">
            <Search className="h-4 w-4 absolute start-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("بحث...")} className="w-full ps-9 pe-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#004e89]" />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 pb-24 bg-gray-50">
        {loading ? (
          <div className="text-center py-12 text-gray-400">{t("جاري التحميل...")}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-400">{t("لا يوجد موظفون")}</div>
        ) : (
          filtered.map((emp) => (
            <button key={emp.id} onClick={() => setSelected(emp)} className="w-full bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-3 flex items-center gap-3 hover:shadow-md transition text-start">
              <div className="w-12 h-12 rounded-full bg-[#004e89] flex items-center justify-center text-white font-bold text-lg flex-shrink-0 overflow-hidden">
                <EmployeePhoto value={emp.photo_url} name={emp.name} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 text-sm truncate">{emp.name}</p>
                <p className="text-xs text-gray-500 truncate">{emp.job_title ?? emp.department ?? "—"}</p>
              </div>
              <ChevronLeft className="h-5 w-5 text-gray-400 flex-shrink-0" />
            </button>
          ))
        )}
      </div>
    </div>
  );
}
