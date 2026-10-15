import { useEffect, useMemo, useState } from "react";
import { Wrench, Lock, Mail, Copy, RefreshCw, Search, KeyRound } from "lucide-react";
import { toast } from "sonner";
import Layout from "@/components/Layout";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/i18n";

// صفحة إيميلات الموظفين: توليد بريد داخلي وكلمة مرور لكل موظف وربطهما بملفه، ليدخل بريده من بوابة الموظف.
// القفل 1234 واجهة فقط؛ الحماية الحقيقية في دالة الخادم (مدير النظام أو إدارة الموارد البشرية،
// وكلمات المرور المحفوظة لا تُعرض إلا لمدير النظام).
// أداة الخصومات الآلية التي كانت في هذه الصفحة موقوفة ولا تعود.

type GeneratedEmail = {
  id: string;
  emp_id: string;
  emp_name: string;
  generated_email: string;
  generated_password: string;
  created_at: string;
};

type EmployeeOption = {
  id: string;
  emp_id: string;
  name: string;
  nationality: string;
};

type NewCredential = {
  emp_id: string;
  emp_name: string;
  generated_email: string;
  generated_password: string;
};

const INACTIVE_STATUSES = new Set([
  "غير فعال", "غير نشط", "منتهي", "منتهية", "منتهي الخدمة", "مستقيل", "مفصول", "موقوف", "inactive", "terminated",
]);

// رسالة الخطأ من دالة الخادم: من جسم الرد إن وُجد، ومن الاستجابة نفسها إن كانت Response فقط
const functionErrorText = async (data: any, error: unknown, fallback: string) => {
  if (data?.error) return String(data.error);
  const context = (error as { context?: unknown } | null)?.context as { clone?: () => Response; json?: () => Promise<any> } | undefined;
  if (context && typeof context.json === "function") {
    try {
      const body = typeof context.clone === "function" ? await context.clone().json() : await context.json();
      if (body?.error) return String(body.error);
    } catch {
      // الرد ليس JSON
    }
  }
  const message = (error as { message?: string } | null)?.message;
  if (message && /failed to send|failed to fetch|network/i.test(message)) return "تعذر الاتصال بالخادم؛ تحقق من الإنترنت ثم أعد المحاولة";
  return message || fallback;
};

const copyText = async (value: string) => {
  try {
    await navigator.clipboard.writeText(value);
    toast.success("تم النسخ");
  } catch {
    toast.error("تعذر النسخ؛ انسخه يدويًا");
  }
};

