import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { AlertTriangle, Bell, Download, FileWarning, Gauge, IdCard, Printer, RefreshCw, ShieldAlert, Wrench } from "lucide-react";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import { supabase } from "@/lib/supabaseClient";
import { selectAllRows } from "@/lib/ledgerData";
import { COMPANY_REPORT_BRAND, exportReportExcel, printReport, type ReportCell, type ReportColumn } from "@/lib/reportExport";
import {
  DOCUMENT_TYPES, MAINTENANCE_TYPES, VEHICLE_STATUSES, daysUntil, documentTrackKey, expiryState, fleetErrorText, fleetToday, loadFleetDrivers,
  loadFleetVehicles, numberOf, optionLabel, vehicleLabel, type FleetDriver, type FleetVehicle,
} from "@/lib/fleet";

type ReportId = "cost" | "fuel" | "trips" | "maintenance";
type FleetDocument = { id: string; vehicleId: string; type: string; number: string; startDate: string; expiryDate: string; amount: number };
type Maintenance = {
  id: string; number: string; vehicleId: string; date: string; type: string; status: string; odometer: number | null;
  description: string; amount: number; nextDueDate: string; nextDueOdometer: number | null;
};
type FuelLog = { id: string; vehicleId: string; date: string; liters: number; amount: number; odometer: number | null };
type Trip = { id: string; vehicleId: string; driverId: string; startDate: string; status: string; distance: number | null };
type AssetValue = { vehicleId: string; assetNumber: string; bookValue: number };
type SourceData = {
  vehicles: FleetVehicle[];
  drivers: FleetDriver[];
  documents: FleetDocument[];
  maintenance: Maintenance[];
  fuel: FuelLog[];
  trips: Trip[];
  assetValues: Map<string, AssetValue>;
  assetError: string;
};
/** صيانة قادمة: سجل «مجدولة»، أو موعد الصيانة التالية المسجل في آخر صيانة منفذة من النوع نفسه. */
type DueItem = {
  id: string; source: "scheduled" | "next_due"; number: string; vehicle: FleetVehicle; type: string; description: string;
  dueDate: string; dueOdometer: number | null; days: number | null; remainingKm: number | null; amount: number;
};
type AlertCategory = "document" | "insurance" | "license" | "maintenance";
type FleetAlert = { key: string; category: AlertCategory; title: string; detail: string; badge: string; critical: boolean; urgency: number };
type Report = { columns: ReportColumn[]; rows: Record<string, ReportCell>[]; summary: Array<{ label: string; value: ReportCell }>; notice?: string; sectionKey?: string };

const REPORTS: Array<{ id: ReportId; label: string; description: string }> = [
  { id: "cost", label: "تكلفة المركبات", description: "تكلفة الوقود والصيانة المنفذة والوثائق لكل مركبة في الفترة، مع الكيلومترات المقطوعة وتكلفة الكيلومتر والقيمة الدفترية." },
  { id: "fuel", label: "استهلاك الوقود", description: "اللترات والتكلفة ومتوسط سعر اللتر لكل مركبة، والمسافة من قراءات العداد عند التعبئة ومعدل الكيلومتر لكل لتر." },
  { id: "trips", label: "الرحلات", description: "عدد الرحلات والمسافة المقطوعة لكل سائق ولكل مركبة في الفترة." },
  { id: "maintenance", label: "الصيانة القادمة", description: "الصيانات المجدولة ومواعيد الصيانة التالية مرتبة حسب تاريخ الاستحقاق، مع المتبقي بالأيام والكيلومترات." },
];

const ALERT_ICON: Record<AlertCategory, typeof Bell> = { document: FileWarning, insurance: ShieldAlert, license: IdCard, maintenance: Wrench };
const ALERT_CATEGORY_LABEL: Record<AlertCategory, string> = { document: "وثائق", insurance: "تأمين", license: "رخص", maintenance: "صيانة" };

const ALERT_WINDOW_DAYS = 30;
const ALERT_WINDOW_KM = 1000;

const dateText = (value: unknown) => String(value ?? "").slice(0, 10);
const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const optionalNumber = (value: unknown) => (value === null || value === undefined || value === "" ? null : numberOf(value));
const RIYADH_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" });
/** تاريخ بداية الرحلة بتوقيت الرياض (start_at مخزن timestamptz). */
const riyadhDate = (iso: unknown) => {
  const date = new Date(String(iso ?? ""));
  if (Number.isNaN(date.getTime())) return "";
  const parts = RIYADH_DATE.formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
};
const sortNumber = (value: number | null) => (value === null ? Number.MAX_SAFE_INTEGER : value);

