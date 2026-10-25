/**
 * S22: طباعة نقاط البيع على الطابعة الحرارية (80مم): إيصال البيع (الفاتورة المبسطة أو الضريبية برمز QR)،
 * وإيصال المرتجع (الإشعار الدائن)، وتقريرا الجلسة X (أثناءها) وZ (عند إغلاقها).
 * الطباعة من إطار مخفي (بلا نافذة منبثقة)، والعرض 80مم بهامش صغير يناسب طابعات الإيصالات.
 */
import QRCode from "qrcode";
import { COMPANY_PROFILE, DEFAULT_LOGO_URL } from "@/lib/companyProfile";
import { escapeHtml } from "@/lib/utils";
import { METHOD_LABELS, type PosReceipt, type ReturnResult, type SessionReport } from "@/lib/pos";

type Format = {
  t: (value: string) => string;
  direction: "rtl" | "ltr";
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatDate: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
};

const STYLE = `
  @page { size: 80mm auto; margin: 3mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Tahoma, Arial, sans-serif; font-size: 11.5px; color: #000; width: 74mm; }
  .c { text-align: center; }
  .b { font-weight: 700; }
  .big { font-size: 15px; font-weight: 700; }
  .muted { color: #333; }
  .rule { border-top: 1px dashed #000; margin: 5px 0; }
  .rule2 { border-top: 2px solid #000; margin: 5px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 1.5px 0; vertical-align: top; }
  td.n { text-align: end; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .line-name { font-weight: 700; }
  .line-meta { font-size: 10.5px; color: #222; }
  .qr { display: flex; justify-content: center; margin: 6px 0 2px; }
  .logo { max-height: 18mm; max-width: 50mm; object-fit: contain; }
  h2 { font-size: 12.5px; margin: 6px 0 3px; }
`;

/** التاريخ في المطبوعات: ميلادي بتوقيت الرياض (لا الهجري الافتراضي للعربية ولا توقيت الجهاز) */
const printDate = (format: Format, value: Date | string | number | null | undefined) =>
  value ? format.formatDate(value, { dateStyle: "short", timeStyle: "short", calendar: "gregory", timeZone: "Asia/Riyadh" } as Intl.DateTimeFormatOptions) : "";

/** رقم مستند أو رمز باتجاه ثابت من اليسار داخل الإيصال العربي */
const code = (value: string | null | undefined) => `<bdi dir="ltr">${escapeHtml(value ?? "")}</bdi>`;

/** إطار مخفي يُطبع منه المستند ثم يُزال */
function printHtml(html: string, direction: "rtl" | "ltr") {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.style.left = "-9999px";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    frame.remove();
    return;
  }
  doc.open();
  doc.write(`<!doctype html><html dir="${direction}" lang="${direction === "rtl" ? "ar" : "en"}"><head><meta charset="utf-8"><style>${STYLE}</style></head><body>${html}</body></html>`);
  doc.close();
  // مرة واحدة فقط (تحميل الصور والمهلة قد يتسابقان)، ويُزال الإطار بعد إغلاق نافذة الطباعة
  let printed = false;
  const remove = () => { if (frame.isConnected) frame.remove(); };
  const run = () => {
    if (printed) return;
    printed = true;
    win.addEventListener("afterprint", () => setTimeout(remove, 100), { once: true });
    try {
      win.focus();
      win.print();
    } finally {
      // احتياط للمتصفحات التي لا تطلق afterprint
      setTimeout(remove, 60000);
    }
  };
  // الشعار والصور قبل الطباعة
  const images = Array.from(doc.images);
  if (images.length === 0) {
    setTimeout(run, 50);
    return;
  }
  let pending = images.length;
  const done = () => {
    pending -= 1;
    if (pending <= 0) run();
  };
  images.forEach((image) => {
    if (image.complete) done();
    else {
      image.onload = done;
      image.onerror = done;
    }
  });
  setTimeout(run, 2500);
}

const qrSvg = async (data: string | null | undefined) =>
  data
    ? QRCode.toString(data, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } })
        .then((svg) => svg.replace("<svg ", '<svg width="34mm" height="34mm" preserveAspectRatio="xMidYMid meet" '))
        .catch(() => "")
    : "";

