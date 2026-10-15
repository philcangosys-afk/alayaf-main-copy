import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { Search, Plus, Edit, Trash2, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n";

type LeaveType = {
  id: string;
  name: string;
  name_en: string;
  max_days: number;
  deduction_percent: number;
  paid: boolean;
  affects_balance: boolean;
  gender: string;
  status: string;
};

const ACTIVE_STATUS = "مفعلة";
const INACTIVE_STATUS = "غير مفعلة";
const INACTIVE_SPELLINGS = ["غير مفعلة", "غير مفعل", "معطلة", "معطل", "غير فعال", "غير فعالة", "موقوفة", "موقوف", "inactive", "disabled"];
const isInactiveStatus = (status: unknown) => INACTIVE_SPELLINGS.includes(String(status ?? "").trim().toLowerCase());

export default function HRLeavesTypes() {
  const { t, direction } = useI18n();
  const [items, setItems] = useState<LeaveType[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formName, setFormName] = useState("");
  const [formNameEn, setFormNameEn] = useState("");
  const [formDays, setFormDays] = useState("1");
  const [formDeduction, setFormDeduction] = useState("0");
  const [formPaid, setFormPaid] = useState(true);
  const [formAffects, setFormAffects] = useState(true);
  const [formGender, setFormGender] = useState("both");
  const [formStatus, setFormStatus] = useState(ACTIVE_STATUS);
  // عمود الحالة يُرسل فقط إن كان موجودًا فعلًا في صفوف الجدول المحمّلة
  const [hasStatusColumn, setHasStatusColumn] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from("leave_types").select("*").order("id");
      if (error) throw error;
      setHasStatusColumn(Boolean(data?.length) && Object.prototype.hasOwnProperty.call(data[0], "status"));
      if (data) setItems(data.map((r: any) => ({
        id: String(r.id), name: r.name ?? "", name_en: r.name_en ?? "",
        max_days: r.max_days ?? 0, deduction_percent: r.deduction_percent ?? 0,
        paid: r.is_paid ?? true, affects_balance: r.affects_balance ?? true,
        gender: r.gender ?? "both", status: r.status ?? ACTIVE_STATUS,
      })));
    } catch (error) {
      toast({ title: t("تعذر تحميل تصنيفات الإجازات"), description: error instanceof Error ? error.message : t("حدث خطأ غير متوقع"), variant: "destructive" });
    } finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, []);

  const resetForm = () => {
    setShowForm(false); setEditingId(null);
    setFormName(""); setFormNameEn(""); setFormDays("1");
    setFormDeduction("0"); setFormPaid(true); setFormAffects(true); setFormGender("both");
    setFormStatus(ACTIVE_STATUS);
  };

  const startEdit = (item: LeaveType) => {
    setEditingId(item.id); setFormName(item.name); setFormNameEn(item.name_en);
    setFormDays(String(item.max_days)); setFormDeduction(String(item.deduction_percent));
    setFormPaid(item.paid); setFormAffects(item.affects_balance); setFormGender(item.gender);
    setFormStatus(isInactiveStatus(item.status) ? INACTIVE_STATUS : ACTIVE_STATUS);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) { toast({ title: t("خطأ"), description: t("اسم التصنيف مطلوب"), variant: "destructive" }); return; }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: formName.trim(), name_en: formNameEn.trim(), max_days: Number(formDays),
        deduction_percent: Number(formDeduction), is_paid: formPaid,
        affects_balance: formAffects, gender: formGender,
      };
      if (hasStatusColumn) payload.status = formStatus;
      if (editingId) {
        const { data, error } = await supabase.from("leave_types").update(payload).eq("id", editingId).select("id");
        if (error) throw error;
        if (!data?.length) throw new Error(t("لم يُحفظ التعديل: لا تملك صلاحية تعديل هذا التصنيف"));
        toast({ title: t("تم التعديل بنجاح") });
      } else {
        const { error } = await supabase.from("leave_types").insert([payload]);
        if (error) throw error;
        toast({ title: t("تمت الإضافة بنجاح") });
      }
      resetForm();
      await loadData();
    } catch (error) {
      toast({ title: t("تعذر حفظ التصنيف"), description: (error as { message?: string } | null)?.message || t("حدث خطأ غير متوقع"), variant: "destructive" });
    } finally { setSaving(false); }
  };

  const handleDelete = async (item: LeaveType) => {
    if (!confirm(`${t("حذف")} "${item.name}"؟`)) return;
    const { data, error } = await supabase.from("leave_types").delete().eq("id", item.id).select("id");
    if (error || !data?.length) {
      toast({ title: t("تعذر حذف التصنيف"), description: error?.message || t("لم يُحذف شيء: لا تملك صلاحية حذف هذا التصنيف"), variant: "destructive" });
      return;
    }
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    toast({ title: t("تم الحذف") });
  };

  const filtered = items.filter((i) => !search || i.name.includes(search) || i.name_en.toLowerCase().includes(search.toLowerCase()));

  return (
    <Layout>
      <div className="p-6 max-w-[1400px] mx-auto space-y-6" dir={direction}>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">{t("تصنيف الإجازات")}</h1>
          <Button onClick={() => { resetForm(); setShowForm(true); }} className="bg-[#004e89] hover:bg-[#003865]">
            <Plus className="h-4 w-4 ml-2" /> {t("تصنيف جديد")}
          </Button>
        </div>

        {showForm && (
          <div className="bg-white rounded-lg border shadow-sm p-6 space-y-4">
            <h3 className="font-bold text-lg">{editingId ? t("تعديل التصنيف") : t("تصنيف جديد")}</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div><label className="block text-sm font-medium mb-1">{t("الاسم بالعربية")} *</label><Input value={formName} onChange={(e) => setFormName(e.target.value)} /></div>
              <div><label className="block text-sm font-medium mb-1">{t("الاسم بالإنجليزية")}</label><Input value={formNameEn} onChange={(e) => setFormNameEn(e.target.value)} /></div>
              <div><label className="block text-sm font-medium mb-1">{t("مدة الإجازة (يوم)")}</label><Input type="number" value={formDays} onChange={(e) => setFormDays(e.target.value)} /></div>
              <div><label className="block text-sm font-medium mb-1">{t("نسبة الخصم (%)")}</label><Input type="number" min={0} max={100} value={formDeduction} onChange={(e) => setFormDeduction(e.target.value)} /><p className="mt-1 text-[11px] text-gray-500">{t("تُخصم من الراتب لكل يوم من الإجازة. الإجازة المرضية تُحسب تلقائيًا حسب المادة 117 ولا تُستخدم نسبتها.")}</p></div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("إجازة مدفوعة")}</label>
                <div className="flex gap-4 h-10 items-center">
                  <label className="flex items-center gap-2 cursor-pointer"><input type="radio" checked={formPaid} onChange={() => setFormPaid(true)} /><span>{t("نعم")}</span></label>
                  <label className="flex items-center gap-2 cursor-pointer"><input type="radio" checked={!formPaid} onChange={() => setFormPaid(false)} /><span>{t("لا")}</span></label>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("تؤثر على الرصيد")}</label>
                <div className="flex gap-4 h-10 items-center">
                  <label className="flex items-center gap-2 cursor-pointer"><input type="radio" checked={formAffects} onChange={() => setFormAffects(true)} /><span>{t("نعم")}</span></label>
                  <label className="flex items-center gap-2 cursor-pointer"><input type="radio" checked={!formAffects} onChange={() => setFormAffects(false)} /><span>{t("لا")}</span></label>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("تقييد الجنس")}</label>
                <select value={formGender} onChange={(e) => setFormGender(e.target.value)} className="w-full h-10 border rounded-md px-3 bg-white text-sm">
                  <option value="both">{t("لكلا الجنسين")}</option>
                  <option value="male">{t("ذكور فقط")}</option>
                  <option value="female">{t("إناث فقط")}</option>
                </select>
              </div>
              {hasStatusColumn && (
                <div>
                  <label className="block text-sm font-medium mb-1">{t("الحالة")}</label>
                  <select value={formStatus} onChange={(e) => setFormStatus(e.target.value)} className="w-full h-10 border rounded-md px-3 bg-white text-sm">
                    <option value={ACTIVE_STATUS}>{t("مفعلة")}</option>
                    <option value={INACTIVE_STATUS}>{t("غير مفعلة")}</option>
                  </select>
                </div>
              )}
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
            <table className="w-full text-sm text-right">
              <thead className="bg-[#004e89] text-white">
                <tr>
                  <th className="py-3 px-4 font-medium w-16">#</th>
                  <th className="py-3 px-4 font-medium">{t("اسم التصنيف")}</th>
                  <th className="py-3 px-4 font-medium">{t("مدة الإجازة")}</th>
                  <th className="py-3 px-4 font-medium">{t("نسبة الخصم")}</th>
                  <th className="py-3 px-4 font-medium text-center">{t("الحالة")}</th>
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
                    <td className="py-3 px-4">{item.max_days} {t("يوم")}</td>
                    <td className="py-3 px-4">{item.deduction_percent}%</td>
                    <td className="py-3 px-4 text-center">
                      <span className={`${isInactiveStatus(item.status) ? "bg-gray-100 text-gray-500" : "bg-emerald-50 text-emerald-600"} px-3 py-1 rounded text-xs font-medium`}>{t(item.status)}</span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex justify-center items-center gap-2">
                        <button onClick={() => startEdit(item)} title={t("تعديل")} aria-label={t("تعديل")} className="text-gray-400 hover:text-[#004e89]"><Edit className="h-4 w-4" /></button>
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
