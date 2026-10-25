import { useMemo, useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { useI18n } from "@/i18n";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { riyadhToday } from "@/lib/hrDates";
import DataImportDialog from "@/components/DataImportDialog";
import { employeesImportSpec, type EmployeeFormModule, type EmployeeImportSettings } from "@/lib/imports/employees";

type Option = { id: string; name: string; branchId?: string | null };
type Lists = { form: EmployeeFormModule; branches: Option[]; departments: Option[]; jobs: string[]; roles: string[] };

/** أدوار الإدارة العليا: يمنحها مدير النظام من ملف الموظف وحده (الخادم يرفضها في الإضافة) */
const ADMIN_ROLES = ["مدير النظام", "مدير عام", "المدير العام"];

const fieldClass = "mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm";
const labelClass = "block text-xs font-medium text-slate-600";

/**
 * «استيراد من إكسل» في قائمة الموظفين: الصفوف بالبيانات الشخصية، وبيانات العمل المشتركة تُختار هنا مرة لكل الصفوف.
 * قوائم الهيكل ونموذج الموظف تُحمَّل عند فتح النافذة فقط.
 */
export default function EmployeesImportButton({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lists, setLists] = useState<Lists | null>(null);
  const [settings, setSettings] = useState<EmployeeImportSettings>({
    branchId: "", branchName: "", departmentId: "", departmentName: "", jobTitle: "", employmentType: "أساسي", hireDate: riyadhToday(), role: "",
  });

  const start = async () => {
    if (loading) return;
    if (lists) { setOpen(true); return; }
    setLoading(true);
    try {
      const [form, branches, departments, jobs, roles] = await Promise.all([
        import("@/pages/EmployeeForm"),
        supabase.from("branches").select("id, name").eq("status", "فعال").order("name"),
        supabase.from("departments").select("id, name, branch_id").eq("status", "فعال").order("name"),
        supabase.from("hr_jobs").select("name").eq("status", "فعال").order("name"),
        supabase.from("user_roles").select("name_ar").eq("status", "فعال").order("name_ar"),
      ]);
      const error = branches.error ?? departments.error ?? jobs.error ?? roles.error;
      if (error) throw error;
      const next: Lists = {
        form: form as unknown as EmployeeFormModule,
        branches: (branches.data ?? []).map((row: Record<string, unknown>) => ({ id: String(row.id), name: String(row.name ?? "") })).filter((row) => row.id && row.name),
        departments: (departments.data ?? []).map((row: Record<string, unknown>) => ({ id: String(row.id), name: String(row.name ?? ""), branchId: row.branch_id ? String(row.branch_id) : null })),
        jobs: (jobs.data ?? []).map((row: Record<string, unknown>) => String(row.name)).filter(Boolean),
        roles: (roles.data ?? []).map((row: Record<string, unknown>) => String(row.name_ar ?? "")).filter((role) => role && !ADMIN_ROLES.includes(role)),
      };
      setLists(next);
      // الافتراضي: الفرع الوحيد، والدور «موظف» إن وُجد
      setSettings((current) => {
        const branch = next.branches.length === 1 ? next.branches[0] : null;
        return {
          ...current,
          branchId: current.branchId || branch?.id || "",
          branchName: current.branchName || branch?.name || "",
          role: current.role || (next.roles.includes("موظف") ? "موظف" : ""),
        };
      });
      setOpen(true);
    } catch (error) {
      toast({ title: t("تعذر فتح الاستيراد"), description: error instanceof Error ? error.message : String((error as { message?: string })?.message ?? ""), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // إدارات الفرع المختار وحده، كما في نموذج الموظف
  const departments = useMemo(
    () => (lists?.departments ?? []).filter((department) => !settings.branchId || department.branchId === settings.branchId),
    [lists, settings.branchId],
  );

  const spec = useMemo(
    () => (lists ? employeesImportSpec(lists.form, lists.jobs, settings, t) : null),
    [lists, settings, t],
  );

  const settingsError = !settings.branchId ? t("اختر الفرع")
    : !settings.departmentId ? t("اختر الإدارة")
      : !settings.jobTitle ? t("اختر المسمى الوظيفي الافتراضي")
        : !settings.employmentType ? t("اختر نوع التوظيف")
          : !/^\d{4}-\d{2}-\d{2}$/.test(settings.hireDate) ? t("أدخل تاريخ التعيين")
            : !settings.role ? t("اختر الدور")
              : null;

  const set = (changes: Partial<EmployeeImportSettings>) => setSettings((current) => ({ ...current, ...changes }));

  const settingsForm = lists && (
    <div className="grid gap-3 sm:grid-cols-3">
      <label className={labelClass}>{t("الفرع")} *
        <select value={settings.branchId} className={fieldClass}
          onChange={(event) => {
            const branch = lists.branches.find((item) => item.id === event.target.value);
            const keepDepartment = lists.departments.find((item) => item.id === settings.departmentId && item.branchId === event.target.value);
            set({ branchId: event.target.value, branchName: branch?.name ?? "", ...(keepDepartment ? {} : { departmentId: "", departmentName: "" }) });
          }}>
          <option value="">{lists.branches.length ? "--" : t("أضف الفروع من الهيكل التنظيمي")}</option>
          {lists.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
        </select>
      </label>
      <label className={labelClass}>{t("الإدارة")} *
        <select value={settings.departmentId} className={fieldClass}
          onChange={(event) => set({ departmentId: event.target.value, departmentName: departments.find((item) => item.id === event.target.value)?.name ?? "" })}>
          <option value="">{departments.length ? "--" : t("أضف الإدارات من الهيكل التنظيمي")}</option>
          {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
        </select>
      </label>
      <label className={labelClass}>{t("المسمى الوظيفي الافتراضي")} *
        <select value={settings.jobTitle} className={fieldClass} onChange={(event) => set({ jobTitle: event.target.value })}>
          <option value="">{lists.jobs.length ? "--" : t("أضف الوظائف من الهيكل التنظيمي")}</option>
          {lists.jobs.map((job) => <option key={job} value={job}>{job}</option>)}
        </select>
      </label>
      <label className={labelClass}>{t("نوع التوظيف")} *
        <select value={settings.employmentType} className={fieldClass} onChange={(event) => set({ employmentType: event.target.value })}>
          {lists.form.EMPLOYMENT_TYPES.map((type) => <option key={type} value={type}>{t(type)}</option>)}
        </select>
      </label>
      <label className={labelClass}>{t("تاريخ التعيين")} *
        <input type="date" value={settings.hireDate} className={fieldClass} onChange={(event) => set({ hireDate: event.target.value })} />
      </label>
      <label className={labelClass}>{t("الدور (الصلاحية)")} *
        <select value={settings.role} className={fieldClass} onChange={(event) => set({ role: event.target.value })}>
          <option value="">--</option>
          {lists.roles.map((role) => <option key={role} value={role}>{role}</option>)}
        </select>
      </label>
      <p className="text-xs leading-6 text-slate-500 sm:col-span-3">
        {t("المسمى الافتراضي لمن لا مسمى له في الملف. البدلات والتأمينات وحساب الدخول تُكمَل من ملف كل موظف بعد الاستيراد.")}
      </p>
    </div>
  );

  return (
    <>
      <button type="button" onClick={() => void start()} disabled={loading} title={t("إضافة سجلات من ملف إكسل")}
        className="inline-flex items-center gap-2 rounded-lg border border-blue-600 bg-white px-4 py-2 text-sm font-medium text-blue-700 shadow-sm transition hover:bg-blue-50 disabled:opacity-60">
        <FileSpreadsheet className="h-4 w-4" />{t("استيراد من إكسل")}
      </button>
      {open && spec && (
        <DataImportDialog spec={spec} settings={settingsForm} settingsError={settingsError}
          onClose={() => setOpen(false)} onDone={() => onDone()} />
      )}
    </>
  );
}