function sellerHeader(t: Format["t"]) {
  const logo = COMPANY_PROFILE.logoUrl && COMPANY_PROFILE.logoUrl !== DEFAULT_LOGO_URL
    ? `<div class="c"><img class="logo" src="${escapeHtml(COMPANY_PROFILE.logoUrl)}" alt=""></div>` : "";
  const lines = [
    `<div class="c big">${escapeHtml(COMPANY_PROFILE.companyNameAr || COMPANY_PROFILE.companyNameEn)}</div>`,
    COMPANY_PROFILE.vatNumber ? `<div class="c">${escapeHtml(t("الرقم الضريبي"))}: ${code(COMPANY_PROFILE.vatNumber)}</div>` : "",
    COMPANY_PROFILE.commercialRegistration ? `<div class="c">${escapeHtml(t("السجل التجاري"))}: ${code(COMPANY_PROFILE.commercialRegistration)}</div>` : "",
    COMPANY_PROFILE.addressAr ? `<div class="c muted">${escapeHtml(COMPANY_PROFILE.addressAr)}</div>` : "",
    COMPANY_PROFILE.phone ? `<div class="c muted">${code(COMPANY_PROFILE.phone)}</div>` : "",
  ];
  return logo + lines.join("");
}

const row = (label: string, value: string, bold = false) =>
  `<tr${bold ? ' class="b"' : ""}><td>${escapeHtml(label)}</td><td class="n">${value}</td></tr>`;

