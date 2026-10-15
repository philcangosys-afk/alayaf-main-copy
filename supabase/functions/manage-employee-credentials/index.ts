import { createClient } from "jsr:@supabase/supabase-js@2";

// البريد الداخلي للموظفين (employee_emails) — نظام الشركات:
// كل قراءة وكتابة بمفتاح الخادم مقيّدة بمنشأة المستدعي، ونطاق البريد من بيانات المنشأة (employee_email_domain).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: jsonHeaders });

const fullAccessRoles = new Set(["مدير النظام", "مدير عام", "المدير العام"]);
const canManageCredentials = (roleName: string, permissions: Record<string, unknown>) =>
  fullAccessRoles.has(roleName) ||
  permissions["module.hr"] === true ||
  permissions["module.hr"] === "manage" ||
  permissions["hr.settings"] === true ||
  permissions["hr.settings"] === "manage";

const arabicMap: Record<string, string> = {
  ا: "a", أ: "a", إ: "i", آ: "a", ء: "a", ؤ: "o", ئ: "e", ى: "a", ة: "a",
  ب: "b", ت: "t", ث: "th", ج: "j", ح: "h", خ: "kh", د: "d", ذ: "dh",
  ر: "r", ز: "z", س: "s", ش: "sh", ص: "s", ض: "d", ط: "t", ظ: "z",
  ع: "a", غ: "gh", ف: "f", ق: "q", ك: "k", ل: "l", م: "m", ن: "n",
  ه: "h", و: "w", ي: "y", پ: "p", چ: "ch", ڤ: "v", گ: "g",
};

const toEnglishFirstName = (firstName: unknown, fullName: unknown) => {
  const source = String(firstName || fullName || "").trim().split(/\s+/)[0];
  const transliterated = Array.from(source)
    .map((character) => arabicMap[character] ?? character)
    .join("")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return transliterated || "employee";
};

const randomDigits = () => {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return String(value[0] % 1000).padStart(3, "0");
};

const strongPassword = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#$%";
  const values = new Uint32Array(14);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => chars[value % chars.length]).join("");
};

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
};

const base64ToBytes = (value: string) => {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const encryptionKey = async (secret: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
};

const encryptPassword = async (password: string, secret: string) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(secret);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(password),
  ));
  return `${bytesToBase64(iv)}.${bytesToBase64(ciphertext)}`;
};

const decryptPassword = async (encrypted: string | null, secret: string) => {
  if (!encrypted) return "";
  try {
    const [ivValue, ciphertextValue] = encrypted.split(".");
    const key = await encryptionKey(secret);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(ivValue) },
      key,
      base64ToBytes(ciphertextValue),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    return "";
  }
};

