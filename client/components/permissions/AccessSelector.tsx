import { Eye, Pencil, ShieldX } from "lucide-react";

import { useI18n } from "@/i18n";

export type AccessLevel = "none" | "read" | "manage";

export default function AccessSelector({ value, onChange, compact = false }: { value: AccessLevel; onChange: (value: AccessLevel) => void; compact?: boolean }) {
  const { t, direction } = useI18n();
  const options = [
    { value: "none" as const, label: t("بدون وصول"), icon: ShieldX, active: "bg-gray-700 text-white border-gray-700" },
    { value: "read" as const, label: t("قراءة فقط"), icon: Eye, active: "bg-blue-600 text-white border-blue-600" },
    { value: "manage" as const, label: t("إدارة كاملة"), icon: Pencil, active: "bg-emerald-600 text-white border-emerald-600" },
  ];
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm" dir={direction}>
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <button key={option.value} type="button" onClick={() => onChange(option.value)} title={option.label} className={`flex items-center gap-1.5 border-l border-gray-200 px-2.5 py-2 text-xs font-semibold transition last:border-l-0 ${value === option.value ? option.active : "text-gray-500 hover:bg-gray-50"}`}>
            <Icon className="h-3.5 w-3.5" />
            {!compact && <span>{option.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
