import { supabase } from "@/lib/supabaseClient";
import { computePayroll, payrollLineNotes, round2, type PayrollComputation } from "@/lib/payrollCalc";
import { isCancelledPayrollStatus } from "@/lib/advances";
import { monthRange, riyadhToday } from "@/lib/hrDates";

/**
 * مطابقة الرواتب المحفوظة مع الحساب.
 * صف الرواتب يُحفظ عند إرسال طلب الاعتماد ولا يتغير بعده (يراه المعتمد كما أُرسل). فإن أُدخل حضور أو غياب
 * أو جزاء بعد الإرسال بقي في الطلب الصافي القديم (مثل الراتب كاملًا قبل خصم الغياب).
 * هذه الدوال تكشف ذلك لمسؤول الرواتب (فيعيد الإرسال) وللمعتمد (فلا يعتمد أرقامًا قديمة).
 */

/**
 * pending-mine: في طلبي المعلق، أو صف مفتوح بلا طلب معلق — إعادة الإرسال تصححه
 * pending-other: في طلب معلق أرسله مستخدم آخر — يرفضه المعتمد ثم يُعاد الإرسال
 * decided: معتمد أو مرحّل، أو إيقاف قرّرته الإدارة — لا يتغير بإعادة الإرسال
 */
export type PayrollDiffKind = "pending-mine" | "pending-other" | "decided";

export type PayrollAmountDiff = {
  empId: string;
  name: string;
  /** حالة صف الرواتب المحفوظ */
  status: string;
  kind: PayrollDiffKind;
  /** الصافي المحفوظ (المعروض على المعتمد) */
  savedNet: number;
  /** الصافي بالحساب */
  currentNet: number;
  /** تفاصيل الحساب: أيام العمل والحضور والغياب والخصومات */
  currentNotes: string;
};

export type PayrollFreshness = {
  diffs: PayrollAmountDiff[];
  /**
   * للمعتمد: اختلافات لا تظهر بحساب يوم إرسال الطلب وتظهر بحساب اليوم
   * (حضور أو غياب لأيام بعد يوم الإرسال). لا تمنع الاعتماد، لكن يُسأل المعتمد قبله.
   */
  laterDiffs?: PayrollAmountDiff[];
  /** موظفون تعذر التحقق منهم (لا ملف موظف بالرقم، أو أكثر من ملف بالرقم نفسه بنتائج مختلفة) */
  unverified: string[];
};

type SavedRow = { empId: string; name: string; status: string; net: number; kind: PayrollDiffKind };
type PayrollRequest = { id: string; status: string; createdAt: string; sender: string; details: Record<string, unknown> };

const ID_CHUNK = 150;
const chunks = <T,>(items: T[]) =>
  Array.from({ length: Math.ceil(items.length / ID_CHUNK) }, (_, index) => items.slice(index * ID_CHUNK, (index + 1) * ID_CHUNK));
const differs = (a: number, b: number) => Math.abs(round2(a) - round2(b)) >= 0.01;
const addId = (map: Map<string, string[]>, code: string, id: string) => {
  const list = map.get(code) ?? [];
  if (!list.includes(id)) list.push(id);
  map.set(code, list);
};
const isDate = (value: unknown): value is string => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));
// نفس قواعد القاعدة: request_status_is_pending و hr7_is_approved
const isPendingRequest = (status: string) => ["", "معلق", "معلقة", "pending"].includes(status.trim());
const isApprovedRequest = (status: string) => ["موافق", "معتمد", "معتمدة", "مقبول", "approved", "مدفوع"].includes(status.trim());
const codesIn = (details: Record<string, unknown>, key: string): string[] | null => {
  const list = details[key];
  return Array.isArray(list) ? list.map((code) => String(code ?? "").trim()).filter(Boolean) : null;
};

