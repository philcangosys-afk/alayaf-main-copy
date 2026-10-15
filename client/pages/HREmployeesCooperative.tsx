import { useEffect, useMemo, useState } from "react";
import Layout from "@/components/Layout";
import {
  Users,
  Search,
  Eye,
  Edit,
  Trash2,
  UserPlus,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabaseClient";
import { PageHeader } from "@/components/SalesPageUI";
import EmployeeForm, { emptyForm, mapRowToForm } from "./EmployeeForm";
import type { EmpFormData } from "./EmployeeForm";
import { useI18n } from "@/i18n";
import { deleteOrDeactivateEmployee } from "@/components/hr/employeeActions";

const STATUS_COLORS: Record<string, string> = {
  نشط: "bg-green-100 text-green-700 border-green-200",
  "غير نشط": "bg-gray-100 text-gray-700 border-gray-200",
  إجازة: "bg-yellow-100 text-yellow-700 border-yellow-200",
  منتهي: "bg-red-100 text-red-700 border-red-200",
};

const COOPERATIVE_TYPES = ["متعاون", "تعاون", "متعاقد"];

function getCooperativeInitialData(): EmpFormData {
  const data = emptyForm();
  return {
    ...data,
    employmentType: "متعاون",
    status: "فعال",
  };
}

export default function HREmployeesCooperative() {
  const { t, direction, locale, formatNumber } = useI18n();
  const [employees, setEmployees] = useState<EmpFormData[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(false);

  const [mode, setMode] = useState<"list" | "create" | "edit" | "view">("list");
  const [selected, setSelected] = useState<EmpFormData | null>(null);

  const [fSearch, setFSearch] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fBranch, setFBranch] = useState("");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from("employees")
          .select("*")
          .in("employment_type", COOPERATIVE_TYPES)
          .order("created_at", { ascending: false });

        if (error) {
          toast({ title: t("تعذر تحميل الموظفين المتعاونين"), description: error.message });
          return;
        }

        setEmployees((data ?? []).map((row) => mapRowToForm(row)));
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [refreshKey]);

  const branches = useMemo(() => {
    const all = employees.map((e) => e.branch).filter(Boolean);
    return Array.from(new Set(all));
  }, [employees]);

  const filtered = useMemo(() => {
    return employees.filter((e) => {
      if (
        fSearch &&
        !e.name.includes(fSearch) &&
        !e.empId.includes(fSearch) &&
        !e.accountTitle.includes(fSearch) &&
        !e.phone.includes(fSearch)
      ) {
        return false;
      }
      if (fStatus && e.status !== fStatus) return false;
      if (fBranch && e.branch !== fBranch) return false;
      return true;
    });
  }, [employees, fSearch, fStatus, fBranch]);

  const refresh = () => setRefreshKey((k) => k + 1);

  const handleDelete = async (emp: EmpFormData) => {
    const result = await deleteOrDeactivateEmployee(emp, t);
    if (result === "deleted") setEmployees((prev) => prev.filter((e) => e.id !== emp.id));
    if (result === "deactivated") setEmployees((prev) => prev.map((e) => e.id === emp.id ? { ...e, status: "غير فعال" } : e));
  };

  if (mode === "create") {
    return (
      <EmployeeForm
        mode="create"
        initialData={getCooperativeInitialData()}
        title="إضافة موظف متعاون"
        onBack={() => setMode("list")}
        onSaved={() => {
          setMode("list");
          refresh();
        }}
      />
    );
  }

  if (mode === "edit" && selected) {
    return (
      <EmployeeForm
        mode="edit"
        initialData={selected}
        onBack={() => setMode("list")}
        title="تعديل موظف متعاون"
        onSaved={() => {
          setMode("list");
          refresh();
        }}
      />
    );
  }

  return (
    <Layout>
      <div className="mx-auto max-w-7xl space-y-6" dir={direction}>
        <PageHeader
          icon={Users}
          title="الموظفون المتعاونون"
          subtitle="إدارة الموظفين المتعاونين وربطهم الفعلي مع قاعدة البيانات"
          actionLabel="إضافة موظف متعاون"
          onAction={() => setMode("create")}
          gradient="from-blue-600 to-indigo-700"
        />

        <div className="rounded-xl border border-border bg-card shadow-sm">
          <div className="bg-gradient-to-r from-blue-600 to-indigo-700 px-5 py-3 flex items-center justify-between text-white rounded-t-lg">
            <div className="flex items-center gap-3">
              <Users className="h-5 w-5" />
              <h2 className="font-semibold">{t("قائمة المتعاونين")} ({formatNumber(filtered.length)})</h2>
            </div>
            <button
              onClick={() => setMode("create")}
              className="inline-flex items-center gap-2 rounded-lg bg-white/15 hover:bg-white/25 transition px-3 py-1.5 text-sm font-medium"
            >
              <UserPlus className="h-4 w-4" />
              {t("إضافة متعاون")}
            </button>
          </div>

          <div className="px-5 py-3 border-b border-border/30 flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[220px] relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                placeholder={t("بحث بالاسم / رقم الموظف / الهاتف")}
                value={fSearch}
                onChange={(e) => setFSearch(e.target.value)}
                className="w-full rounded-lg border border-border bg-background pr-9 pl-3 py-2 text-sm text-right"
              />
            </div>

            <select
              value={fStatus}
              onChange={(e) => setFStatus(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-right"
            >
              <option value="">{t("جميع الحالات")}</option>
              <option value="فعال">{t("فعال")}</option>
              <option value="غير فعال">{t("غير فعال")}</option>
              <option value="إجازة">{t("إجازة")}</option>
              <option value="منتهي">{t("منتهي")}</option>
            </select>

            <select
              value={fBranch}
              onChange={(e) => setFBranch(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-right"
            >
              <option value="">{t("جميع الفروع")}</option>
              {branches.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>

            <button
              onClick={() => {
                setFSearch("");
                setFStatus("");
                setFBranch("");
              }}
              className="px-3 py-2 text-sm rounded-lg border border-border hover:bg-muted/50 transition"
            >
              {t("إعادة تعيين")}
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm" dir={direction}>
              <thead>
                <tr className="border-b border-border/30 bg-muted/40">
                  <th className="px-4 py-3 text-start font-semibold">{t("إجراءات")}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t("الحالة")}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t("نوع التوظيف")}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t("الراتب الأساسي")}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t("تاريخ التعيين")}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t("الفرع")}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t("القسم")}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t("المسمى الوظيفي")}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t("الهاتف")}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t("الاسم")}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t("رقم الموظف")}</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={11} className="py-10 text-center text-muted-foreground text-sm">{t("جاري التحميل...")}</td>
                  </tr>
                )}

                {!loading && filtered.map((emp) => (
                  <tr key={emp.id} className="border-b border-border/20 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 align-middle">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setSelected(emp)}
                          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg"
                          title={t("عرض")}
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => {
                            setSelected(emp);
                            setMode("edit");
                          }}
                          className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg"
                          title={t("تعديل")}
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(emp)}
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg"
                          title={t("حذف")}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>

                    <td className="px-4 py-3 align-middle">
                      <span className={cn("inline-block px-2 py-0.5 rounded-full text-xs font-semibold border", STATUS_COLORS[emp.status] ?? "bg-gray-100 text-gray-600")}>{emp.status ? t(emp.status) : "-"}</span>
                    </td>
                    <td className="px-4 py-3 align-middle text-muted-foreground">{emp.employmentType ? t(emp.employmentType) : "-"}</td>
                    <td className="px-4 py-3 align-middle font-medium">{formatNumber(emp.baseSalary)} {t("ر.س")}</td>
                    <td className="px-4 py-3 align-middle text-muted-foreground">{emp.hireDate || "-"}</td>
                    <td className="px-4 py-3 align-middle text-muted-foreground">{emp.branch || "-"}</td>
                    <td className="px-4 py-3 align-middle text-muted-foreground">{emp.department || "-"}</td>
                    <td className="px-4 py-3 align-middle text-muted-foreground">{emp.jobTitle || "-"}</td>
                    <td className="px-4 py-3 align-middle text-muted-foreground">{emp.phone || "-"}</td>
                    <td className="px-4 py-3 align-middle font-semibold">{locale === "en" ? emp.firstName || emp.name || "-" : emp.name || emp.firstName || "-"}</td>
                    <td className="px-4 py-3 align-middle font-mono text-blue-700 font-semibold">{emp.empId || "-"}</td>
                  </tr>
                ))}

                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={11} className="py-12 text-center text-muted-foreground">
                      {t("لا يوجد موظفون متعاونون. يمكنك الضغط على إضافة موظف متعاون للبدء.")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {selected && mode === "list" && (
          <EmployeeQuickView
            employee={selected}
            onClose={() => setSelected(null)}
            onEdit={() => {
              setMode("edit");
            }}
          />
        )}
      </div>
    </Layout>
  );
}

