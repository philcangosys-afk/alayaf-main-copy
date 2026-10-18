import type { ReactNode } from "react";
import { LockKeyhole } from "lucide-react";
import { toast } from "sonner";

const MUTATION_WORDS = /(إضافة|اضافة|حذف|تعديل|حفظ|إنشاء|انشاء|اعتماد|رفض|إرسال|ارسال|ترحيل|إيقاف|ايقاف|تفعيل|add|edit|delete|save|create|approve|reject|submit)/i;
// S15: في القراءة فقط بسبب الاشتراك يبقى متاحًا: الإرسال للهيئة (التزام نظامي، والخادم يسمح به)، وتعطيل الموظفين
// والمستخدمين وإيقاف دخولهم (سحب الصلاحية لا ينتظر الدفع؛ الخادم يسمح بالتعطيل فقط ويرفض غيره)
const SUBSCRIPTION_ALLOWED = /(الهيئة|زاتكا|ZATCA|تعطيل|إيقاف|ايقاف|deactivate|disable)/i;

/**
 * reason = "subscription" (S15): المنشأة للقراءة فقط لانتهاء التجربة أو الاشتراك؛ التنبيه في أعلى الصفحة (SubscriptionBanner)
 * فلا يتكرر هنا، والرسالة عند محاولة التعديل تذكر الاشتراك. الخادم يرفض الكتابة على أي حال.
 */
export default function ReadOnlyBoundary({
  readOnly,
  children,
  reason = "permission",
}: {
  readOnly: boolean;
  children: ReactNode;
  reason?: "permission" | "subscription";
}) {
  const block = () =>
    toast.error(
      reason === "subscription"
        ? "المنشأة في وضع القراءة فقط حتى تفعيل الاشتراك؛ لا يمكن الإضافة أو التعديل أو الحذف"
        : "هذه الصلاحية للقراءة فقط ولا تسمح بإضافة أو تعديل أو حذف البيانات",
    );

  return (
    <div
      className="min-h-full"
      onSubmitCapture={(event) => {
        if (!readOnly) return;
        // جزء تسمح به صلاحية أخرى (مثل السداد لصاحب صلاحية الحسابات)؛ القاعدة تفرض الصلاحية على أي حال
        if ((event.target as HTMLElement).closest("[data-readonly-exempt]")) return;
        event.preventDefault();
        event.stopPropagation();
        block();
      }}
      onClickCapture={(event) => {
        if (!readOnly) return;
        const action = (event.target as HTMLElement).closest("button, a");
        if (!action) return;
        if (action.closest("[data-readonly-exempt]")) return;
        const descriptor = `${action.textContent ?? ""} ${action.getAttribute("title") ?? ""} ${action.getAttribute("aria-label") ?? ""} ${action.getAttribute("href") ?? ""}`;
        if (!MUTATION_WORDS.test(descriptor)) return;
        if (reason === "subscription" && SUBSCRIPTION_ALLOWED.test(descriptor)) return;
        event.preventDefault();
        event.stopPropagation();
        block();
      }}
    >
      {readOnly && reason === "permission" && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800" dir="rtl">
          <LockKeyhole className="h-4 w-4" />
          وضع القراءة فقط — يمكنك استعراض البيانات والبحث والطباعة، ولا يمكنك الإضافة أو التعديل أو الحذف.
        </div>
      )}
      {children}
    </div>
  );
}
