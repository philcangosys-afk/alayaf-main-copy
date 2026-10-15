import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n";
import { daysInclusive, riyadhToday } from "@/lib/hrDates";
import { ACTIVE_EMPLOYEE_STATUSES, isAnnualLeaveType, isApprovedStatus } from "@/lib/hrStatus";
import { fetchAllRows } from "@/lib/fetchAll";

type Row = { id: string; empId: string; name: string; type: string; annualBalance: string; usedDays: string; remainingBalance: string; joinDate: string; contractDate: string };

const dateKey = (value: unknown) => String(value ?? "").slice(0, 10);
const typeKey = (value: unknown) => String(value ?? "").trim();
const INACTIVE_LEAVE_TYPE_STATUSES = ["غير مفعل", "غير مفعلة", "غير فعال", "غير فعالة", "معطل", "معطلة", "موقوف", "موقوفة", "inactive", "disabled"];
const isInactiveLeaveType = (status: unknown) => INACTIVE_LEAVE_TYPE_STATUSES.includes(String(status ?? "").trim().toLowerCase());

/** أيام الإجازة الواقعة داخل السنة: days المحفوظ إن وُجد والإجازة كلها داخل السنة، وإلا عدد الأيام المقصوص على حدود السنة */
function leaveDaysInYear(leave: { days?: unknown; start_date?: unknown; end_date?: unknown }, yearStart: string, yearEnd: string): number {
  const start = dateKey(leave.start_date);
  if (!start) return 0;
  const end = dateKey(leave.end_date) || start;
  if (end < yearStart || start > yearEnd) return 0;
  const stored = Number(leave.days);
  const hasStoredDays = leave.days !== null && leave.days !== undefined && leave.days !== "" && Number.isFinite(stored) && stored > 0;
  if (start >= yearStart && end <= yearEnd) return hasStoredDays ? stored : daysInclusive(start, end);
  return daysInclusive(start > yearStart ? start : yearStart, end < yearEnd ? end : yearEnd);
}

