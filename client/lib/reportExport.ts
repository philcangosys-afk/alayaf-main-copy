import * as XLSX from "xlsx";
import { COMPANY_PROFILE } from "@/lib/companyProfile";

export type ReportCell = string | number | null | undefined;

export type ReportColumn = {
  key: string;
  label: string;
  width?: number;
};

export type ReportBrand = {
  /** السطر العلوي في ترويسة التقرير المطبوع (اسم الجهة المصدرة). */
  label: string;
  /** شارة قصيرة داخل المربع الملون في الترويسة. */
  mark?: string;
};

/** ترويسة التقارير المالية والضريبية: اسم المنشأة ورقمها الضريبي بدل ترويسة الموارد البشرية. */
export const COMPANY_REPORT_BRAND: ReportBrand = {
  // يُقرأ وقت الطباعة: بيانات المنشأة الحالية بعد الدخول
  get label() {
    return `${COMPANY_PROFILE.companyNameAr} — الرقم الضريبي ${COMPANY_PROFILE.vatNumber}`;
  },
  mark: "ERP",
};

/** الترويسة الافتراضية كما كانت (تستخدمها تقارير الموارد البشرية دون تغيير). */
const DEFAULT_BRAND: Required<ReportBrand> = { label: "نظام إدارة الموارد البشرية", mark: "HR" };

type ReportExportOptions = {
  title: string;
  subtitle?: string;
  columns: ReportColumn[];
  rows: Record<string, ReportCell>[];
  fileName: string;
  summary?: Array<{ label: string; value: ReportCell }>;
  landscape?: boolean;
  brand?: ReportBrand;
};

const text = (value: ReportCell) => value === null || value === undefined || value === "" ? "-" : String(value);

