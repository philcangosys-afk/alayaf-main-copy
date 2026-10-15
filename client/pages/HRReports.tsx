import { useState } from "react";
import Layout from "@/components/Layout";
import { cn } from "@/lib/utils";
import DynamicReport from "@/components/hr/reports/DynamicReport";
import { reportSchemas } from "@/components/hr/reports/reportSchemas";
import { useI18n } from "@/i18n";

// Reports Sidebar Menu Items mapping
const REPORT_CATEGORIES = [
  "إجازات",
  "المساءلات والإنذارات",
  "مصروفات الرواتب",
  "بيانات مالية",
  "تقارير الصرف",
  "حركات النقل",
  "دورات تدريبية",
  "عهد",
  "تفاصيل شخصية",
  "الحسابات البنكية",
  "الموظفين الجدد",
  "قياس الأداء",
  "الإنتبدابات",
  "الحضور و الانصراف",
  "تقارير الاستئذانات",
  "مباشرة العمل",
  "أرصدة الإجازات",
  "التأمينات الاجتماعية",
  "تقارير إنهاء الخدمة",
  "قياس الرضا الوظيفي",
  "تقارير السلف",
  "تقارير العمولات",
  "تقارير العمل الإضافي"
];

export default function HRReports() {
  const { t, direction } = useI18n();
  const [selectedReport, setSelectedReport] = useState<string | null>(null);

  return (
    <Layout>
      <div className="flex h-[calc(100vh-100px)] gap-4 mx-auto max-w-[1400px]" dir={direction}>
        
        {/* Right Sidebar - Report Categories */}
        <div className="w-64 flex-shrink-0 bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50">
            <h2 className="font-bold text-gray-800 text-sm">{t("قسم التقارير")}</h2>
          </div>
          
          <div className="flex-1 overflow-y-auto py-2">
            <ul className="space-y-0.5">
              {REPORT_CATEGORIES.map((category) => (
                <li key={category}>
                  <button
                    onClick={() => setSelectedReport(category)}
                    className={cn(
                      "w-full text-right px-5 py-2.5 text-[13px] font-medium transition-all duration-200",
                      selectedReport === category
                        ? "bg-[#004e89] text-white"
                        : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                    )}
                  >
                    {t(category)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 bg-gray-50/30 border border-gray-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
          
          {/* Header */}
          <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
            <h2 className="text-xl font-bold text-gray-800">
              {selectedReport ? `${t("تقرير")} ${t(selectedReport)}` : t("التقارير الشاملة")}
            </h2>
          </div>

          {/* Content Body */}
          <div className="flex-1 p-0 overflow-hidden bg-gray-50/30 relative">
            {selectedReport && reportSchemas[selectedReport] ? (
              <DynamicReport key={selectedReport} schema={reportSchemas[selectedReport]} />
            ) : selectedReport ? (
              <div className="bg-white rounded-xl border border-gray-200 p-8 m-6 min-h-[400px] flex flex-col items-center justify-center text-center animate-in fade-in zoom-in-95 duration-200">
                <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mb-4">
                  <svg className="w-10 h-10 text-[#004e89]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-bold text-gray-800 mb-2">{t("جاري العمل على تقرير")} "{t(selectedReport)}"</h3>
                <p className="text-gray-500 text-sm max-w-md">
                  {t("هذا التقرير قيد التطوير وسيتم توفيره قريباً. سيشمل تفاصيل وإحصائيات متقدمة مع إمكانية التصدير والطباعة.")}
                </p>
                
                <div className="mt-8 flex gap-3">
                  <button className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm font-medium cursor-not-allowed opacity-50">{t("تصدير PDF")}</button>
                  <button className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm font-medium cursor-not-allowed opacity-50">{t("تصدير Excel")}</button>
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center p-6">
                <div className="text-center">
                  <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-gray-100 mb-6 border-4 border-white shadow-sm">
                    <svg className="w-10 h-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                  </div>
                  <h2 className="text-2xl font-bold text-gray-800 mb-2">{t("اختر نوع التقرير من القائمة")}</h2>
                  <p className="text-gray-500 max-w-sm mx-auto">
                    {t("قم بتحديد التقرير المطلوب من القائمة الجانبية لاستعراض البيانات والإحصائيات الخاصة به")}
                  </p>
                </div>
              </div>
            )}
          </div>
          
        </div>

      </div>
    </Layout>
  );
}
