import { MoreHorizontal, Pencil, Trash2, Plus, Building2 } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useI18n } from "@/i18n";
import type { AccountNode } from "./accountData";

type Props = {
  account: AccountNode;
  onEdit: () => void;
  onDelete: () => void;
  onAddSubAccount: () => void;
  onAddBankSubAccount: () => void;
};

export default function AccountActionsMenu({
  account,
  onEdit,
  onDelete,
  onAddSubAccount,
  onAddBankSubAccount,
}: Props) {
  const { t, direction } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const canDelete = !account.isSystem;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        title={t("المزيد")}
        aria-label={t("المزيد")}
        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground transition"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && (
        <div
          className={`absolute ${direction === "rtl" ? "right-0" : "left-0"} top-full z-50 mt-1 w-64 rounded-lg border border-border bg-white shadow-lg`}
          dir={direction}
        >
          {/* Edit */}
          <button
            onClick={() => { onEdit(); setOpen(false); }}
            aria-label={t("تعديل الحساب")}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-foreground hover:bg-muted/40 transition"
          >
            <Pencil className="h-4 w-4 text-muted-foreground" />
            <span>{t("تعديل الحساب")}</span>
          </button>

          {/* Delete */}
          <button
            onClick={() => { if (canDelete) { onDelete(); } setOpen(false); }}
            aria-label={t("حذف حساب")}
            className={`flex w-full items-center gap-2 px-4 py-2.5 text-sm transition ${
              canDelete
                ? "text-foreground hover:bg-muted/40"
                : "text-muted-foreground cursor-not-allowed"
            }`}
          >
            <Trash2 className="h-4 w-4" />
            <span>{t("حذف حساب")}</span>
          </button>

          {!canDelete && (
            <div className={`mx-3 mb-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700 ${direction === "rtl" ? "text-right" : "text-left"} leading-relaxed`}>
              {t("لا يمكن حذف هذا الحساب بسبب وجود معاملات أو قيود في دفتر الأستاذ العام، أو لأنه حساب نظامي.")}
            </div>
          )}

          <div className="border-t border-border" />

          {/* Add Sub Account */}
          <button
            onClick={() => { onAddSubAccount(); setOpen(false); }}
            aria-label={t("إضافة حساب فرعي")}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-foreground hover:bg-muted/40 transition"
          >
            <Plus className="h-4 w-4 text-muted-foreground" />
            <span>{t("إضافة حساب فرعي")}</span>
          </button>

          {/* Add Sub Account as Bank */}
          <button
            onClick={() => { onAddBankSubAccount(); setOpen(false); }}
            aria-label={t("إضافة حساب فرعي كحساب بنك")}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-foreground hover:bg-muted/40 transition"
          >
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <span>{t("إضافة حساب فرعي كحساب بنك")}</span>
          </button>

          <div className={`mx-3 mb-2 mt-1 text-xs text-muted-foreground ${direction === "rtl" ? "text-right" : "text-left"} leading-relaxed`}>
            {t("سيتم أيضاً إنشاء حساب بنكي في وحدة الحسابات البنكية. تتيح لك الحسابات البنكية تسجيل المعاملات المصرفية بسهولة واستيراد كشف الحساب ومطابقته.")}
          </div>
        </div>
      )}
    </div>
  );
}
