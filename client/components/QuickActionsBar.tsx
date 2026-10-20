import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell,
  BriefcaseBusiness,
  Calculator,
  CheckCircle,
  ChevronDown,
  Languages,
  Landmark,
  LogIn,
  LogOut,
  Mail,
  MessageSquare,
  Phone,
  RefreshCw,
  User,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { readUserSession } from "@/lib/authSession";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { hrRequestErrorText } from "@/lib/hrErrors";
import { riyadhDateString } from "@/lib/utils";
import { dbErrorOr } from "@/lib/dbErrors";
import { useCompany } from "@/lib/companyContext";
import { hasCompanyModule, type CompanyModule } from "@/lib/companyModules";

// S19: أزرار تتبع قسمًا من أقسام المنشأة (تُخفى إن لم يكن في باقتها)
const ACTION_MODULE: Partial<Record<string, CompanyModule>> = {
  management: "hr",
  incoming: "hr",
  accountant: "accounting",
};

type Panel =
  | "contact"
  | "management"
  | "calculator"
  | "notifications"
  | "language"
  | "account"
  | null;
type ContactSettings = { phone: string; email: string; whatsapp: string };
type Notice = { id: string; title: string; status: string; date: string };

const actions = [
  {
    id: "contact" as const,
    label: "اتصل بنا",
    icon: Phone,
    color: "from-sky-500 to-blue-600",
  },
  {
    id: "management" as const,
    label: "تواصل مع الإدارة",
    icon: MessageSquare,
    color: "from-indigo-500 to-violet-600",
  },
  {
    id: "refresh" as const,
    label: "تحديث الكاش",
    icon: RefreshCw,
    color: "from-emerald-500 to-teal-600",
  },
  {
    id: "calculator" as const,
    label: "آلة حاسبة",
    icon: Calculator,
    color: "from-amber-500 to-orange-600",
  },
  {
    id: "incoming" as const,
    label: "الطلبات الواردة",
    icon: Mail,
    color: "from-cyan-500 to-sky-600",
  },
  {
    id: "notifications" as const,
    label: "الإشعارات",
    icon: Bell,
    color: "from-rose-500 to-pink-600",
  },
  {
    id: "language" as const,
    label: "اللغة",
    icon: Languages,
    color: "from-purple-500 to-fuchsia-600",
  },
  {
    id: "accountant" as const,
    label: "المحاسب",
    icon: Landmark,
    color: "from-blue-700 to-indigo-800",
  },
  {
    id: "tasks" as const,
    label: "المهام والمشاريع",
    icon: BriefcaseBusiness,
    color: "from-slate-600 to-slate-800",
  },
];

