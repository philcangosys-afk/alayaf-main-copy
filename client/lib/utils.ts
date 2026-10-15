import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * تاريخ اليوم (YYYY-MM-DD) بتوقيت الرياض، مع إزاحة اختيارية بالأيام.
 * يُستخدم بدل toISOString() الذي يعطي تاريخ UTC (يوم أمس بين 00:00 و03:00 بتوقيت الرياض).
 */
export function riyadhDateString(offsetDays = 0): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const pick = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const date = new Date(Date.UTC(pick("year"), pick("month") - 1, pick("day")));
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

/** الرقم الضريبي السعودي: 15 رقمًا يبدأ وينتهي بالرقم 3 (قواعد ZATCA). */
export const SAUDI_VAT_NUMBER_PATTERN = /^3\d{13}3$/;

/** نسبة ضريبة القيمة المضافة الأساسية المدعومة حاليًا في مسار الفوترة الإلكترونية. */
export const SAUDI_STANDARD_VAT_RATE = 15;

/** تهريب النص قبل كتابته داخل HTML للطباعة. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
