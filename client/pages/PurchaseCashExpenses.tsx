import Layout from "@/components/Layout";
import { companyStorageKey } from "@/lib/companyProfile";
import { purchasesFeatures } from "./Purchases";
import { ArrowRight, Plus, Save, UploadCloud, AlertTriangle } from "lucide-react";
import { ChangeEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n";
import { riyadhDateString } from "@/lib/utils";

type CashExpense = {
  id: string;
  expenseNumber: string;
  vendor: string;
  contractRef: string;
  category: string;
  branch: string;
  date: string;
  currency: string;
  mainAccount: string;
  beneficiary: string;
  subCategory: string;
  costCenter: string;
  description: string;
  notes: string;
  attachmentName: string;
};

type ExpenseForm = Omit<CashExpense, "id">;

/** مفتاح المتصفح خاص بالمنشأة الحالية */
const storageKey = () => companyStorageKey("purchase-cash-expenses");
const START_NUMBER = 1;

const buildExpenseNumber = (num: number) => `EXP-${String(num).padStart(4, "0")}`;
const extractNumber = (expenseNumber: string) => Number(expenseNumber.split("-")[1] || START_NUMBER);

const getEmptyForm = (num: number): ExpenseForm => ({
  expenseNumber: buildExpenseNumber(num),
  vendor: "",
  contractRef: "",
  category: "",
  branch: "",
  date: riyadhDateString(),
  currency: "SAR",
  mainAccount: "",
  beneficiary: "",
  subCategory: "",
  costCenter: "",
  description: "",
  notes: "",
  attachmentName: "",
});

/**
 * الشاشة معطّلة: كانت تحفظ في ذاكرة المتصفح فقط وبلا مبلغ ولا قيد، فلا يصل أي مصروف إلى الدفاتر.
 * المصروف النقدي يُسجَّل الآن كفاتورة مشتريات ثم سداد نقدي (قيد صحيح + ضريبة مدخلات عند توفر فاتورة ضريبية).
 * نعرض ما حُفظ سابقًا في هذا المتصفح للقراءة فقط حتى يُعاد تسجيله بالطريقة الصحيحة.
 */
export default function PurchaseCashExpenses() {
  const { t, direction, formatDate } = useI18n();
  const [legacyRows, setLegacyRows] = useState<CashExpense[]>([]);

  useEffect(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey()) || "[]");
      setLegacyRows(Array.isArray(parsed) ? (parsed as CashExpense[]) : []);
    } catch {
      setLegacyRows([]);
    }
  }, []);

  return (
    <Layout subMenu={{ title: t("المشتريات"), items: purchasesFeatures }}>
      <div dir={direction} className="mx-auto max-w-4xl space-y-6">
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-6 space-y-3">
          <div className="flex items-center gap-2 text-amber-800">
            <AlertTriangle className="h-5 w-5" />
            <h1 className="text-xl font-bold">{t("شاشة المصروفات النقدية متوقفة مؤقتًا")}</h1>
          </div>
          <p className="text-sm text-amber-900 leading-7">
            {t("كانت هذه الشاشة تحفظ المصروفات في المتصفح فقط وبلا مبلغ، فلا تصل إلى الدفاتر ولا إلى الإقرار الضريبي. لتسجيل مصروف نقدي: أنشئ فاتورة مشتريات للمورد (برقم فاتورته)، ثم سجّل سدادها نقدًا.")}
          </p>
          <Link
            to="/purchases/invoices"
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white"
          >
            {t("الذهاب إلى فواتير المشتريات")}
          </Link>
        </div>

        {legacyRows.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <h2 className="text-sm font-bold">
              {t("مصروفات محفوظة سابقًا في هذا المتصفح فقط (غير مسجلة في الدفاتر) — أعد تسجيلها كفواتير مشتريات")}
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40">
                    <th className="px-3 py-2 text-start">{t("الرقم")}</th>
                    <th className="px-3 py-2 text-start">{t("التاريخ")}</th>
                    <th className="px-3 py-2 text-start">{t("المورد")}</th>
                    <th className="px-3 py-2 text-start">{t("الوصف")}</th>
                  </tr>
                </thead>
                <tbody>
                  {legacyRows.map((row) => (
                    <tr key={row.id} className="border-t border-border">
                      <td className="px-3 py-2">{row.expenseNumber}</td>
                      <td className="px-3 py-2">{row.date ? formatDate(row.date) : "-"}</td>
                      <td className="px-3 py-2">{row.vendor || "-"}</td>
                      <td className="px-3 py-2">{row.description || row.notes || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

// الشاشة القديمة محفوظة كمرجع فقط وغير مستخدمة
export function LegacyPurchaseCashExpenses() {
  const { t, direction, formatDate, formatNumber } = useI18n();
  const [mode, setMode] = useState<"list" | "create">("list");
  const [rows, setRows] = useState<CashExpense[]>([]);
  const [nextNumber, setNextNumber] = useState(START_NUMBER);
  const [form, setForm] = useState<ExpenseForm>(() => getEmptyForm(START_NUMBER));
  const formatCurrency = (currency: string) =>
    currency.trim().toUpperCase() === "SAR" ? t("ر.س") : currency;

  useEffect(() => {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as CashExpense[];
      setRows(parsed);
      const max = parsed.reduce((acc, cur) => Math.max(acc, extractNumber(cur.expenseNumber)), 0);
      const sequence = max + 1;
      setNextNumber(sequence);
      setForm(getEmptyForm(sequence));
    } catch {
      setRows([]);
      setNextNumber(START_NUMBER);
      setForm(getEmptyForm(START_NUMBER));
    }
  }, []);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setForm((prev) => ({ ...prev, attachmentName: file.name }));
  };

  const handleCreateNew = () => {
    setForm(getEmptyForm(nextNumber));
    setMode("create");
  };

  const handleSave = () => {
    if (!form.vendor.trim()) {
      toast({ title: t("المورد مطلوب"), description: t("يرجى إدخال المورد قبل الحفظ") });
      return;
    }

    const payload: CashExpense = {
      id: crypto.randomUUID(),
      ...form,
    };

    const updated = [payload, ...rows];
    setRows(updated);
    localStorage.setItem(storageKey(), JSON.stringify(updated));

    const sequence = extractNumber(form.expenseNumber) + 1;
    setNextNumber(sequence);
    setForm(getEmptyForm(sequence));
    setMode("list");

    toast({
      title: t("تم حفظ المصروف النقدي"),
      description: t("تم حفظ المصروف {expenseNumber}").replace("{expenseNumber}", payload.expenseNumber),
    });
  };

  return (
    <Layout subMenu={{ title: t("المشتريات"), items: purchasesFeatures }}>
      <div dir={direction} className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-foreground">{t("مصروفات نقدية")}</h1>
            <p className="text-sm text-muted-foreground">
              {mode === "list" ? t("عرض المصروفات النقدية") : t("إدخال مصروف نقدي")}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {mode === "list" ? (
              <button
                onClick={handleCreateNew}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white"
              >
                <Plus className="h-4 w-4" />
                {t("إضافة مصروف نقدي")}
              </button>
            ) : (
              <>
                <button
                  onClick={() => setMode("list")}
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium"
                >
                  <ArrowRight className={`h-4 w-4 ${direction === "ltr" ? "rotate-180" : ""}`} />
                  {t("الرجوع للقائمة")}
                </button>
                <button
                  onClick={handleSave}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white"
                >
                  <Save className="h-4 w-4" />
                  {t("حفظ المصروف")}
                </button>
              </>
            )}
          </div>
        </div>

        {mode === "list" ? (
          <div className="space-y-4 rounded-xl border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">
              {t("عدد المصروفات:")} <span className="font-semibold text-foreground">{formatNumber(rows.length)}</span>
            </p>
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("لا توجد مصروفات محفوظة حالياً.")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-start text-sm">
                  <thead>
                    <tr className="bg-muted/40">
                      <th className="px-3 py-2">{t("رقم المصروف")}</th>
                      <th className="px-3 py-2">{t("المورد")}</th>
                      <th className="px-3 py-2">{t("التاريخ")}</th>
                      <th className="px-3 py-2">{t("العملة")}</th>
                      <th className="px-3 py-2">{t("المستفيد")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className="border-t border-border">
                        <td className="px-3 py-2 font-semibold text-primary">{row.expenseNumber}</td>
                        <td className="px-3 py-2">{row.vendor}</td>
                        <td className="px-3 py-2">{formatDate(row.date, { dateStyle: "medium" })}</td>
                        <td className="px-3 py-2">{formatCurrency(row.currency)}</td>
                        <td className="px-3 py-2">{row.beneficiary || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
            <label className="rounded-xl border border-border bg-card p-3 block cursor-pointer">
              <p className="mb-3 text-sm font-semibold text-foreground text-center">{t("تحميل مصروف من الجهاز")}</p>
              <input type="file" onChange={handleFileChange} className="hidden" />
              <div className="flex h-[340px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 text-center">
                <UploadCloud className="mb-3 h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-foreground">{t("اسحب الملفات هنا أو انقر للتصفح")}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t("أنواع مدعومة: PDF, PNG, JPG")}</p>
                {form.attachmentName && (
                  <p className="mt-3 rounded-md bg-primary/10 px-2 py-1 text-xs text-primary">{form.attachmentName}</p>
                )}
              </div>
            </label>

            <div className="space-y-3 rounded-xl border border-border bg-card p-4">
              <div className="grid gap-3 md:grid-cols-[160px_1fr] items-center">
                <label className="text-sm font-medium text-foreground">{t("المورد*")}</label>
                <input value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} placeholder={t("مطلوب")} className="h-10 rounded-md border border-border bg-background px-3 text-sm" />

                <label className="text-sm font-medium text-foreground">{t("رقم مرجع العقد")}</label>
                <input value={form.contractRef} onChange={(e) => setForm({ ...form, contractRef: e.target.value })} placeholder={t("اختياري")} className="h-10 rounded-md border border-border bg-background px-3 text-sm" />

                <label className="text-sm font-medium text-foreground">{t("الفئة")}</label>
                <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder={t("اختياري")} className="h-10 rounded-md border border-border bg-background px-3 text-sm" />

                <label className="text-sm font-medium text-foreground">{t("فرع")}</label>
                <input value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} placeholder={t("اختياري")} className="h-10 rounded-md border border-border bg-background px-3 text-sm" />

                <label className="text-sm font-medium text-foreground">{t("التاريخ*")}</label>
                <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="h-10 rounded-md border border-border bg-background px-3 text-sm" />

                <label className="text-sm font-medium text-foreground">{t("العملة")}</label>
                <input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className="h-10 rounded-md border border-border bg-background px-3 text-sm" />

                <label className="text-sm font-medium text-foreground">{t("الحساب الرئيسي")}</label>
                <input value={form.mainAccount} onChange={(e) => setForm({ ...form, mainAccount: e.target.value })} placeholder={t("اختياري")} className="h-10 rounded-md border border-border bg-background px-3 text-sm" />

                <label className="text-sm font-medium text-foreground">{t("المستفيد")}</label>
                <input value={form.beneficiary} onChange={(e) => setForm({ ...form, beneficiary: e.target.value })} placeholder={t("اختياري")} className="h-10 rounded-md border border-border bg-background px-3 text-sm" />

                <label className="text-sm font-medium text-foreground">{t("فئة")}</label>
                <input value={form.subCategory} onChange={(e) => setForm({ ...form, subCategory: e.target.value })} placeholder={t("اختياري")} className="h-10 rounded-md border border-border bg-background px-3 text-sm" />

                <label className="text-sm font-medium text-foreground">{t("مركز تكلفة")}</label>
                <input value={form.costCenter} onChange={(e) => setForm({ ...form, costCenter: e.target.value })} placeholder={t("اختياري")} className="h-10 rounded-md border border-border bg-background px-3 text-sm" />

                <label className="text-sm font-medium text-foreground">{t("الوصف")}</label>
                <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={t("غير محدد")} className="h-10 rounded-md border border-border bg-background px-3 text-sm" />

                <label className="text-sm font-medium text-foreground">{t("توضيح")}</label>
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} placeholder={t("غير محدد")} className="rounded-md border border-border bg-background px-3 py-2 text-sm resize-none" />
              </div>

              <div className="pt-2 flex justify-end">
                <input value={form.expenseNumber} readOnly className="w-40 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs" />
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
