import { useEffect, useMemo, useState } from "react";
import Layout from "@/components/Layout";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabaseClient";
import { fetchAllRows } from "@/lib/fetchAll";
import { hrRequestErrorText } from "@/lib/hrErrors";
import { isEmployeeActive } from "@/lib/employeeStatus";
import { isSaudiNationality } from "@/lib/hrStatus";
import { monthRange, riyadhMonth } from "@/lib/hrDates";
import { allowancesForPeriod, loadPayrollPolicy } from "@/lib/payrollCalc";
import { GOSI_TYPE_NEW_SYSTEM, GOSI_WAGE_CAP, gosiExcluded, gosiShares, type GosiShares } from "@/lib/gosi";
import { useI18n } from "@/i18n";

/**
 * التأمينات الاجتماعية: الاشتراك الشهري المتوقع لكل موظف فعال من بيانات ملفه (لا من مسير الرواتب).
 * المصدر نفسه الذي يحسب به مسير الرواتب حصة الموظف (lib/gosi): أجر الاشتراك = الأساسي + بدل السكن بحد 45,000،
 * السعودي 9.75% موظف و11.75% منشأة، وغير السعودي 2% منشأة فقط.
 */
type Row = {
  id: string;
  empId: string;
  name: string;
  nationality: string;
  coverage: "included" | "excluded" | "unset";
  insuranceType: string;
  startDate: string;
  shares: GosiShares;
  capped: boolean;
  /** سعودي ملفه "غير مشمول" ويُخصم منه لأن إعداد اتباع الحقل مطفأ */
  flagIgnored: boolean;
};

const COVERAGE_LABELS: Record<Row["coverage"], string> = { included: "مشمول", excluded: "غير مشمول", unset: "غير محدد" };

