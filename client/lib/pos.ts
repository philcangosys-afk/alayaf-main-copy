/**
 * S22: نقاط البيع (جزء من المحاسبة والمالية): الأنواع والقراءة والحساب والتسميات ورسائل الأخطاء المشتركة بين الشاشات.
 * الجداول: pos_settings، pos_devices، pos_cashier_accounts، pos_sessions، pos_sales، pos_returns، pos_movements
 * (الكتابة من دوال pos_* في الخادم فقط). البيع فاتورة مبيعات عادية، والمرتجع إشعار دائن عادي، وكل حركة نقد بقيدها.
 */
import { supabase } from "@/lib/supabaseClient";
import { dbErrorOr } from "@/lib/dbErrors";
import { companyStorageKey, zatcaDeviceSerialKey } from "@/lib/companyProfile";
import { readUserSession } from "@/lib/authSession";

/* ═══════════ الأنواع ═══════════ */
export type DeviceType = "cash_box" | "custody";
export type DiscountLevel = "none" | "limited" | "full";

export type PosPermissions = {
  sell: boolean;
  price_change: boolean;
  discount: DiscountLevel;
  returns: boolean;
  cash: boolean;
  sessions: boolean;
  sessions_manage: boolean;
  devices: boolean;
  customers_add: boolean;
};

export type PosOpenSessionRef = {
  id: string; session_number: string; user_id: string; user_name: string | null; opened_at: string; mine: boolean;
};

export type PosDevice = {
  id: string; name: string; device_type: DeviceType; active: boolean; notes: string | null;
  warehouse_id: string; warehouse_name: string | null; branch_ids: string[]; user_ids: string[];
  cash_account_code: string | null; cash_account_name: string | null; cash_balance: number | null;
  card_account_code: string | null; card_account_name: string | null;
  open_session: PosOpenSessionRef | null; open_sessions_count: number; sessions_count: number; can_open: boolean;
};

export type PosSession = {
  id: string; session_number: string; status: "open" | "closed";
  device_id: string; device_name: string; device_type: DeviceType;
  user_id: string; user_name: string | null; mine: boolean;
  warehouse_id: string; warehouse_name: string | null;
  cash_account_code: string; cash_account_name: string | null;
  card_account_code: string | null; card_account_name: string | null;
  opening_balance: number; opening_note: string | null; opened_at: string;
  expected_cash: number | null; counted_cash: number | null; difference: number | null; remaining_cash: number | null;
  closing_note: string | null; closed_at: string | null; closed_by_name: string | null;
  sales_count?: number; sales_total?: number; returns_total?: number;
};

export type TreasuryAccount = { account_code: string; name: string; account_kind: "cash" | "bank"; in_session?: boolean };
export type AccountOption = { code: string; name: string };

export type PosContext = {
  session: PosSession | null;
  user_name: string | null;
  permissions: PosPermissions;
  settings: {
    max_discount_percent: number; return_days: number; receipt_footer: string | null; has_default_address: boolean;
    default_customer_id: string | null; default_customer_name: string | null;
  };
  treasury_accounts: TreasuryAccount[];
  expense_accounts: AccountOption[];
  devices: PosDevice[];
};

export type PosProduct = {
  id: string; sku: string; name_ar: string; name_en: string; item_type: "product" | "service"; unit: string; barcode: string;
  price: number; vat_rate: number;
  /** نسبة الصنف 15%: غير ذلك يُباع من فواتير المبيعات */
  vat_ok: boolean;
  description: string; quantity: number | null;
};

export type PosCustomer = {
  id: string; name: string; customer_number: string; phone: string | null;
  tax_registration_mode: "not_registered" | "registered_sa"; tax_number: string | null;
  address_complete: boolean; balance: number;
};

export type PosSettings = {
  default_customer_id: string | null; default_customer_name: string | null; default_address: string | null;
  shortage_account: string | null; surplus_account: string | null;
  effective_shortage_account: string | null; effective_surplus_account: string | null;
  effective_shortage_name: string | null; effective_surplus_name: string | null;
  max_discount_percent: number; return_days: number; receipt_footer: string | null;
  cash_group_code: string | null; custody_group_code: string | null;
};
export type PosSettingsPayload = {
  can_manage: boolean; settings: PosSettings; accounts: AccountOption[]; bank_accounts: TreasuryAccount[];
  warehouses: Array<{ id: string; code: string; name_ar: string }>; branches: Array<{ id: string; name: string }>;
  users: Array<{ user_id: string; name: string | null }>;
};

export type SaleResult = {
  sale_id: string; invoice_id: string; session_id: string; customer_id: string | null; customer: string;
  gross_total: number; discount_total: number; subtotal: number; tax: number; total: number;
  cash_tendered: number; change_given: number; paid_cash: number; paid_card: number; on_account: number;
  invoice_status: string; invoice_type: "simplified" | "standard"; zatca_phase: "phase1" | "phase2"; zatca_status: string;
  qr_code_data: string | null; created_at: string; existing: boolean;
};

export type ReturnResult = {
  return_id: string; session_id: string; invoice_id: string; note_id: string; note_number: string; total: number;
  /** mixed: نقد وبطاقة (الرد بالطريقة المطلوبة حتى ما قُبض بها، والباقي بالأخرى) */
  refund_method: "cash" | "card" | "mixed" | "none"; refund_amount: number; reason: string | null;
  note_zatca_phase: "phase1" | "phase2" | null; note_zatca_status: string | null; note_qr_code_data: string | null;
  note_subtotal: number; note_tax: number;
  /** بنود الإشعار كما صدر (الكمية والسعر والخصم) */
  lines: Array<{ description: string; quantity: number; unit_price: number; discount: number }>;
  invoice_remaining: number; created_at: string; existing: boolean;
};

