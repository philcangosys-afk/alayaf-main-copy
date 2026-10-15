import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Building2, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n";
import { COMPANY_PROFILE } from "@/lib/companyProfile";

/** اسم المنشأة الحالية وقت الاستخدام (يُملأ بعد الدخول) */
const companyName = () => COMPANY_PROFILE.companyNameAr;

type AccountOption = {
  code: string;
  name_ar: string;
};

type CostCenter = {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  linked_account_code: string;
  budget: number;
  active: boolean;
  accounting_accounts?: AccountOption | null;
};

type CostCenterForm = Omit<CostCenter, "id" | "accounting_accounts">;

const emptyForm: CostCenterForm = {
  code: "",
  name_ar: "",
  name_en: "",
  linked_account_code: "",
  budget: 0,
  active: true,
};

export default function CostCenters() {
  const { t, direction, formatNumber } = useI18n();
  const [centers, setCenters] = useState<CostCenter[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [form, setForm] = useState<CostCenterForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadData = async () => {
    setLoading(true);
    const [accountsResult, centersResult] = await Promise.all([
      supabase
        .from("accounting_accounts")
        .select("code, name_ar")
        .order("code"),
      supabase
        .from("cost_centers")
        .select("id, code, name_ar, name_en, linked_account_code, budget, active, accounting_accounts(code, name_ar)")
        .order("code"),
    ]);

    if (accountsResult.error || centersResult.error) {
      toast({
        title: t("تعذر تحميل مراكز التكلفة"),
        description: accountsResult.error?.message || centersResult.error?.message,
        variant: "destructive",
      });
    } else {
      setAccounts((accountsResult.data ?? []) as AccountOption[]);
      setCenters((centersResult.data ?? []) as unknown as CostCenter[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    void loadData();
  }, []);

  const totalBudget = useMemo(
    () => centers.reduce((sum, center) => sum + Number(center.budget || 0), 0),
    [centers]
  );

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...emptyForm, linked_account_code: accounts[0]?.code ?? "" });
    setShowForm(true);
  };

  const openEdit = (center: CostCenter) => {
    setEditingId(center.id);
    setForm({
      code: center.code,
      name_ar: center.name_ar,
      name_en: center.name_en,
      linked_account_code: center.linked_account_code,
      budget: Number(center.budget || 0),
      active: center.active,
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.code.trim() || !form.name_ar.trim() || !form.linked_account_code) {
      toast({ title: t("بيانات ناقصة"), description: t("أدخل الكود والاسم والحساب المرتبط."), variant: "destructive" });
      return;
    }

    setSaving(true);
    const payload = {
      code: form.code.trim(),
      name_ar: form.name_ar.trim(),
      name_en: form.name_en.trim(),
      linked_account_code: form.linked_account_code,
      budget: Number(form.budget || 0),
      active: form.active,
      updated_at: new Date().toISOString(),
    };

    const result = editingId
      ? await supabase.from("cost_centers").update(payload).eq("id", editingId)
      : await supabase.from("cost_centers").insert(payload);

    setSaving(false);
    if (result.error) {
      toast({ title: t("تعذر الحفظ"), description: result.error.message, variant: "destructive" });
      return;
    }

    toast({ title: editingId ? t("تم تحديث مركز التكلفة") : t("تم إنشاء مركز التكلفة") });
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
    await loadData();
  };

  const handleDelete = async (center: CostCenter) => {
    if (!window.confirm(`${t("هل تريد حذف مركز التكلفة")} ${center.name_ar}?`)) return;
    const { error } = await supabase.from("cost_centers").delete().eq("id", center.id);
    if (error) {
      toast({ title: t("تعذّر الحذف"), description: error.message, variant: "destructive" });
      return;
    }
    setCenters((current) => current.filter((item) => item.id !== center.id));
    toast({ title: t("تم حذف مركز التكلفة") });
  };

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4" dir={direction}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">{t("مراكز التكلفة")}</h2>
            <p className="text-xs text-muted-foreground">{t("مرتبطة فعليًا بحسابات")} {t(companyName())}</p>
          </div>
        </div>
        <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
          <Plus className="h-4 w-4" /> {t("إضافة مركز تكلفة")}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Summary label={t("الشركة")} value={t(companyName())} />
        <Summary label={t("عدد المراكز")} value={formatNumber(centers.length)} />
        <Summary label={t("إجمالي الميزانيات")} value={`${formatNumber(totalBudget)} ${t("ريال")}`} />
      </div>

      {showForm && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-bold text-foreground">{editingId ? t("تعديل مركز التكلفة") : t("مركز تكلفة جديد")}</h3>
            <button onClick={() => setShowForm(false)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-white"><X className="h-4 w-4" /></button>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Field label={t("كود مركز التكلفة")}><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15" placeholder="CC-004" /></Field>
            <Field label={t("الاسم بالعربية")}><input value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15" /></Field>
            <Field label={t("الاسم بالإنجليزية")}><input dir="ltr" value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15" /></Field>
            <Field label={t("الحساب المرتبط")}>
              <select value={form.linked_account_code} onChange={(e) => setForm({ ...form, linked_account_code: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15">
                <option value="">{t("اختر الحساب")}</option>
                {accounts.map((account) => <option key={account.code} value={account.code}>{account.code} — {account.name_ar}</option>)}
              </select>
            </Field>
            <Field label={t("الميزانية بالريال")}><input type="number" min="0" value={form.budget} onChange={(e) => setForm({ ...form, budget: Number(e.target.value) })} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15" /></Field>
            <Field label={t("الحالة")}>
              <select value={form.active ? "active" : "inactive"} onChange={(e) => setForm({ ...form, active: e.target.value === "active" })} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"><option value="active">{t("فعال")}</option><option value="inactive">{t("غير فعال")}</option></select>
            </Field>
          </div>
          <div className="mt-4 flex justify-end">
            <button onClick={() => void handleSave()} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} {t("حفظ")}
            </button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border">
        <div className="overflow-x-auto">
          <table dir={direction} className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50 text-muted-foreground"><tr><th className="px-4 py-3 text-start">{t("الكود")}</th><th className="px-4 py-3 text-start">{t("مركز التكلفة")}</th><th className="px-4 py-3 text-start">{t("الحساب المرتبط")}</th><th className="px-4 py-3 text-start">{t("الميزانية")}</th><th className="px-4 py-3 text-start">{t("الحالة")}</th><th className="px-4 py-3" /></tr></thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr><td colSpan={6} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-emerald-600" /></td></tr>
              ) : centers.length === 0 ? (
                <tr><td colSpan={6} className="py-10 text-center text-muted-foreground">{t("لا توجد مراكز تكلفة.")}</td></tr>
              ) : centers.map((center) => (
                <tr key={center.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 font-mono font-semibold">{center.code}</td>
                  <td className="px-4 py-3"><div className="font-semibold">{center.name_ar}</div><div className="text-xs text-muted-foreground" dir="ltr">{center.name_en}</div></td>
                  <td className="px-4 py-3"><span className="font-mono">{center.linked_account_code}</span><span className="ms-2 text-muted-foreground">{center.accounting_accounts?.name_ar}</span></td>
                  <td className="px-4 py-3">{formatNumber(Number(center.budget || 0))} {t("ريال")}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${center.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{center.active ? t("فعال") : t("غير فعال")}</span></td>
                  <td className="px-4 py-3"><div className="flex justify-end gap-1"><button onClick={() => openEdit(center)} className="rounded-lg p-2 text-blue-600 hover:bg-blue-50" title={t("تعديل")}><Pencil className="h-4 w-4" /></button><button onClick={() => void handleDelete(center)} className="rounded-lg p-2 text-red-600 hover:bg-red-50" title={t("حذف")}><Trash2 className="h-4 w-4" /></button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-border bg-background p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 font-bold text-foreground">{value}</div></div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="space-y-1.5"><span className="text-xs font-semibold text-foreground">{label}</span>{children}</label>;
}
