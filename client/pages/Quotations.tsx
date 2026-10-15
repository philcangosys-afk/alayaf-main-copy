import { type ReactNode, useEffect, useMemo, useState } from "react";
import Layout from "@/components/Layout";
import { salesFeatures } from "./Sales";
import {
  Plus,
  Trash2,
  ArrowLeftRight,
  Edit,
  Eye,
  FileSpreadsheet,
  Save,
  Download,
  Loader2,
  Send,
} from "lucide-react";
import { cn, escapeHtml, riyadhDateString } from "@/lib/utils";
import {
  PageHeader,
  FilterBar,
  FilterInput,
  FilterSelect,
  FilterActions,
  DataTable,
  ActionBtn,
} from "@/components/SalesPageUI";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabaseClient";
import { companyNumberLike, nextCompanyNumber, previewNextNumber } from "@/lib/companyNumbers";
import { useI18n } from "@/i18n";
import { COMPANY_PROFILE } from "@/lib/companyProfile";

type QuotationItem = {
  id: number;
  itemLabel: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxPercent: number;
};

type Totals = {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
};

type QuotationRow = {
  id: string;
  date: string;
  validity: string;
  customer: string;
  customerVat: string;
  customerAddress: string;
  referenceNo: string;
  projectName: string;
  notes: string;
  total: string;
  status: string;
  statusColor: string;
  items: QuotationItem[];
};

const statusColors: Record<string, string> = {
  مفتوح: "bg-cyan-500 text-white",
  مرسل: "bg-indigo-600 text-white",
  مغلق: "bg-green-600 text-white",
};

/** بيانات المنشأة الحالية وقت الطباعة/العرض (تُملأ بعد الدخول) */
const companyInfo = () => ({
  nameAr: COMPANY_PROFILE.companyNameAr,
  nameEn: COMPANY_PROFILE.companyNameEn,
  commercialNo: COMPANY_PROFILE.commercialRegistration,
  vatNo: COMPANY_PROFILE.vatNumber,
  city: COMPANY_PROFILE.city,
  bankName: COMPANY_PROFILE.bank.nameAr,
  beneficiary: COMPANY_PROFILE.bank.beneficiaryAr,
  iban: COMPANY_PROFILE.bank.iban,
});

const toNum = (v: unknown) => Number(v) || 0;

const INPUT_CLASS =
  "w-full h-10 rounded-lg border border-slate-300 bg-white px-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20";

const formatMoney = (v: number) =>
  v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const parseCurrency = (value: unknown) => {
  const raw = String(value ?? "").replace(/[^0-9.-]/g, "");
  return Number(raw) || 0;
};

function calculateTotals(items: QuotationItem[]): Totals {
  return items.reduce(
    (acc, item) => {
      const lineSubtotal =
        toNum(item.quantity) * toNum(item.unitPrice) - toNum(item.discount);
      const lineTax = (lineSubtotal * toNum(item.taxPercent)) / 100;
      return {
        subtotal: acc.subtotal + lineSubtotal,
        discount: acc.discount + toNum(item.discount),
        tax: acc.tax + lineTax,
        total: acc.total + lineSubtotal + lineTax,
      };
    },
    { subtotal: 0, discount: 0, tax: 0, total: 0 },
  );
}

function createDefaultItem(id = 1): QuotationItem {
  return {
    id,
    itemLabel: "توريد عمالة",
    description: "",
    quantity: 1,
    unitPrice: 0,
    discount: 0,
    taxPercent: 15,
  };
}

function mapRow(row: Record<string, unknown>): QuotationRow {
  const status = String(row.status ?? "مفتوح");
  const itemsRaw = Array.isArray(row.items)
    ? (row.items as Record<string, unknown>[])
    : [];

  const items =
    itemsRaw.length > 0
      ? itemsRaw.map((it, idx) => ({
          id: Number(it.id) || idx + 1,
          itemLabel: String(it.itemLabel ?? "توريد عمالة"),
          description: String(it.description ?? ""),
          quantity: toNum(it.quantity),
          unitPrice: toNum(it.unitPrice),
          discount: toNum(it.discount),
          taxPercent: toNum(it.taxPercent),
        }))
      : [createDefaultItem(1)];

  return {
    id: String(row.id ?? ""),
    date: String(row.issue_date ?? row.date ?? ""),
    validity: String(row.valid_until ?? row.validity ?? ""),
    customer: String(row.customer ?? ""),
    customerVat: String(row.customer_vat ?? ""),
    customerAddress: String(row.customer_address ?? ""),
    referenceNo: String(row.reference_no ?? ""),
    projectName: String(row.project_name ?? ""),
    notes: String(row.notes ?? ""),
    total: formatMoney(parseCurrency(row.grand_total ?? row.total)),
    status,
    statusColor: statusColors[status] ?? "bg-cyan-500 text-white",
    items,
  };
}