/** رسالة عربية لأخطاء التحقق نفسه (وإلا يُستخدم نص الخطأ العام) */
export const freshnessErrorText = (error: unknown): string | null => {
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  if (message.includes("PAYROLL_CHECK_NO_ACCESS")) return "لا تملك صلاحية قراءة الرواتب أو تقارير الموارد البشرية، فلا يمكن التحقق من الأرقام";
  if (message.includes("PAYROLL_INPUTS_INCOMPLETE")) return "تعذر تحميل بعض بيانات الحساب (إعدادات الراتب أو جداول الدوام أو العطل أو الإجازات)";
  return null;
};

/**
 * يقارن صفوفًا محفوظة بحساب جاهز. الرقم الوظيفي قد يخص أكثر من ملف (رقم مكرر قديم):
 * يكفي أن يطابق أحدها، وإن لم يطابق أيٌّ منها لا يُحكم بالاختلاف (يُعد غير متحقق منه).
 */
function compare(rows: SavedRow[], computation: PayrollComputation, idsByCode: Map<string, string[]>): PayrollFreshness {
  const diffs: PayrollAmountDiff[] = [];
  const unverified: string[] = [];
  rows.forEach((row) => {
    const candidates = (idsByCode.get(row.empId) ?? [])
      .map((id) => {
        const line = computation.lines.get(id);
        // من تعيينه بعد نهاية الشهر لا سطر له: صافيه صفر
        if (line) return { net: line.net, notes: payrollLineNotes(line), name: computation.employees.get(id)?.name ?? "" };
        if (computation.notStarted.has(id)) return { net: 0, notes: "تاريخ التعيين بعد نهاية الشهر", name: "" };
        return null;
      })
      .filter((candidate): candidate is { net: number; notes: string; name: string } => candidate !== null);
    if (candidates.length === 0) {
      unverified.push(row.empId);
      return;
    }
    if (candidates.some((candidate) => !differs(row.net, candidate.net))) return;
    if (candidates.length > 1) {
      unverified.push(row.empId);
      return;
    }
    diffs.push({
      empId: row.empId,
      name: row.name || candidates[0].name || row.empId,
      status: row.status || "معلق",
      kind: row.kind,
      savedNet: round2(row.net),
      currentNet: round2(candidates[0].net),
      currentNotes: candidates[0].notes,
    });
  });
  return { diffs, unverified };
}

/**
 * طلبات اعتماد رواتب الشهر:
 * - ownerOf: الرقم الوظيفي في طلب معلق؟ true طلبي، false طلب مستخدم آخر (أو طلب قديم بلا قائمة لغيري)، null لا طلب معلق
 * - stopDecided: نفس قاعدة القاعدة payroll_stop_decided — آخر طلب مقرَّر يذكر الموظف موافَق عليه وفيه ضمن الموقوفين
 */
async function payrollRequestContext(period: string) {
  const { data, error } = await supabase
    .from("hr_requests")
    .select("id, status, created_at, sender_auth_user_id, details")
    .contains("details", { workflow: "payroll_approval", payroll_period: period });
  if (error) throw error;
  const { data: sessionData } = await supabase.auth.getSession();
  const me = sessionData.session?.user?.id ?? "";
  const requests: PayrollRequest[] = (data ?? []).map((request: Record<string, unknown>) => ({
    id: String(request.id ?? ""),
    status: String(request.status ?? ""),
    createdAt: String(request.created_at ?? ""),
    sender: String(request.sender_auth_user_id ?? ""),
    details: request.details && typeof request.details === "object" ? (request.details as Record<string, unknown>) : {},
  }));

  const ownerByCode = new Map<string, boolean>();
  let wholeMonth: boolean | null = null;
  requests.filter((request) => isPendingRequest(request.status)).forEach((request) => {
    const mine = Boolean(me) && request.sender === me;
    const list = codesIn(request.details, "employee_ids");
    if (list === null) {
      wholeMonth = wholeMonth === false ? false : mine;
      return;
    }
    // طلب لمستخدم آخر يغلب (إعادة الإرسال تتوقف عنده)
    list.forEach((code) => ownerByCode.set(code, (ownerByCode.get(code) ?? true) && mine));
  });

  const decided = requests
    .filter((request) => !isPendingRequest(request.status))
    .sort((a, b) => (a.createdAt === b.createdAt ? b.id.localeCompare(a.id) : b.createdAt.localeCompare(a.createdAt)));

  return {
    ownerOf: (code: string): boolean | null => {
      const own = ownerByCode.get(code);
      if (own !== undefined) return wholeMonth === false ? false : own;
      return wholeMonth;
    },
    stopDecided: (code: string): boolean => {
      const latest = decided.find((request) =>
        ["employee_ids", "active_employee_ids", "stopped_employee_ids"].some((key) => codesIn(request.details, key)?.includes(code)),
      );
      return Boolean(latest && isApprovedRequest(latest.status) && codesIn(latest.details, "stopped_employee_ids")?.includes(code));
    },
  };
}

