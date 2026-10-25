import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload, X, XCircle } from "lucide-react";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  downloadRejected, downloadTemplate, readImportFile, validateRows,
  type ImportFileData, type ImportRow, type ImportSpec, type ImportValues,
} from "@/lib/dataImport";

type Rejected = { line: number; values: ImportValues; reason: string };
type Phase = "choose" | "checking" | "preview" | "saving" | "done";

const PREVIEW_LIMIT = 300;
const BATCH_SIZE = 50;

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : typeof error === "string" && error ? error : fallback;

/**
 * نافذة الاستيراد من إكسل لأي شاشة: تنزيل القالب، ورفع الملف، ومعاينة كل صف بحالته (جاهز، بتنبيه، مرفوض) قبل الحفظ،
 * ثم الحفظ صفًا صفًا (أو دفعات) بدالة الشاشة نفسها، وتنزيل الصفوف المرفوضة بسبب كل صف لتصحيحها وإعادة رفعها.
 */
export default function DataImportDialog<T, C>({
  spec,
  onClose,
  onDone,
  settings,
  settingsError = null,
}: {
  spec: ImportSpec<T, C>;
  onClose: () => void;
  /** بعد الحفظ (ولو جزئيًا): لإعادة تحميل القائمة */
  onDone: (added: number) => void;
  /** إعدادات مشتركة لكل الصفوف (مثل فرع الموظفين وإدارتهم) */
  settings?: ReactNode;
  /** سبب منع الاستيراد إن لم تكتمل الإعدادات المشتركة */
  settingsError?: string | null;
}) {
  const { t, direction } = useI18n();
  // الأعداد بأرقام لاتينية كأرقام الصفوف في إكسل وفي الرسائل، في اللغتين
  const formatNumber = (value: number) => value.toLocaleString("en-US");
  const format = { t, direction };
  const [phase, setPhase] = useState<Phase>("choose");
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState("");
  const [fileData, setFileData] = useState<ImportFileData | null>(null);
  const [ctx, setCtx] = useState<C | null>(null);
  const [filter, setFilter] = useState<"all" | "error" | "warning">("all");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<{ added: number; failed: Rejected[]; stopped: boolean } | null>(null);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const cancelRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // التحقق يُعاد إن تغيّرت الإعدادات المشتركة (القواعد في spec)
  const rows: ImportRow<T>[] = useMemo(
    () => (fileData && ctx !== null ? validateRows(spec, fileData, ctx, t) : []),
    [spec, fileData, ctx, t],
  );
  const counts = useMemo(() => ({
    ready: rows.filter((row) => row.status === "ready").length,
    warning: rows.filter((row) => row.status === "warning").length,
    error: rows.filter((row) => row.status === "error").length,
  }), [rows]);
  const importable = counts.ready + counts.warning;
  const shown = rows.filter((row) => filter === "all" || row.status === filter);

  const busy = phase === "checking" || phase === "saving";
  const close = () => { if (!busy) onClose(); };
  // Escape يغلق النافذة ما لم تكن قراءة أو حفظ جاريًا، ولا يغلقها وهو في قائمة منسدلة (يغلق القائمة فقط)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy || event.defaultPrevented) return;
      if (event.target instanceof HTMLSelectElement) return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const getTemplate = async () => {
    setTemplateBusy(true);
    try {
      await downloadTemplate(spec, format);
    } catch (error) {
      setFileError(`${t("تعذر تجهيز القالب")}: ${errorMessage(error, "")}`);
    } finally {
      setTemplateBusy(false);
    }
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setFileError("");
    setFilter("all");
    setPhase("checking");
    try {
      // بيانات النظام الحالية (الموجود مسبقًا والقوائم) ثم الملف
      const context = spec.prepare ? await spec.prepare() : (undefined as C);
      const data = await readImportFile(file, spec, t);
      setCtx(() => context);
      setFileData(data);
      setPhase("preview");
    } catch (error) {
      setFileData(null);
      setFileError(errorMessage(error, t("تعذر قراءة الملف")));
      setPhase("choose");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const runImport = async () => {
    if (ctx === null || settingsError) return;
    const items = rows.filter((row) => row.status !== "error" && row.value !== undefined);
    if (!items.length) return;
    cancelRef.current = false;
    setPhase("saving");
    setProgress({ done: 0, total: items.length });
    const failed: Rejected[] = [];
    let added = 0;
    let done = 0;
    const saveOne = async (row: ImportRow<T>) => {
      let message: string | null;
      try {
        message = await spec.save(row.value as T, ctx);
      } catch (error) {
        message = errorMessage(error, t("تعذر الحفظ"));
      }
      if (message) failed.push({ line: row.line, values: row.values, reason: message });
      else added += 1;
      done += 1;
      setProgress({ done, total: items.length });
    };

    let index = 0;
    while (index < items.length && !cancelRef.current) {
      if (spec.saveBatch) {
        const chunk = items.slice(index, index + BATCH_SIZE);
        let batchError: string | null;
        try {
          batchError = await spec.saveBatch(chunk.map((row) => row.value as T), ctx);
        } catch (error) {
          batchError = errorMessage(error, t("تعذر الحفظ"));
        }
        if (!batchError) {
          added += chunk.length;
          done += chunk.length;
          setProgress({ done, total: items.length });
        } else {
          // الدفعة فشلت كلها (معاملة واحدة): تُحفظ صفًا صفًا لمعرفة سبب كل صف
          for (const row of chunk) {
            if (cancelRef.current) break;
            await saveOne(row);
          }
        }
        index += chunk.length;
      } else {
        await saveOne(items[index]);
        index += 1;
      }
    }
    const stopped = cancelRef.current && done < items.length;
    // ما لم يُحفظ بعد الإيقاف يُعاد مع المرفوض ليُرفع مرة أخرى
    if (stopped) {
      const handled = new Set(failed.map((row) => row.line));
      items.slice(done).forEach((row) => {
        if (!handled.has(row.line)) failed.push({ line: row.line, values: row.values, reason: t("أُوقف الاستيراد قبل حفظ هذا الصف") });
      });
    }
    setResult({ added, failed, stopped });
    setPhase("done");
    if (added > 0) onDone(added);
  };

  const rejectedAll = (): Rejected[] => [
    ...rows.filter((row) => row.status === "error").map((row) => ({ line: row.line, values: row.values, reason: row.message })),
    ...(result?.failed ?? []),
  ].sort((a, b) => a.line - b.line);

  const getRejected = async () => {
    try {
      await downloadRejected(spec, rejectedAll(), format);
    } catch (error) {
      setFileError(`${t("تعذر تجهيز الملف")}: ${errorMessage(error, "")}`);
    }
  };

  const reset = () => {
    setPhase("choose");
    setFileData(null);
    setCtx(null);
    setResult(null);
    setFileName("");
    setFileError("");
  };

  const statusBadge = (row: ImportRow<T>) =>
    row.status === "error" ? <XCircle className="h-4 w-4 text-red-600" aria-label={t("مرفوض")} />
      : row.status === "warning" ? <AlertTriangle className="h-4 w-4 text-amber-600" aria-label={t("بتنبيه")} />
        : <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label={t("جاهز")} />;

  const chip = (label: string, value: number, tone: string, key?: "all" | "error" | "warning") => (
    <button type="button" onClick={() => key && setFilter(key)} disabled={!key}
      className={cn("rounded-full border px-3 py-1 text-xs font-semibold", tone, key && filter === key && "ring-2 ring-offset-1 ring-slate-400")}>
      {t(label)}: <span className="tabular-nums">{formatNumber(value)}</span>
    </button>
  );

  const title = `${t("استيراد من إكسل")} — ${t(spec.title)}`;

  return createPortal(
    <div dir={direction} className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-slate-950/45 p-4 pt-[5vh]" role="dialog" aria-modal="true" aria-label={title}
      onMouseDown={close}>
      <section className="w-full max-w-5xl rounded-xl bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-emerald-50 p-2 text-emerald-700"><FileSpreadsheet className="h-5 w-5" /></div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">{title}</h2>
              <p className="text-xs text-slate-500">{t("نزّل القالب، واملأه أو الصق فيه بياناتك من النظام الآخر، ثم ارفعه هنا.")}</p>
            </div>
          </div>
          <button type="button" onClick={close} disabled={busy} className="rounded p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-40" aria-label={t("إغلاق")}>
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="max-h-[75vh] space-y-4 overflow-y-auto px-5 py-4">
          {(phase === "choose" || phase === "checking") && (
            <>
              <div className="rounded-lg border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-sm font-bold text-slate-800">{t("1. القالب")}</h3>
                  <button type="button" onClick={() => void getTemplate()} disabled={templateBusy}
                    className="inline-flex items-center gap-2 rounded-lg border border-emerald-600 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
                    {templateBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}{t("تنزيل القالب")}
                  </button>
                </div>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-xs text-slate-500">
                      <tr><th className="px-3 py-2 text-start">{t("العمود")}</th><th className="px-3 py-2 text-start">{t("الوصف")}</th><th className="px-3 py-2 text-start">{t("مثال")}</th></tr>
                    </thead>
                    <tbody>
                      {spec.columns.map((column) => (
                        <tr key={column.key} className="border-t border-slate-100">
                          <td className="whitespace-nowrap px-3 py-2 font-semibold text-slate-800">
                            {t(column.label)}{column.required && <span className="ms-1 text-red-600">*</span>}
                          </td>
                          <td className="px-3 py-2 text-slate-600">{t(column.hint)}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-slate-500"><bdi>{column.example ?? ""}</bdi></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-xs text-slate-500">{t("الأعمدة المعلّمة بـ * مطلوبة، والباقي يمكن إكماله لاحقًا من شاشة السجل.")}</p>
                {spec.notes?.length ? (
                  <ul className="mt-2 list-disc space-y-1 ps-5 text-xs leading-6 text-slate-600">
                    {spec.notes.map((note) => <li key={note}>{t(note)}</li>)}
                  </ul>
                ) : null}
              </div>

              {settings && (
                <div className="rounded-lg border border-slate-200 p-4">
                  <h3 className="mb-3 text-sm font-bold text-slate-800">{t("بيانات مشتركة لكل الصفوف")}</h3>
                  {settings}
                </div>
              )}

              <div className="rounded-lg border border-slate-200 p-4">
                <h3 className="mb-3 text-sm font-bold text-slate-800">{t("2. رفع الملف")}</h3>
                <label
                  onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => { event.preventDefault(); setDragging(false); if (phase !== "checking") void pickFile(event.dataTransfer.files?.[0]); }}
                  className={cn("flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center",
                    dragging ? "border-emerald-500 bg-emerald-50" : "border-slate-300 hover:bg-slate-50", phase === "checking" && "pointer-events-none opacity-60")}>
                  {phase === "checking" ? <Loader2 className="h-7 w-7 animate-spin text-emerald-600" /> : <Upload className="h-7 w-7 text-slate-400" />}
                  <span className="text-sm font-semibold text-slate-700">
                    {phase === "checking" ? `${t("جارٍ قراءة الملف والتحقق من صفوفه...")} ${fileName}` : t("اختر ملف إكسل أو اسحبه هنا")}
                  </span>
                  <span className="text-xs text-slate-500">xlsx · xls · csv</span>
                  <input ref={inputRef} type="file" accept=".xlsx,.xls,.xlsm,.csv" className="hidden" disabled={phase === "checking"}
                    onChange={(event) => void pickFile(event.target.files?.[0])} />
                </label>
              </div>
            </>
          )}

          {phase === "preview" && fileData && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-slate-600">
                  <bdi className="font-semibold text-slate-800">{fileName}</bdi>
                  <span className="mx-2 text-slate-300">|</span>{t("الورقة")}: <bdi>{fileData.sheetName}</bdi>
                </p>
                <div className="flex flex-wrap gap-2">
                  {chip("الكل", rows.length, "border-slate-200 bg-white text-slate-700", "all")}
                  {chip("جاهز", counts.ready, "border-emerald-200 bg-emerald-50 text-emerald-800")}
                  {chip("بتنبيه", counts.warning, "border-amber-200 bg-amber-50 text-amber-800", counts.warning ? "warning" : undefined)}
                  {chip("مرفوض", counts.error, "border-red-200 bg-red-50 text-red-700", counts.error ? "error" : undefined)}
                </div>
              </div>
              {fileData.unknownHeaders.length > 0 && (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  {t("أعمدة في الملف لا تخص القالب وتُهمل")}: <bdi>{fileData.unknownHeaders.join("، ")}</bdi>
                </p>
              )}
              {fileData.ignoredHeaders.length > 0 && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {t("أعمدة مكررة لعمود واحد؛ قُرئ الأقرب لعنوان القالب وأُهملت هذه")}: <bdi>{fileData.ignoredHeaders.join("، ")}</bdi>
                </p>
              )}
              {settingsError && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{settingsError}</p>}
              {settings && (
                <details className="rounded-lg border border-slate-200 p-3">
                  <summary className="cursor-pointer text-sm font-semibold text-slate-700">{t("بيانات مشتركة لكل الصفوف")}</summary>
                  <div className="mt-3">{settings}</div>
                </details>
              )}
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th className="px-2 py-2">{t("الصف")}</th>
                      <th className="px-2 py-2" />
                      {spec.columns.map((column) => <th key={column.key} className="whitespace-nowrap px-2 py-2 text-start">{t(column.label)}</th>)}
                      <th className="px-2 py-2 text-start">{t("الملاحظة")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.slice(0, PREVIEW_LIMIT).map((row) => (
                      <tr key={row.line} className={cn("border-t border-slate-100", row.status === "error" && "bg-red-50/60", row.status === "warning" && "bg-amber-50/60")}>
                        <td className="px-2 py-1.5 text-center text-xs tabular-nums text-slate-500">{row.line}</td>
                        <td className="px-2 py-1.5">{statusBadge(row)}</td>
                        {spec.columns.map((column) => (
                          <td key={column.key} className="max-w-[220px] truncate px-2 py-1.5 text-slate-700" title={row.values[column.key]}><bdi>{row.values[column.key]}</bdi></td>
                        ))}
                        <td className={cn("min-w-[220px] px-2 py-1.5 text-xs", row.status === "error" ? "text-red-700" : "text-amber-800")}>{row.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {shown.length > PREVIEW_LIMIT && (
                <p className="text-xs text-slate-500">{t("يُعرض أول 300 صف؛ كل الصفوف تُستورد، والمرفوض كله في ملف المرفوض.")}</p>
              )}
            </>
          )}

          {phase === "saving" && (
            <div className="space-y-3 py-6 text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-emerald-600" />
              <p className="text-sm font-semibold text-slate-700">
                {t("جارٍ الحفظ")}: <span className="tabular-nums">{formatNumber(progress.done)} / {formatNumber(progress.total)}</span>
              </p>
              <div className="mx-auto h-2 max-w-md overflow-hidden rounded-full bg-slate-100">
                <div className="h-full bg-emerald-600 transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
              </div>
              <p className="text-xs text-slate-500">{t("لا تغلق الصفحة حتى ينتهي الحفظ.")}</p>
            </div>
          )}

          {phase === "done" && result && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-xs font-semibold text-emerald-700">{t("أُضيف")}</p>
                  <p className="text-2xl font-extrabold tabular-nums text-emerald-800">{formatNumber(result.added)}</p>
                </div>
                <div className={cn("rounded-lg border p-4", rejectedAll().length ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50")}>
                  <p className={cn("text-xs font-semibold", rejectedAll().length ? "text-red-700" : "text-slate-600")}>{t("لم يُضف")}</p>
                  <p className={cn("text-2xl font-extrabold tabular-nums", rejectedAll().length ? "text-red-700" : "text-slate-700")}>{formatNumber(rejectedAll().length)}</p>
                </div>
              </div>
              {result.stopped && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("أُوقف الاستيراد؛ الصفوف التي لم تُحفظ في ملف المرفوض.")}</p>}
              {rejectedAll().length > 0 && (
                <>
                  <p className="text-sm text-slate-600">{t("نزّل ملف المرفوض: فيه الصفوف بعناوين القالب نفسها وسبب كل صف. صحّحها ثم ارفع الملف كما هو.")}</p>
                  <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200">
                    <table className="w-full text-sm">
                      <tbody>
                        {rejectedAll().slice(0, 100).map((row) => (
                          <tr key={`${row.line}-${row.reason}`} className="border-t border-slate-100 first:border-t-0">
                            <td className="w-16 px-2 py-1.5 text-center text-xs tabular-nums text-slate-500">{row.line}</td>
                            <td className="px-2 py-1.5 font-semibold text-slate-700"><bdi>{row.values[spec.columns[0].key]}</bdi></td>
                            <td className="px-2 py-1.5 text-xs text-red-700">{row.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {fileError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{fileError}</p>}
        </div>

        <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-4">
          {phase === "preview" && (
            <>
              <button type="button" onClick={reset} className="rounded-lg border border-slate-200 px-4 py-2 text-sm">{t("ملف آخر")}</button>
              {counts.error > 0 && (
                <button type="button" onClick={() => void getRejected()} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm">
                  <Download className="h-4 w-4" />{t("تنزيل المرفوض")}
                </button>
              )}
              <button type="button" onClick={() => void runImport()} disabled={importable === 0 || Boolean(settingsError)}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                <Upload className="h-4 w-4" />{`${t("إضافة الصفوف الصالحة")} (${formatNumber(importable)})`}
              </button>
            </>
          )}
          {phase === "saving" && (
            <button type="button" onClick={() => { cancelRef.current = true; }} className="rounded-lg border border-slate-200 px-4 py-2 text-sm">{t("إيقاف الاستيراد")}</button>
          )}
          {phase === "done" && (
            <>
              {rejectedAll().length > 0 && (
                <button type="button" onClick={() => void getRejected()} className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50">
                  <Download className="h-4 w-4" />{t("تنزيل المرفوض لتصحيحه")}
                </button>
              )}
              <button type="button" onClick={reset} className="rounded-lg border border-slate-200 px-4 py-2 text-sm">{t("ملف آخر")}</button>
              <button type="button" onClick={onClose} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">{t("إغلاق")}</button>
            </>
          )}
          {(phase === "choose" || phase === "checking") && (
            <button type="button" onClick={close} disabled={busy} className="rounded-lg border border-slate-200 px-4 py-2 text-sm disabled:opacity-40">{t("إغلاق")}</button>
          )}
        </footer>
      </section>
    </div>,
    document.body,
  );
}

/** زر «استيراد من إكسل» يفتح النافذة (العنوان يحوي «إضافة» فتمنعه صلاحية القراءة فقط) */
export function DataImportButton<T, C>({
  spec,
  onDone,
  className,
  settings,
  settingsError,
  onOpen,
}: {
  spec: ImportSpec<T, C>;
  onDone: (added: number) => void;
  className?: string;
  settings?: ReactNode;
  settingsError?: string | null;
  onOpen?: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => { onOpen?.(); setOpen(true); }} title={t("إضافة سجلات من ملف إكسل")}
        className={className ?? "inline-flex items-center gap-2 rounded-lg border border-emerald-600 bg-white px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"}>
        <FileSpreadsheet className="h-4 w-4" />{t("استيراد من إكسل")}
      </button>
      {open && <DataImportDialog spec={spec} onClose={() => setOpen(false)} onDone={onDone} settings={settings} settingsError={settingsError} />}
    </>
  );
}
