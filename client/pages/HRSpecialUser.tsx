import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowRight, Loader2, Save, UserPlus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/i18n";
import { toast } from "sonner";

type Option = { id: string; label: string };
type SpecialUser = { id: string; full_name: string; email: string; status: string; created_at: string; role_id?: string | null };

export default function HRSpecialUser() {
  const navigate = useNavigate();
  const { t, direction, formatDate } = useI18n();
  const [roles, setRoles] = useState<Option[]>([]);
  const [branches, setBranches] = useState<Option[]>([]);
  const [users, setUsers] = useState<SpecialUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form, setForm] = useState({ fullName: "", email: "", password: "", roleId: "", branchId: "" });

  useEffect(() => {
    void Promise.all([
      supabase.from("user_roles").select("id, name_ar").eq("status", "فعال").order("name_ar"),
      supabase.from("branches").select("id, name").eq("status", "فعال").order("name"),
      supabase.from("system_users").select("id, full_name, email, status, created_at, role_id").order("created_at", { ascending: false }),
    ]).then(([roleResult, branchResult, userResult]) => {
      setRoles((roleResult.data ?? []).map((row) => ({ id: String(row.id), label: String(row.name_ar) })));
      setBranches((branchResult.data ?? []).map((row) => ({ id: String(row.id), label: String(row.name) })));
      setUsers((userResult.data ?? []) as SpecialUser[]);
    });
  }, []);

  // استدعاء دالة المستخدمين الخاصين بجلسة محدّثة؛ يرجع رسالة الخطأ أو البيانات
  const callFunction = async (payload: Record<string, unknown>): Promise<{ data?: { user?: SpecialUser }; error?: string }> => {
    const { data: sessionData, error: sessionError } = await supabase.auth.refreshSession();
    const accessToken = sessionData.session?.access_token;
    if (sessionError || !accessToken) return { error: t("انتهت جلسة الدخول، يرجى تسجيل الدخول مرة أخرى") };
    const { data, error } = await supabase.functions.invoke("manage-special-users", {
      body: payload,
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (error || data?.error) {
      let message = String(data?.error ?? error?.message ?? t("تعذر تنفيذ العملية"));
      const response = (error as { context?: Response } | null)?.context;
      if (response) {
        const errorBody = await response.clone().json().catch(() => null) as { error?: string } | null;
        if (errorBody?.error) message = errorBody.error;
      }
      return { error: message };
    }
    return { data };
  };

  const changeStatus = async (user: SpecialUser) => {
    const next = user.status === "فعال" ? "غير فعال" : "فعال";
    const question = next === "فعال"
      ? `${t("إعادة تفعيل المستخدم")} "${user.full_name}" ${t("وإعادة دخوله؟")}`
      : `${t("إيقاف المستخدم")} "${user.full_name}" ${t("ومنع دخوله؟")}`;
    if (!confirm(question)) return;
    setBusyId(user.id);
    const result = await callFunction({ action: "set-status", id: user.id, status: next });
    setBusyId(null);
    if (result.error) { toast.error(result.error); return; }
    setUsers((current) => current.map((row) => row.id === user.id ? { ...row, ...(result.data?.user ?? {}), status: next } : row));
    toast.success(next === "فعال" ? t("أُعيد تفعيل المستخدم ودخوله") : t("أُوقف المستخدم ومُنع دخوله"));
  };

  const changeRole = async (user: SpecialUser, roleId: string) => {
    if (!roleId || roleId === user.role_id) return;
    const roleName = roles.find((role) => role.id === roleId)?.label ?? "";
    if (!confirm(`${t("تغيير دور")} "${user.full_name}" ${t("إلى")} "${roleName}"؟`)) return;
    setBusyId(user.id);
    const result = await callFunction({ action: "set-role", id: user.id, roleId });
    setBusyId(null);
    if (result.error) { toast.error(result.error); return; }
    setUsers((current) => current.map((row) => row.id === user.id ? { ...row, role_id: roleId } : row));
    toast.success(t("تم تغيير الدور"));
  };

  const save = async () => {
    if (!form.fullName.trim() || !form.email.trim() || !form.roleId || form.password.length < 8) {
      toast.error(t("أدخل الاسم والبريد والدور وكلمة مرور من 8 أحرف على الأقل"));
      return;
    }
    setLoading(true);
    const { data: sessionData, error: sessionError } = await supabase.auth.refreshSession();
    const accessToken = sessionData.session?.access_token;
    if (sessionError || !accessToken) {
      setLoading(false);
      toast.error(t("انتهت جلسة الدخول، يرجى تسجيل الدخول مرة أخرى"));
      return;
    }

    const { data, error } = await supabase.functions.invoke("manage-special-users", {
      body: form,
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    setLoading(false);
    if (error || data?.error) {
      let message = String(data?.error ?? error?.message ?? t("تعذر إنشاء المستخدم"));
      const response = (error as { context?: Response } | null)?.context;
      if (response) {
        const errorBody = await response.clone().json().catch(() => null) as { error?: string } | null;
        if (errorBody?.error) message = errorBody.error;
      }
      toast.error(message);
      return;
    }
    setUsers((current) => [data.user as SpecialUser, ...current]);
    setForm({ fullName: "", email: "", password: "", roleId: "", branchId: "" });
    toast.success(t("تم إنشاء المستخدم الخاص وربطه بالدور"));
  };

  return (
    <Layout>
      <div className="mx-auto max-w-5xl space-y-6 p-6" dir={direction}>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-[#004e89]/10 p-3 text-[#004e89]"><UserPlus className="h-6 w-6" /></div>
            <div><h1 className="text-xl font-bold text-[#004e89]">{t("إضافة مستخدم خاص")}</h1><p className="text-sm text-muted-foreground">{t("مستخدم نظام مستقل غير مسجل كموظف")}</p></div>
          </div>
          <Button variant="outline" onClick={() => navigate("/hr/permissions/roles")}><ArrowRight className="ms-1 h-4 w-4" />{t("العودة للأدوار")}</Button>
        </div>

        <div className="rounded-xl border bg-white p-6 shadow-sm">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            <span>{t("تحدد صلاحيات المستخدم الخاص من الدور المختار، ويمكن تعديلها من شاشة الأدوار والصلاحيات")}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => navigate(form.roleId ? `/hr/permissions/edit-role/${form.roleId}` : "/hr/permissions/roles")}
              className="border-blue-300 bg-white text-blue-800 hover:bg-blue-100"
            >
              {t("إدارة صلاحيات الدور")}
            </Button>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2"><Label>{t("الاسم")}</Label><Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></div>
            <div className="space-y-2"><Label>{t("البريد الإلكتروني")}</Label><Input type="email" dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="space-y-2"><Label>{t("كلمة المرور")}</Label><Input type="password" dir="ltr" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
            <div className="space-y-2"><Label>{t("الدور والصلاحيات")}</Label><select className="h-10 w-full rounded-md border px-3" value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}><option value="">{t("اختر الدور")}</option>{roles.map((role) => <option key={role.id} value={role.id}>{role.label}</option>)}</select></div>
            <div className="space-y-2 md:col-span-2"><Label>{t("الفرع")}</Label><select className="h-10 w-full rounded-md border px-3" value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}><option value="">{t("بدون فرع محدد")}</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.label}</option>)}</select></div>
          </div>
          <div className="mt-6 flex justify-end"><Button onClick={save} disabled={loading} className="bg-[#004e89] hover:bg-[#003865]">{loading ? <Loader2 className="ms-2 h-4 w-4 animate-spin" /> : <Save className="ms-2 h-4 w-4" />}{t("إنشاء المستخدم")}</Button></div>
        </div>

        <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <div className="bg-slate-900 px-4 py-3 font-bold text-white">{t("المستخدمون الخاصون")}</div>
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="px-4 py-3 text-start">{t("الاسم")}</th><th className="px-4 py-3 text-start">{t("البريد الإلكتروني")}</th><th className="px-4 py-3 text-start">{t("الدور")}</th><th className="px-4 py-3 text-start">{t("الحالة")}</th><th className="px-4 py-3 text-start">{t("تاريخ الإضافة")}</th><th className="px-4 py-3 text-start">{t("إجراء")}</th></tr></thead><tbody>{users.map((user) => <tr key={user.id} className="border-t"><td className="px-4 py-3 font-medium">{user.full_name}</td><td className="px-4 py-3" dir="ltr">{user.email}</td><td className="px-4 py-3"><select className="h-9 rounded-md border px-2" value={user.role_id ?? ""} disabled={busyId === user.id} onChange={(e) => void changeRole(user, e.target.value)}><option value="" disabled>{t("اختر الدور")}</option>{roles.map((role) => <option key={role.id} value={role.id}>{role.label}</option>)}</select></td><td className="px-4 py-3"><span className={user.status === "فعال" ? "rounded-full bg-green-100 px-2 py-0.5 text-green-800" : "rounded-full bg-gray-200 px-2 py-0.5 text-gray-700"}>{t(user.status)}</span></td><td className="px-4 py-3">{formatDate(user.created_at)}</td><td className="px-4 py-3"><Button type="button" size="sm" variant="outline" disabled={busyId === user.id} onClick={() => void changeStatus(user)}>{busyId === user.id ? <Loader2 className="h-4 w-4 animate-spin" /> : user.status === "فعال" ? t("إيقاف") : t("إعادة تفعيل")}</Button></td></tr>)}</tbody></table></div>
        </div>
      </div>
    </Layout>
  );
}
