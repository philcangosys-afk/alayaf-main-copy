import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { Search, FileText, Printer, Eye, Plus, X, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n";
import { hrRequestErrorText } from "@/lib/hrErrors";

const isPendingStatus = (status: string) => ["", "معلق", "معلقة", "pending"].includes(status.trim());

type LeaveRequest = {
  id: string;
  employeeId: string;
  empName: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  status: string;
  notes: string;
  createdAt: string;
};

const mapRow = (r: Record<string, unknown>): LeaveRequest => ({
  id: String(r.id ?? ""),
  employeeId: String(r.employee_id ?? ""),
  empName: String(r.emp_name ?? ""),
  leaveType: String(r.leave_type ?? ""),
  startDate: String(r.start_date ?? ""),
  endDate: String(r.end_date ?? ""),
  days: Number(r.days ?? 0),
  status: String(r.status ?? "معلقة"),
  notes: String(r.notes ?? ""),
  createdAt: String(r.created_at ?? ""),
});

const STATUS_COLORS: Record<string, string> = {
  "معلقة": "bg-yellow-100 text-yellow-700",
  "معلق": "bg-yellow-100 text-yellow-700",
  "معتمدة": "bg-emerald-100 text-emerald-700",
  "معتمد": "bg-emerald-100 text-emerald-700",
  "موافق": "bg-emerald-100 text-emerald-700",
  "مرفوضة": "bg-red-100 text-red-700",
  "مرفوض": "bg-red-100 text-red-700",
};

export default function HRLeavesEmployees() {
  const { t, direction } = useI18n();
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from("leave_requests")
          .select("*")
          .order("created_at", { ascending: false });
        if (!error && data) setLeaves(data.map(mapRow));
      } catch { /* no-op */ } finally { setLoading(false); }
    };
    load();
  }, [refreshKey]);

  // القرار للمستلم فقط (سياسة الخادم)؛ نتحقق من أن الصف تغيّر فعلًا
  const decide = async (leave: LeaveRequest, status: "معتمدة" | "مرفوضة") => {
    const { error } = await supabase.from("leave_requests").update({ status }).eq("id", leave.id).select("id").single();
    if (error) {
      toast({
        title: t("تعذر حفظ القرار"),
        description: error.code === "PGRST116" ? t("القرار لمستلم الطلب (المدير المباشر) فقط") : t(hrRequestErrorText(error)),
        variant: "destructive",
      });
      return;
    }
    setLeaves((prev) => prev.map((l) => l.id === leave.id ? { ...l, status } : l));
    toast({ title: t(status === "معتمدة" ? "تمت الموافقة على الطلب" : "تم رفض الطلب") });
  };
  const handleApprove = (leave: LeaveRequest) => decide(leave, "معتمدة");
  const handleReject = (leave: LeaveRequest) => decide(leave, "مرفوضة");

  if (showForm) {
    return <LeaveForm onBack={() => setShowForm(false)} onSaved={() => { setShowForm(false); setRefreshKey((k) => k + 1); }} />;
  }

  return (
    <Layout>
      <div className="p-6 max-w-[1600px] mx-auto space-y-6" dir={direction}>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="bg-[#004e89] text-white p-3 flex items-center justify-between gap-4">
            <h2 className="text-lg font-bold">{t("طلبات الإجازات")}</h2>
            <div className="flex items-center gap-3">
              <button onClick={() => setShowForm(true)} className="flex items-center gap-1 px-3 py-1.5 bg-white text-[#004e89] rounded-lg text-sm font-medium hover:bg-gray-100 transition">
                <Plus className="h-4 w-4" /> {t("طلب إجازة جديد")}
              </button>
              <button className="p-1.5 hover:bg-white/10 rounded transition-colors text-white" title={t("طباعة")} aria-label={t("طباعة")}>
                <Printer className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm text-center whitespace-nowrap">
              <thead className="bg-gray-50 text-gray-700 border-b border-gray-200">
                <tr>
                  <th className="py-3 px-3 font-medium">#</th>
                  <th className="py-3 px-3 font-medium">{t("الموظف")}</th>
                  <th className="py-3 px-3 font-medium">{t("نوع الإجازة")}</th>
                  <th className="py-3 px-3 font-medium">{t("تاريخ البداية")}</th>
                  <th className="py-3 px-3 font-medium">{t("تاريخ النهاية")}</th>
                  <th className="py-3 px-3 font-medium">{t("المدة (أيام)")}</th>
                  <th className="py-3 px-3 font-medium">{t("الحالة")}</th>
                  <th className="py-3 px-3 font-medium">{t("ملاحظات")}</th>
                  <th className="py-3 px-3 font-medium">{t("الإجراءات")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {loading ? (
                  <tr><td colSpan={9} className="py-8 text-center text-gray-400">{t("جاري التحميل...")}</td></tr>
                ) : leaves.length === 0 ? (
                  <tr><td colSpan={9} className="py-8 text-center text-gray-400">{t("لا توجد طلبات إجازة")}</td></tr>
                ) : (
                  leaves.map((leave, i) => (
                    <tr key={leave.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="py-3 px-3">{i + 1}</td>
                      <td className="py-3 px-3 font-medium text-gray-900">{leave.empName}</td>
                      <td className="py-3 px-3">{t(leave.leaveType)}</td>
                      <td className="py-3 px-3">{leave.startDate}</td>
                      <td className="py-3 px-3">{leave.endDate}</td>
                      <td className="py-3 px-3">{leave.days}</td>
                      <td className="py-3 px-3">
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[leave.status] ?? "bg-gray-100 text-gray-700"}`}>
                          {t(leave.status)}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-gray-500 max-w-[200px] truncate">{leave.notes || "—"}</td>
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-1 justify-center">
                          {isPendingStatus(leave.status) && (
                            <>
                              <button onClick={() => handleApprove(leave)} className="px-2 py-1 bg-emerald-600 text-white rounded text-xs hover:bg-emerald-700">{t("موافقة")}</button>
                              <button onClick={() => handleReject(leave)} className="px-2 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700">{t("رفض")}</button>
                            </>
                          )}
                          <button className="text-gray-400 hover:text-[#004e89]" title={t("عرض")} aria-label={t("عرض")}>
                            <Eye className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="bg-gray-50 p-4 border-t border-gray-100 flex items-center justify-between text-sm">
            <span className="text-gray-500">{t("يعرض")} {leaves.length} {t("سجل")}</span>
          </div>
        </div>
      </div>
    </Layout>
  );
}

function LeaveForm({ onBack, onSaved }: { onBack: () => void; onSaved: () => void }) {
  const { t, direction } = useI18n();
  const [empName, setEmpName] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [leaveType, setLeaveType] = useState("إجازة سنوية");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [employees, setEmployees] = useState<{ id: string; empId: string; name: string }[]>([]);

  useEffect(() => {
    const loadEmps = async () => {
      const { data } = await supabase.from("employees").select("id, emp_id, name").in("status", ["فعال", "نشط"]).order("name");
      if (data) setEmployees(data.map((e) => ({ id: String(e.id), empId: String(e.emp_id ?? ""), name: String(e.name) })));
    };
    loadEmps();
  }, []);

  // أيام تقويمية شاملة البداية والنهاية (بتاريخ UTC لتجنب فرق التوقيت)
  const days = startDate && endDate && endDate >= startDate
    ? Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000) + 1
    : 0;

  const handleSave = async () => {
    if (!employeeId || !startDate || !endDate) {
      toast({ title: t("خطأ"), description: t("يرجى تعبئة جميع الحقول المطلوبة"), variant: "destructive" });
      return;
    }
    if (endDate < startDate) {
      toast({ title: t("خطأ"), description: t("تاريخ النهاية قبل تاريخ البداية"), variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const employee = employees.find((em) => em.id === employeeId);
      const { error } = await supabase.from("leave_requests").insert([{
        employee_id: employeeId,
        emp_id: employee?.empId || null,
        emp_name: empName,
        leave_type: leaveType,
        start_date: startDate,
        end_date: endDate,
        days,
        status: "معلقة",
        notes,
      }]);
      if (error) throw error;
      toast({ title: t("تم تقديم الطلب"), description: `${t("طلب إجازة")} ${empName} ${t("تم تسجيله")}` });
      onSaved();
    } catch (error) {
      toast({ title: t("خطأ"), description: t(hrRequestErrorText(error, "فشل في حفظ الطلب")), variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <Layout>
      <div dir={direction} className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">{t("طلب إجازة جديد")}</h1>
          <div className="flex gap-2">
            <button onClick={onBack} className="flex items-center gap-1 px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm hover:bg-gray-50"><X className="h-4 w-4" /> {t("إلغاء")}</button>
            <button onClick={handleSave} disabled={saving} className="flex items-center gap-1 px-4 py-2 rounded-lg bg-[#004e89] text-white text-sm font-medium hover:bg-[#003d6e] disabled:opacity-50"><Save className="h-4 w-4" /> {saving ? t("جاري الحفظ...") : t("حفظ")}</button>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow border border-gray-100 p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("الموظف")} *</label>
            <select value={employeeId} onChange={(e) => { setEmployeeId(e.target.value); const emp = employees.find((em) => em.id === e.target.value); if (emp) setEmpName(emp.name); }} className="w-full px-3 py-2 border rounded-lg text-sm bg-white">
              <option value="">{t("اختر الموظف")}</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("نوع الإجازة")} *</label>
            <select value={leaveType} onChange={(e) => setLeaveType(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm bg-white">
              <option>{t("إجازة سنوية")}</option><option>{t("إجازة مرضية")}</option><option>{t("إجازة طارئة")}</option><option>{t("إجازة بدون راتب")}</option><option>{t("إجازة زواج")}</option><option>{t("إجازة وفاة")}</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("تاريخ البداية")} *</label><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("تاريخ النهاية")} *</label><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
          </div>
          {days > 0 && <div className="bg-blue-50 p-3 rounded-lg text-sm text-blue-700 font-medium">{t("عدد الأيام")}: {days} {t("يوم")}</div>}
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("ملاحظات")}</label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full px-3 py-2 border rounded-lg text-sm resize-none" /></div>
        </div>
      </div>
    </Layout>
  );
}
