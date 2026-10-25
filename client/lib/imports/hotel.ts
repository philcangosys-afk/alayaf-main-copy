/**
 * استيراد بيانات الحجوزات من إكسل: الوحدات، والنزلاء، والحجوزات القادمة.
 * الحفظ بدوال الشاشات نفسها (hotel_save_unit، hotel_save_guest، hotel_save_reservation)،
 * فيتحقق الخادم من التوفر والسعة والصلاحية كما في الإدخال اليدوي.
 */
import { supabase } from "@/lib/supabaseClient";
import { ID_TYPES, hotelErrorText, hotelToday, loadGuests, loadHotelSetup, type HotelGuest, type HotelSetup } from "@/lib/hotel";
import {
  cleanCell, cleanText, looksMonthFirst, normalizeKey, normalizePhone, parseAmount, parseDateText, parseInteger, pickOption,
  type ImportSpec, type Translate,
} from "@/lib/dataImport";

/** أقصى مدة للحجز الواحد كما في دالة الحفظ */
const MAX_NIGHTS = 365;

/** عدد الليالي بين تاريخين yyyy-mm-dd */
const nightsBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** الطابق للبحث: الاسم كما هو، ثم بعد التوحيد (الأول = الاول) */
type FloorLookup = { exact: Map<string, string>; loose: Map<string, string> };
const floorLookup = (floors: Array<{ id: string; name: string }>): FloorLookup => {
  const lookup: FloorLookup = { exact: new Map(), loose: new Map() };
  floors.forEach((floor) => addFloor(lookup, floor.name, floor.id));
  return lookup;
};
function addFloor(lookup: FloorLookup, name: string, id: string) {
  lookup.exact.set(cleanText(name), id);
  const key = normalizeKey(name);
  if (key && !lookup.loose.has(key)) lookup.loose.set(key, id);
}
const findFloor = (lookup: FloorLookup, name: string) => lookup.exact.get(cleanText(name)) ?? lookup.loose.get(normalizeKey(name)) ?? null;

/* ═══════════ الوحدات ═══════════ */

type UnitValue = { code: string; typeId: string; floorId: string | null; floorName: string; price: number | null; capacity: number | null };
type UnitContext = { setup: HotelSetup; codes: Set<string>; types: Map<string, HotelSetup["types"][number]>; floors: FloorLookup };

/** رقم الوحدة كما في الفهرس الفريد (مطابقة تامة بعد حذف المسافات الزائدة)، والأرقام لاتينية */
const unitCode = (value: string) => cleanCell(value);

