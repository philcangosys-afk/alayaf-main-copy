/**
 * S20: قسم الحجوزات (الفنادق والشقق المفروشة): الأنواع والقراءة والتسميات ورسائل الأخطاء المشتركة بين الشاشات.
 * الجداول: hotel_settings، hotel_unit_types، hotel_floors، hotel_units، hotel_guests، hotel_reservations،
 * hotel_reservation_units، hotel_charges، hotel_payments (قراءة فقط من الواجهة؛ الكتابة من دوال hotel_* في الخادم).
 * المحاسبة: الدفعة قبل المغادرة دفعة مقدمة، وعند المغادرة فاتورة مبيعات تُخصم منها الدفعات المقدمة.
 */
import { supabase } from "@/lib/supabaseClient";
import { selectAllRows } from "@/lib/ledgerData";
import { dbErrorOr } from "@/lib/dbErrors";
import { riyadhDateString } from "@/lib/utils";

export type Option = { value: string; label: string };

export type HotelUnitType = {
  id: string; name: string; basePrice: number; maxOccupancy: number; description: string; active: boolean; sortOrder: number;
};
export type HotelFloor = { id: string; name: string; sortOrder: number };
export type HousekeepingStatus = "clean" | "dirty" | "inspected";
export type HotelUnit = {
  id: string; code: string; name: string; typeId: string; floorId: string; basePrice: number | null; maxOccupancy: number | null;
  housekeeping: HousekeepingStatus; outOfService: boolean; outOfServiceNote: string; active: boolean; notes: string; sortOrder: number;
};
export type HotelGuest = {
  id: string; fullName: string; phone: string; email: string; nationality: string; idType: string; idNumber: string;
  buildingNumber: string; street: string; district: string; city: string; postalCode: string; customerId: string; notes: string;
  createdAt: string;
};
export type ReservationStatus = "confirmed" | "checked_in" | "checked_out" | "cancelled";
export type HotelReservationUnit = { unitId: string; nightlyRate: number };
export type HotelReservation = {
  id: string; number: string; guestId: string; customerId: string; status: ReservationStatus; checkIn: string; checkOut: string;
  adults: number; children: number; source: string; notes: string; discount: number; checkedInAt: string; checkedOutAt: string;
  cancelledAt: string; cancelReason: string; invoiceId: string; advancesApplied: number; createdAt: string;
  units: HotelReservationUnit[];
};
export type HotelCharge = { id: string; reservationId: string; date: string; description: string; quantity: number; unitPrice: number; createdAt: string };
export type PaymentKind = "advance" | "refund" | "invoice";
export type HotelPayment = {
  id: string; number: string; reservationId: string; kind: PaymentKind; amount: number; method: string; reference: string;
  depositAccount: string; date: string; createdAt: string;
};
export type HotelSettings = {
  check_in_time: string; check_out_time: string; municipality_rate: number; room_revenue_account: string | null;
  service_revenue_account: string | null; municipality_account: string | null; advances_account: string;
  default_guest_address: string | null; default_revenue_account: string | null; saved: boolean;
};
export type InvoiceLine = { id: number; description: string; accountCode?: string | null; quantity: number; unitPrice: number; discount: number; taxPercent: number };
export type HotelInvoice = {
  id: string; date: string; invoice_type: "simplified" | "standard"; customer: string; customer_address: string; buyer_vat: string | null;
  buyer_commercial_registration: string | null; items: InvoiceLine[]; subtotal: number; total_tax: number;
  /** الإجمالي بعد الإشعارات الدائنة والمدينة؛ original_total كما صدرت الفاتورة */
  total: number; original_total: number; paid: number;
  remaining: number; adjustment_total: number; status: string; zatca_phase: string; zatca_status: string; qr_code_data: string | null;
  created_at: string;
};
export type HotelTotals = {
  reservation_id: string; reservation_number: string; status: ReservationStatus; nights: number; items: InvoiceLine[];
  room_total: number; discount: number; room_net: number; charges_total: number; municipality_rate: number; municipality_fee: number;
  subtotal: number; tax: number; total: number; advances: number; advances_received: number; refunds: number; advances_applied: number;
  invoice_payments: number; balance: number; invoice: HotelInvoice | null;
};
export type AvailableUnit = {
  unit_id: string; code: string; name: string | null; type_id: string; type_name: string; floor_name: string | null;
  nightly_rate: number; max_occupancy: number; housekeeping_status: HousekeepingStatus;
};
export type DepositAccount = { account_code: string; name: string; account_kind: "bank" | "cash" };

