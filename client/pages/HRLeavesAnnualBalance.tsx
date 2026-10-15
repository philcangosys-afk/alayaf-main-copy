import { Fragment, useEffect, useMemo, useState } from "react";
import Layout from "@/components/Layout";
import { Search, Download } from "lucide-react";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n";
import { addDays, daysInclusive, riyadhToday, serviceYears } from "@/lib/hrDates";
import { ACTIVE_EMPLOYEE_STATUSES, isAnnualLeaveType, isApprovedStatus } from "@/lib/hrStatus";
import { fetchAllRows } from "@/lib/fetchAll";

type CountedLeave = { id: string; startDate: string; endDate: string; days: number };

type BalanceRow = {
  id: string;
  empId: string;
  name: string;
  jobTitle: string;
  branch: string;
  department: string;
  administration: string;
  workLocation: string;
  workTime: string;
  hireDate: string;
  contractEndDate: string;
  entitlementBasis: string;
  annualEntitlement: number;
  endOfYearBalance: number;
  usedCurrentYear: number;
  remainingBalance: number;
  currentBalance: number;
  lastReturnDate: string;
  countedLeaves: CountedLeave[];
};

const round2 = (value: number) => Math.round(value * 100) / 100;
const INACTIVE_LEAVE_TYPE_STATUSES = ["غير مفعل", "غير مفعلة", "غير فعال", "غير فعالة", "معطل", "معطلة", "موقوف", "موقوفة", "inactive", "disabled"];
const isInactiveLeaveType = (status: unknown) => INACTIVE_LEAVE_TYPE_STATUSES.includes(String(status ?? "").trim().toLowerCase());
const dateKey = (value: unknown) => String(value ?? "").slice(0, 10);

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

