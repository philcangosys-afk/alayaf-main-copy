import { useEffect, useState } from "react";
import QRCode from "qrcode";

type ZatcaQrCodeProps = {
  value?: string | null;
  size?: number;
  className?: string;
  status?: string | null;
};

export default function ZatcaQrCode({
  value,
  size = 112,
  className = "",
  status,
}: ZatcaQrCodeProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setDataUrl(null);
    if (!value)
      return () => {
        active = false;
      };

    QRCode.toDataURL(value, {
      width: size,
      margin: 4,
      errorCorrectionLevel: "M",
    })
      .then((url) => {
        if (active) setDataUrl(url);
      })
      .catch(() => {
        if (active) setDataUrl(null);
      });

    return () => {
      active = false;
    };
  }, [size, value]);

  if (!dataUrl) {
    return (
      <div
        className={`grid place-items-center border border-slate-200 bg-slate-50 text-center text-[10px] text-slate-500 ${className}`}
        style={{ width: size, height: size }}
      >
        {value
          ? "جارٍ إنشاء QR"
          : status === "ambiguous"
            ? "يتطلب مراجعة — لا تعد الإرسال"
            : status === "rejected"
              ? "لم يتم إنشاء QR"
              : "QR بعد اعتماد الفاتورة"}
      </div>
    );
  }

  return (
    <img
      src={dataUrl}
      alt="رمز QR لفاتورة ZATCA"
      width={size}
      height={size}
      className={`bg-white object-contain ${className}`}
    />
  );
}
