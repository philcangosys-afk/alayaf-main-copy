/**
 * وحدة الأسطول والسيارات: الأنواع والتسميات وقوائم الاختيار ورسائل الأخطاء المشتركة بين الشاشات.
 * الجداول: fleet_vehicles، fleet_drivers، fleet_documents، fleet_maintenance، fleet_fuel_logs، fleet_trips.
 * القيد المحاسبي والضريبة لتكاليف الأسطول يُسجلان مرة واحدة عبر فاتورة المشتريات، ويُربط السجل بها فقط.
 */
import { supabase } from "@/lib/supabaseClient";
import { selectAllRows } from "@/lib/ledgerData";
import { riyadhDateString } from "@/lib/utils";

export type FleetVehicle = {
  id: string;
  number: string;
  plate: string;
  make: string;
  model: string;
  year: number | null;
  vin: string;
  color: string;
  type: string;
  fuelType: string;
  ownership: string;
  status: string;
  odometer: number;
  openingOdometer: number;
  fuelCapacity: number | null;
  branchId: string;
  costCenterId: string;
  fixedAssetId: string;
  driverId: string;
  notes: string;
};

export type FleetDriver = {
  id: string;
  employeeId: string;
  employeeNumber: string;
  name: string;
  licenseNumber: string;
  licenseType: string;
  licenseExpiry: string;
  phone: string;
  status: string;
  notes: string;
};

export type Option = { value: string; label: string };
export type PurchaseInvoiceOption = { id: string; date: string; vendor: string; subtotal: number; linkedAmount: number };

export const VEHICLE_TYPES: Option[] = [
  { value: "car", label: "سيارة صالون" },
  { value: "pickup", label: "بيك أب (ونيت)" },
  { value: "van", label: "فان" },
  { value: "truck", label: "شاحنة" },
  { value: "bus", label: "حافلة" },
  { value: "heavy_equipment", label: "معدة ثقيلة" },
  { value: "motorcycle", label: "دراجة نارية" },
  { value: "other", label: "أخرى" },
];
export const FUEL_TYPES: Option[] = [
  { value: "petrol91", label: "بنزين 91" },
  { value: "petrol95", label: "بنزين 95" },
  { value: "diesel", label: "ديزل" },
  { value: "electric", label: "كهربائي" },
  { value: "hybrid", label: "هجين" },
  { value: "other", label: "أخرى" },
];
export const OWNERSHIP_TYPES: Option[] = [
  { value: "owned", label: "ملك الشركة" },
  { value: "leased", label: "تأجير تمويلي" },
  { value: "rented", label: "مستأجرة" },
];
export const VEHICLE_STATUSES: Option[] = [
  { value: "active", label: "متاحة" },
  { value: "maintenance", label: "في الصيانة" },
  { value: "out_of_service", label: "خارج الخدمة" },
  { value: "disposed", label: "مستبعدة" },
];
export const LICENSE_TYPES: Option[] = [
  { value: "private", label: "خاصة" },
  { value: "public", label: "عمومي" },
  { value: "heavy", label: "نقل ثقيل" },
  { value: "motorcycle", label: "دراجة نارية" },
  { value: "other", label: "أخرى" },
];
export const DOCUMENT_TYPES: Option[] = [
  { value: "insurance", label: "تأمين" },
  { value: "inspection", label: "فحص دوري" },
  { value: "registration", label: "استمارة" },
  { value: "operating_card", label: "بطاقة تشغيل" },
  { value: "other", label: "أخرى" },
];
export const MAINTENANCE_TYPES: Option[] = [
  { value: "periodic", label: "صيانة دورية" },
  { value: "repair", label: "إصلاح عطل" },
  { value: "oil", label: "تغيير زيت" },
  { value: "tires", label: "إطارات" },
  { value: "battery", label: "بطارية" },
  { value: "accident", label: "حادث" },
  { value: "other", label: "أخرى" },
];
export const MAINTENANCE_STATUSES: Option[] = [
  { value: "scheduled", label: "مجدولة" },
  { value: "completed", label: "منفذة" },
  { value: "cancelled", label: "ملغاة" },
];
export const TRIP_STATUSES: Option[] = [
  { value: "open", label: "جارية" },
  { value: "closed", label: "مغلقة" },
  { value: "cancelled", label: "ملغاة" },
];

