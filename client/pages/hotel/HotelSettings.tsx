import { useEffect, useMemo, useState } from "react";
import { Save, Settings2 } from "lucide-react";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import { permissionLevelAny } from "@/lib/authSession";
import { addressComplete, hotelErrorText, nationalAddress, type HotelSettings } from "@/lib/hotel";
import { ErrorNote, HotelButton, HotelCard, HotelHeader, hotelInput, hotelLabel, hotelSelect } from "@/components/hotel/HotelUi";

type Account = { code: string; name: string };
type Form = {
  checkIn: string; checkOut: string; rate: string; roomAccount: string; serviceAccount: string; municipalityAccount: string; advancesAccount: string;
  building: string; street: string; district: string; city: string; postal: string; address: string;
};

/** إعدادات الحجوزات: الأوقات، ورسوم البلدية، وحسابات الإيراد والدفعات المقدمة، والعنوان الافتراضي في الفاتورة */
export default function HotelSettingsPage() {
  const { t, direction } = useI18n();
  const { permissions } = useRolePermissions();
  const canManage = permissionLevelAny(permissions, ["hotel.setup", "module.hotel"]) === "manage";
  const [settings, setSettings] = useState<HotelSettings | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const apply = (s: HotelSettings) => {
    setSettings(s);
    setForm({
      checkIn: s.check_in_time, checkOut: s.check_out_time, rate: String(Number(s.municipality_rate ?? 0)),
      roomAccount: s.room_revenue_account ?? "", serviceAccount: s.service_revenue_account ?? "",
      municipalityAccount: s.municipality_account ?? "", advancesAccount: s.advances_account ?? "213",
      building: "", street: "", district: "", city: "", postal: "", address: s.default_guest_address ?? "",
    });
  };

  useEffect(() => {
    (async () => {
      const [settingsResult, accountsResult] = await Promise.all([
        supabase.rpc("hotel_get_settings"),
        supabase.from("accounting_accounts").select("code, name_ar, parent_code").order("code").limit(5000),
      ]);
      if (settingsResult.error) { setError(hotelErrorText(settingsResult.error.message, t)); return; }
      apply(settingsResult.data as HotelSettings);
      if (!accountsResult.error) {
        const rows = (accountsResult.data ?? []) as Array<{ code: string; name_ar: string; parent_code: string | null }>;
        const parents = new Set(rows.map((row) => row.parent_code).filter(Boolean));
        setAccounts(rows.filter((row) => !parents.has(row.code)).map((row) => ({ code: row.code, name: row.name_ar })));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const revenue = useMemo(() => accounts.filter((a) => a.code.startsWith("4")), [accounts]);
  const liabilities = useMemo(() => accounts.filter((a) => a.code.startsWith("2")), [accounts]);
  const municipality = useMemo(() => accounts.filter((a) => a.code.startsWith("2") || a.code.startsWith("4")), [accounts]);

  if (!form || !settings) {
    return <Layout><main dir={direction} className="space-y-4"><ErrorNote message={error} />{!error && <div className="rounded-xl border bg-white p-10 text-center text-slate-500">{t("جاري التحميل...")}</div>}</main></Layout>;
  }
  const set = (key: keyof Form) => (value: string) => setForm((current) => (current ? { ...current, [key]: value } : current));
  const composed = nationalAddress({ buildingNumber: form.building, street: form.street, district: form.district, city: form.city, postalCode: form.postal });
  const address = composed || form.address.trim();

  const accountField = (label: string, key: "roomAccount" | "serviceAccount" | "municipalityAccount" | "advancesAccount", list: Account[], optionalLabel?: string) => (
    <label className={hotelLabel}>{t(label)}
      {accounts.length ? (
        <select value={form[key]} onChange={(e) => set(key)(e.target.value)} className={hotelSelect} disabled={!canManage}>
          {optionalLabel !== undefined && <option value="">{t(optionalLabel)}</option>}
          {list.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
          {form[key] && !list.some((a) => a.code === form[key]) ? <option value={form[key]}>{form[key]}</option> : null}
        </select>
      ) : <input value={form[key]} onChange={(e) => set(key)(e.target.value)} className={`${hotelInput} text-left`} dir="ltr" disabled={!canManage} placeholder={optionalLabel ? t(optionalLabel) : ""} />}
    </label>
  );

  const save = async () => {
    setError("");
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(form.checkIn) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(form.checkOut)) { setError(t("الوقت بصيغة ساعة:دقيقة (مثل 14:00)")); return; }
    const rate = Number(form.rate || 0);
    if (!/^\d{1,2}(\.\d{1,2})?$/.test(form.rate || "0") || rate > 20) { setError(t("نسبة رسوم البلدية من 0 إلى 20 بخانتين على الأكثر")); return; }
    if (rate > 0 && !form.municipalityAccount) { setError(t("اختر حساب رسوم البلدية عند تحديد نسبتها")); return; }
    if (address && !addressComplete(address)) { setError(t("العنوان الوطني ناقص: رقم المبنى (4 أرقام) والشارع والحي والمدينة والرمز البريدي (5 أرقام)")); return; }
    setBusy(true);
    const { data, error: saveError } = await supabase.rpc("hotel_save_settings", {
      p: {
        check_in_time: form.checkIn, check_out_time: form.checkOut, municipality_rate: rate,
        room_revenue_account: form.roomAccount || null, service_revenue_account: form.serviceAccount || null,
        municipality_account: form.municipalityAccount || null, advances_account: form.advancesAccount || "213",
        default_guest_address: address || null,
      },
    });
    setBusy(false);
    if (saveError) { setError(hotelErrorText(saveError.message, t)); return; }
    apply(data as HotelSettings);
    toast({ title: t("حُفظت إعدادات الحجوزات") });
  };

  const defaultRevenue = settings.default_revenue_account ? `${t("حساب المبيعات الافتراضي")} (${settings.default_revenue_account})` : t("حساب المبيعات الافتراضي");

  return (
    <Layout>
      <main dir={direction} className="space-y-5">
        <HotelHeader icon={Settings2} title="إعدادات الحجوزات" description="تسري على الحجوزات وفواتير المغادرة الجديدة. الفواتير الصادرة لا تتغير."
          actions={canManage ? <HotelButton onClick={() => void save()} busy={busy}><Save className="h-4 w-4" />{t("حفظ الإعدادات")}</HotelButton> : undefined} />
        <ErrorNote message={error} />
        <div className="grid gap-5 lg:grid-cols-2">
          <HotelCard title="الأوقات">
            <div className="grid gap-3 md:grid-cols-2">
              <label className={hotelLabel}>{t("وقت تسجيل الدخول")}<input type="time" value={form.checkIn} onChange={(e) => set("checkIn")(e.target.value)} className={hotelInput} disabled={!canManage} /></label>
              <label className={hotelLabel}>{t("وقت المغادرة")}<input type="time" value={form.checkOut} onChange={(e) => set("checkOut")(e.target.value)} className={hotelInput} disabled={!canManage} /></label>
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-500">{t("للعرض والتنبيه؛ الإقامة تُحسب بالليالي بين تاريخي الوصول والمغادرة.")}</p>
          </HotelCard>
          <HotelCard title="رسوم البلدية">
            <div className="grid gap-3 md:grid-cols-2">
              <label className={hotelLabel}>{t("النسبة من صافي الإقامة (%)")}<input value={form.rate} onChange={(e) => set("rate")(e.target.value)} className={`${hotelInput} text-left`} dir="ltr" inputMode="decimal" disabled={!canManage} /></label>
              {accountField("حساب رسوم البلدية", "municipalityAccount", municipality, "بدون")}
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-500">{t("صفر = بلا رسوم. تظهر بندًا في فاتورة المغادرة وتخضع لضريبة القيمة المضافة. الحساب التزام (2) أو إيراد (4).")}</p>
          </HotelCard>
          <HotelCard title="الحسابات">
            <div className="grid gap-3">
              {accountField("إيراد الإقامة", "roomAccount", revenue, defaultRevenue)}
              {accountField("إيراد الخدمات الإضافية", "serviceAccount", revenue, defaultRevenue)}
              {accountField("الدفعات المقدمة من النزلاء", "advancesAccount", liabilities)}
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-500">{t("الدفعة قبل المغادرة: مدين الصندوق أو البنك / دائن الدفعات المقدمة. عند المغادرة تُسوّى من الفاتورة: مدين الدفعات المقدمة / دائن الذمم.")}</p>
          </HotelCard>
          <HotelCard title="عنوان الفاتورة الافتراضي">
            <p className="mb-3 text-xs leading-5 text-slate-500">{t("فاتورة المبيعات تتطلب عنوان المشتري. يُستخدم هذا العنوان (عنوان الفندق مثلًا) إن لم يكتمل عنوان العميل أو النزيل.")}</p>
            {form.address && !composed ? <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">{form.address}</p> : null}
            <div className="grid gap-2 md:grid-cols-5">
              <input value={form.building} onChange={(e) => set("building")(e.target.value)} placeholder={t("رقم المبنى")} className={`${hotelInput} text-left`} dir="ltr" maxLength={4} disabled={!canManage} />
              <input value={form.street} onChange={(e) => set("street")(e.target.value)} placeholder={t("الشارع")} className={`${hotelInput} md:col-span-2`} disabled={!canManage} />
              <input value={form.district} onChange={(e) => set("district")(e.target.value)} placeholder={t("الحي")} className={`${hotelInput} md:col-span-2`} disabled={!canManage} />
              <input value={form.city} onChange={(e) => set("city")(e.target.value)} placeholder={t("المدينة")} className={`${hotelInput} md:col-span-3`} disabled={!canManage} />
              <input value={form.postal} onChange={(e) => set("postal")(e.target.value)} placeholder={t("الرمز البريدي")} className={`${hotelInput} text-left md:col-span-2`} dir="ltr" maxLength={5} disabled={!canManage} />
            </div>
            {canManage && form.address && <button onClick={() => set("address")("")} className="mt-2 text-xs font-semibold text-red-700">{t("حذف العنوان الافتراضي")}</button>}
            {composed && <p className="mt-2 text-xs text-slate-600">{t("سيُحفظ")}: {composed}</p>}
          </HotelCard>
        </div>
      </main>
    </Layout>
  );
}
