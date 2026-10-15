import { useEffect, useMemo, useState } from "react";
import { Mail, Trash2, Send, Settings as SettingsIcon, ChevronLeft, Lock, Eye, EyeOff } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { useI18n } from "@/i18n";

interface MailMessage {
  id: string;
  from_email: string;
  to_email: string;
  subject: string;
  body: string;
  read_at?: string | null;
  deleted_by_sender_at?: string | null;
  deleted_by_recipient_at?: string | null;
  purged_by_sender_at?: string | null;
  purged_by_recipient_at?: string | null;
  /** رسالة أنشأها نظام الخصم الآلي القديم (موقوف): محفوظة للمراجعة ولا تُعدَّل */
  deduction_assignment_id?: string | null;
  created_at: string;
}

type Folder = "inbox" | "sent" | "trash" | "settings";


export default function EmployeeEmailPage({
  onBack,
  empId,
  employeeName,
}: {
  onBack: () => void;
  empId?: string;
  employeeName?: string;
}) {
  const { t, direction, formatDate } = useI18n();
  const [activeFolder, setActiveFolder] = useState<Folder>("inbox");
  const [employeeEmail, setEmployeeEmail] = useState("");
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<MailMessage | null>(null);
  const [mailboxPassword, setMailboxPassword] = useState("");
  const [mailboxAuthenticated, setMailboxAuthenticated] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoadingEmail, setIsLoadingEmail] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);

  useEffect(() => {
    async function loadEmployeeEmail() {
      if (!empId) {
        setLoginError("لم يتم العثور على الرقم الوظيفي");
        setIsLoadingEmail(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke("manage-employee-credentials", {
        body: { action: "mailbox-info", empId },
      });
      if (error || !data?.success) {
        setLoginError(data?.error || "لم يتم إنشاء بريد إلكتروني لك بعد");
      } else {
        setEmployeeEmail(String(data.generated_email || ""));
      }
      setIsLoadingEmail(false);
    }

    loadEmployeeEmail();
  }, [empId]);

  useEffect(() => {
    async function loadMessages() {
      if (!employeeEmail || !mailboxAuthenticated) {
        setMessages([]);
        return;
      }
      const { data, error } = await supabase
        .from("employee_mail_messages")
        .select("id, from_email, to_email, subject, body, read_at, deleted_by_sender_at, deleted_by_recipient_at, purged_by_sender_at, purged_by_recipient_at, deduction_assignment_id, created_at")
        .or(`to_email.eq.${employeeEmail},from_email.eq.${employeeEmail}`)
        .order("created_at", { ascending: false });
      if (!error && data) setMessages(data as MailMessage[]);
    }

    loadMessages();
  }, [employeeEmail, mailboxAuthenticated]);

  const inbox = useMemo(
    () => messages.filter((message) => message.to_email === employeeEmail && !message.deleted_by_recipient_at),
    [messages, employeeEmail],
  );
  const sent = useMemo(
    () => messages.filter((message) => message.from_email === employeeEmail && !message.deleted_by_sender_at),
    [messages, employeeEmail],
  );
  const trash = useMemo(
    () => messages.filter((message) =>
      (message.from_email === employeeEmail && Boolean(message.deleted_by_sender_at) && !message.purged_by_sender_at) ||
      (message.to_email === employeeEmail && Boolean(message.deleted_by_recipient_at) && !message.purged_by_recipient_at),
    ),
    [messages, employeeEmail],
  );
  const visibleMessages = activeFolder === "inbox" ? inbox : activeFolder === "sent" ? sent : activeFolder === "trash" ? trash : [];

  const folders: { id: Folder; label: string; count: number }[] = [
    { id: "inbox", label: t("صندوق الوارد"), count: inbox.filter((message) => !message.read_at).length },
    { id: "sent", label: t("المرسل"), count: sent.length },
    { id: "trash", label: t("المهملات"), count: trash.length },
    { id: "settings", label: t("الإعدادات"), count: 0 },
  ];

  const markMessagesRead = async (messageIds: string[]) => {
    if (messageIds.length === 0) return;
    const { data, error } = await supabase.functions.invoke("manage-employee-credentials", {
      body: { action: "mark-mailbox-messages-read", empId, messageIds },
    });
    if (error || !data?.success) return;

    const updatedIds = new Set<string>((data.message_ids ?? []).map((id: unknown) => String(id)));
    if (updatedIds.size === 0) return;
    const readAt = String(data.read_at || new Date().toISOString());
    setMessages((current) => current.map((message) =>
      updatedIds.has(message.id) ? { ...message, read_at: readAt } : message,
    ));
  };

  // لا قراءة تلقائية: الرسالة تُعلَّم مقروءة عند فتحها فقط (لا وقت قراءة لم يحدث، خاصة إشعارات الخصم الآلي المحفوظة للمراجعة)

  const handleMailboxLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!mailboxPassword) {
      setLoginError("أدخل كلمة مرور البريد الإلكتروني");
      return;
    }

    setIsSigningIn(true);
    setLoginError("");
    const { data, error } = await supabase.functions.invoke("manage-employee-credentials", {
      body: { action: "verify-mailbox", empId, password: mailboxPassword },
    });
    setIsSigningIn(false);
    if (error || !data?.success) {
      setLoginError(data?.error || "كلمة مرور البريد غير صحيحة");
      return;
    }

    setMailboxPassword("");
    setMailboxAuthenticated(true);
  };

  const deleteMessage = async (message: MailMessage) => {
    if (!window.confirm("هل تريد نقل هذه الرسالة إلى المهملات؟")) return;

    setDeletingMessageId(message.id);
    const { data, error } = await supabase.functions.invoke("manage-employee-credentials", {
      body: { action: "delete-mailbox-message", empId, messageId: message.id },
    });
    setDeletingMessageId(null);
    if (error || !data?.success) {
      toast.error(data?.error || "تعذر حذف الرسالة");
      return;
    }

    const deletedAt = String(data.deleted_at || new Date().toISOString());
    setMessages((current) => current.map((item) => item.id === message.id ? {
      ...item,
      deleted_by_sender_at: item.from_email === employeeEmail ? deletedAt : item.deleted_by_sender_at,
      deleted_by_recipient_at: item.to_email === employeeEmail ? deletedAt : item.deleted_by_recipient_at,
    } : item));
    setSelectedEmail(null);
    toast.success("تم نقل الرسالة إلى المهملات");
  };

  const purgeMessage = async (message: MailMessage) => {
    if (!window.confirm("سيتم حذف الرسالة نهائياً من مهملاتك. هل تريد المتابعة؟")) return;

    setDeletingMessageId(message.id);
    const { data, error } = await supabase.functions.invoke("manage-employee-credentials", {
      body: { action: "purge-mailbox-message", empId, messageId: message.id },
    });
    setDeletingMessageId(null);
    if (error || !data?.success) {
      toast.error(data?.error || "تعذر حذف الرسالة نهائياً");
      return;
    }

    const purgedAt = String(data.purged_at || new Date().toISOString());
    setMessages((current) => current.map((item) => item.id === message.id ? {
      ...item,
      purged_by_sender_at: item.from_email === employeeEmail ? purgedAt : item.purged_by_sender_at,
      purged_by_recipient_at: item.to_email === employeeEmail ? purgedAt : item.purged_by_recipient_at,
    } : item));
    setSelectedEmail(null);
    toast.success("تم حذف الرسالة نهائياً من مهملاتك");
  };

  const openMessage = (message: MailMessage) => {
    setSelectedEmail(message);
    if (message.to_email === employeeEmail && !message.read_at) {
      void markMessagesRead([message.id]);
    }
  };

  if (isLoadingEmail) {
    return (
      <div className="h-screen bg-gray-900 text-white flex items-center justify-center" dir={direction}>
        <p className="text-gray-400">{t("جاري تحميل البريد الإلكتروني...")}</p>
      </div>
    );
  }

  if (!mailboxAuthenticated) {
    return (
      <div className="h-screen bg-gray-900 text-white flex items-center justify-center p-4" dir={direction}>
        <div className="w-full max-w-md rounded-2xl border border-gray-700 bg-gray-800 p-6 shadow-2xl">
          <button onClick={onBack} className="mb-6 flex items-center gap-1 text-sm text-gray-400 hover:text-white">
            <ChevronLeft className={`h-4 w-4 ${direction === "rtl" ? "rotate-180" : ""}`} />
            {t("رجوع")}
          </button>
          <div className="mb-6 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600/20">
              <Mail className="h-7 w-7 text-blue-400" />
            </div>
            <h1 className="text-xl font-bold">{t("الدخول إلى البريد الإلكتروني")}</h1>
            <p className="mt-2 text-sm text-gray-400">{t("البريد مثبت لحسابك، أدخل كلمة المرور فقط")}</p>
          </div>
          <form onSubmit={handleMailboxLogin} className="space-y-4">
            <div>
              <label className="mb-2 block text-sm text-gray-300">{t("البريد الإلكتروني")}</label>
              <input
                dir="ltr"
                type="email"
                value={employeeEmail}
                readOnly
                className="w-full cursor-not-allowed rounded-lg border border-gray-600 bg-gray-900 px-4 py-3 text-left font-mono text-blue-300 outline-none"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm text-gray-300">{t("كلمة مرور البريد")}</label>
              <div className="relative">
                <Lock className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={mailboxPassword}
                  onChange={(event) => {
                    setMailboxPassword(event.target.value);
                    setLoginError("");
                  }}
                  disabled={!employeeEmail || isSigningIn}
                  autoComplete="current-password"
                  placeholder={t("أدخل كلمة المرور")}
                  className="w-full rounded-lg border border-gray-600 bg-gray-900 py-3 pr-10 pl-10 text-white outline-none focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {loginError && <p className="text-sm text-red-400">{loginError}</p>}
            <button
              type="submit"
              disabled={!employeeEmail || isSigningIn}
              className="w-full rounded-lg bg-blue-600 py-3 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSigningIn ? t("جاري الدخول...") : t("دخول البريد")}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gray-900 text-white flex flex-col md:flex-row" dir={direction}>
      <div className="hidden md:flex w-64 bg-gray-800 flex-col border-l border-gray-700">
        <div className="p-4 border-b border-gray-700">
          <button className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg flex items-center justify-center gap-2">
            <Send className="h-4 w-4" />
            {t("إرسال")}
          </button>
        </div>
        <nav className="flex-1 p-2">
          {folders.map((folder) => (
            <button
              key={folder.id}
              onClick={() => { setActiveFolder(folder.id); setSelectedEmail(null); }}
              className={`w-full text-right px-4 py-2.5 rounded-lg font-medium transition flex items-center justify-between ${activeFolder === folder.id ? "bg-blue-600 text-white" : "text-gray-300 hover:bg-gray-700"}`}
            >
              <span>{folder.label}</span>
              {folder.count > 0 && <span className="bg-red-500 text-xs font-bold rounded-full min-w-5 h-5 px-1 flex items-center justify-center">{folder.count}</span>}
            </button>
          ))}
        </nav>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="bg-gray-800 border-b border-gray-700 p-4 flex items-center justify-between md:justify-start md:gap-4">
          <button onClick={onBack} className="text-gray-400 hover:text-white">
            <ChevronLeft className={`h-6 w-6 ${direction === "rtl" ? "rotate-180" : ""}`} />
          </button>
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Mail className="h-5 w-5 text-blue-400" />
              {t("المراسلات")}
            </h1>
            {employeeEmail && <p dir="ltr" className="text-xs text-blue-300 font-mono mt-1 text-left">{employeeEmail}</p>}
          </div>
          <button onClick={() => setActiveFolder("settings")} className="md:hidden mr-auto text-gray-400 hover:text-white">
            <SettingsIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-hidden">
          {!selectedEmail ? (
            <div className="h-full overflow-y-auto">
              {(activeFolder === "inbox" || activeFolder === "sent" || activeFolder === "trash") && (
                <div className="divide-y divide-gray-700">
                  {visibleMessages.map((message) => (
                    <div key={message.id} className="flex items-stretch transition hover:bg-gray-800">
                      <button
                        onClick={() => openMessage(message)}
                        className="min-w-0 flex-1 p-4 text-right"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <p dir="ltr" className="truncate text-left font-semibold">
                              {activeFolder === "inbox" ? message.from_email : activeFolder === "sent" ? message.to_email : message.from_email === employeeEmail ? message.to_email : message.from_email}
                            </p>
                            <p className="mt-1 truncate text-sm text-gray-300">{message.subject}</p>
                            {message.deduction_assignment_id && <p className="mt-1 text-xs text-amber-400">{t("رسالة آلية من نظام خصم موقوف — ليست صادرة من شخص")}</p>}
                            <p className="mt-2 truncate text-xs text-gray-500">{message.body}</p>
                          </div>
                          <span className="whitespace-nowrap text-xs text-gray-500">{formatDate(message.created_at, { dateStyle: "medium" })}</span>
                        </div>
                      </button>
                      <button
                        onClick={() => activeFolder === "trash" ? purgeMessage(message) : deleteMessage(message)}
                        disabled={deletingMessageId === message.id}
                        title={activeFolder === "trash" ? "حذف نهائي" : "نقل إلى المهملات"}
                        className="px-4 text-gray-500 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40"
                      >
                        <Trash2 className="h-5 w-5" />
                      </button>
                    </div>
                  ))}
                  {visibleMessages.length === 0 && <div className="p-8 text-center text-gray-400">{t("لا توجد رسائل")}</div>}
                </div>
              )}

              {activeFolder === "settings" && (
                <div className="p-6 space-y-4">
                  <h2 className="text-lg font-semibold">{t("إعدادات البريد الإلكتروني")}</h2>
                  <div className="bg-gray-800 p-4 rounded-lg">
                    <label className="text-sm text-gray-400">{t("عنوانك البريدي")}</label>
                    <p dir="ltr" className="text-white font-mono mt-1 text-left">{employeeEmail || t("لم يتم إنشاء إيميل لهذا الموظف")}</p>
                  </div>
                  <label className="flex items-center gap-2 bg-gray-800 p-4 rounded-lg cursor-pointer">
                    <input type="checkbox" defaultChecked className="rounded" />
                    {t("إشعارات البريد الجديد")}
                  </label>
                  <label className="flex items-center gap-2 bg-gray-800 p-4 rounded-lg cursor-pointer">
                    <input type="checkbox" defaultChecked className="rounded" />
                    {t("اشتراك في رسائل الخصومات")}
                  </label>
                </div>
              )}
            </div>
          ) : (
            <div className="h-full overflow-y-auto p-6">
              <div className="max-w-2xl">
                <button onClick={() => setSelectedEmail(null)} className="text-gray-400 hover:text-white mb-4 flex items-center gap-1">
                  <ChevronLeft className={`h-4 w-4 ${direction === "rtl" ? "rotate-180" : ""}`} />
                  {t("رجوع")}
                </button>
                <div className="bg-gray-800 rounded-lg p-6">
                  <div className="flex items-start justify-between border-b border-gray-700 pb-4 mb-4">
                    <div>
                      <p className="text-sm text-gray-400">من:</p>
                      <p dir="ltr" className="text-white font-semibold text-left">{selectedEmail.from_email}</p>
                      <p className="text-sm text-gray-400 mt-2">إلى:</p>
                      <p dir="ltr" className="text-white text-sm text-left">{selectedEmail.to_email}</p>
                    </div>
                    <button
                      onClick={() => activeFolder === "trash" ? purgeMessage(selectedEmail) : deleteMessage(selectedEmail)}
                      disabled={deletingMessageId === selectedEmail.id}
                      title={activeFolder === "trash" ? "حذف نهائي" : "نقل إلى المهملات"}
                      className="text-gray-400 hover:text-red-400 disabled:opacity-40"
                    >
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                  <h2 className="text-xl font-bold mb-2">{selectedEmail.subject}</h2>
                  {selectedEmail.deduction_assignment_id && (
                    <div className="mb-4 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300">
                      {t("هذه رسالة أنشأها آليًا نظام خصم قديم أُوقف، وليست صادرة من شخص، وهي محفوظة للمراجعة. لأي استفسار عن راتبك راجع الموارد البشرية.")}
                    </div>
                  )}
                  <div className="text-sm text-gray-400 mb-6">{formatDate(selectedEmail.created_at, { dateStyle: "medium", timeStyle: "short" })}</div>
                  <div className="bg-gray-900 p-4 rounded text-white leading-relaxed whitespace-pre-line">{selectedEmail.body}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="md:hidden flex gap-1 bg-gray-800 border-t border-gray-700 p-2 overflow-x-auto">
        {folders.slice(0, 3).map((folder) => (
          <button
            key={folder.id}
            onClick={() => { setActiveFolder(folder.id); setSelectedEmail(null); }}
            className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition ${activeFolder === folder.id ? "bg-blue-600 text-white" : "text-gray-400 hover:bg-gray-700"}`}
          >
            {folder.label}{folder.count > 0 ? ` (${folder.count})` : ""}
          </button>
        ))}
      </div>
    </div>
  );
}