export default function HRInsuranceSocial() {
  const { t, direction, formatNumber, formatDate } = useI18n();
  const [items, setItems] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [policyError, setPolicyError] = useState(false);

  const money = (value: number) => formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const percent = (rate: number) => `${formatNumber(rate * 100, { maximumFractionDigits: 2 })}%`;

  useEffect(() => {
    const load = async () => {
      setLoading(true); setError("");
      try {
        const policyResult = await loadPayrollPolicy();
        const follow = policyResult.policy.gosiFollowEmployeeFlag;
        const includeHousing = policyResult.policy.gosiIncludeHousing;
        setPolicyError(Boolean(policyResult.error));
        const rows = await fetchAllRows<Record<string, unknown>>((from, to) => supabase
          .from("employees")
          .select("id, emp_id, name, nationality, status, base_salary, allowances, social_insurance, social_insurance_type, social_insurance_start_date")
          .order("name")
          .order("id")
          .range(from, to));
        const month = riyadhMonth();
        const { from, to } = monthRange(month);
        setItems(rows.filter((row) => isEmployeeActive(row.status)).map((row) => {
          const basic = Math.max(0, Number(row.base_salary) || 0);
          const { housing } = allowancesForPeriod(row.allowances, from, to);
          const flag = String(row.social_insurance ?? "").trim();
          const coverage: Row["coverage"] = gosiExcluded(flag) ? "excluded" : ["نعم", "مشمول"].includes(flag) ? "included" : "unset";
          return {
            id: String(row.id),
            empId: String(row.emp_id ?? ""),
            name: String(row.name ?? ""),
            nationality: String(row.nationality ?? ""),
            coverage,
            insuranceType: String(row.social_insurance_type ?? ""),
            startDate: String(row.social_insurance_start_date ?? "").slice(0, 10),
            shares: gosiShares({ nationality: row.nationality, socialInsurance: flag, insuranceType: row.social_insurance_type, basic, housing: includeHousing ? housing : 0, month, followFlag: follow }),
            capped: basic + (includeHousing ? housing : 0) > GOSI_WAGE_CAP,
            flagIgnored: !follow && coverage === "excluded" && isSaudiNationality(row.nationality),
          };
        }));
      } catch (loadError) {
        setError(hrRequestErrorText(loadError, t("تعذر تحميل بيانات التأمينات")));
        setItems([]);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [t]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((item) => !query || item.name.toLowerCase().includes(query) || item.empId.toLowerCase().includes(query));
  }, [items, search]);
  const totals = useMemo(() => filtered.filter((item) => !item.shares.excluded).reduce((sum, item) => ({
    wage: sum.wage + item.shares.wage,
    employee: sum.employee + item.shares.employee,
    employer: sum.employer + item.shares.employer,
    total: sum.total + item.shares.total,
  }), { wage: 0, employee: 0, employer: 0, total: 0 }), [filtered]);
  const unsetSaudis = items.filter((item) => item.coverage === "unset" && isSaudiNationality(item.nationality)).length;
  const ignoredFlags = items.filter((item) => item.flagIgnored).length;

  return (
    <Layout>
      <div className="mx-auto max-w-[1600px] space-y-6 p-6" dir={direction}>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("التأمينات الاجتماعية")}</h1>
          <p className="mt-1 text-sm text-gray-500">{t("الاشتراك الشهري المتوقع من بيانات ملف الموظف وإعدادات حساب الراتب: أجر الاشتراك = الأساسي (أو الأساسي + بدل السكن إن فُعّل الإعداد)، بحد 45,000. السعودي: 9.75% على الموظف و11.75% على المنشأة. غير السعودي: 2% على المنشأة فقط")}</p>
          <p className="mt-1 text-xs text-gray-500">{t("السعودي المسجّل أول مرة في التأمينات من 3 يوليو 2024 (نوع «النظام الجديد» في ملفه): نسبة المعاشات ترتفع 0.5% كل يوليو على الطرفين حتى 11% في 2028")}</p>
        </div>

        {unsetSaudis > 0 && (
          <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            {formatNumber(unsetSaudis)} {t("موظف سعودي حقل التأمينات في ملفه غير محدد؛ يُعامل مشمولًا ويُخصم من راتبه. حدّد الحقل في ملف الموظف (نعم أو لا)")}
          </div>
        )}
        {ignoredFlags > 0 && (
          <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            {formatNumber(ignoredFlags)} {t("موظف سعودي ملفه «غير مشمول» وتُخصم منه حصة التأمينات لأن إعداد «اتباع حقل التأمينات» مطفأ. إن كان غير مشمول فعلًا فصحّح ملفات البقية ثم فعّل الإعداد من إعدادات حساب الراتب")}
          </div>
        )}
        {policyError && <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{t("تعذر قراءة إعدادات حساب الراتب؛ الأرقام بالإعداد الافتراضي")}</div>}
        {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        <div className="overflow-hidden rounded-lg border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b p-4">
            <div className="relative w-72">
              <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input placeholder={t("بحث بالاسم أو الرقم الوظيفي...")} value={search} onChange={(event) => setSearch(event.target.value)} className="pr-9" />
            </div>
            <span className="text-sm text-gray-500">{formatNumber(filtered.length)} {t("موظف")}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1200px] text-right text-sm">
              <thead className="bg-[#004e89] text-white">
                <tr>
                  <th className="px-3 py-3 font-medium">{t("الرقم الوظيفي")}</th>
                  <th className="px-3 py-3 font-medium">{t("الاسم")}</th>
                  <th className="px-3 py-3 font-medium">{t("الجنسية")}</th>
                  <th className="px-3 py-3 font-medium">{t("الشمول")}</th>
                  <th className="px-3 py-3 font-medium">{t("نوع التأمين")}</th>
                  <th className="px-3 py-3 font-medium">{t("أجر الاشتراك")}</th>
                  <th className="px-3 py-3 font-medium">{t("حصة الموظف")}</th>
                  <th className="px-3 py-3 font-medium">{t("حصة المنشأة")}</th>
                  <th className="px-3 py-3 font-medium">{t("الإجمالي")}</th>
                  <th className="px-3 py-3 font-medium">{t("تاريخ الاشتراك")}</th>
                </tr>
              </thead>
              <tbody className="divide-y bg-white">
                {loading ? (
                  <tr><td colSpan={10} className="py-8 text-center text-gray-400">{t("جاري التحميل...")}</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={10} className="py-8 text-center text-gray-400">{t("لا توجد بيانات")}</td></tr>
                ) : filtered.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50/50">
                    <td className="px-3 py-2">{row.empId || "—"}</td>
                    <td className="px-3 py-2 font-medium">{row.name}</td>
                    <td className="px-3 py-2">{row.nationality || "—"}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-2 py-1 text-xs font-semibold ${row.coverage === "included" ? "bg-emerald-50 text-emerald-700" : row.coverage === "excluded" ? "bg-slate-100 text-slate-600" : "bg-amber-50 text-amber-700"}`}>{t(COVERAGE_LABELS[row.coverage])}</span>
                      {row.flagIgnored && <span className="ms-1 text-xs text-amber-700">({t("يُخصم")})</span>}
                    </td>
                    <td className="px-3 py-2">{row.insuranceType || "—"}{row.insuranceType === GOSI_TYPE_NEW_SYSTEM && <span className="block text-xs text-gray-500">{t("أول تسجيل من 3 يوليو 2024")}</span>}</td>
                    <td className="px-3 py-2">{money(row.shares.wage)}{row.capped && <span className="ms-1 text-xs text-gray-500">({t("الحد الأعلى")})</span>}</td>
                    <td className="px-3 py-2">{money(row.shares.employee)} <span className="text-xs text-gray-500">{percent(row.shares.employeeRate)}</span></td>
                    <td className="px-3 py-2">{money(row.shares.employer)} <span className="text-xs text-gray-500">{percent(row.shares.employerRate)}</span></td>
                    <td className="px-3 py-2 font-semibold">{money(row.shares.total)}</td>
                    <td className="px-3 py-2">{row.startDate ? formatDate(row.startDate) : "—"}</td>
                  </tr>
                ))}
              </tbody>
              {!loading && filtered.length > 0 && (
                <tfoot className="bg-slate-50 font-semibold">
                  <tr>
                    <td className="px-3 py-3" colSpan={5}>{t("الإجمالي")} ({t("ر.س")})</td>
                    <td className="px-3 py-3">{money(totals.wage)}</td>
                    <td className="px-3 py-3">{money(totals.employee)}</td>
                    <td className="px-3 py-3">{money(totals.employer)}</td>
                    <td className="px-3 py-3">{money(totals.total)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>
    </Layout>
  );
}
