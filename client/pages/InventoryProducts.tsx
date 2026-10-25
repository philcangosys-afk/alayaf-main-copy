import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Boxes, Edit3, Loader2, PackagePlus, Save, Search, Trash2, Wrench, X } from "lucide-react";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { selectAllRows } from "@/lib/ledgerData";
import { inventoryErrorText } from "@/lib/inventoryErrors";
import { parseCatalog, stockIn, stockLevel, type CatalogItem, type CatalogWarehouse } from "@/lib/itemCatalog";
import { DataImportButton } from "@/components/DataImportDialog";
import { productsImportSpec } from "@/lib/imports/products";

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
  // S17: الأسعار والبيانات (الأسعار قبل الضريبة دائمًا)
  salePrice: number;
  purchasePrice: number;
  description: string;
  barcode: string;
  reorderLevel: number;
  purchaseAccountCode: string;
  // S18: طريقة إدخال السعر ونسبة الضريبة
  pricesIncludeVat: boolean;
  vatRate: number;
};
type TypeFilter = "all" | "product" | "service";

// الحسابات الافتراضية للصنف الجديد إن وُجدت في دليل المنشأة كحسابات طرفية:
// 1151 مخزون البضاعة، 513 تكلفة البضاعة المباعة (وإلا 511 كما كان سابقًا)، 411 الإيراد
const DEFAULT_INVENTORY_ACCOUNTS = ["1151"];
const DEFAULT_COGS_ACCOUNTS = ["513", "511"];
const DEFAULT_REVENUE_ACCOUNTS = ["411"];
// الحساب المقابل للرصيد الافتتاحي (حقوق الملكية): رأس المال، وإلا أول حساب طرفي من الفئة 3
const DEFAULT_OPENING_OFFSET_ACCOUNTS = ["321", "331"];
// مستخدم المخزون فقط قد لا يقرأ دليل الحسابات: تُستخدم الحسابات الافتراضية السابقة حتى يستطيع الحفظ
const LEGACY_DEFAULT_ACCOUNTS = { inventory: "1151", cogs: "511", revenue: "411" };
// نسب الضريبة المعروضة (فواتير المبيعات بنسبة 15% دائمًا)
const VAT_RATE_OPTIONS = [15, 0];

const toNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const round2 = (value: number) => Math.round(value * 100) / 100;
const round4 = (value: number) => Math.round(value * 10000) / 10000;
// حقل رقمي يُحفظ نصًا أثناء الكتابة (يقبل الفاصلة العشرية) ويُرسل رقمًا
const numberText = (value: number) => (value ? String(round4(value)) : "");
const parseInput = (value: string) => (value.trim() === "" ? 0 : Number(value));
/** السعر الشامل من السعر قبل الضريبة (هللتان)، والعكس بأربع خانات كما يحفظه الخادم */
const grossOf = (net: number, rate: number) => round2(net * (1 + rate / 100));
const netOf = (gross: number, rate: number) => round4(gross / (1 + rate / 100));