export default function Quotations() {
  const { t, locale, direction, formatDate, formatNumber } = useI18n();
  const [view, setView] = useState<"list" | "create" | "details" | "edit">(
    "list",
  );
  const [quotations, setQuotations] = useState<QuotationRow[]>([]);
  const [selectedQuotation, setSelectedQuotation] =
    useState<QuotationRow | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const loadQuotations = async () => {
      const { data, error } = await supabase
        .from("sales_quotations")
        .select("*")
        .order("created_at", { ascending: false });

      if (!error && data) {
        setQuotations(
          data.map((row) => mapRow(row as Record<string, unknown>)),
        );
      }
    };

    loadQuotations();
  }, [refreshKey]);

  const refresh = () => setRefreshKey((k) => k + 1);

  const handleDelete = async (quotationId: string) => {
    if (!confirm(t("هل تريد حذف عرض السعر؟"))) return;

    const { error } = await supabase
      .from("sales_quotations")
      .delete()
      .eq("id", quotationId);

    if (!error) {
      setQuotations((prev) => prev.filter((row) => row.id !== quotationId));
      toast({
        title: t("تم حذف عرض السعر"),
        description: `${t("العرض")}: ${quotationId}`,
      });
    } else {
      toast({ title: t("تعذر حذف عرض السعر"), description: error.message });
    }
  };

  const handleDownloadPdf = (quotation: QuotationRow) => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const totals = calculateTotals(quotation.items);
    const rowsHtml = quotation.items
      .map((item) => {
        const subtotal = item.quantity * item.unitPrice - item.discount;
        const taxVal = (subtotal * item.taxPercent) / 100;
        const lineTotal = subtotal + taxVal;
        return `
          <tr>
            <td>${escapeHtml(item.itemLabel || "-")}</td>
            <td>${escapeHtml(item.description || "-")}</td>
            <td>${formatNumber(item.unitPrice, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td>${formatNumber(item.quantity)}</td>
            <td>${formatNumber(item.discount, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td>${formatNumber(subtotal, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td>${formatNumber(item.taxPercent)}%</td>
            <td>${formatNumber(taxVal, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td>${formatNumber(lineTotal, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          </tr>
        `;
      })
      .join("");

    printWindow.document.write(`
      <html dir="${direction}" lang="${locale}">
        <head>
          <meta charset="utf-8" />
          <title>${t("عرض سعر")} ${escapeHtml(quotation.id)}</title>
          <style>
            @page{size:A4 landscape;margin:10mm}
            *{box-sizing:border-box}
            body{font-family:Arial,"Tahoma",sans-serif;margin:0;padding:0;color:#111827;font-size:11px;line-height:1.5}
            .sheet{width:100%;margin:0 auto}
            .top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;padding-bottom:10px;border-bottom:2px solid #1d4ed8}
            .logo{width:105px;height:72px;object-fit:contain}
            .title{font-size:23px;font-weight:700;margin:0 0 4px}
            .meta{font-size:11px;line-height:1.6}
            .customer{margin:10px 0;padding:8px 12px;border:1px solid #dbeafe;border-radius:6px;background:#f8fafc;font-size:12px;text-align:${direction === "rtl" ? "right" : "left"};line-height:1.7}
            table{width:100%;border-collapse:collapse;font-size:10.5px;table-layout:fixed}
            th,td{border:1px solid #cbd5e1;padding:6px 4px;text-align:center;vertical-align:middle;overflow-wrap:anywhere}
            th{background:#e2e8f0;font-weight:700;color:#0f172a}
            th:nth-child(2),td:nth-child(2){width:22%;text-align:start}
            .totals{width:340px;margin-top:10px;margin-inline-start:auto;font-size:12px}
            .totals div{display:flex;justify-content:space-between;border-bottom:1px solid #d1d5db;padding:5px 7px}
            .totals div:last-child{background:#eff6ff;border:1px solid #93c5fd;font-weight:700;font-size:13px}
            .bank{margin-top:18px;padding-top:10px;border-top:1px solid #cbd5e1;font-size:11px;line-height:1.8}
            @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
          </style>
        </head>
        <body>
          <div class="sheet">
            <div class="top">
              <div>
                <h1 class="title">${t("عرض سعر")}</h1>
                <div class="meta">${t("الرقم")} ${escapeHtml(quotation.id)}<br/>${t("التاريخ")} ${quotation.date ? formatDate(quotation.date) : "-"}</div>
              </div>
              <div class="meta" style="text-align:center">
                <div style="font-size:28px;font-weight:700">${escapeHtml(t(companyInfo().nameAr))}</div>
                ${t("السجل التجاري")}: ${escapeHtml(companyInfo().commercialNo)}<br/>
                ${t("الرقم الضريبي")}: ${escapeHtml(companyInfo().vatNo)}<br/>
                ${escapeHtml(t(companyInfo().city))}
              </div>
              <div style="text-align:${direction === "rtl" ? "left" : "right"}">
                <img src="${escapeHtml(COMPANY_PROFILE.logoUrl)}" class="logo"/>
                <div class="meta">${escapeHtml(companyInfo().nameEn)}</div>
              </div>
            </div>

            <div class="customer">
              ${t("العميل")}: ${escapeHtml(quotation.customer || "-")}<br/>
              ${t("الرقم الضريبي")}: ${escapeHtml(quotation.customerVat || "-")}<br/>
              ${t("العنوان")}: ${escapeHtml(quotation.customerAddress || "-")}
            </div>

            <table>
              <thead>
                <tr>
                  <th>${t("البند")}</th>
                  <th>${t("الوصف")}</th>
                  <th>${t("السعر")}</th>
                  <th>${t("الكمية")}</th>
                  <th>${t("الخصم")}</th>
                  <th>${t("المجموع بدون الضريبة")}</th>
                  <th>${t("نسبة الضريبة")}</th>
                  <th>${t("قيمة الضريبة")}</th>
                  <th>${t("المجموع")}</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>

            <div class="totals">
              <div><span>${formatNumber(totals.subtotal, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span><span>${t("الإجمالي قبل الضريبة")}</span></div>
              <div><span>${formatNumber(totals.tax, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span><span>${t("القيمة المضافة %15")}</span></div>
              <div><span>${formatNumber(totals.total, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span><span>${t("الإجمالي (﷼)")}</span></div>
              <div><span>${formatNumber(totals.total, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span><span>${t("المستحق (﷼)")}</span></div>
            </div>

            <div class="bank">
              <div>
                <strong>${t("ملاحظة")}</strong><br/>
                <strong>${t("البيانات البنكية")}</strong><br/>
                *${t("اسم البنك")}: ${escapeHtml(t(companyInfo().bankName))}<br/>
                *${t("اسم المستفيد")}: ${escapeHtml(t(companyInfo().beneficiary))}<br/>
                *${t("رقم الايبان")}: ${escapeHtml(companyInfo().iban)}
              </div>
            </div>
          </div>
        </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  return (
    <Layout
      subMenu={{
        title: t("المبيعات"),
        items: salesFeatures.map((item) => ({ ...item, label: t(item.label) })),
      }}
    >
      <div className="mx-auto max-w-7xl">
        {view === "list" && (
          <QuotationsList
            quotations={quotations}
            onCreateClick={() => setView("create")}
            onView={(quotation) => {
              setSelectedQuotation(quotation);
              setView("details");
            }}
            onEdit={(quotation) => {
              setSelectedQuotation(quotation);
              setView("edit");
            }}
            onDelete={handleDelete}
            onDownloadPdf={handleDownloadPdf}
          />
        )}

        {view === "create" && (
          <QuotationEditor
            mode="create"
            onBack={() => setView("list")}
            onSaved={(newRow) => {
              setQuotations((prev) => [newRow, ...prev]);
              setView("list");
              refresh();
            }}
          />
        )}

        {view === "details" && selectedQuotation && (
          <QuotationDetails
            quotation={selectedQuotation}
            onBack={() => setView("list")}
            onEdit={() => setView("edit")}
            onDownloadPdf={handleDownloadPdf}
          />
        )}

        {view === "edit" && selectedQuotation && (
          <QuotationEditor
            mode="edit"
            initialData={selectedQuotation}
            onBack={() => setView("details")}
            onSaved={(updatedRow) => {
              setQuotations((prev) =>
                prev.map((q) => (q.id === updatedRow.id ? updatedRow : q)),
              );
              setSelectedQuotation(updatedRow);
              setView("details");
              refresh();
            }}
          />
        )}
      </div>
    </Layout>
  );
}

function QuotationsList({
  quotations,
  onCreateClick,
  onView,
  onEdit,
  onDelete,
  onDownloadPdf,
}: {
  quotations: QuotationRow[];
  onCreateClick: () => void;
  onView: (quotation: QuotationRow) => void;
  onEdit: (quotation: QuotationRow) => void;
  onDelete: (quotationId: string) => void;
  onDownloadPdf: (quotation: QuotationRow) => void;
}) {
  const { t, direction, formatDate, formatNumber } = useI18n();
  // فلترة فعلية بدل حقول البحث التي لم تكن موصولة
  const [search, setSearch] = useState("");
  const [customerFilter, setCustomerFilter] = useState("الكل");
  const [statusFilter, setStatusFilter] = useState("الكل");
  const customerNames = useMemo(
    () =>
      Array.from(
        new Set(quotations.map((row) => row.customer).filter(Boolean)),
      ),
    [quotations],
  );
  const filteredQuotations = quotations.filter((row) => {
    const term = search.trim().toLowerCase();
    return (
      (!term || `${row.id} ${row.customer}`.toLowerCase().includes(term)) &&
      (customerFilter === "الكل" || row.customer === customerFilter) &&
      (statusFilter === "الكل" || row.status === statusFilter)
    );
  });

  return (
    <div className="space-y-6" dir={direction}>
      <PageHeader
        icon={FileSpreadsheet}
        title={t("عروض الأسعار")}
        subtitle={t("إدارة وتتبع جميع عروض الأسعار")}
        actionLabel={t("إضافة عرض سعر جديد")}
        onAction={onCreateClick}
        gradient="from-blue-600 to-indigo-700"
      />

      <FilterBar>
        <FilterInput
          label={t("البحث")}
          placeholder={t("رقم العرض، العميل...")}
          colSpan={2}
          value={search}
          onChange={setSearch}
        />
        <FilterSelect
          label={t("العميل")}
          options={["الكل", ...customerNames]}
          value={customerFilter}
          onChange={setCustomerFilter}
        />
        <FilterSelect
          label={t("الحالة")}
          options={["الكل", "مفتوح", "مرسل", "مغلق"]}
          value={statusFilter}
          onChange={setStatusFilter}
        />
        <FilterActions
          onReset={() => {
            setSearch("");
            setCustomerFilter("الكل");
            setStatusFilter("الكل");
          }}
        />
      </FilterBar>

      <DataTable
        headers={[
          t("الإجراءات"),
          t("الحالة"),
          t("الإجمالي"),
          t("العميل"),
          t("تاريخ الصلاحية"),
          t("تاريخ العرض"),
          t("رقم العرض"),
        ]}
        gradient="from-[#1e293b] to-[#334155]"
      >
        {filteredQuotations.map((row, idx) => (
          <tr
            key={row.id}
            className={cn("hover:bg-muted/30", idx % 2 !== 0 && "bg-muted/10")}
          >
            <td className="px-5 py-3.5 align-middle">
              <div className="flex items-center gap-1.5 flex-wrap">
                <ActionBtn
                  icon={Eye}
                  label={t("عرض")}
                  color="blue"
                  onClick={() => onView(row)}
                />
                <ActionBtn
                  icon={Edit}
                  label={t("تعديل")}
                  color="emerald"
                  onClick={() => onEdit(row)}
                />
                <ActionBtn
                  icon={Download}
                  label="PDF"
                  color="slate"
                  onClick={() => onDownloadPdf(row)}
                />
                <ActionBtn
                  icon={Trash2}
                  label={t("حذف")}
                  color="red"
                  onClick={() => onDelete(row.id)}
                />
              </div>
            </td>
            <td className="px-5 py-3.5" style={{ textAlign: "start" }}>
              <span
                className={cn(
                  "inline-flex rounded-full px-3 py-1 text-xs font-semibold",
                  row.statusColor,
                )}
              >
                {t(row.status)}
              </span>
            </td>
            <td className="px-5 py-3.5 font-bold text-primary whitespace-nowrap">
              {formatNumber(parseCurrency(row.total), {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{" "}
              {t("ريال")}
            </td>
            <td className="px-5 py-3.5">{row.customer || "-"}</td>
            <td className="px-5 py-3.5 text-muted-foreground">
              {row.validity ? formatDate(row.validity) : "-"}
            </td>
            <td className="px-5 py-3.5 text-muted-foreground">
              {row.date ? formatDate(row.date) : "-"}
            </td>
            <td className="px-5 py-3.5 font-bold text-primary">{row.id}</td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}

function QuotationEditor({
  mode,
  initialData,
  onBack,
  onSaved,
}: {
  mode: "create" | "edit";
  initialData?: QuotationRow;
  onBack: () => void;
  onSaved: (quotation: QuotationRow) => void;
}) {
  const { t, direction, formatNumber } = useI18n();
  const [quotationId, setQuotationId] = useState(initialData?.id ?? "");
  const [date, setDate] = useState(initialData?.date ?? "");
  const [validity, setValidity] = useState(initialData?.validity ?? "");
  const [customer, setCustomer] = useState(initialData?.customer ?? "");
  const [customerVat, setCustomerVat] = useState(
    initialData?.customerVat ?? "",
  );
  const [customerAddress, setCustomerAddress] = useState(
    initialData?.customerAddress ?? "",
  );
  const [referenceNo, setReferenceNo] = useState(
    initialData?.referenceNo ?? "",
  );
  const [projectName, setProjectName] = useState(
    initialData?.projectName ?? "",
  );
  const [notes, setNotes] = useState(initialData?.notes ?? "");
  const [status, setStatus] = useState(initialData?.status ?? "مفتوح");
  const [items, setItems] = useState<QuotationItem[]>(
    initialData?.items?.length ? initialData.items : [createDefaultItem(1)],
  );
  const [customers, setCustomers] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const loadDefaults = async () => {
      if (!initialData) {
        setDate(riyadhDateString());
        setValidity(riyadhDateString(30));

        // عرض فقط: الرقم الفعلي يُحجز عند الحفظ (1001-QUO-000001 لكل منشأة)
        const { data } = await supabase
          .from("sales_quotations")
          .select("id")
          .like("id", companyNumberLike("QUO"))
          .order("id", { ascending: false })
          .limit(1);

        setQuotationId(previewNextNumber(data?.[0]?.id, "QUO", 6));
      }

      const { data: customerRows } = await supabase
        .from("customers")
        .select("name")
        .order("name");
      const names = (customerRows ?? [])
        .map((r) => String(r.name ?? ""))
        .filter(Boolean);
      setCustomers(names);
    };

    loadDefaults();
  }, [initialData]);

  const totals = useMemo(() => calculateTotals(items), [items]);

  const updateItem = (id: number, changes: Partial<QuotationItem>) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, ...changes } : it)),
    );
  };

  const addItem = () => {
    setItems((prev) => [...prev, createDefaultItem(Date.now())]);
  };

  const removeItem = (id: number) => {
    setItems((prev) =>
      prev.length === 1 ? prev : prev.filter((it) => it.id !== id),
    );
  };

  const handleSave = async (nextStatus: string) => {
    if (!quotationId || !customer || !date) {
      toast({
        title: t("بيانات ناقصة"),
        description: t("يرجى إدخال رقم العرض والعميل والتاريخ"),
      });
      return;
    }

    setSaving(true);

    // عرض جديد: رقمه يُحجز من قاعدة البيانات الآن (لا يتكرر بين المستخدمين)
    let savedQuotationId = quotationId;
    if (mode === "create") {
      try {
        savedQuotationId = await nextCompanyNumber("QUO", 6);
      } catch {
        setSaving(false);
        toast({ title: t("تعذر حجز رقم عرض السعر"), description: t("حاول مرة أخرى") });
        return;
      }
    }

    const payload = {
      id: savedQuotationId,
      date,
      validity,
      issue_date: date,
      valid_until: validity || null,
      customer,
      customer_vat: customerVat || null,
      customer_address: customerAddress || null,
      reference_no: referenceNo || null,
      project_name: projectName || null,
      notes: notes || null,
      status: nextStatus,
      subtotal: totals.subtotal,
      discount_total: totals.discount,
      tax_total: totals.tax,
      grand_total: totals.total,
      total: totals.total.toFixed(2),
      items,
    };

    const query =
      mode === "create"
        ? supabase.from("sales_quotations").insert([payload]).select().single()
        : supabase
            .from("sales_quotations")
            .update({ ...payload, id: initialData?.id ?? quotationId })
            // التحديث بالرقم الأصلي للعرض، لا بالرقم المعروض (كان تغيير الرقم يكتب فوق عرض آخر)
            .eq("id", initialData?.id ?? quotationId)
            .select()
            .single();

    const { data, error } = await query;
    setSaving(false);

    if (error?.code === "23505" && mode === "create") {
      // الرقم المحجوز مستخدم (أُدخل عرض بنفس الرقم يدويًا من قبل): نعرض الرقم التالي ليحفظ المستخدم مرة أخرى
      setQuotationId(previewNextNumber(savedQuotationId, "QUO", 6));
      toast({
        title: t("رقم العرض مستخدم"),
        description: t("تم تحديث رقم العرض تلقائيًا، اضغط حفظ مرة أخرى"),
      });
      return;
    }
    if (error || !data) {
      toast({
        title: t("تعذر حفظ عرض السعر"),
        description: error?.message ?? t("حدث خطأ غير متوقع"),
      });
      return;
    }

    const mapped = mapRow(data as Record<string, unknown>);
    onSaved(mapped);
    toast({
      title:
        mode === "create" ? t("تم حفظ عرض السعر") : t("تم تحديث عرض السعر"),
      description: `${t("العرض")}: ${mapped.id}`,
    });
  };

  return (
    <div className="space-y-5" dir={direction}>
      <div className="flex items-center justify-between rounded-xl border border-border/60 bg-white px-4 py-3">
        <button
          onClick={onBack}
          className="px-4 py-2 rounded-lg border border-border text-sm font-semibold flex items-center gap-2"
        >
          {t("العودة للقائمة")} <ArrowLeftRight className="h-4 w-4" />
        </button>
        <h1 className="text-lg font-bold">
          {mode === "create" ? t("عرض سعر") : t("تعديل عرض سعر")}
        </h1>
        <div className="flex gap-2">
          <button
            onClick={() => handleSave("مفتوح")}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-slate-700 text-white text-sm font-semibold flex items-center gap-1.5 disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}{" "}
            {t("حفظ")}
          </button>
          <button
            onClick={() => handleSave("مرسل")}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold flex items-center gap-1.5 disabled:opacity-60"
          >
            <Send className="h-4 w-4" /> {t("حفظ ثم إرسال")}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <QuotePreview
          quotation={{
            id: quotationId,
            date,
            validity,
            customer,
            customerVat,
            customerAddress,
            referenceNo,
            projectName,
            notes,
            total: totals.total.toFixed(2),
            status,
            statusColor: statusColors[status] ?? "bg-cyan-500 text-white",
            items,
          }}
        />

        <div className="rounded-xl border border-border/60 bg-white p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label={t("رقم عرض السعر")}>
              <input
                value={quotationId}
                /* الرقم يُولَّد تلقائيًا ولا يُعدَّل */
                readOnly
                className={INPUT_CLASS}
              />
            </Field>
            <Field label={t("العميل")}>
              <div className="space-y-2">
                <select
                  value={customer}
                  onChange={(e) => setCustomer(e.target.value)}
                  className={INPUT_CLASS}
                >
                  <option value="">{t("اختر العميل")}</option>
                  {customers.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <input
                  value={customer}
                  onChange={(e) => setCustomer(e.target.value)}
                  placeholder={t("أو اكتب اسم عميل جديد")}
                  className={INPUT_CLASS}
                />
              </div>
            </Field>
            <Field label={t("التاريخ")}>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={INPUT_CLASS}
              />
            </Field>
            <Field label={t("تاريخ الصلاحية")}>
              <input
                type="date"
                value={validity}
                onChange={(e) => setValidity(e.target.value)}
                className={INPUT_CLASS}
              />
            </Field>
            <Field label={t("الرقم الضريبي للعميل")}>
              <input
                value={customerVat}
                onChange={(e) => setCustomerVat(e.target.value)}
                className={INPUT_CLASS}
              />
            </Field>
            <Field label={t("رقم المرجع")}>
              <input
                value={referenceNo}
                onChange={(e) => setReferenceNo(e.target.value)}
                className={INPUT_CLASS}
              />
            </Field>
            <Field label={t("العنوان")} className="md:col-span-2">
              <input
                value={customerAddress}
                onChange={(e) => setCustomerAddress(e.target.value)}
                className={INPUT_CLASS}
              />
            </Field>
            <Field label={t("المشروع")} className="md:col-span-2">
              <input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                className={INPUT_CLASS}
              />
            </Field>
          </div>

          <div className="rounded-xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-sm" style={{ textAlign: "start" }}>
              <thead className="bg-slate-100">
                <tr>
                  <th className="px-2 py-2 border">{t("الإجراءات")}</th>
                  <th className="px-2 py-2 border">{t("البند")}</th>
                  <th className="px-2 py-2 border">{t("الوصف")}</th>
                  <th className="px-2 py-2 border">{t("السعر")}</th>
                  <th className="px-2 py-2 border">{t("الكمية")}</th>
                  <th className="px-2 py-2 border">{t("الخصم")}</th>
                  <th className="px-2 py-2 border">{t("الضريبة %")}</th>
                  <th className="px-2 py-2 border">{t("المجموع")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const subtotal =
                    item.quantity * item.unitPrice - item.discount;
                  const taxVal = (subtotal * item.taxPercent) / 100;
                  const lineTotal = subtotal + taxVal;

                  return (
                    <tr key={item.id}>
                      <td className="border px-2 py-2">
                        <button
                          onClick={() => removeItem(item.id)}
                          className="w-7 h-7 rounded bg-red-500 text-white flex items-center justify-center"
                          title={t("حذف البند")}
                          aria-label={t("حذف البند")}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                      <td className="border px-2 py-2">
                        <input
                          value={item.itemLabel}
                          onChange={(e) =>
                            updateItem(item.id, { itemLabel: e.target.value })
                          }
                          className={`${INPUT_CLASS} h-9`}
                        />
                      </td>
                      <td className="border px-2 py-2 min-w-[220px]">
                        <input
                          value={item.description}
                          onChange={(e) =>
                            updateItem(item.id, { description: e.target.value })
                          }
                          className={`${INPUT_CLASS} h-9`}
                        />
                      </td>
                      <td className="border px-2 py-2">
                        <input
                          type="number"
                          value={item.unitPrice}
                          onChange={(e) =>
                            updateItem(item.id, {
                              unitPrice: toNum(e.target.value),
                            })
                          }
                          className={`${INPUT_CLASS} h-9`}
                        />
                      </td>
                      <td className="border px-2 py-2">
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={(e) =>
                            updateItem(item.id, {
                              quantity: toNum(e.target.value),
                            })
                          }
                          className={`${INPUT_CLASS} h-9`}
                        />
                      </td>
                      <td className="border px-2 py-2">
                        <input
                          type="number"
                          value={item.discount}
                          onChange={(e) =>
                            updateItem(item.id, {
                              discount: toNum(e.target.value),
                            })
                          }
                          className={`${INPUT_CLASS} h-9`}
                        />
                      </td>
                      <td className="border px-2 py-2">
                        <input
                          type="number"
                          value={item.taxPercent}
                          onChange={(e) =>
                            updateItem(item.id, {
                              taxPercent: toNum(e.target.value),
                            })
                          }
                          className={`${INPUT_CLASS} h-9`}
                        />
                      </td>
                      <td className="border px-2 py-2 font-semibold whitespace-nowrap">
                        {formatNumber(lineTotal, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex justify-between items-center">
            <button
              onClick={addItem}
              className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold flex items-center gap-1.5"
            >
              <Plus className="h-4 w-4" /> {t("إضافة بند")}
            </button>
            <div className="text-sm space-y-1" style={{ textAlign: "start" }}>
              <p>
                {t("الإجمالي قبل الضريبة")}:{" "}
                <strong>
                  {formatNumber(totals.subtotal, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </strong>
              </p>
              <p>
                {t("الضريبة")}:{" "}
                <strong>
                  {formatNumber(totals.tax, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </strong>
              </p>
              <p className="text-base">
                {t("الإجمالي")}:{" "}
                <strong>
                  {formatNumber(totals.total, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </strong>
              </p>
            </div>
          </div>

          <Field label={t("ملاحظات")}>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className={`${INPUT_CLASS} h-auto py-2 min-h-[88px]`}
            />
          </Field>
        </div>
      </div>
    </div>
  );
}

function QuotationDetails({
  quotation,
  onBack,
  onEdit,
  onDownloadPdf,
}: {
  quotation: QuotationRow;
  onBack: () => void;
  onEdit: () => void;
  onDownloadPdf: (quotation: QuotationRow) => void;
}) {
  const { t, direction } = useI18n();

  return (
    <div className="space-y-4" dir={direction}>
      <div className="flex items-center justify-between rounded-xl border border-border/60 bg-white px-4 py-3">
        <button
          onClick={onBack}
          className="px-4 py-2 rounded-lg border border-border text-sm font-semibold flex items-center gap-2"
        >
          {t("العودة للقائمة")} <ArrowLeftRight className="h-4 w-4" />
        </button>
        <h1 className="text-lg font-bold">{t("تفاصيل عرض السعر")}</h1>
        <div className="flex gap-2">
          <button
            onClick={() => onDownloadPdf(quotation)}
            className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold flex items-center gap-1.5"
          >
            <Download className="h-4 w-4" /> PDF
          </button>
          <button
            onClick={onEdit}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold flex items-center gap-1.5"
          >
            <Edit className="h-4 w-4" /> {t("تعديل")}
          </button>
        </div>
      </div>

      <QuotePreview quotation={quotation} />
    </div>
  );
}

function QuotePreview({ quotation }: { quotation: QuotationRow }) {
  const { t, direction, formatDate, formatNumber } = useI18n();
  const totals = calculateTotals(quotation.items);

  return (
    <div
      className="rounded-xl border border-slate-300 bg-white p-4 overflow-x-auto"
      dir={direction}
    >
      <div className="min-w-[760px] space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-3xl font-bold">{t("عرض سعر")}</h2>
            <p className="text-sm mt-1">
              {t("الرقم")} {quotation.id || "-"}
            </p>
            <p className="text-sm">
              {t("التاريخ")} {quotation.date ? formatDate(quotation.date) : "-"}
            </p>
          </div>

          <div className="text-center text-sm leading-7">
            <h3 className="text-2xl font-bold">{t(companyInfo().nameAr)}</h3>
            <p>
              {t("السجل التجاري")}: {companyInfo().commercialNo}
            </p>
            <p>
              {t("الرقم الضريبي")}: {companyInfo().vatNo}
            </p>
            <p>{t(companyInfo().city)}</p>
          </div>

          <div style={{ textAlign: "end" }}>
            <img
              src={COMPANY_PROFILE.logoUrl}
              alt={t("شعار الشركة")}
              className="w-28 h-20 object-contain"
            />
            <p className="text-xs mt-1">{companyInfo().nameEn}</p>
          </div>
        </div>

        <div className="text-center text-xl leading-9">
          <p>
            {t("العميل")}: {quotation.customer || "-"}
          </p>
          <p>
            {t("الرقم الضريبي")}: {quotation.customerVat || "-"}
          </p>
          <p>
            {t("العنوان")}: {quotation.customerAddress || "-"}
          </p>
        </div>

        <table className="w-full border-collapse text-lg">
          <thead>
            <tr className="bg-slate-200">
              <th className="border border-slate-300 px-2 py-2">
                {t("البند")}
              </th>
              <th className="border border-slate-300 px-2 py-2">
                {t("الوصف")}
              </th>
              <th className="border border-slate-300 px-2 py-2">
                {t("السعر")}
              </th>
              <th className="border border-slate-300 px-2 py-2">
                {t("الكمية")}
              </th>
              <th className="border border-slate-300 px-2 py-2">
                {t("الخصم")}
              </th>
              <th className="border border-slate-300 px-2 py-2">
                {t("المجموع بدون الضريبة")}
              </th>
              <th className="border border-slate-300 px-2 py-2">
                {t("نسبة الضريبة")}
              </th>
              <th className="border border-slate-300 px-2 py-2">
                {t("قيمة الضريبة")}
              </th>
              <th className="border border-slate-300 px-2 py-2">
                {t("المجموع")}
              </th>
            </tr>
          </thead>
          <tbody>
            {quotation.items.map((item) => {
              const lineSubtotal =
                item.quantity * item.unitPrice - item.discount;
              const lineTax = (lineSubtotal * item.taxPercent) / 100;
              const lineTotal = lineSubtotal + lineTax;

              return (
                <tr key={item.id}>
                  <td className="border border-slate-300 px-2 py-2 text-center">
                    {item.itemLabel || "-"}
                  </td>
                  <td className="border border-slate-300 px-2 py-2 text-center">
                    {item.description || "-"}
                  </td>
                  <td className="border border-slate-300 px-2 py-2 text-center">
                    {formatNumber(item.unitPrice, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </td>
                  <td className="border border-slate-300 px-2 py-2 text-center">
                    {formatNumber(item.quantity)}
                  </td>
                  <td className="border border-slate-300 px-2 py-2 text-center">
                    {formatNumber(item.discount, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </td>
                  <td className="border border-slate-300 px-2 py-2 text-center">
                    {formatNumber(lineSubtotal, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </td>
                  <td className="border border-slate-300 px-2 py-2 text-center">
                    {formatNumber(item.taxPercent)}%
                  </td>
                  <td className="border border-slate-300 px-2 py-2 text-center">
                    {formatNumber(lineTax, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </td>
                  <td className="border border-slate-300 px-2 py-2 text-center font-semibold">
                    {formatNumber(lineTotal, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div
          className="max-w-md text-2xl leading-10 border-t border-slate-300 pt-2"
          style={{ marginInlineStart: "auto" }}
        >
          <div className="flex justify-between">
            <span>
              {formatNumber(totals.subtotal, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
            <span>{t("الإجمالي قبل الضريبة")}</span>
          </div>
          <div className="flex justify-between">
            <span>
              {formatNumber(totals.tax, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
            <span>{t("القيمة المضافة %15")}</span>
          </div>
          <div className="flex justify-between font-bold">
            <span>
              {formatNumber(totals.total, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
            <span>{t("الإجمالي (﷼)")}</span>
          </div>
          <div className="flex justify-between font-bold">
            <span>
              {formatNumber(totals.total, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
            <span>{t("المستحق (﷼)")}</span>
          </div>
        </div>

        <div className="pt-3 text-lg leading-8">
          <div>
            <h4 className="font-bold">{t("ملاحظة")}</h4>
            <p>{quotation.notes || "-"}</p>
            <h4 className="font-bold mt-2">{t("البيانات البنكية")}</h4>
            <p>
              *{t("اسم البنك")} : {t(companyInfo().bankName)}
            </p>
            <p>
              *{t("اسم المستفيد")} : {t(companyInfo().beneficiary)}
            </p>
            <p>
              *{t("رقم الايبان")} : {companyInfo().iban}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <label className="text-xs text-slate-500 font-semibold">{label}</label>
      {children}
    </div>
  );
}