export const optionLabel = (options: Option[], value: string) => options.find((option) => option.value === value)?.label ?? value;

export const fleetToday = () => riyadhDateString();
export const numberOf = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
export const nullableNumber = (value: string) => (value.trim() === "" ? null : Number(value));

/** الأيام المتبقية حتى تاريخ (سالب = منتهٍ). */
export function daysUntil(date: string, today = fleetToday()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(date)) return null;
  const toUtc = (value: string) => Date.UTC(+value.slice(0, 4), +value.slice(5, 7) - 1, +value.slice(8, 10));
  return Math.round((toUtc(date) - toUtc(today)) / 86400000);
}

/** حالة انتهاء وثيقة أو رخصة: منتهية، تنتهي خلال 30 يومًا، سارية. */
export function expiryState(date: string): { label: string; className: string; days: number | null } {
  const days = daysUntil(date);
  if (days === null) return { label: "—", className: "bg-slate-100 text-slate-500", days };
  if (days < 0) return { label: "منتهية", className: "bg-red-100 text-red-700", days };
  if (days <= 30) return { label: "تنتهي قريبًا", className: "bg-amber-100 text-amber-800", days };
  return { label: "سارية", className: "bg-emerald-100 text-emerald-700", days };
}

export const mapVehicle = (row: Record<string, unknown>): FleetVehicle => ({
  id: String(row.id),
  number: String(row.vehicle_number ?? ""),
  plate: String(row.plate_number ?? ""),
  make: String(row.make ?? ""),
  model: String(row.model ?? ""),
  year: row.manufacture_year === null || row.manufacture_year === undefined ? null : numberOf(row.manufacture_year),
  vin: String(row.vin ?? ""),
  color: String(row.color ?? ""),
  type: String(row.vehicle_type ?? "car"),
  fuelType: String(row.fuel_type ?? "petrol91"),
  ownership: String(row.ownership ?? "owned"),
  status: String(row.status ?? "active"),
  odometer: numberOf(row.current_odometer),
  openingOdometer: numberOf(row.opening_odometer),
  fuelCapacity: row.fuel_capacity === null || row.fuel_capacity === undefined ? null : numberOf(row.fuel_capacity),
  branchId: String(row.branch_id ?? ""),
  costCenterId: String(row.cost_center_id ?? ""),
  fixedAssetId: String(row.fixed_asset_id ?? ""),
  driverId: String(row.assigned_driver_id ?? ""),
  notes: String(row.notes ?? ""),
});

export const mapDriver = (row: Record<string, unknown>): FleetDriver => ({
  id: String(row.id),
  employeeId: String(row.employee_id ?? ""),
  employeeNumber: String(row.employee_number ?? ""),
  name: String(row.driver_name ?? ""),
  licenseNumber: String(row.license_number ?? ""),
  licenseType: String(row.license_type ?? "private"),
  licenseExpiry: String(row.license_expiry ?? ""),
  phone: String(row.phone ?? ""),
  status: String(row.status ?? "active"),
  notes: String(row.notes ?? ""),
});

export async function loadFleetVehicles() {
  const result = await selectAllRows((from, to) => supabase.from("fleet_vehicles").select("*").order("vehicle_number").order("id").range(from, to));
  return { data: result.data.map((row: Record<string, unknown>) => mapVehicle(row)), error: result.error };
}

export async function loadFleetDrivers() {
  const result = await selectAllRows((from, to) => supabase.from("fleet_drivers").select("*").order("driver_name").order("id").range(from, to));
  return { data: result.data.map((row: Record<string, unknown>) => mapDriver(row)), error: result.error };
}

/** فواتير المشتريات المرحّلة للربط (مع المبلغ المربوط سابقًا بسجلات الأسطول). */
export async function loadPurchaseInvoiceOptions(): Promise<{ data: PurchaseInvoiceOption[]; error: string }> {
  const { data, error } = await supabase.rpc("fleet_purchase_invoice_options");
  if (error) return { data: [], error: error.message };
  return {
    data: ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      date: String(row.invoice_date ?? ""),
      vendor: String(row.vendor ?? ""),
      subtotal: numberOf(row.subtotal),
      linkedAmount: numberOf(row.linked_amount),
    })),
    error: "",
  };
}

