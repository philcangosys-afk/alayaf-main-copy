import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Coins, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  closePosSession, fromCents, isMoneyText, loadSessionReport, parseMoney, posErrorText, sessionPendingCount, toCents,
  type SessionReport, type TreasuryAccount,
} from "@/lib/pos";
import { Code, ErrorNote, PosButton, PosModal, num, posInput, posLabel, posSelect, useMoney } from "@/components/pos/PosUi";

/** فئات الريال للعدّ (اختياري): المعدود يُحسب منها */
const DENOMINATIONS = [500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.25, 0.1, 0.05];

type Handover = { key: number; account: string; amount: string };

/**
 * إغلاق الجلسة على ثلاث خطوات: الملخص، ثم عدّ النقد (المتوقع مقابل المعدود)، ثم تسليمه لخزينة أو أكثر.
 * العجز والزيادة يُقيّدان على حسابيهما في الإعدادات، وما لا يُسلَّم يبقى في الصندوق أو عهدة مع الموظف.
 */
export default function PosCloseDialog({
  sessionId,
  treasuryAccounts = [],
  canSettleLedger = false,
  parkedOrders = 0,
  onClose,
  onClosed,
}: {
  sessionId: string;
  /** احتياطي إن لم يرجع تقرير الجلسة حسابات التسليم */
  treasuryAccounts?: TreasuryAccount[];
  /** إدارة الجلسات: تسوية فرق الدفتر عند الإغلاق إن خالف رصيدُ الحساب حركاتِها */
  canSettleLedger?: boolean;
  /** طلبات معلّقة فيها بنود (في هذا المتصفح) تُحذف بالإغلاق */
  parkedOrders?: number;
  onClose: () => void;
  onClosed: (report: SessionReport) => void;
}) {
  const { t } = useI18n();
  const money = useMoney();
  const [report, setReport] = useState<SessionReport | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [counted, setCounted] = useState("");
  const [useCounter, setUseCounter] = useState(false);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [handovers, setHandovers] = useState<Handover[]>([]);
  const [note, setNote] = useState("");
  const [settle, setSettle] = useState(false);
  // محاولات لم تُعرف نتيجتها في هذا المتصفح (انقطع الاتصال): تُمحى بالإغلاق، فليراجعها قبله
  const [pendingAttempts] = useState(() => sessionPendingCount(sessionId));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const result = await loadSessionReport(sessionId);
      if (result.error || !result.data) { setError(posErrorText(result.error ?? "", t)); return; }
      setReport(result.data);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // حسابات التسليم من تقرير الجلسة (لمدير الجلسات ولو بلا صلاحية البيع)، والمشغولة بجلسة مفتوحة معطّلة
  const accounts = useMemo(
    () => (report?.treasury_accounts ?? treasuryAccounts).filter((a) => a.account_code !== report?.session.cash_account_code),
    [treasuryAccounts, report?.treasury_accounts, report?.session.cash_account_code],
  );
  const freeAccount = accounts.find((a) => !a.in_session)?.account_code ?? "";
  const nextKey = (list: Handover[]) => list.reduce((max, h) => Math.max(max, h.key), 0) + 1;

  const counterTotal = useMemo(
    () => DENOMINATIONS.reduce((sum, value) => sum + toCents(value) * (Number(counts[String(value)] || 0) || 0), 0),
    [counts],
  );
  useEffect(() => {
    if (useCounter) setCounted(fromCents(counterTotal).toFixed(2));
  }, [counterTotal, useCounter]);

  if (!report) {
    return (
      <PosModal title="إغلاق الجلسة" onClose={onClose}>
        <ErrorNote message={error} />
        {!error && <p className="py-8 text-center text-sm text-slate-500">{t("جاري التحميل...")}</p>}
      </PosModal>
    );
  }

  const s = report.summary;
  const movementsCents = toCents(report.session.expected_cash ?? s.expected_cash);
  // رصيد الدفتر يخالف حركات الجلسة (خلل نادر): لا تُغلق إلا بتسويته ممن له إدارة الجلسات، فيصير المتوقع رصيد الدفتر
  const ledgerCents = report.ledger_balance === null || report.ledger_balance === undefined ? null : toCents(report.ledger_balance);
  const mismatch = ledgerCents !== null && ledgerCents !== movementsCents;
  const expectedCents = mismatch && settle ? (ledgerCents ?? movementsCents) : movementsCents;
  const blockedByLedger = mismatch && !settle;
  const countedCents = parseMoney(counted);
  const diffCents = countedCents === null ? null : countedCents - expectedCents;
  const handoverCents = handovers.reduce((sum, h) => sum + (parseMoney(h.amount) ?? 0), 0);
  const remainingCents = (countedCents ?? 0) - handoverCents;
  const box = report.session.device_type === "cash_box";
  const handoverError = handovers.some((h) => !h.account || (h.amount.trim() && !isMoneyText(h.amount)))
    ? "اختر الحساب وأدخل مبلغًا صحيحًا لكل تسليم"
    : handoverCents > (countedCents ?? 0) ? "المسلَّم أكبر من النقد المعدود" : "";

  const submit = async () => {
    if (countedCents === null) { setError(t("أدخل النقد المعدود")); return; }
    if (handoverError) { setError(t(handoverError)); return; }
    setBusy(true);
    setError("");
    const result = await closePosSession(sessionId, {
      counted_cash: fromCents(countedCents),
      note: note.trim() || null,
      accept_ledger_difference: mismatch && settle,
      handovers: handovers.filter((h) => (parseMoney(h.amount) ?? 0) > 0).map((h) => ({ account_code: h.account, amount: Number(h.amount) })),
    });
    setBusy(false);
    if (result.error || !result.data) { setError(posErrorText(result.error ?? "", t)); return; }
    onClosed(result.data);
  };

  const line = (label: string, value: number, strong = false) => (
    <div className={cn("flex items-center justify-between py-1 text-sm", strong && "font-bold")}>
      <span className="text-slate-600">{t(label)}</span><span className={num}>{money(value)}</span>
    </div>
  );

  const steps = [
    { n: 1, label: "الملخص" },
    { n: 2, label: "عدّ النقد" },
    { n: 3, label: "التسليم والإغلاق" },
  ] as const;

  return (
    <PosModal
      title="إغلاق الجلسة"
      onClose={onClose}
      busy={busy}
      size="lg"
      footer={
        <>
          {step > 1 && <PosButton variant="outline" onClick={() => setStep((step - 1) as 1 | 2)} disabled={busy}>{t("السابق")}</PosButton>}
          {step < 3 ? (
            <PosButton disabled={blockedByLedger} onClick={() => { if (step === 2 && countedCents === null) { setError(t("أدخل النقد المعدود")); return; } setError(""); setStep((step + 1) as 2 | 3); }}>
              {t("التالي")}
            </PosButton>
          ) : (
            <PosButton onClick={submit} busy={busy} disabled={Boolean(handoverError) || blockedByLedger}>{t("إغلاق الجلسة")}</PosButton>
          )}
        </>
      }
    >
      <ol className="mb-4 flex gap-2">
        {steps.map((item) => (
          <li key={item.n} className={cn("flex-1 rounded-lg border px-3 py-2 text-center text-xs font-semibold",
            step === item.n ? "border-[#0f6b63] bg-[#e6f2f0] text-[#0b5751]" : step > item.n ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-500")}>
            {item.n}. {t(item.label)}
          </li>
        ))}
      </ol>
      <div className="mb-3 text-sm text-slate-600">
        {t("الجلسة")} <b><Code>{report.session.session_number}</Code></b> — {report.session.device_name} — {report.session.user_name ?? "—"}
      </div>

      {mismatch && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="flex items-start gap-2 font-semibold">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {t("رصيد حساب الجلسة في الدفتر لا يطابق حركاتها")}:
            <span className={num}>{t("الحركات")} {money(fromCents(movementsCents))} — {t("الدفتر")} {money(fromCents(ledgerCents ?? 0))}</span>
          </p>
          {canSettleLedger ? (
            <label className="mt-2 flex items-start gap-2 text-xs leading-6">
              <input type="checkbox" className="mt-1.5" checked={settle} onChange={(e) => setSettle(e.target.checked)} />
              {t("تسوية الفرق عند الإغلاق: تُسجَّل حركة «تسوية فرق الدفتر» بلا قيد، ويصير المتوقع رصيد الدفتر. راجع قيود الحساب لمعرفة سبب الفرق.")}
            </label>
          ) : (
            <p className="mt-1 text-xs leading-6">{t("لا تُغلق الجلسة حتى يسوّي الفرق من له صلاحية إدارة الجلسات.")}</p>
          )}
        </div>
      )}

      {step === 1 && (parkedOrders > 0 || pendingAttempts > 0) && (
        <div className="mb-3 space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {parkedOrders > 0 && (
            <p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t("طلبات معلّقة لم تُدفع تُحذف بإغلاق الجلسة")}: <b className={num}>{parkedOrders}</b></span></p>
          )}
          {pendingAttempts > 0 && (
            <p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t("عمليات انقطع الاتصال أثناءها ولم تُعرف نتيجتها؛ راجع فواتير الجلسة وحركاتها قبل الإغلاق")}: <b className={num}>{pendingAttempts}</b></span></p>
          )}
        </div>
      )}
      {step === 1 && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border p-4">
            <h3 className="mb-2 text-sm font-bold text-slate-900">{t("المبيعات")}</h3>
            {line("عدد الفواتير", s.sales_count)}
            {line("إجمالي المبيعات", s.total, true)}
            {line("نقد", s.sales_cash)}
            {line("بطاقة", s.sales_card)}
            {line("على الحساب", s.sales_on_account)}
            {line("المرتجعات", s.returns_total)}
            {line("صافي المبيعات بعد المرتجعات", s.net_total, true)}
          </div>
          <div className="rounded-xl border p-4">
            <h3 className="mb-2 text-sm font-bold text-slate-900">{t("النقد")}</h3>
            {line("رصيد الافتتاح", s.opening_balance)}
            {line("مبيعات نقدية", s.sales_cash)}
            {line("قبض من العملاء نقدًا", s.receipts_cash)}
            {line("إيداع من الخزينة", s.cash_in)}
            {line("رد نقدي", -s.refunds_cash)}
            {line("المصروفات", -s.expenses_total)}
            {line("سحب إلى الخزينة", -s.cash_out)}
            {mismatch && settle && line("تسوية فرق الدفتر", fromCents((ledgerCents ?? 0) - movementsCents))}
            {line("النقد المتوقع", fromCents(expectedCents), true)}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border bg-slate-50 p-3">
              <div className="text-xs text-slate-500">{t("النقد المتوقع")}</div>
              <div className={cn("text-xl font-bold text-slate-900", num)}>{money(fromCents(expectedCents))}</div>
            </div>
            <label className="rounded-xl border p-3">
              <span className="text-xs text-slate-500">{t("النقد المعدود")}</span>
              <input value={counted} onChange={(e) => { setUseCounter(false); setCounted(e.target.value); }} inputMode="decimal"
                className={cn(posInput, "text-left text-lg font-bold", num)} dir="ltr" autoFocus placeholder="0.00" />
            </label>
            <div className={cn("rounded-xl border p-3",
              diffCents === null ? "bg-slate-50" : diffCents === 0 ? "border-emerald-200 bg-emerald-50" : diffCents < 0 ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50")}>
              <div className="text-xs text-slate-500">{t("الفرق")}</div>
              <div className={cn("text-xl font-bold", num, diffCents === null ? "text-slate-400" : diffCents === 0 ? "text-emerald-700" : diffCents < 0 ? "text-red-700" : "text-amber-800")}>
                {diffCents === null ? "—" : diffCents === 0 ? t("مطابق") : `${t(diffCents < 0 ? "عجز" : "زيادة")} ${money(Math.abs(fromCents(diffCents)))}`}
              </div>
            </div>
          </div>
          {diffCents !== null && diffCents !== 0 && (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-6 text-slate-600">
              {t(diffCents < 0
                ? "العجز يُقيَّد على حساب العجز في إعدادات نقاط البيع (مدين العجز / دائن حساب الجلسة)."
                : "الزيادة تُقيَّد على حساب الزيادة في إعدادات نقاط البيع (مدين حساب الجلسة / دائن الزيادة).")}
            </p>
          )}
          <div>
            <button type="button" onClick={() => setUseCounter((v) => !v)} className="inline-flex items-center gap-2 text-sm font-semibold text-[#0f6b63] hover:underline">
              <Coins className="h-4 w-4" />{t(useCounter ? "إخفاء عدّ الفئات" : "العدّ بالفئات")}
            </button>
            {useCounter && (
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {DENOMINATIONS.map((value) => (
                  <label key={value} className="flex items-center gap-2 rounded-lg border px-2 py-1.5 text-sm">
                    <span className={cn("w-12 font-semibold text-slate-700", num)}>{value}</span>
                    <span className="text-slate-400">×</span>
                    <input value={counts[String(value)] ?? ""} inputMode="numeric"
                      onChange={(e) => setCounts((c) => ({ ...c, [String(value)]: e.target.value.replace(/[^0-9]/g, "") }))}
                      className={cn("h-8 w-full rounded border border-slate-300 px-2 text-left text-sm", num)} dir="ltr" />
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-900">{t("تسليم النقد للخزينة")}</h3>
            <div className="flex gap-2">
              {freeAccount && (
                <PosButton variant="outline" className="h-8 px-3 text-xs"
                  onClick={() => setHandovers([{ key: 1, account: freeAccount, amount: fromCents(countedCents ?? 0).toFixed(2) }])}>
                  {t("تسليم كل المعدود")}
                </PosButton>
              )}
              <PosButton variant="outline" className="h-8 px-3 text-xs" disabled={!freeAccount}
                onClick={() => setHandovers((list) => [...list, { key: nextKey(list), account: freeAccount, amount: "" }])}>
                <Plus className="h-3.5 w-3.5" />{t("تسليم")}
              </PosButton>
            </div>
          </div>
          {handovers.length === 0 && (
            <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-600">
              {t(box ? "بلا تسليم: يبقى النقد كله في الصندوق، وهو رصيد افتتاح الجلسة التالية." : "بلا تسليم: يبقى النقد كله عهدة مع الموظف.")}
            </p>
          )}
          {handovers.map((h) => (
            <div key={h.key} className="grid grid-cols-[1fr_140px_auto] items-end gap-2">
              <label className={posLabel}>{t("إلى")}
                <select value={h.account} onChange={(e) => setHandovers((list) => list.map((x) => (x.key === h.key ? { ...x, account: e.target.value } : x)))} className={posSelect}>
                  {accounts.map((a) => (
                    <option key={a.account_code} value={a.account_code} disabled={a.in_session}>
                      {a.account_code} — {a.name}{a.in_session ? ` (${t("عليه جلسة مفتوحة")})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className={posLabel}>{t("المبلغ")}
                <input value={h.amount} inputMode="decimal" onChange={(e) => setHandovers((list) => list.map((x) => (x.key === h.key ? { ...x, amount: e.target.value } : x)))}
                  className={cn(posInput, "text-left", num)} dir="ltr" />
              </label>
              <button type="button" onClick={() => setHandovers((list) => list.filter((x) => x.key !== h.key))} className="mb-1 rounded p-2 text-red-600 hover:bg-red-50" aria-label={t("حذف")}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <div className="grid gap-2 rounded-xl border bg-slate-50 p-3 text-sm sm:grid-cols-3">
            <div><span className="text-slate-500">{t("المعدود")}: </span><b className={num}>{money(fromCents(countedCents ?? 0))}</b></div>
            <div><span className="text-slate-500">{t("المسلَّم")}: </span><b className={num}>{money(fromCents(handoverCents))}</b></div>
            <div><span className="text-slate-500">{t(box ? "يبقى في الصندوق" : "يبقى عهدة")}: </span><b className={num}>{money(fromCents(remainingCents))}</b></div>
          </div>
          <label className={posLabel}>{t("ملاحظة الإغلاق")}
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className={posInput} />
          </label>
          {diffCents !== null && diffCents !== 0 && (
            <p className="flex items-center gap-2 text-xs text-slate-600"><CheckCircle2 className="h-4 w-4 text-slate-400" />
              {t(diffCents < 0 ? "سيُقيَّد العجز" : "ستُقيَّد الزيادة")}: <b className={num}>{money(Math.abs(fromCents(diffCents)))}</b>
            </p>
          )}
          <ErrorNote message={handoverError ? t(handoverError) : ""} />
        </div>
      )}
      <div className="mt-3"><ErrorNote message={error} /></div>
    </PosModal>
  );
}
