import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { Search, Plus, Edit, Trash2, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n";
import { hrRequestErrorText } from "@/lib/hrErrors";

type Reason = { id: string; reason: string; effect: string };

export default function HRTerminationReasons() {
  const { t, direction } = useI18n();
  const [items, setItems] = useState<Reason[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formReason, setFormReason] = useState("");
  const [formEffect, setFormEffect] = useState("no_effect");
  const [saving, setSaving] = useState(false);

  const effectLabels: Record<string, string> = {
    no_effect: "لا يؤدي إلى حرمان الموظف من مكافأة نهاية الخدمة",
    has_effect: "يؤدي إلى حرمان الموظف من مكافأة نهاية الخدمة",
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from("termination_reasons").select("*").order("id");
      if (error) throw error;
      setItems((data ?? []).map((r: any) => ({ id: String(r.id), reason: r.reason ?? "", effect: r.effect ?? "" })));
    } catch (error) {
      toast({ title: t("تعذر تحميل الأسباب"), description: t(hrRequestErrorText(error)), variant: "destructive" });
    } finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, []);

  const resetForm = () => { setShowForm(false); setEditingId(null); setFormReason(""); setFormEffect("no_effect"); };

  const startEdit = (item: Reason) => {
    setEditingId(item.id); setFormReason(item.reason);
    setFormEffect(item.effect.includes("حرمان") && !item.effect.includes("لا ") ? "has_effect" : "no_effect");
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!formReason.trim()) { toast({ title: t("خطأ"), description: t("السبب مطلوب"), variant: "destructive" }); return; }
    setSaving(true);
    try {
      const payload = { reason: formReason.trim(), effect: effectLabels[formEffect] };
      if (editingId) {
        const { data, error } = await supabase.from("termination_reasons").update(payload).eq("id", editingId).select("id");
        if (error) throw error;
        if (!data?.length) throw new Error(t("لم يُحفظ التعديل: لا تملك صلاحية تعديل هذا السبب"));
        toast({ title: t("تم التعديل") });
      } else {
        const { error } = await supabase.from("termination_reasons").insert([payload]);
        if (error) throw error;
        toast({ title: t("تمت الإضافة") });
      }
      resetForm(); await loadData();
    } catch (error) {
      toast({ title: t("تعذر الحفظ"), description: t(hrRequestErrorText(error)), variant: "destructive" });
    } finally { setSaving(false); }
  };

  const handleDelete = async (item: Reason) => {
    if (!confirm(`${t("حذف")} "${item.reason}"؟`)) return;
    const { data, error } = await supabase.from("termination_reasons").delete().eq("id", item.id).select("id");
    if (error || !data?.length) {
      toast({
        title: t("تعذر الحذف"),
        description: error ? t(hrRequestErrorText(error)) : t("لم يُحذف شيء: لا تملك صلاحية حذف هذا السبب"),
        variant: "destructive",
      });
      return;
    }
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    toast({ title: t("تم الحذف") });
  };

  const filtered = items.filter((i) => !search || i.reason.includes(search));

  return (
    <Layout>
      <div className="p-6 max-w-[1600px] mx-auto space-y-6" dir={direction}>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">{t("أسباب إنهاء الخدمة")}</h1>
          <Button onClick={() => { resetForm(); setShowForm(true); }} className="bg-[#004e89] hover:bg-[#003865]">
            <Plus className="h-4 w-4 ml-2" /> {t("إضافة سبب جديد")}
          </Button>
        </div>

        {showForm && (
          <div className="bg-white rounded-lg border shadow-sm p-6 space-y-4">
            <h3 className="font-bold text-lg">{editingId ? t("تعديل السبب") : t("إضافة سبب جديد")}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium mb-1">{t("السبب")} *</label><Input value={formReason} onChange={(e) => setFormReason(e.target.value)} /></div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("تأثيره على مكافأة نهاية الخدمة")}</label>
                <select value={formEffect} onChange={(e) => setFormEffect(e.target.value)} className="w-full h-10 border rounded-md px-3 bg-white text-sm">
                  <option value="no_effect">{t(effectLabels.no_effect)}</option>
                  <option value="has_effect">{t(effectLabels.has_effect)}</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={saving} className="bg-[#004e89] hover:bg-[#003865]"><Save className="h-4 w-4 ml-1" /> {saving ? t("جاري الحفظ...") : t("حفظ")}</Button>
              <Button variant="outline" onClick={resetForm}><X className="h-4 w-4 ml-1" /> {t("إلغاء")}</Button>
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
          <div className="p-4 border-b flex justify-between items-center">
            <div className="relative w-72">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input placeholder={t("بحث...")} value={search} onChange={(e) => setSearch(e.target.value)} className="pr-9" />
            </div>
            <span className="text-sm text-gray-500">{filtered.length} {t("سجل")}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="bg-[#004e89] text-white">
                <tr>
                  <th className="py-3 px-4 font-medium w-16">#</th>
                  <th className="py-3 px-4 font-medium">{t("السبب")}</th>
                  <th className="py-3 px-4 font-medium">{t("تأثيره على مكافأة نهاية الخدمة")}</th>
                  <th className="py-3 px-4 font-medium text-center w-24">{t("الإجراءات")}</th>
                </tr>
              </thead>
              <tbody className="divide-y bg-white">
                {loading ? (
                  <tr><td colSpan={4} className="text-center py-8 text-gray-400">{t("جاري التحميل...")}</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={4} className="text-center py-8 text-gray-400">{t("لا توجد بيانات")}</td></tr>
                ) : filtered.map((item, i) => (
                  <tr key={item.id} className="hover:bg-gray-50/50">
                    <td className="py-3 px-4">{i + 1}</td>
                    <td className="py-3 px-4 font-medium">{item.reason}</td>
                    <td className="py-3 px-4">{t(item.effect)}</td>
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
