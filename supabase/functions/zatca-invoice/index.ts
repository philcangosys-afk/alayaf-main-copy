import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { KJUR, X509 } from "npm:jsrsasign@11.1.3";
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
const PRODUCTION_CONFIRMATION = "SUBMIT_REAL_ZATCA_INVOICE";

const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(), "Content-Type": "application/json" },
  });

const clean = (value: unknown) => String(value ?? "").trim();

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

function containsSyntheticMarker(value: unknown): boolean {
  if (typeof value === "string") {
    return /(?:^|[^A-Z])(?:TEST(?:ING)?|SIM(?:ULATION|ULATED|ULATOR)?)(?:[^A-Z]|$)|تجريب/i.test(
      value,
    );
  }
  if (Array.isArray(value)) return value.some(containsSyntheticMarker);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(
      containsSyntheticMarker,
    );
  }
  return false;
}

function getValidationResult(responseData: any) {
  const validation = responseData?.validationResults;
  const errors = Array.isArray(validation?.errorMessages)
    ? validation.errorMessages
    : [];
  const status = clean(validation?.status).toUpperCase();
  const documentStatus = clean(
    responseData?.reportingStatus ?? responseData?.clearanceStatus,
  ).toUpperCase();
  const validDocumentStatus =
    !documentStatus || ["REPORTED", "CLEARED"].includes(documentStatus);
  return {
    accepted:
      errors.length === 0 &&
      ["PASS", "WARNING"].includes(status) &&
      validDocumentStatus,
    message: clean(
      errors[0]?.message ??
        responseData?.message ??
        responseData?.error ??
        responseData?.dispositionMessage,
    ),
  };
}

