import { CheckCircle2, EllipsisVertical, FileUp, Landmark, Link2, RefreshCw, Unlink, WalletCards, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import { supabase } from "@/lib/supabaseClient";

type BankAccount = { id: string; name: string; bank_name: string | null; iban: string | null; account_code: string; currency: string; active: boolean };
type ImportRow = { id: string; bank_account_id: string; file_name: string; statement_from: string; statement_to: string; opening_balance: number | null; closing_balance: number | null; status: string; created_at: string };
type StatementLine = { id: string; import_id: string; bank_account_id: string; transaction_date: string; reference: string | null; description: string; debit: number; credit: number; running_balance: number | null; amount: number; reconciliation_status: string; matched_journal_entry_id: string | null };
type Candidate = { journal_entry_id: string; entry_date: string; reference: string; description: string; ledger_amount: number };
type LedgerBalance = { account_code: string; ledger_balance: number };
type ParsedLine = { date: string; valueDate: string; reference: string; description: string; debit: number; credit: number; balance: number | null };

const numeric = (value: unknown) => Number(String(value ?? "").replace(/,/g, "").trim()) || 0;
const normalizeHeader = (value: string) => value.trim().toLowerCase().replace(/\s+/g, "_");

function parseCsvRow(row: string) {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < row.length; index += 1) {
    const character = row[index];
    if (character === '"' && row[index + 1] === '"' && quoted) { value += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { values.push(value.trim()); value = ""; }
    else value += character;
  }
  values.push(value.trim());
  return values;
}

function parseStatementCsv(text: string): ParsedLine[] {
  const rows = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((row) => row.trim());
  if (rows.length < 2) throw new Error("BANK_STATEMENT_CSV_EMPTY");
  const headers = parseCsvRow(rows[0]).map(normalizeHeader);
  const indexOf = (...names: string[]) => headers.findIndex((header) => names.includes(header));
  const dateIndex = indexOf("date", "transaction_date", "التاريخ");
  const valueDateIndex = indexOf("value_date", "تاريخ_القيمة");
  const referenceIndex = indexOf("reference", "ref", "المرجع");
  const descriptionIndex = indexOf("description", "details", "البيان", "الوصف");
  const debitIndex = indexOf("debit", "مدين", "سحب");
  const creditIndex = indexOf("credit", "دائن", "إيداع");
  const amountIndex = indexOf("amount", "المبلغ");
  const balanceIndex = indexOf("balance", "الرصيد");
  if (dateIndex < 0 || (debitIndex < 0 && creditIndex < 0 && amountIndex < 0)) throw new Error("BANK_STATEMENT_COLUMNS_INVALID");

  return rows.slice(1).map((row) => {
    const cells = parseCsvRow(row);
    const signedAmount = amountIndex >= 0 ? numeric(cells[amountIndex]) : 0;
    const debit = debitIndex >= 0 ? numeric(cells[debitIndex]) : signedAmount < 0 ? Math.abs(signedAmount) : 0;
    const credit = creditIndex >= 0 ? numeric(cells[creditIndex]) : signedAmount > 0 ? signedAmount : 0;
    if (!cells[dateIndex] || !((debit > 0 && credit === 0) || (credit > 0 && debit === 0))) throw new Error("BANK_STATEMENT_ROW_INVALID");
    return { date: cells[dateIndex], valueDate: valueDateIndex >= 0 ? cells[valueDateIndex] ?? "" : "", reference: referenceIndex >= 0 ? cells[referenceIndex] ?? "" : "", description: descriptionIndex >= 0 ? cells[descriptionIndex] ?? "" : "", debit, credit, balance: balanceIndex >= 0 && cells[balanceIndex] ? numeric(cells[balanceIndex]) : null };
  });
}

export default function BankAccounts() {
  const { t, direction, formatNumber } = useI18n();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [lines, setLines] = useState<StatementLine[]>([]);
  const [ledgerBalances, setLedgerBalances] = useState<Record<string, number>>({});
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [importAccountId, setImportAccountId] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [statementFrom, setStatementFrom] = useState("");
  const [statementTo, setStatementTo] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");
  const [closingBalance, setClosingBalance] = useState("");
  const [matchingLine, setMatchingLine] = useState<StatementLine | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const candidateRequest = useRef(0);
  const money = (value: number) => formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const load = async () => {
    setLoading(true); setError("");
    const [accountResult, importResult, lineResult, balanceResult] = await Promise.all([
      supabase.from("accounting_bank_accounts").select("id, name, bank_name, iban, account_code, currency, active").eq("active", true).order("name"),
      supabase.from("accounting_bank_statement_imports").select("*").order("statement_to", { ascending: false }).order("created_at", { ascending: false }),
      supabase.from("accounting_bank_statement_lines").select("*").order("transaction_date", { ascending: false }).order("id"),
      supabase.rpc("get_accounting_bank_ledger_balances"),
    ]);
    const firstError = accountResult.error ?? importResult.error ?? lineResult.error ?? balanceResult.error;
    if (firstError) { setError(firstError.message); setLoading(false); return; }
    const bankAccounts = (accountResult.data ?? []) as BankAccount[];
    const balances: Record<string, number> = {};
    ((balanceResult.data ?? []) as LedgerBalance[]).forEach((row) => { balances[String(row.account_code)] = numeric(row.ledger_balance); });
    setAccounts(bankAccounts);
    setImports((importResult.data ?? []) as ImportRow[]);
    setLines((lineResult.data ?? []) as StatementLine[]);
    setLedgerBalances(balances);
    if (!selectedAccountId && bankAccounts[0]) setSelectedAccountId(bankAccounts[0].id);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const latestImportByAccount = useMemo(() => {
    const result = new Map<string, ImportRow>();
    imports.forEach((item) => { if (!result.has(item.bank_account_id)) result.set(item.bank_account_id, item); });
    return result;
  }, [imports]);
  const selectedLines = lines.filter((line) => line.bank_account_id === selectedAccountId);

  const openImport = (account: BankAccount) => {
    setImportAccountId(account.id); setFile(null); setOpeningBalance(""); setClosingBalance(""); setStatementFrom(""); setStatementTo(""); setError(""); setShowImport(true);
  };

  const importStatement = async () => {
    if (!file || !importAccountId || !statementFrom || !statementTo) { setError(t("اختر الحساب والملف والفترة")); return; }
    setSaving(true); setError("");
    try {
      const parsed = parseStatementCsv(await file.text());
      const { error: importError } = await supabase.rpc("import_accounting_bank_statement", { p_bank_account_id: importAccountId, p_file_name: file.name, p_statement_from: statementFrom, p_statement_to: statementTo, p_opening_balance: openingBalance === "" ? null : numeric(openingBalance), p_closing_balance: closingBalance === "" ? null : numeric(closingBalance), p_lines: parsed });
      if (importError) throw importError;
      setShowImport(false); setSelectedAccountId(importAccountId); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : t("تعذر استيراد كشف الحساب")); }
    finally { setSaving(false); }
  };

  const openCandidates = async (line: StatementLine) => {
    const requestId = candidateRequest.current + 1;
    candidateRequest.current = requestId;
    setMatchingLine(line); setCandidates([]); setError("");
    const { data, error: candidateError } = await supabase.rpc("get_bank_reconciliation_candidates", { p_line_id: line.id });
    if (candidateRequest.current !== requestId) return;
    if (candidateError) { setError(candidateError.message); return; }
    setCandidates((data ?? []) as Candidate[]);
  };

  const closeMatching = () => {
    candidateRequest.current += 1;
    setMatchingLine(null);
  };

  const match = async (candidate: Candidate) => {
    if (!matchingLine) return;
    setSaving(true);
    const { error: matchError } = await supabase.rpc("match_bank_statement_line", { p_line_id: matchingLine.id, p_journal_entry_id: candidate.journal_entry_id, p_note: null });
    setSaving(false);
    if (matchError) { setError(matchError.message); return; }
    closeMatching(); await load();
  };

  const unmatch = async (line: StatementLine) => {
    setSaving(true);
    const { error: unmatchError } = await supabase.rpc("unmatch_bank_statement_line", { p_line_id: line.id });
    setSaving(false);
    if (unmatchError) { setError(unmatchError.message); return; }
    await load();
  };

  return <Layout><main dir={direction} className="min-h-full bg-slate-50 p-4"><div className="mx-auto max-w-7xl overflow-hidden rounded border border-slate-200 bg-white shadow-sm">
    <header className="flex items-center justify-between border-t-2 border-red-700 px-5 py-3"><div><p className="text-[11px] text-slate-400">{t("المحاسبة والمالية")}</p><h1 className="text-base font-bold text-slate-800">{t("الحسابات البنكية والتسوية")}</h1></div><button onClick={() => void load()} className="rounded border border-slate-200 p-2" title={t("تحديث")}><RefreshCw className="h-4 w-4" /></button></header>
    {error && <div className="border-y border-red-200 bg-red-50 px-5 py-2 text-xs text-red-700">{error}</div>}
    {loading ? <p className="py-20 text-center text-sm text-slate-500">{t("جاري التحميل...")}</p> : <><section className="grid gap-4 p-5 lg:grid-cols-3">{accounts.map((account) => { const latest = latestImportByAccount.get(account.id); const ledger = ledgerBalances[account.account_code] ?? 0; const statement = latest?.closing_balance == null ? null : numeric(latest.closing_balance); const difference = statement == null ? null : statement - ledger; const Icon = account.name.includes("بنك") || account.bank_name ? Landmark : WalletCards; return <article key={account.id} className={`cursor-pointer rounded border bg-white p-4 shadow-sm ${selectedAccountId === account.id ? "border-blue-500 ring-1 ring-blue-200" : "border-slate-200"}`} onClick={() => setSelectedAccountId(account.id)}><div className="flex items-start justify-between gap-3"><div className="flex items-center gap-2"><span className="rounded-full bg-slate-100 p-2"><Icon className="h-4 w-4" /></span><div><h2 className="text-sm font-bold">{account.name}</h2><p className="text-[10px] text-slate-400">{account.account_code}{account.bank_name ? ` · ${account.bank_name}` : ""}</p></div></div><button onClick={(event) => { event.stopPropagation(); openImport(account); }} className="rounded border border-slate-200 px-2 py-1 text-[11px]"><FileUp className="me-1 inline h-3 w-3" />{t("استيراد كشف")}</button></div><div className="mt-4 grid gap-2 text-xs"><div className="flex justify-between"><span>{t("رصيد الدفتر")}</span><b>{money(ledger)} {account.currency}</b></div><div className="flex justify-between"><span>{t("رصيد آخر كشف")}</span><b>{statement == null ? t("غير متوفر") : `${money(statement)} ${account.currency}`}</b></div><div className="flex justify-between border-t pt-2"><span>{t("الفرق")}</span><b className={difference == null ? "text-slate-400" : Math.abs(difference) <= 0.01 ? "text-emerald-600" : "text-red-600"}>{difference == null ? t("غير محسوب") : `${money(difference)} ${account.currency}`}</b></div></div></article>; })}</section>
    <section className="border-t border-slate-200 p-5"><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-bold text-slate-800">{t("حركات كشف الحساب")}</h2><span className="text-[11px] text-slate-400">{t("الاستيراد لا ينشئ قيودًا محاسبية")}</span></div><div className="overflow-x-auto"><table className="min-w-full text-xs"><thead className="bg-slate-100"><tr><th className="px-3 py-2">{t("التاريخ")}</th><th className="px-3 py-2">{t("المرجع")}</th><th className="px-3 py-2">{t("البيان")}</th><th className="px-3 py-2">{t("مدين البنك")}</th><th className="px-3 py-2">{t("دائن البنك")}</th><th className="px-3 py-2">{t("الرصيد")}</th><th className="px-3 py-2">{t("المطابقة")}</th></tr></thead><tbody>{selectedLines.length ? selectedLines.map((line) => <tr key={line.id} className="border-b"><td className="px-3 py-2 text-center">{line.transaction_date}</td><td className="px-3 py-2 text-center">{line.reference || "—"}</td><td className="px-3 py-2">{line.description || "—"}</td><td className="px-3 py-2 text-center">{money(numeric(line.debit))}</td><td className="px-3 py-2 text-center">{money(numeric(line.credit))}</td><td className="px-3 py-2 text-center">{line.running_balance == null ? "—" : money(numeric(line.running_balance))}</td><td className="px-3 py-2 text-center">{line.reconciliation_status === "matched" ? <button disabled={saving} onClick={() => void unmatch(line)} className="rounded bg-emerald-50 px-2 py-1 text-emerald-700"><CheckCircle2 className="me-1 inline h-3 w-3" />{t("مطابق")} <Unlink className="ms-1 inline h-3 w-3" /></button> : <button onClick={() => void openCandidates(line)} className="rounded bg-blue-50 px-2 py-1 text-blue-700"><Link2 className="me-1 inline h-3 w-3" />{t("مطابقة")}</button>}</td></tr>) : <tr><td colSpan={7} className="py-12 text-center text-slate-400">{t("لا توجد حركات مستوردة لهذا الحساب")}</td></tr>}</tbody></table></div></section></>}
  </div>
  {showImport && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={() => setShowImport(false)}><section className="w-full max-w-xl rounded-xl bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><header className="flex items-center justify-between border-b px-5 py-4"><h2 className="font-bold">{t("استيراد كشف حساب CSV")}</h2><button onClick={() => setShowImport(false)}><X className="h-5 w-5" /></button></header><div className="grid gap-3 p-5 md:grid-cols-2"><label className="text-xs">{t("من تاريخ")}<input type="date" value={statementFrom} onChange={(event) => setStatementFrom(event.target.value)} className="mt-1 block w-full rounded border p-2" /></label><label className="text-xs">{t("إلى تاريخ")}<input type="date" value={statementTo} onChange={(event) => setStatementTo(event.target.value)} className="mt-1 block w-full rounded border p-2" /></label><label className="text-xs">{t("الرصيد الافتتاحي")}<input type="number" step="0.01" value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} className="mt-1 block w-full rounded border p-2" /></label><label className="text-xs">{t("الرصيد الختامي")}<input type="number" step="0.01" value={closingBalance} onChange={(event) => setClosingBalance(event.target.value)} className="mt-1 block w-full rounded border p-2" /></label><label className="col-span-full text-xs">{t("ملف CSV")}<input type="file" accept=".csv,text/csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="mt-1 block w-full rounded border p-2" /></label><p className="col-span-full text-[11px] text-slate-400">date, value_date, reference, description, debit, credit, balance</p></div><footer className="flex justify-end gap-2 border-t px-5 py-4"><button onClick={() => setShowImport(false)} className="rounded border px-4 py-2 text-sm">{t("إلغاء")}</button><button disabled={saving} onClick={() => void importStatement()} className="rounded bg-blue-700 px-4 py-2 text-sm text-white disabled:opacity-50">{saving ? t("جاري الاستيراد...") : t("استيراد دون ترحيل")}</button></footer></section></div>}
  {matchingLine && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={closeMatching}><section className="w-full max-w-3xl rounded-xl bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><header className="flex items-center justify-between border-b px-5 py-4"><div><h2 className="font-bold">{t("مطابقة حركة كشف البنك")}</h2><p className="text-xs text-slate-500">{matchingLine.transaction_date} · {money(matchingLine.amount)} SAR</p></div><button onClick={closeMatching}><X className="h-5 w-5" /></button></header><div className="max-h-96 overflow-y-auto p-5">{candidates.length ? candidates.map((candidate) => <button key={candidate.journal_entry_id} disabled={saving} onClick={() => void match(candidate)} className="mb-2 flex w-full items-center justify-between rounded border border-slate-200 p-3 text-start hover:bg-blue-50"><span><b className="block text-sm">{candidate.reference}</b><span className="text-xs text-slate-500">{candidate.entry_date} · {candidate.description}</span></span><b className="text-sm text-blue-700">{money(candidate.ledger_amount)} SAR</b></button>) : <p className="py-10 text-center text-sm text-slate-400">{t("لا توجد قيود مرحّلة مطابقة في المبلغ ضمن سبعة أيام")}</p>}</div></section></div>}
  </main></Layout>;
}
