import { ChevronLeft, Lock } from "lucide-react";

import { useI18n } from "@/i18n";

type Props = { onBack: () => void };

const SECTIONS = [
  {
    title: "جمع البيانات",
    content: "يجمع النظام بيانات الموظفين الضرورية لتشغيل نظام الموارد البشرية، وتشمل: البيانات الشخصية (الاسم، تاريخ الميلاد، الجنسية)، بيانات العمل (القسم، المسمى الوظيفي، الراتب)، سجلات الحضور والانصراف، وسجلات الطلبات.",
  },
  {
    title: "استخدام البيانات",
    content: "تُستخدم البيانات حصرًا لأغراض إدارية داخلية كإدارة الرواتب والإجازات والحضور وإعداد التقارير الإدارية. لا تُشارك البيانات مع أي جهة خارجية دون إذن صريح.",
  },
  {
    title: "أمن البيانات",
    content: "تخضع جميع البيانات لتشفير كامل أثناء النقل والتخزين. يُطبّق النظام نموذج صلاحيات دقيق يضمن وصول كل موظف فقط إلى البيانات المخصصة لدوره.",
  },
  {
    title: "حقوق الموظف",
    content: "لكل موظف حق الاطلاع على بياناته الشخصية وطلب تصحيح أي معلومات غير دقيقة. يمكن التواصل مع إدارة الموارد البشرية لأي استفسار يتعلق بالبيانات الشخصية.",
  },
  {
    title: "التعديلات",
    content: "يحق لإدارة الشركة تحديث سياسة الخصوصية في أي وقت. سيتم إشعار الموظفين بأي تغييرات جوهرية عبر النظام.",
  },
];

export default function PrivacyPage({ onBack }: Props) {
  const { t, direction } = useI18n();

  return (
    <div className="flex flex-col h-full bg-gray-50" dir={direction}>
      <div className="flex items-center gap-3 p-4 bg-white border-b sticky top-0 z-10">
        <button onClick={onBack} className="text-[#004e89]"><ChevronLeft className={`h-6 w-6 ${direction === "rtl" ? "rotate-180" : ""}`} /></button>
        <Lock className="h-5 w-5 text-[#004e89]" />
        <h2 className="font-bold text-lg text-gray-900">{t("سياسة الخصوصية")}</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4 pb-24 space-y-4">
        <div className="bg-gradient-to-r from-[#004e89] to-[#0066b3] rounded-xl p-5 text-white">
          <Lock className="h-8 w-8 mb-2 text-white/80" />
          <p className="font-bold text-lg">{t("سياسة حماية بيانات الموظفين")}</p>
          <p className="text-xs text-blue-200 mt-1">{t("آخر تحديث")}: 2024</p>
        </div>
        {SECTIONS.map((sec) => (
          <div key={sec.title} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <p className="font-semibold text-[#004e89] mb-2">{t(sec.title)}</p>
            <p className="text-sm text-gray-600 leading-relaxed">{t(sec.content)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