export const escapeReportHtml = (value: ReportCell) => text(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");

export function printReport({ title, subtitle, columns, rows, summary = [], landscape = false, brand }: ReportExportOptions) {
  const brandLabel = brand?.label || DEFAULT_BRAND.label;
  const brandMark = brand ? brand.mark || "" : DEFAULT_BRAND.mark;
  const printWindow = window.open("", "_blank");
  if (!printWindow) return false;

  const tableRows = rows.length
    ? rows.map((row, index) => `<tr><td class="index">${index + 1}</td>${columns.map((column) => `<td>${escapeReportHtml(row[column.key])}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${columns.length + 1}" class="empty">لا توجد بيانات في التقرير</td></tr>`;
  const summaryHtml = summary.length
    ? `<div class="summary">${summary.map((item) => `<div><span>${escapeReportHtml(item.label)}</span><strong>${escapeReportHtml(item.value)}</strong></div>`).join("")}</div>`
    : "";

  printWindow.document.write(`<!doctype html>
<html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${escapeReportHtml(title)}</title>
<style>
@page{size:A4 ${landscape ? "landscape" : "portrait"};margin:10mm}*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}body{margin:0;background:#e8eef4;color:#10233d;font-family:"Tajawal","Tahoma",Arial,sans-serif}.report{max-width:${landscape ? "277mm" : "190mm"};min-height:180mm;margin:14px auto;background:#fff;padding:12mm;border-radius:18px;box-shadow:0 15px 45px #0f27441f}.header{display:flex;align-items:center;justify-content:space-between;padding:0 0 14px;border-bottom:4px solid #0f766e}.eyebrow{color:#0f766e;font-size:11px;font-weight:800;letter-spacing:.8px}.header h1{margin:4px 0 3px;font-size:25px;color:#10233d}.header p{margin:0;color:#64748b;font-size:11px}.mark{width:58px;height:58px;border-radius:18px;background:linear-gradient(135deg,#075985,#0f766e);display:grid;place-items:center;color:#fff;font-size:18px;font-weight:900;box-shadow:0 8px 18px #0f766e40}.meta{display:flex;justify-content:space-between;gap:12px;margin:13px 0;color:#64748b;font-size:10px}.table-wrap{border:1px solid #dbe5ee;border-radius:12px;overflow:hidden}table{width:100%;border-collapse:collapse;font-size:${landscape ? "9px" : "10px"};table-layout:auto}thead{display:table-header-group}th{background:linear-gradient(135deg,#075985,#0f766e);color:#fff;font-weight:700;padding:8px 6px;text-align:center;border-left:1px solid #ffffff24}td{padding:7px 6px;text-align:center;border-bottom:1px solid #e7edf3;border-left:1px solid #edf2f7;vertical-align:middle;word-break:break-word}tbody tr:nth-child(even){background:#f6fafb}tbody tr:nth-child(odd){background:#fff}.index{width:30px;color:#64748b}.empty{padding:28px;color:#64748b}.summary{display:grid;grid-template-columns:repeat(${Math.min(Math.max(summary.length, 1), 4)},1fr);gap:8px;margin-top:12px}.summary div{border:1px solid #cfe4df;background:linear-gradient(135deg,#f0fdfa,#eff6ff);padding:10px;border-radius:10px}.summary span{display:block;color:#64748b;font-size:9px;margin-bottom:4px}.summary strong{font-size:14px;color:#0f766e}.footer{display:flex;justify-content:space-between;margin-top:16px;padding-top:9px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:9px}tr{page-break-inside:avoid}@media print{body{background:#fff}.report{max-width:none;margin:0;padding:0;box-shadow:none;border-radius:0}.no-print{display:none}}
</style></head><body><main class="report"><header class="header"><div><div class="eyebrow">${escapeReportHtml(brandLabel)}</div><h1>${escapeReportHtml(title)}</h1><p>${escapeReportHtml(subtitle || "تقرير رسمي صادر من النظام")}</p></div><div class="mark">${escapeReportHtml(brandMark)}</div></header><div class="meta"><span>عدد السجلات: ${rows.length}</span><span>تاريخ الإصدار: ${new Date().toLocaleDateString("ar-SA")}</span></div><div class="table-wrap"><table><thead><tr><th>#</th>${columns.map((column) => `<th>${escapeReportHtml(column.label)}</th>`).join("")}</tr></thead><tbody>${tableRows}</tbody></table></div>${summaryHtml}<footer class="footer"><span>${escapeReportHtml(title)}</span><span>وثيقة تم إنشاؤها إلكترونياً</span></footer></main><script>window.onload=()=>setTimeout(()=>window.print(),250)</script></body></html>`);
  printWindow.document.close();
  return true;
}

export function exportReportExcel({ title, subtitle, columns, rows, fileName, summary = [], brand }: ReportExportOptions) {
  const subtitleText = subtitle || `تاريخ الإصدار: ${new Date().toLocaleDateString("ar-SA")}`;
  const headingRows: ReportCell[][] = [
    [title],
    [brand?.label ? `${brand.label} — ${subtitleText}` : subtitleText],
    [],
    ["م", ...columns.map((column) => column.label)],
    ...rows.map((row, index) => [index + 1, ...columns.map((column) => row[column.key] ?? "-")]),
  ];

  if (summary.length) {
    headingRows.push([], ["الملخص"], ...summary.map((item) => [item.label, item.value]));
  }

  const worksheet = XLSX.utils.aoa_to_sheet(headingRows);
  worksheet["!rtl"] = true;
  worksheet["!cols"] = [{ wch: 6 }, ...columns.map((column) => ({ wch: column.width ?? Math.max(14, column.label.length + 4) }))];
  worksheet["!freeze"] = { xSplit: 0, ySplit: 4 };
  worksheet["!autofilter"] = rows.length ? { ref: XLSX.utils.encode_range({ r: 3, c: 0 }, { r: 3 + rows.length, c: columns.length }) } : undefined;
  worksheet["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: columns.length } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: columns.length } },
  ];

  const workbook = XLSX.utils.book_new();
  workbook.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(workbook, worksheet, "التقرير");
  XLSX.writeFile(workbook, `${fileName}.xlsx`, { compression: true });
}
