import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { Search, Plus, Edit, Trash2, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n";

type InsuranceItem = {
  id: string; arabicDescription: string; englishDescription: string;
  employeeShare: string; companyShare: string; includeAllowances: string; allowances: string;
};

export default function HRInsuranceList() {
  const { t, direction } = useI18n();
  const [items, setItems] = useState<InsuranceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formAr, setFormAr] = useState("");
  const [formEn, setFormEn] = useState("");
  const [formEmpShare, setFormEmpShare] = useState("0");
  const [formCompShare, setFormCompShare] = useState("0");
  const [formInclude, setFormInclude] = useState("لا");
  const [saving, setSaving] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const { data } = await supabase.from("insurance_records").select("*").order("id");
      if (data) setItems(data.map((r: any) => ({
        id: String(r.id), arabicDescription: r.description_ar ?? "", englishDescription: r.description_en ?? "",
        employeeShare: r.employee_share ?? "0%", companyShare: r.company_share ?? "0%",
        includeAllowances: r.include_allowances ? t("نعم") : t("لا"), allowances: r.allowances ?? "",
      })));
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, []);

  const resetForm = () => { setShowForm(false); setEditingId(null); setFormAr(""); setFormEn(""); setFormEmpShare("0"); setFormCompShare("0"); setFormInclude("لا"); };

  const startEdit = (item: InsuranceItem) => {
    setEditingId(item.id); setFormAr(item.arabicDescription); setFormEn(item.englishDescription);
    setFormEmpShare(item.employeeShare.replace("%", "")); setFormCompShare(item.companyShare.replace("%", ""));
    setFormInclude(item.includeAllowances); setShowForm(true);
  };

  const handleSave = async () => {
    if (!formAr.trim()) { toast({ title: t("خطأ"), description: t("الوصف بالعربية مطلوب"), variant: "destructive" }); return; }
    setSaving(true);
    try {
      const payload = {
        description_ar: formAr, description_en: formEn,
        employee_share: formEmpShare + "%", company_share: formCompShare + "%",
        include_allowances: formInclude === "نعم",
      };
      if (editingId) {
        await supabase.from("insurance_records").update(payload).eq("id", editingId);
        toast({ title: t("تم التعديل") });
      } else {
        await supabase.from("insurance_records").insert([payload]);
        toast({ title: t("تمت الإضافة") });
      }
      resetForm(); loadData();
    } catch { toast({ title: t("خطأ"), variant: "destructive" }); } finally { setSaving(false); }
  };

  const handleDelete = async (item: InsuranceItem) => {
    if (!confirm(`${t("حذف")} "${item.arabicDescription}"؟`)) return;
    await supabase.from("insurance_records").delete().eq("id", item.id);
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    toast({ title: t("تم الحذف") });
  };

  const filtered = items.filter((i) => !search || i.arabicDescription.includes(search) || i.englishDescription.toLowerCase().includes(search.toLowerCase()));

  return (
    <Layout>
      <div className="p-6 max-w-[1600px] mx-auto space-y-6" dir={direction}>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">{t("قائمة التأمينات الاجتماعية")}</h1>
          <Button onClick={() => { resetForm(); setShowForm(true); }} className="bg-[#004e89] hover:bg-[#003865]">
            <Plus className="h-4 w-4 ml-2" /> {t("إضافة تأمين")}
          </Button>
        </div>

        {showForm && (
          <div className="bg-white rounded-lg border shadow-sm p-6 space-y-4">
            <h3 className="font-bold text-lg">{editingId ? t("تعديل") : t("إضافة تأمين اجتماعي")}</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div><label className="block text-sm font-medium mb-1">{t("الوصف بالعربية")} *</label><Input value={formAr} onChange={(e) => setFormAr(e.target.value)} /></div>
              <div><label className="block text-sm font-medium mb-1">{t("الوصف بالإنجليزية")}</label><Input value={formEn} onChange={(e) => setFormEn(e.target.value)} /></div>
              <div><label className="block text-sm font-medium mb-1">{t("نسبة الموظف")} %</label><Input type="number" value={formEmpShare} onChange={(e) => setFormEmpShare(e.target.value)} /></div>
              <div><label className="block text-sm font-medium mb-1">{t("نسبة المنشأة")} %</label><Input type="number" value={formCompShare} onChange={(e) => setFormCompShare(e.target.value)} /></div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("شمول البدلات")}</label>
                <select value={formInclude} onChange={(e) => setFormInclude(e.target.value)} className="w-full h-10 border rounded-md px-3 bg-white text-sm">
                  <option value="لا">{t("لا")}</option>
                  <option value="نعم">{t("نعم")}</option>
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
            <table className="w-full text-sm text-right min-w-[1000px]">
              <thead className="bg-[#004e89] text-white">
                <tr>
                  <th className="py-3 px-4 font-medium w-12">#</th>
                  <th className="py-3 px-4 font-medium">{t("الوصف بالعربية")}</th>
                  <th className="py-3 px-4 font-medium">{t("الوصف بالإنجليزية")}</th>
                  <th className="py-3 px-4 font-medium">{t("نسبة الموظف")}</th>
                  <th className="py-3 px-4 font-medium">{t("نسبة المنشأة")}</th>
                  <th className="py-3 px-4 font-medium">{t("شمول البدلات")}</th>
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
                    <td className="py-3 px-4 font-medium">{item.arabicDescription}</td>
                    <td className="py-3 px-4">{item.englishDescription}</td>
                    <td className="py-3 px-4">{item.employeeShare}</td>
                    <td className="py-3 px-4">{item.companyShare}</td>
                    <td className="py-3 px-4">{item.includeAllowances}</td>
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
