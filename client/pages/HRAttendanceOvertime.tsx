import { useEffect, useMemo, useRef, useState } from "react";
import Layout from "@/components/Layout";
import { CheckCircle2, RefreshCw, Search, Trash2, XCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabaseClient";
import { fetchAllRows } from "@/lib/fetchAll";
import { hrRequestErrorText } from "@/lib/hrErrors";
import { isApprovedStatus, isRejectedStatus } from "@/lib/hrStatus";
import { monthRange, riyadhMonth } from "@/lib/hrDates";
import { canManagePerm, readUserSession } from "@/lib/authSession";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import { useI18n } from "@/i18n";

/**
 * اعتماد الساعات الإضافية: تُسجَّل من "حساب الدوام" معلقة، ولا تدخل الراتب إلا بعد اعتمادها هنا
 * من مسؤول آخر (إدارة الحضور أو الرواتب)، لا من سجّلها ولا من صاحبها. قاعدة البيانات تفرض ذلك أيضًا.
 */
type OvertimeRow = {
  id: string;
  employeeId: string;
  empId: string;
  name: string;
  department: string;
  date: string;
  hours: number;
  amount: number;
  status: string;
  notes: string;
  createdBy: string;
  decidedBy: string;
  decisionNote: string;
};
type Tab = "pending" | "approved" | "rejected" | "all";
type DecideResult = { updated?: number; self_skipped?: number; creator_skipped?: number; not_pending?: number; locked?: number };

const TABS: { key: Tab; label: string }[] = [
  { key: "pending", label: "بانتظار الاعتماد" },
  { key: "approved", label: "معتمدة" },
  { key: "rejected", label: "مرفوضة" },
  { key: "all", label: "الكل" },
];
const tabOf = (status: string): Tab => (isApprovedStatus(status) ? "approved" : isRejectedStatus(status) ? "rejected" : "pending");
const ID_CHUNK = 100;
const chunkIds = (ids: string[]) => Array.from({ length: Math.ceil(ids.length / ID_CHUNK) }, (_, index) => ids.slice(index * ID_CHUNK, (index + 1) * ID_CHUNK));
const missingRpc = (error: unknown) => ["PGRST202", "42883"].includes(String((error as { code?: string } | null)?.code ?? ""));

export default function HRAttendanceOvertime() {
  const { t, direction, formatNumber, formatDate } = useI18n();
  const { permissions } = useRolePermissions();
  // الصفحة تحت الحضور: يقرر فيها من يدير الحضور (قاعدة البيانات تقبل أيضًا مدير الرواتب عبر الدالة نفسها)
  const canDecide = canManagePerm(permissions, "hr.attendance.overtime", "hr.attendance", "module.hr");
  const canDelete = canDecide;
  const session = readUserSession() as { empId?: unknown; name?: unknown } | null;
  const ownEmpId = String(session?.empId ?? "").trim();
  const ownName = String(session?.name ?? "").trim();
  const [month, setMonth] = useState(riyadhMonth());
  const [tab, setTab] = useState<Tab>("pending");
  const [rows, setRows] = useState<OvertimeRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const loadSeq = useRef(0);

  const isOwn = (row: OvertimeRow) => Boolean(ownEmpId) && row.empId.trim() === ownEmpId && (!ownName || row.name.trim() === ownName);
  const money = (value: number) => `${formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${t("ر.س")}`;

  const load = async () => {
    const seq = ++loadSeq.current;
    if (!/^\d{4}-\d{2}$/.test(month)) { setLoading(false); setRows([]); return; }
    setLoading(true); setError("");
    try {
      const { from, to } = monthRange(month);
      const records = await fetchAllRows<Record<string, unknown>>((start, end) => supabase
        .from("overtime_records")
        .select("*")
        .gte("date", from)
        .lte("date", to)
        .order("date", { ascending: false })
        .order("id")
        .range(start, end));
      const ids = [...new Set(records.map((row) => String(row.employee_id ?? "")).filter(Boolean))];
      const employees = new Map<string, Record<string, unknown>>();
      // تعذر قراءة أسماء الموظفين لا يوقف الصفحة: يُعرض الاسم المحفوظ في السجل
      for (const part of chunkIds(ids)) {
        const { data, error: employeeError } = await supabase.from("employees").select("id, emp_id, name, department").in("id", part);
        if (employeeError) continue;
        (data ?? []).forEach((row: Record<string, unknown>) => employees.set(String(row.id), row));
      }
      if (seq !== loadSeq.current) return;
      setRows(records.map((row) => {
        const employee = employees.get(String(row.employee_id ?? ""));
        return {
          id: String(row.id ?? ""),
          employeeId: String(row.employee_id ?? ""),
          empId: String(employee?.emp_id ?? row.emp_id ?? ""),
          name: String(employee?.name ?? row.emp_name ?? ""),
          department: String(employee?.department ?? ""),
          date: String(row.date ?? "").slice(0, 10),
          hours: Number(row.hours) || 0,
          amount: Number(row.amount) || 0,
          status: String(row.status ?? "").trim() || "معلق",
          notes: String(row.notes ?? ""),
          createdBy: String(row.created_by_name ?? ""),
          decidedBy: String(row.decided_by_name ?? ""),
          decisionNote: String(row.decision_note ?? ""),
        };
      }));
      setSelected(new Set());
    } catch (loadError) {
      if (seq !== loadSeq.current) return;
      setError(hrRequestErrorText(loadError, t("تعذر تحميل الساعات الإضافية")));
      setRows([]);
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [month]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => (tab === "all" || tabOf(row.status) === tab)
      && (!query || row.name.toLowerCase().includes(query) || row.empId.toLowerCase().includes(query)));
  }, [rows, tab, search]);
  const counts = useMemo(() => {
    const result: Record<Tab, number> = { pending: 0, approved: 0, rejected: 0, all: rows.length };
    rows.forEach((row) => { result[tabOf(row.status)] += 1; });
    return result;
  }, [rows]);
  const approvedTotal = useMemo(() => rows.filter((row) => isApprovedStatus(row.status)).reduce((sum, row) => sum + row.amount, 0), [rows]);
  const selectable = visible.filter((row) => tabOf(row.status) === "pending" && !isOwn(row));
  const allSelected = selectable.length > 0 && selectable.every((row) => selected.has(row.id));

  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectable.map((row) => row.id)));

  const decide = async (decision: "معتمد" | "مرفوض") => {
    // المحدد الظاهر فقط (لا ما أخفاه البحث)
    const ids = selectable.filter((row) => selected.has(row.id)).map((row) => row.id);
    if (!ids.length || busy) return;
    if (decision === "مرفوض" && !note.trim()) { setError(t("اكتب سبب الرفض في خانة الملاحظة")); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      // دفعات من 500 سجل (حد الدالة 1000 في المرة)
      const result: Required<DecideResult> = { updated: 0, self_skipped: 0, creator_skipped: 0, not_pending: 0, locked: 0 };
      for (let index = 0; index < ids.length; index += 500) {
        const { data, error: rpcError } = await supabase.rpc("decide_overtime", { p_ids: ids.slice(index, index + 500), p_decision: decision, p_note: note.trim() || null });
        if (rpcError) {
          if (missingRpc(rpcError)) throw new Error(t("اعتماد الساعات الإضافية يتطلب تحديث قاعدة البيانات (HR-7)؛ لم يُعتمد شيء"));
          throw rpcError;
        }
        const part = (data ?? {}) as DecideResult;
        (Object.keys(result) as (keyof DecideResult)[]).forEach((key) => { result[key] += Number(part[key]) || 0; });
      }
      const parts = [`${t(decision === "معتمد" ? "اعتُمد" : "رُفض")} ${formatNumber(Number(result.updated) || 0)} ${t("سجل")}`];
      if (result.self_skipped) parts.push(`${t("تُخطي")} ${formatNumber(result.self_skipped)} ${t("سجل يخصك")}`);
      if (result.creator_skipped) parts.push(`${t("تُخطي")} ${formatNumber(result.creator_skipped)} ${t("سجل سجّلته أنت؛ يعتمده مسؤول آخر")}`);
      if (result.locked) parts.push(`${t("تُخطي")} ${formatNumber(result.locked)} ${t("سجل في شهر رواتبه معتمدة أو مرحّلة")}`);
      if (result.not_pending) parts.push(`${t("تُخطي")} ${formatNumber(result.not_pending)} ${t("سجل صدر فيه قرار مسبقًا")}`);
      setMessage(parts.join("، "));
      setNote("");
      await load();
    } catch (decideError) {
      setError(hrRequestErrorText(decideError, t("تعذر حفظ القرار")));
    } finally {
      setBusy(false);
    }
  };

  const removePending = async () => {
    const ids = selectable.filter((row) => selected.has(row.id)).map((row) => row.id);
    if (!ids.length || busy) return;
    if (!window.confirm(t("حذف السجلات المعلقة المحددة؟ لا يُحذف سجل معتمد أو مرفوض"))) return;
    setBusy(true); setError(""); setMessage("");
    try {
      let deleted = 0;
      for (const part of chunkIds(ids)) {
        const { data, error: deleteError } = await supabase.from("overtime_records").delete().in("id", part).eq("status", "معلق").select("id");
        if (deleteError) throw deleteError;
        deleted += (data ?? []).length;
      }
      setMessage(deleted ? `${t("حُذف")} ${formatNumber(deleted)} ${t("سجل")}` : t("لم يُحذف شيء: لا تملك صلاحية الحذف أو صدر قرار في السجلات"));
      await load();
    } catch (deleteError) {
      setError(hrRequestErrorText(deleteError, t("تعذر الحذف")));
    } finally {
      setBusy(false);
    }
  };

  const statusBadge = (status: string) => {
    const kind = tabOf(status);
    const style = kind === "approved" ? "bg-emerald-50 text-emerald-700" : kind === "rejected" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700";
    return <span className={`rounded px-2 py-1 text-xs font-semibold ${style}`}>{t(kind === "approved" ? "معتمد" : kind === "rejected" ? "مرفوض" : "معلق")}</span>;
  };

  return (
    <Layout>
      <div className="mx-auto max-w-[1600px] space-y-5 p-6" dir={direction}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t("اعتماد الساعات الإضافية")}</h1>
            <p className="mt-1 text-sm text-gray-500">{t("تُسجَّل الساعات الإضافية من حساب الدوام معلقة، ولا تدخل الراتب إلا بعد اعتمادها هنا من مسؤول غير من سجّلها وغير صاحبها")}</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">{t("الشهر")}</label>
            <Input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="w-44" />
            <button type="button" onClick={() => void load()} className="rounded border px-3 py-2 text-sm hover:bg-gray-50" disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {TABS.map((item) => (
            <button key={item.key} type="button" onClick={() => { setTab(item.key); setSelected(new Set()); }}
              className={`rounded-lg border p-3 text-start ${tab === item.key ? "border-[#004e89] bg-[#004e89]/5" : "bg-white"}`}>
              <p className="text-xs text-gray-500">{t(item.label)}</p>
              <p className="text-xl font-bold text-gray-900">{formatNumber(counts[item.key])}</p>
            </button>
          ))}
        </div>
        <p className="text-sm text-gray-600">{t("إجمالي المعتمد في الشهر")}: <span className="font-semibold text-gray-900">{money(approvedTotal)}</span></p>

        {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {message && <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</div>}

        <div className="overflow-hidden rounded-lg border bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
            <div className="relative w-72">
              <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input placeholder={t("بحث بالاسم أو الرقم الوظيفي")} value={search} onChange={(event) => { setSearch(event.target.value); setSelected(new Set()); }} className="pr-9" />
            </div>
            {canDecide && tab === "pending" && (
              <div className="flex flex-wrap items-center gap-2">
                <Input placeholder={t("ملاحظة القرار (إلزامية عند الرفض)")} value={note} onChange={(event) => setNote(event.target.value)} className="w-72" />
                <button type="button" disabled={!selected.size || busy} onClick={() => void decide("معتمد")}
                  className="flex items-center gap-1 rounded bg-emerald-600 px-3 py-2 text-sm text-white disabled:opacity-50">
                  <CheckCircle2 className="h-4 w-4" />{t("اعتماد المحدد")} ({formatNumber(selected.size)})
                </button>
                <button type="button" disabled={!selected.size || busy} onClick={() => void decide("مرفوض")}
                  className="flex items-center gap-1 rounded bg-red-600 px-3 py-2 text-sm text-white disabled:opacity-50">
                  <XCircle className="h-4 w-4" />{t("رفض المحدد")}
                </button>
                {canDelete && (
                  <button type="button" disabled={!selected.size || busy} onClick={() => void removePending()}
                    className="flex items-center gap-1 rounded border border-red-300 px-3 py-2 text-sm text-red-700 disabled:opacity-50">
                    <Trash2 className="h-4 w-4" />{t("حذف")}
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-right text-sm">
              <thead className="bg-[#004e89] text-white">
                <tr>
                  {canDecide && tab === "pending" && <th className="w-10 px-3 py-3"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label={t("تحديد الكل")} /></th>}
                  <th className="px-3 py-3 font-medium">{t("الرقم الوظيفي")}</th>
                  <th className="px-3 py-3 font-medium">{t("الاسم")}</th>
                  <th className="px-3 py-3 font-medium">{t("الإدارة")}</th>
                  <th className="px-3 py-3 font-medium">{t("التاريخ")}</th>
                  <th className="px-3 py-3 font-medium">{t("الساعات")}</th>
                  <th className="px-3 py-3 font-medium">{t("المبلغ")}</th>
                  <th className="px-3 py-3 font-medium">{t("الحالة")}</th>
                  <th className="px-3 py-3 font-medium">{t("سجّلها")}</th>
                  <th className="px-3 py-3 font-medium">{t("القرار")}</th>
                  <th className="px-3 py-3 font-medium">{t("ملاحظات")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {loading ? (
                  <tr><td colSpan={11} className="py-8 text-center text-gray-400">{t("جاري التحميل...")}</td></tr>
                ) : visible.length === 0 ? (
                  <tr><td colSpan={11} className="py-8 text-center text-gray-400">{t("لا توجد سجلات")}</td></tr>
                ) : visible.map((row) => {
                  const own = isOwn(row);
                  return (
                    <tr key={row.id} className="hover:bg-gray-50/50">
                      {canDecide && tab === "pending" && (
                        <td className="px-3 py-2 text-center">
                          <input type="checkbox" disabled={own} checked={selected.has(row.id)} onChange={() => toggle(row.id)} title={own ? t("لا تعتمد ساعاتك الإضافية") : ""} />
                        </td>
                      )}
                      <td className="px-3 py-2">{row.empId || "—"}</td>
                      <td className="px-3 py-2 font-medium">{row.name || "—"}{own && <span className="ms-2 text-xs text-amber-700">({t("أنت")})</span>}</td>
                      <td className="px-3 py-2">{row.department || "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2">{row.date ? formatDate(row.date) : "—"}</td>
                      <td className="px-3 py-2">{formatNumber(row.hours)}</td>
                      <td className="px-3 py-2">{money(row.amount)}</td>
                      <td className="px-3 py-2">{statusBadge(row.status)}</td>
                      <td className="px-3 py-2">{row.createdBy || "—"}</td>
                      <td className="px-3 py-2">{row.decidedBy ? `${row.decidedBy}${row.decisionNote ? ` — ${row.decisionNote}` : ""}` : "—"}</td>
                      <td className="max-w-48 px-3 py-2 text-gray-600">{row.notes || "—"}</td>
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
