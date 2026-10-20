/**
 * S17: اختيار منتج أو خدمة لبند مستند (فاتورة المبيعات، عرض السعر، أمر البيع، فاتورة المشتريات).
 * - نافذة بحث بالاسم أو الرمز أو الباركود، مع النوع والسعر والكمية المتوفرة للمنتج في المستودع المختار.
 * - البند يبقى قابلًا للتعديل بعد الاختيار (الوصف والسعر)، و«بند حر» يفك الربط.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Boxes, Link2Off, PackageSearch, Search, Wrench, X } from "lucide-react";
import { useI18n } from "@/i18n";
import {
  itemMatches,
  roundQuantity,
  stockIn,
  stockLevel,
  type CatalogItem,
  type CatalogWarehouse,
} from "@/lib/itemCatalog";

type PriceKind = "sale" | "purchase";
type TypeFilter = "all" | "product" | "service";

const levelClass = {
  out: "text-red-600",
  low: "text-amber-600",
  ok: "text-emerald-700",
} as const;

function useMoney() {
  const { formatNumber } = useI18n();
  // S18: الأسعار قبل الضريبة بأربع خانات (السعر الشامل يعود كما أُدخل)
  return (value: number) => formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function useQuantity() {
  const { formatNumber } = useI18n();
  return (value: number) => formatNumber(value, { maximumFractionDigits: 4 });
}

export function ItemPickerDialog({
  items,
  warehouses,
  warehouseId,
  priceKind,
  selectedId,
  onSelect,
  onClose,
}: {
  items: CatalogItem[];
  warehouses: CatalogWarehouse[];
  warehouseId?: string | null;
  priceKind: PriceKind;
  selectedId?: string;
  onSelect: (item: CatalogItem | null) => void;
  onClose: () => void;
}) {
  const { t, direction } = useI18n();
  const money = useMoney();
  const qty = useQuantity();
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const inputRef = useRef<HTMLInputElement>(null);
  const warehouse = warehouses.find((row) => row.id === warehouseId);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const visible = useMemo(
    () =>
      items
        .filter((item) => item.active)
        .filter((item) => typeFilter === "all" || item.itemType === typeFilter)
        .filter((item) => itemMatches(item, query))
        .slice(0, 200),
    [items, query, typeFilter],
  );

  const priceOf = (item: CatalogItem) => (priceKind === "sale" ? item.salePrice : item.purchasePrice);

  return createPortal(
    <div
      dir={direction}
      className="fixed inset-0 z-[100] flex items-start justify-center bg-slate-950/40 p-4 pt-[8vh]"
      onMouseDown={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t("اختر منتجًا أو خدمة")}
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-slate-800">{t("اختر منتجًا أو خدمة")}</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {warehouse
                ? `${t("الكمية المتوفرة في المستودع")}: ${warehouse.code} — ${warehouse.nameAr}`
                : t("الكمية المتوفرة في كل المستودعات")}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-2 text-slate-500 hover:bg-slate-100" aria-label={t("إغلاق")}>
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="space-y-3 border-b border-slate-100 px-5 py-3">
          <label className="relative block">
            <Search className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 start-3" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && visible.length > 0) {
                  event.preventDefault();
                  onSelect(visible[0]);
                }
              }}
              placeholder={t("ابحث بالاسم أو الرمز أو الباركود")}
              className="h-10 w-full rounded-lg border border-slate-200 ps-9 pe-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
            />
          </label>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("النوع")}>
            {(
              [
                ["all", "الكل"],
                ["product", "منتجات"],
                ["service", "خدمات"],
              ] as Array<[TypeFilter, string]>
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setTypeFilter(value)}
                aria-pressed={typeFilter === value}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                  typeFilter === value
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {t(label)}
              </button>
            ))}
          </div>
        </div>

        <ul className="flex-1 overflow-y-auto">
          {visible.length === 0 ? (
            <li className="px-5 py-12 text-center text-sm text-slate-400">
              {items.length === 0
                ? t("لا توجد منتجات أو خدمات معرّفة. أضفها من «المنتجات والخدمات» في المخزون.")
                : t("لا توجد نتائج مطابقة")}
            </li>
          ) : (
            visible.map((item) => {
              const isProduct = item.itemType === "product";
              const available = stockIn(item, warehouseId);
              const level = stockLevel(item, available);
              const price = priceOf(item);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(item)}
                    className={`flex w-full items-center gap-3 border-b border-slate-100 px-5 py-3 text-start hover:bg-emerald-50/60 focus:bg-emerald-50 focus:outline-none ${
                      item.id === selectedId ? "bg-emerald-50" : ""
                    }`}
                  >
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                        isProduct ? "bg-sky-50 text-sky-700" : "bg-violet-50 text-violet-700"
                      }`}
                      aria-hidden
                    >
                      {isProduct ? <Boxes className="h-4 w-4" /> : <Wrench className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-800">{item.nameAr}</span>
                      <span className="mt-0.5 block truncate text-xs text-slate-500" dir="ltr">
                        {[item.sku, item.barcode].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="shrink-0 text-end">
                      <span className="block text-sm font-bold text-slate-800">
                        {price === null ? "—" : `${money(price)} ${t("ريال")}`}
                      </span>
                      <span className={`mt-0.5 block text-xs ${isProduct ? levelClass[level] : "text-slate-400"}`}>
                        {isProduct
                          ? `${t("متوفر")}: ${qty(available)} ${item.unit}`
                          : `${t("خدمة")} · ${item.unit}`}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>

        {selectedId && (
          <footer className="flex justify-start border-t border-slate-100 px-5 py-3">
            <button
              type="button"
              onClick={() => onSelect(null)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              <Link2Off className="h-3.5 w-3.5" />
              {t("بند حر (فك الربط بالصنف)")}
            </button>
          </footer>
        )}
      </section>
    </div>,
    document.body,
  );
}

/** زر البند: «اختر من الأصناف» أو الصنف المرتبط برمزه ونوعه */
export function ItemLinkButton({
  item,
  linkedId,
  onOpen,
  disabled,
}: {
  item?: CatalogItem;
  linkedId?: string;
  onOpen: () => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  if (!linkedId) {
    return (
      <button
        type="button"
        onClick={onOpen}
        disabled={disabled}
        className="mb-1.5 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-emerald-300 bg-emerald-50/50 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <PackageSearch className="h-3.5 w-3.5" />
        {t("اختر من المنتجات والخدمات")}
      </button>
    );
  }
  const isProduct = item ? item.itemType === "product" : true;
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled}
      title={t("تغيير الصنف")}
      className={`mb-1.5 inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold disabled:cursor-not-allowed ${
        isProduct ? "border-sky-200 bg-sky-50 text-sky-800" : "border-violet-200 bg-violet-50 text-violet-800"
      }`}
    >
      {isProduct ? <Boxes className="h-3.5 w-3.5 shrink-0" /> : <Wrench className="h-3.5 w-3.5 shrink-0" />}
      <span className="truncate" dir="ltr">{item?.sku ?? linkedId.slice(0, 8)}</span>
      <span className="shrink-0 font-normal opacity-80">· {t(isProduct ? "منتج" : "خدمة")}</span>
    </button>
  );
}