/* ═══════════ التسميات ═══════════ */
export const RESERVATION_STATUSES: Array<{ value: ReservationStatus; label: string; className: string }> = [
  { value: "confirmed", label: "مؤكد", className: "bg-sky-100 text-sky-800" },
  { value: "checked_in", label: "مقيم", className: "bg-emerald-100 text-emerald-800" },
  { value: "checked_out", label: "غادر", className: "bg-slate-200 text-slate-700" },
  { value: "cancelled", label: "ملغى", className: "bg-red-100 text-red-700" },
];
export const statusOf = (value: string) => RESERVATION_STATUSES.find((s) => s.value === value) ?? RESERVATION_STATUSES[0];

export const SOURCES: Option[] = [
  { value: "direct", label: "مباشر" },
  { value: "walk_in", label: "حضور بلا حجز مسبق" },
  { value: "phone", label: "هاتف" },
  { value: "website", label: "الموقع الإلكتروني" },
  { value: "booking", label: "Booking.com" },
  { value: "gathern", label: "جاذر إن" },
  { value: "airbnb", label: "Airbnb" },
  { value: "agoda", label: "Agoda" },
  { value: "expedia", label: "Expedia" },
  { value: "other", label: "أخرى" },
];
export const ID_TYPES: Option[] = [
  { value: "national_id", label: "هوية وطنية" },
  { value: "iqama", label: "إقامة" },
  { value: "passport", label: "جواز سفر" },
  { value: "gcc_id", label: "هوية خليجية" },
  { value: "other", label: "أخرى" },
];
export const HOUSEKEEPING: Array<{ value: HousekeepingStatus; label: string; className: string }> = [
  { value: "clean", label: "نظيفة", className: "bg-emerald-100 text-emerald-800" },
  { value: "dirty", label: "تحتاج تنظيفًا", className: "bg-amber-100 text-amber-800" },
  { value: "inspected", label: "نظيفة ومفحوصة", className: "bg-teal-100 text-teal-800" },
];
export const housekeepingOf = (value: string) => HOUSEKEEPING.find((h) => h.value === value) ?? HOUSEKEEPING[0];
export const PAYMENT_METHODS: Option[] = [
  { value: "نقدي", label: "نقدًا" },
  { value: "بطاقة", label: "بطاقة (مدى/ائتمانية)" },
  { value: "تحويل بنكي", label: "تحويل بنكي" },
  { value: "شيك", label: "شيك" },
];
export const PAYMENT_KINDS: Record<PaymentKind, string> = { advance: "دفعة مقدمة", refund: "رد دفعة", invoice: "سداد الفاتورة" };
export const optionLabel = (options: Option[], value: string) => options.find((o) => o.value === value)?.label ?? value;

/* ═══════════ القراءة ═══════════ */
const num = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const str = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const numOrNull = (value: unknown) => (value === null || value === undefined || value === "" ? null : num(value));

const mapType = (r: Record<string, unknown>): HotelUnitType => ({
  id: str(r.id), name: str(r.name), basePrice: num(r.base_price), maxOccupancy: num(r.max_occupancy) || 1,
  description: str(r.description), active: r.active !== false, sortOrder: num(r.sort_order),
});
const mapFloor = (r: Record<string, unknown>): HotelFloor => ({ id: str(r.id), name: str(r.name), sortOrder: num(r.sort_order) });
const mapUnit = (r: Record<string, unknown>): HotelUnit => ({
  id: str(r.id), code: str(r.code), name: str(r.name), typeId: str(r.type_id), floorId: str(r.floor_id),
  basePrice: numOrNull(r.base_price), maxOccupancy: numOrNull(r.max_occupancy),
  housekeeping: (str(r.housekeeping_status) || "clean") as HousekeepingStatus, outOfService: r.out_of_service === true,
  outOfServiceNote: str(r.out_of_service_note), active: r.active !== false, notes: str(r.notes), sortOrder: num(r.sort_order),
});
export const mapGuest = (r: Record<string, unknown>): HotelGuest => ({
  id: str(r.id), fullName: str(r.full_name), phone: str(r.phone), email: str(r.email), nationality: str(r.nationality),
  idType: str(r.id_type), idNumber: str(r.id_number), buildingNumber: str(r.building_number), street: str(r.street),
  district: str(r.district), city: str(r.city), postalCode: str(r.postal_code), customerId: str(r.customer_id), notes: str(r.notes),
  createdAt: str(r.created_at),
});
const mapReservation = (r: Record<string, unknown>, units: HotelReservationUnit[]): HotelReservation => ({
  id: str(r.id), number: str(r.reservation_number), guestId: str(r.guest_id), customerId: str(r.customer_id),
  status: (str(r.status) || "confirmed") as ReservationStatus, checkIn: str(r.check_in), checkOut: str(r.check_out),
  adults: num(r.adults) || 1, children: num(r.children), source: str(r.source) || "direct", notes: str(r.notes),
  discount: num(r.discount), checkedInAt: str(r.checked_in_at), checkedOutAt: str(r.checked_out_at), cancelledAt: str(r.cancelled_at),
  cancelReason: str(r.cancel_reason), invoiceId: str(r.invoice_id), advancesApplied: num(r.advances_applied), createdAt: str(r.created_at),
  units,
});
const mapCharge = (r: Record<string, unknown>): HotelCharge => ({
  id: str(r.id), reservationId: str(r.reservation_id), date: str(r.charge_date), description: str(r.description),
  quantity: num(r.quantity), unitPrice: num(r.unit_price), createdAt: str(r.created_at),
});
const mapPayment = (r: Record<string, unknown>): HotelPayment => ({
  id: str(r.id), number: str(r.payment_number), reservationId: str(r.reservation_id), kind: str(r.kind) as PaymentKind,
  amount: num(r.amount), method: str(r.payment_method), reference: str(r.reference), depositAccount: str(r.deposit_account_code),
  date: str(r.payment_date), createdAt: str(r.created_at),
});

