import { useEffect, useState } from "react";
import { Plus, Search, Edit, Trash2, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import { hrRequestErrorText } from "@/lib/hrErrors";

const NO_ROWS_MESSAGE = "لم يُحفظ شيء: السجل غير موجود أو لا تملك صلاحية هذه العملية";
const configErrorText = (error: unknown) =>
  (error as { code?: string } | null)?.code === "23503"
    ? "مرتبط بسجلات أخرى؛ لا يمكن حذفه"
    : hrRequestErrorText(error, "تعذر حفظ البيانات");

type ConfigItem = {
  id: string;
  nameAr: string;
  nameEn: string;
  value: string;
  description: string;
  status: string;
};

type Props = {
  title: string;
  configType: string;
  valueLabel?: string;
  showValue?: boolean;
};

export default function HRConfigPage({ title, configType, valueLabel = "القيمة", showValue = true }: Props) {
  const { t, direction } = useI18n();
  const [items, setItems] = useState<ConfigItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formNameAr, setFormNameAr] = useState("");
  const [formNameEn, setFormNameEn] = useState("");
  const [formValue, setFormValue] = useState("");
  const [saving, setSaving] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("hr_config_items")
        .select("*")
        .eq("config_type", configType)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      if (data) setItems(data.map((r) => ({
        id: String(r.id), nameAr: String(r.name_ar ?? ""), nameEn: String(r.name_en ?? ""),
        value: String(r.value ?? ""), description: String(r.description ?? ""), status: String(r.status ?? "فعال"),
      })));
    } catch (error) {
      toast({ title: t("تعذر تحميل البيانات"), description: t(hrRequestErrorText(error)), variant: "destructive" });
    } finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, [configType]);

  const resetForm = () => { setShowForm(false); setEditingId(null); setFormNameAr(""); setFormNameEn(""); setFormValue(""); };

  const startEdit = (item: ConfigItem) => {
    setEditingId(item.id); setFormNameAr(item.nameAr); setFormNameEn(item.nameEn); setFormValue(item.value); setShowForm(true);
  };

  const handleSave = async () => {
    if (!formNameAr.trim()) { toast({ title: t("خطأ"), description: t("الوصف بالعربية مطلوب"), variant: "destructive" }); return; }
    setSaving(true);
    try {
      if (editingId) {
        const { data, error } = await supabase.from("hr_config_items").update({ name_ar: formNameAr, name_en: formNameEn, value: formValue }).eq("id", editingId).select("id");
        if (error) throw error;
        if (!data?.length) throw new Error(NO_ROWS_MESSAGE);
      } else {
        const { error } = await supabase.from("hr_config_items").insert([{ config_type: configType, name_ar: formNameAr, name_en: formNameEn, value: formValue }]);
        if (error) throw error;
      }
      toast({ title: editingId ? t("تم التعديل") : t("تمت الإضافة") });
      resetForm(); loadData();
    } catch (error) {
      toast({ title: t("خطأ"), description: t(configErrorText(error)), variant: "destructive" });
    } finally { setSaving(false); }
  };

  const handleDelete = async (item: ConfigItem) => {
    if (!confirm(`${t("حذف")} "${item.nameAr}"؟`)) return;
    const { data, error } = await supabase.from("hr_config_items").delete().eq("id", item.id).select("id");
    if (error || !data?.length) {
      toast({ title: t("لم يتم الحذف"), description: t(error ? configErrorText(error) : NO_ROWS_MESSAGE), variant: "destructive" });
      return;
    }
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    toast({ title: t("تم الحذف") });
  };

  const filtered = items.filter((i) => !searchTerm || i.nameAr.includes(searchTerm) || i.nameEn.includes(searchTerm));

  return (
    <Layout>
      <div className="space-y-6 p-6 max-w-[1200px] mx-auto" dir={direction}>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">{t(title)}</h1>
          <Button className="bg-[#004e89] hover:bg-[#003b6d]" onClick={() => { resetForm(); setShowForm(true); }}>
            <Plus className="h-5 w-5 ml-2" /> {t("إضافة جديد")}
          </Button>
        </div>

        {showForm && (
          <div className="bg-white rounded-lg border shadow-sm p-6 space-y-4">
            <h3 className="font-bold text-lg">{editingId ? t("تعديل") : t("إضافة جديد")}</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div><label className="block text-sm font-medium mb-1">{t("الوصف بالعربية")} *</label><Input value={formNameAr} onChange={(e) => setFormNameAr(e.target.value)} /></div>
              <div><label className="block text-sm font-medium mb-1">{t("الوصف بالإنجليزية")}</label><Input value={formNameEn} onChange={(e) => setFormNameEn(e.target.value)} /></div>
              {showValue && <div><label className="block text-sm font-medium mb-1">{t(valueLabel)}</label><Input value={formValue} onChange={(e) => setFormValue(e.target.value)} /></div>}
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={saving} className="bg-[#004e89] hover:bg-[#003b6d]"><Save className="h-4 w-4 ml-1" /> {saving ? t("جاري الحفظ...") : t("حفظ")}</Button>
              <Button variant="outline" onClick={resetForm}><X className="h-4 w-4 ml-1" /> {t("إلغاء")}</Button>
            </div>
          </div>
        )}

        <div className="bg-white rounded-md border shadow-sm">
          <div className="p-4 border-b flex justify-between items-center">
            <div className="relative w-64">
              <Search className="absolute right-3 top-2.5 h-4 w-4 text-gray-400" />
              <Input placeholder={t("بحث...")} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pr-9" />
            </div>
            <span className="text-sm text-gray-500">{filtered.length} {t("سجل")}</span>
          </div>

          <Table>
            <TableHeader className="bg-[#004e89]">
              <TableRow>
                <TableHead className="text-white text-right w-12">#</TableHead>
                <TableHead className="text-white text-right">{t("وصف (عربي)")}</TableHead>
                <TableHead className="text-white text-right">{t("وصف (إنجليزي)")}</TableHead>
                {showValue && <TableHead className="text-white text-right">{t(valueLabel)}</TableHead>}
                <TableHead className="text-white text-center w-24">{t("الإجراءات")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={showValue ? 5 : 4} className="text-center py-8 text-gray-400">{t("جاري التحميل...")}</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={showValue ? 5 : 4} className="text-center py-8 text-gray-400">{t("لا توجد بيانات")}</TableCell></TableRow>
              ) : filtered.map((item, i) => (
                <TableRow key={item.id}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell className="font-medium">{item.nameAr}</TableCell>
                  <TableCell>{item.nameEn}</TableCell>
                  {showValue && <TableCell>{item.value}</TableCell>}
                  <TableCell>
                    <div className="flex justify-center items-center gap-2">
                      <button onClick={() => startEdit(item)} title={t("تعديل")} aria-label={t("تعديل")} className="text-gray-500 hover:text-[#004e89]"><Edit className="h-4 w-4" /></button>
                      <button onClick={() => handleDelete(item)} title={t("حذف")} aria-label={t("حذف")} className="text-red-500 hover:text-red-700"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </Layout>
  );
}
