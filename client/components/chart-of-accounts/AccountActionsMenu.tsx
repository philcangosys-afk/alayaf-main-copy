import { MoreHorizontal, Pencil, Trash2, Plus, Building2, WalletCards } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useI18n } from "@/i18n";
import type { AccountNode } from "./accountData";

type Props = {
  account: AccountNode;
  onEdit: () => void;
  onDelete: () => void;
  onAddSubAccount: () => void;
  /** ينشئ حساب دليل فرعيًا ومعه حساب بنكي (save_accounting_bank_account) */
  onAddBankSubAccount: () => void;
  /** ينشئ حساب دليل فرعيًا ومعه صندوق نقدي */
  onAddCashSubAccount: () => void;
  /** الحساب داخل «النقد وما يعادله» (111) وليس تحت الشيكات (1112) */
  cashSubtree: boolean;
};

export default function AccountActionsMenu({
  account,
  onEdit,
  onDelete,
  onAddSubAccount,
  onAddBankSubAccount,
  onAddCashSubAccount,
  cashSubtree,
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

          {/* Add Sub Account as Bank / Cash box: creates the chart account and the bank row together */}
          <button
            onClick={() => { if (cashSubtree) { onAddBankSubAccount(); setOpen(false); } }}
            disabled={!cashSubtree}
            aria-label={t("إضافة حساب بنكي فرعي")}
            className={`flex w-full items-center gap-2 px-4 py-2.5 text-sm transition ${cashSubtree ? "text-foreground hover:bg-muted/40" : "text-muted-foreground cursor-not-allowed"}`}
          >
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <span>{t("إضافة حساب بنكي فرعي")}</span>
          </button>
          <button
            onClick={() => { if (cashSubtree) { onAddCashSubAccount(); setOpen(false); } }}
            disabled={!cashSubtree}
            aria-label={t("إضافة صندوق نقدي فرعي")}
            className={`flex w-full items-center gap-2 px-4 py-2.5 text-sm transition ${cashSubtree ? "text-foreground hover:bg-muted/40" : "text-muted-foreground cursor-not-allowed"}`}
          >
            <WalletCards className="h-4 w-4 text-muted-foreground" />
            <span>{t("إضافة صندوق نقدي فرعي")}</span>
          </button>

          <div className={`mx-3 mb-2 mt-1 text-xs text-muted-foreground ${direction === "rtl" ? "text-right" : "text-left"} leading-relaxed`}>
            {cashSubtree
              ? t("يُنشأ حساب فرعي جديد في الشجرة ومعه حساب بنكي أو صندوق مربوط به في صفحة الحسابات البنكية، فيظهر في الدفع والتحصيل ومطابقة كشف البنك.")
              : t("إضافة بنك أو صندوق متاحة فقط تحت «النقد وما يعادله» (111)، وليس تحت الشيكات (1112).")}
          </div>
        </div>
      )}
    </div>
  );
}
