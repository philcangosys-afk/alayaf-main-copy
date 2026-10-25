import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  beginRequest, endRequest, isMoneyText, outcomeUnknown, pendingRequest, posCashOperation, posErrorText, searchPosCustomers,
  type AccountOption, type PosCustomer, type PosSession, type TreasuryAccount,
} from "@/lib/pos";
import { Code, ErrorNote, PosButton, PosModal, num, posInput, posLabel, posSelect, useMoney } from "@/components/pos/PosUi";

export type CashKind = "receipt" | "expense" | "cash_in" | "cash_out";

const TITLES: Record<CashKind, string> = {
  receipt: "قبض من عميل",
  expense: "مصروف من الجلسة",
  cash_in: "إيداع نقد من الخزينة",
  cash_out: "سحب نقد إلى الخزينة",
};

/** عمليات النقد في الجلسة: كل عملية بقيدها على حساب الجلسة */
export default function PosCashDialog({
  kind,
  session,
  treasuryAccounts,
  expenseAccounts,
  onClose,
  onDone,
}: {
  kind: CashKind;
  session: PosSession;
  treasuryAccounts: TreasuryAccount[];
  expenseAccounts: AccountOption[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { t } = useI18n();
  const money = useMoney();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [method, setMethod] = useState<"cash" | "card">("cash");
  const [account, setAccount] = useState(kind === "expense" ? expenseAccounts[0]?.code ?? "" : treasuryAccounts.find((a) => !a.in_session)?.account_code ?? "");
  const [vendor, setVendor] = useState("");
  const [reference, setReference] = useState("");
  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState<PosCustomer[]>([]);
  const [customer, setCustomer] = useState<PosCustomer | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // محاولة سابقة من النوع نفسه لم تُعرف نتيجتها (انقطع الاتصال): تُحسم بإعادتها نفسها قبل أي عملية جديدة
  const scope = `cash-${session.id}-${kind}`;
  const [pending, setPending] = useState(() => pendingRequest(scope));

  useEffect(() => {
    if (kind !== "receipt" || customer) return;
    let current = true;
    const handle = setTimeout(async () => {
      const result = await searchPosCustomers(query);
      if (current && !result.error) setCustomers((result.data ?? []).filter((c) => c.balance > 0));
    }, 250);
    return () => { current = false; clearTimeout(handle); };
  }, [kind, query, customer]);

  const amountValue = Number(amount);

  const submit = async () => {
    let payload: Record<string, unknown>;
    if (pending) payload = pending.payload;
    else {
      if (!isMoneyText(amount) || amountValue <= 0) { setError(t("المبلغ رقم موجب بخانتين عشريتين على الأكثر")); return; }
      if (kind === "receipt" && !customer) { setError(t("اختر العميل")); return; }
      if (kind !== "receipt" && !account) { setError(t("اختر الحساب")); return; }
      payload = { session_id: session.id, kind, amount: amountValue, note: note.trim() || null, reference: reference.trim() || null };
      if (kind === "receipt") Object.assign(payload, { customer_id: customer?.id, method });
      else Object.assign(payload, { account_code: account });
      if (kind === "expense") Object.assign(payload, { vendor_name: vendor.trim() || null });
    }
    setBusy(true);
    setError("");
    const attempt = beginRequest(scope, payload);
    const result = await posCashOperation({ ...attempt.payload, client_request_id: attempt.id });
    setBusy(false);
    if (result.error || !result.data) {
      if (outcomeUnknown(result, attempt.resumed)) {
        setPending(pendingRequest(scope));
        setError(t("انقطع الاتصال ولم يُعرف إن سُجّلت العملية. أعد المحاولة: تُرسل العملية نفسها، فإن كانت سُجّلت لا تتكرر."));
      } else {
        endRequest(scope);
        setPending(null);
        setError(posErrorText(result.error ?? "", t));
      }
      return;
    }
    endRequest(scope);
    setPending(null);
    onDone(`${t(TITLES[kind])}: ${money(result.data.amount)}${result.data.existing ? ` — ${t("كانت مسجّلة من قبل (انقطع الرد فلم تتكرر)")}` : ""}`);
  };

  const accountsForKind = kind === "expense" ? [] : treasuryAccounts;

  return (
    <PosModal
      title={TITLES[kind]}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <PosButton variant="outline" onClick={onClose} disabled={busy}>{t("إلغاء")}</PosButton>
          {pending && (
            <PosButton variant="danger" disabled={busy} onClick={() => { endRequest(scope); setPending(null); setError(""); }}
              title={t("تحقق من حركات الجلسة أولًا: إن كانت سُجّلت فالعملية الجديدة تكررها")}>
              {t("تجاهل المحاولة")}
            </PosButton>
          )}
          <PosButton onClick={submit} busy={busy}>{t(pending ? "إعادة المحاولة" : "حفظ العملية")}</PosButton>
        </>
      }
    >
      {pending ? (
        <div className="space-y-3">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm leading-7 text-amber-900">
            <p className="font-semibold">{t("عملية سابقة لم تُعرف نتيجتها (انقطع الاتصال)")}: {t(TITLES[kind])} — <b className={num}>{money(Number(pending.payload.amount ?? 0))}</b></p>
            <p>{t("«إعادة المحاولة» ترسلها نفسها: إن كانت سُجّلت لا تتكرر، وإلا تُسجَّل الآن. «تجاهل المحاولة» بعد التحقق من حركات الجلسة فقط.")}</p>
          </div>
          <ErrorNote message={error} />
        </div>
      ) : (
      <div className="space-y-3">
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {t("النقد المتوقع في الجلسة")}: <b className={num}>{money(session.expected_cash ?? 0)}</b>
        </div>

        {kind === "receipt" && (
          customer ? (
            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <div>
                <div className="font-semibold text-slate-900">{customer.name}</div>
                <div className="text-xs text-slate-500"><Code>{customer.customer_number}</Code> — {t("المستحق")}: <b className={num}>{money(customer.balance)}</b></div>
              </div>
              <PosButton variant="ghost" className="h-8 px-2 text-xs" onClick={() => setCustomer(null)}>{t("تغيير")}</PosButton>
            </div>
          ) : (
            <div>
              <label className={posLabel}>{t("العميل")}
                <div className="relative">
                  <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} className={cn(posInput, "ps-9")} placeholder={t("ابحث بالاسم أو الجوال أو الرقم")} autoFocus />
                </div>
              </label>
              <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border">
                {customers.length === 0 ? (
                  <p className="px-3 py-4 text-center text-xs text-slate-500">{t("لا عملاء عليهم مستحقات بهذا البحث")}</p>
                ) : customers.map((c) => (
                  <button key={c.id} type="button" onClick={() => { setCustomer(c); setAmount(c.balance.toFixed(2)); }}
                    className="flex w-full items-center justify-between border-b px-3 py-2 text-start text-sm last:border-b-0 hover:bg-slate-50">
                    <span><b>{c.name}</b> {c.phone ? <Code className="text-xs text-slate-500">{c.phone}</Code> : null}</span>
                    <span className={cn("font-semibold", num)}>{money(c.balance)}</span>
                  </button>
                ))}
              </div>
            </div>
          )
        )}

        {kind === "receipt" && (
          <div className="flex gap-2">
            {(["cash", "card"] as const).map((m) => (
              <button key={m} type="button" disabled={m === "card" && !session.card_account_code} onClick={() => setMethod(m)}
                className={cn("flex-1 rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-40",
                  method === m ? "border-[#0f6b63] bg-[#e6f2f0] text-[#0b5751]" : "border-slate-300 text-slate-600")}>
                {t(m === "cash" ? "نقد" : "بطاقة")}
              </button>
            ))}
          </div>
        )}

        {kind === "expense" && (
          <label className={posLabel}>{t("حساب المصروف")}
            <select value={account} onChange={(e) => setAccount(e.target.value)} className={posSelect}>
              {expenseAccounts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
            </select>
          </label>
        )}
        {(kind === "cash_in" || kind === "cash_out") && (
          <label className={posLabel}>{t(kind === "cash_in" ? "من" : "إلى")}
            <select value={account} onChange={(e) => setAccount(e.target.value)} className={posSelect}>
              {accountsForKind.map((a) => (
                <option key={a.account_code} value={a.account_code} disabled={a.in_session}>
                  {a.account_code} — {a.name}{a.in_session ? ` (${t("عليه جلسة مفتوحة")})` : ""}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className={posLabel}>{t(kind === "expense" ? "المبلغ المدفوع" : "المبلغ")}
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className={cn(posInput, "text-left text-lg font-bold", num)} dir="ltr" placeholder="0.00" />
        </label>

        {kind === "expense" && (
          <>
            <label className={posLabel}>{t("المورد (اختياري)")}
              <input value={vendor} onChange={(e) => setVendor(e.target.value)} maxLength={120} className={posInput} />
            </label>
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-6 text-slate-600">
              {t("يُقيَّد المبلغ كاملًا على حساب المصروف. المصروف الذي له فاتورة ضريبية وتريد استرداد ضريبته سجّله فاتورة مشتريات ليدخل الإقرار.")}
            </p>
          </>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className={posLabel}>{t("المرجع (اختياري)")}
            <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} className={posInput} placeholder={t(kind === "expense" ? "رقم فاتورة المورد" : "")} />
          </label>
          <label className={posLabel}>{t("ملاحظة")}
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className={posInput} />
          </label>
        </div>
        {kind === "receipt" && (
          <p className="text-xs leading-6 text-slate-500">{t("يُوزَّع المبلغ على فواتير العميل المفتوحة، الأقدم أولًا، بسند قبض لكل فاتورة.")}</p>
        )}
        <ErrorNote message={error} />
      </div>
      )}
    </PosModal>
  );
}
