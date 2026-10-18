import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabaseClient";
import { applyCompanyProfile, type CompanyRecord, type CompanyStatus, type LastRejection, type MyCompanyResult } from "@/lib/companyProfile";
import { SUBSCRIPTION_ERROR_EVENT, type SubscriptionInfo } from "@/lib/subscription";

/**
 * حالة المنشأة للمستخدم الحالي (نظام الشركات).
 * عند كل دخول تُستدعى ensure_membership(): تربط صاحب الشركة بحسابه أول مرة، وتعيد حالة المنشأة وبياناتها.
 * الصفحات المحمية لا تعمل إلا والحالة active، فبيانات المنشأة (COMPANY_PROFILE) جاهزة قبل عرضها.
 */
export type CompanyState = {
  loading: boolean;
  /** anonymous: لا دخول / none: حساب بلا منشأة / error: تعذر التحقق / pending... حالة المنشأة */
  status: CompanyStatus;
  isPlatformAdmin: boolean;
  memberRole: "owner" | "member" | null;
  company: CompanyRecord | null;
  lastRejection: LastRejection | null;
  /** S15: اشتراك المنشأة (التجربة، الباقة، القراءة فقط). null قبل التحميل أو إن لم تُطبَّق S15 بعد */
  subscription: SubscriptionInfo | null;
  /** حساب الدخول الذي حُمّلت له الحالة */
  userId: string | null;
  error: string;
};

type CompanyContextValue = CompanyState & {
  /** إعادة القراءة من قاعدة البيانات (بعد التسجيل، أو تعديل بيانات المنشأة) */
  refresh: () => Promise<CompanyState>;
};

const initialState: CompanyState = {
  loading: true,
  status: "anonymous",
  isPlatformAdmin: false,
  memberRole: null,
  company: null,
  lastRejection: null,
  subscription: null,
  userId: null,
  error: "",
};

const CompanyContext = createContext<CompanyContextValue | null>(null);

function toState(result: MyCompanyResult | null, userId: string | null): CompanyState {
  const status = (result?.status ?? "anonymous") as CompanyStatus;
  const company = status !== "anonymous" && status !== "none" && result?.company ? result.company : null;
  return {
    loading: false,
    status,
    isPlatformAdmin: Boolean(result?.is_platform_admin),
    memberRole: (result?.member_role as "owner" | "member" | undefined) ?? null,
    company,
    lastRejection: result?.last_rejection ?? null,
    subscription: null,
    userId,
    error: "",
  };
}

/** S15: اشتراك المنشأة الفعّالة. خطأ القراءة (أو S15 غير مطبّق) لا يوقف النظام: يبقى بلا تنبيه */
async function loadSubscription(): Promise<SubscriptionInfo | null> {
  const { data, error } = await supabase.rpc("my_subscription");
  if (error || !data || typeof data !== "object") return null;
  return data as SubscriptionInfo;
}

/** قراءة حالة المنشأة من قاعدة البيانات (تُستخدم أيضًا مباشرة في صفحات الدخول) */
export async function loadCompanyState(): Promise<CompanyState> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id ?? null;
  if (!sessionData.session) {
    applyCompanyProfile(null);
    return { ...initialState, loading: false };
  }
  const { data, error } = await supabase.rpc("ensure_membership");
  if (error) {
    // تعذر التحقق (اتصال أو خادم): لا نعامل الحساب كأنه بلا منشأة ولا نفرغ بيانات منشأة محمّلة
    return { ...initialState, loading: false, status: "error", userId, error: error.message || "COMPANY_LOAD_FAILED" };
  }
  const state = toState((data ?? null) as MyCompanyResult | null, userId);
  applyCompanyProfile(state.status === "active" ? state.company : null);
  if (state.status === "active") state.subscription = await loadSubscription();
  return state;
}

const sameState = (a: CompanyState, b: CompanyState) => JSON.stringify(a) === JSON.stringify(b);

