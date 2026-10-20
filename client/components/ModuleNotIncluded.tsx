import { Link } from "react-router-dom";
import { PackageX } from "lucide-react";
import { useI18n } from "@/i18n";
import { COMPANY_MODULE_LABELS, type CompanyModule } from "@/lib/companyModules";

/** S19: صفحة من قسم غير مشمول في باقة المنشأة (المحاسبة والمالية، الموارد البشرية، الحجوزات) */
export default function ModuleNotIncluded({ module }: { module: CompanyModule }) {
  const { t, direction } = useI18n();
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-16" dir={direction}>
      <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
          <PackageX className="h-7 w-7" />
        </div>
        <h1 className="text-xl font-bold text-slate-900">{t("هذا القسم غير مشمول في باقة منشأتك")}</h1>
        <p className="mt-2 text-sm leading-7 text-slate-600">
          {t(COMPANY_MODULE_LABELS[module])} — {t(module === "hotel"
            ? "الحجوزات إضافة على المحاسبة والمالية، وتُفعَّل للمنشأة من باقتها. بياناتك محفوظة وتعود كما هي عند تفعيل القسم."
            : "يُفعَّل القسم للمنشأة من باقتها. بياناتك محفوظة وتعود كما هي عند تفعيل القسم.")}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link to="/" className="rounded-lg bg-[#004e89] px-5 py-2 text-sm font-bold text-white">{t("العودة للوحة التحكم")}</Link>
          <Link to="/subscription" className="rounded-lg border border-slate-300 px-5 py-2 text-sm font-bold text-slate-700">{t("الاشتراك والباقة")}</Link>
        </div>
      </div>
    </div>
  );
}
