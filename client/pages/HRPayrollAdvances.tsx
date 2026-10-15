import { useEffect, useMemo, useRef, useState } from "react";
import Layout from "@/components/Layout";
import { CheckCircle2, Plus, RefreshCw, Search, Trash2, XCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabaseClient";
import { fetchAllRows } from "@/lib/fetchAll";
import { hrRequestErrorText } from "@/lib/hrErrors";
import { isApprovedStatus, isRejectedStatus } from "@/lib/hrStatus";
import { advanceStartMonth, allocateAdvanceRepayments, isCancelledPayrollStatus, parseApprovedAdvance, type AdvanceRecord } from "@/lib/advances";
import { isEmployeeActive } from "@/lib/employeeStatus";
import { riyadhMonth, riyadhToday } from "@/lib/hrDates";
import { canManagePerm, readUserSession } from "@/lib/authSession";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import { useI18n } from "@/i18n";

/**
 * سلف الموظفين: تُسجَّل معلقة، ويعتمدها مسؤول رواتب آخر (لا من سجّلها ولا صاحبها)، ثم يُخصم قسطها من الراتب
 * ابتداءً من شهر البداية حتى السداد. المسدَّد يُحسب من أقساط كشوف الرواتب (عدا الملغاة) شهرًا بشهر،
 * بالدالة نفسها التي يستخدمها مسير الرواتب (lib/advances). المادة 92: قسط السلفة بلا موافقة كتابية لا يزيد على 10% من الأجر،
 * والمادة 93: المحسوم كله لا يزيد على نصف الأجر (يطبقه مسير الرواتب ويؤجل الباقي).
 */
type Employee = { id: string; empId: string; name: string; wage: number; active: boolean };
type Advance = {
  id: string;
  employeeId: string;
  empId: string;
  name: string;
  amount: number;
  installment: number;
  startMonth: string;
  status: string;
  notes: string;
  requestId: string;
  createdBy: string;
  decidedBy: string;
  decisionNote: string;
  createdAt: string;
  repaid: number;
  remaining: number;
};
type AdvanceRequest = { id: string; empId: string; name: string; amount: number; installments: number; installmentAmount: number; startMonth: string; method: string; currency: string; createdAt: string };
type Draft = { employeeId: string; amount: string; installment: string; startMonth: string; notes: string; requestId: string };
type Tab = "pending" | "active" | "closed" | "rejected" | "all";

const TABS: { key: Tab; label: string }[] = [
  { key: "pending", label: "بانتظار الاعتماد" },
  { key: "active", label: "قيد السداد" },
  { key: "closed", label: "مسددة" },
  { key: "rejected", label: "مرفوضة" },
  { key: "all", label: "الكل" },
];
const ADVANCE_REQUEST_TYPE = "السلف";
const METHOD_LABELS: Record<string, string> = { salary: "اقتطاع من الراتب", bank: "تحويل بنكي", cash: "نقدًا" };
const round2 = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const nextMonth = (month: string) => {
  const [year, mon] = month.split("-").map(Number);
  return mon === 12 ? `${year + 1}-01` : `${year}-${String(mon + 1).padStart(2, "0")}`;
};
const emptyDraft = (): Draft => ({ employeeId: "", amount: "", installment: "", startMonth: nextMonth(riyadhMonth()), notes: "", requestId: "" });
const missingRpc = (error: unknown) => ["PGRST202", "42883"].includes(String((error as { code?: string } | null)?.code ?? ""));
/** قسط يكفي لسداد المبلغ في عدد الأشهر (مقرّب للأعلى بالهللة): 1000 على 3 = 333.34 */
const installmentFor = (amount: number, months: number) => (amount > 0 && months > 0 ? Math.ceil(round2(amount / months) * 100 - 1e-6) / 100 : 0);

export default function HRPayrollAdvances() {
  const { t, direction, formatNumber, formatDate } = useI18n();
  const { permissions } = useRolePermissions();
  const canManage = canManagePerm(permissions, "hr.payroll.advances", "hr.payroll", "module.hr");
  const session = readUserSession() as { empId?: unknown; name?: unknown } | null;
  const ownEmpId = String(session?.empId ?? "").trim();
  const ownName = String(session?.name ?? "").trim();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [requests, setRequests] = useState<AdvanceRequest[]>([]);
  const [tab, setTab] = useState<Tab>("pending");
  const [search, setSearch] = useState("");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftSource, setDraftSource] = useState<AdvanceRequest | null>(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const loadSeq = useRef(0);

  const money = (value: number) => `${formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${t("ر.س")}`;
  const isOwn = (empId: string, name: string) => Boolean(ownEmpId) && empId.trim() === ownEmpId && (!ownName || name.trim() === ownName);
  const tabOf = (advance: Advance): Tab => {
    if (isRejectedStatus(advance.status)) return "rejected";
    if (!isApprovedStatus(advance.status)) return "pending";
    return advance.remaining > 0.004 ? "active" : "closed";
  };

  const load = async () => {
    const seq = ++loadSeq.current;
    setLoading(true); setError("");
    try {
      const [employeeRows, advanceRows, payrollRows, requestRows] = await Promise.all([
        fetchAllRows<Record<string, unknown>>((from, to) => supabase.from("employees").select("id, emp_id, name, status, base_salary, total_salary").order("name").order("id").range(from, to)),
        fetchAllRows<Record<string, unknown>>((from, to) => supabase.from("hr_advances").select("*").order("id").range(from, to)),
        // أقساط السلف المخصومة في كشوف الرواتب (غير المرفوضة) — المسدَّد من كل سلفة
        fetchAllRows<Record<string, unknown>>((from, to) => supabase.from("payroll").select("id, emp_id, month, status, advance_deduction").gt("advance_deduction", 0).order("month").order("id").range(from, to)),
        fetchAllRows<Record<string, unknown>>((from, to) => supabase.from("hr_requests").select("id, emp_id, emp_name, status, details, created_at").eq("request_type", ADVANCE_REQUEST_TYPE).order("created_at", { ascending: false }).order("id").range(from, to)),
      ]);
      if (seq !== loadSeq.current) return;
      const employeeList: Employee[] = employeeRows.map((row) => ({
        id: String(row.id),
        empId: String(row.emp_id ?? "").trim(),
        name: String(row.name ?? ""),
        wage: Number(row.total_salary) > 0 ? Number(row.total_salary) : Number(row.base_salary) || 0,
        active: isEmployeeActive(row.status),
      }));
      const employeeById = new Map(employeeList.map((item) => [item.id, item]));
      // أقساط السلف المخصومة لكل موظف شهرًا بشهر (كل الصفوف عدا الملغاة، كما في مسير الرواتب)
      const deductionsByCode = new Map<string, Map<string, number>>();
      payrollRows.forEach((row) => {
        if (isCancelledPayrollStatus(row.status)) return;
        const code = String(row.emp_id ?? "").trim();
        const month = String(row.month ?? "").slice(0, 7);
        const months = deductionsByCode.get(code) ?? new Map<string, number>();
        months.set(month, round2((months.get(month) ?? 0) + (Number(row.advance_deduction) || 0)));
        deductionsByCode.set(code, months);
      });
      const list: Advance[] = advanceRows.map((row) => {
        const employee = employeeById.get(String(row.employee_id ?? ""));
        return {
          id: String(row.id ?? ""),
          employeeId: String(row.employee_id ?? ""),
          empId: employee?.empId ?? String(row.emp_id ?? ""),
          name: employee?.name ?? String(row.emp_name ?? ""),
          amount: round2(Number(row.amount ?? row.remaining_amount) || 0),
          installment: round2(Number(row.monthly_installment) || 0),
          startMonth: advanceStartMonth(row),
          status: String(row.status ?? "").trim() || "معلق",
          notes: String(row.notes ?? row.reason ?? ""),
          requestId: String(row.request_id ?? ""),
          createdBy: String(row.created_by_name ?? ""),
          decidedBy: String(row.decided_by_name ?? ""),
          decisionNote: String(row.decision_note ?? ""),
          createdAt: String(row.created_at ?? ""),
          repaid: 0,
          remaining: 0,
        };
      });
      // توزيع المسدَّد على السلف المعتمدة لكل موظف بالدالة نفسها التي يستخدمها مسير الرواتب
      const recordsByEmployee = new Map<string, AdvanceRecord[]>();
      advanceRows.forEach((row) => {
        const record = parseApprovedAdvance(row);
        if (record) recordsByEmployee.set(record.employeeId, [...(recordsByEmployee.get(record.employeeId) ?? []), record]);
      });
      const repaidById = new Map<string, number>();
      recordsByEmployee.forEach((records, employeeId) => {
        allocateAdvanceRepayments(records, deductionsByCode.get(employeeById.get(employeeId)?.empId ?? "") ?? new Map()).forEach((value, id) => repaidById.set(id, value));
      });
      list.forEach((advance) => {
        if (!isApprovedStatus(advance.status)) { advance.remaining = isRejectedStatus(advance.status) ? 0 : advance.amount; return; }
        advance.repaid = round2(repaidById.get(advance.id) ?? 0);
        advance.remaining = round2(Math.max(0, advance.amount - advance.repaid));
      });
      const linked = new Set(list.filter((advance) => !isRejectedStatus(advance.status)).map((advance) => advance.requestId).filter(Boolean));
      const requestList: AdvanceRequest[] = requestRows
        .filter((row) => isApprovedStatus(row.status) && !linked.has(String(row.id)))
        .map((row) => {
          const details = (row.details && typeof row.details === "object" ? row.details : {}) as Record<string, unknown>;
          return {
            id: String(row.id),
            empId: String(row.emp_id ?? "").trim(),
            name: String(row.emp_name ?? ""),
            amount: round2(Number(details.amount) || 0),
            installments: Math.max(0, Math.round(Number(details.installments) || 0)),
            installmentAmount: round2(Number(details.installment_amount) || 0),
            startMonth: String(details.start_date ?? "").slice(0, 7),
            method: String(details.payment_method ?? ""),
            currency: String(details.currency ?? ""),
            createdAt: String(row.created_at ?? ""),
          };
        });
      setEmployees(employeeList);
      setAdvances(list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      setRequests(requestList);
    } catch (loadError) {
      if (seq !== loadSeq.current) return;
      setError(hrRequestErrorText(loadError, t("تعذر تحميل السلف")));
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => {
    const result: Record<Tab, number> = { pending: 0, active: 0, closed: 0, rejected: 0, all: advances.length };
    advances.forEach((advance) => { result[tabOf(advance)] += 1; });
    return result;
  }, [advances]); // eslint-disable-line react-hooks/exhaustive-deps
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return advances.filter((advance) => (tab === "all" || tabOf(advance) === tab)
      && (!query || advance.name.toLowerCase().includes(query) || advance.empId.toLowerCase().includes(query)));
  }, [advances, tab, search]); // eslint-disable-line react-hooks/exhaustive-deps
  const outstandingTotal = useMemo(() => advances.filter((advance) => isApprovedStatus(advance.status)).reduce((sum, advance) => sum + advance.remaining, 0), [advances]);
  const employeeOptions = useMemo(() => {
    const query = employeeSearch.trim().toLowerCase();
    return employees.filter((employee) => employee.active && (!query || employee.name.toLowerCase().includes(query) || employee.empId.toLowerCase().includes(query))).slice(0, 200);
  }, [employees, employeeSearch]);

  const startFromRequest = (request: AdvanceRequest) => {
    const matches = employees.filter((employee) => employee.empId === request.empId);
    const employee = matches.find((item) => item.name.trim() === request.name.trim()) ?? (matches.length === 1 ? matches[0] : undefined);
    setDraft({
      employeeId: employee?.id ?? "",
      amount: request.amount ? String(request.amount) : "",
      // القسط الذي طلبه الموظف إن ذكره، وإلا ما يكفي للسداد في عدد الأقساط
      installment: request.installmentAmount > 0 ? String(Math.min(request.installmentAmount, request.amount || request.installmentAmount)) : request.amount && request.installments ? String(installmentFor(request.amount, request.installments)) : "",
      startMonth: /^\d{4}-\d{2}$/.test(request.startMonth) && request.startMonth >= riyadhMonth() ? request.startMonth : nextMonth(riyadhMonth()),
      notes: `${t("من طلب سلفة بتاريخ")} ${request.createdAt.slice(0, 10)}`,
      requestId: request.id,
    });
    setDraftSource(request);
    setEmployeeSearch(employee ? "" : request.empId);
    setError(""); setMessage("");
  };

  const draftEmployee = draft ? employees.find((employee) => employee.id === draft.employeeId) : undefined;
  const draftAmount = Number(draft?.amount);
  const draftInstallment = Number(draft?.installment);
  const draftMonths = draftAmount > 0 && draftInstallment > 0 ? Math.ceil(round2(draftAmount / draftInstallment)) : 0;
  const overTenPercent = Boolean(draftEmployee && draftEmployee.wage > 0 && draftInstallment > draftEmployee.wage * 0.1);

  const saveDraft = async () => {
    if (!draft || busy) return;
    const amount = round2(Number(draft.amount));
    const installment = round2(Number(draft.installment));
    if (!draftEmployee) { setError(t("اختر الموظف")); return; }
    if (isOwn(draftEmployee.empId, draftEmployee.name)) { setError(t("لا تسجّل سلفة لنفسك؛ يسجّلها مسؤول رواتب آخر")); return; }
    if (!(amount > 0)) { setError(t("أدخل مبلغ السلفة")); return; }
    if (!(installment > 0) || installment > amount) { setError(t("القسط الشهري يجب أن يكون أكبر من صفر ولا يتجاوز مبلغ السلفة")); return; }
    if (!/^\d{4}-\d{2}$/.test(draft.startMonth) || draft.startMonth < riyadhMonth()) { setError(t("شهر بداية الخصم يجب ألا يسبق الشهر الحالي")); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const payload: Record<string, unknown> = {
        employee_id: draftEmployee.id,
        emp_name: draftEmployee.name,
        amount,
        remaining_amount: amount,
        monthly_installment: installment,
        start_month: draft.startMonth,
        request_date: riyadhToday(),
        status: "معلق",
        notes: draft.notes.trim() || null,
      };
      if (draft.requestId) payload.request_id = draft.requestId;
      const { error: insertError } = await supabase.from("hr_advances").insert(payload);
      if (insertError) throw insertError;
      setMessage(t("سُجّلت السلفة بانتظار اعتماد مسؤول رواتب آخر"));
      setDraft(null); setDraftSource(null); setEmployeeSearch("");
      setTab("pending");
      await load();
    } catch (saveError) {
      setError(hrRequestErrorText(saveError, t("تعذر حفظ السلفة")));
    } finally {
      setBusy(false);
    }
  };

  const decide = async (advance: Advance, decision: "معتمد" | "مرفوض") => {
    if (busy) return;
    if (decision === "مرفوض" && !note.trim()) { setError(t("اكتب سبب الرفض في خانة الملاحظة")); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const { data, error: rpcError } = await supabase.rpc("decide_advance", { p_id: advance.id, p_decision: decision, p_note: note.trim() || null });
      if (rpcError) {
        if (missingRpc(rpcError)) throw new Error(t("اعتماد السلف يتطلب تحديث قاعدة البيانات (HR-7)؛ لم يُعتمد شيء"));
        throw rpcError;
      }
      const updated = Number((data as { updated?: number } | null)?.updated) || 0;
      setMessage(updated ? t(decision === "معتمد" ? "اعتُمدت السلفة؛ يُخصم قسطها من شهر البداية" : "رُفضت السلفة") : t("لم يتغير شيء: صدر قرار في السلفة مسبقًا"));
      setNote("");
      await load();
    } catch (decideError) {
      setError(hrRequestErrorText(decideError, t("تعذر حفظ القرار")));
    } finally {
      setBusy(false);
    }
  };

  const removePending = async (advance: Advance) => {
    if (busy || !window.confirm(t("حذف السلفة المعلقة؟"))) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const { data, error: deleteError } = await supabase.from("hr_advances").delete().eq("id", advance.id).eq("status", "معلق").select("id");
      if (deleteError) throw deleteError;
      setMessage((data ?? []).length ? t("حُذفت السلفة") : t("لم يُحذف شيء: لا تملك صلاحية الحذف أو صدر قرار في السلفة"));
      await load();
    } catch (deleteError) {
      setError(hrRequestErrorText(deleteError, t("تعذر الحذف")));
    } finally {
      setBusy(false);
    }
  };

  const statusBadge = (advance: Advance) => {
    const kind = tabOf(advance);
    const style = kind === "active" ? "bg-sky-50 text-sky-700" : kind === "closed" ? "bg-emerald-50 text-emerald-700" : kind === "rejected" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700";
    const label = kind === "active" ? "قيد السداد" : kind === "closed" ? "مسددة" : kind === "rejected" ? "مرفوضة" : "معلقة";
    return <span className={`rounded px-2 py-1 text-xs font-semibold ${style}`}>{t(label)}</span>;
  };

  return (
    <Layout>
      <div className="mx-auto max-w-[1600px] space-y-5 p-6" dir={direction}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t("سلف الموظفين")}</h1>
            <p className="mt-1 text-sm text-gray-500">{t("تُسجَّل السلفة معلقة ويعتمدها مسؤول رواتب آخر، ثم يُخصم قسطها من الراتب ابتداءً من شهر البداية حتى السداد")}</p>
          </div>
          <div className="flex items-center gap-2">
            {canManage && !draft && (
              <button type="button" onClick={() => { setDraft(emptyDraft()); setDraftSource(null); setEmployeeSearch(""); setError(""); setMessage(""); }}
                className="flex items-center gap-1 rounded bg-[#004e89] px-3 py-2 text-sm text-white">
                <Plus className="h-4 w-4" />{t("سلفة جديدة")}
              </button>
            )}
            <button type="button" onClick={() => void load()} className="rounded border px-3 py-2 text-sm hover:bg-gray-50" disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {message && <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</div>}

        {draft && (
          <div className="space-y-4 rounded-lg border bg-white p-5 shadow-sm">
            <h2 className="font-semibold text-gray-900">{t("تسجيل سلفة")}</h2>
            {draftSource && (
              <div className="rounded border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
                {t("من طلب")} {draftSource.name} ({draftSource.empId}) — {t("طريقة السداد في الطلب")}: {t(METHOD_LABELS[draftSource.method] ?? (draftSource.method || "غير محددة"))}
                {draftSource.method && draftSource.method !== "salary" && <span className="block font-semibold">{t("الموظف طلب السداد بغير الاقتطاع من الراتب؛ لا تسجّلها هنا إن لم يوافق على الاقتطاع")}</span>}
                {draftSource.currency && draftSource.currency !== "SAR" && <span className="block font-semibold">{t("عملة الطلب ليست الريال؛ أدخل المبلغ بالريال")}</span>}
              </div>
            )}
            <div className="grid gap-4 md:grid-cols-3">
              <div className="md:col-span-3">
                <label className="mb-1 block text-sm text-gray-700">{t("الموظف")} *</label>
                <div className="flex flex-wrap gap-2">
                  <Input placeholder={t("بحث بالاسم أو الرقم الوظيفي")} value={employeeSearch} onChange={(event) => setEmployeeSearch(event.target.value)} className="w-64" />
                  <select value={draft.employeeId} onChange={(event) => setDraft({ ...draft, employeeId: event.target.value })} className="min-w-72 rounded border px-3 py-2 text-sm">
                    <option value="">{t("اختر الموظف")}</option>
                    {draftEmployee && !employeeOptions.includes(draftEmployee) && <option value={draftEmployee.id}>{draftEmployee.name} — {draftEmployee.empId}</option>}
                    {employeeOptions.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} — {employee.empId}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-700">{t("مبلغ السلفة (ر.س)")} *</label>
                <Input type="number" min="0" step="0.01" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-700">{t("القسط الشهري (ر.س)")} *</label>
                <Input type="number" min="0" step="0.01" value={draft.installment} onChange={(event) => setDraft({ ...draft, installment: event.target.value })} />
                {draftMonths > 0 && <p className="mt-1 text-xs text-gray-500">{t("عدد الأشهر")}: {formatNumber(draftMonths)}</p>}
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-700">{t("شهر بداية الخصم")} *</label>
                <Input type="month" value={draft.startMonth} min={riyadhMonth()} onChange={(event) => setDraft({ ...draft, startMonth: event.target.value })} />
              </div>
              <div className="md:col-span-3">
                <label className="mb-1 block text-sm text-gray-700">{t("ملاحظات")}</label>
                <Input value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
              </div>
            </div>
            {overTenPercent && (
              <p className="rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800">
                {t("القسط يتجاوز 10% من أجر الموظف: يلزم موافقته الكتابية على الاقتطاع (المادة 92)، مثل طلب السلفة من البوابة. ولا يُخصم في الشهر أكثر من نصف الأجر مع الجزاءات والتأمينات (المادة 93)؛ الباقي يؤجل")}
              </p>
            )}
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={() => void saveDraft()} className="rounded bg-[#004e89] px-4 py-2 text-sm text-white disabled:opacity-50">{t("حفظ بانتظار الاعتماد")}</button>
              <button type="button" disabled={busy} onClick={() => { setDraft(null); setDraftSource(null); }} className="rounded border px-4 py-2 text-sm">{t("إلغاء")}</button>
            </div>
          </div>
        )}

        {canManage && requests.length > 0 && (
          <div className="rounded-lg border bg-white shadow-sm">
            <div className="border-b p-4">
              <h2 className="font-semibold text-gray-900">{t("طلبات سلف موافق عليها لم تُسجَّل بعد")} ({formatNumber(requests.length)})</h2>
              <p className="text-xs text-gray-500">{t("الموافقة على طلب السلفة لا تخصم شيئًا حتى تُسجَّل السلفة هنا وتُعتمد")}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-right text-sm">
                <thead className="bg-slate-100 text-slate-700">
                  <tr>
                    <th className="px-3 py-2">{t("الموظف")}</th><th className="px-3 py-2">{t("المبلغ")}</th><th className="px-3 py-2">{t("عدد الأقساط")}</th>
                    <th className="px-3 py-2">{t("بداية الاستقطاع")}</th><th className="px-3 py-2">{t("طريقة السداد")}</th><th className="px-3 py-2">{t("تاريخ الطلب")}</th><th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {requests.map((request) => (
                    <tr key={request.id}>
                      <td className="px-3 py-2">{request.name} — {request.empId}</td>
                      <td className="px-3 py-2">{formatNumber(request.amount, { minimumFractionDigits: 2 })} {request.currency || ""}</td>
                      <td className="px-3 py-2">{request.installments || "—"}</td>
                      <td className="px-3 py-2">{request.startMonth || "—"}</td>
                      <td className="px-3 py-2">{t(METHOD_LABELS[request.method] ?? (request.method || "—"))}</td>
                      <td className="px-3 py-2">{request.createdAt ? formatDate(request.createdAt.slice(0, 10)) : "—"}</td>
                      <td className="px-3 py-2"><button type="button" onClick={() => startFromRequest(request)} className="rounded border border-[#004e89] px-3 py-1 text-xs text-[#004e89]">{t("تسجيل كسلفة")}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {TABS.map((item) => (
            <button key={item.key} type="button" onClick={() => setTab(item.key)}
              className={`rounded-lg border p-3 text-start ${tab === item.key ? "border-[#004e89] bg-[#004e89]/5" : "bg-white"}`}>
              <p className="text-xs text-gray-500">{t(item.label)}</p>
              <p className="text-xl font-bold text-gray-900">{formatNumber(counts[item.key])}</p>
            </button>
          ))}
        </div>
        <p className="text-sm text-gray-600">{t("إجمالي المتبقي على الموظفين")}: <span className="font-semibold text-gray-900">{money(outstandingTotal)}</span></p>

        <div className="overflow-hidden rounded-lg border bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
            <div className="relative w-72">
              <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input placeholder={t("بحث بالاسم أو الرقم الوظيفي")} value={search} onChange={(event) => setSearch(event.target.value)} className="pr-9" />
            </div>
            {canManage && counts.pending > 0 && <Input placeholder={t("ملاحظة القرار (إلزامية عند الرفض)")} value={note} onChange={(event) => setNote(event.target.value)} className="w-72" />}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1300px] text-right text-sm">
              <thead className="bg-[#004e89] text-white">
                <tr>
                  <th className="px-3 py-3 font-medium">{t("الموظف")}</th>
                  <th className="px-3 py-3 font-medium">{t("المبلغ")}</th>
                  <th className="px-3 py-3 font-medium">{t("القسط الشهري")}</th>
                  <th className="px-3 py-3 font-medium">{t("بداية الخصم")}</th>
                  <th className="px-3 py-3 font-medium">{t("المسدَّد")}</th>
                  <th className="px-3 py-3 font-medium">{t("المتبقي")}</th>
                  <th className="px-3 py-3 font-medium">{t("الحالة")}</th>
                  <th className="px-3 py-3 font-medium">{t("سجّلها")}</th>
                  <th className="px-3 py-3 font-medium">{t("القرار")}</th>
                  <th className="px-3 py-3 font-medium">{t("ملاحظات")}</th>
                  {canManage && <th className="px-3 py-3 font-medium">{t("الإجراءات")}</th>}
                </tr>
              </thead>
              <tbody className="divide-y">
                {loading ? (
                  <tr><td colSpan={11} className="py-8 text-center text-gray-400">{t("جاري التحميل...")}</td></tr>
                ) : visible.length === 0 ? (
                  <tr><td colSpan={11} className="py-8 text-center text-gray-400">{t("لا توجد سلف")}</td></tr>
                ) : visible.map((advance) => {
                  const pending = tabOf(advance) === "pending";
                  const own = isOwn(advance.empId, advance.name);
                  return (
                    <tr key={advance.id} className="hover:bg-gray-50/50">
                      <td className="px-3 py-2 font-medium">{advance.name || "—"} <span className="text-xs text-gray-500">{advance.empId}</span></td>
                      <td className="px-3 py-2">{money(advance.amount)}</td>
                      <td className="px-3 py-2">{advance.installment ? money(advance.installment) : <span className="text-red-600">{t("غير محدد — لا يُخصم")}</span>}</td>
                      <td className="px-3 py-2">{advance.startMonth || "—"}</td>
                      <td className="px-3 py-2">{isApprovedStatus(advance.status) ? money(advance.repaid) : "—"}</td>
                      <td className="px-3 py-2 font-semibold">{isApprovedStatus(advance.status) ? money(advance.remaining) : "—"}</td>
                      <td className="px-3 py-2">{statusBadge(advance)}</td>
                      <td className="px-3 py-2">{advance.createdBy || "—"}</td>
                      <td className="px-3 py-2">{advance.decidedBy ? `${advance.decidedBy}${advance.decisionNote ? ` — ${advance.decisionNote}` : ""}` : "—"}</td>
                      <td className="max-w-48 px-3 py-2 text-gray-600">{advance.notes || "—"}</td>
                      {canManage && (
                        <td className="whitespace-nowrap px-3 py-2">
                          {pending && !own && (
                            <span className="flex gap-1">
                              <button type="button" disabled={busy} onClick={() => void decide(advance, "معتمد")} className="flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-xs text-white disabled:opacity-50"><CheckCircle2 className="h-3 w-3" />{t("اعتماد")}</button>
                              <button type="button" disabled={busy} onClick={() => void decide(advance, "مرفوض")} className="flex items-center gap-1 rounded bg-red-600 px-2 py-1 text-xs text-white disabled:opacity-50"><XCircle className="h-3 w-3" />{t("رفض")}</button>
                              <button type="button" disabled={busy} onClick={() => void removePending(advance)} className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 disabled:opacity-50" title={t("حذف")}><Trash2 className="h-3 w-3" /></button>
                            </span>
                          )}
                          {pending && own && <span className="text-xs text-amber-700">{t("سلفتك؛ يقرر فيها مسؤول آخر")}</span>}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Layout>
  );
}