export default function InventoryProducts() {
  const { t, direction, formatNumber, locale } = useI18n();
  const [products, setProducts] = useState<Product[]>([]);
  const [stock, setStock] = useState<Map<string, CatalogItem> | null>(null);
  const [warehouses, setWarehouses] = useState<CatalogWarehouse[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [editingId, setEditingId] = useState<string | null | undefined>(undefined);
  const [sku, setSku] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [itemType, setItemType] = useState<"product" | "service">("product");
  const [unit, setUnit] = useState("قطعة");
  const [inventoryAccount, setInventoryAccount] = useState("");
  const [cogsAccount, setCogsAccount] = useState("");
  const [revenueAccount, setRevenueAccount] = useState("");
  const [purchaseAccount, setPurchaseAccount] = useState("");
  // الأسعار كما تُكتب: شاملة الضريبة إن كان المفتاح مفعّلًا، وإلا قبلها
  const [salePrice, setSalePriceText] = useState("");
  const [purchasePrice, setPurchasePriceText] = useState("");
  // السعر قبل الضريبة الذي عُرض منه النص (تحميل أو تبديل المفتاح)؛ يُرسل كما هو ما لم يُكتب السعر من جديد
  const [saleBaseNet, setSaleBaseNet] = useState<number | null>(null);
  const [purchaseBaseNet, setPurchaseBaseNet] = useState<number | null>(null);
  const setSalePrice = (text: string) => { setSalePriceText(text); setSaleBaseNet(null); };
  const setPurchasePrice = (text: string) => { setPurchasePriceText(text); setPurchaseBaseNet(null); };
  const [pricesIncludeVat, setPricesIncludeVat] = useState(false);
  const [vatRate, setVatRate] = useState(15);
  const [barcode, setBarcode] = useState("");
  const [reorderLevel, setReorderLevel] = useState("");
  const [description, setDescription] = useState("");
  const [active, setActive] = useState(true);
  // S18: رصيد افتتاحي من بطاقة الصنف (اختياري)
  const [openingQuantity, setOpeningQuantity] = useState("");
  const [openingWarehouse, setOpeningWarehouse] = useState("");
  const [openingCost, setOpeningCost] = useState("");
  const [openingOffset, setOpeningOffset] = useState("");

  const money = (value: number) => formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const quantity = (value: number) => formatNumber(value, { maximumFractionDigits: 4 });

  const load = async () => {
    setLoading(true);
    setError("");
    // select("*"): الأعمدة الجديدة تُقرأ إن وُجدت، والصفحة تعمل قبلها
    const [productResult, accountResult, catalogResult] = await Promise.all([
      selectAllRows((from, to) => supabase.from("inventory_products").select("*").order("sku").order("id").range(from, to)),
      selectAllRows((from, to) => supabase.from("accounting_accounts").select("code, name_ar, parent_code").order("code").range(from, to)),
      supabase.rpc("list_item_catalog", { p_include_inactive: true }),
    ]);
    if (productResult.error) {
      setError(inventoryErrorText(productResult.error.message, t));
      setLoading(false);
      return;
    }
    // تعذر قراءة الدليل (صلاحية) لا يمنع عرض الأصناف: تبقى القائمة فارغة وتُستخدم الحسابات الافتراضية السابقة
    const allAccounts = (accountResult.error ? [] : accountResult.data ?? []) as Account[];
    setAccounts(allAccounts.filter((account) => !allAccounts.some((child) => child.parent_code === account.code)));
    setAccountsLoaded(true);
    // الكميات المتوفرة والمستودعات من القائمة؛ بلا صلاحية يبقى العمود «—»
    const catalog = catalogResult.error ? null : parseCatalog(catalogResult.data);
    setStock(catalog ? new Map(catalog.items.map((item) => [item.id, item] as const)) : null);
    setWarehouses(catalog?.warehouses ?? []);
    setProducts((productResult.data ?? []).map((row) => ({
      id: String(row.id),
      sku: String(row.sku),
      nameAr: String(row.name_ar),
      nameEn: String(row.name_en ?? ""),
      itemType: row.item_type as Product["itemType"],
      unit: String(row.unit),
      inventoryAccountCode: String(row.inventory_account_code ?? ""),
      cogsAccountCode: String(row.cogs_account_code ?? ""),
      revenueAccountCode: String(row.revenue_account_code ?? ""),
      active: Boolean(row.active),
      salePrice: toNumber(row.sale_price),
      purchasePrice: toNumber(row.purchase_price),
      description: String(row.description ?? ""),
      barcode: String(row.barcode ?? ""),
      reorderLevel: toNumber(row.reorder_level),
      purchaseAccountCode: String(row.purchase_account_code ?? ""),
      pricesIncludeVat: row.prices_include_vat === true,
      vatRate: row.vat_rate === null || row.vat_rate === undefined ? 15 : toNumber(row.vat_rate),
    })));
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const availableOf = (product: Product) => stock?.get(product.id)?.quantity ?? null;
  const levelOf = (product: Product) => {
    const item = stock?.get(product.id);
    return item && product.itemType === "product" ? stockLevel(item, item.quantity) : "ok";
  };

  const totals = useMemo(() => ({
    products: products.filter((item) => item.itemType === "product").length,
    services: products.filter((item) => item.itemType === "service").length,
    active: products.filter((item) => item.active).length,
    low: products.filter((item) => item.active && item.itemType === "product" && levelOf(item) !== "ok").length,
  }), [products, stock]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products
      .filter((item) => typeFilter === "all" || item.itemType === typeFilter)
      .filter((item) => !needle || [item.nameAr, item.nameEn, item.sku, item.barcode, item.description]
        .some((part) => part.toLowerCase().includes(needle)));
  }, [products, query, typeFilter]);

  // أول حساب طرفي موجود من القائمة المفضلة، وإلا يبقى الاختيار فارغًا ليحدده المستخدم.
  // دليل غير مقروء (بلا صفوف): الحسابات الافتراضية السابقة 1151/511/411
  const defaultAccounts = useMemo(() => {
    if (!accountsLoaded) return { inventory: "", cogs: "", revenue: "", opening: "" };
    if (accounts.length === 0) return { ...LEGACY_DEFAULT_ACCOUNTS, opening: "" };
    const pick = (codes: string[]) => codes.find((code) => accounts.some((account) => account.code === code)) ?? "";
    return {
      inventory: pick(DEFAULT_INVENTORY_ACCOUNTS),
      cogs: pick(DEFAULT_COGS_ACCOUNTS),
      revenue: pick(DEFAULT_REVENUE_ACCOUNTS),
      opening: pick(DEFAULT_OPENING_OFFSET_ACCOUNTS) || accounts.find((account) => account.code.startsWith("3"))?.code || "",
    };
  }, [accounts, accountsLoaded]);
  // الاستيراد من إكسل بالحسابات الافتراضية نفسها
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const importSpec = useMemo(() => productsImportSpec(defaultAccounts, t), [defaultAccounts, locale]);
  // إن فُتح نموذج صنف جديد قبل اكتمال تحميل الدليل تُملأ الحسابات الفارغة عند وصوله
  useEffect(() => {
    if (editingId !== undefined) setOpeningOffset((current) => current || defaultAccounts.opening);
    if (editingId !== null) return;
    setInventoryAccount((current) => current || defaultAccounts.inventory);
    setCogsAccount((current) => current || defaultAccounts.cogs);
    setRevenueAccount((current) => current || defaultAccounts.revenue);
  }, [defaultAccounts]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetOpening = () => {
    setOpeningQuantity(""); setOpeningCost("");
    setOpeningWarehouse(warehouses.length === 1 ? warehouses[0].id : "");
    setOpeningOffset(defaultAccounts.opening);
  };
  const reset = () => {
    setEditingId(undefined);
    setSku(""); setNameAr(""); setNameEn(""); setItemType("product"); setUnit("قطعة");
    setInventoryAccount(defaultAccounts.inventory); setCogsAccount(defaultAccounts.cogs); setRevenueAccount(defaultAccounts.revenue);
    setPurchaseAccount(""); setSalePrice(""); setPurchasePrice(""); setPricesIncludeVat(false); setVatRate(15);
    setBarcode(""); setReorderLevel(""); setDescription("");
    setActive(true); setError(""); resetOpening();
  };
  const startNew = () => { reset(); setEditingId(null); };
  const startEdit = (product: Product) => {
    // التعديل يبقي حسابات الصنف المحفوظة؛ الافتراضي فقط لحساب فارغ (خدمة تتحول إلى منتج مخزني)
    setEditingId(product.id); setSku(product.sku); setNameAr(product.nameAr); setNameEn(product.nameEn);
    setItemType(product.itemType); setUnit(product.unit); setInventoryAccount(product.inventoryAccountCode || defaultAccounts.inventory);
    setCogsAccount(product.cogsAccountCode || defaultAccounts.cogs); setRevenueAccount(product.revenueAccountCode);
    setPurchaseAccount(product.purchaseAccountCode);
    // السعر يُعرض كما أُدخل: شاملًا إن كان الصنف بأسعار شاملة الضريبة
    setPricesIncludeVat(product.pricesIncludeVat); setVatRate(product.vatRate);
    const shown = (net: number) => (product.pricesIncludeVat ? grossOf(net, product.vatRate) : net);
    setSalePriceText(numberText(shown(product.salePrice))); setSaleBaseNet(product.salePrice);
    setPurchasePriceText(numberText(shown(product.purchasePrice))); setPurchaseBaseNet(product.purchasePrice);
    setBarcode(product.barcode); setReorderLevel(numberText(product.reorderLevel)); setDescription(product.description);
    setActive(product.active); setError(""); resetOpening();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const netPrice = (text: string, baseNet: number | null = null) => {
    if (baseNet !== null) return baseNet;
    const value = parseInput(text);
    if (!Number.isFinite(value) || value < 0) return 0;
    return pricesIncludeVat ? netOf(value, vatRate) : round4(value);
  };
  // مفتاح «شامل الضريبة»: السعر نفسه يُعرض بالطريقة الأخرى (لا يتغير السعر الفعلي قبل الضريبة)
  const toggleIncludeVat = () => {
    const next = !pricesIncludeVat;
    const convert = (text: string, baseNet: number | null, setText: (value: string) => void, setBase: (value: number | null) => void) => {
      const value = parseInput(text);
      if (!Number.isFinite(value) || value <= 0) return;
      const net = netPrice(text, baseNet);
      setText(numberText(next ? grossOf(net, vatRate) : net));
      setBase(net);
    };
    convert(salePrice, saleBaseNet, setSalePriceText, setSaleBaseNet);
    convert(purchasePrice, purchaseBaseNet, setPurchasePriceText, setPurchaseBaseNet);
    setPricesIncludeVat(next);
  };
  // تغيير النسبة: السعر المكتوب يبقى كما هو (الشامل يبقى شاملًا)
  const changeVatRate = (rate: number) => {
    if (pricesIncludeVat) { setSaleBaseNet(null); setPurchaseBaseNet(null); }
    setVatRate(rate);
  };

  const editingProduct = editingId ? products.find((product) => product.id === editingId) : undefined;
  const editingStock = editingId ? stock?.get(editingId) : undefined;
  const openingWarehouseQuantity = editingStock && openingWarehouse ? stockIn(editingStock, openingWarehouse) : 0;

  const save = async () => {
    if (!nameAr.trim() || !unit.trim() || !revenueAccount || (itemType === "product" && (!inventoryAccount || !cogsAccount))) {
      setError(t("أكمل بيانات الصنف والحسابات المطلوبة"));
      return;
    }
    const prices = [salePrice, purchasePrice, reorderLevel].map(parseInput);
    if (prices.some((value) => !Number.isFinite(value) || value < 0)) {
      setError(t("الأسعار وحد إعادة الطلب أرقام موجبة أو صفر"));
      return;
    }
    // تُرسل الأسعار قبل الضريبة (بأربع خانات)، والطريقة والنسبة لعرضها في البطاقة
    const saleNet = netPrice(salePrice, saleBaseNet);
    const purchaseNet = netPrice(purchasePrice, purchaseBaseNet);
    // الرصيد الافتتاحي: كمية ومستودع وتكلفة وحدة (الافتراضي سعر الشراء قبل الضريبة) وحساب مقابل
    const openingQty = itemType === "product" ? parseInput(openingQuantity) : 0;
    const openingUnitCost = openingCost.trim() === "" ? purchaseNet : parseInput(openingCost);
    if (!Number.isFinite(openingQty) || openingQty < 0) {
      setError(t("الكمية الافتتاحية رقم موجب"));
      return;
    }
    if (openingQty > 0) {
      if (!active) { setError(t("الرصيد الافتتاحي لصنف نشط فقط")); return; }
      if (!openingWarehouse) { setError(t("اختر مستودع الرصيد الافتتاحي")); return; }
      if (!Number.isFinite(openingUnitCost) || openingUnitCost <= 0) { setError(t("أدخل تكلفة الوحدة للرصيد الافتتاحي (قبل الضريبة)")); return; }
      if (!openingOffset) { setError(t("اختر الحساب المقابل للرصيد الافتتاحي")); return; }
    }
    setBusy(true); setError("");
    const { data: savedId, error: saveError } = await supabase.rpc("save_inventory_product", {
      p_id: editingId || null,
      p_product: {
        sku: sku.trim(), nameAr: nameAr.trim(), nameEn: nameEn.trim(), itemType, unit: unit.trim(),
        inventoryAccountCode: itemType === "product" ? inventoryAccount : null,
        cogsAccountCode: itemType === "product" ? cogsAccount : null,
        revenueAccountCode: revenueAccount, active,
        salePrice: saleNet, purchasePrice: purchaseNet, pricesIncludeVat, vatRate,
        reorderLevel: itemType === "product" ? prices[2] : 0,
        barcode: barcode.trim(), description: description.trim(),
        purchaseAccountCode: itemType === "service" ? purchaseAccount || null : null,
      },
    });
    if (saveError) { setBusy(false); setError(inventoryErrorText(saveError.message, t)); return; }
    const productId = String(savedId ?? editingId ?? "");
    if (openingQty > 0 && productId) {
      const { data: opening, error: openingError } = await supabase.rpc("post_product_opening_stock", {
        p_product_id: productId,
        p_warehouse_id: openingWarehouse,
        p_quantity: openingQty,
        p_unit_cost: openingUnitCost,
        p_offset_account_code: openingOffset,
      });
      setBusy(false);
      if (openingError) {
        // الصنف محفوظ: يبقى النموذج مفتوحًا عليه لتصحيح الرصيد الافتتاحي
        await load();
        setEditingId(productId);
        setError(`${t("حُفظ الصنف، وتعذّر تسجيل الرصيد الافتتاحي")}: ${inventoryErrorText(openingError.message, t)}`);
        return;
      }
      const number = String((opening as { opening_number?: unknown } | null)?.opening_number ?? "");
      toast({
        title: t(editingId ? "تم تحديث الصنف" : "تم إنشاء الصنف"),
        description: `${t("سُجّل رصيد افتتاحي")}: ${quantity(openingQty)} ${unit.trim()}${number ? ` (${number})` : ""}`,
      });
    } else {
      setBusy(false);
      toast({ title: t(editingId ? "تم تحديث الصنف" : "تم إنشاء الصنف") });
    }
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

  const AccountSelect = ({ label, value, onChange, prefix, optional }: { label: string; value: string; onChange: (value: string) => void; prefix: string; optional?: boolean }) => {
    const options = accounts.filter((account) => account.code.startsWith(prefix));
    return (
      <label className="text-xs text-slate-600">{t(label)}
        <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-10 w-full rounded border px-2 text-sm">
          <option value="">{t(optional ? "الحساب الافتراضي للمشتريات" : "اختر حسابًا طرفيًا")}</option>
          {/* الحساب المحفوظ أو الافتراضي يظهر ولو لم يكن الدليل مقروءًا */}
          {value && !options.some((account) => account.code === value) && <option value={value}>{value}</option>}
          {options.map((account) => <option key={account.code} value={account.code}>{account.code} — {account.name_ar}</option>)}
        </select>
      </label>
    );
  };

  const numberInput = (label: string, value: string, onChange: (value: string) => void, hint?: string) => (
    <label className="text-xs text-slate-600">{t(label)}
      <input inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" dir="ltr" className="mt-1 h-10 w-full rounded border px-3 text-start" />
      {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );

  // تحت السعر: الوجه الآخر له (قبل الضريبة والضريبة، أو الشامل)
  const priceHint = (text: string, baseNet: number | null, fallback: string) => {
    const value = parseInput(text);
    if (!Number.isFinite(value) || value <= 0) return t(fallback);
    if (pricesIncludeVat) {
      const net = netPrice(text, baseNet);
      return `${t("قبل الضريبة")}: ${money(net)} — ${t("الضريبة")}: ${money(round4(value - net))}`;
    }
    return `${t("شامل الضريبة")}: ${money(grossOf(value, vatRate))}`;
  };

  const levelBadge = (product: Product) => {
    const level = levelOf(product);
    if (level === "ok") return null;
    return <span className={`ms-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${level === "out" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}><AlertTriangle className="h-3 w-3" />{t(level === "out" ? "نفد" : "تحت حد الطلب")}</span>;
  };

  const priceCell = (product: Product, net: number) => net
    ? <>{money(net)}{product.pricesIncludeVat && <p className="text-[11px] text-slate-400">{t("شامل")}: {money(grossOf(net, product.vatRate))}</p>}</>
    : "—";

  const rateOptions = VAT_RATE_OPTIONS.includes(vatRate) ? VAT_RATE_OPTIONS : [...VAT_RATE_OPTIONS, vatRate];
  const warehouseName = (id: string) => {
    const warehouse = warehouses.find((row) => row.id === id);
    return warehouse ? `${warehouse.code} — ${warehouse.nameAr}` : id.slice(0, 8);
  };

  return <Layout><main dir={direction} className="space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3"><div className="rounded-lg bg-emerald-50 p-2 text-emerald-700"><Boxes className="h-6 w-6" /></div><div><h1 className="text-2xl font-bold text-slate-900">{t("المنتجات والخدمات")}</h1><p className="mt-1 text-sm text-slate-500">{t("الأسعار والكميات المتوفرة، وربط الأصناف بحسابات المخزون والتكلفة والإيراد. تُختار في بنود الفواتير والعروض والأوامر.")}</p></div></div>
      <div className="flex flex-wrap items-center gap-2">
        <DataImportButton spec={importSpec} onDone={() => void load()} />
        <button onClick={startNew} className="inline-flex items-center gap-2 rounded bg-emerald-700 px-4 py-2 text-sm font-semibold text-white"><PackagePlus className="h-4 w-4" />{t("صنف أو خدمة جديدة")}</button>
      </div>
    </header>

    {error && <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
    <section className="grid gap-3 grid-cols-2 md:grid-cols-4">{([["المنتجات", totals.products], ["الخدمات", totals.services], ["النشطة", totals.active], ["تحت حد الطلب أو نافدة", totals.low]] as Array<[string, number]>).map(([label, value]) => <div key={label} className="rounded-xl border bg-white p-4"><p className="text-xs text-slate-500">{t(label)}</p><p className={`mt-2 text-xl font-bold ${label === "تحت حد الطلب أو نافدة" && value > 0 ? "text-amber-600" : ""}`}>{value}</p></div>)}</section>

    {editingId !== undefined && <section className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between"><h2 className="font-bold">{t(editingId ? "تعديل الصنف أو الخدمة" : "صنف أو خدمة جديدة")}</h2><button onClick={reset} aria-label={t("إغلاق")}><X className="h-5 w-5" /></button></div>
      <div className="mb-4 inline-flex rounded-lg border p-1" role="group" aria-label={t("النوع")}>
        {(["product", "service"] as const).map((value) => <button key={value} type="button" onClick={() => setItemType(value)} aria-pressed={itemType === value} className={`inline-flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-semibold ${itemType === value ? (value === "product" ? "bg-sky-600 text-white" : "bg-violet-600 text-white") : "text-slate-600 hover:bg-slate-50"}`}>{value === "product" ? <Boxes className="h-4 w-4" /> : <Wrench className="h-4 w-4" />}{t(value === "product" ? "منتج مخزني" : "خدمة")}</button>)}
      </div>
      <p className="mb-4 text-xs text-slate-500">{t(itemType === "product" ? "المنتج له كمية في المستودعات: يُصرف مع فاتورة المبيعات ويُستلم مع فاتورة المشتريات، وتُسجَّل تكلفته." : "الخدمة بلا مخزون ولا تكلفة: إيراد عند البيع، ومصروف عند الشراء.")}</p>

      <h3 className="mb-2 text-sm font-semibold text-slate-700">{t("البيانات الأساسية")}</h3>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-xs text-slate-600">{t("الاسم العربي")}<input value={nameAr} onChange={(event) => setNameAr(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label>
        <label className="text-xs text-slate-600">{t("الاسم الإنجليزي")}<input value={nameEn} onChange={(event) => setNameEn(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label>
        <label className="text-xs text-slate-600">{t("وحدة القياس")}<input value={unit} onChange={(event) => setUnit(event.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label>
        <label className="text-xs text-slate-600">{t("رمز الصنف")}<input value={sku} onChange={(event) => setSku(event.target.value.toUpperCase())} placeholder={t("تلقائي عند تركه فارغًا")} dir="ltr" className="mt-1 h-10 w-full rounded border px-3 text-start" /></label>
        <label className="text-xs text-slate-600">{t("الباركود")}<input value={barcode} onChange={(event) => setBarcode(event.target.value.toUpperCase())} placeholder={t("اختياري")} dir="ltr" className="mt-1 h-10 w-full rounded border px-3 text-start" /></label>
        <label className="flex items-center gap-2 self-end rounded border px-3 py-2 text-sm"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />{t("نشط")}</label>
        <label className="text-xs text-slate-600 md:col-span-3">{t("الوصف")}<textarea value={description} onChange={(event) => setDescription(event.target.value.slice(0, 500))} rows={2} placeholder={t("اختياري — يظهر في عرض السعر عند اختيار الصنف")} className="mt-1 w-full rounded border px-3 py-2 text-sm" /></label>
      </div>

      <div className="mb-2 mt-5 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-700">{t("الأسعار")}</h3>
        <div className="flex flex-wrap items-center gap-4">
          {/* S18: مفتاح «الأسعار شاملة الضريبة» ونسبة الضريبة */}
          <button
            type="button"
            role="switch"
            aria-checked={pricesIncludeVat}
            onClick={toggleIncludeVat}
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-700"
          >
            <span className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${pricesIncludeVat ? "bg-emerald-600" : "bg-slate-300"}`}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${pricesIncludeVat ? "start-[22px]" : "start-0.5"}`} />
            </span>
            {t("الأسعار شاملة الضريبة")}
          </button>
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            {t("نسبة الضريبة")}
            <select value={String(vatRate)} onChange={(event) => changeVatRate(Number(event.target.value))} className="h-9 rounded border px-2 text-sm">
              {rateOptions.map((rate) => <option key={rate} value={String(rate)}>{rate}%</option>)}
            </select>
          </label>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {numberInput(pricesIncludeVat ? "سعر البيع (شامل الضريبة)" : "سعر البيع (قبل الضريبة)", salePrice, setSalePrice, priceHint(salePrice, saleBaseNet, "يُقترح في بنود المبيعات ويمكن تعديله"))}
        {numberInput(pricesIncludeVat ? "سعر الشراء (شامل الضريبة)" : "سعر الشراء (قبل الضريبة)", purchasePrice, setPurchasePrice, priceHint(purchasePrice, purchaseBaseNet, "يُقترح في بنود المشتريات ويمكن تعديله"))}
        {itemType === "product" && numberInput("حد إعادة الطلب", reorderLevel, setReorderLevel, t("تنبيه عندما تنزل الكمية المتوفرة إليه"))}
      </div>
      <p className="mt-2 text-[11px] text-slate-400">{t("يُحفظ السعر قبل الضريبة، وتُحسب الضريبة في البنود. فاتورة المبيعات بنسبة 15% وسعر الوحدة فيها بخانتين، فقد تختلف الكميات الكبيرة بهللات عن السعر الشامل.")}</p>

      {itemType === "product" && <>
        <h3 className="mb-2 mt-5 text-sm font-semibold text-slate-700">{t("المخزون")}</h3>
        {editingId && <div className="mb-3 rounded-lg border bg-slate-50 px-3 py-2 text-sm">
          <span className="font-semibold">{t("الكمية المتوفرة")}: </span>
          {editingStock ? <span className="tabular-nums">{quantity(editingStock.quantity)} {editingProduct?.unit ?? unit}</span> : "—"}
          {editingStock && editingStock.warehouses.length > 0 && <span className="ms-2 text-xs text-slate-500">
            ({editingStock.warehouses.map((entry) => `${warehouseName(entry.warehouseId)}: ${quantity(entry.quantity)}`).join("، ")})
          </span>}
        </div>}
        <p className="mb-2 text-xs font-semibold text-slate-600">{t("رصيد افتتاحي (اختياري)")}</p>
        <div className="grid gap-3 md:grid-cols-4">
          {numberInput("الكمية", openingQuantity, setOpeningQuantity)}
          <label className="text-xs text-slate-600">{t("المستودع")}
            <select value={openingWarehouse} onChange={(event) => setOpeningWarehouse(event.target.value)} className="mt-1 h-10 w-full rounded border px-2 text-sm">
              <option value="">{t("اختر المستودع")}</option>
              {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} — {warehouse.nameAr}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-600">{t("تكلفة الوحدة (قبل الضريبة)")}
            <input inputMode="decimal" value={openingCost} onChange={(event) => setOpeningCost(event.target.value.replace(/[^0-9.]/g, ""))} placeholder={netPrice(purchasePrice, purchaseBaseNet) ? String(netPrice(purchasePrice, purchaseBaseNet)) : "0"} dir="ltr" className="mt-1 h-10 w-full rounded border px-3 text-start" />
          </label>
          <AccountSelect label="الحساب المقابل (حقوق الملكية)" value={openingOffset} onChange={setOpeningOffset} prefix="3" />
        </div>
        {openingWarehouseQuantity !== 0 && parseInput(openingQuantity) > 0
          ? <p className="mt-2 text-xs text-amber-700">{t("للصنف حركات في هذا المستودع؛ الرصيد الافتتاحي لمستودع بلا حركات. عدّل الكمية بسند استلام أو صرف أو بالجرد.")}</p>
          : <p className="mt-2 text-xs text-slate-500">{t("عند الحفظ يُسجَّل سند رصيد افتتاحي مرحّل: مدين المخزون / دائن الحساب المقابل. لمستودع لا حركة فيه لهذا الصنف؛ بعدها تتغير الكمية بسندات الاستلام والصرف والجرد والفواتير.")}</p>}
      </>}

      <h3 className="mb-2 mt-5 text-sm font-semibold text-slate-700">{t("الحسابات")}</h3>
      <div className="grid gap-3 md:grid-cols-3">
        {itemType === "product" && <><AccountSelect label="حساب أصل المخزون" value={inventoryAccount} onChange={setInventoryAccount} prefix="115" /><AccountSelect label="حساب تكلفة المبيعات" value={cogsAccount} onChange={setCogsAccount} prefix="5" /></>}
        <AccountSelect label="حساب الإيراد" value={revenueAccount} onChange={setRevenueAccount} prefix="4" />
        {itemType === "service" && <AccountSelect label="حساب مصروف الشراء" value={purchaseAccount} onChange={setPurchaseAccount} prefix="5" optional />}
      </div>
      {itemType === "product" && <p className="mt-2 text-xs text-slate-500">{t("عند الشراء يُسجَّل المنتج على حساب البضاعة المستلمة غير المفوترة، ويُقفل مع سند الاستلام.")}</p>}
      <div className="mt-4 flex justify-end"><button disabled={busy} onClick={() => void save()} className="inline-flex items-center gap-2 rounded bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{t("حفظ")}</button></div>
    </section>}

    <section className="overflow-hidden rounded-xl border bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b p-3">
        <label className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 start-3" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("ابحث بالاسم أو الرمز أو الباركود")} className="h-9 w-full rounded border ps-9 pe-3 text-sm" /></label>
        <div className="flex gap-1.5" role="group" aria-label={t("النوع")}>{([["all", "الكل"], ["product", "منتجات"], ["service", "خدمات"]] as Array<[TypeFilter, string]>).map(([value, label]) => <button key={value} type="button" onClick={() => setTypeFilter(value)} aria-pressed={typeFilter === value} className={`rounded-full border px-3 py-1 text-xs font-semibold ${typeFilter === value ? "border-emerald-700 bg-emerald-700 text-white" : "border-slate-200 text-slate-600"}`}>{t(label)}</button>)}</div>
      </div>
      <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-100 text-slate-600"><tr><th className="p-3">{t("الرمز")}</th><th className="p-3">{t("الصنف أو الخدمة")}</th><th className="p-3">{t("النوع")}</th><th className="p-3">{t("الوحدة")}</th><th className="p-3">{t("سعر البيع")}</th><th className="p-3">{t("سعر الشراء")}</th><th className="p-3">{t("المتوفر")}</th><th className="p-3">{t("الحسابات")}</th><th className="p-3">{t("الحالة")}</th><th className="p-3">{t("الإجراءات")}</th></tr></thead><tbody>
        {loading ? <tr><td colSpan={10} className="py-14 text-center">{t("جاري التحميل...")}</td></tr> : visible.length === 0 ? <tr><td colSpan={10} className="py-14 text-center text-slate-400">{t(products.length ? "لا توجد نتائج مطابقة" : "لا توجد منتجات أو خدمات")}</td></tr> : visible.map((product) => {
          const available = availableOf(product);
          return <tr key={product.id} className="border-t">
            <td className="p-3 font-mono" dir="ltr">{product.sku}{product.barcode && <p className="text-[11px] text-slate-400">{product.barcode}</p>}</td>
            <td className="p-3"><p className="font-semibold">{product.nameAr}</p><p className="text-xs text-slate-500">{product.nameEn || "—"}</p></td>
            <td className="p-3 text-center"><span className={`rounded px-2 py-0.5 text-xs font-semibold ${product.itemType === "product" ? "bg-sky-50 text-sky-800" : "bg-violet-50 text-violet-800"}`}>{t(product.itemType === "product" ? "منتج مخزني" : "خدمة")}</span></td>
            <td className="p-3 text-center">{product.unit}</td>
            <td className="p-3 text-center tabular-nums">{priceCell(product, product.salePrice)}</td>
            <td className="p-3 text-center tabular-nums">{priceCell(product, product.purchasePrice)}</td>
            <td className="p-3 text-center tabular-nums">{product.itemType === "service" ? <span className="text-slate-400">{t("لا ينطبق")}</span> : available === null ? "—" : <>{quantity(available)}{levelBadge(product)}</>}</td>
            <td className="p-3 text-xs"><p>{t("الإيراد")}: {product.revenueAccountCode}</p>{product.itemType === "product" ? <p>{t("المخزون")}: {product.inventoryAccountCode} · {t("التكلفة")}: {product.cogsAccountCode}</p> : product.purchaseAccountCode ? <p>{t("الشراء")}: {product.purchaseAccountCode}</p> : null}</td>
            <td className="p-3 text-center"><span className={`rounded px-2 py-1 text-xs font-semibold ${product.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{t(product.active ? "نشط" : "غير نشط")}</span></td>
            <td className="p-3"><div className="flex justify-center gap-1"><button onClick={() => startEdit(product)} className="rounded border p-1.5" title={t("تعديل")} aria-label={t("تعديل")}><Edit3 className="h-4 w-4" /></button><button onClick={() => void remove(product)} className="rounded border border-red-200 p-1.5 text-red-600" title={t("حذف")} aria-label={t("حذف")}><Trash2 className="h-4 w-4" /></button></div></td>
          </tr>;
        })}
      </tbody></table></div>
    </section>
  </main></Layout>;
}
