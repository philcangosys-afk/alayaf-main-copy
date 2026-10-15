/**
 * ZATCA (الهيئة العامة للزكاة والدخل والجمارك) Integration Service
 * يدعم المرحلة الثانية من الفاتورة الإلكترونية (Fatoora)
 * 
 * المرحلة الثانية: التكامل مع منصة Fatoora
 * - B2B/B2G: يتطلب المسح والموافقة (Clearance) قبل الإرسال للعميل
 * - B2C: يتم الإبلاغ عن الفاتورة خلال 24 ساعة (Reporting)
 */

import crypto from "crypto";

export interface ZATCAConfig {
  // بيانات Sandbox/Production
  mode: "sandbox" | "production";
  apiUrl: string;
  
  // بيانات الشركة
  companyVAT: string;
  companyName: string;
  companyNameAr: string;
  companyAddress: string;
  companyEmail: string;
  companyPhone: string;
  
  // الشهادات
  ccsid?: string; // Compliance Cryptographic Stamp Identifier
  csid?: string;  // Production/Compliance CSID (username في Basic Auth)
  secret?: string; // Secret المرافق للـ CSID (password في Basic Auth)

  // مفاتيح التشفير
  privateKey?: string;
  publicCert?: string;
}

/**
 * نتيجة الإبلاغ عن الفاتورة وفق Reporting API الرسمي
 */
export interface ZATCAReportingResult {
  success: boolean;
  status?: number;
  reportingStatus?: string; // REPORTED | NOT_REPORTED
  validationResults?: unknown;
  raw?: unknown;
  error?: string;
}

export interface InvoiceLineItem {
  description: string;
  descriptionAr: string;
  quantity: number;
  unitPrice: number;
  taxCategory: "S" | "Z" | "E" | "O"; // Standard, Zero, Exempt, Out of scope
  taxPercent: number;
  total: number;
}

export interface ZATCAInvoice {
  // بيانات أساسية
  invoiceNumber: string;
  // documentType: الوثيقة (invoice/creditNote/debitNote)
  // invoiceType: الفئة (standard/simplified)
  documentType: "invoice" | "creditNote" | "debitNote";
  invoiceType: "standard" | "simplified";
  issueDate: Date;
  dueDate?: Date;

  // للإشعارات: مرجع للفاتورة الأصلية
  originalInvoiceNumber?: string; // رقم الفاتورة المرجعية (للدائن والمدين)

  // المشتري
  buyerName: string;
  buyerNameAr: string;
  buyerVAT?: string; // اختياري للأفراد
  buyerAddress: string;

  // البائع (الشركة)
  sellerVAT: string;
  sellerName: string;
  sellerNameAr: string;
  sellerAddress: string;

  // البيانات المالية
  lineItems: InvoiceLineItem[];
  subtotal: number;
  totalTax: number;
  total: number;

  // بيانات ZATCA (يتم ملؤها بعد المعالجة)
  uuid?: string;
  icv?: string; // Invoice Cryptographic Value
  pih?: string; // Previous Invoice Hash
  qrCode?: string;
  cryptographicStamp?: string;
}

export class ZATCAService {
  private config: ZATCAConfig;
  private previousInvoiceHash: string = "";

  constructor(config: ZATCAConfig) {
    this.config = config;
  }

  /**
   * حساب قيمة الفاتورة التشفيرية (Invoice Cryptographic Value - ICV)
   * يتم حسابها من: الإجمالي الفرعي + إجمالي الضريبة
   */
  calculateICV(subtotal: number, totalTax: number): string {
    const icvData = `${subtotal.toFixed(2)}${totalTax.toFixed(2)}`;
    return crypto
      .createHash("sha256")
      .update(icvData)
      .digest("hex")
      .substring(0, 32);
  }

  /**
   * حساب هاش الفاتورة السابقة (Previous Invoice Hash - PIH)
   * يستخدم لربط الفواتير المتسلسلة
   */
  calculatePIH(previousInvoiceXML: string): string {
    return crypto
      .createHash("sha256")
      .update(previousInvoiceXML)
      .digest("hex")
      .substring(0, 32);
  }

  /**
   * توليد UUID فريد للفاتورة
   */
  generateUUID(): string {
    return crypto.randomUUID();
  }

