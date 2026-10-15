import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Buffer } from "node:buffer";
import { createHash, X509Certificate } from "node:crypto";
import { KEYUTIL, KJUR, X509 } from "npm:jsrsasign@11.1.3";
import {
  BuyerData,
  Certificate,
  InvoiceData,
  InvoiceLineData,
  InvoiceSigner,
  SellerData,
  ZatcaInvoice,
} from "npm:@khaledhajsalem/zatca-node@1.0.4";

type ZatcaMode = "simulation" | "production";

const getCorsHeaders = () => {
  const appOrigin = clean(Deno.env.get("APP_ORIGIN"));
  return {
    ...(appOrigin ? { "Access-Control-Allow-Origin": appOrigin } : {}),
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
};
const SIMULATION_URL = "https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation";
const PRODUCTION_URL = "https://gw-fatoora.zatca.gov.sa/e-invoicing/core";
const ZATCA_INITIAL_PIH =
  "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==";

const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(), "Content-Type": "application/json" },
  });

const clean = (value: unknown) => String(value ?? "").trim();
const cleanToken = (value: unknown) => String(value ?? "").replace(/\s+/g, "");

async function storeZatcaSecret(
  admin: any,
  onboardingId: string,
  kind: string,
  secret: string,
) {
  const { error } = await admin.rpc("store_zatca_secret", {
    p_onboarding_id: onboardingId,
    p_kind: kind,
    p_secret: secret,
  });
  if (error) throw error;
}

async function getZatcaCredentials(admin: any, onboardingId: string) {
  const { data, error } = await admin.rpc("get_zatca_credentials", {
    p_onboarding_id: onboardingId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    private_key_pem: clean(row?.private_key_pem),
    compliance_csid: clean(row?.compliance_csid),
    compliance_secret: clean(row?.compliance_secret),
    production_csid: clean(row?.production_csid),
    production_secret: clean(row?.production_secret),
  };
}
const escapeDn = (value: string) => value.replace(/[,+"\\<>;/]/g, " ").trim();
const escapeXmlText = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
const fullAccessRoles = new Set(["مدير النظام", "مدير عام", "المدير العام"]);
const canManageSettings = (
  roleName: string,
  permissions: Record<string, unknown>,
) =>
  fullAccessRoles.has(roleName) ||
  permissions["module.settings"] === true ||
  permissions["module.settings"] === "manage";

const publicFields = `id, mode, organization_key, branch_key, company_name_ar, company_name_en,
  vat_number, vat_effective_date, commercial_registration, branch_name, branch_location,
  building_number, street_name, district, city, postal_code, additional_number, short_address,
  industry, device_manufacturer, device_model, device_serial, common_name, invoice_type, status,
  compliance_request_id, compliance_csid_masked, compliance_issued_at, compliance_results,
  production_request_id, production_csid_masked, production_issued_at, production_status,
  production_enabled, production_confirmed_at, certificate_expires_at, certificate_revoked_at,
  last_error, created_at, updated_at`;

function parseMode(value: unknown): ZatcaMode {
  const mode = clean(value) || "simulation";
  if (mode !== "simulation" && mode !== "production") {
    throw new Error("وضع ZATCA غير صالح");
  }
  return mode;
}

// نظام الشركات: كل قراءة وكتابة بمفتاح الخادم داخل منشأة المستدعي فقط.
// الجداول هنا كلها فيها company_id؛ الإدخال يُختم برقم المنشأة، والقراءة والتعديل والحذف تُقيَّد به.
// deno-lint-ignore no-explicit-any
function companyScopedDb(admin: any, companyId: string) {
  // deno-lint-ignore no-explicit-any
  const stamp = (values: any) =>
    Array.isArray(values)
      ? values.map((value) => ({ ...value, company_id: companyId }))
      : { ...values, company_id: companyId };
  return (table: string) => {
    const base = admin.from(table);
    return {
      // deno-lint-ignore no-explicit-any
      select: (columns?: string, options?: any) => base.select(columns, options).eq("company_id", companyId),
      // deno-lint-ignore no-explicit-any
      insert: (values: any, options?: any) => base.insert(stamp(values), options),
      // deno-lint-ignore no-explicit-any
      upsert: (values: any, options?: any) => base.upsert(stamp(values), options),
      // deno-lint-ignore no-explicit-any
      update: (values: any, options?: any) => {
        const { company_id: _ignored, ...rest } = values ?? {};
        return base.update(rest, options).eq("company_id", companyId);
      },
      // deno-lint-ignore no-explicit-any
      delete: (options?: any) => base.delete(options).eq("company_id", companyId),
    };
  };
}

// منشأة المستدعي الفعالة (بجلسته هو)، مع هويتها الضريبية المعتمدة في المنصة
type CallerCompany = { id: string; code: string; vat: string; cr: string; nameAr: string; nameEn: string };
// deno-lint-ignore no-explicit-any
async function callerCompany(caller: any): Promise<CallerCompany | null> {
  const { data, error } = await caller.rpc("my_company");
  const info = (data ?? {}) as {
    status?: string;
    company?: { id?: string; code?: number | string; vat_number?: string; cr_number?: string; name_ar?: string; name_en?: string };
  };
  const id = String(info.company?.id ?? "");
  if (error || info.status !== "active" || !id) return null;
  return {
    id,
    code: String(info.company?.code ?? ""),
    vat: clean(info.company?.vat_number),
    cr: clean(info.company?.cr_number),
    nameAr: clean(info.company?.name_ar),
    nameEn: clean(info.company?.name_en),
  };
}

// البريد في ilike حرفيًا (بلا محارف بحث)
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (character) => `\\${character}`);

function validateKey(value: unknown, fallback: string, label: string) {
  const key = clean(value) || fallback;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(key)) {
    throw new Error(`${label} غير صالح`);
  }
  return key;
}

function validateDeviceSerial(value: unknown, required = true) {
  const serial = clean(value);
  if (!serial && !required) return "";
  if (!/^[A-Za-z0-9._\-\/]+$/.test(serial)) {
    throw new Error("الرقم التسلسلي للجهاز يحتوي على رموز غير صالحة");
  }
  return serial;
}

function validateStructuredAddress(body: any, required: boolean) {
  const address = {
    buildingNumber: clean(body.buildingNumber),
    streetName: clean(body.streetName),
    district: clean(body.district),
    city: clean(body.city),
    postalCode: clean(body.postalCode),
    additionalNumber: clean(body.additionalNumber),
    shortAddress: clean(body.shortAddress),
  };
  const supplied = Object.values(address).some(Boolean);
  if (!supplied && !required) return null;
  if (!/^\d{4}$/.test(address.buildingNumber))
    throw new Error("رقم المبنى يجب أن يتكون من 4 أرقام");
  if (!/^\d{5}$/.test(address.postalCode))
    throw new Error("الرمز البريدي يجب أن يتكون من 5 أرقام");
  if (!/^\d{4}$/.test(address.additionalNumber))
    throw new Error("الرقم الإضافي يجب أن يتكون من 4 أرقام");
  if (
    !address.streetName ||
    !address.district ||
    !address.city ||
    !address.shortAddress
  ) {
    throw new Error("أكمل جميع حقول العنوان الوطني المنظمة");
  }
  return address;
}

function constructBranchLocation(
  address: NonNullable<ReturnType<typeof validateStructuredAddress>>,
) {
  return `${address.buildingNumber} ${address.streetName}، ${address.district}، ${address.city}، ${address.postalCode}، ${address.additionalNumber}، ${address.shortAddress}`;
}

function sanitizeAuditDetails(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeAuditDetails);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(
        ([key]) =>
          !/secret|private.?key|binarysecuritytoken|(^|_)csid$/i.test(key),
      )
      .map(([key, nested]) => [key, sanitizeAuditDetails(nested)]),
  );
}

