/**
 * S16: التقاط أخطاء الواجهة وإرسالها إلى سجل أخطاء النظام (app_error_logs عبر log_client_error).
 *
 * - كل خطأ يأخذ «رقم خطأ» قصيرًا (مثل E3F9A1C20B) يظهر للمستخدم ليرسله مع البلاغ، ويُبحث به في لوحة المنصة.
 * - المنشأة والمستخدم يحددهما الخادم من الجلسة؛ لا يُرسل من هنا أي بريد أو اسم.
 * - الصفحة تُرسل بلا معاملات (?…) ولا جزء بعد #، والخادم يخفي ما يشبه الرموز والبريد والأرقام الطويلة.
 * - حد في المتصفح: الخطأ نفسه يُرسل مرة كل دقيقة (وتكراره يأخذ رقمه نفسه)، و25 خطأ كل 10 دقائق.
 *   الإرسال لا يرمي ولا يكرر نفسه أبدًا. في التطوير (npm run dev) لا يُرسل شيء: يظهر في وحدة التحكم فقط.
 *
 * الإرسال يُسجَّل من supabaseClient (registerErrorTransport) حتى لا يتبادل الملفان الاستيراد.
 */

export type ErrorLevel = "warn" | "error" | "fatal";

type ErrorPayload = Record<string, unknown>;
type Transport = (payload: ErrorPayload) => Promise<unknown>;

declare const __APP_VERSION__: string | undefined;

const APP_VERSION = (() => {
  try {
    return typeof __APP_VERSION__ === "string" && __APP_VERSION__ ? __APP_VERSION__ : "dev";
  } catch {
    return "dev";
  }
})();

const IS_DEV = (() => {
  try {
    return Boolean(import.meta.env.DEV);
  } catch {
    return false;
  }
})();

const DEDUPE_MS = 60_000;
const WINDOW_MS = 10 * 60_000;
const MAX_PER_WINDOW = 25;
const MAX_QUEUE = 10;

let transport: Transport | null = null;
const queue: ErrorPayload[] = [];
/** آخر إرسال لكل خطأ: وقته ورقمه (تكراره خلال دقيقة يأخذ الرقم نفسه، وهو المحفوظ) */
const recent = new Map<string, { at: number; id: string }>();
let sentTimes: number[] = [];
let installed = false;

/** رقم خطأ قصير يقرؤه المستخدم: E + 10 خانات */
export function newErrorId(): string {
  const bytes = new Uint8Array(5);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  return `E${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function currentRoute(): string {
  if (typeof window === "undefined") return "";
  return window.location.pathname.slice(0, 200);
}

/** بوابة الموظف: مساراتها تحت /employee/ وصفحة البوابة القديمة */
function sourceFor(route: string): "web" | "portal" {
  return route.startsWith("/employee/") || route === "/hr/employee-dashboard" ? "portal" : "web";
}

type Described = { type: string; message: string; stack: string };

function describe(error: unknown): Described {
  if (error instanceof Error) {
    return { type: error.name || "Error", message: error.message || String(error), stack: error.stack ?? "" };
  }
  if (typeof error === "string") return { type: "string", message: error, stack: "" };
  if (error && typeof error === "object") {
    const value = error as { name?: unknown; message?: unknown; code?: unknown; details?: unknown; stack?: unknown };
    const message = [value.message, value.details].filter((part) => typeof part === "string" && part).join(" — ");
    let fallback = "";
    if (!message) {
      try {
        fallback = JSON.stringify(error).slice(0, 500);
      } catch {
        fallback = Object.prototype.toString.call(error);
      }
    }
    return {
      type: String(value.name ?? value.code ?? "object").slice(0, 100),
      message: message || fallback,
      stack: typeof value.stack === "string" ? value.stack : "",
    };
  }
  return { type: typeof error, message: String(error), stack: "" };
}

function send(payload: ErrorPayload) {
  if (IS_DEV) {
    console.warn("[errorReporter] (التطوير: لا يُرسل)", payload);
    return;
  }
  if (!transport) {
    if (queue.length < MAX_QUEUE) queue.push(payload);
    return;
  }
  try {
    transport(payload).catch(() => undefined);
  } catch {
    // لا شيء: الإبلاغ عن الخطأ لا يكسر الصفحة أبدًا
  }
}

/** يسجّله supabaseClient بعد إنشاء العميل */
export function registerErrorTransport(next: Transport) {
  transport = next;
  while (queue.length) send(queue.shift() as ErrorPayload);
}

/**
 * يبلّغ عن خطأ ويعيد رقمه فورًا (يُعرض للمستخدم). الإرسال في الخلفية.
 * event: اسم ثابت بأحرف صغيرة ونقاط، مثل ui.render_crash أو api.server_error.
 * الخطأ نفسه خلال دقيقة لا يُرسل ثانية، ويعيد رقم المرة الأولى (المحفوظ في السجل).
 */
export function reportError(
  event: string,
  error: unknown,
  options: { level?: ErrorLevel; context?: Record<string, string | number | boolean | null | undefined>; errorId?: string } = {},
): string {
  const errorId = options.errorId ?? newErrorId();
  try {
    const route = currentRoute();
    const described = describe(error);
    const key = `${event}|${described.type}|${described.message.slice(0, 200)}`;
    const now = Date.now();
    const last = recent.get(key);
    if (last && now - last.at < DEDUPE_MS) return last.id;
    sentTimes = sentTimes.filter((time) => now - time < WINDOW_MS);
    if (sentTimes.length >= MAX_PER_WINDOW) return errorId;
    if (recent.size > 200) recent.clear();
    recent.set(key, { at: now, id: errorId });
    sentTimes.push(now);

    const context: Record<string, string | number | boolean> = {};
    for (const [name, value] of Object.entries(options.context ?? {})) {
      if (value !== null && value !== undefined) context[name] = value;
    }
    if (typeof navigator !== "undefined") context.online = navigator.onLine;

    send({
      source: sourceFor(route),
      level: options.level ?? "error",
      event,
      request_id: errorId,
      route,
      app_version: APP_VERSION,
      error_type: described.type,
      message: described.message.slice(0, 2000),
      stack: described.stack.slice(0, 6000),
      context,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 300) : "",
    });
  } catch {
    // لا شيء
  }
  return errorId;
}

/** أخطاء لا فائدة منها: إضافات المتصفح، وأخطاء نصوص من نطاق آخر بلا تفاصيل، وتحذير ResizeObserver المعروف */
function isNoise(message: string, stack: string): boolean {
  return (
    /ResizeObserver loop/i.test(message) ||
    message === "Script error." ||
    /(chrome|moz|safari(-web)?)-extension:\/\//i.test(stack) ||
    /(chrome|moz|safari(-web)?)-extension:\/\//i.test(message)
  );
}

/** معالجات عامة: خطأ لم يُلتقط، ووعد مرفوض بلا معالجة. تُركَّب مرة واحدة. */
export function installGlobalErrorHandlers() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (event: ErrorEvent) => {
    const error = event.error ?? event.message;
    const described = describe(error);
    if (isNoise(described.message, described.stack)) return;
    reportError("ui.unhandled_error", error, {
      context: { line: event.lineno || undefined, column: event.colno || undefined },
    });
  });
  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    const described = describe(event.reason);
    if (isNoise(described.message, described.stack)) return;
    reportError("ui.unhandled_rejection", event.reason);
  });
}

export { APP_VERSION };
