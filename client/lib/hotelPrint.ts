/**
 * S20: طباعة فاتورة الحجز (بعد المغادرة) أو كشف حساب مبدئي (قبلها) من قسم الحجوزات، أو تحميلها PDF مباشرة.
 * الفاتورة نفسها فاتورة مبيعات (رقمها وقيدها ورمز QR المحفوظ لها كما في المبيعات)؛ هنا عرضها للنزيل فقط.
 */
import QRCode from "qrcode";
import { COMPANY_PROFILE } from "@/lib/companyProfile";
import { escapeHtml } from "@/lib/utils";
import { openDocumentOutput, type DocumentOutputMode } from "@/lib/pdfDownload";
import { isolate, isolateCodes, type HotelGuest, type HotelReservation, type HotelTotals, type InvoiceLine } from "@/lib/hotel";

type Format = {
  t: (value: string) => string;
  direction: "rtl" | "ltr";
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatDate: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
};

/** بالهللة (أعداد صحيحة) لا بكسور النقطة العائمة */
const toCents = (value: number) => Math.round(Number(value) * 100);

export async function printHotelDocument(input: Format & {
  mode: DocumentOutputMode;
  totals: HotelTotals;
  reservation: HotelReservation;
  guest: HotelGuest | null;
  unitCodes: string[];
}) {
  const { mode, totals, reservation, guest, unitCodes, t, direction, formatNumber, formatDate } = input;
  const invoice = totals.invoice;
  const fileName = invoice ? invoice.id : `${reservation.number}-folio`;
  const target = openDocumentOutput(mode, fileName);
  if (!target) return;
  const money = (value: number) => formatNumber(Math.abs(value) < 0.005 ? 0 : value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const lines: InvoiceLine[] = invoice?.items?.length ? invoice.items : totals.items;
  const rows = lines.map((item, index) => {
    // ضريبة البند للعرض: من صافيه بالهللة؛ ضريبة الفاتورة المعتمدة من مجموعها (قد يختلف المجموع بهللة)
    const taxableCents = Math.round(Number(item.quantity) * toCents(item.unitPrice)) - toCents(item.discount || 0);
    const taxable = taxableCents / 100;
    const vat = Math.round((taxableCents * Number(item.taxPercent ?? 15)) / 100) / 100;
    return `<tr>
      <td>${formatNumber(index + 1)}</td>
      <td class="desc">${escapeHtml(isolateCodes(item.description || "-"))}</td>
      <td>${formatNumber(Number(item.quantity))}</td>
      <td>${money(Number(item.unitPrice))}</td>
      <td>${money(Number(item.discount || 0))}</td>
      <td>${money(taxable)}</td>
      <td>${money(vat)}</td>
      <td>${money(taxable + vat)}</td>
    </tr>`;
  }).join("");

  const qr = invoice?.qr_code_data
    ? await QRCode.toString(invoice.qr_code_data, { type: "svg", margin: 2, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } })
      .then((svg) => svg.replace("<svg ", '<svg width="38mm" height="38mm" preserveAspectRatio="xMidYMid meet" '))
      .catch(() => "")
    : "";

  const title = invoice
    ? t(invoice.invoice_type === "standard" ? "فاتورة ضريبية" : "فاتورة ضريبية مبسطة")
    : t("كشف حساب مبدئي");
  const seller = [
    COMPANY_PROFILE.companyNameAr,
    COMPANY_PROFILE.vatNumber ? `${t("الرقم الضريبي")}: ${COMPANY_PROFILE.vatNumber}` : "",
    COMPANY_PROFILE.commercialRegistration ? `${t("السجل التجاري")}: ${COMPANY_PROFILE.commercialRegistration}` : "",
    COMPANY_PROFILE.addressAr,
  ].filter(Boolean).map((line) => `<div>${escapeHtml(line)}</div>`).join("");
  const buyer = invoice
    ? [
        invoice.customer,
        invoice.customer_address,
        invoice.buyer_vat ? `${t("الرقم الضريبي")}: ${invoice.buyer_vat}` : "",
        invoice.buyer_commercial_registration ? `${t("السجل التجاري")}: ${invoice.buyer_commercial_registration}` : "",
      ]
    : [guest?.fullName ?? "", guest?.phone ?? ""];
  const issued = invoice
    ? formatDate(invoice.created_at || invoice.date, { dateStyle: "medium", timeStyle: "short" })
    : formatDate(new Date(), { dateStyle: "medium", timeStyle: "short" });
  const totalsRows = invoice
    ? [
        [t("المجموع قبل الضريبة"), money(invoice.subtotal)],
        [t("ضريبة القيمة المضافة 15%"), money(invoice.total_tax)],
        [t("الإجمالي شامل الضريبة"), money(invoice.original_total ?? invoice.subtotal + invoice.total_tax)],
        // بعد إشعار دائن أو مدين: الإجمالي المعدل
        ...(Math.abs((invoice.original_total ?? invoice.total) - invoice.total) >= 0.005
          ? [[t("الإجمالي بعد الإشعارات"), money(invoice.total)]]
          : []),
        [t("المدفوع"), money(invoice.paid)],
        [t("المتبقي"), money(invoice.remaining)],
      ]
    : [
        [t("المجموع قبل الضريبة"), money(totals.subtotal)],
        [t("ضريبة القيمة المضافة 15%"), money(totals.tax)],
        [t("الإجمالي شامل الضريبة"), money(totals.total)],
        [t("الدفعات المقدمة"), money(totals.advances)],
        [t("المتبقي"), money(totals.balance)],
      ];

  target.document.open();
  target.document.write(`<!doctype html>
<html dir="${direction}" lang="${direction === "rtl" ? "ar" : "en"}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)} ${escapeHtml(invoice?.id ?? reservation.number)}</title>
<style>
  @page { size: A4 portrait; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Tahoma, Arial, sans-serif; color: #1f2937; font-size: 12px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { width: 100%; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 2px solid #5d1a3c; padding-bottom: 10px; }
  .top h1 { margin: 0 0 4px; font-size: 20px; color: #5d1a3c; }
  .muted { color: #6b7280; }
  .meta { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin: 12px 0; }
  .box { border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 10px; line-height: 1.7; }
  .box h3 { margin: 0 0 4px; font-size: 12px; color: #5d1a3c; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { border: 1px solid #e5e7eb; padding: 6px; text-align: center; }
  th { background: #f7eef2; color: #3b0f26; font-weight: bold; }
  td.desc { text-align: start; }
  .bottom { display: flex; justify-content: space-between; gap: 16px; margin-top: 12px; align-items: flex-start; }
  .totals { width: 55%; border-collapse: collapse; }
  .totals td { text-align: start; }
  .totals td:last-child { text-align: end; font-weight: bold; }
  .qr { width: 40mm; text-align: center; }
  .note { margin-top: 14px; font-size: 11px; color: #6b7280; }
</style>
</head>
<body>
<div class="sheet">
  <div class="top">
    <div>
      <h1>${escapeHtml(title)}</h1>
      <div class="muted">${escapeHtml(invoice ? `${t("رقم الفاتورة")}: ${isolate(invoice.id)}` : `${t("الحجز")}: ${isolate(reservation.number)}`)}</div>
      <div class="muted">${escapeHtml(`${t("التاريخ")}: ${issued}`)}</div>
    </div>
    <div style="text-align:end">${seller}</div>
  </div>
  <div class="meta">
    <div class="box"><h3>${escapeHtml(t(invoice ? "المشتري" : "النزيل"))}</h3>${buyer.filter(Boolean).map((line) => `<div>${escapeHtml(line)}</div>`).join("")}</div>
    <div class="box"><h3>${escapeHtml(t("الإقامة"))}</h3>
      <div>${escapeHtml(`${t("الحجز")}: ${isolate(reservation.number)}`)}</div>
      <div>${escapeHtml(`${t("الوحدات")}: ${unitCodes.join("، ")}`)}</div>
      <div>${escapeHtml(`${formatDate(reservation.checkIn, { dateStyle: "medium" })} — ${formatDate(reservation.checkOut, { dateStyle: "medium" })} (${formatNumber(totals.nights)} ${t("ليلة")})`)}</div>
    </div>
  </div>
  <table>
    <thead><tr>
      <th>#</th><th>${escapeHtml(t("البيان"))}</th><th>${escapeHtml(t("الكمية"))}</th><th>${escapeHtml(t("السعر"))}</th>
      <th>${escapeHtml(t("الخصم"))}</th><th>${escapeHtml(t("المبلغ الخاضع"))}</th><th>${escapeHtml(t("الضريبة 15%"))}</th><th>${escapeHtml(t("الإجمالي"))}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="bottom">
    <table class="totals"><tbody>
      ${totalsRows.map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(value)} ${escapeHtml(t("ريال"))}</td></tr>`).join("")}
    </tbody></table>
    ${invoice ? `<div class="qr">${qr || `<div class="box muted">${escapeHtml(t(invoice.zatca_phase === "phase1" ? "لا يوجد رقم ضريبي للمنشأة" : "QR بعد الاعتماد"))}</div>`}</div>` : ""}
  </div>
  <div class="note">${escapeHtml(invoice
    ? t(reservation.status === "cancelled"
      ? "فاتورة رسوم إلغاء الحجز؛ الدفعات المقدمة مخصومة منها."
      : "فاتورة مبيعات صادرة عند المغادرة؛ الدفعات المقدمة مخصومة منها.")
    : t("ليس فاتورة ضريبية: الفاتورة تصدر عند المغادرة، والمبالغ قد تتغير بالخدمات وتعديل الإقامة."))}</div>
</div>
</body>
</html>`);
  target.document.close();
  window.setTimeout(() => {
    target.focus();
    target.print();
  }, 150);
}
