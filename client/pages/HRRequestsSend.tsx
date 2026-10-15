import { useState, useEffect } from "react";
import Layout from "@/components/Layout";
import { ChevronDown, Send, List } from "lucide-react";
import { cn } from "@/lib/utils";
import LeaveRequestForm from "@/components/hr/LeaveRequestForm";
import DynamicRequestForm from "@/components/hr/DynamicRequestForm";
import { requestFormSchemas } from "@/components/hr/formSchemas";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/i18n";
import { readUserSession } from "@/lib/authSession";

// ─── Request Types Grid ───────────────────────────────────────────────────────
const REQUEST_TYPES = [
  // Row 1
  { id: "custody",        label: "عهدة",                icon: "📋" },
  { id: "leave",          label: "الإجازات",             icon: "📅" },
  { id: "accommodation",  label: "استئذان",             icon: "🏠" },
  { id: "advance",        label: "السلف",                icon: "💰" },
  { id: "disbursement",   label: "الصرف",                icon: "💳" },
  { id: "maintenance",    label: "صيانة",                icon: "🔧" },
  // Row 2
  { id: "purchase",       label: "شراء",                 icon: "🛒" },
  { id: "clearance",      label: "إخلاء طرف",            icon: "🚪" },
  { id: "transfer",       label: "نقل",                  icon: "🔄" },
  { id: "training",       label: "دورة تدريبية",          icon: "🖥️" },
  { id: "overtime",       label: "عمل إضافي",            icon: "👥" },
  { id: "empty1",         label: "",                     icon: "" },
  // Row 3
  { id: "resignation",    label: "استقالة",              icon: "📝" },
  { id: "secondment",     label: "انتداب",               icon: "👤" },
  { id: "return_work",    label: "مباشرة العمل",          icon: "👥" },
  { id: "add_party",      label: "إضافة طرف",            icon: "👤" },
  { id: "empty2",         label: "",                     icon: "" },
  { id: "empty3",         label: "",                     icon: "" },
  // Row 4
  { id: "salary_adj",     label: "تعديل راتب",           icon: "📝" },
  { id: "add_employee",   label: "إضافة موظف",           icon: "📝" },
  { id: "vacancy",        label: "وظيفة شاغرة",          icon: "🗂️" },
  { id: "termination",    label: "إقالة موظف",           icon: "🚫" },
  { id: "disburse_bonus", label: "صرف امتياز مالي",      icon: "📝" },
  { id: "empty4",         label: "",                     icon: "" },
  // Row 5
  { id: "empty5",         label: "",                     icon: "" },
  { id: "leave_dues",     label: "صرف مستحقات إجازة",    icon: "📝" },
  { id: "commission",     label: "صرف عمولة",            icon: "📁" },
  { id: "mission",        label: "مهمة عمل",             icon: "💼" },
  { id: "empty6",         label: "",                     icon: "" },
  { id: "empty7",         label: "",                     icon: "" },
];