export type ReceiptLine = {
  index: number; description: string; sku: string | null; unit: string | null; product_id: string | null;
  quantity: number; unit_price: number; discount: number; net: number; stock: boolean; returned: number; returnable: number;
};
export type PosReceipt = {
  invoice: {
    id: string; date: string; created_at: string; invoice_type: "simplified" | "standard"; customer: string; customer_id: string | null;
    customer_address: string | null; buyer_vat: string | null; subtotal: number; total_tax: number; total: number;
    adjusted_total: number | null; paid: number; status: string; zatca_phase: "phase1" | "phase2"; zatca_status: string;
    qr_code_data: string | null; uuid: string | null; issued_by_name: string | null;
  };
  sale: { gross_total: number; discount_total: number; cash_tendered: number; change_given: number; paid_cash: number; paid_card: number; on_account: number; created_at: string };
  session: { id: string; session_number: string; device_name: string; user_name: string | null; status: string; mine: boolean };
  lines: ReceiptLine[];
  returns: Array<{ id: string; note_id: string; note_number: string; total: number; refund_method: string; refund_amount: number; zatca_status: string | null; created_at: string }>;
  return_expired: boolean;
  /** على الفاتورة إشعار تخفيض سعر أو إشعار مدين: المرتجع من الإشعارات الدائنة لا من هنا */
  has_adjustments: boolean;
  /** ما قُبض بكل طريقة بعد ما رُد بها (الرد بطريقة أكبر مما قُبض بها يتطلب إدارة المرتجع) */
  refundable: { cash: number; card: number };
  receipt_footer: string | null;
};

export type SessionSummary = {
  sales_count: number; gross: number; discounts: number; net_sales: number; tax: number; total: number;
  sales_cash: number; sales_card: number; sales_on_account: number; cash_tendered: number; change_given: number;
  returns_count: number; returns_total: number; returns_subtotal: number; returns_tax: number;
  refunds_cash: number; refunds_card: number; receipts_count: number; receipts_cash: number; receipts_card: number;
  expenses_count: number; expenses_total: number; cash_in: number; cash_out: number;
  /** هللات تقريب ضريبة المرتجعات (قيد على الذمم بلا أثر نقدي) */
  rounding: number;
  /** تسوية فرق الدفتر عند الإغلاق (بإشارتها) */
  ledger_adjustment: number;
  shortage: number; surplus: number; handovers: number; opening_balance: number; expected_cash: number;
  card_total: number; net_total: number; net_tax: number;
  items: Array<{ product_id: string | null; description: string; quantity: number; amount: number }>;
};
export type SessionClose = {
  expected_cash: number; counted_cash: number; difference: number; handovers: Array<{ account_code: string; name: string; amount: number }>;
  handover_total: number; remaining_cash: number; remaining_place: "box" | "custody"; closed_at: string; closed_by_name: string | null;
  note: string | null;
};
export type MovementKind = "sale" | "receipt" | "refund" | "expense" | "cash_in" | "cash_out" | "shortage" | "surplus" | "handover"
  | "rounding" | "adjustment";
export type SessionReport = {
  session: PosSession;
  report_type: "X" | "Z";
  generated_at: string;
  /** رصيد حساب الجلسة في الدفتر (للجلسة المفتوحة) */
  ledger_balance: number | null;
  /** حسابات الخزينة للتسليم عند الإغلاق (للجلسة المفتوحة) */
  treasury_accounts?: TreasuryAccount[] | null;
  summary: SessionSummary;
  close: SessionClose | null;
  invoices: Array<{
    invoice_id: string; created_at: string; customer: string; customer_id: string | null; total: number; paid_cash: number; paid_card: number;
    on_account: number; change_given: number; discount_total: number; status: string; invoice_type: string; zatca_phase: string;
    zatca_status: string; adjusted_total: number | null; returned_total: number;
  }>;
  movements: Array<{
    id: string; kind: MovementKind; method: "cash" | "card" | "account"; amount: number; cash_effect: number; tax_amount: number;
    account_code: string | null; account_name: string | null; invoice_id: string | null; customer: string | null;
    reference: string | null; note: string | null; entry_number: string | null; created_at: string;
  }>;
  returns: Array<{
    id: string; invoice_id: string; note_id: string; note_number: string; total: number; refund_method: string; refund_amount: number;
    reason: string | null; zatca_phase: string | null; zatca_status: string | null; created_at: string;
  }>;
};

/* ═══════════ التسميات ═══════════ */
export const DEVICE_TYPES: Array<{ value: DeviceType; label: string; hint: string }> = [
  { value: "cash_box", label: "صندوق", hint: "للجهاز حساب نقدية خاص؛ جلسة واحدة عليه، وما يبقى فيه عند الإغلاق رصيد الجلسة التالية" },
  { value: "custody", label: "عهدة", hint: "النقد في عهدة الموظف؛ جلسة واحدة لكل موظف، وما يبقى معه عند الإغلاق يبقى عهدة عليه" },
];
export const deviceTypeLabel = (value: string) => DEVICE_TYPES.find((type) => type.value === value)?.label ?? value;

export const MOVEMENT_LABELS: Record<MovementKind, string> = {
  sale: "بيع",
  receipt: "قبض من عميل",
  refund: "رد مرتجع",
  expense: "مصروف",
  cash_in: "إيداع من الخزينة",
  cash_out: "سحب إلى الخزينة",
  shortage: "عجز عند الإغلاق",
  surplus: "زيادة عند الإغلاق",
  handover: "تسليم للخزينة",
  rounding: "هللات تقريب المرتجع",
  adjustment: "تسوية فرق الدفتر",
};
export const METHOD_LABELS: Record<string, string> = { cash: "نقد", card: "بطاقة", mixed: "نقد وبطاقة", account: "على الحساب", none: "بلا رد" };

/** رقم مستند أو رمز (1001-INV-000012) داخل نص عربي: يُعزل باتجاه اليسار فلا تنقلب أجزاؤه (للعناوين والتنبيهات والطباعة) */
export const isoLtr = (value: string | null | undefined) => (value ? `\u2066${value}\u2069` : "");

/* ═══════════ المال بالهللة ═══════════ */
/** هللات صحيحة من رقم (تقريب نصف للأعلى كالخادم للقيم الموجبة) */
export const toCents = (value: number) => Math.round(Number(value) * 100 + (Number(value) >= 0 ? 1e-7 : -1e-7));
export const fromCents = (cents: number) => Math.round(cents) / 100;
/** مبلغ بخانتين على الأكثر وغير سالب */
export const isMoneyText = (value: string) => /^\d{1,9}(\.\d{1,2})?$/.test(value.trim());
/** كمية موجبة بثلاث خانات على الأكثر */
export const isQuantityText = (value: string) => /^\d{1,7}(\.\d{1,3})?$/.test(value.trim()) && Number(value) > 0;
export const parseMoney = (value: string) => (isMoneyText(value) ? toCents(Number(value)) : null);

/* ═══════════ السلة ═══════════ */
export type CartLine = {
  key: string;
  productId: string;
  name: string;
  sku: string;
  unit: string;
  itemType: "product" | "service";
  /** سعر البيع في بطاقة الصنف (قبل الضريبة) */
  listPrice: number;
  unitPrice: string;
  quantity: string;
  discountMode: "amount" | "percent";
  discountValue: string;
};