export function CompanyProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CompanyState>(initialState);
  const requestRef = useRef(0);
  const userRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const request = ++requestRef.current;
    const next = await loadCompanyState();
    if (request === requestRef.current) {
      userRef.current = next.userId;
      // نفس البيانات: لا إعادة رسم (لا تُفقد النماذج المفتوحة)
      setState((prev) => (sameState(prev, next) ? prev : next));
    }
    return next;
  }, []);

  useEffect(() => {
    void refresh();
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        requestRef.current += 1;
        userRef.current = null;
        applyCompanyProfile(null);
        setState({ ...initialState, loading: false });
        return;
      }
      if (event === "SIGNED_IN" || event === "USER_UPDATED") {
        // Supabase يرسل SIGNED_IN عند كل عودة للتبويب: لنفس الحساب نحدّث بصمت دون إخفاء الصفحة
        const nextUser = session?.user?.id ?? null;
        if (nextUser !== userRef.current) setState((prev) => ({ ...prev, loading: true }));
        // خارج معالج الحدث نفسه (توصية Supabase لتجنب تعليق الجلسة)
        setTimeout(() => void refresh(), 0);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [refresh]);

  // S15: رفض الخادم عملية بسبب الاشتراك (انتهت التجربة أثناء العمل مثلًا): تُحدَّث الحالة ليظهر التنبيه
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onSubscriptionError = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void refresh();
      }, 400);
    };
    window.addEventListener(SUBSCRIPTION_ERROR_EVENT, onSubscriptionError);
    return () => {
      window.removeEventListener(SUBSCRIPTION_ERROR_EVENT, onSubscriptionError);
      if (timer) clearTimeout(timer);
    };
  }, [refresh]);

  const value = useMemo(() => ({ ...state, refresh }), [state, refresh]);
  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

export function useCompany(): CompanyContextValue {
  const value = useContext(CompanyContext);
  if (!value) throw new Error("useCompany must be used inside CompanyProvider");
  return value;
}

/** رسائل حالة المنشأة للمستخدم */
export function companyStatusMessage(state: Pick<CompanyState, "status" | "isPlatformAdmin" | "company">): { title: string; body: string } {
  if (state.isPlatformAdmin && (state.status === "none" || state.status === "anonymous")) {
    return {
      title: "هذا حساب إدارة المنصة",
      body: "حساب إدارة المنصة لا يدخل إلى نظام المنشآت. استخدم لوحة إدارة المنصة.",
    };
  }
  switch (state.status) {
    case "pending":
      return {
        title: "طلب التسجيل قيد المراجعة",
        body: "استلمنا طلب تسجيل منشأتك، وسيتم تفعيلها بعد مراجعة إدارة المنصة. يمكنك تحديث الصفحة لاحقًا.",
      };
    case "suspended":
      return {
        title: "حساب المنشأة موقوف",
        body: state.company?.status_reason
          ? `أوقفت إدارة المنصة حساب المنشأة: ${state.company.status_reason}`
          : "أوقفت إدارة المنصة حساب المنشأة مؤقتًا. تواصل مع إدارة المنصة.",
      };
    case "rejected":
      return {
        title: "لم يُقبل طلب التسجيل",
        body: state.company?.status_reason
          ? `سبب الرفض: ${state.company.status_reason}`
          : "لم يُقبل طلب تسجيل المنشأة. تواصل مع إدارة المنصة.",
      };
    case "disabled":
      return {
        title: "حسابك معطّل",
        body: "عطّلت إدارة المنصة حسابك في هذه المنشأة. تواصل مع مسؤول المنشأة أو إدارة المنصة.",
      };
    case "error":
      return {
        title: "تعذر التحقق من حساب المنشأة",
        body: "تعذر الاتصال بالخادم للتحقق من منشأتك. تحقق من الاتصال ثم أعد المحاولة.",
      };
    case "none":
      return {
        title: "لا توجد منشأة مرتبطة بحسابك",
        body: "سجّل منشأتك الآن، أو اطلب من مسؤول منشأتك إنشاء حساب دخول لك.",
      };
    default:
      return { title: "", body: "" };
  }
}