export function hotelUnitsImportSpec(setup: HotelSetup, t: Translate): ImportSpec<UnitValue, UnitContext> {
  return {
    id: "hotel_units",
    title: "وحدات الحجز",
    fileName: "قالب استيراد الوحدات",
    columns: [
      {
        key: "code", label: "رقم الوحدة", required: true, kind: "text", hint: "رقم الغرفة أو الشقة، ولا يتكرر", example: "101",
        aliases: ["الوحدة", "رقم الغرفة", "الغرفة", "رقم الشقة", "unit", "unit number", "unit no", "room", "room number", "code"],
      },
      {
        key: "type", label: "نوع الوحدة", required: true, options: setup.types.filter((type) => type.active).map((type) => type.name), dataOptions: true,
        hint: "اسم نوع موجود في «الأنواع» (مثل غرفة مزدوجة)", example: setup.types[0]?.name ?? "غرفة مزدوجة",
        aliases: ["النوع", "نوع الغرفة", "type", "unit type", "room type", "category"],
      },
      {
        key: "floor", label: "الطابق", options: setup.floors.map((floor) => floor.name), dataOptions: true,
        hint: "اختياري: اسم طابق موجود، أو جديد يُضاف تلقائيًا", example: setup.floors[0]?.name ?? "الأول",
        aliases: ["الدور", "floor", "level"],
      },
      {
        key: "price", label: "سعر الليلة", kind: "number",
        hint: "اختياري، قبل الضريبة: يغلب سعر النوع لهذه الوحدة وحدها", example: "350",
        aliases: ["السعر", "سعر الوحدة", "price", "rate", "nightly rate", "price per night"],
      },
      {
        key: "capacity", label: "السعة", kind: "number",
        hint: "اختياري: أقصى عدد نزلاء من 1 إلى 50؛ الافتراضي سعة النوع", example: "2",
        aliases: ["عدد الأشخاص", "الأشخاص", "capacity", "max occupancy", "occupancy", "guests"],
      },
    ],
    notes: ["أضف أنواع الوحدات أولًا من «الأنواع»؛ الوحدة بنوع غير موجود تُرفض."],

    prepare: async () => {
      const result = await loadHotelSetup();
      if (result.error) throw new Error(hotelErrorText(result.error.message, t));
      const types = new Map<string, HotelSetup["types"][number]>();
      result.data.types.forEach((type) => { if (!types.has(normalizeKey(type.name))) types.set(normalizeKey(type.name), type); });
      return {
        setup: result.data,
        codes: new Set(result.data.units.map((unit) => unitCode(unit.code))),
        types,
        floors: floorLookup(result.data.floors),
      };
    },

    parse: (values, ctx) => {
      const code = unitCode(values.code);
      if (!code) return { error: t("رقم الوحدة مطلوب") };
      if (code.length > 30) return { error: t("رقم الوحدة أطول من 30 حرفًا") };
      if (ctx.codes.has(code)) return { error: t("رقم الوحدة موجود في النظام") };
      const type = ctx.types.get(normalizeKey(values.type));
      if (!type) return { error: `${t("نوع الوحدة غير موجود؛ أضفه من «الأنواع» أولًا")}: ${cleanText(values.type)}` };
      if (!type.active) return { error: `${t("نوع الوحدة موقوف")}: ${type.name}` };
      const floorName = cleanText(values.floor);
      if (floorName.length > 50) return { error: t("اسم الطابق أطول من 50 حرفًا") };
      const floorId = floorName ? findFloor(ctx.floors, floorName) : null;
      const priceText = cleanCell(values.price);
      const price = priceText ? parseAmount(priceText) : null;
      if (priceText && price === null) return { error: t("السعر رقم موجب بخانتين عشريتين على الأكثر") };
      const capacityText = cleanCell(values.capacity);
      const capacity = capacityText ? parseInteger(capacityText, 1, 50) : null;
      if (capacityText && capacity === null) return { error: t("السعة من 1 إلى 50") };
      return {
        key: `code:${code}`,
        warning: floorName && !floorId ? `${t("طابق جديد يُضاف")}: ${floorName}` : undefined,
        value: { code, typeId: type.id, floorId, floorName, price, capacity },
      };
    },

    save: async (unit, ctx) => {
      let floorId = unit.floorId;
      if (!floorId && unit.floorName) {
        // الطابق الجديد يُضاف مرة واحدة ويُستخدم لبقية الصفوف
        floorId = findFloor(ctx.floors, unit.floorName);
        if (!floorId) {
          const { data, error } = await supabase.rpc("hotel_save_floor", { p_id: null, p: { name: unit.floorName, sort_order: 0 } });
          if (error) return `${t("تعذر إضافة الطابق")}: ${hotelErrorText(error.message, t)}`;
          floorId = String(data);
          addFloor(ctx.floors, unit.floorName, floorId);
        }
      }
      const { error } = await supabase.rpc("hotel_save_unit", {
        p_id: null,
        p: {
          code: unit.code, name: null, type_id: unit.typeId, floor_id: floorId, base_price: unit.price, max_occupancy: unit.capacity,
          active: true, notes: null, sort_order: 0,
        },
      });
      return error ? hotelErrorText(error.message, t) : null;
    },
  };
}

/* ═══════════ النزلاء ═══════════ */

const idTypeOptions = (t: Translate) => ID_TYPES.map((type) => ({
  value: type.value,
  labels: [type.label, t(type.label), ...({
    national_id: ["هوية", "هوية وطنية", "national id", "id", "nid", "citizen id"],
    iqama: ["اقامة", "iqama", "residence", "resident id"],
    passport: ["جواز", "جواز سفر", "passport"],
    gcc_id: ["هوية خليجية", "gcc", "gcc id"],
    other: ["أخرى", "اخرى", "other"],
  } as Record<string, string[]>)[type.value] ?? []],
}));

type GuestValue = Record<string, unknown>;
type GuestContext = { phones: Set<string>; ids: Set<string> };

/** نوع الهوية من الرقم إن لم يُحدَّد: 1xxxxxxxxx هوية وطنية، و2xxxxxxxxx إقامة */
const inferIdType = (number: string) => (/^1\d{9}$/.test(number) ? "national_id" : /^2\d{9}$/.test(number) ? "iqama" : null);