export type CartLineResult = {
  key: string;
  grossCents: number;
  lineDiscountCents: number;
  shareCents: number;
  discountCents: number;
  netCents: number;
  error: string | null;
};

export type CartTotals = {
  lines: CartLineResult[];
  grossCents: number;
  discountCents: number;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  invoiceDiscountCents: number;
  /** أول خطأ يمنع الدفع */
  error: string | null;
};

/** نسبة (بخانتين عشريتين) من مبلغ بالهللات، مقربة لأقرب هللة بحساب صحيح كما في الخادم (لا كسور عشرية عائمة) */
export const percentOfCents = (cents: number, percent: number) =>
  Math.floor((Math.round(cents) * Math.round(Number(percent) * 100) + 5000) / 10000);

/** صافي البند وخصمه وخصم الفاتورة موزعًا بالهللة (كما يحسبه الخادم تمامًا) */
export function computeCart(lines: CartLine[], invoiceDiscountCents: number): CartTotals {
  const results: CartLineResult[] = lines.map((line) => {
    let error: string | null = null;
    if (!isQuantityText(line.quantity)) error = "الكمية رقم موجب بثلاث خانات عشرية على الأكثر";
    const priceCents = parseMoney(line.unitPrice);
    if (priceCents === null || priceCents <= 0) error = error ?? "سعر البند مطلوب (أكبر من صفر)";
    const qtyMilli = Math.round(Number(line.quantity) * 1000);
    const grossMilli = qtyMilli * (priceCents ?? 0);
    if (!error && grossMilli % 1000 !== 0) error = "الكمية × السعر يجب أن يكون بالهللة؛ عدّل الكمية أو السعر";
    const grossCents = error ? 0 : grossMilli / 1000;
    let lineDiscountCents = 0;
    if (!error && line.discountValue.trim()) {
      if (line.discountMode === "percent") {
        const pct = Number(line.discountValue);
        if (!Number.isFinite(pct) || pct < 0 || pct > 100 || !/^\d{1,3}(\.\d{1,2})?$/.test(line.discountValue.trim())) {
          error = "نسبة الخصم من 0 إلى 100";
        } else {
          lineDiscountCents = percentOfCents(grossCents, pct);
        }
      } else {
        const cents = parseMoney(line.discountValue);
        if (cents === null) error = "الخصم مبلغ بخانتين عشريتين على الأكثر";
        else lineDiscountCents = cents;
      }
      if (!error && lineDiscountCents > grossCents) error = "الخصم أكبر من قيمة البند";
    }
    return { key: line.key, grossCents, lineDiscountCents, shareCents: 0, discountCents: lineDiscountCents, netCents: grossCents - lineDiscountCents, error };
  });
  const baseTotal = results.reduce((sum, line) => sum + line.netCents, 0);
  let invoiceDiscount = Math.max(0, Math.round(invoiceDiscountCents));
  let error = results.find((line) => line.error)?.error ?? null;
  if (invoiceDiscount > baseTotal) {
    error = error ?? "خصم الفاتورة أكبر من قيمتها";
    invoiceDiscount = 0;
  }
  if (invoiceDiscount > 0 && baseTotal > 0) {
    // بالهللات الصحيحة: قسمة وباقي دقيقان (BigInt)، والهللات الباقية لأكبر باقٍ ثم للأسبق، كما في الخادم
    const total = BigInt(baseTotal);
    let allocated = 0;
    const fractions = results.map((line, index) => {
      const product = BigInt(invoiceDiscount) * BigInt(line.netCents);
      const floor = Number(product / total);
      line.shareCents = floor;
      allocated += floor;
      return { index, rem: product % total, base: line.netCents };
    });
    let left = invoiceDiscount - allocated;
    fractions
      .filter((item) => item.base > results[item.index].shareCents)
      .sort((a, b) => (a.rem === b.rem ? a.index - b.index : a.rem > b.rem ? -1 : 1))
      .forEach((item) => {
        if (left <= 0) return;
        results[item.index].shareCents += 1;
        left -= 1;
      });
    results.forEach((line) => {
      line.discountCents = line.lineDiscountCents + line.shareCents;
      line.netCents = line.grossCents - line.discountCents;
    });
  }
  const grossCents = results.reduce((sum, line) => sum + line.grossCents, 0);
  const subtotalCents = results.reduce((sum, line) => sum + line.netCents, 0);
  const taxCents = Math.round((subtotalCents * 15) / 100);
  return {
    lines: results,
    grossCents,
    discountCents: grossCents - subtotalCents,
    subtotalCents,
    taxCents,
    totalCents: subtotalCents + taxCents,
    invoiceDiscountCents: invoiceDiscount,
    error: lines.length === 0 ? "أضف صنفًا واحدًا على الأقل" : error,
  };
}

/** الإجمالي بعد خصم فاتورة (قبل الضريبة) */
const totalWithDiscount = (lines: CartLine[], discountCents: number) => computeCart(lines, discountCents).totalCents;

/**
 * خصم الفاتورة (قبل الضريبة) الذي يجعل الإجمالي مساويًا للمبلغ المدفوع (زر «خصم» في الدفع):
 * الأقرب الذي لا يزيد الإجمالي معه عن المدفوع. null إن كان المدفوع أكبر من الإجمالي أو لا يمكن.
 */
export function discountToMatch(lines: CartLine[], targetTotalCents: number): number | null {
  const base = computeCart(lines, 0);
  if (base.error || targetTotalCents >= base.totalCents || targetTotalCents < 0) return null;
  const guess = base.subtotalCents - Math.round((targetTotalCents * 100) / 115);
  let best: number | null = null;
  for (let delta = -3; delta <= 3; delta += 1) {
    const candidate = guess + delta;
    if (candidate < 0 || candidate > base.subtotalCents) continue;
    const total = totalWithDiscount(lines, candidate);
    if (total === targetTotalCents) return candidate;
    if (total <= targetTotalCents && (best === null || candidate < best)) best = candidate;
  }
  return best;
}

/** أكبر خصم مسموح للبند بحد الخصم (للصلاحية المحدودة): هللة سماح لتوزيع خصم الفاتورة، ولا سماح إن كان الحد صفرًا */
export const lineDiscountLimitCents = (grossCents: number, maxPercent: number) =>
  percentOfCents(grossCents, maxPercent) + (maxPercent > 0 ? 1 : 0);