/**
 * مفتاح متابعة الوثيقة: الوثيقة الأحدث انتهاءً لكل مفتاح هي السارية والأقدم «مُجددة».
 * النوع «أخرى» قد يضم وثائق مختلفة للمركبة نفسها، فيُميَّز برقم الوثيقة (أو يُتابع كل سجل منه على حدة).
 */
export const documentTrackKey = (document: { id: string; vehicleId: string; type: string; number: string }) =>
  document.type === "other" ? `${document.vehicleId}|other|${document.number.trim() || document.id}` : `${document.vehicleId}|${document.type}`;

export const vehicleLabel = (vehicle: FleetVehicle | undefined) =>
  vehicle ? `${vehicle.plate} — ${vehicle.make}${vehicle.model ? ` ${vehicle.model}` : ""}` : "—";

const FLEET_ERRORS: Array<[RegExp, string]> = [
  [/FLEET_EMPLOYEE_NOT_FOUND/, "الموظف غير موجود في الموارد البشرية."],
  [/FLEET_DRIVER_INACTIVE/, "السائق غير نشط."],
  [/FLEET_DRIVER_LICENSE_EXPIRED/, "رخصة السائق منتهية في تاريخ الرحلة؛ جدّد الرخصة في شاشة السائقين أولًا."],
  [/FLEET_VEHICLE_DISPOSED/, "المركبة مستبعدة ولا تُسجل عليها حركات جديدة."],
  [/FLEET_VEHICLE_NOT_AVAILABLE/, "المركبة غير متاحة (في الصيانة أو خارج الخدمة)."],
  [/FLEET_FUTURE_DATE/, "لا يمكن تسجيل حركة بتاريخ مستقبلي."],
  [/FLEET_TRIP_CLOSED/, "الرحلة مغلقة أو ملغاة ولا يمكن تعديل بياناتها الأساسية."],
  [/FLEET_PURCHASE_INVOICE_NOT_POSTED/, "فاتورة المشتريات غير موجودة أو غير مرحّلة."],
  [/FLEET_INVOICE_AMOUNT_EXCEEDED/, "مجموع التكاليف المربوطة بهذه الفاتورة يتجاوز صافيها قبل الضريبة."],
  [/FLEET_PERMISSION_REQUIRED|row-level security|permission denied/i, "لا تملك صلاحية تنفيذ هذا الإجراء."],
  [/fleet_vehicles_plate_uidx/, "رقم اللوحة مسجل لمركبة أخرى."],
  [/fleet_vehicles_vin_uidx/, "رقم الهيكل مسجل لمركبة أخرى."],
  [/fleet_drivers_employee_id_key/, "الموظف مسجل سائقًا من قبل."],
  [/fleet_trips_one_open_per_vehicle/, "للمركبة رحلة جارية؛ أغلقها أولًا."],
  [/fleet_trips_one_open_per_driver/, "للسائق رحلة جارية؛ أغلقها أولًا."],
  [/fleet_vehicles_fixed_asset_id_key/, "الأصل الثابت مربوط بمركبة أخرى."],
  [/update or delete on table .*violates foreign key constraint/i, "السجل مرتبط بحركات أخرى ولا يمكن حذفه."],
  [/violates foreign key constraint/i, "السجل المرتبط غير موجود أو حُذف؛ حدّث الصفحة وأعد المحاولة."],
  [/fleet_trips_check|end_odometer/i, "عداد نهاية الرحلة يجب ألا يقل عن عداد البداية، وتاريخ النهاية بعد البداية."],
  [/fleet_documents_check/, "تاريخ الانتهاء يجب أن يكون بعد تاريخ البداية."],
];

/** نص عربي لخطأ القاعدة (مفتاح ترجمة)؛ الرسالة الأصلية إن لم تُعرف. */
export function fleetErrorText(message: string): string {
  const text = String(message ?? "");
  return FLEET_ERRORS.find(([pattern]) => pattern.test(text))?.[1] ?? text;
}
