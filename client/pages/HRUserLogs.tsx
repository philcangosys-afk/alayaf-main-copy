import { Fragment, useCallback, useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { Search, Download, Printer, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabaseClient";
import { hrRequestErrorText } from "@/lib/hrErrors";

type LogEntry = {
  id: string;
  user_name: string;
  created_at: string;
  module: string;
  module_label: string;
  operation: string;
  details: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
};

const PAGE_SIZE = 100;
const EXPORT_LIMIT = 5000;

// الوحدات المعروفة في السجل (تُضاف إليها أي وحدة تظهر في الصفحة الحالية)
const KNOWN_MODULES: Array<[string, string]> = [
  ["hr.employees", "الموظفون"],
  ["audit.user_roles", "الأدوار والصلاحيات"],
  ["audit.system_users", "المستخدمون الخاصون"],
  ["audit.hr_settings", "إعدادات الموارد البشرية"],
  ["audit.approval_chains", "سلاسل الموافقات"],
  ["audit.leave_types", "أنواع الإجازات"],
  ["audit.official_holidays", "العطل الرسمية"],
  ["audit.termination_reasons", "أسباب إنهاء الخدمة"],
];

const MODULE_COLORS: Record<string, string> = {
  "hr.employees": "bg-emerald-100 text-emerald-700",
  "audit.user_roles": "bg-rose-100 text-rose-700",
  "audit.system_users": "bg-rose-100 text-rose-700",
  "audit.hr_settings": "bg-purple-100 text-purple-700",
  "audit.approval_chains": "bg-amber-100 text-amber-700",
};

const asObject = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const toLog = (r: Record<string, unknown>): LogEntry => ({
  id: String(r.id ?? ""),
  user_name: String(r.user_name ?? ""),
  created_at: String(r.created_at ?? ""),
  module: String(r.module ?? ""),
  module_label: String(r.module_label ?? r.module ?? ""),
  operation: String(r.operation ?? ""),
  details: String(r.details ?? ""),
  old_values: asObject(r.old_values),
  new_values: asObject(r.new_values),
});

const showValue = (value: unknown) => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

// نص البحث داخل مرشح PostgREST: لا فواصل ولا أقواس ولا محارف أنماط
const cleanSearch = (value: string) => value.replace(/[,()*%_\\"']/g, " ").trim();

// خلية CSV آمنة: علامات التنصيص مضاعفة، ولا تبدأ بمحرف صيغة في برامج الجداول
const csvCell = (value: unknown) => {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

export default function HRUserLogs() {
  const { t, direction, formatDate, formatNumber } = useI18n();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // الاستعلام بمرشحات الخادم (لا تُحمَّل كل السجلات في المتصفح)
  const buildQuery = useCallback((withCount: boolean) => {
    let query = supabase.from("user_logs").select("*", withCount ? { count: "exact" } : undefined);
    if (moduleFilter) query = query.eq("module", moduleFilter);
    if (fromDate) query = query.gte("created_at", `${fromDate}T00:00:00+03:00`);
    if (toDate) query = query.lte("created_at", `${toDate}T23:59:59.999+03:00`);
    const q = cleanSearch(appliedSearch);
    if (q) query = query.or(`user_name.ilike.%${q}%,operation.ilike.%${q}%,details.ilike.%${q}%`);
    return query.order("created_at", { ascending: false }).order("id", { ascending: false });
  }, [moduleFilter, fromDate, toDate, appliedSearch]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const from = page * PAGE_SIZE;
    const { data, error: loadError, count } = await buildQuery(true).range(from, from + PAGE_SIZE - 1);
    if (loadError) {
      setLogs([]);
      setTotal(0);
      setError(hrRequestErrorText(loadError, "تعذر تحميل السجلات"));
    } else {
      setLogs(((data ?? []) as Record<string, unknown>[]).map(toLog));
      setTotal(count ?? 0);
    }
    setLoading(false);
  }, [buildQuery, page]);

  useEffect(() => { void load(); }, [load]);

  const moduleOptions = [...KNOWN_MODULES];
  logs.forEach((log) => {
    if (log.module && !moduleOptions.some(([key]) => key === log.module)) moduleOptions.push([log.module, log.module_label || log.module]);
  });

  const formatLogDate = (value: string) =>
    value ? formatDate(value, { dateStyle: "medium", timeStyle: "short" }) : "";

  const changes = (log: LogEntry) => {
    const keys = [...new Set([...Object.keys(log.old_values ?? {}), ...Object.keys(log.new_values ?? {})])].sort();
    return keys.map((key) => ({ key, before: log.old_values?.[key], after: log.new_values?.[key] }));
  };

  const handleExport = async () => {
    setExporting(true);
    const { data, error: exportError } = await buildQuery(false).range(0, EXPORT_LIMIT - 1);
    setExporting(false);
    if (exportError) {
      setError(hrRequestErrorText(exportError, "تعذر التصدير"));
      return;
    }
    const rows = ((data ?? []) as Record<string, unknown>[]).map(toLog);
    const headers = [t("المستخدم"), t("التاريخ"), t("الوحدة"), t("العملية"), t("التفاصيل"), t("قبل"), t("بعد")];
    const lines = rows.map((l) => [l.user_name, formatLogDate(l.created_at), l.module_label, l.operation, l.details,
      l.old_values ? JSON.stringify(l.old_values) : "", l.new_values ? JSON.stringify(l.new_values) : ""]);
    const csv = [headers, ...lines].map((r) => r.map(csvCell).join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "user_logs.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const resetPage = () => { setPage(0); setExpanded(null); };

  return (
    <Layout>
      <div className="mx-auto max-w-full space-y-4 p-6" dir={direction}>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">{t("سجلات المستخدمين")}</h1>
          <div className="flex items-center gap-2">
            <button onClick={() => void load()} title={t("تحديث")} className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600"><RefreshCw className="h-4 w-4" /></button>
            <button onClick={() => void handleExport()} disabled={exporting} title={t("تصدير")} className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 disabled:opacity-50"><Download className="h-4 w-4" /></button>
            <button onClick={() => window.print()} title={t("طباعة")} className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600"><Printer className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap bg-white border rounded-xl px-4 py-3 shadow-sm">
          <select value={moduleFilter} onChange={(e) => { setModuleFilter(e.target.value); resetPage(); }}
            className="border rounded-lg px-3 py-1.5 text-sm bg-white outline-none">
            <option value="">{t("كل الوحدات")}</option>
            {moduleOptions.map(([key, label]) => <option key={key} value={key}>{t(label)}</option>)}
          </select>
          <label className="flex items-center gap-1 text-sm text-gray-600">{t("من")}
            <input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); resetPage(); }} className="border rounded-lg px-2 py-1 text-sm" />
          </label>
          <label className="flex items-center gap-1 text-sm text-gray-600">{t("إلى")}
            <input type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); resetPage(); }} className="border rounded-lg px-2 py-1 text-sm" />
          </label>
          <form className="flex-1 min-w-[200px] relative" onSubmit={(e) => { e.preventDefault(); setAppliedSearch(search); resetPage(); }}>
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            <input type="text" placeholder={t("بحث بالمستخدم أو العملية أو التفاصيل ثم Enter")} value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pr-9 pl-3 py-1.5 border rounded-lg text-sm outline-none" />
          </form>
          <span className="text-sm text-gray-500">{formatNumber(total)} {t("سجل")}</span>
        </div>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#004e89] text-white">
                  <th className="px-4 py-3 text-right font-medium">{t("المستخدم")}</th>
                  <th className="px-4 py-3 text-right font-medium">{t("التاريخ")}</th>
                  <th className="px-4 py-3 text-right font-medium">{t("الوحدة")}</th>
                  <th className="px-4 py-3 text-right font-medium">{t("العملية")}</th>
                  <th className="px-4 py-3 text-right font-medium">{t("التفاصيل")}</th>
                  <th className="px-4 py-3 text-right font-medium">{t("قبل وبعد")}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="py-12 text-center text-gray-400">{t("جاري التحميل...")}</td></tr>
                ) : logs.length === 0 ? (
                  <tr><td colSpan={6} className="py-12 text-center text-gray-400">{t("لا توجد سجلات")}</td></tr>
                ) : logs.map((log, i) => {
                  const rows = changes(log);
                  const open = expanded === log.id;
                  return (
                    <Fragment key={log.id}>
                      <tr className={cn("border-b hover:bg-blue-50/30", i % 2 === 0 ? "bg-white" : "bg-gray-50/40")}>
                        <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap">{log.user_name}</td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap font-mono text-xs">{formatLogDate(log.created_at)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={cn("inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium", MODULE_COLORS[log.module] ?? "bg-gray-100 text-gray-600")}>{log.module_label}</span>
                        </td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap text-xs">{log.operation}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs max-w-md truncate" title={log.details}>{log.details}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {rows.length ? (
                            <button type="button" onClick={() => setExpanded(open ? null : log.id)} className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline">
                              {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}{formatNumber(rows.length)} {t("حقل")}
                            </button>
                          ) : <span className="text-xs text-gray-300">—</span>}
                        </td>
                      </tr>
                      {open && (
                        <tr className="border-b bg-slate-50">
                          <td colSpan={6} className="px-4 py-3">
                            <table className="w-full text-xs">
                              <thead><tr className="text-gray-500"><th className="py-1 text-right font-medium">{t("الحقل")}</th><th className="py-1 text-right font-medium">{t("قبل")}</th><th className="py-1 text-right font-medium">{t("بعد")}</th></tr></thead>
                              <tbody>
                                {rows.map((row) => (
                                  <tr key={row.key} className="border-t border-slate-200 align-top">
                                    <td className="py-1 pe-3 font-mono text-gray-700 whitespace-nowrap">{row.key}</td>
                                    <td className="py-1 pe-3 text-red-700 break-all" dir="auto">{showValue(row.before)}</td>
                                    <td className="py-1 text-green-700 break-all" dir="auto">{showValue(row.after)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t px-4 py-2 text-sm text-gray-600">
            <span>{t("صفحة")} {formatNumber(page + 1)} {t("من")} {formatNumber(pages)}</span>
            <div className="flex gap-2">
              <button type="button" disabled={page === 0 || loading} onClick={() => { setPage((p) => Math.max(0, p - 1)); setExpanded(null); }} className="rounded-lg border px-3 py-1 disabled:opacity-40">{t("السابق")}</button>
              <button type="button" disabled={page + 1 >= pages || loading} onClick={() => { setPage((p) => p + 1); setExpanded(null); }} className="rounded-lg border px-3 py-1 disabled:opacity-40">{t("التالي")}</button>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
