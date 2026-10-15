import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { Search, Plus, Edit, Trash2, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n";
import { hrRequestErrorText } from "@/lib/hrErrors";

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

type Section = { id: string; name: string; nameEn: string; department: string; departmentId: string; manager: string; description: string };

export default function HROrgSections() {
  const { t, direction, formatNumber } = useI18n();
  const [items, setItems] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formNameEn, setFormNameEn] = useState("");
  const [formDept, setFormDept] = useState("");
  const [formDeptId, setFormDeptId] = useState("");
  const [formManager, setFormManager] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);

  const loadData = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from("org_sections").select("*").order("id", { ascending: false });
      if (error) throw error;
      if (data) setItems(data.map((r: any) => ({
        id: String(r.id), name: r.name ?? "", nameEn: r.name_en ?? "", department: r.department ?? "",
        departmentId: r.department_id ? String(r.department_id) : "",
        manager: r.manager ?? "", description: r.description ?? "",
      })));
      const { data: depts, error: deptError } = await supabase.from("departments").select("id, name").order("name");
      if (deptError) throw deptError;
      if (depts) setDepartments(depts.map((d: any) => ({ id: String(d.id), name: d.name })));
    } catch (error) {
      toast({ title: t("تعذر تحميل البيانات"), description: t(hrRequestErrorText(error)), variant: "destructive" });
    } finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, []);

  const resetForm = () => { setShowForm(false); setEditingId(null); setFormName(""); setFormNameEn(""); setFormDept(""); setFormDeptId(""); setFormManager(""); setFormDesc(""); };

  const startEdit = (item: Section) => {
    setEditingId(item.id); setFormName(item.name); setFormNameEn(item.nameEn); setFormDept(item.department);
    setFormDeptId(item.departmentId);
    setFormManager(item.manager); setFormDesc(item.description); setShowForm(true);
  };

  const onDeptChange = (id: string) => {
    setFormDeptId(id);
    setFormDept(departments.find((d) => d.id === id)?.name ?? "");
  };

  const handleSave = async () => {
    if (!formName.trim() || !formNameEn.trim()) { toast({ title: t("خطأ"), description: t("اسم القسم بالعربية والإنجليزية مطلوب"), variant: "destructive" }); return; }
    setSaving(true);
    try {
      const payload = { name: formName.trim(), name_en: formNameEn.trim(), department: formDept, department_id: formDeptId || null, manager: formManager, description: formDesc };
      if (editingId) {
        const { data, error } = await supabase.from("org_sections").update(payload).eq("id", editingId).select("id");
        if (error) throw error;
        if (!data?.length) throw new Error(NO_ROWS_MESSAGE);
        toast({ title: t("تم التعديل") });
      } else {
        const { error } = await supabase.from("org_sections").insert([payload]);
        if (error) throw error;
        toast({ title: t("تمت الإضافة") });
      }
      resetForm(); loadData();
    } catch (error) {
      toast({ title: t("خطأ"), description: t(orgErrorText(error)), variant: "destructive" });
    } finally { setSaving(false); }
  };

  const handleDelete = async (item: Section) => {
    if (!confirm(`${t("حذف")} "${item.name}"؟`)) return;
    try {
      const linked = await countLinkedEmployees("section_id", item.id);
      if (linked > 0) {
        toast({ title: t("لم يتم الحذف"), description: `${t("لا يمكن الحذف: مرتبط بـ")} ${formatNumber(linked)} ${t("موظف")}`, variant: "destructive" });
        return;
      }
    } catch (error) {
      toast({ title: t("تعذر التحقق من الموظفين المرتبطين"), description: t(hrRequestErrorText(error)), variant: "destructive" });
      return;
    }
    const { data, error } = await supabase.from("org_sections").delete().eq("id", item.id).select("id");
    if (error || !data?.length) {
      toast({ title: t("لم يتم الحذف"), description: t(error ? orgErrorText(error) : NO_ROWS_MESSAGE), variant: "destructive" });
      return;
    }
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    toast({ title: t("تم الحذف") });
  };

  const filtered = items.filter((i) => !search || i.name.includes(search) || i.nameEn.toLowerCase().includes(search.toLowerCase()) || i.department.includes(search));

  return (
    <Layout>
      <div className="p-6 max-w-[1600px] mx-auto space-y-6" dir={direction}>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">{t("قائمة الأقسام")}</h1>
          <Button onClick={() => { resetForm(); setShowForm(true); }} className="bg-[#004e89] hover:bg-[#003865]">
            <Plus className="h-4 w-4 me-2" /> {t("إضافة قسم")}
          </Button>
        </div>

        {showForm && (
          <div className="bg-white rounded-lg border shadow-sm p-6 space-y-4">
            <h3 className="font-bold text-lg">{editingId ? t("تعديل القسم") : t("إضافة قسم جديد")}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium mb-1">{t("اسم القسم بالعربية")} *</label><Input value={formName} onChange={(e) => setFormName(e.target.value)} /></div>
              <div><label className="block text-sm font-medium mb-1">{t("اسم القسم بالإنجليزية")} *</label><Input dir="ltr" value={formNameEn} onChange={(e) => setFormNameEn(e.target.value)} /></div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("الإدارة")}</label>
                <select value={formDeptId} onChange={(e) => onDeptChange(e.target.value)} className="w-full h-10 border rounded-md px-3 bg-white text-sm">
                  <option value="">{t("اختر الإدارة")}</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div><label className="block text-sm font-medium mb-1">{t("المدير")}</label><Input value={formManager} onChange={(e) => setFormManager(e.target.value)} /></div>
              <div><label className="block text-sm font-medium mb-1">{t("الوصف")}</label><Input value={formDesc} onChange={(e) => setFormDesc(e.target.value)} /></div>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={saving} className="bg-[#004e89] hover:bg-[#003865]"><Save className="h-4 w-4 me-1" /> {saving ? t("جاري الحفظ...") : t("حفظ")}</Button>
              <Button variant="outline" onClick={resetForm}><X className="h-4 w-4 me-1" /> {t("إلغاء")}</Button>
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
          <div className="p-4 border-b flex justify-between items-center">
            <div className="relative w-72">
              <Search className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input placeholder={t("بحث...")} value={search} onChange={(e) => setSearch(e.target.value)} className="pe-9" />
            </div>
            <span className="text-sm text-gray-500">{formatNumber(filtered.length)} {t("سجل")}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-start min-w-[1000px]">
              <thead className="bg-[#004e89] text-white">
                <tr>
                  <th className="py-3 px-4 font-medium w-16">#</th>
                  <th className="py-3 px-4 font-medium">{t("اسم القسم بالعربية")}</th>
                  <th className="py-3 px-4 font-medium">{t("اسم القسم بالإنجليزية")}</th>
                  <th className="py-3 px-4 font-medium">{t("الإدارة")}</th>
                  <th className="py-3 px-4 font-medium">{t("المدير")}</th>
                  <th className="py-3 px-4 font-medium">{t("الوصف")}</th>
                  <th className="py-3 px-4 font-medium text-center w-24">{t("الإجراءات")}</th>
                </tr>
              </thead>
              <tbody className="divide-y bg-white">
                {loading ? (
                  <tr><td colSpan={7} className="text-center py-8 text-gray-400">{t("جاري التحميل...")}</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-8 text-gray-400">{t("لا توجد بيانات")}</td></tr>
                ) : filtered.map((item, i) => (
                  <tr key={item.id} className="hover:bg-gray-50/50">
                    <td className="py-3 px-4">{i + 1}</td>
                    <td className="py-3 px-4 font-medium">{item.name}</td>
                    <td className="py-3 px-4" dir="ltr">{item.nameEn}</td>
                    <td className="py-3 px-4">{item.department}</td>
                    <td className="py-3 px-4">{item.manager}</td>
                    <td className="py-3 px-4">{item.description}</td>
                    <td className="py-3 px-4">
                      <div className="flex justify-center items-center gap-2">
                        <button onClick={() => startEdit(item)} className="text-gray-400 hover:text-blue-500"><Edit className="h-4 w-4" /></button>
                        <button onClick={() => handleDelete(item)} className="text-red-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Layout>
  );
}
