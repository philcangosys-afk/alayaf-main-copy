import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, ChevronLeft, Eye, EyeOff, FileText, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { COMPANY_PROFILE } from "@/lib/companyProfile";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/i18n";
import { riyadhDateString } from "@/lib/utils";
import { dbErrorOr } from "@/lib/dbErrors";

export type DocumentTemplateId =
  | "invoice"
  | "quotation"
  | "credit_note"
  | "purchase_order"
  | "delivery_note";

type LanguageMode = "bilingual" | "ar" | "en";

type TemplateFieldSection = "party" | "document" | "table" | "summary" | "notes";

type TemplateField = {
  id: string;
  section: TemplateFieldSection;
  labelAr: string;
  labelEn: string;
  content: string;
  visible: boolean;
  custom?: boolean;
};

type TemplateSettings = {
  templateKey: DocumentTemplateId;
  displayName: string;
  languageMode: LanguageMode;
  primaryColor: string;
  textColor: string;
  showLogo: boolean;
  showQr: boolean;
  showBankDetails: boolean;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  fields: TemplateField[];
};

type TemplateDefinition = {
  id: DocumentTemplateId;
  titleAr: string;
  titleEn: string;
  numberLabelAr: string;
  numberLabelEn: string;
  number: string;
  partyAr: string;
  partyEn: string;
  hasAmounts: boolean;
};

const TEMPLATE_DEFINITIONS: TemplateDefinition[] = [
  { id: "invoice", titleAr: "فاتورة ضريبية", titleEn: "Tax Invoice", numberLabelAr: "رقم الفاتورة", numberLabelEn: "Invoice number", number: "INV-001", partyAr: "العميل", partyEn: "Customer", hasAmounts: true },
  { id: "quotation", titleAr: "عرض سعر", titleEn: "Quotation", numberLabelAr: "رقم عرض السعر", numberLabelEn: "Quote number", number: "QT-001", partyAr: "العميل", partyEn: "Customer", hasAmounts: true },
  { id: "credit_note", titleAr: "إشعار دائن", titleEn: "Tax Credit Note", numberLabelAr: "رقم الإشعار", numberLabelEn: "Credit note number", number: "CN-001", partyAr: "العميل", partyEn: "Customer", hasAmounts: true },
  { id: "purchase_order", titleAr: "أمر شراء", titleEn: "Purchase Order", numberLabelAr: "رقم أمر الشراء", numberLabelEn: "Purchase order number", number: "PO-001", partyAr: "المورد", partyEn: "Supplier", hasAmounts: true },
  { id: "delivery_note", titleAr: "إشعار تسليم", titleEn: "Delivery Note", numberLabelAr: "رقم إشعار التسليم", numberLabelEn: "Delivery note number", number: "DN-001", partyAr: "العميل", partyEn: "Customer", hasAmounts: false },
];

const defaultFields = (template: TemplateDefinition): TemplateField[] => [
  { id: "party", section: "party", labelAr: template.partyAr, labelEn: template.partyEn, content: "—", visible: true },
  { id: "address", section: "party", labelAr: "العنوان", labelEn: "Address", content: "—", visible: true },
  { id: "email", section: "party", labelAr: "البريد الإلكتروني", labelEn: "Email", content: "—", visible: true },
  { id: "phone", section: "party", labelAr: "رقم الهاتف", labelEn: "Phone number", content: "—", visible: true },
  { id: "number", section: "document", labelAr: template.numberLabelAr, labelEn: template.numberLabelEn, content: template.number, visible: true },
  { id: "date", section: "document", labelAr: "التاريخ", labelEn: "Date", content: riyadhDateString(), visible: true },
  { id: "reference", section: "document", labelAr: "المرجع", labelEn: "Reference", content: "—", visible: true },
  { id: "currency", section: "document", labelAr: "العملة", labelEn: "Currency", content: "SAR", visible: template.hasAmounts },
  { id: "description", section: "table", labelAr: "الوصف", labelEn: "Description", content: "—", visible: true },
  { id: "quantity", section: "table", labelAr: "الكمية", labelEn: "Quantity", content: "—", visible: true },
  { id: "price", section: "table", labelAr: "السعر", labelEn: "Price", content: "—", visible: template.hasAmounts },
  { id: "tax", section: "table", labelAr: "الضريبة", labelEn: "Tax", content: "15%", visible: template.hasAmounts },
  { id: "total", section: "table", labelAr: "الإجمالي", labelEn: "Total", content: "—", visible: template.hasAmounts },
  { id: "notes", section: "notes", labelAr: "ملاحظات", labelEn: "Notes", content: "", visible: true },
  { id: "subtotal", section: "summary", labelAr: "المجموع الفرعي", labelEn: "Subtotal", content: "— SAR", visible: template.hasAmounts },
  { id: "vat_total", section: "summary", labelAr: "إجمالي ضريبة القيمة المضافة", labelEn: "VAT total", content: "— SAR", visible: template.hasAmounts },
  { id: "grand_total", section: "summary", labelAr: "الإجمالي شامل الضريبة", labelEn: "Total including VAT", content: "— SAR", visible: template.hasAmounts },
];

