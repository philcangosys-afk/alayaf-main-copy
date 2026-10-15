import { useEffect, useState } from "react";
import { ChevronLeft, ClipboardList, Users, CalendarDays, BarChart3, Megaphone, BadgeDollarSign } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/i18n";
import { riyadhMonth } from "@/lib/hrDates";

type Mode = "performance" | "team" | "attendance" | "my-reports" | "reports" | "circulars" | "commissions" | "announcements";
type Props = {
  mode: Mode;
  empId: string;
  employeeName: string;
  isManager: boolean;
  onBack: () => void;
};

type Card = { id: string; title: string; subtitle?: string; meta?: string; status?: string };

const PAGE_META: Record<Mode, { title: string; empty: string }> = {
  performance: { title: "تقييم الأداء", empty: "لا توجد بيانات أداء مسجلة" },
  team: { title: "فريق العمل", empty: "لا يوجد أعضاء في فريق العمل" },
  attendance: { title: "الحضور", empty: "لا توجد سجلات حضور" },
  "my-reports": { title: "تقاريري", empty: "لا توجد تقارير شخصية" },
  reports: { title: "التقارير", empty: "لا توجد بيانات تقارير" },
  circulars: { title: "التعاميم", empty: "لا توجد تعاميم منشورة" },
  commissions: { title: "عمولات الموظفين", empty: "لا توجد سجلات عمولات" },
  announcements: { title: "الإعلانات", empty: "لا توجد إعلانات منشورة" },
};

const modeIcon = (mode: Mode) => {
  if (mode === "team") return Users;
  if (mode === "attendance") return CalendarDays;
  if (mode === "performance" || mode === "reports" || mode === "my-reports") return BarChart3;
  if (mode === "circulars" || mode === "announcements") return Megaphone;
  if (mode === "commissions") return BadgeDollarSign;
  return ClipboardList;
};

