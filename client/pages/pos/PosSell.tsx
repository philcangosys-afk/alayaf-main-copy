import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight, Barcode, Boxes, ChevronDown, CircleDollarSign, FileText, Keyboard, LayoutGrid, List, Loader2, LockKeyhole, Minus,
  Plus, Printer, Receipt, RotateCcw, Search, Send, ShoppingBag, StickyNote, Trash2, User, Wallet, X,
} from "lucide-react";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useCompany } from "@/lib/companyContext";
import { COMPANY_PROFILE, isSaudiCompany } from "@/lib/companyProfile";
import { BILLING_COUNTRY_MESSAGE } from "@/lib/countries";
import { isReadOnlySubscription } from "@/lib/subscription";
import {
  METHOD_LABELS, beginRequest, clearOrders, computeCart, confirmZatcaForSession, createPosSale, discountToMatch, emptyOrder, endRequest,
  fromCents, lineDiscountLimitCents, loadOrders, percentOfCents, loadPosContext, loadPosProducts, loadPosReceipt, loadSessionReport, outcomeUnknown,
  isoLtr, parseMoney, pendingRequest, posErrorText, saveOrders, sendToZatca, trackMySession, zatcaConfirmedForSession,
  type CartLine, type CartOrder, type PosContext, type PosProduct, type ReturnResult, type SaleResult, type SessionReport,
} from "@/lib/pos";
import { printReturnReceipt, printSaleReceipt, printSessionReport } from "@/lib/posPrint";
import { Code, ErrorNote, PosButton, PosModal, num, posInput, useMoney, usePosDate } from "@/components/pos/PosUi";
import PosPaymentDialog, { type PaymentSubmit } from "@/components/pos/PosPaymentDialog";
import PosCustomerDialog from "@/components/pos/PosCustomerDialog";
import PosReturnDialog from "@/components/pos/PosReturnDialog";
import PosCashDialog, { type CashKind } from "@/components/pos/PosCashDialog";
import PosCloseDialog from "@/components/pos/PosCloseDialog";

type Dialog =
  | { kind: "none" }
  | { kind: "pay" }
  | { kind: "customer" }
  | { kind: "return"; invoice?: string }
  | { kind: "cash"; op: CashKind }
  | { kind: "close" }
  | { kind: "invoices" }
  | { kind: "shortcuts" }
  | { kind: "note" }
  | { kind: "discount" };

type Done = { sale: SaleResult; zatca: "none" | "sending" | "sent" | "failed"; zatcaMessage: string };

const PREFS_KEY = "pos-prefs";
type Prefs = { view: "grid" | "list"; autoPrint: boolean };
const readPrefs = (): Prefs => {
  try {
    const value = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<Prefs>;
    return { view: value.view === "list" ? "list" : "grid", autoPrint: value.autoPrint !== false };
  } catch {
    return { view: "grid", autoPrint: true };
  }
};

/** محاولة بيع الطلب محفوظة بهذا المفتاح حتى تُعرف نتيجتها */
const saleScopeFor = (sessionId: string, order: CartOrder) => `sale-${sessionId}-${order.id}-${order.createdAt}`;

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);

/**
 * شاشة البيع (ملء الشاشة): الأصناف والبحث والباركود، والطلبات المعلّقة، والعميل، والبنود بالكمية والسعر والخصم،
 * والدفع، والإيصال الحراري، والمرتجع، وعمليات النقد، وتقرير X، وإغلاق الجلسة. البيع فاتورة مبيعات عادية.
 */
