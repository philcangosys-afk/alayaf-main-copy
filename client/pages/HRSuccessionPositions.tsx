import Layout from "@/components/Layout";
import { AlertTriangle } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useI18n } from "@/i18n";

// قسم التعاقب الوظيفي لا يملك جداول في قاعدة البيانات بعد: الصفحة للعرض فقط ولا تحفظ شيئًا
export default function HRSuccessionPositions() {
  const { t, direction } = useI18n();

  return (
    <Layout>
      <div className="space-y-6" dir={direction}>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">{t("المناصب")}</h1>
        </div>

        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800">
          <AlertTriangle className="h-5 w-5 mt-0.5 flex-shrink-0" />
          <p className="text-sm font-semibold">{t("هذا القسم قيد التطوير ولا يحفظ بيانات بعد")}</p>
        </div>

        <div className="bg-white rounded-md border shadow-sm">
          <div className="p-4 border-b flex justify-between items-center bg-[#004e89] text-white">
            <span className="font-semibold">{t("المناصب")}</span>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-[#004e89]">
                <TableRow>
                  <TableHead className="text-white text-right">{t("المسمى الوظيفي")}</TableHead>
                  <TableHead className="text-white text-right">{t("الإدارة")}</TableHead>
                  <TableHead className="text-white text-right">{t("القسم")}</TableHead>
                  <TableHead className="text-white text-right">{t("النوع")}</TableHead>
                  <TableHead className="text-white text-right">{t("المهارة")}</TableHead>
                  <TableHead className="text-white text-right">{t("التأثير")}</TableHead>
                  <TableHead className="text-white text-right">{t("الحالة")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-gray-500">
                    {t("لا توجد بيانات")}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </Layout>
  );
}
