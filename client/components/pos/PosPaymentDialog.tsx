import { useEffect, useMemo, useState } from "react";
import { Banknote, CreditCard, Percent, Plus, Trash2, UserCheck } from "lucide-react";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { fromCents, isMoneyText, parseMoney, type CartTotals } from "@/lib/pos";
import { ErrorNote, PosButton, PosModal, num, useMoney } from "@/components/pos/PosUi";

export type PaymentRow = { key: number; method: "cash" | "card"; amount: string };
export type PaymentSubmit = { payments: Array<{ method: "cash" | "card"; amount: number }>; onAccount: boolean };

/** فئات تقريب النقد المستلم (أزرار سريعة) */
const ROUNDING = [5, 10, 50, 100, 500];

/**
 * الدفع: نقد أو بطاقة أو أكثر من سطر، والباقي للعميل من النقد فقط.
 * «تسوية»: الباقي على حساب العميل المسمّى. «خصم»: خصم على الفاتورة يجعل الإجمالي مساويًا للمدفوع.
 */
export default function PosPaymentDialog({
  totals,
  cardEnabled,
  namedCustomer,
  canDiscount,
  error: externalError,
  busy,
  onApplyDiscount,
  onClose,
  onSubmit,
}: {
  totals: CartTotals;
  cardEnabled: boolean;
  namedCustomer: boolean;
  canDiscount: boolean;
  error: string;
  busy: boolean;
  /** يعيد null إن طُبّق، أو رسالة خطأ */
  onApplyDiscount: (targetTotalCents: number) => string | null;
  onClose: () => void;
  onSubmit: (value: PaymentSubmit) => void;
}) {
  const { t } = useI18n();
  const money = useMoney();
  const totalCents = totals.totalCents;
  const [rows, setRows] = useState<PaymentRow[]>([{ key: 1, method: "cash", amount: fromCents(totalCents).toFixed(2) }]);
  const [onAccount, setOnAccount] = useState(false);
  const [error, setError] = useState("");

  // تغيّر الإجمالي (خصم من هنا): سطر الدفع الوحيد يتبعه
  useEffect(() => {
    setRows((current) => (current.length === 1 && !onAccount ? [{ ...current[0], amount: fromCents(totalCents).toFixed(2) }] : current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalCents]);

  const cashCents = rows.filter((r) => r.method === "cash").reduce((sum, r) => sum + (parseMoney(r.amount) ?? 0), 0);
  const cardCents = rows.filter((r) => r.method === "card").reduce((sum, r) => sum + (parseMoney(r.amount) ?? 0), 0);
  const invalidRow = rows.some((r) => r.amount.trim() !== "" && !isMoneyText(r.amount));
  const paidCashCents = Math.min(cashCents, Math.max(totalCents - cardCents, 0));
  const changeCents = cashCents - paidCashCents;
  const remainingCents = Math.max(totalCents - cardCents - paidCashCents, 0);

  const problem = invalidRow ? "مبلغ غير صحيح في سطر الدفع"
    : cardCents > totalCents ? "مبلغ البطاقة أكبر من الإجمالي"
    : cashCents > 0 && paidCashCents === 0 ? "لا حاجة للنقد بعد البطاقة؛ احذف سطر النقد"
    : remainingCents > 0 && !onAccount ? ""
    : "";

  const quickCash = useMemo(() => {
    const values = new Set<number>();
    const due = Math.max(totalCents - cardCents, 0);
    if (due <= 0) return [];
    values.add(due);
    ROUNDING.forEach((step) => {
      const stepCents = step * 100;
      const rounded = Math.ceil(due / stepCents) * stepCents;
      if (rounded > due) values.add(rounded);
    });
    return Array.from(values).sort((a, b) => a - b).slice(0, 5);
  }, [totalCents, cardCents]);

  const setCash = (cents: number) => {
    setOnAccount(false);
    setRows((current) => {
      const card = current.filter((r) => r.method === "card");
      return [...card, { key: Date.now(), method: "cash", amount: fromCents(cents).toFixed(2) }];
    });
  };

  const submit = () => {
    if (problem) { setError(t(problem)); return; }
    if (remainingCents > 0 && !onAccount) { setError(t("المدفوع أقل من الإجمالي؛ أكمل الدفع أو اختر «تسوية» لعميل مسمّى")); return; }
    setError("");
    onSubmit({
      payments: rows.filter((r) => (parseMoney(r.amount) ?? 0) > 0).map((r) => ({ method: r.method, amount: fromCents(parseMoney(r.amount) ?? 0) })),
      onAccount: onAccount && remainingCents > 0,
    });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Enter" && !busy && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault();
        submit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const applyDiscount = () => {
    const paidCents = cardCents + cashCents;
    const message = onApplyDiscount(paidCents);
    if (message) setError(t(message));
    else { setError(""); setOnAccount(false); }
  };

  return (
    <PosModal
      title="الدفع"
      onClose={onClose}
      busy={busy}
      size="lg"
      footer={
        <>
          <PosButton variant="outline" onClick={onClose} disabled={busy}>{t("رجوع للطلب")}</PosButton>
          <PosButton onClick={submit} busy={busy} disabled={Boolean(problem) || (remainingCents > 0 && !onAccount)} className="min-w-[160px] text-base">
            {t("إتمام البيع")} <span className="text-xs opacity-75">Enter</span>
          </PosButton>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-[1fr_220px]">
        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.key} className="flex items-center gap-2">
              <div className="flex overflow-hidden rounded-lg border">
                {(["cash", "card"] as const).map((m) => (
                  <button key={m} type="button" disabled={m === "card" && !cardEnabled}
                    onClick={() => setRows((list) => list.map((r) => (r.key === row.key ? { ...r, method: m } : r)))}
                    className={cn("flex items-center gap-1.5 px-3 py-2 text-sm font-semibold disabled:opacity-40",
                      row.method === m ? "bg-[#0f6b63] text-white" : "bg-white text-slate-600 hover:bg-slate-50")}
                    title={m === "card" && !cardEnabled ? t("لم يُحدَّد حساب بنكي للبطاقة في الجهاز") : undefined}>
                    {m === "cash" ? <Banknote className="h-4 w-4" /> : <CreditCard className="h-4 w-4" />}{t(m === "cash" ? "نقد" : "بطاقة")}
                  </button>
                ))}
              </div>
              <input value={row.amount} inputMode="decimal" autoFocus={rows.length === 1}
                onChange={(e) => { setOnAccount(false); setRows((list) => list.map((r) => (r.key === row.key ? { ...r, amount: e.target.value } : r))); }}
                onFocus={(e) => e.currentTarget.select()}
                className={cn("h-11 flex-1 rounded-lg border border-slate-300 px-3 text-left text-xl font-bold focus:border-[#0f6b63] focus:outline-none", num)} dir="ltr" />
              {rows.length > 1 && (
                <button type="button" onClick={() => setRows((list) => list.filter((r) => r.key !== row.key))} className="rounded p-2 text-red-600 hover:bg-red-50" aria-label={t("حذف")}>
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <PosButton variant="outline" className="h-9 px-3 text-xs" disabled={rows.length >= 6}
              onClick={() => setRows((list) => [...list, { key: Date.now(), method: cardEnabled && !list.some((r) => r.method === "card") ? "card" : "cash", amount: fromCents(remainingCents).toFixed(2) }])}>
              <Plus className="h-3.5 w-3.5" />{t("طريقة دفع أخرى")}
            </PosButton>
            {quickCash.map((cents) => (
              <button key={cents} type="button" onClick={() => setCash(cents)}
                className={cn("rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:border-[#0f6b63] hover:text-[#0b5751]", num)}>
                {money(fromCents(cents))}
              </button>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" disabled={!namedCustomer || remainingCents <= 0} onClick={() => setOnAccount((v) => !v)}
              className={cn("flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-semibold disabled:opacity-40",
                onAccount ? "border-amber-400 bg-amber-50 text-amber-900" : "border-slate-300 text-slate-700 hover:bg-slate-50")}
              title={!namedCustomer ? t("التسوية لعميل مسمّى؛ اختر العميل أولًا") : undefined}>
              <UserCheck className="h-4 w-4" />{t("تسوية: الباقي على حساب العميل")}
            </button>
            <button type="button" disabled={!canDiscount || remainingCents <= 0} onClick={applyDiscount}
              className="flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              title={!canDiscount ? t("لا تملك صلاحية الخصم") : undefined}>
              <Percent className="h-4 w-4" />{t("خصم: الإجمالي = المدفوع")}
            </button>
          </div>
          <ErrorNote message={error || (problem ? t(problem) : "") || externalError} />
        </div>
        <div className="space-y-2 rounded-xl bg-slate-900 p-4 text-white">
          <div className="text-xs opacity-70">{t("الإجمالي شامل الضريبة")}</div>
          <div className={cn("text-3xl font-extrabold", num)}>{money(fromCents(totalCents))}</div>
          <div className="my-2 h-px bg-white/15" />
          <div className="flex justify-between text-sm"><span className="opacity-70">{t("نقد")}</span><span className={num}>{money(fromCents(cashCents))}</span></div>
          <div className="flex justify-between text-sm"><span className="opacity-70">{t("بطاقة")}</span><span className={num}>{money(fromCents(cardCents))}</span></div>
          {remainingCents > 0 && (
            <div className={cn("flex justify-between text-sm font-bold", onAccount ? "text-amber-300" : "text-red-300")}>
              <span>{t(onAccount ? "على الحساب" : "المتبقي")}</span><span className={num}>{money(fromCents(remainingCents))}</span>
            </div>
          )}
          {changeCents > 0 && (
            <div className="rounded-lg bg-emerald-500/20 p-2">
              <div className="text-xs text-emerald-200">{t("الباقي للعميل")}</div>
              <div className={cn("text-2xl font-extrabold text-emerald-300", num)}>{money(fromCents(changeCents))}</div>
            </div>
          )}
        </div>
      </div>
    </PosModal>
  );
}