export default function QuickActionsBar() {
  const navigate = useNavigate();
  const { t, locale, direction, setLocale, formatDate, formatNumber } =
    useI18n();
  const session = readUserSession();
  const { modules: companyModules } = useCompany();
  const hrOn = hasCompanyModule(companyModules, "hr");
  const visibleActions = actions.filter((action) => hasCompanyModule(companyModules, ACTION_MODULE[action.id] ?? null));
  const [panel, setPanel] = useState<Panel>(null);
  const [contacts, setContacts] = useState<ContactSettings>({
    phone: "",
    email: "",
    whatsapp: "",
  });
  const [contactSaving, setContactSaving] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [noticeCount, setNoticeCount] = useState(0);
  const [notificationResetAt] = useState(() => {
    const stored = localStorage.getItem("app-notifications-reset-at-v1");
    if (stored) return stored;
    const resetAt = new Date().toISOString();
    localStorage.setItem("app-notifications-reset-at-v1", resetAt);
    return resetAt;
  });
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [firstNumber, setFirstNumber] = useState(0);
  const [secondNumber, setSecondNumber] = useState(0);
  const [operator, setOperator] = useState<"+" | "-" | "×" | "÷">("+");

  const loadNotices = async () => {
    // الطلبات والإجازات من الموارد البشرية: بلا القسم لا إشعارات منها
    if (!session?.id || !hrOn) {
      setNotices([]);
      setNoticeCount(0);
      return;
    }

    const [leaveResult, requestResult] = await Promise.all([
      supabase
        .from("leave_requests")
        .select("id, leave_type, status, created_at")
        .eq("recipient_auth_user_id", session.id)
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("hr_requests")
        .select("id, request_type, status, created_at")
        .eq("recipient_auth_user_id", session.id)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);
    const rows: Notice[] = [
      ...(leaveResult.data ?? []).map((row: any) => ({
        id: `l-${row.id}`,
        title: row.leave_type ?? "طلب إجازة",
        status: row.status ?? "معلق",
        date: row.created_at ?? "",
      })),
      ...(requestResult.data ?? []).map((row: any) => ({
        id: `r-${row.id}`,
        title: row.request_type ?? "طلب موظف",
        status: row.status ?? "معلق",
        date: row.created_at ?? "",
      })),
    ]
      .filter((row) => row.date > notificationResetAt)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 7);
    setNotices(rows);
    setNoticeCount(
      rows.filter((row) => ["معلق", "معلقة", "pending"].includes(row.status))
        .length,
    );
  };

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("app_contact_settings")
        .select("phone, email, whatsapp")
        .eq("id", "main")
        .maybeSingle();
      if (data)
        setContacts({
          phone: data.phone ?? "",
          email: data.email ?? "",
          whatsapp: data.whatsapp ?? "",
        });
      await loadNotices();
    };
    void load();
  }, []);

  const handleAction = (id: string) => {
    if (id === "refresh") {
      toast.success(t("جاري تحديث بيانات النظام..."));
      window.setTimeout(() => window.location.reload(), 250);
      return;
    }
    if (id === "incoming") {
      navigate("/hr/requests/incoming");
      return;
    }
    if (id === "tasks") {
      navigate("/tasks-projects");
      return;
    }
    if (id === "accountant") {
      navigate("/expenses/accountant");
      return;
    }
    setPanel((current) => (current === id ? null : (id as Panel)));
  };

  const saveContacts = async () => {
    setContactSaving(true);
    const { error } = await supabase.rpc("set_app_contact_settings", {
      p_phone: contacts.phone,
      p_email: contacts.email,
      p_whatsapp: contacts.whatsapp,
    });
    setContactSaving(false);
    if (error) return toast.error(t(dbErrorOr(error.message)));
    toast.success(t("تم حفظ بيانات الاتصال"));
  };

  const sendToManagement = async () => {
    if (!session?.empId || !subject.trim() || !message.trim()) {
      toast.error(t("أدخل الموضوع والرسالة وتأكد من ارتباط الحساب بموظف"));
      return;
    }
    setSending(true);
    try {
      const { data: signature } = await supabase.rpc(
        "get_my_employee_signature",
      );
      if (!signature?.signatureData)
        throw new Error(t("يجب حفظ توقيعك الإلكتروني من نموذج طلب موظف أولاً"));
      const { error } = await supabase.from("hr_requests").insert({
        id: crypto.randomUUID(),
        emp_id: session.empId,
        emp_name: session.name,
        request_type: "تواصل مع الإدارة",
        start_date: riyadhDateString(),
        end_date: riyadhDateString(),
        status: "معلق",
        details: { subject: subject.trim(), message: message.trim() },
        signature_data: signature.signatureData,
        signed_at: new Date().toISOString(),
      });
      if (error) throw error;
      setSubject("");
      setMessage("");
      setPanel(null);
      await loadNotices();
      toast.success(t("تم إرسال رسالتك إلى الإدارة"));
    } catch (error) {
      toast.error(
        t(hrRequestErrorText(error instanceof Error ? { message: error.message } : error, "تعذر إرسال الرسالة")),
      );
    } finally {
      setSending(false);
    }
  };

  const changeLanguage = async (lang: "ar" | "en") => {
    await setLocale(lang);
    setPanel(null);
    toast.success(
      lang === "ar" ? "تم اختيار اللغة العربية" : "Language preference saved",
    );
  };

  const logout = async () => {
    localStorage.removeItem("user_session");
    await supabase.auth.signOut();
    navigate("/login");
  };

  const result =
    operator === "+"
      ? firstNumber + secondNumber
      : operator === "-"
        ? firstNumber - secondNumber
        : operator === "×"
          ? firstNumber * secondNumber
          : secondNumber === 0
            ? null
            : firstNumber / secondNumber;

  return (
    <div
      className="relative z-30 border-b border-slate-200 bg-white px-3 py-2 shadow-sm"
      dir={direction}
    >
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
        {visibleActions.map(({ id, label, icon: Icon, color }) => (
          <button
            key={id}
            onClick={() => handleAction(id)}
            className="group relative flex min-w-[76px] flex-col items-center gap-1 rounded-xl px-2 py-1.5 hover:bg-slate-50"
          >
            <span
              className={`relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br ${color} text-white shadow-sm transition group-hover:-translate-y-0.5 group-hover:shadow-md`}
            >
              <Icon className="h-4 w-4" />
              {id === "notifications" && noticeCount > 0 && (
                <span className="absolute -left-1 -top-1 min-w-4 rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                  {noticeCount}
                </span>
              )}
            </span>
            <span className="whitespace-nowrap text-[10px] font-semibold text-slate-600">
              {t(label)}
            </span>
          </button>
        ))}
        <div className="ms-auto h-10 w-px shrink-0 bg-slate-200" />
        <button
          onClick={() => setPanel(panel === "account" ? null : "account")}
          className="flex min-w-[155px] items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-start hover:bg-slate-100"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#004e89] text-white">
            <User className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-bold text-slate-800">
              {session?.name || t("الحساب")}
            </span>
            <span className="block text-[10px] text-slate-500">
              {session?.empId || session?.role || t("مستخدم")}
            </span>
          </span>
          <ChevronDown className="h-4 w-4 text-slate-400" />
        </button>
      </div>

      {panel && (
        <div className="absolute end-3 top-full mt-2 w-[min(390px,calc(100vw-24px))] rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-bold text-slate-800">
              {t(
                actions.find((action) => action.id === panel)?.label ||
                  "الحساب",
              )}
            </h3>
            <button
              onClick={() => setPanel(null)}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {panel === "contact" && (
            <div className="space-y-2 text-sm">
              {contacts.phone ? (
                <a
                  href={`tel:${contacts.phone}`}
                  className="flex items-center gap-3 rounded-xl border p-3 hover:bg-slate-50"
                >
                  <Phone className="h-4 w-4 text-blue-600" />
                  <span>{contacts.phone}</span>
                </a>
              ) : (
                <p className="rounded-xl bg-amber-50 p-3 text-amber-800">
                  {t("لم يتم إعداد رقم الاتصال بعد.")}
                </p>
              )}
              {contacts.email ? (
                <a
                  href={`mailto:${contacts.email}`}
                  className="flex items-center gap-3 rounded-xl border p-3 hover:bg-slate-50"
                >
                  <Mail className="h-4 w-4 text-blue-600" />
                  <span>{contacts.email}</span>
                </a>
              ) : (
                <p className="rounded-xl bg-slate-50 p-3 text-slate-500">
                  {t("لم يتم إعداد البريد الإلكتروني.")}
                </p>
              )}
              {contacts.whatsapp && (
                <a
                  href={`https://wa.me/${contacts.whatsapp.replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-3 rounded-xl border p-3 hover:bg-emerald-50"
                >
                  <MessageSquare className="h-4 w-4 text-emerald-600" />
                  <span>
                    {t("واتساب")}: {contacts.whatsapp}
                  </span>
                </a>
              )}
              {["مدير النظام", "مدير عام", "المدير العام"].includes(
                session?.role ?? "",
              ) && (
                <div className="mt-3 space-y-2 border-t pt-3">
                  <p className="text-xs font-bold text-slate-600">
                    {t("إعداد بيانات الاتصال")}
                  </p>
                  <input
                    value={contacts.phone}
                    onChange={(event) =>
                      setContacts((current) => ({
                        ...current,
                        phone: event.target.value,
                      }))
                    }
                    placeholder={t("رقم الهاتف")}
                    className="w-full rounded-lg border px-3 py-2"
                  />
                  <input
                    value={contacts.email}
                    onChange={(event) =>
                      setContacts((current) => ({
                        ...current,
                        email: event.target.value,
                      }))
                    }
                    placeholder={t("البريد الإلكتروني")}
                    className="w-full rounded-lg border px-3 py-2"
                  />
                  <input
                    value={contacts.whatsapp}
                    onChange={(event) =>
                      setContacts((current) => ({
                        ...current,
                        whatsapp: event.target.value,
                      }))
                    }
                    placeholder={t("رقم واتساب")}
                    className="w-full rounded-lg border px-3 py-2"
                  />
                  <button
                    onClick={saveContacts}
                    disabled={contactSaving}
                    className="w-full rounded-lg bg-[#004e89] py-2 font-semibold text-white disabled:opacity-50"
                  >
                    {contactSaving
                      ? t("جاري الحفظ...")
                      : t("حفظ بيانات الاتصال")}
                  </button>
                </div>
              )}
            </div>
          )}

          {panel === "management" && (
            <div className="space-y-3">
              <input
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder={t("موضوع الرسالة")}
                className="w-full rounded-lg border px-3 py-2 text-sm"
              />
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder={t("اكتب رسالتك إلى الإدارة")}
                rows={4}
                className="w-full resize-none rounded-lg border px-3 py-2 text-sm"
              />
              <button
                onClick={sendToManagement}
                disabled={sending}
                className="w-full rounded-lg bg-[#004e89] py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {sending ? t("جاري الإرسال...") : t("إرسال إلى الإدارة")}
              </button>
            </div>
          )}

          {panel === "calculator" && (
            <div className="space-y-3">
              <div className="grid grid-cols-[1fr_70px_1fr] gap-2">
                <input
                  type="number"
                  value={firstNumber}
                  onChange={(event) =>
                    setFirstNumber(Number(event.target.value))
                  }
                  className="rounded-lg border px-3 py-2"
                />
                <select
                  value={operator}
                  onChange={(event) =>
                    setOperator(event.target.value as typeof operator)
                  }
                  className="rounded-lg border bg-white px-2"
                >
                  <option>+</option>
                  <option>-</option>
                  <option>×</option>
                  <option>÷</option>
                </select>
                <input
                  type="number"
                  value={secondNumber}
                  onChange={(event) =>
                    setSecondNumber(Number(event.target.value))
                  }
                  className="rounded-lg border px-3 py-2"
                />
              </div>
              <div className="rounded-xl bg-slate-900 p-4 text-center text-2xl font-bold text-white">
                {result === null
                  ? t("لا يمكن القسمة على صفر")
                  : formatNumber(result)}
              </div>
            </div>
          )}

          {panel === "notifications" && (
            <div className="max-h-80 space-y-2 overflow-y-auto">
              {notices.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400">
                  {t("لا توجد إشعارات")}
                </p>
              ) : (
                notices.map((notice) => (
                  <button
                    key={notice.id}
                    onClick={() => {
                      setPanel(null);
                      navigate("/hr/requests/incoming");
                    }}
                    className="flex w-full items-center gap-3 rounded-xl border p-3 text-right hover:bg-slate-50"
                  >
                    <CheckCircle
                      className={`h-4 w-4 ${["معلق", "معلقة", "pending"].includes(notice.status) ? "text-amber-500" : "text-emerald-500"}`}
                    />
                    <span className="flex-1">
                      <span className="block text-sm font-medium">
                        {t(notice.title)}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {notice.date
                          ? formatDate(notice.date, {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })
                          : ""}
                      </span>
                    </span>
                    <span className="text-xs text-slate-500">
                      {t(notice.status)}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}

          {panel === "language" && (
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => changeLanguage("ar")}
                className={`rounded-xl border p-4 font-bold ${locale === "ar" ? "border-blue-200 bg-blue-50 text-blue-800" : "text-slate-700"}`}
              >
                {t("العربية")}
              </button>
              <button
                onClick={() => changeLanguage("en")}
                className={`rounded-xl border p-4 font-bold ${locale === "en" ? "border-blue-200 bg-blue-50 text-blue-800" : "text-slate-700"}`}
              >
                {t("English")}
              </button>
            </div>
          )}

          {panel === "account" && (
            <div className="space-y-2 text-sm">
              {hrOn && <button
                onClick={() => {
                  setPanel(null);
                  navigate("/employee/dashboard?view=profile");
                }}
                className="flex w-full items-center gap-3 rounded-xl border p-3 hover:bg-slate-50"
              >
                <User className="h-4 w-4 text-blue-600" /> {t("الملف الشخصي")}
              </button>}
              <button
                onClick={() => {
                  setPanel(null);
                  navigate("/");
                }}
                className="flex w-full items-center gap-3 rounded-xl border p-3 hover:bg-slate-50"
              >
                <BriefcaseBusiness className="h-4 w-4 text-violet-600" />{" "}
                {t("لوحة إدارة الأعمال")}
              </button>
              {hrOn && <button
                onClick={() => {
                  setPanel(null);
                  navigate("/hr/dashboard");
                }}
                className="flex w-full items-center gap-3 rounded-xl border p-3 hover:bg-slate-50"
              >
                <BriefcaseBusiness className="h-4 w-4 text-emerald-600" />{" "}
                {t("لوحة الموارد البشرية")}
              </button>}
              <button
                onClick={() => {
                  localStorage.removeItem("user_session");
                  navigate("/login");
                }}
                className="flex w-full items-center gap-3 rounded-xl border p-3 hover:bg-slate-50"
              >
                <LogIn className="h-4 w-4 text-slate-600" />{" "}
                {t("تغيير الحساب / تسجيل الدخول")}
              </button>
              <button
                onClick={logout}
                className="flex w-full items-center gap-3 rounded-xl border border-red-100 bg-red-50 p-3 text-red-700 hover:bg-red-100"
              >
                <LogOut className="h-4 w-4" /> {t("تسجيل الخروج")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
