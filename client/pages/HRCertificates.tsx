import { useEffect, useMemo, useState } from "react";
import { companyStorageKey, companyDocPrefix } from "@/lib/companyProfile";
import Layout from "@/components/Layout";
import { ArrowRight, Award, Eye, Plus, Save, Trash2, X, Edit, Search } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { nextCompanyNumber } from "@/lib/companyNumbers";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { riyadhToday } from "@/lib/hrDates";
import { ACTIVE_EMPLOYEE_STATUSES } from "@/lib/hrStatus";
import { hrRequestErrorText } from "@/lib/hrErrors";
import {
  PageHeader,
  FilterBar,
  FilterInput,
  FilterSelect,
  FilterActions,
  DataTable,
  ActionBtn,
} from "@/components/SalesPageUI";

type EmployeeOption = {
  id: string;
  empId: string;
  name: string;
  jobTitle: string;
  hireDate: string;
  status: string;
};

type Certificate = {
  id: string;
  certificateNo: string;
  employeeId: string;
  empId: string;
  empName: string;
  jobTitle: string;
  hireDate: string;
  issueDate: string;
  directedTo: string;
  purpose: string;
  notes: string;
  status: string;
};

type NewCertificateForm = {
  employeeId: string;
  issueDate: string;
  directedTo: string;
  purpose: string;
  notes: string;
};

// الموظفون المنتهية خدمتهم وغير الفعالين هم الأحوج لشهادة الخبرة
const CERTIFICATE_EMPLOYEE_STATUSES = [...ACTIVE_EMPLOYEE_STATUSES, "منتهي", "غير فعال"];

