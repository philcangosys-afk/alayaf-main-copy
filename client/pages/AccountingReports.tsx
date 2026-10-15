import Layout from "@/components/Layout";
import { AlertTriangle, Download, Printer, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "@/i18n";
import { riyadhDateString } from "@/lib/utils";
import { COMPANY_REPORT_BRAND, exportReportExcel, printReport, type ReportCell, type ReportColumn } from "@/lib/reportExport";
import { accountClass, fetchPostedLedger, fiscalYearStart, isIncomeStatementAccount, type LedgerAccount, type LedgerEntry, type LedgerLine } from "@/lib/ledgerData";

type ReportKind = "income" | "comprehensive" | "position";
type RowKind = "section" | "group" | "account" | "total" | "grand" | "check";
type StatementRow = { key: string; kind: RowKind; label: string; values: number[] | null };
type Statement = { headers: string[]; rows: StatementRow[]; warnings: string[]; summary: Array<{ label: string; value: number }> };
type Translate = (text: string) => string;

const REPORTS: { kind: ReportKind; label: string }[] = [
  { kind: "income", label: "قائمة الدخل" },
  { kind: "comprehensive", label: "قائمة الدخل الشامل" },
  { kind: "position", label: "قائمة المركز المالي" },
];

/** تقارير فعلية موجودة في النظام بدل القائمة السابقة التي كانت تعرض أصفارًا ثابتة. */
const REPORT_LINKS: { title: string; items: { label: string; path: string }[] }[] = [
  { title: "ميزان المراجعة والدفاتر", items: [{ label: "ميزان المراجعة ودفتر الأستاذ وكشف الحساب", path: "/expenses/accountant" }] },
  { title: "الزكاة والضريبة", items: [{ label: "تقارير ضريبة القيمة المضافة", path: "/expenses/tax-reports" }] },
  { title: "المشتريات", items: [{ label: "تقارير المشتريات والموردين", path: "/purchases/reports" }] },
  { title: "المبيعات والعملاء", items: [{ label: "تقارير العملاء والمبيعات", path: "/crm/reports" }] },
  { title: "الأصول", items: [{ label: "الأصول الثابتة والإهلاك", path: "/expenses/fixed-assets" }] },
];

const EPSILON = 0.005;
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const isZero = (value: number) => Math.abs(value) < EPSILON;

/** أشهر السنة المالية من يناير حتى شهر تاريخ النهاية. */
function monthKeys(end: string) {
  const year = end.slice(0, 4);
  const lastMonth = Number(end.slice(5, 7)) || 12;
  return Array.from({ length: lastMonth }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`);
}

export default function AccountingReports() {
  const { t, direction, locale, formatNumber } = useI18n();
  const navigate = useNavigate();
  const [active, setActive] = useState<ReportKind>("income");
  const [endDate, setEndDate] = useState(() => riyadhDateString());
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [lines, setLines] = useState<LedgerLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(endDate);
  // يمنع ردًا متأخرًا لتاريخ سابق من الكتابة فوق نتيجة التاريخ الحالي.
  const requestId = useRef(0);

  const load = async () => {
    const current = ++requestId.current;
    if (!validDate) { setError(t("اختر تاريخًا صحيحًا")); setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const ledger = await fetchPostedLedger(endDate);
      if (current !== requestId.current) return;
      setAccounts(ledger.accounts); setEntries(ledger.entries); setLines(ledger.lines);
    } catch (loadError) {
      if (current !== requestId.current) return;
      setError(loadError instanceof Error ? loadError.message : t("تعذر تحميل التقارير"));
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [endDate]);

  const statement = useMemo<Statement>(() => buildStatement(active, endDate, accounts, entries, lines, locale, t), [active, endDate, accounts, entries, lines, locale, t]);
  const activeLabel = REPORTS.find((report) => report.kind === active)?.label ?? "";
  const periodText = active === "position"
    ? `${t("كما في")} ${endDate}`
    : `${t("من تاريخ")} ${validDate ? fiscalYearStart(endDate) : "—"} ${t("إلى تاريخ")} ${endDate}`;
  const money = (value: number) => formatNumber(round2(value), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const canExport = !loading && !error && validDate;

  const exportColumns: ReportColumn[] = [{ key: "label", label: t("البند"), width: 44 }, ...statement.headers.map((header, index) => ({ key: `v${index}`, label: header, width: 16 }))];
  const exportRows = (asNumbers: boolean) => statement.rows.map((row) => {
    const record: Record<string, ReportCell> = { label: row.kind === "account" ? `    ${row.label}` : row.label };
    statement.headers.forEach((_, index) => {
      const value = row.values?.[index];
      record[`v${index}`] = value === undefined ? "" : asNumbers ? round2(value) : money(value);
    });
    return record;
  });
  const exportBase = { title: t(activeLabel), subtitle: `${periodText} — ${t("المبالغ بالريال السعودي")}`, columns: exportColumns, fileName: `${t(activeLabel)}-${endDate}`, landscape: statement.headers.length > 3, brand: COMPANY_REPORT_BRAND };
  const handlePrint = () => {
    setNotice("");
    const opened = printReport({ ...exportBase, rows: exportRows(false), summary: statement.summary.map((item) => ({ label: item.label, value: money(item.value) })) });
    if (!opened) setNotice(t("تعذر فتح نافذة الطباعة. اسمح بالنوافذ المنبثقة لهذا الموقع ثم أعد المحاولة."));
  };
  const handleExport = () => exportReportExcel({ ...exportBase, rows: exportRows(true), summary: statement.summary.map((item) => ({ label: item.label, value: round2(item.value) })) });

  return <Layout><main dir={direction} className="min-h-full bg-slate-50 p-4">
    <div className="mx-auto max-w-[1600px] overflow-hidden rounded border border-slate-200 bg-white shadow-sm">
      <header className="border-t-2 border-red-600 px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1">{REPORTS.map((reportItem) => <button key={reportItem.kind} onClick={() => setActive(reportItem.kind)} className={`rounded px-3 py-1.5 text-xs font-semibold ${active === reportItem.kind ? "bg-blue-700 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{t(reportItem.label)}</button>)}</div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-[11px] text-slate-500">{active === "position" ? t("كما في") : t("حتى تاريخ")}<input value={endDate} onChange={(event) => setEndDate(event.target.value)} type="date" className="rounded border border-slate-200 px-2 py-1 text-xs" /></label>
            <button onClick={() => void load()} className="rounded border border-slate-200 p-1.5" title={t("تحديث")}><RefreshCw className="h-3.5 w-3.5" /></button>
            <button onClick={handlePrint} disabled={!canExport} className="rounded border border-slate-200 p-1.5 disabled:opacity-40" title={t("طباعة")}><Printer className="h-3.5 w-3.5" /></button>
            <button onClick={handleExport} disabled={!canExport} className="rounded border border-slate-200 p-1.5 disabled:opacity-40" title={t("تصدير Excel")}><Download className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      </header>
      <section className="p-4">
        <h1 className="text-center text-sm font-bold text-slate-800">{t(activeLabel)}</h1>
        <p className="mt-1 text-center text-[11px] text-slate-400">{periodText} — {t("المبالغ بالريال السعودي")} — {t("القيود المرحّلة فقط")}</p>
        {notice ? <p className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{notice}</p> : null}
        {!loading && !error && statement.warnings.length ? <div className="mt-3 space-y-1 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{statement.warnings.map((warning) => <p key={warning} className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{warning}</p>)}</div> : null}
        {loading ? <State text={t("جاري التحميل...")} /> : error ? <State text={error} /> : <StatementTable statement={statement} money={money} />}

        <section className="mt-6 border-t border-slate-200 pt-5">
          <h2 className="mb-3 text-sm font-bold text-slate-800">{t("باقي التقارير")}</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {REPORT_LINKS.map((section) => <div key={section.title} className="overflow-hidden rounded border border-slate-200 bg-white">
              <h3 className="bg-slate-800 px-3 py-2 text-xs font-bold text-white">{t(section.title)}</h3>
              <div className="divide-y divide-slate-100">{section.items.map((item) => <button key={item.path} onClick={() => navigate(item.path)} className="flex w-full items-center justify-between px-3 py-2 text-start text-xs text-slate-600 hover:bg-blue-50 hover:text-blue-700"><span>{t(item.label)}</span><span className="text-slate-300">‹</span></button>)}</div>
            </div>)}
          </div>
        </section>
      </section>
    </div>
  </main></Layout>;
}

function buildStatement(kind: ReportKind, endDate: string, accounts: LedgerAccount[], entries: LedgerEntry[], lines: LedgerLine[], locale: string, t: Translate): Statement {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return { headers: [], rows: [], warnings: [], summary: [] };
  const nameOf = new Map(accounts.map((account) => [account.code, locale === "en" && account.name_en ? account.name_en : account.name_ar]));
  const accountLabel = (code: string) => `${code} - ${nameOf.get(code) ?? code}`;
  const entryDate = new Map(entries.map((entry) => [entry.id, entry.entry_date]));
  const yearStart = fiscalYearStart(endDate);
  const warnings: string[] = [];

  const unclassified = new Set<string>();
  const missingEntries = lines.filter((line) => !entryDate.has(line.journal_entry_id)).length;
  if (missingEntries) warnings.push(`${t("أسطر قيود بلا قيد مرحّل مطابق ولم تُحتسب")}: ${missingEntries}`);

  /** يبني أقسام الحسابات مجمّعة على المستوى الأول (أول رقمين من الكود). */
  const buildSection = (classes: string[], sign: (line: LedgerLine) => number, bucketOf: (date: string) => number, width: number, filter: (date: string) => boolean) => {
    const byAccount = new Map<string, number[]>();
    for (const line of lines) {
      const date = entryDate.get(line.journal_entry_id);
      if (!date || !filter(date)) continue;
      if (!classes.includes(accountClass(line.account_code))) continue;
      const index = bucketOf(date);
      if (index < 0 || index >= width) continue;
      const values = byAccount.get(line.account_code) ?? Array<number>(width).fill(0);
      values[index] += sign(line);
      byAccount.set(line.account_code, values);
    }
    const groups = new Map<string, { code: string; accounts: { code: string; values: number[] }[] }>();
    [...byAccount.entries()].sort(([first], [second]) => first.localeCompare(second)).forEach(([code, values]) => {
      if (values.every(isZero)) return;
      const groupCode = code.slice(0, 2);
      const group = groups.get(groupCode) ?? { code: groupCode, accounts: [] };
      group.accounts.push({ code, values });
      groups.set(groupCode, group);
    });
    const rows: StatementRow[] = [];
    const total = Array<number>(width).fill(0);
    [...groups.values()].forEach((group) => {
      const subtotal = Array<number>(width).fill(0);
      group.accounts.forEach((account) => account.values.forEach((value, index) => { subtotal[index] += value; total[index] += value; }));
      rows.push({ key: `group-${group.code}`, kind: "group", label: accountLabel(group.code), values: subtotal });
      group.accounts.forEach((account) => rows.push({ key: `account-${account.code}`, kind: "account", label: accountLabel(account.code), values: account.values }));
    });
    return { rows, total };
  };

  const creditNormal = (line: LedgerLine) => line.credit - line.debit;
  const debitNormal = (line: LedgerLine) => line.debit - line.credit;

  for (const line of lines) {
    if (!["1", "2", "3", "4", "5"].includes(accountClass(line.account_code))) unclassified.add(line.account_code);
  }
  if (unclassified.size) warnings.push(`${t("حسابات عليها حركات خارج تصنيف القوائم (1-5) ولم تظهر في القائمة")}: ${[...unclassified].join("، ")}`);

  if (kind === "income" || kind === "comprehensive") {
    const months = monthKeys(endDate);
    const width = months.length + 1;
    const monthIndex = (date: string) => months.indexOf(date.slice(0, 7));
    const inPeriod = (date: string) => date >= yearStart && date <= endDate;
    const withTotal = (values: number[]) => { const copy = values.slice(0, months.length); copy.push(copy.reduce((sum, value) => sum + value, 0)); return copy; };
    const revenue = buildSection(["4"], creditNormal, monthIndex, months.length, inPeriod);
    const expenses = buildSection(["5"], debitNormal, monthIndex, months.length, inPeriod);
    const net = revenue.total.map((value, index) => value - expenses.total[index]);
    const rows: StatementRow[] = [
      { key: "section-revenue", kind: "section", label: t("الإيرادات"), values: null },
      ...revenue.rows.map((row) => ({ ...row, values: row.values ? withTotal(row.values) : null })),
      { key: "total-revenue", kind: "total", label: t("إجمالي الإيرادات"), values: withTotal(revenue.total) },
      { key: "section-expenses", kind: "section", label: t("المصروفات والتكاليف"), values: null },
      ...expenses.rows.map((row) => ({ ...row, values: row.values ? withTotal(row.values) : null })),
      { key: "total-expenses", kind: "total", label: t("إجمالي المصروفات والتكاليف"), values: withTotal(expenses.total) },
      { key: "net-profit", kind: "grand", label: t("صافي الربح (الخسارة) للفترة"), values: withTotal(net) },
    ];
    const netTotal = withTotal(net)[months.length];
    const summary = [
      { label: t("إجمالي الإيرادات"), value: withTotal(revenue.total)[months.length] },
      { label: t("إجمالي المصروفات والتكاليف"), value: withTotal(expenses.total)[months.length] },
      { label: t("صافي الربح (الخسارة) للفترة"), value: netTotal },
    ];
    if (kind === "comprehensive") {
      rows.push(
        { key: "section-oci", kind: "section", label: t("الدخل الشامل الآخر"), values: null },
        { key: "oci", kind: "account", label: t("بنود الدخل الشامل الآخر"), values: Array<number>(width).fill(0) },
        { key: "total-comprehensive", kind: "grand", label: t("إجمالي الدخل الشامل للفترة"), values: withTotal(net) },
      );
      warnings.push(t("لا توجد في دليل الحسابات حسابات للدخل الشامل الآخر، لذلك يساوي إجمالي الدخل الشامل صافي الربح."));
      summary.push({ label: t("إجمالي الدخل الشامل للفترة"), value: netTotal });
    }
    return { headers: [...months, t("الإجمالي من بداية السنة")], rows, warnings, summary };
  }

  // قائمة المركز المالي كما في تاريخ النهاية.
  const asAt = (date: string) => date <= endDate;
  const single = () => 0;
  const assets = buildSection(["1"], debitNormal, single, 1, asAt);
  const liabilities = buildSection(["2"], creditNormal, single, 1, asAt);
  const equity = buildSection(["3"], creditNormal, single, 1, asAt);
  let priorYearsResult = 0;
  let currentPeriodResult = 0;
  for (const line of lines) {
    const date = entryDate.get(line.journal_entry_id);
    if (!date || date > endDate || !isIncomeStatementAccount(line.account_code)) continue;
    if (date < yearStart) priorYearsResult += creditNormal(line);
    else currentPeriodResult += creditNormal(line);
  }
  const totalAssets = assets.total[0];
  const totalLiabilities = liabilities.total[0];
  const totalEquity = equity.total[0] + priorYearsResult + currentPeriodResult;
  const difference = totalAssets - (totalLiabilities + totalEquity);
  if (!isZero(priorYearsResult)) warnings.push(t("توجد أرباح/خسائر من سنوات سابقة لم تُقفل في الأرباح المحتجزة؛ عُرضت ضمن حقوق الملكية في سطر مستقل."));
  if (!isZero(difference)) warnings.push(`${t("قائمة المركز المالي غير متوازنة؛ راجع الحسابات خارج التصنيف أو القيود")}: ${round2(difference)}`);
  const rows: StatementRow[] = [
    { key: "section-assets", kind: "section", label: t("الأصول"), values: null },
    ...assets.rows,
    { key: "total-assets", kind: "grand", label: t("إجمالي الأصول"), values: [totalAssets] },
    { key: "section-liabilities", kind: "section", label: t("الخصوم"), values: null },
    ...liabilities.rows,
    { key: "total-liabilities", kind: "total", label: t("إجمالي الخصوم"), values: [totalLiabilities] },
    { key: "section-equity", kind: "section", label: t("حقوق الملكية"), values: null },
    ...equity.rows,
    ...(!isZero(priorYearsResult) ? [{ key: "prior-years", kind: "account" as const, label: t("أرباح (خسائر) سنوات سابقة غير مقفلة"), values: [priorYearsResult] }] : []),
    { key: "current-result", kind: "account", label: t("صافي ربح (خسارة) الفترة الحالية"), values: [currentPeriodResult] },
    { key: "total-equity", kind: "total", label: t("إجمالي حقوق الملكية"), values: [totalEquity] },
    { key: "total-liabilities-equity", kind: "grand", label: t("إجمالي الخصوم وحقوق الملكية"), values: [totalLiabilities + totalEquity] },
    { key: "check", kind: "check", label: t("الفرق (الأصول − الخصوم وحقوق الملكية)"), values: [difference] },
  ];
  return {
    headers: [t("الرصيد")],
    rows,
    warnings,
    summary: [
      { label: t("إجمالي الأصول"), value: totalAssets },
      { label: t("إجمالي الخصوم وحقوق الملكية"), value: totalLiabilities + totalEquity },
      { label: t("الفرق"), value: difference },
    ],
  };
}

function StatementTable({ statement, money }: { statement: Statement; money: (value: number) => string }) {
  const { t } = useI18n();
  if (!statement.rows.length) return <State text={t("لا توجد حركات مرحّلة للفترة المحددة")} />;
  const rowClass: Record<RowKind, string> = {
    section: "bg-slate-800 text-white font-bold",
    group: "bg-slate-50 font-semibold text-slate-700",
    account: "text-slate-600",
    total: "bg-slate-100 font-bold text-slate-800",
    grand: "bg-blue-50 font-bold text-blue-900 border-y-2 border-blue-200",
    check: "font-semibold text-slate-500",
  };
  return <div className="mt-4 overflow-x-auto"><table className="min-w-full text-[11px]">
    <thead className="bg-slate-100 text-slate-600"><tr><th className="min-w-72 border-b px-3 py-2 text-start">{t("البند")}</th>{statement.headers.map((header) => <th key={header} className="min-w-28 border-b px-2 py-2">{header}</th>)}</tr></thead>
    <tbody>{statement.rows.map((row) => <tr key={row.key} className={`border-b border-slate-100 ${rowClass[row.kind]}`}>
      <td className={`px-3 py-2 ${row.kind === "account" ? "ps-8" : ""}`}>{row.label}</td>
      {statement.headers.map((_, index) => {
        const value = row.values?.[index];
        const negative = value !== undefined && value < -EPSILON;
        const checkFailed = row.kind === "check" && value !== undefined && !isZero(value);
        return <td key={index} className={`px-2 py-2 text-center tabular-nums ${negative && row.kind !== "section" ? "text-red-600" : ""} ${checkFailed ? "bg-red-50 text-red-700" : ""}`}>{value === undefined ? "" : money(value)}</td>;
      })}
    </tr>)}</tbody>
  </table></div>;
}

function State({ text }: { text: string }) { return <div className="py-16 text-center text-sm text-slate-500">{text}</div>; }
