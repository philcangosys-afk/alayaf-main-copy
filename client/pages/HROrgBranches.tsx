import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Printer, FileText, Plus, Trash2, Edit, Save, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n";
import { hrRequestErrorText } from "@/lib/hrErrors";
import { exportReportExcel, printReport } from "@/lib/reportExport";

type BranchRow = { id: string; name: string; nameEn: string; address: string; phone: string; status: string };

const NO_ROWS_MESSAGE = "لم يُحفظ شيء: السجل غير موجود أو لا تملك صلاحية هذه العملية";
const orgErrorText = (error: unknown) =>
  (error as { code?: string } | null)?.code === "23503"
    ? "مرتبط بموظفين أو سجلات أخرى؛ لا يمكن حذفه"
    : hrRequestErrorText(error, "تعذر حفظ البيانات");

export default function HROrgBranches() {
  const { t, direction, formatNumber } = useI18n();
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formNameEn, setFormNameEn] = useState("");
  const [formAddress, setFormAddress] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [saving, setSaving] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from("branches").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      if (data) setBranches(data.map((r) => ({
        id: String(r.id), name: String(r.name ?? ""), nameEn: String(r.name_en ?? ""),
        address: String(r.address ?? ""), phone: String(r.phone ?? ""), status: String(r.status ?? "فعال"),
      })));
    } catch (error) {
      toast({ title: t("تعذر تحميل البيانات"), description: t(hrRequestErrorText(error)), variant: "destructive" });
    } finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, []);

  const handleDelete = async (b: BranchRow) => {
    if (!confirm(`${t("حذف الفرع")} "${b.name}"؟`)) return;
    const { data, error } = await supabase.from("branches").delete().eq("id", b.id).select("id");
    if (error || !data?.length) {
      toast({ title: t("لم يتم الحذف"), description: t(error ? orgErrorText(error) : NO_ROWS_MESSAGE), variant: "destructive" });
      return;
    }
    setBranches((prev) => prev.filter((d) => d.id !== b.id));
    toast({ title: t("تم الحذف") });
  };

  const handleSave = async () => {
    if (!formName.trim()) { toast({ title: t("خطأ"), description: t("اسم الفرع مطلوب"), variant: "destructive" }); return; }
    const payload = { name: formName, name_en: formNameEn, address: formAddress, phone: formPhone };
    setSaving(true);
    try {
      if (editingId) {
        const { data, error } = await supabase.from("branches").update(payload).eq("id", editingId).select("id");
        if (error) throw error;
        if (!data?.length) throw new Error(NO_ROWS_MESSAGE);
      } else {
        const { error } = await supabase.from("branches").insert([payload]);
        if (error) throw error;
      }
      toast({ title: editingId ? t("تم التعديل") : t("تمت الإضافة") });
      resetForm(); loadData();
    } catch (error) {
      toast({ title: t("خطأ"), description: t(orgErrorText(error)), variant: "destructive" });
    } finally { setSaving(false); }
  };

  const reportOptions = () => ({
    title: "قائمة الفروع",
    fileName: "branches",
    columns: [
      { key: "name", label: "اسم الفرع", width: 24 },
      { key: "nameEn", label: "الاسم بالإنجليزية", width: 24 },
      { key: "address", label: "العنوان", width: 30 },
      { key: "phone", label: "الهاتف", width: 16 },
      { key: "status", label: "الحالة", width: 12 },
    ],
    rows: branches.map((row) => ({ name: row.name, nameEn: row.nameEn, address: row.address, phone: row.phone, status: row.status })),
  });
  const handlePrint = () => {
    if (!printReport(reportOptions())) toast({ title: t("تعذر فتح نافذة الطباعة"), description: t("اسمح بالنوافذ المنبثقة ثم أعد المحاولة"), variant: "destructive" });
  };
  const handleExport = () => exportReportExcel(reportOptions());

  const startEdit = (b: BranchRow) => {
    setEditingId(b.id); setFormName(b.name); setFormNameEn(b.nameEn); setFormAddress(b.address); setFormPhone(b.phone); setShowForm(true);
  };

  const resetForm = () => { setShowForm(false); setEditingId(null); setFormName(""); setFormNameEn(""); setFormAddress(""); setFormPhone(""); };

  return (
    <Layout>
      <div className="p-6 max-w-[1600px] mx-auto space-y-6" dir={direction}>
        <div className="flex justify-between items-center bg-white p-4 rounded-lg border shadow-sm">
          <div className="flex gap-2">
            <Button variant="outline" size="icon" className="text-blue-600 border-blue-600 hover:bg-blue-50" onClick={handlePrint} disabled={branches.length === 0} title={t("طباعة")} aria-label={t("طباعة")}><Printer className="h-4 w-4" /></Button>
            <Button variant="outline" size="icon" className="text-blue-600 border-blue-600 hover:bg-blue-50" onClick={handleExport} disabled={branches.length === 0} title={t("تصدير Excel")} aria-label={t("تصدير Excel")}><FileText className="h-4 w-4" /></Button>
            <Button size="icon" className="bg-[#004e89] hover:bg-[#003d6d] text-white" onClick={() => { resetForm(); setShowForm(true); }}><Plus className="h-4 w-4" /></Button>
          </div>
          <div className="font-semibold text-lg text-[#004e89]">{t("قائمة الفروع")}</div>
        </div>

        {showForm && (
          <div className="bg-white rounded-lg border shadow-sm p-6 space-y-4">
            <h3 className="font-bold text-lg">{editingId ? t("تعديل الفرع") : t("إضافة فرع جديد")}</h3>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium mb-1">{t("اسم الفرع")} *</label><input value={formName} onChange={(e) => setFormName(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
              <div><label className="block text-sm font-medium mb-1">{t("الاسم بالإنجليزية")}</label><input value={formNameEn} onChange={(e) => setFormNameEn(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
              <div><label className="block text-sm font-medium mb-1">{t("العنوان")}</label><input value={formAddress} onChange={(e) => setFormAddress(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
              <div><label className="block text-sm font-medium mb-1">{t("الهاتف")}</label><input value={formPhone} onChange={(e) => setFormPhone(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={saving} className="bg-[#004e89] hover:bg-[#003d6d] text-white"><Save className="h-4 w-4 me-1" /> {saving ? t("جاري الحفظ...") : t("حفظ")}</Button>
              <Button variant="outline" onClick={resetForm}><X className="h-4 w-4 me-1" /> {t("إلغاء")}</Button>
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg border shadow-sm overflow-hidden overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-[#004e89] hover:bg-[#004e89]">
                <TableHead className="text-white text-start font-medium w-[60px]">#</TableHead>
                <TableHead className="text-white text-start font-medium">{t("اسم الفرع")}</TableHead>
                <TableHead className="text-white text-start font-medium">{t("الاسم بالإنجليزية")}</TableHead>
                <TableHead className="text-white text-start font-medium">{t("العنوان")}</TableHead>
                <TableHead className="text-white text-start font-medium">{t("الهاتف")}</TableHead>
                <TableHead className="text-white text-start font-medium">{t("الحالة")}</TableHead>
                <TableHead className="text-white text-center font-medium w-[120px]">{t("الإجراءات")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-gray-400">{t("جاري التحميل...")}</TableCell></TableRow>
              ) : branches.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-gray-400">{t("لا توجد فروع")}</TableCell></TableRow>
              ) : branches.map((row, i) => (
                <TableRow key={row.id}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell>{row.nameEn}</TableCell>
                  <TableCell>{row.address}</TableCell>
                  <TableCell>{row.phone}</TableCell>
                  <TableCell><span className="px-2 py-1 rounded bg-green-50 text-green-600 text-xs font-medium">{t(row.status)}</span></TableCell>
                  <TableCell className="text-center">
                    <div className="flex justify-center gap-2">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600 hover:bg-blue-50" onClick={() => startEdit(row)}><Edit className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:bg-red-50" onClick={() => handleDelete(row)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="text-sm text-gray-500">{t("إظهار")} {formatNumber(branches.length)} {t("فرع")}</div>
      </div>
    </Layout>
  );
}
