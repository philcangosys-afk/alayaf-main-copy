import { useState, useEffect } from "react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Edit, Save, X, Printer, FileText } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n";
import { hrRequestErrorText } from "@/lib/hrErrors";
import { exportReportExcel, printReport } from "@/lib/reportExport";

const NO_ROWS_MESSAGE = "لم يُحفظ شيء: السجل غير موجود أو لا تملك صلاحية هذه العملية";
const orgErrorText = (error: unknown) =>
  (error as { code?: string } | null)?.code === "23503"
    ? "مرتبط بموظفين أو سجلات أخرى؛ لا يمكن حذفه"
    : hrRequestErrorText(error, "تعذر حفظ البيانات");

// عدد الموظفين المرتبطين قبل الحذف (قاعدة البيانات تمنع الحذف أيضًا برمز ORG_ITEM_IN_USE)
const countLinkedEmployees = async (column: string, value: string) => {
  const { count, error } = await supabase.from("employees").select("id", { count: "exact", head: true }).eq(column, value);
  if (error) throw error;
  return count ?? 0;
};

const DEFAULT_JOBS = [
  { name: "مدير عام", name_en: "General Manager", department: "", status: "فعال" },
  { name: "مدير موارد بشرية", name_en: "HR Manager", department: "", status: "فعال" },
  { name: "مدير مالي", name_en: "CFO", department: "", status: "فعال" },
  { name: "محاسب", name_en: "Accountant", department: "", status: "فعال" },
  { name: "مهندس", name_en: "Engineer", department: "", status: "فعال" },
  { name: "فني صيانة", name_en: "Maintenance Technician", department: "", status: "فعال" },
  { name: "مسؤول مبيعات", name_en: "Sales Representative", department: "", status: "فعال" },
  { name: "مسؤول مشتريات", name_en: "Procurement Officer", department: "", status: "فعال" },
  { name: "أخصائي موارد بشرية", name_en: "HR Specialist", department: "", status: "فعال" },
  { name: "موظف إداري", name_en: "Administrative Staff", department: "", status: "فعال" },
];

type JobRow = { id: string; name: string; nameEn: string; department: string; status: string };

