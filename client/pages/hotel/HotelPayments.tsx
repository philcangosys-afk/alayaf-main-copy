import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Wallet } from "lucide-react";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import { supabase } from "@/lib/supabaseClient";
import {
  PAYMENT_KINDS, PAYMENT_METHODS, addDays, hotelErrorText, hotelToday, loadPayments, optionLabel, type HotelPayment, type PaymentKind,
} from "@/lib/hotel";
import { ErrorNote, HotelButton, HotelHeader, hotelInput, useMoney, useHotelDate } from "@/components/hotel/HotelUi";

/** مقبوضات الحجوزات في فترة: الدفعات المقدمة وردّها، وسداد فواتير المغادرة */
export default function HotelPayments() {
  const { t, direction } = useI18n();
  const formatDate = useHotelDate();
  const money = useMoney();
  const navigate = useNavigate();
  const [from, setFrom] = useState(addDays(hotelToday(), -30));
  const [to, setTo] = useState(hotelToday());
  const [kind, setKind] = useState<PaymentKind | "">("");
  const [rows, setRows] = useState<HotelPayment[]>([]);
  const [numbers, setNumbers] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    if (!from || !to || to < from) { setError(t("حدد فترة صحيحة")); return; }
    setLoading(true);
    const result = await loadPayments({ from, to });
    setRows(result.data);
    setError(result.error ? hotelErrorText(result.error.message, t) : "");
    const ids = [...new Set(result.data.map((p) => p.reservationId))];
    const map = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await supabase.from("hotel_reservations").select("id, reservation_number").in("id", ids.slice(i, i + 200));
      ((data ?? []) as Array<{ id: string; reservation_number: string }>).forEach((row) => map.set(row.id, row.reservation_number));
    }
    setNumbers(map);
    setLoading(false);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, []);

  const visible = useMemo(() => rows.filter((p) => !kind || p.kind === kind), [rows, kind]);
  const sum = (k: PaymentKind) => rows.filter((p) => p.kind === k).reduce((total, p) => total + p.amount, 0);
  const byMethod = PAYMENT_METHODS.map((m) => ({
    ...m,
    net: rows.filter((p) => p.method === m.value).reduce((total, p) => total + (p.kind === "refund" ? -p.amount : p.amount), 0),
  })).filter((m) => Math.abs(m.net) >= 0.005);

  return (
    <Layout>
      <main dir={direction} className="space-y-5">
        <HotelHeader icon={Wallet} title="المقبوضات" description="مقبوضات الحجوزات في الفترة: الدفعات المقدمة وردّها، وسداد فواتير المغادرة. لكل منها قيد في المحاسبة." />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {(Object.keys(PAYMENT_KINDS) as PaymentKind[]).map((k) => (
            <button key={k} onClick={() => setKind((current) => current === k ? "" : k)} className={`rounded-xl border bg-white p-4 text-start shadow-sm ${kind === k ? "ring-2 ring-[#7a2450]" : ""}`}>
              <p className="text-xs text-slate-500">{t(PAYMENT_KINDS[k])}</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-slate-900">{money(sum(k))}</p>
            </button>
          ))}
          <div className="rounded-xl border bg-[#f7eef2] p-4 shadow-sm">
            <p className="text-xs text-[#5d1a3c]">{t("الصافي المقبوض")}</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-[#5d1a3c]">{money(sum("advance") + sum("invoice") - sum("refund"))}</p>
            {byMethod.length > 0 && <p className="mt-1 text-[11px] text-[#5d1a3c]/80">{byMethod.map((m) => `${t(m.label)} ${money(m.net)}`).join("، ")}</p>}
          </div>
        </div>
        <ErrorNote message={error} />
        <section className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <div className="flex flex-wrap items-end gap-2 border-b bg-slate-50 px-4 py-3">
            <label className="text-xs text-slate-600">{t("من")}<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${hotelInput} h-9 w-40`} /></label>
            <label className="text-xs text-slate-600">{t("إلى")}<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${hotelInput} h-9 w-40`} /></label>
            <HotelButton variant="outline" onClick={() => void load()} busy={loading} className="h-9">{t("عرض")}</HotelButton>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr><th className="p-3 text-start">{t("الرقم")}</th><th className="p-3">{t("التاريخ")}</th><th className="p-3">{t("الحجز")}</th><th className="p-3">{t("النوع")}</th><th className="p-3">{t("الطريقة")}</th><th className="p-3">{t("الحساب")}</th><th className="p-3">{t("المرجع")}</th><th className="p-3 text-end">{t("المبلغ")}</th></tr>
              </thead>
              <tbody>
                {loading ? <tr><td colSpan={8} className="py-14 text-center text-slate-500">{t("جاري التحميل...")}</td></tr>
                  : visible.length === 0 ? <tr><td colSpan={8} className="py-14 text-center text-slate-400">{t("لا مقبوضات في هذه الفترة")}</td></tr>
                  : visible.map((p) => (
                    <tr key={p.id} className="border-t">
                      <td className="p-3 font-mono text-xs" dir="ltr">{p.number}</td>
                      <td className="p-3 text-center">{formatDate(p.date, { dateStyle: "medium" })}</td>
                      <td className="p-3 text-center"><button onClick={() => navigate(`/hotel/reservations/${p.reservationId}`)} className="font-mono text-xs text-[#7a2450] underline" dir="ltr">{numbers.get(p.reservationId) ?? "—"}</button></td>
                      <td className="p-3 text-center">{t(PAYMENT_KINDS[p.kind])}</td>
                      <td className="p-3 text-center">{t(optionLabel(PAYMENT_METHODS, p.method))}</td>
                      <td className="p-3 text-center font-mono text-xs">{p.depositAccount}</td>
                      <td className="p-3 text-center text-xs text-slate-500">{p.reference || "—"}</td>
                      <td className={`p-3 text-end tabular-nums ${p.kind === "refund" ? "text-red-700" : ""}`}>{p.kind === "refund" ? "−" : ""}{money(p.amount)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </Layout>
  );
}
