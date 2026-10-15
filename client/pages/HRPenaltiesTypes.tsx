import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { Plus, Edit, Trash2, Save, X, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n";
import { hrRequestErrorText } from "@/lib/hrErrors";

type PenaltyType = { id: string; nameAr: string; nameEn: string; limit: string; status: string };

const NO_ROWS_MESSAGE = "لم يُحفظ شيء: السجل غير موجود أو لا تملك صلاحية هذه العملية";
const penaltyErrorText = (error: unknown) =>
  (error as { code?: string } | null)?.code === "23503"
    ? "مرتبط بمخالفات أو سجلات أخرى؛ لا يمكن حذفه"
    : hrRequestErrorText(error, "تعذر حفظ البيانات");

export default function HRPenaltiesTypes() {
  const { t, direction } = useI18n();
  const [items, setItems] = useState<PenaltyType[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formNameAr, setFormNameAr] = useState("");
  const [formNameEn, setFormNameEn] = useState("");
  const [formLimit, setFormLimit] = useState("90");
  const [saving, setSaving] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from("penalty_types").select("*").order("id");
      if (error) toast({ title: t("تعذر تحميل البيانات"), description: t(hrRequestErrorText(error)), variant: "destructive" });
      if (data) setItems(data.map((r: any) => ({
        id: String(r.id), nameAr: r.name_ar ?? r.name ?? "", nameEn: r.name_en ?? "",
        limit: r.day_limit ? `${r.day_limit} ${t("يوم")}` : `90 ${t("يوم")}`, status: r.status ?? "فعال",
      })));
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, []);

  const resetForm = () => { setShowForm(false); setEditingId(null); setFormNameAr(""); setFormNameEn(""); setFormLimit("90"); };

  const startEdit = (item: PenaltyType) => {
    setEditingId(item.id); setFormNameAr(item.nameAr); setFormNameEn(item.nameEn);
    setFormLimit(item.limit.replace(` ${t("يوم")}`, "")); setShowForm(true);
  };

  const handleSave = async () => {
    if (!formNameAr.trim()) { toast({ title: t("خطأ"), description: t("الاسم مطلوب"), variant: "destructive" }); return; }
    setSaving(true);
    try {
      const payload = { name_ar: formNameAr, name_en: formNameEn, day_limit: Number(formLimit) || 90 };
      if (editingId) {
        // select() يكشف التعديل الذي منعته الصلاحيات (0 صفوف) بدل إظهار نجاح وهمي
        const { data, error } = await supabase.from("penalty_types").update(payload).eq("id", editingId).select("id");
        if (error) throw error;
        if (!data?.length) throw new Error(NO_ROWS_MESSAGE);
      } else {
        const { error } = await supabase.from("penalty_types").insert([payload]);
        if (error) throw error;
      }
      toast({ title: editingId ? t("تم التعديل") : t("تمت الإضافة") });
      resetForm(); loadData();
    } catch (error) {
      toast({ title: t("خطأ"), description: t(penaltyErrorText(error)), variant: "destructive" });
    } finally { setSaving(false); }
  };

  const handleDelete = async (item: PenaltyType) => {
    if (!confirm(`${t("حذف")} "${item.nameAr}"؟`)) return;
    const { data, error } = await supabase.from("penalty_types").delete().eq("id", item.id).select("id");
    if (error || !data?.length) {
      toast({ title: t("لم يتم الحذف"), description: t(error ? penaltyErrorText(error) : NO_ROWS_MESSAGE), variant: "destructive" });
      return;
    }
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    toast({ title: t("تم الحذف") });
  };

  const filtered = items.filter((i) => !search || i.nameAr.includes(search) || i.nameEn.includes(search));

  return (
    <Layout>
      <div className="p-6 max-w-[1600px] mx-auto space-y-6" dir={direction}>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">{t("أنواع المخالفات")}</h1>
          <Button onClick={() => { resetForm(); setShowForm(true); }} className="bg-[#004e89] hover:bg-[#003865]">
            <Plus className="h-4 w-4 ml-2" /> {t("إضافة نوع")}
          </Button>
        </div>

        {showForm && (
          <div className="bg-white rounded-lg border shadow-sm p-6 space-y-4">
            <h3 className="font-bold text-lg">{editingId ? t("تعديل") : t("إضافة نوع مخالفة")}</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div><label className="block text-sm font-medium mb-1">{t("الاسم بالعربية")} *</label><Input value={formNameAr} onChange={(e) => setFormNameAr(e.target.value)} /></div>
              <div><label className="block text-sm font-medium mb-1">{t("الاسم بالإنجليزية")}</label><Input value={formNameEn} onChange={(e) => setFormNameEn(e.target.value)} /></div>
              <div><label className="block text-sm font-medium mb-1">{t("عدد الأيام المسموحة")}</label><Input type="number" value={formLimit} onChange={(e) => setFormLimit(e.target.value)} /></div>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={saving} className="bg-[#004e89] hover:bg-[#003865]"><Save className="h-4 w-4 ml-1" /> {saving ? t("جاري الحفظ...") : t("حفظ")}</Button>
              <Button variant="outline" onClick={resetForm}><X className="h-4 w-4 ml-1" /> {t("إلغاء")}</Button>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <div className="p-4 border-b flex justify-between items-center">
            <div className="relative w-72">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input placeholder={t("بحث...")} value={search} onChange={(e) => setSearch(e.target.value)} className="pr-9" />
            </div>
            <span className="text-sm text-gray-500">{filtered.length} {t("سجل")}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-center whitespace-nowrap">
              <thead className="bg-[#004e89] text-white">
                <tr>
                  <th className="py-3 px-4 font-medium w-12">#</th>
                  <th className="py-3 px-4 font-medium text-right">{t("الاسم بالعربية")}</th>
                  <th className="py-3 px-4 font-medium text-right">{t("الاسم بالإنجليزية")}</th>
                  <th className="py-3 px-4 font-medium">{t("الأيام المسموحة")}</th>
                  <th className="py-3 px-4 font-medium">{t("الحالة")}</th>
                  <th className="py-3 px-4 font-medium w-24">{t("الإجراءات")}</th>
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
                    <td className="py-3 px-4 text-right">{item.nameAr}</td>
                    <td className="py-3 px-4 text-right">{item.nameEn}</td>
                    <td className="py-3 px-4">{item.limit}</td>
                    <td className="py-3 px-4">
                      <span className="bg-emerald-100 text-emerald-700 px-2 py-1 rounded text-xs">{t(item.status)}</span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex justify-center items-center gap-2">
                        <button onClick={() => startEdit(item)} title={t("تعديل")} aria-label={t("تعديل")} className="text-gray-400 hover:text-blue-500"><Edit className="h-4 w-4" /></button>
                        <button onClick={() => handleDelete(item)} title={t("حذف")} aria-label={t("حذف")} className="text-red-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
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