/* ═══════════ الطلبات المعلّقة (في المتصفح، لكل جلسة) ═══════════ */
export type CartOrder = {
  id: number;
  lines: CartLine[];
  customer: PosCustomer | null;
  note: string;
  invoiceDiscount: string;
  invoiceType: "simplified" | "standard";
  createdAt: string;
};
export const emptyOrder = (id: number): CartOrder => ({
  id, lines: [], customer: null, note: "", invoiceDiscount: "", invoiceType: "simplified", createdAt: new Date().toISOString(),
});
const ordersKey = (sessionId: string) => companyStorageKey(`pos-orders-${sessionId}`);
export function loadOrders(sessionId: string): CartOrder[] {
  try {
    const raw = localStorage.getItem(ordersKey(sessionId));
    const parsed = raw ? (JSON.parse(raw) as CartOrder[]) : [];
    return Array.isArray(parsed) && parsed.length ? parsed.filter((order) => order && Array.isArray(order.lines)) : [emptyOrder(1)];
  } catch {
    return [emptyOrder(1)];
  }
}
export function saveOrders(sessionId: string, orders: CartOrder[]) {
  try {
    localStorage.setItem(ordersKey(sessionId), JSON.stringify(orders));
  } catch {
    /* التخزين غير متاح: الطلبات تبقى في الذاكرة */
  }
}
export function clearOrders(sessionId: string) {
  try {
    localStorage.removeItem(ordersKey(sessionId));
  } catch {
    /* لا شيء */
  }
  clearSessionRequests(sessionId);
}

/* ═══════════ القراءة والكتابة (دوال الخادم) ═══════════ */
/** status وcode: حالة HTTP ورمز الخطأ (SQLSTATE أو PGRST) لتمييز رفض الخادم من انقطاع لا تُعرف نتيجته */
type RpcResult<T> = { data: T | null; error: string | null; status?: number | null; code?: string | null };
async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<RpcResult<T>> {
  try {
    const { data, error, status } = await supabase.rpc(name, args ?? {});
    if (error) return { data: null, error: String(error.message ?? "error"), status: typeof status === "number" ? status : null, code: error.code ?? null };
    return { data: data as T, error: null };
  } catch (thrown) {
    // انقطاع الاتصال قد يُرمى بدل أن يعود خطأً
    return { data: null, error: String((thrown as Error)?.message ?? thrown ?? "Failed to fetch") || "Failed to fetch" };
  }
}

export const loadPosContext = () => rpc<PosContext>("pos_screen_context");
export const loadPosProducts = (sessionId: string) => rpc<PosProduct[]>("pos_list_products", { p_session: sessionId });
export const listPosDevices = () => rpc<PosDevice[]>("pos_list_devices");
export const loadPosSettings = () => rpc<PosSettingsPayload>("pos_get_settings");
export const savePosSettings = (payload: Record<string, unknown>) => rpc<PosSettingsPayload>("pos_save_settings", { p: payload });
export const savePosDevice = (id: string | null, payload: Record<string, unknown>) => rpc<PosDevice>("pos_save_device", { p_id: id, p: payload });
export const setPosDeviceActive = (id: string, active: boolean) => rpc<PosDevice>("pos_set_device_active", { p_id: id, p_active: active });
export const deletePosDevice = (id: string) => rpc<{ deleted: boolean; account_deleted: boolean }>("pos_delete_device", { p_id: id });
export const openPosSession = (deviceId: string, note: string) => rpc<PosSession>("pos_open_session", { p_device: deviceId, p: { note: note || null } });
export const deletePosSession = (id: string) => rpc<{ deleted: boolean }>("pos_delete_session", { p_session: id });
export const searchPosCustomers = (query: string) => rpc<PosCustomer[]>("pos_search_customers", { p_query: query });
export const quickPosCustomer = (payload: Record<string, unknown>) => rpc<PosCustomer>("pos_quick_customer", { p: payload });
export const createPosSale = (payload: Record<string, unknown>) => rpc<SaleResult>("pos_create_sale", { p: payload });
export const createPosReturn = (payload: Record<string, unknown>) => rpc<ReturnResult>("pos_create_return", { p: payload });
export const posCashOperation = (payload: Record<string, unknown>) =>
  rpc<{ batch_id: string; kind: string; amount: number; tax_amount: number; expected_cash: number; existing: boolean }>("pos_cash_operation", { p: payload });
export const loadSessionReport = (sessionId: string) => rpc<SessionReport>("pos_session_report", { p_session: sessionId });
export const closePosSession = (sessionId: string, payload: Record<string, unknown>) => rpc<SessionReport>("pos_close_session", { p_session: sessionId, p: payload });
export const listPosSessions = (filters: Record<string, unknown>) => rpc<PosSession[]>("pos_list_sessions", { p: filters });
export const loadPosReceipt = (invoiceId: string) => rpc<PosReceipt>("pos_receipt", { p_invoice: invoiceId });

/** يُنشأ مرة لكل طلب ويُعاد مع إعادة المحاولة (لا يتكرر البيع إن انقطع الاتصال بعد الحفظ) */
export const newRequestId = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));


/*
 * محاولة العملية محفوظة في المتصفح (المعرّف والبيانات) من قبل إرسالها حتى تُعرف نتيجتها، لكل طلب بيع ونوع عملية نقد وفاتورة مرتجع.
 * - تُمحى عند النجاح، أو عند خطأ من الخادم (العملية لم تُنفَّذ).
 * - تبقى إن انقطع الاتصال (لا يُعرف إن نُفّذت)، ولو أُعيد تحميل الصفحة: تُعاد هي نفسها بمعرّفها وبياناتها،
 *   فإن كانت قد سُجّلت يعيد الخادم نتيجتها (existing) ولا تتكرر، وإلا تُنفَّذ الآن. وحتى ذلك تُقفل بياناتها في الشاشة.
 */
export type PendingRequest = { id: string; payload: Record<string, unknown> };
const requestKey = (scope: string) => companyStorageKey(`pos-req-${scope}`);
const isSessionRequestKey = (key: string, sessionId: string) =>
  key.startsWith("pos-req-") && key.endsWith(companyStorageKey("")) && key.includes(sessionId);
