import { BookOpen, Calculator, Download, Landmark, Printer, RefreshCw, Scale, WalletCards } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import { riyadhDateString } from "@/lib/utils";
import { COMPANY_REPORT_BRAND, exportReportExcel, printReport, type ReportColumn } from "@/lib/reportExport";
import { fetchPostedLedger, fiscalYearStart, isIncomeStatementAccount } from "@/lib/ledgerData";

type View = "trial" | "statement" | "general" | "subsidiary" | "reconciliation" | "revalue";
type Account = { code: string; name_ar: string; name_en: string | null };
type Entry = { id: string; date: string; createdAt: string; description: string; reference: string };
type JournalLine = { id: string; entryId: string; account: string; debit: number; credit: number; counterparty: string };
type TableRow = Record<string, string | number>;
type ReportResult = { columns: ReportColumn[]; rows: TableRow[]; summary: Array<{ label: string; value: string | number }> };

const REPORTS: { id: View; label: string; icon: typeof Scale; realData: boolean }[] = [
  { id: "trial", label: "ميزان المراجعة", icon: Scale, realData: true },
  { id: "statement", label: "كشف الحساب", icon: WalletCards, realData: true },
  { id: "general", label: "دفتر الأستاذ العام", icon: BookOpen, realData: true },
  { id: "subsidiary", label: "دفتر الأستاذ المساعد", icon: BookOpen, realData: true },
  { id: "reconciliation", label: "تسوية مصرفية", icon: Landmark, realData: false },
  { id: "revalue", label: "إعادة تقييم العملة الأجنبية", icon: Calculator, realData: false },
];

const amount = (value: unknown) => Number(value ?? 0) || 0;
const isEmpty = (value: unknown) => value === null || value === undefined || value === "";

