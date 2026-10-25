import { useEffect, useState } from "react";
import { Search, UserPlus } from "lucide-react";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { posErrorText, quickPosCustomer, searchPosCustomers, type PosCustomer } from "@/lib/pos";
import { Code, ErrorNote, PosButton, PosModal, num, posInput, posLabel, useMoney } from "@/components/pos/PosUi";

type NewCustomer = {
  name: string; phone: string; email: string; tax_number: string; commercial_registration: string;
  building_number: string; street: string; district: string; city: string; postal_code: string;
};
const EMPTY: NewCustomer = {
  name: "", phone: "", email: "", tax_number: "", commercial_registration: "",
  building_number: "", street: "", district: "", city: "", postal_code: "",
};

/** اختيار عميل للطلب (بالاسم أو الجوال أو الرقم أو الرقم الضريبي) أو إضافة عميل جديد سريعًا */
export default function PosCustomerDialog({
  onClose,
  onSelect,
  allowCreate,
}: {
  onClose: () => void;
  onSelect: (customer: PosCustomer | null) => void;
  allowCreate: boolean;
}) {
  const { t } = useI18n();
  const money = useMoney();
  const [query, setQuery] = useState("");
  const [list, setList] = useState<PosCustomer[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<NewCustomer>(EMPTY);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (adding) return;
    setLoading(true);
    // نتيجة بحث قديم وصلت بعد الأحدث تُهمل
    let current = true;
    const handle = setTimeout(async () => {
      const result = await searchPosCustomers(query);
      if (!current) return;
      setLoading(false);
      if (result.error) { setError(posErrorText(result.error, t)); return; }
      setError("");
      setList(result.data ?? []);
    }, 250);
    return () => { current = false; clearTimeout(handle); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, adding]);

  const set = (key: keyof NewCustomer) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const create = async () => {
    if (form.name.trim().length < 2) { setError(t("اسم العميل مطلوب (حرفان على الأقل)")); return; }
    setBusy(true);
    setError("");
    const payload = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim() || null]));
    const result = await quickPosCustomer(payload);
    setBusy(false);
    if (result.error || !result.data) { setError(posErrorText(result.error ?? "", t)); return; }
    onSelect(result.data);
  };

  return (
    <PosModal
      title={adding ? "عميل جديد" : "اختيار العميل"}
      onClose={onClose}
      busy={busy}
      size="lg"
      footer={adding ? (
        <>
          <PosButton variant="outline" onClick={() => { setAdding(false); setError(""); }} disabled={busy}>{t("رجوع")}</PosButton>
          <PosButton onClick={create} busy={busy}>{t("إضافة واختيار")}</PosButton>
        </>
      ) : (
        <>
          <PosButton variant="outline" onClick={() => onSelect(null)}>{t("عميل نقدي")}</PosButton>
          {allowCreate && <PosButton variant="outline" onClick={() => { setAdding(true); setForm({ ...EMPTY, name: /\d{5,}/.test(query) ? "" : query, phone: /\d{5,}/.test(query) ? query : "" }); }}><UserPlus className="h-4 w-4" />{t("عميل جديد")}</PosButton>}
        </>
      )}
    >
      {adding ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={cn(posLabel, "sm:col-span-3")}>{t("الاسم")}
              <input value={form.name} onChange={(e) => set("name")(e.target.value)} maxLength={200} className={posInput} autoFocus />
            </label>
            <label className={posLabel}>{t("الجوال")}
              <input value={form.phone} onChange={(e) => set("phone")(e.target.value)} className={cn(posInput, "text-left", num)} dir="ltr" />
            </label>
            <label className={cn(posLabel, "sm:col-span-2")}>{t("البريد الإلكتروني")}
              <input value={form.email} onChange={(e) => set("email")(e.target.value)} className={cn(posInput, "text-left")} dir="ltr" />
            </label>
          </div>
          <button type="button" onClick={() => setMore((v) => !v)} className="text-sm font-semibold text-[#0f6b63] hover:underline">
            {t(more ? "إخفاء العنوان والبيانات الضريبية" : "العنوان الوطني والبيانات الضريبية (للفاتورة الضريبية)")}
          </button>
          {more && (
            <div className="grid gap-3 sm:grid-cols-3">
              <label className={posLabel}>{t("الرقم الضريبي")}
                <input value={form.tax_number} onChange={(e) => set("tax_number")(e.target.value.replace(/\D/g, "").slice(0, 15))} className={cn(posInput, "text-left", num)} dir="ltr" />
              </label>
              <label className={posLabel}>{t("السجل التجاري")}
                <input value={form.commercial_registration} onChange={(e) => set("commercial_registration")(e.target.value.replace(/\D/g, "").slice(0, 15))} className={cn(posInput, "text-left", num)} dir="ltr" />
              </label>
              <label className={posLabel}>{t("رقم المبنى")}
                <input value={form.building_number} onChange={(e) => set("building_number")(e.target.value.replace(/\D/g, "").slice(0, 4))} className={cn(posInput, "text-left", num)} dir="ltr" />
              </label>
              <label className={posLabel}>{t("الشارع")}
                <input value={form.street} onChange={(e) => set("street")(e.target.value)} maxLength={120} className={posInput} />
              </label>
              <label className={posLabel}>{t("الحي")}
                <input value={form.district} onChange={(e) => set("district")(e.target.value)} maxLength={120} className={posInput} />
              </label>
              <label className={posLabel}>{t("المدينة")}
                <input value={form.city} onChange={(e) => set("city")(e.target.value)} maxLength={80} className={posInput} />
              </label>
              <label className={posLabel}>{t("الرمز البريدي")}
                <input value={form.postal_code} onChange={(e) => set("postal_code")(e.target.value.replace(/\D/g, "").slice(0, 5))} className={cn(posInput, "text-left", num)} dir="ltr" />
              </label>
            </div>
          )}
          <ErrorNote message={error} />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} className={cn(posInput, "mt-0 ps-9")} placeholder={t("ابحث بالاسم أو الجوال أو الرقم أو الرقم الضريبي")} autoFocus />
          </div>
          <div className="max-h-[50vh] overflow-y-auto rounded-xl border">
            {loading && list.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">{t("جاري البحث...")}</p>
            ) : list.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">{t("لا نتائج")}</p>
            ) : list.map((c) => (
              <button key={c.id} type="button" onClick={() => onSelect(c)} className="flex w-full items-center justify-between gap-3 border-b px-4 py-3 text-start last:border-b-0 hover:bg-slate-50">
                <span>
                  <span className="block font-semibold text-slate-900">{c.name}</span>
                  <span className="block text-xs text-slate-500">
                    <Code>{c.customer_number}</Code>{c.phone ? <> — <Code>{c.phone}</Code></> : ""}{c.tax_registration_mode === "registered_sa" ? ` — ${t("مسجل ضريبيًا")}` : ""}
                  </span>
                </span>
                <span className="text-end text-xs">
                  <span className="block text-slate-500">{t("الرصيد")}</span>
                  <span className={cn("font-bold", num, c.balance > 0 ? "text-amber-700" : c.balance < 0 ? "text-emerald-700" : "text-slate-600")}>{money(c.balance)}</span>
                </span>
              </button>
            ))}
          </div>
          <ErrorNote message={error} />
        </div>
      )}
    </PosModal>
  );
}
