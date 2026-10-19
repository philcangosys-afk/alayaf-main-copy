import { Component, useState, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, Check, Copy, Home, RotateCcw } from "lucide-react";
import { newErrorId, reportError } from "@/lib/errorReporter";

/**
 * S16: بدل الصفحة البيضاء عند خطأ في العرض: شاشة واضحة برقم الخطأ، والخطأ يُسجَّل في سجل أخطاء النظام.
 * area="root" حول التطبيق كله (خارج الموجّه والترجمة)، وarea="page" حول الصفحات: الانتقال لصفحة أخرى يعيدها.
 * لا تعتمد على سياق الترجمة: اللغة من اختيار المستخدم المحفوظ.
 */

const TEXT = {
  ar: {
    title: "تعذّر عرض هذه الصفحة",
    body: "حدث خطأ غير متوقع، وسُجّل تلقائيًا لفريق الدعم. أعد تحميل الصفحة؛ وإن تكرر الخطأ أرسل رقمه للدعم.",
    idLabel: "رقم الخطأ",
    copy: "نسخ",
    copied: "نُسخ",
    reload: "إعادة تحميل الصفحة",
    home: "العودة للرئيسية",
    chunkTitle: "صدر تحديث جديد للنظام",
    chunkBody: "أعد تحميل الصفحة لاستخدام النسخة الجديدة.",
  },
  en: {
    title: "This page couldn't be displayed",
    body: "An unexpected error occurred and was reported to support automatically. Reload the page; if it happens again, send the error number to support.",
    idLabel: "Error number",
    copy: "Copy",
    copied: "Copied",
    reload: "Reload page",
    home: "Back to home",
    chunkTitle: "A new version is available",
    chunkBody: "Reload the page to use the latest version.",
  },
} as const;

function locale(): "ar" | "en" {
  try {
    return window.localStorage.getItem("app_language") === "en" ? "en" : "ar";
  } catch {
    return "ar";
  }
}

/** ملف بناء قديم بعد نشر نسخة جديدة: العلاج إعادة التحميل، لا خطأ في الكود */
function isChunkError(error: unknown) {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /ChunkLoadError|Loading chunk|dynamically imported module|Importing a module script failed/i.test(message);
}

function homePath() {
  const path = typeof window !== "undefined" ? window.location.pathname : "/";
  return path.startsWith("/employee/") || path === "/hr/employee-dashboard" ? "/employee/dashboard" : "/";
}

function ErrorFallback({ errorId, chunk }: { errorId: string | null; chunk: boolean }) {
  const lang = locale();
  const t = TEXT[lang];
  const [copied, setCopied] = useState(false);

  const copyId = async () => {
    if (!errorId) return;
    try {
      await navigator.clipboard.writeText(errorId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // النسخ غير متاح: الرقم ظاهر ويمكن تحديده يدويًا
    }
  };

  return (
    <div dir={lang === "ar" ? "rtl" : "ltr"} className="flex min-h-[60vh] items-center justify-center bg-background px-4 py-12">
      <div role="alert" className="w-full max-w-md rounded-2xl border border-border bg-card p-7 text-start shadow-sm">
        <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
          <AlertTriangle className="h-6 w-6" aria-hidden />
        </span>
        <h1 className="text-xl font-extrabold text-foreground">{chunk ? t.chunkTitle : t.title}</h1>
        <p className="mt-2 text-[14px] leading-7 text-muted-foreground">{chunk ? t.chunkBody : t.body}</p>

        {errorId && !chunk ? (
          <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-dashed border-border bg-muted/50 px-4 py-3">
            <div className="min-w-0">
              <div className="text-[11.5px] font-semibold text-muted-foreground">{t.idLabel}</div>
              <div dir="ltr" className="select-all text-start font-mono text-[15px] font-bold tracking-wider text-foreground">
                {errorId}
              </div>
            </div>
            <button
              type="button"
              onClick={copyId}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-[12.5px] font-semibold text-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
              {copied ? t.copied : t.copy}
            </button>
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground shadow-sm hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            {t.reload}
          </button>
          {!chunk ? (
            <button
              type="button"
              onClick={() => window.location.assign(homePath())}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-bold text-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              <Home className="h-4 w-4" aria-hidden />
              {t.home}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

type Props = { children: ReactNode; area: "root" | "page"; resetKey?: string };
type State = { error: unknown; errorId: string | null; failed: boolean };

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorId: null, failed: false };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    // الرقم يُنشأ هنا ليظهر مع أول عرض للشاشة، ويُرسل نفسه مع الخطأ
    return { error, failed: true, errorId: newErrorId() };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const chunk = isChunkError(error);
    // أول مكوّن في سلسلة العرض يكفي لمعرفة مكان الخطأ (بلا بيانات)
    const component = /^\s*at\s+([A-Za-z0-9_$]+)/m.exec(info.componentStack ?? "")?.[1]
      ?? /^\s*([A-Za-z0-9_$]+)@/m.exec(info.componentStack ?? "")?.[1];
    const errorId = reportError(chunk ? "ui.chunk_load_failed" : "ui.render_crash", error, {
      level: chunk ? "warn" : this.props.area === "root" ? "fatal" : "error",
      context: { area: this.props.area, component },
      errorId: this.state.errorId ?? undefined,
    });
    if (errorId !== this.state.errorId) this.setState({ errorId });
  }

  componentDidUpdate(previous: Props) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null, errorId: null, failed: false });
    }
  }

  render() {
    if (this.state.failed) {
      return <ErrorFallback errorId={this.state.errorId} chunk={isChunkError(this.state.error)} />;
    }
    return this.props.children;
  }
}
