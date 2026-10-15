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
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: jsonHeaders });

const adminRoles = new Set(["مدير النظام", "مدير عام", "المدير العام"]);
// نفس قائمة قاعدة البيانات (employee_status_active)
const inactiveStatuses = new Set(["غير فعال", "غير نشط", "منتهي", "منتهية", "منتهي الخدمة", "مستقيل", "مفصول", "موقوف", "inactive", "terminated"]);
const isInactive = (status: unknown) => inactiveStatuses.has(String(status ?? "").trim().toLowerCase());
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
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

Deno.serve(async (req: Request) => {
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
    const callerEmail = user.email.toLowerCase();

    // منشأة المستدعي (فعالة) — كل ما بعده داخلها فقط
    const { data: myCompany, error: companyError } = await callerClient.rpc("my_company");
    const company = (myCompany ?? {}) as { status?: string; company?: { id?: string } };
    const companyId = String(company.company?.id ?? "");
    if (companyError || company.status !== "active" || !companyId) {
      return respond({ success: false, error: "حسابك غير مرتبط بمنشأة فعالة" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");
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

    // ── تغيير البريد ─────────────────────────────────────────────────────────
    if (changingEmail) {
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
          console.error("change-email rollback failed", target.id, restoreError);
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
          console.error("change-email rollback failed", target.id, revertError ?? restoreError);
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
        return respond({ success: false, error: "تعذر ربط حساب الدخول بالموظف؛ الحساب مستخدم في منشأة أخرى أو غير صالح" }, 409);
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
        return respond({ success: false, error: "تعذر ربط حساب الدخول بالموظف؛ لم يُنشأ الحساب" }, 409);
      }
      created = true;
    }
    await log(created ? "employee_login_created" : adopted ? "employee_login_adopted" : "employee_password_reset",
      `${created ? "إنشاء حساب دخول" : adopted ? "استعادة حساب دخول قديم بالبريد نفسه وتغيير كلمة مروره" : "تغيير كلمة مرور"} للموظف ${target.emp_id ?? ""} — ${target.name ?? ""}`);
    return respond({ success: true, created, adopted });
  } catch (error) {
    console.error(error);
    return respond({ success: false, error: "تعذر حفظ حساب الدخول" }, 500);
  }
});