function EmployeeQuickView({
  employee,
  onClose,
  onEdit,
}: {
  employee: EmpFormData;
  onClose: () => void;
  onEdit: () => void;
}) {
  const { t, direction, locale, formatNumber } = useI18n();

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" dir={direction}>
      <div className="w-full max-w-xl bg-white rounded-xl shadow-xl border border-border">
        <div className="px-5 py-4 border-b border-border/40 flex items-center justify-between">
          <button
            onClick={onClose}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowRight className="h-4 w-4" /> {t("إغلاق")}
          </button>
          <h3 className="font-bold">{t("بيانات الموظف المتعاون")}</h3>
          <button
            onClick={onEdit}
            className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700"
          >
            {t("تعديل")}
          </button>
        </div>

        <div className="p-5 grid grid-cols-2 gap-4 text-sm">
          <InfoRow label={t("الاسم")} value={locale === "en" ? employee.firstName || employee.name : employee.name || employee.firstName} />
          <InfoRow label={t("رقم الموظف")} value={employee.empId || "-"} />
          <InfoRow label={t("الهاتف")} value={employee.phone || "-"} />
          <InfoRow label={t("البريد")} value={employee.email || "-"} />
          <InfoRow label={t("المسمى الوظيفي")} value={employee.jobTitle || "-"} />
          <InfoRow label={t("القسم")} value={employee.department || "-"} />
          <InfoRow label={t("الفرع")} value={employee.branch || "-"} />
          <InfoRow label={t("نوع التوظيف")} value={employee.employmentType ? t(employee.employmentType) : "-"} />
          <InfoRow label={t("الحالة")} value={employee.status ? t(employee.status) : "-"} />
          <InfoRow label={t("الراتب الأساسي")} value={`${formatNumber(employee.baseSalary)} ${t("ر.س")}`} />
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 font-medium">{value}</div>
    </div>
  );
}