// ─── Main Component ──────────────────────────────────────────────────────────
export default function HRRequestsSend() {
  const { t, direction } = useI18n();
  const [selectedRequest, setSelectedRequest] = useState<string | null>(null);
  const [delegateDept, setDelegateDept] = useState("");
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [leaveFormOpen, setLeaveFormOpen] = useState(false);
  const [dynamicFormOpen, setDynamicFormOpen] = useState(false);
  const [activeSchemaId, setActiveSchemaId] = useState<string | null>(null);
  const [employeeInfo, setEmployeeInfo] = useState({
    empId: "",
    name: "",
    department: "",
    directManager: ""
  });

  useEffect(() => {
    const loadAdminUser = async () => {
      try {
        // المرسل هو صاحب الجلسة نفسه (لا أول موظف في الجدول)
        const session = readUserSession();
        const [employeeResult, departmentResult] = await Promise.all([
          session?.empId
            ? supabase.from("employees").select("emp_id, name, department_id, directorate, department, direct_manager").eq("emp_id", session.empId).maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          supabase.from("departments").select("id, name").order("name"),
        ]);
        const departmentRows = (departmentResult.data ?? []).map((row) => ({ id: String(row.id), name: String(row.name) }));
        setDepartments(departmentRows);
        const data = employeeResult.data;
        if (data) {
          setEmployeeInfo({
            empId: data.emp_id || "",
            name: data.name || "",
            department: departmentRows.find((item) => item.id === String(data.department_id ?? ""))?.name || data.directorate || data.department || "",
            directManager: data.direct_manager || ""
          });
        }
      } catch (err) {
        console.warn("Could not load employee info", err);
      }
    };
    loadAdminUser();
  }, []);

  const handleRequestClick = (id: string, label: string) => {
    if (!label) return;
    setSelectedRequest(id);

    if (id === "leave") {
      setLeaveFormOpen(true);
    } else if (requestFormSchemas[id]) {
      setActiveSchemaId(id);
      setDynamicFormOpen(true);
    } else {
      alert(`${t("نموذج")} ${t(label)} ${t("غير متوفر حالياً")}`);
    }
  };

  return (
    <Layout>
      <div className="mx-auto max-w-7xl" dir={direction}>
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
          <span className="text-blue-600 font-medium cursor-pointer hover:underline">{t("الطلبات")}</span>
          <span>/</span>
          <span>{t("إرسال الطلبات")}</span>
        </div>

        <div className="flex gap-5">
          {/* ── Left: Request Cards Grid ── */}
          <div className="flex-1 min-w-0">
            {/* Top action bar */}
            <div className="flex items-center justify-between mb-4 gap-3">
              <p className="text-sm text-gray-500">{t("قائمة سلسلة الموافقات الخاصة بهذا الحساب")}</p>
              <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition shadow-sm">
                <Send className="h-4 w-4" />
                {t("نماذج إرسال الطلبات")}
              </button>
            </div>

            {/* Cards Grid */}
            <div className="grid grid-cols-6 gap-3">
              {REQUEST_TYPES.map((req) => {
                if (!req.label) {
                  return <div key={req.id} />;
                }
                return (
                  <button
                    key={req.id}
                    onClick={() => handleRequestClick(req.id, req.label)}
                    className={cn(
                      "flex flex-col items-center justify-center gap-2 p-4 rounded-xl border transition-all duration-200 cursor-pointer hover:shadow-md",
                      selectedRequest === req.id
                        ? "border-blue-500 bg-blue-50 shadow-md"
                        : "border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/40"
                    )}
                  >
                    <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center text-2xl">
                      {req.icon}
                    </div>
                    <span className="text-xs font-medium text-gray-700 text-center leading-tight">
                      {t(req.label)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Right: Employee Info + Delegate ── */}
          <div className="w-72 flex-shrink-0 space-y-4">
            {/* Employee Card */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
              {/* Blue header */}
              <div className="bg-blue-600 h-16 relative" />
              {/* Avatar */}
              <div className="flex flex-col items-center -mt-8 px-4 pb-4">
                <div className="w-16 h-16 rounded-full border-4 border-white shadow-lg bg-blue-100 flex items-center justify-center overflow-hidden">
                  <svg viewBox="0 0 100 100" className="w-full h-full" fill="none">
                    <circle cx="50" cy="50" r="50" fill="#dbeafe" />
                    <ellipse cx="50" cy="38" rx="16" ry="18" fill="#93c5fd" />
                    <ellipse cx="50" cy="80" rx="26" ry="22" fill="#60a5fa" />
                    <circle cx="50" cy="37" r="13" fill="#fcd34d" />
                    <ellipse cx="50" cy="34" rx="12" ry="8" fill="#1e3a5f" />
                  </svg>
                </div>
              </div>

              {/* Employee Info */}
              <div className="px-4 pb-4 space-y-2 text-sm">
                <div className="flex justify-between border-b border-gray-100 py-1.5">
                  <span className="text-gray-500">{t("الاسم")}</span>
                  <span className="font-medium text-gray-800 text-left">{employeeInfo.empId} - {employeeInfo.name}</span>
                </div>
                <div className="flex justify-between border-b border-gray-100 py-1.5">
                  <span className="text-gray-500">{t("الإدارة")}</span>
                  <span className="font-medium text-gray-800">{employeeInfo.department}</span>
                </div>
                <div className="flex justify-between py-1.5">
                  <span className="text-gray-500">{t("المدير المباشر")}</span>
                  <span className="font-medium text-gray-800">{employeeInfo.directManager}</span>
                </div>
              </div>
            </div>

            {/* Delegate Section */}
            <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm space-y-3">
              <h3 className="text-sm font-semibold text-gray-800">{t("إرسال طلب عوضاً عن موظف")}</h3>

              {departments.map((department) => (
                <div
                  key={department.id}
                  className={cn(
                    "flex items-center justify-between px-3 py-2.5 rounded-lg border cursor-pointer transition",
                    delegateDept === department.id
                      ? "border-blue-400 bg-blue-50"
                      : "border-gray-200 hover:bg-gray-50"
                  )}
                  onClick={() => setDelegateDept(delegateDept === department.id ? "" : department.id)}
                >
                  <span className="text-sm text-gray-700">{department.name}</span>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 text-gray-400 transition-transform",
                      delegateDept === department.id && "rotate-180"
                    )}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Forms */}
      <LeaveRequestForm
        open={leaveFormOpen}
        onOpenChange={setLeaveFormOpen}
        employeeInfo={{ empId: employeeInfo.empId, name: employeeInfo.name }}
      />
      <DynamicRequestForm
        open={dynamicFormOpen}
        onOpenChange={setDynamicFormOpen}
        schema={activeSchemaId ? requestFormSchemas[activeSchemaId] : null}
        employeeInfo={{ empId: employeeInfo.empId, name: employeeInfo.name }}
      />
    </Layout>
  );
}
