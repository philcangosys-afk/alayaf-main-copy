import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n";
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast";

export function Toaster() {
  const { toasts } = useToast();
  const { t } = useI18n();

  return (
    <ToastProvider label={t("الإشعارات")}>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast key={id} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose aria-label={t("إغلاق")} />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
