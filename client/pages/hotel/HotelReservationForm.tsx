import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { BedDouble, CalendarPlus, Check, Save, Search, UserPlus, Users } from "lucide-react";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import {
  SOURCES, addDays, estimateStay, hotelErrorText, hotelToday, isMoney, isolate, loadGuests, loadHotelSetup, loadReservationBundle,
  nightsBetween, type AvailableUnit, type HotelGuest, type HotelReservation, type HotelSetup, type Option,
} from "@/lib/hotel";
import GuestFormModal, { loadCustomerOptions } from "@/components/hotel/GuestFormModal";
import { ErrorNote, HotelButton, HotelCard, HotelHeader, hotelInput, hotelLabel, hotelSelect, useMoney } from "@/components/hotel/HotelUi";

type Selected = Map<string, string>; // الوحدة ← سعر الليلة (نص)

/** حجز جديد أو تعديل حجز (التواريخ والوحدات وسعرها والنزلاء والخصم) */
export default function HotelReservationForm() {
  const { t, direction, formatNumber } = useI18n();
  const money = useMoney();
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const editing = Boolean(id);
  const query = useMemo(() => new URLSearchParams(location.search), [location.search]);

  const [setup, setSetup] = useState<HotelSetup>({ types: [], floors: [], units: [] });
  const [guests, setGuests] = useState<HotelGuest[]>([]);
  const [customers, setCustomers] = useState<Option[]>([]);
  const [municipalityRate, setMunicipalityRate] = useState(0);
  const [existing, setExisting] = useState<HotelReservation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const initialFrom = /^\d{4}-\d{2}-\d{2}$/.test(query.get("from") ?? "") ? String(query.get("from")) : hotelToday();
  const [checkIn, setCheckIn] = useState(initialFrom < hotelToday() ? hotelToday() : initialFrom);
  const [checkOut, setCheckOut] = useState(addDays(initialFrom < hotelToday() ? hotelToday() : initialFrom, 1));
  const [guestId, setGuestId] = useState("");
  const [guestSearch, setGuestSearch] = useState("");
  const [guestModal, setGuestModal] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [adults, setAdults] = useState("1");
  const [children, setChildren] = useState("0");
  const [source, setSource] = useState(query.get("source") === "walk_in" ? "walk_in" : "direct");
  const [notes, setNotes] = useState("");
  const [discount, setDiscount] = useState("0");
  const [selected, setSelected] = useState<Selected>(new Map());
  const [available, setAvailable] = useState<AvailableUnit[]>([]);
  const [availableLoading, setAvailableLoading] = useState(false);
  const [availableError, setAvailableError] = useState("");
  const preselected = useRef(query.get("unit"));

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [setupResult, guestResult, customerList, settings] = await Promise.all([
        loadHotelSetup(), loadGuests(), loadCustomerOptions(), supabase.rpc("hotel_get_settings"),
      ]);
      setSetup(setupResult.data);
      setGuests(guestResult.data);
      setCustomers(customerList);
      if (!settings.error && settings.data) setMunicipalityRate(Number((settings.data as { municipality_rate?: number }).municipality_rate ?? 0));
      const firstError = setupResult.error ?? guestResult.error ?? settings.error;
      if (firstError) setError(hotelErrorText(firstError.message, t));
      if (id) {
        const bundle = await loadReservationBundle(id);
        if (bundle.error || !bundle.data) {
          setError(bundle.error ? hotelErrorText(bundle.error.message, t) : t("الحجز غير موجود"));
        } else {
          const r = bundle.data.reservation;
          setExisting(r);
          setCheckIn(r.checkIn);
          setCheckOut(r.checkOut);
          setGuestId(r.guestId);
          setCustomerId(r.customerId);
          setAdults(String(r.adults));
          setChildren(String(r.children));
          setSource(r.source);
          setNotes(r.notes);
          setDiscount(String(r.discount));
          setSelected(new Map(r.units.map((u) => [u.unitId, u.nightlyRate.toFixed(2)])));
        }
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const nights = nightsBetween(checkIn, checkOut);
  const datesValid = nights > 0 && nights <= 365;

  // الوحدات المتاحة للفترة (مع وحدات هذا الحجز عند التعديل)
  useEffect(() => {
    if (loading || !datesValid) { setAvailable([]); return; }
    let active = true;
    setAvailableLoading(true);
    const timer = window.setTimeout(async () => {
      const { data, error: availableErr } = await supabase.rpc("hotel_available_units", { p_from: checkIn, p_to: checkOut, p_exclude: id ?? null });
      if (!active) return;
      setAvailableLoading(false);
      if (availableErr) { setAvailableError(hotelErrorText(availableErr.message, t)); setAvailable([]); return; }
      setAvailableError("");
      const list = (data ?? []) as AvailableUnit[];
      setAvailable(list);
      // وحدة مختارة من لوحة الاستقبال
      if (preselected.current) {
        const unit = list.find((u) => u.unit_id === preselected.current);
        if (unit) setSelected(new Map([[unit.unit_id, Number(unit.nightly_rate).toFixed(2)]]));
        preselected.current = null;
      }
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkIn, checkOut, loading, datesValid, id]);

  const availableIds = useMemo(() => new Set(available.map((u) => u.unit_id)), [available]);
  const unitById = useMemo(() => new Map(setup.units.map((u) => [u.id, u])), [setup.units]);
  const typeById = useMemo(() => new Map(setup.types.map((type) => [type.id, type])), [setup.types]);
  // مختارة لكنها لم تعد متاحة في الفترة الجديدة
  const unavailableSelected = [...selected.keys()].filter((unitId) => !availableIds.has(unitId) && !availableLoading);

  const capacityOf = (unitId: string) => {
    const fromAvailable = available.find((u) => u.unit_id === unitId)?.max_occupancy;
    if (fromAvailable) return fromAvailable;
    const unit = unitById.get(unitId);
    return unit?.maxOccupancy ?? typeById.get(unit?.typeId ?? "")?.maxOccupancy ?? 1;
  };
  const capacity = [...selected.keys()].reduce((sum, unitId) => sum + capacityOf(unitId), 0);
  const guestsCount = (Number(adults) || 0) + (Number(children) || 0);

  const rates = [...selected.values()].map((v) => (isMoney(v) ? Number(v) : 0));
  const estimate = estimateStay({ nights: datesValid ? nights : 0, rates, discount: isMoney(discount) ? Number(discount) : 0, municipalityRate });

  const toggleUnit = (unit: AvailableUnit) => {
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(unit.unit_id)) next.delete(unit.unit_id);
      else next.set(unit.unit_id, Number(unit.nightly_rate).toFixed(2));
      return next;
    });
  };

  const guest = guests.find((g) => g.id === guestId) ?? null;
  const guestMatches = useMemo(() => {
    const q = guestSearch.trim().toLowerCase();
    if (!q) return [];
    return guests.filter((g) => `${g.fullName} ${g.phone} ${g.idNumber}`.toLowerCase().includes(q)).slice(0, 8);
  }, [guestSearch, guests]);

  const byType = useMemo(() => {
    const groups = new Map<string, AvailableUnit[]>();
    available.forEach((unit) => groups.set(unit.type_name, [...(groups.get(unit.type_name) ?? []), unit]));
    return [...groups.entries()];
  }, [available]);

  const checkedIn = existing?.status === "checked_in";
  const closed = existing && (existing.status === "checked_out" || existing.status === "cancelled");

  const save = async () => {
    setError("");
    if (!guestId) { setError(t("اختر النزيل أو أضفه")); return; }
    if (!datesValid) { setError(t("تاريخ المغادرة يجب أن يكون بعد تاريخ الوصول (سنة على الأكثر)")); return; }
    if (selected.size === 0) { setError(t("اختر وحدة واحدة على الأقل")); return; }
    if ([...selected.values()].some((v) => !isMoney(v))) { setError(t("سعر الليلة رقم موجب بخانتين عشريتين على الأكثر")); return; }
    if (!isMoney(discount || "0")) { setError(t("الخصم رقم موجب بخانتين عشريتين على الأكثر")); return; }
    if (estimate.discountTooLarge) { setError(t("الخصم لا يتجاوز مبلغ الإقامة، وبخانتين على الأكثر")); return; }
    if (!(Number(adults) >= 1) || !Number.isInteger(Number(adults)) || !(Number(children) >= 0) || !Number.isInteger(Number(children))) {
      setError(t("عدد النزلاء غير صحيح")); return;
    }
    if (guestsCount > capacity) { setError(t("عدد النزلاء أكبر من سعة الوحدات المختارة")); return; }
    setBusy(true);
    const payload = {
      guest_id: guestId, customer_id: customerId || null, check_in: checkIn, check_out: checkOut,
      adults: Number(adults), children: Number(children), source, notes: notes.trim() || null, discount: Number(discount || 0),
      units: [...selected.entries()].map(([unitId, rate]) => ({ unit_id: unitId, nightly_rate: Number(rate) })),
    };
    const { data, error: saveError } = await supabase.rpc("hotel_save_reservation", { p_id: id ?? null, p: payload });
    setBusy(false);
    if (saveError) { setError(hotelErrorText(saveError.message, t)); return; }
    const result = data as { id: string; reservation_number: string };
    toast({ title: t(editing ? "تم حفظ الحجز" : "تم إنشاء الحجز"), description: isolate(result.reservation_number) });
    navigate(`/hotel/reservations/${result.id}`);
  };

  return (
    <Layout>
      <main dir={direction} className="space-y-5">
        <HotelHeader
          icon={CalendarPlus}
          title={editing ? "تعديل الحجز" : "حجز جديد"}
          description={editing && existing
            ? `${isolate(existing.number)}${checkedIn ? ` — ${t("النزيل مقيم: يمكن تمديد الإقامة أو تقصيرها ونقله إلى وحدة أخرى، وتاريخ الوصول ثابت.")}` : ""}`
            : "اختر الفترة ثم الوحدات المتاحة والنزيل. الأسعار قبل ضريبة القيمة المضافة، والفاتورة تصدر عند المغادرة."}
          actions={
            <>
              <HotelButton variant="outline" onClick={() => navigate(editing && id ? `/hotel/reservations/${id}` : "/hotel/reservations")}>{t("رجوع")}</HotelButton>
              <HotelButton onClick={() => void save()} busy={busy} disabled={loading || Boolean(closed)}><Save className="h-4 w-4" />{t("حفظ الحجز")}</HotelButton>
            </>
          }
        />
        <ErrorNote message={error} />
        {closed ? <ErrorNote message={t("الحجز مغلق (غادر النزيل أو أُلغي الحجز)")} /> : null}

        {loading ? <div className="rounded-xl border bg-white p-10 text-center text-slate-500">{t("جاري التحميل...")}</div> : (
          <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
            <div className="space-y-5">
              <HotelCard title="الفترة والنزلاء">
                <div className="grid gap-3 md:grid-cols-4">
                  <label className={hotelLabel}>{t("الوصول")}
                    <input type="date" value={checkIn} min={editing ? undefined : hotelToday()} disabled={checkedIn}
                      onChange={(e) => { const v = e.target.value; setCheckIn(v); if (v && checkOut <= v) setCheckOut(addDays(v, 1)); }} className={hotelInput} />
                  </label>
                  <label className={hotelLabel}>{t("المغادرة")}
                    <input type="date" value={checkOut} min={addDays(checkIn || hotelToday(), 1)} onChange={(e) => setCheckOut(e.target.value)} className={hotelInput} />
                  </label>
                  <label className={hotelLabel}>{t("البالغون")}
                    <input type="number" min={1} max={100} value={adults} onChange={(e) => setAdults(e.target.value)} className={hotelInput} />
                  </label>
                  <label className={hotelLabel}>{t("الأطفال")}
                    <input type="number" min={0} max={100} value={children} onChange={(e) => setChildren(e.target.value)} className={hotelInput} />
                  </label>
                </div>
                <p className="mt-3 text-sm text-slate-600">
                  {datesValid ? `${formatNumber(nights)} ${t("ليلة")}` : t("تاريخ المغادرة بعد تاريخ الوصول")}
                  {selected.size > 0 ? ` — ${t("السعة")} ${formatNumber(capacity)} ${t("نزيل")}` : ""}
                  {selected.size > 0 && guestsCount > capacity ? <span className="font-semibold text-red-600"> — {t("عدد النزلاء أكبر من السعة")}</span> : null}
                </p>
              </HotelCard>

              <HotelCard title="الوحدات المتاحة" actions={availableLoading ? <span className="text-xs text-slate-500">{t("جاري التحقق من التوفر...")}</span> : undefined}>
                <ErrorNote message={availableError} />
                {unavailableSelected.length > 0 && (
                  <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    {t("وحدات مختارة غير متاحة في الفترة الجديدة")}: {unavailableSelected.map((unitId) => unitById.get(unitId)?.code ?? "—").join("، ")}
                    <button onClick={() => setSelected((current) => { const next = new Map(current); unavailableSelected.forEach((unitId) => next.delete(unitId)); return next; })}
                      className="ms-2 font-semibold underline">{t("إزالتها")}</button>
                  </div>
                )}
                {!datesValid ? <p className="text-sm text-slate-500">{t("حدد الفترة أولًا")}</p>
                  : available.length === 0 && !availableLoading ? <p className="text-sm text-slate-500">{t("لا توجد وحدات متاحة في هذه الفترة")}</p>
                  : (
                    <div className="space-y-4">
                      {byType.map(([typeName, list]) => (
                        <div key={typeName}>
                          <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700"><BedDouble className="h-4 w-4 text-[#7a2450]" />{typeName}</h3>
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {list.map((unit) => {
                              const on = selected.has(unit.unit_id);
                              return (
                                <div key={unit.unit_id} className={cn("rounded-xl border-2 p-3 transition", on ? "border-[#7a2450] bg-[#fbf3f7]" : "border-slate-200 bg-white")}>
                                  <button type="button" onClick={() => toggleUnit(unit)} className="flex w-full items-start justify-between gap-2 text-start">
                                    <span>
                                      <span className="block text-lg font-extrabold tabular-nums text-slate-900">{unit.code}</span>
                                      <span className="block text-xs text-slate-500">{unit.floor_name ? `${unit.floor_name}، ` : ""}{t("حتى")} {formatNumber(unit.max_occupancy)} {t("نزيل")}{unit.housekeeping_status === "dirty" ? `، ${t("تحتاج تنظيفًا")}` : ""}</span>
                                    </span>
                                    <span className={cn("flex h-6 w-6 items-center justify-center rounded-md border", on ? "border-[#7a2450] bg-[#7a2450] text-white" : "border-slate-300")}>{on ? <Check className="h-4 w-4" /> : null}</span>
                                  </button>
                                  {on ? (
                                    <label className="mt-2 block text-[11px] text-slate-600">{t("سعر الليلة (قبل الضريبة)")}
                                      <input value={selected.get(unit.unit_id) ?? ""} inputMode="decimal" dir="ltr"
                                        onChange={(e) => { const v = e.target.value; setSelected((current) => new Map(current).set(unit.unit_id, v)); }}
                                        className={cn(hotelInput, "h-9 text-left tabular-nums", !isMoney(selected.get(unit.unit_id) ?? "") && "border-red-400")} />
                                    </label>
                                  ) : <p className="mt-2 text-sm font-semibold tabular-nums text-slate-700">{money(Number(unit.nightly_rate))} <span className="text-xs font-normal text-slate-500">{t("لليلة")}</span></p>}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
              </HotelCard>

              <HotelCard title="بيانات إضافية">
                <div className="grid gap-3 md:grid-cols-3">
                  <label className={hotelLabel}>{t("مصدر الحجز")}
                    <select value={source} onChange={(e) => setSource(e.target.value)} className={hotelSelect}>
                      {SOURCES.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
                    </select>
                  </label>
                  {customers.length > 0 && (
                    <label className={`${hotelLabel} md:col-span-2`}>{t("الشركة (عميل) — للفاتورة الضريبية، اختياري")}
                      <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={hotelSelect}>
                        <option value="">{t("بدون: الفاتورة باسم النزيل")}</option>
                        {customers.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </label>
                  )}
                  <label className={`${hotelLabel} md:col-span-3`}>{t("ملاحظات")}
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className={`${hotelInput} h-20 py-2`} maxLength={1000} />
                  </label>
                </div>
              </HotelCard>
            </div>

            <div className="space-y-5">
              <HotelCard title="النزيل">
                {guest ? (
                  <div className="space-y-1 text-sm">
                    <p className="text-base font-bold text-slate-900">{guest.fullName}</p>
                    {guest.phone && <p className="text-slate-600" dir="ltr">{guest.phone}</p>}
                    {guest.idNumber ? <p className="text-xs text-slate-500">{t("الهوية")}: <span className="font-mono">{guest.idNumber}</span></p>
                      : <p className="text-xs text-amber-700">{t("الهوية غير مسجلة؛ تُطلب عند تسجيل الدخول")}</p>}
                    <button onClick={() => setGuestId("")} className="mt-2 text-xs font-semibold text-[#7a2450] underline">{t("تغيير النزيل")}</button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="relative">
                      <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input value={guestSearch} onChange={(e) => setGuestSearch(e.target.value)} placeholder={t("ابحث بالاسم أو الجوال أو الهوية")} className="h-10 w-full rounded-lg border bg-white ps-9 pe-3 text-sm" />
                    </div>
                    {guestMatches.length > 0 && (
                      <ul className="max-h-60 divide-y overflow-y-auto rounded-lg border">
                        {guestMatches.map((g) => (
                          <li key={g.id}>
                            <button onClick={() => { setGuestId(g.id); setGuestSearch(""); if (g.customerId && !customerId) setCustomerId(g.customerId); }}
                              className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-slate-50">
                              <Users className="h-4 w-4 text-slate-400" />
                              <span><span className="font-semibold">{g.fullName}</span>{g.phone ? <span className="ms-2 text-xs text-slate-500" dir="ltr">{g.phone}</span> : null}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {guestSearch.trim() && guestMatches.length === 0 ? <p className="text-xs text-slate-500">{t("لا يوجد نزيل بهذا البحث")}</p> : null}
                    <HotelButton variant="outline" onClick={() => setGuestModal(true)} className="w-full"><UserPlus className="h-4 w-4" />{t("إضافة نزيل جديد")}</HotelButton>
                  </div>
                )}
              </HotelCard>

              <HotelCard title="المبلغ التقديري">
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between"><dt className="text-slate-600">{t("الإقامة")} ({formatNumber(datesValid ? nights : 0)} {t("ليلة")})</dt><dd className="tabular-nums">{money(estimate.roomTotal)}</dd></div>
                  <label className="flex items-center justify-between gap-3">
                    <span className="text-slate-600">{t("الخصم")}</span>
                    <input value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" dir="ltr"
                      className={cn("h-8 w-28 rounded-lg border px-2 text-left text-sm tabular-nums", (!isMoney(discount || "0") || estimate.discountTooLarge) && "border-red-400")} />
                  </label>
                  {estimate.fee > 0 && <div className="flex justify-between"><dt className="text-slate-600">{t("رسوم البلدية")} ({formatNumber(municipalityRate)}%)</dt><dd className="tabular-nums">{money(estimate.fee)}</dd></div>}
                  <div className="flex justify-between border-t pt-2"><dt className="text-slate-600">{t("المجموع قبل الضريبة")}</dt><dd className="tabular-nums">{money(estimate.subtotal)}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-600">{t("ضريبة القيمة المضافة 15%")}</dt><dd className="tabular-nums">{money(estimate.tax)}</dd></div>
                  <div className="flex justify-between border-t pt-2 text-base font-bold"><dt>{t("الإجمالي")}</dt><dd className="tabular-nums">{money(estimate.total)}</dd></div>
                </dl>
                <p className="mt-3 text-xs leading-5 text-slate-500">{t("تقدير قبل الخدمات الإضافية. المبالغ المعتمدة تظهر في الحجز بعد الحفظ، والفاتورة تصدر عند المغادرة.")}</p>
              </HotelCard>
            </div>
          </div>
        )}

        {guestModal && (
          <GuestFormModal
            guest={null}
            customers={customers}
            onClose={() => setGuestModal(false)}
            onSaved={(saved) => {
              setGuests((current) => [saved, ...current.filter((g) => g.id !== saved.id)]);
              setGuestId(saved.id);
              if (saved.customerId && !customerId) setCustomerId(saved.customerId);
              setGuestModal(false);
            }}
          />
        )}
      </main>
    </Layout>
  );
}
