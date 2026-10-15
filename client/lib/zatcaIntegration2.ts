/**
 * ZATCA Six Document Types Support
 * Helper to generate correct XML for all 6 compliance test types
 */

export type DocumentType = "invoice" | "creditNote" | "debitNote";
export type InvoiceClassification = "standard" | "simplified";

/**
 * Get the correct InvoiceTypeCode per ZATCA UBL spec
 * Standard (معياري): 388=Invoice, 381=CreditNote, 383=DebitNote  
 * Simplified (مبسط): 0200003=Invoice, 0200002=CreditNote, 0200001=DebitNote
 */
export function getInvoiceTypeCode(
  documentType: DocumentType,
  classification: InvoiceClassification
): string {
  if (classification === "simplified") {
    switch (documentType) {
      case "invoice":
        return "0200003";
      case "creditNote":
        return "0200002";
      case "debitNote":
        return "0200001";
    }
  } else {
    // standard
    switch (documentType) {
      case "invoice":
        return "388";
      case "creditNote":
        return "381";
      case "debitNote":
        return "383";
    }
  }
}

/**
 * Get the correct XML root element name
 */
export function getRootElement(documentType: DocumentType): string {
  switch (documentType) {
    case "invoice":
      return "Invoice";
    case "creditNote":
      return "CreditNote";
    case "debitNote":
      return "DebitNote";
  }
}

/**
 * Get the namespace URI for the document type
 */
export function getNamespaceURI(documentType: DocumentType): string {
  const element = getRootElement(documentType);
  return `urn:oasis:names:specification:ubl:schema:xsd:${element}-2`;
}

/**
 * Document type labels for UI
 */
export const DOCUMENT_TYPE_LABELS = {
  "invoice-standard": "فاتورة معيارية (388)",
  "invoice-simplified": "فاتورة مبسطة (0200003)",
  "creditNote-standard": "إشعار دائن معياري (381)",
  "creditNote-simplified": "إشعار دائن مبسط (0200002)",
  "debitNote-standard": "إشعار مدين معياري (383)",
  "debitNote-simplified": "إشعار مدين مبسط (0200001)",
} as const;

/**
 * All six types for sequential compliance testing
 */
export const COMPLIANCE_DOCUMENT_TYPES: Array<{
  documentType: DocumentType;
  invoiceType: InvoiceClassification;
}> = [
  { documentType: "invoice", invoiceType: "standard" },
  { documentType: "creditNote", invoiceType: "standard" },
  { documentType: "debitNote", invoiceType: "standard" },
  { documentType: "invoice", invoiceType: "simplified" },
  { documentType: "creditNote", invoiceType: "simplified" },
  { documentType: "debitNote", invoiceType: "simplified" },
];