type LoadResult<T> = { data: T; error: { message: string } | null };

export type HotelSetup = { types: HotelUnitType[]; floors: HotelFloor[]; units: HotelUnit[] };

export async function loadHotelSetup(): Promise<LoadResult<HotelSetup>> {
  const [types, floors, units] = await Promise.all([
    supabase.from("hotel_unit_types").select("*").order("sort_order").order("name"),
    supabase.from("hotel_floors").select("*").order("sort_order").order("name"),
    selectAllRows((from, to) => supabase.from("hotel_units").select("*").order("sort_order").order("code").range(from, to)),
  ]);
  const error = types.error ?? floors.error ?? units.error;
  return {
    data: {
      types: ((types.data ?? []) as Record<string, unknown>[]).map(mapType),
      floors: ((floors.data ?? []) as Record<string, unknown>[]).map(mapFloor),
      units: ((units.data ?? []) as Record<string, unknown>[]).map(mapUnit),
    },
    error: error ? { message: error.message } : null,
  };
}

export async function loadGuests(): Promise<LoadResult<HotelGuest[]>> {
  const result = await selectAllRows((from, to) =>
    supabase.from("hotel_guests").select("*").order("created_at", { ascending: false }).order("id").range(from, to));
  return { data: (result.data as Record<string, unknown>[]).map(mapGuest), error: result.error };
}

/** الحجوزات التي تتقاطع مع فترة (وصول قبل نهايتها، ومغادرة بعد بدايتها)، والمقيمون دائمًا */
export async function loadReservations(range: { from: string; to: string } | null): Promise<LoadResult<HotelReservation[]>> {
  const rows = await selectAllRows((from, to) => {
    let query = supabase.from("hotel_reservations").select("*");
    if (range) query = query.or(`status.eq.checked_in,and(check_in.lt.${range.to},check_out.gt.${range.from})`);
    return query.order("check_in", { ascending: false }).order("id").range(from, to);
  });
  if (rows.error) return { data: [], error: rows.error };
  const ids = (rows.data as Record<string, unknown>[]).map((r) => str(r.id));
  const units = await loadReservationUnits(ids);
  if (units.error) return { data: [], error: units.error };
  return {
    data: (rows.data as Record<string, unknown>[]).map((r) => mapReservation(r, units.data.get(str(r.id)) ?? [])),
    error: null,
  };
}

async function loadReservationUnits(ids: string[]): Promise<LoadResult<Map<string, HotelReservationUnit[]>>> {
  const map = new Map<string, HotelReservationUnit[]>();
  // 50 حجزًا في كل طلب (20 وحدة على الأكثر لكل حجز): لا يتجاوز حد الصفوف في الطلب الواحد (1000)
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    if (!chunk.length) continue;
    const { data, error } = await supabase.from("hotel_reservation_units").select("reservation_id, unit_id, nightly_rate").in("reservation_id", chunk);
    if (error) return { data: map, error: { message: error.message } };
    ((data ?? []) as Record<string, unknown>[]).forEach((row) => {
      const list = map.get(str(row.reservation_id)) ?? [];
      list.push({ unitId: str(row.unit_id), nightlyRate: num(row.nightly_rate) });
      map.set(str(row.reservation_id), list);
    });
  }
  return { data: map, error: null };
}

export type ReservationBundle = {
  reservation: HotelReservation; guest: HotelGuest | null; charges: HotelCharge[]; payments: HotelPayment[]; totals: HotelTotals | null;
  totalsError: string;
};