const memoryRequests = new Map<string, PendingRequest>();
function readPending(key: string): PendingRequest | null {
  // الذاكرة أولًا: إن تعذرت الكتابة في التخزين فلا تغلبها نسخة قديمة فيه
  const memory = memoryRequests.get(key);
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingRequest>;
    if (typeof value?.id === "string" && value.payload && typeof value.payload === "object" && !Array.isArray(value.payload)) {
      return { id: value.id, payload: value.payload as Record<string, unknown> };
    }
  } catch { /* التخزين غير متاح */ }
  return null;
}
/** محاولة سابقة لم تُعرف نتيجتها */
export const pendingRequest = (scope: string) => readPending(requestKey(scope));
/** يبدأ العملية: المحاولة المعلّقة نفسها إن وُجدت، وإلا محاولة جديدة تُحفظ قبل الإرسال */
export function beginRequest(scope: string, payload: Record<string, unknown>): PendingRequest & { resumed: boolean } {
  const key = requestKey(scope);
  const pending = readPending(key);
  if (pending) return { ...pending, resumed: true };
  const next: PendingRequest = { id: newRequestId(), payload };
  memoryRequests.set(key, next);
  try {
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // تعذرت الكتابة: تُزال أي نسخة قديمة لئلا تُقرأ بدل هذه
    try { localStorage.removeItem(key); } catch { /* الذاكرة فقط */ }
  }
  return { ...next, resumed: false };
}
/** عُرفت النتيجة (نجاح، أو خطأ من الخادم): تُمحى المحاولة */
export function endRequest(scope: string) {
  const key = requestKey(scope);
  memoryRequests.delete(key);
  try { localStorage.removeItem(key); } catch { /* لا شيء */ }
}
/**
 * هل بقيت نتيجة العملية مجهولة؟ المعروف فقط رفضُ الخادم الصريح: حالة 4xx برمز خطأ من القاعدة (SQLSTATE) أو PGRST،
 * فالمعاملة لم تُنفَّذ. كل ما سواه (انقطاع، مهلة، 5xx، صفحة وسيط، رد غير مفهوم) مجهول تبقى معه المحاولة؛
 * والخطأ في هذا الاتجاه آمن: يكلّف إعادة محاولة فقط.
 * resumed: إعادة محاولة معلّقة. الخادم يعيد نتيجة طلب صاحبه المنفّذ قبل فحص الصلاحية، لكن رفض الدخول نفسه
 * (انتهاء الجلسة أو الصلاحية أو القسم) لا يدل على أنها لم تُنفَّذ، فتبقى معلّقة حتى يعود الدخول.
 */
export function outcomeUnknown(result: { error: string | null; status?: number | null; code?: string | null }, resumed = false): boolean {
  const status = typeof result.status === "number" ? result.status : 0;
  const code = String(result.code ?? "").trim();
  if (!(status >= 400 && status < 500 && code)) return true;
  if (resumed) {
    if (status === 401 || status === 403 || code === "42501" || /^PGRST3/.test(code)) return true;
    if (/\b(UNAUTHORIZED|POS_FORBIDDEN|POS_MODULE_NOT_ENABLED|POS_INPUT_INVALID|SUBSCRIPTION_[A-Z_]+|READ_ONLY[A-Z_]*|BILLING_COUNTRY_NOT_READY)\b|permission denied|JWT/i.test(result.error ?? "")) return true;
  }
  return false;
}
/** عدد محاولات الجلسة التي لم تُعرف نتيجتها (في هذا المتصفح) */
export function sessionPendingCount(sessionId: string): number {
  const keys = new Set<string>();
  for (const key of memoryRequests.keys()) if (isSessionRequestKey(key, sessionId)) keys.add(key);
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && isSessionRequestKey(key, sessionId)) keys.add(key);
    }
  } catch { /* لا شيء */ }
  return keys.size;
}
/**
 * آخر جلسة مفتوحة لهذا المستخدم في هذا المتصفح: إن لم تعد هي جلسته (أغلقها مدير الجلسات من مكان آخر)
 * تُمحى طلباتها المعلّقة ومحاولاتها، فلا تبقى في المتصفح.
 */
export function trackMySession(openSessionId: string | null) {
  const userId = readUserSession()?.id;
  if (!userId) return;
  try {
    const key = companyStorageKey(`pos-my-session-${userId}`);
    const previous = localStorage.getItem(key);
    if (previous && previous !== openSessionId) clearOrders(previous);
    if (openSessionId) localStorage.setItem(key, openSessionId);
    else localStorage.removeItem(key);
  } catch { /* التخزين غير متاح */ }
}
/** عند إغلاق الجلسة: معرّفات طلباتها المحفوظة */
export function clearSessionRequests(sessionId: string) {
  for (const key of [...memoryRequests.keys()]) if (isSessionRequestKey(key, sessionId)) memoryRequests.delete(key);
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && isSessionRequestKey(key, sessionId)) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch { /* لا شيء */ }
}

/* ═══════════ الهيئة (المرحلة الثانية) ═══════════ */
const zatcaConfirmKey = (sessionId: string) => companyStorageKey(`pos-zatca-confirmed-${sessionId}`);
/** تأكيد الإرسال الفعلي للهيئة مرة واحدة لكل جلسة */
export const zatcaConfirmedForSession = (sessionId: string) => {
  try { return sessionStorage.getItem(zatcaConfirmKey(sessionId)) === "1"; } catch { return false; }
};
export const confirmZatcaForSession = (sessionId: string) => {
  try { sessionStorage.setItem(zatcaConfirmKey(sessionId), "1"); } catch { /* الذاكرة فقط */ }
};

export type ZatcaSendResult = { ok: boolean; status: string; qrCodeData: string; message: string };
/** إرسال فاتورة أو إشعار للهيئة (دالة الحافة نفسها التي تستخدمها فواتير المبيعات) */
export async function sendToZatca(target: { invoiceId?: string; noteId?: string }): Promise<ZatcaSendResult> {
  const { data, error } = await supabase.functions.invoke("zatca-invoice", {
    body: {
      ...(target.invoiceId ? { invoiceId: target.invoiceId } : { noteId: target.noteId }),
      mode: "production",
      deviceSerial: localStorage.getItem(zatcaDeviceSerialKey()),
      productionConfirmation: "SUBMIT_REAL_ZATCA_INVOICE",
    },
  });
  if (error || data?.error) {
    const context = (error as { context?: Response } | null)?.context;
    const payload = context ? await context.clone().json().catch(() => null) : null;
    return {
      ok: false,
      status: String(payload?.status ?? data?.status ?? "failed"),
      qrCodeData: "",
      message: String(payload?.error ?? data?.error ?? error?.message ?? "تعذر الإرسال للهيئة"),
    };
  }
  return { ok: true, status: String(data?.status ?? "reported"), qrCodeData: String(data?.qrCodeData ?? ""), message: String(data?.message ?? "") };
}

