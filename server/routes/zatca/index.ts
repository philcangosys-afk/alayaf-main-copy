/**
 * مسارات ZATCA على الخادم (Express)
 * تتعامل مع: توليد CSR، الـ Onboarding، فحص التوافق، والإبلاغ.
 *
 * كل شيء هنا في وضع Sandbox افتراضياً — لا يؤثر على أي بيانات ضريبية حقيقية.
 */

import { RequestHandler } from "express";
import {
  generateKeyPairAndCSR,
  computeInvoiceHash,
  encodeInvoiceBase64,
  CSRInput,
} from "./crypto";
import {
  requestComplianceCSID,
  requestProductionCSID,
  checkComplianceInvoice,
  reportInvoice,
  clearInvoice,
  ZatcaMode,
} from "./client";

function resolveMode(body: any): ZatcaMode {
  const m = body?.mode;
  if (m === "production" || m === "simulation") return m;
  return "sandbox";
}

/**
 * POST /api/zatca/csr
 * توليد زوج مفاتيح و CSR. المفتاح الخاص يُرجَع مرة واحدة ليُحفظ بأمان.
 */
export const handleGenerateCSR: RequestHandler = (req, res) => {
  try {
    const input = req.body as Partial<CSRInput>;
    const required: (keyof CSRInput)[] = [
      "commonName",
      "serialNumber",
      "organizationIdentifier",
      "organizationUnitName",
      "organizationName",
      "countryName",
      "invoiceType",
      "location",
      "industry",
    ];
    const missing = required.filter((k) => !input[k]);
    if (missing.length) {
      return res
        .status(400)
        .json({ error: `حقول ناقصة: ${missing.join(", ")}` });
    }

    const result = generateKeyPairAndCSR(input as CSRInput);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "فشل توليد CSR",
    });
  }
};

/**
 * POST /api/zatca/onboarding/compliance
 * الحصول على Compliance CSID باستخدام CSR + OTP.
 */
export const handleComplianceCSID: RequestHandler = async (req, res) => {
  try {
    const { csrBase64, otp } = req.body || {};
    if (!csrBase64 || !otp) {
      return res.status(400).json({ error: "csrBase64 و otp مطلوبان" });
    }
    const mode = resolveMode(req.body);
    const result = await requestComplianceCSID(mode, csrBase64, otp);
    return res.status(result.ok ? 200 : result.status).json(result);
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "فشل طلب Compliance CSID",
    });
  }
};

/**
 * POST /api/zatca/onboarding/production
 * الحصول على Production CSID.
 */
export const handleProductionCSID: RequestHandler = async (req, res) => {
  try {
    const { complianceCsid, complianceSecret, complianceRequestId } =
      req.body || {};
    if (!complianceCsid || !complianceSecret || !complianceRequestId) {
      return res.status(400).json({
        error:
          "complianceCsid و complianceSecret و complianceRequestId مطلوبة",
      });
    }
    const mode = resolveMode(req.body);
    const result = await requestProductionCSID(
      mode,
      complianceCsid,
      complianceSecret,
      complianceRequestId,
    );
    return res.status(result.ok ? 200 : result.status).json(result);
  } catch (error) {
    return res.status(500).json({
      error:
        error instanceof Error ? error.message : "فشل طلب Production CSID",
    });
  }
};

/**
 * POST /api/zatca/compliance-check
 * فحص توافق فاتورة تجريبية قبل الاعتماد.
 */
export const handleComplianceCheck: RequestHandler = async (req, res) => {
  try {
    const { csid, secret, invoiceXml, uuid } = req.body || {};
    if (!csid || !secret || !invoiceXml || !uuid) {
      return res
        .status(400)
        .json({ error: "csid و secret و invoiceXml و uuid مطلوبة" });
    }
    const mode = resolveMode(req.body);
    const invoiceHash = computeInvoiceHash(invoiceXml);
    const invoiceBase64 = encodeInvoiceBase64(invoiceXml);
    const result = await checkComplianceInvoice(
      mode,
      csid,
      secret,
      invoiceHash,
      uuid,
      invoiceBase64,
    );
    return res
      .status(result.ok ? 200 : result.status)
      .json({ ...result, invoiceHash });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "فشل فحص التوافق",
    });
  }
};

/**
 * POST /api/zatca/report
 * الإبلاغ عن فاتورة مبسطة (B2C).
 */
export const handleReport: RequestHandler = async (req, res) => {
  try {
    const { csid, secret, invoiceXml, uuid } = req.body || {};
    if (!csid || !secret || !invoiceXml || !uuid) {
      return res
        .status(400)
        .json({ error: "csid و secret و invoiceXml و uuid مطلوبة" });
    }
    const mode = resolveMode(req.body);
    const invoiceHash = computeInvoiceHash(invoiceXml);
    const invoiceBase64 = encodeInvoiceBase64(invoiceXml);
    const result = await reportInvoice(
      mode,
      csid,
      secret,
      invoiceHash,
      uuid,
      invoiceBase64,
    );
    return res
      .status(result.ok ? 200 : result.status)
      .json({ ...result, invoiceHash });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "فشل الإبلاغ",
    });
  }
};

/**
 * POST /api/zatca/clear
 * المسح والموافقة على فاتورة معيارية (B2B/B2G).
 */
export const handleClear: RequestHandler = async (req, res) => {
  try {
    const { csid, secret, invoiceXml, uuid } = req.body || {};
    if (!csid || !secret || !invoiceXml || !uuid) {
      return res
        .status(400)
        .json({ error: "csid و secret و invoiceXml و uuid مطلوبة" });
    }
    const mode = resolveMode(req.body);
    const invoiceHash = computeInvoiceHash(invoiceXml);
    const invoiceBase64 = encodeInvoiceBase64(invoiceXml);
    const result = await clearInvoice(
      mode,
      csid,
      secret,
      invoiceHash,
      uuid,
      invoiceBase64,
    );
    return res
      .status(result.ok ? 200 : result.status)
      .json({ ...result, invoiceHash });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "فشل المسح",
    });
  }
};