function generateCsr(input: {
  mode: ZatcaMode;
  commonName: string;
  branchName: string;
  companyNameAr: string;
  deviceManufacturer: string;
  deviceModel: string;
  deviceSerial: string;
  branchLocation: string;
  industry: string;
  vatNumber: string;
  invoiceType: string;
}) {
  const keypair = KEYUTIL.generateKeypair("EC", "secp256k1");
  const privateKeyPem = KEYUTIL.getPEM(keypair.prvKeyObj, "PKCS8PRV");
  const publicKeyPem = KEYUTIL.getPEM(keypair.pubKeyObj);
  const subject = `/CN=${escapeDn(input.commonName)}/OU=${escapeDn(input.branchName)}/O=${escapeDn(input.companyNameAr)}/C=SA`;
  const serialNumber = `1-${input.deviceManufacturer}|2-${input.deviceModel}|3-${input.deviceSerial}`;
  const registeredAddress = compactCsrLocation(input.branchLocation);
  const businessCategory = asciiCsrValue(input.industry, "Contracting", 64);
  const certificateTemplateName =
    input.mode === "production"
      ? "ZATCA-Code-Signing"
      : "PREZATCA-Code-Signing";
  const csrPem = KJUR.asn1.csr.CSRUtil.newCSRPEM({
    subject: { str: subject },
    sbjpubkey: keypair.pubKeyObj,
    sbjprvkey: keypair.prvKeyObj,
    sigalg: "SHA256withECDSA",
    extreq: [
      {
        extname: "1.3.6.1.4.1.311.20.2",
        extn: { prnstr: { str: certificateTemplateName } },
      },
      {
        extname: "subjectAltName",
        array: [
          {
            dn: {
              array: [
                [{ type: "SN", value: serialNumber, ds: "prn" }],
                [{ type: "UID", value: input.vatNumber, ds: "prn" }],
                [{ type: "title", value: input.invoiceType, ds: "prn" }],
                [{ type: "2.5.4.26", value: registeredAddress, ds: "prn" }],
                [{ type: "2.5.4.15", value: businessCategory, ds: "prn" }],
              ],
            },
          },
        ],
      },
    ],
  } as any);
  return {
    privateKeyPem,
    publicKeyPem,
    csrPem,
    csrBase64: Buffer.from(csrPem, "utf8").toString("base64"),
  };
}

function validateIdentity(body: any, mode: ZatcaMode) {
  const structuredAddress = validateStructuredAddress(
    body,
    mode === "production",
  );
  const identity = {
    // مفتاح المنشأة = رقمها في المنصة (يُفرض في المعالج؛ لا يُقبل من المتصفح)
    organizationKey: validateKey(
      body.organizationKey,
      "company",
      "مفتاح المنشأة",
    ),
    branchKey: validateKey(body.branchKey, "main", "مفتاح الفرع"),
    companyNameAr: clean(body.companyNameAr),
    companyNameEn: clean(body.companyNameEn),
    vatNumber: clean(body.vatNumber),
    vatEffectiveDate: clean(body.vatEffectiveDate),
    commercialRegistration: clean(body.commercialRegistration),
    branchName: clean(body.branchName),
    branchLocation: structuredAddress
      ? constructBranchLocation(structuredAddress)
      : clean(body.branchLocation),
    structuredAddress,
    industry: clean(body.industry),
    deviceManufacturer: clean(body.deviceManufacturer),
    deviceModel: clean(body.deviceModel),
    deviceSerial: validateDeviceSerial(body.deviceSerial),
    commonName: clean(body.commonName),
    invoiceType: clean(body.invoiceType || "1100"),
  };
  if (!/^\d{15}$/.test(identity.vatNumber))
    throw new Error("رقم ضريبة القيمة المضافة يجب أن يتكون من 15 رقماً");
  if (!/^\d{10,15}$/.test(identity.commercialRegistration))
    throw new Error("رقم السجل التجاري يجب أن يتكون من 10 إلى 15 رقماً");
  if (!["1000", "0100", "1100"].includes(identity.invoiceType))
    throw new Error("نوع الفواتير غير صالح");
  if (
    identity.vatEffectiveDate &&
    !/^\d{4}-\d{2}-\d{2}$/.test(identity.vatEffectiveDate)
  ) {
    throw new Error(
      "تاريخ سريان ضريبة القيمة المضافة يجب أن يكون بصيغة YYYY-MM-DD",
    );
  }
  const required = [
    "companyNameAr",
    "branchName",
    "branchLocation",
    "industry",
    "deviceManufacturer",
    "deviceModel",
    "deviceSerial",
    "commonName",
  ] as const;
  const missing = required.filter((key) => identity[key].length < 2);
  if (missing.length)
    throw new Error("أكمل جميع بيانات المنشأة والجهاز المطلوبة");
  parseRegisteredAddress(identity.branchLocation);
  return identity;
}

type ComplianceCase = {
  key: string;
  label: string;
  scope: "standard" | "simplified";
  kind: "invoice" | "credit" | "debit";
};

const complianceCases: ComplianceCase[] = [
  {
    key: "standard-invoice",
    label: "فاتورة ضريبية معيارية B2B",
    scope: "standard",
    kind: "invoice",
  },
  {
    key: "standard-credit",
    label: "إشعار دائن معياري B2B",
    scope: "standard",
    kind: "credit",
  },
  {
    key: "standard-debit",
    label: "إشعار مدين معياري B2B",
    scope: "standard",
    kind: "debit",
  },
  {
    key: "simplified-invoice",
    label: "فاتورة ضريبية مبسطة B2C",
    scope: "simplified",
    kind: "invoice",
  },
  {
    key: "simplified-credit",
    label: "إشعار دائن مبسط B2C",
    scope: "simplified",
    kind: "credit",
  },
  {
    key: "simplified-debit",
    label: "إشعار مدين مبسط B2C",
    scope: "simplified",
    kind: "debit",
  },
];

function requiredCaseIndexes(invoiceType: string) {
  return complianceCases
    .map((testCase, index) => ({ testCase, index }))
    .filter(({ testCase }) => {
      if (invoiceType === "1000") return testCase.scope === "standard";
      if (invoiceType === "0100") return testCase.scope === "simplified";
      return true;
    })
    .map(({ index }) => index);
}

function toCertificatePem(binarySecurityToken: string) {
  const compactToken = binarySecurityToken.replace(/\s+/g, "");
  const decoded = Buffer.from(compactToken, "base64").toString("utf8").trim();
  if (decoded.includes("-----BEGIN CERTIFICATE-----")) return decoded;
  const certificateBody =
    /^[A-Za-z0-9+/=\s]+$/.test(decoded) && decoded.length > 100
      ? decoded.replace(/\s+/g, "")
      : compactToken;
  return `-----BEGIN CERTIFICATE-----\n${certificateBody.match(/.{1,64}/g)?.join("\n") ?? certificateBody}\n-----END CERTIFICATE-----`;
}

