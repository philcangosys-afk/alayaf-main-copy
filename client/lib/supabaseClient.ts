import { createClient } from "@supabase/supabase-js";
import { SUBSCRIPTION_ERROR_EVENT, subscriptionErrorCode } from "@/lib/subscription";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

/**
 * S15: إن رفض الخادم عملية بسبب الاشتراك (القراءة فقط أو حد الباقة) يُطلق حدث عام،
 * فتعرض الواجهة رسالة واضحة وتحدّث حالة الاشتراك، أيًّا كانت الصفحة التي نفّذت العملية.
 * لا يغيّر الاستجابة: تُقرأ نسخة منها فقط، وللاستجابات الفاشلة فقط.
 */
const subscriptionAwareFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  if (response.status >= 400 && typeof window !== "undefined") {
    response
      .clone()
      .text()
      .then((text) => {
        const code = subscriptionErrorCode(text);
        if (code) window.dispatchEvent(new CustomEvent(SUBSCRIPTION_ERROR_EVENT, { detail: code }));
      })
      .catch(() => undefined);
  }
  return response;
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, { global: { fetch: subscriptionAwareFetch } });
