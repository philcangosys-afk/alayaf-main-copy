import { useEffect, useRef, useState } from "react";
import Layout from "@/components/Layout";
import { Search, Plus, Edit, Trash2, Save, X, Info, AlertTriangle, RefreshCw, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n";
import { hrRequestErrorText } from "@/lib/hrErrors";
import { fetchAllRows } from "@/lib/fetchAll";
import {
  DEFAULT_WORK_DAYS,
  FIXED_SCHEDULE_TYPE,
  FLEXIBLE_SCHEDULE_TYPE,
  MAX_PERIODS,
  WEEKDAY_LABELS,
  computeDailyMinutes,
  minutesToHoursText,
  parseSchedule,
  periodMinutes,
  scheduleDraftError,
  timeToMinutes,
  type ScheduleDraft,
  type SchedulePeriod,
  type WorkSchedule,
} from "@/lib/workSchedule";

// إعداد فترات الدوام: جداول attendance_schedules التي يُربط بها الموظف بالاسم (employees.work_schedule)،
// ويقرأ منها حساب الدوام والتقرير الشهري وكشف الرواتب عبر parseSchedule في lib/workSchedule.

const ACTIVE_STATUS = "فعال";
const INACTIVE_STATUS = "غير فعال";
const MIGRATION_MESSAGE = "يجب تطبيق ملف قاعدة البيانات P2 أولًا لحفظ الفترات وأيام العمل";
const NO_ROWS_SAVE_MESSAGE = "لم يُحفظ شيء: لا تملك صلاحية تعديل هذا الجدول أو أنه لم يعد موجودًا";
const NO_ROWS_DELETE_MESSAGE = "لم يُحذف شيء: لا تملك صلاحية حذف هذا الجدول أو أنه لم يعد موجودًا";
const SCHEDULE_COLUMNS = "id, name, type, status, hours, shifts, periods, work_days, break_minutes, late_grace_minutes, early_leave_grace_minutes";
const SETTINGS_COLUMNS = ["periods", "work_days", "break_minutes", "late_grace_minutes", "early_leave_grace_minutes"];

type ErrorLike = { code?: string; message?: string; details?: string } | null;

/** أعمدة الإعدادات غير موجودة: ملف قاعدة البيانات P2 لم يُطبَّق بعد */
const isMissingColumnError = (error: unknown) => {
  const err = error as ErrorLike;
  const code = String(err?.code ?? "");
  if (code === "42703" || code === "PGRST204") return true;
  if (code.startsWith("23")) return false;
  const text = `${err?.message ?? ""} ${err?.details ?? ""}`;
  return /column/i.test(text) && SETTINGS_COLUMNS.some((column) => text.includes(column));
};

const scheduleErrorText = (error: unknown, fallback: string) => {
  if (isMissingColumnError(error)) return MIGRATION_MESSAGE;
  const err = error as ErrorLike;
  const text = `${err?.message ?? ""} ${err?.details ?? ""}`;
  // رموز ORG_ITEM_* تُترجم في hrRequestErrorText؛ هنا فقط أخطاء القيود العامة بلا رمز
  if (!text.includes("ORG_ITEM_")) {
    if (err?.code === "23503") return "الجدول مرتبط بسجلات أخرى؛ لا يمكن حذفه";
    if (err?.code === "23514") return "قيمة غير مقبولة في إعدادات الجدول؛ راجع الفترات وأيام العمل والدقائق";
  }
  return hrRequestErrorText(error, fallback);
};

const pad2 = (value: number) => String(value).padStart(2, "0");
/** دقائق إلى "H:MM" */
const formatHM = (minutes: number) => {
  const safe = Math.max(0, Math.round(minutes));
  return `${Math.floor(safe / 60)}:${pad2(safe % 60)}`;
};
const normalizeTime = (value: string) => {
  const minutes = timeToMinutes(value);
  return minutes === null ? "" : `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
};
const isFlexibleType = (type: string) => type.includes("متغير");
/** الحقل الفارغ صفر؛ غير الرقم يبقى NaN ليُرفض في التحقق */
const parseWhole = (value: string) => (value.trim() === "" ? 0 : Number(value));
const isWholeInRange = (value: number, min: number, max: number) => Number.isInteger(value) && value >= min && value <= max;

type FormState = {
  name: string;
  type: string;
  status: string;
  periods: SchedulePeriod[];
  workDays: number[];
  breakMinutes: string;
  lateGrace: string;
  earlyGrace: string;
  flexHours: string;
  flexMinutes: string;
};

const emptyForm = (): FormState => ({
  name: "",
  type: FIXED_SCHEDULE_TYPE,
  status: ACTIVE_STATUS,
  periods: [{ start: "08:00", end: "16:00" }],
  workDays: [...DEFAULT_WORK_DAYS],
  breakMinutes: "0",
  lateGrace: "0",
  earlyGrace: "0",
  flexHours: "8",
  flexMinutes: "0",
});

const formFromSchedule = (schedule: WorkSchedule): FormState => ({
  name: schedule.name,
  type: isFlexibleType(schedule.type) ? FLEXIBLE_SCHEDULE_TYPE : FIXED_SCHEDULE_TYPE,
  status: schedule.status || ACTIVE_STATUS,
  periods: schedule.periods.length ? schedule.periods.map((period) => ({ ...period })) : [{ start: "", end: "" }],
  workDays: [...schedule.workDays],
  breakMinutes: String(schedule.breakMinutes),
  lateGrace: String(schedule.lateGraceMinutes),
  earlyGrace: String(schedule.earlyLeaveGraceMinutes),
  flexHours: String(Math.floor(schedule.dailyMinutes / 60)),
  flexMinutes: String(schedule.dailyMinutes % 60),
});

const flexibleMinutesOf = (form: FormState) => parseWhole(form.flexHours) * 60 + parseWhole(form.flexMinutes);

const buildDraft = (form: FormState): ScheduleDraft => ({
  name: form.name,
  type: form.type,
  periods: form.periods,
  workDays: form.workDays,
  breakMinutes: parseWhole(form.breakMinutes),
  lateGraceMinutes: parseWhole(form.lateGrace),
  earlyLeaveGraceMinutes: parseWhole(form.earlyGrace),
  flexibleMinutes: flexibleMinutesOf(form),
});

/** أول خطأ في النموذج (تحقق المكتبة المشتركة ثم الأرقام الصحيحة وحدود قاعدة البيانات وتكرار الاسم) */
const formErrorText = (form: FormState, items: WorkSchedule[], editingId: string | null): string | null => {
  const draft = buildDraft(form);
  const baseError = scheduleDraftError(draft);
  if (baseError) return baseError;
  if (form.type === FLEXIBLE_SCHEDULE_TYPE) {
    if (!isWholeInRange(parseWhole(form.flexHours), 0, 24) || !isWholeInRange(parseWhole(form.flexMinutes), 0, 59)) return "عدد الساعات رقم صحيح حتى 24، والدقائق بين 0 و59";
  } else {
    if (!isWholeInRange(draft.breakMinutes, 0, 600)) return "الاستراحة عدد صحيح من الدقائق بين 0 و600";
    if (!isWholeInRange(draft.lateGraceMinutes, 0, 240)) return "فترة السماح للتأخير عدد صحيح من الدقائق بين 0 و240";
    if (!isWholeInRange(draft.earlyLeaveGraceMinutes, 0, 240)) return "فترة السماح للخروج المبكر عدد صحيح من الدقائق بين 0 و240";
  }
  const name = form.name.trim();
  if (items.some((item) => item.id !== editingId && item.name === name)) return "يوجد جدول عمل آخر بالاسم نفسه";
  return null;
};

/** ما يُحفظ في attendance_schedules؛ يُقرأ لاحقًا بـ parseSchedule بالقيم نفسها */
const buildPayload = (form: FormState) => {
  const flexible = form.type === FLEXIBLE_SCHEDULE_TYPE;
  const periods: SchedulePeriod[] = flexible ? [] : form.periods.map((period) => ({ start: normalizeTime(period.start), end: normalizeTime(period.end) }));
  const breakMinutes = flexible ? 0 : parseWhole(form.breakMinutes);
  const dailyMinutes = flexible ? flexibleMinutesOf(form) : computeDailyMinutes(periods, breakMinutes);
  return {
    name: form.name.trim(),
    type: form.type,
    status: form.status,
    periods,
    work_days: [...new Set(form.workDays)].sort((a, b) => a - b),
    break_minutes: breakMinutes,
    late_grace_minutes: flexible ? 0 : parseWhole(form.lateGrace),
    early_leave_grace_minutes: flexible ? 0 : parseWhole(form.earlyGrace),
    shifts: periods.length || 1,
    hours: minutesToHoursText(dailyMinutes),
  };
};

const fetchSchedules = (columns: string) => supabase.from("attendance_schedules").select(columns).order("name");

export default function HRAttendanceSchedules() {
  const { t, direction, formatNumber } = useI18n();
  const [items, setItems] = useState<WorkSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [employeeCounts, setEmployeeCounts] = useState<Map<string, number> | null>(null);
  const [countsError, setCountsError] = useState(false);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const requestRef = useRef(0);
  const formRef = useRef<HTMLDivElement | null>(null);

  const loadData = async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setLoadError(null);
    // عدد الموظفين لكل جدول (المطابقة بالاسم بعد حذف المسافات)؛ فشله لا يمنع عرض الجداول
    const countsPromise = fetchAllRows<{ id: unknown; work_schedule: unknown }>((from, to) =>
      supabase.from("employees").select("id, work_schedule").order("id").range(from, to),
    ).then(
      (rows) => {
        const counts = new Map<string, number>();
        rows.forEach((row) => {
          const name = String(row.work_schedule ?? "").trim();
          if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
        });
        return counts;
      },
      () => null,
    );
    try {
      let missing = false;
      let result = await fetchSchedules(SCHEDULE_COLUMNS);
      if (result.error && isMissingColumnError(result.error)) {
        missing = true;
        result = await fetchSchedules("*");
      }
      if (result.error) throw result.error;
      const counts = await countsPromise;
      if (requestId !== requestRef.current) return;
      setItems((result.data ?? []).map((row) => parseSchedule(row as unknown as Record<string, unknown>)));
      setMigrationMissing(missing);
      setEmployeeCounts(counts);
      setCountsError(counts === null);
    } catch (error) {
      if (requestId !== requestRef.current) return;
      setItems([]);
      setEmployeeCounts(null);
      setCountsError(false);
      setLoadError(scheduleErrorText(error, "تعذر تحميل جداول العمل"));
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  };

  useEffect(() => { void loadData(); }, []);

  useEffect(() => {
    if (showForm) formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [showForm, editingId]);

  const resetForm = () => { setShowForm(false); setEditingId(null); setForm(emptyForm()); setShowErrors(false); };
  const startAdd = () => { setEditingId(null); setForm(emptyForm()); setShowErrors(false); setShowForm(true); };
  const startEdit = (item: WorkSchedule) => { setEditingId(item.id); setForm(formFromSchedule(item)); setShowErrors(false); setShowForm(true); };

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((prev) => ({ ...prev, [key]: value }));
  const updatePeriod = (index: number, key: keyof SchedulePeriod, value: string) =>
    setForm((prev) => ({ ...prev, periods: prev.periods.map((period, i) => (i === index ? { ...period, [key]: value } : period)) }));
  const addPeriod = () =>
    setForm((prev) => (prev.periods.length >= MAX_PERIODS ? prev : { ...prev, periods: [...prev.periods, { start: prev.periods[prev.periods.length - 1]?.end ?? "", end: "" }] }));
  const removePeriod = (index: number) =>
    setForm((prev) => (prev.periods.length <= 1 ? prev : { ...prev, periods: prev.periods.filter((_, i) => i !== index) }));
  const toggleDay = (day: number, checked: boolean) =>
    setForm((prev) => ({ ...prev, workDays: checked ? [...new Set([...prev.workDays, day])].sort((a, b) => a - b) : prev.workDays.filter((value) => value !== day) }));

  const linkedCount = (name: string) => employeeCounts?.get(name.trim()) ?? 0;
  const linkedMessage = (count: number) => `${t("الجدول مرتبط بـ")} ${formatNumber(count)} ${t("موظف؛ انقلهم إلى جدول آخر أولًا")}`;

  const handleSave = async () => {
    setShowErrors(true);
    const validationError = formErrorText(form, items, editingId);
    if (validationError) {
      toast({ title: t("لم يُحفظ الجدول"), description: t(validationError), variant: "destructive" });
      return;
    }
    const payload = buildPayload(form);
    const wasEditing = Boolean(editingId);
    setSaving(true);
    try {
      if (editingId) {
        const { data, error } = await supabase.from("attendance_schedules").update(payload).eq("id", editingId).select("id");
        if (error) throw error;
        if (!data?.length) throw new Error(NO_ROWS_SAVE_MESSAGE);
      } else {
        const { error } = await supabase.from("attendance_schedules").insert([payload]);
        if (error) throw error;
      }
      toast({ title: t(wasEditing ? "تم حفظ تعديل الجدول" : "تمت إضافة الجدول") });
      resetForm();
      void loadData();
    } catch (error) {
      if (isMissingColumnError(error)) setMigrationMissing(true);
      toast({ title: t("تعذر حفظ جدول العمل"), description: t(scheduleErrorText(error, "تعذر حفظ جدول العمل")), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item: WorkSchedule) => {
    const known = linkedCount(item.name);
    if (known > 0) {
      toast({ title: t("لم يتم الحذف"), description: linkedMessage(known), variant: "destructive" });
      return;
    }
    if (!window.confirm(`${t("حذف جدول العمل")} "${item.name}"؟`)) return;
    setDeletingId(item.id);
    try {
      // تحقق أخير وقت الحذف (قاعدة البيانات تمنعه أيضًا برمز ORG_ITEM_IN_USE)
      const { count, error: countError } = await supabase.from("employees").select("id", { count: "exact", head: true }).eq("work_schedule", item.name);
      if (countError) {
        toast({ title: t("تعذر التحقق من الموظفين المرتبطين"), description: t(scheduleErrorText(countError, "تعذر التحقق من الموظفين المرتبطين")), variant: "destructive" });
        return;
      }
      if ((count ?? 0) > 0) {
        toast({ title: t("لم يتم الحذف"), description: linkedMessage(count ?? 0), variant: "destructive" });
        return;
      }
      const { data, error } = await supabase.from("attendance_schedules").delete().eq("id", item.id).select("id");
      if (error || !data?.length) {
        toast({ title: t("لم يتم الحذف"), description: t(error ? scheduleErrorText(error, "تعذر حذف جدول العمل") : NO_ROWS_DELETE_MESSAGE), variant: "destructive" });
        return;
      }
      setItems((prev) => prev.filter((row) => row.id !== item.id));
      if (editingId === item.id) resetForm();
      toast({ title: t("تم حذف الجدول") });
    } catch (error) {
      toast({ title: t("لم يتم الحذف"), description: t(scheduleErrorText(error, "تعذر حذف جدول العمل")), variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  const workDaysText = (days: number[]) => {
    const set = new Set(days);
    if (set.size === 7) return t("كل أيام الأسبوع");
    if (set.size >= 3) {
      // أيام متتالية (مع الالتفاف من السبت إلى الأحد) تُعرض كمدى: الأحد–الخميس
      const start = days.find((day) => !set.has((day + 6) % 7));
      if (start !== undefined) {
        let length = 0;
        while (length < 7 && set.has((start + length) % 7)) length += 1;
        if (length === set.size) return `${t(WEEKDAY_LABELS[start])}–${t(WEEKDAY_LABELS[(start + length - 1) % 7])}`;
      }
    }
    return [...set].sort((a, b) => a - b).map((day) => t(WEEKDAY_LABELS[day])).join("، ");
  };

  const query = search.trim();
  const filtered = items.filter((item) => !query || item.name.includes(query));
  const iconMargin = direction === "rtl" ? "ml-2" : "mr-2";
  const searchIconPosition = direction === "rtl" ? "right-3" : "left-3";
  const searchInputPadding = direction === "rtl" ? "pr-9" : "pl-9";

  // معاينة حية في المحرر
  const formFlexible = form.type === FLEXIBLE_SCHEDULE_TYPE;
  const validPeriods = form.periods.filter((period) => periodMinutes(period) > 0);
  const periodsTotal = computeDailyMinutes(validPeriods, 0);
  const breakValue = parseWhole(form.breakMinutes);
  const safeBreak = Number.isFinite(breakValue) && breakValue > 0 ? breakValue : 0;
  const flexValue = flexibleMinutesOf(form);
  const dailyPreview = formFlexible ? (Number.isFinite(flexValue) ? flexValue : 0) : computeDailyMinutes(validPeriods, safeBreak);
  const liveError = showErrors ? formErrorText(form, items, editingId) : null;
  const editingItem = editingId ? items.find((item) => item.id === editingId) ?? null : null;
  const editingLinked = editingItem ? linkedCount(editingItem.name) : 0;
  const legacyWithoutPeriods = Boolean(editingItem && !isFlexibleType(editingItem.type) && editingItem.periods.length === 0);
  const renaming = Boolean(editingItem && form.name.trim() && form.name.trim() !== editingItem.name);

  const labelCls = "mb-1 block text-sm font-medium text-gray-700";
  const selectCls = "h-10 w-full rounded-md border bg-white px-3 text-sm";

  return <Layout><div className="mx-auto max-w-[1400px] space-y-6 p-6" dir={direction}>
    <div className="overflow-hidden rounded-xl border bg-white shadow-sm"><div className="flex items-center justify-between gap-3 border-b bg-gray-50 p-4"><h2 className="text-lg font-bold text-gray-800">{t("إعدادات الحضور")}</h2><span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">{t("غير مفعّلة بعد")}</span></div><div className="p-6">{/* هذه الخيارات لا تُحفظ بعد؛ تُعرض معطلة حتى لا توحي بحفظ غير موجود */}<div className="flex flex-wrap items-center gap-8 text-sm text-gray-400"><div className="flex items-center gap-2"><Checkbox id="hide-unused" disabled /><label htmlFor="hide-unused">{t("إخفاء سجلات البصمة غير المستخدمة")}</label></div><div className="flex items-center gap-2"><Checkbox id="show-chart" disabled /><label htmlFor="show-chart">{t("عرض مخطط جدول العمل")}</label></div><div className="flex items-center gap-2"><Checkbox id="show-exit" disabled /><label htmlFor="show-exit">{t("عرض خروج الموظف للبصمة في يوم الدخول")}</label></div></div><p className="mt-3 text-xs text-amber-700">{t("غير مفعّلة بعد: هذه الإعدادات لا تُحفظ ولا تؤثر على الحضور حاليًا")}</p></div></div>

    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t("إعداد فترات الدوام")}</h1>
        <p className="mt-1 text-sm text-gray-500">{t("جداول العمل التي يُربط بها الموظف في ملفه، وتُحسب بها ساعات الدوام والتأخير والخروج المبكر في حساب الدوام والرواتب")}</p>
      </div>
      <Button onClick={startAdd} className="bg-[#004e89] hover:bg-[#003865]"><Plus className={`h-4 w-4 ${iconMargin}`} />{t("إضافة جدول")}</Button>
    </div>

    {migrationMissing && (
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div><p className="font-semibold">{t(MIGRATION_MESSAGE)}</p><p className="mt-1">{t("حتى ذلك الحين تُعرض الجداول بالاسم وعدد الساعات فقط، ولا يمكن حفظ الإعدادات الجديدة.")}</p></div>
      </div>
    )}

    {showForm && (
      <div ref={formRef} className="space-y-5 rounded-xl border bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-gray-900">{editingId ? `${t("تعديل الجدول")}: ${editingItem?.name ?? ""}` : t("جدول عمل جديد")}</h3>
          <button type="button" onClick={resetForm} title={t("إغلاق")} aria-label={t("إغلاق")} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
        </div>

        {legacyWithoutPeriods && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{t("هذا الجدول محفوظ بلا فترات دوام، ولذلك يُحسب حاليًا كجدول متغير بعدد ساعات")} {formatHM(editingItem?.dailyMinutes ?? 0)} {t("يوميًا دون تأخير. أدخل الفترات لتفعيل حساب التأخير والخروج المبكر، أو غيّر النوع إلى متغير.")}</span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div><label htmlFor="schedule-name" className={labelCls}>{t("اسم الجدول")} *</label><Input id="schedule-name" value={form.name} onChange={(e) => setField("name", e.target.value)} placeholder={t("مثال: دوام إداري")} /></div>
          <div><label htmlFor="schedule-type" className={labelCls}>{t("نوع الجدول")}</label><select id="schedule-type" value={form.type} onChange={(e) => setField("type", e.target.value)} className={selectCls}><option value={FIXED_SCHEDULE_TYPE}>{t("ثابت (مواعيد دخول وخروج محددة)")}</option><option value={FLEXIBLE_SCHEDULE_TYPE}>{t("متغير (عدد ساعات فقط)")}</option></select></div>
          <div><label htmlFor="schedule-status" className={labelCls}>{t("الحالة")}</label><select id="schedule-status" value={form.status} onChange={(e) => setField("status", e.target.value)} className={selectCls}><option value={ACTIVE_STATUS}>{t("فعال")}</option><option value={INACTIVE_STATUS}>{t("غير فعال")}</option></select></div>
        </div>
        {renaming && editingLinked > 0 && <p className="text-xs text-blue-700">{t("سيتغير اسم الجدول تلقائيًا في ملفات")} {formatNumber(editingLinked)} {t("موظف مرتبطين به")}</p>}
        {form.status === INACTIVE_STATUS && editingLinked > 0 && <p className="text-xs text-amber-700">{t("الموظفون المرتبطون بهذا الجدول يبقون عليه ويُحسب دوامهم بإعداداته، لكنه لن يظهر عند اختيار جدول في ملف الموظف")}</p>}

        <div>
          <span className={labelCls}>{t("أيام العمل")} *</span>
          <div className="flex flex-wrap gap-2">
            {WEEKDAY_LABELS.map((label, day) => {
              const checked = form.workDays.includes(day);
              return <label key={day} htmlFor={`work-day-${day}`} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${checked ? "border-[#004e89] bg-blue-50 text-[#004e89]" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}><Checkbox id={`work-day-${day}`} checked={checked} onCheckedChange={(value) => toggleDay(day, value === true)} />{t(label)}</label>;
            })}
          </div>
          <p className="mt-1 text-xs text-gray-500">{t("الأيام غير المختارة أيام راحة لا يُحسب فيها غياب.")}</p>
        </div>

        {formFlexible ? (
          <div className="space-y-4 rounded-lg border border-purple-100 bg-purple-50/40 p-4">
            <div className="flex items-start gap-2 text-sm text-purple-800"><Info className="mt-0.5 h-4 w-4 shrink-0" /><span>{t("الجدول المتغير: لا مواعيد ثابتة ولا يُحسب تأخير؛ يُطلب عدد الساعات فقط")}</span></div>
            <div>
              <span className={labelCls}>{t("عدد ساعات العمل اليومية")} *</span>
              <div className="flex flex-wrap items-center gap-2">
                <Input type="number" min={0} max={24} step={1} inputMode="numeric" value={form.flexHours} onChange={(e) => setField("flexHours", e.target.value)} className="w-24" aria-label={t("الساعات")} />
                <span className="text-sm text-gray-600">{t("ساعة")}</span>
                <Input type="number" min={0} max={59} step={1} inputMode="numeric" value={form.flexMinutes} onChange={(e) => setField("flexMinutes", e.target.value)} className="w-24" aria-label={t("الدقائق")} />
                <span className="text-sm text-gray-600">{t("دقيقة")}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4 rounded-lg border border-gray-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><h4 className="font-semibold text-gray-800">{t("فترات الدوام")}</h4><p className="text-xs text-gray-500">{t("رتّب الفترات حسب وقتها؛ التأخير يُقاس من بداية الفترة الأولى والخروج المبكر من نهاية الفترة الأخيرة")}</p></div>
              <Button type="button" variant="outline" size="sm" onClick={addPeriod} disabled={form.periods.length >= MAX_PERIODS}><Plus className={`h-4 w-4 ${direction === "rtl" ? "ml-1" : "mr-1"}`} />{t("إضافة فترة")} ({formatNumber(form.periods.length)}/{formatNumber(MAX_PERIODS)})</Button>
            </div>
            <div className="space-y-2">
              {form.periods.map((period, index) => {
                const duration = periodMinutes(period);
                const start = timeToMinutes(period.start);
                const end = timeToMinutes(period.end);
                const overnight = start !== null && end !== null && end < start;
                return <div key={index} className="flex flex-wrap items-center gap-3 rounded-lg bg-gray-50 px-3 py-2">
                  <span className="w-20 text-sm font-medium text-gray-700">{t("الفترة")} {formatNumber(index + 1)}</span>
                  <span className="text-sm text-gray-500">{t("من")}</span>
                  <Input type="time" dir="ltr" value={period.start} onChange={(e) => updatePeriod(index, "start", e.target.value)} className="w-32" aria-label={`${t("بداية الفترة")} ${index + 1}`} />
                  <span className="text-sm text-gray-500">{t("إلى")}</span>
                  <Input type="time" dir="ltr" value={period.end} onChange={(e) => updatePeriod(index, "end", e.target.value)} className="w-32" aria-label={`${t("نهاية الفترة")} ${index + 1}`} />
                  <span className="text-sm text-gray-600">{duration > 0 ? `${t("المدة")} ${formatHM(duration)}` : "—"}</span>
                  {overnight && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">{t("تنتهي في اليوم التالي")}</span>}
                  <button type="button" onClick={() => removePeriod(index)} disabled={form.periods.length <= 1} title={t("حذف الفترة")} aria-label={`${t("حذف الفترة")} ${index + 1}`} className="ms-auto text-red-400 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
                </div>;
              })}
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div><label htmlFor="break-minutes" className={labelCls}>{t("الاستراحة (دقيقة)")}</label><Input id="break-minutes" type="number" min={0} max={600} step={1} inputMode="numeric" value={form.breakMinutes} onChange={(e) => setField("breakMinutes", e.target.value)} /><p className="mt-1 text-xs text-gray-500">{t("تُخصم من مجموع الفترات (استراحة غير مدفوعة داخل الفترات)")}</p></div>
              <div><label htmlFor="late-grace" className={labelCls}>{t("فترة السماح للتأخير (دقيقة)")}</label><Input id="late-grace" type="number" min={0} max={240} step={1} inputMode="numeric" value={form.lateGrace} onChange={(e) => setField("lateGrace", e.target.value)} /><p className="mt-1 text-xs text-gray-500">{t("إن تجاوزها الدخول يُحسب التأخير كاملًا من بداية الدوام")}</p></div>
              <div><label htmlFor="early-grace" className={labelCls}>{t("فترة السماح للخروج المبكر (دقيقة)")}</label><Input id="early-grace" type="number" min={0} max={240} step={1} inputMode="numeric" value={form.earlyGrace} onChange={(e) => setField("earlyGrace", e.target.value)} /><p className="mt-1 text-xs text-gray-500">{t("الخروج قبل نهاية آخر فترة بأكثر منها يُحسب خروجًا مبكرًا")}</p></div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-blue-50 px-4 py-3 text-sm text-[#004e89]">
          <Clock className="h-4 w-4 shrink-0" />
          <span className="font-semibold">{t("ساعات العمل اليومية")}: {formatHM(dailyPreview)}</span>
          {!formFlexible && <span className="text-xs text-blue-700">({t("مجموع الفترات")} {formatHM(periodsTotal)} − {t("الاستراحة")} {formatNumber(safeBreak)} {t("دقيقة")})</span>}
        </div>

        {liveError && <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{t(liveError)}</span></div>}

        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={saving} className="bg-[#004e89] hover:bg-[#003865]"><Save className={`h-4 w-4 ${direction === "rtl" ? "ml-1" : "mr-1"}`} />{saving ? t("جاري الحفظ...") : t("حفظ")}</Button>
          <Button variant="outline" onClick={resetForm} disabled={saving}><X className={`h-4 w-4 ${direction === "rtl" ? "ml-1" : "mr-1"}`} />{t("إلغاء")}</Button>
        </div>
      </div>
    )}

    <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <div className="relative w-72 max-w-full"><Search className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 ${searchIconPosition}`} /><Input placeholder={t("بحث باسم الجدول...")} value={search} onChange={(e) => setSearch(e.target.value)} className={searchInputPadding} /></div>
        <span className="text-sm text-gray-500">{formatNumber(filtered.length)} {t("جدول")}</span>
      </div>
      {countsError && !loading && <div className="border-b bg-amber-50 px-4 py-2 text-xs text-amber-800">{t("تعذر تحميل عدد الموظفين المرتبطين بكل جدول؛ سيُتحقق منه عند الحذف")}</div>}
      <div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-sm">
        <thead className="bg-[#004e89] text-white"><tr>
          <th className="w-12 px-4 py-3 text-start font-medium">#</th>
          <th className="px-4 py-3 text-start font-medium">{t("الاسم")}</th>
          <th className="px-4 py-3 text-start font-medium">{t("النوع")}</th>
          <th className="px-4 py-3 text-start font-medium">{t("فترات الدوام")}</th>
          <th className="px-4 py-3 text-start font-medium">{t("الساعات اليومية")}</th>
          <th className="px-4 py-3 text-start font-medium">{t("أيام العمل")}</th>
          <th className="px-4 py-3 text-start font-medium">{t("السماح (دقيقة)")}</th>
          <th className="px-4 py-3 text-start font-medium">{t("الموظفون")}</th>
          <th className="px-4 py-3 text-start font-medium">{t("الحالة")}</th>
          <th className="w-24 px-4 py-3 text-center font-medium">{t("الإجراءات")}</th>
        </tr></thead>
        <tbody className="divide-y bg-white">
          {loading ? <tr><td colSpan={10} className="py-8 text-center text-gray-400">{t("جاري التحميل...")}</td></tr>
            : loadError ? <tr><td colSpan={10} className="py-8 text-center"><p className="text-red-600">{t("تعذر تحميل جداول العمل")}: {t(loadError)}</p><Button variant="outline" size="sm" className="mt-3" onClick={() => void loadData()}><RefreshCw className={`h-4 w-4 ${direction === "rtl" ? "ml-1" : "mr-1"}`} />{t("إعادة المحاولة")}</Button></td></tr>
            : filtered.length === 0 ? <tr><td colSpan={10} className="py-8 text-center text-gray-400">{items.length === 0 ? t("لا توجد جداول عمل بعد؛ أضف جدولًا") : t("لا توجد نتائج مطابقة للبحث")}</td></tr>
            : filtered.map((item, i) => {
              const typeFlexible = isFlexibleType(item.type);
              const count = employeeCounts ? employeeCounts.get(item.name) ?? 0 : null;
              return <tr key={item.id} className="align-top hover:bg-gray-50/50">
                <td className="px-4 py-3">{formatNumber(i + 1)}</td>
                <td className="px-4 py-3 font-medium text-gray-900">{item.name}</td>
                <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${typeFlexible ? "bg-purple-50 text-purple-700" : "bg-blue-50 text-[#004e89]"}`}>{t(typeFlexible ? "متغير" : "ثابت")}</span></td>
                <td className="px-4 py-3">
                  {item.periods.length ? <>
                    <div>{item.periods.map((period) => `${period.start}–${period.end}`).join("، ")}</div>
                    {item.breakMinutes > 0 && <div className="text-xs text-gray-500">{t("استراحة")} {formatNumber(item.breakMinutes)} {t("دقيقة")}</div>}
                  </> : typeFlexible ? <span className="text-gray-600">{t("مرن")}</span>
                    : <span className="text-xs text-amber-700">{t("لم تُحدد فترات (يُحسب كمرن)")}</span>}
                </td>
                <td className="px-4 py-3 font-medium">{formatHM(item.dailyMinutes)}</td>
                <td className="px-4 py-3">{workDaysText(item.workDays)}</td>
                <td className="px-4 py-3">{item.flexible ? <span className="text-gray-400">—</span> : <div className="space-y-0.5 text-xs"><div>{t("تأخير")}: {formatNumber(item.lateGraceMinutes)}</div><div>{t("خروج مبكر")}: {formatNumber(item.earlyLeaveGraceMinutes)}</div></div>}</td>
                <td className="px-4 py-3">{count === null ? <span className="text-gray-400" title={t("تعذر تحميل عدد الموظفين")}>—</span> : formatNumber(count)}</td>
                <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${item.status === ACTIVE_STATUS ? "bg-green-50 text-green-700" : item.status ? "bg-gray-100 text-gray-600" : "bg-amber-50 text-amber-700"}`}>{item.status ? t(item.status) : t("غير محدد")}</span></td>
                <td className="px-4 py-3"><div className="flex items-center justify-center gap-3">
                  <button type="button" onClick={() => startEdit(item)} title={t("تعديل")} aria-label={`${t("تعديل")} ${item.name}`} className="text-gray-400 hover:text-[#004e89]"><Edit className="h-4 w-4" /></button>
                  <button type="button" onClick={() => void handleDelete(item)} disabled={deletingId === item.id} title={t("حذف")} aria-label={`${t("حذف")} ${item.name}`} className="text-red-400 hover:text-red-600 disabled:opacity-40"><Trash2 className="h-4 w-4" /></button>
                </div></td>
              </tr>;
            })}
        </tbody>
      </table></div>
    </div>

    <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-5 text-sm text-gray-700">
      <div className="mb-2 flex items-center gap-2 font-semibold text-[#004e89]"><Info className="h-4 w-4" />{t("كيف تُستخدم هذه الإعدادات في حساب الدوام والرواتب")}</div>
      <ul className="list-disc space-y-1 ps-5">
        <li>{t("يوم العمل حسب الأيام المختارة في جدول الموظف، وغيرها أيام راحة.")}</li>
        <li>{t("الساعات المطلوبة يوميًا = مجموع الفترات ناقص الاستراحة (وللجدول المتغير: عدد الساعات المحدد).")}</li>
        <li>{t("التأخير يُحسب من بداية أول فترة إذا تجاوز الدخول فترة السماح، ويُحسب حينها كاملًا من بداية الدوام.")}</li>
        <li>{t("الخروج المبكر: الخروج قبل نهاية آخر فترة بأكثر من فترة السماح.")}</li>
        <li>{t("الجدول المتغير: لا مواعيد ثابتة ولا يُحسب فيه تأخير ولا خروج مبكر؛ المطلوب عدد الساعات اليومية فقط.")}</li>
        <li>{t("الموظف بلا جدول: أيام العمل الأحد–الخميس، وساعاته اليومية من ملفه.")}</li>
        <li>{t("يُربط الموظف بالجدول من ملفه (حقل جدول العمل)؛ تظهر هناك الجداول الفعالة فقط.")}</li>
      </ul>
    </div>
  </div></Layout>;
}