export default function PortalDataPage({ mode, empId, employeeName, isManager, onBack }: Props) {
  const { t, direction, formatDate } = useI18n();
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        let next: Card[] = [];

        if (mode === "team") {
          const { data: current } = await supabase.from("employees").select("department").eq("emp_id", empId).maybeSingle();
          let query = supabase.from("employees").select("id, emp_id, name, job_title, department, branch, status").in("status", ["نشط", "فعال"]);
          if (!isManager && current?.department) query = query.eq("department", current.department);
          const { data, error: queryError } = await query.order("name");
          if (queryError) throw queryError;
          next = (data ?? []).map((row: any) => ({
            id: String(row.id),
            title: String(row.name ?? "موظف"),
            subtitle: String(row.job_title ?? row.department ?? "—"),
            meta: [row.department, row.branch].filter(Boolean).join(" • "),
            status: String(row.status ?? "فعال"),
          }));
        } else if (mode === "attendance") {
          let query = supabase.from("attendance").select("id, emp_id, emp_name, date, check_in, check_out, status, late_minutes");
          if (!isManager) query = query.eq("emp_id", empId);
          const { data, error: queryError } = await query.order("date", { ascending: false }).limit(isManager ? 100 : 60);
          if (queryError) throw queryError;
          next = (data ?? []).map((row: any) => ({
            id: String(row.id),
            title: isManager ? `${row.emp_name || row.emp_id} — ${row.date}` : String(row.date),
            subtitle: `الحضور: ${row.check_in || "—"} • الانصراف: ${row.check_out || "—"}`,
            meta: Number(row.late_minutes || 0) > 0 ? `تأخير ${row.late_minutes} دقيقة` : "دون تأخير",
            status: String(row.status ?? "—"),
          }));
        } else if (mode === "performance") {
          // بداية الشهر بتوقيت الرياض (toISOString بتوقيت غرينتش يعطي الشهر السابق في أول ساعات الشهر)
          const monthStart = `${riyadhMonth()}-01`;
          let query = supabase.from("attendance").select("emp_id, emp_name, status, late_minutes").gte("date", monthStart);
          if (!isManager) query = query.eq("emp_id", empId);
          const { data, error: queryError } = await query;
          if (queryError) throw queryError;
          const grouped = new Map<string, { name: string; present: number; absent: number; late: number }>();
          (data ?? []).forEach((row: any) => {
            const key = String(row.emp_id || empId);
            const item = grouped.get(key) ?? { name: String(row.emp_name || employeeName), present: 0, absent: 0, late: 0 };
            if (row.status === "حاضر") item.present += 1;
            if (row.status === "غائب") item.absent += 1;
            if (Number(row.late_minutes || 0) > 0) item.late += 1;
            grouped.set(key, item);
          });
          next = Array.from(grouped.entries()).map(([id, item]) => {
            const total = item.present + item.absent;
            const score = total ? Math.max(0, Math.round(((item.present - item.late * 0.25) / total) * 100)) : 0;
            return { id, title: item.name, subtitle: `حضور ${item.present} • غياب ${item.absent} • تأخير ${item.late}`, meta: `مؤشر الالتزام: ${score}%`, status: score >= 90 ? "ممتاز" : score >= 75 ? "جيد" : "يحتاج متابعة" };
          });
        } else if (mode === "my-reports" || mode === "reports") {
          const managerView = mode === "reports" && isManager;
          let attendanceQuery = supabase.from("attendance").select("id, status, late_minutes");
          let leaveQuery = supabase.from("leave_requests").select("id, status");
          let requestQuery = supabase.from("hr_requests").select("id, status");
          if (!managerView) {
            attendanceQuery = attendanceQuery.eq("emp_id", empId);
            leaveQuery = leaveQuery.eq("emp_id", empId);
            requestQuery = requestQuery.eq("emp_id", empId);
          }
          const [attendance, leaves, requests] = await Promise.all([attendanceQuery, leaveQuery, requestQuery]);
          if (attendance.error) throw attendance.error;
          if (leaves.error) throw leaves.error;
          if (requests.error) throw requests.error;
          const attendanceRows = attendance.data ?? [];
          const leaveRows = leaves.data ?? [];
          const requestRows = requests.data ?? [];
          next = [
            { id: "attendance", title: "الحضور", subtitle: `${attendanceRows.filter((row: any) => row.status === "حاضر").length} يوم حضور`, meta: `${attendanceRows.filter((row: any) => Number(row.late_minutes || 0) > 0).length} حالة تأخير` },
            { id: "leaves", title: "الإجازات", subtitle: `${leaveRows.length} طلب`, meta: `${leaveRows.filter((row: any) => ["موافق", "معتمدة", "approved"].includes(row.status)).length} طلب معتمد` },
            { id: "requests", title: "طلبات الموارد البشرية", subtitle: `${requestRows.length} طلب`, meta: `${requestRows.filter((row: any) => ["معلق", "معلقة", "pending"].includes(row.status)).length} قيد المراجعة` },
          ];
        } else if (mode === "commissions") {
          let query = supabase.from("hr_requests").select("id, emp_id, emp_name, request_type, status, details, created_at").eq("request_type", "صرف عمولة");
          if (!isManager) query = query.eq("emp_id", empId);
          const { data, error: queryError } = await query.order("created_at", { ascending: false });
          if (queryError) throw queryError;
          next = (data ?? []).map((row: any) => ({
            id: String(row.id),
            title: isManager ? String(row.emp_name || row.emp_id) : "طلب صرف عمولة",
            subtitle: formatDate(row.created_at, { dateStyle: "medium" }),
            meta: row.details?.amount ? `القيمة: ${row.details.amount}` : "تفاصيل العمولة محفوظة في الطلب",
            status: String(row.status ?? "معلق"),
          }));
        } else {
          const announcementType = mode === "circulars" ? "تعميم" : "إعلان";
          const { data, error: queryError } = await supabase
            .from("hr_announcements")
            .select("id, type, title, content, created_by, status, created_at")
            .eq("type", announcementType)
            .eq("status", "منشور")
            .order("created_at", { ascending: false });
          if (queryError) throw queryError;
          next = (data ?? []).map((row: any) => ({
            id: String(row.id),
            title: String(row.title),
            subtitle: String(row.content || ""),
            meta: `${formatDate(row.created_at, { dateStyle: "medium" })} • ${row.created_by || ""}`,
            status: String(row.status),
          }));
        }

        if (!cancelled) setCards(next);
      } catch (loadError: any) {
        if (!cancelled) {
          setCards([]);
          setError(loadError?.message || t("تعذر تحميل البيانات"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [mode, empId, employeeName, isManager]);

  const Icon = modeIcon(mode);
  const meta = PAGE_META[mode];

  return (
    <div className="flex flex-col h-full bg-gray-50" dir={direction}>
      <div className="flex items-center gap-3 p-4 bg-white border-b sticky top-0 z-10">
        <button onClick={onBack} className="text-[#004e89]"><ChevronLeft className={`h-6 w-6 ${direction === "rtl" ? "rotate-180" : ""}`} /></button>
        <Icon className="h-5 w-5 text-[#004e89]" />
        <h2 className="font-bold text-lg text-gray-900">{t(meta.title)}</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4 pb-24">
        {loading ? (
          <div className="text-center py-12 text-gray-400">{t("جاري تحميل البيانات...")}</div>
        ) : error ? (
          <div className="bg-red-50 text-red-700 rounded-xl p-4 text-center text-sm">{t(error)}</div>
        ) : cards.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-10 text-center text-gray-400">{t(meta.empty)}</div>
        ) : cards.map((card) => (
          <div key={card.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-gray-900">{card.title}</p>
                {card.subtitle && <p className="text-sm text-gray-600 mt-1">{card.subtitle}</p>}
                {card.meta && <p className="text-xs text-gray-400 mt-2">{card.meta}</p>}
              </div>
              {card.status && <span className="bg-blue-50 text-[#004e89] px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap">{t(card.status)}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
