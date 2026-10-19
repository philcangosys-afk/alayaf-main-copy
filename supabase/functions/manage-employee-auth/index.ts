import { createClient } from "jsr:@supabase/supabase-js@2";

// حسابات دخول الموظفين (Supabase Auth) — نظام الشركات.
// { action: "set-password", employeeId, password, adopt? } ← إنشاء الحساب أو تغيير كلمة مروره
//   adopt: true (مدير النظام فقط، بعد تأكيده) ← استعادة حساب قديم بنفس البريد كان لموظف سابق في المنشأة
// { action: "set-login-state", employeeId, enabled }    ← إيقاف الدخول عند تعطيل الموظف أو إعادته
// { action: "change-email", employeeId, email }         ← تغيير بريد الموظف (ومعه بريد حساب دخوله) — مدير النظام فقط
// القواعد:
// - المستدعي يعمل داخل منشأته فقط (my_company)، وكل قراءة بمفتاح الخادم مقيّدة برقم منشأته.
// - الموظف يُحدَّد بمعرّفه داخل المنشأة، وبريده يُقرأ من سجله (لا يُقبل بريد من المتصفح إلا البريد الجديد في change-email).
// - الصلاحية من قاعدة البيانات نفسها: is_main_system_admin() أو hr_area_allowed(['hr.employees'], إدارة).
// - حساب الدخول المرتبط بالموظف هو employees.auth_user_id. لا يُعدَّل حساب قائم آخر إلا إذا أنشأه الخادم
//   لهذه المنشأة (app_metadata.company_id) حساب موظف لهذا الموظف نفسه؛ فلا يُستولى على حساب منشأة أخرى
//   أو حساب إدارة المنصة أو حساب سجّل بنفسه (صاحب المنشأة) أو حساب مستخدم خاص.
// - حساب موظف سابق في المنشأة (حُذف أو فُك ربطه) بنفس البريد: يُستعاد فقط بتأكيد صريح من مدير النظام،
//   لأن الحساب يحمل سجل طلبات ذلك الموظف.
// - الحساب الجديد يُختم بالمنشأة ويُربط بالموظف (قاعدة البيانات تتحقق من الختم والبريد وتنشئ العضوية).
// - صاحب المنشأة: حسابه سجّله بنفسه؛ لا تُغيَّر كلمة مروره ولا بريده من هنا (يستعيد كلمة المرور من صفحة الدخول).
// - غير المدير:
//   * لا يمس حساب مدير، ولا حسابه هو.
//   * لا ينشئ حساب دخول ولا يعيد تفعيله لموظف دوره فيه صلاحية أعلى من صلاحياته (grant_ceiling_violations).
//   * لا يغيّر كلمة مرور حساب قائم لموظف دوره له صلاحيات (انتحال؛ يتطلب مديرًا).
//   * لا يغيّر بريد موظف (قاعدة البيانات تشترط مدير النظام لذلك أيضًا).
//   * إيقاف الدخول مسموح دائمًا لمن يدير الموظفين (حتى لا يبقى المعطّل قادرًا على الدخول).
// - لا يمس حساب مستخدم خاص، ولا حسابًا مرتبطًا بموظف آخر.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: jsonHeaders });

