import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Check, Clock3, Crown, GitBranch, Headphones, Landmark, Printer, Receipt, Send, Users } from "lucide-react";
import { toast } from "sonner";
import Layout from "@/components/Layout";
import { UsageMeter } from "@/components/subscription/SubscriptionCard";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { supabase } from "@/lib/supabaseClient";
import { useCompany } from "@/lib/companyContext";
import { ALL_COMPANY_MODULES, COMPANY_MODULE_LABELS } from "@/lib/companyModules";
import {
  INVOICE_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  STATE_LABELS,
  countText,
  daysText,
  formatDay,
  graceDaysLeft,
  formatMoney,
  subscriptionErrorText,
  type PlatformBilling,
  type PlatformInvoice,
  type SubscriptionPlan,
} from "@/lib/subscription";

type Cycle = "monthly" | "yearly";

const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string);

/** طباعة فاتورة اشتراك المنصة (نافذة مستقلة، كل القيم مهرَّبة) */
function printInvoice(invoice: PlatformInvoice) {
  const seller = invoice.seller ?? {};
  const buyer = invoice.buyer ?? {};
  const row = (label: string, value: unknown) =>
    value === null || value === undefined || String(value).trim() === "" ? "" : `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(invoice.number)}</title>
<style>
body{font-family:"IBM Plex Sans Arabic","Segoe UI",Tahoma,sans-serif;color:#0f172a;margin:32px;font-size:13px}
h1{font-size:20px;margin:0 0 4px} .muted{color:#64748b} .grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin:24px 0}
.box{border:1px solid #e2e8f0;border-radius:10px;padding:14px} .box h2{font-size:13px;margin:0 0 8px;color:#334155}
table{width:100%;border-collapse:collapse} th{text-align:right;color:#64748b;font-weight:600;padding:3px 0;width:40%} td{padding:3px 0}
.lines{margin-top:8px} .lines th,.lines td{border-bottom:1px solid #e2e8f0;padding:8px 6px;width:auto} .lines thead th{background:#f8fafc;color:#334155}
.num{text-align:left;font-variant-numeric:tabular-nums} .total td{font-weight:800;font-size:15px}
.status{display:inline-block;border-radius:999px;padding:2px 10px;background:#f1f5f9;font-weight:700}
@media print{body{margin:12mm}}
</style></head><body>
<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px">
<div><h1>مطالبة اشتراك</h1><div class="muted">رقم ${escapeHtml(invoice.number)}، بتاريخ ${escapeHtml(formatDay(invoice.issued_at))}</div></div>
<span class="status">${escapeHtml(INVOICE_STATUS_LABELS[invoice.status] ?? invoice.status)}</span></div>
<div class="grid">
<div class="box"><h2>المورّد</h2><table>${row("الاسم", seller.name_ar)}${row("الرقم الضريبي", seller.vat_number)}${row("السجل التجاري", seller.cr_number)}${row("العنوان", seller.address_ar)}${row("البنك", seller.bank_name)}${row("الآيبان", seller.iban)}</table></div>
<div class="box"><h2>العميل</h2><table>${row("المنشأة", buyer.name_ar)}${row("رقم المنشأة", buyer.code)}${row("الرقم الضريبي", buyer.vat_number)}${row("السجل التجاري", buyer.cr_number)}${row("العنوان", [buyer.address_ar, buyer.city, buyer.region].filter(Boolean).join("، "))}</table></div>
</div>
<table class="lines"><thead><tr><th>الوصف</th><th>الفترة</th><th class="num">المبلغ</th></tr></thead><tbody>
<tr><td>${escapeHtml(invoice.description)}</td><td>${escapeHtml(invoice.period_start ? `${formatDay(invoice.period_start)} – ${formatDay(invoice.period_end)}` : "—")}</td><td class="num">${escapeHtml(formatMoney(invoice.subtotal))}</td></tr>
${Number(invoice.discount) > 0 ? `<tr><td colspan="2">الخصم</td><td class="num">-${escapeHtml(formatMoney(invoice.discount))}</td></tr>` : ""}
<tr><td colspan="2">ضريبة القيمة المضافة (${escapeHtml(invoice.vat_rate)}%)</td><td class="num">${escapeHtml(formatMoney(invoice.vat_amount))}</td></tr>
<tr class="total"><td colspan="2">الإجمالي</td><td class="num">${escapeHtml(formatMoney(invoice.total))}</td></tr>
<tr><td colspan="2">المدفوع</td><td class="num">${escapeHtml(formatMoney(invoice.paid_amount))}</td></tr>
</tbody></table>
<p class="muted" style="margin-top:24px">تاريخ الاستحقاق: ${escapeHtml(formatDay(invoice.due_at))}</p>
<p class="muted" style="margin-top:8px;font-size:12px">هذا المستند مطالبة بقيمة الاشتراك، وليس فاتورة ضريبية إلكترونية.</p>
<script>window.onload=function(){window.print()}</script>
</body></html>`;
  const popup = window.open("", "_blank", "width=900,height=1000");
  if (!popup) {
    toast.error("اسمح للمتصفح بفتح النوافذ المنبثقة لطباعة الفاتورة");
    return;
  }
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
}