const secureEqual = (left: string, right: string) => {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond({ success: false, error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return respond({ success: false, error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !anonKey || !serviceKey) return respond({ success: false, error: "Server configuration is incomplete" }, 503);

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, serviceKey);
    const token = authHeader.slice("Bearer ".length);
    const { data: { user }, error: authError } = await callerClient.auth.getUser(token);
    if (authError || !user?.email) return respond({ success: false, error: "Unauthorized" }, 401);

    // منشأة المستدعي (فعالة) — كل ما بعده داخلها فقط
    const { data: myCompany, error: companyError } = await callerClient.rpc("my_company");
    const companyInfo = (myCompany ?? {}) as { status?: string; company?: { id?: string; employee_email_domain?: string } };
    const companyId = String(companyInfo.company?.id ?? "");
    if (companyError || companyInfo.status !== "active" || !companyId) {
      return respond({ success: false, error: "حسابك غير مرتبط بمنشأة فعالة" }, 403);
    }
    const emailDomain = String(companyInfo.company?.employee_email_domain ?? "").trim().toLowerCase();

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");
    // المستدعي يُحدَّد من ربط حسابه (employees.auth_user_id أو employee_emails) أو من بريده المطابق تمامًا داخل منشأته؛
    // لا من user_metadata (يغيّرها المستخدم بنفسه)
    const escapeLike = (value: string) => value.replace(/[\\%_]/g, (character) => `\\${character}`);
    const { data: linkedCredential } = await adminClient
      .from("employee_emails")
      .select("employee_id")
      .eq("company_id", companyId)
      .eq("auth_user_id", user.id)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    const { data: linkedEmployee } = await adminClient
      .from("employees").select("id, emp_id, name, employee_role")
      .eq("company_id", companyId).eq("auth_user_id", user.id).limit(1);
    const { data: callerRows } = (linkedEmployee ?? []).length
      ? { data: linkedEmployee }
      : linkedCredential?.employee_id
      ? await adminClient.from("employees").select("id, emp_id, name, employee_role").eq("company_id", companyId).eq("id", linkedCredential.employee_id).limit(1)
      : await adminClient.from("employees").select("id, emp_id, name, employee_role").eq("company_id", companyId).ilike("email", escapeLike(user.email.toLowerCase())).limit(2);
    const caller = callerRows && callerRows.length === 1 ? callerRows[0] : null;

    if (["mailbox-info", "verify-mailbox", "mark-mailbox-messages-read", "delete-mailbox-message", "purge-mailbox-message"].includes(action)) {
      const requestedEmpId = String(body?.empId ?? "").trim();
      if (!caller || !requestedEmpId || String(caller.emp_id) !== requestedEmpId) {
        return respond({ success: false, error: "غير مصرح بالدخول إلى هذا البريد" }, 403);
      }

      const { data: credential } = await adminClient
        .from("employee_emails")
        .select("generated_email, password_ciphertext")
        .eq("company_id", companyId)
        .eq("employee_id", caller.id)
        .eq("status", "active")
        .maybeSingle();

      if (!credential) return respond({ success: false, error: "لم يتم إنشاء بريد إلكتروني لك بعد" }, 404);

      if (action === "mailbox-info") {
        return respond({ success: true, generated_email: credential.generated_email });
      }

      if (action === "mark-mailbox-messages-read") {
        const requestedIds = Array.isArray(body?.messageIds)
          ? Array.from(new Set(body.messageIds.map((value: unknown) => String(value)).filter(Boolean))).slice(0, 100)
          : [];
        if (requestedIds.length === 0) return respond({ success: true, message_ids: [] });
        const { data: ownedMessages, error: ownedMessagesError } = await adminClient
          .from("employee_mail_messages")
          .select("id")
          .eq("company_id", companyId)
          .in("id", requestedIds)
          .eq("to_email", credential.generated_email)
          .is("read_at", null);
        if (ownedMessagesError) throw ownedMessagesError;
        const ownedIds = (ownedMessages ?? []).map((message) => String(message.id));
        if (ownedIds.length === 0) return respond({ success: true, message_ids: [] });
        const readAt = new Date().toISOString();
        const { error: readError } = await adminClient
          .from("employee_mail_messages")
          .update({ read_at: readAt })
          .eq("company_id", companyId)
          .in("id", ownedIds);
        if (readError) throw readError;
        return respond({ success: true, message_ids: ownedIds, read_at: readAt });
      }

      if (action === "delete-mailbox-message" || action === "purge-mailbox-message") {
        const messageId = String(body?.messageId ?? "").trim();
        if (!messageId) return respond({ success: false, error: "الرسالة مطلوبة" }, 400);
        const { data: message } = await adminClient
          .from("employee_mail_messages")
          // "*" لا اسم عمود بعينه: عمود deduction_assignment_id قد لا يوجد في قاعدة قديمة، وطلب عمود غير موجود يُفشل القراءة
          .select("*")
          .eq("company_id", companyId)
          .eq("id", messageId)
          .maybeSingle();
        if (!message || ![message.from_email, message.to_email].includes(credential.generated_email)) {
          return respond({ success: false, error: "الرسالة غير موجودة في بريدك" }, 404);
        }

        const changedAt = new Date().toISOString();
        const changes: Record<string, string> = {};
        const isSender = message.from_email === credential.generated_email;
        const isRecipient = message.to_email === credential.generated_email;
        if (action === "purge-mailbox-message") {
          if ((isSender && !message.deleted_by_sender_at) || (isRecipient && !message.deleted_by_recipient_at)) {
            return respond({ success: false, error: "يجب نقل الرسالة إلى المهملات أولاً" }, 400);
          }
          if (isSender) changes.purged_by_sender_at = changedAt;
          if (isRecipient) changes.purged_by_recipient_at = changedAt;
        } else {
          if (isSender) changes.deleted_by_sender_at = changedAt;
          if (isRecipient) changes.deleted_by_recipient_at = changedAt;
        }

        const { error: changeError } = await adminClient
          .from("employee_mail_messages")
          .update(changes)
          .eq("company_id", companyId)
          .eq("id", message.id);
        if (changeError) throw changeError;

        const senderPurged = Boolean(message.purged_by_sender_at || changes.purged_by_sender_at);
        const recipientPurged = Boolean(message.purged_by_recipient_at || changes.purged_by_recipient_at);
        // رسائل الخصم الآلي القديم محفوظة للمراجعة القانونية: تُخفى من الصندوقين ولا تُحذف من قاعدة البيانات
        if (senderPurged && recipientPurged && !message.deduction_assignment_id) {
          const { error: hardDeleteError } = await adminClient
            .from("employee_mail_messages")
            .delete()
            .eq("company_id", companyId)
            .eq("id", message.id);
          if (hardDeleteError) throw hardDeleteError;
        }

        return respond({
          success: true,
          message_id: message.id,
          deleted_at: action === "delete-mailbox-message" ? changedAt : null,
          purged_at: action === "purge-mailbox-message" ? changedAt : null,
        });
      }

      const suppliedPassword = String(body?.password ?? "");
      const savedPassword = await decryptPassword(credential.password_ciphertext, serviceKey);
      if (!savedPassword || !secureEqual(suppliedPassword, savedPassword)) {
        return respond({ success: false, error: "كلمة مرور البريد غير صحيحة" }, 401);
      }
      return respond({ success: true, generated_email: credential.generated_email });
    }

    // الإدارة: مدير النظام، أو إدارة الموظفين (بمنطق القسم في قاعدة البيانات: مفتاح الموظفين يحسم، وإلا الموارد البشرية العام)
    const [{ data: isAdmin }, { data: canManage }] = await Promise.all([
      callerClient.rpc("is_main_system_admin"),
      callerClient.rpc("hr_area_allowed", { p_areas: ["hr.employees"], p_manage: true }),
    ]);
    if (isAdmin !== true && canManage !== true) {
      return respond({ success: false, error: "غير مصرح بإدارة بيانات الدخول" }, 403);
    }

    if (action === "list") {
      const { data, error } = await adminClient
        .from("employee_emails")
        .select("id, emp_id, emp_name, generated_email, password_ciphertext, created_at")
        .eq("company_id", companyId)
        .eq("status", "active")
        .order("created_at", { ascending: false });
      if (error) throw error;
      const credentials = await Promise.all((data ?? []).map(async (row) => ({
        id: row.id,
        emp_id: row.emp_id,
        emp_name: row.emp_name,
        generated_email: row.generated_email,
        // كلمة المرور لا تُعرض إلا لمدير النظام
        generated_password: isAdmin === true ? await decryptPassword(row.password_ciphertext, serviceKey) : "",
        created_at: row.created_at,
      })));
      return respond({ success: true, credentials });
    }

    if (action !== "generate") return respond({ success: false, error: "Unknown action" }, 400);
    const employeeId = String(body?.employeeId ?? "").trim();
    if (!employeeId) return respond({ success: false, error: "الموظف مطلوب" }, 400);

    const { data: employee, error: employeeError } = await adminClient
      .from("employees")
      .select("id, emp_id, name, first_name, email, nationality, auth_user_id")
      .eq("company_id", companyId)
      .eq("id", employeeId)
      .maybeSingle();
    if (employeeError || !employee) return respond({ success: false, error: "لم يتم العثور على الموظف" }, 404);
    if (String(employee.nationality).trim() !== "سعودي") {
      return respond({ success: false, error: "توليد البريد متاح للموظفين السعوديين فقط" }, 400);
    }

    // نطاق البريد الداخلي من بيانات المنشأة (تحدده إدارة المنصة)، ولا يتكرر بين المنشآت
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(emailDomain)) {
      return respond({ success: false, error: "لم يُحدَّد نطاق البريد الداخلي للمنشأة؛ اطلبه من إدارة المنصة" }, 400);
    }
    const firstName = toEnglishFirstName(employee.first_name, employee.name);
    let localPart = firstName;
    let generatedEmail = `${localPart}@${emailDomain}`;
    let suffix = 1;
    while (true) {
      const { data: collision } = await adminClient
        .from("employee_emails")
        .select("employee_id")
        .eq("generated_email", generatedEmail)
        .maybeSingle();
      if (!collision || collision.employee_id === employee.id) break;
      suffix += 1;
      localPart = `${firstName}${suffix}`;
      generatedEmail = `${localPart}@${emailDomain}`;
    }

    const generatedPassword = strongPassword();
    const { data: existingCredential } = await adminClient
      .from("employee_emails")
      .select("id, auth_user_id")
      .eq("company_id", companyId)
      .eq("employee_id", employee.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // حساب الدخول المرتبط بالموظف (ينشئه ويربطه manage-employee-auth)؛ لا بحث عام في حسابات المنصة بالبريد
    const authUserId = employee.auth_user_id
      ? String(employee.auth_user_id)
      : existingCredential?.auth_user_id ? String(existingCredential.auth_user_id) : "";

    const passwordCiphertext = await encryptPassword(generatedPassword, serviceKey);
    const credentialPayload = {
      company_id: companyId,
      employee_id: employee.id,
      auth_user_id: authUserId || null,
      emp_id: employee.emp_id,
      emp_name: employee.name,
      generated_first_name: localPart,
      generated_email: generatedEmail,
      password_ciphertext: passwordCiphertext,
      status: "active",
      updated_at: new Date().toISOString(),
    };
    const credentialResult = existingCredential?.id
      ? await adminClient.from("employee_emails").update(credentialPayload).eq("company_id", companyId).eq("id", existingCredential.id)
      : await adminClient.from("employee_emails").insert(credentialPayload);
    if (credentialResult.error) throw credentialResult.error;

    return respond({
      success: true,
      credential: {
        employee_id: employee.id,
        emp_id: employee.emp_id,
        emp_name: employee.name,
        generated_email: generatedEmail,
        generated_password: generatedPassword,
      },
    });
  } catch (error) {
    console.error(error);
    return respond({ success: false, error: "تعذر إدارة بيانات دخول الموظف" }, 500);
  }
});