export async function loadReservationBundle(id: string): Promise<LoadResult<ReservationBundle | null>> {
  const { data: row, error } = await supabase.from("hotel_reservations").select("*").eq("id", id).maybeSingle();
  if (error) return { data: null, error: { message: error.message } };
  if (!row) return { data: null, error: null };
  const record = row as Record<string, unknown>;
  const [units, guest, charges, payments, totals] = await Promise.all([
    loadReservationUnits([id]),
    supabase.from("hotel_guests").select("*").eq("id", str(record.guest_id)).maybeSingle(),
    supabase.from("hotel_charges").select("*").eq("reservation_id", id).order("charge_date").order("created_at"),
    supabase.from("hotel_payments").select("*").eq("reservation_id", id).order("created_at"),
    supabase.rpc("hotel_reservation_totals", { p_id: id }),
  ]);
  const firstError = units.error ?? guest.error ?? charges.error;
  if (firstError) return { data: null, error: { message: firstError.message } };
  return {
    data: {
      reservation: mapReservation(record, units.data.get(id) ?? []),
      guest: guest.data ? mapGuest(guest.data as Record<string, unknown>) : null,
      charges: ((charges.data ?? []) as Record<string, unknown>[]).map(mapCharge),
      // المقبوضات لمن يملك صلاحيتها؛ غيره يرى المبالغ من الملخص
      payments: payments.error ? [] : ((payments.data ?? []) as Record<string, unknown>[]).map(mapPayment),
      totals: totals.error ? null : (totals.data as HotelTotals),
      totalsError: totals.error ? totals.error.message : "",
    },
    error: null,
  };
}

export async function loadPayments(range: { from: string; to: string }): Promise<LoadResult<HotelPayment[]>> {
  const result = await selectAllRows((from, to) =>
    supabase.from("hotel_payments").select("*").gte("payment_date", range.from).lte("payment_date", range.to)
      .order("created_at", { ascending: false }).order("id").range(from, to));
  return { data: (result.data as Record<string, unknown>[]).map(mapPayment), error: result.error };
}

/* ═══════════ الحساب في الواجهة (للمعاينة فقط؛ المبالغ المعتمدة من الخادم) ═══════════ */
const cents = (value: number) => Math.round(value * 100);

/** نفس حساب hotel_compute: الخصم على صافي الإقامة، والرسوم على صافيها، والضريبة 15%. discountTooLarge: الخادم يرفضه */
export function estimateStay(input: {
  nights: number; rates: number[]; discount: number; municipalityRate: number; charges?: number;
}): {
  roomTotal: number; discount: number; roomNet: number; charges: number; fee: number; subtotal: number; tax: number; total: number;
  discountTooLarge: boolean;
} {
  const nights = Math.max(0, Math.trunc(input.nights));
  const gross = input.rates.map((rate) => cents(rate) * nights);
  const roomTotal = gross.reduce((sum, g) => sum + g, 0);
  const requested = Math.max(cents(input.discount), 0);
  const discount = Math.min(requested, roomTotal);
  const roomNet = roomTotal - discount;
  const charges = cents(input.charges ?? 0);
  const fee = input.municipalityRate > 0 ? Math.round((roomNet * Math.round(input.municipalityRate * 100)) / 10000) : 0;
  const subtotal = roomNet + charges + fee;
  const tax = Math.round(subtotal * 0.15);
  const toSar = (value: number) => value / 100;
  return {
    roomTotal: toSar(roomTotal), discount: toSar(discount), roomNet: toSar(roomNet), charges: toSar(charges), fee: toSar(fee),
    subtotal: toSar(subtotal), tax: toSar(tax), total: toSar(subtotal + tax), discountTooLarge: requested > roomTotal,
  };
}

export const nightsBetween = (from: string, to: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return 0;
  const diff = (Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10)) - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) / 86_400_000;
  return Math.round(diff);
};

export const addDays = (date: string, days: number) => {
  const d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10) + days));
  return d.toISOString().slice(0, 10);
};

export const hotelToday = () => riyadhDateString();

/** رقم مستند لاتيني داخل نص عربي: يُعزل اتجاهه فلا تنقلب أجزاؤه (1001-RSV-000001) */
export const isolate = (value: string) => (value ? `\u2066${value}\u2069` : value);

/** في نص عربي (وصف بنود الفاتورة): التواريخ وأرقام المستندات تُعزل للعرض فقط فلا تنقلب (2026-10-22، 1001-RSV-000003) */
export const isolateCodes = (text: string) =>
  String(text ?? "").replace(/\d{4}-\d{2}-\d{2}|\d{4}-[A-Z]{2,6}-\d{3,}/g, (match) => isolate(match));

/** مبلغ بخانتين على الأكثر وغير سالب */
export const isMoney = (value: string) => /^\d{1,9}(\.\d{1,2})?$/.test(value.trim());