function EmployeeEmailsTool() {
  const { t } = useI18n();
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [generatedEmails, setGeneratedEmails] = useState<GeneratedEmail[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [lastCredential, setLastCredential] = useState<NewCredential | null>(null);

  const loadEmployees = async () => {
    const { data, error } = await supabase
      .from("employees")
      .select("id, emp_id, name, nationality, status")
      .order("emp_id");
    if (error) {
      toast.error(t("تعذر تحميل الموظفين"));
      return;
    }
    setEmployees((data ?? [])
      .filter((row: any) => !INACTIVE_STATUSES.has(String(row.status ?? "").trim().toLowerCase()))
      .map((row: any) => ({
        id: String(row.id),
        emp_id: String(row.emp_id ?? ""),
        name: String(row.name ?? ""),
        nationality: String(row.nationality ?? ""),
      })));
  };

  const loadGeneratedEmails = async () => {
    setListLoading(true);
    setListError("");
    const { data, error } = await supabase.functions.invoke("manage-employee-credentials", {
      body: { action: "list" },
    });
    if (error || !data?.success) {
      setListError(await functionErrorText(data, error, "تعذر تحميل الإيميلات المحفوظة"));
      setGeneratedEmails([]);
      setListLoading(false);
      return;
    }
    setGeneratedEmails((data.credentials ?? []) as GeneratedEmail[]);
    setListLoading(false);
  };

  useEffect(() => {
    loadEmployees();
    loadGeneratedEmails();
  }, []);

  const withEmail = useMemo(() => new Set(generatedEmails.map((row) => String(row.emp_id ?? "").trim())), [generatedEmails]);

  const generateEmailForEmployee = async () => {
    const employee = employees.find((row) => row.id === selectedEmployee);
    if (!employee) {
      toast.error(t("اختر موظفاً"));
      return;
    }
    if (withEmail.has(employee.emp_id.trim())
        && !window.confirm(`${employee.name} ${t("لديه بريد محفوظ. إعادة التوليد تغيّر كلمة مرور بريده، ويلزم إبلاغه بالجديدة. متابعة؟")}`)) {
      return;
    }

    setIsLoading(true);
    const { data, error } = await supabase.functions.invoke("manage-employee-credentials", {
      body: { action: "generate", employeeId: employee.id },
    });
    setIsLoading(false);

    if (error || !data?.success) {
      toast.error(await functionErrorText(data, error, "تعذر توليد بيانات دخول الموظف"));
      return;
    }

    const credential = data.credential ?? {};
    setLastCredential({
      emp_id: String(credential.emp_id ?? employee.emp_id),
      emp_name: String(credential.emp_name ?? employee.name),
      generated_email: String(credential.generated_email ?? ""),
      generated_password: String(credential.generated_password ?? ""),
    });
    toast.success(t("تم توليد وحفظ البريد وكلمة المرور وربطهما بالموظف"));
    setSelectedEmployee("");
    await loadGeneratedEmails();
  };

  const visibleEmails = generatedEmails.filter((row) => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return [row.emp_name, row.emp_id, row.generated_email].some((value) => String(value ?? "").toLowerCase().includes(query));
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 p-6 rounded-2xl">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-8 flex items-center gap-3">
          <Mail className="h-8 w-8 text-blue-400" />
          {t("إيميلات الموظفين")}
        </h1>

        <div className="bg-gray-800 rounded-xl p-6 text-white space-y-4">
          <h2 className="text-xl font-bold mb-2 flex items-center gap-2">
            <Mail className="h-5 w-5 text-blue-400" />
            {t("توليد الإيميلات")}
          </h2>
          <p className="text-sm text-gray-300">
            {t("يُولَّد للموظف بريد داخلي وكلمة مرور ويُربطان بملفه، فيدخل بهما إلى بريده من بوابة الموظف.")}
          </p>

          <select
            value={selectedEmployee}
            onChange={(event) => setSelectedEmployee(event.target.value)}
            className="w-full px-4 py-2 bg-gray-700 rounded-lg text-white"
          >
            <option value="">{t("اختر موظف")}</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name} ({employee.emp_id}){withEmail.has(employee.emp_id.trim()) ? ` — ${t("لديه بريد")}` : ""}
              </option>
            ))}
          </select>

          <button
            onClick={generateEmailForEmployee}
            disabled={!selectedEmployee || isLoading}
            className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 py-2 rounded-lg font-semibold flex items-center justify-center gap-2"
          >
            <Mail className="h-5 w-5" />
            {isLoading ? t("جاري التوليد والحفظ...") : t("توليد وحفظ بيانات الدخول")}
          </button>

          {lastCredential && (
            <div className="rounded-lg border border-green-500/40 bg-green-900/30 p-4 space-y-2">
              <p className="font-semibold">{t("بيانات دخول بريد")} {lastCredential.emp_name} ({lastCredential.emp_id})</p>
              <div className="flex items-center gap-2">
                <p dir="ltr" className="flex-1 text-sm text-green-300 font-mono text-left">{lastCredential.generated_email}</p>
                <button onClick={() => copyText(lastCredential.generated_email)} title={t("نسخ")} aria-label={t("نسخ")} className="p-1.5 rounded hover:bg-white/10"><Copy className="h-4 w-4" /></button>
              </div>
              {lastCredential.generated_password && (
                <div className="flex items-center gap-2">
                  <p dir="ltr" className="flex-1 text-sm text-amber-300 font-mono text-left">{lastCredential.generated_password}</p>
                  <button onClick={() => copyText(lastCredential.generated_password)} title={t("نسخ")} aria-label={t("نسخ")} className="p-1.5 rounded hover:bg-white/10"><Copy className="h-4 w-4" /></button>
                </div>
              )}
              <p className="text-xs text-gray-300">{t("سلّمها للموظف ليدخل بريده من البوابة. تظهر كلمة المرور هنا مرة واحدة، وفي القائمة لمدير النظام فقط.")}</p>
            </div>
          )}

          <div className="space-y-2 mt-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <h3 className="font-bold">{t("الإيميلات المحفوظة")} ({generatedEmails.length})</h3>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="h-4 w-4 absolute start-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={t("بحث بالاسم أو الرقم أو البريد")}
                    className="ps-9 pe-3 py-2 bg-gray-700 rounded-lg text-white text-sm placeholder-gray-400 outline-none"
                  />
                </div>
                <button onClick={loadGeneratedEmails} title={t("تحديث")} aria-label={t("تحديث")} className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600">
                  <RefreshCw className={`h-4 w-4 ${listLoading ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>
            {listError ? (
              <p className="text-sm text-red-300">{listError}</p>
            ) : listLoading ? (
              <p className="text-sm text-gray-400">{t("جاري التحميل...")}</p>
            ) : visibleEmails.length === 0 ? (
              <p className="text-sm text-gray-400">{t("لا توجد إيميلات محفوظة")}</p>
            ) : visibleEmails.map((email) => (
              <div key={email.id} className="bg-gray-700 p-4 rounded-lg">
                <p className="font-semibold">{email.emp_name} <span className="text-xs text-gray-400">({email.emp_id})</span></p>
                <div className="flex items-center gap-2">
                  <p dir="ltr" className="flex-1 text-sm text-green-400 font-mono text-left">{email.generated_email}</p>
                  <button onClick={() => copyText(email.generated_email)} title={t("نسخ")} aria-label={t("نسخ")} className="p-1.5 rounded hover:bg-white/10"><Copy className="h-4 w-4" /></button>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-amber-300" />
                  {email.generated_password ? (
                    <>
                      <p dir="ltr" className="flex-1 text-sm text-amber-300 font-mono text-left">{email.generated_password}</p>
                      <button onClick={() => copyText(email.generated_password)} title={t("نسخ")} aria-label={t("نسخ")} className="p-1.5 rounded hover:bg-white/10"><Copy className="h-4 w-4" /></button>
                    </>
                  ) : (
                    <p className="flex-1 text-sm text-gray-400">{t("كلمة المرور تظهر لمدير النظام فقط")}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HRDeductionsEmails() {
  const { t, direction } = useI18n();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handlePasswordSubmit = () => {
    if (password === "1234") {
      setIsAuthenticated(true);
      setPassword("");
      setError("");
    } else {
      setError(t("كلمة المرور غير صحيحة"));
      setPassword("");
    }
  };

  if (!isAuthenticated) {
    return (
      <Layout>
        <div className="h-full flex items-center justify-center p-4">
          <div className="w-full max-w-md">
            <div className="bg-white rounded-2xl shadow-xl p-8 space-y-6">
              {/* Logo Only */}
              <div className="flex justify-center">
                <div className="p-4 bg-orange-100 rounded-2xl">
                  <Wrench className="h-8 w-8 text-orange-600" />
                </div>
              </div>

              {/* Password Input */}
              <div className="space-y-3">
                <label className="block text-sm font-semibold text-gray-700">
                  <Lock className="h-4 w-4 inline mr-2" />
                  {t("كلمة المرور")}
                </label>
                <input
                  type="password"
                  placeholder={t("أدخل كلمة المرور")}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handlePasswordSubmit();
                    }
                  }}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
                {error && <p className="text-sm text-red-600 font-medium">{error}</p>}
              </div>

              {/* Submit Button */}
              <button
                onClick={handlePasswordSubmit}
                className="w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold py-3 rounded-lg transition"
              >
                {t("دخول")}
              </button>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div dir={direction} className="space-y-6">
        {/* Logo Only - No Text */}
        <div className="flex items-center justify-between mb-8">
          <div className="p-3 bg-orange-100 rounded-lg">
            <Wrench className="h-6 w-6 text-orange-600" />
          </div>
          <button
            onClick={() => setIsAuthenticated(false)}
            className="text-sm text-gray-600 hover:text-gray-900 font-medium"
          >
            {t("خروج")}
          </button>
        </div>

        {/* Content */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
          <EmployeeEmailsTool />
        </div>
      </div>
    </Layout>
  );
}
