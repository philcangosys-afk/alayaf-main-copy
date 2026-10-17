import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Layout from "@/components/Layout";
import { purchasesFeatures } from "./Purchases";
import type { PurchaseOrderInvoiceSource } from "./PurchaseOrders";
import {
  Plus,
  Search,
  X,
  Trash2,
  ArrowLeftRight,
  Edit,
  Eye,
  Save,
  Loader2,
  FileText,
  CreditCard,
  Printer,
} from "lucide-react";
import {
  cn,
  riyadhDateString,
  SAUDI_STANDARD_VAT_RATE,
  SAUDI_VAT_NUMBER_PATTERN,
} from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabaseClient";
import { companyNumberLike, nextCompanyNumber, previewNextNumber } from "@/lib/companyNumbers";
import { useI18n } from "@/i18n";
import { COMPANY_PROFILE } from "@/lib/companyProfile";
import { dbErrorOr } from "@/lib/dbErrors";
import PartyRegistrationDialog from "@/components/PartyRegistrationDialog";
import { canManagePerm, checkPerm } from "@/lib/authSession";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import {
  PageHeader,
  FilterBar,
  FilterInput,
  FilterSelect,
  FilterActions,
  DataTable,
  ActionBtn,
} from "@/components/SalesPageUI";


/* ── Types ── */
type InvoiceItem = {
  id: number;
  description: string;
  unit: string;
  accountCode: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxPercent: number;
  // سعر البند وخصمه بعملة فاتورة المورد الأجنبي (للتوثيق؛ القيد بالريال)
  foreignUnitPrice?: number;
  foreignDiscount?: number;
};

// فاتورة المورد غير المقيم: خدمات (احتساب عكسي — الخانة 9)، بضائع (ضريبتها في البيان الجمركي — الخانة 8)، أو غير خاضعة
type ImportTreatment = "" | "reverse_charge" | "customs_goods" | "not_subject";
const IMPORT_TREATMENT_LABELS: Record<Exclude<ImportTreatment, "">, string> = {
  reverse_charge: "خدمات من مورد غير مقيم — احتساب عكسي 15% (الخانة 9)",
  customs_goods: "بضائع مستوردة — ضريبتها في البيان الجمركي (الخانة 8)",
  not_subject: "غير خاضعة لضريبة القيمة المضافة في المملكة",
};
const SUPPLIER_CURRENCIES = ["SAR", "USD", "EUR", "GBP", "AED", "CNY"];
// الحساب الوسيط لجمارك وضريبة استيراد دفعها المخلّص نيابة عنا (يُغلق بسطر في فاتورته)
const CUSTOMS_CLEARING_ACCOUNT = "2115";

type PurchaseExpenseAccount = { code: string; name_ar: string; parent_code: string | null };
type VendorOption = {
  id: string;
  name: string;
  vendor_number: string | null;
  tax_registration_mode?: string | null;
  tax_number?: string | null;
  currency?: string | null;
};

// حالة تسجيل المورد ضريبيًا: "yes" مسجل برقم صحيح، "no" غير مسجل، "" غير معروفة (فواتير قديمة)
type VendorVatState = "yes" | "no" | "";

const vendorVatState = (vendor?: {
  tax_registration_mode?: string | null;
  tax_number?: string | null;
}): VendorVatState =>
  vendor
    ? vendor.tax_registration_mode === "registered_sa" &&
      SAUDI_VAT_NUMBER_PATTERN.test(String(vendor.tax_number ?? "").trim())
      ? "yes"
      : "no"
    : "";

// تقريب لخانتين مطابق لـ round(x, 2) في القاعدة: نصف الهللة يُقرَّب بعيدًا عن الصفر،
// والضرب في 100 يُثبَّت أولًا حتى لا تُحوّل أخطاء الفاصلة العائمة 2.175 إلى 2.17
const round2 = (value: number) => {
  const rounded = Math.round(Number((Math.abs(value) * 100).toFixed(6))) / 100;
  return value < 0 ? -rounded : rounded;
};
const lineAmounts = (item: {
  quantity: number;
  unitPrice: number;
  discount: number;
  taxPercent: number;
}) => {
  const net = round2(
    (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0) -
      (Number(item.discount) || 0),
  );
  const tax = round2((net * (Number(item.taxPercent) || 0)) / 100);
  return { net, tax, total: round2(net + tax) };
};
// البند بعملة المورد → بالريال بسعر الصرف (السعر بست خانات والخصم بخانتين، ثم تقريب القاعدة نفسه للبند)
const toSarItem = (item: InvoiceItem, rate: number): InvoiceItem => ({
  ...item,
  unitPrice: Number(((Number(item.unitPrice) || 0) * rate).toFixed(6)),
  discount: round2((Number(item.discount) || 0) * rate),
});
const reverseChargeTaxOf = (items: InvoiceItem[]) =>
  round2(items.reduce((sum, item) => sum + round2((lineAmounts(item).net * SAUDI_STANDARD_VAT_RATE) / 100), 0));

type PurchaseInvoice = {
  id: string;
  date: string;
  dueDate: string;
  vendor: string;
  vendorId: string;
  vendorTaxNumber?: string;
  poNumber: string;
  referenceNo: string;
  notes: string;
  costCenter: string;
  costCenterName: string;
  status: string;
  statusColor: string;
  total: string;
  paid: string;
  remaining: string;
  accountingStatus: string;
  accountingJournalEntryId: string;
  items: InvoiceItem[];
  issuedBy?: string;
  issuerName?: string;
  importTreatment?: string;
  reverseChargeTax?: number;
  supplierCurrency?: string;
  exchangeRate?: number;
  supplierCurrencyTotal?: number;
};

const statusColors: Record<string, string> = {
  مفتوحة: "bg-cyan-500 text-white",
  "مدفوعة جزئياً": "bg-yellow-500 text-white",
  "مدفوعة بالكامل": "bg-green-600 text-white",
  ملغاة: "bg-red-500 text-white",
};

const parseCurrency = (value: string) =>
  Number(value.replace(/[^0-9.]/g, "")) || 0;

function mapRow(row: Record<string, unknown>): PurchaseInvoice {
  const status = (row.status as string) ?? "مفتوحة";
  return {
    id: (row.id as string) ?? "",
    date: (row.date as string) ?? "",
    dueDate: (row.due_date as string) ?? "",
    vendor: (row.vendor as string) ?? "",
    vendorId: String(row.vendor_id ?? ""),
    vendorTaxNumber: String(row.vendor_tax_number ?? ""),
    poNumber: (row.po_number as string) ?? "",
    referenceNo: (row.reference_no as string) ?? "",
    notes: (row.notes as string) ?? "",
    costCenter: (row.cost_center as string) ?? "بدون مركز تكلفة",
    costCenterName: (row.cost_center_name as string) ?? "",
    status,
    statusColor: statusColors[status] ?? "bg-slate-500 text-white",
    total:
      row.adjusted_total != null
        ? Number(row.adjusted_total).toFixed(2)
        : ((row.total as string) ?? "0.00"),
    paid: (row.paid as string) ?? "0.00",
    remaining:
      row.adjusted_remaining != null
        ? Number(row.adjusted_remaining).toFixed(2)
        : ((row.remaining as string) ?? "0.00"),
    accountingStatus: String(row.accounting_status ?? "unposted"),
    accountingJournalEntryId: String(row.accounting_journal_entry_id ?? ""),
    issuedBy: String(row.issued_by ?? row.created_by ?? ""),
    issuerName: "—",
    importTreatment: String(row.import_treatment ?? ""),
    reverseChargeTax: Number(row.reverse_charge_tax) || 0,
    supplierCurrency: String(row.supplier_currency ?? ""),
    exchangeRate: Number(row.exchange_rate) || 0,
    supplierCurrencyTotal: Number(row.supplier_currency_total) || 0,
    items: Array.isArray(row.items)
      ? (row.items as Record<string, unknown>[]).map((it) => ({
          id: Number(it.id) || 0,
          description: String(it.description ?? ""),
          unit: String(it.unit ?? ""),
          accountCode: String(it.accountCode ?? it.unit ?? "511"),
          quantity: Number(it.quantity) || 0,
          unitPrice: Number(it.unitPrice) || 0,
          discount: Number(it.discount) || 0,
          taxPercent: Number(it.taxPercent) || 0,
          foreignUnitPrice: it.foreignUnitPrice != null ? Number(it.foreignUnitPrice) || 0 : undefined,
          foreignDiscount: it.foreignDiscount != null ? Number(it.foreignDiscount) || 0 : undefined,
        }))
      : [],
  };
}

