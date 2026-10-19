import { createClient } from "jsr:@supabase/supabase-js@2";

// المستخدمون الخاصون (حسابات دخول ليست لموظفين) — نظام الشركات:
// كل العمليات داخل منشأة المستدعي فقط، والحساب الجديد يُختم بالمنشأة (app_metadata.company_id)
// ويُربط بها في system_users، فتنشأ عضويته في المنشأة نفسها.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id",
};
const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// ===== S16: سجل منظّم (سطر JSON لكل حدث) ورقم طلب، وأخطاء 5xx إلى سجل أخطاء النظام =====
// النسخة نفسها في manage-employee-auth وmanage-employee-credentials وmanage-special-users؛ عدّلها في الثلاث معًا.
// - كل طلب: سطر «request» بالحالة والمدة والمستخدم والمنشأة والإجراء (403 و401 تحذير: حدث أمني).
// - الفشل: سطر خطأ بنوعه ونصه ومساره، ويُحفظ في app_error_logs (log_server_error) برقم الطلب نفسه، بعد إرسال الرد.
// - رقم الطلب يولّده الخادم (S + 12 خانة) ويعود في ترويسة X-Request-ID.
// - لا كلمات مرور ولا رموز ولا بريد كامل ولا أرقام طويلة (هوية، جوال، آيبان، بطاقة) في أي سطر: القواعد نفسها في log_redact.
const FN_NAME = "manage-special-users";
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

