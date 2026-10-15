import { useState, useCallback, useEffect } from "react";
import {
  createZATCAService,
  ZATCAService,
  ZATCAConfig,
  ZATCAInvoice,
  COMPLIANCE_DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
} from "@/lib/zatcaIntegration";
import { supabase } from "@/lib/supabaseClient";

interface ZATCAResult {
  success: boolean;
  uuid?: string;
  error?: string;
  message?: string;
}

export interface ComplianceTestResult {
  documentType: string;
  label: string;
  status: "pending" | "testing" | "passed" | "failed";
  message?: string;
  error?: string;
}

export function useZATCA() {
  const [service, setService] = useState<ZATCAService | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [config, setConfig] = useState<ZATCAConfig | null>(null);

  // تحميل إعدادات ZATCA من قاعدة البيانات
  useEffect(() => {
    const loadZATCAConfig = async () => {
      try {
        const { data: orgData } = await supabase.auth.getUser();
        if (!orgData.user) return;

        // جلب إعدادات ZATCA من جدول zatca_integration
        const { data } = await supabase
          .from("zatca_integration")
          .select("*")
          .limit(1)
          .single();

        if (data) {
          const zatcaConfig: ZATCAConfig = {
            mode: data.sandbox_mode ? "sandbox" : "production",
            // Reporting API الرسمي — بوابة Fatoora
            apiUrl: data.sandbox_mode
              ? "https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal"
              : "https://gw-fatoora.zatca.gov.sa/e-invoicing/core",
            companyVAT: "", // سيتم ملؤها من بيانات المنظمة
            companyName: "",
            companyNameAr: "",
            companyAddress: "",
            companyEmail: "",
            companyPhone: "",
            ccsid: data.ccsid,
            csid: data.csid,
            secret: data.secret,
          };

          setConfig(zatcaConfig);
          setService(createZATCAService(zatcaConfig));
        }
      } catch (error) {
        console.error("Error loading ZATCA config:", error);
      }
    };

    loadZATCAConfig();
  }, []);

  // اختبار الاتصال بـ ZATCA
  const testConnection = useCallback(async () => {
    if (!service) return;

    setIsLoading(true);
    try {
      const result = await service.testConnection();
      setIsConnected(result.connected);
      return result;
    } catch (error) {
      console.error("Connection test error:", error);
      setIsConnected(false);
      return {
        connected: false,
        message: "فشل اختبار الاتصال",
      };
    } finally {
      setIsLoading(false);
    }
  }, [service]);

  // تقديم الفاتورة للمسح (B2B/B2G)
  const submitInvoiceForClearance = useCallback(
    async (invoice: ZATCAInvoice): Promise<ZATCAResult> => {
      if (!service) return { success: false, error: "خدمة ZATCA غير مهيأة" };

      setIsLoading(true);
      try {
        // توليد XML
        const invoiceXML = service.generateInvoiceXML(invoice);

        const uuid = invoice.uuid || crypto.randomUUID();

        // المسح عبر الخادم (يتجنب CORS ويُبقي المفاتيح على السيرفر)
        const res = await fetch("/api/zatca/clear", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: config?.mode || "sandbox",
            csid: config?.csid,
            secret: config?.secret,
            invoiceXml: invoiceXML,
            uuid,
          }),
        });
        const result = await res.json();

        if (result.ok) {
          // حفظ نتائج ZATCA في قاعدة البيانات
          await supabase
            .from("sales_invoices")
            .update({
              uuid,
              icv: result?.invoiceHash,
              cryptographic_stamp: result?.data?.clearedInvoice,
              zatca_status: "cleared",
              zatca_response: result?.data ?? result,
            })
            .eq("invoice_number", invoice.invoiceNumber);

          return {
            success: true,
            uuid,
            message: "تم المسح والموافقة بنجاح",
          };
        }

        return {
          success: false,
          error: result.error || "خطأ في المسح",
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "خطأ غير معروف",
        };
      } finally {
        setIsLoading(false);
      }
    },
    [service]
  );

  // تقديم الفاتورة المبسطة للإبلاغ (B2C)
  const submitSimplifiedInvoice = useCallback(
    async (invoice: ZATCAInvoice): Promise<ZATCAResult> => {
      if (!service) return { success: false, error: "خدمة ZATCA غير مهيأة" };

      setIsLoading(true);
      try {
        // توليد XML
        const invoiceXML = service.generateInvoiceXML(invoice);
        const uuid = invoice.uuid || crypto.randomUUID();

        // الإبلاغ عبر الخادم (يتجنب CORS ويُبقي المفاتيح على السيرفر)
        const res = await fetch("/api/zatca/report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: config?.mode || "sandbox",
            csid: config?.csid,
            secret: config?.secret,
            invoiceXml: invoiceXML,
            uuid,
          }),
        });
        const result = await res.json();
        const reportingStatus = result?.data?.reportingStatus;

        // حفظ نتيجة الإبلاغ (نجاح أو فشل) للمراجعة
        await supabase
          .from("sales_invoices")
          .update({
            uuid,
            icv: result?.invoiceHash,
            zatca_status: result.ok
              ? reportingStatus === "REPORTED"
                ? "reported"
                : "reported_with_warnings"
              : "reporting_failed",
            zatca_response: result?.data ?? result,
            zatca_reported_at: result.ok ? new Date().toISOString() : null,
          })
          .eq("invoice_number", invoice.invoiceNumber);

        if (result.ok) {
          return {
            success: true,
            uuid,
            message:
              reportingStatus === "REPORTED"
                ? "تم الإبلاغ بنجاح"
                : "تم الإبلاغ مع وجود تحذيرات",
          };
        }

        return {
          success: false,
          error: result.error || "خطأ في الإبلاغ",
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "خطأ غير معروف",
        };
      } finally {
        setIsLoading(false);
      }
    },
    [service]
  );

  // تحميل نموذج الفاتورة من البيانات الموجودة
  const buildInvoiceFromData = useCallback(
    async (invoiceId: string): Promise<ZATCAInvoice | null> => {
      try {
        const { data } = await supabase
          .from("sales_invoices")
          .select("*")
          .eq("id", invoiceId)
          .single();

        if (!data) return null;

        // تحويل بيانات قاعدة البيانات إلى نموذج ZATCA
        return {
          invoiceNumber: data.invoice_number || data.id,
          documentType: "invoice" as const, // افتراضي: فاتورة عادية
          invoiceType: data.buyer_vat ? "standard" : "simplified",
          issueDate: new Date(data.date),
          dueDate: data.due_date ? new Date(data.due_date) : undefined,
          buyerName: data.customer || "",
          buyerNameAr: data.customer || "",
          buyerVAT: data.buyer_vat,
          buyerAddress: data.customer_address || "",
          sellerVAT: config?.companyVAT || "",
          sellerName: config?.companyName || "",
          sellerNameAr: config?.companyNameAr || "",
          sellerAddress: config?.companyAddress || "",
          lineItems: data.items || [],
          subtotal: parseFloat(data.subtotal) || 0,
          totalTax: parseFloat(data.total_tax) || 0,
          total: parseFloat(data.total) || 0,
        };
      } catch (error) {
        console.error("Error building invoice:", error);
        return null;
      }
    },
    [config]
  );

  // تشغيل فحص التوافق الكامل (الأنواع الستة)
  const runFullComplianceTest = useCallback(
    async (
      onProgress: (results: ComplianceTestResult[]) => void
    ): Promise<ComplianceTestResult[]> => {
      if (!service || !config)
        return [
          {
            documentType: "all",
            label: "جميع الأنواع",
            status: "failed",
            error: "خدمة ZATCA غير مهيأة",
          },
        ];

      const results: ComplianceTestResult[] = [];

      // بيانات اختبار ثابتة (سيتم إضافة documentType و invoiceType لكل نوع)
      const baseInvoice = {
        invoiceNumber: `TEST-${Date.now()}`,
        issueDate: new Date(),
        buyerName: "العميل التجريبي",
        buyerNameAr: "العميل التجريبي",
        buyerAddress: "الرياض",
        sellerVAT: config.companyVAT || "300000000000003",
        sellerName: config.companyName || "شركة تجريبية",
        sellerNameAr: config.companyNameAr || "شركة تجريبية",
        sellerAddress: config.companyAddress || "الرياض",
        lineItems: [
          {
            description: "Test Item",
            descriptionAr: "عنصر تجريبي",
            quantity: 1,
            unitPrice: 100,
            taxCategory: "S" as const,
            taxPercent: 15,
            total: 115,
          },
        ],
        subtotal: 100,
        totalTax: 15,
        total: 115,
      };

      // تشغيل الاختبار لكل نوع
      for (const docType of COMPLIANCE_DOCUMENT_TYPES) {
        const label = DOCUMENT_TYPE_LABELS[
          `${docType.documentType}-${docType.invoiceType}`
        ] as string;

        const testResult: ComplianceTestResult = {
          documentType: `${docType.documentType}-${docType.invoiceType}`,
          label,
          status: "testing",
        };

        results.push(testResult);
        onProgress(results);

        try {
          // بناء الفاتورة التجريبية
          const invoice: ZATCAInvoice = {
            ...baseInvoice,
            documentType: docType.documentType,
            invoiceType: docType.invoiceType,
            uuid: crypto.randomUUID(),
            originalInvoiceNumber:
              docType.documentType !== "invoice"
                ? `ORIG-${Date.now()}`
                : undefined,
          };

          // توليد XML
          const invoiceXML = service.generateInvoiceXML(invoice);

          // فحص التوافق عبر الخادم
          const res = await fetch("/api/zatca/compliance-check", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mode: config.mode || "sandbox",
              csid: config.csid,
              secret: config.secret,
              invoiceXml: invoiceXML,
              uuid: invoice.uuid,
            }),
          });

          const result = await res.json();

          if (result.ok) {
            testResult.status = "passed";
            testResult.message = "✓ نجح الاختبار";
          } else {
            testResult.status = "failed";
            testResult.error = result.error || "فشل الاختبار";
          }
        } catch (error) {
          testResult.status = "failed";
          testResult.error =
            error instanceof Error
              ? error.message
              : "خطأ غير معروف";
        }

        // تحديث التقدم
        onProgress([...results]);
      }

      return results;
    },
    [service, config]
  );

  return {
    service,
    config,
    isConnected,
    isLoading,
    testConnection,
    submitInvoiceForClearance,
    submitSimplifiedInvoice,
    buildInvoiceFromData,
    runFullComplianceTest,
  };
}
