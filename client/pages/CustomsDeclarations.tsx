import Layout from "@/components/Layout";
import { purchasesFeatures } from "./Purchases";
import { ArrowRight, Plus, RotateCcw, Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n";
import { supabase } from "@/lib/supabaseClient";
import { riyadhDateString } from "@/lib/utils";
import { canManagePerm } from "@/lib/authSession";
import { useRolePermissions } from "@/hooks/useRolePermissions";

// البيان الجمركي: ضريبة الاستيراد المدفوعة في الجمارك (الخانة 8 في الإقرار) والرسوم الجمركية.
// القيد: مدين ضريبة المدخلات + مدين حساب التكلفة (الرسوم) / دائن البنك، أو الحساب الوسيط 2115 إذا دفعها المخلّص
// (ويُغلق 2115 بسطر "مدفوع نيابة عنا" في فاتورة المخلّص). يسجّله المحاسب، ولا يُعدَّل بعد الترحيل بل يُعكس.

const round2 = (value: number) => {
  const rounded = Math.round(Number((Math.abs(value) * 100).toFixed(6))) / 100;
  return value < 0 ? -rounded : rounded;
};

type Declaration = {
  id: string;
  number: string;
  date: string;
  invoiceId: string;
  description: string;
  customsValue: number;
  customsDuties: number;
  otherCharges: number;
  vatBase: number;
  exemptBase: number;
  importVat: number;
  route: "bank" | "agent";
  bankAccountCode: string;
  agentVendorId: string;
  status: "posted" | "reversed";
  reversedOn: string;
  reversalReason: string;
};

type Option = { code: string; label: string };

const errorText = (message: string, t: (key: string) => string) => {
  const map: [string, string][] = [
    ["ACCOUNTING_MANAGE_PERMISSION_REQUIRED", "تسجيل البيانات الجمركية يحتاج صلاحية إدارة المحاسبة"],
    ["CUSTOMS_IMPORTER_CONFIRMATION_REQUIRED", "أكّد أن البيان الجمركي باسم الشركة (المستورد)"],
    ["CUSTOMS_DECLARATION_NUMBER_REQUIRED", "أدخل رقم البيان الجمركي"],
    ["CUSTOMS_DECLARATION_DATE_INVALID", "تاريخ البيان لا يكون في المستقبل"],
    ["CUSTOMS_DECLARATION_AMOUNTS_INVALID", "القيمة الجمركية يجب أن تكون أكبر من صفر، والرسوم والضريبة غير سالبة"],
    ["CUSTOMS_IMPORT_VAT_INVALID", "ضريبة الاستيراد يجب أن تساوي 15% من الجزء الخاضع من الوعاء بفرق ريال واحد على الأكثر"],
    ["CUSTOMS_IMPORT_VAT_REQUIRED", "أدخل ضريبة الاستيراد، أو أكّد أن الاستيراد معفى"],
    ["CUSTOMS_DECLARATION_NOTHING_TO_POST", "لا ضريبة ولا رسوم في البيان"],
    ["CUSTOMS_DUTIES_ACCOUNT_INVALID", "اختر حساب التكلفة للرسوم الجمركية (مصروف أو بضاعة مستلمة غير مفوترة)"],
    ["CUSTOMS_BANK_ACCOUNT_INVALID", "اختر الحساب البنكي الذي دُفعت منه الجمارك"],
    ["CUSTOMS_AGENT_INVALID", "اختر المخلّص الجمركي من الموردين النشطين"],
    ["CUSTOMS_PAYMENT_ROUTE_INVALID", "اختر طريقة الدفع: من البنك أو عبر المخلّص"],
    ["CUSTOMS_LINKED_INVOICE_INVALID", "الفاتورة المرتبطة يجب أن تكون فاتورة بضاعة مستوردة مرحّلة"],
    ["CUSTOMS_DECLARATION_DUPLICATE", "رقم البيان الجمركي مسجل مسبقًا"],
    ["customs_declarations_number_uidx", "رقم البيان الجمركي مسجل مسبقًا"],
    ["CUSTOMS_REVERSAL_REASON_REQUIRED", "اكتب سبب العكس"],
    ["CUSTOMS_REVERSAL_DATE_INVALID", "تاريخ العكس لا يسبق تاريخ البيان ولا يكون في المستقبل"],
    ["CUSTOMS_DECLARATION_ALREADY_REVERSED", "البيان معكوس مسبقًا"],
    ["ACCOUNTING_FISCAL_PERIOD_CLOSED", "الفترة المحاسبية مقفلة"],
    ["ACCOUNTING_FISCAL_PERIOD_REQUIRED", "لا توجد فترة محاسبية لهذا التاريخ"],
  ];
  const hit = map.find(([code]) => message.includes(code));
  return hit ? t(hit[1]) : message;
};

const emptyForm = (today: string) => ({
  number: "",
  date: today,
  invoiceId: "",
  description: "",
  customsValue: "",
  customsDuties: "",
  otherCharges: "",
  exemptBase: "",
  importVat: "",
  exemptImport: false,
  dutiesAccountCode: "",
  route: "bank" as "bank" | "agent",
  bankAccountCode: "",
  agentVendorId: "",
  importerConfirmed: false,
});

export default function CustomsDeclarations() {
  const { t, direction, formatDate, formatNumber } = useI18n();
  const formatAmount = (value: number) => formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const { permissions } = useRolePermissions();
  // نفس فحص القاعدة (accounting_access_allowed للإدارة)
  const canPost = ["accounting.tax_reports", "accounting.accounts", "module.accounting"].some((key) => canManagePerm(permissions, key));
  const today = riyadhDateString();
  const [mode, setMode] = useState<"list" | "create">("list");
  const [rows, setRows] = useState<Declaration[]>([]);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [banks, setBanks] = useState<Option[]>([]);
  const [vendors, setVendors] = useState<Option[]>([]);
  const [importInvoices, setImportInvoices] = useState<Option[]>([]);
  const [costAccounts, setCostAccounts] = useState<Option[]>([]);
  const [form, setForm] = useState(() => emptyForm(today));
  const [saving, setSaving] = useState(false);
  const [reverseTarget, setReverseTarget] = useState<string | null>(null);
  const [reverseDate, setReverseDate] = useState(today);
  const [reverseReason, setReverseReason] = useState("");
  const inFlight = useRef(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const [declarationsResult, banksResult, vendorsResult, invoicesResult, accountsResult] = await Promise.all([
        supabase
          .from("customs_declarations")
          .select("id, declaration_number, declaration_date, purchase_invoice_id, description, customs_value, customs_duties, other_charges, vat_base, exempt_base, import_vat, payment_route, bank_account_code, agent_vendor_id, status, reversed_on, reversal_reason")
          .order("declaration_date", { ascending: false })
          .order("created_at", { ascending: false }),
        supabase.from("accounting_bank_accounts").select("account_code, name, account_kind").eq("active", true).order("name"),
        supabase.from("vendors").select("id, name, vendor_number").eq("status", "نشط").order("name"),
        supabase
          .from("purchase_invoices")
          .select("id, vendor, reference_no, date")
          .eq("import_treatment", "customs_goods")
          .eq("accounting_status", "posted")
          .order("date", { ascending: false }),
        supabase.rpc("list_purchase_item_accounts"),
      ]);
      if (!active) return;
      if (declarationsResult.error) {
        setLoadError(String(declarationsResult.error.message ?? ""));
        return;
      }
      setLoadError("");
      setRows(
        (declarationsResult.data ?? []).map((row: any) => ({
          id: String(row.id),
          number: String(row.declaration_number ?? ""),
          date: String(row.declaration_date ?? ""),
          invoiceId: String(row.purchase_invoice_id ?? ""),
          description: String(row.description ?? ""),
          customsValue: Number(row.customs_value) || 0,
          customsDuties: Number(row.customs_duties) || 0,
          otherCharges: Number(row.other_charges) || 0,
          vatBase: Number(row.vat_base) || 0,
          exemptBase: Number(row.exempt_base) || 0,
          importVat: Number(row.import_vat) || 0,
          route: row.payment_route === "agent" ? "agent" : "bank",
          bankAccountCode: String(row.bank_account_code ?? ""),
          agentVendorId: String(row.agent_vendor_id ?? ""),
          status: row.status === "reversed" ? "reversed" : "posted",
          reversedOn: String(row.reversed_on ?? ""),
          reversalReason: String(row.reversal_reason ?? ""),
        })),
      );
      setBanks((banksResult.data ?? []).map((row: any) => ({ code: String(row.account_code), label: `${row.account_code} - ${row.name}` })));
      setVendors((vendorsResult.data ?? []).map((row: any) => ({ code: String(row.id), label: `${row.vendor_number ? `${row.vendor_number} - ` : ""}${row.name}` })));
      setImportInvoices(
        (invoicesResult.data ?? []).map((row: any) => ({
          code: String(row.id),
          label: `${row.id} — ${row.vendor ?? ""}${row.reference_no ? ` — ${row.reference_no}` : ""}`,
        })),
      );
      setCostAccounts(
        ((accountsResult.data ?? []) as { code: string; name_ar: string }[])
          .filter((account) => account.code !== "2115")
          .map((account) => ({ code: String(account.code), label: `${account.code} - ${account.name_ar}` })),
      );
    };
    void load();
    return () => {
      active = false;
    };
  }, [reload]);

  const customsValue = round2(Number(form.customsValue) || 0);
  const customsDuties = round2(Number(form.customsDuties) || 0);
  const otherCharges = round2(Number(form.otherCharges) || 0);
  const vatBase = round2(customsValue + customsDuties + otherCharges);
  // بيان مختلط: جزء من الوعاء معفى؛ والاستيراد المعفى بالكامل يُؤكَّد بالخيار
  const exemptBase = form.exemptImport ? vatBase : Math.min(round2(Number(form.exemptBase) || 0), vatBase);
  const taxableBase = round2(vatBase - exemptBase);
  const importVat = form.exemptImport ? 0 : round2(Number(form.importVat) || 0);
  const suggestedVat = round2((taxableBase * 15) / 100);
  const vendorName = (id: string) => vendors.find((vendor) => vendor.code === id)?.label ?? id;

  const handleSave = async () => {
    if (inFlight.current || !canPost) return;
    if (!form.number.trim()) {
      toast({ title: t("أدخل رقم البيان الجمركي") });
      return;
    }
    if (!form.date || form.date > today) {
      toast({ title: t("تاريخ البيان لا يكون في المستقبل") });
      return;
    }
    if (!(customsValue > 0) || customsDuties < 0 || otherCharges < 0 || importVat < 0) {
      toast({ title: t("القيمة الجمركية يجب أن تكون أكبر من صفر، والرسوم والضريبة غير سالبة") });
      return;
    }
    // نفس قاعدة القاعدة: 15% من الجزء الخاضع بفرق ريال، أو صفر إذا كان الوعاء كله معفى
    if (Number(form.exemptBase) > vatBase) {
      toast({ title: t("القيمة الجمركية يجب أن تكون أكبر من صفر، والرسوم والضريبة غير سالبة") });
      return;
    }
    if (taxableBase > 0 && (importVat === 0 || Math.abs(importVat - suggestedVat) > 1)) {
      toast({ title: t(importVat === 0 ? "أدخل ضريبة الاستيراد، أو أكّد أن الاستيراد معفى" : "ضريبة الاستيراد يجب أن تساوي 15% من الجزء الخاضع من الوعاء بفرق ريال واحد على الأكثر") });
      return;
    }
    if (customsDuties + otherCharges > 0 && !form.dutiesAccountCode) {
      toast({ title: t("اختر حساب التكلفة للرسوم الجمركية (مصروف أو بضاعة مستلمة غير مفوترة)") });
      return;
    }
    if (form.route === "bank" ? !form.bankAccountCode : !form.agentVendorId) {
      toast({ title: t(form.route === "bank" ? "اختر الحساب البنكي الذي دُفعت منه الجمارك" : "اختر المخلّص الجمركي من الموردين النشطين") });
      return;
    }
    if (!form.importerConfirmed) {
      toast({ title: t("أكّد أن البيان الجمركي باسم الشركة (المستورد)") });
      return;
    }
    inFlight.current = true;
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("post_customs_declaration", {
        p_declaration: {
          declarationNumber: form.number.trim(),
          declarationDate: form.date,
          purchaseInvoiceId: form.invoiceId || null,
          description: form.description.trim(),
          customsValue,
          customsDuties,
          otherCharges,
          importVat,
          exemptImport: form.exemptImport,
          exemptBase: form.exemptImport ? 0 : exemptBase,
          dutiesAccountCode: customsDuties + otherCharges > 0 ? form.dutiesAccountCode : null,
          paymentRoute: form.route,
          bankAccountCode: form.route === "bank" ? form.bankAccountCode : null,
          agentVendorId: form.route === "agent" ? form.agentVendorId : null,
          importerConfirmed: form.importerConfirmed,
        },
      });
      if (error) {
        toast({ title: t("تعذّر تسجيل البيان"), description: errorText(String(error.message ?? ""), t), variant: "destructive" });
        return;
      }
      toast({ title: t("تم تسجيل البيان الجمركي"), description: String((data as { declaration_number?: string } | null)?.declaration_number ?? "") });
      setForm(emptyForm(today));
      setMode("list");
      setReload((value) => value + 1);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  const handleReverse = async () => {
    if (!reverseTarget || inFlight.current || !canPost) return;
    if (!reverseReason.trim()) {
      toast({ title: t("اكتب سبب العكس") });
      return;
    }
    inFlight.current = true;
    setSaving(true);
    try {
      const { error } = await supabase.rpc("reverse_customs_declaration", {
        p_declaration_id: reverseTarget,
        p_reversal_date: reverseDate,
        p_reason: reverseReason.trim(),
      });
      if (error) {
        toast({ title: t("تعذّر عكس البيان"), description: errorText(String(error.message ?? ""), t), variant: "destructive" });
        setReload((value) => value + 1);
        return;
      }
      toast({ title: t("تم عكس البيان الجمركي") });
      setReverseTarget(null);
      setReverseReason("");
      setReload((value) => value + 1);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  const inputClass = "h-10 w-full rounded-md border border-border bg-background px-3 text-sm";

  return (
    <Layout subMenu={{ title: t("المشتريات"), items: purchasesFeatures }}>
      {/* المحاسب قد يملك قراءة المشتريات فقط؛ التسجيل والعكس بصلاحية المحاسبة (والقاعدة تفرضها) */}
      <div dir={direction} className="mx-auto max-w-7xl space-y-6" data-readonly-exempt={canPost ? "true" : undefined}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-foreground">{t("البيانات الجمركية")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("ضريبة الاستيراد المدفوعة في الجمارك (الخانة 8) والرسوم الجمركية؛ يسجّلها المحاسب ولا تُعدَّل بعد الترحيل بل تُعكس.")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {mode === "list" ? (
              canPost && (
                <button
                  onClick={() => { setForm(emptyForm(today)); setMode("create"); }}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white"
                >
                  <Plus className="h-4 w-4" />
                  {t("بيان جمركي جديد")}
                </button>
              )
            ) : (
              <>
                <button
                  onClick={() => setMode("list")}
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium"
                >
                  <ArrowRight className={`h-4 w-4 ${direction === "ltr" ? "rotate-180" : ""}`} />
                  {t("الرجوع إلى البيانات")}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  <Save className="h-4 w-4" />
                  {t("تسجيل البيان وترحيله")}
                </button>
              </>
            )}
          </div>
        </div>

        {loadError && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{loadError}</p>}

        {mode === "list" ? (
          <div className="space-y-4 rounded-xl border border-border bg-card p-4">
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("لا توجد بيانات جمركية مسجلة.")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className={`w-full min-w-[960px] text-sm ${direction === "rtl" ? "text-right" : "text-left"}`}>
                  <thead>
                    <tr className="bg-muted/40">
                      <th className="px-3 py-2">{t("رقم البيان")}</th>
                      <th className="px-3 py-2">{t("التاريخ")}</th>
                      <th className="px-3 py-2">{t("القيمة الجمركية")}</th>
                      <th className="px-3 py-2">{t("الرسوم الجمركية")}</th>
                      <th className="px-3 py-2">{t("ضريبة الاستيراد")}</th>
                      <th className="px-3 py-2">{t("الدفع")}</th>
                      <th className="px-3 py-2">{t("الفاتورة المرتبطة")}</th>
                      <th className="px-3 py-2">{t("الحالة")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className="border-t border-border align-top">
                        <td className="px-3 py-2 font-semibold text-primary">
                          {row.number}
                          {row.description && <div className="text-xs font-normal text-muted-foreground">{row.description}</div>}
                        </td>
                        <td className="px-3 py-2">{row.date ? formatDate(row.date) : "-"}</td>
                        <td className="px-3 py-2">{formatAmount(row.customsValue)}</td>
                        <td className="px-3 py-2">
                          {formatAmount(row.customsDuties)}
                          {row.otherCharges > 0 && <div className="text-xs text-muted-foreground">+ {t("رسوم أخرى")} {formatAmount(row.otherCharges)}</div>}
                        </td>
                        <td className="px-3 py-2 font-semibold">
                          {formatAmount(row.importVat)}
                          {row.exemptBase > 0 && <div className="text-xs font-normal text-muted-foreground">{t("معفى من الوعاء")} {formatAmount(row.exemptBase)}</div>}
                        </td>
                        <td className="px-3 py-2">
                          {row.route === "bank" ? `${t("من البنك")} ${row.bankAccountCode}` : `${t("عبر المخلّص")}: ${vendorName(row.agentVendorId)}`}
                        </td>
                        <td className="px-3 py-2">{row.invoiceId || "-"}</td>
                        <td className="px-3 py-2">
                          {row.status === "reversed" ? (
                            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-bold text-slate-700" title={row.reversalReason}>
                              {t("معكوس")} {row.reversedOn ? formatDate(row.reversedOn) : ""}
                            </span>
                          ) : (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">{t("مرحّل")}</span>
                          )}
                          {canPost && row.status === "posted" && (
                            <button
                              onClick={() => { setReverseTarget(row.id); setReverseDate(today); setReverseReason(""); }}
                              className="ms-2 inline-flex items-center gap-1 rounded border border-red-300 px-2 py-0.5 text-xs text-red-700"
                            >
                              <RotateCcw className="h-3 w-3" /> {t("عكس")}
                            </button>
                          )}
                          {reverseTarget === row.id && row.status === "posted" && (
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <input
                                type="date"
                                value={reverseDate}
                                min={row.date || undefined}
                                max={today}
                                onChange={(e) => setReverseDate(e.target.value)}
                                className="h-8 rounded border border-border px-2 text-xs"
                              />
                              <input
                                value={reverseReason}
                                onChange={(e) => setReverseReason(e.target.value)}
                                placeholder={t("سبب العكس")}
                                className="h-8 rounded border border-border px-2 text-xs"
                              />
                              <button onClick={handleReverse} disabled={saving} className="rounded bg-red-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-60">
                                {t("تأكيد العكس")}
                              </button>
                              <button onClick={() => setReverseTarget(null)} className="rounded border border-border px-2 py-1 text-xs">
                                {t("تراجع")}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4 rounded-xl border border-border bg-card p-4">
            <div className="grid gap-4 md:grid-cols-3">
              <label className="space-y-1 text-sm">
                <span className="font-medium">{t("رقم البيان الجمركي")}*</span>
                <input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} className={inputClass} />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">{t("تاريخ البيان")}*</span>
                <input type="date" value={form.date} max={today} onChange={(e) => setForm({ ...form, date: e.target.value })} className={inputClass} />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">{t("فاتورة البضاعة المستوردة")}</span>
                <select value={form.invoiceId} onChange={(e) => setForm({ ...form, invoiceId: e.target.value })} className={inputClass}>
                  <option value="">{t("اختياري")}</option>
                  {importInvoices.map((invoice) => <option key={invoice.code} value={invoice.code}>{invoice.label}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-sm md:col-span-3">
                <span className="font-medium">{t("الوصف")}</span>
                <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={t("اختياري")} className={inputClass} />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">{t("القيمة الجمركية (ريال)")}*</span>
                <input type="number" min={0} value={form.customsValue} onChange={(e) => setForm({ ...form, customsValue: e.target.value })} className={inputClass} />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">{t("الرسوم الجمركية (ريال)")}</span>
                <input type="number" min={0} value={form.customsDuties} onChange={(e) => setForm({ ...form, customsDuties: e.target.value })} className={inputClass} />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">{t("رسوم أخرى ضمن وعاء الضريبة (ريال)")}</span>
                <input type="number" min={0} value={form.otherCharges} onChange={(e) => setForm({ ...form, otherCharges: e.target.value })} placeholder={t("اختياري")} className={inputClass} />
              </label>
              {!form.exemptImport && (
                <label className="space-y-1 text-sm">
                  <span className="font-medium">{t("الجزء المعفى من الوعاء (ريال)")}</span>
                  <input type="number" min={0} value={form.exemptBase} onChange={(e) => setForm({ ...form, exemptBase: e.target.value })} placeholder={t("اختياري — لبيان فيه بضائع معفاة")} className={inputClass} />
                </label>
              )}
              <label className="space-y-1 text-sm">
                <span className="font-medium">{t("ضريبة الاستيراد كما في البيان (ريال)")}*</span>
                <div className="flex gap-2">
                  <input type="number" min={0} value={form.exemptImport ? "0" : form.importVat} disabled={form.exemptImport} onChange={(e) => setForm({ ...form, importVat: e.target.value })} className={inputClass} />
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, importVat: String(suggestedVat) })}
                    className="shrink-0 rounded border border-border px-2 text-xs"
                  >
                    15% = {formatAmount(suggestedVat)}
                  </button>
                </div>
              </label>
              <label className="flex items-start gap-2 text-sm md:col-span-3">
                <input type="checkbox" checked={form.exemptImport} onChange={(e) => setForm({ ...form, exemptImport: e.target.checked })} className="mt-1" />
                <span>{t("استيراد معفى بالكامل من ضريبة القيمة المضافة (لا ضريبة في البيان)")}</span>
              </label>
              {customsDuties + otherCharges > 0 && (
                <label className="space-y-1 text-sm md:col-span-3">
                  <span className="font-medium">{t("حساب تكلفة الرسوم الجمركية")}*</span>
                  <select value={form.dutiesAccountCode} onChange={(e) => setForm({ ...form, dutiesAccountCode: e.target.value })} className={inputClass}>
                    <option value="">{t("اختر الحساب")}</option>
                    {costAccounts.map((account) => <option key={account.code} value={account.code}>{account.label}</option>)}
                  </select>
                </label>
              )}
              <div className="space-y-2 text-sm md:col-span-3">
                <span className="font-medium">{t("من دفع الجمارك والضريبة؟")}*</span>
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2">
                    <input type="radio" checked={form.route === "bank"} onChange={() => setForm({ ...form, route: "bank" })} />
                    {t("الشركة مباشرة من حسابها البنكي")}
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" checked={form.route === "agent"} onChange={() => setForm({ ...form, route: "agent" })} />
                    {t("المخلّص الجمركي (يُقيَّد على الحساب الوسيط 2115 حتى تصل فاتورته)")}
                  </label>
                </div>
                {form.route === "bank" ? (
                  <select value={form.bankAccountCode} onChange={(e) => setForm({ ...form, bankAccountCode: e.target.value })} className={inputClass}>
                    <option value="">{t("اختر الحساب الذي دُفعت منه (بنك أو صندوق)")}</option>
                    {banks.map((bank) => <option key={bank.code} value={bank.code}>{bank.label}</option>)}
                  </select>
                ) : (
                  <>
                    <select value={form.agentVendorId} onChange={(e) => setForm({ ...form, agentVendorId: e.target.value })} className={inputClass}>
                      <option value="">{t("اختر المخلّص الجمركي")}</option>
                      {vendors.map((vendor) => <option key={vendor.code} value={vendor.code}>{vendor.label}</option>)}
                    </select>
                    <p className="text-xs text-amber-700">
                      {t("عند وصول فاتورة المخلّص سجّلها في فواتير المشتريات، واجعل سطر الجمارك والضريبة المدفوعة نيابة عنا على الحساب 2115 بضريبة 0%.")}
                    </p>
                  </>
                )}
              </div>
              <label className="flex items-start gap-2 text-sm md:col-span-3">
                <input type="checkbox" checked={form.importerConfirmed} onChange={(e) => setForm({ ...form, importerConfirmed: e.target.checked })} className="mt-1" />
                <span>{t("البيان الجمركي صادر باسم الشركة بصفتها المستورد (شرط خصم ضريبة الاستيراد)")}</span>
              </label>
            </div>
            <div className="flex justify-end">
              <div className="w-80 space-y-1 rounded-lg border border-border p-3 text-sm">
                <div className="flex justify-between gap-8"><span>{t("وعاء الضريبة (القيمة + الرسوم)")}</span><span>{formatAmount(vatBase)}</span></div>
                {exemptBase > 0 && <div className="flex justify-between gap-8"><span>{t("منه معفى")}</span><span>{formatAmount(exemptBase)}</span></div>}
                <div className="flex justify-between gap-8"><span>{t("ضريبة الاستيراد")}</span><span>{formatAmount(importVat)}</span></div>
                <div className="flex justify-between gap-8 border-t pt-1 font-semibold"><span>{t("المدفوع للجمارك")}</span><span>{formatAmount(round2(importVat + customsDuties + otherCharges))}</span></div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
