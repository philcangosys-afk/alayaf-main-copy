import Layout from "@/components/Layout";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Users,
  Building2,
  UserCheck,
  AlertCircle,
  BarChart2,
  TrendingUp,
  Plus,
  Eye,
  Calendar,
  Clock,
  FileText,
  ArrowLeft,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/i18n";
import { riyadhToday, addDays, isWeekend } from "@/lib/hrDates";
import { isSaudiNationality, ACTIVE_EMPLOYEE_STATUSES, PENDING_STATUSES, isApprovedStatus, isInactiveEmployeeStatus } from "@/lib/hrStatus";
import { fetchAllRows } from "@/lib/fetchAll";

type EmpRow = { id: string; empId: string; nationality: string; totalSalary: number; status: string; branch: string; directorate: string; department: string; name: string; attendanceExempt: boolean };
type AttendanceAlert = { notRegisteredToday: number; absentToday: number; lateToday: number; leavesUnknown: boolean };
type LeaveAlert = { pendingLeaves: number };
type DocumentAlert = { name: string; type: string; date: string; expired: boolean };
type HolidayScope = { branch: string; department: string; section: string; team: string };

const isActiveStatus = (status: string) => ACTIVE_EMPLOYEE_STATUSES.includes(status.trim());
// الموظف في إجازة ما زال على رأس العمل: يدخل في إجمالي الرواتب وعدد السعوديين
const isEmployedStatus = (status: string) => isActiveStatus(status) || status.trim() === "إجازة";
const EMPLOYEE_SELECT = "id, emp_id, name, nationality, total_salary, base_salary, status, branch, directorate, department, id_expiry_date, passport_expiry_date, contract_end_date";
const errorText = (error: unknown) => (error as { message?: string } | null)?.message || "حدث خطأ غير متوقع";

// عطلة رسمية تشمل الموظف: كل حقل نطاق محدد يجب أن يطابق (الفرع، الإدارة = directorate، القسم = department).
// فريق العمل لا يُخزَّن في ملف الموظف، فالعطلة المحددة بفريق لا تُطبَّق هنا.
const holidayCovers = (holiday: HolidayScope, employee: EmpRow) => {
  if (holiday.team) return false;
  if (holiday.branch && holiday.branch !== employee.branch.trim()) return false;
  if (holiday.department && holiday.department !== employee.directorate.trim()) return false;
  if (holiday.section && holiday.section !== employee.department.trim()) return false;
  return true;
};
const DOCUMENT_FIELDS: Array<{ key: string; label: string }> = [
  { key: "id_expiry_date", label: "انتهاء الهوية / الإقامة" },
  { key: "passport_expiry_date", label: "انتهاء جواز السفر" },
  { key: "contract_end_date", label: "انتهاء العقد" },
];

const statusBarColor = (status: string) => {
  if (isActiveStatus(status)) return "bg-green-500";
  if (status === "إجازة") return "bg-blue-500";
  if (status === "غير نشط" || status === "غير فعال") return "bg-gray-400";
  if (status === "منتهي") return "bg-slate-500";
  return "bg-amber-500";
};