  /**
   * توليد بيانات كود QR وفقاً لمواصفات ZATCA
   * يتضمن 9 حقول (Tags) بصيغة TLV (Tag-Length-Value)
   */
  generateQRData(invoice: ZATCAInvoice): string {
    // بيانات QR (9 tags أساسية):
    // 1. Company Name (AR)
    // 2. Company VAT
    // 3. Invoice Date/Time
    // 4. Invoice Total
    // 5. Invoice Tax
    // 6. Invoice Hash
    // 7. ECDSA Signature
    // 8. ECDSA Public Key
    // 9. Certificate (optional)

    const qrContent = {
      sellerName: this.config.companyNameAr,
      sellerVAT: this.config.companyVAT,
      invoiceDateTime: invoice.issueDate.toISOString(),
      invoiceTotal: invoice.total.toFixed(2),
      invoiceTax: invoice.totalTax.toFixed(2),
      invoiceHash: invoice.icv || "00000000000000000000000000000000",
    };

    // تحويل البيانات إلى JSON وتشفيرها
    return Buffer.from(JSON.stringify(qrContent)).toString("base64");
  }

  /**
   * توليد ملف XML بصيغة UBL 2.1 المعتمدة من ZATCA
   */
  generateInvoiceXML(invoice: ZATCAInvoice): string {
    const issueDateTime = invoice.issueDate.toISOString().split(".")[0] + "Z";
    const dueDateTime = invoice.dueDate
      ? invoice.dueDate.toISOString().split(".")[0] + "Z"
      : issueDateTime;

    // حساب القيم
    const icv = this.calculateICV(invoice.subtotal, invoice.totalTax);
    const uuid = invoice.uuid || this.generateUUID();
    const qrData = this.generateQRData(invoice);

    // حساب رمز النوع والعنصر الجذر
    const invoiceTypeCode = this.getInvoiceTypeCode(
      invoice.documentType,
      invoice.invoiceType
    );
    const rootElement = this.getRootElement(invoice.documentType);
    const namespaceUri = `urn:oasis:names:specification:ubl:schema:xsd:${rootElement}-2`;

    // بناء XML وفقاً لمواصفات ZATCA UBL 2.1
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<${rootElement} xmlns="${namespaceUri}"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">

  <!-- معرف الوثيقة -->
  <cbc:ID>${invoice.invoiceNumber}</cbc:ID>
  <cbc:UUID>${uuid}</cbc:UUID>
  <cbc:IssueDate>${invoice.issueDate.toISOString().split("T")[0]}</cbc:IssueDate>
  <cbc:IssueTime>${issueDateTime.split("T")[1]}</cbc:IssueTime>
  ${invoice.dueDate ? `<cbc:DueDate>${invoice.dueDate.toISOString().split("T")[0]}</cbc:DueDate>` : ""}

  <!-- نوع الوثيقة -->
  <cbc:InvoiceTypeCode>${invoiceTypeCode}</cbc:InvoiceTypeCode>

  ${
    (invoice.documentType === "creditNote" ||
      invoice.documentType === "debitNote") &&
    invoice.originalInvoiceNumber
      ? `<!-- مرجع الفاتورة الأصلية -->
  <cac:BillingReference>
    <cac:InvoiceDocumentReference>
      <cbc:ID>${invoice.originalInvoiceNumber}</cbc:ID>
    </cac:InvoiceDocumentReference>
  </cac:BillingReference>
  `
      : ""
  }
  
  <!-- المنطقة النقدية -->
  <cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>
  
  <!-- البائع (الشركة) -->
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PostalAddress>
        <cbc:StreetName>${this.escapeXML(this.config.companyAddress)}</cbc:StreetName>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${this.config.companyVAT}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${this.escapeXML(this.config.companyName)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  
  <!-- المشتري -->
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PostalAddress>
        <cbc:StreetName>${this.escapeXML(invoice.buyerAddress)}</cbc:StreetName>
      </cac:PostalAddress>
      ${
        invoice.buyerVAT
          ? `<cac:PartyTaxScheme>
        <cbc:CompanyID>${invoice.buyerVAT}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>`
          : ""
      }
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${this.escapeXML(invoice.buyerName)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  
  <!-- خطوط الفاتورة -->
  <cac:InvoiceLine>
    ${invoice.lineItems
      .map(
        (item, index) => `
    <cbc:ID>${index + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">${item.quantity}</cbc:InvoicedQuantity>
    <cac:Item>
      <cbc:Description>${this.escapeXML(item.description)}</cbc:Description>
      <cbc:Name>${this.escapeXML(item.descriptionAr)}</cbc:Name>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="SAR">${item.unitPrice.toFixed(2)}</cbc:PriceAmount>
    </cac:Price>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="SAR">${(item.quantity * item.unitPrice * (item.taxPercent / 100)).toFixed(2)}</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="SAR">${(item.quantity * item.unitPrice).toFixed(2)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="SAR">${(item.quantity * item.unitPrice * (item.taxPercent / 100)).toFixed(2)}</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:ID>${item.taxCategory}</cbc:ID>
          <cbc:Percent>${item.taxPercent}</cbc:Percent>
          <cac:TaxScheme>
            <cbc:ID>VAT</cbc:ID>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:LineExtensionAmount currencyID="SAR">${item.total.toFixed(2)}</cac:LineExtensionAmount>
    `
      )
      .join("")}
  </cac:InvoiceLine>
  
  <!-- الإجمالي -->
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="SAR">${invoice.subtotal.toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxInclusiveAmount currencyID="SAR">${invoice.total.toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="SAR">${invoice.total.toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  
  <!-- البيانات التشفيرية -->
  <cbc:ICV>${icv}</cbc:ICV>
  <cbc:QRCode>${qrData}</cbc:QRCode>

</${rootElement}>`;

    return xml;
  }

  /**
   * الحصول على رمز نوع الفاتورة الصحيح
   * معياري: 388, 381, 383
   * مبسط: 0200003, 0200002, 0200001
   */
  private getInvoiceTypeCode(
    documentType: string,
    invoiceType: string
  ): string {
    if (invoiceType === "simplified") {
      switch (documentType) {
        case "creditNote":
          return "0200002";
        case "debitNote":
          return "0200001";
        default:
          return "0200003"; // invoice
      }
    } else {
      // standard
      switch (documentType) {
        case "creditNote":
          return "381";
        case "debitNote":
          return "383";
        default:
          return "388"; // invoice
      }
    }
  }

  /**
   * الحصول على العنصر الجذر للـ XML
   */
  private getRootElement(documentType: string): string {
    switch (documentType) {
      case "creditNote":
        return "CreditNote";
      case "debitNote":
        return "DebitNote";
      default:
        return "Invoice";
    }
  }

  /**
   * تنظيف نصوص XML من الأحرف الخاصة
   */
  private escapeXML(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  /**
   * إرسال الفاتورة للمسح والموافقة (B2B/B2G - Clearance)
   * يتطلب تشفير وتوقيع الفاتورة
   */
  async clearInvoice(invoiceXML: string): Promise<{
    success: boolean;
    uuid?: string;
    cryptographicStamp?: string;
    qrCode?: string;
    error?: string;
  }> {
    try {
      // في بيئة الإنتاج، سيتم استخدام الـ credentials الفعلية
      // الآن نرسل طلب تجريبي
      const response = await fetch(`${this.config.apiUrl}/invoices/clearance`, {
        method: "POST",
        headers: {
          "Content-Type": "application/xml",
          "Authorization": `Bearer ${this.config.ccsid || "sandbox-token"}`,
        },
        body: invoiceXML,
      });

      if (!response.ok) {
        return {
          success: false,
          error: `ZATCA API Error: ${response.status}`,
        };
      }

      const result = await response.json();

      return {
        success: true,
        uuid: result.uuid,
        cryptographicStamp: result.cryptographicStamp,
        qrCode: result.qrCode,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * بناء ترويسة المصادقة Basic Auth من CSID والـ Secret
   * وفق مواصفات ZATCA: base64("{CSID}:{Secret}")
   */
  private buildAuthHeader(): string {
    const username = this.config.csid || this.config.ccsid || "";
    const password = this.config.secret || "";
    const token =
      typeof btoa !== "undefined"
        ? btoa(`${username}:${password}`)
        : Buffer.from(`${username}:${password}`).toString("base64");
    return `Basic ${token}`;
  }

  /**
   * الإبلاغ عن الفاتورة المبسطة (B2C - Reporting API الرسمي)
   * POST {apiUrl}/invoices/reporting/single
   *
   * @param invoiceHash هاش الفاتورة (base64 SHA-256)
   * @param uuid معرف الفاتورة الفريد
   * @param invoiceBase64 محتوى XML للفاتورة مُرمّز base64
   */
  async reportInvoice(
    invoiceHash: string,
    uuid: string,
    invoiceBase64: string,
    options?: { clearanceStatus?: string; language?: string },
  ): Promise<ZATCAReportingResult> {
    try {
      const response = await fetch(
        `${this.config.apiUrl}/invoices/reporting/single`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "Accept-Version": "V2",
            "accept-language": options?.language || "ar",
            "Clearance-Status": options?.clearanceStatus || "0",
            Authorization: this.buildAuthHeader(),
          },
          body: JSON.stringify({
            invoiceHash,
            uuid,
            invoice: invoiceBase64,
          }),
        },
      );

      const status = response.status;
      let payload: any = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      // 200 = مقبولة، 202 = مقبولة مع تحذيرات
      const success = status === 200 || status === 202;

      return {
        success,
        status,
        reportingStatus: payload?.reportingStatus,
        validationResults: payload?.validationResults,
        raw: payload,
        error: success
          ? undefined
          : this.mapReportingError(status, payload),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * ترجمة رموز أخطاء Reporting API إلى رسائل عربية مفهومة
   */
  private mapReportingError(status: number, payload: any): string {
    const detail =
      payload?.validationResults?.errorMessages
        ?.map((e: any) => e.message)
        .join("، ") || payload?.message;
    switch (status) {
      case 400:
        return `طلب غير صالح (400): ${detail || "تحقق من بيانات الفاتورة"}`;
      case 401:
        return "فشل المصادقة (401): تحقق من CSID والـ Secret";
      case 406:
        return "صيغة غير مقبولة (406): تحقق من الترويسات";
      case 409:
        return "تعارض (409): الفاتورة مُبلّغ عنها مسبقاً";
      case 500:
        return "خطأ في خادم ZATCA (500): أعد المحاولة لاحقاً";
      default:
        return `خطأ ZATCA (${status}): ${detail || "غير معروف"}`;
    }
  }

  /**
   * توافقية مؤقتة: الإبلاغ باستخدام XML مباشرة (يحسب الهاش ويرمّز base64)
   * @deprecated استخدم reportInvoice مع الهاش والـ UUID الصحيحين
   */
  async reportSimplifiedInvoice(
    invoiceXML: string,
    uuid?: string,
  ): Promise<ZATCAReportingResult> {
    const invoiceHash = crypto
      .createHash("sha256")
      .update(invoiceXML)
      .digest("base64");
    const invoiceBase64 =
      typeof btoa !== "undefined"
        ? btoa(unescape(encodeURIComponent(invoiceXML)))
        : Buffer.from(invoiceXML, "utf-8").toString("base64");
    return this.reportInvoice(
      invoiceHash,
      uuid || this.generateUUID(),
      invoiceBase64,
    );
  }

  /**
   * اختبار الاتصال بـ ZATCA Sandbox
   */
  async testConnection(): Promise<{ connected: boolean; message: string }> {
    try {
      const response = await fetch(`${this.config.apiUrl}/compliance/ping`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${this.config.ccsid || "sandbox-token"}`,
        },
      });

      if (response.ok) {
        return {
          connected: true,
          message: "تم الاتصال بنجاح مع ZATCA Sandbox",
        };
      }

      return {
        connected: false,
        message: `خطأ في الاتصال: ${response.status}`,
      };
    } catch (error) {
      return {
        connected: false,
        message: error instanceof Error ? error.message : "خطأ غير معروف",
      };
    }
  }
}

// Six compliance test document types
export const COMPLIANCE_DOCUMENT_TYPES: Array<{
  documentType: "invoice" | "creditNote" | "debitNote";
  invoiceType: "standard" | "simplified";
}> = [
  { documentType: "invoice", invoiceType: "standard" },
  { documentType: "creditNote", invoiceType: "standard" },
  { documentType: "debitNote", invoiceType: "standard" },
  { documentType: "invoice", invoiceType: "simplified" },
  { documentType: "creditNote", invoiceType: "simplified" },
  { documentType: "debitNote", invoiceType: "simplified" },
];

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  "invoice-standard": "فاتورة معيارية (388)",
  "creditNote-standard": "إشعار دائن معياري (381)",
  "debitNote-standard": "إشعار مدين معياري (383)",
  "invoice-simplified": "فاتورة مبسطة (0200003)",
  "creditNote-simplified": "إشعار دائن مبسط (0200002)",
  "debitNote-simplified": "إشعار مدين مبسط (0200001)",
};

// Export helper functions
export function createZATCAService(config: ZATCAConfig): ZATCAService {
  return new ZATCAService(config);
}