const DEFAULT_SETTINGS: Record<DocumentTemplateId, TemplateSettings> = Object.fromEntries(
  TEMPLATE_DEFINITIONS.map((template) => [
    template.id,
    {
      templateKey: template.id,
      displayName: template.titleAr,
      languageMode: "bilingual",
      primaryColor: "#004e89",
      textColor: "#111827",
      showLogo: true,
      showQr: template.id === "invoice" || template.id === "credit_note",
      showBankDetails: template.hasAmounts,
      marginTop: 10,
      marginRight: 10,
      marginBottom: 10,
      marginLeft: 10,
      fields: defaultFields(template),
    },
  ]),
) as Record<DocumentTemplateId, TemplateSettings>;

const fromRow = (row: Record<string, unknown>): TemplateSettings => {
  const templateKey = String(row.template_key) as DocumentTemplateId;
  const defaults = DEFAULT_SETTINGS[templateKey];
  const savedFields = Array.isArray(row.fields) ? row.fields as TemplateField[] : [];
  const defaultsById = new Map(defaults.fields.map((field) => [field.id, field]));
  // الترتيب المحفوظ أولًا (مع دمج الحقل الافتراضي بنسخته المحفوظة)، ثم الحقول الافتراضية غير الموجودة في المحفوظ بترتيبها الافتراضي.
  const seenIds = new Set<string>();
  const orderedSaved: TemplateField[] = [];
  savedFields.forEach((field) => {
    if (!field || typeof field.id !== "string" || seenIds.has(field.id)) return;
    const base = defaultsById.get(field.id);
    if (!base && !field.custom) return;
    seenIds.add(field.id);
    orderedSaved.push(base ? { ...base, ...field } : field);
  });
  const fields = [
    ...orderedSaved,
    ...defaults.fields.filter((field) => !seenIds.has(field.id)),
  ];

  return {
    templateKey,
    displayName: String(row.display_name ?? ""),
    languageMode: String(row.language_mode ?? "bilingual") as LanguageMode,
    primaryColor: String(row.primary_color ?? "#004e89"),
    textColor: String(row.text_color ?? "#111827"),
    showLogo: Boolean(row.show_logo),
    showQr: Boolean(row.show_qr),
    showBankDetails: Boolean(row.show_bank_details),
    marginTop: Number(row.margin_top ?? 10),
    marginRight: Number(row.margin_right ?? 10),
    marginBottom: Number(row.margin_bottom ?? 10),
    marginLeft: Number(row.margin_left ?? 10),
    fields,
  };
};

function MiniatureDocument({ definition, settings }: { definition: TemplateDefinition; settings: TemplateSettings }) {
  return (
    <div className="aspect-[0.72] w-full overflow-hidden rounded-sm border border-gray-200 bg-white p-2 shadow-sm">
      <div className="flex items-start justify-between border-b pb-1" style={{ borderColor: settings.primaryColor }}>
        <div className="space-y-1">
          <div className="h-1.5 w-14 rounded" style={{ backgroundColor: settings.primaryColor }} />
          <div className="h-1 w-10 rounded bg-gray-300" />
        </div>
        {settings.showLogo && <img src={COMPANY_PROFILE.logoUrl} alt="" className="h-5 w-10 object-contain" />}
      </div>
      <p className="my-2 text-center text-[7px] font-bold" style={{ color: settings.primaryColor }}>{definition.titleEn} / {definition.titleAr}</p>
      <div className="space-y-1 border-y py-1">
        {[68, 88, 55].map((width) => <div key={width} className="h-1 rounded bg-gray-200" style={{ width: `${width}%` }} />)}
      </div>
      <div className="mt-2 grid grid-cols-4 gap-px border bg-gray-200">
        {Array.from({ length: 16 }).map((_, index) => <div key={index} className={`${index < 4 ? "h-2" : "h-4"} bg-white`} />)}
      </div>
      <div className="mt-2 ms-auto w-2/3 space-y-1">
        {[80, 65, 90].map((width) => <div key={width} className="h-1 rounded bg-gray-200" style={{ width: `${width}%` }} />)}
      </div>
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1.5 text-sm text-gray-700">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-[#004e89]" />
    </label>
  );
}

