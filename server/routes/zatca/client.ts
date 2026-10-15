/**
 * عميل ZATCA للاتصال بـ Compliance و Reporting APIs (يعمل على الخادم)
 * يتجنب مشاكل CORS ويُبقي بيانات الاعتماد على السيرفر.
 *
 * المرجع: وثائق ZATCA الرسمية (Developer Portal - Sandbox)
 */

import { buildBasicAuth } from "./crypto";

// روابط بوابة Fatoora
export const ZATCA_URLS = {
  sandbox: "https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal",
  simulation: "https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation",
  production: "https://gw-fatoora.zatca.gov.sa/e-invoicing/core",
} as const;

export type ZatcaMode = keyof typeof ZATCA_URLS;

function baseUrl(mode: ZatcaMode): string {
  return ZATCA_URLS[mode] || ZATCA_URLS.sandbox;
}

interface ZatcaResponse<T = any> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

async function parseJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * الخطوة 1 من الـ Onboarding: الحصول على Compliance CSID
 * POST /compliance
 * Body: { csr: base64 }
 * Header: OTP
 */
export async function requestComplianceCSID(
  mode: ZatcaMode,
  csrBase64: string,
  otp: string,
): Promise<ZatcaResponse> {
  const res = await fetch(`${baseUrl(mode)}/compliance`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Version": "V2",
      OTP: otp,
    },
    body: JSON.stringify({ csr: csrBase64 }),
  });
  const data = await parseJson(res);
  return {
    ok: res.status === 200,
    status: res.status,
    data,
    error: res.status === 200 ? undefined : data?.message || `HTTP ${res.status}`,
  };
}

/**
 * الخطوة 2 من الـ Onboarding: الحصول على Production CSID
 * POST /production/csids
 * Body: { compliance_request_id }
 * Auth: Basic (compliance CSID:secret)
 */
export async function requestProductionCSID(
  mode: ZatcaMode,
  complianceCsid: string,
  complianceSecret: string,
  complianceRequestId: string,
): Promise<ZatcaResponse> {
  const res = await fetch(`${baseUrl(mode)}/production/csids`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Version": "V2",
      "Accept-Language": "en",
      Authorization: buildBasicAuth(
        complianceCsid.replace(/\s+/g, ""),
        complianceSecret.replace(/\s+/g, ""),
      ),
    },
    body: JSON.stringify({
      compliance_request_id: complianceRequestId.trim(),
    }),
  });
  const data = await parseJson(res);
  return {
    ok: res.status === 200,
    status: res.status,
    data,
    error: res.status === 200 ? undefined : data?.message || `HTTP ${res.status}`,
  };
}

/**
 * فحص التوافق (Compliance Check) لفاتورة تجريبية
 * POST /compliance/invoices
 * Auth: Basic (compliance CSID:secret)
 */
export async function checkComplianceInvoice(
  mode: ZatcaMode,
  csid: string,
  secret: string,
  invoiceHash: string,
  uuid: string,
  invoiceBase64: string,
): Promise<ZatcaResponse> {
  const res = await fetch(`${baseUrl(mode)}/compliance/invoices`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Version": "V2",
      "accept-language": "ar",
      Authorization: buildBasicAuth(csid, secret),
    },
    body: JSON.stringify({ invoiceHash, uuid, invoice: invoiceBase64 }),
  });
  const data = await parseJson(res);
  return {
    ok: res.status === 200 || res.status === 202,
    status: res.status,
    data,
    error:
      res.status === 200 || res.status === 202
        ? undefined
        : data?.message || `HTTP ${res.status}`,
  };
}

/**
 * الإبلاغ عن الفاتورة المبسطة (B2C)
 * POST /invoices/reporting/single
 * Auth: Basic (production CSID:secret)
 */
export async function reportInvoice(
  mode: ZatcaMode,
  csid: string,
  secret: string,
  invoiceHash: string,
  uuid: string,
  invoiceBase64: string,
  clearanceStatus = "0",
): Promise<ZatcaResponse> {
  const res = await fetch(`${baseUrl(mode)}/invoices/reporting/single`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Version": "V2",
      "accept-language": "ar",
      "Clearance-Status": clearanceStatus,
      Authorization: buildBasicAuth(csid, secret),
    },
    body: JSON.stringify({ invoiceHash, uuid, invoice: invoiceBase64 }),
  });
  const data = await parseJson(res);
  return {
    ok: res.status === 200 || res.status === 202,
    status: res.status,
    data,
    error:
      res.status === 200 || res.status === 202
        ? undefined
        : data?.message || `HTTP ${res.status}`,
  };
}

/**
 * المسح والموافقة على الفاتورة المعيارية (B2B/B2G)
 * POST /invoices/clearance/single
 * Auth: Basic (production CSID:secret)
 */
export async function clearInvoice(
  mode: ZatcaMode,
  csid: string,
  secret: string,
  invoiceHash: string,
  uuid: string,
  invoiceBase64: string,
): Promise<ZatcaResponse> {
  const res = await fetch(`${baseUrl(mode)}/invoices/clearance/single`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Version": "V2",
      "accept-language": "ar",
      "Clearance-Status": "1",
      Authorization: buildBasicAuth(csid, secret),
    },
    body: JSON.stringify({ invoiceHash, uuid, invoice: invoiceBase64 }),
  });
  const data = await parseJson(res);
  return {
    ok: res.status === 200,
    status: res.status,
    data,
    error: res.status === 200 ? undefined : data?.message || `HTTP ${res.status}`,
  };
}
