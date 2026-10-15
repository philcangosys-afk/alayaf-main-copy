/**
 * أدوات التشفير الخاصة بـ ZATCA (تعمل على الخادم فقط)
 * ملاحظة: كل ما في هذا الملف يعمل على السيرفر ولا يُرسل المفتاح الخاص للمتصفح أبداً.
 *
 * المرجع: مواصفات ZATCA للمرحلة الثانية (Fatoora)
 * - المنحنى المطلوب: secp256k1
 * - CSR يحتوي على امتداد subjectAltName بحقول خاصة بالهيئة
 */

import crypto from "crypto";
import { KEYUTIL, KJUR } from "jsrsasign";

export interface CSRInput {
  commonName: string; // اسم الشهادة / الوحدة
  serialNumber: string; // 1-<Manufacturer>|2-<Model>|3-<SerialNumber>
  organizationIdentifier: string; // رقم ضريبة القيمة المضافة (15 رقم)
  organizationUnitName: string; // اسم الفرع أو رقم التسجيل
  organizationName: string; // اسم المنشأة
  countryName: string; // SA
  invoiceType: string; // مثل 1100 (معيارية + مبسطة)
  location: string; // عنوان المنشأة
  industry: string; // نوع النشاط
}

export interface KeyPairAndCSR {
  privateKeyPem: string;
  publicKeyPem: string;
  csrPem: string;
  csrBase64: string; // CSR مُرمّز base64 كما تطلبه ZATCA
}

/**
 * توليد زوج مفاتيح EC (secp256k1) و CSR متوافق مع متطلبات ZATCA
 */
export function generateKeyPairAndCSR(input: CSRInput): KeyPairAndCSR {
  // 1) توليد زوج مفاتيح EC على منحنى secp256k1
  const keypair = KEYUTIL.generateKeypair("EC", "secp256k1");
  const privateKeyPem = KEYUTIL.getPEM(keypair.prvKeyObj, "PKCS8PRV");
  const publicKeyPem = KEYUTIL.getPEM(keypair.pubKeyObj);

  // 2) بناء نص الموضوع (Subject)
  const subjectStr =
    `/CN=${escapeDN(input.commonName)}` +
    `/OU=${escapeDN(input.organizationUnitName)}` +
    `/O=${escapeDN(input.organizationName)}` +
    `/C=${escapeDN(input.countryName)}`;

  // 3) بناء CSR مع امتداد ZATCA (subjectAltName / directoryName)
  const csrPem = KJUR.asn1.csr.CSRUtil.newCSRPEM({
    subject: { str: subjectStr },
    sbjpubkey: keypair.pubKeyObj,
    sbjprvkey: keypair.prvKeyObj,
    sigalg: "SHA256withECDSA",
    extreq: [
      {
        extname: "subjectAltName",
        array: [
          {
            dn: {
              array: [
                [{ type: "SN", value: input.serialNumber, ds: "prn" }],
                [
                  {
                    type: "UID",
                    value: input.organizationIdentifier,
                    ds: "prn",
                  },
                ],
                [{ type: "title", value: input.invoiceType, ds: "prn" }],
                // registeredAddress = OID 2.5.4.26
                [{ type: "2.5.4.26", value: input.location, ds: "prn" }],
                // businessCategory = OID 2.5.4.15
                [{ type: "2.5.4.15", value: input.industry, ds: "prn" }],
              ],
            },
          },
        ],
      },
    ],
  } as any);

  const csrBase64 = Buffer.from(csrPem, "utf-8").toString("base64");

  return { privateKeyPem, publicKeyPem, csrPem, csrBase64 };
}

/** تنظيف قيم الـ DN من المحارف الخاصة */
function escapeDN(value: string): string {
  return String(value).replace(/[,+"\\<>;/]/g, " ").trim();
}

/**
 * حساب هاش الفاتورة (SHA-256) وإرجاعه بصيغة base64 كما تطلب ZATCA
 */
export function computeInvoiceHash(invoiceXml: string): string {
  return crypto
    .createHash("sha256")
    .update(invoiceXml, "utf-8")
    .digest("base64");
}

/**
 * ترميز XML الفاتورة إلى base64 (مطلوب في جسم طلب Reporting/Clearance)
 */
export function encodeInvoiceBase64(invoiceXml: string): string {
  return Buffer.from(invoiceXml, "utf-8").toString("base64");
}

/**
 * توقيع الفاتورة بالمفتاح الخاص (ECDSA / SHA-256) — يُرجع base64
 */
export function signInvoice(invoiceXml: string, privateKeyPem: string): string {
  const sig = new KJUR.crypto.Signature({ alg: "SHA256withECDSA" });
  sig.init(privateKeyPem);
  sig.updateString(invoiceXml);
  const hexSig = sig.sign();
  return Buffer.from(hexSig, "hex").toString("base64");
}

/**
 * بناء ترويسة Basic Auth من CSID والـ Secret
 */
export function buildBasicAuth(csid: string, secret: string): string {
  const token = Buffer.from(`${csid}:${secret}`).toString("base64");
  return `Basic ${token}`;
}
