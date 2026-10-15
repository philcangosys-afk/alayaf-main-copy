import { useEffect, useMemo, useState } from "react";
import { Boxes, Edit3, Loader2, PackagePlus, Save, Trash2, X } from "lucide-react";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { selectAllRows } from "@/lib/ledgerData";
import { inventoryErrorText } from "@/lib/inventoryErrors";

type Account = { code: string; name_ar: string; parent_code: string | null };
type Product = {
  id: string;
  sku: string;
  nameAr: string;
  nameEn: string;
  itemType: "product" | "service";
  unit: string;
  inventoryAccountCode: string;
  cogsAccountCode: string;
  revenueAccountCode: string;
  active: boolean;
};

export default function InventoryProducts() {
  const { t, direction } = useI18n();
  const [products, setProducts] = useState<Product[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null | undefined>(undefined);
  const [sku, setSku] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [itemType, setItemType] = useState<"product" | "service">("product");
  const [unit, setUnit] = useState("قطعة");
  const [inventoryAccount, setInventoryAccount] = useState("1151");
  const [cogsAccount, setCogsAccount] = useState("511");
  const [revenueAccount, setRevenueAccount] = useState("411");
  const [active, setActive] = useState(true);

  const load = async () => {
    setLoading(true);
    setError("");
    const [productResult, accountResult] = await Promise.all([
      selectAllRows((from, to) => supabase.from("inventory_products").select("id, sku, name_ar, name_en, item_type, unit, inventory_account_code, cogs_account_code, revenue_account_code, active").order("sku").order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("accounting_accounts").select("code, name_ar, parent_code").order("code").range(from, to)),
    ]);
    const firstError = productResult.error ?? accountResult.error;
    if (firstError) {
      setError(inventoryErrorText(firstError.message, t));
      setLoading(false);
      return;
    }
    const allAccounts = (accountResult.data ?? []) as Account[];
    setAccounts(allAccounts.filter((account) => !allAccounts.some((child) => child.parent_code === account.code)));
    setProducts((productResult.data ?? []).map((row) => ({
      id: String(row.id),
      sku: String(row.sku),
      nameAr: String(row.name_ar),
      nameEn: String(row.name_en ?? ""),
      itemType: row.item_type as Product["itemType"],
      unit: String(row.unit),
      inventoryAccountCode: String(row.inventory_account_code ?? ""),
      cogsAccountCode: String(row.cogs_account_code ?? ""),
      revenueAccountCode: String(row.revenue_account_code),
      active: Boolean(row.active),
    })));
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const totals = useMemo(() => ({
    products: products.filter((item) => item.itemType === "product").length,
    services: products.filter((item) => item.itemType === "service").length,
    active: products.filter((item) => item.active).length,
  }), [products]);

  const reset = () => {
    setEditingId(undefined);
    setSku(""); setNameAr(""); setNameEn(""); setItemType("product"); setUnit("قطعة");
    setInventoryAccount("1151"); setCogsAccount("511"); setRevenueAccount("411"); setActive(true); setError("");
  };
  const startNew = () => { reset(); setEditingId(null); };
  const startEdit = (product: Product) => {
    setEditingId(product.id); setSku(product.sku); setNameAr(product.nameAr); setNameEn(product.nameEn);
    setItemType(product.itemType); setUnit(product.unit); setInventoryAccount(product.inventoryAccountCode || "1151");
    setCogsAccount(product.cogsAccountCode || "511"); setRevenueAccount(product.revenueAccountCode); setActive(product.active); setError("");
  };

  const save = async () => {
    if (!nameAr.trim() || !unit.trim() || !revenueAccount || (itemType === "product" && (!inventoryAccount || !cogsAccount))) {
      setError(t("أكمل بيانات الصنف والحسابات المطلوبة"));
      return;
    }
    setBusy(true); setError("");
    const { error: saveError } = await supabase.rpc("save_inventory_product", {
      p_id: editingId || null,
      p_product: {
        sku: sku.trim(), nameAr: nameAr.trim(), nameEn: nameEn.trim(), itemType, unit: unit.trim(),
        inventoryAccountCode: itemType === "product" ? inventoryAccount : null,
        cogsAccountCode: itemType === "product" ? cogsAccount : null,
        revenueAccountCode: revenueAccount, active,
      },
    });
    setBusy(false);
    if (saveError) { setError(inventoryErrorText(saveError.message, t)); return; }
    toast({ title: t(editingId ? "تم تحديث الصنف" : "تم إنشاء الصنف") });
    reset(); await load();
  };

  const remove = async (product: Product) => {
    if (!confirm(t("هل تريد حذف الصنف؟ لا يمكن حذف صنف لديه حركات مخزون."))) return;
    setBusy(true);
    const { error: deleteError } = await supabase.rpc("delete_inventory_product", { p_id: product.id });
    setBusy(false);
    if (deleteError) { toast({ title: t("تعذر حذف الصنف"), description: inventoryErrorText(deleteError.message, t), variant: "destructive" }); return; }
    toast({ title: t("تم حذف الصنف") }); await load();
  };

  const AccountSelect = ({ label, value, onChange, prefix }: { label: string; value: string; onChange: (value: string) => void; prefix: string }) => (
    <label className="text-xs text-slate-600">{t(label)}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-10 w-full rounded border px-2 text-sm">
        <option value="">{t("اختر حسابًا طرفيًا")}</option>
        {accounts.filter((account) => account.code.startsWith(prefix)).map((account) => <option key={account.code} value={account.code}>{account.code} — {account.name_ar}</option>)}
      </select>
    </label>
  );

  return <Layout><main dir={direction} className="space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3"><div className="rounded-lg bg-emerald-50 p-2 text-emerald-700"><Boxes className="h-6 w-6" /></div><div><h1 className="text-2xl font-bold text-slate-900">{t("المنتجات والخدمات")}</h1><p className="mt-1 text-sm text-slate-500">{t("تعريف الأصناف والخدمات وربطها بحسابات المخزون والتكلفة والإيراد.")}</p></div></div>
      <button onClick={startNew} className="inline-flex items-center gap-2 rounded bg-emerald-700 px-4 py-2 text-sm font-semibold text-white"><PackagePlus className="h-4 w-4" />{t("صنف أو خدمة جديدة")}</button>
    </header>

    {error && <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
    <section className="grid gap-3 md:grid-cols-3">{[["المنتجات", totals.products], ["الخدمات", totals.services], ["النشطة", totals.active]].map(([label, value]) => <div key={String(label)} className="rounded-xl border bg-white p-4"><p className="text-xs text-slate-500">{t(String(label))}</p><p className="mt-2 text-xl font-bold">{value}</p></div>)}</section>

    {editingId !== undefined && <section className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between"><h2 className="font-bold">{t(editingId ? "تعديل الصنف أو الخدمة" : "صنف أو خدمة جديدة")}</h2><button onClick={reset}><X className="h-5 w-5" /></button></div>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-xs text-slate-600">{t("رمز الصنف")}<input value={sku} onChange={(event) => setSku(event.target.value.toUpperCase())} placeholder={t("تلقائي عند تركه فارغًا")} className="mt-1 h-10 w-full rounded border px-3" /></label>
        <label className="text-xs text-slate-600">{t("الاسم العربي")}<input value={nameAr} onChange={(event) => setNameAr(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label>
        <label className="text-xs text-slate-600">{t("الاسم الإنجليزي")}<input value={nameEn} onChange={(event) => setNameEn(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label>
        <label className="text-xs text-slate-600">{t("النوع")}<select value={itemType} onChange={(event) => setItemType(event.target.value as Product["itemType"])} className="mt-1 h-10 w-full rounded border px-2"><option value="product">{t("منتج مخزني")}</option><option value="service">{t("خدمة")}</option></select></label>
        <label className="text-xs text-slate-600">{t("وحدة القياس")}<input value={unit} onChange={(event) => setUnit(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label>
        <label className="flex items-center gap-2 self-end rounded border px-3 py-2 text-sm"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />{t("نشط")}</label>
        {itemType === "product" && <><AccountSelect label="حساب أصل المخزون" value={inventoryAccount} onChange={setInventoryAccount} prefix="115" /><AccountSelect label="حساب تكلفة المبيعات" value={cogsAccount} onChange={setCogsAccount} prefix="5" /></>}
        <AccountSelect label="حساب الإيراد" value={revenueAccount} onChange={setRevenueAccount} prefix="4" />
      </div>
      <div className="mt-4 flex justify-end"><button disabled={busy} onClick={() => void save()} className="inline-flex items-center gap-2 rounded bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{t("حفظ")}</button></div>
    </section>}

    <section className="overflow-hidden rounded-xl border bg-white shadow-sm"><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-100 text-slate-600"><tr><th className="p-3">{t("الرمز")}</th><th className="p-3">{t("الصنف أو الخدمة")}</th><th className="p-3">{t("النوع")}</th><th className="p-3">{t("الوحدة")}</th><th className="p-3">{t("الحسابات")}</th><th className="p-3">{t("الحالة")}</th><th className="p-3">{t("الإجراءات")}</th></tr></thead><tbody>
      {loading ? <tr><td colSpan={7} className="py-14 text-center">{t("جاري التحميل...")}</td></tr> : products.length === 0 ? <tr><td colSpan={7} className="py-14 text-center text-slate-400">{t("لا توجد منتجات أو خدمات")}</td></tr> : products.map((product) => <tr key={product.id} className="border-t"><td className="p-3 font-mono">{product.sku}</td><td className="p-3"><p className="font-semibold">{product.nameAr}</p><p className="text-xs text-slate-500">{product.nameEn || "—"}</p></td><td className="p-3 text-center">{t(product.itemType === "product" ? "منتج مخزني" : "خدمة")}</td><td className="p-3 text-center">{product.unit}</td><td className="p-3 text-xs"><p>{t("الإيراد")}: {product.revenueAccountCode}</p>{product.itemType === "product" && <p>{t("المخزون")}: {product.inventoryAccountCode} · {t("التكلفة")}: {product.cogsAccountCode}</p>}</td><td className="p-3 text-center"><span className={`rounded px-2 py-1 text-xs font-semibold ${product.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{t(product.active ? "نشط" : "غير نشط")}</span></td><td className="p-3"><div className="flex justify-center gap-1"><button onClick={() => startEdit(product)} className="rounded border p-1.5" title={t("تعديل")}><Edit3 className="h-4 w-4" /></button><button onClick={() => void remove(product)} className="rounded border border-red-200 p-1.5 text-red-600" title={t("حذف")}><Trash2 className="h-4 w-4" /></button></div></td></tr>)}
    </tbody></table></div></section>
  </main></Layout>;
}
