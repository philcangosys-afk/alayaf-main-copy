import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Printer, FileText, Plus, Trash2, Edit, Save, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n";
import { hrRequestErrorText } from "@/lib/hrErrors";
import { exportReportExcel, printReport } from "@/lib/reportExport";

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

type DeptRow = { id: string; name: string; nameEn: string; branchId: string; branch: string; manager: string; status: string };
type BranchOption = { id: string; name: string };

export default function HROrgDepartments() {
  const { t, direction, formatNumber } = useI18n();
  const [departments, setDepartments] = useState<DeptRow[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formNameEn, setFormNameEn] = useState("");
  const [formBranchId, setFormBranchId] = useState("");
  const [formManager, setFormManager] = useState("");
  const [saving, setSaving] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [departmentResult, branchResult] = await Promise.all([
        supabase.from("departments").select("id, name, name_en, branch_id, branch, manager, status, created_at").order("created_at", { ascending: false }),
        supabase.from("branches").select("id, name").eq("status", "فعال").order("name"),
      ]);
      if (departmentResult.error) throw departmentResult.error;
      if (branchResult.error) throw branchResult.error;
      const branchRows = (branchResult.data ?? []).map((r) => ({ id: String(r.id), name: String(r.name ?? "") }));
      const branchById = new Map(branchRows.map((branch) => [branch.id, branch.name]));
      setBranches(branchRows);
      setDepartments((departmentResult.data ?? []).map((r) => ({
        id: String(r.id), name: String(r.name ?? ""), nameEn: String(r.name_en ?? ""), branchId: String(r.branch_id ?? ""),
        branch: branchById.get(String(r.branch_id ?? "")) || String(r.branch ?? ""), manager: String(r.manager ?? ""), status: String(r.status ?? "فعال"),
      })));
    } catch (error) {
      toast({ title: t("تعذر تحميل البيانات"), description: t(hrRequestErrorText(error)), variant: "destructive" });
    } finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, []);

  const handleDelete = async (dept: DeptRow) => {
    if (!confirm(`${t("حذف الإدارة")} "${dept.name}"؟`)) return;
    try {
      const linked = await countLinkedEmployees("department_id", dept.id);
      if (linked > 0) {
        toast({ title: t("لم يتم الحذف"), description: `${t("لا يمكن الحذف: مرتبط بـ")} ${formatNumber(linked)} ${t("موظف")}`, variant: "destructive" });
        return;
      }
    } catch (error) {
      toast({ title: t("تعذر التحقق من الموظفين المرتبطين"), description: t(hrRequestErrorText(error)), variant: "destructive" });
      return;
    }
    const { data, error } = await supabase.from("departments").delete().eq("id", dept.id).select("id");
    if (error || !data?.length) {
      toast({ title: t("لم يتم الحذف"), description: t(error ? orgErrorText(error) : NO_ROWS_MESSAGE), variant: "destructive" });
      return;
    }
    setDepartments((prev) => prev.filter((d) => d.id !== dept.id));
    toast({ title: t("تم الحذف") });
  };

  const handleSave = async () => {
    if (!formName.trim()) { toast({ title: t("خطأ"), description: t("اسم الإدارة مطلوب"), variant: "destructive" }); return; }
    const selectedBranch = branches.find((branch) => branch.id === formBranchId);
    const payload = { name: formName, name_en: formNameEn, branch_id: formBranchId || null, branch: selectedBranch?.name ?? "", manager: formManager };
    setSaving(true);
    try {
      if (editingId) {
        const { data, error } = await supabase.from("departments").update(payload).eq("id", editingId).select("id");
        if (error) throw error;
        if (!data?.length) throw new Error(NO_ROWS_MESSAGE);
      } else {
        const { error } = await supabase.from("departments").insert([payload]);
        if (error) throw error;
      }
      toast({ title: editingId ? t("تم التعديل") : t("تمت الإضافة") });
      resetForm();
      loadData();
    } catch (error) {
      toast({ title: t("خطأ"), description: t(orgErrorText(error)), variant: "destructive" });
    } finally { setSaving(false); }
  };

  const reportOptions = () => ({
    title: "قائمة الإدارات",
    fileName: "departments",
    columns: [
      { key: "name", label: "اسم الإدارة", width: 26 },
      { key: "nameEn", label: "الاسم بالإنجليزية", width: 24 },
      { key: "branch", label: "الفرع", width: 20 },
      { key: "manager", label: "المدير", width: 20 },
      { key: "status", label: "الحالة", width: 12 },
    ],
    rows: departments.map((row) => ({ name: row.name, nameEn: row.nameEn, branch: row.branch, manager: row.manager, status: row.status })),
  });
  const handlePrint = () => {
    if (!printReport(reportOptions())) toast({ title: t("تعذر فتح نافذة الطباعة"), description: t("اسمح بالنوافذ المنبثقة ثم أعد المحاولة"), variant: "destructive" });
  };
  const handleExport = () => exportReportExcel(reportOptions());

  const startEdit = (dept: DeptRow) => {
    setEditingId(dept.id); setFormName(dept.name); setFormNameEn(dept.nameEn); setFormBranchId(dept.branchId); setFormManager(dept.manager); setShowForm(true);
  };

  const resetForm = () => { setShowForm(false); setEditingId(null); setFormName(""); setFormNameEn(""); setFormBranchId(""); setFormManager(""); };

  return (
    <Layout>
      <div className="p-6 max-w-[1600px] mx-auto space-y-6" dir={direction}>
        <div className="flex justify-between items-center bg-white p-4 rounded-lg border shadow-sm">
          <div className="flex gap-2">
            <Button variant="outline" size="icon" className="text-blue-600 border-blue-600 hover:bg-blue-50" onClick={handlePrint} disabled={departments.length === 0} title={t("طباعة")} aria-label={t("طباعة")}><Printer className="h-4 w-4" /></Button>
            <Button variant="outline" size="icon" className="text-blue-600 border-blue-600 hover:bg-blue-50" onClick={handleExport} disabled={departments.length === 0} title={t("تصدير Excel")} aria-label={t("تصدير Excel")}><FileText className="h-4 w-4" /></Button>
            <Button size="icon" className="bg-[#004e89] hover:bg-[#003d6d] text-white" onClick={() => { resetForm(); setShowForm(true); }}><Plus className="h-4 w-4" /></Button>
          </div>
          <div className="font-semibold text-lg text-[#004e89]">{t("قائمة الإدارات")}</div>
        </div>

        {showForm && (
          <div className="bg-white rounded-lg border shadow-sm p-6 space-y-4">
            <h3 className="font-bold text-lg">{editingId ? t("تعديل الإدارة") : t("إضافة إدارة جديدة")}</h3>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium mb-1">{t("اسم الإدارة")} *</label><input value={formName} onChange={(e) => setFormName(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
              <div><label className="block text-sm font-medium mb-1">{t("الاسم بالإنجليزية")}</label><input value={formNameEn} onChange={(e) => setFormNameEn(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
              <div><label className="block text-sm font-medium mb-1">{t("الفرع")}</label><select value={formBranchId} onChange={(e) => setFormBranchId(e.target.value)} className="w-full px-3 py-2 border rounded-lg bg-white text-sm"><option value="">{t("غير محدد")}</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></div>
              <div><label className="block text-sm font-medium mb-1">{t("المدير")}</label><input value={formManager} onChange={(e) => setFormManager(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={saving} className="bg-[#004e89] hover:bg-[#003d6d] text-white"><Save className="h-4 w-4 me-1" /> {saving ? t("جاري الحفظ...") : t("حفظ")}</Button>
              <Button variant="outline" onClick={resetForm}><X className="h-4 w-4 me-1" /> {t("إلغاء")}</Button>
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg border shadow-sm overflow-hidden overflow-x-auto">
          <Table className="min-w-[800px]">
            <TableHeader>
              <TableRow className="bg-[#004e89] hover:bg-[#004e89]">
                <TableHead className="text-white text-start font-medium w-[60px]">#</TableHead>
                <TableHead className="text-white text-start font-medium">{t("اسم الإدارة")}</TableHead>
                <TableHead className="text-white text-start font-medium">{t("الاسم بالإنجليزية")}</TableHead>
                <TableHead className="text-white text-start font-medium">{t("الفرع")}</TableHead>
                <TableHead className="text-white text-start font-medium">{t("المدير")}</TableHead>
                <TableHead className="text-white text-start font-medium">{t("الحالة")}</TableHead>
                <TableHead className="text-white text-center font-medium w-[120px]">{t("الإجراءات")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-gray-400">{t("جاري التحميل...")}</TableCell></TableRow>
              ) : departments.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-gray-400">{t("لا توجد إدارات")}</TableCell></TableRow>
              ) : (
                departments.map((row, i) => (
                  <TableRow key={row.id}>
                    <TableCell>{i + 1}</TableCell>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>{row.nameEn}</TableCell>
                    <TableCell>{row.branch}</TableCell>
                    <TableCell>{row.manager}</TableCell>
                    <TableCell><span className="px-2 py-1 rounded bg-green-50 text-green-600 text-xs font-medium">{t(row.status)}</span></TableCell>
                    <TableCell className="text-center">
                      <div className="flex justify-center gap-2">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600 hover:bg-blue-50" onClick={() => startEdit(row)}><Edit className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:bg-red-50" onClick={() => handleDelete(row)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <div className="text-sm text-gray-500">{t("إظهار")} {formatNumber(departments.length)} {t("إدارة")}</div>
      </div>
    </Layout>
  );
}
