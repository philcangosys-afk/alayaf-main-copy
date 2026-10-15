import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, CheckSquare, Eye, Loader2, Search, X } from "lucide-react";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { riyadhDateString } from "@/lib/utils";
import { fetchControlAccountCodes } from "@/lib/ledgerData";

type Account = { code: string; name_ar: string; parent_code: string | null };
type Candidate = {
  id: string;
  journalId: string;
  date: string;
  referenceType: string;
  description: string;
  debit: number;
  credit: number;
  counterparty: string;
};
type Reclassification = {
  id: string;
  journalEntryId: string;
  sourceCode: string;
  destinationCode: string;
  date: string;
  description: string;
  lineCount: number;
  debit: number;
  credit: number;
  createdAt: string;
};

const amount = (value: unknown) => Number(value ?? 0) || 0;
const today = () => riyadhDateString();
const monthStart = () => `${today().slice(0, 7)}-01`;

export default function BulkReclassification() {
  const { t, direction, formatDate, formatNumber } = useI18n();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [history, setHistory] = useState<Reclassification[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sourceCode, setSourceCode] = useState("");
  const [destinationCode, setDestinationCode] = useState("");
  const [dateFrom, setDateFrom] = useState(monthStart());
  const [dateTo, setDateTo] = useState(today());
  const [entryDate, setEntryDate] = useState(today());
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<Reclassification | null>(null);

  const money = (value: number) => formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const loadBase = async () => {
    setLoading(true);
    const [accountResult, historyResult, controlCodes] = await Promise.all([
      supabase.from("accounting_accounts").select("code, name_ar, parent_code").order("code"),
      supabase.from("accounting_reclassifications").select("id, journal_entry_id, source_account_code, destination_account_code, entry_date, description, selected_line_count, total_debit, total_credit, created_at").order("created_at", { ascending: false }).limit(100),
      fetchControlAccountCodes(),
    ]);
    const firstError = accountResult.error ?? historyResult.error;
    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }
    const allAccounts = (accountResult.data ?? []) as Account[];
    // حسابات الرقابة (الذمم، الموردون، ضريبة المخرجات والمدخلات، المخزون) لا يُعاد تصنيفها يدويًا حتى تبقى مطابقة لمستنداتها.
    setAccounts(allAccounts.filter((account) => !allAccounts.some((child) => child.parent_code === account.code) && !controlCodes.has(account.code)));
    setHistory((historyResult.data ?? []).map((row) => ({
      id: String(row.id), journalEntryId: String(row.journal_entry_id), sourceCode: String(row.source_account_code),
      destinationCode: String(row.destination_account_code), date: String(row.entry_date), description: String(row.description),
      lineCount: Number(row.selected_line_count), debit: amount(row.total_debit), credit: amount(row.total_credit), createdAt: String(row.created_at),
    })));
    setLoading(false);
  };

  useEffect(() => { void loadBase(); }, []);

  const selected = useMemo(() => candidates.filter((line) => selectedIds.has(line.id)), [candidates, selectedIds]);
  const totals = useMemo(() => selected.reduce((sum, line) => ({ debit: sum.debit + line.debit, credit: sum.credit + line.credit }), { debit: 0, credit: 0 }), [selected]);
  const sourceName = accounts.find((account) => account.code === sourceCode)?.name_ar ?? "";
  const destinationName = accounts.find((account) => account.code === destinationCode)?.name_ar ?? "";

  const search = async () => {
    if (!sourceCode || !dateFrom || !dateTo || dateFrom > dateTo) {
      setError(t("اختر حساب المصدر ونطاق تاريخ صحيح"));
      return;
    }
    setSearching(true); setError(""); setSelectedIds(new Set());
    const { data, error: searchError } = await supabase.rpc("list_bulk_reclassification_candidates", {
      p_source_account_code: sourceCode,
      p_date_from: dateFrom,
      p_date_to: dateTo,
    });
    setSearching(false);
    if (searchError) { setError(searchError.message); return; }
    setCandidates((data ?? []).map((row: any) => ({
      id: String(row.id), journalId: String(row.journal_entry_id), date: String(row.entry_date),
      referenceType: String(row.reference_type), description: String(row.description),
      debit: amount(row.debit), credit: amount(row.credit), counterparty: String(row.counterparty ?? ""),
    })));
  };

  const toggle = (id: string) => setSelectedIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleAll = () => setSelectedIds(selectedIds.size === candidates.length
    ? new Set()
    : new Set(candidates.map((line) => line.id)));

  const submit = async () => {
    if (!selected.length || !sourceCode || !destinationCode || sourceCode === destinationCode || !entryDate || !description.trim()) {
      setError(t("اختر الحركات والحساب البديل وأدخل تاريخًا ووصفًا صحيحين"));
      return;
    }
    const message = t(`سيتم إنشاء قيد مرحّل مستقل لنقل ${selected.length} حركة من ${sourceCode} إلى ${destinationCode}. لن تتغير القيود الأصلية. هل تريد المتابعة؟`);
    if (!confirm(message)) return;
    setBusy(true); setError("");
    const { error: rpcError } = await supabase.rpc("create_bulk_reclassification", {
      p_source_line_ids: selected.map((line) => line.id),
      p_destination_account_code: destinationCode,
      p_entry_date: entryDate,
      p_description: description.trim(),
    });
    setBusy(false);
    if (rpcError) { setError(rpcError.message); return; }
    toast({ title: t("تم إنشاء وترحيل قيد إعادة التصنيف") });
    setCandidates([]); setSelectedIds(new Set()); setDestinationCode(""); setDescription("");
    await loadBase();
  };

  return (
    <Layout>
      <main dir={direction} className="space-y-5">
        <header className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3"><div className="rounded-lg bg-indigo-50 p-2 text-indigo-700"><ArrowLeftRight className="h-6 w-6" /></div><div><h1 className="text-2xl font-bold text-slate-900">{t("إعادة التصنيف الجماعي")}</h1><p className="mt-1 text-sm text-slate-500">{t("نقل أثر حركات مرحّلة إلى حساب طرفي آخر بقيد مستقل مع الحفاظ على القيود الأصلية.")}</p></div></div>
        </header>

        {error && <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-bold text-slate-900">{t("1. تحديد الحركات الأصلية")}</h2>
          <div className="grid gap-3 md:grid-cols-4">
            <label className="text-xs text-slate-600">{t("حساب المصدر الطرفي")}<select value={sourceCode} onChange={(event) => { setSourceCode(event.target.value); setCandidates([]); setSelectedIds(new Set()); }} className="mt-1 h-10 w-full rounded border px-2 text-sm"><option value="">{t("اختر الحساب")}</option>{accounts.map((account) => <option key={account.code} value={account.code}>{account.code} — {account.name_ar}</option>)}</select></label>
            <label className="text-xs text-slate-600">{t("من تاريخ")}<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="mt-1 h-10 w-full rounded border px-3 text-sm" /></label>
            <label className="text-xs text-slate-600">{t("إلى تاريخ")}<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="mt-1 h-10 w-full rounded border px-3 text-sm" /></label>
            <button onClick={() => void search()} disabled={searching} className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded bg-indigo-700 px-4 text-sm font-semibold text-white disabled:opacity-50">{searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}{t("عرض الحركات")}</button>
          </div>
        </section>

        {candidates.length > 0 && <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4"><div><h2 className="font-bold">{t("2. معاينة واختيار الحركات")}</h2><p className="text-xs text-slate-500">{t("تظهر أول 500 حركة مرحّلة ضمن النطاق المحدد.")}</p></div><button onClick={toggleAll} className="inline-flex items-center gap-2 rounded border px-3 py-2 text-sm"><CheckSquare className="h-4 w-4" />{t(selectedIds.size === candidates.length ? "إلغاء تحديد الكل" : "تحديد الكل")}</button></div>
          <div className="max-h-[420px] overflow-auto"><table className="min-w-full text-sm"><thead className="sticky top-0 bg-slate-100 text-slate-600"><tr><th className="p-3"></th><th className="p-3">{t("التاريخ")}</th><th className="p-3">{t("نوع المرجع")}</th><th className="p-3">{t("الوصف")}</th><th className="p-3">{t("مدين")}</th><th className="p-3">{t("دائن")}</th><th className="p-3">{t("جهة التعامل")}</th></tr></thead><tbody>{candidates.map((line) => <tr key={line.id} className="border-t"><td className="p-3 text-center"><input type="checkbox" checked={selectedIds.has(line.id)} onChange={() => toggle(line.id)} /></td><td className="p-3 text-center">{formatDate(line.date)}</td><td className="p-3 text-center">{line.referenceType}</td><td className="p-3">{line.description}</td><td className="p-3 text-center">{money(line.debit)}</td><td className="p-3 text-center">{money(line.credit)}</td><td className="p-3">{line.counterparty || "—"}</td></tr>)}</tbody></table></div>
          <div className="border-t bg-slate-50 px-4 py-3 text-sm font-semibold">{t("المحدد")}: {selected.length} | {t("إجمالي المدين")}: {money(totals.debit)} | {t("إجمالي الدائن")}: {money(totals.credit)}</div>
        </section>}

        {selected.length > 0 && <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-bold">{t("3. إنشاء قيد إعادة التصنيف")}</h2>
          <div className="grid gap-3 md:grid-cols-3"><label className="text-xs text-slate-600">{t("الحساب البديل الطرفي")}<select value={destinationCode} onChange={(event) => setDestinationCode(event.target.value)} className="mt-1 h-10 w-full rounded border px-2 text-sm"><option value="">{t("اختر الحساب البديل")}</option>{accounts.filter((account) => account.code !== sourceCode).map((account) => <option key={account.code} value={account.code}>{account.code} — {account.name_ar}</option>)}</select></label><label className="text-xs text-slate-600">{t("تاريخ قيد إعادة التصنيف")}<input type="date" value={entryDate} onChange={(event) => setEntryDate(event.target.value)} className="mt-1 h-10 w-full rounded border px-3 text-sm" /></label><label className="text-xs text-slate-600">{t("وصف القيد")}<input value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1 h-10 w-full rounded border px-3 text-sm" /></label></div>
          <div className="mt-4 rounded-lg border border-indigo-100 bg-indigo-50 p-4 text-sm text-indigo-900"><p className="font-semibold">{t("معاينة القيد الجديد")}</p>{totals.debit > 0 && <p className="mt-2">{t("مدين")}: {destinationCode || "—"} {destinationName} {money(totals.debit)} — {t("دائن")}: {sourceCode} {sourceName} {money(totals.debit)}</p>}{totals.credit > 0 && <p className="mt-1">{t("مدين")}: {sourceCode} {sourceName} {money(totals.credit)} — {t("دائن")}: {destinationCode || "—"} {destinationName} {money(totals.credit)}</p>}<p className="mt-2 text-xs">{t("القيود الأصلية ستبقى دون أي تعديل.")}</p></div>
          <div className="mt-4 flex justify-end"><button onClick={() => void submit()} disabled={busy} className="inline-flex items-center gap-2 rounded bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeftRight className="h-4 w-4" />}{t("إنشاء وترحيل القيد")}</button></div>
        </section>}

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b p-4"><h2 className="font-bold">{t("سجل إعادة التصنيف")}</h2></div><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-100 text-slate-600"><tr><th className="p-3">{t("التاريخ")}</th><th className="p-3">{t("الوصف")}</th><th className="p-3">{t("من حساب")}</th><th className="p-3">{t("إلى حساب")}</th><th className="p-3">{t("الحركات")}</th><th className="p-3">{t("القيمة")}</th><th className="p-3"></th></tr></thead><tbody>{loading ? <tr><td colSpan={7} className="py-12 text-center">{t("جاري التحميل...")}</td></tr> : history.length === 0 ? <tr><td colSpan={7} className="py-12 text-center text-slate-400">{t("لا توجد عمليات إعادة تصنيف")}</td></tr> : history.map((item) => <tr key={item.id} className="border-t"><td className="p-3 text-center">{formatDate(item.date)}</td><td className="p-3">{item.description}</td><td className="p-3 text-center">{item.sourceCode}</td><td className="p-3 text-center">{item.destinationCode}</td><td className="p-3 text-center">{item.lineCount}</td><td className="p-3 text-center">{money(item.debit + item.credit)}</td><td className="p-3 text-center"><button onClick={() => setDetail(item)} className="rounded border p-2" title={t("عرض التفاصيل")}><Eye className="h-4 w-4" /></button></td></tr>)}</tbody></table></div></section>

        {detail && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={() => setDetail(null)}><section className="w-full max-w-xl rounded-xl bg-white p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><div className="flex items-start justify-between"><div><h2 className="font-bold">{detail.description}</h2><p className="mt-1 text-xs text-slate-500">{detail.id}</p></div><button onClick={() => setDetail(null)}><X className="h-5 w-5" /></button></div><dl className="mt-5 grid grid-cols-2 gap-4 text-sm"><div><dt className="text-slate-500">{t("تاريخ القيد")}</dt><dd className="font-semibold">{formatDate(detail.date)}</dd></div><div><dt className="text-slate-500">{t("رقم القيد")}</dt><dd className="break-all font-semibold">{detail.journalEntryId}</dd></div><div><dt className="text-slate-500">{t("حساب المصدر")}</dt><dd className="font-semibold">{detail.sourceCode}</dd></div><div><dt className="text-slate-500">{t("الحساب البديل")}</dt><dd className="font-semibold">{detail.destinationCode}</dd></div><div><dt className="text-slate-500">{t("عدد الحركات الأصلية")}</dt><dd className="font-semibold">{detail.lineCount}</dd></div><div><dt className="text-slate-500">{t("إجمالي الأثر")}</dt><dd className="font-semibold">{money(detail.debit + detail.credit)}</dd></div></dl></section></div>}
      </main>
    </Layout>
  );
}
