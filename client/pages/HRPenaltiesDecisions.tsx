import { useEffect, useMemo, useState } from "react";
import Layout from "@/components/Layout";
import { Search, Plus, Trash2, Pencil, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n";

type Decision = {
  id: string;
  name_ar: string;
  name_en: string | null;
  status: string;
};

export default function HRPenaltiesDecisions() {
  const { t, direction } = useI18n();
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Decision | null>(null);
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [status, setStatus] = useState("فعال");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("penalty_decisions")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast({ title: t("خطأ في التحميل"), description: error.message, variant: "destructive" });
    else setRows((data as Decision[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          !search ||
          r.name_ar.includes(search) ||
          (r.name_en ?? "").toLowerCase().includes(search.toLowerCase()),
      ),
    [rows, search],
  );

  const openAdd = () => {
    setEditing(null);
    setNameAr("");
    setNameEn("");
    setStatus("فعال");
    setModalOpen(true);
  };

  const openEdit = (d: Decision) => {
    setEditing(d);
    setNameAr(d.name_ar);
    setNameEn(d.name_en ?? "");
    setStatus(d.status);
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!nameAr.trim()) {
      toast({ title: t("خطأ"), description: t("الوصف بالعربية مطلوب"), variant: "destructive" });
      return;
    }
    setSaving(true);
    if (editing) {
      const { error } = await supabase
        .from("penalty_decisions")
        .update({ name_ar: nameAr, name_en: nameEn, status })
        .eq("id", editing.id);
      if (error) {
        toast({ title: t("تعذّر الحفظ"), description: error.message, variant: "destructive" });
        setSaving(false);
        return;
      }
    } else {
      const { error } = await supabase
        .from("penalty_decisions")
        .insert([{ id: crypto.randomUUID(), name_ar: nameAr, name_en: nameEn, status }]);
      if (error) {
        toast({ title: t("تعذّر الحفظ"), description: error.message, variant: "destructive" });
        setSaving(false);
        return;
      }
    }
    setSaving(false);
    setModalOpen(false);
    toast({ title: t("تم الحفظ بنجاح") });
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("هل تريد حذف هذا القرار؟"))) return;
    const { error } = await supabase.from("penalty_decisions").delete().eq("id", id);
    if (error) {
      toast({ title: t("تعذّر الحذف"), description: error.message, variant: "destructive" });
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== id));
    toast({ title: t("تم الحذف") });
  };

  return (
    <Layout>
      <div className="p-6 max-w-[1200px] mx-auto space-y-6" dir={direction}>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-800">{t("القرارات النهائية")}</h2>
            <Button onClick={openAdd} className="bg-[#004e89] hover:bg-[#003865] text-white flex items-center gap-2">
              <Plus className="h-4 w-4" /> {t("إضافة قرار")}
            </Button>
          </div>

          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="relative w-72">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder={t("بحث")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-3 pr-9 h-10"
                />
              </div>
            </div>

            <div className="overflow-x-auto border border-gray-100 rounded-lg mt-4">
              <table className="w-full text-sm text-right">
                <thead className="bg-[#004e89] text-white">
                  <tr>
                    <th className="py-3 px-4 font-medium w-24">{t("معرف")}</th>
                    <th className="py-3 px-4 font-medium min-w-[200px]">{t("الوصف بالعربية")}</th>
                    <th className="py-3 px-4 font-medium min-w-[200px]">{t("الوصف بالإنجليزية")}</th>
                    <th className="py-3 px-4 font-medium">{t("الحالة")}</th>
                    <th className="py-3 px-4 font-medium text-center w-32">{t("الأمر")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {loading ? (
                    <tr>
                      <td colSpan={5} className="py-10 text-center">
                        <Loader2 className="h-6 w-6 animate-spin mx-auto text-[#004e89]" />
                      </td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-gray-500 font-medium bg-gray-50/30">
                        {t("لا توجد بيانات في الجدول")}
                      </td>
                    </tr>
                  ) : (
                    filtered.map((d, i) => (
                      <tr key={d.id} className="hover:bg-gray-50">
                        <td className="py-3 px-4 text-gray-500">{i + 1}</td>
                        <td className="py-3 px-4 font-medium text-gray-800">{d.name_ar}</td>
                        <td className="py-3 px-4 text-gray-600">{d.name_en || "-"}</td>
                        <td className="py-3 px-4">
                          <span
                            className={
                              "px-2 py-0.5 rounded-full text-xs " +
                              (d.status === "فعال" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600")
                            }
                          >
                            {t(d.status)}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-center gap-2">
                            <button onClick={() => openEdit(d)} className="text-blue-500 hover:text-blue-700" title={t("تعديل")} aria-label={t("تعديل")}>
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button onClick={() => handleDelete(d.id)} className="text-red-500 hover:text-red-700" title={t("حذف")} aria-label={t("حذف")}>
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between text-sm text-gray-500 pt-2">
              <span>{t("يعرض")} {filtered.length} {t("من أصل")} {rows.length} {t("سجل")}</span>
            </div>
          </div>
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" dir={direction}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-bold text-gray-800">{editing ? t("تعديل القرار") : t("إضافة قرار نهائي")}</h3>
              <button onClick={() => setModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("الوصف بالعربية")} *</label>
                <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} placeholder={t("مثال: إنذار كتابي")} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("الوصف بالإنجليزية")}</label>
                <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} placeholder="Written warning" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("الحالة")}</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                >
                  <option value="فعال">{t("فعال")}</option>
                  <option value="غير فعال">{t("غير فعال")}</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 p-4 border-t">
              <Button variant="outline" onClick={() => setModalOpen(false)}>{t("إلغاء")}</Button>
              <Button onClick={handleSave} disabled={saving} className="bg-[#004e89] hover:bg-[#003865] text-white">
                {saving ? t("جاري الحفظ...") : t("حفظ")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
