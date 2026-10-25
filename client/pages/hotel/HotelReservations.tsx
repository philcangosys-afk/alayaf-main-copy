import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarPlus, CalendarRange, Search } from "lucide-react";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import { permissionLevelAny } from "@/lib/authSession";
import {
  RESERVATION_STATUSES, SOURCES, addDays, hotelErrorText, hotelToday, loadGuests, loadHotelSetup, loadReservations, nightsBetween,
  optionLabel, type HotelGuest, type HotelReservation, type HotelUnit,
} from "@/lib/hotel";
import { ErrorNote, HotelButton, HotelHeader, ReservationStatusPill, hotelInput, useHotelDate } from "@/components/hotel/HotelUi";
import { DataImportButton } from "@/components/DataImportDialog";
import { hotelReservationsImportSpec } from "@/lib/imports/hotel";

/** قائمة الحجوزات في فترة (بحسب تقاطع الإقامة معها)، مع المقيمين دائمًا */
export default function HotelReservations() {
  const { t, direction, formatNumber, locale } = useI18n();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const importSpec = useMemo(() => hotelReservationsImportSpec(t), [locale]);
  const formatDate = useHotelDate();
  const navigate = useNavigate();
  const { permissions } = useRolePermissions();
  const canBook = permissionLevelAny(permissions, ["hotel.reservations", "module.hotel"]) === "manage";
  const [from, setFrom] = useState(addDays(hotelToday(), -7));
  const [to, setTo] = useState(addDays(hotelToday(), 30));
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<HotelReservation[]>([]);
  const [guests, setGuests] = useState<Map<string, HotelGuest>>(new Map());
  const [units, setUnits] = useState<Map<string, HotelUnit>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    if (!from || !to || to < from) { setError(t("حدد فترة صحيحة")); return; }
    setLoading(true);
    setError("");
    const [reservationResult, guestResult, setupResult] = await Promise.all([
      loadReservations({ from, to: addDays(to, 1) }),
      loadGuests(),
      loadHotelSetup(),
    ]);
    const firstError = reservationResult.error ?? guestResult.error ?? setupResult.error;
    if (firstError) setError(hotelErrorText(firstError.message, t));
    setRows(reservationResult.data);
    setGuests(new Map(guestResult.data.map((g) => [g.id, g])));
    setUnits(new Map(setupResult.data.units.map((u) => [u.id, u])));
    setLoading(false);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => !status || r.status === status)
      .filter((r) => {
        if (!q) return true;
        const guest = guests.get(r.guestId);
        const codes = r.units.map((u) => units.get(u.unitId)?.code ?? "").join(" ");
        return `${r.number} ${guest?.fullName ?? ""} ${guest?.phone ?? ""} ${guest?.idNumber ?? ""} ${codes}`.toLowerCase().includes(q);
      })
      .sort((a, b) => b.checkIn.localeCompare(a.checkIn) || b.number.localeCompare(a.number));
  }, [rows, status, search, guests, units]);

  const counts = RESERVATION_STATUSES.map((s) => ({ ...s, count: rows.filter((r) => r.status === s.value).length }));

  return (
    <Layout>
      <main dir={direction} className="space-y-5">
        <HotelHeader
          icon={CalendarRange}
          title="الحجوزات"
          description="الحجوزات التي تقع إقامتها في الفترة المختارة، والمقيمون حاليًا. افتح الحجز لتسجيل الدخول أو المغادرة أو القبض."
          actions={canBook ? (
            <>
              <DataImportButton spec={importSpec} onDone={() => void load()} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50" />
              <HotelButton onClick={() => navigate("/hotel/reservations/new")}><CalendarPlus className="h-4 w-4" />{t("حجز جديد")}</HotelButton>
            </>
          ) : undefined}
        />

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {counts.map((s) => (
            <button key={s.value} onClick={() => setStatus((current) => current === s.value ? "" : s.value)}
              className={`rounded-xl border bg-white p-4 text-start shadow-sm ${status === s.value ? "ring-2 ring-[#7a2450]" : ""}`}>
              <p className="text-xs text-slate-500">{t(s.label)}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{formatNumber(s.count)}</p>
            </button>
          ))}
        </div>

        <ErrorNote message={error} />

        <section className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <div className="flex flex-wrap items-end gap-2 border-b bg-slate-50 px-4 py-3">
            <label className="text-xs text-slate-600">{t("من")}<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${hotelInput} h-9 w-40`} /></label>
            <label className="text-xs text-slate-600">{t("إلى")}<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${hotelInput} h-9 w-40`} /></label>
            <HotelButton variant="outline" onClick={() => void load()} busy={loading} className="h-9">{t("عرض")}</HotelButton>
            <div className="relative ms-auto w-full max-w-xs">
              <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("ابحث برقم الحجز أو النزيل أو الجوال أو الوحدة")} className="h-9 w-full rounded-lg border bg-white ps-9 pe-3 text-sm" />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="p-3 text-start">{t("رقم الحجز")}</th>
                  <th className="p-3 text-start">{t("النزيل")}</th>
                  <th className="p-3">{t("الوحدات")}</th>
                  <th className="p-3">{t("الوصول")}</th>
                  <th className="p-3">{t("المغادرة")}</th>
                  <th className="p-3">{t("الليالي")}</th>
                  <th className="p-3">{t("المصدر")}</th>
                  <th className="p-3">{t("الحالة")}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? <tr><td colSpan={8} className="py-14 text-center text-slate-500">{t("جاري التحميل...")}</td></tr>
                  : visible.length === 0 ? <tr><td colSpan={8} className="py-14 text-center text-slate-400">{t("لا توجد حجوزات في هذه الفترة")}</td></tr>
                  : visible.map((r) => {
                    const guest = guests.get(r.guestId);
                    return (
                      <tr key={r.id} onClick={() => navigate(`/hotel/reservations/${r.id}`)} className="cursor-pointer border-t hover:bg-[#fbf6f8]">
                        <td className="p-3 font-mono text-xs" dir="ltr">{r.number}</td>
                        <td className="p-3">
                          <span className="font-semibold text-slate-900">{guest?.fullName ?? "—"}</span>
                          {guest?.phone ? <span className="block text-xs text-slate-500" dir="ltr">{guest.phone}</span> : null}
                        </td>
                        <td className="p-3 text-center font-semibold tabular-nums">{r.units.map((u) => units.get(u.unitId)?.code ?? "—").join("، ")}</td>
                        <td className="p-3 text-center">{formatDate(r.checkIn, { dateStyle: "medium" })}</td>
                        <td className="p-3 text-center">{formatDate(r.checkOut, { dateStyle: "medium" })}</td>
                        <td className="p-3 text-center tabular-nums">{formatNumber(nightsBetween(r.checkIn, r.checkOut))}</td>
                        <td className="p-3 text-center text-xs">{t(optionLabel(SOURCES, r.source))}</td>
                        <td className="p-3 text-center"><ReservationStatusPill status={r.status} /></td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </Layout>
  );
}