function parseX509TimeToIso(value: unknown) {
  const raw = clean(value);
  const match = raw.match(
    /^(?:(\d{4})|(\d{2}))(\d{2})(\d{2})(\d{2})(\d{2})(?:(\d{2})(?:[.,](\d+))?)?(Z|[+-]\d{4})$/,
  );
  if (!match) {
    const timestamp = Date.parse(raw);
    if (!Number.isFinite(timestamp)) return null;
    return new Date(timestamp).toISOString();
  }

  const year = match[1]
    ? Number(match[1])
    : Number(match[2]) >= 50
      ? 1900 + Number(match[2])
      : 2000 + Number(match[2]);
  const month = Number(match[3]);
  const day = Number(match[4]);
  const hour = Number(match[5]);
  const minute = Number(match[6]);
  const second = Number(match[7] ?? 0);
  const millisecond = Number(`0.${match[8] ?? "0"}`) * 1000;
  const unadjusted = Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
    second,
    millisecond,
  );
  const date = new Date(unadjusted);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) {
    return null;
  }

  const timezone = match[9];
  if (timezone !== "Z") {
    const sign = timezone[0] === "+" ? 1 : -1;
    const offsetHours = Number(timezone.slice(1, 3));
    const offsetRemainderMinutes = Number(timezone.slice(3, 5));
    if (offsetHours > 23 || offsetRemainderMinutes > 59) return null;
    const offsetMinutes = offsetHours * 60 + offsetRemainderMinutes;
    return new Date(unadjusted - sign * offsetMinutes * 60_000).toISOString();
  }
  return date.toISOString();
}

function getCertificateExpiryIso(binarySecurityToken: string) {
  const compactToken = cleanToken(binarySecurityToken);
  const decoded = Buffer.from(compactToken, "base64");
  const decodedText = decoded.toString("utf8").trim();
  const candidates: Array<string | Buffer> = [decoded];

  if (decodedText.includes("-----BEGIN CERTIFICATE-----")) {
    candidates.unshift(decodedText);
  } else if (
    decodedText.length > 100 &&
    /^[A-Za-z0-9+/=\s]+$/.test(decodedText)
  ) {
    candidates.push(Buffer.from(decodedText.replace(/\s+/g, ""), "base64"));
  }
  candidates.push(toCertificatePem(binarySecurityToken));

  for (const candidate of candidates) {
    try {
      const certificate = new X509Certificate(candidate);
      const timestamp = Date.parse(certificate.validTo);
      if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString();
    } catch {
      // Try the next supported ZATCA certificate representation.
    }
  }

  const fallbackCertificate = new X509();
  fallbackCertificate.readCertPEM(toCertificatePem(binarySecurityToken));
  return parseX509TimeToIso(fallbackCertificate.getNotAfter());
}