export default function FleetOverview() {
  const { t, direction, formatNumber } = useI18n();
  const location = useLocation();
  const today = fleetToday();
  const [view, setView] = useState<ReportId>("cost");
  const [dateFrom, setDateFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [dateTo, setDateTo] = useState(today);
  const [data, setData] = useState<SourceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestId = useRef(0);
  const reportsRef = useRef<HTMLElement>(null);

  const load = async () => {
    const current = ++requestId.current;
    setLoading(true);
    setError("");
    const [vehicleResult, driverResult, documentResult, maintenanceResult, fuelResult, tripResult, valueResult] = await Promise.all([
      loadFleetVehicles(),
      loadFleetDrivers(),
      selectAllRows((from, to) => supabase.from("fleet_documents").select("id, vehicle_id, document_type, document_number, provider, start_date, expiry_date, amount").order("expiry_date").order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("fleet_maintenance").select("id, maintenance_number, vehicle_id, maintenance_date, maintenance_type, status, odometer, description, amount, next_due_date, next_due_odometer").order("maintenance_date").order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("fleet_fuel_logs").select("id, fuel_number, vehicle_id, driver_id, fuel_date, liters, amount, odometer").order("fuel_date").order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("fleet_trips").select("id, vehicle_id, driver_id, start_at, start_odometer, end_odometer, status").order("start_at").order("id").range(from, to)),
      supabase.rpc("fleet_vehicle_asset_values"),
    ]);
    if (current !== requestId.current) return;
    const firstError = vehicleResult.error ?? driverResult.error ?? documentResult.error ?? maintenanceResult.error ?? fuelResult.error ?? tripResult.error;
    if (firstError) {
      setError(t(fleetErrorText(firstError.message)));
      setLoading(false);
      return;
    }
    // القيمة الدفترية من الأصول الثابتة إضافية؛ تعذر قراءتها لا يوقف اللوحة
    const assetRows = (valueResult.error ? [] : valueResult.data ?? []) as Record<string, unknown>[];
    setData({
      vehicles: vehicleResult.data,
      drivers: driverResult.data,
      documents: documentResult.data.map((row: Record<string, unknown>) => ({
        id: String(row.id), vehicleId: String(row.vehicle_id ?? ""), type: String(row.document_type ?? "other"), number: String(row.document_number ?? ""),
        startDate: dateText(row.start_date), expiryDate: dateText(row.expiry_date), amount: numberOf(row.amount),
      })),
      maintenance: maintenanceResult.data.map((row: Record<string, unknown>) => ({
        id: String(row.id), number: String(row.maintenance_number ?? ""), vehicleId: String(row.vehicle_id ?? ""), date: dateText(row.maintenance_date),
        type: String(row.maintenance_type ?? "other"), status: String(row.status ?? ""), odometer: optionalNumber(row.odometer),
        description: String(row.description ?? ""), amount: numberOf(row.amount), nextDueDate: dateText(row.next_due_date), nextDueOdometer: optionalNumber(row.next_due_odometer),
      })),
      fuel: fuelResult.data.map((row: Record<string, unknown>) => ({
        id: String(row.id), vehicleId: String(row.vehicle_id ?? ""), date: dateText(row.fuel_date), liters: numberOf(row.liters),
        amount: numberOf(row.amount), odometer: optionalNumber(row.odometer),
      })),
      trips: tripResult.data.map((row: Record<string, unknown>) => {
        const status = String(row.status ?? "open");
        const end = optionalNumber(row.end_odometer);
        return {
          id: String(row.id), vehicleId: String(row.vehicle_id ?? ""), driverId: String(row.driver_id ?? ""), startDate: riyadhDate(row.start_at), status,
          distance: status === "closed" && end !== null ? Math.max(end - numberOf(row.start_odometer), 0) : null,
        };
      }),
      assetValues: new Map<string, AssetValue>(assetRows.map((row) => [
        String(row.vehicle_id), { vehicleId: String(row.vehicle_id), assetNumber: String(row.asset_number ?? ""), bookValue: numberOf(row.book_value) },
      ])),
      assetError: valueResult.error ? valueResult.error.message : "",
    });
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  // مسار التقارير يفتح اللوحة نفسها وينزل إلى قسم التقارير
  useEffect(() => {
    if (!loading && location.pathname.startsWith("/fleet/reports")) reportsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [loading, location.pathname]);

  const money = (value: number) => formatNumber(Math.abs(value) < 0.005 ? 0 : value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const km = (value: number) => formatNumber(value, { maximumFractionDigits: 1 });
  const liters = (value: number) => formatNumber(value, { maximumFractionDigits: 2 });
  const ratio = (value: number) => formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const dueItems = useMemo<DueItem[]>(() => {
    if (!data) return [];
    const vehicleById = new Map(data.vehicles.map((vehicle) => [vehicle.id, vehicle]));
    const typeKey = (item: Maintenance) => `${item.vehicleId}|${item.type}`;
    const scheduledKeys = new Set(data.maintenance.filter((item) => item.status === "scheduled").map(typeKey));
    const latestCompleted = new Map<string, Maintenance>();
    data.maintenance.filter((item) => item.status === "completed").forEach((item) => {
      const previous = latestCompleted.get(typeKey(item));
      if (!previous || item.date > previous.date || (item.date === previous.date && (item.odometer ?? 0) >= (previous.odometer ?? 0))) latestCompleted.set(typeKey(item), item);
    });
    const items: DueItem[] = [];
    const add = (item: Maintenance, source: DueItem["source"], dueDate: string, dueOdometer: number | null) => {
      const vehicle = vehicleById.get(item.vehicleId);
      if (!vehicle || vehicle.status === "disposed") return;
      const validDate = isDate(dueDate) ? dueDate : "";
      if (!validDate && dueOdometer === null) return;
      items.push({
        id: item.id, source, number: item.number, vehicle, type: item.type, description: item.description, dueDate: validDate,
        dueOdometer, days: validDate ? daysUntil(validDate, today) : null,
        remainingKm: dueOdometer === null ? null : dueOdometer - vehicle.odometer, amount: source === "scheduled" ? item.amount : 0,
      });
    };
    // المجدولة: مستحقة في تاريخها المخطط (حقول «الصيانة القادمة» فيها تخص ما بعد تنفيذها)
    data.maintenance.filter((item) => item.status === "scheduled").forEach((item) => add(item, "scheduled", item.date, null));
    // المنفذة: موعد الصيانة التالية من آخر صيانة لكل مركبة ونوع، ما لم تُجدول صيانة من النوع نفسه
    latestCompleted.forEach((item, key) => { if (!scheduledKeys.has(key)) add(item, "next_due", item.nextDueDate, item.nextDueOdometer); });
    return items.sort((first, second) =>
      (first.dueDate || "9999-12-31").localeCompare(second.dueDate || "9999-12-31") || sortNumber(first.remainingKm) - sortNumber(second.remainingKm));
  }, [data, today]);

  const alerts = useMemo<FleetAlert[]>(() => {
    if (!data) return [];
    const list: FleetAlert[] = [];
    const liveVehicles = data.vehicles.filter((vehicle) => vehicle.status !== "disposed");
    const vehicleById = new Map(liveVehicles.map((vehicle) => [vehicle.id, vehicle]));
    const expiryDetail = (date: string, days: number) => days < 0
      ? `${t("انتهت في")} ${date} (${t("منذ")} ${formatNumber(-days)} ${t("يوم")})`
      : days === 0 ? `${t("تنتهي اليوم")} ${date}` : `${t("تنتهي في")} ${date} (${t("بعد")} ${formatNumber(days)} ${t("يوم")})`;

    // الوثائق: آخر وثيقة لكل مركبة ونوع، فتجديد الوثيقة يلغي تنبيه السابقة
    const latestDocuments = new Map<string, FleetDocument>();
    data.documents.forEach((document) => {
      if (!vehicleById.has(document.vehicleId) || !isDate(document.expiryDate)) return;
      const key = documentTrackKey(document);
      const previous = latestDocuments.get(key);
      if (!previous || document.expiryDate > previous.expiryDate) latestDocuments.set(key, document);
    });
    latestDocuments.forEach((document) => {
      const days = daysUntil(document.expiryDate, today);
      if (days === null || days > ALERT_WINDOW_DAYS) return;
      list.push({
        key: `document-${document.id}`, category: "document",
        title: `${t(optionLabel(DOCUMENT_TYPES, document.type))} — ${vehicleLabel(vehicleById.get(document.vehicleId))}`,
        detail: `${expiryDetail(document.expiryDate, days)}${document.number ? ` — ${t("رقم الوثيقة")} ${document.number}` : ""}`,
        badge: t(expiryState(document.expiryDate).label), critical: days < 0, urgency: days,
      });
    });

    // مركبات بلا أي وثيقة تأمين (التأمين المنتهي يظهر أعلاه ضمن الوثائق)
    const insured = new Set(data.documents.filter((document) => document.type === "insurance").map((document) => document.vehicleId));
    liveVehicles.filter((vehicle) => !insured.has(vehicle.id)).forEach((vehicle) => list.push({
      key: `insurance-${vehicle.id}`, category: "insurance", title: `${t("لا توجد وثيقة تأمين")} — ${vehicleLabel(vehicle)}`,
      detail: t("المركبة بلا تأمين ساري؛ سجّل وثيقة التأمين في شاشة التأمين والفحص."), badge: t("غير مؤمّنة"), critical: true, urgency: -1e9,
    }));

    data.drivers.filter((driver) => driver.status === "active").forEach((driver) => {
      const days = daysUntil(driver.licenseExpiry, today);
      if (days === null || days > ALERT_WINDOW_DAYS) return;
      list.push({
        key: `license-${driver.id}`, category: "license", title: `${t("رخصة السائق")} — ${driver.name}`,
        detail: expiryDetail(driver.licenseExpiry, days), badge: t(expiryState(driver.licenseExpiry).label), critical: days < 0, urgency: days,
      });
    });

    dueItems.forEach((item) => {
      const dateDue = item.days !== null && item.days <= ALERT_WINDOW_DAYS;
      const kmDue = item.remainingKm !== null && item.remainingKm <= ALERT_WINDOW_KM;
      if (!dateDue && !kmDue) return;
      const critical = (item.days !== null && item.days < 0) || (item.remainingKm !== null && item.remainingKm <= 0);
      const parts: string[] = [];
      if (item.dueDate && item.days !== null) {
        parts.push(item.days < 0
          ? `${t("كان موعدها")} ${item.dueDate} (${t("متأخرة")} ${formatNumber(-item.days)} ${t("يوم")})`
          : item.days === 0 ? `${t("موعدها اليوم")} ${item.dueDate}` : `${t("موعدها")} ${item.dueDate} (${t("بعد")} ${formatNumber(item.days)} ${t("يوم")})`);
      }
      if (item.remainingKm !== null && item.dueOdometer !== null) {
        parts.push(item.remainingKm <= 0
          ? `${t("تجاوز العداد موعدها بـ")} ${km(-item.remainingKm)} ${t("كم")}`
          : `${t("المتبقي")} ${km(item.remainingKm)} ${t("كم")} (${t("عند العداد")} ${km(item.dueOdometer)})`);
      }
      list.push({
        key: `maintenance-${item.id}`, category: "maintenance",
        title: `${t(optionLabel(MAINTENANCE_TYPES, item.type))} — ${vehicleLabel(item.vehicle)}`,
        detail: parts.join(" — "), badge: t(critical ? "متأخرة" : "مستحقة قريبًا"), critical,
        // الاستحقاق بالعداد فقط: المتأخر في أعلى العاجل، والقريب في آخر التنبيهات
        urgency: item.days ?? (critical ? -1e6 + sortNumber(item.remainingKm) : 1e6 + sortNumber(item.remainingKm)),
      });
    });

    return list.sort((first, second) => Number(second.critical) - Number(first.critical) || first.urgency - second.urgency);
  }, [data, dueItems, today, t, formatNumber]);

  const kpis = useMemo(() => {
    if (!data) return [];
    const count = (status: string) => data.vehicles.filter((vehicle) => vehicle.status === status).length;
    const disposed = count("disposed");
    const critical = alerts.filter((alert) => alert.critical).length;
    return [
      { key: "total", label: t("إجمالي المركبات"), value: data.vehicles.length - disposed, hint: disposed ? `${t("عدا المستبعدة")}: ${formatNumber(disposed)}` : "", tone: "text-slate-900" },
      ...["active", "maintenance", "out_of_service"].map((status) => ({
        key: status, label: t(optionLabel(VEHICLE_STATUSES, status)), value: count(status), hint: "",
        tone: status === "active" ? "text-emerald-700" : status === "maintenance" ? "text-amber-700" : "text-slate-600",
      })),
      { key: "open_trips", label: t("رحلات جارية"), value: data.trips.filter((trip) => trip.status === "open").length, hint: "", tone: "text-sky-700" },
      { key: "alerts", label: t("التنبيهات"), value: alerts.length, hint: critical ? `${t("عاجلة")}: ${formatNumber(critical)}` : "", tone: critical ? "text-red-700" : alerts.length ? "text-amber-700" : "text-slate-900" },
    ];
  }, [data, alerts, t, formatNumber]);

  const report = useMemo<Report>(() => {
    if (!data) return { columns: [], rows: [], summary: [] };
    const inPeriod = (date: string) => isDate(date) && date >= dateFrom && date <= dateTo;
    const vehicleById = new Map(data.vehicles.map((vehicle) => [vehicle.id, vehicle]));
    const byVehicleNumber = (first: FleetVehicle, second: FleetVehicle) => first.number.localeCompare(second.number);

    if (view === "cost") {
      const stats = new Map<string, { fuel: number; maintenance: number; documents: number; km: number }>();
      const stat = (vehicleId: string) => {
        const existing = stats.get(vehicleId);
        if (existing) return existing;
        const created = { fuel: 0, maintenance: 0, documents: 0, km: 0 };
        stats.set(vehicleId, created);
        return created;
      };
      data.fuel.filter((log) => inPeriod(log.date)).forEach((log) => { stat(log.vehicleId).fuel += log.amount; });
      data.maintenance.filter((item) => item.status === "completed" && inPeriod(item.date)).forEach((item) => { stat(item.vehicleId).maintenance += item.amount; });
      data.documents.filter((document) => inPeriod(document.startDate || document.expiryDate)).forEach((document) => { stat(document.vehicleId).documents += document.amount; });
      data.trips.filter((trip) => trip.distance !== null && inPeriod(trip.startDate)).forEach((trip) => { stat(trip.vehicleId).km += trip.distance ?? 0; });
      const lines = data.vehicles
        .filter((vehicle) => vehicle.status !== "disposed" || stats.has(vehicle.id))
        .map((vehicle) => {
          const values = stats.get(vehicle.id) ?? { fuel: 0, maintenance: 0, documents: 0, km: 0 };
          return { vehicle, ...values, total: values.fuel + values.maintenance + values.documents, asset: data.assetValues.get(vehicle.id) };
        })
        .sort((first, second) => second.total - first.total || byVehicleNumber(first.vehicle, second.vehicle));
      const sum = (pick: (line: (typeof lines)[number]) => number) => lines.reduce((total, line) => total + pick(line), 0);
      const totalCost = sum((line) => line.total);
      const totalKm = sum((line) => line.km);
      return {
        columns: [
          { key: "number", label: t("رقم المركبة") },
          { key: "vehicle", label: t("المركبة"), width: 26 },
          { key: "fuel", label: t("الوقود") },
          { key: "maintenance", label: t("الصيانة") },
          { key: "documents", label: t("الوثائق") },
          { key: "total", label: t("إجمالي التكلفة") },
          { key: "km", label: t("الكيلومترات") },
          { key: "costPerKm", label: t("تكلفة الكيلومتر") },
          { key: "bookValue", label: t("القيمة الدفترية") },
        ],
        rows: lines.map((line) => ({
          number: line.vehicle.number, vehicle: vehicleLabel(line.vehicle), fuel: money(line.fuel), maintenance: money(line.maintenance),
          documents: money(line.documents), total: money(line.total), km: km(line.km), costPerKm: line.km > 0 ? money(line.total / line.km) : "—",
          bookValue: line.asset ? money(line.asset.bookValue) : "—",
        })),
        summary: [
          { label: t("الوقود"), value: money(sum((line) => line.fuel)) },
          { label: t("الصيانة"), value: money(sum((line) => line.maintenance)) },
          { label: t("الوثائق"), value: money(sum((line) => line.documents)) },
          { label: t("إجمالي التكلفة"), value: money(totalCost) },
          { label: t("الكيلومترات"), value: km(totalKm) },
          { label: t("متوسط تكلفة الكيلومتر"), value: totalKm > 0 ? money(totalCost / totalKm) : "—" },
          { label: t("إجمالي القيمة الدفترية"), value: money(sum((line) => line.asset?.bookValue ?? 0)) },
        ],
        notice: `${t("المبالغ قبل ضريبة القيمة المضافة. الوقود بتاريخ التعبئة، والصيانة المنفذة بتاريخها، والوثائق بتاريخ بدايتها (أو انتهائها إن لم تُحدد البداية)، والكيلومترات من الرحلات المغلقة التي بدأت في الفترة.")}${data.assetError ? ` ${t("تعذر قراءة القيم الدفترية من الأصول الثابتة.")}` : ""}`,
      };
    }

    if (view === "fuel") {
      const groups = new Map<string, FuelLog[]>();
      data.fuel.filter((log) => inPeriod(log.date) && vehicleById.has(log.vehicleId)).forEach((log) => {
        const list = groups.get(log.vehicleId) ?? [];
        list.push(log);
        groups.set(log.vehicleId, list);
      });
      const lines = [...groups.entries()].map(([vehicleId, logs]) => {
        const totalLiters = logs.reduce((total, log) => total + log.liters, 0);
        const cost = logs.reduce((total, log) => total + log.amount, 0);
        const withOdometer = logs
          .filter((log) => log.odometer !== null && log.odometer > 0)
          .sort((first, second) => (first.odometer ?? 0) - (second.odometer ?? 0) || first.date.localeCompare(second.date));
        const distance = withOdometer.length >= 2 ? (withOdometer[withOdometer.length - 1].odometer ?? 0) - (withOdometer[0].odometer ?? 0) : null;
        // لترات أول تعبئة في الفترة استُهلكت قبلها، فتُستبعد من معدل الاستهلاك
        const consumed = withOdometer.slice(1).reduce((total, log) => total + log.liters, 0);
        const kmPerLiter = distance !== null && distance > 0 && consumed > 0 ? distance / consumed : null;
        return { vehicle: vehicleById.get(vehicleId) as FleetVehicle, fills: logs.length, liters: totalLiters, cost, distance, consumed, kmPerLiter };
      }).sort((first, second) => byVehicleNumber(first.vehicle, second.vehicle));
      const totalLiters = lines.reduce((total, line) => total + line.liters, 0);
      const totalCost = lines.reduce((total, line) => total + line.cost, 0);
      const measured = lines.filter((line) => line.kmPerLiter !== null);
      const measuredKm = measured.reduce((total, line) => total + (line.distance ?? 0), 0);
      const measuredLiters = measured.reduce((total, line) => total + line.consumed, 0);
      return {
        columns: [
          { key: "number", label: t("رقم المركبة") },
          { key: "vehicle", label: t("المركبة"), width: 26 },
          { key: "fills", label: t("عدد التعبئات") },
          { key: "liters", label: t("اللترات") },
          { key: "cost", label: t("التكلفة") },
          { key: "price", label: t("متوسط سعر اللتر") },
          { key: "distance", label: t("المسافة من العداد (كم)") },
          { key: "kmPerLiter", label: t("كم / لتر") },
        ],
        rows: lines.map((line) => ({
          number: line.vehicle.number, vehicle: vehicleLabel(line.vehicle), fills: formatNumber(line.fills), liters: liters(line.liters),
          cost: money(line.cost), price: line.liters > 0 ? money(line.cost / line.liters) : "—",
          distance: line.distance === null ? "—" : km(line.distance), kmPerLiter: line.kmPerLiter === null ? "—" : ratio(line.kmPerLiter),
        })),
        summary: [
          { label: t("اللترات"), value: liters(totalLiters) },
          { label: t("التكلفة"), value: money(totalCost) },
          { label: t("متوسط سعر اللتر"), value: totalLiters > 0 ? money(totalCost / totalLiters) : "—" },
          { label: t("المسافة من العداد (كم)"), value: km(lines.reduce((total, line) => total + (line.distance ?? 0), 0)) },
          { label: t("متوسط كم / لتر"), value: measuredLiters > 0 ? ratio(measuredKm / measuredLiters) : "—" },
        ],
        notice: t("المبالغ قبل ضريبة القيمة المضافة. المسافة هي الفرق بين أعلى وأدنى قراءة عداد في تعبئات الفترة، ومعدل كم/لتر يستبعد لترات أول تعبئة، ويلزمه تعبئتان على الأقل بقراءة عداد."),
      };
    }

    if (view === "trips") {
      const periodTrips = data.trips.filter((trip) => trip.status !== "cancelled" && inPeriod(trip.startDate));
      const group = (keyOf: (trip: Trip) => string) => {
        const map = new Map<string, { closed: number; open: number; km: number }>();
        periodTrips.forEach((trip) => {
          const key = keyOf(trip);
          const entry = map.get(key) ?? { closed: 0, open: 0, km: 0 };
          if (trip.status === "closed") { entry.closed += 1; entry.km += trip.distance ?? 0; } else entry.open += 1;
          map.set(key, entry);
        });
        return [...map.entries()].sort((first, second) => second[1].km - first[1].km);
      };
      const driverById = new Map(data.drivers.map((driver) => [driver.id, driver]));
      const row = (section: string, name: string, entry: { closed: number; open: number; km: number }) => ({
        group: section, name, closed: formatNumber(entry.closed), open: formatNumber(entry.open), km: km(entry.km),
        average: entry.closed > 0 ? km(entry.km / entry.closed) : "—",
      });
      const driverSection = t("حسب السائق");
      const vehicleSection = t("حسب المركبة");
      const closedCount = periodTrips.filter((trip) => trip.status === "closed").length;
      const totalKm = periodTrips.reduce((total, trip) => total + (trip.distance ?? 0), 0);
      return {
        columns: [
          { key: "group", label: t("التجميع") },
          { key: "name", label: t("السائق / المركبة"), width: 28 },
          { key: "closed", label: t("رحلات مغلقة") },
          { key: "open", label: t("رحلات جارية") },
          { key: "km", label: t("المسافة (كم)") },
          { key: "average", label: t("متوسط مسافة الرحلة (كم)") },
        ],
        rows: [
          ...group((trip) => trip.driverId).map(([driverId, entry]) => {
            const driver = driverById.get(driverId);
            return row(driverSection, driver ? `${driver.name}${driver.employeeNumber ? ` (${driver.employeeNumber})` : ""}` : "—", entry);
          }),
          ...group((trip) => trip.vehicleId).map(([vehicleId, entry]) => row(vehicleSection, vehicleLabel(vehicleById.get(vehicleId)), entry)),
        ],
        summary: [
          { label: t("رحلات مغلقة"), value: formatNumber(closedCount) },
          { label: t("رحلات جارية"), value: formatNumber(periodTrips.length - closedCount) },
          { label: t("المسافة (كم)"), value: km(totalKm) },
          { label: t("متوسط مسافة الرحلة (كم)"), value: closedCount > 0 ? km(totalKm / closedCount) : "—" },
        ],
        notice: t("الرحلات التي بدأت في الفترة عدا الملغاة؛ المسافة من الرحلات المغلقة فقط."),
        sectionKey: "group",
      };
    }

    const stateOf = (item: DueItem) => {
      if ((item.days !== null && item.days < 0) || (item.remainingKm !== null && item.remainingKm <= 0)) return "متأخرة";
      if ((item.days !== null && item.days <= ALERT_WINDOW_DAYS) || (item.remainingKm !== null && item.remainingKm <= ALERT_WINDOW_KM)) return "مستحقة قريبًا";
      return "قادمة";
    };
    const overdue = dueItems.filter((item) => stateOf(item) === "متأخرة").length;
    const soon = dueItems.filter((item) => stateOf(item) === "مستحقة قريبًا").length;
    return {
      columns: [
        { key: "vehicle", label: t("المركبة"), width: 26 },
        { key: "type", label: t("نوع الصيانة") },
        { key: "source", label: t("المصدر") },
        { key: "number", label: t("رقم السجل") },
        { key: "dueDate", label: t("تاريخ الاستحقاق") },
        { key: "days", label: t("المتبقي (يوم)") },
        { key: "dueOdometer", label: t("عداد الاستحقاق") },
        { key: "odometer", label: t("العداد الحالي") },
        { key: "remainingKm", label: t("المتبقي (كم)") },
        { key: "state", label: t("الحالة") },
        { key: "description", label: t("الوصف"), width: 24 },
        { key: "amount", label: t("التكلفة التقديرية") },
      ],
      rows: dueItems.map((item) => ({
        vehicle: vehicleLabel(item.vehicle), type: t(optionLabel(MAINTENANCE_TYPES, item.type)),
        source: t(item.source === "scheduled" ? "صيانة مجدولة" : "موعد الصيانة التالية"), number: item.number || "—",
        dueDate: item.dueDate || "—", days: item.days === null ? "—" : formatNumber(item.days),
        dueOdometer: item.dueOdometer === null ? "—" : km(item.dueOdometer), odometer: km(item.vehicle.odometer),
        remainingKm: item.remainingKm === null ? "—" : km(item.remainingKm), state: t(stateOf(item)),
        description: item.description || "—", amount: item.amount > 0 ? money(item.amount) : "—",
      })),
      summary: [
        { label: t("عدد الصيانات القادمة"), value: formatNumber(dueItems.length) },
        { label: t("متأخرة"), value: formatNumber(overdue) },
        { label: t("مستحقة خلال 30 يومًا أو 1000 كم"), value: formatNumber(soon) },
        { label: t("التكلفة التقديرية"), value: money(dueItems.reduce((total, item) => total + item.amount, 0)) },
      ],
      notice: t("الصيانات المجدولة، وموعد الصيانة التالية المسجل في آخر صيانة منفذة لكل مركبة ونوع ما لم تُجدول صيانة من النوع نفسه. القيم السالبة تعني تجاوز الموعد."),
    };
  }, [data, dueItems, view, dateFrom, dateTo, t, formatNumber]);

  const current = REPORTS.find((item) => item.id === view) ?? REPORTS[0];
  const isSnapshot = view === "maintenance";
  const invalidRange = !isSnapshot && dateFrom > dateTo;
  const subtitle = `${isSnapshot ? `${t("حتى تاريخ")} ${today}` : `${t("من تاريخ")} ${dateFrom} ${t("إلى تاريخ")} ${dateTo}`}${report.notice ? ` — ${report.notice}` : ""}`;
  const exportOptions = { title: t(current.label), subtitle, columns: report.columns, rows: report.rows, summary: report.summary, fileName: t(current.label), landscape: true, brand: COMPANY_REPORT_BRAND };
  const canExport = !loading && !error && !invalidRange && report.rows.length > 0;
  const screenColumns = report.sectionKey ? report.columns.filter((column) => column.key !== report.sectionKey) : report.columns;

  return (
    <Layout>
      <main dir={direction} className="space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-emerald-50 p-2 text-emerald-700"><Gauge className="h-6 w-6" /></div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{t("لوحة الأسطول والتقارير")}</h1>
              <p className="mt-1 text-sm text-slate-500">{t("حالة المركبات والتنبيهات العاجلة، وتقارير التكلفة والوقود والرحلات والصيانة القادمة.")}</p>
            </div>
          </div>
          <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded border bg-white px-3 py-2 text-sm text-slate-700 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />{t("تحديث")}</button>
        </header>

        {error && <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {loading && !data
            ? Array.from({ length: 6 }, (_, index) => <div key={index} className="h-[88px] animate-pulse rounded-xl border bg-white shadow-sm" />)
            : kpis.map((card) => (
              <div key={card.key} className="rounded-xl border bg-white p-4 shadow-sm">
                <p className="text-xs text-slate-500">{card.label}</p>
                <p className={`mt-1 text-2xl font-bold ${card.tone}`}>{formatNumber(card.value)}</p>
                {card.hint && <p className="mt-0.5 text-[11px] text-slate-400">{card.hint}</p>}
              </div>
            ))}
        </div>

        <section className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b bg-slate-50 px-4 py-3">
            <h2 className="flex items-center gap-2 font-bold text-slate-800"><Bell className="h-4 w-4 text-amber-600" />{t("التنبيهات")}</h2>
            <span className="text-xs text-slate-500">{t("الوثائق والرخص خلال 30 يومًا، والصيانة خلال 30 يومًا أو 1000 كم")}</span>
          </div>
          {loading && !data ? (
            <p className="py-10 text-center text-sm text-slate-500">{t("جاري التحميل...")}</p>
          ) : alerts.length === 0 ? (
            <p className="py-10 text-center text-sm text-emerald-700">{t("لا توجد تنبيهات؛ الوثائق والرخص والصيانة في مواعيدها.")}</p>
          ) : (
            <ul className="max-h-[420px] divide-y overflow-y-auto">
              {alerts.map((alert) => {
                const Icon = ALERT_ICON[alert.category];
                return (
                  <li key={alert.key} className="flex items-start gap-3 px-4 py-3">
                    <div className={`mt-0.5 rounded-lg p-2 ${alert.critical ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-700"}`}><Icon className="h-4 w-4" /></div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-800">{alert.title}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{alert.detail}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${alert.critical ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`}>{alert.badge}</span>
                      <span className="text-[11px] text-slate-400">{t(ALERT_CATEGORY_LABEL[alert.category])}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section ref={reportsRef} className="scroll-mt-4 overflow-hidden rounded-xl border bg-white shadow-sm">
          <div className="grid grid-cols-2 border-b md:grid-cols-4">
            {REPORTS.map((item) => (
              <button key={item.id} onClick={() => setView(item.id)} className={`px-3 py-3 text-xs font-semibold ${view === item.id ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-50"}`}>
                {t(item.label)}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-end justify-between gap-3 border-b bg-slate-50 px-4 py-3">
            <div className="flex flex-wrap gap-2">
              {isSnapshot ? (
                <p className="text-xs text-slate-500">{t("حتى تاريخ")}: <b className="text-slate-700">{today}</b></p>
              ) : (
                <>
                  <label className="text-xs text-slate-500">{t("من تاريخ")}<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="mt-1 block rounded border border-slate-200 bg-white px-2 py-1.5 text-xs" /></label>
                  <label className="text-xs text-slate-500">{t("إلى تاريخ")}<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="mt-1 block rounded border border-slate-200 bg-white px-2 py-1.5 text-xs" /></label>
                </>
              )}
            </div>
            <div className="flex gap-1">
              <button onClick={() => void load()} className="rounded border border-slate-200 bg-white p-1.5" title={t("تحديث")}><RefreshCw className="h-3.5 w-3.5" /></button>
              <button disabled={!canExport} onClick={() => printReport(exportOptions)} className="rounded border border-slate-200 bg-white p-1.5 disabled:opacity-40" title={t("طباعة")}><Printer className="h-3.5 w-3.5" /></button>
              <button disabled={!canExport} onClick={() => exportReportExcel(exportOptions)} className="rounded border border-slate-200 bg-white p-1.5 disabled:opacity-40" title={t("تصدير Excel")}><Download className="h-3.5 w-3.5" /></button>
            </div>
          </div>

          <div className="p-4">
            <p className="mb-2 text-xs text-slate-500">{t(current.description)}</p>
            {report.notice && <p className="mb-3 flex items-start gap-1 text-xs text-amber-700"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{report.notice}</p>}
            {loading ? (
              <p className="py-16 text-center text-sm text-slate-500">{t("جاري التحميل...")}</p>
            ) : error ? (
              <p className="py-16 text-center text-sm text-red-600">{error}</p>
            ) : invalidRange ? (
              <p className="py-16 text-center text-sm text-red-600">{t("تاريخ البداية يجب أن يسبق تاريخ النهاية")}</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead className="bg-slate-100 text-slate-600">
                      <tr>{screenColumns.map((column) => <th key={column.key} className="border-b px-3 py-2 text-center font-semibold">{column.label}</th>)}</tr>
                    </thead>
                    <tbody>
                      {report.rows.length ? report.rows.map((row, index) => {
                        const section = report.sectionKey ? String(row[report.sectionKey] ?? "") : "";
                        const startsSection = Boolean(section) && (index === 0 || String(report.rows[index - 1][report.sectionKey as string] ?? "") !== section);
                        return (
                          <Fragment key={`${index}-${String(row.number ?? row.name ?? row.vehicle ?? "row")}`}>
                            {startsSection && <tr><td colSpan={screenColumns.length} className="border-b bg-slate-50 px-3 py-2 text-start text-xs font-bold text-slate-700">{section}</td></tr>}
                            <tr className="border-b border-slate-100">
                              {screenColumns.map((column) => <td key={column.key} className="px-3 py-2 text-center text-slate-700">{row[column.key] === "" || row[column.key] === undefined ? "—" : row[column.key]}</td>)}
                            </tr>
                          </Fragment>
                        );
                      }) : (
                        <tr><td colSpan={screenColumns.length} className="px-3 py-12 text-center text-slate-400">{t(isSnapshot ? "لا توجد صيانة قادمة" : "لا توجد بيانات للفترة المحددة")}</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {report.summary.length > 0 && report.rows.length > 0 && (
                  <div className="mt-3 flex flex-wrap justify-end gap-4 border-t border-slate-100 pt-3 text-xs">
                    {report.summary.map((item) => <span key={item.label} className="font-semibold text-slate-700">{item.label}: <b className="text-emerald-700">{item.value}</b></span>)}
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </main>
    </Layout>
  );
}
