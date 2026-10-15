import PlaceholderModule from "@/components/PlaceholderModule";
import { ShoppingCart } from "lucide-react";

export const purchasesFeatures = [
  { label: "فواتير المشتريات", href: "/purchases/invoices" },
  // "مصروفات نقدية" أُخفيت: كانت لا تسجل في الدفاتر (المسار يعرض تنبيهًا فقط)
  { label: "طلبات إشعار دائن", href: "/purchases/debit-notes" },
  { label: "إشعارات دائنة", href: "/purchases/credit-notes" },
  { label: "البيانات الجمركية", href: "/purchases/customs-declarations" },
  { label: "أوامر الشراء", href: "/purchases/orders" },
  { label: "تقارير المشتريات الشاملة", href: "/purchases/reports" },
];

export default function Purchases() {
  return (
    <PlaceholderModule
      title="إدارة المشتريات"
      description="نظام شامل لإدارة جميع عمليات الشراء والتعاملات مع الموردين، مع تقارير تفصيلية وتتبع العمليات"
      icon={ShoppingCart}
      features={purchasesFeatures}
    />
  );
}