function getRetryAfter(response?: Response) {
  const header = response?.headers.get("Retry-After");
  if (header) {
    const seconds = Number(header);
    const parsed = Number.isFinite(seconds)
      ? Date.now() + Math.max(0, seconds) * 1000
      : Date.parse(header);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return new Date(Date.now() + 5 * 60 * 1000).toISOString();
}
const escapeXmlText = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

function parseRegisteredAddress(location: string, strict = false) {
  const normalized = location.replace(/\s+/g, " ").trim();
  const parts = normalized
    .split(/[،,]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const firstPart = parts[0] ?? "";
  const combinedFirstPart = firstPart.match(/^(\d{4})\s+(.+)$/u);
  const separatedBuilding = /^\d{4}$/.test(firstPart);

  const buildingNumber =
    combinedFirstPart?.[1] ?? (separatedBuilding ? firstPart : "0000");
  const streetName = combinedFirstPart
    ? combinedFirstPart[2].trim()
    : separatedBuilding
      ? (parts[1] ?? "")
      : "";
  const citySubdivisionName = combinedFirstPart
    ? (parts[1] ?? "")
    : separatedBuilding
      ? (parts[2] ?? "")
      : "";
  const cityName = combinedFirstPart
    ? (parts[2] ?? "")
    : separatedBuilding
      ? (parts[3] ?? "")
      : "";
  const postalCandidate = combinedFirstPart
    ? (parts[3] ?? "")
    : separatedBuilding
      ? (parts[4] ?? "")
      : "";
  const postalZone = /^\d{5}$/.test(postalCandidate)
    ? postalCandidate
    : "00000";
  const hasText = (value: string) => /[\p{L}]/u.test(value);

  if (
    strict &&
    (buildingNumber === "0000" ||
      postalZone === "00000" ||
      !hasText(streetName) ||
      !hasText(citySubdivisionName) ||
      !hasText(cityName))
  ) {
    throw new Error("INVALID_REGISTERED_ADDRESS");
  }

  return {
    buildingNumber,
    postalZone,
    cityName: cityName || "الرياض",
    citySubdivisionName: citySubdivisionName || "الفرع الرئيسي",
    streetName: streetName || "العنوان الوطني",
  };
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

function extractQrCodeData(xml: string) {
  const documentReferences =
    xml.match(
      /<cac:AdditionalDocumentReference>[\s\S]*?<\/cac:AdditionalDocumentReference>/g,
    ) ?? [];
  const qrReference = documentReferences.find((reference) =>
    /<cbc:ID>\s*QR\s*<\/cbc:ID>/.test(reference),
  );
  return (
    qrReference
      ?.match(
        /<cbc:EmbeddedDocumentBinaryObject[^>]*>([^<]+)<\/cbc:EmbeddedDocumentBinaryObject>/,
      )?.[1]
      ?.trim() ?? null
  );
}

function getAcceptedInvoiceArtifacts(
  responseData: any,
  signed: {
    signedXml: string;
    qrCodeData: string;
    signatureValue: string;
    simplified: boolean;
  },
) {
  if (signed.simplified || !clean(responseData?.clearedInvoice)) {
    return {
      invoiceXml: signed.signedXml,
      qrCodeData: signed.qrCodeData,
      cryptographicStamp: signed.signatureValue,
    };
  }

  try {
    const invoiceXml = Buffer.from(
      clean(responseData.clearedInvoice).replace(/\s+/g, ""),
      "base64",
    ).toString("utf8");
    if (!invoiceXml.includes("<Invoice")) throw new Error("Invalid cleared XML");
    return {
      invoiceXml,
      qrCodeData: extractQrCodeData(invoiceXml) ?? signed.qrCodeData,
      cryptographicStamp:
        invoiceXml.match(/<ds:SignatureValue[^>]*>([^<]+)<\/ds:SignatureValue>/)
          ?.[1] ?? signed.signatureValue,
    };
  } catch {
    return {
      invoiceXml: signed.signedXml,
      qrCodeData: signed.qrCodeData,
      cryptographicStamp: signed.signatureValue,
    };
  }
}

// The XML builder always emits <cac:PartyIdentification> with the default TIN
// scheme, so simplified B2C invoices carry an empty BT-46 that ZATCA flags as
// BR-KSA-F-07. Drop identification blocks that have no value.
function removeEmptyPartyIdentification(xml: string) {
  return xml.replace(
    /[ \t]*<cac:PartyIdentification>\s*<cbc:ID schemeID="[^"]*">\s*<\/cbc:ID>\s*<\/cac:PartyIdentification>\r?\n?/g,
    "",
  );
}

const BILLING_REFERENCE_BLOCK =
  /<cac:InvoiceDocumentReference>[\s\S]*?<\/cac:InvoiceDocumentReference>/g;

// The XML builder always writes <cbc:UUID> inside the billing reference. An
// original issued in ZATCA Phase 1 was never reported, so it has no UUID at
// ZATCA: the reference carries the original invoice number only (BT-25).
// Drop the empty UUID element there; the other <cbc:UUID> elements (the
// document UUID and the ICV) are outside this block and stay untouched.
function removeEmptyBillingReferenceUuid(xml: string) {
  return xml.replace(BILLING_REFERENCE_BLOCK, (block) =>
    block.replace(/[ \t]*<cbc:UUID>\s*<\/cbc:UUID>\r?\n?/g, ""),
  );
}

function buildSignedInvoice(input: {
  setup: any;
  invoice: any;
  lines: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    discount: number;
    taxPercent: number;
  }>;
  icv: number;
  previousHash: string;
  uuid: string;
  documentType: "invoice" | "creditNote" | "debitNote";
  originalInvoiceId?: string;
  originalInvoiceUuid?: string;
  /** The original was issued in ZATCA Phase 1: reference its number without a UUID */
  originalReferenceWithoutUuid?: boolean;
  credentials: { csid: string; secret: string };
}) {
  const {
    setup,
    invoice,
    lines,
    icv,
    previousHash,
    uuid,
    documentType,
    originalInvoiceId,
    originalInvoiceUuid,
    originalReferenceWithoutUuid,
    credentials,
  } = input;
  const address = parseRegisteredAddress(String(setup.branch_location));
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
  const simplified = invoice.invoice_type !== "standard";

  const document = new InvoiceData()
    .setInvoiceNumber(String(invoice.id))
    .setIssueDate(clean(invoice.date) || now.slice(0, 10))
    .setIssueTime(now.slice(11, 19))
    .setDueDate(
      clean(invoice.due_date) || clean(invoice.date) || now.slice(0, 10),
    )
    .setCurrencyCode("SAR")
    .setDocumentCurrencyCode("SAR")
    .setTaxCurrencyCode("SAR")
    .setInvoiceCounter(String(icv))
    .setPreviousInvoiceHash(previousHash);

  if (simplified) document.simplified();
  else document.standard();
  if (documentType === "creditNote") document.creditNote();
  else if (documentType === "debitNote") document.debitNote();
  else document.taxInvoice();

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

  const buyerAddress = parseRegisteredAddress(
    clean(invoice.customer_address) || "1234 الرياض 12345",
  );
  const buyer = new BuyerData()
    .setRegistrationName(escapeXmlText(invoice.customer) || "عميل")
    .setStreetName(escapeXmlText(buyerAddress.streetName))
    .setBuildingNumber(buyerAddress.buildingNumber)
    .setCitySubdivisionName(escapeXmlText(buyerAddress.citySubdivisionName))
    .setCityName(escapeXmlText(buyerAddress.cityName))
    .setPostalZone(buyerAddress.postalZone)
    .setCountryCode("SA");
  if (!simplified) {
    buyer
      .setPartyIdentification(
        String(invoice.buyer_commercial_registration),
      )
      .setPartyIdentificationId("CRN")
      .setVatNumber(String(invoice.buyer_vat));
  }

  document.setSeller(seller).setBuyer(buyer);
  lines.forEach((line, index) => {
    document.addLine(
      new InvoiceLineData()
        .setId(index + 1)
        .setItemName(escapeXmlText(line.description) || "بند")
        .setDescription(escapeXmlText(line.description) || "بند")
        .setQuantity(line.quantity)
        .setUnitPrice(line.unitPrice)
        .setAllowanceAmount(line.discount)
        .setTaxPercent(line.taxPercent)
        .setUnitCode("EA")
        .calculateTotals(),
    );
  });
  if (documentType !== "invoice") {
    document.addBillingReference({
      id: String(originalInvoiceId ?? invoice.id),
      uuid: originalReferenceWithoutUuid
        ? ""
        : String(originalInvoiceUuid ?? crypto.randomUUID()),
    });
    document.addPaymentMeans({
      code: "10",
      instruction_note:
        clean(invoice.reason) ||
        (documentType === "creditNote"
          ? "تخفيض قيمة الفاتورة الأصلية"
          : "زيادة قيمة الفاتورة الأصلية"),
    });
  }
  document.calculateTotals();

  const unsignedXml = removeEmptyBillingReferenceUuid(
    removeEmptyPartyIdentification(
      new ZatcaInvoice().generateXml(document, uuid),
    ),
  );
  if (documentType !== "invoice" && originalReferenceWithoutUuid) {
    // Phase 1 original: exactly one reference, to the original number, and no
    // UUID in it. Anything else stops here, before signing or sending.
    const references = unsignedXml.match(BILLING_REFERENCE_BLOCK) ?? [];
    if (
      references.length !== 1 ||
      !references[0].includes(`<cbc:ID>${String(originalInvoiceId)}</cbc:ID>`) ||
      /<cbc:UUID\b/.test(references[0])
    ) {
      throw new Error("PHASE1_BILLING_REFERENCE_INVALID");
    }
  }
  const certificate = createCompatibleCertificate(
    toCertificatePem(credentials.csid),
    String(setup.private_key_pem),
    credentials.secret,
  );
  const signer = InvoiceSigner.signInvoice(unsignedXml, certificate);
  const signedXml = correctXadesDigests(signer.getXML(), certificate);
  const invoiceHash = signer.getHash();
  const signatureValue =
    signedXml.match(/<ds:SignatureValue>([^<]+)<\/ds:SignatureValue>/)?.[1] ??
    "";

  const qrCodeData = extractQrCodeData(signedXml);
  if (!qrCodeData) {
    throw new Error("SIGNED_XML_QR_MISSING");
  }

  return { signedXml, invoiceHash, qrCodeData, simplified, signatureValue };
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
  const {
    data: { user },
    error: authError,
  } = await caller.auth.getUser(authHeader.slice(7));
  if (authError || !user?.email) return respond({ error: "Unauthorized" }, 401);

  const company = await callerCompany(caller);
  if (!company) return respond({ error: "حسابك غير مرتبط بمنشأة فعالة" }, 403);
  const db = companyScopedDb(admin, company.id);

  const { data: callerEmployee } = await db("employees")
    .select("employee_role")
    .ilike("email", escapeLike(user.email))
    .maybeSingle();
  if (!callerEmployee?.employee_role) {
    return respond({ error: "غير مصرح بإرسال مستندات ZATCA" }, 403);
  }
  const { data: callerRole } = await db("user_roles")
    .select("permissions")
    .eq("name_ar", callerEmployee.employee_role)
    .eq("status", "فعال")
    .maybeSingle();
  const permissions =
    callerRole?.permissions && typeof callerRole.permissions === "object"
      ? (callerRole.permissions as Record<string, unknown>)
      : {};
  const fullAccessRoles = new Set(["مدير النظام", "مدير عام", "المدير العام"]);
  const canSubmitZatca =
    fullAccessRoles.has(callerEmployee.employee_role) ||
    permissions["module.sales"] === true ||
    permissions["module.sales"] === "manage" ||
    permissions["sales.invoices"] === true ||
    permissions["sales.invoices"] === "manage";
  if (!canSubmitZatca) {
    return respond({ error: "غير مصرح بإرسال مستندات ZATCA" }, 403);
  }

  try {
    const body = await req.json();
    const mode: ZatcaMode = body.mode ?? "simulation";
    if (!(["simulation", "production"] as string[]).includes(mode)) {
      return respond({ error: "mode must be simulation or production" }, 400);
    }

    const invoiceId = clean(body.invoiceId);
    const noteId = clean(body.noteId);
    const deviceSerial = clean(body.deviceSerial);
    if ((!invoiceId && !noteId) || (invoiceId && noteId)) {
      return respond({ error: "حدد فاتورة أو إشعاراً واحداً فقط" }, 400);
    }
    const table = noteId ? "invoice_adjustment_notes" : "sales_invoices";
    const recordId = noteId || invoiceId;
    const idempotencyKey = `${mode}:${table}:${recordId}`;

    const { data: record, error: recordError } = await db(table)
      .select("*")
      .eq("id", recordId)
      .maybeSingle();
    if (recordError) throw recordError;
    if (!record) return respond({ error: "المستند غير موجود" }, 404);
    // مستند المرحلة الأولى (الإصدار والحفظ): رمزه يُنشأ عند الإصدار ولا يُرسل للهيئة
    if (clean(record.zatca_phase) === "phase1") {
      return respond(
        {
          error: "هذا المستند صدر في المرحلة الأولى (الإصدار والحفظ)؛ لا يُرسل إلى ZATCA",
          status: "phase1",
          retryable: false,
        },
        409,
      );
    }

    const { data: existingLog, error: existingLogError } = await db("zatca_invoice_submission_logs")
      .select("*")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existingLogError) throw existingLogError;
    if (
      existingLog &&
      ["cleared", "reported"].includes(clean(existingLog.status))
    ) {
      return respond({
        status: existingLog.status,
        uuid: existingLog.request_uuid,
        icv: existingLog.icv,
        qrCodeData: record.qr_code_data,
        response: existingLog.response,
        idempotent: true,
        message: "تم إرسال هذا المستند إلى ZATCA مسبقاً",
      });
    }
    if (clean(existingLog?.status) === "ambiguous") {
      return respond(
        {
          error:
            "نتيجة الإرسال السابق غير محسومة؛ لا تعد إرسال المستند قبل المراجعة اليدوية",
          status: "ambiguous",
          retryable: false,
        },
        409,
      );
    }
    if (clean(existingLog?.status) === "submitted") {
      const submittedTimestamps = [
        Date.parse(clean(existingLog.updated_at)),
        Date.parse(clean(existingLog.created_at)),
      ].filter(Number.isFinite);
      const latestSubmittedAt = submittedTimestamps.length
        ? Math.max(...submittedTimestamps)
        : Number.NEGATIVE_INFINITY;
      if (latestSubmittedAt > Date.now() - 5 * 60 * 1000) {
        return respond({ error: "يوجد إرسال جارٍ بالفعل لهذا المستند" }, 409);
      }

      const staleInvocationError =
        "Stale submitted invocation exceeded 5 minutes; retry allowed";
      const { error: staleLogError } = await db("zatca_invoice_submission_logs")
        .update({
          status: "failed",
          retry_after: null,
          last_error: staleInvocationError,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingLog.id);
      if (staleLogError) throw staleLogError;
      existingLog.status = "failed";
      existingLog.last_error = staleInvocationError;
    }

    let setupQuery = db("zatca_onboarding_settings")
      .select("*")
      .eq("mode", mode);
    if (mode === "production") {
      setupQuery = setupQuery.eq("production_enabled", true);
    }
    if (deviceSerial) setupQuery = setupQuery.eq("device_serial", deviceSerial);
    const { data: setups, error: setupError } = await setupQuery.limit(2);
    if (setupError) throw setupError;
    if (!setups?.length) {
      return respond({ error: `لا توجد تهيئة ZATCA لوضع ${mode}` }, 409);
    }
    if (setups.length > 1) {
      return respond(
        { error: "deviceSerial مطلوب لتحديد جهاز ZATCA الصحيح" },
        409,
      );
    }
    const setup = setups[0];
    const { data: unresolvedSubmission, error: unresolvedSubmissionError } =
      await db("zatca_invoice_submission_logs")
        .select("id")
        .eq("onboarding_id", setup.id)
        .eq("status", "ambiguous")
        .limit(1)
        .maybeSingle();
    if (unresolvedSubmissionError) throw unresolvedSubmissionError;
    if (unresolvedSubmission) {
      return respond(
        {
          error:
            "يوجد مستند سابق غير محسوم على هذا الجهاز؛ لا ترسل مستندًا جديدًا قبل المراجعة اليدوية",
          status: "ambiguous",
          retryable: false,
        },
        409,
      );
    }

    const vaultCredentials = await getZatcaCredentials(admin, setup.id);
    Object.assign(setup, vaultCredentials);

    let originalInvoice: any = null;
    if (noteId) {
      const { data: linked, error: linkedError } = await db("sales_invoices")
        .select("*")
        .eq("id", clean(record.original_invoice_id))
        .maybeSingle();
      if (linkedError) throw linkedError;
      originalInvoice = linked;
    }
    // A Phase 1 original was never sent to ZATCA, so ZATCA holds no UUID for it:
    // the note references the original invoice number only (any stored UUID is ignored)
    const originalReferenceWithoutUuid =
      Boolean(noteId) && clean(originalInvoice?.zatca_phase) === "phase1";

    const documentType: "invoice" | "creditNote" | "debitNote" = !noteId
      ? "invoice"
      : record.note_type === "sales_credit"
        ? "creditNote"
        : "debitNote";
    const invoice = noteId
      ? {
          id: clean(record.note_number) || recordId,
          date: clean(record.issue_date),
          due_date: clean(record.issue_date),
          customer: clean(record.counterparty),
          customer_address: clean(originalInvoice?.customer_address),
          invoice_type: clean(originalInvoice?.invoice_type) || "simplified",
          buyer_vat: clean(originalInvoice?.buyer_vat),
          buyer_commercial_registration: clean(
            originalInvoice?.buyer_commercial_registration,
          ),
          reason: clean(record.reason),
        }
      : record;
    const simplified = invoice.invoice_type !== "standard";
    const baseUrl = mode === "production" ? PRODUCTION_URL : SIMULATION_URL;
    const endpoint = simplified
      ? `${baseUrl}/invoices/reporting/single`
      : `${baseUrl}/invoices/clearance/single`;
    const attemptCount = Number(existingLog?.attempt_count ?? 0) + 1;
    const baseLog = {
      invoice_id: recordId,
      invoice_table: table,
      document_type: documentType,
      invoice_type: simplified ? "simplified" : "standard",
      mode,
      onboarding_id: setup.id,
      idempotency_key: idempotencyKey,
      endpoint,
      attempt_count: attemptCount,
      created_by: user.id,
      updated_at: new Date().toISOString(),
    };
    let durableLogId = clean(existingLog?.id);
    const saveLog = async (values: Record<string, unknown>) => {
      if (durableLogId) {
        const { error } = await db("zatca_invoice_submission_logs")
          .update({ ...baseLog, ...values })
          .eq("id", durableLogId);
        if (error) throw error;
        return;
      }
      const { data, error } = await db("zatca_invoice_submission_logs")
        .insert({ ...baseLog, ...values })
        .select("id")
        .single();
      if (error) throw error;
      durableLogId = clean(data?.id);
    };
    await saveLog({
      status: "submitted",
      request_payload: {
        mode,
        invoiceTable: table,
        recordId,
        deviceSerial: setup.device_serial,
        endpoint,
      },
      response: {},
      response_text: "",
      retry_after: null,
      last_error: null,
    });
    const rejectBeforeSubmission = async (message: string, status = 409) => {
      await saveLog({
        status: "rejected",
        request_payload: {
          mode,
          invoiceTable: table,
          recordId,
          deviceSerial: setup.device_serial,
          reason: message,
        },
        response: {},
        response_text: "",
        retry_after: null,
        last_error: message,
      });
      return respond({ error: message }, status);
    };

    if (mode === "production") {
      if (body.productionConfirmation !== PRODUCTION_CONFIRMATION) {
        return await rejectBeforeSubmission(
          `productionConfirmation must equal ${PRODUCTION_CONFIRMATION}`,
          403,
        );
      }
      if (setup.production_enabled !== true) {
        return await rejectBeforeSubmission("الإرسال الإنتاجي غير مفعّل", 403);
      }
      if (
        !clean(setup.private_key_pem) ||
        !clean(setup.production_csid) ||
        !clean(setup.production_secret)
      ) {
        return await rejectBeforeSubmission(
          "بيانات اعتماد ZATCA الإنتاجية غير مكتملة",
        );
      }
      const expiresAt = Date.parse(clean(setup.certificate_expires_at));
      if (setup.certificate_revoked_at) {
        return await rejectBeforeSubmission("شهادة ZATCA ملغاة", 403);
      }
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        return await rejectBeforeSubmission(
          "شهادة ZATCA منتهية أو لا يوجد تاريخ انتهاء صالح",
          403,
        );
      }
      const productionRecordText = {
        recordId,
        invoiceNumber: record.invoice_number,
        noteNumber: record.note_number,
        customer: record.customer,
        counterparty: record.counterparty,
        originalInvoiceId: record.original_invoice_id,
        items: Array.isArray(record.items)
          ? record.items.map((item: any) => ({
              description: item.description,
              name: item.name,
              id: item.id,
              sku: item.sku,
            }))
          : [],
        originalInvoice: originalInvoice
          ? {
              id: originalInvoice.id,
              invoiceNumber: originalInvoice.invoice_number,
              customer: originalInvoice.customer,
              items: Array.isArray(originalInvoice.items)
                ? originalInvoice.items.map((item: any) => ({
                    description: item.description,
                    name: item.name,
                    id: item.id,
                    sku: item.sku,
                  }))
                : [],
            }
          : null,
      };
      if (containsSyntheticMarker(productionRecordText)) {
        return await rejectBeforeSubmission(
          "تم رفض مستند إنتاجي يحتوي على بيانات اختبارية أو تجريبية",
          422,
        );
      }
      if (!clean(invoice.customer_address)) {
        return await rejectBeforeSubmission(
          "العنوان الوطني الحقيقي للعميل مطلوب قبل الإرسال الإنتاجي",
          422,
        );
      }
      try {
        parseRegisteredAddress(clean(invoice.customer_address), true);
      } catch {
        return await rejectBeforeSubmission(
          "عنوان العميل يجب أن يتضمن رقم مبنى من 4 أرقام ورمزًا بريديًا من 5 أرقام ومدينة",
          422,
        );
      }
      if (!simplified) {
        if (!/^3\d{14}$/.test(clean(invoice.buyer_vat))) {
          return await rejectBeforeSubmission(
            "الرقم الضريبي الحقيقي للعميل مطلوب لفاتورة B2B",
            422,
          );
        }
        if (
          !/^\d{10,15}$/.test(
            clean(invoice.buyer_commercial_registration),
          )
        ) {
          return await rejectBeforeSubmission(
            "السجل التجاري الحقيقي للعميل مطلوب لفاتورة B2B",
            422,
          );
        }
      }
      if (noteId && !clean(record.reason)) {
        return await rejectBeforeSubmission(
          "سبب الإشعار الدائن أو المدين مطلوب قبل الإرسال الإنتاجي",
          422,
        );
      }
      if (
        noteId &&
        !clean(originalInvoice?.uuid) &&
        !originalReferenceWithoutUuid
      ) {
        return await rejectBeforeSubmission(
          "لا يمكن إرسال إشعار إنتاجي دون UUID فعلي للفاتورة الأصلية",
          422,
        );
      }
    }

    const credentials =
      mode === "production"
        ? {
            csid: clean(setup.production_csid),
            secret: clean(setup.production_secret),
          }
        : {
            csid: clean(setup.compliance_csid),
            secret: clean(setup.compliance_secret),
          };
    if (
      !clean(setup.private_key_pem) ||
      !credentials.csid ||
      !credentials.secret
    ) {
      return await rejectBeforeSubmission(
        "أكمل تهيئة بيانات اعتماد ZATCA قبل إرسال الفواتير",
      );
    }

    const rawItems = Array.isArray(record.items) ? record.items : [];
    const lines = rawItems.map((item: any) => ({
      description: clean(item.description),
      quantity: Number(item.quantity) || 1,
      unitPrice: Number(item.unitPrice) || 0,
      discount: Math.max(Number(item.discount) || 0, 0),
      taxPercent: Number(item.taxPercent ?? 15) || 15,
    }));
    if (!lines.length) {
      return await rejectBeforeSubmission(
        "لا توجد بنود صالحة داخل المستند",
        400,
      );
    }
    if (
      lines.some(
        (line) =>
          line.quantity <= 0 ||
          line.unitPrice < 0 ||
          line.discount > line.quantity * line.unitPrice,
      )
    ) {
      return await rejectBeforeSubmission(
        "توجد كمية أو قيمة خصم غير صالحة في بنود المستند",
        400,
      );
    }
    const calculated = lines.reduce(
      (totals, line) => {
        const net = line.quantity * line.unitPrice - line.discount;
        const tax = (net * line.taxPercent) / 100;
        return {
          subtotal: totals.subtotal + net,
          tax: totals.tax + tax,
          total: totals.total + net + tax,
        };
      },
      { subtotal: 0, tax: 0, total: 0 },
    );
    const storedSubtotal = Number(record.subtotal);
    const storedTax = Number(noteId ? record.tax : record.total_tax);
    const storedTotal = Number(
      String(record.total ?? "0").replace(/[^0-9.-]/g, ""),
    );
    if (
      !Number.isFinite(storedSubtotal) ||
      !Number.isFinite(storedTax) ||
      !Number.isFinite(storedTotal) ||
      Math.abs(storedSubtotal - calculated.subtotal) > 0.01 ||
      Math.abs(storedTax - calculated.tax) > 0.01 ||
      Math.abs(storedTotal - calculated.total) > 0.01
    ) {
      return await rejectBeforeSubmission(
        "إجماليات المستند لا تطابق مجموع البنود والضريبة",
        422,
      );
    }

    const { data: reservationRows, error: reservationError } = await admin.rpc(
      "reserve_zatca_sequence",
      { p_onboarding_id: setup.id },
    );
    if (reservationError) {
      const message = clean(reservationError.message) || "تعذر حجز تسلسل ZATCA";
      await saveLog({
        status: "failed",
        request_payload: { mode, invoiceTable: table, recordId, endpoint },
        response: {},
        response_text: "",
        retry_after: getRetryAfter(),
        last_error: message,
      });
      return respond({ error: message }, 409);
    }
    const reservation = Array.isArray(reservationRows)
      ? reservationRows[0]
      : reservationRows;
    const reservationToken = clean(reservation?.reservation_token);
    const icv = Number(reservation?.icv);
    const previousHash = clean(reservation?.previous_pih) || ZATCA_INITIAL_PIH;
    if (!reservationToken || !Number.isSafeInteger(icv) || icv < 1) {
      if (reservationToken) {
        await admin.rpc("release_zatca_sequence", {
          p_onboarding_id: setup.id,
          p_reservation_token: reservationToken,
        });
      }
      await saveLog({
        status: "failed",
        retry_after: getRetryAfter(),
        last_error: "استجابة حجز تسلسل ZATCA غير صالحة",
      });
      throw new Error("استجابة حجز تسلسل ZATCA غير صالحة");
    }

    let sequenceFinalized = false;
    let sequenceBlocked = false;
    let submissionAmbiguous = false;
    const markAmbiguousAndBlock = async (
      values: Record<string, unknown>,
      reason: string,
    ) => {
      submissionAmbiguous = true;
      let logError: unknown = null;
      try {
        await saveLog({
          ...values,
          status: "ambiguous",
          retry_after: null,
          last_error: reason,
        });
      } catch (error) {
        logError = error;
      }

      let invoiceStatusError: unknown = null;
      try {
        const { error } = await db(table)
          .update({
            zatca_status: "ambiguous",
            zatca_response: values.response ?? {},
            zatca_submitted_at: new Date().toISOString(),
          })
          .eq("id", recordId);
        invoiceStatusError = error;
      } catch (error) {
        invoiceStatusError = error;
      }

      const { error: blockError } = await admin.rpc("block_zatca_sequence", {
        p_onboarding_id: setup.id,
        p_reservation_token: reservationToken,
        p_reason: reason,
      });
      if (blockError) {
        const error = new Error(
          clean(blockError.message) || "تعذر حظر تسلسل ZATCA للمراجعة",
        ) as Error & { zatcaStatus?: string };
        error.zatcaStatus = "ambiguous";
        throw error;
      }
      sequenceBlocked = true;
      if (logError) console.error("zatca-invoice ambiguous log", logError);
      if (invoiceStatusError) {
        const { error: retryStatusError } = await db(table)
          .update({
            zatca_status: "ambiguous",
            zatca_response: values.response ?? {},
            zatca_submitted_at: new Date().toISOString(),
          })
          .eq("id", recordId);
        if (retryStatusError)
          console.error(
            "zatca-invoice ambiguous document status",
            retryStatusError,
          );
      }
    };
    try {
      const uuid = clean(record.uuid) || crypto.randomUUID();
      const signed = buildSignedInvoice({
        setup,
        invoice,
        lines,
        icv,
        previousHash,
        uuid,
        documentType,
        originalInvoiceId: clean(record.original_invoice_id),
        originalInvoiceUuid: clean(originalInvoice?.uuid) || undefined,
        originalReferenceWithoutUuid,
        credentials,
      });
      const requestPayload = {
        mode,
        invoiceTable: table,
        recordId,
        documentType,
        invoiceType: simplified ? "simplified" : "standard",
        deviceSerial: setup.device_serial,
        endpoint,
        uuid,
        icv,
        previousPih: previousHash,
        invoiceHash: signed.invoiceHash,
        invoiceBytes: Buffer.byteLength(signed.signedXml, "utf8"),
      };
      await saveLog({
        status: "submitted",
        http_status: null,
        request_uuid: uuid,
        invoice_hash: signed.invoiceHash,
        icv,
        previous_pih: previousHash,
        request_payload: requestPayload,
        signed_invoice_xml: signed.signedXml,
        qr_code_data: signed.qrCodeData,
        cryptographic_stamp: signed.signatureValue,
        response: {},
        response_text: "",
        retry_after: null,
        last_error: null,
      });

      let zatcaResponse: Response;
      try {
        zatcaResponse = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "Accept-Version": "V2",
            "Accept-Language": "en",
            "Clearance-Status": signed.simplified ? "0" : "1",
            Authorization: `Basic ${Buffer.from(`${credentials.csid}:${credentials.secret}`, "utf8").toString("base64")}`,
          },
          body: JSON.stringify({
            invoiceHash: signed.invoiceHash,
            uuid,
            invoice: Buffer.from(signed.signedXml, "utf8").toString("base64"),
          }),
          signal: AbortSignal.timeout(35_000),
        });
      } catch (error: any) {
        const message = clean(error?.message) || "ZATCA network error";
        await markAmbiguousAndBlock(
          {
            http_status: null,
            request_uuid: uuid,
            invoice_hash: signed.invoiceHash,
            icv,
            previous_pih: previousHash,
            request_payload: requestPayload,
            response: {},
            response_text: "",
          },
          message,
        );
        return respond(
          { error: message, status: "ambiguous", retryable: false },
          503,
        );
      }

      let responseText: string;
      try {
        responseText = await zatcaResponse.text();
      } catch (error: any) {
        const message = clean(error?.message) || "ZATCA network error";
        await markAmbiguousAndBlock(
          {
            http_status: zatcaResponse.status,
            request_uuid: uuid,
            invoice_hash: signed.invoiceHash,
            icv,
            previous_pih: previousHash,
            request_payload: requestPayload,
            response: {},
            response_text: "",
          },
          message,
        );
        return respond(
          { error: message, status: "ambiguous", retryable: false },
          503,
        );
      }
      let responseData: any = {};
      try {
        responseData = responseText ? JSON.parse(responseText) : {};
      } catch {
        responseData = {};
      }
      const httpAccepted = [200, 202].includes(zatcaResponse.status);
      const validation = getValidationResult(responseData);
      const accepted = httpAccepted && validation.accepted;
      const retryable = zatcaResponse.status >= 500;
      const submittedAt = new Date().toISOString();

      if (!accepted) {
        const errorMessage =
          validation.message ||
          responseText ||
          `ZATCA HTTP ${zatcaResponse.status}`;
        const failureStatus = retryable ? "ambiguous" : "rejected";
        const failureValues = {
          http_status: zatcaResponse.status,
          request_uuid: uuid,
          invoice_hash: signed.invoiceHash,
          icv,
          previous_pih: previousHash,
          request_payload: requestPayload,
          response: responseData,
          response_text: responseText,
        };
        if (retryable) {
          await markAmbiguousAndBlock(failureValues, errorMessage);
        } else {
          await saveLog({
            ...failureValues,
            status: failureStatus,
            retry_after: null,
            last_error: errorMessage,
          });
        }
        await db(table)
          .update({
            zatca_status: failureStatus,
            zatca_response: responseData,
            zatca_submitted_at: submittedAt,
          })
          .eq("id", recordId);
        return respond(
          {
            error: errorMessage,
            status: failureStatus,
            details: responseData,
            retryable: false,
          },
          retryable ? 503 : 422,
        );
      }

      const status = signed.simplified ? "reported" : "cleared";
      const acceptedArtifacts = getAcceptedInvoiceArtifacts(
        responseData,
        signed,
      );
      const { error: finalizeError } = await admin.rpc(
        "finalize_zatca_accepted_submission",
        {
          p_onboarding_id: setup.id,
          p_reservation_token: reservationToken,
          p_invoice_hash: signed.invoiceHash,
          p_log_id: durableLogId,
          p_status: status,
          p_http_status: zatcaResponse.status,
          p_request_uuid: uuid,
          p_icv: icv,
          p_previous_pih: previousHash,
          p_request_payload: requestPayload,
          p_response: responseData,
          p_response_text: responseText,
          p_invoice_table: table,
          p_record_id: recordId,
          p_qr_code_data: acceptedArtifacts.qrCodeData,
          p_cryptographic_stamp: acceptedArtifacts.cryptographicStamp,
          p_invoice_xml: acceptedArtifacts.invoiceXml,
          p_submitted_at: submittedAt,
        },
      );
      if (finalizeError) {
        const persistenceError =
          "قبلت ZATCA المستند لكن تعذر تثبيت النتيجة محليًا؛ تم إيقاف تسلسل الجهاز للمراجعة اليدوية";
        await markAmbiguousAndBlock(
          {
            http_status: zatcaResponse.status,
            request_uuid: uuid,
            invoice_hash: signed.invoiceHash,
            icv,
            previous_pih: previousHash,
            request_payload: requestPayload,
            response: responseData,
            response_text: responseText,
          },
          `${persistenceError}: ${clean(finalizeError.message)}`,
        );
        return respond(
          { error: persistenceError, status: "ambiguous", retryable: false },
          503,
        );
      }
      sequenceFinalized = true;

      return respond({
        status,
        uuid,
        icv,
        qrCodeData: acceptedArtifacts.qrCodeData,
        message: signed.simplified
          ? "تم إبلاغ ZATCA بالمستند المبسط"
          : "تمت مصادقة ZATCA على المستند المعياري",
      });
    } catch (error: any) {
      const message = clean(error?.message) || "Unexpected submission error";
      if (!sequenceFinalized && !sequenceBlocked && !submissionAmbiguous) {
        await saveLog({
          status: "failed",
          request_payload: {
            mode,
            invoiceTable: table,
            recordId,
            documentType,
            invoiceType: simplified ? "simplified" : "standard",
            deviceSerial: setup.device_serial,
            endpoint,
          },
          retry_after: getRetryAfter(),
          last_error: message,
        }).catch((logError) =>
          console.error("zatca-invoice log failure", logError),
        );
      }
      throw error;
    } finally {
      if (!sequenceFinalized && !sequenceBlocked) {
        const { error: releaseError } = await admin.rpc(
          "release_zatca_sequence",
          {
            p_onboarding_id: setup.id,
            p_reservation_token: reservationToken,
          },
        );
        if (releaseError)
          console.error("zatca-invoice sequence release", releaseError);
      }
    }
  } catch (error: any) {
    console.error("zatca-invoice", error);
    const status = error?.zatcaStatus === "ambiguous" ? "ambiguous" : undefined;
    return respond(
      {
        error: error?.message ?? "Unexpected error",
        ...(status ? { status, retryable: false } : {}),
      },
      status ? 503 : 500,
    );
  }
});
