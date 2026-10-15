import Layout from "@/components/Layout";
import { Plus, Search, Eye, Pencil, Trash2, Save, X, Printer, AlertTriangle } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import ChartOfAccountsTree from "@/components/chart-of-accounts/ChartOfAccountsTree";
import CostCenters from "@/components/chart-of-accounts/CostCenters";
import { useI18n } from "@/i18n";
import { COMPANY_PROFILE } from "@/lib/companyProfile";

type VoucherRow = {
  id: string;
  voucherNumber: string;
  voucherDate: string;
  description: string;
  department: string;
  approvedBy: string;
  totalAmount: string;
  status: string;
};

type PettyCashRow = {
  id: string;
  voucherNumber: string;
  voucherDate: string;
  beneficiaryName: string;
  purpose: string;
  amount: string;
  paidBy: string;
  receivedBy: string;
  status: string;
};

type VoucherItemForm = {
  id?: string;
  description: string;
  accountCode: string;
  amount: string;
};

type VoucherForm = {
  id?: string;
  voucherNumber: string;
  voucherDate: string;
  description: string;
  department: string;
  approvedBy: string;
  items: VoucherItemForm[];
};

type VoucherViewData = VoucherRow & { items: VoucherItemForm[] };
type PettyCashViewData = PettyCashRow;

type PettyCashForm = {
  id?: string;
  voucherNumber: string;
  voucherDate: string;
  beneficiaryName: string;
  purpose: string;
  amount: string;
  paidBy: string;
  receivedBy: string;
};


const mapVoucherRow = (row: Record<string, unknown>): VoucherRow => ({
  id: String(row.id ?? ""),
  voucherNumber: String(row.voucher_number ?? ""),
  voucherDate: String(row.voucher_date ?? ""),
  description: String(row.description ?? ""),
  department: String(row.department ?? ""),
  approvedBy: String(row.approved_by ?? ""),
  totalAmount: String(row.total_amount ?? "0.00"),
  status: String(row.status ?? "مسودة"),
});

const mapPettyCashRow = (row: Record<string, unknown>): PettyCashRow => ({
  id: String(row.id ?? ""),
  voucherNumber: String(row.voucher_number ?? ""),
  voucherDate: String(row.voucher_date ?? ""),
  beneficiaryName: String(row.beneficiary_name ?? ""),
  purpose: String(row.purpose ?? ""),
  amount: String(row.amount ?? "0.00"),
  paidBy: String(row.paid_by ?? ""),
  receivedBy: String(row.received_by ?? ""),
  status: String(row.status ?? "قيد المراجعة"),
});

/**
 * سندات القبض والصرف في هذه الشاشة لا تُنشئ قيودًا محاسبية ولا تُربط بفاتورة أو عميل أو صندوق،
 * لذلك أصبحت للاطلاع فقط. التحصيل من العملاء يتم من زر السداد في فاتورة المبيعات،
 * والمصروفات تُسجَّل بفاتورة مشتريات ثم سدادها، فيُرحَّل كل ذلك إلى الدفاتر والإقرار الضريبي.
 */
const VOUCHERS_READ_ONLY = true;

const getEmptyVoucherForm = (): VoucherForm => ({
  id: undefined,
  voucherNumber: "",
  voucherDate: new Date().toISOString().split("T")[0],
  description: "",
  department: "",
  approvedBy: "",
  items: [{ description: "", accountCode: "", amount: "" }],
});

const getEmptyPettyCashForm = (): PettyCashForm => ({
  id: undefined,
  voucherNumber: "",
  voucherDate: new Date().toISOString().split("T")[0],
  beneficiaryName: "",
  purpose: "",
  amount: "",
  paidBy: "",
  receivedBy: "",
});