export default function HRLeavesAnnualBalance() {
  const { t, direction } = useI18n();
  const [rows, setRows] = useState<BalanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState("الكل");
  const [deptFilter, setDeptFilter] = useState("الكل");
  const [locationFilter, setLocationFilter] = useState("الكل");
  const [adminFilter, setAdminFilter] = useState("الكل");
  const [workTimeFilter, setWorkTimeFilter] = useState("الكل");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const today = riyadhToday();
  const currentYear = today.slice(0, 4);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        // كل الموظفين (نشطين وغيرهم) لمعرفة الأرقام الوظيفية المكررة، ثم نعرض النشطين فقط
        const [allEmployees, allLeaves, typesResult] = await Promise.all([
          fetchAllRows<Record<string, unknown>>((from, to) =>
            supabase
              .from("employees")
              .select("id, emp_id, name, job_title, branch, department, directorate, work_location, work_time, hire_date, contract_end_date, management_days_after, status")
              .order("id")
              .range(from, to),
          ),
          fetchAllRows<Record<string, unknown>>((from, to) =>
            supabase
              .from("leave_requests")
              .select("id, emp_id, employee_id, days, status, leave_type, start_date, end_date")
              .order("id")
              .range(from, to),
          ),
          supabase.from("leave_types").select("*").order("id"),
        ]);

        // مدة الإجازة السنوية في سياسة الشركة (تصنيف الإجازات)؛ إن تعذر تحميلها نكمل بملف الموظف ونظام العمل
        if (typesResult.error) {
          toast({
            title: t("تعذر تحميل تصنيفات الإجازات"),
            description: t("الاستحقاق محسوب من ملف الموظف ونظام العمل فقط"),
            variant: "destructive",
          });
        }
        const companyAnnualDays = ((typesResult.data as Record<string, unknown>[] | null) ?? [])
          .filter((type) => isAnnualLeaveType(type.name) && !isInactiveLeaveType(type.status))
          .reduce((max, type) => Math.max(max, Number(type.max_days) || 0), 0);

        const employees = allEmployees
          .filter((e) => ACTIVE_EMPLOYEE_STATUSES.includes(String(e.status ?? "").trim()))
          .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""), "ar"));
        const yearStart = `${currentYear}-01-01`;
        const yearEnd = `${currentYear}-12-31`;
        const daysInYear = daysInclusive(yearStart, yearEnd);

        // الرقم الوظيفي يُعتمد للربط فقط إن كان لموظف واحد في كل الموظفين (توجد أرقام مكررة)
        const codeCounts = new Map<string, number>();
        const uuidByCode = new Map<string, string>();
        allEmployees.forEach((e) => {
          const code = String(e.emp_id ?? "").trim();
          if (!code) return;
          codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1);
          uuidByCode.set(code, String(e.id));
        });

        // الإجازات السنوية المعتمدة فقط، وكل إجازة تُنسب لموظف واحد: employee_id أولًا ثم الرقم الوظيفي غير المكرر
        const annualApproved = allLeaves.filter((l) => isApprovedStatus(l.status) && isAnnualLeaveType(l.leave_type));
        const byEmployeeId = new Map<string, Record<string, unknown>[]>();
        annualApproved.forEach((l) => {
          const employeeUuid = String(l.employee_id ?? "").trim();
          const code = String(l.emp_id ?? "").trim();
          const owner = employeeUuid || (code && codeCounts.get(code) === 1 ? uuidByCode.get(code) ?? "" : "");
          if (!owner) return;
          const list = byEmployeeId.get(owner) ?? [];
          list.push(l);
          byEmployeeId.set(owner, list);
        });

        const computed: BalanceRow[] = employees.map((e: any) => {
          const empId = String(e.emp_id ?? "");
          const hireDate = dateKey(e.hire_date);

          // الاستحقاق السنوي = الأعلى من: الأيام التعاقدية، ونظام العمل (21 يومًا، و30 بعد خمس سنوات)، وسياسة الشركة
          const contractualDays = Number(e.management_days_after ?? 0) || 0;
          const years = serviceYears(hireDate, today);
          const statutoryDays = years >= 5 ? 30 : 21;
          const annualEntitlement = Math.max(contractualDays, statutoryDays, companyAnnualDays);
          const entitlementBasis =
            contractualDays > 0 && contractualDays === annualEntitlement ? "تعاقدي"
            : companyAnnualDays > 0 && companyAnnualDays === annualEntitlement && companyAnnualDays > statutoryDays ? "سياسة الشركة"
            : years >= 5 ? "نظام العمل (5 سنوات فأكثر)" : "نظام العمل";

          // الاستحقاق نسبي من max(تاريخ التعيين، 1 يناير) إلى اليوم/نهاية السنة
          const accrualStart = hireDate && hireDate > yearStart ? hireDate : yearStart;
          const accruedToday = accrualStart > today ? 0 : (annualEntitlement * daysInclusive(accrualStart, today)) / daysInYear;
          const accruedYear = accrualStart > yearEnd ? 0 : (annualEntitlement * daysInclusive(accrualStart, yearEnd)) / daysInYear;

          const leaves = byEmployeeId.get(String(e.id)) ?? [];

          const countedLeaves: CountedLeave[] = [];
          let lastEnd = "";
          leaves.forEach((l) => {
            const days = leaveDaysInYear(l, yearStart, yearEnd);
            const startDate = dateKey(l.start_date);
            const endDate = dateKey(l.end_date) || startDate;
            if (days > 0) countedLeaves.push({ id: String(l.id ?? ""), startDate, endDate, days });
            // آخر عودة: الإجازات المنتهية فعلًا قبل اليوم فقط
            if (endDate && endDate < today && endDate > lastEnd) lastEnd = endDate;
          });
          countedLeaves.sort((a, b) => a.startDate.localeCompare(b.startDate));
          const usedCurrentYear = round2(countedLeaves.reduce((sum, l) => sum + l.days, 0));

          return {
            id: String(e.id),
            empId,
            name: String(e.name ?? ""),
            jobTitle: String(e.job_title ?? ""),
            branch: String(e.branch ?? ""),
            department: String(e.department ?? ""),
            administration: String(e.directorate ?? e.department ?? ""),
            workLocation: String(e.work_location ?? ""),
            workTime: String(e.work_time ?? ""),
            hireDate,
            contractEndDate: dateKey(e.contract_end_date),
            entitlementBasis,
            annualEntitlement,
            endOfYearBalance: round2(accruedYear),
            usedCurrentYear,
            remainingBalance: round2(accruedYear - usedCurrentYear),
            currentBalance: round2(accruedToday - usedCurrentYear),
            lastReturnDate: lastEnd ? addDays(lastEnd, 1) : "-",
            countedLeaves,
          };
        });

        setRows(computed);
      } catch (error) {
        toast({
          title: t("تعذر تحميل أرصدة الإجازات"),
          description: (error as { message?: string } | null)?.message || t("حدث خطأ غير متوقع"),
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const options = useMemo(() => {
    const uniq = (vals: string[]) => ["الكل", ...Array.from(new Set(vals.filter(Boolean)))];
    return {
      branches: uniq(rows.map((r) => r.branch)),
      departments: uniq(rows.map((r) => r.department)),
      locations: uniq(rows.map((r) => r.workLocation)),
      admins: uniq(rows.map((r) => r.administration)),
      workTimes: uniq(rows.map((r) => r.workTime)),
    };
  }, [rows]);

  const filtered = useMemo(() => {
    const keyword = search.trim();
    return rows.filter((r) => {
      if (keyword && !r.name.includes(keyword) && !r.empId.includes(keyword)) return false;
      if (branchFilter !== "الكل" && r.branch !== branchFilter) return false;
      if (deptFilter !== "الكل" && r.department !== deptFilter) return false;
      if (locationFilter !== "الكل" && r.workLocation !== locationFilter) return false;
      if (adminFilter !== "الكل" && r.administration !== adminFilter) return false;
      if (workTimeFilter !== "الكل" && r.workTime !== workTimeFilter) return false;
      return true;
    });
  }, [rows, search, branchFilter, deptFilter, locationFilter, adminFilter, workTimeFilter]);

  const carryLabel = t("الترحيل غير مفعّل");

  const exportCSV = () => {
    const cell = (value: unknown) => {
      const text = String(value ?? "");
      return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const headers = [t("الرقم الوظيفي"), t("الاسم"), t("الرصيد السنوي"), t("أساس الاستحقاق"), t("رصيد السنوات السابقة"), t("المستحق حتى نهاية السنة الحالية"), t("المستخدم في السنة الحالية"), t("المتبقي حتى نهاية السنة الحالية"), t("الرصيد المتاح حتى اليوم"), t("آخر عودة من إجازة سنوية"), t("تاريخ التعيين"), t("تاريخ انتهاء العقد")].map(cell).join(",");
    const csvRows = filtered.map((r) =>
      [r.empId, r.name, r.annualEntitlement.toFixed(2), t(r.entitlementBasis), carryLabel, r.endOfYearBalance.toFixed(2), r.usedCurrentYear.toFixed(2), r.remainingBalance.toFixed(2), r.currentBalance.toFixed(2), r.lastReturnDate, r.hireDate, r.contractEndDate].map(cell).join(",")
    );
    // BOM حتى يفتح Excel الملف بترميز UTF-8 وتظهر العربية صحيحة
    const blob = new Blob(["\uFEFF" + headers + "\r\n" + csvRows.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `أرصدة_الإجازات_السنوية_${today}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Layout>
      <div className="w-full p-4 space-y-4" dir={direction}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-xl font-bold text-gray-900">{t("أرصدة الإجازات")}</h1>
          <div className="flex items-center gap-3 text-sm text-gray-600">
            <span>{t("تاريخ التقرير")}: {today}</span>
            <button onClick={exportCSV} title={t("تصدير CSV")} aria-label={t("تصدير CSV")} className="flex items-center gap-1 px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50 text-sm">
              <Download className="h-4 w-4" /> {t("تصدير")}
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-xs text-gray-600 space-y-1">
          <p>{t("الاستحقاق السنوي: الأعلى من الأيام التعاقدية في ملف الموظف، ونظام العمل (21 يومًا، و30 يومًا بعد خمس سنوات خدمة)، ومدة الإجازة السنوية في تصنيف الإجازات. يُحتسب نسبيًا من بداية السنة أو تاريخ التعيين، والمستخدم = أيام الإجازات السنوية المعتمدة داخل السنة الحالية.")}</p>
          <p>{t("الأرصدة محسوبة من الإجازات المعتمدة المسجلة في النظام")}</p>
        </div>

        {/* Filter bar */}
        <div className="bg-white rounded-lg border border-gray-200 p-3 flex flex-wrap gap-2 items-end">
          <FilterSelect label={t("الفرع")} value={branchFilter} onChange={setBranchFilter} options={options.branches} t={t} />
          <FilterSelect label={t("الإدارة")} value={adminFilter} onChange={setAdminFilter} options={options.admins} t={t} />
          <FilterSelect label={t("القسم")} value={deptFilter} onChange={setDeptFilter} options={options.departments} t={t} />
          <FilterSelect label={t("مكان العمل")} value={locationFilter} onChange={setLocationFilter} options={options.locations} t={t} />
          <FilterSelect label={t("وقت العمل")} value={workTimeFilter} onChange={setWorkTimeFilter} options={options.workTimes} t={t} />
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input placeholder={t("بحث...")} value={search} onChange={(e) => setSearch(e.target.value)} className="pr-9 h-9 text-sm" />
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 text-sm text-gray-600">
            <span>{t("العدد")} {filtered.length}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-center whitespace-nowrap">
              <thead className="bg-[#004e89] text-white">
                <tr>
                  <th className="py-3 px-3 font-medium">{t("الرقم الوظيفي")}</th>
                  <th className="py-3 px-3 font-medium text-right">{t("الاسم")}</th>
                  <th className="py-3 px-3 font-medium">{t("الرصيد السنوي")}</th>
                  <th className="py-3 px-3 font-medium">{t("رصيد السنوات السابقة")}</th>
                  <th className="py-3 px-3 font-medium">{t("المستحق حتى نهاية السنة الحالية")}</th>
                  <th className="py-3 px-3 font-medium">{t("المستخدم في السنة الحالية")}</th>
                  <th className="py-3 px-3 font-medium">{t("المتبقي حتى نهاية السنة الحالية")}</th>
                  <th className="py-3 px-3 font-medium text-[#a5d8ff]">{t("الرصيد المتاح حتى اليوم")}</th>
                  <th className="py-3 px-3 font-medium">{t("آخر عودة من إجازة سنوية")}</th>
                  <th className="py-3 px-3 font-medium">{t("تاريخ التعيين")}</th>
                  <th className="py-3 px-3 font-medium">{t("تاريخ انتهاء العقد")}</th>
                  <th className="py-3 px-3 font-medium">{t("إجراءات")}</th>
                </tr>
              </thead>
              <tbody className="divide-y bg-white">
                {loading ? (
                  <tr><td colSpan={12} className="py-10 text-center text-gray-400">{t("جاري التحميل...")}</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={12} className="py-10 text-center text-gray-500">{t("لا توجد بيانات")}</td></tr>
                ) : filtered.map((row) => (
                  <Fragment key={row.id}>
                    <tr className="hover:bg-gray-50/50">
                      <td className="py-2.5 px-3">{row.empId || "—"}</td>
                      <td className="py-2.5 px-3 text-right font-medium">{row.name}</td>
                      <td className="py-2.5 px-3" title={t(row.entitlementBasis)}>{row.annualEntitlement.toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-gray-400">{carryLabel}</td>
                      <td className="py-2.5 px-3">{row.endOfYearBalance.toFixed(2)}</td>
                      <td className="py-2.5 px-3">{row.usedCurrentYear.toFixed(2)}</td>
                      <td className="py-2.5 px-3">{row.remainingBalance.toFixed(2)}</td>
                      <td className="py-2.5 px-3 font-semibold text-[#004e89]">{row.currentBalance.toFixed(2)}</td>
                      <td className="py-2.5 px-3">{row.lastReturnDate}</td>
                      <td className="py-2.5 px-3">{row.hireDate || "—"}</td>
                      <td className="py-2.5 px-3">{row.contractEndDate || "—"}</td>
                      <td className="py-2.5 px-3">
                        <button
                          onClick={() => setExpandedId((current) => (current === row.id ? null : row.id))}
                          aria-expanded={expandedId === row.id}
                          className="text-[#004e89] hover:underline text-xs"
                        >
                          {expandedId === row.id ? t("إخفاء التفاصيل") : t("التفاصيل")}
                        </button>
                      </td>
                    </tr>
                    {expandedId === row.id && (
                      <tr className="bg-gray-50">
                        <td colSpan={12} className="px-4 py-3 text-right whitespace-normal">
                          <p className="mb-2 text-gray-600">
                            {t("أساس الاستحقاق")}: {t(row.entitlementBasis)} — {row.annualEntitlement} {t("يوم في السنة")}
                          </p>
                          {row.countedLeaves.length === 0 ? (
                            <p className="text-gray-500">{t("لا توجد إجازات سنوية معتمدة محتسبة في السنة الحالية")}</p>
                          ) : (
                            <table className="text-xs border border-gray-200 bg-white">
                              <thead className="bg-gray-100 text-gray-700">
                                <tr>
                                  <th className="py-1.5 px-3 font-medium">{t("من")}</th>
                                  <th className="py-1.5 px-3 font-medium">{t("إلى")}</th>
                                  <th className="py-1.5 px-3 font-medium">{t("الأيام المحتسبة")}</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y">
                                {row.countedLeaves.map((leave) => (
                                  <tr key={leave.id || `${leave.startDate}-${leave.endDate}`}>
                                    <td className="py-1.5 px-3">{leave.startDate}</td>
                                    <td className="py-1.5 px-3">{leave.endDate}</td>
                                    <td className="py-1.5 px-3">{leave.days}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-gray-100 text-xs text-gray-500 text-right">
            {t("عرض")} {filtered.length ? 1 : 0} {t("إلى")} {filtered.length} {t("من أصل")} {rows.length} {t("سجل")}
          </div>
        </div>
      </div>
    </Layout>
  );
}

function FilterSelect({ label, value, onChange, options, t }: { label: string; value: string; onChange: (v: string) => void; options: string[]; t: (s: string) => string }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-[110px]">
      <span className="text-xs text-gray-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 border border-gray-300 rounded-md px-2 bg-white text-sm outline-none focus:ring-1 focus:ring-[#004e89]"
      >
        {options.map((op) => <option key={op} value={op}>{t(op)}</option>)}
      </select>
    </div>
  );
}
