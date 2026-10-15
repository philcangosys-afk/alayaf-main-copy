import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import { FormSchema, FormField } from "./formSchemas";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import EmployeeSignatureField, { EmployeeSignature } from "./EmployeeSignatureField";
import { hrRequestErrorText } from "@/lib/hrErrors";
import { riyadhToday } from "@/lib/hrDates";

// أزواج تاريخ البداية والنهاية في نماذج الطلبات (formSchemas.ts)
const DATE_PAIRS: [string, string][] = [
  ["start_date", "end_date"],
  ["from_date", "to_date"],
  ["proposed_date", "end_date"],
];

/** حقل اختيار موظف: قائمة بلا خيارات معرّفة اسمها employee أو عنوانها يذكر الموظف */
const isEmployeeField = (field: FormField) =>
  field.type === "select" && (!field.options || field.options.length === 0) && (field.name === "employee" || field.label.includes("الموظف"));

type DirectoryOption = { key: string; value: string; label: string };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schema: FormSchema | null;
  employeeInfo?: {
    empId: string;
    name: string;
  };
}

export default function DynamicRequestForm({ open, onOpenChange, schema, employeeInfo }: Props) {
  const { t, direction } = useI18n();
  const [loading, setLoading] = useState(false);
  const [signature, setSignature] = useState<EmployeeSignature | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  // دليل الموظفين النشطين لحقول اختيار الموظف؛ إن تعذر تحميله يبقى الحقل نصًا حرًا
  const [directory, setDirectory] = useState<DirectoryOption[]>([]);
  const [directoryError, setDirectoryError] = useState("");
  const needsDirectory = Boolean(schema?.fields.some(isEmployeeField));

  // نموذج جديد = بيانات فارغة (لا تنتقل قيم نموذج سابق إلى طلب من نوع آخر)
  useEffect(() => {
    setFormData({});
  }, [schema?.id]);

  useEffect(() => {
    if (!open || !needsDirectory) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc("list_employee_directory");
      if (cancelled) return;
      if (error) {
        setDirectory([]);
        setDirectoryError(`${hrRequestErrorText(error, "تعذر تحميل قائمة الموظفين")}؛ اكتب اسم الموظف`);
        return;
      }
      const options = ((data as Record<string, unknown>[] | null) ?? [])
        .map((row, index) => {
          const empId = String(row.emp_id ?? "").trim();
          const name = String(row.name ?? "").trim();
          const department = String(row.department ?? "").trim();
          return {
            // الرقم الوظيفي قد يتكرر بين موظفين، فالمفتاح يضم الترتيب
            key: String(row.id ?? "").trim() || `${empId}#${index}`,
            value: empId ? `${name} (${empId})` : name,
            label: `${name}${empId ? ` (${empId})` : ""}${department ? ` - ${department}` : ""}`,
          };
        })
        .filter((option) => option.value);
      setDirectory(options);
      setDirectoryError(options.length ? "" : "لا توجد قائمة موظفين متاحة؛ اكتب اسم الموظف");
    })();
    return () => {
      cancelled = true;
    };
  }, [open, needsDirectory]);

  if (!schema) return null;

  const handleSubmit = async () => {
    if (!schema) return;

    const requiredFields = schema.fields.filter((f) => f.required);
    const missingRequired = requiredFields.find((f) => {
      const value = formData[f.name];
      return value === undefined || value === null || String(value).trim() === "";
    });

    if (missingRequired) {
      toast.error(`${t("يرجى تعبئة الحقل الإلزامي")}: ${t(missingRequired.label)}`);
      return;
    }

    // تاريخ النهاية لا يسبق تاريخ البداية
    const fieldNames = new Set(schema.fields.map((f) => f.name));
    for (const [startField, endField] of DATE_PAIRS) {
      if (!fieldNames.has(startField) || !fieldNames.has(endField)) continue;
      // proposed_date بديل عن start_date فقط إن لم يكن في النموذج تاريخ بداية
      if (startField === "proposed_date" && fieldNames.has("start_date")) continue;
      const from = String(formData[startField] ?? "");
      const to = String(formData[endField] ?? "");
      if (from && to && to < from) {
        const label = (name: string) => t(schema.fields.find((f) => f.name === name)?.label ?? name);
        toast.error(`${t("تاريخ النهاية يجب ألا يسبق تاريخ البداية")}: ${label(startField)} / ${label(endField)}`);
        return;
      }
    }

    const today = riyadhToday();

    const startDate =
      formData.start_date ||
      formData.date ||
      formData.from_date ||
      formData.return_date ||
      formData.transfer_date ||
      formData.proposed_date ||
      formData.last_day ||
      today;

    const endDate =
      formData.end_date ||
      formData.to_date ||
      formData.date ||
      formData.last_day ||
      startDate;

    const empId = employeeInfo?.empId;
    const empName = employeeInfo?.name;
    if (!empId || !empName) {
      toast.error(t("تعذر تحديد بيانات الموظف مقدم الطلب"));
      return;
    }

    if (!signature) {
      toast.error(t("يجب إنشاء وحفظ توقيعك الإلكتروني قبل إرسال الطلب"));
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.from("hr_requests").insert([
        {
          emp_id: empId,
          emp_name: empName,
          request_type: schema.title,
          start_date: startDate,
          end_date: endDate,
          status: "معلق",
          signature_data: signature.signatureData,
          signed_at: new Date().toISOString(),
          details: formData,
        },
      ]);

      if (error) throw error;

      toast.success(t("تم إرسال الطلب بنجاح"));
      setFormData({});
      onOpenChange(false);
    } catch (error: any) {
      console.error("Request submission failed:", error);
      toast.error(t(hrRequestErrorText(error, "تعذر إرسال الطلب")));
    } finally {
      setLoading(false);
    }
  };

  const renderField = (field: FormField) => {
    const commonClass = "w-full h-10 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-start bg-white";
    
    switch (field.type) {
      case "text":
      case "number":
        return (
          <input
            type={field.type}
            placeholder={field.placeholder}
            className={commonClass}
            value={formData[field.name] || ""}
            onChange={(e) => setFormData({ ...formData, [field.name]: e.target.value })}
          />
        );
      case "date":
        return (
          <div className="relative">
            <input
              type="date"
              className={cn(commonClass, "ps-10")}
              value={formData[field.name] || ""}
              onChange={(e) => setFormData({ ...formData, [field.name]: e.target.value })}
            />
            <Calendar className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          </div>
        );
      case "time":
        return (
          <input
            type="time"
            className={commonClass}
            value={formData[field.name] || ""}
            onChange={(e) => setFormData({ ...formData, [field.name]: e.target.value })}
          />
        );
      case "select":
        // حقل اختيار موظف: من دليل الموظفين النشطين
        if (isEmployeeField(field) && directory.length > 0) {
          return (
            <select
              className={cn(commonClass, "appearance-none")}
              style={{ backgroundImage: "url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 24 24\" stroke=\"%239CA3AF\"><path stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" d=\"M19 9l-7 7-7-7\"/></svg>')", backgroundPosition: "left 0.5rem center", backgroundRepeat: "no-repeat", backgroundSize: "1.5em 1.5em" }}
              value={formData[field.name] || ""}
              onChange={(e) => setFormData({ ...formData, [field.name]: e.target.value })}
            >
              <option value="" disabled></option>
              {directory.map((option) => (
                <option key={option.key} value={option.value}>{option.label}</option>
              ))}
            </select>
          );
        }
        // قائمة بلا خيارات معرّفة: إدخال نصي حتى لا يصبح الحقل الإلزامي مستحيل التعبئة
        if (!field.options || field.options.length === 0) {
          return (
            <input
              type="text"
              placeholder={field.placeholder || t("اكتب القيمة")}
              className={commonClass}
              value={formData[field.name] || ""}
              onChange={(e) => setFormData({ ...formData, [field.name]: e.target.value })}
            />
          );
        }
        return (
          <select
            className={cn(commonClass, "appearance-none")}
            style={{ backgroundImage: "url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 24 24\" stroke=\"%239CA3AF\"><path stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" d=\"M19 9l-7 7-7-7\"/></svg>')", backgroundPosition: "left 0.5rem center", backgroundRepeat: "no-repeat", backgroundSize: "1.5em 1.5em" }}
            value={formData[field.name] || ""}
            onChange={(e) => setFormData({ ...formData, [field.name]: e.target.value })}
          >
            <option value="" disabled></option>
            {field.options?.map(opt => (
              <option key={opt.value} value={opt.value}>{t(opt.label)}</option>
            ))}
          </select>
        );
      case "textarea":
        return (
          <textarea
            rows={4}
            className="w-full p-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-start resize-none"
            value={formData[field.name] || ""}
            onChange={(e) => setFormData({ ...formData, [field.name]: e.target.value })}
          />
        );
      case "radio":
        return (
          <div className="flex items-center gap-6 h-10 px-3 bg-white border border-gray-200 rounded-lg justify-end">
            {field.options?.map(opt => (
              <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                <span className="text-sm text-gray-700">{t(opt.label)}</span>
                <input
                  type="radio"
                  name={field.name}
                  value={opt.value}
                  checked={formData[field.name] === opt.value}
                  onChange={(e) => setFormData({ ...formData, [field.name]: e.target.value })}
                  className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                />
              </label>
            ))}
          </div>
        );
      case "table":
        // جدول مبسّط: نص متعدد الأسطر (سطر لكل بند) يُحفظ كنص في تفاصيل الطلب
        return (
          <div className="border border-gray-200 rounded-lg overflow-hidden mt-1">
            <div className="bg-[#004e89] text-white text-[13px] font-medium flex justify-between px-4 py-2">
              {field.tableColumns?.map((c, i) => (
                <div key={i} className="flex-1 text-center">{t(c)}</div>
              ))}
            </div>
            <textarea
              rows={4}
              placeholder={`${t("اكتب كل بند في سطر مستقل")}${field.tableColumns?.length ? `: ${field.tableColumns.map((c) => t(c)).join(" - ")}` : ""}`}
              className="w-full p-3 border-0 text-sm focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 text-start resize-none"
              value={formData[field.name] || ""}
              onChange={(e) => setFormData({ ...formData, [field.name]: e.target.value })}
            />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[900px] p-0 overflow-hidden bg-white" dir={direction}>
        <DialogHeader className="bg-white px-6 py-4 border-b border-gray-100 flex flex-row justify-between items-center space-y-0 text-start">
          <DialogTitle className="text-xl font-bold text-gray-800">{t(schema.title)}</DialogTitle>
        </DialogHeader>

        <div className="p-6 bg-white max-h-[80vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-x-8 gap-y-6">
            {schema.fields.map((field) => (
              <div
                key={field.name}
                className={cn(
                  "space-y-2",
                  field.colSpan === 2 ? "col-span-2" : "col-span-1"
                )}
              >
                <label className="text-sm font-medium text-gray-700 flex justify-end">
                  {field.required && <span className="text-red-500 ml-1">*</span>}
                  {t(field.label)}
                </label>
                {renderField(field)}
                {isEmployeeField(field) && directoryError && (
                  <p className="text-xs text-amber-700">{t(directoryError)}</p>
                )}
              </div>
            ))}
          </div>

          <div className="pt-8">
            <EmployeeSignatureField onChange={setSignature} />
          </div>

          <div className="space-y-2 pt-8">
            <label className="text-sm font-medium text-gray-700 flex justify-end">{t("المرفق")}</label>
            <div className="w-full py-3 border border-dashed border-gray-200 rounded-lg text-gray-400 text-sm text-center bg-gray-50/50">
              {t("إرفاق الملفات غير متاح حاليًا")}
            </div>
          </div>
        </div>

        <div className="bg-gray-50 px-6 py-4 border-t border-gray-100 flex justify-end">
          <button
            onClick={handleSubmit}
            disabled={loading}
            className={cn(
              "px-8 py-2 bg-[#004e89] hover:bg-[#003d6d] text-white font-medium rounded-lg text-sm transition-colors",
              loading && "opacity-70 cursor-not-allowed"
            )}
          >
            {loading ? t("جاري الإرسال...") : t("إرسال")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
