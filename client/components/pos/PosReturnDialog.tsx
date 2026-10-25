import { useEffect, useState } from "react";
import { PackageCheck, RotateCcw, Search, Send } from "lucide-react";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  beginRequest, createPosReturn, endRequest, isQuantityText, loadPosReceipt, outcomeUnknown, pendingRequest, posErrorText, sendToZatca, toCents,
  type PosReceipt, type PosSession, type ReturnResult,
} from "@/lib/pos";
import { Code, ErrorNote, PosButton, PosModal, num, posInput, posLabel, useMoney } from "@/components/pos/PosUi";

type LineInput = { quantity: string; restock: boolean };

/**
 * المرتجع من شاشة البيع: فاتورة نقطة بيع ← الكميات المرتجعة لكل بند (وهل تعود للمخزون) ← إشعار دائن عادي،
 * ثم رد ما زاد عن الفاتورة (حتى قيمة الإشعار) نقدًا أو للبطاقة. فاتورة عليها إشعار تخفيض سعر تُرجع من الإشعارات الدائنة.
 */
export default function PosReturnDialog({
  session,
  initialInvoice,
  zatcaAllowed,
  onClose,
  onDone,
}: {
  session: PosSession;
  initialInvoice?: string;
  /** المرحلة الثانية: أُكّد الإرسال الفعلي في هذه الجلسة */
  zatcaAllowed: () => Promise<boolean>;
  onClose: () => void;
  onDone: (result: ReturnResult, receipt: PosReceipt) => void;
}) {
  const { t } = useI18n();
  const money = useMoney();
  const [invoiceId, setInvoiceId] = useState(initialInvoice ?? "");
  const [receipt, setReceipt] = useState<PosReceipt | null>(null);
  const [inputs, setInputs] = useState<Record<number, LineInput>>({});
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState<"cash" | "card">("cash");
  const [error, setError] = useState("");
  const [needsZatca, setNeedsZatca] = useState(false);
  const [busy, setBusy] = useState(false);
  // مرتجع سابق لهذه الفاتورة لم تُعرف نتيجته (انقطع الاتصال): يُحسم بإعادته نفسه
  const [pending, setPending] = useState<ReturnType<typeof pendingRequest>>(null);
  const scopeFor = (invoice: string) => `return-${session.id}-${invoice}`;

  const load = async (id = invoiceId) => {
    const value = id.trim();
    if (!value) return;
    setBusy(true);
    setError("");
    setNeedsZatca(false);
    const result = await loadPosReceipt(value);
    setBusy(false);
    if (result.error || !result.data) { setReceipt(null); setError(posErrorText(result.error ?? "", t)); return; }
    setReceipt(result.data);
    setPending(pendingRequest(scopeFor(result.data.invoice.id)));
    setInputs(Object.fromEntries(result.data.lines.map((line) => [line.index, { quantity: "", restock: line.stock }])));
    // الرد بالطريقة التي قُبض بها أكثر
    setMethod(session.card_account_code && result.data.refundable.card > result.data.refundable.cash ? "card" : "cash");
  };

  // تحميل الفاتورة الممرّرة من قائمة فواتير الجلسة
  useEffect(() => {
    if (initialInvoice) void load(initialInvoice);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lines = receipt?.lines ?? [];
  const picked = lines
    .map((line) => {
      const input = inputs[line.index];
      // فارغ أو صفر: البند لا يُرجع
      if (!input || !input.quantity.trim() || (/^[0.]+$/.test(input.quantity.trim()) && Number(input.quantity) === 0)) return null;
      const quantity = Number(input.quantity);
      if (!isQuantityText(input.quantity) || quantity > line.returnable) return { line, input, quantity, invalid: true, netCents: 0 };
      // خصم البند بتقريب تراكمي كما في الخادم: خصم الكمية المرتجعة حتى الآن ناقصًا ما رُد قبلها
      const discountCents = line.discount > 0
        ? Math.round((toCents(line.discount) * (line.returned + quantity)) / line.quantity) - Math.round((toCents(line.discount) * line.returned) / line.quantity)
        : 0;
      const netCents = Math.round(quantity * toCents(line.unit_price)) - discountCents;
      return { line, input, quantity, invalid: false, netCents };
    })
    .filter(Boolean) as Array<{ line: PosReceipt["lines"][number]; input: LineInput; quantity: number; invalid: boolean; netCents: number }>;
  const invalid = picked.some((p) => p.invalid);
  const subtotalCents = picked.reduce((sum, p) => sum + p.netCents, 0);
  const totalCents = subtotalCents + Math.round((subtotalCents * 15) / 100);
  const paidCents = toCents(receipt?.invoice.paid ?? 0);
  const effectiveCents = receipt ? toCents(receipt.invoice.adjusted_total ?? receipt.invoice.total) : 0;
  // يُكمل إرجاع كل كميات الفاتورة: تُقفل ويُرد المدفوع حتى ما بقي من قيمتها (فرق تقريب الضريبة بالهللات يقيّده الخادم)
  const completes = !invalid && picked.length > 0
    && lines.every((line) => line.returnable === (picked.find((p) => p.line.index === line.index)?.quantity ?? 0));
  // وإلا: ما دُفع زائدًا عن الفاتورة بعد المرتجع، حتى قيمة الإشعار
  const refundCents = completes ? Math.min(paidCents, effectiveCents) : Math.min(Math.max(paidCents - Math.max(effectiveCents - totalCents, 0), 0), totalCents);
  // بالطريقة المختارة حتى ما قُبض بها، والباقي بالأخرى حتى ما قُبض بها (كما في الخادم)
  const other: "cash" | "card" = method === "cash" ? "card" : "cash";
  const firstCents = receipt ? Math.min(refundCents, toCents(receipt.refundable[method] ?? 0)) : 0;
  const secondCents = receipt && !(other === "card" && !session.card_account_code)
    ? Math.min(refundCents - firstCents, toCents(receipt.refundable[other] ?? 0)) : 0;
  const uncoveredCents = refundCents - firstCents - secondCents;
  const blocked = Boolean(receipt?.return_expired || receipt?.has_adjustments);

  const submit = async () => {
    if (!receipt) return;
    const scope = scopeFor(receipt.invoice.id);
    let payload: Record<string, unknown>;
    if (pending) payload = pending.payload;
    else {
      if (picked.length === 0) { setError(t("حدّد كمية بند واحد على الأقل")); return; }
      if (invalid) { setError(t("الكمية أكبر من المتبقي القابل للإرجاع من البند")); return; }
      if (/[<>&]/.test(reason)) { setError(t("سبب المرتجع لا يقبل الرموز < > &")); return; }
      payload = {
        session_id: session.id,
        invoice_id: receipt.invoice.id,
        reason: reason.trim() || null,
        refund_method: method,
        lines: picked.map((p) => ({ line_index: p.line.index, quantity: p.quantity, restock: p.line.stock ? p.input.restock : false })),
      };
    }
    setBusy(true);
    setError("");
    setNeedsZatca(false);
    const attempt = beginRequest(scope, payload);
    const result = await createPosReturn({ ...attempt.payload, client_request_id: attempt.id });
    setBusy(false);
    if (result.error || !result.data) {
      if (outcomeUnknown(result, attempt.resumed)) {
        setPending(pendingRequest(scope));
        setError(t("انقطع الاتصال ولم يُعرف إن تمّ المرتجع. أعد المحاولة: يُرسل المرتجع نفسه، فإن كان سُجّل لا يتكرر."));
        return;
      }
      endRequest(scope);
      setPending(null);
      if (/SALES_NOTE_ORIGINAL_NOT_ACCEPTED/.test(result.error ?? "")) setNeedsZatca(true);
      setError(posErrorText(result.error ?? "", t));
      return;
    }
    endRequest(scope);
    setPending(null);
    onDone(result.data, receipt);
  };

  const sendInvoice = async () => {
    if (!receipt) return;
    if (!(await zatcaAllowed())) return;
    setBusy(true);
    const sent = await sendToZatca({ invoiceId: receipt.invoice.id });
    setBusy(false);
    if (!sent.ok) { setError(`${t("تعذر إرسال الفاتورة إلى الهيئة")}: ${sent.message}`); return; }
    setNeedsZatca(false);
    setError("");
    await load(receipt.invoice.id);
  };

  return (
    <PosModal
      title="مرتجع"
      onClose={onClose}
      busy={busy}
      size="lg"
      footer={receipt ? (
        <>
          <PosButton variant="outline" onClick={onClose} disabled={busy}>{t("إلغاء")}</PosButton>
          {pending ? (
            <>
              <PosButton variant="danger" disabled={busy} onClick={() => { endRequest(scopeFor(receipt.invoice.id)); setPending(null); setError(""); }}
                title={t("تحقق من إشعارات الفاتورة أولًا: إن كان سُجّل فالمرتجع الجديد يكرره")}>
                {t("تجاهل المحاولة")}
              </PosButton>
              <PosButton onClick={submit} busy={busy}><RotateCcw className="h-4 w-4" />{t("إعادة المحاولة")}</PosButton>
            </>
          ) : (
            <PosButton onClick={submit} busy={busy} disabled={picked.length === 0 || invalid || blocked}>
              <RotateCcw className="h-4 w-4" />{t("تنفيذ المرتجع")}
            </PosButton>
          )}
        </>
      ) : undefined}
    >
      <div className="space-y-4">
        <div className="flex items-end gap-2">
          <label className={cn(posLabel, "flex-1")}>{t("رقم الفاتورة")}
            <div className="relative">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void load(); } }}
                className={cn(posInput, "ps-9 text-left", num)} dir="ltr" placeholder="1001-INV-000123" autoFocus={!initialInvoice} />
            </div>
          </label>
          <PosButton variant="outline" onClick={() => void load()} busy={busy && !receipt}>{t("بحث")}</PosButton>
        </div>

        {receipt && (
          <>
            <div className="grid gap-2 rounded-xl border bg-slate-50 p-3 text-sm sm:grid-cols-4">
              <div><span className="block text-xs text-slate-500">{t("الفاتورة")}</span><b><Code>{receipt.invoice.id}</Code></b></div>
              <div><span className="block text-xs text-slate-500">{t("العميل")}</span><b>{receipt.invoice.customer}</b></div>
              <div><span className="block text-xs text-slate-500">{t("الإجمالي")}</span><b className={num}>{money(receipt.invoice.total)}</b></div>
              <div><span className="block text-xs text-slate-500">{t("المدفوع")}</span><b className={num}>{money(receipt.invoice.paid)}</b></div>
            </div>
            {pending && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm leading-7 text-amber-900">
                <p className="font-semibold">{t("مرتجع سابق لهذه الفاتورة لم تُعرف نتيجته (انقطع الاتصال)")}</p>
                <p>{t("«إعادة المحاولة» ترسله نفسه: إن كان سُجّل لا يتكرر، وإلا يُنفَّذ الآن. «تجاهل المحاولة» بعد التحقق من إشعارات الفاتورة فقط.")}</p>
              </div>
            )}
            {!pending && receipt.return_expired && <ErrorNote message={t("انتهت مدة المرتجع المسموحة في الإعدادات")} />}
            {!pending && receipt.has_adjustments && (
              <ErrorNote message={t("على الفاتورة إشعار تخفيض سعر أو إشعار مدين؛ أصدر المرتجع من المبيعات ← الإشعارات الدائنة")} />
            )}
            {!pending && (<>
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-start">{t("البند")}</th>
                    <th className="px-3 py-2">{t("المباع")}</th>
                    <th className="px-3 py-2">{t("أُرجع")}</th>
                    <th className="px-3 py-2">{t("السعر")}</th>
                    <th className="px-3 py-2">{t("الكمية المرتجعة")}</th>
                    <th className="px-3 py-2">{t("للمخزون")}</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => {
                    const input = inputs[line.index] ?? { quantity: "", restock: line.stock };
                    const bad = input.quantity.trim() !== "" && (!isQuantityText(input.quantity) || Number(input.quantity) > line.returnable);
                    return (
                      <tr key={line.index} className="border-t">
                        <td className="px-3 py-2"><b>{line.description}</b>{line.discount > 0 && <span className="block text-xs text-slate-500">{t("خصم")} {money(line.discount)}</span>}</td>
                        <td className={cn("px-3 py-2 text-center", num)}>{line.quantity}</td>
                        <td className={cn("px-3 py-2 text-center", num)}>{line.returned}</td>
                        <td className={cn("px-3 py-2 text-center", num)}>{money(line.unit_price)}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            <input value={input.quantity} disabled={line.returnable <= 0} inputMode="decimal"
                              onChange={(e) => setInputs((map) => ({ ...map, [line.index]: { ...input, quantity: e.target.value } }))}
                              className={cn("h-9 w-20 rounded-lg border px-2 text-center", num, bad ? "border-red-400 bg-red-50" : "border-slate-300")} dir="ltr" />
                            {line.returnable > 0 && (
                              <button type="button" onClick={() => setInputs((map) => ({ ...map, [line.index]: { ...input, quantity: String(line.returnable) } }))}
                                className="rounded px-1.5 py-1 text-xs font-semibold text-[#0f6b63] hover:bg-[#e6f2f0]">{t("الكل")}</button>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-center">
                          {line.stock ? (
                            <label className="inline-flex items-center gap-1 text-xs" title={t("ألغِ الاختيار للصنف التالف: لا تعود كميته للمخزون")}>
                              <input type="checkbox" checked={input.restock} onChange={(e) => setInputs((map) => ({ ...map, [line.index]: { ...input, restock: e.target.checked } }))} />
                              <PackageCheck className="h-4 w-4 text-slate-500" />
                            </label>
                          ) : <span className="text-xs text-slate-400">{t("خدمة")}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={posLabel}>{t("سبب المرتجع")}
                <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} className={posInput} placeholder={t("مثل: عيب في الصنف، تغيير رأي العميل")} />
              </label>
              <div>
                <span className={posLabel}>{t("رد المبلغ")}</span>
                <div className="mt-1 flex gap-2">
                  {(["cash", "card"] as const).map((m) => (
                    <button key={m} type="button" onClick={() => setMethod(m)} disabled={m === "card" && !session.card_account_code}
                      className={cn("flex-1 rounded-lg border px-2 py-2 text-xs font-semibold disabled:opacity-40",
                        method === m ? "border-[#0f6b63] bg-[#e6f2f0] text-[#0b5751]" : "border-slate-300 text-slate-600")}>
                      {t(m === "cash" ? "نقدًا" : "للبطاقة")}
                      <span className={cn("block text-[10px] font-normal opacity-75", num)}>{t("المقبوض")} {money(receipt.refundable[m] ?? 0)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-900 px-4 py-3 text-white">
              <span className="text-sm opacity-80">{t("إجمالي المرتجع (تقريبي حتى التنفيذ)")}</span>
              <span className={cn("text-xl font-extrabold", num)}>{money(totalCents / 100)}</span>
              <span className="w-full text-xs opacity-70">
                {refundCents <= 0
                  ? t("لا رد: المرتجع يُنقص المتبقي على الفاتورة")
                  : [
                    firstCents + (uncoveredCents > 0 ? uncoveredCents : 0) > 0 ? `${t(method === "card" ? "يُرد للبطاقة" : "يُرد نقدًا")}: ${money((firstCents + Math.max(uncoveredCents, 0)) / 100)}` : "",
                    secondCents > 0 ? `${t(other === "card" ? "يُرد للبطاقة" : "يُرد نقدًا")}: ${money(secondCents / 100)}` : "",
                  ].filter(Boolean).join(" — ")}
                {!completes && refundCents > 0 && refundCents < totalCents ? ` — ${t("والباقي يُنقص المتبقي على الفاتورة")}` : ""}
                {completes ? ` — ${t("يُكمل إرجاع الفاتورة كلها")}` : ""}
              </span>
            </div>
            {uncoveredCents > 0 && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-6 text-amber-900">
                {t("المردود أكبر مما قُبض على الفاتورة بالنقد والبطاقة معًا")} ({money((firstCents + secondCents) / 100)}) — {t("يردّه من له إدارة المرتجع.")}
              </p>
            )}
            </>)}
          </>
        )}
        <ErrorNote message={error} />
        {needsZatca && receipt && (
          <PosButton variant="outline" onClick={sendInvoice} busy={busy}><Send className="h-4 w-4" />{t("إرسال الفاتورة للهيئة الآن")}</PosButton>
        )}
      </div>
    </PosModal>
  );
}