export default function HRLeavesOtherBalance() {
  const { t, direction } = useI18n();
  const [items, setItems] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const year = riyadhToday().slice(0, 4);
        const yearStart = `${year}-01-01`;
        const yearEnd = `${year}-12-31`;
        // كل الموظفين (نشطين وغيرهم) لمعرفة الأرقام الوظيفية المكررة، ونعرض النشطين فقط
        const [allEmployees, typesResult, leaves] = await Promise.all([
          fetchAllRows<Record<string, unknown>>((from, to) =>
            supabase.from("employees").select("id, emp_id, name, hire_date, gender, status").order("id").range(from, to),
          ),
          supabase.from("leave_types").select("*").order("id"),
          fetchAllRows<Record<string, unknown>>((from, to) =>
            supabase
              .from("leave_requests")
              .select("id, emp_id, employee_id, leave_type, start_date, end_date, days, status")
              .lte("start_date", yearEnd)
              .order("id")
              .range(from, to),
          ),
        ]);
        if (typesResult.error) throw typesResult.error;
        const emps = allEmployees
          .filter((e) => ACTIVE_EMPLOYEE_STATUSES.includes(String(e.status ?? "").trim()))
          .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""), "ar"));
        // كل الأنواع المفعّلة عدا الإجازة السنوية بأي صيغة
        const types = ((typesResult.data as Record<string, unknown>[] | null) ?? [])
          .filter((lt) => !isAnnualLeaveType(lt.name) && !isInactiveLeaveType(lt.status));

        // الرقم الوظيفي يُعتمد للربط فقط إن كان لموظف واحد في كل الموظفين (توجد أرقام مكررة)
        const codeCounts = new Map<string, number>();
        const uuidByCode = new Map<string, string>();
        allEmployees.forEach((e) => {
          const code = String(e.emp_id ?? "").trim();
          if (!code) return;
          codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1);
          uuidByCode.set(code, String(e.id));
        });

        // الأيام المعتمدة المستخدمة هذا العام لكل (موظف، نوع)؛ كل طلب يُنسب لموظف واحد بالـ UUID
        const usedById = new Map<string, number>();
        leaves.forEach((l) => {
          if (!isApprovedStatus(l.status)) return;
          const days = leaveDaysInYear(l, yearStart, yearEnd);
          if (days <= 0) return;
          const type = typeKey(l.leave_type);
          const code = String(l.emp_id ?? "").trim();
          const owner = String(l.employee_id ?? "").trim() || (code && codeCounts.get(code) === 1 ? uuidByCode.get(code) ?? "" : "");
          if (!owner) return;
          usedById.set(`${owner}|${type}`, (usedById.get(`${owner}|${type}`) ?? 0) + days);
        });

        const rows: Row[] = [];
        emps.forEach((e: any) => {
          types.forEach((lt: any) => {
            if (lt.gender === "female" && e.gender !== "أنثى") return;
            if (lt.gender === "male" && e.gender !== "ذكر") return;
            const type = typeKey(lt.name);
            const maxDays = Number(lt.max_days ?? 0);
            const used = usedById.get(`${e.id}|${type}`) ?? 0;
            rows.push({
              id: `${e.id}-${lt.id}`, empId: e.emp_id ?? "", name: e.name ?? "",
              type: lt.name ?? "", annualBalance: maxDays.toFixed(2),
              usedDays: used.toFixed(2),
              remainingBalance: (Math.round((maxDays - used) * 100) / 100).toFixed(2),
              joinDate: e.hire_date ?? "-", contractDate: e.hire_date ?? "-",
            });
          });
        });
        setItems(rows);
      } catch (error) {
        toast({
          title: t("تعذر تحميل أرصدة الإجازات"),
          description: (error as { message?: string } | null)?.message || t("حدث خطأ غير متوقع"),
          variant: "destructive",
        });
      } finally { setLoading(false); }
    })();
  }, []);

  const filtered = items.filter((i) => !search || i.name.includes(search) || i.empId.includes(search));

  return (
    <Layout>
      <div className="p-6 max-w-[1600px] mx-auto space-y-6" dir={direction}>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">{t("أرصدة الإجازات الأخرى")}</h1>
        </div>
        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
          <div className="p-4 border-b flex justify-between items-center">
            <div className="relative w-72">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input placeholder={t("بحث...")} value={search} onChange={(e) => setSearch(e.target.value)} className="pr-9" />
            </div>
            <span className="text-sm text-gray-500">{filtered.length} {t("سجل")}</span>
          </div>
          <p className="px-4 py-2 border-b text-xs text-gray-600 bg-gray-50">
            {t("المتبقي = الحد السنوي للنوع − الأيام المعتمدة من النوع نفسه في السنة الحالية.")} {t("الأرصدة محسوبة من الإجازات المعتمدة المسجلة في النظام")}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-center whitespace-nowrap">
              <thead className="bg-[#004e89] text-white">
                <tr>
                  <th className="py-3 px-3 font-medium">{t("الرقم الوظيفي")}</th>
                  <th className="py-3 px-3 font-medium text-right">{t("الاسم")}</th>
                  <th className="py-3 px-3 font-medium">{t("نوع الإجازة")}</th>
                  <th className="py-3 px-3 font-medium">{t("الرصيد السنوي")}</th>
                  <th className="py-3 px-3 font-medium">{t("المستخدم في السنة الحالية")}</th>
                  <th className="py-3 px-3 font-medium">{t("الرصيد المتبقي")}</th>
                  <th className="py-3 px-3 font-medium">{t("تاريخ التعيين")}</th>
                  <th className="py-3 px-3 font-medium">{t("تاريخ التعاقد")}</th>
                </tr>
              </thead>
              <tbody className="divide-y bg-white">
                {loading ? (
                  <tr><td colSpan={8} className="text-center py-8 text-gray-400">{t("جاري التحميل...")}</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-8 text-gray-400">{t("لا توجد بيانات")}</td></tr>
                ) : filtered.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50/50">
                    <td className="py-3 px-3">{row.empId}</td>
                    <td className="py-3 px-3 font-medium text-right">{row.name}</td>
                    <td className="py-3 px-3">{t(row.type)}</td>
                    <td className="py-3 px-3">{row.annualBalance}</td>
                    <td className="py-3 px-3">{row.usedDays}</td>
                    <td className="py-3 px-3">{row.remainingBalance}</td>
                    <td className="py-3 px-3">{row.joinDate}</td>
                    <td className="py-3 px-3">{row.contractDate}</td>
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
