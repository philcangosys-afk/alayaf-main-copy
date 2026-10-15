import { useEffect, useMemo, useState } from "react";
import { Edit3, Eye, FilePlus2, Loader2, Save, Send, Trash2, X } from "lucide-react";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { riyadhDateString } from "@/lib/utils";
import { fetchControlAccountCodes } from "@/lib/ledgerData";

type Account = { code: string; name_ar: string; parent_code: string | null };
type JournalLine = { id: string; accountCode: string; accountName: string; debit: number; credit: number; counterparty: string };
type Journal = { id: string; date: string; description: string; status: "draft" | "posted" | "reversed"; createdAt: string; lines: JournalLine[] };
type DraftLine = { id: string; accountCode: string; debit: string; credit: string; counterparty: string };

const emptyLines = (): DraftLine[] => [
  { id: crypto.randomUUID(), accountCode: "", debit: "", credit: "", counterparty: "" },
  { id: crypto.randomUUID(), accountCode: "", debit: "", credit: "", counterparty: "" },
];
const amount = (value: unknown) => Number(value ?? 0) || 0;

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

  const money = (value: number) => formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const load = async () => {
    setLoading(true); setError("");
    const [entryResult, accountResult, controlCodes] = await Promise.all([
      supabase.from("accounting_journal_entries").select("id, entry_date, description, status, created_at").eq("reference_type", "manual_journal").order("entry_date", { ascending: false }).order("created_at", { ascending: false }),
      supabase.from("accounting_accounts").select("code, name_ar, parent_code").order("code"),
      fetchControlAccountCodes(),
    ]);
    const firstError = entryResult.error ?? accountResult.error;
    if (firstError) { setError(firstError.message); setLoading(false); return; }
    const entryRows = entryResult.data ?? [];
    const ids = entryRows.map((entry) => String(entry.id));
    const lineResult = ids.length
      ? await supabase.from("accounting_journal_lines").select("id, journal_entry_id, account_code, account_name, debit, credit, counterparty").in("journal_entry_id", ids).order("created_at")
      : { data: [], error: null };
    if (lineResult.error) { setError(lineResult.error.message); setLoading(false); return; }
    const allAccounts = (accountResult.data ?? []) as Account[];
    const leafAccounts = allAccounts.filter((account) => !allAccounts.some((child) => child.parent_code === account.code));
    // حسابات الرقابة (الذمم، الموردون، ضريبة المخرجات والمدخلات، المخزون) لا تُقيَّد يدويًا؛ تُغذّى من مستنداتها فقط.
    setAccounts(leafAccounts.filter((account) => !controlCodes.has(account.code)));
    setControlAccounts(leafAccounts.filter((account) => controlCodes.has(account.code)));
    setJournals(entryRows.map((entry) => ({
      id: String(entry.id), date: String(entry.entry_date), description: String(entry.description),
      status: entry.status as Journal["status"], createdAt: String(entry.created_at),
      lines: (lineResult.data ?? []).filter((line) => line.journal_entry_id === entry.id).map((line) => ({
        id: String(line.id), accountCode: String(line.account_code), accountName: String(line.account_name),
        debit: amount(line.debit), credit: amount(line.credit), counterparty: String(line.counterparty ?? ""),
      })),
    })));
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

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
    if (saveError) { setError(saveError.message); return; }
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
    if (postError) { toast({ title: t("تعذر ترحيل القيد"), description: postError.message, variant: "destructive" }); return; }
    toast({ title: t("تم ترحيل القيد") }); setSelected(null); await load();
  };

  const remove = async (journal: Journal) => {
    if (journal.status !== "draft" || !confirm(t("هل تريد حذف مسودة القيد؟"))) return;
    setBusy(true);
    const { error: deleteError } = await supabase.rpc("delete_manual_journal", { p_entry_id: journal.id });
    setBusy(false);
    if (deleteError) { toast({ title: t("تعذر حذف المسودة"), description: deleteError.message, variant: "destructive" }); return; }
    toast({ title: t("تم حذف المسودة") }); setSelected(null); await load();
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

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-100 text-slate-600"><tr><th className="px-3 py-3">{t("التاريخ")}</th><th className="px-3 py-3">{t("الوصف")}</th><th className="px-3 py-3">{t("الحالة")}</th><th className="px-3 py-3">{t("المدين")}</th><th className="px-3 py-3">{t("الدائن")}</th><th className="px-3 py-3">{t("الإجراءات")}</th></tr></thead><tbody>{loading ? <tr><td colSpan={6} className="py-16 text-center">{t("جاري التحميل...")}</td></tr> : journals.length === 0 ? <tr><td colSpan={6} className="py-16 text-center text-slate-400">{t("لا توجد قيود يدوية")}</td></tr> : journals.map((journal) => { const debit = journal.lines.reduce((sum, line) => sum + line.debit, 0); const credit = journal.lines.reduce((sum, line) => sum + line.credit, 0); return <tr key={journal.id} className="border-t"><td className="px-3 py-3 text-center">{formatDate(journal.date)}</td><td className="px-3 py-3">{journal.description}</td><td className="px-3 py-3 text-center"><span className={`rounded px-2 py-1 text-xs font-semibold ${journal.status === "posted" ? "bg-emerald-50 text-emerald-700" : journal.status === "draft" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{t(journal.status === "posted" ? "مرحّل" : journal.status === "draft" ? "مسودة" : "معكوس")}</span></td><td className="px-3 py-3 text-center">{money(debit)}</td><td className="px-3 py-3 text-center">{money(credit)}</td><td className="px-3 py-3"><div className="flex justify-center gap-1"><button onClick={() => setSelected(journal)} className="rounded border p-2" title={t("عرض")}><Eye className="h-4 w-4" /></button>{journal.status === "draft" && <><button onClick={() => startEdit(journal)} className="rounded border p-2 text-blue-700" title={t("تعديل")}><Edit3 className="h-4 w-4" /></button><button disabled={busy || Math.round(debit * 100) !== Math.round(credit * 100) || debit <= 0} onClick={() => void post(journal)} className="rounded border p-2 text-emerald-700 disabled:opacity-30" title={t("ترحيل")}><Send className="h-4 w-4" /></button><button onClick={() => void remove(journal)} className="rounded border p-2 text-red-600" title={t("حذف")}><Trash2 className="h-4 w-4" /></button></>}</div></td></tr>; })}</tbody></table></div></section>

        {selected && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={() => setSelected(null)}><section className="max-h-[85vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-white p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><div className="mb-4 flex items-center justify-between"><div><h2 className="font-bold">{selected.description}</h2><p className="text-xs text-slate-500">{selected.id} — {selected.date}</p></div><button onClick={() => setSelected(null)}><X className="h-5 w-5" /></button></div><table className="min-w-full text-sm"><thead className="bg-slate-100"><tr><th className="p-2">{t("الحساب")}</th><th className="p-2">{t("مدين")}</th><th className="p-2">{t("دائن")}</th><th className="p-2">{t("جهة التعامل")}</th></tr></thead><tbody>{selected.lines.map((line) => <tr key={line.id} className="border-b"><td className="p-2">{line.accountCode} — {line.accountName}</td><td className="p-2 text-center">{money(line.debit)}</td><td className="p-2 text-center">{money(line.credit)}</td><td className="p-2">{line.counterparty || "—"}</td></tr>)}</tbody></table>{selected.status === "draft" && <div className="mt-4 flex justify-end gap-2"><button onClick={() => startEdit(selected)} className="rounded border px-4 py-2 text-sm">{t("تعديل المسودة")}</button><button onClick={() => void post(selected)} className="rounded bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">{t("ترحيل القيد")}</button></div>}</section></div>}
      </main>
    </Layout>
  );
}