export default function DocumentTemplateWorkspace() {
  const { t, direction } = useI18n();
  const [selectedId, setSelectedId] = useState<DocumentTemplateId>("invoice");
  const [settingsById, setSettingsById] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const definition = TEMPLATE_DEFINITIONS.find((item) => item.id === selectedId) ?? TEMPLATE_DEFINITIONS[0];
  const settings = settingsById[selectedId];

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data, error } = await supabase.from("document_template_settings").select("*");
      if (!active) return;
      if (error) {
        toast.error(t("تعذر تحميل إعدادات القوالب"));
      } else if (data) {
        setSettingsById((previous) => {
          const next = { ...previous };
          data.forEach((row) => {
            const mapped = fromRow(row as Record<string, unknown>);
            if (mapped.templateKey in next) next[mapped.templateKey] = mapped;
          });
          return next;
        });
      }
      setLoading(false);
    };
    void load();
    return () => { active = false; };
  }, [t]);

  const updateSettings = (patch: Partial<TemplateSettings>) => {
    setSettingsById((previous) => ({
      ...previous,
      [selectedId]: { ...previous[selectedId], ...patch },
    }));
  };

  const updateField = (id: string, patch: Partial<TemplateField>) => {
    updateSettings({ fields: settings.fields.map((field) => field.id === id ? { ...field, ...patch } : field) });
  };

  const addField = () => {
    updateSettings({
      fields: [
        ...settings.fields,
        {
          id: `custom_${crypto.randomUUID()}`,
          section: "party",
          labelAr: "حقل جديد",
          labelEn: "New field",
          content: "—",
          visible: true,
          custom: true,
        },
      ],
    });
  };

  const removeField = (id: string) => {
    updateSettings({ fields: settings.fields.filter((field) => field.id !== id) });
  };

  const moveField = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= settings.fields.length) return;
    const fields = [...settings.fields];
    [fields[index], fields[target]] = [fields[target], fields[index]];
    updateSettings({ fields });
  };

  const labelFor = (field: TemplateField) => {
    if (settings.languageMode === "en") return field.labelEn;
    if (settings.languageMode === "ar") return field.labelAr;
    return `${field.labelEn} / ${field.labelAr}`;
  };

  const visibleFields = (section: TemplateFieldSection) => settings.fields.filter((field) => field.section === section && field.visible);

  const saveSettings = async () => {
    setSaving(true);
    const { data: authData } = await supabase.auth.getUser();
    const { error } = await supabase.from("document_template_settings").upsert({
      template_key: settings.templateKey,
      display_name: settings.displayName,
      language_mode: settings.languageMode,
      primary_color: settings.primaryColor,
      text_color: settings.textColor,
      show_logo: settings.showLogo,
      show_qr: settings.showQr,
      show_bank_details: settings.showBankDetails,
      margin_top: settings.marginTop,
      margin_right: settings.marginRight,
      margin_bottom: settings.marginBottom,
      margin_left: settings.marginLeft,
      fields: settings.fields,
      updated_by: authData.user?.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "company_id,template_key" });
    setSaving(false);
    if (error) {
      toast.error(`${t("تعذر حفظ القالب")}: ${t(dbErrorOr(error.message))}`);
      return;
    }
    toast.success(t("تم حفظ القالب"));
  };

  const title = useMemo(() => {
    if (settings.languageMode === "ar") return definition.titleAr;
    if (settings.languageMode === "en") return definition.titleEn;
    return `${definition.titleEn}  ${definition.titleAr}`;
  }, [definition, settings.languageMode]);

  if (loading) {
    return <div className="flex min-h-80 items-center justify-center rounded-2xl border bg-white"><Loader2 className="h-7 w-7 animate-spin text-blue-700" /></div>;
  }

  return (
    <div className="space-y-6" dir={direction}>
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">{t("قوالب المستندات")}</h2>
            <p className="mt-1 text-sm text-gray-500">{t("اختر المستند لتخصيص تصميمه وبياناته")}</p>
            <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{t("تنبيه: القوالب تُحفظ للمعاينة فقط ولا تُطبق بعد على المستندات المطبوعة. الفاتورة الضريبية تُطبع دائمًا بالنموذج المعتمد لهيئة الزكاة والضريبة.")}</p>
          </div>
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">{t("بيانات الشركة معتمدة")}</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {TEMPLATE_DEFINITIONS.map((item) => {
            const active = item.id === selectedId;
            return (
              <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={`group rounded-xl border p-3 text-start transition ${active ? "border-blue-600 bg-blue-50 shadow-md" : "border-gray-200 hover:border-blue-300 hover:shadow"}`}>
                <MiniatureDocument definition={item} settings={settingsById[item.id]} />
                <div className="mt-3 flex items-center justify-between gap-2">
                  <div><p className="text-sm font-bold text-gray-900">{t(item.titleAr)}</p><p className="text-xs text-gray-500">{item.titleEn}</p></div>
                  {active ? <span className="grid h-6 w-6 place-items-center rounded-full bg-blue-600 text-white"><Check className="h-3.5 w-3.5" /></span> : <ChevronLeft className="h-4 w-4 text-gray-400" />}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[410px_minmax(620px,1fr)]">
        <aside className="rounded-2xl border border-gray-200 bg-white shadow-sm xl:sticky xl:top-4">
          <div className="border-b border-gray-100 p-4">
            <div className="flex items-center gap-2"><FileText className="h-5 w-5 text-blue-700" /><h3 className="font-bold text-gray-900">{t("تخصيص القالب")}</h3></div>
            <p className="mt-1 text-xs text-gray-500">{t(definition.titleAr)}</p>
          </div>
          <div className="space-y-4 p-4">
            <label className="block space-y-1.5 text-sm font-medium text-gray-700"><span>{t("اسم القالب")}</span><input value={settings.displayName} onChange={(event) => updateSettings({ displayName: event.target.value })} className="h-10 w-full rounded-lg border border-gray-300 px-3 outline-none focus:border-blue-600" /></label>
            <div className="space-y-1.5"><span className="text-sm font-medium text-gray-700">{t("لغة المستند")}</span><div className="grid grid-cols-3 gap-1 rounded-lg bg-gray-100 p-1">{(["bilingual", "ar", "en"] as LanguageMode[]).map((mode) => <button key={mode} type="button" onClick={() => updateSettings({ languageMode: mode })} className={`rounded-md px-2 py-2 text-xs font-semibold ${settings.languageMode === mode ? "bg-white text-blue-700 shadow-sm" : "text-gray-500"}`}>{mode === "bilingual" ? t("ثنائي اللغة") : mode === "ar" ? t("عربي") : "English"}</button>)}</div></div>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1.5 text-xs font-medium text-gray-600"><span>{t("اللون الرئيسي")}</span><input type="color" value={settings.primaryColor} onChange={(event) => updateSettings({ primaryColor: event.target.value })} className="h-10 w-full cursor-pointer rounded-lg border bg-white p-1" /></label>
              <label className="space-y-1.5 text-xs font-medium text-gray-600"><span>{t("لون النص")}</span><input type="color" value={settings.textColor} onChange={(event) => updateSettings({ textColor: event.target.value })} className="h-10 w-full cursor-pointer rounded-lg border bg-white p-1" /></label>
            </div>
            <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
              <ToggleRow label={t("إظهار شعار الشركة")} checked={settings.showLogo} onChange={(showLogo) => updateSettings({ showLogo })} />
              <ToggleRow label={t("إظهار رمز QR")} checked={settings.showQr} onChange={(showQr) => updateSettings({ showQr })} />
              <ToggleRow label={t("إظهار البيانات البنكية")} checked={settings.showBankDetails} onChange={(showBankDetails) => updateSettings({ showBankDetails })} />
            </div>
            <div className="space-y-2"><span className="text-sm font-medium text-gray-700">{t("الهوامش")}</span><div className="grid grid-cols-4 gap-2">{(["Top", "Right", "Bottom", "Left"] as const).map((side) => { const key = `margin${side}` as "marginTop" | "marginRight" | "marginBottom" | "marginLeft"; return <label key={side} className="text-center text-[10px] text-gray-500"><span>{t(side === "Top" ? "أعلى" : side === "Right" ? "يمين" : side === "Bottom" ? "أسفل" : "يسار")}</span><input type="number" min={0} max={40} value={settings[key]} onChange={(event) => updateSettings({ [key]: Number(event.target.value) })} className="mt-1 h-9 w-full rounded-md border px-1 text-center text-xs" /></label>; })}</div></div>

            <div className="border-t pt-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div><h4 className="text-sm font-bold text-gray-800">{t("حقول المستند")}</h4><p className="text-[11px] text-gray-500">{t("عدّل النص أو أخفِ الحقل أو غيّر ترتيبه")}</p></div>
                <button type="button" onClick={addField} className="flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100"><Plus className="h-3.5 w-3.5" />{t("إضافة حقل")}</button>
              </div>
              <div className="max-h-[540px] space-y-2 overflow-y-auto pe-1">
                {settings.fields.map((field, index) => (
                  <details key={field.id} className={`group rounded-lg border ${field.visible ? "border-gray-200 bg-white" : "border-gray-100 bg-gray-50 opacity-75"}`}>
                    <summary className="flex cursor-pointer list-none items-center gap-2 p-2.5">
                      <button type="button" title={field.visible ? t("إخفاء الحقل") : t("إظهار الحقل")} onClick={(event) => { event.preventDefault(); updateField(field.id, { visible: !field.visible }); }} className="rounded p-1 text-gray-500 hover:bg-gray-100">{field.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}</button>
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-700">{labelFor(field)}</span>
                      <span className="text-[10px] text-gray-400">{t(field.section === "party" ? "بيانات الطرف" : field.section === "document" ? "بيانات المستند" : field.section === "table" ? "جدول الأصناف" : field.section === "summary" ? "الإجماليات" : "الملاحظات")}</span>
                    </summary>
                    <div className="space-y-2 border-t p-3">
                      <div className="grid grid-cols-2 gap-2">
                        <label className="text-[10px] text-gray-500">{t("التسمية العربية")}<input value={field.labelAr} onChange={(event) => updateField(field.id, { labelAr: event.target.value })} className="mt-1 h-8 w-full rounded border px-2 text-xs text-gray-800" /></label>
                        <label className="text-[10px] text-gray-500">{t("التسمية الإنجليزية")}<input dir="ltr" value={field.labelEn} onChange={(event) => updateField(field.id, { labelEn: event.target.value })} className="mt-1 h-8 w-full rounded border px-2 text-xs text-gray-800" /></label>
                      </div>
                      <label className="block text-[10px] text-gray-500">{t("المحتوى الافتراضي")}<input value={field.content} onChange={(event) => updateField(field.id, { content: event.target.value })} className="mt-1 h-8 w-full rounded border px-2 text-xs text-gray-800" /></label>
                      {field.custom && <label className="block text-[10px] text-gray-500">{t("موضع الحقل")}<select value={field.section} onChange={(event) => updateField(field.id, { section: event.target.value as TemplateFieldSection })} className="mt-1 h-8 w-full rounded border px-2 text-xs text-gray-800"><option value="party">{t("بيانات الطرف")}</option><option value="document">{t("بيانات المستند")}</option><option value="notes">{t("الملاحظات")}</option></select></label>}
                      <div className="flex items-center justify-end gap-1">
                        <button type="button" title={t("تحريك لأعلى")} disabled={index === 0} onClick={() => moveField(index, -1)} className="rounded border p-1.5 text-gray-500 hover:bg-gray-50 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                        <button type="button" title={t("تحريك لأسفل")} disabled={index === settings.fields.length - 1} onClick={() => moveField(index, 1)} className="rounded border p-1.5 text-gray-500 hover:bg-gray-50 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                        {field.custom && <button type="button" title={t("حذف الحقل")} onClick={() => removeField(field.id)} className="rounded border border-red-100 p-1.5 text-red-600 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /></button>}
                      </div>
                    </div>
                  </details>
                ))}
              </div>
            </div>

            <button type="button" onClick={() => void saveSettings()} disabled={saving || !settings.displayName.trim()} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#004e89] font-bold text-white hover:bg-[#003d6d] disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving ? t("جاري الحفظ...") : t("حفظ القالب")}</button>
          </div>
        </aside>

        <div className="overflow-auto rounded-2xl border border-gray-200 bg-slate-100 p-4 shadow-inner sm:p-8">
          <div className="mx-auto min-h-[842px] w-[595px] origin-top bg-white shadow-xl" style={{ color: settings.textColor, paddingTop: `${settings.marginTop}mm`, paddingRight: `${settings.marginRight}mm`, paddingBottom: `${settings.marginBottom}mm`, paddingLeft: `${settings.marginLeft}mm` }}>
            <header className="grid grid-cols-[1fr_auto_1fr] items-start gap-5 border-b-2 pb-4" style={{ borderColor: settings.primaryColor }}>
              <div dir="ltr" className="text-left text-[10px] leading-relaxed"><strong className="block text-sm">{COMPANY_PROFILE.companyNameEn}</strong><span>{COMPANY_PROFILE.addressEn}</span><span className="block">VAT: {COMPANY_PROFILE.vatNumber}</span><span className="block">CR: {COMPANY_PROFILE.commercialRegistration}</span></div>
              {settings.showLogo ? <img src={COMPANY_PROFILE.logoUrl} alt={COMPANY_PROFILE.companyNameAr} className="h-14 w-28 object-contain" /> : <div className="w-20" />}
              <div dir="rtl" className="text-right text-[10px] leading-relaxed"><strong className="block text-sm">{COMPANY_PROFILE.companyNameAr}</strong><span>{COMPANY_PROFILE.addressAr}</span><span className="block">الرقم الضريبي: {COMPANY_PROFILE.vatNumber}</span><span className="block">السجل التجاري: {COMPANY_PROFILE.commercialRegistration}</span></div>
            </header>

            <h1 className="my-5 text-center text-xl font-black" style={{ color: settings.primaryColor }}>{title}</h1>
            <section className="grid grid-cols-2 border text-[10px]">
              <div className="space-y-1.5 border-e p-3">{visibleFields("party").map((field) => <p key={field.id}><strong>{labelFor(field)}:</strong> {field.content}</p>)}</div>
              <div className="space-y-1.5 p-3">{visibleFields("document").map((field) => <p key={field.id}><strong>{labelFor(field)}:</strong> {field.content}</p>)}</div>
            </section>

            {visibleFields("table").length > 0 && <table className="mt-5 w-full border-collapse text-[9px]">
              <thead><tr style={{ backgroundColor: settings.primaryColor, color: "white" }}><th className="border p-2">#</th>{visibleFields("table").map((field) => <th key={field.id} className="border p-2">{labelFor(field)}</th>)}</tr></thead>
              <tbody>{[1, 2, 3].map((row) => <tr key={row}><td className="border p-3 text-center">{row}</td>{visibleFields("table").map((field) => <td key={field.id} className="border p-3 text-center">{field.content}</td>)}</tr>)}</tbody>
            </table>}

            <div className="mt-5 grid grid-cols-2 gap-8 text-[10px]">
              <div>{settings.showQr && <div className="grid h-20 w-20 grid-cols-5 gap-0.5 border p-1" aria-label={t("موضع رمز QR")}>{Array.from({ length: 25 }).map((_, index) => <span key={index} className={(index * 7 + 3) % 5 < 2 ? "bg-gray-900" : "bg-white"} />)}</div>}{visibleFields("notes").map((field) => <div key={field.id}><p className="mt-4 font-bold">{labelFor(field)}</p><div className="mt-1 min-h-12 border-b border-dashed">{field.content}</div></div>)}</div>
              {visibleFields("summary").length > 0 && <div className="space-y-2">{visibleFields("summary").map((field, index, fields) => <div key={field.id} className={`flex justify-between p-2 ${index === fields.length - 1 ? "text-white" : "border-b pb-2"}`} style={index === fields.length - 1 ? { backgroundColor: settings.primaryColor } : undefined}><span>{labelFor(field)}</span><strong>{field.content}</strong></div>)}</div>}
            </div>

            {settings.showBankDetails && definition.hasAmounts && <section className="mt-8 rounded border p-3 text-[9px]"><strong className="mb-2 block" style={{ color: settings.primaryColor }}>{t("البيانات البنكية")}</strong><div className="grid grid-cols-2 gap-2"><span>{COMPANY_PROFILE.bank.nameAr}</span><span dir="ltr">IBAN: {COMPANY_PROFILE.bank.iban}</span><span>{COMPANY_PROFILE.bank.beneficiaryAr}</span></div></section>}
            <footer className="mt-10 flex justify-between border-t pt-3 text-[8px] text-gray-400"><span>{COMPANY_PROFILE.programNameAr}</span><span>{COMPANY_PROFILE.companyNameEn}</span></footer>
          </div>
        </div>
      </div>
    </div>
  );
}