const handle = async (req: Request, reqLog: RequestLog): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return respond({ error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!url || !anonKey || !serviceKey) return respond({ error: "Server configuration is incomplete" }, 503);

    const caller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const token = authHeader.slice("Bearer ".length);
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) return respond({ error: "Unauthorized" }, 401);
    reqLog.set({ user_id: user.id });

    // إدارة المستخدمين الخاصين (إنشاء، إيقاف، تغيير دور): لمدير النظام فقط
    const { data: mainAdmin, error: adminError } = await caller.rpc("is_main_system_admin");
    if (adminError || mainAdmin !== true) return respond({ error: "إدارة المستخدمين الخاصين لمدير النظام فقط" }, 403);

    // منشأة المستدعي (فعالة) — كل ما بعده داخلها فقط
    const { data: myCompany, error: companyError } = await caller.rpc("my_company");
    const companyInfo = (myCompany ?? {}) as { status?: string; company?: { id?: string } };
    const companyId = String(companyInfo.company?.id ?? "");
    if (companyError || companyInfo.status !== "active" || !companyId) {
      return respond({ error: "حسابك غير مرتبط بمنشأة فعالة" }, 403);
    }
    reqLog.set({ company_id: companyId });

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "create");
    reqLog.set({ action: action.slice(0, 40) });

    // إيقاف مستخدم خاص أو إعادته: الحالة في الجدول بجلسة المدير (يُسجَّل باسمه)، ثم حظر دخوله أو رفعه
    if (action === "set-status") {
      const id = String(body.id ?? "").trim();
      const status = String(body.status ?? "");
      if (!id || !["فعال", "غير فعال"].includes(status)) return respond({ error: "المستخدم والحالة مطلوبان" }, 400);
      const { data: target } = await admin.from("system_users").select("id, auth_user_id, status")
        .eq("company_id", companyId).eq("id", id).maybeSingle();
      if (!target) return respond({ error: "المستخدم الخاص غير موجود" }, 404);
      const { data: updated, error: updateError } = await caller.from("system_users")
        .update({ status, updated_at: new Date().toISOString() }).eq("id", id)
        .select("id, full_name, email, role_id, branch_id, status, created_at").single();
      if (updateError || !updated) return respond({ error: updateError?.message ?? "تعذر تحديث الحالة" }, 400);
      const { error: banError } = await admin.auth.admin.updateUserById(String(target.auth_user_id), {
        ban_duration: status === "فعال" ? "none" : "876000h",
      });
      if (banError) {
        // لا تبقى الحالة مخالفة للدخول: نعيدها كما كانت
        await caller.from("system_users").update({ status: target.status }).eq("id", id);
        reqLog.fail(banError, "set_status.ban_failed");
        return respond({ error: "تعذر تحديث حالة حساب الدخول؛ لم يتغير شيء" }, 500);
      }
      return respond({ user: updated }, 200);
    }

    // تغيير دور مستخدم خاص (ليس دور مدير النظام)
    if (action === "set-role") {
      const id = String(body.id ?? "").trim();
      const newRoleId = String(body.roleId ?? "").trim();
      if (!id || !newRoleId) return respond({ error: "المستخدم والدور مطلوبان" }, 400);
      const { data: newRole } = await admin.from("user_roles").select("id, name_ar")
        .eq("company_id", companyId).eq("id", newRoleId).eq("status", "فعال").maybeSingle();
      if (!newRole) return respond({ error: "الدور المحدد غير صالح" }, 400);
      if (["مدير النظام", "مدير عام", "المدير العام"].includes(String(newRole.name_ar ?? "").trim())) {
        return respond({ error: "لا يُمنح دور مدير النظام لمستخدم خاص" }, 400);
      }
      const { data: updated, error: updateError } = await caller.from("system_users")
        .update({ role_id: newRoleId, updated_at: new Date().toISOString() }).eq("id", id)
        .select("id, full_name, email, role_id, branch_id, status, created_at").single();
      if (updateError || !updated) return respond({ error: updateError?.message ?? "تعذر تغيير الدور" }, 400);
      return respond({ user: updated }, 200);
    }

    if (action !== "create") return respond({ error: "إجراء غير معروف" }, 400);

    const fullName = String(body.fullName ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const roleId = String(body.roleId ?? "").trim();
    const branchId = String(body.branchId ?? "").trim() || null;

    if (!fullName || !email || !roleId || password.length < 8) {
      return respond({ error: "الاسم والبريد والدور وكلمة مرور من 8 أحرف على الأقل مطلوبة" }, 400);
    }

    const { data: role } = await admin.from("user_roles").select("id, name_ar")
      .eq("company_id", companyId).eq("id", roleId).eq("status", "فعال").maybeSingle();
    if (!role) return respond({ error: "الدور المحدد غير صالح" }, 400);
    if (["مدير النظام", "مدير عام", "المدير العام"].includes(String(role.name_ar ?? "").trim())) {
      return respond({ error: "لا يُمنح دور مدير النظام لمستخدم خاص" }, 400);
    }

    if (branchId) {
      const { data: branch } = await admin.from("branches").select("id").eq("company_id", companyId).eq("id", branchId).maybeSingle();
      if (!branch) return respond({ error: "الفرع المحدد غير صالح" }, 400);
    }

    const escaped = email.replace(/[\\%_]/g, (character) => `\\${character}`);
    const [{ data: employeeWithEmail }, { data: systemUserWithEmail }] = await Promise.all([
      admin.from("employees").select("id").eq("company_id", companyId).ilike("email", escaped).limit(1).maybeSingle(),
      admin.from("system_users").select("id").eq("company_id", companyId).ilike("email", escaped).limit(1).maybeSingle(),
    ]);
    if (employeeWithEmail) {
      return respond({ error: "هذا البريد مرتبط مسبقًا بحساب موظف، استخدم بريدًا مختلفًا للمستخدم الخاص" }, 400);
    }
    if (systemUserWithEmail) {
      return respond({ error: "يوجد مستخدم خاص مسجل مسبقًا بهذا البريد الإلكتروني" }, 400);
    }

    const userMetadata = { full_name: fullName, account_type: "special_system_user" };
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: userMetadata,
      // ختم المنشأة: قاعدة البيانات لا تربط الحساب إلا بالمنشأة المختوم بها
      app_metadata: { company_id: companyId, account_type: "special_system_user" },
    });

    // لا يُستولى على حساب دخول قائم: البريد المسجّل مسبقًا يُرفض
    if (createError || !created.user) {
      const duplicateEmail = createError?.message.toLowerCase().includes("already") || createError?.message.toLowerCase().includes("registered");
      return respond({
        error: duplicateEmail
          ? "هذا البريد مستخدم بالفعل لحساب دخول في المنصة، استخدم بريدًا مختلفًا"
          : createError?.message ?? "تعذر إنشاء حساب الدخول",
      }, duplicateEmail ? 409 : 400);
    }
    const authUser = created.user;
    const createdNewAuthUser = true;

    const { data: systemUser, error: insertError } = await admin
      .from("system_users")
      .insert({
        company_id: companyId,
        auth_user_id: authUser.id,
        full_name: fullName,
        email,
        role_id: roleId,
        branch_id: branchId,
        created_by: user.id,
      })
      .select("id, full_name, email, role_id, branch_id, status, created_at")
      .single();

    if (insertError) {
      if (createdNewAuthUser) await admin.auth.admin.deleteUser(authUser.id);
      return respond({ error: "تعذر ربط المستخدم الخاص بالمنشأة؛ لم يُنشأ الحساب" }, 400);
    }

    return respond({ user: systemUser }, 201);
  } catch (error) {
    reqLog.fail(error);
    return respond({ error: "تعذر إتمام العملية على المستخدم الخاص" }, 500);
  }
};

Deno.serve((req: Request) => serveLogged(req, handle));
