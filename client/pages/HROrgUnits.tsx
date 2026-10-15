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

type Unit = { id: string; name: string; section: string; employee: string; description: string };

export default function HROrgUnits() {
  const { t, direction, formatNumber } = useI18n();
  const [items, setItems] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formSection, setFormSection] = useState("");
  const [formEmployee, setFormEmployee] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [saving, setSaving] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from("org_units").select("*").order("id", { ascending: false });
      if (error) throw error;
      if (data) setItems(data.map((r: any) => ({
        id: String(r.id), name: r.name ?? "", section: r.section ?? "",
        employee: r.employee ?? "", description: r.description ?? "",
      })));
    } catch (error) {
      setItems([]);
      toast({ title: t("تعذر تحميل البيانات"), description: t(hrRequestErrorText(error)), variant: "destructive" });
    } finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, []);

  const resetForm = () => { setShowForm(false); setEditingId(null); setFormName(""); setFormSection(""); setFormEmployee(""); setFormDesc(""); };

  const startEdit = (item: Unit) => {
    setEditingId(item.id); setFormName(item.name); setFormSection(item.section);
    setFormEmployee(item.employee); setFormDesc(item.description); setShowForm(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) { toast({ title: t("خطأ"), description: t("اسم الوحدة مطلوب"), variant: "destructive" }); return; }
    setSaving(true);
    try {
      const payload = { name: formName, section: formSection, employee: formEmployee, description: formDesc };
      if (editingId) {
        const { data, error } = await supabase.from("org_units").update(payload).eq("id", editingId).select("id");
        if (error) throw error;
        if (!data?.length) throw new Error(NO_ROWS_MESSAGE);
      } else {
        const { error } = await supabase.from("org_units").insert([payload]);
        if (error) throw error;
      }
      toast({ title: editingId ? t("تم التعديل") : t("تمت الإضافة") });
      resetForm(); loadData();
    } catch (error) {
      toast({ title: t("خطأ"), description: t(orgErrorText(error)), variant: "destructive" });
    } finally { setSaving(false); }
  };

  const handleDelete = async (item: Unit) => {
    if (!confirm(`${t("حذف")} "${item.name}"؟`)) return;
    const { data, error } = await supabase.from("org_units").delete().eq("id", item.id).select("id");
    if (error || !data?.length) {
      toast({ title: t("لم يتم الحذف"), description: t(error ? orgErrorText(error) : NO_ROWS_MESSAGE), variant: "destructive" });
      return;
    }
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    toast({ title: t("تم الحذف") });
  };

  const filtered = items.filter((i) => !search || i.name.includes(search));

  return (
    <Layout>
      <div className="p-6 max-w-[1600px] mx-auto space-y-6" dir={direction}>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">{t("قائمة الوحدات")}</h1>
          <Button onClick={() => { resetForm(); setShowForm(true); }} className="bg-[#004e89] hover:bg-[#003865]">
            <Plus className="h-4 w-4 me-2" /> {t("إضافة وحدة")}
          </Button>
        </div>

        {showForm && (
          <div className="bg-white rounded-lg border shadow-sm p-6 space-y-4">
            <h3 className="font-bold text-lg">{editingId ? t("تعديل") : t("إضافة وحدة جديدة")}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium mb-1">{t("اسم الوحدة")} *</label><Input value={formName} onChange={(e) => setFormName(e.target.value)} /></div>
              <div><label className="block text-sm font-medium mb-1">{t("القسم")}</label><Input value={formSection} onChange={(e) => setFormSection(e.target.value)} /></div>
              <div><label className="block text-sm font-medium mb-1">{t("الموظف المسؤول")}</label><Input value={formEmployee} onChange={(e) => setFormEmployee(e.target.value)} /></div>
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
                  <th className="py-3 px-4 font-medium">{t("اسم الوحدة")}</th>
                  <th className="py-3 px-4 font-medium">{t("القسم")}</th>
                  <th className="py-3 px-4 font-medium">{t("الموظف")}</th>
                  <th className="py-3 px-4 font-medium">{t("الوصف")}</th>
                  <th className="py-3 px-4 font-medium text-center w-24">{t("الإجراءات")}</th>
                </tr>
              </thead>
              <tbody className="divide-y bg-white">
                {loading ? (
                  <tr><td colSpan={6} className="text-center py-8 text-gray-400">{t("جاري التحميل...")}</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-gray-400">{t("لا توجد بيانات")}</td></tr>
                ) : filtered.map((item, i) => (
                  <tr key={item.id} className="hover:bg-gray-50/50">
                    <td className="py-3 px-4">{i + 1}</td>
                    <td className="py-3 px-4 font-medium">{item.name}</td>
                    <td className="py-3 px-4">{item.section}</td>
                    <td className="py-3 px-4">{item.employee}</td>
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
