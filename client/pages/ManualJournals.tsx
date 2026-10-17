import { useEffect, useMemo, useState } from "react";
import { Edit3, Eye, FilePlus2, Loader2, RotateCcw, Save, Send, Trash2, X } from "lucide-react";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { riyadhDateString } from "@/lib/utils";
import { fetchControlAccountCodes, selectAllRows } from "@/lib/ledgerData";
import { accountingErrorText } from "@/lib/accountingErrors";

type Account = { code: string; name_ar: string; parent_code: string | null };
type JournalLine = { id: string; accountCode: string; accountName: string; debit: number; credit: number; counterparty: string };
// kind: manual = قيد يدوي، reversal = قيد عكسي مستقل أنشأه reverse_manual_journal (originalId = القيد الأصلي).
// entryNumber: رقم القيد المقروء (1001-JE-000007) يُعطى عند الترحيل؛ المسودة بلا رقم.
type Journal = { id: string; entryNumber: string | null; kind: "manual" | "reversal"; originalId: string | null; date: string; description: string; status: "draft" | "posted" | "reversed"; createdAt: string; lines: JournalLine[] };
type DraftLine = { id: string; accountCode: string; debit: string; credit: string; counterparty: string };

const emptyLines = (): DraftLine[] => [
  { id: crypto.randomUUID(), accountCode: "", debit: "", credit: "", counterparty: "" },
  { id: crypto.randomUUID(), accountCode: "", debit: "", credit: "", counterparty: "" },
];
const amount = (value: unknown) => Number(value ?? 0) || 0;
const ID_CHUNK = 150;

