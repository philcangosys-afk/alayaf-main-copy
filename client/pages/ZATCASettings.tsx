import { useEffect, useMemo, useState } from "react";
import Layout from "@/components/Layout";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { COMPANY_PROFILE, PLATFORM_NAME_EN, zatcaDeviceSerialKey } from "@/lib/companyProfile";
import ZatcaPhaseCard from "@/components/zatca/ZatcaPhaseCard";
import { useCompany } from "@/lib/companyContext";
import {
  AlertCircle,
  Building2,
  Check,
  FileKey2,
  Loader2,
  MonitorCog,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

type SetupStatus =
  | "identity_saved"
  | "csr_generated"
  | "compliance_ready"
  | "compliance_testing"
  | "compliance_passed"
  | "failed";

type ZatcaMode = "simulation" | "production";

type SetupMetadata = {
  id: string;
  mode: ZatcaMode;
  company_name_ar: string;
  company_name_en?: string;
  vat_number: string;
  commercial_registration: string;
  branch_name: string;
  branch_location: string;
  industry: string;
  device_manufacturer: string;
  device_model: string;
  device_serial: string;
  common_name: string;
  invoice_type: "1000" | "0100" | "1100";
  status: SetupStatus;
  compliance_request_id?: string;
  compliance_csid_masked?: string;
  compliance_issued_at?: string;
  production_request_id?: string;
  production_csid_masked?: string;
  production_issued_at?: string;
  certificate_expires_at?: string;
  production_status?: "not_requested" | "issued" | "failed";
  production_enabled?: boolean;
  compliance_results?: ComplianceResult[];
  last_error?: string;
  updated_at?: string;
};

type ComplianceResult = {
  caseIndex?: number;
  documentType: string;
  label: string;
  status: "pending" | "testing" | "passed" | "failed";
  message?: string;
  httpStatus?: number;
  invoiceHash?: string;
  validationResults?: {
    errorMessages?: Array<{ code?: string; message?: string }>;
    warningMessages?: Array<{ code?: string; message?: string }>;
  };
};

type IdentityForm = {
  companyNameAr: string;
  companyNameEn: string;
  vatNumber: string;
  commercialRegistration: string;
  branchName: string;
  branchLocation: string;
  buildingNumber: string;
  streetName: string;
  district: string;
  city: string;
  postalCode: string;
  additionalNumber: string;
  shortAddress: string;
  vatEffectiveDate: string;
  industry: string;
  deviceManufacturer: string;
  deviceModel: string;
  deviceSerial: string;
  commonName: string;
  invoiceType: "1000" | "0100" | "1100";
};

/** لكل منشأة مفتاحها في المتصفح */
const activeProductionDeviceKey = () => zatcaDeviceSerialKey();

/** القيم الأولية لنموذج الربط: من بيانات المنشأة الحالية، وعنوان المنشأة يُدخل يدويًا كما في العنوان الوطني */
const buildInitialIdentity = (): IdentityForm => ({
  companyNameAr: COMPANY_PROFILE.companyNameAr,
  companyNameEn: COMPANY_PROFILE.companyNameEn,
  vatNumber: COMPANY_PROFILE.vatNumber,
  commercialRegistration: COMPANY_PROFILE.commercialRegistration,
  branchName: "الفرع الرئيسي",
  branchLocation: COMPANY_PROFILE.addressAr,
  buildingNumber: "",
  streetName: "",
  district: "",
  city: COMPANY_PROFILE.city,
  postalCode: "",
  additionalNumber: "",
  shortAddress: "",
  vatEffectiveDate: "",
  industry: "",
  deviceManufacturer: PLATFORM_NAME_EN,
  deviceModel: "Web EGS V1",
  deviceSerial: `EGS-${COMPANY_PROFILE.code || "0000"}-001`,
  commonName: `EGS-${COMPANY_PROFILE.code || "0000"}-001`,
  invoiceType: "1100",
});

const complianceDocuments = [
  { caseIndex: 0, scope: "standard", label: "فاتورة ضريبية معيارية B2B" },
  { caseIndex: 1, scope: "standard", label: "إشعار دائن معياري B2B" },
  { caseIndex: 2, scope: "standard", label: "إشعار مدين معياري B2B" },
  { caseIndex: 3, scope: "simplified", label: "فاتورة ضريبية مبسطة B2C" },
  { caseIndex: 4, scope: "simplified", label: "إشعار دائن مبسط B2C" },
  { caseIndex: 5, scope: "simplified", label: "إشعار مدين مبسط B2C" },
] as const;

const onboardingSteps = [
  { number: 1, label: "بيانات المنشأة", Icon: Building2 },
  { number: 2, label: "OTP وتهيئة الجهاز", Icon: FileKey2 },
  { number: 3, label: "شهادة التوافق", Icon: ShieldCheck },
  { number: 4, label: "اختبارات التوافق", Icon: MonitorCog },
  { number: 5, label: "اعتماد تشغيل المحاكاة التجريبي", Icon: ShieldCheck },
];

const statusLabels: Record<SetupStatus, string> = {
  identity_saved: "تم حفظ بيانات المنشأة",
  csr_generated: "CSR جاهز — بانتظار OTP",
  compliance_ready: "تم الحصول على Compliance CSID",
  compliance_testing: "جاري فحص التوافق",
  compliance_passed: "اجتاز فحص التوافق",
  failed: "آخر محاولة تهيئة لم تنجح",
};

const auditActionLabels: Record<string, string> = {
  csr_generated: "توليد CSR والمفتاح الخاص",
  compliance_csid_requested: "طلب شهادة التوافق من ZATCA",
  "compliance_test_standard-invoice": "فحص فاتورة معيارية B2B",
  "compliance_test_standard-credit": "فحص إشعار دائن معياري B2B",
  "compliance_test_standard-debit": "فحص إشعار مدين معياري B2B",
  "compliance_test_simplified-invoice": "فحص فاتورة مبسطة B2C",
  "compliance_test_simplified-credit": "فحص إشعار دائن مبسط B2C",
  "compliance_test_simplified-debit": "فحص إشعار مدين مبسط B2C",
  branch_location_updated: "تحديث عنوان الفواتير المسجل",
  production_activated: "تفعيل الإنتاج الحقيقي يدويًا",
  production_deactivated: "تعطيل الإنتاج الحقيقي",
};

function getAuditDetailMessage(item: any) {
  if (item?.result !== "failed") return "";
  const details = item?.details ?? {};
  const response = details?.response ?? {};
  const errors = Array.isArray(response?.errors)
    ? response.errors.map((error: unknown) =>
        typeof error === "string"
          ? error
          : String((error as { message?: unknown })?.message ?? ""),
      )
    : [];
  return [
    details?.code,
    details?.message,
    response?.code,
    response?.message,
    response?.errorMessage,
    response?.dispositionMessage,
    ...errors,
  ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(" — ");
}

export default function ZATCASettings() {
  const [identity, setIdentity] = useState<IdentityForm>(() => {
    const activeProductionSerial = localStorage.getItem(
      activeProductionDeviceKey(),
    );
    return activeProductionSerial
      ? {
          ...buildInitialIdentity(),
          deviceSerial: activeProductionSerial,
          commonName: activeProductionSerial,
        }
      : buildInitialIdentity();
  });
  const [selectedMode, setSelectedMode] = useState<ZatcaMode>("simulation");
  // المرحلة الأولى لا تحتاج الربط ولا OTP: قسم المرحلة الثانية مطوي حتى يفتحه المستخدم
  const company = useCompany();
  const companyPhase1 = company.company?.zatca_phase === "phase1";
  const [showPhase2Setup, setShowPhase2Setup] = useState(false);
  const phase2SetupHidden = companyPhase1 && !showPhase2Setup;
  const [setup, setSetup] = useState<SetupMetadata | null>(null);
  const [audit, setAudit] = useState<any[]>([]);
  const [otp, setOtp] = useState("");
  const [activationPhrase, setActivationPhrase] = useState("");
  const [legalEnglishConfirmed, setLegalEnglishConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<
    | "prepare"
    | "address"
    | "onboard"
    | "refresh"
    | "compliance"
    | "production"
    | "activate"
    | "deactivate"
    | "reset"
    | null
  >(null);

  const invoke = async (
    body: Record<string, unknown>,
    mode: ZatcaMode = selectedMode,
  ) => {
    const { data, error } = await supabase.functions.invoke(
      "zatca-onboarding",
      {
        body: {
          ...body,
          mode,
          deviceSerial: identity.deviceSerial,
        },
      },
    );
    if (error || data?.error) {
      let payload = data;
      const context = (error as { context?: Response } | null)?.context;
      if (!payload && context) {
        payload = await context
          .clone()
          .json()
          .catch(() => null);
      }

      const response = payload?.details?.response;
      const responseErrors = Array.isArray(response?.errors)
        ? response.errors
            .map((item: unknown) =>
              typeof item === "string"
                ? item
                : String((item as { message?: unknown })?.message ?? ""),
            )
            .filter(Boolean)
        : [];
      const messages = [
        payload?.error,
        response?.dispositionMessage,
        response?.message,
        ...responseErrors,
      ]
        .map((item) => String(item ?? "").trim())
        .filter(Boolean);
      const safeMessage = [...new Set(messages)].join(" — ");

      throw new Error(
        safeMessage ||
          "لم تكتمل العملية. راجع السجل الآمن في الخادم دون عرض بيانات الاعتماد.",
      );
    }
    return data;
  };

  const loadStatus = async (quiet = false, mode: ZatcaMode = selectedMode) => {
    if (!quiet) setAction("refresh");
    try {
      const data = await invoke({ action: "status" }, mode);
      setSetup(data.setup ?? null);
      setAudit(data.audit ?? []);
      if (!quiet) {
        toast({
          title: "الاتصال الآمن يعمل",
          description: data.setup
            ? `حالة التهيئة: ${statusLabels[data.setup.status as SetupStatus] ?? data.setup.status}`
            : "لا توجد تهيئة سابقة. راجع البيانات ثم ولّد CSR.",
        });
      }
      if (data.setup) {
        if (mode === "production" && data.setup.device_serial) {
          localStorage.setItem(
            activeProductionDeviceKey(),
            data.setup.device_serial,
          );
        }
        setIdentity({
          companyNameAr:
            data.setup.company_name_ar ?? buildInitialIdentity().companyNameAr,
          companyNameEn:
            data.setup.company_name_en ?? buildInitialIdentity().companyNameEn,
          vatNumber: data.setup.vat_number ?? buildInitialIdentity().vatNumber,
          commercialRegistration:
            data.setup.commercial_registration ??
            buildInitialIdentity().commercialRegistration,
          branchName: data.setup.branch_name ?? buildInitialIdentity().branchName,
          branchLocation:
            data.setup.branch_location ?? buildInitialIdentity().branchLocation,
          buildingNumber:
            data.setup.building_number ?? buildInitialIdentity().buildingNumber,
          streetName: data.setup.street_name ?? buildInitialIdentity().streetName,
          district: data.setup.district ?? buildInitialIdentity().district,
          city: data.setup.city ?? buildInitialIdentity().city,
          postalCode: data.setup.postal_code ?? buildInitialIdentity().postalCode,
          additionalNumber:
            data.setup.additional_number ?? buildInitialIdentity().additionalNumber,
          shortAddress:
            data.setup.short_address ?? buildInitialIdentity().shortAddress,
          vatEffectiveDate:
            data.setup.vat_effective_date ?? buildInitialIdentity().vatEffectiveDate,
          industry: data.setup.industry ?? buildInitialIdentity().industry,
          deviceManufacturer:
            data.setup.device_manufacturer ??
            buildInitialIdentity().deviceManufacturer,
          deviceModel: data.setup.device_model ?? buildInitialIdentity().deviceModel,
          deviceSerial:
            data.setup.device_serial ?? buildInitialIdentity().deviceSerial,
          commonName: data.setup.common_name ?? buildInitialIdentity().commonName,
          invoiceType: data.setup.invoice_type ?? "1100",
        });
      } else {
        setIdentity(buildInitialIdentity());
        setLegalEnglishConfirmed(false);
      }
    } catch (error) {
      if (!quiet) {
        toast({
          title: "تعذر تحميل حالة ZATCA",
          description:
            error instanceof Error ? error.message : "حدث خطأ غير متوقع",
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
      setAction(null);
    }
  };

  useEffect(() => {
    loadStatus(true);
  }, []);

  const requiredComplianceDocuments = useMemo(() => {
    const invoiceType = setup?.invoice_type ?? identity.invoiceType;
    return complianceDocuments.filter((document) => {
      if (invoiceType === "1000") return document.scope === "standard";
      if (invoiceType === "0100") return document.scope === "simplified";
      return true;
    });
  }, [identity.invoiceType, setup?.invoice_type]);

  const setField = <K extends keyof IdentityForm>(
    key: K,
    value: IdentityForm[K],
  ) => setIdentity((current) => ({ ...current, [key]: value }));

  const addressPayload = {
    buildingNumber: identity.buildingNumber,
    streetName: identity.streetName,
    district: identity.district,
    city: identity.city,
    postalCode: identity.postalCode,
    additionalNumber: identity.additionalNumber,
    shortAddress: identity.shortAddress,
    branchLocation: [
      identity.buildingNumber,
      identity.streetName,
      identity.district,
      identity.city,
      identity.postalCode,
      identity.additionalNumber,
    ]
      .filter(Boolean)
      .join("، "),
  };

  const prepare = async () => {
    if (!legalEnglishConfirmed) {
      toast({
        title: "يلزم تأكيد الاسم الإنجليزي",
        description:
          "راجع الاسم الإنجليزي المقترح وعدّله إن لزم، ثم فعّل خانة التأكيد.",
        variant: "destructive",
      });
      return;
    }
    setAction("prepare");
    try {
      const data = await invoke({
        action: "prepare",
        ...identity,
        ...addressPayload,
      });
      toast({
        title:
          selectedMode === "production"
            ? "تم إعداد CSR إنتاج منفصل"
            : "تم تجهيز جهاز المحاكاة",
        description:
          selectedMode === "production"
            ? "تم حفظ بيانات الإنتاج وإعداد CSR منفصل دون طلب OTP أو تفعيل الإنتاج."
            : "تم حفظ بيانات المحاكاة وإعداد CSR دون طلب OTP.",
      });
      await loadStatus(true);
    } catch (error) {
      toast({
        title: "تعذر تجهيز الجهاز",
        description:
          error instanceof Error ? error.message : "تحقق من البيانات",
        variant: "destructive",
      });
    } finally {
      setAction(null);
    }
  };

  const saveBranchLocation = async () => {
    setAction("address");
    try {
      const data = await invoke({
        action: "update_branch_location",
        ...addressPayload,
      });
      toast({
        title: "تم حفظ العنوان",
        description: "تم تحديث حقول عنوان الفواتير المسجلة.",
      });
      await loadStatus(true);
    } catch (error) {
      toast({
        title: "تعذر حفظ العنوان",
        description:
          error instanceof Error ? error.message : "تحقق من العنوان المسجل",
        variant: "destructive",
      });
    } finally {
      setAction(null);
    }
  };

  const onboard = async () => {
    if (!/^\d{6}$/.test(otp)) {
      toast({
        title: "رمز غير صالح",
        description: "أدخل رمز OTP المكون من 6 أرقام",
        variant: "destructive",
      });
      return;
    }
    setAction("onboard");
    try {
      const data = await invoke({ action: "onboard", otp });
      setOtp("");
      toast({
        title:
          selectedMode === "production"
            ? "تم إصدار شهادة التوافق للإنتاج"
            : "نجحت تهيئة المحاكاة",
        description: "تمت معالجة OTP مرة واحدة ولم يتم حفظه في الواجهة.",
      });
      await loadStatus(true);
    } catch (error) {
      toast({
        title: "رفضت ZATCA طلب التهيئة",
        description:
          error instanceof Error ? error.message : "تحقق من OTP والبيانات",
        variant: "destructive",
      });
      await loadStatus(true);
    } finally {
      setAction(null);
    }
  };

  const activateProduction = async () => {
    if (
      !setup?.production_csid_masked ||
      activationPhrase !== "ENABLE_REAL_ZATCA_PRODUCTION"
    )
      return;
    setAction("activate");
    try {
      const data = await invoke({
        action: "activate_production",
        confirmation: activationPhrase,
      });
      setActivationPhrase("");
      toast({
        title: "تم تفعيل الإنتاج الحقيقي",
        description: "اكتمل التفعيل الصريح بعد التحقق من اعتماد الإنتاج.",
      });
      await loadStatus(true);
    } catch (error) {
      toast({
        title: "تعذر تفعيل الإنتاج الحقيقي",
        description:
          error instanceof Error ? error.message : "حدث خطأ أثناء التفعيل",
        variant: "destructive",
      });
    } finally {
      setAction(null);
    }
  };

  const deactivateProduction = async () => {
    setAction("deactivate");
    try {
      const data = await invoke({ action: "deactivate_production" });
      toast({
        title: "تم تعطيل الإنتاج الحقيقي",
        description: "تم إيقاف حالة الإنتاج الحقيقي لهذا الجهاز.",
      });
      await loadStatus(true);
    } catch (error) {
      toast({
        title: "تعذر تعطيل الإنتاج الحقيقي",
        description:
          error instanceof Error ? error.message : "حدث خطأ أثناء التعطيل",
        variant: "destructive",
      });
    } finally {
      setAction(null);
    }
  };

  const requestProductionCsid = async () => {
    setAction("production");
    try {
      const data = await invoke({ action: "request_production_csid" });
      toast({
        title:
          selectedMode === "production"
            ? "تم إصدار Production CSID الحقيقي"
            : "تم إصدار اعتماد تشغيل المحاكاة",
        description:
          selectedMode === "production"
            ? "تم حفظ اعتماد الإنتاج الحقيقي داخل Vault، وما زال إرسال الفواتير معطلاً حتى التفعيل الصريح."
            : "هذا اعتماد تجريبي داخل Simulation وليس اعتماد إنتاج حقيقيًا.",
      });
      await loadStatus(true);
    } catch (error) {
      toast({
        title: "تعذر إصدار Production CSID",
        description:
          error instanceof Error ? error.message : "حدث خطأ أثناء الطلب",
        variant: "destructive",
      });
      await loadStatus(true);
    } finally {
      setAction(null);
    }
  };

  const resetOnboarding = async () => {
    const environmentLabel =
      selectedMode === "production" ? "الإنتاج الحقيقي" : "المحاكاة";
    const confirmed = window.confirm(
      `سيتم حذف اعتماد ${environmentLabel} الحالي ونتائج الاختبارات لبدء تهيئة جديدة. هل تريد المتابعة؟`,
    );
    if (!confirmed) return;
    setAction("reset");
    try {
      const data = await invoke({ action: "reset_onboarding" });
      setSetup(null);
      setAudit([]);
      setOtp("");
      if (selectedMode === "production") {
        localStorage.removeItem(activeProductionDeviceKey());
      }
      toast({
        title: "تم بدء تهيئة جديدة",
        description: `تمت إعادة حالة تهيئة ${environmentLabel} دون عرض أي اعتماد أو سر.`,
      });
    } catch (error) {
      toast({
        title: "تعذر بدء تهيئة جديدة",
        description:
          error instanceof Error
            ? error.message
            : "حدث خطأ أثناء إعادة التهيئة",
        variant: "destructive",
      });
    } finally {
      setAction(null);
    }
  };

  const runComplianceTests = async () => {
    if (
      !setup ||
      !["compliance_ready", "compliance_testing", "compliance_passed"].includes(
        setup.status,
      )
    )
      return;
    setAction("compliance");
    try {
      let passed = 0;
      for (const document of requiredComplianceDocuments) {
        const data = await invoke({
          action: "run_compliance_case",
          caseIndex: document.caseIndex,
          reuseResults: true,
        });
        if (data.result?.status === "passed") passed += 1;
        setSetup((current) =>
          current
            ? {
                ...current,
                status: data.status as SetupStatus,
                compliance_results: [
                  ...(current.compliance_results ?? []).filter(
                    (item) => item.caseIndex !== document.caseIndex,
                  ),
                  data.result as ComplianceResult,
                ].sort(
                  (a, b) => Number(a.caseIndex ?? 0) - Number(b.caseIndex ?? 0),
                ),
              }
            : current,
        );
        if (data.result?.status !== "passed") break;
      }
      await loadStatus(true);
      toast({
        title:
          passed === requiredComplianceDocuments.length
            ? "اجتاز النظام فحص التوافق"
            : "اكتمل فحص التوافق",
        description: `نجح ${passed} من ${requiredComplianceDocuments.length} مستندات`,
        variant:
          passed === requiredComplianceDocuments.length
            ? "default"
            : "destructive",
      });
    } catch (error) {
      await loadStatus(true);
      toast({
        title: "تعذر إكمال فحص التوافق",
        description:
          error instanceof Error ? error.message : "حدث خطأ أثناء الفحص",
        variant: "destructive",
      });
    } finally {
      setAction(null);
    }
  };

  const step = useMemo(() => {
    if (!setup) return 1;
    if (setup.status === "csr_generated" || setup.status === "failed") return 2;
    if (setup.status === "compliance_ready") return 4;
    if (setup.status === "compliance_testing") return 4;
    if (setup.production_csid_masked) return 5;
    if (setup.status === "compliance_passed") return 4;
    return 1;
  }, [setup]);

  const inputClass =
    "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
  const productionCsrPrepared =
    selectedMode === "production" &&
    setup?.mode === "production" &&
    [
      "csr_generated",
      "compliance_ready",
      "compliance_testing",
      "compliance_passed",
    ].includes(setup.status);
  const productionCsidExists =
    selectedMode === "production" && Boolean(setup?.production_csid_masked);
  const addressComplete = [
    identity.buildingNumber,
    identity.streetName,
    identity.district,
    identity.city,
    identity.postalCode,
    identity.additionalNumber,
    identity.shortAddress,
  ].every(Boolean);

  return (
    <Layout>
      <div className="mx-auto max-w-6xl space-y-6 p-2" dir="rtl">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-blue-700">
              الفاتورة الإلكترونية (ZATCA)
            </p>
            <h1 className="mt-1 text-3xl font-bold text-slate-950">
              {companyPhase1 ? "مرحلة الفوترة والربط مع ZATCA" : "إعداد الربط مع ZATCA"}
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              {companyPhase1
                ? "المنشأة في المرحلة الأولى: الفواتير تصدر من النظام برمز QR مباشرة، دون ربط مع الهيئة ولا OTP."
                : "إعداد منفصل وآمن للمحاكاة أو للإنتاج الحقيقي. لا تُرسل فواتير ولا يُطلب OTP تلقائيًا، ولا تُعرض المفاتيح أو الأسرار أو CSID الكامل."}
            </p>
          </div>
          {!phase2SetupHidden && (
            <button
              onClick={() => loadStatus()}
              disabled={Boolean(action)}
              className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw
                className={`h-4 w-4 ${action === "refresh" ? "animate-spin" : ""}`}
              />{" "}
              تحديث الحالة
            </button>
          )}
        </header>

        <ZatcaPhaseCard />

        {phase2SetupHidden ? (
          <section className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">الربط مع الهيئة (المرحلة الثانية)</h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
                  غير مطلوب في المرحلة الأولى. أكمله عند اقتراب موعد إلزام منشأتك بالمرحلة الثانية: بيانات وحدة
                  إصدار الفواتير، ثم رمز OTP من بوابة «فاتورة»، ثم تفعيل جهاز الإنتاج، ثم الانتقال من البطاقة أعلاه.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPhase2Setup(true)}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-100"
              >
                إعداد الربط للمرحلة الثانية
              </button>
            </div>
          </section>
        ) : (
          <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-bold text-slate-900">الربط مع الهيئة (المرحلة الثانية)</h2>
          {companyPhase1 && (
            <button
              type="button"
              onClick={() => setShowPhase2Setup(false)}
              disabled={Boolean(action)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              إخفاء إعداد المرحلة الثانية
            </button>
          )}
        </div>

        <section className="grid gap-4 md:grid-cols-2">
          {[
            {
              mode: "simulation" as const,
              title: "المحاكاة",
              description: "تهيئة واختبارات تجريبية مع ZATCA Simulation فقط.",
            },
            {
              mode: "production" as const,
              title: "الإنتاج الحقيقي",
              description:
                "اعتماد حقيقي قد يسمح بإرسال فواتير ملزمة قانونيًا بعد التفعيل الصريح.",
            },
          ].map((environment) => (
            <button
              key={environment.mode}
              type="button"
              disabled={Boolean(action)}
              onClick={() => {
                setSelectedMode(environment.mode);
                setSetup(null);
                setOtp("");
                setActivationPhrase("");
                loadStatus(false, environment.mode);
              }}
              className={`rounded-2xl border-2 p-5 text-right transition disabled:opacity-50 ${
                selectedMode === environment.mode
                  ? environment.mode === "production"
                    ? "border-rose-500 bg-rose-50"
                    : "border-blue-500 bg-blue-50"
                  : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              <strong className="block text-lg text-slate-950">
                {environment.title}
              </strong>
              <span className="mt-1 block text-sm leading-6 text-slate-600">
                {environment.description}
              </span>
            </button>
          ))}
        </section>

        {selectedMode === "production" && (
          <section className="flex gap-3 rounded-2xl border-2 border-rose-400 bg-rose-50 p-5 text-rose-950">
            <AlertCircle className="mt-0.5 h-6 w-6 shrink-0" />
            <div>
              <strong className="block">تحذير: هذه بيئة الإنتاج الحقيقي</strong>
              <p className="mt-1 text-sm leading-6">
                التحضير وحده لا يفعّل الإنتاج ولا يرسل أي فاتورة. استخدم CSR
                وOTP واعتماد إنتاج منفصلين، ثم نفّذ التفعيل اليدوي فقط بعد
                التحقق الكامل.
              </p>
            </div>
          </section>
        )}

        {selectedMode === "simulation" && (
          <section className="grid gap-3 md:grid-cols-5">
            {onboardingSteps.map(({ number, label, Icon }) => {
              const active = step >= number;
              return (
                <div
                  key={number}
                  className={`rounded-2xl border p-4 ${active ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-white"}`}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`grid h-9 w-9 place-items-center rounded-full ${active ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-400"}`}
                    >
                      {step > number ? (
                        <Check className="h-5 w-5" />
                      ) : (
                        <Icon className="h-5 w-5" />
                      )}
                    </span>
                    <div>
                      <small className="text-slate-500">الخطوة {number}</small>
                      <strong className="block text-sm text-slate-900">
                        {label}
                      </strong>
                    </div>
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {setup && (
          <section
            className={`rounded-2xl border p-4 ${setup.status === "failed" ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <ShieldCheck
                  className={
                    setup.status === "failed"
                      ? "text-rose-600"
                      : "text-emerald-600"
                  }
                />
                <div>
                  <strong className="block text-slate-900">
                    {statusLabels[setup.status]}
                  </strong>
                  <span className="text-xs text-slate-600">
                    البيئة:{" "}
                    {selectedMode === "simulation"
                      ? "المحاكاة فقط"
                      : "الإنتاج الحقيقي"}
                  </span>
                </div>
              </div>
              {setup.compliance_csid_masked && (
                <span className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-slate-700">
                  {selectedMode === "simulation"
                    ? "اعتماد توافق المحاكاة موجود"
                    : "اعتماد التوافق للإنتاج موجود"}
                </span>
              )}
            </div>
            {setup.last_error && (
              <div className="mt-3 rounded-lg bg-white/70 p-3 text-sm text-rose-700">
                <strong className="block">
                  آخر رد محفوظ من المحاولة السابقة
                </strong>
                <span className="mt-1 block">
                  لم تكتمل المحاولة. التفاصيل الحساسة متاحة في سجل الخادم الآمن
                  فقط.
                </span>
                <small className="mt-1 block text-slate-500">
                  ظهور هذه الحالة لا يعني إرسال طلب جديد أو استخدام OTP.
                </small>
              </div>
            )}
          </section>
        )}

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-slate-50 px-5 py-4">
            <h2 className="font-bold text-slate-900">
              1. بيانات المنشأة ووحدة إصدار الفواتير
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              راجع البيانات القانونية والعنوان الوطني بدقة. حفظ البيانات وتحضير
              CSR لا يطلب OTP ولا يفعّل الربط ولا يرسل فواتير.
            </p>
            <p className="mt-2 text-xs font-semibold text-blue-700">
              نطاق الربط المعتمد: الفرع الرئيسي فقط — وحدة إصدار واحدة — الرقم
              التسلسلي {identity.deviceSerial || buildInitialIdentity().deviceSerial}.
            </p>
          </div>
          <div className="grid gap-4 p-5 md:grid-cols-2">
            <Field
              label="اسم المنشأة بالعربية"
              value={identity.companyNameAr}
              onChange={(value) => setField("companyNameAr", value)}
              className={inputClass}
            />
            <div className="space-y-2">
              <Field
                label="اسم المنشأة بالإنجليزية — قيمة مقترحة قابلة للتعديل"
                value={identity.companyNameEn}
                onChange={(value) => {
                  setField("companyNameEn", value);
                  setLegalEnglishConfirmed(false);
                }}
                className={inputClass}
                dir="ltr"
              />
              <label className="flex items-start gap-2 text-xs text-amber-800">
                <input
                  type="checkbox"
                  checked={legalEnglishConfirmed}
                  onChange={(event) =>
                    setLegalEnglishConfirmed(event.target.checked)
                  }
                  className="mt-0.5"
                />
                راجعت الاسم الإنجليزي وأؤكد مطابقته للمستندات القانونية.
              </label>
            </div>
            <Field
              label="الرقم الضريبي — 15 رقمًا"
              value={identity.vatNumber}
              onChange={(value) =>
                setField("vatNumber", value.replace(/\D/g, "").slice(0, 15))
              }
              className={inputClass}
              dir="ltr"
            />
            <Field
              label="رقم السجل التجاري"
              value={identity.commercialRegistration}
              onChange={(value) =>
                setField(
                  "commercialRegistration",
                  value.replace(/\D/g, "").slice(0, 15),
                )
              }
              className={inputClass}
              dir="ltr"
            />
            <Field
              label="اسم الفرع"
              value={identity.branchName}
              onChange={(value) => setField("branchName", value)}
              className={inputClass}
            />
            <Field
              label="نوع النشاط"
              value={identity.industry}
              onChange={(value) => setField("industry", value)}
              className={inputClass}
            />
            <Field
              label="رقم المبنى"
              value={identity.buildingNumber}
              onChange={(value) =>
                setField("buildingNumber", value.replace(/\D/g, "").slice(0, 4))
              }
              className={inputClass}
              dir="ltr"
            />
            <Field
              label="اسم الشارع"
              value={identity.streetName}
              onChange={(value) => setField("streetName", value)}
              className={inputClass}
            />
            <Field
              label="الحي"
              value={identity.district}
              onChange={(value) => setField("district", value)}
              className={inputClass}
            />
            <Field
              label="المدينة"
              value={identity.city}
              onChange={(value) => setField("city", value)}
              className={inputClass}
            />
            <Field
              label="الرمز البريدي"
              value={identity.postalCode}
              onChange={(value) =>
                setField("postalCode", value.replace(/\D/g, "").slice(0, 5))
              }
              className={inputClass}
              dir="ltr"
            />
            <Field
              label="الرقم الإضافي"
              value={identity.additionalNumber}
              onChange={(value) =>
                setField(
                  "additionalNumber",
                  value.replace(/\D/g, "").slice(0, 4),
                )
              }
              className={inputClass}
              dir="ltr"
            />
            <Field
              label="العنوان المختصر"
              value={identity.shortAddress}
              onChange={(value) =>
                setField(
                  "shortAddress",
                  value
                    .toUpperCase()
                    .replace(/[^A-Z0-9]/g, "")
                    .slice(0, 8),
                )
              }
              className={inputClass}
              dir="ltr"
            />
            <Field
              label="تاريخ سريان تسجيل ضريبة القيمة المضافة"
              value={identity.vatEffectiveDate}
              onChange={(value) => setField("vatEffectiveDate", value)}
              className={inputClass}
              dir="ltr"
              type="date"
            />
            <Field
              label="مصنّع الحل التقني"
              value={identity.deviceManufacturer}
              onChange={(value) => setField("deviceManufacturer", value)}
              className={inputClass}
              dir="ltr"
            />
            <Field
              label="طراز الجهاز / النظام"
              value={identity.deviceModel}
              onChange={(value) => setField("deviceModel", value)}
              className={inputClass}
              dir="ltr"
            />
            <Field
              label="الرقم التسلسلي للوحدة"
              value={identity.deviceSerial}
              onChange={(value) =>
                setField(
                  "deviceSerial",
                  value.toUpperCase().replace(/[^A-Z0-9._\-/]/g, ""),
                )
              }
              className={inputClass}
              dir="ltr"
            />
            <Field
              label="الاسم الشائع للشهادة (CN)"
              value={identity.commonName}
              onChange={(value) => setField("commonName", value)}
              className={inputClass}
              dir="ltr"
            />
            <label className="space-y-1.5 md:col-span-2">
              <span className="text-xs font-bold text-slate-700">
                أنواع الفواتير التي تصدرها الوحدة
              </span>
              <span className="block text-xs leading-5 text-slate-500">
                تم اختيار 1100 لأنه النوع المتعارف لوحدة واحدة تصدر فواتير
                معيارية B2B ومبسطة B2C.
              </span>
              <select
                value={identity.invoiceType}
                onChange={(event) =>
                  setField(
                    "invoiceType",
                    event.target.value as IdentityForm["invoiceType"],
                  )
                }
                className={inputClass}
              >
                <option value="1100">
                  معيارية B2B ومبسطة B2C — 1100 (الاختيار المعتمد)
                </option>
                <option value="1000">معيارية فقط — 1000</option>
                <option value="0100">مبسطة فقط — 0100</option>
              </select>
            </label>
          </div>
          <div className="flex justify-end border-t border-slate-100 bg-slate-50 px-5 py-4">
            <button
              onClick={
                selectedMode === "simulation" && setup?.compliance_csid_masked
                  ? saveBranchLocation
                  : prepare
              }
              disabled={
                Boolean(action) || !legalEnglishConfirmed || !addressComplete
              }
              className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {action === "prepare" || action === "address" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileKey2 className="h-4 w-4" />
              )}
              {selectedMode === "simulation" && setup?.compliance_csid_masked
                ? "حفظ عنوان الفواتير"
                : selectedMode === "production"
                  ? "حفظ البيانات وإعداد CSR إنتاج منفصل"
                  : "حفظ البيانات وتوليد CSR محاكاة آمن"}
            </button>
          </div>
        </section>

        {selectedMode === "production" && !productionCsrPrepared ? (
          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <h2 className="font-bold text-slate-900">
              2. OTP الإنتاج غير متاح بعد
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              لن يظهر إدخال OTP ولن يكون مفعّلًا قبل إعداد CSR مستقل للإنتاج
              الحقيقي من زر التحضير أعلاه.
            </p>
          </section>
        ) : (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-bold text-slate-900">
              2. إدخال رمز التفعيل OTP
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              أنشئ الرمز يدويًا من
              {selectedMode === "simulation"
                ? " منصة المحاكاة"
                : " بوابة الإنتاج الحقيقي"}
              ، ثم أدخله هنا. لا يطلب النظام OTP تلقائيًا.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <input
                value={otp}
                onChange={(event) =>
                  setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                dir="ltr"
                className="h-12 w-48 rounded-xl border border-slate-300 px-4 text-center font-mono text-xl tracking-[0.35em] outline-none focus:border-blue-500"
              />
              <button
                onClick={onboard}
                disabled={
                  Boolean(action) ||
                  !setup ||
                  setup.mode !== selectedMode ||
                  !["csr_generated", "failed"].includes(setup.status) ||
                  Boolean(setup.compliance_csid_masked) ||
                  otp.length !== 6
                }
                className={`flex h-12 items-center gap-2 rounded-xl px-6 font-bold text-white disabled:cursor-not-allowed disabled:opacity-40 ${
                  selectedMode === "production"
                    ? "bg-rose-700 hover:bg-rose-800"
                    : "bg-emerald-600 hover:bg-emerald-700"
                }`}
              >
                {action === "onboard" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
                {selectedMode === "production"
                  ? "طلب اعتماد الإنتاج الحقيقي"
                  : "تهيئة الجهاز في المحاكاة"}
              </button>
            </div>
            <div className="mt-4 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
              <AlertCircle className="h-5 w-5 shrink-0" /> لا يُحفظ OTP، ولا
              يعرض النظام المفتاح الخاص أو Secret أو CSID الكامل في المتصفح.
            </div>
          </section>
        )}

        {selectedMode === "production" && (
          <section className="space-y-5 rounded-2xl border-2 border-rose-300 bg-white p-5 shadow-sm">
            <div>
              <h2 className="text-lg font-bold text-slate-950">
                قائمة جاهزية الإنتاج الحقيقي
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                اعتماد المحاكاة التجريبي لا يساوي Production CSID حقيقيًا ولا
                يسمح بالتفعيل هنا.
              </p>
            </div>
            <ul className="grid gap-2 md:grid-cols-2">
              {[
                [legalEnglishConfirmed, "تأكيد الاسم القانوني الإنجليزي"],
                [addressComplete, "اكتمال حقول العنوان الوطني"],
                [
                  Boolean(identity.deviceSerial),
                  "وجود رقم تسلسلي ثابت لوحدة EGS",
                ],
                [productionCsrPrepared, "إعداد CSR مستقل للإنتاج الحقيقي"],
                [productionCsidExists, "وجود Production CSID حقيقي للإنتاج"],
              ].map(([ready, label]) => (
                <li
                  key={String(label)}
                  className={`flex items-center gap-2 rounded-xl border p-3 text-sm ${
                    ready
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-slate-200 bg-slate-50 text-slate-600"
                  }`}
                >
                  {ready ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <AlertCircle className="h-4 w-4" />
                  )}
                  {label}
                </li>
              ))}
            </ul>

            <div className="rounded-2xl border border-rose-300 bg-rose-50 p-4">
              <h3 className="font-bold text-rose-950">
                التفعيل الصريح للإنتاج الحقيقي
              </h3>
              <p className="mt-1 text-sm leading-6 text-rose-900">
                لا يُسمح بالتفعيل إلا بعد وجود Production CSID حقيقي. اكتب
                العبارة التالية حرفيًا للتأكيد:
              </p>
              <code
                className="mt-2 block text-xs font-bold text-rose-950"
                dir="ltr"
              >
                ENABLE_REAL_ZATCA_PRODUCTION
              </code>
              <div className="mt-4 flex flex-wrap gap-3">
                <input
                  value={activationPhrase}
                  onChange={(event) => setActivationPhrase(event.target.value)}
                  disabled={
                    !productionCsidExists || Boolean(setup?.production_enabled)
                  }
                  dir="ltr"
                  autoComplete="off"
                  className="h-12 min-w-72 flex-1 rounded-xl border border-rose-300 bg-white px-4 font-mono text-sm outline-none disabled:bg-slate-100"
                  placeholder="اكتب عبارة التفعيل"
                />
                {setup?.production_enabled ? (
                  <button
                    onClick={deactivateProduction}
                    disabled={Boolean(action)}
                    className="h-12 rounded-xl border border-rose-600 bg-white px-6 font-bold text-rose-700 disabled:opacity-40"
                  >
                    {action === "deactivate"
                      ? "جاري التعطيل..."
                      : "تعطيل الإنتاج الحقيقي"}
                  </button>
                ) : (
                  <button
                    onClick={activateProduction}
                    disabled={
                      Boolean(action) ||
                      !productionCsidExists ||
                      activationPhrase !== "ENABLE_REAL_ZATCA_PRODUCTION"
                    }
                    className="h-12 rounded-xl bg-rose-700 px-6 font-bold text-white hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {action === "activate"
                      ? "جاري التفعيل..."
                      : "تفعيل الإنتاج الحقيقي"}
                  </button>
                )}
              </div>
            </div>
          </section>
        )}

        {setup && (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-bold text-slate-900">
                  3. فحص التوافق — المستندات المطلوبة
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {selectedMode === "production"
                    ? "ينشئ الخادم مستندات التوافق الستة ويرسلها إلى منصة ZATCA Core باستخدام شهادة التوافق، دون إرسال أي فاتورة أعمال حقيقية."
                    : "ينشئ الخادم مستندات UBL موقعة ويرسل كل نتيجة فعليًا إلى منصة ZATCA Simulation."}
                </p>
              </div>
              <button
                onClick={runComplianceTests}
                disabled={
                  Boolean(action) ||
                  !setup ||
                  ![
                    "compliance_ready",
                    "compliance_testing",
                    "compliance_passed",
                  ].includes(setup.status)
                }
                className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {action === "compliance" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MonitorCog className="h-4 w-4" />
                )}
                {action === "compliance"
                  ? "جاري إرسال المستندات..."
                  : "تشغيل فحص التوافق"}
              </button>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {requiredComplianceDocuments.map((document) => {
                const result = setup?.compliance_results?.find(
                  (item) => item.caseIndex === document.caseIndex,
                );
                return (
                  <div
                    key={document.caseIndex}
                    className={`rounded-xl border p-3 text-sm ${result?.status === "passed" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : result?.status === "failed" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-slate-200 bg-slate-50 text-slate-700"}`}
                  >
                    <div className="flex items-center gap-2 font-semibold">
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${result?.status === "passed" ? "bg-emerald-500" : result?.status === "failed" ? "bg-rose-500" : "bg-slate-300"}`}
                      />
                      {document.label}
                    </div>
                    {result?.status === "failed" &&
                    result.validationResults?.errorMessages?.length ? (
                      <ul className="mt-2 space-y-1 text-xs leading-5 opacity-80">
                        {result.validationResults.errorMessages.map(
                          (error, index) => (
                            <li key={`${error.code ?? "error"}-${index}`}>
                              {error.code ? `[${error.code}] ` : ""}
                              {error.message || "رفضت ZATCA المستند"}
                            </li>
                          ),
                        )}
                      </ul>
                    ) : (
                      <p className="mt-2 text-xs leading-5 opacity-80">
                        {result?.status === "passed"
                          ? "اجتاز فحص ZATCA"
                          : result?.message || "لم يُختبر بعد"}
                      </p>
                    )}
                    {result?.httpStatus ? (
                      <small className="mt-1 block font-mono">
                        HTTP {result.httpStatus}
                      </small>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {setup?.status === "compliance_passed" && (
          <section className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="font-bold text-indigo-950">
                  {setup.production_csid_masked
                    ? selectedMode === "production"
                      ? "4. تم إصدار Production CSID الحقيقي"
                      : "4. تم إصدار اعتماد المحاكاة"
                    : selectedMode === "production"
                      ? "4. إصدار Production CSID الحقيقي"
                      : "4. إصدار Production CSID للمحاكاة — اعتماد تجريبي فقط"}
                </h2>
                <p className="mt-1 text-sm leading-6 text-indigo-800">
                  {setup.production_csid_masked
                    ? "تم حفظ بيانات الاعتماد بأمان داخل Vault. لا تُرسل أي فاتورة حقيقية قبل التفعيل الصريح."
                    : selectedMode === "production"
                      ? "هذا طلب اعتماد إنتاج حقيقي بعد اجتياز اختبارات التوافق. إصداره وحده لا يفعّل إرسال الفواتير؛ يلزم التفعيل الصريح لاحقًا."
                      : "هذا Production CSID داخل Simulation فقط، وليس Production CSID للإنتاج الحقيقي. يُستخدم لاختبارات Clearance وReporting التجريبية."}
                </p>
                {setup.production_csid_masked && (
                  <div className="mt-3 grid gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-900 sm:grid-cols-2">
                    <span dir="ltr">
                      CSID: {setup.production_csid_masked}
                    </span>
                    <span>
                      انتهاء الشهادة: {setup.certificate_expires_at
                        ? new Date(setup.certificate_expires_at).toLocaleString(
                            "ar-SA",
                          )
                        : "يحتاج مراجعة"}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {setup.production_status === "failed" && (
                  <button
                    onClick={resetOnboarding}
                    disabled={Boolean(action)}
                    className="rounded-xl border border-rose-300 bg-white px-4 py-3 text-sm font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-40"
                  >
                    {action === "reset" ? "جاري البدء..." : "بدء تهيئة جديدة"}
                  </button>
                )}
                <button
                  onClick={requestProductionCsid}
                  disabled={
                    Boolean(action) || Boolean(setup.production_csid_masked)
                  }
                  className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {action === "production" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-4 w-4" />
                  )}
                  {setup.production_csid_masked
                    ? selectedMode === "production"
                      ? "تم إصدار Production CSID الحقيقي"
                      : "تم إصدار اعتماد المحاكاة"
                    : selectedMode === "production"
                      ? "إصدار Production CSID الحقيقي"
                      : "إصدار Production CSID للمحاكاة فقط"}
                </button>
              </div>
            </div>
          </section>
        )}

        {audit.length > 0 && (
          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 font-bold text-slate-900">سجل التهيئة</h2>
            <div className="space-y-2">
              {audit.map((item) => {
                const detailMessage = getAuditDetailMessage(item);
                return (
                  <div
                    key={item.id}
                    className="rounded-lg bg-slate-50 px-3 py-2 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-slate-700">
                        {auditActionLabels[item.action] ?? item.action}
                      </span>
                      <span
                        className={
                          item.result === "success"
                            ? "text-emerald-700"
                            : "text-rose-700"
                        }
                      >
                        {item.result === "success" ? "نجح" : "فشل"}
                        {item.http_status ? ` — HTTP ${item.http_status}` : ""}
                      </span>
                      <time className="text-slate-400">
                        {new Date(item.created_at).toLocaleString("ar-SA")}
                      </time>
                    </div>
                    {detailMessage && (
                      <p
                        className="mt-2 break-words rounded-md bg-rose-50 px-2 py-1.5 text-rose-800"
                        dir="auto"
                      >
                        {detailMessage}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}
          </>
        )}

        {loading && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-white/40 backdrop-blur-[1px]">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          </div>
        )}
      </div>
    </Layout>
  );
}

function Field({
  label,
  value,
  onChange,
  className,
  dir,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className: string;
  dir?: "rtl" | "ltr";
  type?: "text" | "date";
}) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-bold text-slate-700">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={className}
        dir={dir}
      />
    </label>
  );
}