/* ═══════════ رسائل الأخطاء ═══════════ */
const MESSAGES: Record<string, string> = {
  UNAUTHORIZED: "انتهت الجلسة؛ سجّل الدخول من جديد",
  POS_MODULE_NOT_ENABLED: "نقاط البيع جزء من المحاسبة والمالية، والقسم غير مفعّل لمنشأتك",
  POS_FORBIDDEN: "لا تملك صلاحية هذه العملية في نقاط البيع",
  POS_INPUT_INVALID: "قيمة غير صحيحة في أحد الحقول",
  POS_TEXT_TOO_LONG: "نص أطول من المسموح",
  POS_REQUEST_ID_REQUIRED: "أعد المحاولة",
  POS_REQUEST_REUSED: "الطلب سُجّل من قبل بغير هذه البيانات؛ أعد المحاولة",
  POS_ACCOUNT_INVALID: "الحساب غير موجود أو تجميعي أو من نوع غير مناسب",
  POS_ACCOUNT_RESERVED: "حساب الضريبة أو الذمم أو الرواتب في قواعد الترحيل لا يُستخدم هنا",
  POS_ACCOUNT_REQUIRED: "اختر الحساب",
  POS_ACCOUNT_PARENT_MISSING: "حساب «النقد وما يعادله» (111) أو «الأصول المتداولة» (11) غير موجود في شجرة الحسابات أو ليس تجميعيًا",
  POS_ACCOUNT_CODE_EXHAUSTED: "لا رمز متاح لحساب جديد تحت المجموعة؛ راجع شجرة الحسابات",
  POS_ACCOUNT_GROUP_INVALID: "مجموعة حسابات نقاط البيع رُحّل عليها أو صارت حسابًا بنكيًا؛ راجع شجرة الحسابات",
  POS_ADDRESS_INCOMPLETE: "العنوان الوطني ناقص: رقم المبنى (4 أرقام) والشارع والحي والمدينة والرمز البريدي (5 أرقام)",
  POS_CUSTOMER_INVALID: "العميل غير موجود",
  POS_DEVICE_NOT_FOUND: "الجهاز غير موجود",
  POS_DEVICE_NAME_REQUIRED: "اسم الجهاز مطلوب",
  POS_DEVICE_NAME_EXISTS: "اسم الجهاز مستخدم لجهاز آخر",
  POS_DEVICE_TYPE_INVALID: "اختر نوع الجهاز",
  POS_DEVICE_TYPE_LOCKED: "نوع الجهاز لا يتغير بعد فتح جلسات عليه",
  POS_WAREHOUSE_INVALID: "اختر مستودعًا فعالًا",
  POS_BRANCH_INVALID: "أحد الفروع غير موجود",
  POS_USER_INVALID: "أحد المستخدمين ليس عضوًا فعالًا في المنشأة",
  POS_CARD_ACCOUNT_INVALID: "حساب البطاقة حساب بنكي فعال من الحسابات البنكية",
  POS_DEVICE_HAS_OPEN_SESSION: "على الجهاز جلسة مفتوحة؛ أغلقها أولًا",
  POS_DEVICE_HAS_SESSIONS: "للجهاز جلسات سابقة؛ أرشفه بدل الحذف",
  POS_DEVICE_INACTIVE: "الجهاز مؤرشف",
  POS_DEVICE_USER_NOT_ALLOWED: "الجهاز غير مخصص لك",
  POS_DEVICE_BRANCH_NOT_ALLOWED: "الجهاز غير مخصص لفرعك",
  POS_USER_HAS_OPEN_SESSION: "لك جلسة مفتوحة؛ تابع البيع فيها أو أغلقها أولًا",
  POS_DEVICE_IN_USE: "على الصندوق جلسة مفتوحة لمستخدم آخر",
  POS_ACCOUNT_IN_OPEN_SESSION: "الحساب مقفل لأن عليه جلسة نقطة بيع مفتوحة؛ يُرحَّل عليه بعد إغلاقها",
  POS_SESSION_REQUIRED: "افتح جلسة أولًا",
  POS_SESSION_NOT_FOUND: "الجلسة غير موجودة",
  POS_SESSION_CLOSED: "الجلسة مغلقة",
  POS_SESSION_NOT_YOURS: "الجلسة لمستخدم آخر",
  POS_SESSION_NOT_EMPTY: "في الجلسة عمليات؛ أغلقها بدل الحذف",
  POS_SESSION_LEDGER_MISMATCH: "رصيد حساب الجلسة في الدفتر لا يطابق حركاتها؛ يُغلقها من له إدارة الجلسات بتسوية الفرق",
  POS_LINES_REQUIRED: "أضف صنفًا واحدًا على الأقل",
  POS_TOO_MANY_LINES: "200 بند على الأكثر",
  POS_LINE_INVALID: "بند غير صحيح",
  POS_PRODUCT_INVALID: "الصنف غير موجود أو موقوف",
  POS_PRODUCT_VAT_UNSUPPORTED: "نسبة ضريبة الصنف غير 15%؛ يُباع من فواتير المبيعات",
  POS_LINE_QUANTITY_INVALID: "الكمية رقم موجب بثلاث خانات عشرية على الأكثر",
  POS_LINE_PRICE_REQUIRED: "الصنف بلا سعر بيع؛ أدخل السعر (يتطلب صلاحية تغيير السعر) أو حدّده في بطاقة الصنف",
  POS_PRICE_CHANGE_FORBIDDEN: "لا تملك صلاحية تغيير سعر الصنف",
  POS_LINE_AMOUNT_FRACTION: "الكمية × السعر يجب أن يكون بالهللة؛ عدّل الكمية أو السعر",
  POS_LINE_DISCOUNT_INVALID: "خصم البند غير صحيح",
  POS_DISCOUNT_INVALID: "خصم الفاتورة غير صحيح أو أكبر من قيمتها",
  POS_DISCOUNT_FORBIDDEN: "لا تملك صلاحية الخصم",
  POS_DISCOUNT_LIMIT_EXCEEDED: "الخصم أكبر من الحد المسموح لك من سعر البند",
  POS_TOTAL_INVALID: "إجمالي الفاتورة يجب أن يكون أكبر من صفر",
  POS_INVOICE_TYPE_INVALID: "نوع الفاتورة غير صحيح",
  POS_CUSTOMER_VAT_REQUIRED: "الفاتورة الضريبية لعميل مسجل برقمه الضريبي (15 رقمًا يبدأ بالرقم 3)",
  POS_CUSTOMER_CR_REQUIRED: "الفاتورة الضريبية تتطلب السجل التجاري للعميل",
  POS_CUSTOMER_ADDRESS_REQUIRED: "الفاتورة الضريبية بعنوان العميل الوطني؛ أكمله في بطاقة العميل",
  POS_DEFAULT_ADDRESS_REQUIRED: "حدّد العنوان الافتراضي للفاتورة المبسطة في إعدادات نقاط البيع، أو اختر عميلًا عنوانه مكتمل",
  POS_PAYMENT_INVALID: "طريقة دفع أو مبلغ غير صحيح",
  POS_CARD_ACCOUNT_REQUIRED: "البطاقة غير متاحة في هذه الجلسة: لم يُحدَّد حساب بنكي للبطاقة في الجهاز",
  POS_CARD_EXCEEDS_TOTAL: "مبلغ البطاقة أكبر من الإجمالي",
  POS_PAYMENT_INSUFFICIENT: "المدفوع أقل من الإجمالي؛ أكمل الدفع أو اختر «تسوية» لعميل مسمّى",
  POS_ON_ACCOUNT_CUSTOMER_REQUIRED: "التسوية (الباقي على الحساب) لعميل مسمّى؛ اختر العميل أولًا",
  POS_RETURN_INVOICE_NOT_POS: "الفاتورة ليست من نقاط البيع، أو لا تملك الاطلاع عليها",
  POS_RETURN_PERIOD_EXPIRED: "انتهت مدة المرتجع المسموحة في الإعدادات",
  POS_RETURN_REASON_INVALID: "سبب المرتجع لا يقبل الرموز < > &",
  POS_REFUND_METHOD_INVALID: "طريقة الرد غير صحيحة",
  POS_REFUND_METHOD_EXCEEDS_RECEIVED: "المردود أكبر مما قُبض على الفاتورة بالنقد والبطاقة؛ يردّه من له إدارة المرتجع",
  POS_RETURN_INVOICE_HAS_ADJUSTMENTS: "على الفاتورة إشعار تخفيض سعر أو إشعار مدين؛ أصدر المرتجع من المبيعات ← الإشعارات الدائنة",
  POS_RETURN_LINES_REQUIRED: "حدّد كمية بند واحد على الأقل",
  POS_RETURN_LINE_INVALID: "بند المرتجع غير صحيح",
  POS_RETURN_LINE_DUPLICATE: "البند مكرر في المرتجع",
  POS_RETURN_QUANTITY_INVALID: "الكمية المرتجعة غير صحيحة",
  POS_RETURN_QUANTITY_EXCEEDS: "الكمية أكبر من المتبقي القابل للإرجاع من البند",
  POS_RETURN_AMOUNT_FRACTION: "الكمية المرتجعة × السعر يجب أن يكون بالهللة",
  POS_CASH_INSUFFICIENT: "النقد في الجلسة لا يكفي",
  POS_OPERATION_INVALID: "العملية غير صحيحة",
  POS_AMOUNT_INVALID: "المبلغ رقم موجب بخانتين عشريتين على الأكثر",
  POS_RECEIPT_EXCEEDS_BALANCE: "المبلغ أكبر من المستحق على العميل",
  POS_TREASURY_ACCOUNT_INVALID: "اختر صندوقًا أو بنكًا فعالًا من الحسابات البنكية غير حساب الجلسة",
  POS_COUNTED_CASH_INVALID: "النقد المعدود مبلغ بخانتين عشريتين على الأكثر",
  POS_SHORTAGE_ACCOUNT_REQUIRED: "حدّد حساب العجز في إعدادات نقاط البيع",
  POS_SURPLUS_ACCOUNT_REQUIRED: "حدّد حساب الزيادة في إعدادات نقاط البيع",
  POS_HANDOVER_INVALID: "مبلغ التسليم أو حسابه غير صحيح",
  POS_HANDOVER_EXCEEDS_COUNTED: "المسلَّم أكبر من النقد المعدود",
  POS_CUSTOMER_NAME_REQUIRED: "اسم العميل مطلوب (حرفان على الأقل)",
  POS_CUSTOMER_PHONE_INVALID: "رقم الجوال غير صحيح",
  POS_CUSTOMER_EMAIL_INVALID: "البريد الإلكتروني غير صحيح",
  POS_CUSTOMER_VAT_INVALID: "الرقم الضريبي 15 رقمًا يبدأ بالرقم 3",
  POS_CUSTOMER_CR_INVALID: "السجل التجاري من 10 إلى 15 رقمًا",
  POS_CUSTOMER_ADDRESS_INVALID: "رقم المبنى 4 أرقام، والرمز البريدي 5 أرقام",
  POS_CUSTOMER_EXISTS: "يوجد عميل بهذا الاسم؛ ابحث عنه واختره",
  POS_PAYMENT_EXCEEDS_BALANCE: "المبلغ أكبر من المتبقي على الفاتورة",
  POS_ENTRY_UNBALANCED: "القيد غير متوازن",
  INVENTORY_ISSUE_INSUFFICIENT_STOCK: "الكمية غير متوفرة في مستودع الجهاز",
  INVENTORY_ISSUE_WAREHOUSE_INVALID: "مستودع الجهاز غير فعال",
  SALES_INVOICE_SYNTHETIC_TEXT: "في بيانات الفاتورة نص يشبه بيانات تجريبية (test أو تجريبي)",
  SALES_INVOICE_INVALID_CHARS: "في بيانات الفاتورة رموز غير مقبولة",
  SALES_INVOICE_ADDRESS_INCOMPLETE: "عنوان المشتري ناقص",
  SALES_INVOICE_TOTALS_DO_NOT_MATCH_LINES: "مجاميع الفاتورة لا تطابق بنودها",
  SALES_INVOICE_RECEIVABLE_ACCOUNT_NOT_FOUND: "حساب الذمم في قيد الفاتورة غير موجود؛ راجع قواعد الترحيل",
  SALES_INVOICE_PRODUCT_INVALID: "صنف غير صحيح في الفاتورة",
  SALES_INVOICE_STOCK_CUSTOMER_REQUIRED: "صرف المخزون يتطلب عميلًا من قائمة العملاء",
  ZATCA_COMPANY_VAT_REQUIRED: "أدخل الرقم الضريبي للمنشأة في الإعدادات قبل إصدار الفواتير",
  BILLING_COUNTRY_NOT_READY: "الفوترة لدولة منشأتك تُفعَّل في تحديث قادم",
  ACCOUNTING_FISCAL_PERIOD_CLOSED: "الفترة المالية لتاريخ اليوم مقفلة",
  ACCOUNTING_FISCAL_PERIOD_REQUIRED: "لا توجد فترة مالية مفتوحة لتاريخ اليوم؛ أنشئها من إعدادات المحاسبة",
  SALES_NOTE_ORIGINAL_NOT_ACCEPTED: "الفاتورة لم تُبلَّغ للهيئة بعد؛ أرسلها أولًا ثم أعد المرتجع",
  SALES_NOTE_ORIGINAL_PHASE2_WHILE_PHASE1: "لا يصدر إشعار مرحلة أولى على فاتورة مرحلة ثانية",
  SALES_NOTE_ORIGINAL_BUYER_DATA_INCOMPLETE: "بيانات المشتري في الفاتورة ناقصة",
  SALES_NOTE_PERMISSION_REQUIRED: "لا تملك صلاحية المرتجع",
  SALES_CREDIT_STOCK_PRODUCT_INACTIVE: "الصنف موقوف؛ لا تعود كميته للمخزون (ألغِ «إرجاع للمخزون» للبند)",
  SALES_CREDIT_STOCK_EXCEEDS_ISSUED: "الكمية أكبر مما صُرف من الصنف على الفاتورة",
  SALES_CREDIT_STOCK_WAREHOUSE_INACTIVE: "المستودع الذي صُرف منه الصنف غير فعال",
};

