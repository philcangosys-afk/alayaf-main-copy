import { useEffect, useState } from "react";
import { Edit, Loader2, Plus, Save, Trash2, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { hrRequestErrorText } from "@/lib/hrErrors";

export type JobTitleRow = { id: string; name: string; nameEn: string; department: string; status: string };

const emptyJob = { name: "", nameEn: "", department: "", status: "فعال" };

export default function JobTitlesManager({ embedded = false }: { embedded?: boolean }) {
  const [jobs, setJobs] = useState<JobTitleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyJob);

  const loadJobs = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("hr_jobs").select("id, name, name_en, department, status").order("name");
    if (error) toast.error(`تعذر تحميل المسميات الوظيفية: ${error.message}`);
    setJobs((data ?? []).map((row) => ({ id: String(row.id), name: String(row.name ?? ""), nameEn: String(row.name_en ?? ""), department: String(row.department ?? ""), status: String(row.status ?? "فعال") })));
    setLoading(false);
  };

  useEffect(() => { void loadJobs(); }, []);

  const resetForm = () => {
    setEditingId(null);
    setShowForm(false);
    setForm(emptyJob);
  };

  const editJob = (job: JobTitleRow) => {
    setEditingId(job.id);
    setForm({ name: job.name, nameEn: job.nameEn, department: job.department, status: job.status });
    setShowForm(true);
  };

  const saveJob = async () => {
    if (!form.name.trim()) return toast.error("اسم المسمى الوظيفي مطلوب");
    setSaving(true);
    const payload = { name: form.name.trim(), name_en: form.nameEn.trim(), department: form.department.trim(), status: form.status, updated_at: new Date().toISOString() };
    // select() يكشف التحديث الذي لم يمس صفًا (لا صلاحية أو السجل غير موجود) بدل نجاح كاذب
    const { data, error } = editingId
      ? await supabase.from("hr_jobs").update(payload).eq("id", editingId).select("id")
      : await supabase.from("hr_jobs").insert(payload).select("id");
    setSaving(false);
    if (error) return toast.error(`تعذر حفظ المسمى: ${hrRequestErrorText(error)}`);
    if (!data?.length) return toast.error("لم يُحفظ شيء: لا تملك صلاحية الهيكل التنظيمي أو أن المسمى حُذف");
    toast.success(editingId ? "تم تحديث المسمى الوظيفي" : "تمت إضافة المسمى الوظيفي");
    resetForm();
    await loadJobs();
  };

  const deleteJob = async (job: JobTitleRow) => {
    if (!confirm(`حذف المسمى الوظيفي «${job.name}»؟`)) return;
    const { data, error } = await supabase.from("hr_jobs").delete().eq("id", job.id).select("id");
    if (error) return toast.error(`تعذر الحذف: ${hrRequestErrorText(error)}`);
    if (!data?.length) return toast.error("لم يُحذف شيء: لا تملك صلاحية الهيكل التنظيمي أو أن المسمى حُذف مسبقًا");
    setJobs((current) => current.filter((item) => item.id !== job.id));
    toast.success("تم حذف المسمى الوظيفي");
  };

  const inputClass = "h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

  return (
    <section className={`overflow-hidden rounded-xl border border-gray-200 bg-white ${embedded ? "" : "shadow-sm"}`} dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-gradient-to-l from-emerald-50 to-white px-4 py-3">
        <div><h2 className="font-bold text-gray-900">المسميات الوظيفية</h2><p className="mt-0.5 text-xs text-gray-500">تظهر المسميات الفعالة مباشرةً في نموذج إضافة وتعديل الموظف</p></div>
        <button type="button" onClick={() => { resetForm(); setShowForm(true); }} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"><Plus className="h-4 w-4" />إضافة مسمى</button>
      </div>

      {showForm && (
        <div className="grid grid-cols-1 gap-3 border-b border-gray-200 bg-gray-50 p-4 md:grid-cols-2 lg:grid-cols-4">
          <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className={inputClass} placeholder="المسمى بالعربية *" />
          <input value={form.nameEn} onChange={(event) => setForm((current) => ({ ...current, nameEn: event.target.value }))} className={inputClass} placeholder="المسمى بالإنجليزية" />
          <input value={form.department} onChange={(event) => setForm((current) => ({ ...current, department: event.target.value }))} className={inputClass} placeholder="الإدارة" />
          <select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))} className={inputClass}><option value="فعال">فعال</option><option value="غير فعال">غير فعال</option></select>
          <div className="flex gap-2 md:col-span-2 lg:col-span-4">
            <button type="button" onClick={saveJob} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}حفظ</button>
            <button type="button" onClick={resetForm} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm"><X className="h-4 w-4" />إلغاء</button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px] text-right text-sm">
          <thead className="bg-slate-100 text-gray-700"><tr><th className="px-4 py-3">المسمى بالعربية</th><th className="px-4 py-3">المسمى بالإنجليزية</th><th className="px-4 py-3">الإدارة</th><th className="px-4 py-3">الحالة</th><th className="px-4 py-3 text-center">الإجراءات</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? <tr><td colSpan={5} className="py-10 text-center text-gray-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr> : jobs.length === 0 ? <tr><td colSpan={5} className="py-10 text-center text-gray-400">لا توجد مسميات وظيفية</td></tr> : jobs.map((job) => (
              <tr key={job.id} className="hover:bg-gray-50"><td className="px-4 py-3 font-semibold">{job.name}</td><td className="px-4 py-3 text-gray-500">{job.nameEn || "—"}</td><td className="px-4 py-3 text-gray-600">{job.department || "—"}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${job.status === "فعال" ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>{job.status}</span></td><td className="px-4 py-3"><div className="flex justify-center gap-1"><button type="button" onClick={() => editJob(job)} title="تعديل" className="rounded p-1.5 text-blue-600 hover:bg-blue-50"><Edit className="h-4 w-4" /></button><button type="button" onClick={() => deleteJob(job)} title="حذف" className="rounded p-1.5 text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button></div></td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-gray-100 bg-gray-50 px-4 py-2 text-xs text-gray-500">إجمالي المسميات: {jobs.length}</div>
    </section>
  );
}
