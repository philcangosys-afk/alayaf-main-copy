import { useEffect, useMemo, useState } from "react";
import { ArchiveRestore, Edit3, Loader2, Plus, Save, Send, Trash2, X } from "lucide-react";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { riyadhDateString } from "@/lib/utils";
import { selectAllRows } from "@/lib/ledgerData";
import { inventoryErrorText } from "@/lib/inventoryErrors";

type Product = { id: string; sku: string; name: string; unit: string };
type Warehouse = { id: string; code: string; name: string };
type Account = { code: string; name: string };
type OpeningLine = { id: number; productId: string; warehouseId: string; quantity: string; unitCost: string };
type OpeningBalance = {
  id: string;
  number: string;
  date: string;
  offsetAccountCode: string;
  reference: string;
  notes: string;
  status: "draft" | "posted";
  accountingStatus: string;
  journalEntryId: string;
  totalValue: number;
  lines: OpeningLine[];
};

const today = () => riyadhDateString();
const newLine = (id = Date.now()): OpeningLine => ({ id, productId: "", warehouseId: "", quantity: "1", unitCost: "0" });
const numberValue = (value: string) => Number(value) || 0;

export default function InventoryOpeningBalances() {
  const { t, direction, formatNumber } = useI18n();
  const [documents, setDocuments] = useState<OpeningBalance[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null | undefined>(undefined);
  const [date, setDate] = useState(today());
  const [offsetAccountCode, setOffsetAccountCode] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<OpeningLine[]>([newLine()]);

  const load = async () => {
    setLoading(true);
    setError("");
    const [documentResult, lineResult, productResult, warehouseResult, accountResult] = await Promise.all([
      selectAllRows((from, to) => supabase.from("inventory_opening_balances").select("id, opening_number, opening_date, offset_account_code, reference, notes, status, accounting_status, accounting_journal_entry_id, total_value").order("created_at", { ascending: false }).order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("inventory_opening_balance_lines").select("id, opening_balance_id, product_id, warehouse_id, quantity, unit_cost").order("created_at").order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("inventory_products").select("id, sku, name_ar, unit").eq("item_type", "product").eq("active", true).order("sku").order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("inventory_warehouses").select("id, code, name_ar").eq("active", true).order("code").order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("accounting_accounts").select("code, name_ar, parent_code").like("code", "3%").order("code").range(from, to)),
    ]);
    const firstError = documentResult.error ?? lineResult.error ?? productResult.error ?? warehouseResult.error ?? accountResult.error;
    if (firstError) {
      setError(inventoryErrorText(firstError.message, t));
      setLoading(false);
      return;
    }
    setProducts((productResult.data ?? []).map((row) => ({ id: String(row.id), sku: String(row.sku), name: String(row.name_ar), unit: String(row.unit) })));
    setWarehouses((warehouseResult.data ?? []).map((row) => ({ id: String(row.id), code: String(row.code), name: String(row.name_ar) })));
    const accountRows = accountResult.data ?? [];
    const parentAccountCodes = new Set(accountRows.map((row) => String(row.parent_code ?? "")).filter(Boolean));
    setAccounts(accountRows.filter((row) => !parentAccountCodes.has(String(row.code))).map((row) => ({ code: String(row.code), name: String(row.name_ar) })));
    setDocuments((documentResult.data ?? []).map((row) => ({
      id: String(row.id),
      number: String(row.opening_number),
      date: String(row.opening_date),
      offsetAccountCode: String(row.offset_account_code),
      reference: String(row.reference ?? ""),
      notes: String(row.notes ?? ""),
      status: row.status as OpeningBalance["status"],
      accountingStatus: String(row.accounting_status),
      journalEntryId: String(row.accounting_journal_entry_id ?? ""),
      totalValue: Number(row.total_value ?? 0),
      lines: (lineResult.data ?? []).filter((line) => line.opening_balance_id === row.id).map((line, index) => ({
        id: index + 1,
        productId: String(line.product_id),
        warehouseId: String(line.warehouse_id),
        quantity: String(line.quantity),
        unitCost: String(line.unit_cost),
      })),
    })));
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const total = useMemo(() => lines.reduce((sum, line) => sum + numberValue(line.quantity) * numberValue(line.unitCost), 0), [lines]);
  const reset = () => {
    setEditingId(undefined);
    setDate(today());
    setOffsetAccountCode("");
    setReference("");
    setNotes("");
    setLines([newLine()]);
    setError("");
  };
  const startNew = () => { reset(); setEditingId(null); };
  const startEdit = (document: OpeningBalance) => {
    if (document.status !== "draft") return;
    setEditingId(document.id);
    setDate(document.date);
    setOffsetAccountCode(document.offsetAccountCode);
    setReference(document.reference);
    setNotes(document.notes);
    setLines(document.lines.length ? document.lines : [newLine()]);
    setError("");
  };
  const updateLine = (id: number, field: keyof Omit<OpeningLine, "id">, value: string) => {
    setLines((current) => current.map((line) => line.id === id ? { ...line, [field]: value } : line));
  };

  const save = async () => {
    const stockLocations = lines.map((line) => `${line.productId}:${line.warehouseId}`);
    if (!date || !offsetAccountCode || lines.length === 0 || lines.some((line) => !line.productId || !line.warehouseId || numberValue(line.quantity) <= 0 || numberValue(line.unitCost) <= 0) || new Set(stockLocations).size !== stockLocations.length) {
      setError(t("أكمل بيانات الرصيد الافتتاحي وتأكد من عدم تكرار الصنف والمستودع ومن صحة الكميات والتكاليف"));
      return;
    }
    setBusy(true);
    setError("");
    const { error: saveError } = await supabase.rpc("save_inventory_opening_balance", {
      p_id: editingId || null,
      p_opening: {
        openingDate: date,
        offsetAccountCode,
        reference: reference.trim(),
        notes: notes.trim(),
        lines: lines.map((line) => ({
          productId: line.productId,
          warehouseId: line.warehouseId,
          quantity: numberValue(line.quantity),
          unitCost: numberValue(line.unitCost),
        })),
      },
    });
    setBusy(false);
    if (saveError) { setError(inventoryErrorText(saveError.message, t)); return; }
    toast({ title: t("تم حفظ الرصيد الافتتاحي كمسودة") });
    reset();
    await load();
  };

  const post = async (document: OpeningBalance) => {
    if (!confirm(t("هل تريد ترحيل الرصيد الافتتاحي؟ سيصبح غير قابل للتعديل وينشئ حركات المخزون والقيد المحاسبي."))) return;
    setBusy(true);
    const { error: postError } = await supabase.rpc("post_inventory_opening_balance", { p_id: document.id });
    setBusy(false);
    if (postError) {
      toast({ title: t("تعذر ترحيل الرصيد الافتتاحي"), description: inventoryErrorText(postError.message, t), variant: "destructive" });
      return;
    }
    toast({ title: t("تم ترحيل الرصيد الافتتاحي للمخزون والمحاسبة") });
    await load();
  };

  const remove = async (document: OpeningBalance) => {
    if (!confirm(t("هل تريد حذف مسودة الرصيد الافتتاحي؟"))) return;
    setBusy(true);
    const { error: deleteError } = await supabase.rpc("delete_inventory_opening_balance_draft", { p_id: document.id });
    setBusy(false);
    if (deleteError) {
      toast({ title: t("تعذر حذف المسودة"), description: inventoryErrorText(deleteError.message, t), variant: "destructive" });
      return;
    }
    toast({ title: t("تم حذف المسودة") });
    await load();
  };

  const productName = (id: string) => {
    const product = products.find((item) => item.id === id);
    return product ? `${product.sku} — ${product.name}` : "—";
  };
  const warehouseName = (id: string) => {
    const warehouse = warehouses.find((item) => item.id === id);
    return warehouse ? `${warehouse.code} — ${warehouse.name}` : "—";
  };
  const accountName = (code: string) => {
    const account = accounts.find((item) => item.code === code);
    return account ? `${account.code} — ${account.name}` : code || "—";
  };

  return <Layout><main dir={direction} className="space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3"><div className="rounded-lg bg-amber-50 p-2 text-amber-700"><ArchiveRestore className="h-6 w-6" /></div><div><h1 className="text-2xl font-bold text-slate-900">{t("الأرصدة الافتتاحية للمخزون")}</h1><p className="mt-1 text-sm text-slate-500">{t("إثبات الكميات والتكلفة عند بدء استخدام النظام مع قيد افتتاحي متوازن، مرة واحدة لكل صنف ومستودع.")}</p></div></div>
      <button onClick={startNew} className="inline-flex items-center gap-2 rounded bg-amber-700 px-4 py-2 text-sm font-semibold text-white"><Plus className="h-4 w-4" />{t("رصيد افتتاحي جديد")}</button>
    </header>

    <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{t("استخدم هذه الشاشة فقط للأرصدة السابقة لبدء التشغيل. لا يمكن إدخال رصيد افتتاحي لصنف ومستودع توجد لهما حركة سابقة، ولا تُرسل هذه العملية إلى ZATCA.")}</div>
    {error && <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

    {editingId !== undefined && <section className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between"><h2 className="font-bold">{t(editingId ? "تعديل مسودة الرصيد الافتتاحي" : "رصيد افتتاحي جديد")}</h2><button onClick={reset}><X className="h-5 w-5" /></button></div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-xs text-slate-600">{t("تاريخ الرصيد")}<input type="date" max={today()} value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label>
        <label className="text-xs text-slate-600">{t("حساب مقابل الرصيد الافتتاحي")}<select value={offsetAccountCode} onChange={(event) => setOffsetAccountCode(event.target.value)} className="mt-1 h-10 w-full rounded border px-2"><option value="">{t("اختر حساب حقوق الملكية")}</option>{accounts.map((account) => <option key={account.code} value={account.code}>{account.code} — {account.name}</option>)}</select></label>
        <label className="text-xs text-slate-600">{t("المرجع — اختياري")}<input value={reference} onChange={(event) => setReference(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label>
        <label className="text-xs text-slate-600">{t("ملاحظات — اختياري")}<input value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label>
      </div>

      <div className="mt-5 overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-100"><tr><th className="p-2">{t("الصنف")}</th><th className="p-2">{t("المستودع")}</th><th className="p-2">{t("الكمية")}</th><th className="p-2">{t("تكلفة الوحدة")}</th><th className="p-2">{t("القيمة SAR")}</th><th className="p-2"></th></tr></thead><tbody>{lines.map((line) => <tr key={line.id} className="border-b"><td className="p-2"><select value={line.productId} onChange={(event) => updateLine(line.id, "productId", event.target.value)} className="h-10 w-full min-w-56 rounded border px-2"><option value="">{t("اختر الصنف")}</option>{products.map((product) => <option key={product.id} value={product.id}>{product.sku} — {product.name} ({product.unit})</option>)}</select></td><td className="p-2"><select value={line.warehouseId} onChange={(event) => updateLine(line.id, "warehouseId", event.target.value)} className="h-10 w-full min-w-48 rounded border px-2"><option value="">{t("اختر المستودع")}</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} — {warehouse.name}</option>)}</select></td><td className="p-2"><input type="number" min="0.0001" step="0.0001" value={line.quantity} onChange={(event) => updateLine(line.id, "quantity", event.target.value)} className="h-10 w-28 rounded border px-2" /></td><td className="p-2"><input type="number" min="0.0001" step="0.0001" value={line.unitCost} onChange={(event) => updateLine(line.id, "unitCost", event.target.value)} className="h-10 w-32 rounded border px-2" /></td><td className="p-2 text-center font-semibold">{formatNumber(numberValue(line.quantity) * numberValue(line.unitCost), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td><td className="p-2"><button disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((item) => item.id !== line.id))} className="rounded border border-red-200 p-2 text-red-600 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button></td></tr>)}</tbody></table></div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><button onClick={() => setLines((current) => [...current, newLine(Date.now() + current.length)])} className="rounded border px-3 py-2 text-sm">{t("إضافة صنف ومستودع")}</button><div className="flex items-center gap-4"><p className="font-bold">{t("إجمالي القيمة")}: {formatNumber(total, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SAR</p><button disabled={busy} onClick={() => void save()} className="inline-flex items-center gap-2 rounded bg-amber-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{t("حفظ المسودة")}</button></div></div>
    </section>}

    <section className="overflow-hidden rounded-xl border bg-white shadow-sm"><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-100 text-slate-600"><tr><th className="p-3">{t("رقم المستند")}</th><th className="p-3">{t("التاريخ")}</th><th className="p-3">{t("الحساب المقابل")}</th><th className="p-3">{t("الأسطر")}</th><th className="p-3">{t("إجمالي القيمة")}</th><th className="p-3">{t("الحالة")}</th><th className="p-3">{t("القيد")}</th><th className="p-3">{t("الإجراءات")}</th></tr></thead><tbody>{loading ? <tr><td colSpan={8} className="py-14 text-center">{t("جاري التحميل...")}</td></tr> : documents.length === 0 ? <tr><td colSpan={8} className="py-14 text-center text-slate-400">{t("لا توجد أرصدة افتتاحية")}</td></tr> : documents.map((document) => <tr key={document.id} className="border-t"><td className="p-3 font-mono">{document.number}</td><td className="p-3 text-center">{document.date}</td><td className="p-3 text-center">{accountName(document.offsetAccountCode)}</td><td className="p-3 text-center">{document.lines.length}</td><td className="p-3 text-center font-semibold">{formatNumber(document.totalValue, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SAR</td><td className="p-3 text-center"><span className={`rounded px-2 py-1 text-xs font-semibold ${document.status === "posted" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{t(document.status === "posted" ? "مرحّل" : "مسودة")}</span></td><td className="p-3 text-center font-mono text-xs">{document.journalEntryId || "—"}</td><td className="p-3"><div className="flex justify-center gap-1">{document.status === "draft" && <><button disabled={busy} onClick={() => startEdit(document)} className="rounded border p-2 text-slate-600" title={t("تعديل")}><Edit3 className="h-4 w-4" /></button><button disabled={busy} onClick={() => void post(document)} className="rounded border border-emerald-200 p-2 text-emerald-700" title={t("ترحيل")}><Send className="h-4 w-4" /></button><button disabled={busy} onClick={() => void remove(document)} className="rounded border border-red-200 p-2 text-red-600" title={t("حذف")}><Trash2 className="h-4 w-4" /></button></>}</div></td></tr>)}</tbody></table></div></section>

    {documents.some((document) => document.status === "posted") && <section className="rounded-xl border bg-white p-5 shadow-sm"><h2 className="mb-3 font-bold">{t("تفاصيل الأرصدة المرحلة")}</h2><div className="space-y-2">{documents.filter((document) => document.status === "posted").map((document) => <div key={document.id} className="rounded border bg-slate-50 p-3"><p className="mb-2 text-sm font-semibold">{document.number}</p><div className="grid gap-1 text-xs text-slate-600 md:grid-cols-2">{document.lines.map((line) => <p key={line.id}>{productName(line.productId)} — {warehouseName(line.warehouseId)}: {formatNumber(numberValue(line.quantity), { maximumFractionDigits: 4 })} × {formatNumber(numberValue(line.unitCost), { minimumFractionDigits: 2, maximumFractionDigits: 4 })} SAR</p>)}</div></div>)}</div></section>}
  </main></Layout>;
}
