import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Ban, BedDouble, Download, Edit3, FileText, LogIn, LogOut, Plus, Printer, Receipt, RotateCcw, Trash2, UserRound, Wallet,
} from "lucide-react";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import { permissionLevelAny } from "@/lib/authSession";
import { COMPANY_PROFILE } from "@/lib/companyProfile";
import {
  ID_TYPES, PAYMENT_KINDS, PAYMENT_METHODS, SOURCES, addressComplete, hotelErrorText, hotelToday, isMoney, isolate, isolateCodes, listDepositAccounts,
  loadHotelSetup, loadReservationBundle, nationalAddress, nightsBetween, optionLabel, type DepositAccount, type HotelReservation,
  type HotelSetup, type Option, type ReservationBundle,
} from "@/lib/hotel";
import { printHotelDocument } from "@/lib/hotelPrint";
import GuestFormModal, { loadCustomerOptions } from "@/components/hotel/GuestFormModal";
import {
  ErrorNote, HotelButton, HotelCard, HotelConfirm, HotelHeader, HotelModal, ReservationStatusPill, hotelInput, hotelLabel, hotelSelect,
  useHotelDate, useMoney,
} from "@/components/hotel/HotelUi";

type Dialog =
  | { kind: "checkin" }
  | { kind: "checkout" }
  | { kind: "cancel" }
  | { kind: "payment"; mode: "receive" | "refund" }
  | { kind: "guest" }
  | { kind: "delete-charge"; chargeId: string; description: string }
  | null;