function PlanCard({
  plan,
  cycle,
  current,
  requested,
  canManage,
  onRequest,
}: {
  plan: SubscriptionPlan;
  cycle: Cycle;
  current: boolean;
  requested: boolean;
  canManage: boolean;
  onRequest: (plan: SubscriptionPlan) => void;
}) {
  const { t } = useI18n();
  const price = cycle === "yearly" ? plan.price_yearly : plan.price_monthly;
  const saving = Math.max(0, plan.price_monthly * 12 - plan.price_yearly);
  const limits = [
    {
      icon: Users,
      text: plan.max_users === null ? "مستخدمون بلا حد" : countText(plan.max_users, { one: "مستخدم واحد", two: "مستخدمان", few: "مستخدمين", many: "مستخدمًا" }),
    },
    {
      icon: Building2,
      text:
        plan.max_employees === null
          ? "موظفون بلا حد"
          : `حتى ${countText(plan.max_employees, { one: "موظف فعّال واحد", two: "موظفَين فعّالَين", few: "موظفين فعّالين", many: "موظفًا فعّالًا" })}`,
    },
    {
      icon: GitBranch,
      text: plan.max_branches === null ? "فروع بلا حد" : countText(plan.max_branches, { one: "فرع واحد", two: "فرعان", few: "فروع", many: "فرعًا" }),
    },
  ];
  return (
    <div
      className={cn(
        "relative flex flex-col rounded-2xl border bg-white p-5 shadow-sm transition-shadow",
        current ? "border-primary/60 ring-2 ring-primary/15" : "border-border/60 hover:shadow-md",
      )}
    >
      {current ? (
        <span className="absolute -top-3 right-4 rounded-full bg-primary px-3 py-0.5 text-[11.5px] font-bold text-primary-foreground">{t("باقتك الحالية")}</span>
      ) : null}
      <h3 className="text-[17px] font-extrabold text-foreground">{t(plan.name_ar)}</h3>
      {plan.description_ar ? <p className="mt-1 min-h-[40px] text-[12.5px] leading-5 text-muted-foreground">{t(plan.description_ar)}</p> : null}
      <div className="mt-4 flex items-end gap-1.5">
        <span className="text-[28px] font-extrabold leading-none tabular-nums text-foreground">{Number(price).toLocaleString("en-US")}</span>
        <span className="pb-0.5 text-[12.5px] font-semibold text-muted-foreground">
          {t("ر.س")} / {t(cycle === "yearly" ? "سنة" : "شهر")}
        </span>
      </div>
      <p className="mt-1 text-[11.5px] text-muted-foreground">
        {t("غير شامل ضريبة القيمة المضافة")}
        {cycle === "yearly" && saving > 0 ? `، ${t("وتوفّر")} ${saving.toLocaleString("en-US")} ${t("ر.س")}` : ""}
      </p>
      {/* S19: أقسام الباقة */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        {ALL_COMPANY_MODULES.filter((module) => (plan.modules ?? []).includes(module)).map((module) => (
          <span key={module} className="rounded-full border border-primary/20 bg-primary/5 px-2.5 py-0.5 text-[11.5px] font-bold text-primary">
            {t(COMPANY_MODULE_LABELS[module])}
          </span>
        ))}
      </div>
      <ul className="mt-4 space-y-2 border-t border-border/50 pt-4 text-[13px]">
        {limits.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-center gap-2 font-semibold text-foreground">
            <Icon className="h-4 w-4 text-primary" />
            {t(text)}
          </li>
        ))}
        {(plan.features ?? []).map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-muted-foreground">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <span>{t(feature)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-5">
        {canManage ? (
          <button
            type="button"
            data-readonly-exempt
            disabled={requested}
            onClick={() => onRequest(plan)}
            className={cn(
              "w-full rounded-xl px-4 py-2.5 text-sm font-bold transition-colors",
              requested ? "cursor-default bg-emerald-50 text-emerald-700" : current ? "border border-primary/40 text-primary hover:bg-primary/5" : "bg-primary text-primary-foreground hover:bg-primary/90",
            )}
          >
            {requested ? t("طلبك قيد المراجعة") : current ? t("جدّد هذه الباقة") : t("اطلب هذه الباقة")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * S15: صفحة الاشتراك: الحالة والأيام المتبقية، والاستخدام مقابل حدود الباقة، والباقات وطلب الاشتراك،
 * وطريقة الدفع والتواصل، وفواتير المنصة ومدفوعاتها ورصيد المنشأة (لمدير النظام).
 */
export default function Subscription() {
  const { t, direction } = useI18n();
  const company = useCompany();
  const sub = company.subscription;
  const canManage = Boolean(sub?.can_manage);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [plansError, setPlansError] = useState("");
  const [cycle, setCycle] = useState<Cycle>(sub?.billing_cycle === "yearly" ? "yearly" : "monthly");
  const [billing, setBilling] = useState<PlatformBilling | null>(null);
  const [requestPlan, setRequestPlan] = useState<SubscriptionPlan | null>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    void supabase.rpc("list_public_plans").then(({ data, error }) => {
      if (error) setPlansError(subscriptionErrorText(error.message) ?? "تعذر تحميل الباقات");
      else setPlans(Array.isArray(data) ? (data as SubscriptionPlan[]) : []);
    });
  }, []);

  const loadBilling = useCallback(async () => {
    if (!canManage) return;
    const { data, error } = await supabase.rpc("my_platform_billing");
    if (!error && data) setBilling(data as PlatformBilling);
  }, [canManage]);

  useEffect(() => {
    void loadBilling();
  }, [loadBilling]);

  const sendRequest = async () => {
    if (!requestPlan) return;
    setSending(true);
    const { error } = await supabase.rpc("request_subscription", { p: { plan_code: requestPlan.code, billing_cycle: cycle, note: note.trim() } });
    setSending(false);
    if (error) {
      toast.error(t(subscriptionErrorText(error.message) ?? "تعذر إرسال الطلب"));
      return;
    }
    toast.success(t("أُرسل طلبك إلى إدارة المنصة. حوّل المبلغ حسب التعليمات أدناه ليُفعَّل اشتراكك."));
    setRequestPlan(null);
    setNote("");
    await company.refresh();
  };

  const support = sub?.support ?? {};
  const contacts = useMemo(
    () =>
      [
        support.email ? { label: "البريد", value: support.email, href: `mailto:${support.email}` } : null,
        support.phone ? { label: "الهاتف", value: support.phone, href: `tel:${support.phone}` } : null,
        support.whatsapp ? { label: "واتساب", value: support.whatsapp, href: `https://wa.me/${support.whatsapp.replace(/\D/g, "")}` } : null,
      ].filter(Boolean) as Array<{ label: string; value: string; href: string }>,
    [support.email, support.phone, support.whatsapp],
  );

  const endLabel = sub?.state === "trial" || sub?.state === "trial_expired" ? "نهاية الفترة التجريبية" : "نهاية الفترة الحالية";
  const endValue = sub?.state === "trial" || sub?.state === "trial_expired" ? sub?.trial_ends_at : sub?.current_period_end;
  const locked = sub?.access === "read_only";

  return (
    <Layout subMenu={null}>
      <div className="space-y-6" dir={direction}>
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{t("الإعدادات")}</span>
            <span>/</span>
            <span>{t("الاشتراك")}</span>
          </div>
          <h1 className="mt-2 text-3xl font-bold text-foreground">{t("الاشتراك والباقات")}</h1>
        </div>

        {!sub || sub.state === "none" ? (
          <div className="rounded-2xl border border-border/50 bg-white p-6 text-sm text-muted-foreground shadow-sm">
            {t("لا توجد بيانات اشتراك لمنشأتك بعد.")}
          </div>
        ) : (
          <>
            {/* الحالة */}
            <section className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-2xl border border-border/50 bg-white p-5 shadow-sm lg:col-span-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("flex h-9 w-9 items-center justify-center rounded-xl", locked ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700")}>
                    <Crown className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold text-muted-foreground">{t("الباقة")}</p>
                    <p className="text-[17px] font-extrabold text-foreground">{t(sub.plan?.name_ar ?? "—")}</p>
                  </div>
                  <span
                    className={cn(
                      "mr-auto rounded-full px-3 py-1 text-[12px] font-bold",
                      locked ? "bg-rose-100 text-rose-700" : sub.state === "trial" ? "bg-sky-100 text-sky-700" : "bg-emerald-100 text-emerald-700",
                    )}
                  >
                    {t(STATE_LABELS[sub.state])}
                  </span>
                </div>
                <dl className="mt-5 grid gap-4 text-[13px] sm:grid-cols-3">
                  <div>
                    <dt className="text-muted-foreground">{t(endLabel)}</dt>
                    <dd className="mt-1 font-bold text-foreground">{formatDay(endValue)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t("المتبقي")}</dt>
                    <dd className={cn("mt-1 font-bold", locked ? "text-rose-600" : "text-foreground")}>
                      {sub.state === "complimentary"
                        ? t("بلا انتهاء")
                        : locked
                          ? t("انتهى")
                          : sub.state === "grace" || (sub.state === "past_due" && Number(sub.days_left ?? 0) === 0)
                            ? `${t("مهلة")} ${t(daysText(graceDaysLeft(sub)))}`
                            : t(daysText(Number(sub.days_left ?? 0)))}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t("دورة الفوترة")}</dt>
                    <dd className="mt-1 font-bold text-foreground">
                      {sub.state === "trial" || sub.state === "trial_expired" ? t("تجربة مجانية") : t(sub.billing_cycle === "yearly" ? "سنوية" : "شهرية")}
                    </dd>
                  </div>
                </dl>
                {locked ? (
                  <p className="mt-5 rounded-xl bg-rose-50 px-4 py-3 text-[13px] leading-6 text-rose-900">
                    {t("المنشأة الآن للقراءة فقط: بياناتك محفوظة كاملة، ويمكنك استعراضها وطباعتها وتصديرها. الإضافة والتعديل والحذف تعود فور تفعيل الاشتراك.")}
                  </p>
                ) : sub.state === "trial" ? (
                  <p className="mt-5 rounded-xl bg-sky-50 px-4 py-3 text-[13px] leading-6 text-sky-900">
                    {t("كل أقسام النظام متاحة لك خلال الفترة التجريبية. عند انتهائها تصبح المنشأة للقراءة فقط حتى تفعيل الاشتراك، ولا يُحذف شيء من بياناتك.")}
                  </p>
                ) : null}
                {sub.open_request ? (
                  <p className="mt-3 flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-[13px] font-semibold text-emerald-800">
                    <Clock3 className="h-4 w-4 shrink-0" />
                    {t("طلبك قيد المراجعة")}: {t(sub.open_request.plan_name)} ({t(sub.open_request.billing_cycle === "yearly" ? "سنوي" : "شهري")}) — {formatDay(sub.open_request.created_at)}
                  </p>
                ) : null}
              </div>

              <div className="space-y-4 rounded-2xl border border-border/50 bg-white p-5 shadow-sm">
                <p className="text-[13px] font-bold text-foreground">{t("الاستخدام مقابل حدود الباقة")}</p>
                <UsageMeter label="المستخدمون" used={sub.usage?.users ?? 0} limit={sub.plan?.max_users ?? null} icon={Users} />
                <UsageMeter label="الموظفون الفعّالون" used={sub.usage?.employees ?? 0} limit={sub.plan?.max_employees ?? null} icon={Building2} />
                <UsageMeter label="الفروع" used={sub.usage?.branches ?? 0} limit={sub.plan?.max_branches ?? null} icon={GitBranch} />
              </div>
            </section>

            {/* الباقات */}
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-extrabold text-foreground">{t("الباقات")}</h2>
                  <p className="text-[13px] text-muted-foreground">
                    {canManage ? t("اختر الباقة والدورة ثم أرسل الطلب؛ يفعّل فريق المنصة اشتراكك بعد استلام المبلغ.") : t("يطلب الاشتراك مدير النظام في منشأتك.")}
                  </p>
                </div>
                <div role="radiogroup" aria-label={t("دورة الفوترة")} className="inline-flex rounded-xl border border-border/60 bg-white p-1 text-[13px] font-bold">
                  {(["monthly", "yearly"] as Cycle[]).map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={cycle === value}
                      data-readonly-exempt
                      onClick={() => setCycle(value)}
                      className={cn("rounded-lg px-4 py-1.5 transition-colors", cycle === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
                    >
                      {t(value === "monthly" ? "شهري" : "سنوي")}
                    </button>
                  ))}
                </div>
              </div>
              {plansError ? <p className="text-sm text-rose-600">{t(plansError)}</p> : null}
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {plans.map((plan) => (
                  <PlanCard
                    key={plan.code}
                    plan={plan}
                    cycle={cycle}
                    current={sub.plan?.code === plan.code && sub.state !== "trial" && sub.state !== "trial_expired"}
                    requested={sub.open_request?.plan_code === plan.code && sub.open_request?.billing_cycle === cycle}
                    canManage={canManage}
                    onRequest={setRequestPlan}
                  />
                ))}
              </div>

              {requestPlan ? (
                <div className="rounded-2xl border border-primary/30 bg-primary/[0.03] p-5" data-readonly-exempt>
                  <p className="text-[15px] font-extrabold text-foreground">
                    {t("طلب باقة")} {t(requestPlan.name_ar)} — {t(cycle === "yearly" ? "سنوي" : "شهري")}:{" "}
                    {formatMoney(cycle === "yearly" ? requestPlan.price_yearly : requestPlan.price_monthly, sub.currency)}{" "}
                    <span className="text-[12px] font-semibold text-muted-foreground">
                      + {t("ضريبة")} {sub.vat_rate ?? 15}%
                    </span>
                  </p>
                  <label className="mt-3 block text-[13px] font-semibold text-foreground" htmlFor="subscription-note">
                    {t("ملاحظة لفريق المنصة (اختياري)")}
                  </label>
                  <textarea
                    id="subscription-note"
                    value={note}
                    maxLength={500}
                    onChange={(event) => setNote(event.target.value)}
                    rows={2}
                    className="mt-1.5 w-full rounded-xl border border-border/60 bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                    placeholder={t("مثال: حوّلنا المبلغ اليوم من حساب المنشأة")}
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void sendRequest()}
                      disabled={sending}
                      className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                    >
                      <Send className="h-4 w-4" />
                      {sending ? t("جارٍ الإرسال...") : t("أرسل الطلب")}
                    </button>
                    <button type="button" onClick={() => setRequestPlan(null)} className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold hover:bg-muted">
                      {t("إلغاء")}
                    </button>
                  </div>
                </div>
              ) : null}
            </section>

            {/* الدفع والتواصل */}
            <section className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-border/50 bg-white p-5 shadow-sm">
                <p className="flex items-center gap-2 text-[14px] font-extrabold text-foreground">
                  <Landmark className="h-4 w-4 text-primary" />
                  {t("طريقة الدفع")}
                </p>
                <p className="mt-2 whitespace-pre-line text-[13px] leading-7 text-muted-foreground">
                  {sub.payment_instructions ? t(sub.payment_instructions) : t("يطّلع مدير النظام على تعليمات الدفع ورصيد المنشأة.")}
                </p>
                {canManage && billing?.issuer?.iban ? (
                  <dl className="mt-3 grid gap-1 rounded-xl bg-muted/40 px-4 py-3 text-[13px]">
                    {billing.issuer.name_ar ? (
                      <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t("اسم المستفيد")}</dt><dd className="font-semibold">{billing.issuer.name_ar}</dd></div>
                    ) : null}
                    {billing.issuer.bank_name ? (
                      <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t("البنك")}</dt><dd className="font-semibold">{billing.issuer.bank_name}</dd></div>
                    ) : null}
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t("الآيبان")}</dt><dd className="font-mono font-semibold" dir="ltr">{billing.issuer.iban}</dd></div>
                  </dl>
                ) : null}
              </div>
              <div className="rounded-2xl border border-border/50 bg-white p-5 shadow-sm">
                <p className="flex items-center gap-2 text-[14px] font-extrabold text-foreground">
                  <Headphones className="h-4 w-4 text-primary" />
                  {t("الدعم والتفعيل")}
                </p>
                {contacts.length ? (
                  <ul className="mt-3 space-y-2 text-[13px]">
                    {contacts.map((c) => (
                      <li key={c.label} className="flex justify-between gap-3">
                        <span className="text-muted-foreground">{t(c.label)}</span>
                        <a href={c.href} target={c.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className="font-semibold text-primary hover:underline" dir="ltr">
                          {c.value}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-[13px] text-muted-foreground">{t("ستظهر هنا وسائل التواصل مع فريق المنصة.")}</p>
                )}
                {canManage && billing ? (
                  <div className="mt-4 flex items-center justify-between rounded-xl bg-muted/40 px-4 py-3">
                    <span className="text-[13px] font-semibold text-muted-foreground">{t("رصيد منشأتك لدى المنصة")}</span>
                    <span className={cn("text-[16px] font-extrabold tabular-nums", billing.balance > 0 ? "text-rose-600" : "text-emerald-700")}>
                      {formatMoney(billing.balance, sub.currency)}
                    </span>
                  </div>
                ) : null}
                {canManage && billing ? (
                  <p className="mt-1.5 text-[11.5px] text-muted-foreground">{t("موجب: مستحق عليك. سالب: رصيد لك يُخصم من الفواتير القادمة.")}</p>
                ) : null}
              </div>
            </section>

            {/* الفواتير والمدفوعات */}
            {canManage && billing ? (
              <section className="grid gap-4 xl:grid-cols-3">
                <div className="overflow-hidden rounded-2xl border border-border/50 bg-white shadow-sm xl:col-span-2">
                  <p className="flex items-center gap-2 border-b border-border/40 px-5 py-4 text-[14px] font-extrabold text-foreground">
                    <Receipt className="h-4 w-4 text-primary" />
                    {t("مطالبات الاشتراك")}
                  </p>
                  {billing.invoices.length === 0 ? (
                    <p className="px-5 py-6 text-[13px] text-muted-foreground">{t("لا مطالبات بعد. تظهر هنا مطالبة كل اشتراك يُفعَّل لمنشأتك.")}</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[620px] text-[13px]">
                        <thead className="bg-muted/40 text-muted-foreground">
                          <tr>
                            <th className="px-4 py-2.5 text-right font-semibold">{t("الرقم")}</th>
                            <th className="px-4 py-2.5 text-right font-semibold">{t("الوصف")}</th>
                            <th className="px-4 py-2.5 text-right font-semibold">{t("التاريخ")}</th>
                            <th className="px-4 py-2.5 text-left font-semibold">{t("الإجمالي")}</th>
                            <th className="px-4 py-2.5 text-right font-semibold">{t("الحالة")}</th>
                            <th className="px-4 py-2.5" />
                          </tr>
                        </thead>
                        <tbody>
                          {billing.invoices.map((invoice) => (
                            <tr key={invoice.id} className="border-t border-border/40">
                              <td className="px-4 py-2.5 font-mono font-semibold" dir="ltr">{invoice.number}</td>
                              <td className="px-4 py-2.5">{invoice.description}</td>
                              <td className="px-4 py-2.5 text-muted-foreground">{formatDay(invoice.issued_at)}</td>
                              <td className="px-4 py-2.5 text-left font-bold tabular-nums">{formatMoney(invoice.total, sub.currency)}</td>
                              <td className="px-4 py-2.5">
                                <span className={cn("rounded-full px-2.5 py-0.5 text-[11.5px] font-bold", invoice.status === "paid" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>
                                  {t(INVOICE_STATUS_LABELS[invoice.status])}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-left">
                                <button
                                  type="button"
                                  data-readonly-exempt
                                  onClick={() => printInvoice(invoice)}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1.5 text-[12px] font-semibold hover:bg-muted"
                                >
                                  <Printer className="h-3.5 w-3.5" />
                                  {t("طباعة")}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
                <div className="overflow-hidden rounded-2xl border border-border/50 bg-white shadow-sm">
                  <p className="border-b border-border/40 px-5 py-4 text-[14px] font-extrabold text-foreground">{t("المدفوعات والتسويات")}</p>
                  {billing.payments.length === 0 && !(billing.adjustments ?? []).length ? (
                    <p className="px-5 py-6 text-[13px] text-muted-foreground">{t("لا مدفوعات مسجّلة.")}</p>
                  ) : (
                    <ul className="divide-y divide-border/40 text-[13px]">
                      {billing.payments.map((payment) => (
                        <li key={payment.id} className="flex items-center justify-between gap-3 px-5 py-3">
                          <div className="min-w-0">
                            <p className="font-semibold text-foreground">{t(PAYMENT_METHOD_LABELS[payment.method] ?? payment.method)}</p>
                            <p className="text-[12px] text-muted-foreground">
                              {formatDay(payment.received_at)}
                              {payment.invoice_number ? `، ${payment.invoice_number}` : ""}
                            </p>
                          </div>
                          <span className="font-bold tabular-nums text-emerald-700">{formatMoney(payment.amount, sub.currency)}</span>
                        </li>
                      ))}
                      {(billing.adjustments ?? []).map((adjustment) => (
                        <li key={adjustment.id} className="flex items-center justify-between gap-3 px-5 py-3">
                          <div className="min-w-0">
                            <p className="font-semibold text-foreground">{t(adjustment.amount < 0 ? "رصيد لمنشأتك" : "مبلغ مضاف")}</p>
                            <p className="text-[12px] text-muted-foreground">
                              {formatDay(adjustment.created_at)}، {adjustment.reason}
                            </p>
                          </div>
                          <span className={cn("font-bold tabular-nums", adjustment.amount < 0 ? "text-emerald-700" : "text-rose-600")}>
                            {formatMoney(adjustment.amount, sub.currency)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            ) : null}
          </>
        )}
      </div>
    </Layout>
  );
}
