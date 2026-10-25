import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { MonitorSmartphone, Save, Settings2, UserRound, X } from "lucide-react";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { addressComplete, nationalAddress } from "@/lib/hotel";
import { loadPosSettings, posErrorText, savePosSettings, type PosCustomer, type PosSettingsPayload } from "@/lib/pos";
import { ErrorNote, PosButton, PosCard, PosHeader, num, posInput, posLabel, posSelect } from "@/components/pos/PosUi";
import PosCustomerDialog from "@/components/pos/PosCustomerDialog";

type Form = {
  customerId: string; customerName: string;
  building: string; street: string; district: string; city: string; postal: string; address: string;
  shortage: string; surplus: string; maxDiscount: string; returnDays: string; footer: string;
};

/**
 * إعدادات نقاط البيع: العميل والعنوان الافتراضيان للفاتورة المبسطة، وحسابا العجز والزيادة (وفروقات التقريب)،
 * وحد الخصم لمن صلاحيته قراءة، ومدة المرتجع، وتذييل الإيصال. الحفظ يستبدل الإعدادات كلها.
 */
export default function PosSettings() {
  const { t, direction } = useI18n();
  const [payload, setPayload] = useState<PosSettingsPayload | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);

  const apply = (p: PosSettingsPayload) => {
    setPayload(p);
    const s = p.settings;
    setForm({
      customerId: s.default_customer_id ?? "", customerName: s.default_customer_name ?? "",
      building: "", street: "", district: "", city: "", postal: "", address: s.default_address ?? "",
      shortage: s.shortage_account ?? "", surplus: s.surplus_account ?? "",
      maxDiscount: String(Number(s.max_discount_percent ?? 10)), returnDays: String(s.return_days ?? 0), footer: s.receipt_footer ?? "",
    });
  };

  useEffect(() => {
    (async () => {
      const result = await loadPosSettings();
      if (result.error || !result.data) { setError(posErrorText(result.error ?? "", t)); return; }
      apply(result.data);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const expenses = useMemo(() => (payload?.accounts ?? []).filter((a) => a.code.startsWith("5")), [payload]);
  const revenues = useMemo(() => (payload?.accounts ?? []).filter((a) => a.code.startsWith("4")), [payload]);

  if (!payload || !form) {
    return (
      <Layout>
        <main dir={direction} className="space-y-4">
          <ErrorNote message={error} />
          {!error && <div className="rounded-xl border bg-white p-10 text-center text-slate-500">{t("جاري التحميل...")}</div>}
        </main>
      </Layout>
    );
  }

  const canManage = payload.can_manage;
  const s = payload.settings;
  const set = (key: keyof Form) => (value: string) => setForm((f) => (f ? { ...f, [key]: value } : f));
  const composed = nationalAddress({ buildingNumber: form.building, street: form.street, district: form.district, city: form.city, postalCode: form.postal });
  const partsTouched = [form.building, form.street, form.district, form.city, form.postal].some((v) => v.trim());
  const address = partsTouched ? composed : form.address.trim();

  const save = async () => {
    setError("");
    if (partsTouched && !composed) { setError(t("أكمل أجزاء العنوان الوطني الخمسة أو امسحها")); return; }
    if (address && !addressComplete(address)) { setError(t("العنوان الوطني ناقص: رقم المبنى (4 أرقام) والشارع والحي والمدينة والرمز البريدي (5 أرقام)")); return; }
    const max = Number(form.maxDiscount);
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(form.maxDiscount.trim()) || max > 100) { setError(t("حد الخصم نسبة من 0 إلى 100")); return; }
    if (!/^\d{1,4}$/.test(form.returnDays.trim()) || Number(form.returnDays) > 3650) { setError(t("مدة المرتجع بالأيام من 0 إلى 3650")); return; }
    if (form.footer.length > 300) { setError(t("تذييل الإيصال 300 حرف على الأكثر")); return; }
    setBusy(true);
    const result = await savePosSettings({
      default_customer_id: form.customerId || null,
      default_address: address || null,
      shortage_account: form.shortage || null,
      surplus_account: form.surplus || null,
      max_discount_percent: max,
      return_days: Number(form.returnDays),
      receipt_footer: form.footer.trim() || null,
    });
    setBusy(false);
    if (result.error || !result.data) { setError(posErrorText(result.error ?? "", t)); return; }
    apply(result.data);
    toast({ title: t("حُفظت إعدادات نقاط البيع") });
  };

  const accountSelect = (label: string, key: "shortage" | "surplus", list: Array<{ code: string; name: string }>, effective: string | null, effectiveName: string | null) => (
    <label className={posLabel}>{t(label)}
      <select value={form[key]} onChange={(e) => set(key)(e.target.value)} className={posSelect} disabled={!canManage}>
        <option value="">{t("الافتراضي")}{effective && !form[key] ? ` (${effective} — ${effectiveName ?? ""})` : ""}</option>
        {list.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
        {form[key] && !list.some((a) => a.code === form[key]) ? <option value={form[key]}>{form[key]}</option> : null}
      </select>
    </label>
  );

  return (
    <Layout>
      <main dir={direction} className="space-y-5">
        <PosHeader icon={Settings2} title="إعدادات نقاط البيع"
          description="تسري على البيع والمرتجع والإغلاق من الآن؛ الفواتير والجلسات السابقة لا تتغير."
          actions={
            <>
              <Link to="/pos"><PosButton variant="outline"><MonitorSmartphone className="h-4 w-4" />{t("الأجهزة")}</PosButton></Link>
              {canManage && <PosButton onClick={() => void save()} busy={busy}><Save className="h-4 w-4" />{t("حفظ الإعدادات")}</PosButton>}
            </>
          } />
        <ErrorNote message={error} />
        {!canManage && <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">{t("للاطلاع فقط: التعديل لمن له إدارة أجهزة نقاط البيع.")}</p>}

        <div className="grid gap-5 lg:grid-cols-2">
          <PosCard title="الفاتورة المبسطة">
            <div className="space-y-4">
              <div>
                <span className={posLabel}>{t("العميل الافتراضي")}</span>
                <div className="mt-1 flex items-center gap-2">
                  <div className="flex h-10 flex-1 items-center gap-2 rounded-lg border bg-slate-50 px-3 text-sm">
                    <UserRound className="h-4 w-4 text-slate-400" />
                    {form.customerId ? form.customerName || form.customerId : t("«عميل نقدي» (يُنشأ تلقائيًا)")}
                  </div>
                  {canManage && <PosButton variant="outline" onClick={() => setPicking(true)}>{t("اختيار")}</PosButton>}
                  {canManage && form.customerId && (
                    <button type="button" onClick={() => setForm((f) => (f ? { ...f, customerId: "", customerName: "" } : f))} className="rounded p-2 text-slate-500 hover:bg-slate-100" aria-label={t("إزالة")}>
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <p className="mt-1 text-xs leading-5 text-slate-500">{t("عميل البيع حين لا يختار الكاشير عميلًا.")}</p>
              </div>
              <div>
                <span className={posLabel}>{t("العنوان الافتراضي للفاتورة المبسطة")}</span>
                {form.address && !partsTouched && (
                  <p className="mt-1 rounded-lg border bg-slate-50 px-3 py-2 text-sm">{form.address}</p>
                )}
                <div className="mt-2 grid gap-2 sm:grid-cols-5">
                  <input value={form.building} onChange={(e) => set("building")(e.target.value.replace(/\D/g, "").slice(0, 4))} className={cn(posInput, "mt-0 text-left", num)} dir="ltr" placeholder={t("رقم المبنى")} disabled={!canManage} />
                  <input value={form.street} onChange={(e) => set("street")(e.target.value)} maxLength={120} className={cn(posInput, "mt-0")} placeholder={t("الشارع")} disabled={!canManage} />
                  <input value={form.district} onChange={(e) => set("district")(e.target.value)} maxLength={120} className={cn(posInput, "mt-0")} placeholder={t("الحي")} disabled={!canManage} />
                  <input value={form.city} onChange={(e) => set("city")(e.target.value)} maxLength={80} className={cn(posInput, "mt-0")} placeholder={t("المدينة")} disabled={!canManage} />
                  <input value={form.postal} onChange={(e) => set("postal")(e.target.value.replace(/\D/g, "").slice(0, 5))} className={cn(posInput, "mt-0 text-left", num)} dir="ltr" placeholder={t("الرمز البريدي")} disabled={!canManage} />
                </div>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  {t("الفاتورة تحمل عنوان المشتري؛ للعميل النقدي ومن لا عنوان له يُستخدم هذا العنوان (عادةً عنوان المتجر). اكتب الأجزاء الخمسة لتغييره.")}
                </p>
                {canManage && form.address && !partsTouched && (
                  <button type="button" onClick={() => set("address")("")} className="mt-1 text-xs font-semibold text-red-700 hover:underline">{t("إزالة العنوان")}</button>
                )}
              </div>
            </div>
          </PosCard>

          <PosCard title="الحسابات عند الإغلاق والمرتجع">
            <div className="space-y-4">
              {accountSelect("حساب العجز (مصروف)", "shortage", expenses, s.effective_shortage_account, s.effective_shortage_name)}
              {accountSelect("حساب الزيادة وفروقات التقريب (إيراد)", "surplus", revenues, s.effective_surplus_account, s.effective_surplus_name)}
              <p className="text-xs leading-6 text-slate-500">
                {t("العجز: مدين حساب العجز / دائن حساب الجلسة. الزيادة: مدين حساب الجلسة / دائن حساب الزيادة. وهللات تقريب ضريبة المرتجعات عند اكتمال إرجاع الفاتورة تُقفل على حساب الزيادة.")}
              </p>
              <div className="grid gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600 sm:grid-cols-2">
                <div>{t("مجموعة صناديق الأجهزة")}: <b className={num}>{s.cash_group_code ?? t("تُنشأ مع أول صندوق")}</b></div>
                <div>{t("مجموعة عهد الموظفين")}: <b className={num}>{s.custody_group_code ?? t("تُنشأ مع أول عهدة")}</b></div>
              </div>
            </div>
          </PosCard>

          <PosCard title="الخصم والمرتجع">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={posLabel}>{t("حد الخصم لصلاحية القراءة (% من سعر البند)")}
                <input value={form.maxDiscount} onChange={(e) => set("maxDiscount")(e.target.value)} inputMode="decimal" className={cn(posInput, "text-left", num)} dir="ltr" disabled={!canManage} />
              </label>
              <label className={posLabel}>{t("مدة المرتجع بالأيام (0: بلا حد)")}
                <input value={form.returnDays} onChange={(e) => set("returnDays")(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className={cn(posInput, "text-left", num)} dir="ltr" disabled={!canManage} />
              </label>
            </div>
            <p className="mt-3 text-xs leading-6 text-slate-500">
              {t("صلاحية الخصم «قراءة» تخصم حتى هذا الحد من كل بند، و«إدارة» بلا حد، وبلا صلاحية لا خصم. ورد المرتجع بطريقة أكبر مما قُبض بها على الفاتورة يتطلب إدارة المرتجع.")}
            </p>
          </PosCard>

          <PosCard title="الإيصال">
            <label className={posLabel}>{t("تذييل الإيصال (يظهر أسفل الإيصال الحراري)")}
              <textarea value={form.footer} onChange={(e) => set("footer")(e.target.value)} maxLength={300} rows={3} className={cn(posInput, "h-auto py-2")} disabled={!canManage}
                placeholder={t("مثل: شكرًا لزيارتكم — الاستبدال خلال 7 أيام بالفاتورة")} />
            </label>
            <p className={cn("mt-1 text-end text-xs text-slate-400", num)}>{form.footer.length}/300</p>
          </PosCard>
        </div>

        {picking && (
          <PosCustomerDialog allowCreate={false} onClose={() => setPicking(false)}
            onSelect={(customer: PosCustomer | null) => {
              setForm((f) => (f ? { ...f, customerId: customer?.id ?? "", customerName: customer?.name ?? "" } : f));
              setPicking(false);
            }} />
        )}
      </main>
    </Layout>
  );
}