/** الحجز: الدخول والمغادرة والإلغاء، والخدمات، والمقبوضات، والمبالغ وفاتورة المغادرة */
export default function HotelReservationDetails() {
  const { t, direction, formatNumber } = useI18n();
  const formatDate = useHotelDate();
  const money = useMoney();
  const navigate = useNavigate();
  const { id = "" } = useParams();
  const { permissions } = useRolePermissions();
  const canManage = permissionLevelAny(permissions, ["hotel.reservations", "module.hotel"]) === "manage";
  const canPay = permissionLevelAny(permissions, ["hotel.payments", "module.hotel"]) === "manage";
  const canSeePayments = permissionLevelAny(permissions, ["hotel.payments", "module.hotel"]) !== "none";

  const [bundle, setBundle] = useState<ReservationBundle | null>(null);
  const [setup, setSetup] = useState<HotelSetup>({ types: [], floors: [], units: [] });
  const [customers, setCustomers] = useState<Option[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [charge, setCharge] = useState({ description: "", quantity: "1", unitPrice: "", date: hotelToday() });

  const load = async () => {
    setLoading(true);
    const [result, setupResult, customerList] = await Promise.all([loadReservationBundle(id), loadHotelSetup(), loadCustomerOptions()]);
    setLoading(false);
    setSetup(setupResult.data);
    setCustomers(customerList);
    if (result.error) { setError(hotelErrorText(result.error.message, t)); return; }
    if (!result.data) { setError(t("الحجز غير موجود")); return; }
    setError(result.data.totalsError ? hotelErrorText(result.data.totalsError, t) : "");
    setBundle(result.data);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [id]);

  const unitById = useMemo(() => new Map(setup.units.map((u) => [u.id, u])), [setup.units]);
  const typeById = useMemo(() => new Map(setup.types.map((type) => [type.id, type])), [setup.types]);

  const run = async (action: () => PromiseLike<{ error: { message: string } | null }>, success: string, after?: () => void) => {
    setBusy(true);
    const { error: actionError } = await action();
    setBusy(false);
    if (actionError) {
      toast({ title: t("تعذر تنفيذ العملية"), description: hotelErrorText(actionError.message, t), variant: "destructive" });
      return false;
    }
    toast({ title: t(success) });
    after?.();
    await load();
    return true;
  };

  if (loading && !bundle) {
    return <Layout><div className="rounded-xl border bg-white p-10 text-center text-slate-500" dir={direction}>{t("جاري التحميل...")}</div></Layout>;
  }
  if (!bundle) {
    return <Layout><main dir={direction} className="space-y-4"><ErrorNote message={error || t("الحجز غير موجود")} /><HotelButton variant="outline" onClick={() => navigate("/hotel/reservations")}>{t("الحجوزات")}</HotelButton></main></Layout>;
  }

  const { reservation: r, guest, charges, payments, totals } = bundle;
  const open = r.status === "confirmed" || r.status === "checked_in";
  const today = hotelToday();
  const invoice = totals?.invoice ?? null;
  const advances = totals?.advances ?? 0;

  const addCharge = async () => {
    if (!charge.description.trim()) { toast({ title: t("الوصف مطلوب"), variant: "destructive" }); return; }
    if (!/^\d{1,5}$/.test(charge.quantity) || Number(charge.quantity) < 1) { toast({ title: t("الكمية عدد صحيح من 1 إلى 10000"), variant: "destructive" }); return; }
    if (!isMoney(charge.unitPrice) || Number(charge.unitPrice) <= 0) { toast({ title: t("السعر رقم موجب بخانتين عشريتين على الأكثر"), variant: "destructive" }); return; }
    await run(
      () => supabase.rpc("hotel_add_charge", { p_reservation: r.id, p: { description: charge.description.trim(), quantity: Number(charge.quantity), unit_price: Number(charge.unitPrice), charge_date: charge.date } }),
      "أُضيفت الخدمة",
      () => setCharge({ description: "", quantity: "1", unitPrice: "", date: hotelToday() }),
    );
  };

  // تاريخ المغادرة في الحجز إلى اليوم (مغادرة مبكرة أو تمديد): الفاتورة بالليالي الفعلية
  const adjustCheckOutToToday = async () => {
    const payload = {
      guest_id: r.guestId, customer_id: r.customerId || null, check_in: r.checkIn, check_out: today, adults: r.adults,
      children: r.children, source: r.source, notes: r.notes || null, discount: r.discount,
      units: r.units.map((u) => ({ unit_id: u.unitId, nightly_rate: u.nightlyRate })),
    };
    await run(() => supabase.rpc("hotel_save_reservation", { p_id: r.id, p: payload }), "عُدّل تاريخ المغادرة إلى اليوم");
  };

  const print = (mode: "print" | "download") => {
    if (!totals) return;
    void printHotelDocument({ mode, totals, reservation: r, guest, unitCodes: r.units.map((u) => unitById.get(u.unitId)?.code ?? "—"), t, direction, formatNumber, formatDate });
  };

  return (
    <Layout>
      <main dir={direction} className="space-y-5">
        <HotelHeader
          icon={BedDouble}
          title={`${t("الحجز")} ${isolate(r.number)}`}
          description={`${guest?.fullName ?? "—"}، ${formatDate(r.checkIn, { dateStyle: "medium" })} — ${formatDate(r.checkOut, { dateStyle: "medium" })}`}
          actions={
            <>
              <ReservationStatusPill status={r.status} />
              {canManage && r.status === "confirmed" && <HotelButton variant="success" onClick={() => setDialog({ kind: "checkin" })} busy={busy}><LogIn className="h-4 w-4" />{t("تسجيل الدخول")}</HotelButton>}
              {canManage && r.status === "checked_in" && <HotelButton onClick={() => setDialog({ kind: "checkout" })} busy={busy}><LogOut className="h-4 w-4" />{t("تسجيل المغادرة")}</HotelButton>}
              {canManage && open && <HotelButton variant="outline" onClick={() => navigate(`/hotel/reservations/${r.id}/edit`)}><Edit3 className="h-4 w-4" />{t("تعديل")}</HotelButton>}
              {canManage && r.status === "confirmed" && <HotelButton variant="danger" onClick={() => setDialog({ kind: "cancel" })}><Ban className="h-4 w-4" />{t("إلغاء الحجز")}</HotelButton>}
            </>
          }
        />
        <ErrorNote message={error} />
        {r.status === "confirmed" && r.checkIn < today && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{t("تجاوز الحجز تاريخ الوصول ولم يُسجَّل الدخول. سجّل الدخول، أو عدّل التاريخ، أو ألغِ الحجز.")}</div>
        )}
        {r.status === "checked_in" && r.checkOut <= today && (
          <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">
            {t(r.checkOut < today ? "تجاوز النزيل تاريخ المغادرة. مدّد الإقامة من «تعديل» أو سجّل المغادرة." : "المغادرة اليوم.")}
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
          <div className="space-y-5">
            <div className="grid gap-5 md:grid-cols-2">
              <HotelCard title="الإقامة">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <dt className="text-slate-500">{t("الوصول")}</dt><dd>{formatDate(r.checkIn, { dateStyle: "medium" })}</dd>
                  <dt className="text-slate-500">{t("المغادرة")}</dt><dd>{formatDate(r.checkOut, { dateStyle: "medium" })}</dd>
                  <dt className="text-slate-500">{t("الليالي")}</dt><dd className="tabular-nums">{formatNumber(totals?.nights ?? 0)}</dd>
                  <dt className="text-slate-500">{t("النزلاء")}</dt><dd>{formatNumber(r.adults)} {t("بالغ")}{r.children ? `، ${formatNumber(r.children)} ${t("طفل")}` : ""}</dd>
                  <dt className="text-slate-500">{t("المصدر")}</dt><dd>{t(optionLabel(SOURCES, r.source))}</dd>
                  {r.checkedInAt && <><dt className="text-slate-500">{t("سُجّل الدخول")}</dt><dd>{formatDate(r.checkedInAt, { dateStyle: "short", timeStyle: "short" })}</dd></>}
                  {r.checkedOutAt && <><dt className="text-slate-500">{t("غادر")}</dt><dd>{formatDate(r.checkedOutAt, { dateStyle: "short", timeStyle: "short" })}</dd></>}
                  {r.cancelledAt && <><dt className="text-slate-500">{t("أُلغي")}</dt><dd>{formatDate(r.cancelledAt, { dateStyle: "short", timeStyle: "short" })}{r.cancelReason ? ` — ${r.cancelReason}` : ""}</dd></>}
                </dl>
                {r.notes ? <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{r.notes}</p> : null}
              </HotelCard>
              <HotelCard title="النزيل" actions={canManage && guest ? <button onClick={() => setDialog({ kind: "guest" })} className="text-xs font-semibold text-[#7a2450]">{t("تعديل")}</button> : undefined}>
                {guest ? (
                  <div className="space-y-1.5 text-sm">
                    <p className="flex items-center gap-2 text-base font-bold text-slate-900"><UserRound className="h-4 w-4 text-[#7a2450]" />{guest.fullName}</p>
                    {guest.phone && <p dir="ltr" className="text-end text-slate-600">{guest.phone}</p>}
                    {guest.nationality && <p className="text-slate-600">{guest.nationality}</p>}
                    {guest.idNumber ? <p className="text-slate-600">{t(optionLabel(ID_TYPES, guest.idType))}: <span className="font-mono">{guest.idNumber}</span></p>
                      : <p className="text-amber-700">{t("الهوية غير مسجلة؛ تُطلب عند تسجيل الدخول")}</p>}
                    {nationalAddress(guest) ? <p className="text-xs text-slate-500">{nationalAddress(guest)}</p> : null}
                    {r.customerId && <p className="text-xs text-slate-500">{t("الشركة")}: {customers.find((c) => c.value === r.customerId)?.label ?? r.customerId}</p>}
                  </div>
                ) : <p className="text-sm text-slate-500">—</p>}
              </HotelCard>
            </div>

            <HotelCard title="الوحدات">
              <table className="min-w-full text-sm">
                <thead className="text-slate-500"><tr><th className="py-2 text-start">{t("الوحدة")}</th><th className="py-2">{t("النوع")}</th><th className="py-2">{t("سعر الليلة")}</th><th className="py-2">{t("الليالي")}</th><th className="py-2 text-end">{t("المبلغ")}</th></tr></thead>
                <tbody>
                  {r.units.map((u) => {
                    const unit = unitById.get(u.unitId);
                    return (
                      <tr key={u.unitId} className="border-t">
                        <td className="py-2 font-bold tabular-nums">{unit?.code ?? "—"}</td>
                        <td className="py-2 text-center">{typeById.get(unit?.typeId ?? "")?.name ?? ""}</td>
                        <td className="py-2 text-center tabular-nums">{money(u.nightlyRate)}</td>
                        <td className="py-2 text-center tabular-nums">{formatNumber(totals?.nights ?? 0)}</td>
                        <td className="py-2 text-end tabular-nums">{money(u.nightlyRate * (totals?.nights ?? 0))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </HotelCard>

            <HotelCard title="الخدمات الإضافية">
              {charges.length === 0 ? <p className="text-sm text-slate-500">{t("لا خدمات على الحجز")}</p> : (
                <table className="min-w-full text-sm">
                  <thead className="text-slate-500"><tr><th className="py-2 text-start">{t("الخدمة")}</th><th className="py-2">{t("التاريخ")}</th><th className="py-2">{t("الكمية")}</th><th className="py-2">{t("السعر")}</th><th className="py-2 text-end">{t("المبلغ")}</th><th /></tr></thead>
                  <tbody>
                    {charges.map((c) => (
                      <tr key={c.id} className="border-t">
                        <td className="py-2">{c.description}</td>
                        <td className="py-2 text-center">{formatDate(c.date, { day: "numeric", month: "short" })}</td>
                        <td className="py-2 text-center tabular-nums">{formatNumber(c.quantity)}</td>
                        <td className="py-2 text-center tabular-nums">{money(c.unitPrice)}</td>
                        <td className="py-2 text-end tabular-nums">{money(c.quantity * c.unitPrice)}</td>
                        <td className="py-2 text-end">
                          {canManage && open && <button onClick={() => setDialog({ kind: "delete-charge", chargeId: c.id, description: c.description })} className="rounded p-1.5 text-red-600 hover:bg-red-50" title={t("حذف")}><Trash2 className="h-4 w-4" /></button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {canManage && open && (
                <div className="mt-4 grid gap-2 rounded-xl border border-dashed border-slate-300 p-3 md:grid-cols-[1fr_90px_120px_150px_auto]">
                  <label className={hotelLabel}>{t("الخدمة")}<input value={charge.description} onChange={(e) => setCharge({ ...charge, description: e.target.value })} className={hotelInput} maxLength={200} placeholder={t("مثل: مطعم، غسيل ملابس، سرير إضافي")} /></label>
                  <label className={hotelLabel}>{t("الكمية")}<input value={charge.quantity} onChange={(e) => setCharge({ ...charge, quantity: e.target.value })} className={`${hotelInput} text-left`} dir="ltr" inputMode="numeric" /></label>
                  <label className={hotelLabel}>{t("السعر قبل الضريبة")}<input value={charge.unitPrice} onChange={(e) => setCharge({ ...charge, unitPrice: e.target.value })} className={`${hotelInput} text-left`} dir="ltr" inputMode="decimal" /></label>
                  <label className={hotelLabel}>{t("التاريخ")}<input type="date" value={charge.date} onChange={(e) => setCharge({ ...charge, date: e.target.value })} className={hotelInput} /></label>
                  <div className="flex items-end"><HotelButton onClick={() => void addCharge()} busy={busy} className="h-10 w-full"><Plus className="h-4 w-4" />{t("إضافة الخدمة")}</HotelButton></div>
                </div>
              )}
            </HotelCard>

            {canSeePayments && (
              <HotelCard
                title="المقبوضات"
                actions={canPay && (open || (invoice && (totals?.balance ?? 0) > 0)) ? (
                  <>
                    {(open || (invoice && (totals?.balance ?? 0) > 0)) && <HotelButton onClick={() => setDialog({ kind: "payment", mode: "receive" })}><Wallet className="h-4 w-4" />{t(open ? "قبض دفعة مقدمة" : "سداد المتبقي")}</HotelButton>}
                    {open && advances > 0 && <HotelButton variant="outline" onClick={() => setDialog({ kind: "payment", mode: "refund" })}><RotateCcw className="h-4 w-4" />{t("رد دفعة")}</HotelButton>}
                  </>
                ) : undefined}
              >
                {payments.length === 0 ? <p className="text-sm text-slate-500">{t("لا مقبوضات على الحجز")}</p> : (
                  <table className="min-w-full text-sm">
                    <thead className="text-slate-500"><tr><th className="py-2 text-start">{t("الرقم")}</th><th className="py-2">{t("التاريخ")}</th><th className="py-2">{t("النوع")}</th><th className="py-2">{t("الطريقة")}</th><th className="py-2">{t("المرجع")}</th><th className="py-2 text-end">{t("المبلغ")}</th></tr></thead>
                    <tbody>
                      {payments.map((p) => (
                        <tr key={p.id} className="border-t">
                          <td className="py-2 font-mono text-xs" dir="ltr">{p.number}</td>
                          <td className="py-2 text-center">{formatDate(p.date, { day: "numeric", month: "short", year: "numeric" })}</td>
                          <td className="py-2 text-center">{t(PAYMENT_KINDS[p.kind])}</td>
                          <td className="py-2 text-center">{t(optionLabel(PAYMENT_METHODS, p.method))}</td>
                          <td className="py-2 text-center text-xs text-slate-500">{p.reference || "—"}</td>
                          <td className={`py-2 text-end tabular-nums ${p.kind === "refund" ? "text-red-700" : ""}`}>{p.kind === "refund" ? "−" : ""}{money(p.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </HotelCard>
            )}
          </div>

          <div className="space-y-5">
            <HotelCard
              title={invoice ? "الفاتورة" : "الحساب"}
              actions={totals ? (
                <>
                  <HotelButton variant="ghost" onClick={() => print("print")} title={t("طباعة")}><Printer className="h-4 w-4" /></HotelButton>
                  <HotelButton variant="ghost" onClick={() => print("download")} title={t("تحميل PDF")}><Download className="h-4 w-4" /></HotelButton>
                </>
              ) : undefined}
            >
              {!totals ? <p className="text-sm text-slate-500">{t("تعذر حساب المبالغ")}</p> : (
                <div className="space-y-3 text-sm">
                  {invoice && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                      <p className="flex items-center gap-2 font-bold text-emerald-900"><FileText className="h-4 w-4" /><span dir="ltr">{invoice.id}</span></p>
                      <p className="mt-1 text-xs text-emerald-900">
                        {t(invoice.invoice_type === "standard" ? "فاتورة ضريبية" : "فاتورة ضريبية مبسطة")}، {t(invoice.status)}
                      </p>
                      {invoice.zatca_phase === "phase2" && invoice.zatca_status !== "reported" && invoice.zatca_status !== "cleared" && (
                        <p className="mt-2 text-xs leading-5 text-amber-800">{t("لم تُرسل الفاتورة للهيئة بعد: أرسلها من «فواتير المبيعات» بزر «إعادة الإرسال للهيئة».")}</p>
                      )}
                    </div>
                  )}
                  <ul className="divide-y">
                    {(invoice?.items ?? totals.items).map((item) => (
                      <li key={item.id} className="flex justify-between gap-3 py-2">
                        <span className="text-slate-700">{isolateCodes(item.description)}{item.quantity > 1 ? <span className="text-xs text-slate-500"> × {formatNumber(item.quantity)}</span> : null}{item.discount > 0 ? <span className="block text-xs text-slate-500">{t("خصم")} {money(item.discount)}</span> : null}</span>
                        <span className="tabular-nums">{money(Math.round((item.quantity * item.unitPrice - item.discount) * 100) / 100)}</span>
                      </li>
                    ))}
                  </ul>
                  <dl className="space-y-1.5 border-t pt-3">
                    <div className="flex justify-between"><dt className="text-slate-600">{t("المجموع قبل الضريبة")}</dt><dd className="tabular-nums">{money(invoice ? invoice.subtotal : totals.subtotal)}</dd></div>
                    <div className="flex justify-between"><dt className="text-slate-600">{t("ضريبة القيمة المضافة 15%")}</dt><dd className="tabular-nums">{money(invoice ? invoice.total_tax : totals.tax)}</dd></div>
                    <div className="flex justify-between text-base font-bold"><dt>{t("الإجمالي")}</dt><dd className="tabular-nums">{money(invoice ? (invoice.original_total ?? invoice.subtotal + invoice.total_tax) : totals.total)}</dd></div>
                    {invoice && Math.abs((invoice.original_total ?? invoice.total) - invoice.total) >= 0.005 && (
                      <div className="flex justify-between font-semibold"><dt>{t("الإجمالي بعد الإشعارات")}</dt><dd className="tabular-nums">{money(invoice.total)}</dd></div>
                    )}
                    {invoice ? (
                      <>
                        {totals.advances_applied > 0 && <div className="flex justify-between text-slate-600"><dt>{t("منها دفعات مقدمة")}</dt><dd className="tabular-nums">{money(totals.advances_applied)}</dd></div>}
                        <div className="flex justify-between"><dt className="text-slate-600">{t("المدفوع")}</dt><dd className="tabular-nums">{money(invoice.paid)}</dd></div>
                      </>
                    ) : (
                      <div className="flex justify-between"><dt className="text-slate-600">{t("الدفعات المقدمة")}</dt><dd className="tabular-nums">{money(advances)}</dd></div>
                    )}
                    <div className={`flex justify-between rounded-lg px-3 py-2 font-bold ${totals.balance > 0 ? "bg-[#f7eef2] text-[#5d1a3c]" : "bg-emerald-50 text-emerald-800"}`}>
                      <dt>{t(totals.balance > 0 ? "المتبقي" : "مسدد")}</dt><dd className="tabular-nums">{money(totals.balance)}</dd>
                    </div>
                  </dl>
                  {!invoice && r.status !== "cancelled" && <p className="text-xs leading-5 text-slate-500">{t("الفاتورة تصدر عند المغادرة بالليالي والخدمات، وتُخصم منها الدفعات المقدمة.")}</p>}
                </div>
              )}
            </HotelCard>
            <HotelCard>
              <p className="flex items-start gap-2 text-xs leading-6 text-slate-500"><Receipt className="mt-0.5 h-4 w-4 flex-shrink-0" />{t("الدفعة قبل المغادرة تُقيد دفعةً مقدمة (لا إيرادًا). عند المغادرة تصدر فاتورة مبيعات وتُسوّى بها الدفعات المقدمة، وما بعدها سند قبض على الفاتورة. التعديل بعد الفاتورة بإشعار دائن من المبيعات.")}</p>
            </HotelCard>
          </div>
        </div>

        {dialog?.kind === "checkin" && (
          <HotelConfirm
            title="تسجيل الدخول"
            message={`${t("تسجيل دخول")} ${guest?.fullName ?? ""} ${t("إلى")} ${r.units.map((u) => unitById.get(u.unitId)?.code ?? "—").join("، ")}.`}
            confirmLabel="تسجيل الدخول"
            busy={busy}
            onClose={() => setDialog(null)}
            onConfirm={() => void run(() => supabase.rpc("hotel_check_in", { p_id: r.id }), "سُجّل الدخول", () => setDialog(null))}
          >
            {r.units.some((u) => unitById.get(u.unitId)?.housekeeping === "dirty") && (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("تنبيه: وحدة في الحجز تحتاج تنظيفًا.")}</p>
            )}
          </HotelConfirm>
        )}
        {dialog?.kind === "cancel" && (
          <CancelDialog busy={busy} advances={advances} hasCustomer={Boolean(r.customerId)} guestAddress={guest ? nationalAddress(guest) : ""}
            onClose={() => setDialog(null)}
            onConfirm={(p) => void run(() => supabase.rpc("hotel_cancel_reservation", { p_id: r.id, p }), "أُلغي الحجز", () => setDialog(null))} />
        )}
        {dialog?.kind === "checkout" && totals && (
          <CheckoutDialog
            busy={busy}
            totalsTotal={totals.total}
            advances={advances}
            hasCustomer={Boolean(r.customerId)}
            guestAddress={guest ? nationalAddress(guest) : ""}
            reservation={r}
            today={today}
            onAdjust={() => void adjustCheckOutToToday()}
            onClose={() => setDialog(null)}
            onConfirm={(p) => void (async () => {
              setBusy(true);
              const { data, error: checkoutError } = await supabase.rpc("hotel_check_out", { p_id: r.id, p });
              setBusy(false);
              if (checkoutError) {
                toast({ title: t("تعذرت المغادرة"), description: hotelErrorText(checkoutError.message, t), variant: "destructive" });
                return;
              }
              const result = data as { invoice_id: string | null; zatca_phase: string | null };
              toast({
                title: t("سُجّلت المغادرة"),
                description: result.invoice_id
                  ? `${t("الفاتورة")} ${isolate(result.invoice_id)}${result.zatca_phase === "phase2" ? ` — ${t("أرسلها للهيئة من فواتير المبيعات")}` : ""}`
                  : t("لا فاتورة: الإقامة بلا مبلغ"),
              });
              setDialog(null);
              await load();
            })()}
          />
        )}
        {dialog?.kind === "payment" && totals && (
          <PaymentDialog
            mode={dialog.mode}
            busy={busy}
            maxAmount={dialog.mode === "refund" ? advances : Math.max(totals.balance, 0)}
            afterCheckout={Boolean(invoice)}
            onClose={() => setDialog(null)}
            onConfirm={(p) => void run(
              () => supabase.rpc(dialog.mode === "refund" ? "hotel_refund_payment" : "hotel_record_payment", {
                p_reservation: r.id, p_amount: p.amount, p_method: p.method, p_reference: p.reference || null, p_deposit_account: p.depositAccount || null,
              }),
              dialog.mode === "refund" ? "سُجّل رد الدفعة" : "سُجّل القبض",
              () => setDialog(null),
            )}
          />
        )}
        {dialog?.kind === "delete-charge" && (
          <HotelConfirm
            title="حذف خدمة"
            message={`${t("حذف")} «${dialog.description}» ${t("من الحجز؟")}`}
            confirmLabel="حذف الخدمة"
            danger
            busy={busy}
            onClose={() => setDialog(null)}
            onConfirm={() => void run(() => supabase.rpc("hotel_delete_charge", { p_id: dialog.chargeId }), "حُذفت الخدمة", () => setDialog(null))}
          />
        )}
        {dialog?.kind === "guest" && guest && (
          <GuestFormModal guest={guest} customers={customers} onClose={() => setDialog(null)}
            onSaved={() => { setDialog(null); toast({ title: t("حُفظ النزيل") }); void load(); }} />
        )}
      </main>
    </Layout>
  );
}

/** نوع الفاتورة وعنوان المشتري (للمغادرة وللإلغاء برسوم) */
type InvoiceChoice = { invoice_type: "simplified" | "standard"; customer_address?: string };
function InvoiceOptions({ hasCustomer, guestAddress, onChange }: {
  hasCustomer: boolean; guestAddress: string; onChange: (value: InvoiceChoice, valid: boolean) => void;
}) {
  const { t } = useI18n();
  const [invoiceType, setInvoiceType] = useState<"simplified" | "standard">("simplified");
  const [address, setAddress] = useState("");
  const [parts, setParts] = useState({ buildingNumber: "", street: "", district: "", city: "", postalCode: "" });
  const [useCustom, setUseCustom] = useState(false);
  const composed = nationalAddress(parts);
  const custom = useCustom ? (composed || address) : "";
  const customInvalid = useCustom && !addressComplete(custom);
  useEffect(() => {
    onChange({ invoice_type: invoiceType, ...(useCustom ? { customer_address: custom } : {}) }, !customInvalid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceType, useCustom, custom, customInvalid]);
  return (
    <>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-xs font-semibold text-slate-600">{t("نوع الفاتورة")}</legend>
        <label className="flex items-start gap-2"><input type="radio" checked={invoiceType === "simplified"} onChange={() => setInvoiceType("simplified")} className="mt-1" />
          <span><b>{t("فاتورة ضريبية مبسطة")}</b><span className="block text-xs text-slate-500">{t("للأفراد: باسم النزيل، أو باسم الشركة المرتبطة بالحجز")}</span></span></label>
        <label className={`flex items-start gap-2 ${hasCustomer ? "" : "opacity-50"}`}><input type="radio" disabled={!hasCustomer} checked={invoiceType === "standard"} onChange={() => setInvoiceType("standard")} className="mt-1" />
          <span><b>{t("فاتورة ضريبية")}</b><span className="block text-xs text-slate-500">{t(hasCustomer ? "للشركات: برقمها الضريبي وسجلها التجاري وعنوانها من بطاقة العميل" : "تتطلب ربط الحجز بعميل (شركة) من «تعديل»")}</span></span></label>
      </fieldset>
      <fieldset className="space-y-2 rounded-xl border p-3">
        <legend className="px-1 text-xs font-semibold text-slate-600">{t("عنوان المشتري في الفاتورة")}</legend>
        <label className="flex items-start gap-2"><input type="radio" checked={!useCustom} onChange={() => setUseCustom(false)} className="mt-1" />
          <span>{t(invoiceType === "standard" ? "تلقائي: عنوان العميل في بطاقته" : "تلقائي: عنوان العميل، ثم عنوان النزيل، ثم العنوان الافتراضي في الإعدادات")}
            {guestAddress && invoiceType === "simplified" ? <span className="block text-xs text-slate-500">{guestAddress}</span> : null}</span></label>
        <label className="flex items-start gap-2"><input type="radio" checked={useCustom} onChange={() => setUseCustom(true)} className="mt-1" /><span>{t("عنوان آخر")}</span></label>
        {useCustom && (
          <div className="grid gap-2 md:grid-cols-5">
            <input value={parts.buildingNumber} onChange={(e) => setParts({ ...parts, buildingNumber: e.target.value })} placeholder={t("رقم المبنى")} className={`${hotelInput} text-left`} dir="ltr" maxLength={4} />
            <input value={parts.street} onChange={(e) => setParts({ ...parts, street: e.target.value })} placeholder={t("الشارع")} className={`${hotelInput} md:col-span-2`} />
            <input value={parts.district} onChange={(e) => setParts({ ...parts, district: e.target.value })} placeholder={t("الحي")} className={`${hotelInput} md:col-span-2`} />
            <input value={parts.city} onChange={(e) => setParts({ ...parts, city: e.target.value })} placeholder={t("المدينة")} className={`${hotelInput} md:col-span-3`} />
            <input value={parts.postalCode} onChange={(e) => setParts({ ...parts, postalCode: e.target.value })} placeholder={t("الرمز البريدي")} className={`${hotelInput} text-left md:col-span-2`} dir="ltr" maxLength={5} />
            {!composed && <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="1234 شارع، حي، مدينة، 12345" className={`${hotelInput} md:col-span-5`} />}
            {customInvalid && <p className="text-xs text-red-600 md:col-span-5">{t("العنوان الوطني ناقص: رقم المبنى (4 أرقام) والشارع والحي والمدينة والرمز البريدي (5 أرقام)")}</p>}
          </div>
        )}
      </fieldset>
    </>
  );
}

/** الإلغاء: بلا رسوم (بعد رد الدفعات المقدمة)، أو برسوم إلغاء أو عدم حضور تصدر بها فاتورة وتُسوّى منها الدفعات */
function CancelDialog({ busy, advances, hasCustomer, guestAddress, onClose, onConfirm }: {
  busy: boolean; advances: number; hasCustomer: boolean; guestAddress: string; onClose: () => void;
  onConfirm: (p: Record<string, unknown>) => void;
}) {
  const { t } = useI18n();
  const money = useMoney();
  const [reason, setReason] = useState("");
  const [withFee, setWithFee] = useState(advances > 0);
  const [fee, setFee] = useState("");
  const [invoice, setInvoice] = useState<InvoiceChoice>({ invoice_type: "simplified" });
  const [invoiceValid, setInvoiceValid] = useState(true);
  const feeValue = isMoney(fee) ? Number(fee) : 0;
  const tax = Math.round(feeValue * 15) / 100;
  const total = Math.round((feeValue + tax) * 100) / 100;
  const feeValid = isMoney(fee) && feeValue > 0;
  const excess = Math.round((advances - total) * 100) / 100;
  const blocked = withFee ? !feeValid || !invoiceValid || excess > 0 : advances > 0;
  return (
    <HotelModal
      title="إلغاء الحجز"
      onClose={onClose}
      busy={busy}
      wide={withFee}
      footer={
        <>
          <HotelButton variant="outline" onClick={onClose} disabled={busy}>{t("رجوع")}</HotelButton>
          <HotelButton variant="danger" busy={busy} disabled={blocked}
            onClick={() => onConfirm({ reason: reason.trim() || null, ...(withFee ? { fee: feeValue, ...invoice } : {}) })}>
            <Ban className="h-4 w-4" />{t(withFee ? "الإلغاء وإصدار فاتورة الرسوم" : "إلغاء الحجز")}
          </HotelButton>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <fieldset className="space-y-2">
          <label className="flex items-start gap-2"><input type="radio" checked={!withFee} onChange={() => setWithFee(false)} className="mt-1" />
            <span><b>{t("بلا رسوم")}</b><span className="block text-xs text-slate-500">{t("يُلغى الحجز وتصبح وحداته متاحة. تُرد الدفعات المقدمة أولًا من «المقبوضات».")}</span></span></label>
          <label className="flex items-start gap-2"><input type="radio" checked={withFee} onChange={() => setWithFee(true)} className="mt-1" />
            <span><b>{t("برسوم إلغاء أو عدم حضور")}</b><span className="block text-xs text-slate-500">{t("تصدر فاتورة مبيعات بالرسوم وضريبتها، وتُسوّى منها الدفعات المقدمة، والباقي على النزيل.")}</span></span></label>
        </fieldset>
        {!withFee && advances > 0 && <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">{t("على الحجز دفعات مقدمة")} ({money(advances)})؛ {t("رُدّها من «المقبوضات» قبل الإلغاء بلا رسوم.")}</p>}
        {withFee && (
          <>
            <label className={hotelLabel}>{t("الرسوم قبل الضريبة")}
              <input value={fee} onChange={(e) => setFee(e.target.value)} className={`${hotelInput} text-left tabular-nums`} dir="ltr" inputMode="decimal" autoFocus />
            </label>
            <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-center">
              <div><p className="text-xs text-slate-500">{t("الفاتورة شاملة الضريبة")}</p><p className="font-bold tabular-nums">{money(total)}</p></div>
              <div><p className="text-xs text-slate-500">{t("الدفعات المقدمة")}</p><p className="font-bold tabular-nums">{money(advances)}</p></div>
              <div><p className="text-xs text-slate-500">{t("المتبقي على النزيل")}</p><p className="font-bold tabular-nums">{money(Math.max(total - advances, 0))}</p></div>
            </div>
            {feeValid && excess > 0 && <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">{t("الدفعات المقدمة أكبر من فاتورة الرسوم؛ رُدّ الفرق أولًا من «المقبوضات»")}: {money(excess)}</p>}
            {fee && !feeValid && <p className="text-xs text-red-600">{t("رسوم الإلغاء رقم موجب بخانتين عشريتين على الأكثر")}</p>}
            <InvoiceOptions hasCustomer={hasCustomer} guestAddress={guestAddress} onChange={(value, valid) => { setInvoice(value); setInvoiceValid(valid); }} />
          </>
        )}
        <label className={hotelLabel}>{t("السبب (اختياري)")}
          <input value={reason} onChange={(e) => setReason(e.target.value)} className={hotelInput} maxLength={500} placeholder={t("مثل: عدم حضور، طلب النزيل")} />
        </label>
      </div>
    </HotelModal>
  );
}

function CheckoutDialog({
  busy, totalsTotal, advances, hasCustomer, guestAddress, reservation, today, onAdjust, onClose, onConfirm,
}: {
  busy: boolean; totalsTotal: number; advances: number; hasCustomer: boolean; guestAddress: string;
  reservation: HotelReservation; today: string; onAdjust: () => void;
  onClose: () => void; onConfirm: (p: Record<string, unknown>) => void;
}) {
  const { t, formatNumber } = useI18n();
  const money = useMoney();
  const [invoice, setInvoice] = useState<InvoiceChoice>({ invoice_type: "simplified" });
  const [invoiceValid, setInvoiceValid] = useState(true);
  const [keepBooked, setKeepBooked] = useState(false);
  // الفاتورة بالليالي المحجوزة؛ إن اختلف اليوم عن تاريخ المغادرة يُختار: تعديله إلى اليوم، أو تأكيد الليالي المحجوزة
  const booked = nightsBetween(reservation.checkIn, reservation.checkOut);
  const actual = nightsBetween(reservation.checkIn, today);
  const mismatch = today !== reservation.checkOut;
  const early = today < reservation.checkOut;
  return (
    <HotelModal
      title="تسجيل المغادرة وإصدار الفاتورة"
      onClose={onClose}
      busy={busy}
      wide
      footer={
        <>
          <HotelButton variant="outline" onClick={onClose} disabled={busy}>{t("رجوع")}</HotelButton>
          <HotelButton onClick={() => onConfirm({ ...invoice, ...(mismatch ? { keep_booked_nights: true } : {}) })} busy={busy}
            disabled={(totalsTotal > 0 && !invoiceValid) || (mismatch && !keepBooked)}>
            <LogOut className="h-4 w-4" />{t("تسجيل المغادرة")}
          </HotelButton>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        {mismatch && (
          <div className="space-y-2 rounded-xl border border-orange-200 bg-orange-50 p-3 text-orange-950">
            <p className="font-semibold">
              {early
                ? `${t("المغادرة قبل موعدها")}: ${t("الحجز")} ${formatNumber(booked)} ${t("ليلة")}، ${t("والإقامة حتى اليوم")} ${formatNumber(actual)} ${t("ليلة")}.`
                : `${t("تجاوز النزيل تاريخ المغادرة")}: ${t("الحجز")} ${formatNumber(booked)} ${t("ليلة")}، ${t("والإقامة حتى اليوم")} ${formatNumber(actual)} ${t("ليلة")}.`}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {actual >= 1 && (
                <HotelButton variant="outline" onClick={onAdjust} busy={busy}>
                  {t(early ? "تعديل المغادرة إلى اليوم" : "تمديد الإقامة إلى اليوم")} ({formatNumber(actual)} {t("ليلة")})
                </HotelButton>
              )}
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={keepBooked} onChange={(e) => setKeepBooked(e.target.checked)} />
                <span>{t("المغادرة بالليالي المحجوزة")} ({formatNumber(booked)} {t("ليلة")})</span>
              </label>
            </div>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-center">
          <div><p className="text-xs text-slate-500">{t("الإجمالي")}</p><p className="font-bold tabular-nums">{money(totalsTotal)}</p></div>
          <div><p className="text-xs text-slate-500">{t("الدفعات المقدمة")}</p><p className="font-bold tabular-nums">{money(advances)}</p></div>
          <div><p className="text-xs text-slate-500">{t("المتبقي بعد الفاتورة")}</p><p className="font-bold tabular-nums">{money(Math.max(totalsTotal - advances, 0))}</p></div>
        </div>
        {totalsTotal > 0 ? (
          <>
            <InvoiceOptions hasCustomer={hasCustomer} guestAddress={guestAddress} onChange={(value, valid) => { setInvoice(value); setInvoiceValid(valid); }} />
            <p className="text-xs leading-5 text-slate-500">{t("تصدر فاتورة مبيعات بالليالي والخدمات ورسوم البلدية (إن وجدت)، وتُرحَّل محاسبيًا، وتُسوّى بها الدفعات المقدمة. تصبح الوحدات «تحتاج تنظيفًا».")}</p>
            {COMPANY_PROFILE.zatcaPhase === "phase2" && <p className="text-xs leading-5 text-amber-800">{t("منشأتك في المرحلة الثانية: بعد المغادرة أرسل الفاتورة للهيئة من «فواتير المبيعات».")}</p>}
          </>
        ) : <p className="text-slate-600">{t("الإقامة بلا مبلغ: تُسجَّل المغادرة بلا فاتورة.")}</p>}
      </div>
    </HotelModal>
  );
}

function PaymentDialog({
  mode, busy, maxAmount, afterCheckout, onClose, onConfirm,
}: {
  mode: "receive" | "refund"; busy: boolean; maxAmount: number; afterCheckout: boolean; onClose: () => void;
  onConfirm: (p: { amount: number; method: string; reference: string; depositAccount: string }) => void;
}) {
  const { t } = useI18n();
  const money = useMoney();
  const [amount, setAmount] = useState(maxAmount > 0 ? maxAmount.toFixed(2) : "");
  const [method, setMethod] = useState("نقدي");
  const [reference, setReference] = useState("");
  const [accounts, setAccounts] = useState<DepositAccount[]>([]);
  const [depositAccount, setDepositAccount] = useState("");
  useEffect(() => { void listDepositAccounts().then(setAccounts); }, []);
  const methods = mode === "refund" ? PAYMENT_METHODS.filter((m) => m.value !== "شيك") : PAYMENT_METHODS;
  const kind = method === "نقدي" ? "cash" : "bank";
  const choices = method === "شيك" ? [] : accounts.filter((a) => a.account_kind === kind);
  useEffect(() => {
    // الحساب الافتراضي للطريقة: الخزينة للنقد، والبنك الوحيد للتحويل والبطاقة
    setDepositAccount(choices.find((a) => a.account_code === "1111")?.account_code ?? (choices.length === 1 ? choices[0].account_code : ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, accounts]);
  const valid = isMoney(amount) && Number(amount) > 0 && Number(amount) <= maxAmount + 0.0001;
  const needsAccount = method !== "شيك" && choices.length > 1 && !depositAccount;
  return (
    <HotelModal
      title={mode === "refund" ? "رد دفعة مقدمة" : afterCheckout ? "سداد المتبقي من الفاتورة" : "قبض دفعة مقدمة"}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <HotelButton variant="outline" onClick={onClose} disabled={busy}>{t("رجوع")}</HotelButton>
          <HotelButton onClick={() => onConfirm({ amount: Number(amount), method, reference: reference.trim(), depositAccount })} busy={busy} disabled={!valid || needsAccount}>
            {t(mode === "refund" ? "تسجيل الرد" : "تسجيل القبض")}
          </HotelButton>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-slate-600">{t(mode === "refund" ? "الحد الأقصى (الدفعات المقدمة)" : "المتبقي")}: <b className="tabular-nums">{money(maxAmount)}</b></p>
        <label className={hotelLabel}>{t("المبلغ")}
          <input value={amount} onChange={(e) => setAmount(e.target.value)} className={`${hotelInput} text-left tabular-nums`} dir="ltr" inputMode="decimal" autoFocus />
        </label>
        <label className={hotelLabel}>{t("الطريقة")}
          <select value={method} onChange={(e) => setMethod(e.target.value)} className={hotelSelect}>
            {methods.map((m) => <option key={m.value} value={m.value}>{t(m.label)}</option>)}
          </select>
        </label>
        {method === "شيك" ? <p className="text-xs text-slate-500">{t("الشيك يُقيد في «شيكات تحت التحصيل».")}</p> : (
          <label className={hotelLabel}>{t(mode === "refund" ? "يُصرف من" : "يُودع في")}
            <select value={depositAccount} onChange={(e) => setDepositAccount(e.target.value)} className={hotelSelect}>
              <option value="">{t(choices.length === 1 ? "تلقائي" : "اختر الحساب")}</option>
              {choices.map((a) => <option key={a.account_code} value={a.account_code}>{a.account_code} — {a.name}</option>)}
            </select>
          </label>
        )}
        <label className={hotelLabel}>{t("المرجع (رقم الإيصال أو العملية) — اختياري")}
          <input value={reference} onChange={(e) => setReference(e.target.value)} className={hotelInput} maxLength={100} />
        </label>
        {!valid && amount && <p className="text-xs text-red-600">{t("المبلغ رقم موجب بخانتين على الأكثر ولا يتجاوز الحد")}</p>}
      </div>
    </HotelModal>
  );
}
