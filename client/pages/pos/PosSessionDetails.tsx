import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowRight, LockKeyhole, Play, Printer, ReceiptText, Trash2 } from "lucide-react";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import { posPermissionLevel } from "@/lib/authSession";
import {
  METHOD_LABELS, MOVEMENT_LABELS, clearOrders, deletePosSession, isoLtr, deviceTypeLabel, loadOrders, loadPosReceipt,
  loadSessionReport, posErrorText, type SessionReport,
} from "@/lib/pos";
import { printSaleReceipt, printSessionReport } from "@/lib/posPrint";
import { Code, ErrorNote, PosButton, PosCard, PosConfirm, PosHeader, StatPill, num, useMoney, usePosDate } from "@/components/pos/PosUi";
import PosCloseDialog from "@/components/pos/PosCloseDialog";

type Tab = "invoices" | "returns" | "movements" | "items";

/** تفاصيل الجلسة: ملخصها (X حيًا أو Z المحفوظ) وفواتيرها ومرتجعاتها وحركات نقدها وأصنافها، والطباعة والإغلاق */
export default function PosSessionDetails() {
  const { id = "" } = useParams();
  const { t, direction, formatNumber, formatDate } = useI18n();
  const money = useMoney();
  const fmtDate = usePosDate();
  const navigate = useNavigate();
  const format = useMemo(() => ({ t, direction, formatNumber, formatDate }), [t, direction, formatNumber, formatDate]);
  const { permissions } = useRolePermissions();
  const sessionsManage = posPermissionLevel(permissions, ["pos.sessions"]) === "manage";

  const [report, setReport] = useState<SessionReport | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("invoices");
  const [closing, setClosing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await loadSessionReport(id);
    if (result.error || !result.data) { setError(posErrorText(result.error ?? "", t)); return; }
    setError("");
    setReport(result.data);
  }, [id, t]);

  useEffect(() => { void load(); }, [load]);

  if (!report) {
    return (
      <Layout>
        <main dir={direction} className="space-y-4">
          <Link to="/pos/sessions" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:underline">
            <ArrowRight className={cn("h-4 w-4", direction === "ltr" && "rotate-180")} />{t("جلسات نقاط البيع")}
          </Link>
          <ErrorNote message={error} />
          {!error && <div className="rounded-xl border bg-white p-10 text-center text-slate-500">{t("جاري التحميل...")}</div>}
        </main>
      </Layout>
    );
  }

  const session = report.session;
  const s = report.summary;
  const close = report.close;
  const isOpen = session.status === "open";
  const canClose = isOpen && (session.mine || sessionsManage);
  const empty = s.sales_count === 0 && s.returns_count === 0 && report.movements.length === 0;

  const reprint = async (invoiceId: string) => {
    const result = await loadPosReceipt(invoiceId);
    if (result.error || !result.data) { toast({ title: t("تعذر تجهيز الإيصال"), description: posErrorText(result.error ?? "", t), variant: "destructive" }); return; }
    await printSaleReceipt(result.data, format, { copy: true });
  };

  const remove = async () => {
    setBusy(true);
    const result = await deletePosSession(session.id);
    setBusy(false);
    if (result.error) { toast({ title: t("تعذر الحذف"), description: posErrorText(result.error, t), variant: "destructive" }); return; }
    toast({ title: t("حُذفت الجلسة"), description: isoLtr(session.session_number) });
    navigate("/pos", { replace: true });
  };

  const tabs: Array<[Tab, string, number]> = [
    ["invoices", "الفواتير", report.invoices.length],
    ["returns", "المرتجعات", report.returns.length],
    ["movements", "حركات النقد", report.movements.length],
    ["items", "الأصناف", s.items.length],
  ];

  return (
    <Layout>
      <main dir={direction} className="space-y-5">
        <Link to="/pos/sessions" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:underline">
          <ArrowRight className={cn("h-4 w-4", direction === "ltr" && "rotate-180")} />{t("جلسات نقاط البيع")}
        </Link>
        <PosHeader
          icon={ReceiptText}
          title={`${t("الجلسة")} ${isoLtr(session.session_number)}`}
          description={`${session.device_name} (${t(deviceTypeLabel(session.device_type))}) — ${session.user_name ?? "—"} — ${t(isOpen ? "مفتوحة" : "مغلقة")}`}
          actions={
            <>
              <PosButton variant="outline" onClick={() => printSessionReport(report, format)}>
                <Printer className="h-4 w-4" />{t(isOpen ? "طباعة تقرير X" : "طباعة تقرير Z")}
              </PosButton>
              {isOpen && session.mine && <PosButton variant="outline" onClick={() => navigate("/pos/sell")}><Play className="h-4 w-4" />{t("متابعة البيع")}</PosButton>}
              {isOpen && empty && canClose && <PosButton variant="danger" onClick={() => setDeleting(true)}><Trash2 className="h-4 w-4" />{t("حذف الجلسة")}</PosButton>}
              {canClose && <PosButton onClick={() => setClosing(true)}><LockKeyhole className="h-4 w-4" />{t("إغلاق الجلسة")}</PosButton>}
            </>
          }
        />
        <ErrorNote message={error} />

        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatPill label="إجمالي المبيعات" value={money(s.total)} tone="teal" />
          <StatPill label="المرتجعات" value={money(s.returns_total)} />
          <StatPill label="صافي المبيعات" value={money(s.net_total)} tone="teal" />
          <StatPill label="صافي الضريبة" value={money(s.net_tax)} />
          <StatPill label={isOpen ? "النقد المتوقع الآن" : "النقد المتوقع"} value={money(close ? close.expected_cash : s.expected_cash)} />
          {close ? (
            <StatPill label={close.difference === 0 ? "المعدود (مطابق)" : close.difference < 0 ? "العجز" : "الزيادة"}
              value={close.difference === 0 ? money(close.counted_cash) : money(Math.abs(close.difference))}
              tone={close.difference < 0 ? "red" : close.difference > 0 ? "amber" : "slate"} />
          ) : (
            <StatPill label="إجمالي البطاقة" value={money(s.card_total)} />
          )}
        </div>
        {isOpen && report.ledger_balance !== null && Math.round(report.ledger_balance * 100) !== Math.round(s.expected_cash * 100) && (
          <ErrorNote message={`${t("رصيد حساب الجلسة في الدفتر لا يطابق حركاتها")}: ${t("الدفتر")} ${money(report.ledger_balance)} — ${t("الحركات")} ${money(s.expected_cash)}`} />
        )}

        <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
          <section className="overflow-hidden rounded-xl border bg-white shadow-sm">
            <div className="flex gap-1 overflow-x-auto border-b px-3 pt-2">
              {tabs.map(([key, label, count]) => (
                <button key={key} type="button" onClick={() => setTab(key)}
                  className={cn("shrink-0 rounded-t-lg px-4 py-2 text-sm font-semibold",
                    tab === key ? "border border-b-0 bg-white text-slate-900" : "text-slate-500 hover:text-slate-800")}>
                  {t(label)} <span className={cn("text-xs text-slate-400", num)}>({count})</span>
                </button>
              ))}
            </div>
            <div className="overflow-x-auto">
              {tab === "invoices" && (
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr><th className="px-4 py-2 text-start">{t("الفاتورة")}</th><th className="px-4 py-2 text-start">{t("الوقت")}</th><th className="px-4 py-2 text-start">{t("العميل")}</th>
                      <th className="px-4 py-2">{t("الإجمالي")}</th><th className="px-4 py-2">{t("الدفع")}</th><th className="px-4 py-2">{t("المرتجع")}</th><th className="px-4 py-2" /></tr>
                  </thead>
                  <tbody>
                    {report.invoices.length === 0 ? <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">{t("لا فواتير")}</td></tr> : report.invoices.map((inv) => (
                      <tr key={inv.invoice_id} className="border-t">
                        <td className="px-4 py-2 font-semibold"><Code>{inv.invoice_id}</Code>
                          {inv.invoice_type === "standard" && <span className="ms-1 rounded bg-indigo-50 px-1.5 text-[10px] text-indigo-700">{t("ضريبية")}</span>}
                        </td>
                        <td className="px-4 py-2 text-xs text-slate-500">{fmtDate(inv.created_at, { timeStyle: "short" })}</td>
                        <td className="px-4 py-2">{inv.customer}</td>
                        <td className={cn("px-4 py-2 text-center font-bold", num)}>{money(inv.total)}</td>
                        <td className="px-4 py-2 text-center text-xs">
                          {[inv.paid_cash > 0 ? `${t("نقد")} ${money(inv.paid_cash)}` : "", inv.paid_card > 0 ? `${t("بطاقة")} ${money(inv.paid_card)}` : "",
                            inv.on_account > 0 ? `${t("على الحساب")} ${money(inv.on_account)}` : ""].filter(Boolean).join(" + ")}
                        </td>
                        <td className={cn("px-4 py-2 text-center", num, inv.returned_total > 0 && "text-red-700")}>{inv.returned_total > 0 ? money(inv.returned_total) : "—"}</td>
                        <td className="px-4 py-2 text-end">
                          <button type="button" onClick={() => void reprint(inv.invoice_id)} className="rounded p-1.5 text-slate-600 hover:bg-slate-100" title={t("إعادة طباعة الإيصال")}>
                            <Printer className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {tab === "returns" && (
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr><th className="px-4 py-2 text-start">{t("الإشعار")}</th><th className="px-4 py-2 text-start">{t("الفاتورة")}</th><th className="px-4 py-2 text-start">{t("الوقت")}</th>
                      <th className="px-4 py-2">{t("الإجمالي")}</th><th className="px-4 py-2">{t("المردود")}</th><th className="px-4 py-2 text-start">{t("السبب")}</th></tr>
                  </thead>
                  <tbody>
                    {report.returns.length === 0 ? <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">{t("لا مرتجعات")}</td></tr> : report.returns.map((r) => (
                      <tr key={r.id} className="border-t">
                        <td className="px-4 py-2 font-semibold"><Code>{r.note_number}</Code></td>
                        <td className="px-4 py-2"><Code>{r.invoice_id}</Code></td>
                        <td className="px-4 py-2 text-xs text-slate-500">{fmtDate(r.created_at, { timeStyle: "short" })}</td>
                        <td className={cn("px-4 py-2 text-center font-bold", num)}>{money(r.total)}</td>
                        <td className="px-4 py-2 text-center text-xs">{r.refund_amount > 0 ? `${money(r.refund_amount)} (${t(METHOD_LABELS[r.refund_method] ?? r.refund_method)})` : t("بلا رد")}</td>
                        <td className="px-4 py-2 text-xs text-slate-600">{r.reason ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {tab === "movements" && (
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr><th className="px-4 py-2 text-start">{t("الوقت")}</th><th className="px-4 py-2 text-start">{t("الحركة")}</th><th className="px-4 py-2">{t("الطريقة")}</th>
                      <th className="px-4 py-2">{t("المبلغ")}</th><th className="px-4 py-2">{t("أثرها على النقد")}</th><th className="px-4 py-2 text-start">{t("الحساب / المرجع")}</th><th className="px-4 py-2">{t("القيد")}</th></tr>
                  </thead>
                  <tbody>
                    {report.movements.length === 0 ? <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">{t("لا حركات")}</td></tr> : report.movements.map((m) => (
                      <tr key={m.id} className="border-t">
                        <td className="px-4 py-2 text-xs text-slate-500">{fmtDate(m.created_at, { timeStyle: "short" })}</td>
                        <td className="px-4 py-2 font-semibold">{t(MOVEMENT_LABELS[m.kind] ?? m.kind)}
                          {m.customer && <span className="block text-xs font-normal text-slate-500">{m.customer}</span>}
                        </td>
                        <td className="px-4 py-2 text-center text-xs">{t(METHOD_LABELS[m.method] ?? m.method)}</td>
                        <td className={cn("px-4 py-2 text-center", num)}>{money(m.amount)}</td>
                        <td className={cn("px-4 py-2 text-center font-semibold", num, m.cash_effect < 0 ? "text-red-700" : m.cash_effect > 0 ? "text-emerald-700" : "text-slate-400")}>
                          {m.cash_effect === 0 ? "—" : `${m.cash_effect > 0 ? "+" : "−"}${money(Math.abs(m.cash_effect))}`}
                        </td>
                        <td className="px-4 py-2 text-xs text-slate-600">
                          {m.account_code ? <span className={num}>{m.account_code}</span> : null} {m.account_name ?? ""}
                          {(m.reference || m.invoice_id) && <span className="block text-slate-400">{[m.invoice_id, m.reference].filter(Boolean).map((v) => <Code key={v} className="me-2">{v}</Code>)}</span>}
                          {m.note && <span className="block text-slate-500">{m.note}</span>}
                        </td>
                        <td className="px-4 py-2 text-center text-xs">{m.entry_number ? <Code>{m.entry_number}</Code> : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {tab === "items" && (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr><th className="px-4 py-2 text-start">{t("الصنف")}</th><th className="px-4 py-2">{t("الكمية")}</th><th className="px-4 py-2">{t("الصافي قبل الضريبة")}</th></tr>
                  </thead>
                  <tbody>
                    {s.items.length === 0 ? <tr><td colSpan={3} className="px-4 py-8 text-center text-slate-500">{t("لا أصناف")}</td></tr> : s.items.map((item) => (
                      <tr key={item.product_id ?? item.description} className="border-t">
                        <td className="px-4 py-2">{item.description}</td>
                        <td className={cn("px-4 py-2 text-center", num)}>{formatNumber(item.quantity)}</td>
                        <td className={cn("px-4 py-2 text-center font-semibold", num)}>{money(item.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <aside className="space-y-4">
            <PosCard title="النقد">
              <dl className="space-y-1.5 text-sm">
                {[
                  ["رصيد الافتتاح", s.opening_balance],
                  ["مبيعات نقدية", s.sales_cash],
                  ["قبض من العملاء نقدًا", s.receipts_cash],
                  ["إيداع من الخزينة", s.cash_in],
                  ["رد نقدي", -s.refunds_cash],
                  ["المصروفات", -s.expenses_total],
                  ["سحب إلى الخزينة", -s.cash_out],
                  ...(s.ledger_adjustment ? [["تسوية فرق الدفتر", s.ledger_adjustment] as [string, number]] : []),
                ].map(([label, value]) => (
                  <div key={label as string} className="flex justify-between"><dt className="text-slate-600">{t(label as string)}</dt><dd className={num}>{money(value as number)}</dd></div>
                ))}
                <div className="flex justify-between border-t pt-1.5 font-bold"><dt>{t("النقد المتوقع")}</dt><dd className={num}>{money(close ? close.expected_cash : s.expected_cash)}</dd></div>
                {close && (
                  <>
                    <div className="flex justify-between"><dt className="text-slate-600">{t("المعدود")}</dt><dd className={num}>{money(close.counted_cash)}</dd></div>
                    {close.difference !== 0 && (
                      <div className={cn("flex justify-between font-semibold", close.difference < 0 ? "text-red-700" : "text-amber-700")}>
                        <dt>{t(close.difference < 0 ? "العجز" : "الزيادة")}</dt><dd className={num}>{money(Math.abs(close.difference))}</dd>
                      </div>
                    )}
                    {close.handovers.map((h) => (
                      <div key={h.account_code} className="flex justify-between"><dt className="text-slate-600">{t("تسليم إلى")} {h.name}</dt><dd className={num}>{money(h.amount)}</dd></div>
                    ))}
                    <div className="flex justify-between border-t pt-1.5 font-bold">
                      <dt>{t(close.remaining_place === "box" ? "الباقي في الصندوق" : "الباقي عهدة مع الموظف")}</dt><dd className={num}>{money(close.remaining_cash)}</dd>
                    </div>
                  </>
                )}
              </dl>
            </PosCard>
            <PosCard title="الجلسة">
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between gap-3"><dt className="text-slate-600">{t("المستودع")}</dt><dd>{session.warehouse_name ?? "—"}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-slate-600">{t("حساب النقد")}</dt><dd className="text-end"><span className={num}>{session.cash_account_code}</span> {session.cash_account_name}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-slate-600">{t("حساب البطاقة")}</dt><dd className="text-end">{session.card_account_code ? <><span className={num}>{session.card_account_code}</span> {session.card_account_name}</> : "—"}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-slate-600">{t("الفتح")}</dt><dd className="text-end">{fmtDate(session.opened_at)}</dd></div>
                {session.opening_note && <div className="text-xs text-slate-500">{session.opening_note}</div>}
                {session.closed_at && <div className="flex justify-between gap-3"><dt className="text-slate-600">{t("الإغلاق")}</dt><dd className="text-end">{fmtDate(session.closed_at)}{session.closed_by_name ? ` — ${session.closed_by_name}` : ""}</dd></div>}
                {session.closing_note && <div className="text-xs text-slate-500">{session.closing_note}</div>}
                {s.rounding !== 0 && <div className="flex justify-between gap-3 text-xs"><dt className="text-slate-500">{t("هللات تقريب المرتجعات")}</dt><dd className={num}>{money(s.rounding)}</dd></div>}
              </dl>
            </PosCard>
          </aside>
        </div>

        {closing && (
          <PosCloseDialog sessionId={session.id} canSettleLedger={sessionsManage}
            parkedOrders={session.mine ? loadOrders(session.id).filter((o) => o.lines.length > 0).length : 0}
            onClose={() => setClosing(false)}
            onClosed={(closed) => {
              setClosing(false);
              if (closed.session.mine) clearOrders(closed.session.id);
              setReport(closed);
              printSessionReport(closed, format);
              toast({ title: t("أُغلقت الجلسة"), description: isoLtr(closed.session.session_number) });
            }} />
        )}
        {deleting && (
          <PosConfirm title="حذف الجلسة" message="الجلسة بلا أي عملية؛ تُحذف ويعود الجهاز متاحًا." confirmLabel="حذف" danger busy={busy}
            onConfirm={() => void remove()} onClose={() => setDeleting(false)} />
        )}
      </main>
    </Layout>
  );
}