export default function ExpenseManagement() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, locale, direction, formatDate, formatNumber } = useI18n();
  const isVouchers = location.pathname.includes("/expenses/vouchers");
  const isPettyCash = location.pathname.includes("/expenses/petty-cash");
  const isReports = location.pathname.includes("/expenses/reports");

  const [voucherRows, setVoucherRows] = useState<VoucherRow[]>([]);
  const [pettyCashRows, setPettyCashRows] = useState<PettyCashRow[]>([]);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [voucherView, setVoucherView] = useState<VoucherViewData | null>(null);
  const [pettyCashView, setPettyCashView] = useState<PettyCashViewData | null>(null);
  const [voucherForm, setVoucherForm] = useState<VoucherForm>(getEmptyVoucherForm());
  const [pettyCashForm, setPettyCashForm] = useState<PettyCashForm>(getEmptyPettyCashForm());

  useEffect(() => {
    void Promise.allSettled([loadVouchers(), loadPettyCash()]);
  }, [isVouchers, isPettyCash, isReports]);

  const loadVouchers = async () => {
    try {
      const { data, error } = await supabase
        .from("expense_vouchers")
        .select("*")
        .order("voucher_date", { ascending: false });

      if (!error && data) {
        setVoucherRows(data.map((row) => mapVoucherRow(row as Record<string, unknown>)));
      } else {
        setVoucherRows([]);
      }
    } catch (e) {
      setVoucherRows([]);
    }
  };

  const loadPettyCash = async () => {
    try {
      const { data, error } = await supabase
        .from("petty_cash_vouchers")
        .select("*")
        .order("voucher_date", { ascending: false });

      if (!error && data) {
        setPettyCashRows(data.map((row) => mapPettyCashRow(row as Record<string, unknown>)));
      } else {
        setPettyCashRows([]);
      }
    } catch (e) {
      setPettyCashRows([]);
    }
  };

  const loadVoucherItems = async (voucherId: string): Promise<VoucherItemForm[]> => {
    const { data, error } = await supabase
      .from("expense_voucher_items")
      .select("id, item_description, account_code, amount")
      .eq("voucher_id", voucherId)
      .order("created_at", { ascending: true });

    if (error || !data) {
      return [];
    }

    return data.map((item) => ({
      id: String(item.id ?? ""),
      description: String(item.item_description ?? ""),
      accountCode: String(item.account_code ?? ""),
      amount: String(item.amount ?? "0"),
    }));
  };

  const handlePrintVoucher = async (row: VoucherRow) => {
    const items = await loadVoucherItems(row.id);
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    const escHtml = (v: unknown) => String(v ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    const printText = (value: string) => escHtml(t(value));
    const printNumber = (value: number) => formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const printDate = (value: string) => value ? formatDate(value, { dateStyle: "medium" }) : "-";
    const total = items.reduce((s, i) => s + (Number.parseFloat(i.amount || "0") || 0), 0);
    const rowsHtml = items.map((item, idx) => `<tr><td>${formatNumber(idx + 1)}</td><td style="text-align:${direction === "rtl" ? "right" : "left"}">${escHtml(item.description || "-")}</td><td>${escHtml(item.accountCode || "-")}</td><td style="font-weight:700">${printNumber(Number.parseFloat(item.amount || "0") || 0)} ${printText("ريال")}</td></tr>`).join("");
    printWindow.document.write(`<!doctype html><html dir="${direction}" lang="${locale}"><head><meta charset="utf-8"><title>${printText("سند صرف")} ${escHtml(row.voucherNumber)}</title><style>@page{size:A4 portrait;margin:12mm}*{box-sizing:border-box}body{margin:0;color:#111827;font-family:Arial,Tahoma,sans-serif}.voucher{width:100%;min-height:273mm;border:1px solid #d1d5db;padding:14mm 15mm 10mm;position:relative;background:#fff}.header{display:grid;grid-template-columns:150px 1fr 190px;align-items:start;gap:20px}.logo{width:135px;height:90px;object-fit:contain}.company{text-align:right}.company h2{margin:0;font-size:22px}.company p{margin:4px 0;color:#475569;font-size:11px;line-height:1.6}.voucher-title{text-align:center}.voucher-title h1{font-size:29px;margin:0}.en{font-size:14px;font-weight:700;letter-spacing:1.8px;border-bottom:2px solid #dc2626;padding:4px 12px;display:inline-block}.number{margin-top:10px;color:#dc2626;font-size:24px;font-weight:800;letter-spacing:2px}.date-row{display:flex;justify-content:space-between;margin:14px 0 6px;font-size:12px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:12px;margin-bottom:10px}.label{color:#64748b;font-size:11px}.line-val{font-weight:700;border-bottom:1px solid #94a3b8;padding-bottom:3px}.line{display:grid;grid-template-columns:165px 1fr 165px;gap:8px;align-items:end;margin:10px 0;font-size:13px}.label-ar{font-weight:700}.label-en{text-align:left;font-weight:700;direction:ltr}.vbox{min-height:25px;border-bottom:1px solid #64748b;padding:3px 8px;text-align:center;font-weight:700}table{width:100%;border-collapse:collapse;font-size:11.5px;margin-top:8px}th,td{border:1px solid #d1d5db;padding:6px 8px;text-align:center}th{background:#f1f5f9;font-weight:700}.total-row{background:#fef2f2;font-weight:700;color:#dc2626}.amt-box{float:left;margin-top:8px;border:2px solid #dc2626;border-radius:6px;padding:9px 18px;color:#dc2626;font-size:18px;font-weight:800}.sigs{display:grid;grid-template-columns:repeat(4,1fr);gap:40px;margin-top:30px;text-align:center}.sig strong{display:block;font-size:13px}.sig small{display:block;color:#64748b}.sig .sl{border-bottom:1px solid #94a3b8;height:38px}.footer{position:absolute;bottom:0;left:0;right:0;height:10px;background:linear-gradient(90deg,#dc2626,#0f766e)}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.voucher{border:0}}</style></head><body><section class="voucher"><div class="header"><img class="logo" src="${escHtml(COMPANY_PROFILE.logoUrl)}" alt="logo"><div class="voucher-title"><h1>${printText("سند صرف")}</h1><div class="en">PAYMENT VOUCHER</div><div class="number">${escHtml(row.voucherNumber)}</div></div><div class="company"><h2>${escHtml(COMPANY_PROFILE.companyNameAr)}</h2><p>${escHtml(COMPANY_PROFILE.companyNameEn)}<br>${escHtml(COMPANY_PROFILE.addressAr)}<br>VAT No. ${escHtml(COMPANY_PROFILE.vatNumber)}</p></div></div><div class="date-row"><span><b>${printText("التاريخ")} / Date:</b> ${escHtml(printDate(row.voucherDate))}</span><span><b>${printText("هـ")} / H &nbsp; ${printText("ريال")} / S.R. SAR</b></span></div><div class="meta"><div><div class="label">${printText("صرف إلى")} / Pay to (${printText("قسم")}):</div><div class="line-val">${escHtml(row.department || "-")}</div></div><div><div class="label">${printText("اعتمد من")} / Approved by:</div><div class="line-val">${escHtml(row.approvedBy || "-")}</div></div></div><div class="line"><span class="label-ar">${printText("البيان")} / Description:</span><div class="vbox">${escHtml(row.description || "-")}</div><span class="label-en">Being / Details</span></div><table><thead><tr><th>#</th><th style="text-align:${direction === "rtl" ? "right" : "left"}">${printText("البند")} / Item</th><th>${printText("الحساب")} / Account</th><th>${printText("المبلغ")} / Amount</th></tr></thead><tbody>${rowsHtml || "<tr><td colspan='4'>-</td></tr>"}<tr class='total-row'><td colspan='3'>${printText("الإجمالي")} / Total</td><td>${printNumber(total)} SAR</td></tr></tbody></table><div class="amt-box">${printNumber(total)} SAR</div><div class="sigs"><div class="sig"><strong>${printText("المحاسب")}</strong><small>Accountant</small><div class="sl"></div></div><div class="sig"><strong>${printText("مدير مالي")}</strong><small>Finance Manager</small><div class="sl"></div></div><div class="sig"><strong>${printText("معتمد")}</strong><small>Approved</small><div class="sl"></div></div><div class="sig"><strong>${printText("المستلم")}</strong><small>Received by</small><div class="sl"></div></div></div><div class="footer"></div></section></body></html>`);
    printWindow.document.close();
    let printed = false;
    const doPrint = () => { if (printed) return; printed = true; printWindow.focus(); printWindow.print(); };
    const logo = printWindow.document.querySelector(".logo") as HTMLImageElement | null;
    if (logo && !logo.complete) {
      logo.addEventListener("load", doPrint, { once: true });
      logo.addEventListener("error", doPrint, { once: true });
      window.setTimeout(doPrint, 3000);
    } else window.setTimeout(doPrint, 150);
  };

  const handleViewVoucher = async (row: VoucherRow) => {
    const items = await loadVoucherItems(row.id);
    setVoucherView({ ...row, items });
  };

  const handleEditVoucher = async (row: VoucherRow) => {
    const items = await loadVoucherItems(row.id);
    setVoucherForm({
      id: row.id,
      voucherNumber: row.voucherNumber,
      voucherDate: row.voucherDate,
      description: row.description,
      department: row.department,
      approvedBy: row.approvedBy,
      items: items.length > 0 ? items : [{ description: "", accountCode: "", amount: "" }],
    });
    setVoucherView(null);
    setIsFormOpen(true);
  };

  const generateVoucherNumber = async (
    tableName: "expense_vouchers" | "petty_cash_vouchers",
    prefix: "SRF" | "QBD"
  ) => {
    const { data } = await supabase
      .from(tableName)
      .select("voucher_number")
      .like("voucher_number", `${prefix}-%`)
      .order("created_at", { ascending: false })
      .limit(1);

    const lastVoucherNumber = String(data?.[0]?.voucher_number ?? "");
    const lastNumber = Number(lastVoucherNumber.split("-")[1] ?? "0");
    const nextNumber = String(lastNumber + 1).padStart(4, "0");
    return `${prefix}-${nextNumber}`;
  };

  const handleViewPettyCash = (row: PettyCashRow) => {
    setPettyCashView(row);
  };

  const handleEditPettyCash = (row: PettyCashRow) => {
    setPettyCashForm({
      id: row.id,
      voucherNumber: row.voucherNumber,
      voucherDate: row.voucherDate,
      beneficiaryName: row.beneficiaryName,
      purpose: row.purpose,
      amount: row.amount,
      paidBy: row.paidBy,
      receivedBy: row.receivedBy,
    });
    setPettyCashView(null);
    setIsFormOpen(true);
  };

  const handlePrintPettyCash = (row: PettyCashRow) => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    const escapeHtml = (value: unknown) => String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
    const amount = Number.parseFloat(row.amount || "0") || 0;
    const printText = (value: string) => escapeHtml(t(value));
    const printNumber = (value: number) => formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const printDate = (value: string) => value ? formatDate(value, { dateStyle: "medium" }) : "-";

    printWindow.document.write(`<!doctype html><html dir="${direction}" lang="${locale}"><head><meta charset="utf-8"><title>${printText("سند قبض")} ${escapeHtml(row.voucherNumber)}</title><style>
      @page{size:A4 portrait;margin:12mm}*{box-sizing:border-box}body{margin:0;color:#111827;font-family:Arial,"Tahoma",sans-serif}.voucher{width:100%;min-height:273mm;border:1px solid #d1d5db;padding:14mm 15mm 10mm;position:relative;background:#fff}.header{display:grid;grid-template-columns:150px 1fr 190px;align-items:start;gap:20px}.logo{width:135px;height:90px;object-fit:contain}.company{text-align:right}.company h2{margin:0;font-size:22px}.company p{margin:4px 0;color:#475569;font-size:11px;line-height:1.6}.voucher-title{text-align:center}.voucher-title h1{font-size:29px;margin:0}.voucher-title .en{font-size:14px;font-weight:700;letter-spacing:1.8px;border-bottom:2px solid #0f766e;padding:4px 12px;display:inline-block}.number{margin-top:10px;color:#0f766e;font-size:24px;font-weight:800;letter-spacing:2px}.currency{display:flex;justify-content:center;gap:9px;margin-bottom:7px}.currency span{background:#f1f5f9;padding:5px 10px;font-size:11px;font-weight:700}.date-row{display:flex;justify-content:space-between;margin:17px 0 7px;font-size:12px}.line{display:grid;grid-template-columns:150px 1fr 165px;gap:8px;align-items:end;margin:12px 0;font-size:13px}.label-ar{text-align:right;font-weight:700}.label-en{text-align:left;font-weight:700;direction:ltr}.value{min-height:25px;border-bottom:1px solid #64748b;padding:3px 8px;text-align:center;font-weight:700}.amount-box{display:grid;grid-template-columns:1fr 220px;gap:18px;align-items:center}.amount{border:2px solid #0f766e;border-radius:6px;padding:9px 12px;text-align:center;color:#0f766e;font-size:18px;font-weight:800}.signatures{display:grid;grid-template-columns:1fr 1fr 1fr;gap:70px;margin-top:38px;text-align:center}.signature strong{display:block;font-size:13px}.signature small{display:block;color:#64748b;margin-top:3px}.signature .sign-line{border-bottom:1px solid #94a3b8;height:42px}.footer{position:absolute;bottom:0;left:0;right:0;height:10px;background:linear-gradient(90deg,#0284c7,#0f766e)}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.voucher{border:0}}
    </style></head><body><section class="voucher"><div class="header"><img class="logo" src="${escapeHtml(COMPANY_PROFILE.logoUrl)}" alt="${printText("شعار الشركة")}"><div class="voucher-title"><h1>${printText("سند قبض")}</h1><div class="en">RECEIPT VOUCHER</div><div class="number">${escapeHtml(row.voucherNumber)}</div></div><div class="company"><h2>${escapeHtml(COMPANY_PROFILE.companyNameAr)}</h2><p>${escapeHtml(COMPANY_PROFILE.companyNameEn)}<br>${escapeHtml(COMPANY_PROFILE.addressAr)}<br>VAT No. ${escapeHtml(COMPANY_PROFILE.vatNumber)}</p></div></div><div class="date-row"><span><b>${printText("التاريخ")} / Date:</b> ${escapeHtml(printDate(row.voucherDate))}</span><div class="currency"><span>هـ / H</span><span>${printText("ريال سعودي")} / S.R. SAR</span></div></div><div class="line"><span class="label-ar">${printText("استلمنا من السيد/السادة:")}</span><div class="value">${escapeHtml(row.beneficiaryName || "-")}</div><span class="label-en">Received from Mr./Mrs.:</span></div><div class="amount-box"><div class="line"><span class="label-ar">${printText("مبلغ وقدره:")}</span><div class="value">${printNumber(amount)} ${printText("ريال سعودي")}</div><span class="label-en">Amount:</span></div><div class="amount">${printNumber(amount)} SAR</div></div><div class="line"><span class="label-ar">${printText("نقداً / شيك رقم / البنك:")}</span><div class="value">${escapeHtml(row.paidBy || t("نقداً"))}</div><span class="label-en">Cash / Cheque No. / Bank:</span></div><div class="line"><span class="label-ar">${printText("وذلك مقابل:")}</span><div class="value">${escapeHtml(row.purpose || "-")}</div><span class="label-en">Being:</span></div><div class="signatures"><div class="signature"><strong>المستلم</strong><small>Receiver</small><div class="sign-line"></div><span>${escapeHtml(row.receivedBy || "")}</span></div><div class="signature"><strong>المحاسب</strong><small>Accountant</small><div class="sign-line"></div></div><div class="signature"><strong>المدير المالي</strong><small>Finance Manager</small><div class="sign-line"></div></div></div><div class="footer"></div></section></body></html>`);
    printWindow.document.close();
    let printed = false;
    const print = () => { if (printed) return; printed = true; printWindow.focus(); printWindow.print(); };
    const logo = printWindow.document.querySelector(".logo") as HTMLImageElement | null;
    if (logo && !logo.complete) {
      logo.addEventListener("load", print, { once: true });
      logo.addEventListener("error", print, { once: true });
      window.setTimeout(print, 3000);
    } else window.setTimeout(print, 150);
  };

  const title = isReports
    ? t("تقرير المصروفات")
    : isPettyCash
      ? t("سندات القبض والصرف")
      : isVouchers
        ? t("سندات الصرف")
        : t("المصرفات");

  const description = isReports
    ? t("ملخصات وتقارير المصروفات والسندات.")
    : isPettyCash
      ? t("سجل سندات القبض والصرف السابقة (للاطلاع فقط).")
      : isVouchers
        ? t("سجل سندات الصرف السابقة (للاطلاع فقط).")
        : t("إدارة المصرفات والسندات والتقارير.");

  if (!isVouchers && !isPettyCash && !isReports) {
    return (
      <Layout
        subMenu={{
          title: t("المحاسبة والمالية"),
          items: [
            { label: t("شجرة الحسابات"), href: "/expenses" },
            { label: t("حساب الضرائب"), href: "/expenses/tax" },
            { label: t("تقارير ضريبية"), href: "/expenses/tax-reports" },
          ],
        }}
      >
        <div className="space-y-4" dir={direction}>
          <div>
            <h1 className="text-2xl font-semibold text-foreground text-start">{t("المحاسبة والمالية")}</h1>
            <p className="mt-1 text-sm text-muted-foreground text-start">
              {t("إدارة الحسابات المالية عبر شجرة الحسابات.")}
            </p>
          </div>
          <ChartOfAccountsTree />
          <CostCenters />
        </div>
      </Layout>
    );
  }

  return (
    <Layout
      subMenu={{
        title: t("المحاسبة والمالية"),
        items: [
          { label: t("شجرة الحسابات"), href: "/expenses" },
        ],
      }}
    >
      <div className="space-y-6" dir={direction}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{description}</p>
          </div>
          {!isReports && !VOUCHERS_READ_ONLY && (
            <button
              onClick={async () => {
                if (isVouchers) {
                  const voucherNumber = await generateVoucherNumber("expense_vouchers", "SRF");
                  setVoucherForm({ ...getEmptyVoucherForm(), voucherNumber });
                }
                if (isPettyCash) {
                  const voucherNumber = await generateVoucherNumber("petty_cash_vouchers", "QBD");
                  setPettyCashForm({ ...getEmptyPettyCashForm(), voucherNumber });
                }
                setIsFormOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-lg bg-success px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-success/90"
            >
              <Plus className="h-4 w-4" />
              {isVouchers ? t("إنشاء سند صرف جديد") : t("إنشاء سند قبض من عميل")}
            </button>
          )}
        </div>

        {!isReports && VOUCHERS_READ_ONLY ? (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900" dir={direction}>
            <p className="flex items-start gap-2 font-semibold"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{t("هذه الشاشة للاطلاع فقط: السندات هنا لا تُرحَّل إلى القيود المحاسبية ولا تؤثر على الصندوق أو البنك أو أرصدة العملاء والموردين أو الإقرار الضريبي.")}</p>
            <ul className="mt-2 list-disc space-y-1 ps-10 text-xs leading-6">
              <li>{t("لتسجيل مبلغ مقبوض من عميل: افتح فاتورة المبيعات واستخدم زر السداد، فيُرحَّل القبض ويُخفَّض رصيد العميل.")}</li>
              <li>{t("لتسجيل مصروف أو دفعة لمورد: سجّل فاتورة مشتريات ثم سدادها من الفاتورة نفسها.")}</li>
              <li>{t("السندات المسجلة سابقًا معروضة أدناه للاطلاع والطباعة فقط، ولا يمكن إنشاء أو تعديل أو حذف سندات جديدة من هنا.")}</li>
            </ul>
            <div className="mt-3 flex flex-wrap gap-2 ps-6">
              <button onClick={() => navigate("/sales/invoices")} className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 ring-1 ring-amber-300 hover:bg-amber-100">{t("فواتير المبيعات")}</button>
              <button onClick={() => navigate("/purchases/invoices")} className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 ring-1 ring-amber-300 hover:bg-amber-100">{t("فواتير المشتريات")}</button>
            </div>
          </div>
        ) : null}

        {!isReports && !VOUCHERS_READ_ONLY && isFormOpen && isVouchers ? (
          <VoucherForm
            form={voucherForm}
            setForm={setVoucherForm}
            onSave={async () => {
              setSaving(true);

              const voucherId = voucherForm.id ?? crypto.randomUUID();
              const cleanedItems = voucherForm.items.filter(
                (item) => item.description.trim() || item.accountCode.trim() || item.amount
              );

              const voucherNumber = voucherForm.id
                ? voucherForm.voucherNumber
                : voucherForm.voucherNumber || (await generateVoucherNumber("expense_vouchers", "SRF"));

              const payload = {
                id: voucherId,
                voucher_number: voucherNumber,
                voucher_date: voucherForm.voucherDate,
                description: voucherForm.description,
                department: voucherForm.department,
                approved_by: voucherForm.approvedBy,
                total_amount: cleanedItems.reduce((sum, item) => sum + parseFloat(item.amount || "0"), 0),
                status: "مسودة",
              };

              const result = voucherForm.id
                ? await supabase.from("expense_vouchers").update(payload).eq("id", voucherForm.id)
                : await supabase.from("expense_vouchers").insert([payload]);

              if (!result.error) {
                await supabase.from("expense_voucher_items").delete().eq("voucher_id", voucherId);

                if (cleanedItems.length > 0) {
                  await supabase.from("expense_voucher_items").insert(
                    cleanedItems.map((item) => ({
                      voucher_id: voucherId,
                      item_description: item.description,
                      account_code: item.accountCode,
                      amount: item.amount || "0",
                    }))
                  );
                }

                await loadVouchers();
                setIsFormOpen(false);
                setVoucherForm(getEmptyVoucherForm());
                toast({ title: t("تم الحفظ"), description: t("تم حفظ السند بنجاح") });
              } else {
                toast({ title: t("فشل الحفظ"), description: t("تعذر حفظ السند"), variant: "destructive" });
              }
              setSaving(false);
            }}
            onCancel={() => setIsFormOpen(false)}
            saving={saving}
          />
        ) : !isReports && !VOUCHERS_READ_ONLY && isFormOpen && isPettyCash ? (
          <PettyCashForm
            form={pettyCashForm}
            setForm={setPettyCashForm}
            onSave={async () => {
              setSaving(true);
              const voucherId = pettyCashForm.id ?? crypto.randomUUID();
              const voucherNumber = pettyCashForm.id
                ? pettyCashForm.voucherNumber
                : pettyCashForm.voucherNumber || (await generateVoucherNumber("petty_cash_vouchers", "QBD"));

              const payload = {
                id: voucherId,
                voucher_number: voucherNumber,
                voucher_date: pettyCashForm.voucherDate,
                beneficiary_name: pettyCashForm.beneficiaryName,
                purpose: pettyCashForm.purpose,
                amount: pettyCashForm.amount,
                paid_by: pettyCashForm.paidBy,
                received_by: pettyCashForm.receivedBy,
                status: "قيد المراجعة",
              };

              const result = pettyCashForm.id
                ? await supabase
                    .from("petty_cash_vouchers")
                    .update(payload)
                    .eq("id", pettyCashForm.id)
                : await supabase.from("petty_cash_vouchers").insert([payload]);

              if (!result.error) {
                await loadPettyCash();
                setIsFormOpen(false);
                setPettyCashForm(getEmptyPettyCashForm());
                toast({ title: t("تم الحفظ"), description: t("تم حفظ السند بنجاح") });
              } else {
                toast({ title: t("فشل الحفظ"), description: t("تعذر حفظ السند"), variant: "destructive" });
              }
              setSaving(false);
            }}
            onCancel={() => setIsFormOpen(false)}
            saving={saving}
          />
        ) : null}

        {isVouchers && !isFormOpen && (
          <VouchersList
            rows={voucherRows}
            onView={handleViewVoucher}
            onEdit={VOUCHERS_READ_ONLY ? undefined : handleEditVoucher}
            onPrint={handlePrintVoucher}
            onDelete={VOUCHERS_READ_ONLY ? undefined : async (id) => {
              if (!confirm(t("هل متأكد من حذف السند؟"))) return;
              setDeleting(true);
              await supabase.from("expense_voucher_items").delete().eq("voucher_id", id);
              const result = await supabase.from("expense_vouchers").delete().eq("id", id);
              if (!result.error) {
                await loadVouchers();
                toast({ title: t("تم الحذف"), description: t("تم حذف السند بنجاح") });
              } else {
                toast({ title: t("فشل الحذف"), variant: "destructive" });
              }
              setDeleting(false);
            }}
          />
        )}

        {isPettyCash && !isFormOpen && (
          <>
            <PettyCashList
              rows={pettyCashRows}
              onView={handleViewPettyCash}
              onEdit={VOUCHERS_READ_ONLY ? undefined : handleEditPettyCash}
              onDelete={VOUCHERS_READ_ONLY ? undefined : async (id) => {
                if (!confirm(t("هل متأكد من حذف السند؟"))) return;
                setDeleting(true);
                const result = await supabase.from("petty_cash_vouchers").delete().eq("id", id);
                if (!result.error) {
                  await loadPettyCash();
                  toast({ title: t("تم الحذف"), description: t("تم حذف السند بنجاح") });
                } else {
                  toast({ title: t("فشل الحذف"), variant: "destructive" });
                }
                setDeleting(false);
              }}
            />
            <div className="mt-8 border-t border-border pt-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-foreground">{t("سندات الصرف")}</h2>
                  <p className="text-sm text-muted-foreground">{t("سجلات الصرف والمصروفات المعتمدة")}</p>
                </div>
                {!VOUCHERS_READ_ONLY && <button
                  onClick={async () => {
                    const voucherNumber = await generateVoucherNumber("expense_vouchers", "SRF");
                    setVoucherForm({ ...getEmptyVoucherForm(), voucherNumber });
                    setIsFormOpen(true);
                  }}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 transition"
                >
                  <Plus className="h-4 w-4" />
                  {t("إنشاء سند صرف جديد")}
                </button>}
              </div>
              <VouchersList
                rows={voucherRows}
                onView={handleViewVoucher}
                onEdit={VOUCHERS_READ_ONLY ? undefined : handleEditVoucher}
                onPrint={handlePrintVoucher}
                onDelete={VOUCHERS_READ_ONLY ? undefined : async (id) => {
                  if (!confirm(t("هل متأكد من حذف السند؟"))) return;
                  setDeleting(true);
                  await supabase.from("expense_voucher_items").delete().eq("voucher_id", id);
                  const result = await supabase.from("expense_vouchers").delete().eq("id", id);
                  if (!result.error) {
                    await loadVouchers();
                    toast({ title: t("تم الحذف"), description: t("تم حذف السند بنجاح") });
                  } else {
                    toast({ title: t("فشل الحذف"), variant: "destructive" });
                  }
                  setDeleting(false);
                }}
              />
            </div>
          </>
        )}

        {isReports && <ExpenseReportsList voucherRows={voucherRows} pettyCashRows={pettyCashRows} />}

        {voucherView && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" dir={direction}>
            <div className="w-full max-w-2xl rounded-xl border border-border bg-card p-6 space-y-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-foreground">{t("تفاصيل سند الصرف")}</h3>
                <button
                  onClick={() => setVoucherView(null)}
                  aria-label={t("إغلاق")}
                  className="rounded-lg border border-border p-2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="grid gap-3 md:grid-cols-2 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">{t("رقم السند")}</p>
                  <p className="font-medium text-foreground">{voucherView.voucherNumber}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("التاريخ")}</p>
                  <p className="font-medium text-foreground">{voucherView.voucherDate ? formatDate(voucherView.voucherDate, { dateStyle: "medium" }) : "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("القسم")}</p>
                  <p className="font-medium text-foreground">{voucherView.department || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("الموافق")}</p>
                  <p className="font-medium text-foreground">{voucherView.approvedBy || "—"}</p>
                </div>
              </div>

              <div>
                <p className="text-xs text-muted-foreground">{t("الوصف")}</p>
                <p className="font-medium text-foreground">{voucherView.description || "—"}</p>
              </div>

              <div className="rounded-lg border border-border overflow-hidden">
                <table dir={direction} className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="px-3 py-2 text-start font-semibold">{t("البند")}</th>
                      <th className="px-3 py-2 text-start font-semibold">{t("الحساب")}</th>
                      <th className="px-3 py-2 text-start font-semibold">{t("المبلغ")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {voucherView.items.length > 0 ? (
                      voucherView.items.map((item, index) => (
                        <tr key={item.id ?? index} className="border-t border-border">
                          <td className="px-3 py-2">{item.description || "—"}</td>
                          <td className="px-3 py-2">{item.accountCode || "—"}</td>
                          <td className="px-3 py-2">{formatNumber(Number.parseFloat(item.amount || "0") || 0, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {t("ريال")}</td>
                        </tr>
                      ))
                    ) : (
                      <tr className="border-t border-border">
                        <td colSpan={3} className="px-3 py-4 text-center text-muted-foreground">
                          {t("لا توجد بنود لهذا السند")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between pt-2">
                <p className="text-sm font-semibold text-foreground">{t("الإجمالي")}: {formatNumber(Number.parseFloat(voucherView.totalAmount || "0") || 0, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {t("ريال")}</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => void handlePrintVoucher(voucherView)}
                    className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700"
                  >
                    <Printer className="h-4 w-4" />
                    {t("طباعة سند الصرف")}
                  </button>
                  {!VOUCHERS_READ_ONLY && <button
                    onClick={() => void handleEditVoucher(voucherView)}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white"
                  >
                    <Pencil className="h-4 w-4" />
                    {t("تعديل السند")}
                  </button>}
                </div>
              </div>
            </div>
          </div>
        )}

        {pettyCashView && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" dir={direction}>
            <div className="w-full max-w-xl rounded-xl border border-border bg-card p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-foreground">{t("تفاصيل سند القبض")}</h3>
                <button
                  onClick={() => setPettyCashView(null)}
                  aria-label={t("إغلاق")}
                  className="rounded-lg border border-border p-2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="grid gap-3 md:grid-cols-2 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">{t("رقم السند")}</p>
                  <p className="font-medium text-foreground">{pettyCashView.voucherNumber}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("التاريخ")}</p>
                  <p className="font-medium text-foreground">{pettyCashView.voucherDate ? formatDate(pettyCashView.voucherDate, { dateStyle: "medium" }) : "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("المستفيد")}</p>
                  <p className="font-medium text-foreground">{pettyCashView.beneficiaryName || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("المبلغ")}</p>
                  <p className="font-medium text-foreground">{formatNumber(Number.parseFloat(pettyCashView.amount || "0") || 0, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {t("ريال")}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("صرفه")}</p>
                  <p className="font-medium text-foreground">{pettyCashView.paidBy || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("استلمه")}</p>
                  <p className="font-medium text-foreground">{pettyCashView.receivedBy || "—"}</p>
                </div>
              </div>

              <div>
                <p className="text-xs text-muted-foreground">{t("الغرض")}</p>
                <p className="font-medium text-foreground">{pettyCashView.purpose || "—"}</p>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => handlePrintPettyCash(pettyCashView)}
                  className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700"
                >
                  <Printer className="h-4 w-4" />
                  {t("طباعة سند القبض")}
                </button>
                {!VOUCHERS_READ_ONLY && <button
                  onClick={() => handleEditPettyCash(pettyCashView)}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white"
                >
                  <Pencil className="h-4 w-4" />
                  {t("تعديل السند")}
                </button>}
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

function VoucherForm({
  form,
  setForm,
  onSave,
  onCancel,
  saving,
}: {
  form: VoucherForm;
  setForm: (form: VoucherForm) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const { t, direction } = useI18n();

  return (
    <div className="rounded-xl border border-border bg-card p-6 space-y-4" dir={direction}>
      <h3 className="text-lg font-semibold text-foreground">
        {form.id ? t("تعديل سند الصرف") : t("إنشاء سند صرف جديد")}
      </h3>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="text-xs text-muted-foreground">{t("رقم السند")}</label>
          <input
            value={form.voucherNumber}
            readOnly
            className="mt-1 w-full rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm"
            placeholder={t("يتولد تلقائياً")}
          />
        </div>

        <div>
          <label className="text-xs text-muted-foreground">{t("التاريخ")}</label>
          <input
            type="date"
            value={form.voucherDate}
            onChange={(e) => setForm({ ...form, voucherDate: e.target.value })}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="text-xs text-muted-foreground">{t("القسم")}</label>
          <input
            value={form.department}
            onChange={(e) => setForm({ ...form, department: e.target.value })}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            placeholder={t("القسم")}
          />
        </div>

        <div>
          <label className="text-xs text-muted-foreground">{t("موافق من قبل")}</label>
          <input
            value={form.approvedBy}
            onChange={(e) => setForm({ ...form, approvedBy: e.target.value })}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            placeholder={t("الاسم")}
          />
        </div>
      </div>

      <div>
        <label className="text-xs text-muted-foreground">{t("الوصف")}</label>
        <textarea
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          placeholder={t("وصف السند")}
          rows={2}
        />
      </div>

      <div className="border-t border-border pt-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-semibold text-sm">{t("بنود السند")}</h4>
          <button
            onClick={() =>
              setForm({
                ...form,
                items: [...form.items, { description: "", accountCode: "", amount: "" }],
              })
            }
            className="text-xs text-primary hover:underline"
          >
            + {t("إضافة بند")}
          </button>
        </div>

        <div className="space-y-2">
          {form.items.map((item, idx) => (
            <div key={idx} className="grid gap-2 grid-cols-3">
              <input
                value={item.description}
                onChange={(e) => {
                  const newItems = [...form.items];
                  newItems[idx].description = e.target.value;
                  setForm({ ...form, items: newItems });
                }}
                placeholder={t("البند")}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
              <input
                value={item.accountCode}
                onChange={(e) => {
                  const newItems = [...form.items];
                  newItems[idx].accountCode = e.target.value;
                  setForm({ ...form, items: newItems });
                }}
                placeholder={t("كود الحساب")}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
              <div className="flex gap-2">
                <input
                  type="number"
                  value={item.amount}
                  onChange={(e) => {
                    const newItems = [...form.items];
                    newItems[idx].amount = e.target.value;
                    setForm({ ...form, items: newItems });
                  }}
                  placeholder={t("المبلغ")}
                  className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
                <button
                  onClick={() =>
                    setForm({
                      ...form,
                      items: form.items.filter((_, i) => i !== idx),
                    })
                  }
                  className="p-2 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 pt-4">
        <button
          onClick={onSave}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-success px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-success/90 disabled:opacity-60"
        >
          <Save className="h-4 w-4" />
          {saving ? t("جاري الحفظ...") : t("حفظ")}
        </button>

        <button
          onClick={onCancel}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground"
        >
          <X className="h-4 w-4" />
          {t("إلغاء")}
        </button>
      </div>
    </div>
  );
}

function PettyCashForm({
  form,
  setForm,
  onSave,
  onCancel,
  saving,
}: {
  form: PettyCashForm;
  setForm: (form: PettyCashForm) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const { t, direction, formatNumber } = useI18n();
  const amountValue = Number.parseFloat(form.amount || "0") || 0;
  const formatAmount = (value: number) => `${formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${t("ريال")}`;

  return (
    <div className="mx-auto max-w-3xl rounded-xl border border-border bg-card p-6 space-y-6" dir={direction}>
      <h3 className="text-2xl font-semibold text-foreground text-start">
        {form.id ? t("تعديل سند قبض من عميل") : t("سند قبض من عميل")}
      </h3>

      <section className="space-y-4">
        <div className="flex items-center justify-between rounded-md bg-muted/40 px-4 py-2">
          <h4 className="text-sm font-semibold text-foreground">{t("معلومات أساسية")}</h4>
          <span className="text-xs text-muted-foreground">{t("مطلوب")}</span>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">{t("العميل")}</label>
            <input
              value={form.beneficiaryName}
              onChange={(e) => setForm({ ...form, beneficiaryName: e.target.value })}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              placeholder={t("مطلوب")}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">{t("تم الدفع من خلال")}</label>
            <input
              value={form.paidBy}
              onChange={(e) => setForm({ ...form, paidBy: e.target.value })}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              placeholder={t("مطلوب")}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">{t("استلمه")}</label>
            <input
              value={form.receivedBy}
              onChange={(e) => setForm({ ...form, receivedBy: e.target.value })}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              placeholder={t("اسم المستلم")}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">{t("عملة السند")}</label>
            <input
              value={t("ريال سعودي (SAR)")}
              readOnly
              className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm font-semibold"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">{t("المبلغ المستلم")}</label>
            <input
              type="number"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              placeholder={t("مطلوب")}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">{t("التاريخ")}</label>
            <input
              type="date"
              value={form.voucherDate}
              onChange={(e) => setForm({ ...form, voucherDate: e.target.value })}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">{t("الوصف")}</label>
            <input
              value={form.purpose}
              onChange={(e) => setForm({ ...form, purpose: e.target.value })}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              placeholder={t("غير محدد")}
            />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between rounded-md bg-muted/40 px-4 py-2">
          <h4 className="text-sm font-semibold text-foreground">{t("معلومات إضافية (اختياري)")}</h4>
          <span className="text-xs text-muted-foreground">⌄</span>
        </div>

        <div>
          <p className="mb-2 text-xs text-muted-foreground">{t("نوع الدفعة")}</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground"
            >
              {t("دفعة مقدمة")}
            </button>
            <button
              type="button"
              className="rounded-md border border-border bg-muted/40 px-3 py-1.5 text-xs text-foreground"
            >
              {t("دفعة فواتير")}
            </button>
          </div>
        </div>
      </section>

      <section className="space-y-2 border-t border-border pt-4 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">{t("إضافة لرصيد العميل")}</span>
          <span className="font-medium">{formatAmount(amountValue)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">{t("المبلغ المدفوع")}</span>
          <span className="font-medium">{formatAmount(amountValue)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-foreground font-semibold">{t("المتبقي")}</span>
          <span className="font-semibold">{formatAmount(0)}</span>
        </div>
      </section>

      <div className="flex items-center gap-2 pt-2">
        <button
          onClick={onSave}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-success px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-success/90 disabled:opacity-60"
        >
          <Save className="h-4 w-4" />
          {saving ? t("جاري الحفظ...") : t("حفظ")}
        </button>

        <button
          onClick={onCancel}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground"
        >
          <X className="h-4 w-4" />
          {t("إلغاء")}
        </button>

        <input
          value={form.voucherNumber}
          readOnly
          className="ms-auto w-36 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs"
          placeholder={t("رقم السند")}
        />
      </div>
    </div>
  );
}

function VouchersList({
  rows,
  onView,
  onEdit,
  onPrint,
  onDelete,
}: {
  rows: VoucherRow[];
  onView: (row: VoucherRow) => void;
  onEdit?: (row: VoucherRow) => void;
  onPrint?: (row: VoucherRow) => void;
  onDelete?: (id: string) => void;
}) {
  const { t, direction, formatDate, formatNumber } = useI18n();
  const formatAmount = (value: string) => `${formatNumber(Number.parseFloat(value || "0") || 0, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${t("ريال")}`;
  const displayDate = (value: string) => value ? formatDate(value, { dateStyle: "medium" }) : "—";

  return (
    <div className="rounded-xl border border-border bg-card" dir={direction}>
      <div className="mb-4 flex flex-wrap items-center gap-3 p-4">
        <div className="relative w-full max-w-xs">
          <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            aria-label={t("البحث والتصفية")}
            placeholder={t("ابحث برقم السند...")}
            className="w-full rounded-lg border border-border bg-background px-9 py-2 text-sm"
            dir={direction}
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table dir={direction} className="w-full text-sm">
          <thead>
            <tr className="bg-emerald-600 text-white">
              <th className="px-4 py-3 text-start font-semibold">{t("رقم السند")}</th>
              <th className="px-4 py-3 text-start font-semibold">{t("التاريخ")}</th>
              <th className="px-4 py-3 text-start font-semibold">{t("الوصف")}</th>
              <th className="px-4 py-3 text-start font-semibold">{t("القسم")}</th>
              <th className="px-4 py-3 text-start font-semibold">{t("المبلغ")}</th>
              <th className="px-4 py-3 text-start font-semibold">{t("الحالة")}</th>
              <th className="px-4 py-3 text-start font-semibold">{t("الإجراءات")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border hover:bg-muted/40">
                <td className="px-4 py-3 font-medium text-primary">{row.voucherNumber}</td>
                <td className="px-4 py-3 text-muted-foreground">{displayDate(row.voucherDate)}</td>
                <td className="px-4 py-3 text-muted-foreground">{row.description}</td>
                <td className="px-4 py-3 text-muted-foreground">{row.department}</td>
                <td className="px-4 py-3 font-semibold text-foreground">{formatAmount(row.totalAmount)}</td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-yellow-500/10 px-3 py-1 text-xs font-semibold text-yellow-600">
                    {t(row.status)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onView(row)}
                      title={t("عرض")}
                      className="rounded-lg border border-border p-1.5 text-muted-foreground hover:text-primary transition"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    {onEdit && <button
                      onClick={() => onEdit(row)}
                      title={t("تعديل")}
                      className="rounded-lg border border-border p-1.5 text-muted-foreground hover:text-primary transition"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>}
                    {onPrint && (
                      <button
                        onClick={() => void onPrint(row)}
                        title={t("طباعة")}
                        className="rounded-lg border border-border p-1.5 text-muted-foreground hover:text-sky-600 transition"
                      >
                        <Printer className="h-4 w-4" />
                      </button>
                    )}
                    {onDelete && <button
                      onClick={() => onDelete(row.id)}
                      title={t("حذف")}
                      className="rounded-lg border border-border p-1.5 text-muted-foreground hover:text-destructive transition"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PettyCashList({
  rows,
  onView,
  onEdit,
  onDelete,
}: {
  rows: PettyCashRow[];
  onView: (row: PettyCashRow) => void;
  onEdit?: (row: PettyCashRow) => void;
  onDelete?: (id: string) => void;
}) {
  const { t, direction, formatDate, formatNumber } = useI18n();
  const formatAmount = (value: string) => `${formatNumber(Number.parseFloat(value || "0") || 0, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${t("ريال")}`;
  const displayDate = (value: string) => value ? formatDate(value, { dateStyle: "medium" }) : "—";

  return (
    <div className="rounded-xl border border-border bg-card" dir={direction}>
      <div className="mb-4 flex flex-wrap items-center gap-3 p-4">
        <div className="relative w-full max-w-xs">
          <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            aria-label={t("البحث والتصفية")}
            placeholder={t("ابحث برقم السند...")}
            className="w-full rounded-lg border border-border bg-background px-9 py-2 text-sm"
            dir={direction}
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table dir={direction} className="w-full text-sm">
          <thead>
            <tr className="bg-sky-600 text-white">
              <th className="px-4 py-3 text-start font-semibold">{t("رقم السند")}</th>
              <th className="px-4 py-3 text-start font-semibold">{t("التاريخ")}</th>
              <th className="px-4 py-3 text-start font-semibold">{t("المستفيد")}</th>
              <th className="px-4 py-3 text-start font-semibold">{t("المبلغ")}</th>
              <th className="px-4 py-3 text-start font-semibold">{t("الغرض")}</th>
              <th className="px-4 py-3 text-start font-semibold">{t("الحالة")}</th>
              <th className="px-4 py-3 text-start font-semibold">{t("الإجراءات")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border hover:bg-muted/40">
                <td className="px-4 py-3 font-medium text-primary">{row.voucherNumber}</td>
                <td className="px-4 py-3 text-muted-foreground">{displayDate(row.voucherDate)}</td>
                <td className="px-4 py-3 text-muted-foreground">{row.beneficiaryName}</td>
                <td className="px-4 py-3 font-semibold text-foreground">{formatAmount(row.amount)}</td>
                <td className="px-4 py-3 text-muted-foreground">{row.purpose}</td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-sky-500/10 px-3 py-1 text-xs font-semibold text-sky-600">
                    {t(row.status)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onView(row)}
                      title={t("عرض")}
                      className="rounded-lg border border-border p-1.5 text-muted-foreground hover:text-primary transition"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    {onEdit && <button
                      onClick={() => onEdit(row)}
                      title={t("تعديل")}
                      className="rounded-lg border border-border p-1.5 text-muted-foreground hover:text-primary transition"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>}
                    {onDelete && <button
                      onClick={() => onDelete(row.id)}
                      title={t("حذف")}
                      className="rounded-lg border border-border p-1.5 text-muted-foreground hover:text-destructive transition"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ExpenseReportsList({
  voucherRows,
  pettyCashRows,
}: {
  voucherRows: VoucherRow[];
  pettyCashRows: PettyCashRow[];
}) {
  const { t, direction, formatDate, formatNumber } = useI18n();
  const formatMoney = (value: number) => formatNumber(value, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const displayDate = (value: string) => value ? formatDate(value, { dateStyle: "medium" }) : "—";

  const vouchersTotal = voucherRows.reduce(
    (sum, row) => sum + Number.parseFloat(row.totalAmount || "0"),
    0
  );

  const pettyCashTotal = pettyCashRows.reduce(
    (sum, row) => sum + Number.parseFloat(row.amount || "0"),
    0
  );

  const overallTotal = vouchersTotal + pettyCashTotal;

  const transactions = [
    ...voucherRows.map((row) => ({
      id: row.id,
      number: row.voucherNumber,
      date: row.voucherDate,
      type: "سند صرف",
      description: row.description || row.department || "—",
      amount: Number.parseFloat(row.totalAmount || "0"),
      status: row.status,
    })),
    ...pettyCashRows.map((row) => ({
      id: row.id,
      number: row.voucherNumber,
      date: row.voucherDate,
      type: "سند قبض",
      description: row.purpose || row.beneficiaryName || "—",
      amount: Number.parseFloat(row.amount || "0"),
      status: row.status,
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="overflow-hidden rounded-xl border border-border bg-card p-4">
          <div className="bg-emerald-600 px-4 py-3 text-sm font-semibold text-white rounded-lg mb-3">
            {t("إجمالي سندات الصرف")}
          </div>
          <p className="text-2xl font-bold text-foreground">{formatMoney(vouchersTotal)} {t("ريال")}</p>
          <p className="text-xs text-muted-foreground mt-1">{formatNumber(voucherRows.length)} {t("سند")}</p>
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-card p-4">
          <div className="bg-sky-600 px-4 py-3 text-sm font-semibold text-white rounded-lg mb-3">
            {t("إجمالي سندات القبض")}
          </div>
          <p className="text-2xl font-bold text-foreground">{formatMoney(pettyCashTotal)} {t("ريال")}</p>
          <p className="text-xs text-muted-foreground mt-1">{formatNumber(pettyCashRows.length)} {t("سند")}</p>
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-card p-4">
          <div className="bg-rose-600 px-4 py-3 text-sm font-semibold text-white rounded-lg mb-3">
            {t("إجمالي المصروفات")}
          </div>
          <p className="text-2xl font-bold text-foreground">{formatMoney(overallTotal)} {t("ريال")}</p>
          <p className="text-xs text-muted-foreground mt-1">{t("من جميع السندات")}</p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        <h3 className="text-lg font-semibold text-foreground mb-4">{t("تقرير تفصيلي")}</h3>

        {transactions.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            <p>{t("لا توجد بيانات للعرض حالياً.")}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table dir={direction} className="w-full min-w-[900px] text-sm text-start">
              <thead>
                <tr className="bg-muted/50">
                  <th className="px-4 py-3 font-semibold">{t("رقم السند")}</th>
                  <th className="px-4 py-3 font-semibold">{t("النوع")}</th>
                  <th className="px-4 py-3 font-semibold">{t("التاريخ")}</th>
                  <th className="px-4 py-3 font-semibold">{t("الوصف")}</th>
                  <th className="px-4 py-3 font-semibold">{t("المبلغ")}</th>
                  <th className="px-4 py-3 font-semibold">{t("الحالة")}</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((row) => (
                  <tr key={`${row.type}-${row.id}`} className="border-t border-border hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium text-primary">{row.number}</td>
                    <td className="px-4 py-3">{t(row.type)}</td>
                    <td className="px-4 py-3">{displayDate(row.date)}</td>
                    <td className="px-4 py-3">{row.description}</td>
                    <td className="px-4 py-3 font-semibold">{formatMoney(row.amount)} {t("ريال")}</td>
                    <td className="px-4 py-3">{t(row.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