/** إيصال البيع (يُعاد طبعه من الجلسة أو شاشة المرتجع) */
export async function printSaleReceipt(receipt: PosReceipt, format: Format, options: { copy?: boolean } = {}) {
  const { t, direction, formatNumber } = format;
  const money = (value: number) => formatNumber(Math.abs(value) < 0.005 ? 0 : value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const inv = receipt.invoice;
  const lines = receipt.lines.map((line) => `
    <tr><td colspan="2" class="line-name">${escapeHtml(line.description)}</td></tr>
    <tr><td class="line-meta">${formatNumber(line.quantity)} × ${money(line.unit_price)}${line.discount > 0 ? ` — ${escapeHtml(t("خصم"))} ${money(line.discount)}` : ""}${line.returned > 0 ? ` — ${escapeHtml(t("مرتجع"))} ${formatNumber(line.returned)}` : ""}</td><td class="n">${money(line.net)}</td></tr>`).join("");
  const sale = receipt.sale;
  const payments = [
    sale.paid_cash > 0 || sale.cash_tendered > 0 ? row(t("نقد مستلم"), money(sale.cash_tendered)) : "",
    sale.change_given > 0 ? row(t("الباقي للعميل"), money(sale.change_given)) : "",
    sale.paid_card > 0 ? row(t("بطاقة"), money(sale.paid_card)) : "",
    sale.on_account > 0 ? row(t("على الحساب"), money(sale.on_account), true) : "",
  ].join("");
  const qr = await qrSvg(inv.qr_code_data);
  const zatcaNote = !inv.qr_code_data && inv.zatca_phase === "phase2"
    ? `<div class="c muted">${escapeHtml(t("رمز الهيئة يظهر بعد إبلاغ الفاتورة"))}</div>` : "";
  const returned = receipt.returns.length
    ? `<div class="rule"></div><div class="c b">${escapeHtml(t("على الفاتورة مرتجعات"))}: ${receipt.returns.map((r) => code(r.note_number)).join(direction === "rtl" ? "، " : ", ")}</div>` : "";
  const html = `
    ${sellerHeader(t)}
    <div class="rule2"></div>
    <div class="c big">${escapeHtml(t(inv.invoice_type === "standard" ? "فاتورة ضريبية" : "فاتورة ضريبية مبسطة"))}</div>
    ${options.copy ? `<div class="c b">${escapeHtml(t("نسخة"))}</div>` : ""}
    <table>
      ${row(t("رقم الفاتورة"), code(inv.id))}
      ${row(t("التاريخ"), escapeHtml(printDate(format, inv.created_at || inv.date)))}
      ${row(t("الجهاز"), escapeHtml(receipt.session.device_name))}
      ${row(t("الكاشير"), escapeHtml(receipt.session.user_name ?? "—"))}
      ${inv.customer_id && inv.customer !== "عميل نقدي" ? row(t("العميل"), escapeHtml(inv.customer)) : ""}
      ${inv.buyer_vat ? row(t("الرقم الضريبي للعميل"), code(inv.buyer_vat)) : ""}
    </table>
    <div class="rule"></div>
    <table>${lines}</table>
    <div class="rule"></div>
    <table>
      ${sale.discount_total > 0 ? row(t("الإجمالي قبل الخصم"), money(sale.gross_total)) + row(t("الخصم"), money(sale.discount_total)) : ""}
      ${row(t("الإجمالي قبل الضريبة"), money(inv.subtotal))}
      ${row(t("ضريبة القيمة المضافة 15%"), money(inv.total_tax))}
      ${row(t("الإجمالي شامل الضريبة"), money(inv.total), true)}
    </table>
    <div class="rule"></div>
    <table>${payments}</table>
    ${returned}
    ${qr ? `<div class="qr">${qr}</div>` : zatcaNote}
    ${receipt.receipt_footer ? `<div class="rule"></div><div class="c">${escapeHtml(receipt.receipt_footer)}</div>` : ""}
    <div class="c muted" style="margin-top:4px">${escapeHtml(t("الجلسة"))} ${code(receipt.session.session_number)}</div>
  `;
  printHtml(html, direction);
}

/** إيصال المرتجع (الإشعار الدائن) */
export async function printReturnReceipt(
  input: { result: ReturnResult; receipt: PosReceipt; footer: string | null },
  format: Format,
) {
  const { t, direction, formatNumber } = format;
  const money = (value: number) => formatNumber(Math.abs(value) < 0.005 ? 0 : value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const { result, receipt } = input;
  // بنود الإشعار كما صدر من الخادم (الخصم والضريبة كما في المستند نفسه)
  const rows = result.lines.map((line) => {
    const net = Math.round(line.quantity * line.unit_price * 100 - line.discount * 100) / 100;
    return `<tr><td colspan="2" class="line-name">${escapeHtml(line.description)}</td></tr>
      <tr><td class="line-meta">${formatNumber(line.quantity)} × ${money(line.unit_price)}${line.discount > 0 ? ` — ${escapeHtml(t("خصم"))} ${money(line.discount)}` : ""}</td><td class="n">${money(net)}</td></tr>`;
  }).join("");
  const subtotal = result.note_subtotal;
  const qr = await qrSvg(result.note_qr_code_data);
  const html = `
    ${sellerHeader(t)}
    <div class="rule2"></div>
    <div class="c big">${escapeHtml(t("إشعار دائن (مرتجع)"))}</div>
    <table>
      ${row(t("رقم الإشعار"), code(result.note_number))}
      ${row(t("الفاتورة الأصلية"), code(result.invoice_id))}
      ${row(t("التاريخ"), escapeHtml(printDate(format, result.created_at)))}
      ${receipt.invoice.customer_id && receipt.invoice.customer !== "عميل نقدي" ? row(t("العميل"), escapeHtml(receipt.invoice.customer)) : ""}
      ${result.reason ? row(t("السبب"), escapeHtml(result.reason)) : ""}
    </table>
    <div class="rule"></div>
    <table>${rows}</table>
    <div class="rule"></div>
    <table>
      ${row(t("قبل الضريبة"), money(subtotal))}
      ${row(t("ضريبة القيمة المضافة 15%"), money(result.note_tax))}
      ${row(t("إجمالي المرتجع"), money(result.total), true)}
      ${result.refund_amount > 0 ? row(`${t("المردود")} (${t(METHOD_LABELS[result.refund_method] ?? result.refund_method)})`, money(result.refund_amount), true) : ""}
      ${result.refund_amount > 0 && result.refund_amount < result.total ? row(t("خُصم من المتبقي على الفاتورة"), money(result.total - result.refund_amount)) : ""}
    </table>
    ${qr ? `<div class="qr">${qr}</div>` : result.note_zatca_phase === "phase2" ? `<div class="c muted">${escapeHtml(t("رمز الهيئة يظهر بعد إبلاغ الإشعار"))}</div>` : ""}
    ${input.footer ? `<div class="rule"></div><div class="c">${escapeHtml(input.footer)}</div>` : ""}
  `;
  printHtml(html, direction);
}

/** تقرير الجلسة: X أثناءها، وZ عند إغلاقها */
export function printSessionReport(report: SessionReport, format: Format) {
  const { t, direction, formatNumber } = format;
  const money = (value: number) => formatNumber(Math.abs(value) < 0.005 ? 0 : value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const s = report.summary;
  const session = report.session;
  const close = report.close;
  const items = s.items.slice(0, 40).map((item) =>
    `<tr><td>${escapeHtml(item.description)} <span class="muted">× ${formatNumber(item.quantity)}</span></td><td class="n">${money(item.amount)}</td></tr>`).join("");
  const handovers = close?.handovers?.map((h) => row(`${t("تسليم إلى")} ${h.name}`, money(h.amount))).join("") ?? "";
  const html = `
    ${sellerHeader(t)}
    <div class="rule2"></div>
    <div class="c big">${escapeHtml(t(report.report_type === "Z" ? "تقرير Z (إغلاق الجلسة)" : "تقرير X (أثناء الجلسة)"))}</div>
    <table>
      ${row(t("الجلسة"), code(session.session_number))}
      ${row(t("الجهاز"), escapeHtml(session.device_name))}
      ${row(t("الكاشير"), escapeHtml(session.user_name ?? "—"))}
      ${row(t("الفتح"), escapeHtml(printDate(format, session.opened_at)))}
      ${session.closed_at ? row(t("الإغلاق"), escapeHtml(printDate(format, session.closed_at))) : ""}
      ${close?.closed_by_name ? row(t("أغلقها"), escapeHtml(close.closed_by_name)) : ""}
    </table>
    <h2>${escapeHtml(t("المبيعات"))}</h2>
    <table>
      ${row(t("عدد الفواتير"), formatNumber(s.sales_count))}
      ${row(t("الإجمالي قبل الخصم"), money(s.gross))}
      ${row(t("الخصومات"), money(s.discounts))}
      ${row(t("الصافي قبل الضريبة"), money(s.net_sales))}
      ${row(t("الضريبة"), money(s.tax))}
      ${row(t("إجمالي المبيعات"), money(s.total), true)}
      ${row(t("نقد"), money(s.sales_cash))}
      ${row(t("بطاقة"), money(s.sales_card))}
      ${row(t("على الحساب"), money(s.sales_on_account))}
    </table>
    <h2>${escapeHtml(t("المرتجعات"))}</h2>
    <table>
      ${row(t("عدد المرتجعات"), formatNumber(s.returns_count))}
      ${row(t("إجمالي المرتجعات"), money(s.returns_total), true)}
      ${row(t("رد نقدي"), money(s.refunds_cash))}
      ${row(t("رد للبطاقة"), money(s.refunds_card))}
    </table>
    <div class="rule"></div>
    <table>
      ${row(t("صافي المبيعات بعد المرتجعات"), money(s.net_total), true)}
      ${row(t("صافي الضريبة"), money(s.net_tax))}
    </table>
    <h2>${escapeHtml(t("حركات النقد الأخرى"))}</h2>
    <table>
      ${row(t("قبض من العملاء نقدًا"), money(s.receipts_cash))}
      ${row(t("قبض من العملاء بالبطاقة"), money(s.receipts_card))}
      ${row(t("المصروفات"), money(s.expenses_total))}
      ${row(t("إيداع من الخزينة"), money(s.cash_in))}
      ${row(t("سحب إلى الخزينة"), money(s.cash_out))}
      ${s.rounding ? row(t("هللات تقريب المرتجعات (بلا أثر نقدي)"), money(s.rounding)) : ""}
      ${s.ledger_adjustment ? row(t("تسوية فرق الدفتر"), money(s.ledger_adjustment)) : ""}
    </table>
    <h2>${escapeHtml(t("النقد"))}</h2>
    <table>
      ${row(t("رصيد الافتتاح"), money(s.opening_balance))}
      ${row(t("النقد المتوقع"), money(close ? close.expected_cash : s.expected_cash), true)}
      ${close ? row(t("النقد المعدود"), money(close.counted_cash), true) : ""}
      ${close && close.difference !== 0 ? row(t(close.difference < 0 ? "العجز" : "الزيادة"), money(Math.abs(close.difference)), true) : ""}
      ${handovers}
      ${close ? row(t(close.remaining_place === "box" ? "الباقي في الصندوق" : "الباقي عهدة مع الموظف"), money(close.remaining_cash), true) : ""}
      ${row(t("إجمالي البطاقة"), money(s.card_total))}
    </table>
    ${items ? `<h2>${escapeHtml(t("الأصناف المباعة"))}</h2><table>${items}</table>` : ""}
    <div class="rule"></div>
    <div class="c muted">${escapeHtml(t("طُبع في"))} ${escapeHtml(printDate(format, new Date()))}</div>
  `;
  printHtml(html, direction);
}

