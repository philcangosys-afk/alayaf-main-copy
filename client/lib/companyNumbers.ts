import { supabase } from "@/lib/supabaseClient";
import { companyDocPrefix } from "@/lib/companyProfile";

/**
 * أرقام المستندات لكل منشأة (نظام الشركات): الشكل 1001-SO-000001.
 * الرقم يُحجز من قاعدة البيانات (next_company_number) بلا تكرار بين المستخدمين، ويُطلب عند الحفظ فقط
 * حتى لا تُستهلك أرقام لمستندات لم تُحفظ. فاتورة المبيعات ورقم الموظف تولّدهما قاعدة البيانات نفسها.
 */
export type CompanyCounterKey =
  | "PIN" | "QUO" | "SO" | "PO" | "PR" | "PRT" | "GR" | "EXP" | "EV" | "PCV" | "ER" | "CERT" | "SUP" | "HOL" | "PD" | "DOC";

export async function nextCompanyNumber(key: CompanyCounterKey, width = 6): Promise<string> {
  const { data, error } = await supabase.rpc("next_company_number", { p_key: key, p_width: width });
  if (error) throw error;
  const value = String(data ?? "").trim();
  if (!value) throw new Error("COMPANY_NUMBER_EMPTY");
  return value;
}

/** نمط البحث عن أرقام المنشأة لنوع مستند: "1001-QUO-%" */
export function companyNumberLike(key: string): string {
  return `${companyDocPrefix()}${key}-%`;
}

/**
 * الرقم التالي المتوقع للعرض فقط (لا يحجز رقمًا): أكبر رقم محفوظ + 1.
 * الرقم الفعلي يُحجز عند الحفظ.
 */
export function previewNextNumber(latest: string | null | undefined, key: string, width = 6): string {
  const prefix = `${companyDocPrefix()}${key}-`;
  const match = String(latest ?? "").toUpperCase().startsWith(prefix.toUpperCase())
    ? String(latest).slice(prefix.length).match(/^(\d+)/)
    : null;
  const next = (match ? Number(match[1]) : 0) + 1;
  return `${prefix}${String(next).padStart(width, "0")}`;
}
