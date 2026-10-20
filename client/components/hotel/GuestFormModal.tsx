import { useState } from "react";
import { useI18n } from "@/i18n";
import { supabase } from "@/lib/supabaseClient";
import { ID_TYPES, hotelErrorText, mapGuest, type HotelGuest, type Option } from "@/lib/hotel";
import { ErrorNote, HotelButton, HotelModal, hotelInput, hotelLabel, hotelSelect } from "@/components/hotel/HotelUi";

type Form = {
  fullName: string; phone: string; email: string; nationality: string; idType: string; idNumber: string;
  buildingNumber: string; street: string; district: string; city: string; postalCode: string; customerId: string; notes: string;
};

const toForm = (guest: HotelGuest | null): Form => ({
  fullName: guest?.fullName ?? "", phone: guest?.phone ?? "", email: guest?.email ?? "", nationality: guest?.nationality ?? "",
  idType: guest?.idType ?? "", idNumber: guest?.idNumber ?? "", buildingNumber: guest?.buildingNumber ?? "", street: guest?.street ?? "",
  district: guest?.district ?? "", city: guest?.city ?? "", postalCode: guest?.postalCode ?? "", customerId: guest?.customerId ?? "",
  notes: guest?.notes ?? "",
});

/** إضافة نزيل أو تعديله (hotel_save_guest). الهوية مطلوبة عند تسجيل الدخول، والعنوان الوطني الكامل يدخل الفاتورة */
export default function GuestFormModal({
  guest,
  customers,
  onClose,
  onSaved,
}: {
  guest: HotelGuest | null;
  customers: Option[];
  onClose: () => void;
  onSaved: (guest: HotelGuest) => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<Form>(() => toForm(guest));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (key: keyof Form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (form.fullName.trim().length < 2) { setError(t("اسم النزيل مطلوب (حرفان على الأقل)")); return; }
    if (form.idNumber.trim() && !form.idType) { setError(t("اختر نوع الهوية")); return; }
    if (form.buildingNumber.trim() && !/^\d{4}$/.test(form.buildingNumber.trim())) { setError(t("رقم المبنى 4 أرقام")); return; }
    if (form.postalCode.trim() && !/^\d{5}$/.test(form.postalCode.trim())) { setError(t("الرمز البريدي 5 أرقام")); return; }
    setBusy(true);
    setError("");
    const payload = {
      full_name: form.fullName.trim(), phone: form.phone.trim() || null, email: form.email.trim() || null,
      nationality: form.nationality.trim() || null, id_type: form.idType || null, id_number: form.idNumber.trim() || null,
      building_number: form.buildingNumber.trim() || null, street: form.street.trim() || null, district: form.district.trim() || null,
      city: form.city.trim() || null, postal_code: form.postalCode.trim() || null, customer_id: form.customerId || null,
      notes: form.notes.trim() || null,
    };
    const { data, error: saveError } = await supabase.rpc("hotel_save_guest", { p_id: guest?.id ?? null, p: payload });
    if (saveError) {
      setBusy(false);
      setError(hotelErrorText(saveError.message, t));
      return;
    }
    const { data: row } = await supabase.from("hotel_guests").select("*").eq("id", String(data)).maybeSingle();
    setBusy(false);
    onSaved(row ? mapGuest(row as Record<string, unknown>) : { ...toGuest(String(data), form) });
  };

  return (
    <HotelModal
      title={guest ? "تعديل بيانات النزيل" : "نزيل جديد"}
      onClose={onClose}
      busy={busy}
      wide
      footer={
        <>
          <HotelButton variant="outline" onClick={onClose} disabled={busy}>{t("إلغاء")}</HotelButton>
          <HotelButton onClick={() => void save()} busy={busy}>{t("حفظ النزيل")}</HotelButton>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorNote message={error} />
        <div className="grid gap-3 md:grid-cols-3">
          <label className={`${hotelLabel} md:col-span-2`}>{t("الاسم الكامل")} *
            <input value={form.fullName} onChange={(e) => set("fullName")(e.target.value)} className={hotelInput} maxLength={200} autoFocus />
          </label>
          <label className={hotelLabel}>{t("الجوال")}
            <input value={form.phone} onChange={(e) => set("phone")(e.target.value)} className={`${hotelInput} text-left`} dir="ltr" placeholder="+966 5xxxxxxxx" maxLength={30} />
          </label>
          <label className={hotelLabel}>{t("الجنسية")}
            <input value={form.nationality} onChange={(e) => set("nationality")(e.target.value)} className={hotelInput} maxLength={60} />
          </label>
          <label className={hotelLabel}>{t("نوع الهوية")}
            <select value={form.idType} onChange={(e) => set("idType")(e.target.value)} className={hotelSelect}>
              <option value="">{t("—")}</option>
              {ID_TYPES.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
            </select>
          </label>
          <label className={hotelLabel}>{t("رقم الهوية")}
            <input value={form.idNumber} onChange={(e) => set("idNumber")(e.target.value)} className={`${hotelInput} text-left font-mono`} dir="ltr" maxLength={50} />
          </label>
          <label className={hotelLabel}>{t("البريد الإلكتروني")}
            <input value={form.email} onChange={(e) => set("email")(e.target.value)} className={`${hotelInput} text-left`} dir="ltr" maxLength={200} />
          </label>
          {customers.length > 0 && (
            <label className={`${hotelLabel} md:col-span-2`}>{t("الشركة (عميل) — اختياري")}
              <select value={form.customerId} onChange={(e) => set("customerId")(e.target.value)} className={hotelSelect}>
                <option value="">{t("بدون")}</option>
                {customers.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          )}
        </div>
        <fieldset className="rounded-xl border border-slate-200 p-3">
          <legend className="px-1 text-xs font-semibold text-slate-600">{t("العنوان الوطني (للفاتورة، اختياري)")}</legend>
          <div className="grid gap-3 md:grid-cols-5">
            <label className={hotelLabel}>{t("رقم المبنى")}
              <input value={form.buildingNumber} onChange={(e) => set("buildingNumber")(e.target.value)} className={`${hotelInput} text-left font-mono`} dir="ltr" maxLength={4} inputMode="numeric" />
            </label>
            <label className={`${hotelLabel} md:col-span-2`}>{t("الشارع")}
              <input value={form.street} onChange={(e) => set("street")(e.target.value)} className={hotelInput} maxLength={150} />
            </label>
            <label className={`${hotelLabel} md:col-span-2`}>{t("الحي")}
              <input value={form.district} onChange={(e) => set("district")(e.target.value)} className={hotelInput} maxLength={150} />
            </label>
            <label className={`${hotelLabel} md:col-span-2`}>{t("المدينة")}
              <input value={form.city} onChange={(e) => set("city")(e.target.value)} className={hotelInput} maxLength={100} />
            </label>
            <label className={hotelLabel}>{t("الرمز البريدي")}
              <input value={form.postalCode} onChange={(e) => set("postalCode")(e.target.value)} className={`${hotelInput} text-left font-mono`} dir="ltr" maxLength={5} inputMode="numeric" />
            </label>
          </div>
        </fieldset>
        <label className={hotelLabel}>{t("ملاحظات")}
          <textarea value={form.notes} onChange={(e) => set("notes")(e.target.value)} className={`${hotelInput} h-20 py-2`} maxLength={1000} />
        </label>
      </div>
    </HotelModal>
  );
}

function toGuest(id: string, form: Form): HotelGuest {
  return {
    id, fullName: form.fullName.trim(), phone: form.phone.trim(), email: form.email.trim(), nationality: form.nationality.trim(),
    idType: form.idType, idNumber: form.idNumber.trim(), buildingNumber: form.buildingNumber.trim(), street: form.street.trim(),
    district: form.district.trim(), city: form.city.trim(), postalCode: form.postalCode.trim(), customerId: form.customerId,
    notes: form.notes.trim(), createdAt: "",
  };
}

/** قائمة العملاء لربط النزيل أو الحجز بشركة (فارغة لمن لا يملك صلاحية العملاء) */
export async function loadCustomerOptions(): Promise<Option[]> {
  const { data, error } = await supabase.from("customers").select("id, name, customer_number").order("name").limit(2000);
  if (error) return [];
  return ((data ?? []) as Array<{ id: string; name: string | null; customer_number: string | null }>).map((row) => ({
    value: String(row.id),
    label: `${row.name ?? ""}${row.customer_number ? ` (${row.customer_number})` : ""}`,
  }));
}
