import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Edit, Save, X, Printer, FileText, Clock, Building2, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n";
import { exportReportExcel, printReport, type ReportColumn } from "@/lib/reportExport";
import { hrRequestErrorText } from "@/lib/hrErrors";

type ScheduleRow = { id: string; name: string; company: string; shiftStart: string; shiftEnd: string; daysPerWeek: number; status: string };
type CompanyRow = { id: string; name: string; nameEn: string; city: string; phone: string };

type TabKey = "schedules" | "companies";

export default function HROrgWorkSchedules() {
  const { t, direction, formatNumber } = useI18n();
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabKey>("schedules");

  // Schedules state
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [loadingSched, setLoadingSched] = useState(true);
  const [showSchedForm, setShowSchedForm] = useState(false);
  const [editingSchedId, setEditingSchedId] = useState<string | null>(null);
  const [sName, setSName] = useState("");
  const [sCompany, setSCompany] = useState("");
  const [sStart, setSStart] = useState("08:00");
  const [sEnd, setSEnd] = useState("16:00");
  const [sDays, setSDays] = useState(6);
  const [sStatus, setSStatus] = useState("فعال");

  // Companies state
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [loadingComp, setLoadingComp] = useState(true);
  const [showCompForm, setShowCompForm] = useState(false);
  const [editingCompId, setEditingCompId] = useState<string | null>(null);
  const [cName, setCName] = useState("");
  const [cNameEn, setCNameEn] = useState("");
  const [cCity, setCCity] = useState("");
  const [cPhone, setCPhone] = useState("");

  const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-400 outline-none";

  // Load Schedules
  const loadSchedules = async () => {
    setLoadingSched(true);
    try {
      const { data, error } = await supabase.from("hr_work_schedules").select("*").order("name");
      if (error) throw error;
      if (data) setSchedules(data.map((r: any) => ({
        id: String(r.id), name: String(r.name ?? ""), company: String(r.company ?? ""),
        shiftStart: String(r.shift_start ?? "08:00"), shiftEnd: String(r.shift_end ?? "16:00"),
        daysPerWeek: Number(r.days_per_week ?? 6), status: String(r.status ?? "فعال"),
      })));
    } catch (error) { setSchedules([]); toast({ title: t("تعذر تحميل جداول العمل"), description: hrRequestErrorText(error), variant: "destructive" }); } finally { setLoadingSched(false); }
  };

  // Load Companies
  const loadCompanies = async () => {
    setLoadingComp(true);
    try {
      const { data, error } = await supabase.from("hr_companies").select("*").order("name");
      if (error) throw error;
      if (data) setCompanies(data.map((r: any) => ({
        id: String(r.id), name: String(r.name ?? ""), nameEn: String(r.name_en ?? ""),
        city: String(r.city ?? ""), phone: String(r.phone ?? ""),
      })));
    } catch (error) { setCompanies([]); toast({ title: t("تعذر تحميل الشركات"), description: hrRequestErrorText(error), variant: "destructive" }); } finally { setLoadingComp(false); }
  };

  useEffect(() => { loadSchedules(); loadCompanies(); }, []);

  const resetSchedForm = () => { setShowSchedForm(false); setEditingSchedId(null); setSName(""); setSCompany(""); setSStart("08:00"); setSEnd("16:00"); setSDays(6); setSStatus("فعال"); };
  const resetCompForm = () => { setShowCompForm(false); setEditingCompId(null); setCName(""); setCNameEn(""); setCCity(""); setCPhone(""); };

  // .select() يكشف التعديل/الحذف الذي لم يمس أي صف (غالبًا بسبب صلاحيات RLS) فلا تظهر رسالة نجاح كاذبة.
  // rows = undefined للإضافة: رفض RLS في الإضافة يعيد خطأً صريحًا.
  const mutationFailed = (title: string, error: unknown, rows?: unknown[] | null) => {
    if (!error && (rows === undefined || (rows && rows.length > 0))) return false;
    toast({ title, description: error ? hrRequestErrorText(error) : t("لم يُحفظ شيء: لا تملك صلاحية هذه العملية على هذا السجل"), variant: "destructive" });
    return true;
  };

  const saveSched = async () => {
    if (!sName.trim()) { toast({ title: t("خطأ"), description: t("اسم الجدول مطلوب"), variant: "destructive" }); return; }
    const payload = { name: sName, company: sCompany, shift_start: sStart, shift_end: sEnd, days_per_week: sDays, status: sStatus };
    if (editingSchedId) {
      const { data, error } = await supabase.from("hr_work_schedules").update(payload).eq("id", editingSchedId).select("id");
      if (mutationFailed(t("تعذر حفظ جدول العمل"), error, data)) return;
    } else {
      const { error } = await supabase.from("hr_work_schedules").insert([payload]);
      if (mutationFailed(t("تعذر حفظ جدول العمل"), error)) return;
    }
    toast({ title: editingSchedId ? t("تم التعديل") : t("تمت الإضافة") });
    resetSchedForm(); loadSchedules();
  };

  const saveComp = async () => {
    if (!cName.trim()) { toast({ title: t("خطأ"), description: t("اسم الشركة مطلوب"), variant: "destructive" }); return; }
    const payload = { name: cName, name_en: cNameEn, city: cCity, phone: cPhone };
    if (editingCompId) {
      const { data, error } = await supabase.from("hr_companies").update(payload).eq("id", editingCompId).select("id");
      if (mutationFailed(t("تعذر حفظ الشركة"), error, data)) return;
    } else {
      const { error } = await supabase.from("hr_companies").insert([payload]);
      if (mutationFailed(t("تعذر حفظ الشركة"), error)) return;
    }
    toast({ title: editingCompId ? t("تم التعديل") : t("تمت الإضافة") });
    resetCompForm(); loadCompanies();
  };

  const deleteSched = async (row: ScheduleRow) => {
    if (!confirm(`${t("حذف")} ${t("اسم الجدول")} "${row.name}"؟`)) return;
    const { data, error } = await supabase.from("hr_work_schedules").delete().eq("id", row.id).select("id");
    if (mutationFailed(t("تعذر حذف جدول العمل"), error, data)) return;
    setSchedules((prev) => prev.filter((r) => r.id !== row.id));
    toast({ title: t("تم الحذف") });
  };

  const deleteComp = async (row: CompanyRow) => {
    if (!confirm(`${t("حذف")} ${t("الشركة")} "${row.name}"؟`)) return;
    const { data, error } = await supabase.from("hr_companies").delete().eq("id", row.id).select("id");
    if (mutationFailed(t("تعذر حذف الشركة"), error, data)) return;
    setCompanies((prev) => prev.filter((r) => r.id !== row.id));
    toast({ title: t("تم الحذف") });
  };

  // الطباعة والتصدير للصفوف المعروضة في التبويب الحالي
  const currentReport = () => {
    if (tab === "schedules") {
      const columns: ReportColumn[] = [{ key: "name", label: t("اسم الجدول"), width: 24 }, { key: "company", label: t("الشركة"), width: 22 }, { key: "shiftStart", label: t("بداية الدوام"), width: 14 }, { key: "shiftEnd", label: t("نهاية الدوام"), width: 14 }, { key: "daysPerWeek", label: t("أيام العمل"), width: 12 }, { key: "status", label: t("الحالة"), width: 12 }];
      return { title: t("جداول العمل"), columns, rows: schedules.map((row) => ({ name: row.name, company: row.company, shiftStart: row.shiftStart, shiftEnd: row.shiftEnd, daysPerWeek: row.daysPerWeek, status: t(row.status) })), fileName: "work-schedules" };
    }
    const columns: ReportColumn[] = [{ key: "name", label: t("الشركة"), width: 26 }, { key: "nameEn", label: t("الاسم بالإنجليزية"), width: 26 }, { key: "city", label: t("المدينة"), width: 16 }, { key: "phone", label: t("الهاتف"), width: 16 }];
    return { title: t("الشركات"), columns, rows: companies.map((row) => ({ name: row.name, nameEn: row.nameEn, city: row.city, phone: row.phone })), fileName: "work-schedule-companies" };
  };
  const currentRowsCount = tab === "schedules" ? schedules.length : companies.length;
  const printCurrent = () => {
    if (!printReport(currentReport())) toast({ title: t("تعذر فتح نافذة الطباعة"), description: t("اسمح بالنوافذ المنبثقة لهذا الموقع"), variant: "destructive" });
  };
  const exportCurrent = () => exportReportExcel(currentReport());

  return (
    <Layout>
      <div className="p-6 max-w-[1200px] mx-auto space-y-5" dir={direction}>
        {/* Header */}
        <div className="flex justify-between items-center bg-white p-4 rounded-lg border shadow-sm">
          <div className="flex gap-2">
            <Button variant="outline" size="icon" onClick={printCurrent} disabled={!currentRowsCount} title={t("طباعة")} aria-label={t("طباعة")}><Printer className="h-4 w-4 text-blue-600" /></Button>
            <Button variant="outline" size="icon" onClick={exportCurrent} disabled={!currentRowsCount} title={t("تصدير Excel")} aria-label={t("تصدير Excel")}><FileText className="h-4 w-4 text-blue-600" /></Button>
            {tab === "schedules" && (
              <Button className="bg-[#004e89] hover:bg-[#003d6d] text-white gap-1" onClick={() => { resetSchedForm(); setShowSchedForm(true); }}>
                <Plus className="h-4 w-4" /> {t("إضافة جدول")}
              </Button>
            )}
            {tab === "companies" && (
              <Button className="bg-[#004e89] hover:bg-[#003d6d] text-white gap-1" onClick={() => { resetCompForm(); setShowCompForm(true); }}>
                <Plus className="h-4 w-4" /> {t("إضافة شركة")}
              </Button>
            )}
          </div>
          <h1 className="font-bold text-xl text-[#004e89]">{t("جداول العمل")}</h1>
        </div>

        {/* Tabs */}
        <div className="flex gap-2">
          <button onClick={() => setTab("schedules")} className={`flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium transition ${tab === "schedules" ? "bg-[#004e89] text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}><Clock className="h-4 w-4" /> {t("جداول العمل")}</button>
          <button onClick={() => setTab("companies")} className={`flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium transition ${tab === "companies" ? "bg-[#004e89] text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}><Building2 className="h-4 w-4" /> {t("الشركات")}</button>
        </div>

        {/* Schedules Tab */}
        {tab === "schedules" && (
          <>
            {/* هذه القائمة (hr_work_schedules) لا يقرأها حساب الدوام ولا الرواتب؛ الجداول المستخدمة في attendance_schedules */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{t("هذه القائمة لا تُستخدم في حساب الدوام. جداول الدوام التي يُربط بها الموظف وتُحسب بها الساعات والتأخير في: إعداد فترات الدوام")}</span>
              </div>
              <Button variant="outline" size="sm" className="border-amber-300 bg-white text-amber-800 hover:bg-amber-100" onClick={() => navigate("/hr/attendance/schedules")}>{t("فتح إعداد فترات الدوام")}</Button>
            </div>

            {showSchedForm && (
              <div className="bg-white rounded-lg border shadow-sm p-6 space-y-4">
                <h3 className="font-bold text-lg">{editingSchedId ? t("تعديل جدول") : t("إضافة جدول عمل جديد")}</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="block text-sm font-medium mb-1">{t("اسم الجدول")} *</label><input value={sName} onChange={(e) => setSName(e.target.value)} className={inputCls} /></div>
                  <div><label className="block text-sm font-medium mb-1">{t("الشركة")}</label><input value={sCompany} onChange={(e) => setSCompany(e.target.value)} className={inputCls} /></div>
                  <div><label className="block text-sm font-medium mb-1">{t("بداية الدوام")}</label><input type="time" value={sStart} onChange={(e) => setSStart(e.target.value)} className={inputCls} /></div>
                  <div><label className="block text-sm font-medium mb-1">{t("نهاية الدوام")}</label><input type="time" value={sEnd} onChange={(e) => setSEnd(e.target.value)} className={inputCls} /></div>
                  <div><label className="block text-sm font-medium mb-1">{t("أيام العمل في الأسبوع")}</label><input type="number" min={1} max={7} value={sDays} onChange={(e) => setSDays(Number(e.target.value))} className={inputCls} /></div>
                  <div><label className="block text-sm font-medium mb-1">{t("الحالة")}</label><select value={sStatus} onChange={(e) => setSStatus(e.target.value)} className={inputCls}><option value="فعال">{t("فعال")}</option><option value="غير فعال">{t("غير فعال")}</option></select></div>
                </div>
                <div className="flex gap-2">
                  <Button onClick={saveSched} className="bg-[#004e89] text-white gap-1"><Save className="h-4 w-4" /> {t("حفظ")}</Button>
                  <Button variant="outline" onClick={resetSchedForm}><X className="h-4 w-4" /> {t("إلغاء")}</Button>
                </div>
              </div>
            )}

            <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
              <table className="w-full text-sm text-start">
                <thead className="bg-[#004e89] text-white">
                  <tr>
                    <th className="py-3 px-4">#</th>
                    <th className="py-3 px-4">{t("اسم الجدول")}</th>
                    <th className="py-3 px-4">{t("الشركة")}</th>
                    <th className="py-3 px-4">{t("بداية الدوام")}</th>
                    <th className="py-3 px-4">{t("نهاية الدوام")}</th>
                    <th className="py-3 px-4">{t("أيام العمل")}</th>
                    <th className="py-3 px-4 text-center">{t("الحالة")}</th>
                    <th className="py-3 px-4 text-center w-24">{t("الإجراءات")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {loadingSched ? (
                    <tr><td colSpan={8} className="text-center py-8 text-gray-400">{t("جاري التحميل...")}</td></tr>
                  ) : schedules.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-8 text-gray-400">{t("لا توجد جداول عمل")}</td></tr>
                  ) : schedules.map((row, i) => (
                    <tr key={row.id} className="hover:bg-gray-50">
                      <td className="py-3 px-4">{i + 1}</td>
                      <td className="py-3 px-4 font-medium">{row.name}</td>
                      <td className="py-3 px-4">{row.company}</td>
                      <td className="py-3 px-4">{row.shiftStart}</td>
                      <td className="py-3 px-4">{row.shiftEnd}</td>
                      <td className="py-3 px-4">{formatNumber(row.daysPerWeek)} {t("أيام")}</td>
                      <td className="py-3 px-4 text-center"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${row.status === "فعال" ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-600"}`}>{t(row.status)}</span></td>
                      <td className="py-3 px-4">
                        <div className="flex justify-center gap-2">
                          <button onClick={() => { setEditingSchedId(row.id); setSName(row.name); setSCompany(row.company); setSStart(row.shiftStart); setSEnd(row.shiftEnd); setSDays(row.daysPerWeek); setSStatus(row.status); setShowSchedForm(true); }} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"><Edit className="h-4 w-4" /></button>
                          <button onClick={() => deleteSched(row)} className="p-1.5 text-red-500 hover:bg-red-50 rounded"><Trash2 className="h-4 w-4" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Companies Tab */}
        {tab === "companies" && (
          <>
            {showCompForm && (
              <div className="bg-white rounded-lg border shadow-sm p-6 space-y-4">
                <h3 className="font-bold text-lg">{editingCompId ? t("تعديل شركة") : t("إضافة شركة جديدة")}</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="block text-sm font-medium mb-1">{t("اسم الشركة (عربي)")} *</label><input value={cName} onChange={(e) => setCName(e.target.value)} className={inputCls} /></div>
                  <div><label className="block text-sm font-medium mb-1">{t("اسم الشركة بالإنجليزية")}</label><input value={cNameEn} onChange={(e) => setCNameEn(e.target.value)} className={inputCls} /></div>
                  <div><label className="block text-sm font-medium mb-1">{t("المدينة")}</label><input value={cCity} onChange={(e) => setCCity(e.target.value)} className={inputCls} /></div>
                  <div><label className="block text-sm font-medium mb-1">{t("الهاتف")}</label><input value={cPhone} onChange={(e) => setCPhone(e.target.value)} className={inputCls} /></div>
                </div>
                <div className="flex gap-2">
                  <Button onClick={saveComp} className="bg-[#004e89] text-white gap-1"><Save className="h-4 w-4" /> {t("حفظ")}</Button>
                  <Button variant="outline" onClick={resetCompForm}><X className="h-4 w-4" /> {t("إلغاء")}</Button>
                </div>
              </div>
            )}

            <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
              <table className="w-full text-sm text-start">
                <thead className="bg-[#004e89] text-white">
                  <tr>
                    <th className="py-3 px-4">#</th>
                    <th className="py-3 px-4">{t("الشركة")}</th>
                    <th className="py-3 px-4">{t("الاسم بالإنجليزية")}</th>
                    <th className="py-3 px-4">{t("المدينة")}</th>
                    <th className="py-3 px-4">{t("الهاتف")}</th>
                    <th className="py-3 px-4 text-center w-24">{t("الإجراءات")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {loadingComp ? (
                    <tr><td colSpan={6} className="text-center py-8 text-gray-400">{t("جاري التحميل...")}</td></tr>
                  ) : companies.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-8 text-gray-400">{t("لا توجد شركات")}</td></tr>
                  ) : companies.map((row, i) => (
                    <tr key={row.id} className="hover:bg-gray-50">
                      <td className="py-3 px-4">{i + 1}</td>
                      <td className="py-3 px-4 font-medium">{row.name}</td>
                      <td className="py-3 px-4 text-gray-600">{row.nameEn}</td>
                      <td className="py-3 px-4">{row.city}</td>
                      <td className="py-3 px-4">{row.phone}</td>
                      <td className="py-3 px-4">
                        <div className="flex justify-center gap-2">
                          <button onClick={() => { setEditingCompId(row.id); setCName(row.name); setCNameEn(row.nameEn); setCCity(row.city); setCPhone(row.phone); setShowCompForm(true); }} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"><Edit className="h-4 w-4" /></button>
                          <button onClick={() => deleteComp(row)} className="p-1.5 text-red-500 hover:bg-red-50 rounded"><Trash2 className="h-4 w-4" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
