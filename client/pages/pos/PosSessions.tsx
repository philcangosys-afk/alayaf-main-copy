import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Download, History, MonitorSmartphone, RefreshCw } from "lucide-react";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { deviceTypeLabel, listPosDevices, listPosSessions, posErrorText, type PosDevice, type PosSession } from "@/lib/pos";
import { Code, ErrorNote, PosButton, PosHeader, StatPill, num, posInput, posLabel, posSelect, useMoney, usePosDate } from "@/components/pos/PosUi";

type Filters = { status: "" | "open" | "closed"; device: string; user: string; from: string; to: string };

const riyadhToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
const daysAgo = (days: number) => {
  const date = new Date(Date.now() - days * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(date);
};

/** جلسات نقاط البيع: كلها لمن له صلاحية الجلسات، وجلسات المستخدم لغيره، بالحالة والجهاز والكاشير والتاريخ */
export default function PosSessions() {
  const { t, direction } = useI18n();
  const money = useMoney();
  const fmtDate = usePosDate();
  const [filters, setFilters] = useState<Filters>({ status: "", device: "", user: "", from: daysAgo(30), to: riyadhToday() });
  const [sessions, setSessions] = useState<PosSession[] | null>(null);
  const [devices, setDevices] = useState<PosDevice[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    const result = await listPosSessions({
      status: filters.status || null, device_id: filters.device || null, user_id: filters.user || null,
      date_from: filters.from || null, date_to: filters.to || null, limit: 500,
    });
    setBusy(false);
    if (result.error) { setError(posErrorText(result.error, t)); setSessions([]); return; }
    setError("");
    setSessions(result.data ?? []);
  }, [filters, t]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    (async () => {
      const result = await listPosDevices();
      if (!result.error) setDevices(result.data ?? []);
    })();
  }, []);

  const users = useMemo(() => {
    const map = new Map<string, string>();
    (sessions ?? []).forEach((s) => map.set(s.user_id, s.user_name ?? s.user_id.slice(0, 8)));
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], "ar"));
  }, [sessions]);

  const totals = useMemo(() => (sessions ?? []).reduce((acc, s) => ({
    count: acc.count + 1,
    open: acc.open + (s.status === "open" ? 1 : 0),
    sales: acc.sales + (s.sales_total ?? 0),
    returns: acc.returns + (s.returns_total ?? 0),
    shortage: acc.shortage + Math.min(s.difference ?? 0, 0),
    surplus: acc.surplus + Math.max(s.difference ?? 0, 0),
  }), { count: 0, open: 0, sales: 0, returns: 0, shortage: 0, surplus: 0 }), [sessions]);

  const exportCsv = () => {
    if (!sessions?.length) return;
    const head = ["الجلسة", "الحالة", "الجهاز", "النوع", "الكاشير", "الفتح", "الإغلاق", "الفواتير", "المبيعات", "المرتجعات", "الافتتاح", "المتوقع", "المعدود", "الفرق", "الباقي"];
    const rows = sessions.map((s) => [
      s.session_number, s.status === "open" ? "مفتوحة" : "مغلقة", s.device_name, deviceTypeLabel(s.device_type), s.user_name ?? "",
      fmtDate(s.opened_at), s.closed_at ? fmtDate(s.closed_at) : "", s.sales_count ?? 0, (s.sales_total ?? 0).toFixed(2),
      (s.returns_total ?? 0).toFixed(2), s.opening_balance.toFixed(2), (s.expected_cash ?? 0).toFixed(2),
      s.counted_cash === null ? "" : s.counted_cash.toFixed(2), s.difference === null ? "" : s.difference.toFixed(2),
      s.remaining_cash === null ? "" : s.remaining_cash.toFixed(2),
    ]);
    const csv = "﻿" + [head, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `pos-sessions-${filters.from || "all"}-${filters.to || "all"}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <Layout>
      <main dir={direction} className="space-y-5">
        <PosHeader
          icon={History}
          title="جلسات نقاط البيع"
          description="كل جلسة من فتحها إلى إغلاقها: مبيعاتها ومرتجعاتها ونقدها المتوقع والمعدود، وتقريرا X وZ."
          actions={
            <>
              <Link to="/pos"><PosButton variant="outline"><MonitorSmartphone className="h-4 w-4" />{t("الأجهزة")}</PosButton></Link>
              <PosButton variant="outline" onClick={exportCsv} disabled={!sessions?.length}><Download className="h-4 w-4" />{t("تصدير CSV")}</PosButton>
            </>
          }
        />
        <section className="grid gap-3 rounded-xl border bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-6">
          <label className={posLabel}>{t("الحالة")}
            <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as Filters["status"] }))} className={posSelect}>
              <option value="">{t("الكل")}</option><option value="open">{t("مفتوحة")}</option><option value="closed">{t("مغلقة")}</option>
            </select>
          </label>
          <label className={posLabel}>{t("الجهاز")}
            <select value={filters.device} onChange={(e) => setFilters((f) => ({ ...f, device: e.target.value }))} className={posSelect}>
              <option value="">{t("الكل")}</option>
              {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <label className={posLabel}>{t("الكاشير")}
            <select value={filters.user} onChange={(e) => setFilters((f) => ({ ...f, user: e.target.value }))} className={posSelect}>
              <option value="">{t("الكل")}</option>
              {users.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <label className={posLabel}>{t("من تاريخ")}
            <input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} className={posInput} />
          </label>
          <label className={posLabel}>{t("إلى تاريخ")}
            <input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} className={posInput} />
          </label>
          <div className="flex items-end">
            <PosButton variant="outline" className="h-10 w-full" onClick={() => void load()} busy={busy}><RefreshCw className="h-4 w-4" />{t("تحديث")}</PosButton>
          </div>
        </section>
        <ErrorNote message={error} />
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatPill label="الجلسات" value={String(totals.count)} />
          <StatPill label="المفتوحة" value={String(totals.open)} tone={totals.open ? "amber" : "slate"} />
          <StatPill label="المبيعات" value={money(totals.sales)} tone="teal" />
          <StatPill label="المرتجعات" value={money(totals.returns)} />
          <StatPill label="العجز" value={money(Math.abs(totals.shortage))} tone={totals.shortage ? "red" : "slate"} />
          <StatPill label="الزيادة" value={money(totals.surplus)} />
        </div>
        <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3 text-start">{t("الجلسة")}</th>
                <th className="px-4 py-3 text-start">{t("الجهاز")}</th>
                <th className="px-4 py-3 text-start">{t("الكاشير")}</th>
                <th className="px-4 py-3 text-start">{t("الفتح")}</th>
                <th className="px-4 py-3 text-start">{t("الإغلاق")}</th>
                <th className="px-4 py-3">{t("الفواتير")}</th>
                <th className="px-4 py-3">{t("المبيعات")}</th>
                <th className="px-4 py-3">{t("المرتجعات")}</th>
                <th className="px-4 py-3">{t("المتوقع")}</th>
                <th className="px-4 py-3">{t("المعدود")}</th>
                <th className="px-4 py-3">{t("الفرق")}</th>
              </tr>
            </thead>
            <tbody>
              {sessions === null ? (
                <tr><td colSpan={11} className="px-4 py-10 text-center text-slate-500">{t("جاري التحميل...")}</td></tr>
              ) : sessions.length === 0 ? (
                <tr><td colSpan={11} className="px-4 py-10 text-center text-slate-500">{t("لا جلسات بهذه التصفية")}</td></tr>
              ) : sessions.map((s) => (
                <tr key={s.id} className="border-t hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link to={`/pos/sessions/${s.id}`} className="font-bold text-[#0f6b63] hover:underline"><Code>{s.session_number}</Code></Link>
                    <span className={cn("ms-2 rounded-full px-2 py-0.5 text-[10px] font-bold",
                      s.status === "open" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600")}>
                      {t(s.status === "open" ? "مفتوحة" : "مغلقة")}
                    </span>
                  </td>
                  <td className="px-4 py-3">{s.device_name} <span className="text-xs text-slate-400">({t(deviceTypeLabel(s.device_type))})</span></td>
                  <td className="px-4 py-3">{s.user_name ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">{fmtDate(s.opened_at)}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">{s.closed_at ? fmtDate(s.closed_at) : "—"}</td>
                  <td className={cn("px-4 py-3 text-center", num)}>{s.sales_count ?? 0}</td>
                  <td className={cn("px-4 py-3 text-center font-semibold", num)}>{money(s.sales_total ?? 0)}</td>
                  <td className={cn("px-4 py-3 text-center", num)}>{(s.returns_total ?? 0) > 0 ? money(s.returns_total ?? 0) : "—"}</td>
                  <td className={cn("px-4 py-3 text-center", num)}>{money(s.expected_cash ?? 0)}</td>
                  <td className={cn("px-4 py-3 text-center", num)}>{s.counted_cash === null ? "—" : money(s.counted_cash)}</td>
                  <td className={cn("px-4 py-3 text-center font-semibold", num,
                    (s.difference ?? 0) < 0 ? "text-red-700" : (s.difference ?? 0) > 0 ? "text-amber-700" : "text-slate-500")}>
                    {s.difference === null ? "—" : s.difference === 0 ? t("مطابق") : money(s.difference)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </Layout>
  );
}