/** صيغة الرقم لنوع الهوية كما في دالة حفظ النزيل */
const ID_FORMATS: Record<string, { pattern: RegExp; message: string }> = {
  national_id: { pattern: /^1\d{9}$/, message: "رقم الهوية الوطنية 10 أرقام يبدأ بالرقم 1" },
  iqama: { pattern: /^2\d{9}$/, message: "رقم الإقامة 10 أرقام يبدأ بالرقم 2" },
};

export function hotelGuestsImportSpec(t: Translate): ImportSpec<GuestValue, GuestContext> {
  const ID_TYPE_OPTIONS = idTypeOptions(t);
  return {
    id: "hotel_guests",
    title: "النزلاء",
    fileName: "قالب استيراد النزلاء",
    columns: [
      {
        key: "name", label: "اسم النزيل", required: true, width: 30, hint: "الاسم الكامل", example: "محمد أحمد العتيبي",
        aliases: ["الاسم", "النزيل", "الضيف", "اسم الضيف", "اسم العميل", "name", "guest", "guest name", "full name"],
      },
      {
        key: "phone", label: "الجوال", kind: "text", hint: "رقم الجوال، ويُقبل بلا صفر البداية أو بمفتاح الدولة", example: "0551234567",
        aliases: ["رقم الجوال", "الهاتف", "جوال", "phone", "mobile", "phone number"],
      },
      {
        key: "nationality", label: "الجنسية", hint: "اختياري", example: "السعودية",
        aliases: ["nationality", "country"],
      },
      {
        key: "idType", label: "نوع الهوية", options: ID_TYPES.map((type) => type.label),
        hint: "هوية وطنية أو إقامة أو جواز سفر أو هوية خليجية؛ يُستنتج من الرقم إن بدأ بـ 1 أو 2", example: "هوية وطنية",
        aliases: ["id type", "document type", "نوع الوثيقة"],
      },
      {
        key: "idNumber", label: "رقم الهوية", kind: "text", hint: "اختياري الآن، ومطلوب عند تسجيل الدخول", example: "1012345678",
        aliases: ["رقم الهوية او الاقامة", "رقم الإقامة", "رقم الجواز", "الهوية", "id", "id number", "national id", "iqama", "passport", "passport number"],
      },
    ],
    notes: ["النزيل الموجود بالجوال أو رقم الهوية نفسه لا يتكرر.", "العنوان الوطني يُكمل من بطاقة النزيل إن احتاجت الفاتورة."],

    prepare: async () => {
      const result = await loadGuests();
      if (result.error) throw new Error(hotelErrorText(result.error.message, t));
      return {
        phones: new Set(result.data.map((guest) => normalizePhone(guest.phone)).filter(Boolean)),
        ids: new Set(result.data.map((guest) => normalizeKey(guest.idNumber)).filter(Boolean)),
      };
    },

    parse: (values, ctx) => {
      const name = cleanText(values.name);
      if (name.length < 2) return { error: t("اسم النزيل مطلوب (حرفان على الأقل)") };
      if (name.length > 150) return { error: t("الاسم أطول من 150 حرفًا") };
      const phone = normalizePhone(values.phone);
      if (phone && !/^\+?\d{7,15}$/.test(phone)) return { error: t("رقم الجوال غير صحيح") };
      const idNumber = cleanCell(values.idNumber).replace(/\s/g, "");
      let idType: string | null = null;
      if (cleanCell(values.idType)) {
        idType = pickOption(values.idType, ID_TYPE_OPTIONS);
        if (!idType) return { error: `${t("نوع الهوية غير معروف")}: ${cleanCell(values.idType)}` };
      } else if (idNumber) {
        idType = inferIdType(idNumber);
        if (!idType) return { error: t("حدد نوع الهوية (جواز سفر مثلًا)") };
      }
      if (idNumber && idNumber.length > 30) return { error: t("رقم الهوية أطول من 30 حرفًا") };
      const format = idNumber && idType ? ID_FORMATS[idType] : undefined;
      if (format && !format.pattern.test(idNumber)) return { error: t(format.message) };
      if (phone && ctx.phones.has(phone)) return { error: t("يوجد نزيل بالجوال نفسه في النظام") };
      if (idNumber && ctx.ids.has(normalizeKey(idNumber))) return { error: t("يوجد نزيل برقم الهوية نفسه في النظام") };
      const nationality = cleanText(values.nationality).slice(0, 60);
      return {
        // لا يتكرر الجوال ولا رقم الهوية بين صفوف الملف
        key: [idNumber ? `id:${normalizeKey(idNumber)}` : null, phone ? `phone:${phone}` : null].filter((key): key is string => Boolean(key)),
        value: {
          full_name: name, phone: phone || null, email: null, nationality: nationality || null,
          id_type: idNumber ? idType : null, id_number: idNumber || null,
          building_number: null, street: null, district: null, city: null, postal_code: null, customer_id: null, notes: null,
        },
      };
    },

    save: async (guest) => {
      const { error } = await supabase.rpc("hotel_save_guest", { p_id: null, p: guest });
      return error ? hotelErrorText(error.message, t) : null;
    },
  };
}

