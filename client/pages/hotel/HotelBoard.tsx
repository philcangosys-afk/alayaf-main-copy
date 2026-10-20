import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarPlus, ConciergeBell, DoorOpen, LogIn, LogOut, RefreshCw, Sparkles, Wrench } from "lucide-react";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import { permissionLevelAny } from "@/lib/authSession";
import {
  UNIT_STATE_LABELS, addDays, arrivalsOn, departuresOn, hotelErrorText, hotelToday, housekeepingOf, loadGuests, loadHotelSetup,
  loadReservations, nightsBetween, unitStates, type HotelGuest, type HotelReservation, type HotelSetup, type UnitDayState,
} from "@/lib/hotel";
import { ErrorNote, HotelButton, HotelCard, HotelHeader, hotelInput, useHotelDate } from "@/components/hotel/HotelUi";

/** لوحة الاستقبال: حالة الوحدات اليوم، والوصول والمغادرة، وما يحتاج تنظيفًا */
export default function HotelBoard() {
  const { t, direction, formatNumber } = useI18n();
  const formatDate = useHotelDate();
  const navigate = useNavigate();
  const { permissions } = useRolePermissions();
  const canBook = permissionLevelAny(permissions, ["hotel.reservations", "module.hotel"]) === "manage";
  // الروابط لمن يفتح وجهتها فقط (الحجز: الاستقبال أو المقبوضات؛ التنظيف: التنظيف أو الاستقبال أو الإعداد)
  const canOpenReservation = permissionLevelAny(permissions, ["hotel.reservations", "hotel.payments", "module.hotel"]) !== "none";
  const canHousekeeping = permissionLevelAny(permissions, ["hotel.housekeeping", "hotel.reservations", "hotel.setup", "module.hotel"]) !== "none";
  const canSetup = permissionLevelAny(permissions, ["hotel.setup", "module.hotel"]) !== "none";
  const [day, setDay] = useState(hotelToday());
  const [setup, setSetup] = useState<HotelSetup>({ types: [], floors: [], units: [] });
  const [reservations, setReservations] = useState<HotelReservation[]>([]);
  const [guests, setGuests] = useState<Map<string, HotelGuest>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [floorFilter, setFloorFilter] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    const [setupResult, reservationResult, guestResult] = await Promise.all([
      loadHotelSetup(),
      loadReservations({ from: addDays(day, -1), to: addDays(day, 60) }),
      loadGuests(),
    ]);
    const firstError = setupResult.error ?? reservationResult.error;
    if (firstError) setError(hotelErrorText(firstError.message, t));
    setSetup(setupResult.data);
    setReservations(reservationResult.data);
    setGuests(new Map(guestResult.data.map((g) => [g.id, g])));
    setLoading(false);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [day]);

  const activeUnits = useMemo(() => setup.units.filter((u) => u.active), [setup.units]);
  const states = useMemo(() => unitStates(activeUnits, reservations, day, hotelToday()), [activeUnits, reservations, day]);
  const typeName = useMemo(() => new Map(setup.types.map((type) => [type.id, type.name])), [setup.types]);
  const count = (state: UnitDayState) => activeUnits.filter((u) => states.get(u.id)?.state === state).length;

  const today = hotelToday();
  const arrivals = arrivalsOn(reservations, day, today);
  const departures = departuresOn(reservations, day, today);
  const dirty = activeUnits.filter((u) => u.housekeeping === "dirty" && !u.outOfService);
  const vacantClean = activeUnits.filter((u) => states.get(u.id)?.state === "vacant" && u.housekeeping !== "dirty").length;

  const groups = useMemo(() => {
    const floors = [...setup.floors].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    const list = floors.map((floor) => ({ key: floor.id, name: floor.name, units: activeUnits.filter((u) => u.floorId === floor.id) }));
    const noFloor = activeUnits.filter((u) => !u.floorId || !floors.some((f) => f.id === u.floorId));
    if (noFloor.length) list.push({ key: "none", name: "بلا طابق", units: noFloor });
    return list.filter((group) => group.units.length && (!floorFilter || group.key === floorFilter));
  }, [setup.floors, activeUnits, floorFilter]);

  const unitCodes = (reservation: HotelReservation) =>
    reservation.units.map((u) => setup.units.find((unit) => unit.id === u.unitId)?.code ?? "—").join("، ");

  const tiles: Array<{ state: UnitDayState | "dirty" | "vacant_clean"; label: string; value: number; icon: typeof LogIn }> = [
    { state: "occupied", label: "مشغولة", value: count("occupied") + count("departing"), icon: DoorOpen },
    { state: "arriving", label: "الوصول (لم يُسجَّل)", value: arrivals.length, icon: LogIn },
    { state: "departing", label: "المغادرة", value: departures.length, icon: LogOut },
    { state: "vacant_clean", label: "شاغرة وجاهزة", value: vacantClean, icon: ConciergeBell },
    { state: "dirty", label: "تحتاج تنظيفًا", value: dirty.length, icon: Sparkles },
    { state: "out_of_service", label: "خارج الخدمة", value: count("out_of_service"), icon: Wrench },
  ];

  return (
    <Layout>
      <main dir={direction} className="space-y-5">
        <HotelHeader
          icon={ConciergeBell}
          title="لوحة الاستقبال"
          description="حالة الوحدات في اليوم المختار، ووصوله ومغادرته (واليوم: ومن تأخر)، وما يحتاج تنظيفًا. اضغط الوحدة لفتح حجزها أو لحجزها."
          actions={
            <>
              <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} className={`${hotelInput} mt-0 w-auto`} aria-label={t("اليوم")} />
              <HotelButton variant="outline" onClick={() => void load()} busy={loading}><RefreshCw className="h-4 w-4" />{t("تحديث")}</HotelButton>
              {canBook && <HotelButton onClick={() => navigate("/hotel/reservations/new")}><CalendarPlus className="h-4 w-4" />{t("حجز جديد")}</HotelButton>}
            </>
          }
        />

        <ErrorNote message={error} />

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {tiles.map(({ state, label, value, icon: Icon }) => (
            <div key={state} className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-500">{t(label)}</p>
                <Icon className="h-4 w-4 text-[#7a2450]" />
              </div>
              <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900">{loading ? "…" : formatNumber(value)}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
          <HotelCard
            title="الوحدات"
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <select value={floorFilter} onChange={(e) => setFloorFilter(e.target.value)} className="h-9 rounded-lg border bg-white px-2 text-sm">
                  <option value="">{t("كل الطوابق")}</option>
                  {setup.floors.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
            }
          >
            <div className="mb-4 flex flex-wrap gap-3 text-xs text-slate-600">
              {(Object.keys(UNIT_STATE_LABELS) as UnitDayState[]).map((state) => (
                <span key={state} className="inline-flex items-center gap-1.5"><span className={cn("h-2.5 w-2.5 rounded-full", UNIT_STATE_LABELS[state].dot)} />{t(UNIT_STATE_LABELS[state].label)}</span>
              ))}
            </div>
            {loading ? <p className="py-10 text-center text-slate-500">{t("جاري التحميل...")}</p>
              : activeUnits.length === 0 ? (
                <div className="py-10 text-center text-slate-500">
                  <p>{t("لا توجد وحدات بعد.")}</p>
                  {canSetup && <button onClick={() => navigate("/hotel/setup")} className="mt-2 font-semibold text-[#7a2450] underline">{t("أضف الوحدات وأنواعها")}</button>}
                </div>
              ) : (
                <div className="space-y-5">
                  {groups.map((group) => (
                    <div key={group.key}>
                      <h3 className="mb-2 text-sm font-bold text-slate-700">{t(group.name)}</h3>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
                        {group.units.map((unit) => {
                          const info = states.get(unit.id);
                          const state = info?.state ?? "vacant";
                          const style = UNIT_STATE_LABELS[state];
                          const reservation = info?.reservation ?? null;
                          const guest = reservation ? guests.get(reservation.guestId) : undefined;
                          const hk = housekeepingOf(unit.housekeeping);
                          return (
                            <button
                              key={unit.id}
                              onClick={() => reservation
                                ? canOpenReservation && navigate(`/hotel/reservations/${reservation.id}`)
                                : canBook && state === "vacant" ? navigate(`/hotel/reservations/new?unit=${unit.id}&from=${day}`) : undefined}
                              className={cn("min-h-[92px] rounded-xl border-2 p-3 text-start transition",
                                (reservation ? canOpenReservation : canBook && state === "vacant") ? "hover:shadow-md" : "cursor-default", style.tile)}
                              title={unit.outOfService && unit.outOfServiceNote ? unit.outOfServiceNote : undefined}
                            >
                              <div className="flex items-start justify-between gap-1">
                                <span className="text-lg font-extrabold tabular-nums text-slate-900">{unit.code}</span>
                                <span className={cn("mt-1 h-2.5 w-2.5 rounded-full", style.dot)} />
                              </div>
                              <p className="truncate text-[11px] text-slate-500">{typeName.get(unit.typeId) ?? ""}</p>
                              {guest ? <p className="mt-1 truncate text-xs font-semibold text-slate-800">{guest.fullName}</p>
                                : <p className="mt-1 text-xs text-slate-500">{t(style.label)}</p>}
                              {reservation && <p className="text-[11px] text-slate-500">{t("حتى")} {formatDate(reservation.checkOut, { day: "numeric", month: "short" })}</p>}
                              {unit.housekeeping !== "clean" && !unit.outOfService && (
                                <span className={cn("mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold", hk.className)}>{t(hk.label)}</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
          </HotelCard>

          <div className="space-y-5">
            <HotelCard title="الوصول">
              {arrivals.length === 0 ? <p className="text-sm text-slate-500">{t("لا وصول مستحق")}</p> : (
                <ul className="divide-y">
                  {arrivals.map((r) => (
                    <li key={r.id}>
                      <button onClick={() => canOpenReservation && navigate(`/hotel/reservations/${r.id}`)} className={cn("flex w-full items-center justify-between gap-2 py-2.5 text-start", canOpenReservation ? "hover:bg-slate-50" : "cursor-default")}>
                        <span>
                          <span className="block text-sm font-semibold text-slate-900">{guests.get(r.guestId)?.fullName ?? "—"}</span>
                          <span className="block text-xs text-slate-500">{unitCodes(r)}، {formatNumber(nightsBetween(r.checkIn, r.checkOut))} {t("ليلة")}{r.checkIn < day ? `، ${t("متأخر منذ")} ${formatDate(r.checkIn, { day: "numeric", month: "short" })}` : ""}</span>
                        </span>
                        <LogIn className="h-4 w-4 text-sky-600" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </HotelCard>
            <HotelCard title="المغادرة">
              {departures.length === 0 ? <p className="text-sm text-slate-500">{t("لا مغادرة مستحقة")}</p> : (
                <ul className="divide-y">
                  {departures.map((r) => (
                    <li key={r.id}>
                      <button onClick={() => canOpenReservation && navigate(`/hotel/reservations/${r.id}`)} className={cn("flex w-full items-center justify-between gap-2 py-2.5 text-start", canOpenReservation ? "hover:bg-slate-50" : "cursor-default")}>
                        <span>
                          <span className="block text-sm font-semibold text-slate-900">{guests.get(r.guestId)?.fullName ?? "—"}</span>
                          <span className="block text-xs text-slate-500">{unitCodes(r)}{r.checkOut < day ? `، ${t("تجاوز تاريخ المغادرة")}` : ""}</span>
                        </span>
                        <LogOut className="h-4 w-4 text-orange-600" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </HotelCard>
            {dirty.length > 0 && (
              <HotelCard title="تحتاج تنظيفًا" actions={canHousekeeping ? <button onClick={() => navigate("/hotel/housekeeping")} className="text-xs font-semibold text-[#7a2450]">{t("التنظيف والصيانة")}</button> : undefined}>
                <div className="flex flex-wrap gap-1.5">
                  {dirty.map((u) => <span key={u.id} className="rounded-lg bg-amber-100 px-2 py-1 text-xs font-bold tabular-nums text-amber-900">{u.code}</span>)}
                </div>
              </HotelCard>
            )}
          </div>
        </div>
      </main>
    </Layout>
  );
}