export default function ManualJournals() {
  const { t, direction, formatNumber, formatDate } = useI18n();
  const [journals, setJournals] = useState<Journal[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [controlAccounts, setControlAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Journal | null>(null);
  const [editingId, setEditingId] = useState<string | null | undefined>(undefined);
  const [date, setDate] = useState(() => riyadhDateString());
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<DraftLine[]>(emptyLines);
  const [reversing, setReversing] = useState<Journal | null>(null);
  const [reversalDate, setReversalDate] = useState("");
  const [reversalMaxDate, setReversalMaxDate] = useState("");
  const [reversalReason, setReversalReason] = useState("");
  const [reversalError, setReversalError] = useState("");

  // Math.abs(...) < 0.005 يمنع ظهور "-0.00"
  const money = (value: number) => formatNumber(Math.abs(value) < 0.005 ? 0 : value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const load = async () => {
    setLoading(true); setError("");
    // القيود اليدوية وقيودها العكسية (قيد مرحّل مستقل مرجعه manual_journal_reversal و source_document_id = معرّف الأصل)
    const [entryResult, accountResult, controlCodes] = await Promise.all([
      selectAllRows((from, to) => supabase.from("accounting_journal_entries").select("id, entry_number, entry_date, description, status, created_at, reference_type, source_document_id").in("reference_type", ["manual_journal", "manual_journal_reversal"]).order("entry_date", { ascending: false }).order("created_at", { ascending: false }).order("id").range(from, to)),
      supabase.from("accounting_accounts").select("code, name_ar, parent_code").order("code"),
      fetchControlAccountCodes(),
    ]);
    const firstError = entryResult.error ?? accountResult.error;
    if (firstError) { setError(accountingErrorText(firstError.message, t)); setLoading(false); return; }
    const entryRows = entryResult.data ?? [];
    const ids = entryRows.map((entry) => String(entry.id));
    // الأسطر على دفعات من المعرّفات وبترقيم صفحات حتى لا يطول الرابط ولا تُقطع النتائج بصمت.
    const lineRows: any[] = [];
    for (let index = 0; index < ids.length; index += ID_CHUNK) {
      const chunk = ids.slice(index, index + ID_CHUNK);
      const lineResult = await selectAllRows((from, to) => supabase.from("accounting_journal_lines").select("id, journal_entry_id, account_code, account_name, debit, credit, counterparty, created_at").in("journal_entry_id", chunk).order("created_at").order("id").range(from, to));
      if (lineResult.error) { setError(accountingErrorText(lineResult.error.message, t)); setLoading(false); return; }
      lineRows.push(...lineResult.data);
    }
    const allAccounts = (accountResult.data ?? []) as Account[];
    const leafAccounts = allAccounts.filter((account) => !allAccounts.some((child) => child.parent_code === account.code));
    // حسابات الرقابة (الذمم، الموردون، ضريبة المخرجات والمدخلات، المخزون) لا تُقيَّد يدويًا؛ تُغذّى من مستنداتها فقط.
    setAccounts(leafAccounts.filter((account) => !controlCodes.has(account.code)));
    setControlAccounts(leafAccounts.filter((account) => controlCodes.has(account.code)));
    const linesByEntry = new Map<string, any[]>();
    lineRows.forEach((line) => { const key = String(line.journal_entry_id); linesByEntry.set(key, [...(linesByEntry.get(key) ?? []), line]); });
    setJournals(entryRows.map((entry) => ({
      id: String(entry.id), entryNumber: entry.entry_number ? String(entry.entry_number) : null,
      kind: entry.reference_type === "manual_journal_reversal" ? "reversal" as const : "manual" as const,
      originalId: entry.reference_type === "manual_journal_reversal" && entry.source_document_id ? String(entry.source_document_id) : null,
      date: String(entry.entry_date), description: String(entry.description ?? ""),
      status: entry.status as Journal["status"], createdAt: String(entry.created_at),
      lines: (linesByEntry.get(String(entry.id)) ?? []).map((line) => ({
        id: String(line.id), accountCode: String(line.account_code), accountName: String(line.account_name),
        debit: amount(line.debit), credit: amount(line.credit), counterparty: String(line.counterparty ?? ""),
      })),
    })));
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const journalById = useMemo(() => new Map(journals.map((journal) => [journal.id, journal])), [journals]);
  const reversalByOriginal = useMemo(() => {
    const result = new Map<string, Journal>();
    journals.forEach((journal) => { if (journal.kind === "reversal" && journal.originalId) result.set(journal.originalId, journal); });
    return result;
  }, [journals]);
  // القيد العكسي يظهر مباشرة تحت قيده الأصلي؛ وإن لم يُحمَّل الأصل يظهر في موضع تاريخه.
  const displayJournals = useMemo(() => {
    const result: Journal[] = [];
    journals.forEach((journal) => {
      if (journal.kind === "reversal" && journal.originalId && journalById.has(journal.originalId)) return;
      result.push(journal);
      const reversal = reversalByOriginal.get(journal.id);
      if (reversal) result.push(reversal);
    });
    return result;
  }, [journals, journalById, reversalByOriginal]);
  const isReversed = (journal: Journal) => journal.kind === "manual" && (journal.status === "reversed" || reversalByOriginal.has(journal.id));
  const canReverse = (journal: Journal) => journal.kind === "manual" && journal.status === "posted" && !reversalByOriginal.has(journal.id);

  const totals = useMemo(() => lines.reduce((sum, line) => ({ debit: sum.debit + amount(line.debit), credit: sum.credit + amount(line.credit) }), { debit: 0, credit: 0 }), [lines]);
  const balanced = totals.debit > 0 && Math.round(totals.debit * 100) === Math.round(totals.credit * 100);
  const updateLine = (id: string, changes: Partial<DraftLine>) => setLines((current) => current.map((line) => line.id === id ? { ...line, ...changes } : line));

  const controlCodeSet = useMemo(() => new Set(controlAccounts.map((account) => account.code)), [controlAccounts]);
  const usesControlAccount = (codes: string[]) => codes.some((code) => controlCodeSet.has(code));

  const startCreate = () => { setEditingId(null); setDate(riyadhDateString()); setDescription(""); setLines(emptyLines()); setSelected(null); setError(""); };
  const startEdit = (journal: Journal) => {
    if (journal.status !== "draft") return;
    setEditingId(journal.id); setDate(journal.date); setDescription(journal.description);
    setLines(journal.lines.map((line) => ({ id: line.id, accountCode: line.accountCode, debit: line.debit ? String(line.debit) : "", credit: line.credit ? String(line.credit) : "", counterparty: line.counterparty })));
    setSelected(null); setError("");
  };
  const closeForm = () => { setEditingId(undefined); setError(""); };

  const saveDraft = async () => {
    if (!date || !description.trim() || lines.length < 2 || lines.some((line) => !line.accountCode || ((amount(line.debit) > 0 ? 1 : 0) + (amount(line.credit) > 0 ? 1 : 0) !== 1))) {
      setError(t("أدخل التاريخ والوصف وحسابًا وطرفًا واحدًا مدينًا أو دائنًا لكل سطر")); return;
    }
    if (usesControlAccount(lines.map((line) => line.accountCode))) {
      setError(t("لا يمكن استخدام حسابات الرقابة (العملاء، الموردين، ضريبة القيمة المضافة، المخزون) في قيد يدوي؛ استخدم المستند الخاص بها مثل الفاتورة أو الإشعار أو السداد.")); return;
    }
    setBusy(true); setError("");
    const { error: saveError } = await supabase.rpc("save_manual_journal", {
      p_entry_id: editingId || null,
      p_journal: { date, description: description.trim(), lines: lines.map((line) => ({ accountCode: line.accountCode, debit: amount(line.debit), credit: amount(line.credit), counterparty: line.counterparty.trim() })) },
    });
    setBusy(false);
    if (saveError) { setError(accountingErrorText(saveError.message, t)); return; }
    toast({ title: t("تم حفظ القيد كمسودة") }); closeForm(); await load();
  };

  const post = async (journal: Journal) => {
    if (usesControlAccount(journal.lines.map((line) => line.accountCode))) {
      toast({ title: t("تعذر ترحيل القيد"), description: t("لا يمكن استخدام حسابات الرقابة (العملاء، الموردين، ضريبة القيمة المضافة، المخزون) في قيد يدوي؛ استخدم المستند الخاص بها مثل الفاتورة أو الإشعار أو السداد."), variant: "destructive" });
      return;
    }
    if (!confirm(t("سيؤثر ترحيل القيد على التقارير المالية ولا يمكن تعديله بعد ذلك. هل تريد المتابعة؟"))) return;
    setBusy(true);
    const { error: postError } = await supabase.rpc("post_manual_journal", { p_entry_id: journal.id });
    setBusy(false);
    if (postError) { toast({ title: t("تعذر ترحيل القيد"), description: accountingErrorText(postError.message, t), variant: "destructive" }); return; }
    toast({ title: t("تم ترحيل القيد") }); setSelected(null); await load();
  };

  const remove = async (journal: Journal) => {
    if (journal.status !== "draft" || !confirm(t("هل تريد حذف مسودة القيد؟"))) return;
    setBusy(true);
    const { error: deleteError } = await supabase.rpc("delete_manual_journal", { p_entry_id: journal.id });
    setBusy(false);
    if (deleteError) { toast({ title: t("تعذر حذف المسودة"), description: accountingErrorText(deleteError.message, t), variant: "destructive" }); return; }
    toast({ title: t("تم حذف المسودة") }); setSelected(null); await load();
  };

  const openReverse = (journal: Journal) => {
    if (!canReverse(journal)) return;
    const today = riyadhDateString();
    setReversing(journal); setReversalMaxDate(today); setReversalDate(today); setReversalReason(""); setReversalError(""); setSelected(null);
  };
  const closeReverse = () => { if (!busy) { setReversing(null); setReversalError(""); } };

  const submitReverse = async () => {
    if (!reversing) return;
    const reason = reversalReason.trim();
    if (!reason) { setReversalError(t("اكتب سبب عكس القيد.")); return; }
    if (!reversalDate || reversalDate < reversing.date || reversalDate > reversalMaxDate) { setReversalError(t("تاريخ العكس بين تاريخ القيد واليوم.")); return; }
    setBusy(true); setReversalError("");
    const { data: reversalId, error: reverseError } = await supabase.rpc("reverse_manual_journal", { p_entry_id: reversing.id, p_reversal_date: reversalDate, p_reason: reason });
    if (reverseError) { setBusy(false); setReversalError(accountingErrorText(reverseError.message, t)); return; }
    const { data: created } = reversalId
      ? await supabase.from("accounting_journal_entries").select("entry_number").eq("id", String(reversalId)).maybeSingle()
      : { data: null };
    setBusy(false);
    toast({ title: t("تم عكس القيد"), description: created?.entry_number ? `${t("رقم القيد العكسي")}: ${created.entry_number}` : undefined });
    setReversing(null); setSelected(null); await load();
  };

  return (
    <Layout>
      <main dir={direction} className="space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div><h1 className="text-2xl font-bold text-slate-900">{t("القيود اليدوية")}</h1><p className="mt-1 text-sm text-slate-500">{t("إنشاء قيود محاسبية متوازنة وحفظها كمسودة قبل الترحيل النهائي.")}</p></div>
          <button onClick={startCreate} className="inline-flex items-center gap-2 rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white"><FilePlus2 className="h-4 w-4" />{t("قيد يدوي جديد")}</button>
        </header>

        {error && <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        {editingId !== undefined && <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between"><h2 className="font-bold">{t(editingId ? "تعديل مسودة القيد" : "قيد يدوي جديد")}</h2><button onClick={closeForm}><X className="h-5 w-5" /></button></div>
          <div className="mb-4 grid gap-3 md:grid-cols-[220px_1fr]"><label className="text-xs text-slate-600">{t("تاريخ القيد")}<input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 block h-10 w-full rounded border px-3 text-sm" /></label><label className="text-xs text-slate-600">{t("وصف القيد")}<input value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1 block h-10 w-full rounded border px-3 text-sm" /></label></div>
          <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-100"><tr><th className="px-2 py-2">{t("الحساب")}</th><th className="px-2 py-2">{t("مدين")}</th><th className="px-2 py-2">{t("دائن")}</th><th className="px-2 py-2">{t("جهة التعامل")}</th><th /></tr></thead><tbody>{lines.map((line) => <tr key={line.id} className="border-b"><td className="p-2"><select value={line.accountCode} onChange={(event) => updateLine(line.id, { accountCode: event.target.value })} className="h-10 min-w-64 w-full rounded border px-2"><option value="">{t("اختر حسابًا طرفيًا")}</option>{accounts.map((account) => <option key={account.code} value={account.code}>{account.code} — {account.name_ar}</option>)}{controlCodeSet.has(line.accountCode) && <option value={line.accountCode} disabled>{line.accountCode} — {t("حساب رقابة غير مسموح")}</option>}</select></td><td className="p-2"><input type="number" min="0" step="0.01" value={line.debit} onChange={(event) => updateLine(line.id, { debit: event.target.value, ...(amount(event.target.value) > 0 ? { credit: "" } : {}) })} className="h-10 w-32 rounded border px-2" /></td><td className="p-2"><input type="number" min="0" step="0.01" value={line.credit} onChange={(event) => updateLine(line.id, { credit: event.target.value, ...(amount(event.target.value) > 0 ? { debit: "" } : {}) })} className="h-10 w-32 rounded border px-2" /></td><td className="p-2"><input value={line.counterparty} onChange={(event) => updateLine(line.id, { counterparty: event.target.value })} className="h-10 w-48 rounded border px-2" /></td><td className="p-2"><button disabled={lines.length <= 2} onClick={() => setLines((current) => current.filter((item) => item.id !== line.id))} className="text-red-600 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button></td></tr>)}</tbody></table></div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><button onClick={() => setLines((current) => [...current, ...emptyLines().slice(0, 1)])} className="rounded border px-3 py-2 text-sm">{t("إضافة سطر")}</button>{controlAccounts.length > 0 && <p className="w-full text-xs text-slate-500 md:order-last">{t("حسابات الرقابة غير متاحة في القيود اليدوية")}: {controlAccounts.map((account) => `${account.code} ${account.name_ar}`).join("، ")}</p>}<div className={`rounded px-4 py-2 text-sm font-semibold ${balanced ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{t("إجمالي المدين")}: {money(totals.debit)} | {t("إجمالي الدائن")}: {money(totals.credit)} | {t(balanced ? "متوازن" : "غير متوازن")}</div><button disabled={busy} onClick={saveDraft} className="inline-flex items-center gap-2 rounded bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{t("حفظ المسودة")}</button></div>
        </section>}

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-100 text-slate-600"><tr><th className="px-3 py-3">{t("رقم القيد")}</th><th className="px-3 py-3">{t("التاريخ")}</th><th className="px-3 py-3">{t("الوصف")}</th><th className="px-3 py-3">{t("الحالة")}</th><th className="px-3 py-3">{t("المدين")}</th><th className="px-3 py-3">{t("الدائن")}</th><th className="px-3 py-3">{t("الإجراءات")}</th></tr></thead><tbody>{loading ? <tr><td colSpan={7} className="py-16 text-center">{t("جاري التحميل...")}</td></tr> : displayJournals.length === 0 ? <tr><td colSpan={7} className="py-16 text-center text-slate-400">{t("لا توجد قيود يدوية")}</td></tr> : displayJournals.map((journal) => {
          const debit = journal.lines.reduce((sum, line) => sum + line.debit, 0);
          const credit = journal.lines.reduce((sum, line) => sum + line.credit, 0);
          const reversed = isReversed(journal);
          const reversal = reversalByOriginal.get(journal.id);
          const original = journal.originalId ? journalById.get(journal.originalId) : undefined;
          const badge = journal.status === "draft" ? { text: "مسودة", className: "bg-amber-50 text-amber-700" }
            : journal.kind === "reversal" ? { text: "قيد عكسي", className: "bg-rose-50 text-rose-700" }
            : reversed ? { text: "معكوس", className: "bg-slate-100 text-slate-600" }
            : { text: "مرحّل", className: "bg-emerald-50 text-emerald-700" };
          return <tr key={journal.id} className={`border-t ${journal.kind === "reversal" ? "bg-rose-50/40" : ""}`}>
            <td className="whitespace-nowrap px-3 py-3 text-center">{journal.status === "draft" ? <span className="text-xs text-slate-400">{t("مسودة")}</span> : <span dir="ltr" className="font-mono text-xs font-semibold text-slate-700">{journal.entryNumber ?? "—"}</span>}</td>
            <td className="px-3 py-3 text-center">{formatDate(journal.date)}</td>
            <td className="px-3 py-3">{journal.description}</td>
            <td className="px-3 py-3 text-center"><span className={`rounded px-2 py-1 text-xs font-semibold ${badge.className}`}>{t(badge.text)}</span>{journal.kind === "reversal" && <div className="mt-1 text-[11px] text-slate-500">{t("عكس القيد")} <span dir="ltr" className="font-mono">{original?.entryNumber ?? "—"}</span></div>}{reversed && reversal && <div className="mt-1 text-[11px] text-slate-500">{t("بالقيد العكسي")} <span dir="ltr" className="font-mono">{reversal.entryNumber ?? "—"}</span></div>}</td>
            <td className="px-3 py-3 text-center">{money(debit)}</td>
            <td className="px-3 py-3 text-center">{money(credit)}</td>
            <td className="px-3 py-3"><div className="flex justify-center gap-1"><button onClick={() => setSelected(journal)} className="rounded border p-2" title={t("عرض")}><Eye className="h-4 w-4" /></button>{journal.status === "draft" && <><button onClick={() => startEdit(journal)} className="rounded border p-2 text-blue-700" title={t("تعديل")}><Edit3 className="h-4 w-4" /></button><button disabled={busy || Math.round(debit * 100) !== Math.round(credit * 100) || debit <= 0} onClick={() => void post(journal)} className="rounded border p-2 text-emerald-700 disabled:opacity-30" title={t("ترحيل")}><Send className="h-4 w-4" /></button><button onClick={() => void remove(journal)} className="rounded border p-2 text-red-600" title={t("حذف")}><Trash2 className="h-4 w-4" /></button></>}{canReverse(journal) && <button disabled={busy} onClick={() => openReverse(journal)} className="rounded border p-2 text-rose-700 disabled:opacity-30" title={t("عكس القيد")}><RotateCcw className="h-4 w-4" /></button>}</div></td>
          </tr>;
        })}</tbody></table></div></section>

        {selected && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={() => setSelected(null)}><section className="max-h-[85vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-white p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><div className="mb-4 flex items-center justify-between"><div><h2 className="font-bold">{selected.description}</h2><p className="text-xs text-slate-500">{selected.status === "draft" ? t("مسودة") : <span dir="ltr" className="font-mono">{selected.entryNumber ?? "—"}</span>} — {formatDate(selected.date)}</p>{selected.kind === "reversal" && <p className="mt-1 text-xs font-semibold text-rose-700">{t("قيد عكسي للقيد")} <span dir="ltr" className="font-mono">{(selected.originalId && journalById.get(selected.originalId)?.entryNumber) || "—"}</span></p>}{isReversed(selected) && reversalByOriginal.get(selected.id) && <p className="mt-1 text-xs font-semibold text-slate-600">{t("معكوس بالقيد")} <span dir="ltr" className="font-mono">{reversalByOriginal.get(selected.id)?.entryNumber ?? "—"}</span> — {formatDate(reversalByOriginal.get(selected.id)?.date ?? selected.date)}</p>}</div><button onClick={() => setSelected(null)}><X className="h-5 w-5" /></button></div><table className="min-w-full text-sm"><thead className="bg-slate-100"><tr><th className="p-2">{t("الحساب")}</th><th className="p-2">{t("مدين")}</th><th className="p-2">{t("دائن")}</th><th className="p-2">{t("جهة التعامل")}</th></tr></thead><tbody>{selected.lines.map((line) => <tr key={line.id} className="border-b"><td className="p-2">{line.accountCode} — {line.accountName}</td><td className="p-2 text-center">{money(line.debit)}</td><td className="p-2 text-center">{money(line.credit)}</td><td className="p-2">{line.counterparty || "—"}</td></tr>)}</tbody></table>{selected.status === "draft" && <div className="mt-4 flex justify-end gap-2"><button onClick={() => startEdit(selected)} className="rounded border px-4 py-2 text-sm">{t("تعديل المسودة")}</button><button onClick={() => void post(selected)} className="rounded bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">{t("ترحيل القيد")}</button></div>}{canReverse(selected) && <div className="mt-4 flex justify-end"><button disabled={busy} onClick={() => openReverse(selected)} className="inline-flex items-center gap-2 rounded bg-rose-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><RotateCcw className="h-4 w-4" />{t("عكس القيد")}</button></div>}</section></div>}

        {reversing && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={closeReverse}><section className="w-full max-w-lg rounded-xl bg-white p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
          <div className="mb-4 flex items-start justify-between gap-3"><div><h2 className="font-bold">{t("عكس القيد")} <span dir="ltr" className="font-mono">{reversing.entryNumber ?? ""}</span></h2><p className="mt-1 text-xs text-slate-500">{reversing.description} — {formatDate(reversing.date)}</p></div><button onClick={closeReverse}><X className="h-5 w-5" /></button></div>
          <p className="mb-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-6 text-amber-800">{t("سيُنشأ قيد عكسي مرحّل مستقل يعكس المدين والدائن لكل سطر، ويبقى القيد الأصلي كما هو. لا يمكن عكس القيد أكثر من مرة.")}</p>
          <div className="grid gap-3">
            <label className="text-xs text-slate-600">{t("تاريخ العكس")}<input type="date" value={reversalDate} min={reversing.date} max={reversalMaxDate} onChange={(event) => setReversalDate(event.target.value)} className="mt-1 block h-10 w-full rounded border px-3 text-sm" /></label>
            <label className="text-xs text-slate-600">{t("سبب العكس")} <span className="text-red-600">*</span><textarea value={reversalReason} onChange={(event) => setReversalReason(event.target.value)} rows={3} className="mt-1 block w-full rounded border px-3 py-2 text-sm" /></label>
          </div>
          {reversalError && <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{reversalError}</div>}
          <div className="mt-5 flex justify-end gap-2"><button disabled={busy} onClick={closeReverse} className="rounded border px-4 py-2 text-sm disabled:opacity-50">{t("إلغاء")}</button><button disabled={busy || !reversalReason.trim()} onClick={() => void submitReverse()} className="inline-flex items-center gap-2 rounded bg-rose-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}{t("تأكيد العكس")}</button></div>
        </section></div>}
      </main>
    </Layout>
  );
}