/** رقم شهادة فريد بتوقيت الرياض: CERT-YYYYMMDD-HHMMSS */
function makeCertificateNo(existing: Set<string>): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Riyadh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .map((part) => [part.type, part.value]),
  );
  const base = `CERT-${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
  let candidate = base;
  for (let n = 2; existing.has(candidate); n += 1) candidate = `${base}-${n}`;
  return candidate;
}

// النسخة السابقة كانت تحفظ الشهادة على الجهاز عند فشل الحفظ في قاعدة البيانات؛ نقرأها لرفعها فقط
/** مفتاح المتصفح خاص بالمنشأة الحالية */
const legacyLocalKey = () => companyStorageKey("hr_certificates_local");

function readLegacyLocalCertificates(): Certificate[] {
  try {
    const raw = localStorage.getItem(legacyLocalKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === "object" && String(item.certificateNo ?? "").trim())
      .map((item: Record<string, unknown>) => ({
        id: String(item.id ?? "") || crypto.randomUUID(),
        certificateNo: String(item.certificateNo ?? "").trim(),
        employeeId: String(item.employeeId ?? ""),
        empId: String(item.empId ?? ""),
        empName: String(item.empName ?? ""),
        jobTitle: String(item.jobTitle ?? ""),
        hireDate: String(item.hireDate ?? ""),
        issueDate: String(item.issueDate ?? "").slice(0, 10),
        directedTo: String(item.directedTo ?? "لمن يهمه الأمر"),
        purpose: String(item.purpose ?? "شهادة خبرة"),
        notes: String(item.notes ?? ""),
        status: String(item.status ?? "معتمدة"),
      }));
  } catch {
    return [];
  }
}

function removeLegacyLocalCertificate(id: string) {
  try {
    const raw = localStorage.getItem(legacyLocalKey());
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    localStorage.setItem(legacyLocalKey(), JSON.stringify(parsed.filter((item) => String(item?.id ?? "") !== id)));
  } catch {
    // التخزين المحلي غير متاح: لا شيء نحذفه
  }
}

/** صف الإدراج في hr_certificates (نفس الشكل للإصدار الجديد ولرفع الشهادات المحلية) */
const certificatePayload = (certificate: Certificate) => ({
  id: certificate.id,
  certificate_no: certificate.certificateNo,
  employee_id: certificate.employeeId || null,
  emp_id: certificate.empId,
  emp_name: certificate.empName,
  job_title: certificate.jobTitle,
  hire_date: certificate.hireDate || null,
  issue_date: certificate.issueDate || null,
  directed_to: certificate.directedTo,
  purpose: certificate.purpose,
  notes: certificate.notes,
  status: certificate.status,
});

/** رقم الشهادة المكرر (فهرس فريد) يرجع 23505 */
const certificateErrorText = (error: unknown, fallback: string) =>
  (error as { code?: string } | null)?.code === "23505" ? "رقم الشهادة مستخدم مسبقًا؛ أعد المحاولة" : hrRequestErrorText(error, fallback);

/** هل رقم الشهادة مستخدم في قاعدة البيانات (وليس فقط في القائمة المحمّلة) */
async function certificateNoExists(certificateNo: string): Promise<boolean> {
  const { data, error } = await supabase.from("hr_certificates").select("id").eq("certificate_no", certificateNo).limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

const emptyForm = (): NewCertificateForm => ({
  employeeId: "",
  issueDate: riyadhToday(),
  directedTo: "لمن يهمه الأمر",
  purpose: "شهادة خبرة",
  notes: "",
});

const mapEmployee = (row: Record<string, unknown>): EmployeeOption => ({
  id: String(row.id ?? ""),
  empId: String(row.emp_id ?? ""),
  name: String(row.name ?? ""),
  jobTitle: String(row.job_title ?? ""),
  hireDate: String(row.hire_date ?? ""),
  status: String(row.status ?? ""),
});

const mapCertificateRow = (row: Record<string, unknown>): Certificate => {
  const id = String(row.id ?? crypto.randomUUID());
  const issueDate = String(row.issue_date ?? row.created_at ?? "").slice(0, 10);

  return {
    id,
    certificateNo: String(row.certificate_no ?? `CERT-${id.slice(0, 8).toUpperCase()}`),
    employeeId: String(row.employee_id ?? ""),
    empId: String(row.emp_id ?? ""),
    empName: String(row.emp_name ?? ""),
    jobTitle: String(row.job_title ?? ""),
    hireDate: String(row.hire_date ?? ""),
    issueDate,
    directedTo: String(row.directed_to ?? "لمن يهمه الأمر"),
    purpose: String(row.purpose ?? "شهادة خبرة"),
    notes: String(row.notes ?? ""),
    status: String(row.status ?? "معتمدة"),
  };
};

export default function HRCertificates() {
  const { t, direction } = useI18n();
  const [mode, setMode] = useState<"list" | "create">("list");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [form, setForm] = useState<NewCertificateForm>(emptyForm());
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Certificate | null>(null);
  // شهادات محفوظة على هذا الجهاز فقط (من النسخة السابقة) وليست في قاعدة البيانات
  const [localOnly, setLocalOnly] = useState<Certificate[]>([]);
  const [uploadingLocal, setUploadingLocal] = useState(false);

  useEffect(() => {
    loadAll();
  }, []);

  const selectedEmployee = useMemo(
    () => employees.find((e) => e.id === form.employeeId) ?? null,
    [employees, form.employeeId]
  );

  const filtered = useMemo(
    () =>
      certificates.filter((c) => {
        if (!search) return true;
        return `${c.certificateNo} ${c.empName} ${c.empId}`.includes(search);
      }),
    [certificates, search]
  );

  async function loadAll() {
    setLoading(true);
    try {
      const [certResult, empResult] = await Promise.all([
        supabase.from("hr_certificates").select("*").order("created_at", { ascending: false }),
        supabase
          .from("employees")
          .select("id, emp_id, name, job_title, hire_date, status")
          .in("status", CERTIFICATE_EMPLOYEE_STATUSES)
          .order("name", { ascending: true }),
      ]);

      if (certResult.error) {
        setCertificates([]);
        // لا نعرف ما في قاعدة البيانات، فلا نقارن الشهادات المحلية
        setLocalOnly([]);
        toast({ title: t("تعذر تحميل الشهادات"), description: t(hrRequestErrorText(certResult.error)), variant: "destructive" });
      } else {
        const dbCertificates = (certResult.data ?? []).map((r) => mapCertificateRow(r as Record<string, unknown>));
        setCertificates(dbCertificates);
        const dbNumbers = new Set(dbCertificates.map((c) => c.certificateNo));
        const dbIds = new Set(dbCertificates.map((c) => c.id));
        setLocalOnly(readLegacyLocalCertificates().filter((c) => !dbNumbers.has(c.certificateNo) && !dbIds.has(c.id)));
      }

      if (empResult.error) {
        setEmployees([]);
        toast({ title: t("تعذر تحميل الموظفين"), description: t(hrRequestErrorText(empResult.error)), variant: "destructive" });
      } else {
        setEmployees((empResult.data ?? []).map((r) => mapEmployee(r as Record<string, unknown>)));
      }
    } catch (error) {
      toast({ title: t("تعذر تحميل البيانات"), description: t(hrRequestErrorText(error)), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateCertificate() {
    if (!form.employeeId) {
      toast({ title: t("تنبيه"), description: t("اختر الموظف"), variant: "destructive" });
      return;
    }

    const emp = employees.find((e) => e.id === form.employeeId);
    if (!emp) {
      toast({ title: t("خطأ"), description: t("بيانات الموظف غير متاحة"), variant: "destructive" });
      return;
    }

    const id = crypto.randomUUID();
    const newCertificate: Certificate = {
      id,
      certificateNo: "",
      employeeId: emp.id,
      empId: emp.empId,
      empName: emp.name,
      jobTitle: emp.jobTitle,
      hireDate: emp.hireDate,
      issueDate: form.issueDate,
      directedTo: form.directedTo,
      purpose: form.purpose,
      notes: form.notes,
      status: "معتمدة",
    };

    setSaving(true);
    try {
      // رقم شهادة لكل منشأة يُحجز من قاعدة البيانات (1001-CERT-000001) فلا يتكرر بين المستخدمين
      let certificateNo = "";
      for (let attempt = 0; attempt < 3 && !certificateNo; attempt += 1) {
        const candidate = await nextCompanyNumber("CERT", 6);
        if (!(await certificateNoExists(candidate))) certificateNo = candidate;
      }
      if (!certificateNo) throw new Error(t("تعذر توليد رقم شهادة فريد؛ أعد المحاولة"));
      newCertificate.certificateNo = certificateNo;

      const { error } = await supabase.from("hr_certificates").insert([certificatePayload(newCertificate)]);
      if (error) throw error;

      setCertificates((prev) => [newCertificate, ...prev]);
      setSelected(newCertificate);
      setMode("list");
      setForm(emptyForm());
      toast({ title: t("تم الحفظ"), description: `${t("تم إصدار شهادة الخبرة بنجاح")} — ${t("رقم الشهادة")}: ${newCertificate.certificateNo}` });
    } catch (error) {
      // لا حفظ محلي: الشهادة لم تُسجَّل ما لم تقبلها قاعدة البيانات
      toast({ title: t("تعذر حفظ الشهادة"), description: t(certificateErrorText(error, "لم تُحفظ الشهادة")), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(certificate: Certificate) {
    if (!confirm(`${t("حذف الشهادة")} ${certificate.certificateNo}؟`)) return;

    const { data, error } = await supabase.from("hr_certificates").delete().eq("id", certificate.id).select("id");
    if (error || !data?.length) {
      toast({
        title: t("تعذر حذف الشهادة"),
        description: error ? t(hrRequestErrorText(error)) : t("لم يُحذف شيء: لا تملك صلاحية حذف هذه الشهادة"),
        variant: "destructive",
      });
      return;
    }

    setCertificates((prev) => prev.filter((c) => c.id !== certificate.id));
    // نسخة قديمة على هذا الجهاز لا يجب أن تظهر لاحقًا كشهادة غير مرفوعة
    removeLegacyLocalCertificate(certificate.id);
    if (selected?.id === certificate.id) setSelected(null);
    toast({ title: t("تم الحذف") });
  }

  // رفع شهادة محلية واحدة بعد مراجعتها: النسخة السابقة كانت تحفظ على الجهاز نسخة من كل القائمة،
  // فالشهادة "المحلية فقط" قد تكون حُذفت من قاعدة البيانات عمدًا. لا رفع جماعي.
  async function uploadLocalCertificate(certificate: Certificate) {
    if (uploadingLocal) return;
    setUploadingLocal(true);
    try {
      const { data, error } = await supabase.from("hr_certificates").select("id").eq("certificate_no", certificate.certificateNo).limit(1);
      if (error) throw error;
      const existing = (data ?? [])[0] as { id?: unknown } | undefined;
      if (existing) {
        if (String(existing.id ?? "") === certificate.id) {
          removeLegacyLocalCertificate(certificate.id);
          setLocalOnly((rows) => rows.filter((c) => c.id !== certificate.id));
          toast({ title: t("الشهادة موجودة في قاعدة البيانات"), description: certificate.certificateNo });
        } else {
          toast({ title: t("لم تُرفع"), description: `${certificate.certificateNo}: ${t("الرقم مستخدم لشهادة أخرى في قاعدة البيانات")}`, variant: "destructive" });
        }
        return;
      }
      const { error: insertError } = await supabase.from("hr_certificates").insert([certificatePayload(certificate)]);
      if (insertError) throw insertError;
      removeLegacyLocalCertificate(certificate.id);
      setLocalOnly((rows) => rows.filter((c) => c.id !== certificate.id));
      toast({ title: t("تم الرفع"), description: certificate.certificateNo });
      await loadAll();
    } catch (error) {
      toast({ title: t("لم تُرفع الشهادة"), description: `${certificate.certificateNo}: ${t(certificateErrorText(error, "لم تُرفع الشهادة"))}`, variant: "destructive" });
    } finally {
      setUploadingLocal(false);
    }
  }

  function discardLocalCertificate(certificate: Certificate) {
    removeLegacyLocalCertificate(certificate.id);
    setLocalOnly((rows) => rows.filter((c) => c.id !== certificate.id));
  }

  const totalCertificates = certificates.length;

  return (
    <Layout>
      <div dir={direction} className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Award className="h-7 w-7 text-amber-600" />
            <h1 className="text-2xl font-bold text-foreground">{t("شهادات الخبرة")}</h1>
          </div>

          <div className="flex items-center gap-2">
            {mode === "create" ? (
              <button
                onClick={() => setMode("list")}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium hover:bg-gray-50"
              >
                <ArrowRight className="h-4 w-4" />
                {t("رجوع")}
              </button>
            ) : (
              <button
                onClick={() => {
                  setMode("create");
                  setSelected(null);
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600"
              >
                <Plus className="h-4 w-4" />
                {t("إصدار شهادة جديدة")}
              </button>
            )}
          </div>
        </div>

        {mode === "create" ? (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
              <h2 className="text-lg font-semibold text-gray-800">{t("بيانات الشهادة")}</h2>

              <div>
                <label className="text-sm font-medium text-gray-700">{t("الموظف")}</label>
                <select
                  value={form.employeeId}
                  onChange={(e) => setForm((prev) => ({ ...prev, employeeId: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">{t("اختر الموظف")}</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} ({emp.empId || t("بدون رقم")}){ACTIVE_EMPLOYEE_STATUSES.includes(emp.status) ? "" : ` - ${t(emp.status)}`}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-700">{t("تاريخ الإصدار")}</label>
                  <input
                    type="date"
                    value={form.issueDate}
                    onChange={(e) => setForm((prev) => ({ ...prev, issueDate: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">{t("موجهة إلى")}</label>
                  <input
                    value={form.directedTo}
                    onChange={(e) => setForm((prev) => ({ ...prev, directedTo: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    placeholder={t("لمن يهمه الأمر")}
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700">{t("الغرض")}</label>
                <input
                  value={form.purpose}
                  onChange={(e) => setForm((prev) => ({ ...prev, purpose: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  placeholder={t("شهادة خبرة")}
                />
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700">{t("ملاحظات إضافية")}</label>
                <textarea
                  rows={4}
                  value={form.notes}
                  onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  placeholder={t("أي تفاصيل إضافية تظهر داخل الشهادة")}
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleCreateCertificate}
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-60"
                >
                  <Save className="h-4 w-4" />
                  {saving ? t("جاري الحفظ...") : t("حفظ الشهادة")}
                </button>
                <button
                  onClick={() => {
                    setMode("list");
                    setForm(emptyForm());
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium hover:bg-gray-50"
                >
                  <X className="h-4 w-4" />
                  {t("إلغاء")}
                </button>
              </div>
            </div>

            <div className="bg-white rounded-xl border-2 border-amber-200 shadow-sm p-8">
              <div className="text-center border-b border-dashed border-amber-300 pb-4 mb-6">
                <p className="text-sm text-gray-500">{t("رقم الشهادة")}</p>
                <p className="font-bold text-gray-800">{t("يُولَّد عند الحفظ")} ({companyDocPrefix()}CERT-000001)</p>
              </div>

              <div className="space-y-4 leading-8 text-gray-700">
                <h3 className="text-center text-2xl font-bold text-amber-700">{t("شهادة خبرة")}</h3>
                <p className="text-center text-sm">{t("التاريخ")}: {form.issueDate || "-"}</p>
                <p>
                  {t("تشهد إدارة الشركة بأن الموظف/ة")}
                  <span className="font-bold mx-1">{selectedEmployee?.name || "................"}</span>
                  {t("رقم الموظف")}
                  <span className="font-bold mx-1">{selectedEmployee?.empId || "........"}</span>
                  {t("عمل لدينا بمسمى")}
                  <span className="font-bold mx-1">{selectedEmployee?.jobTitle || "........"}</span>
                  .
                </p>
                <p>
                  {t("وقد منحت هذه الشهادة بناءً على طلبه/طلبها لتقديمها إلى")}:
                  <span className="font-bold mx-1">{form.directedTo || "........"}</span>
                </p>
                <p>
                  {t("الغرض من الشهادة")}:
                  <span className="font-bold mx-1">{form.purpose || "........"}</span>
                </p>
                {form.notes ? <p>{t("ملاحظات")}: {form.notes}</p> : null}
                <p className="pt-8">{t("وتفضلوا بقبول فائق الاحترام.")}</p>
                <p className="pt-8 text-left">{t("ختم وتوقيع الموارد البشرية")}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {localOnly.length > 0 && (
              <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                <p className="font-semibold">{t("توجد")} {localOnly.length} {t("شهادة محفوظة على هذا الجهاز فقط")}</p>
                <p className="text-xs">{t("قد تكون حُذفت من قاعدة البيانات عمدًا من جهاز آخر. ارفع فقط ما تتأكد أنه صادر فعلًا، وتجاهل الباقي.")}</p>
                <ul className="divide-y divide-amber-200">
                  {localOnly.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span>{c.certificateNo} — {c.empName || "-"} {c.issueDate ? `(${c.issueDate})` : ""}</span>
                      <span className="flex gap-2">
                        <button
                          onClick={() => void uploadLocalCertificate(c)}
                          disabled={uploadingLocal}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 disabled:opacity-60"
                        >
                          <Save className="h-3.5 w-3.5" />
                          {t("رفعها")}
                        </button>
                        <button
                          onClick={() => discardLocalCertificate(c)}
                          disabled={uploadingLocal}
                          className="px-3 py-1.5 rounded-lg border border-amber-300 text-xs font-medium hover:bg-amber-100 disabled:opacity-60"
                        >
                          {t("تجاهلها")}
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                <p className="text-sm text-gray-500">{t("إجمالي الشهادات")}</p>
                <p className="mt-1 text-2xl font-bold text-gray-800">{totalCertificates}</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                <p className="text-sm text-gray-500">{t("الشهادات المعتمدة")}</p>
                <p className="mt-1 text-2xl font-bold text-green-700">
                  {certificates.filter((c) => c.status === "معتمدة").length}
                </p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                <p className="text-sm text-gray-500">{t("الموظفون المشمولون")}</p>
                <p className="mt-1 text-2xl font-bold text-amber-700">
                  {new Set(certificates.map((c) => c.empId)).size}
                </p>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-4">
              <div className="relative max-w-md">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("بحث برقم الشهادة أو الموظف")}
                  className="w-full rounded-lg border border-gray-300 pr-10 pl-3 py-2 text-sm"
                />
              </div>

              <div className="overflow-auto">
                <table className="w-full min-w-[860px] text-sm">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="text-right px-3 py-2 font-semibold">{t("رقم الشهادة")}</th>
                      <th className="text-right px-3 py-2 font-semibold">{t("الموظف")}</th>
                      <th className="text-right px-3 py-2 font-semibold">{t("المسمى الوظيفي")}</th>
                      <th className="text-right px-3 py-2 font-semibold">{t("تاريخ الإصدار")}</th>
                      <th className="text-right px-3 py-2 font-semibold">{t("الحالة")}</th>
                      <th className="text-right px-3 py-2 font-semibold">{t("إجراءات")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td className="px-3 py-6 text-center text-gray-500" colSpan={6}>
                          {t("جاري التحميل...")}
                        </td>
                      </tr>
                    ) : filtered.length === 0 ? (
                      <tr>
                        <td className="px-3 py-6 text-center text-gray-500" colSpan={6}>
                          {t("لا توجد شهادات حالياً")}
                        </td>
                      </tr>
                    ) : (
                      filtered.map((certificate) => (
                        <tr key={certificate.id} className="border-t border-gray-100">
                          <td className="px-3 py-2 font-medium text-gray-800">{certificate.certificateNo}</td>
                          <td className="px-3 py-2">{certificate.empName} ({certificate.empId || "-"})</td>
                          <td className="px-3 py-2">{certificate.jobTitle || "-"}</td>
                          <td className="px-3 py-2">{certificate.issueDate || "-"}</td>
                          <td className="px-3 py-2">
                            <span className="inline-flex px-2 py-1 rounded border text-xs bg-green-100 text-green-700 border-green-200">
                              {t(certificate.status)}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setSelected(certificate)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-blue-600 text-white text-xs hover:bg-blue-700"
                              >
                                <Eye className="h-3.5 w-3.5" />
                                {t("عرض")}
                              </button>
                              <button
                                onClick={() => handleDelete(certificate)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-red-600 text-white text-xs hover:bg-red-700"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                {t("حذف")}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {selected ? (
              <div className="bg-white rounded-xl border-2 border-amber-200 shadow-sm p-8">
                <div className="flex items-center justify-between border-b border-dashed border-amber-300 pb-4 mb-6">
                  <div>
                    <p className="text-sm text-gray-500">{t("رقم الشهادة")}</p>
                    <p className="font-bold text-gray-800">{selected.certificateNo}</p>
                  </div>
                  <button
                    onClick={() => setSelected(null)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-gray-300 text-xs hover:bg-gray-50"
                  >
                    <X className="h-3.5 w-3.5" />
                    {t("إغلاق")}
                  </button>
                </div>

                <div className="space-y-4 leading-8 text-gray-700">
                  <h3 className="text-center text-2xl font-bold text-amber-700">{t("شهادة خبرة")}</h3>
                  <p className="text-center text-sm">{t("التاريخ")}: {selected.issueDate || "-"}</p>
                  <p>
                    {t("تشهد إدارة الشركة بأن الموظف/ة")}
                    <span className="font-bold mx-1">{selected.empName}</span>
                    {t("رقم الموظف")}
                    <span className="font-bold mx-1">{selected.empId || "-"}</span>
                    {t("عمل لدينا بمسمى")}
                    <span className="font-bold mx-1">{selected.jobTitle || "-"}</span>
                    .
                  </p>
                  <p>
                    {t("وقد منحت هذه الشهادة بناءً على طلبه/طلبها لتقديمها إلى")}:
                    <span className="font-bold mx-1">{selected.directedTo || "-"}</span>
                  </p>
                  <p>
                    {t("الغرض من الشهادة")}:
                    <span className="font-bold mx-1">{selected.purpose || "-"}</span>
                  </p>
                  {selected.notes ? <p>{t("ملاحظات")}: {selected.notes}</p> : null}
                  <p className="pt-8">{t("وتفضلوا بقبول فائق الاحترام.")}</p>
                  <p className="pt-8 text-left">{t("ختم وتوقيع الموارد البشرية")}</p>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </Layout>
  );
}