const WITH_DETAIL = new Set([
  "POS_ACCOUNT_INVALID", "POS_ACCOUNT_RESERVED", "POS_INPUT_INVALID", "POS_TEXT_TOO_LONG", "POS_USER_HAS_OPEN_SESSION",
  "POS_DEVICE_IN_USE", "POS_ACCOUNT_IN_OPEN_SESSION", "POS_PAYMENT_INSUFFICIENT", "POS_CASH_INSUFFICIENT",
  "POS_RECEIPT_EXCEEDS_BALANCE", "POS_DISCOUNT_LIMIT_EXCEEDED", "POS_RETURN_PERIOD_EXPIRED", "POS_RETURN_QUANTITY_EXCEEDS",
  "POS_PRODUCT_INVALID", "POS_LINE_QUANTITY_INVALID", "POS_LINE_PRICE_REQUIRED", "POS_PRICE_CHANGE_FORBIDDEN",
  "POS_LINE_AMOUNT_FRACTION", "POS_LINE_DISCOUNT_INVALID", "POS_RETURN_LINE_DUPLICATE", "POS_RETURN_AMOUNT_FRACTION",
  "INVENTORY_ISSUE_INSUFFICIENT_STOCK", "POS_SESSION_LEDGER_MISMATCH", "POS_PRODUCT_VAT_UNSUPPORTED", "POS_REFUND_METHOD_EXCEEDS_RECEIVED",
]);