// ===== S16: سجل منظّم (سطر JSON لكل حدث) ورقم طلب، وأخطاء 5xx إلى سجل أخطاء النظام =====
// النسخة نفسها في manage-employee-auth وmanage-employee-credentials وmanage-special-users؛ عدّلها في الثلاث معًا.
// - كل طلب: سطر «request» بالحالة والمدة والمستخدم والمنشأة والإجراء (403 و401 تحذير: حدث أمني).
// - الفشل: سطر خطأ بنوعه ونصه ومساره، ويُحفظ في app_error_logs (log_server_error) برقم الطلب نفسه، بعد إرسال الرد.
// - رقم الطلب يولّده الخادم (S + 12 خانة) ويعود في ترويسة X-Request-ID.
// - لا كلمات مرور ولا رموز ولا بريد كامل ولا أرقام طويلة (هوية، جوال، آيبان، بطاقة) في أي سطر: القواعد نفسها في log_redact.
const FN_NAME = "manage-employee-auth";
const FN_VERSION = "s16";
const SENSITIVE_KEY = /pass(word|wd)?|pwd|secret|token|authorization|cookie|api[-_]?key|apikey|ciphertext|otp|session/i;
const maskText = (value: string, max = 1000) =>
  value
    .slice(0, max + 500)
    .replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) - (digit.charCodeAt(0) >= 0x6f0 ? 0x6f0 : 0x660)))
    .replace(/eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}(\.[A-Za-z0-9_-]*)?/g, "[jwt]")
    .replace(/sb_(secret|publishable)_[A-Za-z0-9_-]{6,}/gi, "[key]")
    .replace(/(authorization["']?\s*[:=]\s*["']?)((bearer|basic)\s+)?[^\s"',;&}]+/gi, "$1[redacted]")
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]")
    .replace(/(Basic\s+)(?=[A-Za-z0-9+/]*(?:[0-9+/=]|[a-z][A-Z]))[A-Za-z0-9+/]{8,}={0,2}/g, "$1[redacted]")
    .replace(/((pass(word|wd)?|pwd|otp)["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s"',;&}]+)/gi, "$1[redacted]")
    .replace(/((secret|token|api[_-]?key|apikey|cookie|session)["']?\s*=\s*)("[^"]*"|'[^']*'|[^\s"',;&}]+)/gi, "$1[redacted]")
    .replace(/((secret|token|api[_-]?key|apikey|cookie|session)["']?\s*:\s*)("[^"]*"|'[^']*'|[^\s"',;&}]{8,})/gi, "$1[redacted]")
    .replace(/(\b(otp|pin|cvv)\b["']?\s*[:=]?\s*["']?)[0-9]{3,8}\b/gi, "$1[redacted]")
    .replace(/(key \([^)]*\)=\()[^)]*/gi, "$1…")
    .replace(/(failing row contains\s*)\([^\n]*/gi, "$1(…)")
    .replace(/([A-Za-z0-9._%+\u0600-\u06FF-])[A-Za-z0-9._%+\u0600-\u06FF-]*@([A-Za-z0-9\u0600-\u06FF-]+(?:\.[A-Za-z0-9\u0600-\u06FF-]+)*\.[A-Za-z\u0600-\u06FF]{2,})/g, "$1***@$2")
    .replace(/\bSA[0-9]{2}(?:[ -]?[0-9A-Za-z]){20}\b/g, "[iban]")
    .replace(/(?<![0-9A-Za-z-])[0-9]{4}(?:[ -][0-9]{4}){2,3}(?:[ -][0-9]{1,4})?(?![0-9A-Za-z-])/g, "[number]")
    .replace(/(?<![0-9])0[0-9]{2}[ -][0-9]{3}[ -][0-9]{4}(?![0-9])/g, "[number]")
    .replace(/\+[0-9][0-9 ()-]{7,}[0-9]/g, "[number]")
    .replace(/(?<![0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{0,11})[0-9]{9,}/g, "[number]")
    .slice(0, max);
type LogFields = Record<string, unknown>;
type ErrorInfo = { type: string; message: string; stack: string };
const describeError = (error: unknown): ErrorInfo => {
  if (error instanceof Error) return { type: error.name || "Error", message: maskText(error.message), stack: maskText(error.stack ?? "", 3000) };
  if (error && typeof error === "object") {
    const value = error as { name?: unknown; code?: unknown; message?: unknown; details?: unknown; status?: unknown };
    const message = [value.message, value.details].filter((part) => typeof part === "string" && part).join(" — ");
    return { type: String(value.name ?? value.code ?? value.status ?? "object").slice(0, 100), message: maskText(message || "(بلا رسالة)"), stack: "" };
  }
  return { type: typeof error, message: maskText(String(error)), stack: "" };
};
const safeFields = (fields: LogFields): LogFields => {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (SENSITIVE_KEY.test(key)) out[key] = "[redacted]";
    else if (value && typeof value === "object") out[key] = describeError(value);
    else out[key] = typeof value === "string" ? maskText(value, key === "stack" ? 3000 : 300) : value;
  }
  return out;
};
type RequestLog = {
  requestId: string;
  context: LogFields;
  set: (fields: LogFields) => void;
  emit: (level: "info" | "warn" | "error", event: string, fields?: LogFields) => void;
  fail: (error: unknown, event?: string, fields?: LogFields) => void;
  failure: () => { event: string; error: unknown } | null;
};
const createRequestLog = (req: Request): RequestLog => {
  // الرقم من الخادم دائمًا؛ رقم أرسله المتصفح يُسجَّل معه للربط فقط
  const requestId = `S${crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
  const incoming = req.headers.get("x-request-id") ?? "";
  const context: LogFields = /^[A-Za-z0-9_-]{6,40}$/.test(incoming) ? { client_request_id: incoming } : {};
  let failure: { event: string; error: unknown } | null = null;
  const emit = (level: "info" | "warn" | "error", event: string, fields: LogFields = {}) => {
    const line = JSON.stringify({
      ts: new Date().toISOString(), level, fn: FN_NAME, version: FN_VERSION, request_id: requestId, event,
      ...safeFields(context), ...safeFields(fields),
    });
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  };
  return {
    requestId,
    context,
    set: (fields) => Object.assign(context, fields),
    emit,
    fail: (error, event = "request.failed", fields = {}) => {
      if (!failure) failure = { event, error };
      const info = describeError(error);
      emit("error", event, { ...fields, error_type: info.type, error_message: info.message, stack: info.stack || undefined });
    },
    failure: () => failure,
  };
};
// حفظ الفشل في سجل أخطاء النظام (بمفتاح الخادم؛ لا يرمي، ولا ينتظر أكثر من 3 ثوانٍ)
const persistFailure = async (log: RequestLog, status: number, durationMs: number) => {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) return;
  const failure = log.failure();
  const info = describeError(failure?.error ?? `HTTP ${status}`);
  const event = `edge.${FN_NAME.replace(/-/g, "_")}.${(failure?.event ?? "http_5xx").toLowerCase().replace(/[^a-z0-9_.]/g, "_")}`.slice(0, 60);
  try {
    const reply = await fetch(`${url}/rest/v1/rpc/log_server_error`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        p: {
          event, level: "error", request_id: log.requestId, route: FN_NAME, app_version: FN_VERSION,
          error_type: info.type, message: info.message, stack: info.stack,
          user_id: log.context.user_id, company_id: log.context.company_id,
          context: { status, duration_ms: durationMs, action: typeof log.context.action === "string" ? log.context.action : undefined },
        },
      }),
      signal: AbortSignal.timeout(3000),
    });
    if (!reply.ok) log.emit("warn", "error_log.persist_failed", { status: reply.status });
    await reply.body?.cancel();
  } catch {
    // السجل لا يوقف الاستجابة
  }
};
// بعد إرسال الرد (EdgeRuntime.waitUntil)؛ وإن لم تتوفر يُنتظر الحفظ (3 ثوانٍ على الأكثر)
const runAfterResponse = async (task: Promise<void>) => {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } }).EdgeRuntime;
  if (typeof runtime?.waitUntil === "function") runtime.waitUntil(task);
  else await task;
};
const serveLogged = async (req: Request, handler: (req: Request, log: RequestLog) => Promise<Response>): Promise<Response> => {
  const log = createRequestLog(req);
  const started = Date.now();
  let response: Response;
  try {
    response = await handler(req, log);
  } catch (error) {
    log.fail(error, "request.unhandled");
    response = new Response(JSON.stringify({ success: false, error: "خطأ غير متوقع في الخادم" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (req.method !== "OPTIONS") {
    const durationMs = Date.now() - started;
    log.emit(response.status >= 500 ? "error" : response.status >= 400 ? "warn" : "info", "request", {
      method: req.method, status: response.status, duration_ms: durationMs,
    });
    if (response.status >= 500) await runAfterResponse(persistFailure(log, response.status, durationMs));
  }
  const headers = new Headers(response.headers);
  headers.set("X-Request-ID", log.requestId);
  headers.set("Access-Control-Expose-Headers", "x-request-id");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};
// ===== نهاية السجل المنظّم =====

const adminRoles = new Set(["مدير النظام", "مدير عام", "المدير العام"]);
// نفس قائمة قاعدة البيانات (employee_status_active)
const inactiveStatuses = new Set(["غير فعال", "غير نشط", "منتهي", "منتهية", "منتهي الخدمة", "مستقيل", "مفصول", "موقوف", "inactive", "terminated"]);
const isInactive = (status: unknown) => inactiveStatuses.has(String(status ?? "").trim().toLowerCase());
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// S15: الاشتراك (القراءة فقط وحد المستخدمين في الباقة)
const SUBSCRIPTION_READ_ONLY_MESSAGE = "المنشأة في وضع القراءة فقط؛ لا يُنشأ حساب دخول ولا يُغيَّر بريده حتى تفعيل الاشتراك";
const PLAN_LIMIT_USERS_MESSAGE = "بلغت المنشأة حد المستخدمين في باقتها؛ رقِّ الباقة من صفحة «الاشتراك» أو عطّل حسابًا آخر";
const subscriptionErrorMessage = (error: { message?: string } | null) => {
  const text = String(error?.message ?? "");
  if (text.includes("SUBSCRIPTION_READ_ONLY")) return SUBSCRIPTION_READ_ONLY_MESSAGE;
  if (text.includes("PLAN_LIMIT_USERS")) return PLAN_LIMIT_USERS_MESSAGE;
  return null;
};
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (character) => `\\${character}`);
const hasPermissions = (permissions: unknown) =>
  Boolean(permissions && typeof permissions === "object" && !Array.isArray(permissions)
    && Object.values(permissions as Record<string, unknown>).some((value) => value === true || value === "read" || value === "manage"));
const missingFunction = (error: { code?: string; message?: string } | null) =>
  Boolean(error && (error.code === "PGRST202" || error.code === "42883" || /could not find the function/i.test(error.message ?? "")));

const EMAIL_NOT_AVAILABLE = "هذا البريد غير متاح لحساب دخول الموظف؛ استخدم بريدًا مختلفًا";
const OWNER_ACCOUNT = "هذا حساب صاحب المنشأة؛ يغيّر كلمة مروره بنفسه من «نسيت كلمة المرور» في صفحة الدخول";
const OWNER_EMAIL = "بريد صاحب المنشأة هو حساب دخوله؛ تغييره عن طريق إدارة المنصة";
const OLD_ACCOUNT_ADMIN = "يوجد حساب دخول قديم بهذا البريد لموظف سابق في المنشأة";
const OLD_ACCOUNT_NOT_ADMIN = "يوجد حساب دخول قديم بهذا البريد لموظف سابق في المنشأة؛ استعادته يتم من مدير النظام";

type AuthAccount = {
  id: string;
  email: string;
  user_metadata: Record<string, unknown>;
  app_metadata: Record<string, unknown>;
  banned_until: string | null;
};

const toAccount = (user: Record<string, unknown>): AuthAccount => ({
  id: String(user.id),
  email: String(user.email ?? "").toLowerCase(),
  user_metadata: (user.user_metadata as Record<string, unknown>) ?? {},
  app_metadata: (user.app_metadata as Record<string, unknown>) ?? {},
  banned_until: (user.banned_until as string | null | undefined) ?? null,
});

const handle = async (req: Request, reqLog: RequestLog): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond({ success: false, error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return respond({ success: false, error: "غير مصرح" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !anonKey || !serviceKey) return respond({ success: false, error: "إعدادات الخادم ناقصة" }, 503);

    const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const token = authHeader.slice("Bearer ".length);
    const { data: { user }, error: authError } = await callerClient.auth.getUser(token);
    if (authError || !user?.email) return respond({ success: false, error: "غير مصرح" }, 401);
    reqLog.set({ user_id: user.id });
    const callerEmail = user.email.toLowerCase();

    // منشأة المستدعي (فعالة) — كل ما بعده داخلها فقط
    const { data: myCompany, error: companyError } = await callerClient.rpc("my_company");
    const company = (myCompany ?? {}) as { status?: string; company?: { id?: string } };
    const companyId = String(company.company?.id ?? "");
    if (companyError || company.status !== "active" || !companyId) {
      return respond({ success: false, error: "حسابك غير مرتبط بمنشأة فعالة" }, 403);
    }
    reqLog.set({ company_id: companyId });

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");
    reqLog.set({ action: action.slice(0, 40) });
    if (action !== "set-password" && action !== "set-login-state" && action !== "change-email") {
      return respond({ success: false, error: "إجراء غير معروف" }, 400);
    }
    const employeeId = String(body?.employeeId ?? "").trim();
    if (!employeeId) return respond({ success: false, error: "الموظف مطلوب" }, 400);
    const enabling = action === "set-login-state" && body?.enabled === true;
    const disabling = action === "set-login-state" && body?.enabled !== true;
    const changingEmail = action === "change-email";

    // الصلاحية بمنطق قاعدة البيانات وبجلسة المستدعي نفسه
    const [{ data: isAdmin, error: adminError }, { data: canManage, error: manageError }] = await Promise.all([
      callerClient.rpc("is_main_system_admin"),
      callerClient.rpc("hr_area_allowed", { p_areas: ["hr.employees"], p_manage: true }),
    ]);
    if (adminError || manageError) return respond({ success: false, error: "تعذر التحقق من الصلاحية" }, 403);
    const callerIsAdmin = isAdmin === true;
    if (!callerIsAdmin && canManage !== true) {
      return respond({ success: false, error: "ليست لديك صلاحية إدارة حسابات دخول الموظفين" }, 403);
    }
    if (changingEmail && !callerIsAdmin) {
      return respond({ success: false, error: "تغيير بريد الموظف يتم من مدير النظام فقط" }, 403);
    }

    // اسم المستدعي ومعرّفه داخل منشأته (للسجل ولمنع تغيير الحساب الذاتي)
    const { data: linkedRows } = await admin.from("employees").select("id, name")
      .eq("company_id", companyId).eq("auth_user_id", user.id).limit(1);
    const { data: callerRows } = (linkedRows ?? []).length
      ? { data: linkedRows }
      : await admin.from("employees").select("id, name")
        .eq("company_id", companyId).ilike("email", escapeLike(callerEmail)).limit(2);
    const callerEmployee = callerRows && callerRows.length === 1 ? callerRows[0] : null;
    let callerName = String(callerEmployee?.name ?? "");
    if (!callerName) {
      const { data: special } = await admin.from("system_users").select("full_name")
        .eq("company_id", companyId).eq("auth_user_id", user.id).maybeSingle();
      callerName = String(special?.full_name ?? callerEmail);
    }

    // الموظف المستهدف داخل المنشأة
    const { data: target, error: targetError } = await admin
      .from("employees")
      .select("id, emp_id, name, email, employee_role, status, auth_user_id")
      .eq("company_id", companyId)
      .eq("id", employeeId)
      .maybeSingle();
    if (targetError || !target) return respond({ success: false, error: "لم يتم العثور على الموظف" }, 404);
    const email = String(target.email ?? "").trim().toLowerCase();
    const targetIsAdmin = adminRoles.has(String(target.employee_role ?? ""));
    if (targetIsAdmin && !callerIsAdmin) {
      return respond({ success: false, error: "حساب مدير النظام لا يغيّره إلا مدير النظام" }, 403);
    }
    if (target.id === callerEmployee?.id || target.auth_user_id === user.id || (email && email === callerEmail)) {
      return respond({ success: false, error: "لا تغيّر حسابك أنت من هنا" }, 400);
    }

    // صاحب المنشأة: حسابه سجّله بنفسه وليس حساب موظف
    const { data: companyRow, error: companyRowError } = await admin.from("companies")
      .select("owner_user_id, owner_email").eq("id", companyId).maybeSingle();
    if (companyRowError || !companyRow) throw companyRowError ?? new Error("company not found");
    const ownerUserId = String(companyRow.owner_user_id ?? "");
    const ownerEmail = String(companyRow.owner_email ?? "").trim().toLowerCase();
    const targetIsOwner = Boolean(email && ownerEmail && email === ownerEmail);
    if (targetIsOwner) {
      if (action === "set-login-state") return respond({ success: true, changed: false, previouslyBanned: false });
      return respond({ success: false, error: changingEmail ? OWNER_EMAIL : OWNER_ACCOUNT }, 403);
    }

    // صلاحيات دور الموظف (الاسم كما هو وبلا مسافات؛ أي صف بصلاحيات يكفي) — أدوار المنشأة فقط
    let roleHasPermissions = false;
    const roleName = String(target.employee_role ?? "").trim();
    if (roleName) {
      const { data: roleRows } = await admin.from("user_roles").select("name_ar, permissions").eq("company_id", companyId).limit(500);
      roleHasPermissions = (roleRows ?? []).some((row) =>
        String(row.name_ar ?? "").trim() === roleName && hasPermissions(row.permissions));
    }
    let aboveCaller = false;
    if (!callerIsAdmin && !disabling) {
      const { data: violations, error: ceilingError } = await callerClient.rpc("grant_ceiling_violations", {
        p_role: String(target.employee_role ?? ""),
        p_permissions: null,
      });
      if (ceilingError && !missingFunction(ceilingError)) {
        return respond({ success: false, error: "تعذر التحقق من صلاحيات دور الموظف" }, 403);
      }
      aboveCaller = ceilingError ? roleHasPermissions : Boolean(violations);
    }
    if (aboveCaller) {
      return respond({
        success: false,
        error: "دور هذا الموظف فيه صلاحيات أعلى من صلاحياتك؛ حساب دخوله يديره مدير النظام",
      }, 403);
    }

    // حساب الدخول بالبريد: دالة الخادم (S5)، وقبل تطبيقها بحث في صفحات الحسابات
    const findAccountByEmail = async (lookupEmail: string): Promise<AuthAccount | null> => {
      const { data, error } = await admin.rpc("auth_account_by_email", { p_email: lookupEmail });
      if (!error) {
        const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null | undefined;
        return row?.id ? toAccount(row) : null;
      }
      if (!missingFunction(error)) throw error;
      for (let page = 1; page <= 50; page += 1) {
        const { data: usersPage, error: listError } = await admin.auth.admin.listUsers({ page, perPage: 200 });
        if (listError) throw listError;
        const pageUsers = (usersPage?.users ?? []) as Array<{ email?: string }>;
        const match = pageUsers.find((candidate) => (candidate.email ?? "").toLowerCase() === lookupEmail);
        if (match) return toAccount(match as unknown as Record<string, unknown>);
        if (pageUsers.length < 200) break;
      }
      return null;
    };

    // هل يصلح حساب قائم لهذا الموظف؟
    //  usable: حساب موظف أنشأه الخادم لهذه المنشأة ولهذا الموظف
    //  orphan: حساب موظف سابق في المنشأة لم يعد مرتبطًا به (حُذف أو فُك ربطه) — يُستعاد بتأكيد مدير النظام فقط
    //  owner: حساب صاحب المنشأة / other: مرتبط بموظف آخر
    //  foreign: منشأة أخرى أو المنصة أو تسجيل ذاتي أو حساب مستخدم خاص
    const classifyAccount = async (account: AuthAccount): Promise<"usable" | "orphan" | "owner" | "other" | "foreign"> => {
      if (ownerUserId && account.id === ownerUserId) return "owner";
      const stampedCompany = String(account.app_metadata?.company_id ?? "");
      const stampedEmployee = String(account.app_metadata?.employee_id ?? "");
      const accountType = String(account.app_metadata?.account_type ?? "");
      if (stampedCompany !== companyId) return "foreign";
      if (accountType && accountType !== "employee") return "foreign";
      if (stampedEmployee === target.id) return "usable";
      if (!stampedEmployee) return "orphan";
      const { data: stillLinked, error: stillLinkedError } = await admin.from("employees").select("id")
        .eq("company_id", companyId).eq("id", stampedEmployee).eq("auth_user_id", account.id).limit(1);
      if (stillLinkedError) return "foreign";
      return (stillLinked ?? []).length ? "other" : "orphan";
    };

    // الحساب المرتبط بالموظف ومن يرتبط به غيره
    const linkedElsewhere = async (accountId: string) => {
      const [{ data: otherEmployee }, { data: otherLink }, { data: special }] = await Promise.all([
        admin.from("employees").select("id").eq("auth_user_id", accountId).neq("id", target.id).limit(1),
        admin.from("employee_emails").select("employee_id").eq("auth_user_id", accountId).neq("employee_id", target.id).limit(1),
        admin.from("system_users").select("id").eq("auth_user_id", accountId).limit(1),
      ]);
      if ((otherEmployee ?? []).length || (otherLink ?? []).length) return "حساب الدخول بهذا البريد مرتبط بموظف آخر";
      if ((special ?? []).length) return "حساب الدخول بهذا البريد مرتبط بمستخدم خاص";
      return "";
    };

    // البريد مكرر داخل المنشأة؟
    const duplicateInCompany = async (checkEmail: string) => {
      const [{ data: sameEmail }, { data: specialEmail }] = await Promise.all([
        admin.from("employees").select("id").eq("company_id", companyId).ilike("email", escapeLike(checkEmail)).neq("id", target.id).limit(1),
        admin.from("system_users").select("id").eq("company_id", companyId).ilike("email", escapeLike(checkEmail)).limit(1),
      ]);
      if ((sameEmail ?? []).length) return "هذا البريد مسجّل لموظف آخر";
      if ((specialEmail ?? []).length) return "هذا البريد مستخدم لمستخدم خاص";
      return "";
    };

    const log = (operation: string, details: string) =>
      admin.from("user_logs").insert({ company_id: companyId, user_name: callerName, module: "hr.employees", module_label: "الموظفون", operation, details })
        .then(() => undefined, () => undefined);

    // حساب الدخول: المرتبط بالموظف أولًا
    let existing: AuthAccount | null = null;
    if (target.auth_user_id) {
      const { data: linkedUser, error: linkedError } = await admin.auth.admin.getUserById(String(target.auth_user_id));
      if (linkedError && !/not.?found/i.test(linkedError.message ?? "")) throw linkedError;
      if (linkedUser?.user) existing = toAccount(linkedUser.user as unknown as Record<string, unknown>);
    }

    // S15: اشتراك المنشأة (القراءة فقط، وحد المستخدمين). بلا S15 على القاعدة: لا قيد
    type SubscriptionState = { access?: string; plan?: { max_users?: number | null }; usage?: { users?: number } };
    const loadSubscription = async (): Promise<SubscriptionState | null> => {
      const { data: subscription, error: subscriptionError } = await callerClient.rpc("my_subscription");
      if (subscriptionError && !missingFunction(subscriptionError)) throw subscriptionError;
      return (subscriptionError ? null : subscription) as SubscriptionState | null;
    };

    // ── تغيير البريد ─────────────────────────────────────────────────────────
    if (changingEmail) {
      // يفك الربط ثم يعيده؛ في القراءة فقط لا تُعاد العضوية فيُقفل الموظف خارج حسابه، فيُرفض قبل أي تغيير
      if ((await loadSubscription())?.access === "read_only") {
        return respond({ success: false, error: SUBSCRIPTION_READ_ONLY_MESSAGE }, 403);
      }
      const newEmail = String(body?.email ?? "").trim().toLowerCase();
      if (!EMAIL_PATTERN.test(newEmail) || newEmail.length > 254) {
        return respond({ success: false, error: "البريد الإلكتروني غير صحيح" }, 400);
      }
      if (newEmail === email) return respond({ success: false, error: "البريد الجديد هو البريد الحالي نفسه" }, 400);
      if (newEmail === callerEmail) return respond({ success: false, error: "لا يمكن استخدام بريد حسابك أنت لموظف آخر" }, 400);
      if (ownerEmail && newEmail === ownerEmail) return respond({ success: false, error: "هذا بريد صاحب المنشأة" }, 409);
      const duplicate = await duplicateInCompany(newEmail);
      if (duplicate) return respond({ success: false, error: duplicate }, 409);
      const { data: reserved } = await admin.from("companies").select("id")
        .ilike("owner_email", escapeLike(newEmail)).neq("id", companyId).in("status", ["pending", "active", "suspended"]).limit(1);
      if ((reserved ?? []).length) return respond({ success: false, error: EMAIL_NOT_AVAILABLE }, 409);
      const holder = await findAccountByEmail(newEmail);

      if (!existing) {
        // بلا حساب دخول مرتبط: يتغيّر سجل الموظف فقط (حساب قائم بالبريد الجديد يُقبل إن كان صالحًا لهذا الموظف)
        // حساب قديم للبريد الجديد يُقبل إن كان لهذا الموظف أو لموظف سابق (استعادته لاحقًا بتأكيد مدير النظام)
        const holderKind = holder ? await classifyAccount(holder) : "usable";
        if (holder && ((holderKind !== "usable" && holderKind !== "orphan") || (await linkedElsewhere(holder.id)))) {
          return respond({ success: false, error: EMAIL_NOT_AVAILABLE }, 409);
        }
        const { data: changed, error: changeError } = await admin.from("employees").update({ email: newEmail })
          .eq("company_id", companyId).eq("id", target.id).is("auth_user_id", null).select("id");
        if (changeError || (changed ?? []).length !== 1) {
          return respond({ success: false, error: "تعذر تغيير البريد؛ أعد فتح الموظف وحاول مرة أخرى" }, 409);
        }
        await log("employee_email_changed", `تغيير بريد الموظف ${target.emp_id ?? ""} — ${target.name ?? ""}: ${email || "—"} ← ${newEmail}`);
        return respond({ success: true, email: newEmail, loginUpdated: false });
      }

      // له حساب دخول مرتبط: يتغيّر البريد في الحساب والسجل معًا
      if (holder && holder.id !== existing.id) return respond({ success: false, error: EMAIL_NOT_AVAILABLE }, 409);
      const elsewhere = await linkedElsewhere(existing.id);
      if (elsewhere) return respond({ success: false, error: elsewhere }, 409);
      if (existing.email !== email) {
        return respond({ success: false, error: "بريد حساب الدخول لا يطابق بريد الموظف؛ راجع إدارة المنصة" }, 409);
      }
      const accountId = existing.id;
      const restoreRow = () => admin.from("employees").update({ email, auth_user_id: accountId })
        .eq("company_id", companyId).eq("id", target.id);

      // 1) البريد الجديد مع فك الربط في نفس التعديل (قاعدة البيانات لا تسمح بغيره)
      const { data: unlinked, error: unlinkError } = await admin.from("employees").update({ email: newEmail, auth_user_id: null })
        .eq("company_id", companyId).eq("id", target.id).eq("auth_user_id", accountId).select("id");
      if (unlinkError || (unlinked ?? []).length !== 1) {
        return respond({ success: false, error: "تعذر تغيير البريد؛ أعد فتح الموظف وحاول مرة أخرى" }, 409);
      }
      // 2) بريد حساب الدخول
      const { error: accountError } = await admin.auth.admin.updateUserById(accountId, { email: newEmail, email_confirm: true });
      if (accountError) {
        const { error: restoreError } = await restoreRow();
        if (restoreError) {
          reqLog.fail(restoreError, "change_email.rollback", { employee_id: target.id });
          return respond({ success: false, error: "تعذر إكمال تغيير البريد ولم يُسترجع الربط كاملًا؛ أنشئ كلمة مرور جديدة للموظف من نموذجه" }, 500);
        }
        const taken = /already|registered|exists/i.test(accountError.message ?? "");
        return respond({ success: false, error: taken ? EMAIL_NOT_AVAILABLE : "تعذر تغيير بريد حساب الدخول؛ لم يتغيّر شيء" }, taken ? 409 : 400);
      }
      // 3) إعادة الربط (قاعدة البيانات تتحقق من البريد والختم وتعيد العضوية)
      const { error: relinkError } = await admin.from("employees").update({ auth_user_id: accountId })
        .eq("company_id", companyId).eq("id", target.id);
      if (relinkError) {
        const { error: revertError } = await admin.auth.admin.updateUserById(accountId, { email, email_confirm: true });
        const { error: restoreError } = revertError ? { error: revertError } : await restoreRow();
        if (revertError || restoreError) {
          reqLog.fail(revertError ?? restoreError, "change_email.rollback", { employee_id: target.id });
          return respond({ success: false, error: "تعذر إكمال تغيير البريد ولم يُسترجع الربط كاملًا؛ أنشئ كلمة مرور جديدة للموظف من نموذجه" }, 500);
        }
        return respond({ success: false, error: "تعذر ربط حساب الدخول بالبريد الجديد؛ لم يتغيّر شيء" }, 409);
      }
      await log("employee_email_changed", `تغيير بريد الموظف وحساب دخوله ${target.emp_id ?? ""} — ${target.name ?? ""}: ${email} ← ${newEmail}`);
      return respond({ success: true, email: newEmail, loginUpdated: true });
    }

    // غير مرتبط: حساب بنفس البريد يُقبل فقط إن كان لهذا الموظف، أو حساب موظف سابق يستعيده مدير النظام بتأكيده
    let unavailableReason = "";
    let adoptable = false;
    let adopted = false;
    if (!existing && EMAIL_PATTERN.test(email)) {
      const match = await findAccountByEmail(email);
      if (match) {
        const kind = await classifyAccount(match);
        if (kind === "usable") existing = match;
        else if (kind === "orphan" && action === "set-password" && callerIsAdmin && body?.adopt === true) {
          existing = match;
          adopted = true;
        } else if (kind === "orphan") {
          adoptable = callerIsAdmin && action === "set-password";
          unavailableReason = callerIsAdmin ? OLD_ACCOUNT_ADMIN : OLD_ACCOUNT_NOT_ADMIN;
        } else {
          unavailableReason = kind === "owner" ? OWNER_ACCOUNT : kind === "other" ? "حساب الدخول بهذا البريد مرتبط بموظف آخر" : EMAIL_NOT_AVAILABLE;
        }
      }
    }
    if (unavailableReason && !disabling) {
      return respond({ success: false, error: unavailableReason, ...(adoptable ? { adoptable: true } : {}) }, 409);
    }

    // الحساب يجب أن يكون لهذا الموظف وحده داخل المنشأة
    if (existing) {
      const elsewhere = await linkedElsewhere(existing.id);
      if (elsewhere) return respond({ success: false, error: elsewhere }, 409);
    }
    if (email && !disabling) {
      const duplicate = await duplicateInCompany(email);
      if (duplicate) return respond({ success: false, error: duplicate }, 409);
    }

    // غير المدير لا يغيّر كلمة مرور حساب قائم لموظف دوره له صلاحيات (يصبح قادرًا على الدخول باسمه)
    if (action === "set-password" && existing && !callerIsAdmin && roleHasPermissions) {
      return respond({ success: false, error: "هذا الموظف له دور بصلاحيات؛ تغيير كلمة مرور حسابه يتم من مدير النظام" }, 403);
    }

    // ربط الحساب بسجل الموظف (قاعدة البيانات تتحقق من البريد والختم وتنشئ العضوية)
    const linkAccount = async (accountId: string) => {
      if (String(target.auth_user_id ?? "") === accountId) return null;
      const { error } = await admin.from("employees").update({ auth_user_id: accountId })
        .eq("company_id", companyId).eq("id", target.id);
      return error;
    };

    if (action === "set-login-state") {
      if (!existing) return respond({ success: true, changed: false, previouslyBanned: false });
      const previouslyBanned = Boolean(existing.banned_until && new Date(existing.banned_until).getTime() > Date.now());
      if (enabling && isInactive(target.status)) {
        return respond({ success: false, error: "الموظف غير فعال؛ فعّله أولًا" }, 400);
      }
      const { error } = await admin.auth.admin.updateUserById(existing.id, { ban_duration: enabling ? "none" : "876000h" });
      if (error) throw error;
      await log(enabling ? "employee_login_enabled" : "employee_login_disabled",
        `${enabling ? "إعادة تفعيل" : "إيقاف"} دخول الموظف ${target.emp_id ?? ""} — ${target.name ?? ""}`);
      return respond({ success: true, changed: true, previouslyBanned });
    }

    // set-password
    const password = String(body?.password ?? "");
    const bytes = new TextEncoder().encode(password).length;
    if (password.length < 8 || bytes > 72) return respond({ success: false, error: "كلمة المرور 8 أحرف على الأقل ولا تزيد على 72 بايت" }, 400);
    if (!EMAIL_PATTERN.test(email)) return respond({ success: false, error: "أضف بريدًا إلكترونيًا صحيحًا للموظف أولًا" }, 400);
    if (isInactive(target.status)) {
      return respond({ success: false, error: "الموظف غير فعال؛ فعّله أولًا" }, 400);
    }
    if (existing && existing.email !== email) {
      return respond({ success: false, error: "بريد الموظف تغيّر عن بريد حساب دخوله؛ راجع مدير النظام" }, 409);
    }
    // S15: ربط حساب جديد بالموظف يُرفض قبل أي تغيير على الحساب إن كانت المنشأة للقراءة فقط أو بلغت حد المستخدمين.
    // تغيير كلمة مرور حساب مربوط مسموح دائمًا (ليصل الموظف إلى بياناته في القراءة فقط). الحكم النهائي للقاعدة.
    const linking = !existing || String(target.auth_user_id ?? "") !== existing.id;
    if (linking) {
      const sub = await loadSubscription();
      if (sub?.access === "read_only") return respond({ success: false, error: SUBSCRIPTION_READ_ONLY_MESSAGE }, 403);
      const maxUsers = sub?.plan?.max_users;
      if (typeof maxUsers === "number" && Number(sub?.usage?.users ?? 0) >= maxUsers) {
        return respond({ success: false, error: PLAN_LIMIT_USERS_MESSAGE }, 409);
      }
    }

    const metadata = { employee_id: target.id, emp_id: target.emp_id, name: target.name };
    const appMetadata = { company_id: companyId, employee_id: target.id, account_type: "employee" };
    let created = false;
    if (existing) {
      const { error } = await admin.auth.admin.updateUserById(existing.id, {
        password,
        email_confirm: true,
        ban_duration: "none",
        user_metadata: { ...(existing.user_metadata ?? {}), ...metadata },
        app_metadata: { ...(existing.app_metadata ?? {}), ...appMetadata },
      });
      if (error) throw error;
      const linkError = await linkAccount(existing.id);
      if (linkError) {
        return respond({
          success: false,
          error: subscriptionErrorMessage(linkError) ?? "تعذر ربط حساب الدخول بالموظف؛ الحساب مستخدم في منشأة أخرى أو غير صالح",
        }, 409);
      }
    } else {
      const { data: createdUser, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: metadata, app_metadata: appMetadata,
      });
      if (error || !createdUser?.user) {
        const duplicate = /already|registered|exists/i.test(error?.message ?? "");
        return respond({
          success: false,
          error: duplicate ? EMAIL_NOT_AVAILABLE : "تعذر إنشاء حساب الدخول",
        }, duplicate ? 409 : 400);
      }
      const linkError = await linkAccount(createdUser.user.id);
      if (linkError) {
        // لا يبقى حساب بلا موظف
        await admin.auth.admin.deleteUser(createdUser.user.id).then(() => undefined, () => undefined);
        return respond({ success: false, error: subscriptionErrorMessage(linkError) ?? "تعذر ربط حساب الدخول بالموظف؛ لم يُنشأ الحساب" }, 409);
      }
      created = true;
    }
    await log(created ? "employee_login_created" : adopted ? "employee_login_adopted" : "employee_password_reset",
      `${created ? "إنشاء حساب دخول" : adopted ? "استعادة حساب دخول قديم بالبريد نفسه وتغيير كلمة مروره" : "تغيير كلمة مرور"} للموظف ${target.emp_id ?? ""} — ${target.name ?? ""}`);
    return respond({ success: true, created, adopted });
  } catch (error) {
    reqLog.fail(error);
    return respond({ success: false, error: "تعذر حفظ حساب الدخول" }, 500);
  }
};

Deno.serve((req: Request) => serveLogged(req, handle));