/* ═══════════ الحجوزات القادمة ═══════════ */

type ReservationValue = { guestName: string; phone: string; guestId: string | null; unitId: string; unitCode: string; checkIn: string; checkOut: string };
type ReservationContext = {
  units: Map<string, HotelSetup["units"][number]>;
  guestsByPhone: Map<string, HotelGuest>;
  guestsByName: Map<string, HotelGuest[]>;
  created: Map<string, string>;
};

/** النزيل الموجود: بالجوال، وإلا بالاسم إن لم يتكرر (ولا جوال مختلف له) */
function findGuest(ctx: ReservationContext, name: string, phone: string): HotelGuest | null {
  if (phone) {
    const byPhone = ctx.guestsByPhone.get(phone);
    if (byPhone) return byPhone;
  }
  const byName = ctx.guestsByName.get(normalizeKey(name)) ?? [];
  return byName.length === 1 && (!phone || !byName[0].phone) ? byName[0] : null;
}

export function hotelReservationsImportSpec(t: Translate): ImportSpec<ReservationValue, ReservationContext> {
  return {
    id: "hotel_reservations",
    title: "الحجوزات",
    fileName: "قالب استيراد الحجوزات",
    columns: [
      {
        key: "guest", label: "اسم النزيل", required: true, width: 28, hint: "النزيل الموجود يُربط بجواله أو اسمه، وإلا يُضاف نزيل جديد", example: "محمد أحمد العتيبي",
        aliases: ["الاسم", "النزيل", "الضيف", "اسم الضيف", "اسم العميل", "guest", "guest name", "name", "customer"],
      },
      {
        key: "phone", label: "جوال النزيل", kind: "text", hint: "اختياري، ويُفضَّل لربط النزيل الموجود", example: "0551234567",
        aliases: ["الجوال", "رقم الجوال", "الهاتف", "phone", "mobile", "guest phone"],
      },
      {
        key: "unit", label: "رقم الوحدة", required: true, kind: "text", hint: "رقم وحدة موجودة", example: "101",
        aliases: ["الوحدة", "رقم الغرفة", "الغرفة", "unit", "unit number", "room", "room number"],
      },
      {
        key: "checkIn", label: "تاريخ الوصول", required: true, kind: "date", hint: "اليوم أو بعده، بصيغة 2026-11-25 أو 25/11/2026 (يوم/شهر/سنة)", example: "2026-11-05",
        aliases: ["الوصول", "تاريخ الدخول", "من", "check in", "check-in", "arrival", "arrival date", "from"],
      },
      {
        key: "checkOut", label: "تاريخ المغادرة", required: true, kind: "date", hint: "بعد تاريخ الوصول، والحجز 365 ليلة على الأكثر", example: "2026-11-08",
        aliases: ["المغادرة", "تاريخ الخروج", "إلى", "check out", "check-out", "departure", "departure date", "to"],
      },
    ],
    notes: [
      "للحجوزات القادمة فقط؛ الإقامات السابقة لا تُستورد.",
      "سعر الليلة سعر الوحدة في هذه الفترة، وعدد النزلاء واحد؛ يُعدَّلان من الحجز بعد الاستيراد.",
      "الوحدة المحجوزة في الفترة نفسها تُرفض، ومنها حجزان متداخلان في الملف للوحدة نفسها.",
    ],

    prepare: async () => {
      const [setup, guests] = await Promise.all([loadHotelSetup(), loadGuests()]);
      const error = setup.error ?? guests.error;
      if (error) throw new Error(hotelErrorText(error.message, t));
      // بحث سريع لكل صف: الوحدات برقمها، والنزلاء بالجوال وبالاسم
      const units = new Map(setup.data.units.map((unit) => [unitCode(unit.code), unit]));
      const guestsByPhone = new Map<string, HotelGuest>();
      const guestsByName = new Map<string, HotelGuest[]>();
      guests.data.forEach((guest) => {
        const phone = normalizePhone(guest.phone);
        if (phone && !guestsByPhone.has(phone)) guestsByPhone.set(phone, guest);
        const name = normalizeKey(guest.fullName);
        if (name) guestsByName.set(name, [...(guestsByName.get(name) ?? []), guest]);
      });
      return { units, guestsByPhone, guestsByName, created: new Map() };
    },

    parse: (values, ctx) => {
      const guestName = cleanText(values.guest);
      if (guestName.length < 2) return { error: t("اسم النزيل مطلوب (حرفان على الأقل)") };
      if (guestName.length > 150) return { error: t("الاسم أطول من 150 حرفًا") };
      const phone = normalizePhone(values.phone);
      if (phone && !/^\+?\d{7,15}$/.test(phone)) return { error: t("رقم الجوال غير صحيح") };
      const unit = ctx.units.get(unitCode(values.unit));
      if (!unit) return { error: `${t("الوحدة غير موجودة")}: ${cleanText(values.unit)}` };
      if (!unit.active) return { error: `${t("الوحدة موقوفة")}: ${unit.code}` };
      const checkIn = parseDateText(values.checkIn);
      const checkOut = parseDateText(values.checkOut);
      if (!checkIn || !checkOut) {
        // 11/25/2026 (شهر/يوم) لا يُخمَّن: التاريخ يوم/شهر/سنة
        if (looksMonthFirst(values.checkIn) || looksMonthFirst(values.checkOut)) return { error: t("التاريخ بصيغة شهر/يوم؛ اكتبه يوم/شهر/سنة (25/11/2026) أو 2026-11-25") };
        return { error: t("التاريخ غير صحيح؛ اكتبه 2026-11-25 أو 25/11/2026") };
      }
      if (checkIn < hotelToday()) return { error: t("تاريخ الوصول قبل اليوم؛ تُستورد الحجوزات القادمة فقط") };
      if (checkOut <= checkIn) return { error: t("تاريخ المغادرة يجب أن يكون بعد تاريخ الوصول") };
      if (nightsBetween(checkIn, checkOut) > MAX_NIGHTS) return { error: t("مدة الحجز أكثر من 365 ليلة") };
      const guest = findGuest(ctx, guestName, phone);
      let warning: string | undefined;
      if (!guest) warning = t("نزيل جديد يُضاف بالاسم والجوال");
      else if (normalizeKey(guest.fullName) !== normalizeKey(guestName)) warning = `${t("الجوال مسجل لنزيل باسم آخر ويُربط الحجز به")}: ${guest.fullName}`;
      return {
        warning,
        value: { guestName, phone, guestId: guest?.id ?? null, unitId: unit.id, unitCode: unit.code, checkIn, checkOut },
      };
    },

    save: async (row, ctx) => {
      // التوفر أولًا: الوحدة غير المتاحة تُرفض قبل إضافة أي نزيل جديد، وسعر الليلة سعرها في الفترة
      const { data: available, error: availableError } = await supabase.rpc("hotel_available_units", { p_from: row.checkIn, p_to: row.checkOut, p_exclude: null });
      if (availableError) return hotelErrorText(availableError.message, t);
      const match = ((available ?? []) as Array<{ unit_id: string; nightly_rate: number }>).find((unit) => unit.unit_id === row.unitId);
      if (!match) return `${t("الوحدة محجوزة أو خارج الخدمة في هذه الفترة")}: ${row.unitCode}`;
      // النزيل الجديد يُضاف مرة واحدة ولو تكرر في أكثر من صف
      let guestId = row.guestId;
      const guestKey = row.phone ? `phone:${row.phone}` : `name:${normalizeKey(row.guestName)}`;
      if (!guestId) guestId = ctx.created.get(guestKey) ?? null;
      if (!guestId) {
        const { data, error } = await supabase.rpc("hotel_save_guest", {
          p_id: null,
          p: { full_name: row.guestName, phone: row.phone || null },
        });
        if (error) return `${t("تعذر إضافة النزيل")}: ${hotelErrorText(error.message, t)}`;
        guestId = String(data);
        ctx.created.set(guestKey, guestId);
      }
      const { error } = await supabase.rpc("hotel_save_reservation", {
        p_id: null,
        p: {
          guest_id: guestId, customer_id: null, check_in: row.checkIn, check_out: row.checkOut, adults: 1, children: 0,
          source: "other", notes: "مستورد من ملف إكسل", discount: 0,
          units: [{ unit_id: row.unitId, nightly_rate: Number(match.nightly_rate) }],
        },
      });
      return error ? hotelErrorText(error.message, t) : null;
    },
  };
}
