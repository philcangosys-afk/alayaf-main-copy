import PlaceholderModule from "@/components/PlaceholderModule";
import { Users } from "lucide-react";

export default function HR() {
  const features = [
    "بيانات الموظفين",
    "إدارة الرواتب",
    "تسجيل الحضور والانصراف",
    "تقارير الموارد البشرية",
    "إجازات وغيابات",
    "تطور الموظفين والمؤهلات",
    "الرواتب والاستقطاعات",
  ];

  return (
    <PlaceholderModule
      title="إدارة الموارد البشرية"
      description="نظام متكامل لإدارة بيانات الموظفين والرواتب والحضور والتقارير، مع حسابات تلقائية وآمنة"
      icon={Users}
      features={features}
    />
  );
}