/** عنوان وطني بصيغة الفاتورة من أجزائه؛ فارغ إن نقص جزء */
export function nationalAddress(parts: { buildingNumber: string; street: string; district: string; city: string; postalCode: string }): string {
  const values = [parts.buildingNumber, parts.street, parts.district, parts.city, parts.postalCode].map((v) => v.trim());
  if (values.some((v) => !v)) return "";
  return `${values[0]} ${values[1]}، ${values[2]}، ${values[3]}، ${values[4]}`;
}
export const addressComplete = (value: string) => {
  const parts = value.split(/[،,]/).map((p) => p.trim()).filter(Boolean);
  const first = parts[0] ?? "";
  if (/^\d{4} .+$/.test(first)) return parts.length >= 4 && /^\d{5}$/.test(parts[3]) && first.slice(0, 4) !== "0000" && parts[3] !== "00000";
  if (/^\d{4}$/.test(first)) return parts.length >= 5 && /^\d{5}$/.test(parts[4]) && first !== "0000" && parts[4] !== "00000";
  return false;
};

/* ═══════════ حالة الوحدة في يوم ═══════════ */
export type UnitDayState = "occupied" | "arriving" | "departing" | "reserved" | "vacant" | "out_of_service";

/** آخر يوم يشغله الحجز (بلا احتسابه): المقيم يبقى حتى مغادرته الفعلية ولو تجاوز تاريخه (كما في الخادم) */
const occupiedUntil = (r: HotelReservation, today: string) =>
  r.status === "checked_in" && r.checkOut <= today ? addDays(today, 1) : r.checkOut;

/** حالة كل وحدة في اليوم المختار من الحجوزات القائمة */
export function unitStates(units: HotelUnit[], reservations: HotelReservation[], day: string, today: string = hotelToday()) {
  const map = new Map<string, { state: UnitDayState; reservation: HotelReservation | null; next: HotelReservation | null }>();
  units.forEach((unit) => {
    const active = reservations.filter((r) => (r.status === "confirmed" || r.status === "checked_in") && r.units.some((u) => u.unitId === unit.id));
    const inHouse = active.find((r) => r.status === "checked_in" && r.checkIn <= day && day < occupiedUntil(r, today)) ?? null;
    const arriving = active.find((r) => r.status === "confirmed" && r.checkIn <= day && r.checkOut > day) ?? null;
    // مغادرة في اليوم: المقيم، أو حجز مؤكد ينتهي في يوم قادم (المؤكد الذي انتهى اليوم ولم يصل: عدم حضور)
    const leaving = active.find((r) => r.checkOut === day && (r.status === "checked_in" || day > today)) ?? null;
    const next = active.filter((r) => r.status === "confirmed" && r.checkIn > day).sort((a, b) => a.checkIn.localeCompare(b.checkIn))[0] ?? null;
    let state: UnitDayState = "vacant";
    let reservation: HotelReservation | null = null;
    if (inHouse) {
      reservation = inHouse;
      state = inHouse.checkOut <= day ? "departing" : "occupied";
    } else if (arriving) {
      reservation = arriving;
      state = arriving.checkIn === day ? "arriving" : "reserved";
    } else if (leaving) {
      reservation = leaving;
      state = "departing";
    }
    if (!inHouse && unit.outOfService) state = "out_of_service";
    map.set(unit.id, { state, reservation, next });
  });
  return map;
}

/** الوصول في اليوم المختار (واليوم: ومن تأخر وصوله والحجز قائم) */
export function arrivalsOn(reservations: HotelReservation[], day: string, today: string = hotelToday()) {
  return reservations
    .filter((r) => r.status === "confirmed" && r.checkOut > day && (r.checkIn === day || (day === today && r.checkIn < day)))
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn));
}

/** المغادرة في اليوم المختار (واليوم: ومن تجاوز تاريخ مغادرته ولم يغادر) */
export function departuresOn(reservations: HotelReservation[], day: string, today: string = hotelToday()) {
  return reservations
    .filter((r) => (r.status === "checked_in" && (r.checkOut === day || (day === today && r.checkOut < day)))
      || (r.status === "confirmed" && r.checkOut === day && day > today))
    .sort((a, b) => a.checkOut.localeCompare(b.checkOut));
}

export const UNIT_STATE_LABELS: Record<UnitDayState, { label: string; tile: string; dot: string }> = {
  occupied: { label: "مشغولة", tile: "border-emerald-300 bg-emerald-50", dot: "bg-emerald-500" },
  departing: { label: "مغادرة اليوم", tile: "border-orange-300 bg-orange-50", dot: "bg-orange-500" },
  arriving: { label: "وصول اليوم", tile: "border-sky-300 bg-sky-50", dot: "bg-sky-500" },
  reserved: { label: "محجوزة (لم يصل)", tile: "border-violet-300 bg-violet-50", dot: "bg-violet-500" },
  vacant: { label: "شاغرة", tile: "border-slate-200 bg-white", dot: "bg-slate-300" },
  out_of_service: { label: "خارج الخدمة", tile: "border-red-300 bg-red-50", dot: "bg-red-500" },
};

