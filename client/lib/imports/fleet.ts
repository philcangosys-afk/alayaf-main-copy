/**
 * استيراد المركبات من إكسل: رقم اللوحة، والشركة المصنعة، والطراز، وسنة الصنع، والنوع.
 * الحفظ كما في شاشة المركبات (إدراج في الجدول، والقاعدة تمنع تكرار اللوحة وتولّد رقم المركبة).
 */
import { supabase } from "@/lib/supabaseClient";
import { selectAllRows } from "@/lib/ledgerData";
import { VEHICLE_TYPES, fleetErrorText } from "@/lib/fleet";
import { alreadySaved, cleanCell, cleanText, parseInteger, pickOption, type ImportSpec, type Translate } from "@/lib/dataImport";

type VehicleRow = Record<string, unknown>;
type VehicleContext = { plates: Set<string> };

/** اللوحة للمقارنة كما في الفهرس الفريد (بلا مسافات وبحروف كبيرة)، والأرقام العربية كاللاتينية فلا تتكرر اللوحة بصيغتين */
const plateKey = (value: string) => cleanCell(value).replace(/\s+/g, "").toUpperCase();

const TYPE_ALIASES: Record<string, string[]> = {
  car: ["سيارة", "صالون", "car", "sedan"],
  pickup: ["بيك أب", "بيك اب", "ونيت", "pickup", "pick-up", "pick up"],
  van: ["فان", "van", "minivan"],
  truck: ["شاحنة", "دينا", "truck", "lorry"],
  bus: ["حافلة", "باص", "bus"],
  heavy_equipment: ["معدة", "معدة ثقيلة", "heavy equipment", "equipment"],
  motorcycle: ["دراجة", "دراجة نارية", "motorcycle", "bike"],
  other: ["أخرى", "اخرى", "other"],
};

export function vehiclesImportSpec(t: Translate): ImportSpec<VehicleRow, VehicleContext> {
  const typeOptions = VEHICLE_TYPES.map((type) => ({ value: type.value, labels: [type.label, t(type.label), ...(TYPE_ALIASES[type.value] ?? [])] }));
  return {
    id: "fleet_vehicles",
    title: "المركبات",
    fileName: "قالب استيراد المركبات",
    columns: [
      {
        key: "plate", label: "رقم اللوحة", required: true, kind: "text", hint: "كما في الاستمارة، ولا يتكرر", example: "أ ب ج 1234",
        aliases: ["اللوحة", "رقم اللوحه", "plate", "plate number", "plate no", "license plate"],
      },
      {
        key: "make", label: "الشركة المصنعة", required: true, hint: "مثل تويوتا أو هيونداي", example: "تويوتا",
        aliases: ["الماركة", "الشركة", "الصانع", "make", "brand", "manufacturer"],
      },
      {
        key: "model", label: "الطراز", hint: "اختياري", example: "هايلكس",
        aliases: ["الموديل", "model"],
      },
      {
        key: "year", label: "سنة الصنع", kind: "number", hint: "اختياري، بين 1950 و2100", example: "2023",
        aliases: ["سنة الموديل", "السنة", "year", "model year", "manufacture year"],
      },
      {
        key: "type", label: "نوع المركبة", options: VEHICLE_TYPES.map((type) => type.label),
        hint: "الافتراضي سيارة صالون", example: "بيك أب (ونيت)",
        aliases: ["النوع", "type", "vehicle type"],
      },
    ],
    notes: ["الوقود والملكية والحالة تأخذ القيم الافتراضية (بنزين 91، ملك الشركة، متاحة)؛ تُعدَّل من بطاقة المركبة مع الفرع والسائق."],

    prepare: async () => {
      const result = await selectAllRows((from, to) => supabase.from("fleet_vehicles").select("plate_number").order("id").range(from, to));
      if (result.error) throw new Error(t(fleetErrorText(result.error.message)));
      return { plates: new Set((result.data as Array<{ plate_number?: string | null }>).map((row) => plateKey(String(row.plate_number ?? "")))) };
    },

    parse: (values, ctx) => {
      // اللوحة كما كُتبت (الحروف والأرقام العربية تبقى)
      const plate = cleanText(values.plate);
      if (!plate) return { error: t("رقم اللوحة مطلوب") };
      if (plate.length > 30) return { error: t("رقم اللوحة أطول من 30 حرفًا") };
      if (ctx.plates.has(plateKey(plate))) return { error: t("رقم اللوحة مسجل لمركبة أخرى") };
      const make = cleanText(values.make);
      if (!make) return { error: t("الشركة المصنعة مطلوبة") };
      const yearText = cleanCell(values.year);
      const year = yearText ? parseInteger(yearText, 1950, 2100) : null;
      if (yearText && year === null) return { error: t("سنة الصنع غير صحيحة") };
      let type = "car";
      if (cleanCell(values.type)) {
        const picked = pickOption(values.type, typeOptions);
        if (!picked) return { error: `${t("نوع المركبة غير معروف")}: ${cleanCell(values.type)}` };
        type = picked;
      }
      return {
        key: `plate:${plateKey(plate)}`,
        value: {
          // المعرّف من المتصفح: إعادة الحفظ بعد انقطاع لا تكرر المركبة
          id: crypto.randomUUID(),
          plate_number: plate, make, model: cleanText(values.model) || null, manufacture_year: year,
          vin: null, color: null, vehicle_type: type, fuel_type: "petrol91", ownership: "owned", status: "active",
          fuel_capacity: null, branch_id: null, cost_center_id: null, fixed_asset_id: null, assigned_driver_id: null, notes: null,
          opening_odometer: 0,
        },
      };
    },

    save: async (row) => {
      const { error } = await supabase.from("fleet_vehicles").insert(row);
      if (alreadySaved(error)) return null;
      return error ? t(fleetErrorText(error.message)) : null;
    },
    saveBatch: async (rows) => {
      const { error } = await supabase.from("fleet_vehicles").insert(rows);
      return error ? t(fleetErrorText(error.message)) : null;
    },
  };
}
