import { useEffect, useRef, useState } from "react";
import { CheckCircle, Eraser, Loader2, PenLine } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";

export type EmployeeSignature = {
  signatureData: string;
  updatedAt: string;
};

type Props = {
  onChange: (signature: EmployeeSignature | null) => void;
};

export default function EmployeeSignatureField({ onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const hasInkRef = useRef(false);
  const [signature, setSignature] = useState<EmployeeSignature | null>(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc("get_my_employee_signature");
      if (!error && data?.signatureData) {
        const saved = {
          signatureData: String(data.signatureData),
          updatedAt: String(data.updatedAt ?? ""),
        };
        setSignature(saved);
        onChange(saved);
      } else {
        setSignature(null);
        onChange(null);
      }
      setLoading(false);
    };
    void load();
  }, [onChange]);

  useEffect(() => {
    if (!editing) return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#111827";
    context.lineWidth = 3;
    context.lineCap = "round";
    context.lineJoin = "round";
    hasInkRef.current = false;
  }, [editing]);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const startDrawing = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const current = point(event);
    context.beginPath();
    context.moveTo(current.x, current.y);
    drawingRef.current = true;
  };

  const draw = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    const current = point(event);
    context.lineTo(current.x, current.y);
    context.stroke();
    hasInkRef.current = true;
  };

  const stopDrawing = () => {
    drawingRef.current = false;
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    hasInkRef.current = false;
  };

  const saveSignature = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasInkRef.current) {
      toast.error("وقّع داخل المساحة البيضاء أولاً");
      return;
    }

    setSaving(true);
    try {
      const signatureData = canvas.toDataURL("image/png");
      const { data, error } = await supabase.rpc("save_my_employee_signature", {
        p_signature_data: signatureData,
      });
      if (error) throw error;
      const saved = {
        signatureData: String(data.signatureData),
        updatedAt: String(data.updatedAt ?? new Date().toISOString()),
      };
      setSignature(saved);
      onChange(saved);
      setEditing(false);
      toast.success("تم حفظ التوقيع الإلكتروني");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر حفظ التوقيع");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-gray-50 py-6 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> جاري تحميل التوقيع...
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-800">التوقيع الإلكتروني *</p>
          <p className="mt-1 text-xs text-gray-500">يُحفظ توقيعك ويُرفق تلقائيًا مع الطلبات التي ترسلها.</p>
        </div>
        {signature && !editing && (
          <span className="flex items-center gap-1 text-xs font-medium text-emerald-700">
            <CheckCircle className="h-4 w-4" /> توقيع محفوظ
          </span>
        )}
      </div>

      {signature && !editing ? (
        <div className="space-y-3">
          <div className="flex min-h-28 items-center justify-center rounded-lg border border-gray-200 bg-white p-3">
            <img src={signature.signatureData} alt="توقيع الموظف" className="max-h-24 max-w-full object-contain" />
          </div>
          <button type="button" onClick={() => setEditing(true)} className="flex w-full items-center justify-center gap-2 rounded-lg border border-blue-200 bg-white py-2 text-sm font-medium text-blue-700 hover:bg-blue-50">
            <PenLine className="h-4 w-4" /> تحديث التوقيع
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <canvas
            ref={canvasRef}
            width={600}
            height={200}
            onPointerDown={startDrawing}
            onPointerMove={draw}
            onPointerUp={stopDrawing}
            onPointerCancel={stopDrawing}
            onPointerLeave={stopDrawing}
            className="h-44 w-full touch-none rounded-lg border-2 border-dashed border-gray-300 bg-white cursor-crosshair"
            aria-label="مساحة التوقيع الإلكتروني"
          />
          <p className="text-center text-xs text-gray-400">وقّع داخل المساحة البيضاء باستخدام الإصبع أو الفأرة</p>
          <div className="flex gap-2">
            <button type="button" onClick={clearCanvas} disabled={saving} className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white py-2 text-sm text-gray-700 disabled:opacity-50">
              <Eraser className="h-4 w-4" /> مسح
            </button>
            {signature && (
              <button type="button" onClick={() => setEditing(false)} disabled={saving} className="flex-1 rounded-lg border border-gray-300 bg-white py-2 text-sm text-gray-700 disabled:opacity-50">إلغاء</button>
            )}
            <button type="button" onClick={saveSignature} disabled={saving} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#004e89] py-2 text-sm font-medium text-white disabled:opacity-50">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}
              {saving ? "جاري الحفظ..." : "حفظ التوقيع"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
