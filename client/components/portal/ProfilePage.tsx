import { useEffect, useState } from "react";
import { ChevronLeft, Edit2, Save, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { EmployeePhoto } from "@/components/hr/employeeFiles";

type Props = { empId: string; onBack: () => void };

type EmpData = Record<string, string | null>;

const TABS = ["المعلومات الشخصية", "العقد", "البنك"] as const;
/**
 * الحقول التي يعدّلها الموظف بنفسه. بقية البيانات (الاسم، الهوية، البريد، البنك، العقد)
 * تُعدَّل عبر الموارد البشرية، وتمنع قاعدة البيانات تعديلها من البوابة.
 */
const SELF_EDITABLE_FIELDS = ["phone", "marital_status", "id_expiry_date"] as const;
const isSelfEditable = (key: string) => (SELF_EDITABLE_FIELDS as readonly string[]).includes(key);
type Tab = typeof TABS[number];

export default function ProfilePage({ empId, onBack }: Props) {
  const { t, formatDate } = useI18n();
  const [activeTab, setActiveTab] = useState<Tab>("المعلومات الشخصية");
  const [data, setData] = useState<EmpData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState<EmpData>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: emp } = await supabase
        .from("employees")
        .select("*")
        .eq("emp_id", empId)
        .maybeSingle();
      if (emp) {
        setData(emp as EmpData);
        setForm(emp as EmpData);
      }
      setLoading(false);
    }
    load();
  }, [empId]);

  const save = async () => {
    setSaving(true);
    // إرسال الحقول المسموح بها فقط بدل السجل كاملًا
    const payload = Object.fromEntries(
      SELF_EDITABLE_FIELDS.map((key) => {
        const value = form[key];
        return [key, value === undefined || value === "" ? null : value];
      }),
    );
    const { error } = await supabase.from("employees").update(payload).eq("emp_id", empId);
    if (error) toast.error(`${t("تعذر الحفظ")}: ${error.message}`);
    else {
      toast.success(t("تم حفظ البيانات"));
      setData((current) => ({ ...(current ?? {}), ...payload }));
      setEditMode(false);
    }
    setSaving(false);
  };

  const personalFields = [
    { key: "name", label: "الاسم" },
    { key: "national_id", label: "رقم الهوية" },
    { key: "id_expiry_date", label: "تاريخ إنتهاء الهوية" },
    { key: "nationality", label: "الجنسية" },
    { key: "marital_status", label: "الحالة الاجتماعية" },
    { key: "gender", label: "الجنس" },
    { key: "birth_date", label: "تاريخ الميلاد" },
    { key: "phone", label: "الهاتف" },
    { key: "email", label: "البريد الإلكتروني" },
  ];

  const contractFields = [
    { key: "emp_id", label: "الرقم الوظيفي" },
    { key: "job_title", label: "المسمى الوظيفي" },
    { key: "department", label: "القسم" },
    { key: "directorate", label: "الإدارة" },
    { key: "branch", label: "الفرع" },
    { key: "hire_date", label: "تاريخ التعيين" },
    { key: "employment_type", label: "نوع العقد" },
    { key: "work_location", label: "مكان العمل" },
    { key: "base_salary", label: "الراتب الأساسي" },
    { key: "total_salary", label: "الراتب الإجمالي" },
  ];

  const bankFields = [
    { key: "bank_name", label: "اسم الحساب البنكي" },
    { key: "bank_branch", label: "اسم الفرع" },
    { key: "bank_account", label: "رقم الحساب" },
    { key: "iban", label: "رقم الآيبان" },
  ];

  const activeFields = activeTab === "المعلومات الشخصية" ? personalFields : activeTab === "العقد" ? contractFields : bankFields;

  if (loading) return <div className="flex items-center justify-center h-full text-gray-400">{t("جاري التحميل...")}</div>;

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="flex items-center justify-between p-4">
          <button onClick={onBack} className="text-[#004e89]"><ChevronLeft className="h-6 w-6 rotate-180" /></button>
          <h2 className="font-bold text-lg text-gray-900">{t("الملف الشخصي")}</h2>
          <button onClick={() => editMode ? save() : setEditMode(true)} disabled={saving} className="text-[#004e89]">
            {editMode ? (saving ? <span className="text-xs">حفظ...</span> : <Save className="h-5 w-5" />) : <Edit2 className="h-5 w-5" />}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-24">
        {/* Profile Header */}
        <div className="bg-[#004e89] text-white p-6 pb-12 text-center">
          <div className="w-20 h-20 rounded-full bg-white/20 flex items-center justify-center text-white text-3xl font-bold mx-auto mb-3 overflow-hidden">
            <EmployeePhoto value={(data as any)?.photo_url} name={data?.name ?? ""} />
          </div>
          <h3 className="text-xl font-bold">{data?.name ?? "—"}</h3>
          <p className="text-blue-100 text-sm mt-1">{(data as any)?.job_title ?? ""}</p>
          <div className="flex justify-center gap-6 mt-3 text-sm">
            <div><p className="text-blue-200">{t("الإدارة")}</p><p className="font-semibold">{(data as any)?.directorate ?? "—"}</p></div>
            <div><p className="text-blue-200">{t("الرقم الوظيفي")}</p><p className="font-semibold">{data?.emp_id ?? "—"}</p></div>
            <div><p className="text-blue-200">{t("تاريخ التعيين")}</p><p className="font-semibold">{(data as any)?.hire_date ? formatDate((data as any).hire_date, { dateStyle: "medium" }) : "—"}</p></div>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white border-b flex sticky top-[65px] z-10 -mt-6 rounded-t-2xl">
          {TABS.map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`flex-1 py-3 text-sm font-semibold border-b-2 transition ${activeTab === tab ? "border-[#004e89] text-[#004e89]" : "border-transparent text-gray-500"}`}>{t(tab)}</button>
          ))}
        </div>

        {/* Fields */}
        <div className="p-4 space-y-1">
          <h3 className="font-bold text-gray-800 mb-3">{t(activeTab)}</h3>
          {editMode && <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{t("يمكنك تعديل الهاتف والحالة الاجتماعية وتاريخ انتهاء الهوية فقط. لتعديل الاسم أو الهوية أو البريد أو بيانات البنك تواصل مع الموارد البشرية.")}</p>}
          {activeFields.map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between py-3 border-b border-gray-100">
              <span className="text-gray-500 text-sm">{t(label)}</span>
              {editMode && isSelfEditable(key) ? (
                <input
                  value={(form as any)[key] ?? ""}
                  type={key === "id_expiry_date" ? "date" : "text"}
                  onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
                  className="border-b border-[#004e89] text-start outline-none text-sm text-gray-800 bg-transparent min-w-0 w-40"
                />
              ) : (
                <span className="font-medium text-gray-800 text-sm">{(data as any)?.[key] ?? t("لا يوجد")}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
