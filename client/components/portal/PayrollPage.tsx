import { useEffect, useState } from "react";
import { ChevronLeft, DollarSign } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/i18n";

type Props = { empId: string; onBack: () => void };

type PayrollRecord = {
  id: string;
  month: string;
  status: string;
  accounting_status: string | null;
  basic_salary: number;
  allowances: number;
  social_insurance_deduction: number;
  penalty_deduction: number;
  advance_deduction: number;
  expense_reduction: number;
  deductions: number;
  net_salary: number;
  notes: string | null;
  paid_date: string | null;
};

const num = (value: unknown) => Math.round((Number(value) || 0) * 100) / 100;

/** حالة القسيمة للموظف: معتمد = لم يُصرف بعد، مرحّل = مستحق مسجّل محاسبيًا، مدفوع */
const statusLabel = (record: PayrollRecord) => {
  if (record.status === "مدفوع") return "مدفوع";
  if (record.status === "موقوف") return "مستحق وموقوف الصرف بقرار الإدارة";
  if (record.status === "مرحّل" || record.accounting_status === "posted") return "مستحق (مرحّل)";
  return "معتمد";
};

export default function PayrollPage({ onBack }: Props) {
  const { t, formatNumber, formatDate } = useI18n();
  const [records, setRecords] = useState<PayrollRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<PayrollRecord | null>(null);

  useEffect(() => {
    async function load() {
      // كشوف الموظف نفسه المعتمدة أو المرحّلة أو المدفوعة فقط (لا المسودات)، من دالة الخادم get_my_payslips
      const { data, error: loadError } = await supabase.rpc("get_my_payslips");
      if (loadError) {
        setError(t("تعذر تحميل كشوف الراتب؛ حاول لاحقًا أو راجع الموارد البشرية"));
        setRecords([]);
      } else {
        setRecords(((data ?? []) as Record<string, unknown>[]).map((row) => ({
          id: String(row.id ?? ""),
          month: String(row.month ?? ""),
          status: String(row.status ?? ""),
          accounting_status: row.accounting_status ? String(row.accounting_status) : null,
          basic_salary: num(row.basic_salary),
          allowances: num(row.allowances),
          social_insurance_deduction: num(row.social_insurance_deduction),
          penalty_deduction: num(row.penalty_deduction),
          advance_deduction: num(row.advance_deduction),
          expense_reduction: num(row.expense_reduction),
          deductions: num(row.deductions),
          net_salary: num(row.net_salary),
          notes: row.notes ? String(row.notes) : null,
          paid_date: row.paid_date ? String(row.paid_date) : null,
        })));
      }
      setLoading(false);
    }
    void load();
  }, [t]);

  if (selected) {
    const other = num(selected.deductions - selected.social_insurance_deduction - selected.penalty_deduction
      - selected.advance_deduction - selected.expense_reduction);
    const lines: { label: string; value: number; color: string; negative?: boolean }[] = [
      { label: "الراتب الأساسي", value: selected.basic_salary, color: "text-gray-800" },
      { label: "البدلات والإضافي", value: selected.allowances, color: "text-green-600" },
    ];
    if (selected.social_insurance_deduction) lines.push({ label: "حصتك في التأمينات الاجتماعية", value: selected.social_insurance_deduction, color: "text-orange-600", negative: true });
    if (selected.expense_reduction) lines.push({ label: "غياب وإجازات بدون راتب وبدلات مخصومة", value: selected.expense_reduction, color: "text-red-600", negative: true });
    if (selected.penalty_deduction) lines.push({ label: "جزاءات", value: selected.penalty_deduction, color: "text-red-600", negative: true });
    if (selected.advance_deduction) lines.push({ label: "قسط سلفة", value: selected.advance_deduction, color: "text-red-600", negative: true });
    if (other >= 0.01) lines.push({ label: "استقطاعات أخرى", value: other, color: "text-red-600", negative: true });
    lines.push({ label: "إجمالي الاستقطاعات", value: selected.deductions, color: "text-red-700", negative: true });
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 p-4 bg-white border-b sticky top-0 z-10">
          <button onClick={() => setSelected(null)} className="text-[#004e89]"><ChevronLeft className="h-6 w-6 rotate-180" /></button>
          <h2 className="font-bold text-lg text-gray-900">{t("قسيمة الراتب")} — {selected.month}</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-4 pb-24 bg-gray-50">
          <div className="bg-[#004e89] text-white rounded-xl p-5 mb-4 text-center">
            <p className="text-blue-200 text-sm mb-1">{t("صافي الراتب")}</p>
            <p className="text-4xl font-bold">{formatNumber(selected.net_salary, { minimumFractionDigits: 2 })} <span className="text-xl">{t("ر.س")}</span></p>
            <p className="text-blue-200 text-sm mt-1">{selected.month}</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm p-5 space-y-3">
            {lines.map(({ label, value, color, negative }) => (
              <div key={label} className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
                <span className="text-gray-600 text-sm">{t(label)}</span>
                <span className={`font-semibold ${color}`}>{negative ? "-" : "+"}{formatNumber(value, { minimumFractionDigits: 2 })} {t("ر.س")}</span>
              </div>
            ))}
            <div className="flex items-center justify-between py-3">
              <span className="text-gray-800 text-sm font-bold">{t("صافي الراتب")}</span>
              <span className="font-bold text-[#004e89]">{formatNumber(selected.net_salary, { minimumFractionDigits: 2 })} {t("ر.س")}</span>
            </div>
          </div>
          {selected.notes && (
            <div className="bg-white rounded-xl shadow-sm p-5 mt-4 text-sm text-gray-600 leading-7">
              <p className="mb-1 font-semibold text-gray-800">{t("تفاصيل الحساب")}</p>
              {selected.notes}
            </div>
          )}
          <div className="bg-white rounded-xl shadow-sm p-5 mt-4">
            <div className="flex justify-between items-center">
              <span className="text-gray-500 text-sm">{t("الحالة")}</span>
              <span className={`px-3 py-1 rounded-full text-xs font-medium ${selected.status === "مدفوع" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>{t(statusLabel(selected))}</span>
            </div>
            {selected.paid_date && <div className="flex justify-between items-center mt-2"><span className="text-gray-500 text-sm">{t("تاريخ الدفع")}</span><span className="text-gray-800 text-sm font-medium">{formatDate(selected.paid_date, { dateStyle: "medium" })}</span></div>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 p-4 bg-white border-b sticky top-0 z-10">
        <button onClick={onBack} className="text-[#004e89]"><ChevronLeft className="h-6 w-6 rotate-180" /></button>
        <h2 className="font-bold text-lg text-gray-900">{t("حساب الراتب")}</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4 pb-24 bg-gray-50">
        {loading ? (
          <div className="text-center py-12 text-gray-400">{t("جاري التحميل...")}</div>
        ) : error ? (
          <div className="text-center py-12 text-red-500">{error}</div>
        ) : records.length === 0 ? (
          <div className="text-center py-12 text-gray-400">{t("لا توجد كشوف رواتب معتمدة بعد")}</div>
        ) : (
          records.map((rec) => (
            <button key={rec.id} onClick={() => setSelected(rec)} className="w-full bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-3 flex items-center gap-4 hover:shadow-md transition text-start">
              <div className="w-12 h-12 rounded-full bg-[#004e89]/10 flex items-center justify-center flex-shrink-0">
                <DollarSign className="h-6 w-6 text-[#004e89]" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-gray-900">{rec.month}</p>
                <p className="text-sm text-gray-500">{t("صافي")} : {formatNumber(rec.net_salary, { minimumFractionDigits: 2 })} {t("ر.س")}</p>
              </div>
              <div className="text-start">
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${rec.status === "مدفوع" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>{t(statusLabel(rec))}</span>
              </div>
              <ChevronLeft className="h-5 w-5 text-gray-400" />
            </button>
          ))
        )}
      </div>
    </div>
  );
}