/* ═══════════ رسائل الأخطاء ═══════════ */
const MESSAGES: Record<string, string> = {
  HOTEL_MODULE_NOT_ENABLED: "قسم الحجوزات غير مفعّل لمنشأتك",
  HOTEL_FORBIDDEN: "لا تملك صلاحية هذه العملية في الحجوزات",
  UNAUTHORIZED: "انتهت الجلسة؛ سجّل الدخول من جديد",
  HOTEL_INPUT_INVALID: "قيمة غير صحيحة في أحد الحقول",
  HOTEL_TEXT_TOO_LONG: "نص أطول من المسموح",
  HOTEL_DATE_INVALID: "تاريخ غير صحيح",
  HOTEL_TIME_INVALID: "الوقت بصيغة ساعة:دقيقة (مثل 14:00)",
  HOTEL_RATE_INVALID: "نسبة رسوم البلدية من 0 إلى 20 بخانتين على الأكثر",
  HOTEL_ACCOUNT_INVALID: "الحساب غير موجود أو تجميعي أو من نوع غير مناسب (الإيراد يبدأ بالرقم 4، والدفعات المقدمة بالرقم 2)",
  HOTEL_ACCOUNT_RESERVED: "حساب الضريبة أو الذمم أو الرواتب في قواعد الترحيل لا يُستخدم هنا؛ اختر حسابًا آخر",
  HOTEL_MUNICIPALITY_ACCOUNT_REQUIRED: "اختر حساب رسوم البلدية عند تحديد نسبتها",
  HOTEL_ADDRESS_INCOMPLETE: "العنوان الوطني ناقص: رقم المبنى (4 أرقام) والشارع والحي والمدينة والرمز البريدي (5 أرقام)",
  HOTEL_NAME_REQUIRED: "الاسم مطلوب",
  HOTEL_NAME_EXISTS: "الاسم مستخدم من قبل",
  HOTEL_TEXT_SYNTHETIC: "النص يشبه بيانات تجريبية (مثل test أو تجريبي) ولا يُقبل في الفاتورة",
  HOTEL_PRICE_INVALID: "السعر رقم موجب بخانتين عشريتين على الأكثر",
  HOTEL_OCCUPANCY_INVALID: "السعة من 1 إلى 50",
  HOTEL_NOT_FOUND: "السجل غير موجود",
  HOTEL_TYPE_IN_USE: "النوع مستخدم في وحدات؛ غيّر نوعها أولًا",
  HOTEL_FLOOR_IN_USE: "الطابق مستخدم في وحدات؛ انقلها أولًا",
  HOTEL_CODE_REQUIRED: "رقم الوحدة مطلوب",
  HOTEL_CODE_EXISTS: "رقم الوحدة مستخدم من قبل",
  HOTEL_TYPE_NOT_FOUND: "اختر نوع الوحدة",
  HOTEL_FLOOR_NOT_FOUND: "الطابق غير موجود",
  HOTEL_UNIT_HAS_RESERVATIONS: "على الوحدة حجز قائم؛ لا تُعطَّل قبل انتهائه أو نقله",
  HOTEL_UNIT_IN_USE: "للوحدة حجوزات سابقة؛ عطّلها بدل الحذف",
  HOTEL_HOUSEKEEPING_STATUS_INVALID: "حالة التنظيف غير صحيحة",
  HOTEL_UNIT_OCCUPIED: "الوحدة مشغولة بنزيل لم يغادر",
  HOTEL_GUEST_NAME_REQUIRED: "اسم النزيل مطلوب (حرفان على الأقل)",
  HOTEL_PHONE_INVALID: "رقم الجوال غير صحيح",
  HOTEL_EMAIL_INVALID: "البريد الإلكتروني غير صحيح",
  HOTEL_ID_TYPE_INVALID: "نوع الهوية غير صحيح",
  HOTEL_ID_NUMBER_INVALID: "رقم الهوية غير صحيح (الهوية الوطنية 10 أرقام تبدأ بالرقم 1، والإقامة 10 أرقام تبدأ بالرقم 2)",
  HOTEL_BUILDING_NUMBER_INVALID: "رقم المبنى 4 أرقام",
  HOTEL_POSTAL_CODE_INVALID: "الرمز البريدي 5 أرقام",
  HOTEL_CUSTOMER_NOT_FOUND: "العميل غير موجود",
  HOTEL_GUEST_IN_USE: "للنزيل حجوزات؛ لا يُحذف",
  HOTEL_DATES_INVALID: "تاريخ المغادرة يجب أن يكون بعد تاريخ الوصول",
  HOTEL_STAY_TOO_LONG: "مدة الحجز سنة على الأكثر",
  HOTEL_GUEST_NOT_FOUND: "اختر النزيل",
  HOTEL_GUESTS_COUNT_INVALID: "عدد النزلاء غير صحيح",
  HOTEL_SOURCE_INVALID: "مصدر الحجز غير صحيح",
  HOTEL_DISCOUNT_INVALID: "الخصم لا يتجاوز مبلغ الإقامة، وبخانتين على الأكثر",
  HOTEL_RESERVATION_UNITS_REQUIRED: "اختر وحدة واحدة على الأقل",
  HOTEL_TOO_MANY_UNITS: "20 وحدة على الأكثر في الحجز الواحد",
  HOTEL_RESERVATION_NOT_FOUND: "الحجز غير موجود",
  HOTEL_RESERVATION_CLOSED: "الحجز مغلق (غادر النزيل أو أُلغي الحجز)",
  HOTEL_CHECK_IN_LOCKED: "تاريخ الوصول لا يتغير بعد تسجيل الدخول",
  HOTEL_CHECK_OUT_PAST: "تاريخ المغادرة اليوم أو بعده؛ عدّل تاريخ المغادرة",
  HOTEL_STAY_ENDED: "انتهت فترة الحجز؛ عدّل تاريخي الوصول والمغادرة أو ألغِ الحجز",
  HOTEL_CHECKOUT_DATE_MISMATCH: "اليوم ليس تاريخ المغادرة في الحجز: عدّل تاريخ المغادرة إلى اليوم، أو أكّد المغادرة بالليالي المحجوزة",
  HOTEL_CHECK_IN_PAST: "تاريخ الوصول اليوم أو بعده",
  HOTEL_UNIT_NOT_FOUND: "الوحدة غير موجودة أو معطّلة",
  HOTEL_UNITS_DUPLICATE: "الوحدة مكررة في الحجز",
  HOTEL_UNIT_OUT_OF_SERVICE: "الوحدة خارج الخدمة",
  HOTEL_OCCUPANCY_EXCEEDED: "عدد النزلاء أكبر من سعة الوحدات المختارة",
  HOTEL_UNIT_NOT_AVAILABLE: "الوحدة محجوزة في هذه الفترة",
  HOTEL_ADVANCES_EXCEED_TOTAL: "الدفعات المقدمة أكبر من إجمالي الحجز بعد التعديل؛ رُدّ الفرق أولًا",
  HOTEL_STATUS_INVALID: "حالة الحجز لا تسمح بهذه العملية",
  HOTEL_CHECK_IN_EARLY: "لم يحن تاريخ الوصول؛ للدخول المبكر عدّل تاريخ الوصول إلى اليوم",
  HOTEL_GUEST_ID_REQUIRED: "سجّل نوع هوية النزيل ورقمها قبل تسجيل الدخول",
  HOTEL_INVOICE_TYPE_INVALID: "نوع الفاتورة غير صحيح",
  HOTEL_STANDARD_INVOICE_CUSTOMER_REQUIRED: "الفاتورة الضريبية للشركات تتطلب ربط الحجز بعميل من قائمة العملاء",
  HOTEL_CUSTOMER_VAT_INVALID: "الرقم الضريبي للعميل غير صحيح (15 رقمًا يبدأ بالرقم 3)؛ صحّحه في بطاقة العميل",
  HOTEL_CUSTOMER_CR_INVALID: "السجل التجاري للعميل مطلوب للفاتورة الضريبية؛ أضفه في بطاقة العميل",
  HOTEL_INVOICE_ADDRESS_REQUIRED: "عنوان المشتري مطلوب للفاتورة: أدخله، أو أكمل عنوان النزيل، أو حدّد عنوانًا افتراضيًا في إعدادات الحجوزات",
  HOTEL_CUSTOMER_ADDRESS_REQUIRED: "الفاتورة الضريبية بعنوان العميل: أدخله هنا أو أكمله في بطاقة العميل",
  HOTEL_ADVANCES_ACCOUNT_MIXED: "دفعات الحجز على أكثر من حساب للدفعات المقدمة؛ راجع المحاسب",
  HOTEL_FEE_INVALID: "رسوم الإلغاء رقم موجب بخانتين عشريتين على الأكثر",
  HOTEL_CANCEL_ADVANCES_EXIST: "على الحجز دفعات مقدمة؛ رُدّها قبل الإلغاء",
  HOTEL_DESCRIPTION_REQUIRED: "الوصف مطلوب",
  HOTEL_QUANTITY_INVALID: "الكمية عدد صحيح من 1 إلى 10000",
  HOTEL_AMOUNT_INVALID: "المبلغ رقم موجب بخانتين عشريتين على الأكثر",
  HOTEL_PAYMENT_METHOD_INVALID: "طريقة الدفع غير صحيحة",
  HOTEL_DEPOSIT_ACCOUNT_INVALID: "حساب الإيداع غير موجود أو غير فعال",
  HOTEL_DEPOSIT_ACCOUNT_KIND_MISMATCH: "النقد يُودع في صندوق، والتحويل والبطاقة في حساب بنكي",
  HOTEL_DEPOSIT_ACCOUNT_REQUIRED: "اختر حساب الإيداع (صندوق أو بنك)",
  HOTEL_NOTHING_DUE: "لا مبلغ مستحق على هذا الحجز",
  HOTEL_PAYMENT_EXCEEDS_BALANCE: "المبلغ أكبر من المتبقي",
  HOTEL_REFUND_METHOD_INVALID: "الرد نقدًا أو بتحويل أو على البطاقة",
  HOTEL_REFUND_NOT_ALLOWED: "الرد قبل المغادرة فقط؛ بعد إصدار الفاتورة يكون بإشعار دائن من المبيعات",
  HOTEL_REFUND_EXCEEDS_ADVANCES: "المبلغ أكبر من الدفعات المقدمة",
  SALES_INVOICE_SYNTHETIC_TEXT: "في بيانات الفاتورة نص يشبه بيانات تجريبية (test أو تجريبي)؛ عدّل اسم النزيل أو العميل أو الوصف",
  SALES_INVOICE_INVALID_CHARS: "في بيانات الفاتورة رموز غير مقبولة",
  SALES_INVOICE_ADDRESS_INCOMPLETE: "عنوان المشتري ناقص",
  SALES_INVOICE_BUYER_VAT_INVALID: "الرقم الضريبي للعميل غير صحيح",
  SALES_INVOICE_TOTALS_DO_NOT_MATCH_LINES: "مجاميع الفاتورة لا تطابق بنودها",
  SALES_INVOICE_MUST_BE_POSTED_BEFORE_PAYMENT: "فاتورة الحجز غير مرحّلة محاسبيًا",
  SALES_INVOICE_NOT_FOUND: "فاتورة الحجز غير موجودة",
  SALES_INVOICE_RECEIVABLE_ACCOUNT_NOT_FOUND: "حساب الذمم في قيد الفاتورة غير موجود؛ راجع قواعد الترحيل",
  SALES_INVOICE_TAX_RATE_INVALID: "نسبة الضريبة في بنود الفاتورة غير صحيحة",
  SALES_INVOICE_TYPE_INVALID: "نوع الفاتورة غير صحيح",
  SALES_INVOICE_SYSTEM_FIELDS_READ_ONLY: "بيانات الفاتورة يحددها النظام",
  SALES_INVOICE_ITEMS_REQUIRED: "الفاتورة بلا بنود",
  INVALID_SALES_INVOICE_LINE: "بند غير صحيح في الفاتورة",
  ZATCA_PHASE_IMMUTABLE: "مرحلة الفوترة الإلكترونية للفاتورة لا تتغير",
  ZATCA_PHASE1_DOCUMENT_IMMUTABLE: "الفاتورة صدرت ولا تُعدَّل",
  ZATCA_COMPANY_VAT_REQUIRED: "أدخل الرقم الضريبي للمنشأة في الإعدادات قبل إصدار الفواتير",
  BILLING_COUNTRY_NOT_READY: "الفوترة لدولة منشأتك تُفعَّل في تحديث قادم",
  ACCOUNTING_FISCAL_PERIOD_CLOSED: "الفترة المالية لتاريخ اليوم مقفلة",
  ACCOUNTING_FISCAL_PERIOD_REQUIRED: "لا توجد فترة مالية مفتوحة لتاريخ اليوم؛ أنشئها من إعدادات المحاسبة",
};

/** رسالة عربية من خطأ الخادم (مع الوحدات المذكورة في بعض الرسائل) */
export function hotelErrorText(message: string, t: (value: string) => string = (v) => v): string {
  const text = String(message ?? "");
  const match = text.match(/\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b(?::\s*([^\n]*))?/);
  if (match && MESSAGES[match[1]]) {
    const detail = (match[2] ?? "").trim();
    const withDetail = ["HOTEL_UNIT_NOT_AVAILABLE", "HOTEL_UNIT_OCCUPIED", "HOTEL_UNIT_OUT_OF_SERVICE", "HOTEL_ACCOUNT_INVALID",
      "HOTEL_ACCOUNT_RESERVED", "HOTEL_INPUT_INVALID", "HOTEL_TEXT_TOO_LONG"].includes(match[1]);
    return withDetail && detail ? `${t(MESSAGES[match[1]])}: ${detail}` : t(MESSAGES[match[1]]);
  }
  return t(dbErrorOr(text));
}

export async function listDepositAccounts(): Promise<DepositAccount[]> {
  const { data, error } = await supabase.rpc("hotel_list_deposit_accounts");
  if (error) return [];
  return (data ?? []) as DepositAccount[];
}
