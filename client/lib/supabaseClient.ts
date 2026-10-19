import { createClient } from "@supabase/supabase-js";
import { SUBSCRIPTION_ERROR_EVENT, subscriptionErrorCode } from "@/lib/subscription";
import { registerErrorTransport, reportError } from "@/lib/errorReporter";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

/** S16: طلب تسجيل الخطأ نفسه لا يُبلَّغ عنه (حتى لا يتكرر بلا نهاية) */
const isErrorLogRequest = (path: string) => path.endsWith("/rpc/log_client_error");

function requestInfo(input: RequestInfo | URL, init?: RequestInit): { path: string; method: string } {
  try {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET") ?? "GET").toUpperCase();
    // المسار فقط: معاملات الاستعلام قد تحمل قيم تصفية (بريد، جوال)
    return { path: new URL(url, window.location.origin).pathname.slice(0, 200), method };
  } catch {
    return { path: "", method: "GET" };
  }
}

/**
 * S15: إن رفض الخادم عملية بسبب الاشتراك (القراءة فقط أو حد الباقة) يُطلق حدث عام،
 * فتعرض الواجهة رسالة واضحة وتحدّث حالة الاشتراك، أيًّا كانت الصفحة التي نفّذت العملية.
 * S16: خطأ الخادم (5xx) وانقطاع الشبكة مع اتصال الجهاز يُسجَّلان في سجل أخطاء النظام.
 * لا يغيّر الاستجابة: تُقرأ نسخة منها فقط، وللاستجابات الفاشلة فقط.
 */
const subscriptionAwareFetch: typeof fetch = async (input, init) => {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (error) {
    if (typeof window !== "undefined" && navigator.onLine && !(error instanceof DOMException && error.name === "AbortError")) {
      const { path, method } = requestInfo(input, init);
      if (!isErrorLogRequest(path)) {
        reportError("api.network_error", error, { level: "warn", context: { path, method } });
      }
    }
    throw error;
  }
  if (response.status >= 400 && typeof window !== "undefined") {
    const status = response.status;
    const serverRequestId = response.headers.get("x-request-id") ?? undefined;
    response
      .clone()
      .text()
      .then((text) => {
        const code = subscriptionErrorCode(text);
        if (code) window.dispatchEvent(new CustomEvent(SUBSCRIPTION_ERROR_EVENT, { detail: code }));
        if (status >= 500) {
          const { path, method } = requestInfo(input, init);
          if (!isErrorLogRequest(path)) {
            reportError("api.server_error", `HTTP ${status}: ${text.slice(0, 500)}`, {
              context: { status, path, method, server_request_id: serverRequestId },
            });
          }
        }
      })
      .catch(() => undefined);
  }
  return response;
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, { global: { fetch: subscriptionAwareFetch } });

registerErrorTransport(async (payload) => {
  const { error, status } = await supabase.rpc("log_client_error", { p: payload });
  // S16: الجلسة منتهية (401): يُرسل بلا جلسة، كما يرسل العميل قبل الدخول (fetch الأصلي، لا المغلّف)
  if (error && status === 401) {
    await fetch(`${supabaseUrl}/rest/v1/rpc/log_client_error`, {
      method: "POST",
      headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p: payload }),
      keepalive: true,
    });
  }
});