/**
 * لمسؤول الرواتب: صفوف الشهر المحفوظة لموظفي الحساب المعروض التي يختلف صافيها عن الحساب.
 * المرفوض والملغي لا يُعرضان (يُعاد حساب المرفوض عند الإرسال).
 */
export async function savedPayrollFreshness(computation: PayrollComputation): Promise<PayrollFreshness> {
  const idsByCode = new Map<string, string[]>();
  computation.employees.forEach((employee, id) => {
    const code = employee.empId.trim();
    if (code) addId(idsByCode, code, id);
  });
  computation.notStarted.forEach((code, id) => {
    if (code.trim()) addId(idsByCode, code.trim(), id);
  });
  const raw: Record<string, unknown>[] = [];
  for (const part of chunks([...idsByCode.keys()])) {
    const { data, error } = await supabase
      .from("payroll")
      .select("emp_id, emp_name, status, net_salary, accounting_status")
      .eq("month", computation.period)
      .in("emp_id", part);
    if (error) throw error;
    raw.push(...((data ?? []) as Record<string, unknown>[]));
  }
  const candidates = raw.filter((row) => {
    const status = String(row.status ?? "").trim();
    return status !== "مرفوض" && !isCancelledPayrollStatus(status);
  });
  if (candidates.length === 0) return { diffs: [], unverified: [] };
  const context = await payrollRequestContext(computation.period);
  const rows: SavedRow[] = candidates.map((row) => {
    const empId = String(row.emp_id ?? "").trim();
    const status = String(row.status ?? "").trim();
    const posted = row.accounting_status === "posted";
    const owner = context.ownerOf(empId);
    let kind: PayrollDiffKind = "decided";
    if (!posted && (status === "" || status === "معلق" || status === "موقوف")) {
      if (owner !== null) kind = owner ? "pending-mine" : "pending-other";
      // موقوف خارج أي طلب معلق: مقرَّر إن اعتمدت الإدارة إيقافه، وإلا (رُفض طلبه مثلًا) يُعاد إرساله
      else kind = status === "موقوف" && context.stopDecided(empId) ? "decided" : "pending-mine";
    }
    return { empId, name: String(row.emp_name ?? ""), status: posted ? "مرحّل" : status || "معلق", net: Number(row.net_salary ?? 0), kind };
  });
  return compare(rows, computation, idsByCode);
}

/**
 * يجهز حساب رواتب موظفين بأرقامهم الوظيفية كما يراها المستخدم الحالي. يُشترط أن يقرأ الرواتب أو تقاريرها
 * (وإلا تخفي صلاحيات القاعدة الحضور والجزاءات والسلف فيخرج صافٍ غير صحيح دون أي خطأ).
 */