const DETAIL_PREFIX: Record<string, string> = {
  POS_PRODUCT_INVALID: "البند",
  POS_PRODUCT_VAT_UNSUPPORTED: "البند",
  POS_LINE_QUANTITY_INVALID: "البند",
  POS_LINE_PRICE_REQUIRED: "البند",
  POS_PRICE_CHANGE_FORBIDDEN: "البند",
  POS_LINE_AMOUNT_FRACTION: "البند",
  POS_LINE_DISCOUNT_INVALID: "البند",
  POS_RETURN_LINE_DUPLICATE: "البند",
  POS_RETURN_AMOUNT_FRACTION: "البند",
  POS_PAYMENT_INSUFFICIENT: "الباقي",
  POS_CASH_INSUFFICIENT: "النقد المتوقع الآن",
  POS_RECEIPT_EXCEEDS_BALANCE: "المستحق",
  POS_DISCOUNT_LIMIT_EXCEEDED: "الحد %",
  POS_RETURN_PERIOD_EXPIRED: "المدة بالأيام",
  POS_USER_HAS_OPEN_SESSION: "الجلسة",
  POS_DEVICE_IN_USE: "المستخدم",
  POS_ACCOUNT_IN_OPEN_SESSION: "الجلسة",
};

/** رسالة عربية من خطأ الخادم (مع التفصيل المفيد: رقم البند، والمبلغ، والجلسة) */
/** رقم مستند (1001-POS-000001) معزولًا باتجاه اليسار لئلا تنقلب أجزاؤه في النص العربي */
const ltrCode = (value: string) => (/^[0-9A-Za-z]+(?:-[0-9A-Za-z]+)+$/.test(value) ? isoLtr(value) : value);

export function posErrorText(message: string, t: (value: string) => string = (v) => v): string {
  const text = String(message ?? "");
  const match = text.match(/\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b(?::\s*([^\n]*))?/);
  if (match && MESSAGES[match[1]]) {
    const code = match[1];
    let detail = (match[2] ?? "").trim();
    if (code === "INVENTORY_ISSUE_INSUFFICIENT_STOCK") {
      const available = detail.match(/available=([0-9.]+)/)?.[1];
      const product = detail.match(/product=([^,]+)/)?.[1];
      detail = [product ? ltrCode(product.trim()) : "", available !== undefined ? `${t("المتوفر")} ${Number(available)}` : ""].filter(Boolean).join(" — ");
    } else if (code === "POS_RETURN_QUANTITY_EXCEEDS") {
      const [line, available] = detail.split(",").map((part) => part.trim());
      detail = line ? `${t("البند")} ${line}${available !== undefined ? ` — ${t("المتبقي")} ${Number(available)}` : ""}` : "";
    } else if (code === "POS_REFUND_METHOD_EXCEEDS_RECEIVED") {
      const available = detail.split(",").map((part) => part.trim())[1];
      detail = available !== undefined ? `${t("المقبوض")} ${Number(available)}` : "";
    } else if (code === "POS_SESSION_LEDGER_MISMATCH") {
      const [expected, ledger] = detail.split(",").map((part) => part.trim());
      detail = expected ? `${t("المتوقع")} ${expected} — ${t("الدفتر")} ${ledger ?? ""}` : "";
    } else if (detail && DETAIL_PREFIX[code]) {
      detail = `${t(DETAIL_PREFIX[code])} ${ltrCode(detail)}`;
    }
    return WITH_DETAIL.has(code) && detail ? `${t(MESSAGES[code])}: ${detail}` : t(MESSAGES[code]);
  }
  return t(dbErrorOr(text));
}

/** وقت محلي قصير للعرض */
export const formatTime = (value: string | null | undefined, formatDate: (v: Date | string | number, o?: Intl.DateTimeFormatOptions) => string) =>
  value ? formatDate(value, { dateStyle: "medium", timeStyle: "short" }) : "—";
