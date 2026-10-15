import { useEffect, useState } from "react";
import { ChevronLeft, Clock } from "lucide-react";
import { useI18n } from "@/i18n";
import { monthRange, riyadhMonth } from "@/lib/hrDates";
import { hrRequestErrorText } from "@/lib/hrErrors";
import { MY_ATTENDANCE_UNAVAILABLE, loadMyAttendance, type MyAttendanceDay, type MyAttendanceSummary } from "@/lib/myAttendance";
import type { DayCategory } from "@/lib/attendanceRules";

type Props = { empId: string; onBack: () => void };

const EMPTY_SUMMARY: MyAttendanceSummary = { present: 0, late: 0, absent: 0, leave: 0, unrecorded: 0, workedSeconds: 0, requiredSeconds: 0, deficitSeconds: 0, overtimeSeconds: 0 };

const CATEGORY_LABEL: Record<DayCategory, string> = {
  present: "حاضر",
  late: "متأخر",
  leave: "إجازة",
  absent: "غائب",
  weekend: "راحة",
  holiday: "عطلة رسمية",
  none: "لا يوجد تسجيل",
};

const categoryColor = (category: DayCategory) =>
  category === "present" ? "text-green-600 bg-green-50"
    : category === "absent" ? "text-red-600 bg-red-50"
    : category === "late" ? "text-orange-600 bg-orange-50"
    : category === "leave" ? "text-sky-700 bg-sky-50"
    : "text-gray-600 bg-gray-100";

// دوامي: أيام الشهر بالقاعدة نفسها في حساب الدوام وكشف الرواتب (جدول الدوام والعطل والإجازات المعتمدة)
export default function AttendanceReportPage({ onBack }: Props) {
  const { t, formatDate, formatNumber } = useI18n();
  const [days, setDays] = useState<MyAttendanceDay[]>([]);
  const [summary, setSummary] = useState<MyAttendanceSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [monthFilter, setMonthFilter] = useState(riyadhMonth);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      const { from, to } = monthRange(monthFilter);
      const { data, error: loadError } = await loadMyAttendance(from, to);
      if (cancelled) return;
      if (loadError || !data) {
        setDays([]);
        setSummary(EMPTY_SUMMARY);
        const unavailable = loadError instanceof Error && loadError.message === MY_ATTENDANCE_UNAVAILABLE;
        setError(unavailable ? t("تقرير الدوام غير متاح حاليًا؛ تواصل مع الموارد البشرية") : t(hrRequestErrorText(loadError, "تعذر تحميل سجلات الحضور")));
      } else {
        // الأيام التي لها سجل، والغياب المحتسب بلا تسجيل (يُخصم من الراتب)، الأحدث أولًا
        setDays(data.days.filter((day) => day.record || day.deductibleAbsence).reverse());
        setSummary(data.summary);
      }
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [monthFilter, t]);

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="flex items-center gap-3 p-4">
          <button onClick={onBack} className="text-[#004e89]"><ChevronLeft className="h-6 w-6 rotate-180" /></button>
          <h2 className="font-bold text-lg text-gray-900">{t("دوامي")}</h2>
        </div>
        <div className="px-4 pb-3">
          <input type="month" value={monthFilter} onChange={(e) => e.target.value && setMonthFilter(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#004e89]" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-24 bg-gray-50">
        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-3 p-4">
          <div className="bg-white rounded-xl shadow-sm p-3 text-center border border-gray-100">
            <p className="text-2xl font-bold text-green-600">{formatNumber(summary.present + summary.late)}</p>
            <p className="text-xs text-gray-500 mt-1">{t("يوم حضور")}</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm p-3 text-center border border-gray-100">
            <p className="text-2xl font-bold text-red-500">{formatNumber(summary.absent)}</p>
            <p className="text-xs text-gray-500 mt-1">{t("يوم غياب")}</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm p-3 text-center border border-gray-100">
            <p className="text-2xl font-bold text-orange-500">{formatNumber(summary.late)}</p>
            <p className="text-xs text-gray-500 mt-1">{t("تأخر")}</p>
          </div>
        </div>
        {!loading && !error && (summary.leave > 0 || summary.unrecorded > 0) && (
          <div className="px-4 pb-3 text-xs text-gray-500">
            {summary.leave > 0 && <span>{t("إجازة")}: {formatNumber(summary.leave)} </span>}
            {summary.unrecorded > 0 && <span>· {t("أيام عمل بلا تسجيل لا تُحتسب غيابًا")}: {formatNumber(summary.unrecorded)}</span>}
          </div>
        )}

        {/* Records */}
        <div className="px-4">
          {loading ? (
            <div className="text-center py-12 text-gray-400">{t("جاري التحميل...")}</div>
          ) : error ? (
            <div className="bg-red-50 text-red-700 rounded-xl p-4 text-center text-sm">{error}</div>
          ) : days.length === 0 ? (
            <div className="text-center py-12 text-gray-400">{t("لا توجد سجلات لهذا الشهر")}</div>
          ) : (
            days.map((day) => (
              <div key={day.date} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 mb-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-gray-800 text-sm">{formatDate(day.date, { dateStyle: "medium" })}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${categoryColor(day.category)}`}>
                    {day.record ? t(day.record.status || CATEGORY_LABEL[day.category]) : t("غائب (بلا تسجيل)")}
                  </span>
                </div>
                <div className="flex gap-6 text-sm">
                  <div className="flex items-center gap-1 text-gray-600">
                    <Clock className="h-4 w-4 text-green-500" />
                    <span>{day.record?.checkIn || "—"}</span>
                  </div>
                  <div className="flex items-center gap-1 text-gray-600">
                    <Clock className="h-4 w-4 text-red-400" />
                    <span>{day.record?.checkOut || "—"}</span>
                  </div>
                  {day.lateMinutes > 0 && (
                    <div className="text-orange-500 text-xs font-medium self-center">{t("تأخر")} {formatNumber(day.lateMinutes)} {t("د")}</div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
