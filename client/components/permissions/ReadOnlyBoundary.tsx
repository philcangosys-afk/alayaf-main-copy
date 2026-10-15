import type { ReactNode } from "react";
import { LockKeyhole } from "lucide-react";
import { toast } from "sonner";

const MUTATION_WORDS = /(إضافة|اضافة|حذف|تعديل|حفظ|إنشاء|انشاء|اعتماد|رفض|إرسال|ارسال|ترحيل|إيقاف|ايقاف|تفعيل|add|edit|delete|save|create|approve|reject|submit)/i;

export default function ReadOnlyBoundary({ readOnly, children }: { readOnly: boolean; children: ReactNode }) {
  const block = () => toast.error("هذه الصلاحية للقراءة فقط ولا تسمح بإضافة أو تعديل أو حذف البيانات");

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
        event.preventDefault();
        event.stopPropagation();
        block();
      }}
    >
      {readOnly && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800" dir="rtl">
          <LockKeyhole className="h-4 w-4" />
          وضع القراءة فقط — يمكنك استعراض البيانات والبحث والطباعة، ولا يمكنك الإضافة أو التعديل أو الحذف.
        </div>
      )}
      {children}
    </div>
  );
}