async function payrollCalculator(period: string, codes: string[]) {
  const { data: allowed, error: accessError } = await supabase.rpc("hr_area_allowed", { p_areas: ["hr.payroll", "hr.reports"], p_manage: false });
  if (accessError) throw accessError;
  if (allowed !== true) throw new Error("PAYROLL_CHECK_NO_ACCESS");
  const idsByCode = new Map<string, string[]>();
  for (const part of chunks(codes)) {
    const { data, error } = await supabase.from("employees").select("id, emp_id").in("emp_id", part);
    if (error) throw error;
    (data ?? []).forEach((row: Record<string, unknown>) => {
      const code = String(row.emp_id ?? "").trim();
      if (code) addId(idsByCode, code, String(row.id));
    });
  }
  const ids = [...new Set([...idsByCode.values()].flat())];
  const compute = async (today?: string) => {
    const computation = await computePayroll(ids, period, { today });
    if (computation.loadErrors.length) throw new Error(`PAYROLL_INPUTS_INCOMPLETE: ${computation.loadErrors.join(" | ")}`);
    return computation;
  };
  return { idsByCode, compute };
}

/**
 * للمعتمد: صفوف طلب اعتماد الرواتب (المعلقة أو الموقوفة فيه) مقارنة بحسابها في يوم إرسال الطلب (computedOn)،
 * فلا يُعد مرور الأيام بعد الإرسال تغييرًا يمنع الاعتماد. وإن أُرسل الطلب قبل نهاية الشهر يُحسب أيضًا بتاريخ اليوم:
 * ما يختلف بحساب اليوم فقط (حضور أو غياب لأيام بعد الإرسال) يُعاد في laterDiffs ليُسأل المعتمد.
 * الطلب القديم بلا تاريخ إرسال يُحسب بتاريخ اليوم.
 * الصفوف من دالة الخادم get_payroll_request_rows (يراها المستلم)، وقبل HR-7 من الجدول مباشرة.
 */
export async function payrollRequestFreshness(requestId: string, period: string, employeeIds: string[], computedOn?: string): Promise<PayrollFreshness> {
  const viaRpc = await supabase.rpc("get_payroll_request_rows", { p_request_id: requestId });
  const missingRpc = Boolean(viaRpc.error && (viaRpc.error.code === "PGRST202" || viaRpc.error.code === "42883"));
  let data = viaRpc.data as Record<string, unknown>[] | null;
  if (missingRpc) {
    const direct = await supabase
      .from("payroll")
      .select("emp_id, emp_name, status, net_salary")
      .eq("month", period)
      .in("emp_id", employeeIds.length ? employeeIds : ["__none__"]);
    if (direct.error) throw direct.error;
    data = direct.data as Record<string, unknown>[] | null;
  } else if (viaRpc.error) {
    throw viaRpc.error;
  }
  // ما يقرره الطلب: الصف المعلق (يُعتمد) والموقوف (يُعتمد إيقافه ويُرحَّل استحقاقه)
  const rows: SavedRow[] = (data ?? [])
    .map((row) => ({
      empId: String(row.emp_id ?? "").trim(),
      name: String(row.emp_name ?? ""),
      status: String(row.status ?? "").trim(),
      net: Number(row.net_salary ?? 0),
      kind: "pending-other" as PayrollDiffKind,
    }))
    .filter((row) => row.empId && ["", "معلق", "موقوف"].includes(row.status));
  if (rows.length === 0) return { diffs: [], unverified: [] };

  const { idsByCode, compute } = await payrollCalculator(period, [...new Set(rows.map((row) => row.empId))]);
  const sentOn = isDate(computedOn) ? computedOn : undefined;
  const atSend = compare(rows, await compute(sentOn), idsByCode);
  const today = riyadhToday();
  if (!sentOn || sentOn >= today || sentOn > monthRange(period).to) return atSend;

  const flagged = new Set([...atSend.diffs.map((diff) => diff.empId), ...atSend.unverified]);
  const atToday = compare(rows, await compute(), idsByCode);
  return { ...atSend, laterDiffs: atToday.diffs.filter((diff) => !flagged.has(diff.empId)) };
}
