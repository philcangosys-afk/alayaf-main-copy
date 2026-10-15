import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Plus, Trash2, Edit } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n";
import { hrRequestErrorText } from "@/lib/hrErrors";

type ApprovalChain = {
  id: string;
  name: string;
  type: string;
  steps: unknown[];
  status: string;
};

export default function HRApprovalsList() {
  const { t, direction } = useI18n();
  const navigate = useNavigate();
  const [chains, setChains] = useState<ApprovalChain[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.from("approval_chains").select("*").order("created_at", { ascending: false });
        if (error) throw error;
        setChains((data ?? []).map((r) => ({
          id: String(r.id), name: String(r.name ?? ""), type: String(r.type ?? ""),
          steps: Array.isArray(r.steps) ? r.steps : [], status: String(r.status ?? "").trim(),
        })));
      } catch (error) {
        toast({ title: t("تعذر تحميل سلاسل الموافقات"), description: t(hrRequestErrorText(error)), variant: "destructive" });
      } finally { setLoading(false); }
    };
    load();
  }, []);

  const handleDelete = async (chain: ApprovalChain) => {
    if (!confirm(`${t("حذف سلسلة الموافقات")} "${chain.name}"؟`)) return;
    const { data, error } = await supabase.from("approval_chains").delete().eq("id", chain.id).select("id");
    if (error) {
      toast({ title: t("تعذر الحذف"), description: t(hrRequestErrorText(error)), variant: "destructive" });
      return;
    }
    if (!data || data.length === 0) {
      toast({ title: t("لم يُحذف شيء"), description: t("لا تملك صلاحية حذف هذه السلسلة أو أنها حُذفت مسبقًا"), variant: "destructive" });
      return;
    }
    setChains((prev) => prev.filter((c) => c.id !== chain.id));
    toast({ title: t("تم الحذف") });
  };

  const filtered = chains.filter((c) =>
    !searchTerm || c.name.includes(searchTerm) || c.type.includes(searchTerm)
  );

  return (
    <Layout>
      <div className="p-6 max-w-[1600px] mx-auto space-y-6" dir={direction}>
        <div className="flex justify-between items-center bg-white p-4 rounded-lg border shadow-sm">
          <div className="flex gap-2">
            <Link to="/hr/approvals/add">
              <Button className="bg-[#004e89] hover:bg-[#003d6d] text-white flex gap-2">
                <Plus className="h-4 w-4" />
                <span>{t("إضافة سلسلة موافقات")}</span>
              </Button>
            </Link>
          </div>
          <div className="font-semibold text-lg text-[#004e89]">{t("قائمة سلسلة الموافقات")}</div>
        </div>

        <div className="bg-white p-4 rounded-lg border shadow-sm flex items-center justify-between">
          <div className="relative w-1/3">
            <Search className="absolute right-3 top-2.5 h-4 w-4 text-gray-400" />
            <Input placeholder={t("بحث...")} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pr-9" />
          </div>
        </div>

        <div className="bg-white rounded-lg border shadow-sm overflow-hidden overflow-x-auto">
          <Table className="min-w-[800px]">
            <TableHeader>
              <TableRow className="bg-[#004e89] hover:bg-[#004e89]">
                <TableHead className="text-white text-right font-medium w-[60px]">#</TableHead>
                <TableHead className="text-white text-right font-medium">{t("اسم السلسلة")}</TableHead>
                <TableHead className="text-white text-right font-medium">{t("النوع")}</TableHead>
                <TableHead className="text-white text-right font-medium">{t("عدد الخطوات")}</TableHead>
                <TableHead className="text-white text-center font-medium w-[100px]">{t("الحالة")}</TableHead>
                <TableHead className="text-white text-center font-medium w-[120px]">{t("الإجراءات")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-gray-400">{t("جاري التحميل...")}</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-gray-400">{t("لا توجد سلاسل موافقات")}</TableCell></TableRow>
              ) : filtered.map((row, i) => (
                <TableRow key={row.id}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell>{row.type || "—"}</TableCell>
                  <TableCell>{row.steps.length} {t("خطوة")}</TableCell>
                  <TableCell className="text-center">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${row.status === "فعال" ? "bg-emerald-100 text-emerald-800" : "bg-gray-100 text-gray-700"}`}>{row.status ? t(row.status) : t("غير محدد")}</span>
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex justify-center gap-2">
                      <Button variant="ghost" size="icon" title={t("تعديل")} aria-label={t("تعديل")} className="h-8 w-8 text-blue-600 hover:bg-blue-50" onClick={() => navigate(`/hr/approvals/add?id=${encodeURIComponent(row.id)}`)}><Edit className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" title={t("حذف")} aria-label={t("حذف")} className="h-8 w-8 text-red-500 hover:bg-red-50" onClick={() => handleDelete(row)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="text-sm text-gray-500">{t("إظهار")} {filtered.length} {t("سجل")}</div>
      </div>
    </Layout>
  );
}