export default function HRDashboard() {
  const navigate = useNavigate();
  const { t, direction, formatNumber } = useI18n();
  const [empData, setEmpData] = useState<EmpRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0, active: 0, saudi: 0, totalSalary: 0 });
  const [attendanceAlert, setAttendanceAlert] = useState<AttendanceAlert>({ notRegisteredToday: 0, absentToday: 0, lateToday: 0, leavesUnknown: false });
  const [leaveAlert, setLeaveAlert] = useState<LeaveAlert>({ pendingLeaves: 0 });
  const [documentAlerts, setDocumentAlerts] = useState<DocumentAlert[]>([]);
  const [documentAlertsTotal, setDocumentAlertsTotal] = useState(0);
  const [documentAlertsExpired, setDocumentAlertsExpired] = useState(0);
  const [recentAttendance, setRecentAttendance] = useState<{ emp_name: string; check_in: string; status: string }[]>([]);
  // فشل تحميل الموظفين أو الحضور: لا نعرض "لا توجد تنبيهات" ولا أصفارًا مضللة
  const [loadError, setLoadError] = useState("");
  const [employeesFailed, setEmployeesFailed] = useState(false);

  useEffect(() => {
    const load = async () => {
      const errors: string[] = [];
      try {
        const today = riyadhToday();

        // Load employees (كل الصفوف، مع عمود الإعفاء من الحضور إن وُجد)
        let rawEmployees: any[] = [];
        let employeesLoaded = false;
        try {
          try {
            rawEmployees = await fetchAllRows<any>((from, to) =>
              supabase.from("employees").select(`${EMPLOYEE_SELECT}, attendance_exempt`).order("id").range(from, to));
          } catch (exemptError: any) {
            // قاعدة بيانات بلا عمود attendance_exempt: نعيد الجلب بدونه
            if (exemptError?.code !== "42703") throw exemptError;
            rawEmployees = await fetchAllRows<any>((from, to) =>
              supabase.from("employees").select(EMPLOYEE_SELECT).order("id").range(from, to));
          }
          employeesLoaded = true;
        } catch (empError) {
          console.error("Employees fetch error:", empError);
          errors.push(`${t("الموظفون")}: ${t(errorText(empError))}`);
          setEmployeesFailed(true);
        }
        const mapped: EmpRow[] = rawEmployees.map((r: any) => {
          const total = Number(r.total_salary ?? 0);
          return {
            id: String(r.id ?? ""),
            empId: String(r.emp_id ?? "").trim(),
            name: String(r.name ?? ""),
            nationality: String(r.nationality ?? ""),
            totalSalary: total > 0 ? total : Number(r.base_salary ?? 0),
            status: String(r.status ?? "نشط"),
            branch: String(r.branch ?? ""),
            directorate: String(r.directorate ?? ""),
            department: String(r.department ?? ""),
            attendanceExempt: r.attendance_exempt === true,
          };
        });
        const activeEmployees = mapped.filter((e) => isActiveStatus(e.status));
        const employedEmployees = mapped.filter((e) => isEmployedStatus(e.status));

        setEmpData(mapped);
        setStats({
          total: mapped.length,
          active: activeEmployees.length,
          saudi: employedEmployees.filter((e) => isSaudiNationality(e.nationality)).length,
          totalSalary: employedEmployees.reduce((s, e) => s + e.totalSalary, 0),
        });

        // تنبيهات الوثائق والعقود: منتهية أو تنتهي خلال 30 يومًا
        // القادمة أولًا بالأقرب تاريخًا، ثم المنتهية (الأحدث انتهاءً أولًا)
        const alertLimit = addDays(today, 30);
        const docs: DocumentAlert[] = [];
        rawEmployees
          .filter((r: any) => !isInactiveEmployeeStatus(r.status))
          .forEach((r: any) => {
            DOCUMENT_FIELDS.forEach(({ key, label }) => {
              const date = String(r[key] ?? "").slice(0, 10);
              if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date <= alertLimit) {
                docs.push({ name: String(r.name ?? ""), type: label, date, expired: date < today });
              }
            });
          });
        docs.sort((a, b) => {
          if (a.expired !== b.expired) return a.expired ? 1 : -1;
          return a.expired ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date);
        });
        setDocumentAlertsTotal(docs.length);
        setDocumentAlertsExpired(docs.filter((doc) => doc.expired).length);
        setDocumentAlerts(docs.slice(0, 10));

        // الإجازات المعتمدة التي تشمل اليوم (الإجازة بلا تاريخ نهاية = يوم واحد)
        const onLeave = new Set<string>();
        let leavesUnknown = false;
        if (employeesLoaded) {
          const { data: leaveRows, error: leavesError } = await supabase
            .from("leave_requests")
            .select("employee_id, emp_id, start_date, end_date, status")
            .lte("start_date", today)
            .or(`end_date.gte.${today},end_date.is.null`);
          if (leavesError) {
            console.error("Approved leaves fetch error:", leavesError);
            leavesUnknown = true;
          } else {
            const codeCount = new Map<string, number>();
            mapped.forEach((e) => { if (e.empId) codeCount.set(e.empId, (codeCount.get(e.empId) ?? 0) + 1); });
            const idByCode = new Map(mapped.filter((e) => e.empId && codeCount.get(e.empId) === 1).map((e) => [e.empId, e.id]));
            (leaveRows ?? []).forEach((l: any) => {
              if (!isApprovedStatus(l.status)) return;
              const start = String(l.start_date ?? "").slice(0, 10);
              const end = String(l.end_date ?? "").slice(0, 10) || start;
              if (!start || start > today || end < today) return;
              const employeeId = String(l.employee_id ?? "").trim();
              // الربط بمعرّف الموظف أولًا، وبالرقم الوظيفي فقط إن كان غير مكرر
              const matched = employeeId || idByCode.get(String(l.emp_id ?? "").trim());
              if (matched) onLeave.add(matched);
            });
          }
        }

        // العطل الرسمية التي تشمل اليوم (يُتجاهل الفشل: التنبيه معلوماتي)
        let holidays: HolidayScope[] = [];
        const { data: holidayRows, error: holidaysError } = await supabase
          .from("official_holidays")
          .select("start_date, end_date, branch, department, section, team")
          .lte("start_date", today)
          .or(`end_date.gte.${today},end_date.is.null`);
        if (holidaysError) {
          console.error("Official holidays fetch error:", holidaysError);
        } else {
          holidays = (holidayRows ?? [])
            .filter((h: any) => {
              const start = String(h.start_date ?? "").slice(0, 10);
              const end = String(h.end_date ?? "").slice(0, 10) || start;
              return start && start <= today && end >= today;
            })
            .map((h: any) => ({
              branch: String(h.branch ?? "").trim(),
              department: String(h.department ?? "").trim(),
              section: String(h.section ?? "").trim(),
              team: String(h.team ?? "").trim(),
            }));
        }

        // Load today's attendance (بتوقيت الرياض)
        try {
          const attData = await fetchAllRows<any>((from, to) =>
            supabase
              .from("attendance")
              .select("id, emp_id, emp_name, check_in, status, late_minutes")
              .eq("date", today)
              .order("check_in", { ascending: false, nullsFirst: false })
              .order("id", { ascending: false })
              .range(from, to));
          const registered = new Set(attData.map((a: any) => String(a.emp_id ?? "").trim()));
          // لا يُحتسب: المعفى من الحضور، ومن في إجازة معتمدة اليوم، ومن تشمله عطلة رسمية، وكل الموظفين في الجمعة والسبت
          const notRegisteredToday = employeesLoaded && !isWeekend(today)
            ? activeEmployees.filter((e) =>
                !e.attendanceExempt && e.empId && !registered.has(e.empId) && !onLeave.has(e.id)
                && !holidays.some((holiday) => holidayCovers(holiday, e))).length
            : 0;
          const absentToday = attData.filter((a: any) => String(a.status ?? "").includes("غائب")).length;
          const lateToday = attData.filter((a: any) => (a.late_minutes ?? 0) > 0).length;
          setAttendanceAlert({ notRegisteredToday, absentToday, lateToday, leavesUnknown });
          setRecentAttendance(attData.slice(0, 5).map((a: any) => ({
            emp_name: String(a.emp_name ?? ""),
            check_in: String(a.check_in ?? "-"),
            status: String(a.status ?? ""),
          })));
        } catch (attError) {
          console.error("Attendance fetch error:", attError);
          errors.push(`${t("الحضور")}: ${t(errorText(attError))}`);
        }

        // Load pending leave requests (عدّ فقط بلا جلب الصفوف)
        const { count: pendingCount, error: leaveError } = await supabase
          .from("leave_requests")
          .select("id", { count: "exact", head: true })
          // نفس عدّ لوحة التحكم الرئيسية: الحالة الفارغة معلقة أيضًا
          .or(`status.is.null,status.eq."",status.in.(${PENDING_STATUSES.map((value) => `"${value}"`).join(",")})`);

        if (leaveError) {
          console.error("Pending leaves count error:", leaveError);
        } else {
          setLeaveAlert({ pendingLeaves: pendingCount ?? 0 });
        }

      } catch (err) {
        console.error("Error loading HR dashboard:", err);
        errors.push(t(errorText(err)));
      } finally {
        setLoadError(errors.join(" — "));
        setLoading(false);
      }
    };
    load();
  }, []);

  const kpiValue = (value: string | number) => (employeesFailed ? "—" : value);
  const kpiCards = [
    { label: "الموظفون الكليون", value: kpiValue(stats.total), icon: Users, color: "text-amber-600", bgColor: "bg-amber-50", onClick: () => navigate("/hr/employees") },
    { label: "الموظفون النشطون", value: kpiValue(stats.active), icon: UserCheck, color: "text-green-600", bgColor: "bg-green-50", onClick: () => navigate("/hr/employees") },
    { label: "الموظفون السعوديون", value: kpiValue(stats.saudi), icon: Building2, color: "text-blue-600", bgColor: "bg-blue-50" },
    { label: "إجمالي الرواتب", value: kpiValue(stats.totalSalary > 0 ? `${formatNumber(stats.totalSalary)} ${t("ر.س")}` : "0"), icon: TrendingUp, color: "text-purple-600", bgColor: "bg-purple-50", onClick: () => navigate("/hr/payroll") },
  ];

  const statusDistribution = empData.reduce((acc, emp) => {
    acc[emp.status] = (acc[emp.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const hasAlerts = attendanceAlert.notRegisteredToday > 0 || attendanceAlert.absentToday > 0 || attendanceAlert.lateToday > 0 || leaveAlert.pendingLeaves > 0 || documentAlerts.length > 0;

  return (
    <Layout>
      <div className="space-y-6" dir={direction}>
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-foreground">{t("لوحة التحكم - الموارد البشرية")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("نظرة عامة على أداء وإحصائيات الموارد البشرية")}</p>
        </div>

        <button
          onClick={() => navigate("/hr/reports/full-employee")}
          className="group relative w-full overflow-hidden rounded-2xl bg-gradient-to-l from-emerald-700 via-teal-700 to-sky-700 p-5 text-right text-white shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl"
        >
          <div className="absolute -left-8 -top-10 h-36 w-36 rounded-full bg-white/10" />
          <div className="relative flex flex-wrap items-center gap-4">
            <div className="rounded-2xl bg-white/15 p-4 ring-1 ring-white/20">
              <FileText className="h-7 w-7" />
            </div>
            <div>
              <div className="mb-1 flex items-center gap-2">
                <span className="rounded-full bg-amber-300 px-2.5 py-0.5 text-[10px] font-bold text-amber-950">{t("تقرير متكامل")}</span>
              </div>
              <h2 className="text-xl font-bold">{t("تقرير الموظف الكامل")}</h2>
              <p className="mt-1 text-sm text-emerald-50">{t("الحضور والانصراف والراتب والخصومات وصافي المستحق في تقرير A4 احترافي")}</p>
            </div>
            <div className="mr-auto flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-teal-800 shadow-sm transition-transform group-hover:-translate-x-1">
              {t("إنشاء تقرير")}
              <ArrowLeft className="h-4 w-4" />
            </div>
          </div>
        </button>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {kpiCards.map((card) => {
            const Icon = card.icon;
            return (
              <button key={card.label} onClick={card.onClick} className={`text-right rounded-xl ${card.bgColor} p-4 transition-all hover:shadow-md border border-transparent hover:border-border`}>
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <p className={`text-xs font-medium ${card.color}`}>{t(card.label)}</p>
                    <p className="text-2xl font-bold text-foreground">{loading ? "..." : card.value}</p>
                  </div>
                  <div className={`rounded-lg ${card.bgColor} p-2.5`}>
                    <Icon className={`h-5 w-5 ${card.color}`} />
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Charts & Info */}
          <div className="lg:col-span-2 space-y-6">
            {/* Status Distribution */}
            <div className="rounded-xl border border-border bg-card p-5">
              <h2 className="text-lg font-semibold text-foreground mb-4">{t("توزيع حالات الموظفين")}</h2>
              {loading ? (
                <p className="text-sm text-muted-foreground text-center py-4">{t("جاري التحميل...")}</p>
              ) : employeesFailed ? (
                <p className="text-sm text-red-600 text-center py-4">{t("تعذر تحميل بيانات الموظفين")}</p>
              ) : Object.keys(statusDistribution).length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">{t("لا يوجد موظفون بعد")}</p>
              ) : (
                <div className="space-y-3">
                  {Object.entries(statusDistribution).map(([status, count]) => (
                    <div key={status}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm font-medium text-muted-foreground">{t(status)}</span>
                        <span className="text-sm font-bold text-foreground">{count}</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted/40 overflow-hidden">
                        <div
                          className={`h-full ${statusBarColor(status)}`}
                          style={{ width: `${stats.total > 0 ? (count / stats.total) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Today's Attendance */}
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-emerald-600" />
                  <h2 className="text-lg font-semibold text-foreground">{t("حضور اليوم")}</h2>
                </div>
                <button onClick={() => navigate("/hr/attendance")} className="text-sm text-primary font-medium hover:underline">{t("عرض الكل")}</button>
              </div>
              {loading ? (
                <p className="text-sm text-muted-foreground text-center py-4">{t("جاري التحميل...")}</p>
              ) : recentAttendance.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">{t("لا توجد سجلات حضور لليوم")}</p>
              ) : (
                <div className="space-y-2">
                  {recentAttendance.map((att, i) => (
                    <div key={i} className="flex items-center justify-between p-2.5 rounded-lg bg-muted/30">
                      <span className="text-sm font-medium">{att.emp_name}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-muted-foreground">{att.check_in}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${att.status === "حاضر" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                          {t(att.status)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Alerts */}
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2 mb-3">
                <AlertCircle className="h-5 w-5 text-amber-600" />
                <h3 className="font-semibold text-foreground">{t("تنبيهات مهمة")}</h3>
              </div>
              {loading ? (
                <p className="text-sm text-muted-foreground">{t("جاري التحميل...")}</p>
              ) : !hasAlerts && !loadError ? (
                <p className="text-sm text-muted-foreground">{t("لا توجد تنبيهات حالياً")}</p>
              ) : (
                <div className="space-y-2">
                  {loadError && (
                    <div className="flex gap-3 rounded-lg border border-red-300 bg-red-50 p-3 text-red-700">
                      <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      <p className="text-sm font-semibold">{`${t("تعذر تحميل بيانات التنبيهات")}: ${loadError}`}</p>
                    </div>
                  )}
                  {documentAlerts.length > 0 && (
                    <div className="rounded-lg border border-red-200 bg-red-50/60 p-3 text-red-700">
                      <div className="flex gap-3">
                        <FileText className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-sm font-bold">{t("وثائق وعقود منتهية أو تنتهي خلال 30 يومًا")}</p>
                          {documentAlertsTotal > documentAlerts.length && (
                            <p className="text-xs opacity-75">
                              {`${t("يُعرض")} ${formatNumber(documentAlerts.length)} ${t("من")} ${formatNumber(documentAlertsTotal)}`}
                              {documentAlertsExpired > 0 ? ` — ${t("منها")} ${formatNumber(documentAlertsExpired)} ${t("منتهية")}` : ""}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="mt-2 space-y-1">
                        {documentAlerts.map((doc, i) => (
                          <div key={`${doc.name}-${doc.type}-${i}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white/70 px-2.5 py-1.5 text-xs">
                            <span className="font-semibold text-foreground">{doc.name || "-"}</span>
                            <span className="text-muted-foreground">{t(doc.type)}</span>
                            <span className={`font-semibold ${doc.expired ? "text-red-700" : "text-amber-700"}`}>
                              {doc.date} {doc.expired ? `(${t("منتهي")})` : ""}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {attendanceAlert.notRegisteredToday > 0 && (
                    <div className="flex gap-3 rounded-lg border border-orange-200 bg-orange-50/60 p-3 text-orange-700">
                      <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-bold">{t("لم يسجلوا حضورًا حتى الآن")}</p>
                        <p className="text-xs opacity-75">
                          {`${formatNumber(attendanceAlert.notRegisteredToday)} ${t("موظف نشط بلا سجل حضور اليوم")}`}
                          {attendanceAlert.leavesUnknown ? ` — ${t("تعذر استبعاد الإجازات المعتمدة")}` : ""}
                        </p>
                      </div>
                    </div>
                  )}
                  {attendanceAlert.absentToday > 0 && (
                    <div className="flex gap-3 rounded-lg border border-red-200 bg-red-50/60 p-3 text-red-700">
                      <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-bold">{t("غياب اليوم")}</p>
                        <p className="text-xs opacity-75">{`${formatNumber(attendanceAlert.absentToday)} ${t("موظف غائب اليوم")}`}</p>
                      </div>
                    </div>
                  )}
                  {attendanceAlert.lateToday > 0 && (
                    <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-amber-700">
                      <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-bold">{t("تأخير اليوم")}</p>
                        <p className="text-xs opacity-75">{`${formatNumber(attendanceAlert.lateToday)} ${t("موظف متأخر اليوم")}`}</p>
                      </div>
                    </div>
                  )}
                  {leaveAlert.pendingLeaves > 0 && (
                    <div className="flex gap-3 rounded-lg border border-blue-200 bg-blue-50/60 p-3 text-blue-700">
                      <Calendar className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-bold">{t("طلبات إجازة معلقة")}</p>
                        <p className="text-xs opacity-75">{`${formatNumber(leaveAlert.pendingLeaves)} ${t("طلب بانتظار الموافقة")}`}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right: Quick Actions */}
          <div className="space-y-5">
            <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
              <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-4 text-white">
                <h3 className="font-semibold text-right">{t("إجراءات سريعة")}</h3>
              </div>
              <div className="p-4 space-y-2">
                <button onClick={() => navigate("/hr/employees/new")} className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg hover:bg-muted/50 text-foreground text-right transition-colors">
                  <Plus className="h-4 w-4" /><span className="text-sm font-medium">{t("إضافة موظف جديد")}</span>
                </button>
                <button onClick={() => navigate("/hr/employees")} className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg hover:bg-muted/50 text-foreground text-right transition-colors">
                  <Eye className="h-4 w-4" /><span className="text-sm font-medium">{t("عرض جميع الموظفين")}</span>
                </button>
                <button onClick={() => navigate("/hr/payroll")} className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg hover:bg-muted/50 text-foreground text-right transition-colors">
                  <TrendingUp className="h-4 w-4" /><span className="text-sm font-medium">{t("فتح مسير الرواتب")}</span>
                </button>
                <button onClick={() => navigate("/hr/attendance")} className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg hover:bg-muted/50 text-foreground text-right transition-colors">
                  <Clock className="h-4 w-4" /><span className="text-sm font-medium">{t("سجل الحضور والانصراف")}</span>
                </button>
                <button onClick={() => navigate("/hr/reports/full-employee")} className="w-full flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-right text-emerald-800 transition-colors hover:bg-emerald-100">
                  <FileText className="h-4 w-4" /><span className="text-sm font-bold">{t("تقرير الموظف الكامل")}</span>
                </button>
              </div>
            </div>

            {/* Module Cards */}
            {[
              { title: "الموظفون", icon: Users, color: "bg-blue-600", onClick: () => navigate("/hr/employees") },
              { title: "الحضور والانصراف", icon: UserCheck, color: "bg-emerald-600", onClick: () => navigate("/hr/attendance") },
              { title: "مسير الرواتب", icon: TrendingUp, color: "bg-purple-600", onClick: () => navigate("/hr/payroll") },
              { title: "التقارير", icon: BarChart2, color: "bg-rose-600", onClick: () => navigate("/hr/reports") },
            ].map((mod) => {
              const Icon = mod.icon;
              return (
                <button key={mod.title} onClick={mod.onClick} className={`w-full rounded-xl ${mod.color} p-4 text-white hover:shadow-lg transition-all text-right`}>
                  <div className="flex items-start justify-between">
                    <h4 className="font-semibold">{t(mod.title)}</h4>
                    <Icon className="h-5 w-5" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Layout>
  );
}
