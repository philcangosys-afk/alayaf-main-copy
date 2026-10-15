import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { cn } from "@/lib/utils";

// ملفات الموظفين (الصورة والمستندات) في حاوية خاصة؛ تُعرض بروابط موقّعة مؤقتة.
// القيمة المحفوظة في الجدول: "employee-files/<معرّف الموظف>/<النوع>/<uuid>-<اسم آمن>"
export const EMPLOYEE_FILES_BUCKET = "employee-files";
export const EMPLOYEE_FILE_ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";
export const EMPLOYEE_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";
const MAX_EMPLOYEE_FILE_BYTES = 5 * 1024 * 1024;
const STORAGE_PREFIX = `${EMPLOYEE_FILES_BUCKET}/`;

export const isEmployeeStoragePath = (value: string | null | undefined) =>
  typeof value === "string" && value.startsWith(STORAGE_PREFIX);

const objectPath = (value: string) => value.slice(STORAGE_PREFIX.length);

export const validateEmployeeFile = (file: File, imageOnly = false): string | null => {
  const allowed = (imageOnly ? EMPLOYEE_IMAGE_ACCEPT : EMPLOYEE_FILE_ACCEPT).split(",");
  if (!allowed.includes(file.type)) {
    return imageOnly ? "الصورة يجب أن تكون JPG أو PNG أو WEBP" : "الملف يجب أن يكون صورة (JPG/PNG/WEBP) أو PDF";
  }
  if (file.size > MAX_EMPLOYEE_FILE_BYTES) return "حجم الملف أكبر من 5 ميجابايت";
  if (file.size === 0) return "الملف فارغ";
  return null;
};

const safeFileName = (name: string) => {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  const base = (dot > 0 ? name.slice(0, dot) : name).replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_").slice(0, 60) || "file";
  return ext ? `${base}.${ext}` : base;
};

export const uploadEmployeeFile = async (employeeId: string, kind: string, file: File): Promise<string> => {
  const path = `${employeeId}/${kind}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
  const { error } = await supabase.storage
    .from(EMPLOYEE_FILES_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return `${STORAGE_PREFIX}${path}`;
};

export const employeeFileName = (value: string) => {
  if (!isEmployeeStoragePath(value)) return value;
  const last = value.split("/").pop() ?? value;
  return last.replace(/^[0-9a-f-]{36}-/, "");
};

const signedUrlCache = new Map<string, { url: string; expires: number }>();

export const employeeFileUrl = async (value: string): Promise<string> => {
  if (!value) return "";
  if (!isEmployeeStoragePath(value)) return value;
  const cached = signedUrlCache.get(value);
  if (cached && cached.expires > Date.now()) return cached.url;
  const { data, error } = await supabase.storage
    .from(EMPLOYEE_FILES_BUCKET)
    .createSignedUrl(objectPath(value), 3600);
  if (error || !data?.signedUrl) return "";
  signedUrlCache.set(value, { url: data.signedUrl, expires: Date.now() + 50 * 60 * 1000 });
  return data.signedUrl;
};

// يفتح نافذة فورًا (قبل الانتظار) حتى لا يحجبها المتصفح، ثم يوجّهها للرابط الموقّع
export const openEmployeeFile = async (value: string): Promise<boolean> => {
  const target = window.open("", "_blank");
  const url = await employeeFileUrl(value);
  if (!url) {
    target?.close();
    return false;
  }
  if (target) {
    target.opener = null;
    target.location.href = url;
  } else {
    window.location.assign(url);
  }
  return true;
};

export function EmployeePhoto({
  value,
  name,
  className,
}: {
  value: string | null | undefined;
  name: string;
  className?: string;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let cancelled = false;
    setUrl("");
    if (value) {
      employeeFileUrl(value).then((resolved) => {
        if (!cancelled) setUrl(resolved);
      });
    }
    return () => { cancelled = true; };
  }, [value]);

  if (url) return <img src={url} alt={name} className={cn("h-full w-full object-cover", className)} />;
  return <>{(name || "م").trim().charAt(0)}</>;
}
