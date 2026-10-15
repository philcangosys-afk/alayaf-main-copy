import { useEffect, useMemo, useState } from "react";
import Layout from "@/components/Layout";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n";
import { riyadhToday } from "@/lib/hrDates";
import { ACTIVE_EMPLOYEE_STATUSES, isApprovedStatus } from "@/lib/hrStatus";
import { fetchAllRows } from "@/lib/fetchAll";

const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

type ChartRow = { id: string; empId: string; name: string; months: string[] };
type EmployeeRow = { id: string; empId: string; name: string };
// owner = UUID الموظف صاحب الإجازة (employee_id، أو الرقم الوظيفي إن كان لموظف واحد فقط)
type LeaveSpan = { owner: string; start: string; end: string };

export default function HRLeavesChart() {
  const { t, direction } = useI18n();
  const currentYear = Number(riyadhToday().slice(0, 4));
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [leaves, setLeaves] = useState<LeaveSpan[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [year, setYear] = useState(currentYear);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // كل الموظفين (نشطين وغيرهم) لمعرفة الأرقام الوظيفية المكررة، ونعرض النشطين فقط
        const [allEmployees, leaveRows] = await Promise.all([
          fetchAllRows<Record<string, unknown>>((from, to) =>
            supabase.from("employees").select("id, emp_id, name, status").order("id").range(from, to),
          ),
          fetchAllRows<Record<string, unknown>>((from, to) =>
            supabase.from("leave_requests").select("id, emp_id, employee_id, start_date, end_date, status").order("id").range(from, to),
          ),
        ]);
        const codeCounts = new Map<string, number>();
        const uuidByCode = new Map<string, string>();
        allEmployees.forEach((e) => {
          const code = String(e.emp_id ?? "").trim();
          if (!code) return;
          codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1);
          uuidByCode.set(code, String(e.id));
        });
        setEmployees(
          allEmployees
            .filter((e) => ACTIVE_EMPLOYEE_STATUSES.includes(String(e.status ?? "").trim()))
            .map((e) => ({ id: String(e.id), empId: String(e.emp_id ?? ""), name: String(e.name ?? "") }))
            .sort((a, b) => a.name.localeCompare(b.name, "ar")),
        );
        setLeaves(
          leaveRows
            .filter((l) => isApprovedStatus(l.status) && l.start_date)
            .map((l) => {
              const start = String(l.start_date).slice(0, 10);
              const end = String(l.end_date ?? "").slice(0, 10);
              const code = String(l.emp_id ?? "").trim();
              const owner = String(l.employee_id ?? "").trim() || (code && codeCounts.get(code) === 1 ? uuidByCode.get(code) ?? "" : "");
              return { owner, start, end: end && end >= start ? end : start };
            })
            .filter((l) => l.owner),
        );
      } catch (error) {
        toast({
          title: t("تعذر تحميل مخطط الإجازات"),
          description: (error as { message?: string } | null)?.message || t("حدث خطأ غير متوقع"),
          variant: "destructive",
        });
      } finally { setLoading(false); }
    })();
  }, []);

  // السنوات من بيانات الإجازات المعتمدة مع السنة الحالية
  const years = useMemo(() => {
    const set = new Set<number>([currentYear]);
    leaves.forEach((l) => {
      for (let y = Number(l.start.slice(0, 4)); y <= Number(l.end.slice(0, 4)); y += 1) set.add(y);
    });
    return Array.from(set).filter(Number.isFinite).sort((a, b) => b - a);
  }, [leaves, currentYear]);

  const items = useMemo<ChartRow[]>(() => {
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;
    const byId = new Map<string, Set<number>>();
    const mark = (key: string, month: number) => {
      if (!key) return;
      const set = byId.get(key) ?? new Set<number>();
      set.add(month);
      byId.set(key, set);
    };
    leaves.forEach((l) => {
      if (l.end < yearStart || l.start > yearEnd) return;
      const from = Number((l.start > yearStart ? l.start : yearStart).slice(5, 7)) - 1;
      const to = Number((l.end < yearEnd ? l.end : yearEnd).slice(5, 7)) - 1;
      // كل شهر تمتد إليه الإجازة، لا شهر البداية فقط
      for (let m = from; m <= to; m += 1) mark(l.owner, m);
    });
    return employees.map((e) => {
      const idMonths = byId.get(e.id);
      const months = Array.from({ length: 12 }, (_, i) => (idMonths?.has(i) ? "إجازة" : "-"));
      return { id: e.id, empId: e.empId, name: e.name, months };
    });
  }, [employees, leaves, year]);

  const filtered = items.filter((i) => !search || i.name.includes(search) || i.empId.includes(search));

  return (
    <Layout>
      <div className="p-6 max-w-[1600px] mx-auto space-y-6" dir={direction}>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">{t("مخطط الإجازات")}</h1>
          <div className="flex items-center gap-3">
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="h-10 border rounded-md px-3 bg-white text-sm">
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>

        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
          <div className="p-4 border-b flex justify-between items-center">
            <div className="relative w-72">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input placeholder={t("بحث...")} value={search} onChange={(e) => setSearch(e.target.value)} className="pr-9" />
            </div>
            <span className="text-sm text-gray-500">{filtered.length} {t("موظف")}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-center whitespace-nowrap">
              <thead className="bg-[#004e89] text-white">
                <tr>
                  <th className="py-3 px-2 font-medium">{t("الرقم الوظيفي")}</th>
                  <th className="py-3 px-2 font-medium text-right min-w-[150px]">{t("الاسم")}</th>
                  {MONTHS.map((m) => <th key={m} className="py-3 px-2 font-medium">{t(m)}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y bg-white">
                {loading ? (
                  <tr><td colSpan={14} className="text-center py-8 text-gray-400">{t("جاري التحميل...")}</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={14} className="text-center py-8 text-gray-400">{t("لا توجد بيانات")}</td></tr>
                ) : filtered.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50/50">
                    <td className="py-3 px-2">{row.empId}</td>
                    <td className="py-3 px-2 font-medium text-right">{row.name}</td>
                    {row.months.map((m, i) => (
                      <td key={i} className={`py-3 px-2 ${m === "إجازة" ? "bg-amber-50 text-amber-700 font-medium" : "text-gray-400"}`}>{m === "إجازة" ? t("إجازة") : m}</td>
                    ))}
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