export default function HROrgJobs() {
  const { t, direction, locale, formatNumber } = useI18n();
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formNameEn, setFormNameEn] = useState("");
  const [formDept, setFormDept] = useState("");
  const [formStatus, setFormStatus] = useState("فعال");
  const [seeded, setSeeded] = useState(false);
  // فشل التحميل لا يعني أن الجدول فارغ: نخفي زر التعبئة حتى لا تتكرر الوظائف
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-400 outline-none";

  const loadData = async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const { data, error } = await supabase.from("hr_jobs").select("*").order("name");
      if (error) throw error;
      if (data && data.length > 0) {
        setJobs(data.map((r: any) => ({
          id: String(r.id), name: String(r.name ?? ""),
          nameEn: String(r.name_en ?? ""), department: String(r.department ?? ""),
          status: String(r.status ?? "فعال"),
        })));
        setSeeded(true);
      } else {
        setJobs([]);
      }
    } catch (error) {
      setJobs([]);
      setLoadFailed(true);
      toast({ title: t("تعذر تحميل البيانات"), description: t(hrRequestErrorText(error)), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const seedDefaults = async () => {
    if (seeded || loadFailed || saving) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("hr_jobs").insert(DEFAULT_JOBS);
      if (error) throw error;
      toast({ title: t("تم إضافة الوظائف الافتراضية") });
      loadData();
    } catch (error) {
      toast({ title: t("تعذر إضافة الوظائف"), description: t(orgErrorText(error)), variant: "destructive" });
    } finally { setSaving(false); }
  };

  useEffect(() => { loadData(); }, []);

  const handleDelete = async (job: JobRow) => {
    if (!confirm(`${t("حذف الوظيفة")} "${job.name}"؟`)) return;
    // الموظف يرتبط بالوظيفة باسمها (employees.job_title)
    if (job.name.trim()) {
      try {
        const linked = await countLinkedEmployees("job_title", job.name);
        if (linked > 0) {
          toast({ title: t("لم يتم الحذف"), description: `${t("لا يمكن الحذف: مرتبط بـ")} ${formatNumber(linked)} ${t("موظف")}`, variant: "destructive" });
          return;
        }
      } catch (error) {
        toast({ title: t("تعذر التحقق من الموظفين المرتبطين"), description: t(hrRequestErrorText(error)), variant: "destructive" });
        return;
      }
    }
    const { data, error } = await supabase.from("hr_jobs").delete().eq("id", job.id).select("id");
    if (error || !data?.length) {
      toast({ title: t("لم يتم الحذف"), description: t(error ? orgErrorText(error) : NO_ROWS_MESSAGE), variant: "destructive" });
      return;
    }
    setJobs((prev) => prev.filter((j) => j.id !== job.id));
    toast({ title: t("تم الحذف") });
  };

  const handleSave = async () => {
    if (!formName.trim()) { toast({ title: t("خطأ"), description: t("اسم الوظيفة مطلوب"), variant: "destructive" }); return; }
    const payload = { name: formName, name_en: formNameEn, department: formDept, status: formStatus };
    setSaving(true);
    try {
      if (editingId) {
        const { data, error } = await supabase.from("hr_jobs").update(payload).eq("id", editingId).select("id");
        if (error) throw error;
        if (!data?.length) throw new Error(NO_ROWS_MESSAGE);
      } else {
        const { error } = await supabase.from("hr_jobs").insert([payload]);
        if (error) throw error;
      }
      toast({ title: editingId ? t("تم التعديل") : t("تمت الإضافة") });
      resetForm(); loadData();
    } catch (error) {
      toast({ title: t("خطأ"), description: t(orgErrorText(error)), variant: "destructive" });
    } finally { setSaving(false); }
  };

  const reportOptions = () => ({
    title: "قائمة الوظائف",
    fileName: "jobs",
    columns: [
      { key: "name", label: "المسمى الوظيفي", width: 26 },
      { key: "nameEn", label: "الاسم بالإنجليزية", width: 26 },
      { key: "department", label: "الإدارة", width: 22 },
      { key: "status", label: "الحالة", width: 12 },
    ],
    rows: jobs.map((row) => ({ name: row.name, nameEn: row.nameEn, department: row.department, status: row.status })),
  });
  const handlePrint = () => {
    if (!printReport(reportOptions())) toast({ title: t("تعذر فتح نافذة الطباعة"), description: t("اسمح بالنوافذ المنبثقة ثم أعد المحاولة"), variant: "destructive" });
  };
  const handleExport = () => exportReportExcel(reportOptions());

  const startEdit = (job: JobRow) => {
    setEditingId(job.id); setFormName(job.name); setFormNameEn(job.nameEn); setFormDept(job.department); setFormStatus(job.status); setShowForm(true);
  };

  const resetForm = () => { setShowForm(false); setEditingId(null); setFormName(""); setFormNameEn(""); setFormDept(""); setFormStatus("فعال"); };

  return (
    <Layout>
      <div className="p-6 max-w-[1200px] mx-auto space-y-5" dir={direction}>
        <div className="flex justify-between items-center bg-white p-4 rounded-lg border shadow-sm">
          <div className="flex gap-2">
            <Button variant="outline" size="icon" className="text-blue-600 border-blue-600" onClick={handlePrint} disabled={jobs.length === 0} title={t("طباعة")} aria-label={t("طباعة")}><Printer className="h-4 w-4" /></Button>
            <Button variant="outline" size="icon" className="text-blue-600 border-blue-600" onClick={handleExport} disabled={jobs.length === 0} title={t("تصدير Excel")} aria-label={t("تصدير Excel")}><FileText className="h-4 w-4" /></Button>
            <Button className="bg-[#004e89] hover:bg-[#003d6d] text-white gap-1" onClick={() => { resetForm(); setShowForm(true); }}>
              <Plus className="h-4 w-4" /> {t("إضافة وظيفة")}
            </Button>
            {jobs.length === 0 && !loading && !loadFailed && (
              <Button variant="outline" onClick={seedDefaults} disabled={saving}>{t("تعبئة الوظائف الافتراضية")}</Button>
            )}
          </div>
          <h1 className="font-bold text-xl text-[#004e89]">{t("قائمة الوظائف")}</h1>
        </div>

        {showForm && (
          <div className="bg-white rounded-lg border shadow-sm p-6 space-y-4">
            <h3 className="font-bold text-lg">{editingId ? t("تعديل وظيفة") : t("إضافة وظيفة جديدة")}</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">{t("اسم الوظيفة (عربي)")} *</label>
                <input value={formName} onChange={(e) => setFormName(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("اسم الوظيفة بالإنجليزية")}</label>
                <input value={formNameEn} onChange={(e) => setFormNameEn(e.target.value)} className={inputCls} placeholder={t("English name")} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("الإدارة")}</label>
                <input value={formDept} onChange={(e) => setFormDept(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("الحالة")}</label>
                <select value={formStatus} onChange={(e) => setFormStatus(e.target.value)} className={inputCls}>
                  <option value="فعال">{t("فعال")}</option>
                  <option value="غير فعال">{t("غير فعال")}</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={saving} className="bg-[#004e89] hover:bg-[#003d6d] text-white gap-1"><Save className="h-4 w-4" /> {saving ? t("جاري الحفظ...") : t("حفظ")}</Button>
              <Button variant="outline" onClick={resetForm} className="gap-1"><X className="h-4 w-4" /> {t("إلغاء")}</Button>
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
          <table className="w-full text-sm text-start">
            <thead className="bg-[#004e89] text-white">
              <tr>
                <th className="py-3 px-4 font-medium">#</th>
                <th className="py-3 px-4 font-medium">{t("المسمى الوظيفي")}</th>
                <th className="py-3 px-4 font-medium">{t("الاسم بالإنجليزية")}</th>
                <th className="py-3 px-4 font-medium">{t("الإدارة")}</th>
                <th className="py-3 px-4 font-medium text-center">{t("الحالة")}</th>
                <th className="py-3 px-4 font-medium text-center w-28">{t("الإجراءات")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading ? (
                <tr><td colSpan={6} className="text-center py-8 text-gray-400">{t("جاري التحميل...")}</td></tr>
              ) : loadFailed ? (
                <tr><td colSpan={6} className="text-center py-8 text-red-500">{t("تعذر تحميل الوظائف؛ أعد تحميل الصفحة")}</td></tr>
              ) : jobs.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-gray-400">{t("لا توجد وظائف - استخدم زر \"تعبئة الوظائف الافتراضية\"")}</td></tr>
              ) : jobs.map((row, i) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="py-3 px-4">{i + 1}</td>
                  <td className="py-3 px-4 font-medium">{locale === "en" ? row.nameEn || row.name : row.name}</td>
                  <td className="py-3 px-4 text-gray-600">{row.nameEn}</td>
                  <td className="py-3 px-4">{row.department}</td>
                  <td className="py-3 px-4 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${row.status === "فعال" ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-600"}`}>{t(row.status)}</span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex justify-center gap-2">
                      <button onClick={() => startEdit(row)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg"><Edit className="h-4 w-4" /></button>
                      <button onClick={() => handleDelete(row)} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-gray-500">{t("إجمالي")}: {formatNumber(jobs.length)} {t("وظيفة")}</p>
      </div>
    </Layout>
  );
}