/* ── Main Page ── */
export default function PurchaseInvoices() {
  const { t, direction, locale, formatDate, formatNumber } = useI18n();
  const formatAmount = (value: number) =>
    formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const displayDate = (value: string) =>
    value ? formatDate(value, { dateStyle: "medium" }) : "-";
  const location = useLocation();
  const navigate = useNavigate();
  // الوصول من أمر شراء: «تحويل إلى فاتورة» يفتح نموذج الإنشاء، ورابط الفاتورة يفتح تفاصيلها
  const routeState = location.state as { fromPurchaseOrder?: unknown; openInvoiceId?: unknown } | null;
  const [view, setView] = useState<
    "list" | "create" | "details" | "edit" | "payment"
  >(() => (routeState?.fromPurchaseOrder ? "create" : "list"));
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([]);
  const [selected, setSelected] = useState<PurchaseInvoice | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const openInvoiceIdRef = useRef(routeState?.openInvoiceId ? String(routeState.openInvoiceId) : "");
  useEffect(() => {
    const target = openInvoiceIdRef.current;
    if (!target) return;
    const invoice = invoices.find((item) => item.id === target);
    if (!invoice) return;
    openInvoiceIdRef.current = "";
    setSelected(invoice);
    setView("details");
    navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices]);
  const { permissions } = useRolePermissions();
  const canViewIssuer = checkPerm(permissions, "audit.creator_columns");
  // فصل المهام: المشتريات تنشئ الفاتورة، والمحاسبة (إدارة الحسابات) تسدد — نفس فحص القاعدة
  const canCreate = ["purchases.invoices", "module.purchases"].some((key) => canManagePerm(permissions, key));
  const canPay = ["accounting.accounts", "module.accounting"].some((key) => canManagePerm(permissions, key));

  useEffect(() => {
    const load = async () => {
      try {
        const { data, error } = await supabase
          .from("purchase_invoices")
          .select("*")
          .order("date", { ascending: false });
        if (!error && data) {
          const mapped = data.map(mapRow);
          if (canViewIssuer) {
            const ids = Array.from(new Set(mapped.map((item) => item.issuedBy).filter(Boolean)));
            if (ids.length > 0) {
              const { data: labels } = await supabase.rpc("business_user_labels", { p_user_ids: ids });
              const names = new Map<string, string>((labels ?? []).map((item) => [String(item.user_id), String(item.display_name)] as [string, string]));
              mapped.forEach((item) => { item.issuerName = names.get(item.issuedBy ?? "") ?? "—"; });
            }
          }
          setInvoices(mapped);
        }
      } catch (e) {
        console.warn("purchase_invoices table not found or network error:", e);
      }
    };
    load();
  }, [refreshKey, canViewIssuer]);

  const refresh = () => setRefreshKey((k) => k + 1);

  const handleDelete = async (id: string) => {
    const invoice = invoices.find((item) => item.id === id);
    if (invoice?.accountingStatus === "posted") {
      toast({ title: t("لا يمكن حذف فاتورة مشتريات مرحلة محاسبيًا") });
      return;
    }
    if (!confirm(t("هل تريد حذف هذه الفاتورة؟"))) return;
    const { error } = await supabase
      .from("purchase_invoices")
      .delete()
      .eq("id", id);
    if (!error) {
      setInvoices((prev) => prev.filter((i) => i.id !== id));
      toast({
        title: t("تم حذف الفاتورة"),
        description: `${t("الفاتورة")}: ${id}`,
      });
    } else {
      toast({ title: t("تعذّر الحذف"), description: error.message });
    }
  };

  const handlePrintPdf = (invoice: PurchaseInvoice) => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const escapeHtml = (value: unknown) =>
      String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#039;");

    const items =
      invoice.items.length > 0
        ? invoice.items
        : [
            {
              id: 1,
              description: "-",
              unit: "",
            accountCode: "511",
            quantity: 1,
              unitPrice: parseCurrency(invoice.total),
              discount: 0,
              taxPercent: 0,
            },
          ];

    const rowsHtml = items
      .map((item) => {
        const qty = Number(item.quantity) || 0;
        const price = Number(item.unitPrice) || 0;
        const disc = Number(item.discount) || 0;
        const taxPct = Number(item.taxPercent) || 0;
        const line = lineAmounts({ quantity: qty, unitPrice: price, discount: disc, taxPercent: taxPct });
        return `<tr>
        <td>${escapeHtml(item.description || "-")}</td>
        <td>${escapeHtml(item.unit || "-")}</td>
        <td>${formatNumber(qty)}</td>
        <td>${formatAmount(price)}</td>
        <td>${formatAmount(disc)}</td>
        <td>${formatAmount(line.tax)}<br><small>${formatNumber(taxPct)}%</small></td>
        <td>${formatAmount(line.total)}</td>
      </tr>`;
      })
      .join("");

    // الإجماليات بنفس تقريب القاعدة (لكل بند)، ثم أثر الإشعارات إن وجدت
    const printTotals = items.reduce(
      (acc, item) => {
        const line = lineAmounts(item);
        return {
          net: round2(acc.net + line.net),
          tax: round2(acc.tax + line.tax),
          total: round2(acc.total + line.total),
        };
      },
      { net: 0, tax: 0, total: 0 },
    );
    const total = printTotals.total;
    const adjustedTotal = parseCurrency(invoice.total);
    const adjustments = round2(adjustedTotal - total);

    printWindow.document.write(`
      <html dir="${direction}" lang="${locale}">
        <head>
          <title>${escapeHtml(t("فاتورة مشتريات"))} ${escapeHtml(invoice.id)}</title>
          <meta charset="utf-8"/>
          <style>
            @page{size:A4 portrait;margin:10mm}
            *{box-sizing:border-box}
            html,body{width:210mm;min-height:297mm}
            body{font-family:Arial,Tahoma,sans-serif;margin:0;color:#111827;background:#fff}
            .sheet{width:190mm;max-width:190mm;margin:0 auto;border:1px solid #d1d5db;padding:10px 12px}
            .company-row{display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:center}
            .company-ar,.company-en{font-size:10.5px;line-height:1.55}
            .company-ar{text-align:right}.company-en{text-align:left;direction:ltr}
            .company-logo{width:120px;height:72px;object-fit:contain;display:block;margin:0 auto}
            .title{text-align:center;font-size:23px;font-weight:700;margin:8px 0 10px}
            .meta{border:1px solid #d1d5db;margin-bottom:10px}
            .grid{display:grid;grid-template-columns:1fr 1fr}
            .card{padding:6px 8px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;gap:8px;font-size:11px}
            .card:nth-child(odd){border-left:1px solid #e5e7eb}
            .label{color:#4b5563}.value{font-weight:700;text-align:left}
            table{width:100%;border-collapse:collapse;font-size:11px}
            th,td{border:1px solid #d1d5db;padding:6px 4px;text-align:center;vertical-align:middle}
            th{background:#f3f4f6;font-weight:700}
            .bottom{display:grid;grid-template-columns:1fr 280px;gap:14px;margin-top:12px;align-items:start}
            .notes{font-size:11px;line-height:1.7;border:1px solid #e5e7eb;padding:8px;min-height:78px}
            .totals{font-size:12px;border-top:1px solid #d1d5db;padding-top:6px}
            .totals-row{display:flex;justify-content:space-between;margin-bottom:7px}
            .final{font-size:14px;font-weight:700;border-top:1px solid #d1d5db;padding-top:7px}
            .footer{margin-top:14px;padding-top:8px;border-top:1px solid #d1d5db;text-align:center;color:#6b7280;font-size:9px}
            @media print{html,body{width:210mm}.sheet{width:190mm;max-width:190mm}}
          </style>
        </head>
        <body>
          <main class="sheet">
            <div class="company-row">
              <div class="company-ar"><strong>${escapeHtml(COMPANY_PROFILE.companyNameAr)}</strong><br>${escapeHtml(COMPANY_PROFILE.addressAr)}<br>${escapeHtml(t("الرقم الضريبي"))} ${escapeHtml(COMPANY_PROFILE.vatNumber)}<br>${escapeHtml(t("السجل التجاري"))} ${escapeHtml(COMPANY_PROFILE.commercialRegistration)}</div>
              <img src="${escapeHtml(COMPANY_PROFILE.logoUrl)}" class="company-logo" alt="${escapeHtml(t("شعار الشركة"))}">
              <div class="company-en"><strong>${escapeHtml(COMPANY_PROFILE.companyNameEn)}</strong><br>${escapeHtml(COMPANY_PROFILE.addressEn)}<br>VAT No. ${escapeHtml(COMPANY_PROFILE.vatNumber)}<br>CR No. ${escapeHtml(COMPANY_PROFILE.commercialRegistration)}</div>
            </div>
            <div class="title">${escapeHtml(t("فاتورة مشتريات"))} | Purchase Invoice</div>
            <section class="meta"><div class="grid">
              <div class="card"><span class="label">${escapeHtml(t("المورد"))} / Vendor</span><span class="value">${escapeHtml(invoice.vendor || "-")}</span></div>
              <div class="card"><span class="label">${escapeHtml(t("رقم الفاتورة"))} / Invoice No.</span><span class="value">${escapeHtml(invoice.id)}</span></div>
              <div class="card"><span class="label">${escapeHtml(t("تاريخ الفاتورة"))}</span><span class="value">${escapeHtml(displayDate(invoice.date))}</span></div>
              <div class="card"><span class="label">${escapeHtml(t("تاريخ الاستحقاق"))}</span><span class="value">${escapeHtml(displayDate(invoice.dueDate))}</span></div>
              <div class="card"><span class="label">${escapeHtml(t("رقم أمر الشراء"))}</span><span class="value">${escapeHtml(invoice.poNumber || "-")}</span></div>
              <div class="card"><span class="label">${escapeHtml(t("رقم فاتورة المورد"))}</span><span class="value">${escapeHtml(invoice.referenceNo || "-")}</span></div>
              <div class="card"><span class="label">${escapeHtml(t("مركز التكلفة"))}</span><span class="value">${escapeHtml(invoice.costCenterName || invoice.costCenter || "-")}</span></div>
              <div class="card"><span class="label">${escapeHtml(t("الحالة"))} / Status</span><span class="value">${escapeHtml(t(invoice.status))}</span></div>
              ${invoice.importTreatment ? `<div class="card"><span class="label">${escapeHtml(t("نوع فاتورة المورد غير المقيم"))}</span><span class="value">${escapeHtml(t(IMPORT_TREATMENT_LABELS[invoice.importTreatment as Exclude<ImportTreatment, "">] ?? invoice.importTreatment))}</span></div>` : ""}
              ${invoice.supplierCurrency ? `<div class="card"><span class="label">${escapeHtml(t("فاتورة المورد بعملته"))}</span><span class="value">${escapeHtml(formatAmount(invoice.supplierCurrencyTotal ?? 0))} ${escapeHtml(invoice.supplierCurrency)} × ${escapeHtml(String(invoice.exchangeRate ?? ""))}</span></div>` : ""}
            </div></section>
            <table>
              <thead><tr><th>${escapeHtml(t("وصف البند"))}<br>Description</th><th>${escapeHtml(t("الوحدة"))}<br>Unit</th><th>${escapeHtml(t("الكمية"))}<br>Qty</th><th>${escapeHtml(t("سعر الوحدة"))}<br>Price</th><th>${escapeHtml(t("الخصم"))}<br>Discount</th><th>${escapeHtml(t("الضريبة"))}<br>VAT</th><th>${escapeHtml(t("الإجمالي"))}<br>Total</th></tr></thead>
              <tbody>${rowsHtml}</tbody>
            </table>
            <div class="bottom">
              <div class="notes"><strong>${escapeHtml(t("الملاحظة"))} / Note</strong><br>${escapeHtml(invoice.notes || t("لا توجد ملاحظات"))}</div>
              <div class="totals">
                <div class="totals-row"><span>${escapeHtml(t("الإجمالي قبل الضريبة"))}</span><strong>${formatAmount(printTotals.net)} ${escapeHtml(t("ريال"))}</strong></div>
                <div class="totals-row"><span>${escapeHtml(t("ضريبة القيمة المضافة"))}</span><strong>${formatAmount(printTotals.tax)} ${escapeHtml(t("ريال"))}</strong></div>
                <div class="totals-row"><span>${escapeHtml(t("الإجمالي الكلي"))}</span><strong>${formatAmount(total)} ${escapeHtml(t("ريال"))}</strong></div>
                ${Math.abs(adjustments) >= 0.01 ? `<div class="totals-row"><span>${escapeHtml(t("أثر الإشعارات"))}</span><strong>${formatAmount(adjustments)} ${escapeHtml(t("ريال"))}</strong></div><div class="totals-row"><span>${escapeHtml(t("الإجمالي بعد الإشعارات"))}</span><strong>${formatAmount(adjustedTotal)} ${escapeHtml(t("ريال"))}</strong></div>` : ""}
                ${(invoice.reverseChargeTax ?? 0) > 0 ? `<div class="totals-row"><span>${escapeHtml(t("ضريبة احتساب عكسي (يحتسبها المشتري ولا تُدفع للمورد)"))}</span><strong>${formatAmount(invoice.reverseChargeTax ?? 0)} ${escapeHtml(t("ريال"))}</strong></div>` : ""}
                <div class="totals-row"><span>${escapeHtml(t("المدفوع"))}</span><strong>${escapeHtml(invoice.paid)} ${escapeHtml(t("ريال"))}</strong></div>
                <div class="totals-row final"><span>${escapeHtml(t("المتبقي"))}</span><strong>${escapeHtml(invoice.remaining)} ${escapeHtml(t("ريال"))}</strong></div>
              </div>
            </div>
            <div class="footer">${escapeHtml(COMPANY_PROFILE.companyNameAr)} | ${escapeHtml(COMPANY_PROFILE.companyNameEn)}</div>
          </main>
        </body>
      </html>
    `);
    printWindow.document.close();
    let printed = false;
    const triggerPrint = () => {
      if (printed) return;
      printed = true;
      printWindow.focus();
      printWindow.print();
    };
    const logo = printWindow.document.querySelector(
      ".company-logo",
    ) as HTMLImageElement | null;
    if (logo && !logo.complete) {
      logo.addEventListener("load", triggerPrint, { once: true });
      logo.addEventListener("error", triggerPrint, { once: true });
      window.setTimeout(triggerPrint, 3000);
    } else {
      window.setTimeout(triggerPrint, 150);
    }
  };

  return (
    <Layout subMenu={{ title: t("المشتريات"), items: purchasesFeatures }}>
      <div className="mx-auto max-w-7xl" dir={direction}>
        {view === "list" && (
          <InvoicesList
            invoices={invoices}
            canViewIssuer={canViewIssuer}
            canCreate={canCreate}
            canPay={canPay}
            onCreateClick={() => setView("create")}
            onView={(inv) => {
              setSelected(inv);
              setView("details");
            }}
            onEdit={(inv) => {
              setSelected(inv);
              setView("edit");
            }}
            onPayment={(inv) => {
              setSelected(inv);
              setView("payment");
            }}
            onDelete={handleDelete}
            onPrintPdf={handlePrintPdf}
          />
        )}
        {view === "create" && (
          <InvoiceForm
            onBack={() => setView("list")}
            onSaved={(inv) => {
              setInvoices((prev) => [inv, ...prev]);
              toast({
                title: t("تم حفظ الفاتورة"),
                description: `${t("الفاتورة")}: ${inv.id}`,
              });
              setView("list");
              refresh();
            }}
          />
        )}
        {view === "details" && selected && (
          <InvoiceDetails
            invoice={selected}
            onBack={() => setView("list")}
            onEdit={() => { if (selected.accountingStatus !== "posted") setView("edit"); }}
            onPrintPdf={handlePrintPdf}
          />
        )}
        {view === "edit" && selected && (
          <InvoiceEdit
            invoice={selected}
            onBack={() => setView("list")}
            onUpdated={(updated) => {
              setInvoices((prev) =>
                prev.map((i) => (i.id === updated.id ? updated : i)),
              );
              setSelected(updated);
              toast({ title: t("تم تحديث الفاتورة") });
              refresh();
              setView("list");
            }}
          />
        )}
        {view === "payment" && selected && (
          <InvoicePayment
            invoice={selected}
            canPay={canPay}
            onRefreshed={(updated) => {
              setInvoices((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
              setSelected(updated);
            }}
            onBack={() => setView("list")}
            onUpdated={(updated) => {
              setInvoices((prev) =>
                prev.map((i) => (i.id === updated.id ? updated : i)),
              );
              setSelected(updated);
              toast({ title: t("تم تسجيل الدفعة") });
              refresh();
              setView("list");
            }}
          />
        )}
      </div>
    </Layout>
  );
}

/* ── List ── */
function InvoicesList({
  invoices,
  canViewIssuer,
  canCreate,
  canPay,
  onCreateClick,
  onView,
  onEdit,
  onPayment,
  onDelete,
  onPrintPdf,
}: {
  invoices: PurchaseInvoice[];
  canViewIssuer: boolean;
  canCreate: boolean;
  canPay: boolean;
  onCreateClick: () => void;
  onView: (i: PurchaseInvoice) => void;
  onEdit: (i: PurchaseInvoice) => void;
  onPayment: (i: PurchaseInvoice) => void;
  onDelete: (id: string) => void;
  onPrintPdf: (i: PurchaseInvoice) => void;
}) {
  const { t, direction, formatDate, formatNumber } = useI18n();
  const formatAmount = (value: string) =>
    formatNumber(parseCurrency(value), {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  const displayDate = (value: string) =>
    value ? formatDate(value, { dateStyle: "medium" }) : "-";
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const filteredInvoices = invoices.filter((invoice) => {
    const matchesSearch = !search.trim() || `${invoice.id} ${invoice.referenceNo} ${invoice.vendor}`.toLowerCase().includes(search.trim().toLowerCase());
    return matchesSearch && (!status || invoice.status === status) && (!fromDate || invoice.date >= fromDate) && (!toDate || invoice.date <= toDate);
  });

  return (
    <div className="space-y-6" dir={direction}>
      <PageHeader
        icon={FileText}
        title={t("فواتير المشتريات")}
        subtitle={t("إدارة وتتبع جميع فواتير المشتريات")}
        actionLabel={canCreate ? t("إضافة فاتورة مشتريات جديدة") : undefined}
        onAction={canCreate ? onCreateClick : undefined}
        gradient="from-purple-600 to-indigo-700"
      />

      <FilterBar>
        <div className="space-y-1.5 md:col-span-2"><label className="block text-start text-xs font-semibold text-muted-foreground">{t("البحث")}</label><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`${t("رقم الفاتورة")}، ${t("المرجع")}، ${t("المورد")}...`} className="w-full rounded-xl border border-border/60 bg-muted/20 px-4 py-2.5 text-sm" /></div>
        <div className="space-y-1.5"><label className="block text-start text-xs font-semibold text-muted-foreground">{t("من تاريخ")}</label><input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="w-full rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5 text-sm" /></div>
        <div className="space-y-1.5"><label className="block text-start text-xs font-semibold text-muted-foreground">{t("إلى تاريخ")}</label><input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="w-full rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5 text-sm" /></div>
        <div className="space-y-1.5"><label className="block text-start text-xs font-semibold text-muted-foreground">{t("الحالة")}</label><select value={status} onChange={(event) => setStatus(event.target.value)} className="w-full rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5 text-sm"><option value="">{t("الكل")}</option><option value="مفتوحة">{t("مفتوحة")}</option><option value="مدفوعة جزئياً">{t("مدفوعة جزئياً")}</option><option value="مدفوعة بالكامل">{t("مدفوعة بالكامل")}</option></select></div>
        <FilterActions onReset={() => { setSearch(""); setStatus(""); setFromDate(""); setToDate(""); }} />
      </FilterBar>

      <div className="rounded-2xl bg-white border border-border/50 shadow-sm overflow-x-auto">
        <table className="w-full text-sm text-right">
          <thead
            className={cn(
              "text-white bg-gradient-to-r",
              "from-purple-800 to-indigo-900",
            )}
          >
            <tr>
              <th className="px-4 py-3 font-semibold whitespace-nowrap text-right">
                {t("الإجراءات")}
              </th>
              <th className="px-4 py-3 font-semibold whitespace-nowrap text-right">
                {t("الحالة")}
              </th>
              {canViewIssuer && <th className="px-4 py-3 font-semibold whitespace-nowrap text-right">{t("مصدر الفاتورة")}</th>}
              <th className="px-4 py-3 font-semibold whitespace-nowrap text-right">
                {t("المتبقي")}
              </th>
              <th className="px-4 py-3 font-semibold whitespace-nowrap text-right">
                {t("المدفوع")}
              </th>
              <th className="px-4 py-3 font-semibold whitespace-nowrap text-right">
                {t("الإجمالي")}
              </th>
              <th className="px-4 py-3 font-semibold whitespace-nowrap text-right">
                {t("المورد")}
              </th>
              <th className="px-4 py-3 font-semibold whitespace-nowrap text-right">
                {t("تاريخ الاستحقاق")}
              </th>
              <th className="px-4 py-3 font-semibold whitespace-nowrap text-right">
                {t("تاريخ الفاتورة")}
              </th>
              <th className="px-4 py-3 font-semibold whitespace-nowrap text-right">
                {t("رقم الفاتورة")}
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredInvoices.map((inv) => (
              <tr
                key={inv.id}
                className="border-b border-border/30 hover:bg-muted/20 transition-colors"
              >
                <td className="px-4 py-3 align-middle">
                  <div className="flex min-w-max items-center gap-1 whitespace-nowrap">
                    <ActionBtn
                      icon={Eye}
                      label={t("عرض")}
                      color="blue"
                      onClick={() => onView(inv)}
                    />
                    {inv.accountingStatus !== "posted" && <ActionBtn
                      icon={Edit}
                      label={t("تعديل")}
                      color="emerald"
                      onClick={() => onEdit(inv)}
                    />}
                    {inv.accountingStatus === "posted" && (canPay || parseCurrency(inv.paid) > 0) && <ActionBtn
                      icon={CreditCard}
                      label={t(canPay && parseCurrency(inv.remaining) > 0.01 ? "تسديد" : "المدفوعات")}
                      color="indigo"
                      onClick={() => onPayment(inv)}
                    />}
                    {inv.accountingStatus !== "posted" && <ActionBtn
                      icon={Trash2}
                      label={t("حذف")}
                      color="red"
                      onClick={() => onDelete(inv.id)}
                    />}
                    <button
                      title={t("طباعة PDF")}
                      onClick={() => onPrintPdf(inv)}
                      className="px-2.5 py-1.5 text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors text-xs font-semibold"
                    >
                      PDF
                    </button>
                  </div>
                </td>
                <td className="px-4 py-3 align-middle">
                  <span
                    className={cn(
                      "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold",
                      inv.statusColor,
                    )}
                  >
                    {t(inv.status)}
                  </span>
                </td>
                {canViewIssuer && <td className="px-4 py-3 align-middle whitespace-nowrap">{inv.issuerName || "—"}</td>}
                <td className="px-4 py-3 align-middle text-red-600 font-medium whitespace-nowrap">
                  {formatAmount(inv.remaining)} {t("ريال")}
                </td>
                <td className="px-4 py-3 align-middle text-green-700 font-medium whitespace-nowrap">
                  {formatAmount(inv.paid)} {t("ريال")}
                </td>
                <td className="px-4 py-3 align-middle font-semibold whitespace-nowrap">
                  {formatAmount(inv.total)} {t("ريال")}
                </td>
                <td className="px-4 py-3 align-middle whitespace-nowrap">
                  {inv.vendor}
                </td>
                <td className="px-4 py-3 align-middle text-muted-foreground whitespace-nowrap">
                  {displayDate(inv.dueDate)}
                </td>
                <td className="px-4 py-3 align-middle text-muted-foreground whitespace-nowrap">
                  {displayDate(inv.date)}
                </td>
                <td
                  className="px-4 py-3 align-middle font-semibold text-purple-600 hover:underline cursor-pointer whitespace-nowrap"
                  onClick={() => onView(inv)}
                >
                  {inv.id}
                </td>
              </tr>
            ))}
            {filteredInvoices.length === 0 && (
              <tr>
                <td
                  colSpan={canViewIssuer ? 10 : 9}
                  className="px-4 py-12 text-center text-muted-foreground"
                >
                  {t("لا توجد فواتير مشتريات")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Details ── */
function InvoiceDetails({
  invoice,
  onBack,
  onEdit,
  onPrintPdf,
}: {
  invoice: PurchaseInvoice;
  onBack: () => void;
  onEdit: () => void;
  onPrintPdf: (i: PurchaseInvoice) => void;
}) {
  const { t, direction, formatDate, formatNumber } = useI18n();
  const formatAmount = (value: number) =>
    formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const displayDate = (value: string) =>
    value ? formatDate(value, { dateStyle: "medium" }) : "-";
  // الرقم الضريبي للمورد: المحفوظ على الفاتورة، وإلا من بطاقة المورد
  const [vendorTaxNumber, setVendorTaxNumber] = useState(invoice.vendorTaxNumber ?? "");
  useEffect(() => {
    setVendorTaxNumber(invoice.vendorTaxNumber ?? "");
    if (invoice.vendorTaxNumber || !invoice.vendorId) return;
    let cancelled = false;
    const loadVendorTaxNumber = async () => {
      const { data } = await supabase
        .from("vendors")
        .select("tax_number")
        .eq("id", invoice.vendorId)
        .maybeSingle();
      if (!cancelled) setVendorTaxNumber(String(data?.tax_number ?? ""));
    };
    void loadVendorTaxNumber();
    return () => {
      cancelled = true;
    };
  }, [invoice.id, invoice.vendorId, invoice.vendorTaxNumber]);
  const items =
    invoice.items.length > 0
      ? invoice.items
      : [
          {
            id: 1,
            description: "-",
            unit: "",
            accountCode: "511",
            quantity: 1,
            unitPrice: parseCurrency(invoice.total),
            discount: 0,
            taxPercent: 0,
          },
        ];

  const totals = items.reduce(
    (acc, item) => {
      const qty = Number(item.quantity) || 0;
      const price = Number(item.unitPrice) || 0;
      const disc = Number(item.discount) || 0;
      const taxPct = Number(item.taxPercent) || 0;
      const sub = qty * price - disc;
      const tax = (sub * taxPct) / 100;
      return {
        subtotal: acc.subtotal + sub,
        discount: acc.discount + item.discount,
        tax: acc.tax + tax,
        total: acc.total + sub + tax,
      };
    },
    { subtotal: 0, discount: 0, tax: 0, total: 0 },
  );

  return (
    <div className="space-y-6 bg-slate-50 min-h-screen pb-12" dir={direction}>
      <div className="flex justify-between items-center bg-white p-4 border-b border-slate-200 shadow-sm">
        <button
          onClick={onBack}
          className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-sm rounded hover:bg-slate-50 flex items-center gap-2"
        >
          {t("العودة للقائمة")} <ArrowLeftRight className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-slate-800">
            {t("تفاصيل فاتورة المشتريات")}
          </h1>
          <FileText className="h-5 w-5 text-blue-600" />
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => onPrintPdf(invoice)}
            className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-sm rounded hover:bg-slate-50 flex items-center gap-2"
          >
            <Printer className="h-4 w-4" /> {t("طباعة PDF")}
          </button>
          {invoice.accountingStatus !== "posted" && <button
            onClick={onEdit}
            className="px-4 py-2 bg-emerald-600 text-white text-sm rounded hover:bg-emerald-700 flex items-center gap-2"
          >
            <Edit className="h-4 w-4" /> {t("تعديل")}
          </button>}
        </div>
      </div>

      <div className="p-4 space-y-6">
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-5">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-center gap-5">
            <div className="text-right text-xs leading-6 text-slate-600">
              <div className="text-base font-bold text-slate-900">
                {COMPANY_PROFILE.companyNameAr}
              </div>
              <div>{COMPANY_PROFILE.addressAr}</div>
              <div>
                {t("الرقم الضريبي")} {COMPANY_PROFILE.vatNumber}
              </div>
            </div>
            <img
              src={COMPANY_PROFILE.logoUrl}
              alt={t("شعار الشركة")}
              className="h-24 w-36 object-contain mx-auto"
            />
            <div
              className="text-left text-xs leading-6 text-slate-600"
              dir="ltr"
            >
              <div className="text-base font-bold text-slate-900">
                {COMPANY_PROFILE.companyNameEn}
              </div>
              <div>{COMPANY_PROFILE.addressEn}</div>
              <div>VAT No. {COMPANY_PROFILE.vatNumber}</div>
            </div>
          </div>
          <h2 className="mt-3 text-center text-2xl font-bold text-slate-900">
            {t("فاتورة مشتريات")} | Purchase Invoice
          </h2>
        </div>

        {/* Header info */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-amber-400 px-4 py-2 text-right font-semibold text-slate-800">
            {t("معلومات الفاتورة")}
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { label: t("رقم الفاتورة"), value: invoice.id },
              { label: t("المورد"), value: invoice.vendor },
              { label: t("الرقم الضريبي للمورد"), value: vendorTaxNumber || "-" },
              { label: t("تاريخ الفاتورة"), value: displayDate(invoice.date) },
              {
                label: t("تاريخ الاستحقاق"),
                value: displayDate(invoice.dueDate),
              },
              { label: t("رقم أمر الشراء"), value: invoice.poNumber || "-" },
              { label: t("مرجع الفاتورة"), value: invoice.referenceNo || "-" },
              // المشروع يُحفظ في cost_center_name (كما في الطباعة)
              { label: t("مركز التكلفة"), value: invoice.costCenterName || t(invoice.costCenter) || "-" },
              { label: t("الحالة"), value: t(invoice.status) },
            ].map(({ label, value }) => (
              <div key={label} className="space-y-1">
                <div className="text-xs text-slate-500 text-right">{label}</div>
                <div className="text-sm font-semibold text-right">{value}</div>
              </div>
            ))}
            {invoice.notes && (
              <div className="md:col-span-3 space-y-1">
                <div className="text-xs text-slate-500 text-right">
                  {t("ملاحظات")}
                </div>
                <div className="text-sm text-right">{invoice.notes}</div>
              </div>
            )}
          </div>
        </div>

        {/* Payment summary */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              label: t("الإجمالي"),
              value: `${formatAmount(parseCurrency(invoice.total))} ${t("ريال")}`,
              color: "text-slate-800",
              bg: "bg-slate-50",
            },
            {
              label: t("المدفوع"),
              value: `${formatAmount(parseCurrency(invoice.paid))} ${t("ريال")}`,
              color: "text-green-700",
              bg: "bg-green-50",
            },
            {
              label: t("المتبقي"),
              value: `${formatAmount(parseCurrency(invoice.remaining))} ${t("ريال")}`,
              color: "text-red-600",
              bg: "bg-red-50",
            },
          ].map(({ label, value, color, bg }) => (
            <div
              key={label}
              className={`${bg} rounded-lg border border-slate-200 p-4 text-right`}
            >
              <div className="text-xs text-slate-500">{label}</div>
              <div className={`text-xl font-bold mt-1 ${color}`}>{value}</div>
            </div>
          ))}
        </div>

        {/* Items */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-green-700 text-white px-4 py-2 text-right font-semibold">
            {t("بنود الفاتورة")}
          </div>
          <div className="p-4 overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="bg-slate-100">
                <tr>
                  <th className="px-3 py-2 border border-slate-200">#</th>
                  <th className="px-3 py-2 border border-slate-200">
                    {t("وصف البند")}
                  </th>
                  <th className="px-3 py-2 border border-slate-200">
                    {t("الوحدة")}
                  </th>
                  <th className="px-3 py-2 border border-slate-200">
                    {t("الكمية")}
                  </th>
                  <th className="px-3 py-2 border border-slate-200">
                    {t("سعر الوحدة")}
                  </th>
                  <th className="px-3 py-2 border border-slate-200">
                    {t("الخصم")}
                  </th>
                  <th className="px-3 py-2 border border-slate-200">
                    {t("الضريبة")}%
                  </th>
                  <th className="px-3 py-2 border border-slate-200">
                    {t("الإجمالي")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => {
                  const qty = Number(item.quantity) || 0;
                  const price = Number(item.unitPrice) || 0;
                  const disc = Number(item.discount) || 0;
                  const taxPct = Number(item.taxPercent) || 0;
                  const sub = qty * price - disc;
                  const tax = (sub * taxPct) / 100;
                  return (
                    <tr key={idx}>
                      <td className="px-3 py-2 border border-slate-200">
                        {idx + 1}
                      </td>
                      <td className="px-3 py-2 border border-slate-200">
                        {item.description}
                      </td>
                      <td className="px-3 py-2 border border-slate-200">
                        {item.unit || "-"}
                      </td>
                      <td className="px-3 py-2 border border-slate-200">
                        {formatNumber(qty)}
                      </td>
                      <td className="px-3 py-2 border border-slate-200">
                        {formatAmount(price)}
                      </td>
                      <td className="px-3 py-2 border border-slate-200">
                        {formatAmount(disc)}
                      </td>
                      <td className="px-3 py-2 border border-slate-200">
                        {formatNumber(taxPct)}%
                      </td>
                      <td className="px-3 py-2 border border-slate-200 font-medium">
                        {formatAmount(sub + tax)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="flex justify-end mt-6">
              <div className="w-80 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="font-semibold">
                    {formatAmount(totals.subtotal)} {t("ريال")}
                  </span>
                  <span className="text-slate-600">{t("المجموع الفرعي")}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-semibold">
                    {formatAmount(totals.discount)} {t("ريال")}
                  </span>
                  <span className="text-slate-600">{t("الخصم")}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-semibold">
                    {formatAmount(totals.tax)} {t("ريال")}
                  </span>
                  <span className="text-slate-600">
                    {t("ضريبة القيمة المضافة")}
                  </span>
                </div>
                <div className="flex justify-between border-t border-slate-200 pt-2">
                  <span className="font-bold text-blue-600 text-base">
                    {formatAmount(totals.total)} {t("ريال")}
                  </span>
                  <span className="font-bold text-slate-800">
                    {t("الإجمالي الكلي")}
                  </span>
                </div>
                {invoice.importTreatment && (
                  <div className="mt-3 space-y-1 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                    <p className="font-semibold">
                      {t(IMPORT_TREATMENT_LABELS[invoice.importTreatment as Exclude<ImportTreatment, "">] ?? invoice.importTreatment)}
                    </p>
                    {(invoice.reverseChargeTax ?? 0) > 0 && (
                      <p>
                        {t("ضريبة احتساب عكسي (يحتسبها المشتري ولا تُدفع للمورد)")}: {formatAmount(invoice.reverseChargeTax ?? 0)} {t("ريال")}
                      </p>
                    )}
                    {invoice.supplierCurrency && (
                      <p>
                        {t("فاتورة المورد بعملته")}: {formatAmount(invoice.supplierCurrencyTotal ?? 0)} {invoice.supplierCurrency} × {invoice.exchangeRate}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Shared items table ── */
function ItemsTable({
  items,
  onAdd,
  onUpdate,
  onRemove,
  accentClass = "focus:border-blue-500 focus:ring-blue-500",
  vendorVat = "",
  foreignCurrency = "SAR",
  exchangeRate = 1,
  importTreatment = "",
}: {
  items: InvoiceItem[];
  onAdd: () => void;
  onUpdate: (id: number, changes: Partial<InvoiceItem>) => void;
  onRemove: (id: number) => void;
  accentClass?: string;
  // "no": المورد غير مسجل ضريبيًا فلا تُطالَب ضريبة مدخلات (0% فقط)
  vendorVat?: VendorVatState;
  // فاتورة المورد غير المقيم: الأسعار بعملته وتُحوَّل للريال بسعر الصرف
  foreignCurrency?: string;
  exchangeRate?: number;
  importTreatment?: ImportTreatment;
}) {
  const { t, direction, formatNumber } = useI18n();
  const vatLocked = vendorVat === "no";
  const isForeign = foreignCurrency !== "SAR";
  const rate = isForeign ? (exchangeRate > 0 ? exchangeRate : 0) : 1;
  const sarItems = isForeign ? items.map((item) => toSarItem(item, rate)) : items;
  const reverseChargeTax = importTreatment === "reverse_charge" ? reverseChargeTaxOf(sarItems) : 0;
  const [expenseAccounts, setExpenseAccounts] = useState<PurchaseExpenseAccount[]>([]);
  useEffect(() => {
    const loadAccounts = async () => {
      // حسابات المصروفات (5) + حساب البضاعة المستلمة غير المفوترة (تسوية GRNI) — حسابات نهائية فقط،
      // عبر دالة في القاعدة حتى يراها منشئ الفاتورة دون صلاحية على شجرة الحسابات كاملة
      const { data } = await supabase.rpc("list_purchase_item_accounts");
      setExpenseAccounts(
        ((data ?? []) as { code: string; name_ar: string }[]).map((account) => ({
          code: String(account.code),
          name_ar: String(account.name_ar ?? ""),
          parent_code: null,
        })),
      );
    };
    void loadAccounts();
  }, []);
  const formatAmount = (value: number) =>
    formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // نفس تقريب القاعدة لكل بند، فيطابق المعروض ما سيُرحَّل (بالريال)
  const totals = sarItems.reduce(
    (acc, item) => {
      const line = lineAmounts(item);
      return {
        subtotal: round2(acc.subtotal + line.net),
        discount: round2(acc.discount + (Number(item.discount) || 0)),
        tax: round2(acc.tax + line.tax),
        total: round2(acc.total + line.total),
      };
    },
    { subtotal: 0, discount: 0, tax: 0, total: 0 },
  );
  const foreignTotal = round2(items.reduce((sum, item) => sum + lineAmounts({ ...item, taxPercent: 0 }).net, 0));

  return (
    <div
      className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden"
      dir={direction}
    >
      <div className="bg-slate-100 px-4 py-2 text-right font-semibold text-slate-700 flex items-center justify-between">
        <span>{t("منتج/منتجات")}</span>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
        >
          <Plus className="h-3.5 w-3.5" /> {t("إضافة بند")}
        </button>
      </div>
      <div className="p-4 overflow-x-auto">
        {/* خيارا "خالٍ من الضريبة / شامل الضريبة" أُزيلا: لم يكونا يؤثران على الحساب */}
        <div className="mb-3 text-sm text-slate-600 text-right space-y-1">
          <p>{t("الأسعار غير شاملة الضريبة — تُحسب الضريبة لكل بند حسب النسبة المختارة")}</p>
          <p>{t("لبنود البضاعة المخزنية التي استُلمت بسند استلام اختر الحساب 2113 بدل حساب المصروف.")}</p>
          {vatLocked && !importTreatment && (
            <p className="text-amber-700">
              {t("المورد غير مسجل ضريبيًا: لا تُطالَب ضريبة مدخلات على فواتيره (النسبة 0%)")}
            </p>
          )}
          {importTreatment === "reverse_charge" && (
            <p className="text-amber-700">
              {t("احتساب عكسي: نحتسب ضريبة 15% على صافي الخدمة (مدخلات ومخرجات بالقيمة نفسها)، ولا تُدفع للمورد.")}
            </p>
          )}
          {importTreatment === "customs_goods" && (
            <p className="text-amber-700">
              {t("بضائع مستوردة: هذه الفاتورة خارج الإقرار، وضريبة الاستيراد تُسجَّل من شاشة البيانات الجمركية.")}
            </p>
          )}
          {isForeign && (
            <p className="text-slate-700">
              {t("الأسعار بعملة المورد")} ({foreignCurrency}){rate > 0 ? ` — ${t("سعر الصرف")} ${rate}` : ` — ${t("أدخل سعر الصرف")}`}
            </p>
          )}
        </div>
        {items.length === 0 ? (
          <div className="h-20 border border-dashed border-slate-300 rounded flex items-center justify-center text-slate-400 text-sm">
            {t('لا يوجد بنود — اضغط "إضافة بند"')}
          </div>
        ) : (
          <table dir="ltr" className="w-full text-sm mb-4 [&_th]:[direction:rtl] [&_td]:[direction:rtl] [&_th]:text-right [&_td]:text-right">
            <thead>
              <tr className="text-slate-600 border-b border-slate-200">
                <th className="pb-2 font-medium w-10 text-center"></th>
                <th className="pb-2 font-medium w-24">{t("المجموع")}{isForeign ? ` (${foreignCurrency})` : ""}</th>
                <th className="pb-2 font-medium w-20">{t("الضريبة")}</th>
                <th className="pb-2 font-medium w-20">{t("الخصم")}</th>
                <th className="pb-2 font-medium w-24">{t("المبلغ")}{isForeign ? ` (${foreignCurrency})` : ""} *</th>
                <th className="pb-2 font-medium w-20">{t("الكمية")} *</th>
                <th className="pb-2 font-medium w-24">
                  {t("حساب المصروفات")}*
                </th>
                <th className="pb-2 font-medium">{t("الوصف")} *</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => {
                const lineTotal = lineAmounts(item).total;
                const inputClass = `w-full px-2 py-2 border border-slate-300 rounded text-sm text-right ${accentClass} focus:ring-1 outline-none h-10`;
                return (
                  <tr key={`item-${idx}`}>
                    <td className="pt-3 align-top">
                      <div className="flex items-center justify-center h-10">
                        <button
                          onClick={() => onRemove(item.id)}
                          className="w-7 h-7 flex items-center justify-center bg-red-500 text-white rounded hover:bg-red-600"
                        >
                          <Trash2
                            className="w-3.5 h-3.5"
                            aria-label={t("حذف البند")}
                          />
                        </button>
                      </div>
                    </td>
                    <td className="pt-3 px-1 align-top">
                      <input
                        type="text"
                        value={formatAmount(lineTotal)}
                        disabled
                        aria-label={t("المجموع")}
                        className="w-full px-2 py-2 border border-slate-200 bg-slate-100 rounded text-sm text-right outline-none h-10"
                      />
                    </td>
                    <td className="pt-3 px-1 align-top">
                      {/* 15% لمورد مسجل بفاتورة ضريبية، 0% لغير الخاضع؛ المورد غير المسجل 0% فقط */}
                      <select
                        value={String(vatLocked ? 0 : item.taxPercent)}
                        disabled={vatLocked}
                        onChange={(e) =>
                          onUpdate(item.id, {
                            taxPercent: Number(e.target.value) === SAUDI_STANDARD_VAT_RATE ? SAUDI_STANDARD_VAT_RATE : 0,
                          })
                        }
                        aria-label={t("الضريبة")}
                        className={`${inputClass} disabled:bg-slate-100`}
                      >
                        <option value={String(SAUDI_STANDARD_VAT_RATE)}>{SAUDI_STANDARD_VAT_RATE}%</option>
                        <option value="0">0%</option>
                      </select>
                    </td>
                    <td className="pt-3 px-1 align-top">
                      <input
                        type="number"
                        value={item.discount}
                        onChange={(e) =>
                          onUpdate(item.id, {
                            discount: Number(e.target.value) || 0,
                          })
                        }
                        className={inputClass}
                      />
                    </td>
                    <td className="pt-3 px-1 align-top">
                      <input
                        type="number"
                        value={item.unitPrice}
                        onChange={(e) =>
                          onUpdate(item.id, {
                            unitPrice: Number(e.target.value) || 0,
                          })
                        }
                        className={inputClass}
                      />
                    </td>
                    <td className="pt-3 px-1 align-top">
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={(e) =>
                          onUpdate(item.id, {
                            quantity: Number(e.target.value) || 0,
                          })
                        }
                        className={inputClass}
                      />
                    </td>
                    <td className="pt-3 px-1 align-top">
                      <select value={item.accountCode} onChange={(e) => onUpdate(item.id, { accountCode: e.target.value })} className={inputClass}>
                        <option value="">{t("اختر حساب المصروف")}</option>
                        {expenseAccounts.map((account) => <option key={account.code} value={account.code}>{account.code} - {account.name_ar}{account.code === "2113" ? ` (${t("بضاعة مخزنية مستلمة")})` : account.code === CUSTOMS_CLEARING_ACCOUNT ? ` (${t("جمارك دفعها المخلّص نيابة عنا — بلا ضريبة")})` : ""}</option>)}
                      </select>
                    </td>
                    <td className="pt-3 pl-1 align-top min-w-[260px]">
                      <input
                        value={item.description}
                        onChange={(e) =>
                          onUpdate(item.id, { description: e.target.value })
                        }
                        placeholder={t("مطلوب")}
                        className={`w-full h-10 px-2 py-2 border border-slate-300 rounded text-sm text-right ${accentClass} focus:ring-1 outline-none`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <div className="border-t border-slate-200 pt-4 mt-2 flex justify-end">
          <div className="w-80 space-y-2 text-sm">
            {isForeign && (
              <div className="flex justify-between">
                <span className="font-semibold">
                  {formatAmount(foreignTotal)} {foreignCurrency}
                </span>
                <span className="text-slate-600">{t("المجموع بعملة المورد")}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="font-semibold">
                {formatAmount(totals.subtotal)} {t("ريال")}
              </span>
              <span className="text-slate-600">{t("المجموع الفرعي")}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-semibold">
                {formatAmount(totals.discount)} {t("ريال")}
              </span>
              <span className="text-slate-600">{t("الخصم")}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-semibold">
                {formatAmount(totals.tax)} {t("ريال")}
              </span>
              <span className="text-slate-600">
                {t("ضريبة القيمة المضافة")}
              </span>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-2">
              <span className="font-bold text-blue-600 text-base">
                {formatAmount(totals.total)} {t("ريال")}
              </span>
              <span className="font-bold text-slate-800">
                {t("المجموع الكلي")}
              </span>
            </div>
            {importTreatment === "reverse_charge" && (
              <div className="flex justify-between text-amber-800">
                <span className="font-semibold">
                  {formatAmount(reverseChargeTax)} {t("ريال")}
                </span>
                <span>{t("ضريبة احتساب عكسي (لا تُدفع للمورد)")}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Shared form hook ── */
function useInvoiceForm(initial?: Partial<PurchaseInvoice>) {
  // التواريخ الافتراضية بتوقيت الرياض (toISOString يعطي تاريخ UTC)
  const today = riyadhDateString();
  const due = riyadhDateString(30);

  const [form, setForm] = useState({
    vendor: initial?.vendor ?? "",
    vendorId: initial?.vendorId ?? "",
    // حالة تسجيل المورد ضريبيًا تُعبّأ عند اختيار المورد (FormFields)
    vendorVat: "" as VendorVatState,
    date: initial?.date ?? today,
    dueDate: initial?.dueDate ?? due,
    poNumber: initial?.poNumber ?? "",
    referenceNo: initial?.referenceNo ?? "",
    notes: initial?.notes ?? "",
    costCenter: initial?.costCenter ?? "بدون مركز تكلفة",
    costCenterName: initial?.costCenterName ?? "",
    status: initial?.status ?? "مفتوحة",
  });

  const [items, setItems] = useState<InvoiceItem[]>(
    initial?.items && initial.items.length > 0
      ? initial.items.map((item, idx) => ({ ...item, id: idx + 1 }))
      : [
          {
            id: 1,
            description: "",
            unit: "",
            accountCode: "511",
            quantity: 1,
            unitPrice: 0,
            discount: 0,
            taxPercent: 15,
          },
        ],
  );

  const setField = (field: keyof typeof form, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  // المورد غير المقيم: نوع الفاتورة (احتساب عكسي/بضائع/غير خاضعة) وعملة فاتورته وسعر الصرف
  const [importInfo, setImportInfo] = useState({
    vendorId: "",
    nonResident: false,
    treatment: "" as ImportTreatment,
    currency: "SAR",
    rate: "",
  });
  const updateImport = (changes: Partial<typeof importInfo>) =>
    setImportInfo((prev) => ({ ...prev, ...changes }));

  // عند اختيار مورد غير مسجل ضريبيًا تصبح كل البنود 0% (لا ضريبة مدخلات بلا فاتورة ضريبية)
  const setVendorVat = (state: VendorVatState, vendor?: VendorOption) => {
    const previous = form.vendorVat;
    setForm((prev) => ({ ...prev, vendorVat: state }));
    const nonResident = vendor?.tax_registration_mode === "non_resident";
    setImportInfo((prev) =>
      !nonResident
        ? { vendorId: vendor?.id ?? "", nonResident: false, treatment: "", currency: "SAR", rate: "" }
        : prev.vendorId === vendor?.id && prev.nonResident
          ? prev
          : {
              vendorId: vendor?.id ?? "",
              nonResident: true,
              treatment: "",
              currency: vendor?.currency && SUPPLIER_CURRENCIES.includes(vendor.currency) ? vendor.currency : "SAR",
              rate: "",
            },
    );
    if (state === "no") {
      setItems((prev) => prev.map((item) => ({ ...item, taxPercent: 0 })));
    } else if (state === "yes" && previous === "no") {
      // الصفر كان مفروضًا بسبب المورد السابق، فنعيد النسبة الأساسية عند اختيار مورد مسجل
      setItems((prev) =>
        prev.map((item) => ({ ...item, taxPercent: SAUDI_STANDARD_VAT_RATE })),
      );
    }
  };

  const addItem = () =>
    setItems((prev) => [
      ...prev,
      {
        id: Date.now(),
        description: "",
        unit: "",
        accountCode: "511",
        quantity: 1,
        unitPrice: 0,
        discount: 0,
        taxPercent: form.vendorVat === "no" ? 0 : SAUDI_STANDARD_VAT_RATE,
      },
    ]);

  const updateItem = (id: number, changes: Partial<InvoiceItem>) =>
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...changes } : item)),
    );

  const removeItem = (id: number) =>
    setItems((prev) => prev.filter((item) => item.id !== id));

  // نفس تقريب القاعدة لكل بند
  const totals = items.reduce(
    (acc, item) => {
      const line = lineAmounts(item);
      return {
        subtotal: round2(acc.subtotal + line.net),
        discount: round2(acc.discount + (Number(item.discount) || 0)),
        tax: round2(acc.tax + line.tax),
        total: round2(acc.total + line.total),
      };
    },
    { subtotal: 0, discount: 0, tax: 0, total: 0 },
  );

  return {
    form,
    setField,
    setVendorVat,
    importInfo,
    updateImport,
    items,
    addItem,
    updateItem,
    removeItem,
    totals,
  };
}

/* ── Shared form fields ── */
function FormFields({
  form,
  setField,
  setVendorVat,
  invoiceNumber,
  accentClass = "focus:border-blue-500 focus:ring-blue-500",
  onCreateVendor,
}: {
  form: ReturnType<typeof useInvoiceForm>["form"];
  setField: ReturnType<typeof useInvoiceForm>["setField"];
  setVendorVat?: ReturnType<typeof useInvoiceForm>["setVendorVat"];
  invoiceNumber?: string;
  accentClass?: string;
  onCreateVendor?: () => void;
}) {
  const { t, direction } = useI18n();
  const [vendorOptions, setVendorOptions] = useState<VendorOption[]>([]);
  useEffect(() => {
    const loadVendors = async () => {
      const { data } = await supabase.from("vendors").select("id, name, vendor_number, tax_registration_mode, tax_number, currency").eq("status", "نشط").order("name");
      setVendorOptions((data ?? []) as VendorOption[]);
    };
    void loadVendors();
  }, []);
  // حالة المورد المختار ضريبيًا (تشمل المورد المحفوظ على فاتورة يجري تعديلها)
  useEffect(() => {
    if (!setVendorVat || !form.vendorId) return;
    const vendor = vendorOptions.find((option) => option.id === form.vendorId);
    if (vendor) setVendorVat(vendorVatState(vendor), vendor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.vendorId, vendorOptions]);
  const today = riyadhDateString();
  const inputClass = `w-full h-10 px-3 py-2 border border-slate-300 rounded text-sm text-right ${accentClass} focus:ring-1 outline-none`;

  return (
    <div
      className="p-6 grid grid-cols-1 md:grid-cols-[170px_1fr] gap-3 items-center"
      dir={direction}
    >
      <label className="text-sm font-medium text-slate-700">
        {t("رقم الفاتورة")}*
      </label>
      <input
        type="text"
        value={invoiceNumber || t("تلقائي")}
        disabled
        className="w-full h-10 px-3 py-2 border border-slate-200 bg-slate-100 rounded text-sm text-right outline-none text-slate-500"
      />

      <label className="text-sm font-medium text-slate-700">
        {t("المورد")}*
      </label>
      <div><select value={form.vendorId} onChange={(event) => { const vendor = vendorOptions.find((option) => option.id === event.target.value); setField("vendorId", vendor?.id ?? ""); setField("vendor", vendor?.name ?? ""); }} className={inputClass}><option value="">{t("اختر المورد")}</option>{form.vendorId && !vendorOptions.some((vendor) => vendor.id === form.vendorId) && <option value={form.vendorId}>{form.vendor}</option>}{vendorOptions.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.vendor_number ? `${vendor.vendor_number} - ` : ""}{vendor.name}</option>)}</select>{onCreateVendor && <button type="button" onClick={onCreateVendor} className="mt-2 rounded bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700">{t("إنشاء مورد جديد +")}</button>}</div>

      <label className="text-sm font-medium text-slate-700">
        {t("العملة")}*
      </label>
      <input
        value="SAR"
        disabled
        className="w-full h-10 px-3 py-2 border border-slate-200 bg-slate-100 rounded text-sm text-right outline-none text-slate-500"
      />

      <label className="text-sm font-medium text-slate-700">
        {t("التاريخ")}*
      </label>
      {/* تاريخ فاتورة المورد: لا يكون مستقبليًا */}
      <input
        type="date"
        value={form.date}
        max={today}
        onChange={(e) => setField("date", e.target.value)}
        className={inputClass}
      />

      <label className="text-sm font-medium text-slate-700">
        {t("تاريخ الاستحقاق")}*
      </label>
      <input
        type="date"
        value={form.dueDate}
        min={form.date || undefined}
        onChange={(e) => setField("dueDate", e.target.value)}
        className={inputClass}
      />

      <label className="text-sm font-medium text-slate-700">
        {t("أمر شراء")}
      </label>
      <input
        value={form.poNumber}
        onChange={(e) => setField("poNumber", e.target.value)}
        placeholder={t("اختياري")}
        className={inputClass}
      />

      {/* رقم فاتورة المورد إلزامي ويُفحص تكراره لنفس المورد عند الحفظ */}
      <label className="text-sm font-medium text-slate-700">
        {t("رقم فاتورة المورد")}*
      </label>
      <input
        value={form.referenceNo}
        onChange={(e) => setField("referenceNo", e.target.value)}
        placeholder={t("كما هو مطبوع على فاتورة المورد")}
        className={inputClass}
      />

      {/* حقل "فرع" أُزيل: كان مربوطًا خطأً بحالة الفاتورة ولا يُحفظ */}
      <label className="text-sm font-medium text-slate-700">{t("الملاحظة")}</label>
      <input
        value={form.notes}
        onChange={(e) => setField("notes", e.target.value)}
        placeholder={t("اختياري")}
        className={inputClass}
      />

      <label className="text-sm font-medium text-slate-700">
        {t("المشروع")}
      </label>
      <input
        value={form.costCenterName}
        onChange={(e) => setField("costCenterName", e.target.value)}
        placeholder={t("اختياري")}
        className={inputClass}
      />
    </div>
  );
}

/* ── أمر شراء محوّل إلى فاتورة (حالة التنقل من شاشة أوامر الشراء) ── */
const readPurchaseOrderSource = (state: unknown): PurchaseOrderInvoiceSource | null => {
  const source = (state as { fromPurchaseOrder?: PurchaseOrderInvoiceSource } | null)?.fromPurchaseOrder;
  return source && typeof source === "object" && source.id ? source : null;
};

// البنود بسعر الأمر وحساب المشتريات الافتراضي 511؛ حساب 2113 يُحدَّد بعد فحص سندات الاستلام
const purchaseOrderInitial = (source: PurchaseOrderInvoiceSource): Partial<PurchaseInvoice> => ({
  vendor: source.vendor ?? "",
  vendorId: source.vendorId ?? "",
  poNumber: source.referenceNo ?? "",
  costCenter: source.costCenter || "بدون مركز تكلفة",
  costCenterName: source.costCenterName ?? "",
  items: (source.items ?? []).map((item, index) => ({
    id: index + 1,
    description: String(item.description ?? ""),
    unit: String(item.unit ?? ""),
    accountCode: "511",
    quantity: Number(item.quantity) || 0,
    unitPrice: Number(item.price) || 0,
    discount: Number(item.discount) || 0,
    taxPercent: Number(item.taxPercent) === SAUDI_STANDARD_VAT_RATE ? SAUDI_STANDARD_VAT_RATE : 0,
  })),
});

/* ── Create Form ── */
function InvoiceForm({
  onBack,
  onSaved,
}: {
  onBack: () => void;
  onSaved: (i: PurchaseInvoice) => void;
}) {
  const { t, direction } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  // يُقرأ مرة واحدة عند فتح النموذج، ثم تُمسح حالة التنقل حتى لا تتكرر التعبئة عند العودة أو التحديث
  const [fromOrder] = useState(() => readPurchaseOrderSource(location.state));
  const {
    form,
    setField,
    setVendorVat,
    importInfo,
    updateImport,
    items,
    addItem,
    updateItem,
    removeItem,
  } = useInvoiceForm(fromOrder ? purchaseOrderInitial(fromOrder) : undefined);
  // حساب البضاعة المستلمة غير المفوترة الذي وُجّهت إليه بنود الأصناف المستلمة (للتنبيه)
  const [grniAccount, setGrniAccount] = useState("");
  useEffect(() => {
    if (!fromOrder) return;
    navigate(location.pathname, { replace: true, state: null });
    const productLines = (fromOrder.items ?? [])
      .map((item, index) => (item.productId ? { id: index + 1, productId: String(item.productId) } : null))
      .filter((line): line is { id: number; productId: string } => line !== null);
    if (productLines.length === 0) return;
    let cancelled = false;
    const applyGrniAccount = async () => {
      // سند استلام مرحّل لهذا الأمر: purchase_order_id نص يُدخل فيه رقم الأمر (أو معرّفه)
      const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);
      const reference = String(fromOrder.referenceNo ?? "").trim();
      const lookups = await Promise.all([
        supabase.from("inventory_receipts").select("id").eq("status", "posted").eq("purchase_order_id", fromOrder.id),
        reference
          ? supabase.from("inventory_receipts").select("id").eq("status", "posted").ilike("purchase_order_id", escapeLike(reference))
          : Promise.resolve({ data: [] as { id: string }[], error: null }),
      ]);
      const receiptIds = Array.from(
        new Set(lookups.flatMap((result) => (result.error ? [] : ((result.data ?? []) as { id: unknown }[]).map((row) => String(row.id))))),
      );
      if (cancelled || receiptIds.length === 0) return;
      // الأصناف المستلمة فعلًا في تلك السندات؛ إن تعذرت قراءتها تُعامل بنود الأصناف كلها كمستلمة
      const { data: lines, error: linesError } = await supabase
        .from("inventory_receipt_lines")
        .select("product_id")
        .in("receipt_id", receiptIds);
      const received = linesError ? null : new Set(((lines ?? []) as { product_id: unknown }[]).map((line) => String(line.product_id)));
      const { data: rule } = await supabase
        .from("accounting_posting_rules")
        .select("grni_account_code")
        .eq("rule_code", "sales_default")
        .maybeSingle();
      const grni = String(rule?.grni_account_code ?? "").trim() || "2113";
      const targets = productLines.filter((line) => !received || received.has(line.productId));
      if (cancelled || targets.length === 0) return;
      targets.forEach((line) => updateItem(line.id, { accountCode: grni }));
      setGrniAccount(grni);
    };
    void applyGrniAccount();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // المورد غير المقيم بعملة أجنبية: البنود تُدخل بعملته وتُرسل للقاعدة بالريال
  const isForeign = importInfo.nonResident && importInfo.currency !== "SAR";
  // سعر الصرف بست خانات كما يُحفظ في القاعدة، فيطابق التحويل هنا ما تتحقق منه
  const exchangeRate = isForeign ? Number((Number(importInfo.rate) || 0).toFixed(6)) : 1;
  const sarItems = isForeign && exchangeRate > 0 ? items.map((item) => toSarItem(item, exchangeRate)) : items;
  const totals = sarItems.reduce(
    (acc, item) => {
      const line = lineAmounts(item);
      return {
        subtotal: round2(acc.subtotal + line.net),
        tax: round2(acc.tax + line.tax),
        total: round2(acc.total + line.total),
      };
    },
    { subtotal: 0, tax: 0, total: 0 },
  );
  const foreignTotal = round2(items.reduce((sum, item) => sum + lineAmounts({ ...item, taxPercent: 0 }).net, 0));
  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [creatingVendor, setCreatingVendor] = useState(false);

  useEffect(() => {
    const loadInvoiceNumber = async () => {
      // عرض فقط: الرقم الفعلي يُحجز عند الحفظ (1001-PIN-000001 لكل منشأة)
      const { data } = await supabase
        .from("purchase_invoices")
        .select("id")
        .like("id", companyNumberLike("PIN"))
        .order("id", { ascending: false })
        .limit(1);

      setInvoiceNumber(previewNextNumber(data?.[0]?.id, "PIN", 6));
    };

    void loadInvoiceNumber();
  }, []);

  const handleSave = async () => {
    if (saveInFlight.current) return;
    if (!form.date) {
      setError(t("يرجى إدخال تاريخ الفاتورة"));
      return;
    }
    if (!form.vendorId || !form.vendor.trim()) {
      setError(t("يرجى اختيار المورد قبل حفظ الفاتورة"));
      return;
    }
    // فاتورة أمر الشراء لمورد الأمر نفسه؛ أمر قديم بلا مورد مسجل يُختار له المورد يدويًا
    if (fromOrder?.vendorId && form.vendorId !== fromOrder.vendorId) {
      setError(t("مورد الفاتورة يجب أن يطابق مورد أمر الشراء. لفوترة مورد آخر أنشئ فاتورة مستقلة بدون أمر الشراء"));
      return;
    }
    if (items.length === 0 || items.some((item) => !item.description.trim() || !item.accountCode || item.quantity <= 0 || item.unitPrice < 0 || item.discount < 0 || item.discount > item.quantity * item.unitPrice)) {
      setError(t("يرجى إكمال بنود الفاتورة والتأكد من الحساب والكميات والأسعار والخصومات"));
      return;
    }
    // التواريخ: لا فاتورة بتاريخ مستقبلي، والاستحقاق لا يسبق الفاتورة
    if (form.date > riyadhDateString()) {
      setError(t("تاريخ الفاتورة لا يمكن أن يكون في المستقبل"));
      return;
    }
    if (form.dueDate && form.dueDate < form.date) {
      setError(t("تاريخ الاستحقاق يجب ألا يسبق تاريخ الفاتورة"));
      return;
    }
    // ضريبة المدخلات تُطالَب فقط من مورد مسجل ضريبيًا برقم صحيح
    if (form.vendorVat !== "yes" && items.some((item) => Number(item.taxPercent) > 0)) {
      setError(t("المورد غير مسجل ضريبيًا أو رقمه الضريبي غير صحيح: اجعل ضريبة البنود 0% أو صحّح بيانات المورد"));
      return;
    }
    if (items.some((item) => ![0, SAUDI_STANDARD_VAT_RATE].includes(Number(item.taxPercent)))) {
      setError(t("نسبة الضريبة يجب أن تكون 15% أو 0%"));
      return;
    }
    // سطر الجمارك المدفوعة نيابة عنا (فاتورة المخلّص): ضريبته مسجلة في البيان الجمركي
    if (items.some((item) => item.accountCode === CUSTOMS_CLEARING_ACCOUNT && Number(item.taxPercent) > 0)) {
      setError(t("سطر الجمارك المدفوعة نيابة عنا بلا ضريبة؛ ضريبته مسجلة في البيان الجمركي"));
      return;
    }
    if (importInfo.nonResident) {
      if (!importInfo.treatment) {
        setError(t("حدد نوع فاتورة المورد غير المقيم: خدمات (احتساب عكسي) أو بضائع (البيان الجمركي) أو غير خاضعة"));
        return;
      }
      if (isForeign && !(exchangeRate > 0)) {
        setError(t("أدخل سعر صرف عملة المورد مقابل الريال في تاريخ الفاتورة"));
        return;
      }
      // الحساب الوسيط 2115 يُغلق بفاتورة المخلّص المحلي فقط
      if (items.some((item) => item.accountCode === CUSTOMS_CLEARING_ACCOUNT)) {
        setError(t("الحساب الوسيط 2115 يُستخدم في فاتورة المخلّص الجمركي فقط"));
        return;
      }
      // نفس هامش القاعدة: نصف الوحدة الصغرى لعملة المورد × السعر + هللة لكل بند
      if (isForeign && Math.abs(round2(foreignTotal * exchangeRate) - totals.total) > items.length * (0.005 * exchangeRate + 0.01) + 0.01) {
        setError(t("بيانات عملة المورد أو سعر الصرف غير صحيحة"));
        return;
      }
    }
    // رقم فاتورة المورد إلزامي ولا يتكرر لنفس المورد (منع تسجيل الفاتورة مرتين)
    const supplierInvoiceNo = form.referenceNo.trim();
    if (!supplierInvoiceNo) {
      setError(t("يرجى إدخال رقم فاتورة المورد كما هو مطبوع عليها"));
      return;
    }

    saveInFlight.current = true;
    setSaving(true);
    setError(null);

    try {
      // أمر الشراء لا يُحوَّل مرتين: يُتأكد أنه ما زال مفتوحًا وغير مربوط بفاتورة
      if (fromOrder) {
        const { data: orderRow } = await supabase
          .from("purchase_orders")
          .select("invoice_id, status")
          .eq("id", fromOrder.id)
          .maybeSingle();
        if (orderRow && (orderRow.invoice_id || orderRow.status !== "مفتوح")) {
          setError(
            orderRow.invoice_id
              ? `${t("أمر الشراء هذا محوّل إلى فاتورة مسبقًا")}: ${orderRow.invoice_id}`
              : t("أمر الشراء مغلق ولا يمكن تحويله إلى فاتورة"),
          );
          return;
        }
        // فاتورة مسجلة مسبقًا برقم هذا الأمر (ولو لم يُربط الأمر بها) تمنع تسجيله مرة ثانية
        const orderReference = String(fromOrder.referenceNo ?? "").trim();
        if (orderReference) {
          const { data: orderInvoices, error: orderInvoicesError } = await supabase
            .from("purchase_invoices")
            .select("id")
            .eq("po_number", orderReference)
            .limit(1);
          if (orderInvoicesError) {
            setError(`${t("تعذّر التحقق من فواتير أمر الشراء")}: ${dbErrorOr(String(orderInvoicesError.message ?? ""))}`);
            return;
          }
          const orderInvoice = orderInvoices?.[0] as { id?: unknown } | undefined;
          if (orderInvoice) {
            setError(
              `${t("توجد فاتورة مشتريات مسجلة لأمر الشراء هذا مسبقًا")}: ${String(orderInvoice.id ?? "")}. ${t("لا يُحوَّل أمر الشراء إلى فاتورة مرتين")}`,
            );
            return;
          }
        }
      }
      const normalizeRef = (value: unknown) =>
        String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
      const { data: vendorInvoices, error: duplicateError } = await supabase
        .from("purchase_invoices")
        .select("id, reference_no")
        .eq("vendor_id", form.vendorId)
        .not("reference_no", "is", null);
      const duplicate = duplicateError
        ? undefined
        : (vendorInvoices ?? []).find(
            (row) => normalizeRef(row.reference_no) === normalizeRef(supplierInvoiceNo),
          );
      if (duplicate) {
        setError(
          `${t("فاتورة المورد هذه مسجلة مسبقًا برقم")} ${duplicate.id}. ${t("لا تُسجَّل الفاتورة مرتين")}`,
        );
        return;
      }
      const totalStr = totals.total.toFixed(2);
      // رقم فاتورة المشتريات لكل منشأة يُحجز من قاعدة البيانات عند الحفظ
      let savedId = await nextCompanyNumber("PIN", 6);
      let postError: { code?: string; message?: string } | null = null;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const result = await supabase.rpc("create_and_post_purchase_invoice", {
          p_invoice: {
            id: savedId,
            vendorId: form.vendorId,
            date: form.date,
            dueDate: form.dueDate,
            poNumber: form.poNumber,
            referenceNo: supplierInvoiceNo,
            notes: form.notes,
            costCenter: form.costCenter,
            costCenterName: form.costCenterName,
            importTreatment: importInfo.nonResident ? importInfo.treatment : "",
            supplierCurrency: isForeign ? importInfo.currency : "",
            exchangeRate: isForeign ? exchangeRate : "",
            supplierCurrencyTotal: isForeign ? foreignTotal : "",
            items: sarItems.map((item, index) => ({
              id: item.id,
              description: item.description,
              unit: item.unit,
              accountCode: item.accountCode,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              discount: item.discount,
              taxPercent: item.taxPercent,
              ...(isForeign
                ? { foreignUnitPrice: Number(items[index].unitPrice) || 0, foreignDiscount: Number(items[index].discount) || 0 }
                : {}),
            })),
          },
        });
        postError = result.error;
        // 23505 لرقم فاتورة المورد المكرر (فهرس القاعدة) لا يُعالج بتغيير رقم فاتورتنا
        if (!postError || postError.code !== "23505" || String(postError.message ?? "").includes("purchase_invoices_vendor_reference_uidx")) break;
        savedId = await nextCompanyNumber("PIN", 6);
      }

      if (postError) {
        setError(
          String(postError.message ?? "").includes("purchase_invoices_vendor_reference_uidx")
            ? `${t("فاتورة المورد هذه مسجلة مسبقًا لنفس المورد")}. ${t("لا تُسجَّل الفاتورة مرتين")}`
            : String(postError.message ?? "").includes("PURCHASE_INVOICE_MANAGE_PERMISSION_REQUIRED")
            ? t("إنشاء فواتير المشتريات يحتاج صلاحية إدارة فواتير المشتريات")
            : String(postError.message ?? "").includes("PURCHASE_ITEM_ACCOUNT_NOT_ALLOWED")
            ? t("حساب البند يجب أن يكون من حسابات المصروفات أو البضاعة المستلمة غير المفوترة")
            : String(postError.message ?? "").includes("PURCHASE_IMPORT_TREATMENT_REQUIRED")
            ? t("حدد نوع فاتورة المورد غير المقيم: خدمات (احتساب عكسي) أو بضائع (البيان الجمركي) أو غير خاضعة")
            : String(postError.message ?? "").includes("PURCHASE_SUPPLIER_CURRENCY")
            ? t("بيانات عملة المورد أو سعر الصرف غير صحيحة")
            : String(postError.message ?? "").includes("PURCHASE_CUSTOMS_CLEARING_LINE_TAX_NOT_ALLOWED")
            ? t("سطر الجمارك المدفوعة نيابة عنا بلا ضريبة؛ ضريبته مسجلة في البيان الجمركي")
            : String(postError.message ?? "").includes("PURCHASE_CUSTOMS_CLEARING_LINE_NOT_ALLOWED")
            ? t("الحساب الوسيط 2115 يُستخدم في فاتورة المخلّص الجمركي فقط")
            : postError.code === "23505"
            ? t("رقم الفاتورة مستخدم بالفعل. حدّث القائمة ثم حاول مرة أخرى.")
            : `${t("تعذّر حفظ وترحيل الفاتورة")}: ${postError.message ?? t("حاول مرة أخرى")}`,
        );
        return;
      }

      // الفاتورة محفوظة: يُربط أمر الشراء بها ويُغلق. فشل الربط لا يلغي الفاتورة، ويظهر تنبيه
      let orderLinkWarning: string | null = null;
      if (fromOrder) {
        const { data: linked, error: linkError } = await supabase
          .from("purchase_orders")
          .update({ invoice_id: savedId, status: "مغلق" })
          .eq("id", fromOrder.id)
          .is("invoice_id", null)
          .select("id");
        if (linkError || !linked || linked.length === 0) {
          orderLinkWarning = linkError
            ? dbErrorOr(String(linkError.message ?? ""))
            : t("لم يُحدَّث أمر الشراء: حُذف أو رُبط بفاتورة أخرى أو لا تملك صلاحية تعديل أوامر الشراء. راجع الأمر وأغلقه يدويًا");
        }
      }

      const { vendorVat: _vendorVat, ...savedFields } = form;
      onSaved({
        id: savedId,
        ...savedFields,
        referenceNo: supplierInvoiceNo,
        status: "مفتوحة",
        total: totalStr,
        paid: "0.00",
        remaining: totalStr,
        statusColor: statusColors["مفتوحة"],
        accountingStatus: "posted",
        accountingJournalEntryId: "",
        items: sarItems,
        importTreatment: importInfo.nonResident ? importInfo.treatment : "",
        reverseChargeTax: importInfo.nonResident && importInfo.treatment === "reverse_charge" ? reverseChargeTaxOf(sarItems) : 0,
        supplierCurrency: isForeign ? importInfo.currency : "",
        exchangeRate: isForeign ? exchangeRate : 0,
        supplierCurrencyTotal: isForeign ? foreignTotal : 0,
      });
      // يظهر بعد تنبيه الحفظ العام (تنبيه واحد في كل مرة)
      if (fromOrder) {
        toast(
          orderLinkWarning
            ? {
                title: t("حُفظت الفاتورة لكن تعذّر إغلاق أمر الشراء وربطه بها"),
                description: `${t("الفاتورة")}: ${savedId} — ${t("أمر الشراء")}: ${fromOrder.referenceNo || "-"} — ${orderLinkWarning}`,
                variant: "destructive",
              }
            : {
                title: t("تم حفظ الفاتورة وإغلاق أمر الشراء"),
                description: `${t("الفاتورة")}: ${savedId} — ${t("أمر الشراء")}: ${fromOrder.referenceNo || "-"}`,
              },
        );
      }
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : t("حدث خطأ غير متوقع أثناء الحفظ"),
      );
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6" dir={direction}>
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-slate-800">
              {t("فاتورة مشتريات")}
            </h1>
            <p className="text-sm text-slate-500">
              {t("معلومات فاتورة المشتريات")}
            </p>
          </div>
          <button
            onClick={onBack}
            disabled={saving}
            className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-sm rounded hover:bg-slate-50 flex items-center gap-2 disabled:opacity-50"
          >
            {t("العودة للقائمة")} <ArrowLeftRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm text-right">
          {error}
        </div>
      )}

      {fromOrder && (
        <div className="p-3 bg-indigo-50 border border-indigo-200 rounded text-indigo-900 text-sm text-right space-y-1">
          <p className="font-semibold">
            {t("فاتورة من أمر الشراء")} {fromOrder.referenceNo || "-"}
          </p>
          <p>{t("بعد حفظ الفاتورة يُغلق أمر الشراء ويُربط بها. أدخل رقم فاتورة المورد وراجع البنود قبل الحفظ.")}</p>
          {grniAccount && (
            <p>
              {t("بنود الأصناف المستلمة بسند استلام مرحّل وُجّهت إلى حساب البضاعة المستلمة غير المفوترة")} ({grniAccount})
            </p>
          )}
          {!fromOrder.vendorId && (
            <p className="text-amber-700">
              {t("أمر الشراء غير مربوط بمورد مسجل: اختر المورد قبل الحفظ")}
              {fromOrder.vendor ? ` — ${fromOrder.vendor}` : ""}
            </p>
          )}
        </div>
      )}

      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <div className="bg-slate-100 px-4 py-2 text-right font-semibold text-slate-800">
          {t("معلومات فاتورة المشتريات")}
        </div>
        <FormFields
          form={form}
          setField={setField}
          setVendorVat={setVendorVat}
          invoiceNumber={invoiceNumber}
          onCreateVendor={() => setCreatingVendor(true)}
        />
      </div>
      {importInfo.nonResident && (
        <div className="bg-white rounded-lg border border-amber-200 shadow-sm overflow-hidden">
          <div className="bg-amber-50 px-4 py-2 text-right font-semibold text-amber-900">
            {t("مورد غير مقيم — نوع الفاتورة وعملتها")}
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-[170px_1fr] gap-3 items-center">
            <label className="text-sm font-medium text-slate-700">{t("نوع الفاتورة")}*</label>
            <select
              value={importInfo.treatment}
              onChange={(e) => updateImport({ treatment: e.target.value as ImportTreatment })}
              className="w-full h-10 px-3 py-2 border border-slate-300 rounded text-sm text-right outline-none"
            >
              <option value="">{t("اختر نوع الفاتورة")}</option>
              {(Object.keys(IMPORT_TREATMENT_LABELS) as Exclude<ImportTreatment, "">[]).map((key) => (
                <option key={key} value={key}>{t(IMPORT_TREATMENT_LABELS[key])}</option>
              ))}
            </select>
            <label className="text-sm font-medium text-slate-700">{t("عملة فاتورة المورد")}*</label>
            <select
              value={importInfo.currency}
              onChange={(e) => updateImport({ currency: e.target.value, rate: e.target.value === "SAR" ? "" : importInfo.rate })}
              className="w-full h-10 px-3 py-2 border border-slate-300 rounded text-sm text-right outline-none"
            >
              {SUPPLIER_CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}
            </select>
            {isForeign && (
              <>
                <label className="text-sm font-medium text-slate-700">{t("سعر الصرف (ريال لكل وحدة)")}*</label>
                <input
                  type="number"
                  min={0}
                  step="0.000001"
                  value={importInfo.rate}
                  onChange={(e) => updateImport({ rate: e.target.value })}
                  placeholder={t("سعر الصرف في تاريخ الفاتورة")}
                  className="w-full h-10 px-3 py-2 border border-slate-300 rounded text-sm text-right outline-none"
                />
              </>
            )}
            <p className="md:col-span-2 text-xs text-slate-500">
              {t("القيد والإقرار بالريال؛ عملة المورد وسعر الصرف يُحفظان للتوثيق. الضريبة لا تُضاف على فاتورة المورد غير المقيم.")}
            </p>
          </div>
        </div>
      )}
      {creatingVendor && <PartyRegistrationDialog kind="vendor" onClose={() => setCreatingVendor(false)} onCreated={(party) => { setField("vendorId", party.id); setField("vendor", party.name); setVendorVat(SAUDI_VAT_NUMBER_PATTERN.test(String(party.vatNumber ?? "").trim()) ? "yes" : "no"); setCreatingVendor(false); }} />}

      <ItemsTable
        items={items}
        onAdd={addItem}
        onUpdate={updateItem}
        onRemove={removeItem}
        vendorVat={form.vendorVat}
        foreignCurrency={importInfo.nonResident ? importInfo.currency : "SAR"}
        exchangeRate={exchangeRate}
        importTreatment={importInfo.nonResident ? importInfo.treatment : ""}
      />

      <div className="flex justify-center gap-4 pt-2">
        <button
          onClick={onBack}
          disabled={saving}
          className="px-6 py-2 bg-slate-500 text-white text-sm rounded hover:bg-slate-600 disabled:opacity-50"
        >
          {t("إلغاء")}
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {saving ? t("جارٍ الحفظ...") : t("حفظ الفاتورة")}
        </button>
      </div>
    </div>
  );
}

/* ── Edit Form ── */
function InvoiceEdit({
  invoice,
  onBack,
  onUpdated,
}: {
  invoice: PurchaseInvoice;
  onBack: () => void;
  onUpdated: (i: PurchaseInvoice) => void;
}) {
  const { t, direction } = useI18n();
  const {
    form,
    setField,
    setVendorVat,
    importInfo,
    items,
    addItem,
    updateItem,
    removeItem,
    totals,
  } = useInvoiceForm(invoice);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (invoice.accountingStatus === "posted") {
      setError(t("لا يمكن تعديل فاتورة مشتريات مرحلة محاسبيًا"));
      return;
    }
    if (saving) return;
    if (!form.vendorId || items.length === 0 || items.some((item) => !item.description.trim() || !item.accountCode || item.quantity <= 0 || item.unitPrice < 0 || item.discount < 0 || item.discount > item.quantity * item.unitPrice)) {
      setError(t("يرجى اختيار المورد وإكمال بنود الفاتورة بصورة صحيحة"));
      return;
    }
    if (form.date > riyadhDateString() || (form.dueDate && form.dueDate < form.date)) {
      setError(t("تاريخ الفاتورة لا يكون مستقبليًا، والاستحقاق لا يسبق تاريخ الفاتورة"));
      return;
    }
    if (form.vendorVat === "no" && items.some((item) => Number(item.taxPercent) > 0)) {
      setError(t("المورد غير مسجل ضريبيًا أو رقمه الضريبي غير صحيح: اجعل ضريبة البنود 0% أو صحّح بيانات المورد"));
      return;
    }
    // فاتورة المورد غير المقيم تُسجَّل فاتورةً جديدة (نوعها وعملتها تُحدَّد عند الإنشاء)
    if (importInfo.nonResident) {
      setError(t("فاتورة المورد غير المقيم تُسجَّل كفاتورة جديدة؛ لا تُحوَّل فاتورة قائمة إليه"));
      return;
    }
    setSaving(true);
    setError(null);

    const paidValue = parseCurrency(invoice.paid);
    const totalStr = totals.total.toFixed(2);
    const remainingStr = Math.max(totals.total - paidValue, 0).toFixed(2);

    const { error: updateError } = await supabase
      .from("purchase_invoices")
      .update({
        vendor: form.vendor,
        vendor_id: form.vendorId,
        date: form.date,
        due_date: form.dueDate || null,
        po_number: form.poNumber || null,
        reference_no: form.referenceNo || null,
        notes: form.notes || null,
        cost_center: form.costCenter,
        cost_center_name: form.costCenterName || null,
        items: items.map((item) => ({
          id: item.id,
          description: item.description,
          unit: item.unit,
          accountCode: item.accountCode,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount,
          taxPercent: item.taxPercent,
        })),
      })
      .eq("id", invoice.id);

    setSaving(false);
    if (!updateError) {
      const { vendorVat: _vendorVat, ...updatedFields } = form;
      onUpdated({
        ...invoice,
        ...updatedFields,
        total: totalStr,
        remaining: remainingStr,
        statusColor: statusColors[form.status] ?? "bg-slate-500 text-white",
        items,
      });
    } else {
      setError(`${t("تعذّر التحديث")}: ${updateError.message}`);
    }
  };

  return (
    <div className="space-y-6 bg-slate-50 min-h-screen pb-12" dir={direction}>
      <div className="flex justify-between items-center bg-white p-4 border-b border-slate-200 shadow-sm">
        <div className="flex gap-2">
          <button
            onClick={onBack}
            disabled={saving}
            className="px-4 py-2 bg-slate-500 text-white text-sm rounded hover:bg-slate-600 flex items-center gap-1 disabled:opacity-50"
          >
            <X className="h-4 w-4" /> {t("إلغاء")}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-emerald-600 text-white text-sm rounded hover:bg-emerald-700 flex items-center gap-2 disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {saving ? t("جارٍ الحفظ...") : t("حفظ التعديلات")}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-slate-800">
            {t("تعديل فاتورة المشتريات")}
          </h1>
          <Edit className="h-5 w-5 text-emerald-600" />
        </div>
        <button
          onClick={onBack}
          disabled={saving}
          className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-sm rounded hover:bg-slate-50 flex items-center gap-2 disabled:opacity-50"
        >
          {t("العودة للقائمة")} <ArrowLeftRight className="h-4 w-4" />
        </button>
      </div>

      {error && (
        <div className="mx-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm text-right">
          {error}
        </div>
      )}

      <div className="p-4 space-y-6">
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-amber-400 px-4 py-2 text-right font-semibold text-slate-800">
            {t("معلومات الفاتورة")}
          </div>
          <FormFields
            form={form}
            setField={setField}
            setVendorVat={setVendorVat}
            accentClass="focus:border-emerald-500 focus:ring-emerald-500"
          />
        </div>
        <ItemsTable
          items={items}
          onAdd={addItem}
          onUpdate={updateItem}
          onRemove={removeItem}
          vendorVat={form.vendorVat}
          accentClass="focus:border-emerald-500 focus:ring-emerald-500"
        />
        <div className="flex justify-center gap-4 pt-2">
          <button
            onClick={onBack}
            disabled={saving}
            className="px-6 py-2 bg-slate-500 text-white text-sm rounded hover:bg-slate-600 disabled:opacity-50"
          >
            {t("إلغاء")}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 bg-emerald-600 text-white text-sm rounded hover:bg-emerald-700 flex items-center gap-2 disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {saving ? t("جارٍ الحفظ...") : t("حفظ التعديلات")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Payment ── */
type PaymentAccount = {
  code: string;
  name: string;
  bankName: string;
  kind: "bank" | "cash";
};

type InvoicePaymentRow = {
  id: string;
  number: string;
  amount: number;
  date: string;
  method: string;
  reference: string;
  accountCode: string;
  chequeNumber: string;
  chequeDate: string;
  chequeStatus: "" | "deferred" | "banked" | "cancelled";
  chequeClearedOn: string;
  status: "posted" | "reversed";
  reversedOn: string;
  reversalReason: string;
};

const PAYMENT_METHODS = ["تحويل بنكي", "شيك", "بطاقة ائتمانية", "نقدي"] as const;

// رسائل أخطاء دوال السداد في القاعدة
const purchasePaymentErrorText = (message: string, t: (key: string) => string) => {
  const map: [string, string][] = [
    ["PURCHASE_PAYMENT_PERMISSION_REQUIRED", "السداد يحتاج صلاحية إدارة الحسابات"],
    ["PURCHASE_PAYMENT_ACCOUNT_KIND_MISMATCH", "النقد يُصرف من صندوق، والتحويل والشيك والبطاقة من حساب بنكي"],
    ["PURCHASE_PAYMENT_ACCOUNT_INVALID", "اختر حسابًا بنكيًا أو صندوقًا مسجلًا ونشطًا"],
    ["PURCHASE_CHEQUE_DETAILS_REQUIRED", "أدخل رقم الشيك وتاريخ استحقاقه"],
    ["PURCHASE_CHEQUE_DETAILS_NOT_ALLOWED", "بيانات الشيك للسداد بشيك فقط"],
    ["PURCHASE_CHEQUE_NUMBER_DUPLICATE", "رقم الشيك مستخدم على هذا الحساب البنكي لمورد آخر أو بتاريخ آخر، أو صُرف أو أُلغي"],
    ["PURCHASE_PAYMENT_EXCEEDS_REMAINING", "المبلغ يتجاوز المتبقي على الفاتورة"],
    ["PURCHASE_PAYMENT_DATE_INVALID", "تاريخ السداد لا يكون في المستقبل ولا قبل تاريخ الفاتورة"],
    ["PURCHASE_PAYMENT_AMOUNT_INVALID", "مبلغ السداد غير صحيح"],
    ["PURCHASE_CHEQUE_NOT_DEFERRED", "هذا الشيك ليس مؤجلًا بانتظار الصرف"],
    ["PURCHASE_CHEQUE_CLEAR_DATE_INVALID", "تاريخ الصرف لا يسبق تاريخ الإصدار ولا يكون في المستقبل"],
    ["PURCHASE_PAYMENT_ALREADY_REVERSED", "هذا السداد معكوس من قبل"],
    ["PURCHASE_PAYMENT_REVERSAL_REASON_REQUIRED", "اكتب سبب العكس"],
    ["PURCHASE_PAYMENT_REVERSAL_DATE_INVALID", "تاريخ العكس لا يسبق السداد أو الصرف ولا يكون في المستقبل"],
    ["ACCOUNTING_FISCAL_PERIOD_CLOSED", "الفترة المحاسبية لهذا التاريخ مقفلة"],
    ["ACCOUNTING_FISCAL_PERIOD_REQUIRED", "لا توجد فترة محاسبية لهذا التاريخ"],
    ["POSTED_PURCHASE_INVOICE_REQUIRED", "الفاتورة غير مرحّلة محاسبيًا"],
    ["PURCHASE_PAYMENT_NOT_FOUND", "السداد غير موجود؛ حدّث الصفحة"],
  ];
  const hit = map.find(([code]) => message.includes(code));
  return hit ? t(hit[1]) : message;
};

const mapPaymentRow = (row: Record<string, unknown>): InvoicePaymentRow => ({
  id: String(row.id),
  number: String(row.payment_number ?? ""),
  amount: Number(row.amount) || 0,
  date: String(row.payment_date ?? ""),
  method: String(row.payment_method ?? ""),
  reference: String(row.reference ?? ""),
  accountCode: String(row.bank_account_code ?? row.withdrawal_account_code ?? ""),
  chequeNumber: String(row.cheque_number ?? ""),
  chequeDate: String(row.cheque_date ?? ""),
  chequeStatus: (String(row.cheque_status ?? "") as InvoicePaymentRow["chequeStatus"]),
  chequeClearedOn: String(row.cheque_cleared_on ?? ""),
  status: row.status === "reversed" ? "reversed" : "posted",
  reversedOn: String(row.reversed_on ?? ""),
  reversalReason: String(row.reversal_reason ?? ""),
});

function InvoicePayment({
  invoice,
  canPay,
  onBack,
  onUpdated,
  onRefreshed,
}: {
  invoice: PurchaseInvoice;
  canPay: boolean;
  onBack: () => void;
  onUpdated: (i: PurchaseInvoice) => void;
  onRefreshed: (i: PurchaseInvoice) => void;
}) {
  const { t, direction, formatNumber, formatDate } = useI18n();
  const formatAmount = (value: number) =>
    formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const displayDate = (value: string) =>
    value ? formatDate(value, { dateStyle: "medium" }) : "-";
  const today = riyadhDateString();
  const [current, setCurrent] = useState<PurchaseInvoice>(invoice);
  const remainingValue = parseCurrency(current.remaining);
  const [amount, setAmount] = useState(parseCurrency(invoice.remaining).toFixed(2));
  const [paymentMethod, setPaymentMethod] = useState<string>("تحويل بنكي");
  const [accountCode, setAccountCode] = useState("");
  const [chequeNumber, setChequeNumber] = useState("");
  const [chequeDate, setChequeDate] = useState(today);
  // تاريخ الشيك يتبع تاريخ السداد حتى يعدّله المستخدم (حتى لا يصير الشيك مؤجلًا دون قصد)
  const [chequeDateTouched, setChequeDateTouched] = useState(false);
  const [paymentsError, setPaymentsError] = useState("");
  const [paymentRef, setPaymentRef] = useState("");
  const [paymentDate, setPaymentDate] = useState(today);
  const [saving, setSaving] = useState(false);
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [payments, setPayments] = useState<InvoicePaymentRow[]>([]);
  const [action, setAction] = useState<{ type: "clear" | "reverse"; paymentId: string } | null>(null);
  const [actionDate, setActionDate] = useState(today);
  const [actionReason, setActionReason] = useState("");
  // يمنع تسجيل سداد أو إجراء مكرر عند النقر المتتابع قبل أن يُعطَّل الزر
  const paymentInFlight = useRef(false);

  const isCash = paymentMethod === "نقدي";
  const isCheque = paymentMethod === "شيك";
  const allowedAccounts = accounts.filter((account) => account.kind === (isCash ? "cash" : "bank"));
  const chequeDeferred = isCheque && !!chequeDate && !!paymentDate && chequeDate > paymentDate;
  const accountLabel = (code: string) => {
    const account = accounts.find((item) => item.code === code);
    return account ? `${account.name}${account.bankName ? ` — ${account.bankName}` : ""} (${code})` : code || "-";
  };

  const loadPayments = async () => {
    const { data, error } = await supabase
      .from("purchase_payments")
      .select("id, payment_number, amount, payment_date, payment_method, reference, withdrawal_account_code, bank_account_code, cheque_number, cheque_date, cheque_status, cheque_cleared_on, status, reversed_on, reversal_reason, created_at")
      .eq("invoice_id", invoice.id)
      .order("payment_date", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) {
      setPaymentsError(error.message);
      return;
    }
    setPaymentsError("");
    setPayments((data ?? []).map((row) => mapPaymentRow(row as Record<string, unknown>)));
  };

  const reloadInvoice = async () => {
    const { data } = await supabase.from("purchase_invoices").select("*").eq("id", invoice.id).maybeSingle();
    if (data) {
      const mapped = { ...mapRow(data as Record<string, unknown>), issuerName: current.issuerName };
      setCurrent(mapped);
      return mapped;
    }
    return null;
  };

  useEffect(() => {
    let active = true;
    supabase
      .from("accounting_bank_accounts")
      .select("account_code, name, bank_name, account_kind")
      .eq("active", true)
      .order("name")
      .then(({ data }) => {
        if (!active) return;
        setAccounts(
          (data ?? []).map((row: Record<string, unknown>) => ({
            code: String(row.account_code),
            name: String(row.name ?? ""),
            bankName: String(row.bank_name ?? ""),
            kind: row.account_kind === "cash" ? "cash" : "bank",
          })),
        );
      });
    loadPayments();
    // أرقام الفاتورة من القاعدة لا من القائمة (قد تكون قديمة)
    reloadInvoice().then((fresh) => {
      if (active && fresh) setAmount(parseCurrency(fresh.remaining).toFixed(2));
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice.id]);

  useEffect(() => {
    if (!chequeDateTouched) setChequeDate(paymentDate);
  }, [paymentDate, chequeDateTouched]);

  // الحساب يتبع طريقة الدفع: صندوق للنقد، وبنك لغيره
  useEffect(() => {
    if (!allowedAccounts.some((account) => account.code === accountCode)) {
      setAccountCode(allowedAccounts.length === 1 ? allowedAccounts[0].code : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentMethod, accounts]);

  const handleSave = async () => {
    if (paymentInFlight.current || !canPay) return;
    const payAmount = round2(Number(amount));
    if (!Number.isFinite(payAmount) || payAmount <= 0 || payAmount > remainingValue + 0.01) {
      toast({ title: t("مبلغ السداد غير صحيح"), description: t("يجب أن يكون المبلغ موجبًا ولا يتجاوز المتبقي") });
      return;
    }
    if (!paymentDate) {
      toast({ title: t("يرجى إدخال تاريخ السداد") });
      return;
    }
    // لا سداد بتاريخ مستقبلي ولا قبل تاريخ الفاتورة
    if (paymentDate > today || (current.date && paymentDate < current.date)) {
      toast({
        title: t("تاريخ السداد غير صحيح"),
        description: t("تاريخ السداد لا يكون في المستقبل ولا قبل تاريخ الفاتورة"),
      });
      return;
    }
    if (!accountCode) {
      toast({ title: t(isCash ? "اختر الصندوق" : "اختر الحساب البنكي") });
      return;
    }
    if (isCheque && (!chequeNumber.trim() || !chequeDate)) {
      toast({ title: t("أدخل رقم الشيك وتاريخ استحقاقه") });
      return;
    }

    paymentInFlight.current = true;
    setSaving(true);
    try {
      let error: { message?: string } | null = null;
      try {
        const response = await supabase.rpc("record_purchase_payment_v2", {
          p_invoice_id: current.id,
          p_amount: payAmount,
          p_payment_method: paymentMethod,
          p_account_code: accountCode,
          p_reference: paymentRef.trim() || null,
          p_payment_date: paymentDate,
          p_cheque_number: isCheque ? chequeNumber.trim() : null,
          p_cheque_date: isCheque ? chequeDate : null,
        });
        error = response.error;
      } catch (rpcError) {
        error = { message: rpcError instanceof Error ? rpcError.message : String(rpcError) };
      }
      // القفل يبقى حتى تُقرأ الفاتورة من جديد، فلا تُسجَّل دفعة ثانية بالمتبقي القديم
      const refreshed = await reloadInvoice();
      if (!error) {
        toast({
          title: t(chequeDeferred ? "تم تسجيل الشيك المؤجل" : "تم تسجيل الدفعة والقيد المحاسبي"),
          description: `${t("المبلغ")}: ${formatAmount(payAmount)} ${t("ريال")}`,
        });
        onUpdated(refreshed ?? current);
      } else {
        if (refreshed) setAmount(parseCurrency(refreshed.remaining).toFixed(2));
        toast({ title: t("تعذّر تسجيل السداد"), description: purchasePaymentErrorText(String(error.message ?? ""), t), variant: "destructive" });
      }
    } finally {
      paymentInFlight.current = false;
      setSaving(false);
    }
  };

  const runAction = async () => {
    if (!action || paymentInFlight.current || !canPay) return;
    if (!actionDate || actionDate > today) {
      toast({ title: t("التاريخ غير صحيح"), description: t("التاريخ لا يكون في المستقبل") });
      return;
    }
    if (action.type === "reverse" && !actionReason.trim()) {
      toast({ title: t("اكتب سبب العكس") });
      return;
    }
    paymentInFlight.current = true;
    setSaving(true);
    try {
      let error: { message?: string } | null = null;
      try {
        const response =
          action.type === "clear"
            ? await supabase.rpc("clear_purchase_cheque", { p_payment_id: action.paymentId, p_clear_date: actionDate })
            : await supabase.rpc("reverse_purchase_payment", {
                p_payment_id: action.paymentId,
                p_reversal_date: actionDate,
                p_reason: actionReason.trim(),
              });
        error = response.error;
      } catch (rpcError) {
        error = { message: rpcError instanceof Error ? rpcError.message : String(rpcError) };
      }
      await loadPayments();
      const refreshed = await reloadInvoice();
      if (refreshed) {
        onRefreshed(refreshed);
        setAmount(parseCurrency(refreshed.remaining).toFixed(2));
      }
      if (error) {
        toast({ title: t("تعذّر تنفيذ الإجراء"), description: purchasePaymentErrorText(String(error.message ?? ""), t), variant: "destructive" });
        return;
      }
      toast({ title: t(action.type === "clear" ? "تم تأكيد صرف الشيك" : "تم عكس السداد وقيده") });
      setAction(null);
      setActionReason("");
    } finally {
      paymentInFlight.current = false;
      setSaving(false);
    }
  };

  const chequeStatusLabel = (status: InvoicePaymentRow["chequeStatus"]) =>
    status === "deferred" ? t("مؤجل بانتظار الصرف") : status === "banked" ? t("مقيد على البنك") : status === "cancelled" ? t("ملغى") : "";

  return (
    <div className="space-y-6 bg-slate-50 min-h-screen pb-12" dir={direction} data-readonly-exempt={canPay ? "true" : undefined}>
      <div className="flex justify-between items-center bg-white p-4 border-b border-slate-200 shadow-sm">
        <button
          onClick={onBack}
          className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-sm rounded hover:bg-slate-50 flex items-center gap-2"
        >
          {t("العودة للقائمة")} <ArrowLeftRight className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-slate-800">
            {t("تسديد الفاتورة")} {current.id}
          </h1>
          <CreditCard className="h-5 w-5 text-indigo-600" />
        </div>
        <span />
      </div>

      <div className="p-4 max-w-3xl mx-auto space-y-6">
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: t("الإجمالي"), value: `${formatAmount(parseCurrency(current.total))} ${t("ريال")}`, color: "text-slate-800", bg: "bg-slate-50" },
            { label: t("المدفوع"), value: `${formatAmount(parseCurrency(current.paid))} ${t("ريال")}`, color: "text-green-700", bg: "bg-green-50" },
            { label: t("المتبقي"), value: `${formatAmount(remainingValue)} ${t("ريال")}`, color: "text-red-600", bg: "bg-red-50" },
          ].map(({ label, value, color, bg }) => (
            <div key={label} className={`${bg} rounded-lg border border-slate-200 p-4 text-right`}>
              <div className="text-xs text-slate-500">{label}</div>
              <div className={`text-lg font-bold mt-1 ${color}`}>{value}</div>
            </div>
          ))}
        </div>

        {canPay && remainingValue > 0.01 && (
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-indigo-600 text-white px-4 py-2 text-right font-semibold">{t("معلومات السداد")}</div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-1">
                <label className="text-sm font-medium text-slate-700 text-right block">
                  {t("المبلغ المدفوع الآن")} <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  max={remainingValue}
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-right focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-slate-700 text-right block">{t("طريقة الدفع")}</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-right focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none appearance-none bg-white"
                >
                  {PAYMENT_METHODS.map((method) => (
                    <option key={method} value={method}>{t(method === "نقدي" ? "نقداً" : method)}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-slate-700 text-right block">
                  {t(isCash ? "الصندوق" : "الحساب البنكي")} <span className="text-red-500">*</span>
                </label>
                <select
                  value={accountCode}
                  onChange={(e) => setAccountCode(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-right focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none appearance-none bg-white"
                >
                  <option value="">{t("اختر...")}</option>
                  {allowedAccounts.map((account) => (
                    <option key={account.code} value={account.code}>{accountLabel(account.code)}</option>
                  ))}
                </select>
                {allowedAccounts.length === 0 && (
                  <p className="text-xs text-amber-700 text-right">{t("لا يوجد حساب مسجل من هذا النوع في الحسابات البنكية")}</p>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-slate-700 text-right block">
                  {t("تاريخ السداد")} <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={paymentDate}
                  min={current.date || undefined}
                  max={today}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-right focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                />
              </div>
              {isCheque && (
                <>
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-slate-700 text-right block">
                      {t("رقم الشيك")} <span className="text-red-500">*</span>
                    </label>
                    <input
                      value={chequeNumber}
                      onChange={(e) => setChequeNumber(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-right focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-slate-700 text-right block">
                      {t("تاريخ استحقاق الشيك")} <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      value={chequeDate}
                      onChange={(e) => { setChequeDate(e.target.value); setChequeDateTouched(true); }}
                      className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-right focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                    />
                  </div>
                  <p className="md:col-span-2 text-xs text-slate-600 text-right">
                    {chequeDeferred
                      ? t("شيك مؤجل: يُقيَّد على حساب «شيكات صادرة مؤجلة الدفع» ثم يُنقل إلى البنك عند تأكيد صرفه")
                      : t("شيك حالّ: يُقيَّد على الحساب البنكي مباشرة")}
                    {" "}
                    {t("الشيك الواحد يمكن توزيعه على عدة فواتير للمورد نفسه: سجّل رقمه وتاريخه نفسيهما في كل فاتورة.")}
                  </p>
                </>
              )}
              <div className="space-y-1 md:col-span-2">
                <label className="text-sm font-medium text-slate-700 text-right block">{t("مرجع الدفعة")}</label>
                <input
                  value={paymentRef}
                  onChange={(e) => setPaymentRef(e.target.value)}
                  placeholder={t("رقم المرجع...")}
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-right focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                />
              </div>
            </div>
            <div className="flex justify-center gap-4 pb-6">
              <button onClick={onBack} className="px-6 py-2 bg-slate-500 text-white text-sm rounded hover:bg-slate-600">
                {t("إلغاء")}
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-6 py-2 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 flex items-center gap-2 disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? t("جارٍ الحفظ...") : t("حفظ السداد")}
              </button>
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-slate-700 text-white px-4 py-2 text-right font-semibold">{t("سجل مدفوعات الفاتورة")}</div>
          {paymentsError ? (
            <p className="p-6 text-center text-sm text-red-600">{t("تعذّر تحميل سجل المدفوعات")}: {paymentsError}</p>
          ) : payments.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-500">{t("لا توجد مدفوعات مسجلة")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-2 text-right">{t("السند")}</th>
                    <th className="px-3 py-2 text-right">{t("التاريخ")}</th>
                    <th className="px-3 py-2 text-right">{t("الطريقة")}</th>
                    <th className="px-3 py-2 text-right">{t("الحساب")}</th>
                    <th className="px-3 py-2 text-right">{t("المبلغ")}</th>
                    <th className="px-3 py-2 text-right">{t("الحالة")}</th>
                    <th className="px-3 py-2 text-right">{t("الإجراءات")}</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment.id} className="border-t border-slate-100 align-top">
                      <td className="px-3 py-2 font-mono text-xs">{payment.number}</td>
                      <td className="px-3 py-2">{displayDate(payment.date)}</td>
                      <td className="px-3 py-2">
                        {t(payment.method)}
                        {payment.chequeNumber && (
                          <div className="text-xs text-slate-500">
                            {t("شيك")} {payment.chequeNumber} — {t("استحقاق")} {displayDate(payment.chequeDate)}
                            <div>{chequeStatusLabel(payment.chequeStatus)}{payment.chequeClearedOn ? ` ${displayDate(payment.chequeClearedOn)}` : ""}</div>
                          </div>
                        )}
                        {payment.reference && <div className="text-xs text-slate-500">{payment.reference}</div>}
                      </td>
                      <td className="px-3 py-2 text-xs">{accountLabel(payment.accountCode)}</td>
                      <td className="px-3 py-2 font-semibold">{formatAmount(payment.amount)}</td>
                      <td className="px-3 py-2">
                        {payment.status === "reversed" ? (
                          <div>
                            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">{t("معكوس")}</span>
                            <div className="text-xs text-slate-500">{displayDate(payment.reversedOn)} — {payment.reversalReason}</div>
                          </div>
                        ) : (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">{t("مرحّل")}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {canPay && payment.status === "posted" && (
                          <div className="flex flex-col gap-1">
                            {payment.chequeStatus === "deferred" && (
                              <button
                                onClick={() => { setAction({ type: "clear", paymentId: payment.id }); setActionDate(today); }}
                                className="rounded border border-emerald-300 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                              >
                                {t("تأكيد صرف الشيك")}
                              </button>
                            )}
                            <button
                              onClick={() => { setAction({ type: "reverse", paymentId: payment.id }); setActionDate(today); setActionReason(""); }}
                              className="rounded border border-red-300 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                            >
                              {t("عكس السداد")}
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
          {action && (
            <div className="border-t border-slate-200 bg-slate-50 p-4 space-y-3">
              {(() => {
                const target = payments.find((payment) => payment.id === action.paymentId);
                return target ? (
                  <p className="text-sm text-slate-800 text-right">
                    {t("السند")}: <b className="font-mono">{target.number}</b> — {formatAmount(target.amount)} {t("ريال")}
                    {target.chequeNumber && <> — {t("شيك")} {target.chequeNumber}. {t("يشمل الإجراء كل الفواتير المسددة بهذا الشيك.")}</>}
                  </p>
                ) : null;
              })()}
              <p className="text-sm font-semibold text-slate-700 text-right">
                {action.type === "clear"
                  ? t("تأكيد صرف الشيك: يُنقل المبلغ من «شيكات صادرة مؤجلة الدفع» إلى الحساب البنكي")
                  : t("عكس السداد: قيد عكسي بتاريخ العكس، ويعود المبلغ إلى المتبقي على الفاتورة")}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-600 block text-right">
                    {t(action.type === "clear" ? "تاريخ الصرف" : "تاريخ العكس")}
                  </label>
                  <input
                    type="date"
                    value={actionDate}
                    max={today}
                    onChange={(e) => setActionDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-right"
                  />
                </div>
                {action.type === "reverse" && (
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-600 block text-right">{t("سبب العكس")}</label>
                    <input
                      value={actionReason}
                      onChange={(e) => setActionReason(e.target.value)}
                      placeholder={t("مثال: شيك مرتد، سداد مكرر...")}
                      className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-right"
                    />
                  </div>
                )}
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setAction(null)} className="px-4 py-1.5 border border-slate-300 rounded text-sm">
                  {t("إلغاء")}
                </button>
                <button
                  onClick={runAction}
                  disabled={saving}
                  className={`px-4 py-1.5 rounded text-sm font-semibold text-white disabled:opacity-60 ${action.type === "clear" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"}`}
                >
                  {saving ? t("جارٍ التنفيذ...") : t(action.type === "clear" ? "تأكيد الصرف" : "تأكيد العكس")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
