import { useEffect, useState, useMemo, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import EmployeeSignatureField, {
  EmployeeSignature,
} from "./EmployeeSignatureField";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { hrRequestErrorText } from "@/lib/hrErrors";
import { daysInclusive } from "@/lib/hrDates";

// تُستخدم فقط إن لم يُرجع جدول leave_types أي نوع مفعّل
const FALLBACK_LEAVE_TYPES = ["إجازة سنوية", "إجازة مرضية", "إجازة اضطرارية", "إجازة بدون راتب"];
const INACTIVE_TYPE_STATUSES = ["غير مفعلة", "غير مفعل", "معطلة", "معطل", "غير فعال", "غير فعالة", "موقوفة", "موقوف", "inactive", "disabled"];

// key فريد لكل خيار: معرّف الموظف إن أرجعته الدالة، وإلا الرقم الوظيفي + الترتيب (توجد أرقام وظيفية مكررة)
type SubstituteOption = { key: string; empId: string; name: string; department: string };

/** توحيد قيمة الجنس: male / female / "" (لكلا الجنسين أو غير محدد) */
const normalizeGender = (value: unknown): "male" | "female" | "" => {
  const text = String(value ?? "").trim().toLowerCase();
  if (["ذكر", "ذكور", "male", "m"].includes(text)) return "male";
  if (["أنثى", "انثى", "إناث", "اناث", "female", "f"].includes(text)) return "female";
  return "";
};

const emptyFormData = () => ({
  leaveType: "",
  startDate: "",
  endDate: "",
  address: "",
  substituteId: "",
  phone: "",
  reason: "",
});

interface LeaveRequestFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeInfo?: {
    empId: string;
    name: string;
    gender?: string;
  };
}

