import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { Printer, Plus, Trash2, Edit, Search, RefreshCw, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { hrRequestErrorText } from "@/lib/hrErrors";

type RoleRow = {
  id: string;
  nameAr: string;
  nameEn: string;
  status: string;
  addedDate: string;
  updateDate: string;
};

export default function HRPermissionsRoles() {
  const navigate = useNavigate();
  const { t, direction, formatDate, formatNumber } = useI18n();
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from("user_roles")
          .select("*")
          .order("created_at", { ascending: false });

        if (error) {
          console.error("Error loading roles:", error);
          // Check if it's a missing table error
          if (error.code === "42P01" || error.message?.includes("does not exist")) {
            toast.error(t("جدول الأدوار غير موجود. يرجى مراجعة إعدادات قاعدة البيانات"));
          } else {
            toast.error(t("خطأ في تحميل الأدوار"));
          }
          setRoles([]);
        } else if (data) {
          setRoles(data.map((r: any) => ({
            id: String(r.id ?? ""),
            nameAr: String(r.name_ar ?? ""),
            nameEn: String(r.name_en ?? ""),
            status: String(r.status ?? "فعال"),
            addedDate: r.created_at ? formatDate(r.created_at) : "",
            updateDate: r.updated_at ? formatDate(r.updated_at) : "",
          })));
        }
      } catch (err) {
        console.error("Unexpected error:", err);
        toast.error(t("حدث خطأ في تحميل البيانات"));
        setRoles([]);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleDelete = async (role: RoleRow) => {
    if (!confirm(`${t("حذف الدور")} "${role.nameAr}"؟`)) return;
    const { error } = await supabase.from("user_roles").delete().eq("id", role.id).select("id").single();
    if (error) {
      toast.error(`${t("تعذر حذف الدور")}: ${t(hrRequestErrorText(error))}`);
    } else {
      setRoles((prev) => prev.filter((r) => r.id !== role.id));
      toast.success(t("تم حذف الدور بنجاح"));
    }
  };

  const filteredRoles = roles.filter((r) =>
    r.nameAr.includes(search) || r.nameEn.includes(search)
  );

  return (
    <Layout>
      <div className="p-6 max-w-[1600px] mx-auto space-y-6" dir={direction}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-[#004e89]">{t("إدارة الأدوار والصلاحيات")}</h1>
          <div className="flex items-center gap-3">
            <Button
              onClick={() => window.location.reload()}
              variant="outline"
              size="icon"
              title={t("تحديث")}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Link
              to="/hr/permissions/special-user"
              className="inline-flex items-center gap-1 px-4 py-2 border border-[#004e89] text-[#004e89] bg-white rounded-lg text-sm font-medium hover:bg-blue-50 transition"
            >
              <UserPlus className="h-4 w-4" /> {t("إضافة مستخدم خاص")}
            </Link>
            <Link
              to="/hr/permissions/add-role"
              className="inline-flex items-center gap-1 px-4 py-2 bg-[#004e89] text-white rounded-lg text-sm font-medium hover:bg-[#003865] transition"
            >
              <Plus className="h-4 w-4" /> {t("إضافة دور جديد")}
            </Link>
          </div>
        </div>

        {/* Search Bar */}
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder={t("بحث عن دور...")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pr-9"
            />
          </div>
        </div>

        {/* Roles Table */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="bg-[#004e89] text-white p-3 flex items-center justify-between gap-4">
            <h2 className="text-lg font-bold">{t("قائمة الأدوار")}</h2>
            <button className="p-1.5 hover:bg-white/10 rounded transition-colors text-white" title={t("طباعة")}>
              <Printer className="h-4 w-4" />
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm text-center whitespace-nowrap">
              <thead className="bg-gray-50 text-gray-700 border-b border-gray-200">
                <tr>
                  <th className="py-3 px-3 font-medium">{t("رقم الدور")}</th>
                  <th className="py-3 px-3 font-medium">{t("اسم الدور")}</th>
                  <th className="py-3 px-3 font-medium">{t("اسم الدور بالإنجليزية")}</th>
                  <th className="py-3 px-3 font-medium">{t("الحالة")}</th>
                  <th className="py-3 px-3 font-medium">{t("تاريخ الإضافة")}</th>
                  <th className="py-3 px-3 font-medium">{t("تاريخ آخر تعديل")}</th>
                  <th className="py-3 px-3 font-medium">{t("الإجراءات")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {loading ? (
                  <tr><td colSpan={7} className="py-8 text-center text-gray-400">{t("جاري التحميل...")}</td></tr>
                ) : filteredRoles.length === 0 ? (
                  <tr><td colSpan={7} className="py-8 text-center text-gray-400">{t("لا توجد أدوار")}</td></tr>
                ) : (
                  filteredRoles.map((role) => (
                    <tr key={role.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="py-3 px-3 font-mono text-gray-500">{role.id.slice(0, 8)}</td>
                      <td className="py-3 px-3 font-medium">{role.nameAr}</td>
                      <td className="py-3 px-3">{role.nameEn}</td>
                      <td className="py-3 px-3">
                        <span className="inline-flex px-2 py-1 rounded bg-green-50 text-green-600 text-xs font-medium">{t(role.status)}</span>
                      </td>
                      <td className="py-3 px-3 text-gray-500 text-xs">{role.addedDate}</td>
                      <td className="py-3 px-3 text-gray-500 text-xs">{role.updateDate}</td>
                      <td className="py-3 px-3">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => navigate(`/hr/permissions/edit-role/${role.id}`)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded" title={t("تعديل")}><Edit className="h-4 w-4" /></button>
                          <button onClick={() => handleDelete(role)} className="p-1.5 text-red-600 hover:bg-red-50 rounded" title={t("حذف")}><Trash2 className="h-4 w-4" /></button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="bg-gray-50 p-4 border-t border-gray-100 flex items-center justify-between text-sm">
            <span className="text-gray-500">
              {t("يعرض")} <span className="font-bold text-gray-800">{formatNumber(filteredRoles.length)}</span> {t("من")} <span className="font-bold text-gray-800">{formatNumber(roles.length)}</span> {t("أدوار")}
            </span>
          </div>
        </div>
      </div>
    </Layout>
  );
}