function parseRegisteredAddress(location: string) {
  const normalized = location.replace(/\s+/g, " ").trim();
  const buildingNumber = normalized.match(/\b\d{4}\b/)?.[0];
  const postalZone = normalized.match(/\b\d{5}\b/)?.[0];
  if (!buildingNumber || !postalZone) {
    throw new Error(
      "عنوان الفرع يجب أن يتضمن رقم المبنى من 4 أرقام والرمز البريدي من 5 أرقام",
    );
  }
  const parts = normalized
    .split(/[،,]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const cityName =
    parts.find((part) =>
      /مكة|جدة|الرياض|المدينة|الدمام|الخبر|الطائف/.test(part),
    ) ?? (parts.length >= 3 && !/^\d+$/.test(parts[2]) ? parts[2] : "");
  if (!cityName) {
    throw new Error("عنوان الفرع يجب أن يتضمن اسم المدينة المسجلة");
  }
  const citySubdivisionName =
    parts.find((part) => /حي|الشوقية|العزيزية|الروضة|النسيم/.test(part)) ??
    parts[1] ??
    "الفرع الرئيسي";
  const streetName = (parts[0] ?? normalized)
    .replace(new RegExp(`^${buildingNumber}\\s*`), "")
    .trim();
  return {
    buildingNumber,
    postalZone,
    cityName,
    citySubdivisionName,
    streetName: streetName || "العنوان الوطني",
  };
}

function asciiCsrValue(value: string, fallback: string, maxLength: number) {
  const ascii = value
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/[^A-Za-z0-9 .\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (ascii || fallback).slice(0, maxLength).trim();
}

function compactCsrLocation(location: string) {
  const address = parseRegisteredAddress(location);
  return asciiCsrValue(
    `${address.buildingNumber} ${address.postalZone} SA`,
    "0000 00000 SA",
    64,
  );
}

function createCompatibleCertificate(
  certificatePem: string,
  privateKeyPem: string,
  secret: string,
) {
  const x509 = new X509();
  x509.readCertPEM(certificatePem);
  const certificateBody = certificatePem.replace(
    /-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s+/g,
    "",
  );
  const issuer = x509
    .getIssuerString()
    .split("/")
    .filter(Boolean)
    .reverse()
    .join(", ");
  const serialNumber = BigInt(`0x${x509.getSerialNumberHex()}`).toString(10);

  return {
    getRawCertificate: () => certificatePem,
    getSecretKey: () => secret,
    getCertHash: () =>
      Buffer.from(
        createHash("sha256").update(certificateBody).digest("hex"),
        "utf8",
      ).toString("base64"),
    getFormattedIssuer: () => issuer,
    getSerialNumber: () => serialNumber,
    getRawPublicKey: () =>
      Buffer.from(x509.getPublicKeyHex(), "hex").toString("base64"),
    getCertSignature: () => Buffer.from(x509.getSignatureValueHex(), "hex"),
    sign: (data: Buffer) => {
      const signature = new KJUR.crypto.Signature({ alg: "SHA256withECDSA" });
      signature.init(privateKeyPem);
      signature.updateHex(data.toString("hex"));
      return Buffer.from(signature.sign(), "hex");
    },
  } as unknown as Certificate;
}

function correctXadesDigests(xml: string, certificate: Certificate) {
  const signingTime = xml.match(
    /<xades:SigningTime>([^<]+)<\/xades:SigningTime>/,
  )?.[1];
  if (!signingTime) throw new Error("تعذر التحقق من وقت توقيع XAdES");

  const signedPropertiesXml =
    '<xades:SignedProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Id="xadesSignedProperties">\n' +
    "                                <xades:SignedSignatureProperties>\n" +
    `                                    <xades:SigningTime>${signingTime}</xades:SigningTime>\n` +
    "                                    <xades:SigningCertificate>\n" +
    "                                        <xades:Cert>\n" +
    "                                            <xades:CertDigest>\n" +
    '                                                <ds:DigestMethod xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>\n' +
    `                                                <ds:DigestValue xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${certificate.getCertHash()}</ds:DigestValue>\n` +
    "                                            </xades:CertDigest>\n" +
    "                                            <xades:IssuerSerial>\n" +
    `                                                <ds:X509IssuerName xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${certificate.getFormattedIssuer()}</ds:X509IssuerName>\n` +
    `                                                <ds:X509SerialNumber xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${certificate.getSerialNumber()}</ds:X509SerialNumber>\n` +
    "                                            </xades:IssuerSerial>\n" +
    "                                        </xades:Cert>\n" +
    "                                    </xades:SigningCertificate>\n" +
    "                                </xades:SignedSignatureProperties>\n" +
    "                            </xades:SignedProperties>";
  const digest = Buffer.from(
    createHash("sha256").update(signedPropertiesXml, "utf8").digest("hex"),
    "utf8",
  ).toString("base64");

  const correctedType = xml.replace(
    'Type="http://www.w3.org/2000/09/xmldsig#SignatureProperties" URI="#xadesSignedProperties"',
    'Type="http://uri.etsi.org/01903#SignedProperties" URI="#xadesSignedProperties"',
  );
  return correctedType.replace(
    /(<ds:Reference Type="http:\/\/uri\.etsi\.org\/01903#SignedProperties" URI="#xadesSignedProperties">[\s\S]*?<ds:DigestValue>)[^<]*(<\/ds:DigestValue>)/,
    `$1${digest}$2`,
  );
}

function buildComplianceDocument(
  setup: any,
  testCase: ComplianceCase,
  caseIndex: number,
  previousHash: string,
) {
  const address = parseRegisteredAddress(String(setup.branch_location));
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
  const issueDate = now.slice(0, 10);
  const issueTime = now.slice(11, 19);
  const invoiceNumber = `${setup.mode === "production" ? "PROD" : "SIM"}-${String(caseIndex + 1).padStart(2, "0")}-${Date.now()}`;
  const invoice = new InvoiceData()
    .setInvoiceNumber(invoiceNumber)
    .setIssueDate(issueDate)
    .setIssueTime(issueTime)
    .setDueDate(issueDate)
    .setCurrencyCode("SAR")
    .setDocumentCurrencyCode("SAR")
    .setTaxCurrencyCode("SAR")
    .setInvoiceCounter(String(caseIndex + 1))
    .setPreviousInvoiceHash(previousHash);

  if (testCase.scope === "standard") invoice.standard();
  else invoice.simplified();
  if (testCase.kind === "invoice") invoice.taxInvoice();
  else if (testCase.kind === "credit") invoice.creditNote();
  else invoice.debitNote();

  const seller = new SellerData()
    .setRegistrationName(escapeXmlText(setup.company_name_ar))
    .setVatNumber(String(setup.vat_number))
    .setPartyIdentification(String(setup.commercial_registration))
    .setPartyIdentificationId("CRN")
    .setStreetName(escapeXmlText(address.streetName))
    .setBuildingNumber(address.buildingNumber)
    .setCitySubdivisionName(escapeXmlText(address.citySubdivisionName))
    .setCityName(escapeXmlText(address.cityName))
    .setPostalZone(address.postalZone)
    .setCountryCode("SA");

  const buyer = new BuyerData()
    .setRegistrationName(
      testCase.scope === "standard" ? "شركة المشتري التجريبية" : "عميل نقدي",
    )
    .setStreetName("شارع الملك فهد")
    .setBuildingNumber("1234")
    .setCitySubdivisionName("حي العليا")
    .setCityName("الرياض")
    .setPostalZone("12345")
    .setCountryCode("SA");
  if (testCase.scope === "standard") {
    buyer
      .setPartyIdentification("1010000000")
      .setPartyIdentificationId("CRN")
      .setVatNumber("310000000000003");
  }

  const line = new InvoiceLineData()
    .setId(1)
    .setItemName(
      testCase.kind === "invoice"
        ? "خدمة اختبار التوافق"
        : testCase.kind === "credit"
          ? "تعديل دائن تجريبي"
          : "تعديل مدين تجريبي",
    )
    .setDescription("مستند محاكاة مخصص لفحص التوافق لدى ZATCA")
    .setQuantity(1)
    .setUnitPrice(100)
    .setTaxPercent(15)
    .setUnitCode("EA")
    .calculateTotals();

  invoice.setSeller(seller).setBuyer(buyer).addLine(line);
  if (testCase.kind !== "invoice") {
    invoice.addBillingReference({
      id: `SIM-ORIGINAL-${caseIndex + 1}`,
      uuid: crypto.randomUUID(),
    });
    invoice.addPaymentMeans({
      code: "10",
      instruction_note:
        testCase.kind === "credit"
          ? "إلغاء جزء من التوريد"
          : "زيادة قيمة التوريد",
    });
  }
  invoice.calculateTotals();

  const uuid = crypto.randomUUID();
  const unsignedXml = new ZatcaInvoice().generateXml(invoice, uuid);
  const certificate = createCompatibleCertificate(
    toCertificatePem(String(setup.compliance_csid)),
    String(setup.private_key_pem),
    String(setup.compliance_secret),
  );
  const signer = InvoiceSigner.signInvoice(unsignedXml, certificate);
  return {
    uuid,
    invoiceNumber,
    signedXml: correctXadesDigests(signer.getXML(), certificate),
    invoiceHash: signer.getHash(),
  };
}

function getValidationSummary(responseData: any) {
  const validation = responseData?.validationResults ?? {};
  const errors = Array.isArray(validation.errorMessages)
    ? validation.errorMessages
    : [];
  const warnings = Array.isArray(validation.warningMessages)
    ? validation.warningMessages
    : [];
  const status = clean(validation.status).toUpperCase();
  const passed = errors.length === 0 && ["PASS", "WARNING"].includes(status);
  return {
    passed,
    status: status || "ERROR",
    message:
      errors[0]?.message ??
      warnings[0]?.message ??
      (passed ? "اجتاز فحص ZATCA" : "لم يجتز فحص ZATCA"),
    validationResults: validation,
  };
}

Deno.serve(async (req) => {
  const appOrigin = clean(Deno.env.get("APP_ORIGIN"));
  const requestOrigin = clean(req.headers.get("Origin"));
  if (appOrigin && requestOrigin && requestOrigin !== appOrigin) {
    return respond({ error: "Origin not allowed" }, 403);
  }
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: getCorsHeaders() });
  if (req.method !== "POST")
    return respond({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer "))
    return respond({ error: "Unauthorized" }, 401);

  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(supabaseUrl, serviceKey);
  const token = authHeader.slice(7);
  const {
    data: { user },
    error: authError,
  } = await caller.auth.getUser(token);
  if (authError || !user?.email) return respond({ error: "Unauthorized" }, 401);

  const company = await callerCompany(caller);
  if (!company) return respond({ error: "حسابك غير مرتبط بمنشأة فعالة" }, 403);
  const db = companyScopedDb(admin, company.id);

  const { data: callerEmployee } = await db("employees")
    .select("employee_role")
    .ilike("email", escapeLike(user.email))
    .maybeSingle();
  if (!callerEmployee?.employee_role)
    return respond({ error: "غير مصرح بإدارة إعدادات ZATCA" }, 403);
  const { data: callerRole } = await db("user_roles")
    .select("permissions")
    .eq("name_ar", callerEmployee.employee_role)
    .eq("status", "فعال")
    .maybeSingle();
  const permissions =
    callerRole?.permissions && typeof callerRole.permissions === "object"
      ? (callerRole.permissions as Record<string, unknown>)
      : {};
  if (!canManageSettings(callerEmployee.employee_role, permissions))
    return respond({ error: "غير مصرح بإدارة إعدادات ZATCA" }, 403);

  let body: any = {};
  try {
    body = await req.json();
    const action = clean(body.action);
    const mode = parseMode(body.mode);
    const baseUrl = mode === "production" ? PRODUCTION_URL : SIMULATION_URL;
    // كل منشأة لها مفتاحها: رقمها في المنصة
    const organizationKey = validateKey(company.code, "company", "مفتاح المنشأة");
    const branchKey = validateKey(body.branchKey, "main", "مفتاح الفرع");
    const requestedDeviceSerial = validateDeviceSerial(
      body.deviceSerial,
      false,
    );
    if (
      mode === "production" &&
      action !== "prepare" &&
      !requestedDeviceSerial
    ) {
      return respond(
        { error: "يجب تحديد الرقم التسلسلي لجهاز بيئة الإنتاج" },
        400,
      );
    }

    let existingSetup: any = null;
    if (action === "status") {
      const { data: latestOwnedSetups, error: latestOwnedError } = await db("zatca_onboarding_settings")
        .select("id, created_by, status, compliance_issued_at, device_serial")
        .eq("mode", mode)
        .eq("organization_key", organizationKey)
        .eq("branch_key", branchKey)
        .eq("created_by", user.id)
        .order("production_issued_at", {
          ascending: false,
          nullsFirst: false,
        })
        .order("updated_at", { ascending: false })
        .limit(1);
      if (latestOwnedError) throw latestOwnedError;
      existingSetup = latestOwnedSetups?.[0] ?? null;
    } else {
      let setupQuery = db("zatca_onboarding_settings")
        .select("id, created_by, status, compliance_issued_at, device_serial")
        .eq("mode", mode)
        .eq("organization_key", organizationKey)
        .eq("branch_key", branchKey);
      if (requestedDeviceSerial) {
        setupQuery = setupQuery.eq("device_serial", requestedDeviceSerial);
      }
      const { data: matchingSetups, error: ownerError } = await setupQuery
        .order("updated_at", { ascending: false })
        .limit(1);
      if (ownerError) throw ownerError;
      existingSetup = matchingSetups?.[0] ?? null;
    }
    if (existingSetup && existingSetup.created_by !== user.id) {
      return respond({ error: "هذه التهيئة مرتبطة بحساب إداري آخر" }, 403);
    }

    if (action === "status") {
      const { data, error } = existingSetup
        ? await db("zatca_onboarding_settings")
            .select(publicFields)
            .eq("id", existingSetup.id)
            .maybeSingle()
        : { data: null, error: null };
      if (error) throw error;
      const { data: audit } = data
        ? await db("zatca_onboarding_audit")
            .select("id, action, result, http_status, details, created_at")
            .eq("onboarding_id", data.id)
            .order("created_at", { ascending: false })
            .limit(20)
        : { data: [] };
      return respond({
        setup: data,
        audit: (audit ?? []).map((entry: any) => ({
          ...entry,
          details: sanitizeAuditDetails(entry.details),
        })),
      });
    }

    if (action === "reset_onboarding" || action === "reset") {
      if (!existingSetup) {
        return respond({ message: "لا توجد تهيئة لإعادة تشغيلها" });
      }
      const { error } = await db("zatca_onboarding_settings")
        .delete()
        .eq("id", existingSetup.id)
        .eq("created_by", user.id);
      if (error) throw error;
      return respond({
        message:
          "تم حذف اعتماد ZATCA السابق. جهّز الجهاز من جديد باستخدام OTP جديد.",
      });
    }

    if (action === "prepare") {
      if (
        existingSetup &&
        (Boolean(existingSetup.compliance_issued_at) ||
          [
            "compliance_ready",
            "compliance_testing",
            "compliance_passed",
          ].includes(existingSetup.status))
      ) {
        return respond(
          {
            error:
              "لا يمكن إعادة توليد المفاتيح بعد إصدار شهادة التوافق لأنها ستفقد صلاحيتها",
          },
          409,
        );
      }
      const identity = validateIdentity(body, mode);
      identity.organizationKey = organizationKey;
      // الهوية الضريبية هي المعتمدة للمنشأة في المنصة؛ لا تُقبل هوية منشأة أخرى من المتصفح
      if (!company.vat || identity.vatNumber !== company.vat) {
        return respond({
          error: company.vat
            ? "الرقم الضريبي لا يطابق الرقم المسجّل للمنشأة في المنصة"
            : "الرقم الضريبي للمنشأة غير مسجّل في المنصة؛ اطلب إضافته من إدارة المنصة",
        }, 409);
      }
      if (!company.cr || identity.commercialRegistration !== company.cr) {
        return respond({
          error: company.cr
            ? "السجل التجاري لا يطابق السجل المسجّل للمنشأة في المنصة"
            : "السجل التجاري للمنشأة غير مسجّل في المنصة؛ اطلب إضافته من إدارة المنصة",
        }, 409);
      }
      if (identity.companyNameAr !== company.nameAr) {
        return respond({ error: "اسم المنشأة لا يطابق الاسم المسجّل في المنصة" }, 409);
      }
      const csr = generateCsr({ ...identity, mode });
      const payload = {
        mode,
        organization_key: identity.organizationKey,
        branch_key: identity.branchKey,
        created_by: user.id,
        company_name_ar: identity.companyNameAr,
        company_name_en: identity.companyNameEn || null,
        vat_number: identity.vatNumber,
        vat_effective_date: identity.vatEffectiveDate || null,
        commercial_registration: identity.commercialRegistration,
        branch_name: identity.branchName,
        branch_location: identity.branchLocation,
        building_number: identity.structuredAddress?.buildingNumber ?? null,
        street_name: identity.structuredAddress?.streetName ?? null,
        district: identity.structuredAddress?.district ?? null,
        city: identity.structuredAddress?.city ?? null,
        postal_code: identity.structuredAddress?.postalCode ?? null,
        additional_number: identity.structuredAddress?.additionalNumber ?? null,
        short_address: identity.structuredAddress?.shortAddress ?? null,
        industry: identity.industry,
        device_manufacturer: identity.deviceManufacturer,
        device_model: identity.deviceModel,
        device_serial: identity.deviceSerial,
        common_name: identity.commonName,
        invoice_type: identity.invoiceType,
        csr_pem: csr.csrPem,
        public_key_pem: csr.publicKeyPem,
        private_key_pem: null,
        status: "csr_generated",
        compliance_request_id: null,
        compliance_csid: null,
        compliance_secret: null,
        compliance_csid_masked: null,
        compliance_issued_at: null,
        compliance_results: [],
        production_request_id: null,
        production_csid: null,
        production_secret: null,
        production_csid_masked: null,
        production_issued_at: null,
        production_status: "not_requested",
        production_enabled: false,
        production_confirmed_by: null,
        production_confirmed_at: null,
        last_error: null,
        updated_at: new Date().toISOString(),
      };
      const saveQuery = existingSetup
        ? db("zatca_onboarding_settings")
            .update(payload)
            .eq("id", existingSetup.id)
            .eq("created_by", user.id)
        : db("zatca_onboarding_settings").insert(payload);
      const { data, error } = await saveQuery.select("id").single();
      if (error) throw error;
      await storeZatcaSecret(admin, data.id, "private_key", csr.privateKeyPem);
      await db("zatca_onboarding_audit").insert({
        onboarding_id: data.id,
        actor_id: user.id,
        action: "csr_generated",
        result: "success",
        details: { mode, deviceSerial: identity.deviceSerial },
      });
      return respond({
        setup: { id: data.id, status: "csr_generated" },
        message: "تم حفظ البيانات وتوليد CSR داخل الخادم",
      });
    }

    if (action === "update_branch_location" || action === "update_address") {
      if (!existingSetup?.compliance_issued_at) {
        return respond({ error: "يجب تجهيز الجهاز أولاً" }, 400);
      }
      const structuredAddress = validateStructuredAddress(
        body,
        mode === "production",
      );
      const branchLocation = structuredAddress
        ? constructBranchLocation(structuredAddress)
        : clean(body.branchLocation);
      parseRegisteredAddress(branchLocation);
      const { error } = await db("zatca_onboarding_settings")
        .update({
          branch_location: branchLocation,
          ...(structuredAddress
            ? {
                building_number: structuredAddress.buildingNumber,
                street_name: structuredAddress.streetName,
                district: structuredAddress.district,
                city: structuredAddress.city,
                postal_code: structuredAddress.postalCode,
                additional_number: structuredAddress.additionalNumber,
                short_address: structuredAddress.shortAddress,
              }
            : {}),
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingSetup.id)
        .eq("created_by", user.id);
      if (error) throw error;
      await db("zatca_onboarding_audit").insert({
        onboarding_id: existingSetup.id,
        actor_id: user.id,
        action: "branch_location_updated",
        result: "success",
        details: { mode, deviceSerial: existingSetup.device_serial },
      });
      return respond({ message: "تم حفظ عنوان الفواتير المسجل" });
    }

    if (action === "onboard") {
      const otp = clean(body.otp);
      if (!/^\d{6}$/.test(otp))
        return respond({ error: "رمز OTP يجب أن يتكون من 6 أرقام" }, 400);
      const { data: setup, error: setupError } = existingSetup
        ? await db("zatca_onboarding_settings")
            .select("*")
            .eq("id", existingSetup.id)
            .maybeSingle()
        : { data: null, error: null };
      if (setupError) throw setupError;
      if (!setup?.csr_pem)
        return respond(
          { error: "يجب تجهيز بيانات المنشأة وتوليد CSR أولاً" },
          400,
        );
      if (setup.compliance_csid_masked || setup.compliance_issued_at) {
        return respond(
          { error: "تم إصدار شهادة التوافق لهذا الجهاز مسبقاً" },
          409,
        );
      }
      // الشهادة تصدر بالهوية المعتمدة حاليًا في المنصة فقط
      if (
        !company.vat ||
        clean(setup.vat_number) !== company.vat ||
        clean(setup.commercial_registration) !== company.cr ||
        clean(setup.company_name_ar) !== company.nameAr
      ) {
        return respond(
          { error: "بيانات المنشأة في المنصة تغيّرت بعد التجهيز؛ أعد خطوة تجهيز البيانات" },
          409,
        );
      }

      const csr = generateCsr({
        mode,
        companyNameAr: clean(setup.company_name_ar),
        vatNumber: clean(setup.vat_number),
        branchName: clean(setup.branch_name),
        branchLocation: clean(setup.branch_location),
        industry: clean(setup.industry),
        deviceManufacturer: clean(setup.device_manufacturer),
        deviceModel: clean(setup.device_model),
        deviceSerial: clean(setup.device_serial),
        commonName: clean(setup.common_name),
        invoiceType: clean(setup.invoice_type),
      });
      const { error: csrUpdateError } = await db("zatca_onboarding_settings")
        .update({
          csr_pem: csr.csrPem,
          public_key_pem: csr.publicKeyPem,
          private_key_pem: null,
          status: "csr_generated",
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", setup.id);
      if (csrUpdateError) throw csrUpdateError;
      await storeZatcaSecret(admin, setup.id, "private_key", csr.privateKeyPem);

      const csrBase64 = csr.csrBase64;
      const zatcaResponse = await fetch(`${baseUrl}/compliance`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Accept-Version": "V2",
          OTP: otp,
        },
        body: JSON.stringify({ csr: csrBase64 }),
      });
      const responseData = await zatcaResponse.json().catch(() => ({}));
      const requestId = clean(responseData.requestID ?? responseData.requestId);
      const csid = clean(responseData.binarySecurityToken);
      const secret = clean(responseData.secret);
      const ok = zatcaResponse.ok && Boolean(requestId && csid && secret);
      const validationErrors =
        responseData?.validationResults?.errorMessages ?? responseData?.errors;
      const firstValidationError = Array.isArray(validationErrors)
        ? validationErrors[0]
        : validationErrors;
      const safeDetails = {
        requestId: requestId || null,
        dispositionMessage: responseData.dispositionMessage ?? null,
        errorCode: firstValidationError?.code ?? responseData?.code ?? null,
        errorMessage: firstValidationError?.message ?? null,
      };

      if (!ok) {
        const message = clean(
          firstValidationError?.message ||
            responseData.message ||
            responseData.error ||
            responseData.dispositionMessage ||
            `ZATCA HTTP ${zatcaResponse.status}`,
        );
        await db("zatca_onboarding_settings")
          .update({
            status: "failed",
            last_error: message,
            updated_at: new Date().toISOString(),
          })
          .eq("id", setup.id);
        await db("zatca_onboarding_audit").insert({
          onboarding_id: setup.id,
          actor_id: user.id,
          action: "compliance_csid_requested",
          result: "failed",
          http_status: zatcaResponse.status,
          details: safeDetails,
        });
        return respond(
          { error: message, details: safeDetails },
          zatcaResponse.status >= 400 ? zatcaResponse.status : 502,
        );
      }

      const masked = `${csid.slice(0, 8)}••••${csid.slice(-6)}`;
      const issuedAt = new Date().toISOString();
      const { error: updateError } = await admin.rpc(
        "store_zatca_compliance_credentials",
        {
          p_onboarding_id: setup.id,
          p_request_id: requestId,
          p_csid: csid,
          p_secret: secret,
          p_csid_masked: masked,
          p_issued_at: issuedAt,
        },
      );
      if (updateError) throw updateError;
      await db("zatca_onboarding_audit").insert({
        onboarding_id: setup.id,
        actor_id: user.id,
        action: "compliance_csid_requested",
        result: "success",
        http_status: zatcaResponse.status,
        details: safeDetails,
      });
      return respond({
        setup: {
          id: setup.id,
          status: "compliance_ready",
          complianceRequestId: requestId,
          complianceCsidMasked: masked,
        },
        message:
          mode === "production"
            ? "تم الحصول على Compliance CSID من منصة الإنتاج"
            : "تم الحصول على Compliance CSID من منصة المحاكاة",
      });
    }

    if (action === "request_production_csid") {
      const { data: setup, error: setupError } = existingSetup
        ? await db("zatca_onboarding_settings")
            .select(
              "id, mode, invoice_type, status, compliance_request_id, compliance_results, compliance_csid_masked, production_csid_masked, certificate_expires_at",
            )
            .eq("id", existingSetup.id)
            .maybeSingle()
        : { data: null, error: null };
      if (setupError) throw setupError;
      if (!setup?.compliance_csid_masked) {
        return respond({ error: "يجب الحصول على Compliance CSID أولاً" }, 400);
      }
      const credentials = await getZatcaCredentials(admin, setup.id);
      if (!credentials.compliance_csid || !credentials.compliance_secret) {
        return respond(
          { error: "بيانات اعتماد التوافق غير موجودة في Vault" },
          409,
        );
      }
      const requiredIndexes = requiredCaseIndexes(String(setup.invoice_type));
      const complianceResults = Array.isArray(setup.compliance_results)
        ? setup.compliance_results
        : [];
      const allRequiredPassed = requiredIndexes.every((caseIndex) =>
        complianceResults.some(
          (item: any) =>
            Number(item.caseIndex) === caseIndex && item.status === "passed",
        ),
      );
      if (setup.status !== "compliance_passed" || !allRequiredPassed) {
        return respond(
          { error: "أكمل جميع اختبارات التوافق المطلوبة أولاً" },
          409,
        );
      }
      if (setup.production_csid_masked) {
        if (!setup.certificate_expires_at) {
          return respond(
            {
              error:
                "تم حفظ Production CSID سابقاً، لكن تاريخ انتهاء الشهادة يحتاج مراجعة. لن يعاد طلب الشهادة حتى لا تُفقد بيانات الاعتماد.",
            },
            409,
          );
        }
        return respond({
          status: "production_ready",
          message:
            mode === "production"
              ? "تم إصدار Production CSID الحقيقي مسبقاً"
              : "تم إصدار Production CSID التجريبي مسبقاً",
        });
      }
      const complianceCsid = credentials.compliance_csid;
      const complianceSecret = credentials.compliance_secret;
      const productionResponse = await fetch(`${baseUrl}/production/csids`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Accept-Version": "V2",
          "Accept-Language": "en",
          Authorization: `Basic ${Buffer.from(`${complianceCsid}:${complianceSecret}`, "utf8").toString("base64")}`,
        },
        body: JSON.stringify({
          compliance_request_id: clean(setup.compliance_request_id),
        }),
        signal: AbortSignal.timeout(35_000),
      });
      const responseText = await productionResponse.text();
      let responseData: any = {};
      try {
        responseData = responseText ? JSON.parse(responseText) : {};
      } catch {
        responseData = {};
      }
      const productionRequestId = clean(
        responseData.requestID ?? responseData.requestId,
      );
      const productionCsid = cleanToken(responseData.binarySecurityToken);
      const productionSecret = cleanToken(responseData.secret);
      const ok =
        productionResponse.ok &&
        Boolean(productionRequestId && productionCsid && productionSecret);
      if (!ok) {
        const productionErrors =
          responseData?.validationResults?.errorMessages ??
          responseData?.errors;
        const firstProductionError = Array.isArray(productionErrors)
          ? productionErrors[0]
          : productionErrors;
        const firstProductionErrorMessage =
          typeof firstProductionError === "string"
            ? firstProductionError
            : firstProductionError?.message;
        const message = clean(
          firstProductionErrorMessage ??
            responseData.message ??
            responseData.error ??
            responseData.dispositionMessage ??
            `ZATCA HTTP ${productionResponse.status}`,
        );
        await db("zatca_onboarding_settings")
          .update({
            production_status: "failed",
            last_error: message,
            updated_at: new Date().toISOString(),
          })
          .eq("id", setup.id);
        await db("zatca_onboarding_audit").insert({
          onboarding_id: setup.id,
          actor_id: user.id,
          action: "production_csid_requested",
          result: "failed",
          http_status: productionResponse.status,
          details: {
            endpoint: `${baseUrl}/production/csids`,
            requestId: clean(setup.compliance_request_id) || null,
            message,
            code:
              (typeof firstProductionError === "object"
                ? firstProductionError?.code
                : null) ??
              responseData.code ??
              null,
            response: sanitizeAuditDetails(responseData),
          },
        });
        return respond(
          {
            error: message,
            details: {
              status: productionResponse.status,
              endpoint: `${baseUrl}/production/csids`,
              requestId: clean(setup.compliance_request_id) || null,
              response: sanitizeAuditDetails(responseData),
            },
          },
          productionResponse.status >= 400 ? productionResponse.status : 502,
        );
      }
      const issuedAt = new Date().toISOString();
      const masked = `${productionCsid.slice(0, 8)}••••${productionCsid.slice(-6)}`;
      let certificateExpiresAt: string | null = null;
      try {
        certificateExpiresAt = getCertificateExpiryIso(productionCsid);
      } catch {
        certificateExpiresAt = null;
      }
      const { error: updateError } = await admin.rpc(
        "store_zatca_production_credentials",
        {
          p_onboarding_id: setup.id,
          p_request_id: productionRequestId,
          p_csid: productionCsid,
          p_secret: productionSecret,
          p_csid_masked: masked,
          p_issued_at: issuedAt,
          p_certificate_expires_at: certificateExpiresAt,
        },
      );
      if (updateError) throw updateError;
      if (!certificateExpiresAt) {
        const message =
          "تم حفظ Production CSID داخل Vault، لكن تعذر قراءة تاريخ انتهاء الشهادة. بقي الإنتاج معطلاً للمراجعة ولن تعاد مطالبة ZATCA بالشهادة.";
        await db("zatca_onboarding_settings")
          .update({
            production_enabled: false,
            production_confirmed_by: null,
            production_confirmed_at: null,
            last_error: message,
            updated_at: issuedAt,
          })
          .eq("id", setup.id);
        await db("zatca_onboarding_audit").insert({
          onboarding_id: setup.id,
          actor_id: user.id,
          action: "production_csid_requested",
          result: "failed",
          http_status: productionResponse.status,
          details: {
            requestId: productionRequestId,
            csidMasked: masked,
            reason: "certificate_expiry_parse_failed_credentials_preserved",
            message,
          },
        });
        return respond({ error: message }, 502);
      }
      await db("zatca_onboarding_audit").insert({
        onboarding_id: setup.id,
        actor_id: user.id,
        action: "production_csid_requested",
        result: "success",
        http_status: productionResponse.status,
        details: {
          requestId: productionRequestId,
          csidMasked: masked,
          certificateExpiresAt,
        },
      });
      return respond({
        status: "production_ready",
        productionRequestId,
        productionCsidMasked: masked,
        certificateExpiresAt,
        message:
          mode === "production"
            ? "تم إصدار Production CSID الحقيقي من منصة الإنتاج"
            : "تم إصدار Production CSID التجريبي من منصة المحاكاة",
      });
    }

    if (
      action === "activate_production" ||
      action === "deactivate_production"
    ) {
      if (mode !== "production") {
        return respond({ error: "هذا الإجراء متاح لوضع الإنتاج فقط" }, 400);
      }
      if (!existingSetup) {
        return respond({ error: "لا توجد تهيئة إنتاج للجهاز المحدد" }, 404);
      }
      const { data: setup, error: setupError } = await db("zatca_onboarding_settings")
        .select(
          "id, invoice_type, status, compliance_results, production_csid_masked, production_enabled, certificate_expires_at, certificate_revoked_at",
        )
        .eq("id", existingSetup.id)
        .maybeSingle();
      if (setupError) throw setupError;
      if (!setup) return respond({ error: "لا توجد تهيئة إنتاج" }, 404);

      if (action === "activate_production") {
        const confirmation = clean(
          body.confirmation ?? body.confirmationPhrase,
        );
        if (confirmation !== "ENABLE_REAL_ZATCA_PRODUCTION") {
          return respond({ error: "عبارة تأكيد تفعيل الإنتاج غير صحيحة" }, 400);
        }
        const certificateExpiresAt = Date.parse(
          clean(setup.certificate_expires_at),
        );
        if (
          !setup.certificate_expires_at ||
          !Number.isFinite(certificateExpiresAt)
        ) {
          return respond(
            {
              error:
                "لا يمكن تفعيل الإنتاج بدون تاريخ انتهاء صالح لشهادة Production CSID. أعد إصدار الشهادة أولاً.",
            },
            409,
          );
        }
        if (setup.certificate_revoked_at) {
          return respond(
            { error: "شهادة Production CSID ملغاة ولا يمكن تفعيل الإنتاج" },
            409,
          );
        }
        if (certificateExpiresAt <= Date.now()) {
          return respond(
            {
              error:
                "انتهت صلاحية شهادة Production CSID. أعد إصدار الشهادة أولاً.",
            },
            409,
          );
        }
        const credentials = await getZatcaCredentials(admin, setup.id);
        const requiredIndexes = requiredCaseIndexes(String(setup.invoice_type));
        const results = Array.isArray(setup.compliance_results)
          ? setup.compliance_results
          : [];
        const allRequiredPassed = requiredIndexes.every((caseIndex) =>
          results.some(
            (item: any) =>
              Number(item.caseIndex) === caseIndex && item.status === "passed",
          ),
        );
        if (
          !setup.production_csid_masked ||
          !credentials.production_csid ||
          !credentials.production_secret ||
          setup.status !== "compliance_passed" ||
          !allRequiredPassed
        ) {
          return respond(
            {
              error:
                "يتطلب التفعيل اعتماد Production CSID واجتياز جميع اختبارات التوافق المطلوبة",
            },
            409,
          );
        }
        const confirmedAt = new Date().toISOString();
        const { error: updateError } = await db("zatca_onboarding_settings")
          .update({
            production_enabled: true,
            production_confirmed_by: user.id,
            production_confirmed_at: confirmedAt,
            last_error: null,
            updated_at: confirmedAt,
          })
          .eq("id", setup.id)
          .eq("mode", "production");
        if (updateError) throw updateError;
        await db("zatca_onboarding_audit").insert({
          onboarding_id: setup.id,
          actor_id: user.id,
          action: "production_activated",
          result: "success",
          details: { mode, deviceSerial: existingSetup.device_serial },
        });
        return respond({
          status: "production_active",
          productionEnabled: true,
          productionConfirmedAt: confirmedAt,
          message: "تم تفعيل الإرسال الحقيقي إلى ZATCA",
        });
      }

      const updatedAt = new Date().toISOString();
      const { error: updateError } = await db("zatca_onboarding_settings")
        .update({
          production_enabled: false,
          production_confirmed_by: null,
          production_confirmed_at: null,
          updated_at: updatedAt,
        })
        .eq("id", setup.id)
        .eq("mode", "production");
      if (updateError) throw updateError;
      await db("zatca_onboarding_audit").insert({
        onboarding_id: setup.id,
        actor_id: user.id,
        action: "production_deactivated",
        result: "success",
        details: { mode, deviceSerial: existingSetup.device_serial },
      });
      return respond({
        status: "production_inactive",
        productionEnabled: false,
        message: "تم تعطيل الإرسال الحقيقي إلى ZATCA",
      });
    }

    if (action === "run_compliance_case") {
      const caseIndex = Number(body.caseIndex);
      if (
        !Number.isInteger(caseIndex) ||
        caseIndex < 0 ||
        caseIndex >= complianceCases.length
      ) {
        return respond({ error: "رقم اختبار التوافق غير صالح" }, 400);
      }
      const { data: setup, error: setupError } = existingSetup
        ? await db("zatca_onboarding_settings")
            .select("*")
            .eq("id", existingSetup.id)
            .maybeSingle()
        : { data: null, error: null };
      if (setupError) throw setupError;
      const credentials = setup
        ? await getZatcaCredentials(admin, setup.id)
        : null;
      if (
        !credentials?.compliance_csid ||
        !credentials.compliance_secret ||
        !credentials.private_key_pem
      ) {
        return respond({ error: "يجب الحصول على Compliance CSID أولاً" }, 400);
      }
      Object.assign(setup, credentials);

      const existingResults: any[] = Array.isArray(setup.compliance_results)
        ? setup.compliance_results
        : [];
      const requiredIndexes = requiredCaseIndexes(String(setup.invoice_type));
      const testCase = complianceCases[caseIndex];
      const { data: passedAuditRows } = await db("zatca_onboarding_audit")
        .select("action, http_status, details, created_at")
        .eq("onboarding_id", setup.id)
        .eq("result", "success")
        .gte("created_at", setup.compliance_issued_at)
        .like("action", "compliance_test_%");
      const hydratedResults = new Map<number, any>();
      for (const item of existingResults) {
        hydratedResults.set(Number(item.caseIndex), item);
      }
      for (const auditRow of passedAuditRows ?? []) {
        const restoredIndex = complianceCases.findIndex(
          (item) => `compliance_test_${item.key}` === auditRow.action,
        );
        if (restoredIndex < 0) continue;
        const restoredCase = complianceCases[restoredIndex];
        hydratedResults.set(restoredIndex, {
          caseIndex: restoredIndex,
          documentType: restoredCase.key,
          label: restoredCase.label,
          status: "passed",
          message: auditRow.details?.message ?? "اجتاز فحص ZATCA مسبقاً",
          httpStatus: auditRow.http_status ?? 200,
          uuid: auditRow.details?.uuid ?? null,
          invoiceHash: auditRow.details?.invoiceHash ?? null,
          testedAt: auditRow.created_at,
        });
      }
      const currentPassed = hydratedResults.get(caseIndex);
      if (
        currentPassed?.status === "passed" &&
        currentPassed.invoiceHash
      ) {
        const restoredResults = [...hydratedResults.values()]
          .filter((item) => requiredIndexes.includes(Number(item.caseIndex)))
          .sort((a, b) => a.caseIndex - b.caseIndex);
        const restoredComplete = requiredIndexes.every(
          (index) => hydratedResults.get(index)?.status === "passed",
        );
        const restoredStatus = restoredComplete
          ? "compliance_passed"
          : "compliance_testing";
        const { error: restoreError } = await db("zatca_onboarding_settings")
          .update({
            status: restoredStatus,
            compliance_results: restoredResults,
            last_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", setup.id);
        if (restoreError) throw restoreError;
        return respond({
          result: currentPassed,
          completed: restoredComplete,
          allPassed: restoredComplete,
          status: restoredStatus,
        });
      }

      const sequenceIndex = requiredIndexes.indexOf(caseIndex);
      if (sequenceIndex === -1) {
        return respond(
          { error: "نوع هذا المستند غير مشمول في شهادة الجهاز" },
          400,
        );
      }
      const previousCaseIndex = requiredIndexes[sequenceIndex - 1];
      const scopedExistingResults =
        sequenceIndex === 0
          ? []
          : [...hydratedResults.values()].filter((item) =>
              requiredIndexes.includes(Number(item.caseIndex)),
            );
      const previousHash =
        sequenceIndex === 0
          ? ZATCA_INITIAL_PIH
          : clean(
              scopedExistingResults.find(
                (item) => item.caseIndex === previousCaseIndex,
              )?.invoiceHash,
            );
      if (sequenceIndex > 0 && !previousHash) {
        return respond({ error: "يجب تنفيذ اختبارات التوافق بالترتيب" }, 409);
      }

      await db("zatca_onboarding_settings")
        .update({
          status: "compliance_testing",
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", setup.id);

      let result: Record<string, unknown>;
      let httpStatus = 0;
      try {
        const document = buildComplianceDocument(
          setup,
          testCase,
          caseIndex,
          previousHash,
        );
        const zatcaResponse = await fetch(`${baseUrl}/compliance/invoices`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "Accept-Version": "V2",
            "Accept-Language": "ar",
            Authorization: `Basic ${Buffer.from(`${setup.compliance_csid}:${setup.compliance_secret}`).toString("base64")}`,
          },
          body: JSON.stringify({
            invoiceHash: document.invoiceHash,
            uuid: document.uuid,
            invoice: Buffer.from(document.signedXml, "utf8").toString("base64"),
          }),
          signal: AbortSignal.timeout(35_000),
        });
        httpStatus = zatcaResponse.status;
        const responseData = await zatcaResponse.json().catch(() => ({}));
        const validation = getValidationSummary(responseData);
        result = {
          caseIndex,
          documentType: testCase.key,
          label: testCase.label,
          status: zatcaResponse.ok && validation.passed ? "passed" : "failed",
          message:
            validation.message ||
            responseData?.message ||
            `ZATCA HTTP ${httpStatus}`,
          httpStatus,
          uuid: document.uuid,
          invoiceNumber: document.invoiceNumber,
          invoiceHash: document.invoiceHash,
          validationResults: validation.validationResults,
          testedAt: new Date().toISOString(),
        };
      } catch (error: any) {
        result = {
          caseIndex,
          documentType: testCase.key,
          label: testCase.label,
          status: "failed",
          message: error?.message ?? "فشل إنشاء أو توقيع مستند التوافق",
          httpStatus,
          testedAt: new Date().toISOString(),
        };
      }

      const nextResults = scopedExistingResults.filter(
        (item) => item.caseIndex !== caseIndex,
      );
      nextResults.push(result);
      nextResults.sort((a, b) => a.caseIndex - b.caseIndex);
      const completed = nextResults.length === requiredIndexes.length;
      const allPassed =
        completed && nextResults.every((item) => item.status === "passed");
      const firstFailure = nextResults.find((item) => item.status === "failed");
      const nextStatus = allPassed ? "compliance_passed" : "compliance_testing";
      const { error: updateError } = await db("zatca_onboarding_settings")
        .update({
          status: nextStatus,
          compliance_results: nextResults,
          last_error: firstFailure ? firstFailure.message : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", setup.id);
      if (updateError) throw updateError;
      await db("zatca_onboarding_audit").insert({
        onboarding_id: setup.id,
        actor_id: user.id,
        action: `compliance_test_${testCase.key}`,
        result: result.status === "passed" ? "success" : "failed",
        http_status: httpStatus || null,
        details: {
          documentType: testCase.key,
          uuid: result.uuid ?? null,
          invoiceHash: result.invoiceHash ?? null,
          message: result.message,
        },
      });
      return respond({ result, completed, allPassed, status: nextStatus });
    }

    return respond({ error: "Unknown action" }, 400);
  } catch (error: any) {
    console.error("zatca-onboarding", error);
    return respond({ error: error?.message ?? "Unexpected error" }, 500);
  }
});