export default function LeaveRequestForm({
  open,
  onOpenChange,
  employeeInfo,
}: LeaveRequestFormProps) {
  const { t, direction } = useI18n();
  const [loading, setLoading] = useState(false);
  const [signature, setSignature] = useState<EmployeeSignature | null>(null);
  const [formData, setFormData] = useState(emptyFormData);
  const [leaveTypes, setLeaveTypes] = useState<string[]>(FALLBACK_LEAVE_TYPES);
  const [substitutes, setSubstitutes] = useState<SubstituteOption[]>([]);
  const [substitutesError, setSubstitutesError] = useState("");
  // إن تعذر تحميل دليل الموظفين أو كان فارغًا يُكتب اسم البديل نصًا بدل منع الإرسال
  const [substituteFreeText, setSubstituteFreeText] = useState(false);
  const substituteFreeTextRef = useRef(false);

  // أنواع الإجازات المفعّلة من leave_types، ودليل الموظفين للبديل
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const ownCodeForGender = String(employeeInfo?.empId ?? "").trim();
      const [typesResult, directoryResult, genderResult] = await Promise.all([
        supabase.from("leave_types").select("*").order("id"),
        supabase.rpc("list_employee_directory"),
        // جنس مقدم الطلب من سجله (الموظف يقرأ سجله)؛ يُهمل إن تكرر الرقم أو تعذر
        employeeInfo?.gender || !ownCodeForGender
          ? Promise.resolve({ data: null, error: null })
          : supabase.from("employees").select("gender, name").eq("emp_id", ownCodeForGender).limit(3),
      ]);
      if (cancelled) return;
      const typeRows = (typesResult.data as Record<string, unknown>[] | null) ?? [];
      const genderRows = ((genderResult.data as Record<string, unknown>[] | null) ?? [])
        .filter((row) => !employeeInfo?.name || String(row.name ?? "").trim() === String(employeeInfo.name).trim());
      // تقييد الجنس يُطبق فقط إن كان في الجدول عمود gender وكان جنس الموظف معروفًا
      const employeeGender = normalizeGender(employeeInfo?.gender ?? (genderRows.length === 1 ? genderRows[0].gender : ""));
      const hasGenderColumn = typeRows.some((row) => Object.prototype.hasOwnProperty.call(row, "gender"));
      const names = typeRows
        .filter((row) => !INACTIVE_TYPE_STATUSES.includes(String(row.status ?? "").trim().toLowerCase()))
        .filter((row) => {
          if (!hasGenderColumn || !employeeGender) return true;
          const typeGender = normalizeGender(row.gender);
          return !typeGender || typeGender === employeeGender;
        })
        .map((row) => String(row.name ?? "").trim())
        .filter(Boolean);
      const allowedTypes = !typesResult.error && names.length ? Array.from(new Set(names)) : FALLBACK_LEAVE_TYPES;
      setLeaveTypes(allowedTypes);
      // نوع اختير من القائمة الاحتياطية قبل اكتمال التحميل ولم يعد ضمن الأنواع المسموحة
      setFormData((prev) => (prev.leaveType && !allowedTypes.includes(prev.leaveType) ? { ...prev, leaveType: "" } : prev));

      const ownCode = String(employeeInfo?.empId ?? "").trim();
      const ownName = String(employeeInfo?.name ?? "").trim();
      const options: SubstituteOption[] = directoryResult.error
        ? []
        : ((directoryResult.data as Record<string, unknown>[] | null) ?? [])
            .map((row, index) => {
              const empId = String(row.emp_id ?? "").trim();
              const id = String(row.id ?? row.employee_id ?? "").trim();
              return { key: id || `${empId}#${index}`, empId, name: String(row.name ?? "").trim(), department: String(row.department ?? "").trim() };
            })
            // استبعاد مقدم الطلب نفسه فقط (رقم واسم متطابقان) حتى لا يُستبعد زميل يحمل الرقم نفسه
            .filter((row) => row.empId && row.name && !(row.empId === ownCode && row.name === ownName));
      setSubstitutes(options);
      const freeText = options.length === 0;
      // تغيّر طريقة إدخال البديل (قائمة ↔ نص): القيمة السابقة لا تصلح للطريقة الجديدة
      if (substituteFreeTextRef.current !== freeText) setFormData((prev) => ({ ...prev, substituteId: "" }));
      substituteFreeTextRef.current = freeText;
      setSubstituteFreeText(freeText);
      setSubstitutesError(
        directoryResult.error
          ? `${hrRequestErrorText(directoryResult.error, "تعذر تحميل قائمة الموظفين")}؛ اكتب اسم الموظف البديل`
          : freeText
            ? "لا توجد قائمة موظفين متاحة؛ اكتب اسم الموظف البديل"
            : "",
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [open, employeeInfo?.empId, employeeInfo?.name, employeeInfo?.gender]);

  // أيام تقويمية شاملة البداية والنهاية (متوافق مع السجلات الحالية)
  const duration = useMemo(() => daysInclusive(formData.startDate, formData.endDate), [formData.startDate, formData.endDate]);
  const datesInvalid = Boolean(formData.startDate && formData.endDate && formData.endDate < formData.startDate);

  const handleChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >,
  ) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async () => {
    try {
      setLoading(true);
      // Validate
      if (
        !formData.leaveType ||
        !formData.startDate ||
        !formData.endDate ||
        !formData.phone ||
        !formData.reason ||
        !formData.substituteId.trim() ||
        !formData.address
      ) {
        alert(t("يرجى تعبئة جميع الحقول الإلزامية"));
        setLoading(false);
        return;
      }

      if (!leaveTypes.includes(formData.leaveType)) {
        alert(t("اختر نوع الإجازة من القائمة"));
        setLoading(false);
        return;
      }

      if (duration <= 0) {
        alert(t("تاريخ الانتهاء يجب أن يكون في يوم البداية أو بعده"));
        setLoading(false);
        return;
      }

      const substitute = substituteFreeText
        ? null
        : substitutes.find((item) => item.key === formData.substituteId) ?? null;
      if (!substituteFreeText && !substitute) {
        alert(t("اختر الموظف البديل من القائمة"));
        setLoading(false);
        return;
      }
      const substituteText = substitute ? `${substitute.name} (${substitute.empId})` : formData.substituteId.trim();

      const empId = employeeInfo?.empId;
      const empName = employeeInfo?.name;
      if (!empId || !empName) {
        alert(t("تعذر تحديد بيانات الموظف مقدم الطلب"));
        setLoading(false);
        return;
      }

      if (!signature) {
        alert(t("يجب إنشاء وحفظ توقيعك الإلكتروني قبل إرسال الطلب"));
        setLoading(false);
        return;
      }

      const { error } = await supabase.from("leave_requests").insert({
        emp_id: empId,
        emp_name: empName,
        leave_type: formData.leaveType,
        start_date: formData.startDate,
        end_date: formData.endDate,
        days: duration,
        status: "معلق",
        signature_data: signature.signatureData,
        signed_at: new Date().toISOString(),
        notes: `مدة الإجازة: ${duration} يوم | العنوان: ${formData.address} | البديل: ${substituteText} | الهاتف: ${formData.phone} | السبب: ${formData.reason}`,
      });

      if (error) throw error;

      alert(t("تم إرسال الطلب بنجاح"));
      setFormData(emptyFormData());
      onOpenChange(false);
    } catch (error: any) {
      console.error("Leave request submission failed:", error);
      alert(t(hrRequestErrorText(error, "حدث خطأ أثناء إرسال الطلب")));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[900px] p-0 overflow-hidden" dir={direction}>
        {/* Header */}
        <DialogHeader className="bg-white px-6 py-4 border-b border-gray-100 flex flex-row justify-between items-center space-y-0 text-start">
          <DialogTitle className="text-xl font-bold text-gray-800">
            {t("الإجازات")}
          </DialogTitle>
        </DialogHeader>

        {/* Form Body */}
        <div className="p-6 bg-white space-y-6 max-h-[80vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-x-8 gap-y-6">
            {/* Right Column */}
            <div className="space-y-6">
              {/* Leave Type */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 flex justify-end">
                  <span className="text-red-500 ml-1">*</span> {t("نوع الإجازة")}
                </label>
                <select
                  name="leaveType"
                  value={formData.leaveType}
                  onChange={handleChange}
                  className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-start appearance-none"
                  style={{
                    backgroundImage:
                      'url(\'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="%239CA3AF"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>\')',
                    backgroundPosition: "left 0.5rem center",
                    backgroundRepeat: "no-repeat",
                    backgroundSize: "1.5em 1.5em",
                  }}
                >
                  <option value="" disabled></option>
                  {leaveTypes.map((name) => (
                    <option key={name} value={name}>{t(name)}</option>
                  ))}
                </select>
              </div>

              {/* Start Date */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 flex justify-end">
                  <span className="text-red-500 ml-1">*</span> {t("تاريخ البداية")}
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type="date"
                      name="startDate"
                      value={formData.startDate}
                      onChange={handleChange}
                      className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-start ps-10"
                    />
                    <Calendar className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                  </div>
                </div>
              </div>

              {/* Duration */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 flex justify-end">
                  {t("مدة الإجازة")}
                </label>
                <div className="w-full h-10 px-3 border border-gray-200 rounded-lg bg-gray-100 flex items-center justify-end text-sm text-gray-500">
                  {duration > 0 ? `${duration} ${t("يوم")}` : ""}
                </div>
                {datesInvalid && (
                  <p className="text-xs text-red-600">{t("تاريخ الانتهاء قبل تاريخ البداية")}</p>
                )}
              </div>

              {/* Phone */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 flex justify-end">
                  <span className="text-red-500 ml-1">*</span> {t("الهاتف")}
                </label>
                <input
                  type="tel"
                  name="phone"
                  value={formData.phone}
                  onChange={handleChange}
                  className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-start"
                />
              </div>
            </div>

            {/* Left Column */}
            <div className="space-y-6 pt-[72px]">
              {/* Note: the pt-[72px] is to align with the start date row, leaving the first row blank as in screenshot */}

              {/* End Date */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 flex justify-end">
                  <span className="text-red-500 ml-1">*</span> {t("تاريخ الانتهاء")}
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type="date"
                      name="endDate"
                      value={formData.endDate}
                      min={formData.startDate || undefined}
                      onChange={handleChange}
                      className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-start ps-10"
                    />
                    <Calendar className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                  </div>
                </div>
              </div>

              {/* Address During Leave */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 flex justify-end">
                  <span className="text-red-500 ml-1">*</span> {t("عنوان الموظف أثناء الإجازة")}
                </label>
                <input
                  type="text"
                  name="address"
                  value={formData.address}
                  onChange={handleChange}
                  className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-start"
                />
              </div>

              {/* Substitute Employee */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 flex justify-end">
                  <span className="text-red-500 ml-1">*</span> {t("الموظف البديل")}
                </label>
                {substituteFreeText ? (
                  <input
                    type="text"
                    name="substituteId"
                    value={formData.substituteId}
                    onChange={handleChange}
                    placeholder={t("اسم الموظف البديل")}
                    className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-start"
                  />
                ) : (
                  <select
                    name="substituteId"
                    value={formData.substituteId}
                    onChange={handleChange}
                    className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-start appearance-none"
                    style={{
                      backgroundImage:
                        'url(\'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="%239CA3AF"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>\')',
                      backgroundPosition: "left 0.5rem center",
                      backgroundRepeat: "no-repeat",
                      backgroundSize: "1.5em 1.5em",
                    }}
                  >
                    <option value="" disabled></option>
                    {substitutes.map((item) => (
                      <option key={item.key} value={item.key}>
                        {item.name}{item.empId ? ` (${item.empId})` : ""}{item.department ? ` - ${item.department}` : ""}
                      </option>
                    ))}
                  </select>
                )}
                {substitutesError && <p className="text-xs text-amber-700">{t(substitutesError)}</p>}
              </div>
            </div>
          </div>

          {/* Full Width Fields */}
          <div className="space-y-6 pt-4">
            {/* Reason */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700 flex justify-end">
                <span className="text-red-500 ml-1">*</span> {t("السبب")}
              </label>
              <textarea
                name="reason"
                value={formData.reason}
                onChange={handleChange}
                rows={4}
                className="w-full p-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-start resize-none"
              />
            </div>

            <EmployeeSignatureField onChange={setSignature} />

            {/* Attachments */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700 flex justify-end">
                {t("المرفق")}
              </label>
              <button
                type="button"
                disabled
                className="w-full py-3 border border-gray-200 rounded-lg text-gray-400 font-medium text-sm flex items-center justify-center gap-2 bg-gray-50 cursor-not-allowed"
              >
                <span>{t("إرفاق الملفات غير متاح حاليًا؛ سلّم المرفقات للموارد البشرية مباشرة")}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-gray-50 px-6 py-4 border-t border-gray-100 flex justify-end">
          <button
            onClick={handleSubmit}
            disabled={loading}
            className={cn(
              "px-8 py-2 bg-[#004e89] hover:bg-[#003d6d] text-white font-medium rounded-lg text-sm transition-colors",
              loading && "opacity-70 cursor-not-allowed",
            )}
          >
            {loading ? t("جاري الإرسال...") : t("إرسال")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