export default function PosSell() {
  const { t, direction, formatNumber, formatDate, locale } = useI18n();
  const money = useMoney();
  const fmtDate = usePosDate();
  const navigate = useNavigate();
  const company = useCompany();
  const format = useMemo(() => ({ t, direction, formatNumber, formatDate }), [t, direction, formatNumber, formatDate]);
  const outsideSaudi = Boolean(company.company) && !isSaudiCompany(company.company?.country);
  const readOnlySubscription = isReadOnlySubscription(company.subscription);

  const [ctx, setCtx] = useState<PosContext | null>(null);
  const [loadError, setLoadError] = useState("");
  const [products, setProducts] = useState<PosProduct[]>([]);
  const [orders, setOrders] = useState<CartOrder[]>([]);
  const [activeId, setActiveId] = useState(1);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "product" | "service">("all");
  const [prefs, setPrefs] = useState<Prefs>(readPrefs);
  const [dialog, setDialog] = useState<Dialog>({ kind: "none" });
  const [payError, setPayError] = useState("");
  const [paying, setPaying] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [zatcaAsk, setZatcaAsk] = useState<{ resolve: (ok: boolean) => void } | null>(null);
  const [zatcaText, setZatcaText] = useState("");
  const [sessionReport, setSessionReport] = useState<SessionReport | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const scanBuffer = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const payingRef = useRef(false);
  const lockedRef = useRef(false);
  const [requestVersion, setRequestVersion] = useState(0);

  const session = ctx?.session ?? null;
  const perms = ctx?.permissions;
  const phase2 = COMPANY_PROFILE.zatcaPhase === "phase2";

  const ordersRef = useRef(orders);
  ordersRef.current = orders;

  /* ═══ التحميل ═══ */
  // التحميل الأول يعرض الخطأ مكان الشاشة؛ التحديث بعد عملية يُنبّه فقط ولا يمس الطلبات، والجلسة المغلقة من مكان آخر تعود للأجهزة
  const reloadContext = useCallback(async (initial = false) => {
    const result = await loadPosContext();
    if (result.error || !result.data) {
      if (initial) setLoadError(posErrorText(result.error ?? "", t));
      else toast({ title: t("تعذر تحديث بيانات الجلسة"), description: posErrorText(result.error ?? "", t), variant: "destructive" });
      return null;
    }
    if (!initial && !result.data.session) {
      toast({ title: t("الجلسة لم تعد مفتوحة"), variant: "destructive" });
      navigate("/pos", { replace: true });
      return null;
    }
    setCtx(result.data);
    return result.data;
  }, [t, navigate]);

  // الأصناف بأسعارها الحالية؛ وبنود الطلبات المعلّقة تأخذ سعر البطاقة الجديد ما لم يُغيَّر سعرها يدويًا
  const reloadProducts = useCallback(async (sessionId: string) => {
    const result = await loadPosProducts(sessionId);
    if (result.error) return;
    const list = result.data ?? [];
    setProducts(list);
    const prices = new Map(list.map((p) => [p.id, p.price]));
    // الطلب الذي له محاولة بيع لم تُعرف نتيجتها لا يُمس (تُعاد ببياناتها نفسها)
    const sync = (current: CartOrder[]) => {
      let changed = false;
      const next = current.map((o) => (pendingRequest(saleScopeFor(sessionId, o)) ? o : {
        ...o,
        lines: o.lines.map((line) => {
          const price = prices.get(line.productId);
          if (price === undefined || price === line.listPrice) return line;
          changed = true;
          const untouched = parseMoney(line.unitPrice) === Math.round(line.listPrice * 100);
          return { ...line, listPrice: price, unitPrice: untouched ? (price > 0 ? price.toFixed(2) : "") : line.unitPrice };
        }),
      }));
      return { changed, next };
    };
    if (sync(ordersRef.current).changed) {
      setOrders((current) => sync(current).next);
      toast({ title: t("تغيّر سعر صنف في الطلبات المعلّقة"), description: t("حُدّثت البنود بسعر بطاقة الصنف الحالي") });
    }
  }, [t]);

  useEffect(() => {
    (async () => {
      const data = await reloadContext(true);
      if (!data) return;
      trackMySession(data.session?.id ?? null);
      if (!data.session) { navigate("/pos", { replace: true }); return; }
      const saved = loadOrders(data.session.id);
      setOrders(saved);
      setActiveId(saved[0]?.id ?? 1);
      await reloadProducts(data.session.id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (session && orders.length) saveOrders(session.id, orders);
  }, [orders, session]);

  useEffect(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* لا تخزين */ }
  }, [prefs]);

  const order = orders.find((o) => o.id === activeId) ?? orders[0] ?? emptyOrder(1);
  // محاولة بيع لهذا الطلب لم تُعرف نتيجتها (انقطع الاتصال): الطلب مقفل حتى تُعاد أو تُتجاهل
  const pendingSale = useMemo(
    () => (session ? pendingRequest(saleScopeFor(session.id, order)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session?.id, order.id, order.createdAt, requestVersion],
  );
  lockedRef.current = Boolean(pendingSale);
  const invoiceDiscountCents = parseMoney(order.invoiceDiscount || "0") ?? 0;
  const totals = useMemo(() => computeCart(order.lines, invoiceDiscountCents), [order.lines, invoiceDiscountCents]);

  // حد الخصم للصلاحية المحدودة، وتغيير السعر (نص مترجم)
  const discountLimitText = (percent: number) => `${t("الخصم أكبر من الحد المسموح لك")} (${formatNumber(percent)}%)`;
  const limitError = useMemo(() => {
    if (!perms || !ctx) return "";
    if (perms.discount === "none" && totals.discountCents > 0) return t("لا تملك صلاحية الخصم");
    if (perms.discount === "limited") {
      const over = totals.lines.some((line) => line.discountCents > lineDiscountLimitCents(line.grossCents, ctx.settings.max_discount_percent));
      if (over) return discountLimitText(ctx.settings.max_discount_percent);
    }
    if (!perms.price_change && order.lines.some((line) => (parseMoney(line.unitPrice) ?? -1) !== Math.round(line.listPrice * 100))) {
      return t("لا تملك صلاحية تغيير سعر الصنف");
    }
    return "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perms, ctx, totals, order.lines, formatNumber, t]);
  const blockError = totals.error ? t(totals.error) : limitError;
  // البيع ممنوع خارج السعودية وفي وضع القراءة فقط
  const saleBlocked = outsideSaudi ? t(BILLING_COUNTRY_MESSAGE) : readOnlySubscription ? t("المنشأة في وضع القراءة فقط حتى تفعيل الاشتراك؛ لا يمكن البيع") : "";

  /* ═══ تعديل الطلب ═══ */
  // لا تعديل للطلب أثناء إتمام البيع (يُحذف الطلب بعده بما فيه)
  const updateOrder = useCallback((change: (o: CartOrder) => CartOrder) => {
    if (payingRef.current || lockedRef.current) return;
    setOrders((list) => list.map((o) => (o.id === activeId ? change(o) : o)));
  }, [activeId]);

  const updateLine = (key: string, changes: Partial<CartLine>) =>
    updateOrder((o) => ({ ...o, lines: o.lines.map((line) => (line.key === key ? { ...line, ...changes } : line)) }));

  // البند نفسه (الصنف بسعره دون خصم) تزيد كميته، وإلا يُضاف بند جديد. المفتاح يُحسب خارج دالة التحديث لتبقى نقية
  const addProduct = useCallback((product: PosProduct, quantity = 1) => {
    if (payingRef.current || lockedRef.current) return;
    const priceCents = Math.round(product.price * 100);
    const matches = (line: CartLine) => line.productId === product.id && !line.discountValue.trim() && parseMoney(line.unitPrice) === priceCents;
    const newKey = `${product.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setSelectedKey(order.lines.find(matches)?.key ?? newKey);
    updateOrder((o) => {
      const same = o.lines.find(matches);
      if (same) {
        const next = Math.round((Number(same.quantity || 0) + quantity) * 1000) / 1000;
        return { ...o, lines: o.lines.map((line) => (line.key === same.key ? { ...line, quantity: String(next) } : line)) };
      }
      return {
        ...o,
        lines: [...o.lines, {
          key: newKey, productId: product.id, name: product.name_ar, sku: product.sku, unit: product.unit, itemType: product.item_type,
          listPrice: product.price, unitPrice: product.price > 0 ? product.price.toFixed(2) : "", quantity: String(quantity),
          discountMode: "amount", discountValue: "",
        }],
      };
    });
  }, [order.lines, updateOrder]);

  const findByCode = useCallback((code: string) => {
    const value = code.trim().toLowerCase();
    if (!value) return null;
    return products.find((p) => p.barcode && p.barcode.toLowerCase() === value)
      ?? products.find((p) => p.sku.toLowerCase() === value) ?? null;
  }, [products]);

  const scanned = useCallback((code: string) => {
    const product = findByCode(code);
    if (product && !product.vat_ok) {
      toast({ title: t("نسبة ضريبة الصنف غير 15%؛ يُباع من فواتير المبيعات"), description: product.name_ar, variant: "destructive" });
      return false;
    }
    if (product) {
      addProduct(product);
      return true;
    }
    toast({ title: t("الصنف غير موجود"), description: code, variant: "destructive" });
    return false;
  }, [findByCode, addProduct, t]);

  const newOrder = () => {
    if (payingRef.current) return;
    const id = Math.max(0, ...orders.map((o) => o.id)) + 1;
    setOrders((list) => [...list, emptyOrder(id)]);
    setActiveId(id);
    setSelectedKey(null);
  };
  const removeOrder = (id: number) => {
    const removed = orders.find((o) => o.id === id);
    // طلب له محاولة بيع لم تُعرف نتيجتها لا يُلغى بصمت: تُعاد أو تُتجاهل صراحة أولًا
    if (removed && session && pendingRequest(saleScopeFor(session.id, removed))) {
      toast({ title: t("للطلب محاولة بيع لم تُعرف نتيجتها؛ أعدها أو تجاهلها أولًا"), variant: "destructive" });
      return;
    }
    setOrders((list) => {
      const rest = list.filter((o) => o.id !== id);
      const next = rest.length ? rest : [emptyOrder(Math.max(0, ...list.map((o) => o.id)) + 1)];
      if (id === activeId) setActiveId(next[next.length - 1].id);
      return next;
    });
    setSelectedKey(null);
  };

  /* ═══ الهيئة: تأكيد الإرسال الفعلي مرة في الجلسة ═══ */
  const ensureZatca = useCallback(() => {
    if (!session) return Promise.resolve(false);
    if (zatcaConfirmedForSession(session.id)) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => { setZatcaText(""); setZatcaAsk({ resolve }); });
  }, [session]);

  const printReceiptFor = useCallback(async (invoiceId: string, copy = false) => {
    const result = await loadPosReceipt(invoiceId);
    if (result.error || !result.data) { toast({ title: t("تعذر تجهيز الإيصال"), description: posErrorText(result.error ?? "", t), variant: "destructive" }); return; }
    await printSaleReceipt(result.data, format, { copy });
  }, [format, t]);

  /* ═══ الدفع ═══ */
  // fromDialog: من نافذة الدفع (الخطأ يظهر فيها)، وإلا من «نقد مضبوط» (الخطأ تنبيه)
  const pay = async (value: PaymentSubmit, fromDialog = true) => {
    if (!session || payingRef.current) return;
    const fail = (message: string) => {
      if (fromDialog) setPayError(message);
      else toast({ title: t("لم يتم البيع"), description: message, variant: "destructive" });
    };
    // المحاولة المعلّقة تُعاد ببياناتها المحفوظة (الطلب مقفل) دون فحص جديد
    if (!pendingSale) {
      if (saleBlocked) { fail(saleBlocked); return; }
      if (blockError) { fail(blockError); return; }
    }
    const payload = {
      session_id: session.id,
      customer_id: order.customer?.id ?? null,
      invoice_type: order.invoiceType,
      note: order.note.trim() || null,
      invoice_discount: fromCents(totals.invoiceDiscountCents),
      lines: order.lines.map((line, index) => ({
        product_id: line.productId,
        quantity: Number(line.quantity),
        unit_price: Number(line.unitPrice),
        discount: fromCents(totals.lines[index]?.lineDiscountCents ?? 0),
      })),
      payments: value.payments,
      on_account: value.onAccount,
    };
    // المحاولة محفوظة قبل الإرسال حتى تُعرف نتيجتها؛ والمحاولة المعلّقة تُعاد هي نفسها (معرّفها وبياناتها) فلا يتكرر البيع
    const scope = saleScopeFor(session.id, order);
    const attempt = beginRequest(scope, payload);
    setPaying(true);
    payingRef.current = true;
    setPayError("");
    const result = await createPosSale({ ...attempt.payload, client_request_id: attempt.id });
    payingRef.current = false;
    setPaying(false);
    if (result.error || !result.data) {
      if (outcomeUnknown(result, attempt.resumed)) {
        setRequestVersion((v) => v + 1);
        setDialog({ kind: "none" });
        toast({ title: t("انقطع الاتصال ولم يُعرف إن تمّ البيع"), description: t("«إعادة المحاولة» ترسل الطلب نفسه: إن كان سُجّل لا يتكرر."), variant: "destructive" });
        return;
      }
      endRequest(scope);
      setRequestVersion((v) => v + 1);
      fail(posErrorText(result.error ?? "", t));
      return;
    }
    endRequest(scope);
    setRequestVersion((v) => v + 1);
    const sale = result.data;
    if (sale.existing) toast({ title: t("البيع مسجّل من قبل"), description: t("انقطع الرد في المحاولة السابقة، فلم يتكرر البيع") });
    setDialog({ kind: "none" });
    removeOrder(order.id);
    const needsZatca = sale.zatca_phase === "phase2" && !["reported", "cleared"].includes(sale.zatca_status);
    setDone({ sale, zatca: needsZatca ? "sending" : "none", zatcaMessage: "" });
    void reloadContext();
    void reloadProducts(session.id);
    if (needsZatca) {
      const allowed = await ensureZatca();
      if (!allowed) {
        setDone((d) => (d ? { ...d, zatca: "failed", zatcaMessage: t("لم يُؤكَّد الإرسال؛ أرسلها من فواتير الجلسة أو من فواتير المبيعات") } : d));
      } else {
        const sent = await sendToZatca({ invoiceId: sale.invoice_id });
        setDone((d) => (d ? { ...d, zatca: sent.ok ? "sent" : "failed", zatcaMessage: sent.message } : d));
      }
    }
    if (prefs.autoPrint) await printReceiptFor(sale.invoice_id);
  };

  // إعادة محاولة البيع المعلّقة ببياناتها نفسها
  const retryPending = () => {
    if (payingRef.current || !pendingSale) return;
    void pay({ payments: [], onAccount: false }, false);
  };
  const discardPending = () => {
    if (!session || payingRef.current) return;
    endRequest(saleScopeFor(session.id, order));
    setRequestVersion((v) => v + 1);
  };
  const quickCash = () => {
    if (payingRef.current) return;
    if (pendingSale) { retryPending(); return; }
    const reason = saleBlocked || blockError || (totals.totalCents <= 0 ? t("أضف صنفًا واحدًا على الأقل") : "");
    if (reason) { toast({ title: reason, variant: "destructive" }); return; }
    void pay({ payments: [{ method: "cash", amount: fromCents(totals.totalCents) }], onAccount: false }, false);
  };
  const openPay = () => {
    if (pendingSale) { retryPending(); return; }
    const reason = saleBlocked || blockError;
    if (reason) { toast({ title: reason, variant: "destructive" }); return; }
    setPayError("");
    setDialog({ kind: "pay" });
  };

  const applyDiscountToMatch = (targetCents: number): string | null => {
    if (!perms || perms.discount === "none") return t("لا تملك صلاحية الخصم");
    const current = computeCart(order.lines, 0);
    const discount = discountToMatch(order.lines, targetCents);
    if (discount === null) return t("لا يمكن الوصول للمبلغ بخصم؛ تحقق من المدفوع");
    const extra = discount;
    if (perms.discount === "limited" && ctx) {
      const after = computeCart(order.lines, extra);
      const over = after.lines.some((line) => line.discountCents > lineDiscountLimitCents(line.grossCents, ctx.settings.max_discount_percent));
      if (over) return discountLimitText(ctx.settings.max_discount_percent);
    }
    if (extra > current.subtotalCents) return t("خصم الفاتورة أكبر من قيمتها");
    updateOrder((o) => ({ ...o, invoiceDiscount: fromCents(extra).toFixed(2) }));
    return null;
  };

  /* ═══ الاختصارات والباركود ═══ */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!ctx?.session || zatcaAsk) return;
      // أثناء إتمام البيع لا اختصارات ولا مسح (الطلب يُحذف بعده)
      if (payingRef.current) { if (/^F\d+$/.test(event.key)) event.preventDefault(); return; }
      if (dialog.kind !== "none" || done) {
        if (done && event.key === "Enter" && dialog.kind === "none") { event.preventDefault(); setDone(null); searchRef.current?.focus(); }
        return;
      }
      const typing = isTyping(event.target);
      const fn: Record<string, () => void> = {
        F2: () => searchRef.current?.focus(),
        F4: () => setDialog({ kind: "customer" }),
        F6: newOrder,
        F7: () => perms?.returns && setDialog({ kind: "return" }),
        F8: openPay,
        F9: quickCash,
        F10: () => setDialog({ kind: "invoices" }),
      };
      if (fn[event.key]) { event.preventDefault(); fn[event.key](); return; }
      if (typing) return;
      // ماسح الباركود: حروف متتابعة بسرعة تنتهي بـ Enter
      const now = Date.now();
      if (event.key === "Enter") {
        const code = scanBuffer.current.text;
        scanBuffer.current = { text: "", at: 0 };
        if (code.length >= 3) { event.preventDefault(); scanned(code); }
        return;
      }
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        // حرف ضمن مسح سريع (الماسح يكتب أسرع من 60 مللي ثانية بين الحروف) لا يغيّر الكمية
        const inScan = now - scanBuffer.current.at < 60 && scanBuffer.current.text.length > 0;
        scanBuffer.current = { text: (inScan ? scanBuffer.current.text : "") + event.key, at: now };
        if (!inScan && (event.key === "+" || event.key === "-")) {
          const line = order.lines.find((l) => l.key === selectedKey);
          if (line) {
            event.preventDefault();
            const next = Math.max(Math.round((Number(line.quantity || 0) + (event.key === "+" ? 1 : -1)) * 1000) / 1000, 0);
            if (next > 0) updateLine(line.key, { quantity: String(next) });
          }
        }
        return;
      }
      if (event.key === "Delete" && selectedKey) {
        event.preventDefault();
        updateOrder((o) => ({ ...o, lines: o.lines.filter((l) => l.key !== selectedKey) }));
        setSelectedKey(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* ═══ العرض ═══ */
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products.filter((p) => (typeFilter === "all" || p.item_type === typeFilter)
      && (!needle || [p.name_ar, p.name_en, p.sku, p.barcode].some((v) => (v ?? "").toLowerCase().includes(needle))));
  }, [products, query, typeFilter]);

  if (loadError) {
    return (
      <div dir={direction} className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <div className="max-w-md space-y-4 rounded-2xl bg-white p-6 text-center shadow">
          <ErrorNote message={loadError} />
          <PosButton variant="outline" onClick={() => navigate("/pos")}>{t("رجوع لنقاط البيع")}</PosButton>
        </div>
      </div>
    );
  }
  if (!ctx || !session || !perms) {
    return <div dir={direction} className="flex min-h-screen items-center justify-center bg-slate-100 text-slate-500">{t("جاري التحميل...")}</div>;
  }

  const customerName = order.customer?.name ?? ctx.settings.default_customer_name ?? t("عميل نقدي");
  const registered = order.customer?.tax_registration_mode === "registered_sa";

  return (
    <div dir={direction} lang={locale} className="flex h-screen flex-col overflow-hidden bg-[#eef1f0] text-slate-900">
      {/* الشريط العلوي */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-800 bg-slate-900 px-3 text-white">
        <Link to="/pos" className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-white/80 hover:bg-white/10" title={t("نقاط البيع")}>
          <ArrowRight className={cn("h-4 w-4", direction === "ltr" && "rotate-180")} />{t("نقاط البيع")}
        </Link>
        <div className="h-6 w-px bg-white/15" />
        <div className="min-w-0 text-sm">
          <span className="font-bold">{session.device_name}</span>
          <span className="mx-2 text-white/40">|</span>
          <Code className="text-white/80">{session.session_number}</Code>
          <span className="mx-2 text-white/40">|</span>
          <span className="text-white/80">{session.user_name}</span>
        </div>
        <div className="ms-auto flex items-center gap-2">
          <div className="hidden rounded-lg bg-white/10 px-3 py-1 text-xs md:block">
            <span className="text-white/60">{t("النقد المتوقع")}: </span><b className={num}>{money(session.expected_cash ?? 0)}</b>
          </div>
          {perms.returns && (
            <button type="button" onClick={() => setDialog({ kind: "return" })} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm hover:bg-white/10">
              <RotateCcw className="h-4 w-4" />{t("مرتجع")}
            </button>
          )}
          <button type="button" onClick={() => setDialog({ kind: "invoices" })} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm hover:bg-white/10">
            <FileText className="h-4 w-4" />{t("فواتير الجلسة")}
          </button>
          <div className="relative">
            <button type="button" onClick={() => setMenuOpen((v) => !v)} className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20" aria-expanded={menuOpen}>
              <Wallet className="h-4 w-4" />{t("الجلسة")}<ChevronDown className="h-3.5 w-3.5" />
            </button>
            {menuOpen && (
              <div className="absolute end-0 top-10 z-40 w-56 overflow-hidden rounded-xl border bg-white py-1 text-sm text-slate-800 shadow-xl" onMouseLeave={() => setMenuOpen(false)}>
                {perms.cash && ([
                  ["receipt", "قبض من عميل"], ["expense", "مصروف"], ["cash_in", "إيداع من الخزينة"], ["cash_out", "سحب إلى الخزينة"],
                ] as Array<[CashKind, string]>).map(([op, label]) => (
                  <button key={op} type="button" onClick={() => { setMenuOpen(false); setDialog({ kind: "cash", op }); }} className="block w-full px-4 py-2 text-start hover:bg-slate-50">{t(label)}</button>
                ))}
                {perms.cash && <div className="my-1 h-px bg-slate-100" />}
                <button type="button" onClick={async () => {
                  setMenuOpen(false);
                  const report = await loadSessionReport(session.id);
                  if (report.data) printSessionReport(report.data, format);
                  else toast({ title: t("تعذر تجهيز التقرير"), description: posErrorText(report.error ?? "", t), variant: "destructive" });
                }} className="block w-full px-4 py-2 text-start hover:bg-slate-50">{t("طباعة تقرير X")}</button>
                <Link to={`/pos/sessions/${session.id}`} className="block w-full px-4 py-2 text-start hover:bg-slate-50">{t("تقرير الجلسة")}</Link>
                <button type="button" onClick={() => { setMenuOpen(false); setDialog({ kind: "shortcuts" }); }} className="block w-full px-4 py-2 text-start hover:bg-slate-50">{t("اختصارات لوحة المفاتيح")}</button>
                <label className="flex w-full cursor-pointer items-center justify-between px-4 py-2 hover:bg-slate-50">
                  {t("طباعة الإيصال تلقائيًا")}
                  <input type="checkbox" checked={prefs.autoPrint} onChange={(e) => setPrefs((p) => ({ ...p, autoPrint: e.target.checked }))} />
                </label>
                <div className="my-1 h-px bg-slate-100" />
                <button type="button" onClick={() => { setMenuOpen(false); setDialog({ kind: "close" }); }} className="flex w-full items-center gap-2 px-4 py-2 text-start font-semibold text-red-700 hover:bg-red-50">
                  <LockKeyhole className="h-4 w-4" />{t("إغلاق الجلسة")}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {(outsideSaudi || readOnlySubscription) && (
        <div className="bg-amber-100 px-4 py-2 text-sm font-medium text-amber-900">
          {t(outsideSaudi ? BILLING_COUNTRY_MESSAGE : "المنشأة في وضع القراءة فقط حتى تفعيل الاشتراك؛ لا يمكن البيع")}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 lg:grid-cols-[minmax(380px,460px)_1fr]">
        {/* الطلب */}
        <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="flex items-center gap-1 overflow-x-auto border-b px-2 pt-2">
            {orders.map((o) => (
              <div key={o.id} className={cn("group flex shrink-0 items-center rounded-t-lg border border-b-0 px-3 py-1.5 text-sm",
                o.id === order.id ? "border-slate-300 bg-white font-bold text-slate-900" : "border-transparent bg-slate-100 text-slate-500 hover:text-slate-800")}>
                <button type="button" disabled={paying} onClick={() => { setActiveId(o.id); setSelectedKey(null); }} className={num}>
                  #{o.id}{o.lines.length ? <span className="ms-1 rounded-full bg-[#e6f2f0] px-1.5 text-[10px] text-[#0b5751]">{o.lines.length}</span> : null}
                </button>
                {orders.length > 1 && (
                  <button type="button" disabled={paying} onClick={() => removeOrder(o.id)} className="ms-1 rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={t("إلغاء الطلب")}>
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}
            <button type="button" onClick={newOrder} className="mb-1 ms-1 flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-[#0f6b63] hover:bg-[#e6f2f0]" title="F6">
              <Plus className="h-3.5 w-3.5" />{t("طلب جديد")}
            </button>
          </div>

          <div className="flex items-center gap-2 border-b px-3 py-2">
            <button type="button" onClick={() => setDialog({ kind: "customer" })} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border px-3 py-2 text-start hover:bg-slate-50" title="F4">
              <User className="h-4 w-4 shrink-0 text-slate-500" />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{customerName}</span>
              {order.customer && (
                <span className={cn("text-xs", num, order.customer.balance > 0 ? "text-amber-700" : "text-slate-500")}>{t("الرصيد")} {money(order.customer.balance)}</span>
              )}
            </button>
            {order.customer && (
              <button type="button" onClick={() => updateOrder((o) => ({ ...o, customer: null, invoiceType: "simplified" }))} className="rounded p-2 text-slate-400 hover:bg-slate-100" aria-label={t("عميل نقدي")}>
                <X className="h-4 w-4" />
              </button>
            )}
            <div className="flex overflow-hidden rounded-lg border text-xs">
              {(["simplified", "standard"] as const).map((type) => (
                <button key={type} type="button" disabled={type === "standard" && !registered}
                  onClick={() => updateOrder((o) => ({ ...o, invoiceType: type }))}
                  className={cn("px-2.5 py-2 font-semibold disabled:opacity-40", order.invoiceType === type ? "bg-slate-900 text-white" : "bg-white text-slate-600")}
                  title={type === "standard" && !registered ? t("الفاتورة الضريبية لعميل مسجل برقمه الضريبي") : undefined}>
                  {t(type === "simplified" ? "مبسطة" : "ضريبية")}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {order.lines.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-slate-400">
                <ShoppingBag className="h-10 w-10" />
                <p className="text-sm">{t("اختر صنفًا أو امسح الباركود")}</p>
              </div>
            ) : order.lines.map((line, index) => {
              const result = totals.lines[index];
              const selected = line.key === selectedKey;
              return (
                <div key={line.key} onClick={() => setSelectedKey(line.key)}
                  className={cn("border-b px-3 py-2.5", selected ? "bg-[#f1f8f7]" : "bg-white", result?.error && "bg-red-50")}>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold">{line.name}</div>
                      <div className="text-[11px] text-slate-500"><Code>{line.sku}</Code>{line.unit ? ` — ${line.unit}` : ""}</div>
                    </div>
                    <div className={cn("text-end text-sm font-bold", num)}>{money(fromCents(result?.netCents ?? 0))}</div>
                    <button type="button" onClick={(e) => { e.stopPropagation(); updateOrder((o) => ({ ...o, lines: o.lines.filter((l) => l.key !== line.key) })); }}
                      className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={t("حذف")}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <div className="flex items-center rounded-lg border">
                      <button type="button" className="p-1.5 hover:bg-slate-100" onClick={(e) => {
                        e.stopPropagation();
                        const next = Math.round((Number(line.quantity || 0) - 1) * 1000) / 1000;
                        if (next > 0) updateLine(line.key, { quantity: String(next) });
                      }} aria-label={t("إنقاص الكمية")}><Minus className="h-3.5 w-3.5" /></button>
                      <input value={line.quantity} onChange={(e) => updateLine(line.key, { quantity: e.target.value })} inputMode="decimal"
                        className={cn("h-7 w-14 border-x text-center text-sm font-bold focus:outline-none", num)} dir="ltr" aria-label={t("الكمية")} />
                      <button type="button" className="p-1.5 hover:bg-slate-100" onClick={(e) => {
                        e.stopPropagation();
                        updateLine(line.key, { quantity: String(Math.round((Number(line.quantity || 0) + 1) * 1000) / 1000) });
                      }} aria-label={t("زيادة الكمية")}><Plus className="h-3.5 w-3.5" /></button>
                    </div>
                    <span className="text-xs text-slate-400">×</span>
                    <input value={line.unitPrice} onChange={(e) => updateLine(line.key, { unitPrice: e.target.value })} readOnly={!perms.price_change}
                      inputMode="decimal" className={cn("h-7 w-20 rounded-lg border px-2 text-center text-sm", num, !perms.price_change && "bg-slate-50 text-slate-600")}
                      dir="ltr" aria-label={t("السعر")} title={perms.price_change ? t("السعر قبل الضريبة") : t("لا تملك صلاحية تغيير السعر")} />
                    {perms.discount !== "none" && (
                      <div className="flex items-center rounded-lg border">
                        <input value={line.discountValue} onChange={(e) => updateLine(line.key, { discountValue: e.target.value })} inputMode="decimal"
                          className={cn("h-7 w-14 rounded-s-lg px-2 text-center text-sm focus:outline-none", num)} dir="ltr" placeholder={t("خصم")} aria-label={t("خصم")} />
                        <button type="button" onClick={(e) => { e.stopPropagation(); updateLine(line.key, { discountMode: line.discountMode === "amount" ? "percent" : "amount" }); }}
                          className="border-s px-2 text-xs font-bold text-slate-600 hover:bg-slate-100">{line.discountMode === "percent" ? "%" : t("ر.س")}</button>
                      </div>
                    )}
                    {(result?.shareCents ?? 0) > 0 && <span className={cn("text-[11px] text-slate-500", num)}>{t("من خصم الفاتورة")} {money(fromCents(result.shareCents))}</span>}
                  </div>
                  {result?.error && <p className="mt-1 text-xs text-red-700">{t(result.error)}</p>}
                </div>
              );
            })}
          </div>

          {pendingSale && !paying && (
            <div className="border-t border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">
              <p className="font-bold">{t("انقطع الاتصال أثناء البيع ولم يُعرف إن تمّ")}</p>
              <p className="mt-1 text-xs leading-6">{t("«إعادة المحاولة» ترسل الطلب نفسه: إن كان سُجّل يظهر ولا يتكرر، وإلا يُكمل الآن. الطلب مقفل حتى ذلك. «تجاهل» بعد التحقق من فواتير الجلسة فقط.")}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <PosButton className="h-9" onClick={retryPending}><RotateCcw className="h-4 w-4" />{t("إعادة المحاولة")} <span className="text-xs opacity-70">F9</span></PosButton>
                <PosButton variant="outline" className="h-9" onClick={() => setDialog({ kind: "invoices" })}><FileText className="h-4 w-4" />{t("فواتير الجلسة")}</PosButton>
                <PosButton variant="danger" className="h-9" onClick={discardPending}>{t("تجاهل المحاولة")}</PosButton>
              </div>
            </div>
          )}
          <div className="space-y-1.5 border-t bg-slate-50 px-4 py-3 text-sm">
            <div className="flex flex-wrap gap-2 pb-1">
              {perms.discount !== "none" && (
                <button type="button" onClick={() => setDialog({ kind: "discount" })} className="flex items-center gap-1 rounded-lg border bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100">
                  <CircleDollarSign className="h-3.5 w-3.5" />{t("خصم الفاتورة")}{invoiceDiscountCents > 0 ? `: ${money(fromCents(invoiceDiscountCents))}` : ""}
                </button>
              )}
              <button type="button" onClick={() => setDialog({ kind: "note" })} className="flex items-center gap-1 rounded-lg border bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100">
                <StickyNote className="h-3.5 w-3.5" />{t(order.note ? "تعديل الملاحظة" : "ملاحظة")}
              </button>
              {order.lines.length > 0 && (
                <button type="button" onClick={() => updateOrder((o) => ({ ...emptyOrder(o.id) }))} className="flex items-center gap-1 rounded-lg border bg-white px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50">
                  <Trash2 className="h-3.5 w-3.5" />{t("تفريغ الطلب")}
                </button>
              )}
            </div>
            {totals.discountCents > 0 && (
              <>
                <div className="flex justify-between text-slate-600"><span>{t("الإجمالي قبل الخصم")}</span><span className={num}>{money(fromCents(totals.grossCents))}</span></div>
                <div className="flex justify-between text-slate-600"><span>{t("الخصم")}</span><span className={num}>- {money(fromCents(totals.discountCents))}</span></div>
              </>
            )}
            <div className="flex justify-between text-slate-600"><span>{t("الإجمالي قبل الضريبة")}</span><span className={num}>{money(fromCents(totals.subtotalCents))}</span></div>
            <div className="flex justify-between text-slate-600"><span>{t("ضريبة القيمة المضافة 15%")}</span><span className={num}>{money(fromCents(totals.taxCents))}</span></div>
            <div className="flex items-end justify-between pt-1">
              <span className="font-bold">{t("الإجمالي")}</span>
              <span className={cn("text-3xl font-extrabold text-slate-900", num)}>{money(fromCents(totals.totalCents))}</span>
            </div>
            {blockError && order.lines.length > 0 && <p className="text-xs font-medium text-red-700">{blockError}</p>}
            <div className="grid grid-cols-[1fr_auto] gap-2 pt-1">
              <button type="button" disabled={(!pendingSale && Boolean(blockError || saleBlocked)) || paying} onClick={openPay}
                className="flex h-14 items-center justify-center gap-2 rounded-xl bg-[#0f6b63] text-lg font-extrabold text-white shadow-sm hover:bg-[#0b5751] disabled:cursor-not-allowed disabled:opacity-40">
                <Receipt className="h-5 w-5" />{t("الدفع")} <span className="text-xs font-semibold opacity-70">F8</span>
              </button>
              <button type="button" disabled={(!pendingSale && Boolean(blockError || saleBlocked)) || paying} onClick={quickCash}
                className="flex h-14 flex-col items-center justify-center rounded-xl border-2 border-[#0f6b63] bg-white px-4 text-sm font-bold text-[#0b5751] hover:bg-[#e6f2f0] disabled:cursor-not-allowed disabled:opacity-40"
                title={t("دفع نقدي بالمبلغ المضبوط")}>
                {t("نقد مضبوط")}<span className="text-[10px] font-semibold opacity-70">F9</span>
              </button>
            </div>
          </div>
        </section>

        {/* الأصناف */}
        <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} autoFocus
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  const exact = findByCode(query);
                  if (exact) { if (scanned(query)) setQuery(""); return; }
                  if (filtered.length === 1 && filtered[0].vat_ok) { addProduct(filtered[0]); setQuery(""); return; }
                  if (filtered.length === 0 && query.trim()) toast({ title: t("الصنف غير موجود"), description: query.trim(), variant: "destructive" });
                }}
                className={cn(posInput, "mt-0 h-11 ps-9 text-base")} placeholder={t("ابحث بالاسم أو الرمز أو امسح الباركود (F2)")} />
              <Barcode className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
            </div>
            <div className="flex overflow-hidden rounded-lg border text-xs">
              {(["all", "product", "service"] as const).map((type) => (
                <button key={type} type="button" onClick={() => setTypeFilter(type)}
                  className={cn("px-3 py-2 font-semibold", typeFilter === type ? "bg-slate-900 text-white" : "bg-white text-slate-600")}>
                  {t(type === "all" ? "الكل" : type === "product" ? "منتجات" : "خدمات")}
                </button>
              ))}
            </div>
            <div className="flex overflow-hidden rounded-lg border">
              <button type="button" onClick={() => setPrefs((p) => ({ ...p, view: "grid" }))} className={cn("p-2", prefs.view === "grid" ? "bg-slate-900 text-white" : "text-slate-500")} aria-label={t("شبكة")}><LayoutGrid className="h-4 w-4" /></button>
              <button type="button" onClick={() => setPrefs((p) => ({ ...p, view: "list" }))} className={cn("p-2", prefs.view === "list" ? "bg-slate-900 text-white" : "text-slate-500")} aria-label={t("قائمة")}><List className="h-4 w-4" /></button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {filtered.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-400">
                <Boxes className="h-10 w-10" />
                <p className="text-sm">{t(products.length ? "لا أصناف بهذا البحث" : "لا أصناف نشطة؛ أضفها من المخزون ← المنتجات والخدمات")}</p>
              </div>
            ) : prefs.view === "grid" ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {filtered.map((p) => {
                  const out = p.item_type === "product" && (p.quantity ?? 0) <= 0;
                  return (
                    <button key={p.id} type="button" onClick={() => addProduct(p)} disabled={!p.vat_ok}
                      title={p.vat_ok ? undefined : t("نسبة ضريبة الصنف غير 15%؛ يُباع من فواتير المبيعات")}
                      className={cn("flex min-h-[96px] flex-col justify-between rounded-xl border bg-white p-3 text-start transition hover:border-[#0f6b63] hover:shadow-sm active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-slate-200",
                        out && "border-dashed opacity-70")}>
                      <span className="line-clamp-2 text-sm font-bold leading-5 text-slate-900">{p.name_ar}</span>
                      {!p.vat_ok && <span className="text-[10px] font-semibold text-amber-700">{t("ضريبة غير 15%")}</span>}
                      <span className="mt-2 flex items-end justify-between gap-2">
                        <span className={cn("text-base font-extrabold text-[#0b5751]", num)}>{p.price > 0 ? money(p.price) : t("بلا سعر")}</span>
                        {p.item_type === "product" ? (
                          <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-bold", num, out ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600")}>{formatNumber(p.quantity ?? 0)}</span>
                        ) : <span className="rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] font-bold text-sky-700">{t("خدمة")}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-500"><tr><th className="py-2 text-start">{t("الصنف")}</th><th>{t("الرمز")}</th><th>{t("المتوفر")}</th><th className="text-end">{t("السعر")}</th></tr></thead>
                <tbody>
                  {filtered.map((p) => (
                    <tr key={p.id} onClick={() => { if (p.vat_ok) addProduct(p); }}
                      className={cn("border-t", p.vat_ok ? "cursor-pointer hover:bg-[#f1f8f7]" : "cursor-not-allowed opacity-50")}>
                      <td className="py-2 font-semibold">{p.name_ar}{!p.vat_ok && <span className="ms-2 text-[10px] text-amber-700">{t("ضريبة غير 15%")}</span>}</td>
                      <td className="text-center text-xs text-slate-500"><Code>{p.sku}</Code></td>
                      <td className={cn("text-center", num)}>{p.item_type === "product" ? formatNumber(p.quantity ?? 0) : "—"}</td>
                      <td className={cn("text-end font-bold", num)}>{p.price > 0 ? money(p.price) : t("بلا سعر")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="border-t px-3 py-1.5 text-[11px] text-slate-500">
            {t("الأسعار قبل ضريبة القيمة المضافة 15%")} — {t("المستودع")}: {session.warehouse_name ?? "—"}
          </div>
        </section>
      </div>

      {/* النوافذ */}
      {dialog.kind === "pay" && (
        <PosPaymentDialog
          totals={totals}
          cardEnabled={Boolean(session.card_account_code)}
          namedCustomer={Boolean(order.customer)}
          canDiscount={perms.discount !== "none"}
          error={payError}
          busy={paying}
          onApplyDiscount={applyDiscountToMatch}
          onClose={() => setDialog({ kind: "none" })}
          onSubmit={(value) => void pay(value)}
        />
      )}
      {dialog.kind === "customer" && (
        <PosCustomerDialog
          allowCreate={perms.customers_add}
          onClose={() => setDialog({ kind: "none" })}
          onSelect={(customer) => {
            updateOrder((o) => ({ ...o, customer, invoiceType: customer?.tax_registration_mode === "registered_sa" ? o.invoiceType : "simplified" }));
            setDialog({ kind: "none" });
          }}
        />
      )}
      {dialog.kind === "discount" && (
        <InvoiceDiscountDialog
          current={order.invoiceDiscount}
          subtotalCents={computeCart(order.lines, 0).subtotalCents}
          maxPercent={perms.discount === "limited" ? ctx.settings.max_discount_percent : null}
          onClose={() => setDialog({ kind: "none" })}
          onSave={(value) => { updateOrder((o) => ({ ...o, invoiceDiscount: value })); setDialog({ kind: "none" }); }}
        />
      )}
      {dialog.kind === "note" && (
        <NoteDialog current={order.note} onClose={() => setDialog({ kind: "none" })}
          onSave={(value) => { updateOrder((o) => ({ ...o, note: value })); setDialog({ kind: "none" }); }} />
      )}
      {dialog.kind === "return" && (
        <PosReturnDialog
          session={session}
          initialInvoice={dialog.invoice}
          zatcaAllowed={ensureZatca}
          onClose={() => setDialog({ kind: "none" })}
          onDone={async (result: ReturnResult, receipt) => {
            setDialog({ kind: "none" });
            toast({
              title: `${t("تم المرتجع")}: ${isoLtr(result.note_number)}`,
              description: result.refund_amount > 0
                ? `${t("المردود")} ${money(result.refund_amount)} (${t(METHOD_LABELS[result.refund_method] ?? result.refund_method)})`
                : t("نقص المتبقي على الفاتورة"),
            });
            void reloadContext();
            void reloadProducts(session.id);
            let printed = result;
            if (result.note_zatca_phase === "phase2" && !["reported", "cleared"].includes(result.note_zatca_status ?? "")) {
              if (await ensureZatca()) {
                const sent = await sendToZatca({ noteId: result.note_id });
                if (sent.ok) printed = { ...result, note_qr_code_data: sent.qrCodeData || result.note_qr_code_data };
                else toast({ title: t("لم يُرسل الإشعار للهيئة"), description: sent.message, variant: "destructive" });
              }
            }
            await printReturnReceipt({ result: printed, receipt, footer: ctx.settings.receipt_footer }, format);
          }}
        />
      )}
      {dialog.kind === "cash" && (
        <PosCashDialog
          kind={dialog.op}
          session={session}
          treasuryAccounts={ctx.treasury_accounts}
          expenseAccounts={ctx.expense_accounts}
          onClose={() => setDialog({ kind: "none" })}
          onDone={(message) => { setDialog({ kind: "none" }); toast({ title: t("تمت العملية"), description: message }); void reloadContext(); }}
        />
      )}
      {dialog.kind === "close" && (
        <PosCloseDialog
          sessionId={session.id}
          treasuryAccounts={ctx.treasury_accounts}
          canSettleLedger={perms.sessions_manage}
          parkedOrders={orders.filter((o) => o.lines.length > 0).length}
          onClose={() => setDialog({ kind: "none" })}
          onClosed={(report) => {
            clearOrders(session.id);
            printSessionReport(report, format);
            toast({ title: t("أُغلقت الجلسة"), description: `${isoLtr(report.session.session_number)} — ${t("الباقي")} ${money(report.close?.remaining_cash ?? 0)}` });
            navigate(`/pos/sessions/${report.session.id}`, { replace: true });
          }}
        />
      )}
      {dialog.kind === "invoices" && (
        <SessionInvoicesDialog
          sessionId={session.id}
          canReturn={perms.returns}
          phase2={phase2}
          report={sessionReport}
          setReport={setSessionReport}
          onClose={() => setDialog({ kind: "none" })}
          onReprint={(id) => void printReceiptFor(id, true)}
          onReturn={(id) => setDialog({ kind: "return", invoice: id })}
          onSend={async (id) => {
            if (!(await ensureZatca())) return;
            const sent = await sendToZatca({ invoiceId: id });
            toast({ title: sent.ok ? t("أُرسلت للهيئة") : t("تعذر الإرسال للهيئة"), description: sent.message, variant: sent.ok ? undefined : "destructive" });
            const refreshed = await loadSessionReport(session.id);
            if (refreshed.data) setSessionReport(refreshed.data);
          }}
        />
      )}
      {dialog.kind === "shortcuts" && (
        <PosModal title="اختصارات لوحة المفاتيح" onClose={() => setDialog({ kind: "none" })}>
          <ul className="space-y-2 text-sm">
            {[
              ["F2", "البحث عن صنف"], ["F4", "اختيار العميل"], ["F6", "طلب جديد (يبقى الحالي معلّقًا)"], ["F7", "مرتجع"],
              ["F8", "الدفع"], ["F9", "دفع نقدي بالمبلغ المضبوط"], ["F10", "فواتير الجلسة"], ["+ / -", "زيادة كمية البند المختار أو إنقاصها"],
              ["Delete", "حذف البند المختار"], ["Enter", "في الدفع: إتمام البيع؛ بعد البيع: طلب جديد"], ["Esc", "إغلاق النافذة"],
            ].map(([key, label]) => (
              <li key={key} className="flex items-center justify-between gap-3 border-b pb-2 last:border-0">
                <span className="text-slate-700">{t(label)}</span>
                <kbd className="rounded border bg-slate-50 px-2 py-0.5 font-mono text-xs">{key}</kbd>
              </li>
            ))}
            <li className="pt-1 text-xs text-slate-500"><Keyboard className="me-1 inline h-3.5 w-3.5" />{t("ماسح الباركود يعمل مباشرة دون الضغط على خانة البحث.")}</li>
          </ul>
        </PosModal>
      )}

      {paying && dialog.kind !== "pay" && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/30" role="status" aria-live="polite">
          <div className="flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-800 shadow-xl">
            <Loader2 className="h-4 w-4 animate-spin text-[#0f6b63]" />{t("جارٍ إتمام البيع...")}
          </div>
        </div>
      )}

      {done && dialog.kind === "none" && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-2xl">
            <div className="text-sm font-semibold text-slate-500"><Code>{done.sale.invoice_id}</Code></div>
            <div className="mt-1 text-lg font-bold text-slate-900">{t("تم البيع")}</div>
            <div className={cn("mt-3 text-sm text-slate-600", num)}>{t("الإجمالي")} {money(done.sale.total)}</div>
            {done.sale.change_given > 0 && (
              <div className="mt-3 rounded-xl bg-emerald-50 p-4">
                <div className="text-xs font-semibold text-emerald-700">{t("الباقي للعميل")}</div>
                <div className={cn("text-4xl font-extrabold text-emerald-700", num)}>{money(done.sale.change_given)}</div>
              </div>
            )}
            {done.sale.on_account > 0 && (
              <div className={cn("mt-3 rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900", num)}>
                {t("على حساب العميل")}: {money(done.sale.on_account)}
              </div>
            )}
            {done.zatca !== "none" && (
              <div className={cn("mt-3 flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold",
                done.zatca === "sent" ? "bg-emerald-50 text-emerald-700" : done.zatca === "failed" ? "bg-red-50 text-red-700" : "bg-slate-50 text-slate-600")}>
                <Send className="h-3.5 w-3.5" />
                {done.zatca === "sending" ? t("جارٍ الإبلاغ للهيئة...") : done.zatca === "sent" ? t("أُبلغت الهيئة") : `${t("لم تُبلَّغ الهيئة")}: ${done.zatcaMessage}`}
              </div>
            )}
            <div className="mt-5 grid grid-cols-2 gap-2">
              <PosButton variant="outline" onClick={() => void printReceiptFor(done.sale.invoice_id, false)}><Printer className="h-4 w-4" />{t("طباعة الإيصال")}</PosButton>
              <PosButton onClick={() => { setDone(null); searchRef.current?.focus(); }}>{t("طلب جديد")} <span className="text-xs opacity-70">Enter</span></PosButton>
            </div>
            <p className="mt-3 text-[11px] text-slate-400">{fmtDate(done.sale.created_at)}</p>
          </div>
        </div>
      )}

      {zatcaAsk && (
        <PosModal title="الإرسال الفعلي للهيئة" onClose={() => { zatcaAsk.resolve(false); setZatcaAsk(null); }}
          footer={
            <>
              <PosButton variant="outline" onClick={() => { zatcaAsk.resolve(false); setZatcaAsk(null); }}>{t("لا الآن")}</PosButton>
              <PosButton disabled={zatcaText.trim() !== "SUBMIT_REAL_ZATCA_INVOICE"} onClick={() => { confirmZatcaForSession(session.id); zatcaAsk.resolve(true); setZatcaAsk(null); }}>
                {t("تأكيد الإرسال في هذه الجلسة")}
              </PosButton>
            </>
          }>
          <p className="text-sm leading-7 text-slate-700">
            {t("فواتير الجلسة وإشعاراتها تُبلَّغ للهيئة فور إصدارها، وهي فواتير إنتاج حقيقية وملزمة قانونيًا. اكتب SUBMIT_REAL_ZATCA_INVOICE للتأكيد مرة واحدة لهذه الجلسة.")}
          </p>
          <input value={zatcaText} onChange={(e) => setZatcaText(e.target.value)} className={cn(posInput, "text-left font-mono")} dir="ltr" autoFocus />
        </PosModal>
      )}
    </div>
  );
}

/** خصم الفاتورة (قبل الضريبة) مبلغًا أو نسبة */
function InvoiceDiscountDialog({ current, subtotalCents, maxPercent, onClose, onSave }: {
  current: string; subtotalCents: number; maxPercent: number | null; onClose: () => void; onSave: (value: string) => void;
}) {
  const { t, formatNumber, direction } = useI18n();
  const money = useMoney();
  const [mode, setMode] = useState<"amount" | "percent">("amount");
  const [value, setValue] = useState(current);
  const [error, setError] = useState("");
  const save = () => {
    if (!value.trim()) { onSave(""); return; }
    let cents: number | null;
    if (mode === "percent") {
      const pct = Number(value);
      cents = Number.isFinite(pct) && pct >= 0 && pct <= 100 && /^\d{1,3}(\.\d{1,2})?$/.test(value.trim()) ? percentOfCents(subtotalCents, pct) : null;
    } else cents = parseMoney(value);
    if (cents === null || cents > subtotalCents) { setError(t("خصم الفاتورة غير صحيح أو أكبر من قيمتها")); return; }
    onSave(fromCents(cents).toFixed(2));
  };
  return (
    <PosModal title="خصم الفاتورة" onClose={onClose}
      footer={<><PosButton variant="outline" onClick={() => onSave("")}>{t("بلا خصم")}</PosButton><PosButton onClick={save}>{t("تطبيق")}</PosButton></>}>
      <div className="space-y-3">
        <div className="flex overflow-hidden rounded-lg border text-sm">
          {(["amount", "percent"] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} className={cn("flex-1 py-2 font-semibold", mode === m ? "bg-slate-900 text-white" : "bg-white text-slate-600")}>
              {t(m === "amount" ? "مبلغ" : "نسبة %")}
            </button>
          ))}
        </div>
        <input value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); }} inputMode="decimal"
          className={cn(posInput, "text-left text-lg font-bold", num)} dir="ltr" autoFocus />
        <p className="text-xs leading-6 text-slate-500">
          {t("الخصم قبل الضريبة على قيمة الفاتورة")} ({money(fromCents(subtotalCents))}){direction === "rtl" ? "،" : ","} {t("ويُوزَّع على البنود بالتناسب.")}
          {maxPercent !== null && ` ${t("الحد المسموح لك")}: ${formatNumber(maxPercent)}%.`}
        </p>
        <ErrorNote message={error} />
      </div>
    </PosModal>
  );
}

function NoteDialog({ current, onClose, onSave }: { current: string; onClose: () => void; onSave: (value: string) => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState(current);
  return (
    <PosModal title="ملاحظة الطلب" onClose={onClose}
      footer={<><PosButton variant="outline" onClick={onClose}>{t("إلغاء")}</PosButton><PosButton onClick={() => onSave(value.trim())}>{t("حفظ")}</PosButton></>}>
      <textarea value={value} onChange={(e) => setValue(e.target.value)} maxLength={200} rows={3} className={cn(posInput, "h-auto py-2")} autoFocus />
      <p className="mt-1 text-xs text-slate-500">{t("تظهر في ملاحظات الفاتورة.")}</p>
    </PosModal>
  );
}

/** فواتير الجلسة: إعادة الطباعة والمرتجع والإرسال للهيئة */
function SessionInvoicesDialog({ sessionId, canReturn, phase2, report, setReport, onClose, onReprint, onReturn, onSend }: {
  sessionId: string; canReturn: boolean; phase2: boolean; report: SessionReport | null; setReport: (r: SessionReport) => void;
  onClose: () => void; onReprint: (id: string) => void; onReturn: (id: string) => void; onSend: (id: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const money = useMoney();
  const fmtDate = usePosDate();
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState("");
  useEffect(() => {
    (async () => {
      const result = await loadSessionReport(sessionId);
      if (result.error || !result.data) { setError(posErrorText(result.error ?? "", t)); return; }
      setReport(result.data);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);
  const list = (report?.session.id === sessionId ? report.invoices : []).filter((inv) =>
    !query.trim() || inv.invoice_id.toLowerCase().includes(query.trim().toLowerCase()) || inv.customer.includes(query.trim()));
  return (
    <PosModal title="فواتير الجلسة" onClose={onClose} size="xl">
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} className={cn(posInput, "mt-0 ps-9")} placeholder={t("ابحث برقم الفاتورة أو العميل")} autoFocus />
        </div>
        <ErrorNote message={error} />
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 text-start">{t("الفاتورة")}</th><th className="px-3 py-2">{t("الوقت")}</th><th className="px-3 py-2 text-start">{t("العميل")}</th>
                <th className="px-3 py-2">{t("الإجمالي")}</th><th className="px-3 py-2">{t("الدفع")}</th><th className="px-3 py-2">{t("المرتجع")}</th>
                {phase2 && <th className="px-3 py-2">{t("الهيئة")}</th>}<th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">{t(report ? "لا فواتير" : "جاري التحميل...")}</td></tr>
              ) : list.map((inv) => (
                <tr key={inv.invoice_id} className="border-t">
                  <td className="px-3 py-2 font-semibold"><Code>{inv.invoice_id}</Code></td>
                  <td className="px-3 py-2 text-center text-xs text-slate-500">{fmtDate(inv.created_at, { timeStyle: "short" })}</td>
                  <td className="px-3 py-2">{inv.customer}</td>
                  <td className={cn("px-3 py-2 text-center font-bold", num)}>{money(inv.total)}</td>
                  <td className="px-3 py-2 text-center text-xs">
                    {[inv.paid_cash > 0 ? `${t("نقد")} ${money(inv.paid_cash)}` : "", inv.paid_card > 0 ? `${t("بطاقة")} ${money(inv.paid_card)}` : "",
                      inv.on_account > 0 ? `${t("على الحساب")} ${money(inv.on_account)}` : ""].filter(Boolean).join(" + ")}
                  </td>
                  <td className={cn("px-3 py-2 text-center", num, inv.returned_total > 0 && "text-red-700")}>{inv.returned_total > 0 ? money(inv.returned_total) : "—"}</td>
                  {phase2 && (
                    <td className="px-3 py-2 text-center text-xs">
                      {["reported", "cleared"].includes(inv.zatca_status) ? <span className="text-emerald-700">{t("أُبلغت")}</span> : (
                        <button type="button" disabled={sending === inv.invoice_id} onClick={async () => { setSending(inv.invoice_id); await onSend(inv.invoice_id); setSending(""); }}
                          className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 font-semibold text-amber-900 disabled:opacity-50">{t(sending === inv.invoice_id ? "جارٍ..." : "إرسال")}</button>
                      )}
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <button type="button" onClick={() => onReprint(inv.invoice_id)} className="rounded p-1.5 text-slate-600 hover:bg-slate-100" title={t("إعادة طباعة الإيصال")}><Printer className="h-4 w-4" /></button>
                      {canReturn && <button type="button" onClick={() => onReturn(inv.invoice_id)} className="rounded p-1.5 text-slate-600 hover:bg-slate-100" title={t("مرتجع")}><RotateCcw className="h-4 w-4" /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </PosModal>
  );
}