/**
 * تحت البند: الكمية المتوفرة للمنتج، وتنبيه إن زاد المطلوب عنها أو لم يُختر المستودع.
 * delivered: ما سُلّم بإشعارات تسليم سابقة مختارة (لا يُصرف مرة ثانية)
 */
export function StockHint({
  item,
  warehouseId,
  requested,
  delivered = 0,
  needsWarehouse,
}: {
  item?: CatalogItem;
  warehouseId?: string | null;
  requested: number;
  delivered?: number;
  needsWarehouse?: boolean;
}) {
  const { t } = useI18n();
  const qty = useQuantity();
  if (!item || item.itemType !== "product") return null;
  const remaining = Math.max(0, roundQuantity(requested - delivered));
  const deliveredNote = delivered > 0 ? `${t("مسلَّم بإشعار سابق")}: ${qty(delivered)} ${item.unit}` : "";
  if (delivered > 0 && remaining === 0) {
    return <p className="mt-1 text-xs text-sky-700">{deliveredNote}</p>;
  }
  if (needsWarehouse && !warehouseId) {
    return (
      <p className="mt-1 text-xs text-amber-600">
        {deliveredNote ? `${deliveredNote} — ` : ""}
        {t("اختر المستودع لمعرفة الكمية المتوفرة")}
      </p>
    );
  }
  const available = stockIn(item, warehouseId);
  const short = remaining > available;
  const level = short ? "out" : stockLevel(item, available - remaining);
  return (
    <p className={`mt-1 text-xs ${levelClass[level]}`}>
      {deliveredNote ? `${deliveredNote} — ` : ""}
      {t("متوفر")}: {qty(available)} {item.unit}
      {short ? ` — ${t("المطلوب أكثر من المتوفر")}` : level === "low" ? ` — ${t("تحت حد إعادة الطلب")}` : ""}
    </p>
  );
}
