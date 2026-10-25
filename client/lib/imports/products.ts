/**
 * استيراد الأصناف من إكسل: الاسم، والنوع، والوحدة، وسعر البيع، والباركود.
 * الحفظ بدالة save_inventory_product نفسها (الرمز يولّده الخادم، والحسابات الافتراضية للشاشة)،
 * والرصيد الافتتاحي لا يُستورد هنا: يُسجَّل من بطاقة الصنف أو «الأرصدة الافتتاحية».
 */
import { supabase } from "@/lib/supabaseClient";
import { selectAllRows } from "@/lib/ledgerData";
import { inventoryErrorText } from "@/lib/inventoryErrors";
import { cleanCell, cleanText, normalizeKey, parseAmount, pickOption, type ImportSpec, type Translate } from "@/lib/dataImport";

export type ProductDefaults = { inventory: string; cogs: string; revenue: string };
type ProductContext = { barcodes: Set<string>; names: Set<string> };
type ProductPayload = Record<string, unknown>;

const TYPE_OPTIONS = [
  { value: "product" as const, labels: ["منتج مخزني", "منتج", "مخزني", "صنف", "product", "item", "goods", "inventory", "stock"] },
  { value: "service" as const, labels: ["خدمة", "خدمي", "service", "services"] },
];

export function productsImportSpec(defaults: ProductDefaults, t: Translate): ImportSpec<ProductPayload, ProductContext> {
  // خيار القالب بلغة الواجهة يُقبل (والإنجليزية دائمًا من pickOption)
  const typeOptions = TYPE_OPTIONS.map((option) => ({ ...option, labels: [...option.labels, ...option.labels.map(t)] }));
  return {
    id: "inventory_products",
    title: "الأصناف",
    fileName: "قالب استيراد الأصناف",
    columns: [
      {
        key: "name", label: "اسم الصنف", required: true, width: 32, hint: "الاسم العربي للصنف أو الخدمة", example: "ورق تصوير A4",
        aliases: ["الاسم", "اسم المنتج", "الصنف", "المنتج", "البيان", "name", "item", "item name", "product", "product name", "description"],
      },
      {
        key: "type", label: "النوع", options: ["منتج مخزني", "خدمة"],
        hint: "منتج مخزني (له كمية في المستودع) أو خدمة؛ الافتراضي منتج مخزني", example: "منتج مخزني",
        aliases: ["نوع الصنف", "type", "item type", "product type"],
      },
      {
        key: "unit", label: "وحدة القياس", hint: "مثل قطعة أو كرتون أو كيلو؛ الافتراضي قطعة", example: "كرتون",
        aliases: ["الوحدة", "وحده", "unit", "uom", "unit of measure"],
      },
      {
        key: "price", label: "سعر البيع", kind: "number",
        hint: "قبل ضريبة القيمة المضافة، بخانتين على الأكثر؛ الافتراضي صفر (يُحدَّد في الفاتورة)", example: "200",
        aliases: ["السعر", "سعر الوحدة", "price", "sale price", "selling price", "unit price"],
      },
      {
        key: "barcode", label: "الباركود", kind: "text",
        hint: "اختياري: حروف إنجليزية وأرقام، ولا يتكرر", example: "6281000000001",
        aliases: ["باركود", "الرمز الشريطي", "barcode", "ean", "upc", "gtin"],
      },
    ],
    notes: [
      "رمز الصنف يولّده النظام تلقائيًا.",
      "النسبة الضريبية 15% والحسابات الافتراضية للأصناف؛ تُعدَّل من بطاقة الصنف.",
      "الكميات الافتتاحية لا تُستورد هنا؛ تُسجَّل من بطاقة الصنف أو «الأرصدة الافتتاحية».",
    ],

    prepare: async () => {
      if (!defaults.revenue || !defaults.inventory || !defaults.cogs) throw new Error(t("الحسابات الافتراضية للأصناف غير متاحة؛ تحقق من دليل الحسابات"));
      const result = await selectAllRows((from, to) => supabase.from("inventory_products").select("name_ar, barcode").order("id").range(from, to));
      if (result.error) throw new Error(inventoryErrorText(result.error.message, t));
      const barcodes = new Set<string>();
      const names = new Set<string>();
      (result.data as Array<{ name_ar?: string | null; barcode?: string | null }>).forEach((row) => {
        if (row.barcode) barcodes.add(String(row.barcode).toUpperCase());
        names.add(normalizeKey(String(row.name_ar ?? "")));
      });
      return { barcodes, names };
    },

    parse: (values, ctx) => {
      const name = cleanText(values.name);
      if (!name) return { error: t("اسم الصنف مطلوب") };
      if (name.length > 200) return { error: t("الاسم أطول من 200 حرف") };
      let itemType: "product" | "service" = "product";
      if (cleanCell(values.type)) {
        const picked = pickOption(values.type, typeOptions);
        if (!picked) return { error: `${t("النوع غير معروف")}: ${cleanCell(values.type)} — ${t("منتج مخزني")} / ${t("خدمة")}` };
        itemType = picked;
      }
      const unit = cleanText(values.unit) || "قطعة";
      if (unit.length > 30) return { error: t("وحدة القياس أطول من 30 حرفًا") };
      const priceText = cleanCell(values.price);
      const price = priceText ? parseAmount(priceText) : 0;
      if (price === null) return { error: t("سعر البيع رقم موجب بخانتين عشريتين على الأكثر") };
      const barcode = cleanCell(values.barcode).replace(/\s/g, "").toUpperCase();
      if (barcode && !/^[A-Z0-9._-]{1,50}$/.test(barcode)) return { error: t("الباركود حروف إنجليزية وأرقام فقط (حتى 50)") };
      if (barcode && ctx.barcodes.has(barcode)) return { error: t("الباركود مستخدم لصنف آخر في النظام") };
      const warning = ctx.names.has(normalizeKey(name)) ? t("يوجد صنف بالاسم نفسه في النظام؛ سيُضاف صنف آخر") : undefined;
      return {
        key: barcode ? `barcode:${barcode}` : null,
        warning,
        value: {
          sku: "", nameAr: name, nameEn: "", itemType, unit,
          inventoryAccountCode: itemType === "product" ? defaults.inventory : null,
          cogsAccountCode: itemType === "product" ? defaults.cogs : null,
          revenueAccountCode: defaults.revenue, active: true,
          salePrice: price, purchasePrice: 0, pricesIncludeVat: false, vatRate: 15,
          reorderLevel: 0, barcode, description: "", purchaseAccountCode: null,
        },
      };
    },

    save: async (product) => {
      const { error } = await supabase.rpc("save_inventory_product", { p_id: null, p_product: product });
      return error ? inventoryErrorText(error.message, t) : null;
    },
  };
}