export default function AccountantWorkspace() {
  const { t, direction, locale, formatNumber } = useI18n();
  const navigate = useNavigate();
  const [today] = useState(() => riyadhDateString());
  const [view, setView] = useState<View>("trial");
  const [dateFrom, setDateFrom] = useState(() => `${today.slice(0, 4)}-01-01`);
  const [dateTo, setDateTo] = useState(today);
  const [accountFilter, setAccountFilter] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [lines, setLines] = useState<JournalLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const invalidRange = dateFrom > dateTo;
  // يمنع ردًا متأخرًا لتاريخ سابق من الكتابة فوق نتيجة التاريخ الحالي.
  const requestId = useRef(0);

  const load = async () => {
    const current = ++requestId.current;
    if (invalidRange) {
      setError(t("تاريخ البداية يجب أن يسبق تاريخ النهاية"));
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    let ledger: Awaited<ReturnType<typeof fetchPostedLedger>>;
    try {
      // قراءة كاملة بترقيم صفحات حتى لا تُقطع الحركات بصمت بعد 1000 سطر.
      ledger = await fetchPostedLedger(dateTo);
    } catch (loadError) {
      if (current !== requestId.current) return;
      setError(loadError instanceof Error ? loadError.message : t("تعذر تحميل التقارير"));
      setLoading(false);
      return;
    }
    if (current !== requestId.current) return;
    setAccounts(ledger.accounts as Account[]);
    setEntries(ledger.entries.map((entry) => ({
      id: String(entry.id),
      date: String(entry.entry_date),
      createdAt: String(entry.created_at ?? ""),
      description: String(entry.description ?? ""),
      reference: String(entry.source_document_id ?? entry.id),
    })));
    setLines(ledger.lines.map((line) => ({
      id: String(line.id),
      entryId: String(line.journal_entry_id),
      account: String(line.account_code),
      debit: amount(line.debit),
      credit: amount(line.credit),
      counterparty: String(line.counterparty ?? ""),
    })));
    setLoading(false);
  };

  useEffect(() => { void load(); }, [dateTo]);

  const accountNames = useMemo(() => new Map(accounts.map((account) => [account.code, locale === "en" && account.name_en ? account.name_en : account.name_ar])), [accounts, locale]);
  const entryById = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);
  const currentReport = REPORTS.find((report) => report.id === view) ?? REPORTS[0];
  const imbalancedEntries = useMemo(() => {
    const totals = new Map<string, number>();
    lines.forEach((line) => {
      const date = entryById.get(line.entryId)?.date ?? "";
      if (date < dateFrom || date > dateTo) return;
      totals.set(line.entryId, (totals.get(line.entryId) ?? 0) + line.debit - line.credit);
    });
    return [...totals.values()].filter((difference) => Math.abs(difference) > 0.01).length;
  }, [dateFrom, dateTo, entryById, lines]);

  const report = useMemo<ReportResult>(() => {
    const money = (value: number) => formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const filtered = lines.filter((line) => !accountFilter || line.account === accountFilter);
    // حسابات الإيرادات والمصروفات تبدأ من صفر في بداية كل سنة مالية؛ ما قبلها يُعرض كأرباح سنوات سابقة غير مقفلة.
    const yearStart = fiscalYearStart(dateFrom);
    const isPriorYearsResult = (line: JournalLine) => isIncomeStatementAccount(line.account) && (entryById.get(line.entryId)?.date ?? "") < yearStart;
    const openingLines = filtered.filter((line) => (entryById.get(line.entryId)?.date ?? "") < dateFrom && !isPriorYearsResult(line));
    const priorYearsResult = accountFilter ? 0 : lines.filter(isPriorYearsResult).reduce((sum, line) => sum + line.debit - line.credit, 0);
    const priorYearsLabel = t("أرباح (خسائر) سنوات سابقة غير مقفلة");
    const periodLines = filtered.filter((line) => {
      const date = entryById.get(line.entryId)?.date ?? "";
      return date >= dateFrom && date <= dateTo;
    });
    const periodTotals = periodLines.reduce((sum, line) => ({ debit: sum.debit + line.debit, credit: sum.credit + line.credit }), { debit: 0, credit: 0 });

    if (view === "trial" || view === "statement") {
      const grouped = new Map<string, { opening: number; debit: number; credit: number; count: number }>();
      openingLines.forEach((line) => {
        const value = grouped.get(line.account) ?? { opening: 0, debit: 0, credit: 0, count: 0 };
        value.opening += line.debit - line.credit;
        grouped.set(line.account, value);
      });
      periodLines.forEach((line) => {
        const value = grouped.get(line.account) ?? { opening: 0, debit: 0, credit: 0, count: 0 };
        value.debit += line.debit;
        value.credit += line.credit;
        value.count += 1;
        grouped.set(line.account, value);
      });
      const balances = [...grouped.entries()].sort(([first], [second]) => first.localeCompare(second)).map(([code, value]) => ({ code, name: accountNames.get(code) ?? code, ...value, closing: value.opening + value.debit - value.credit })).filter((value) => Math.abs(value.opening) > 0.001 || value.debit || value.credit);
      if (Math.abs(priorYearsResult) > 0.001) balances.push({ code: "", name: priorYearsLabel, opening: priorYearsResult, debit: 0, credit: 0, count: 0, closing: priorYearsResult });
      const closingDebit = balances.reduce((sum, value) => sum + Math.max(value.closing, 0), 0);
      const closingCredit = balances.reduce((sum, value) => sum + Math.max(-value.closing, 0), 0);
      if (view === "statement") {
        return {
          columns: [{ key: "account", label: t("الحساب") }, { key: "count", label: t("عدد الحركات") }, { key: "opening", label: t("الرصيد الافتتاحي SAR") }, { key: "debit", label: t("حركة مدين SAR") }, { key: "credit", label: t("حركة دائن SAR") }, { key: "closing", label: t("الرصيد الختامي SAR") }],
          rows: balances.map((value) => ({ account: value.code ? `${value.code} - ${value.name}` : value.name, count: value.count, opening: money(value.opening), debit: money(value.debit), credit: money(value.credit), closing: money(value.closing) })),
          summary: [{ label: t("إجمالي حركة المدين"), value: money(periodTotals.debit) }, { label: t("إجمالي حركة الدائن"), value: money(periodTotals.credit) }, { label: t("فرق الحركات"), value: money(periodTotals.debit - periodTotals.credit) }],
        };
      }
      return {
        columns: [{ key: "code", label: t("رقم الحساب") }, { key: "account", label: t("الحساب") }, { key: "openingDebit", label: t("افتتاحي مدين") }, { key: "openingCredit", label: t("افتتاحي دائن") }, { key: "periodDebit", label: t("حركة مدين") }, { key: "periodCredit", label: t("حركة دائن") }, { key: "closingDebit", label: t("ختامي مدين") }, { key: "closingCredit", label: t("ختامي دائن") }],
        rows: balances.map((value) => ({ code: value.code || "—", account: value.name, openingDebit: money(Math.max(value.opening, 0)), openingCredit: money(Math.max(-value.opening, 0)), periodDebit: money(value.debit), periodCredit: money(value.credit), closingDebit: money(Math.max(value.closing, 0)), closingCredit: money(Math.max(-value.closing, 0)) })),
        summary: [{ label: t("إجمالي الختامي المدين"), value: money(closingDebit) }, { label: t("إجمالي الختامي الدائن"), value: money(closingCredit) }, { label: t("فرق ميزان المراجعة"), value: money(closingDebit - closingCredit) }],
      };
    }

    const sortLines = (first: JournalLine, second: JournalLine) => {
      const firstEntry = entryById.get(first.entryId);
      const secondEntry = entryById.get(second.entryId);
      return (firstEntry?.date ?? "").localeCompare(secondEntry?.date ?? "") || (firstEntry?.createdAt ?? "").localeCompare(secondEntry?.createdAt ?? "") || first.entryId.localeCompare(second.entryId) || first.id.localeCompare(second.id);
    };
    const keyFor = (line: JournalLine) => view === "subsidiary" ? `${line.account}::${line.counterparty || "__unassigned__"}` : line.account;
    const openingByKey = new Map<string, number>();
    openingLines.forEach((line) => openingByKey.set(keyFor(line), (openingByKey.get(keyFor(line)) ?? 0) + line.debit - line.credit));
    const runningByKey = new Map(openingByKey);
    const movementRows = [...periodLines].sort(sortLines).map((line) => {
      const key = keyFor(line);
      const balance = (runningByKey.get(key) ?? 0) + line.debit - line.credit;
      runningByKey.set(key, balance);
      const entry = entryById.get(line.entryId);
      return { date: entry?.date ?? "", reference: entry?.reference ?? line.entryId, account: `${line.account} - ${accountNames.get(line.account) ?? line.account}`, counterparty: line.counterparty || t("غير محدد"), description: entry?.description || "—", debit: money(line.debit), credit: money(line.credit), balance: money(balance) };
    });
    const finalBalance = [...runningByKey.values()].reduce((sum, value) => sum + value, 0);
    return {
      columns: [{ key: "date", label: t("التاريخ") }, { key: "reference", label: t("الرقم") }, { key: "account", label: t("الحساب") }, ...(view === "subsidiary" ? [{ key: "counterparty", label: t("جهة التعامل") }] : []), { key: "description", label: t("الحركة") }, { key: "debit", label: t("مدين SAR") }, { key: "credit", label: t("دائن SAR") }, { key: "balance", label: t("رصيد الحساب SAR") }],
      rows: movementRows,
      summary: [{ label: t("إجمالي المدين"), value: money(periodTotals.debit) }, { label: t("إجمالي الدائن"), value: money(periodTotals.credit) }, { label: accountFilter ? t("الرصيد الختامي للحساب") : t("صافي الأرصدة المعروضة"), value: money(finalBalance) }, ...(Math.abs(priorYearsResult) > 0.001 ? [{ label: priorYearsLabel, value: money(priorYearsResult) }] : []), { label: t("عدد السجلات"), value: movementRows.length }],
    };
  }, [accountFilter, accountNames, dateFrom, dateTo, entryById, formatNumber, lines, t, view]);

  const exportOptions = { title: t(currentReport.label), subtitle: `${t("من تاريخ")} ${dateFrom} ${t("إلى تاريخ")} ${dateTo}`, columns: report.columns, rows: report.rows, fileName: currentReport.label, summary: report.summary, landscape: true, brand: COMPANY_REPORT_BRAND };

  return <Layout><main dir={direction} className="min-h-full bg-slate-50 p-4"><div className="mx-auto max-w-[1600px] overflow-hidden rounded border border-slate-200 bg-white shadow-sm">
    <header className="border-t-2 border-red-700 px-4 py-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[11px] text-slate-400">{t("المحاسبة والمالية")} / {t("مساحة عمل المحاسب")}</p><h1 className="text-base font-bold text-slate-800">{t("مساحة عمل المحاسب")}</h1></div><div className="flex gap-1"><button onClick={() => void load()} className="rounded border border-slate-200 p-2" title={t("تحديث")}><RefreshCw className="h-4 w-4" /></button>{currentReport.realData && <><button onClick={() => printReport(exportOptions)} disabled={invalidRange || loading || Boolean(error)} className="rounded border border-slate-200 p-2 disabled:opacity-40" title={t("طباعة")}><Printer className="h-4 w-4" /></button><button onClick={() => exportReportExcel(exportOptions)} disabled={invalidRange || loading || Boolean(error)} className="rounded border border-slate-200 p-2 disabled:opacity-40" title={t("تصدير Excel")}><Download className="h-4 w-4" /></button></>}</div></div></header>
    <div className="grid grid-cols-2 border-b border-slate-100 md:grid-cols-3 xl:grid-cols-6">{REPORTS.map((item) => { const Icon = item.icon; return <button key={item.id} onClick={() => setView(item.id)} className={`flex items-center justify-center gap-2 border-s border-b border-slate-100 px-3 py-3 text-xs font-semibold ${view === item.id ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-50"}`}><Icon className="h-4 w-4" />{t(item.label)}</button>; })}</div>
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3"><div className="flex flex-wrap gap-2"><label className="text-xs text-slate-500">{t("من تاريخ")}<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className={`mt-1 block rounded border bg-white px-2 py-1.5 text-xs ${invalidRange ? "border-red-400" : "border-slate-200"}`} /></label><label className="text-xs text-slate-500">{t("إلى تاريخ")}<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className={`mt-1 block rounded border bg-white px-2 py-1.5 text-xs ${invalidRange ? "border-red-400" : "border-slate-200"}`} /></label><label className="text-xs text-slate-500">{t("الحساب")}<select value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)} className="mt-1 block max-w-60 rounded border border-slate-200 bg-white px-2 py-1.5 text-xs"><option value="">{t("كل الحسابات")}</option>{accounts.map((account) => <option key={account.code} value={account.code}>{account.code} - {locale === "en" && account.name_en ? account.name_en : account.name_ar}</option>)}</select></label></div><span className="text-xs font-semibold text-slate-500">SAR</span></div>
    {imbalancedEntries > 0 && <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs font-semibold text-red-700">{t("تحذير: توجد قيود مرحّلة غير متوازنة")}: {imbalancedEntries}</div>}
    {!currentReport.realData ? <section className="px-5 py-20 text-center"><h2 className="text-sm font-bold text-slate-700">{t(currentReport.label)}</h2><p className="mx-auto mt-3 max-w-2xl text-xs leading-6 text-slate-500">{view === "reconciliation" ? t("تتم التسوية من صفحة الحسابات البنكية عبر استيراد كشف الحساب ثم مطابقته يدويًا مع القيود المرحلة.") : t("لا توجد أرصدة عملات أجنبية قابلة لإعادة التقييم للفترة المحددة. يتطلب هذا التقرير أسعار صرف معتمدة وحركات بعملة أجنبية.")}</p>{view === "reconciliation" && <button onClick={() => navigate("/expenses/bank-accounts")} className="mt-4 rounded bg-blue-700 px-4 py-2 text-xs font-semibold text-white">{t("فتح الحسابات البنكية والتسوية")}</button>}</section> : <section className="p-4"><h2 className="mb-3 text-center text-sm font-bold text-slate-800">{t(currentReport.label)}</h2>{invalidRange ? <p className="py-16 text-center text-sm text-red-600">{t("تاريخ البداية يجب أن يسبق تاريخ النهاية")}</p> : loading ? <p className="py-16 text-center text-sm text-slate-500">{t("جاري التحميل...")}</p> : error ? <p className="py-16 text-center text-sm text-red-600">{error}</p> : <><div className="overflow-x-auto"><table className="min-w-full text-[11px]"><thead className="bg-slate-100 text-slate-600"><tr>{report.columns.map((column) => <th key={column.key} className="border-b px-3 py-2 text-center">{column.label}</th>)}</tr></thead><tbody>{report.rows.length ? report.rows.map((row, index) => <tr key={`${index}-${row.reference ?? row.account ?? row.code ?? "row"}`} className="border-b border-slate-100">{report.columns.map((column) => <td key={column.key} className="px-3 py-2 text-center">{isEmpty(row[column.key]) ? "—" : row[column.key]}</td>)}</tr>) : <tr><td colSpan={report.columns.length} className="py-16 text-center text-slate-400">{t("لا توجد حركات مرحّلة للفترة المحددة")}</td></tr>}</tbody></table></div><div className="mt-3 flex flex-wrap justify-end gap-4 border-t border-slate-100 pt-3 text-xs font-semibold text-slate-700">{report.summary.map((item) => <span key={item.label}>{item.label}: <b className="text-indigo-700">{item.value}</b></span>)}</div></>}</section>}
  </div></main></Layout>;
}
