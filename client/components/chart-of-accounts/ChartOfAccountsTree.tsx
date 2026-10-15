import { Search, ChevronDown, ChevronLeft, ChevronRight, Info } from "lucide-react";
import { useEffect, useState, useMemo } from "react";
import type { AccountNode } from "./accountData";
import { CATEGORY_COLORS } from "./accountData";
import AccountActionsMenu from "./AccountActionsMenu";
import AccountEditPanel from "./AccountEditPanel";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/i18n";

const getAccountDisplayName = (account: AccountNode, locale: "ar" | "en") =>
  locale === "en" ? account.nameEn || account.nameAr : account.nameAr;

type SalesPostingRule = {
  receivableAccountCode: string;
  revenueAccountCode: string;
  outputVatAccountCode: string;
};

const DEFAULT_SALES_RULE: SalesPostingRule = {
  receivableAccountCode: "112",
  revenueAccountCode: "411",
  outputVatAccountCode: "219",
};

export default function ChartOfAccountsTree() {
  const { t, locale, direction } = useI18n();
  const [accounts, setAccounts] = useState<AccountNode[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingAccount, setEditingAccount] = useState<AccountNode | null>(null);
  const [collapsedCodes, setCollapsedCodes] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<"tree" | "list">("tree");
  const [hoveredSystem, setHoveredSystem] = useState<string | null>(null);
  const [salesPostingRule, setSalesPostingRule] = useState<SalesPostingRule>(DEFAULT_SALES_RULE);

  useEffect(() => {
    const loadAccounts = async () => {
      const { data, error } = await supabase
        .from("accounting_accounts")
        .select("*")
        .order("code");

      if (error) {
        toast({ title: t("تعذر تحميل الحسابات"), description: error.message, variant: "destructive" });
        return;
      }

      if (data?.length) {
        setAccounts(data.map((row) => ({
          code: row.code,
          nameAr: row.name_ar,
          nameEn: row.name_en,
          cashFlowType: row.cash_flow_type,
          enablePayments: row.enable_payments,
          showExpenseClaims: row.show_expense_claims,
          accountType: row.account_type,
          level: row.level,
          isMainCategory: row.is_main_category,
          categoryColor: row.category_color ?? undefined,
          currencyBadge: row.currency_badge ?? undefined,
          isSystem: row.is_system,
          parentCode: row.parent_code ?? "",
        })));
      }

      const { data: rule } = await supabase
        .from("accounting_posting_rules")
        .select("receivable_account_code, revenue_account_code, output_vat_account_code")
        .eq("rule_code", "sales_default")
        .maybeSingle();
      if (rule) {
        setSalesPostingRule({
          receivableAccountCode: String(rule.receivable_account_code),
          revenueAccountCode: String(rule.revenue_account_code),
          outputVatAccountCode: String(rule.output_vat_account_code),
        });
      }
    };

    void loadAccounts();
  }, []);

  const saveSalesPostingRule = async () => {
    const { error } = await supabase.rpc("save_sales_accounting_posting_rule", {
      p_receivable_account_code: salesPostingRule.receivableAccountCode,
      p_revenue_account_code: salesPostingRule.revenueAccountCode,
      p_output_vat_account_code: salesPostingRule.outputVatAccountCode,
    });

    if (error) {
      toast({ title: t("تعذر حفظ قواعد الترحيل"), description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: t("تم حفظ قواعد الترحيل"), description: t("ستُستخدم الحسابات المحددة في الفواتير والإشعارات الجديدة") });
  };

  const hasChildren = (code: string) =>
    accounts.some((a) => a.parentCode === code);

  const toggleCollapse = (code: string) => {
    setCollapsedCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
  };

  const isHidden = (account: AccountNode): boolean => {
    if (!account.parentCode) return false;
    if (collapsedCodes.has(account.parentCode)) return true;
    const parent = accounts.find((a) => a.code === account.parentCode);
    return parent ? isHidden(parent) : false;
  };

  const filteredAccounts = useMemo(() => {
    if (!searchQuery.trim()) return accounts;
    const q = searchQuery.trim().toLowerCase();
    return accounts.filter(
      (a) =>
        a.code.includes(q) ||
        a.nameAr.includes(q) ||
        a.nameEn.toLowerCase().includes(q)
    );
  }, [accounts, searchQuery]);

  const visibleAccounts = useMemo(() => {
    if (searchQuery.trim()) return filteredAccounts;
    return filteredAccounts.filter((a) => !isHidden(a));
  }, [filteredAccounts, searchQuery, collapsedCodes]);

  const getCategoryColor = (account: AccountNode) => {
    if (account.categoryColor) {
      return CATEGORY_COLORS[account.categoryColor];
    }
    return null;
  };

  const getMainCategoryForAccount = (account: AccountNode): AccountNode | undefined => {
    if (account.level === 0) return account;
    const rootCode = account.code.charAt(0);
    return accounts.find((a) => a.code === rootCode && a.level === 0);
  };

  const handleSaveAccount = async (updated: AccountNode) => {
    if (!updated.nameAr.trim()) {
      toast({ title: t("اسم الحساب مطلوب"), variant: "destructive" });
      return;
    }
    const { data, error } = await supabase.rpc("save_accounting_account", {
      p_account: updated,
    });

    if (error || !data) {
      toast({ title: t("تعذر حفظ الحساب"), description: error?.message ?? t("حاول مرة أخرى"), variant: "destructive" });
      return;
    }

    const row = data as Record<string, unknown>;
    const saved: AccountNode = {
      code: String(row.code), nameAr: String(row.name_ar), nameEn: String(row.name_en ?? ""),
      cashFlowType: String(row.cash_flow_type ?? ""), enablePayments: Boolean(row.enable_payments),
      showExpenseClaims: Boolean(row.show_expense_claims), accountType: String(row.account_type ?? ""),
      level: Number(row.level), isMainCategory: Boolean(row.is_main_category),
      categoryColor: row.category_color ? String(row.category_color) : undefined,
      currencyBadge: row.currency_badge ? String(row.currency_badge) : undefined,
      isSystem: Boolean(row.is_system), parentCode: String(row.parent_code ?? ""),
    };
    setAccounts((prev) => prev.some((account) => account.code === saved.code)
      ? prev.map((account) => account.code === saved.code ? saved : account)
      : [...prev, saved].sort((first, second) => first.code.localeCompare(second.code, undefined, { numeric: true })));
    setEditingAccount(null);
    toast({ title: t("تم الحفظ"), description: t("تم تحديث بيانات الحساب وربطه بقاعدة البيانات") });
  };

  const handleDeleteAccount = async (code: string) => {
    const account = accounts.find((a) => a.code === code);
    if (!account) return;

    if (account.isSystem) {
      toast({
        title: t("لا يمكن الحذف"),
        description: t("هذا الحساب مقيد ولا يمكن حذفه لأنه حساب نظامي."),
        variant: "destructive",
      });
      return;
    }

    const childrenExist = accounts.some((a) => a.parentCode === code);
    if (childrenExist) {
      toast({
        title: t("لا يمكن الحذف"),
        description: t("يجب حذف الحسابات الفرعية أولاً."),
        variant: "destructive",
      });
      return;
    }

    const { error } = await supabase.rpc("delete_accounting_account", { p_code: code });
    if (error) {
      toast({ title: t("تعذر حذف الحساب"), description: error.message, variant: "destructive" });
      return;
    }

    setAccounts((prev) => prev.filter((a) => a.code !== code));
    toast({ title: t("تم الحذف"), description: t("تم حذف الحساب من قاعدة البيانات") });
  };

  const handleAddSubAccount = (parentCode: string, isBank = false) => {
    const parent = accounts.find((a) => a.code === parentCode);
    if (!parent) return;

    const siblings = accounts.filter((a) => a.parentCode === parentCode);
    let newCode: string;
    if (siblings.length === 0) {
      newCode = parentCode + "1";
    } else {
      const lastSibling = siblings[siblings.length - 1];
      const lastDigit = parseInt(lastSibling.code.slice(parentCode.length)) || 0;
      newCode = parentCode + String(lastDigit + 1);
    }

    const mainCat = getMainCategoryForAccount(parent);

    const newAccount: AccountNode = {
      code: newCode,
      nameAr: isBank ? "حساب بنكي جديد" : "حساب فرعي جديد",
      nameEn: isBank ? "New Bank Account" : "New Sub Account",
      cashFlowType: parent.cashFlowType || "التشغيليات",
      enablePayments: isBank,
      showExpenseClaims: false,
      accountType: parent.accountType || "التشغيليات",
      level: parent.level + 1,
      currencyBadge: isBank ? "SAR" : undefined,
      isSystem: false,
      parentCode: parentCode,
    };

    // Expand parent
    setCollapsedCodes((prev) => {
      const next = new Set(prev);
      next.delete(parentCode);
      return next;
    });

    setEditingAccount(newAccount);
    toast({
      title: t("حساب جديد"),
      description: t("أكمل البيانات ثم اضغط حفظ لإضافة الحساب إلى الشجرة"),
    });
  };

  return (
    <div className="space-y-4" dir={direction}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {/* Tabs */}
          <div className="flex rounded-lg border border-border bg-muted/30 p-0.5">
            <button
              onClick={() => setActiveTab("list")}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                activeTab === "list"
                  ? "bg-white text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("الحسابات")}
            </button>
            <button
              onClick={() => setActiveTab("tree")}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                activeTab === "tree"
                  ? "bg-white text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("شجرة الحسابات")}
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative w-full max-w-xs">
          <Search className="absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("بحث...")}
            className="w-full rounded-lg border border-border bg-background ps-9 pe-3 py-2 text-sm text-start"
            dir={direction}
          />
        </div>
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4" dir={direction}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-foreground">{t("قواعد ترحيل فواتير المبيعات")}</h3>
            <p className="text-xs text-muted-foreground">{t("تحدد الحسابات الافتراضية للقيد: مدين ذمم العملاء، ودائن الإيراد وضريبة المخرجات.")}</p>
          </div>
          <button
            onClick={saveSalesPostingRule}
            className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
          >
            {t("حفظ قواعد الترحيل")}
          </button>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <PostingAccountSelect
            label={t("حساب ذمم العملاء (مدين)")}
            value={salesPostingRule.receivableAccountCode}
            accounts={accounts.filter((account) => account.code.startsWith("1") && !accounts.some((child) => child.parentCode === account.code))}
            onChange={(value) => setSalesPostingRule((rule) => ({ ...rule, receivableAccountCode: value }))}
          />
          <PostingAccountSelect
            label={t("حساب إيرادات المبيعات (دائن)")}
            value={salesPostingRule.revenueAccountCode}
            accounts={accounts.filter((account) => account.code.startsWith("4") && !accounts.some((child) => child.parentCode === account.code))}
            onChange={(value) => setSalesPostingRule((rule) => ({ ...rule, revenueAccountCode: value }))}
          />
          <PostingAccountSelect
            label={t("حساب ضريبة المخرجات (دائن)")}
            value={salesPostingRule.outputVatAccountCode}
            accounts={accounts.filter((account) => account.code.startsWith("2") && !accounts.some((child) => child.parentCode === account.code))}
            onChange={(value) => setSalesPostingRule((rule) => ({ ...rule, outputVatAccountCode: value }))}
          />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm" dir={direction}>
            <thead>
              <tr className="bg-slate-50 border-b border-border">
                <th className="px-3 py-2.5 text-start font-medium text-muted-foreground w-[120px]">
                  {t("رقم الحساب")}
                </th>
                <th className="px-3 py-2.5 text-start font-medium text-muted-foreground">
                  {t("اسم الحساب")}
                </th>
                <th className="px-3 py-2.5 text-start font-medium text-muted-foreground w-[140px]">
                  {t("نوع التدفق النقدي")}
                </th>
                <th className="px-3 py-2.5 text-start font-medium text-muted-foreground w-[140px]">
                  {t("تفعيل عمليات الدفع")}
                </th>
                <th className="px-3 py-2.5 text-start font-medium text-muted-foreground w-[160px]">
                  {t("إظهار في مطالبات المصروف")}
                </th>
                <th className="px-3 py-2.5 text-start font-medium text-muted-foreground w-[120px]">
                  {t("نوع الحساب")}
                </th>
                <th className="w-[50px]" />
              </tr>
            </thead>
            <tbody>
              {visibleAccounts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-sm text-muted-foreground">
                    {t("لا توجد نتائج")}
                  </td>
                </tr>
              ) : visibleAccounts.map((account) => {
                const catColor = getCategoryColor(account);
                const isMainRow = account.isMainCategory;
                const hasKids = hasChildren(account.code);
                const isCollapsed = collapsedCodes.has(account.code);

                if (isMainRow) {
                  return (
                    <MainCategoryRow
                      key={account.code}
                      account={account}
                      catColor={catColor}
                      hasKids={hasKids}
                      isCollapsed={isCollapsed}
                      onToggle={() => toggleCollapse(account.code)}
                      onEdit={() => setEditingAccount(account)}
                      onDelete={() => handleDeleteAccount(account.code)}
                      onAddSub={() => handleAddSubAccount(account.code)}
                      onAddBank={() => handleAddSubAccount(account.code, true)}
                      hoveredSystem={hoveredSystem}
                      setHoveredSystem={setHoveredSystem}
                    />
                  );
                }

                return (
                  <AccountRow
                    key={account.code}
                    account={account}
                    hasKids={hasKids}
                    isCollapsed={isCollapsed}
                    onToggle={() => toggleCollapse(account.code)}
                    onEdit={() => setEditingAccount(account)}
                    onDelete={() => handleDeleteAccount(account.code)}
                    onAddSub={() => handleAddSubAccount(account.code)}
                    onAddBank={() => handleAddSubAccount(account.code, true)}
                    hoveredSystem={hoveredSystem}
                    setHoveredSystem={setHoveredSystem}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Panel */}
      {editingAccount && (
        <AccountEditPanel
          account={editingAccount}
          allAccounts={accounts}
          onClose={() => setEditingAccount(null)}
          onSave={handleSaveAccount}
        />
      )}
    </div>
  );
}

function PostingAccountSelect({
  label,
  value,
  accounts,
  onChange,
}: {
  label: string;
  value: string;
  accounts: AccountNode[];
  onChange: (value: string) => void;
}) {
  const { direction, locale } = useI18n();

  return (
    <label className="space-y-1 text-xs font-medium text-foreground" dir={direction}>
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-border bg-white px-3 text-sm"
        dir={direction}
      >
        {accounts.map((account) => (
          <option key={account.code} value={account.code}>
            {account.code} — {getAccountDisplayName(account, locale)}
          </option>
        ))}
      </select>
    </label>
  );
}

/* ===== Main Category Row (level 0 colored bar) ===== */
function MainCategoryRow({
  account,
  catColor,
  hasKids,
  isCollapsed,
  onToggle,
  onEdit,
  onDelete,
  onAddSub,
  onAddBank,
  hoveredSystem,
  setHoveredSystem,
}: {
  account: AccountNode;
  catColor: { bg: string; text: string; border: string } | null;
  hasKids: boolean;
  isCollapsed: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddSub: () => void;
  onAddBank: () => void;
  hoveredSystem: string | null;
  setHoveredSystem: (v: string | null) => void;
}) {
  const { t, locale, direction } = useI18n();
  const CollapseIcon = direction === "rtl" ? ChevronLeft : ChevronRight;
  const bgClass = catColor
    ? `${catColor.bg}/10`
    : "bg-slate-100";

  return (
    <tr className={`border-b border-border ${bgClass} font-semibold`}>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          {hasKids && (
            <button
              onClick={onToggle}
              className="text-muted-foreground hover:text-foreground"
              aria-label={isCollapsed ? t("توسيع الحساب") : t("طي الحساب")}
              title={isCollapsed ? t("توسيع الحساب") : t("طي الحساب")}
            >
              {isCollapsed ? (
                <CollapseIcon className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
          )}
          <span className="text-foreground">{account.code}</span>
        </div>
      </td>
      <td className="px-3 py-2.5" colSpan={5}>
        <div className="flex items-center gap-2">
          {catColor && (
            <span
              className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-bold ${catColor.bg} ${catColor.text}`}
            >
              {getAccountDisplayName(account, locale)}
            </span>
          )}
          {!catColor && <span className="text-foreground">{getAccountDisplayName(account, locale)}</span>}

          {account.isSystem && (
            <div className="relative">
              <button
                onMouseEnter={() => setHoveredSystem(account.code)}
                onMouseLeave={() => setHoveredSystem(null)}
                className="text-muted-foreground"
                aria-label={t("معلومات الحساب")}
                title={t("معلومات الحساب")}
              >
                <Info className="h-3.5 w-3.5" />
              </button>
              {hoveredSystem === account.code && (
                <div className="absolute z-50 top-full start-0 mt-1 w-64 rounded-lg border border-border bg-slate-800 text-white p-3 text-xs leading-relaxed shadow-lg">
                  {t("هذا الحساب مقيد ولا يمكن حذفه لأنه حساب نظامي تم إنشاؤه لمساعدتك على تنظيم حساباتك وربطها بالتقارير المناسبة.")}
                </div>
              )}
            </div>
          )}
        </div>
      </td>
      <td className="px-2 py-2.5">
        <AccountActionsMenu
          account={account}
          onEdit={onEdit}
          onDelete={onDelete}
          onAddSubAccount={onAddSub}
          onAddBankSubAccount={onAddBank}
        />
      </td>
    </tr>
  );
}

/* ===== Regular Account Row ===== */
function AccountRow({
  account,
  hasKids,
  isCollapsed,
  onToggle,
  onEdit,
  onDelete,
  onAddSub,
  onAddBank,
  hoveredSystem,
  setHoveredSystem,
}: {
  account: AccountNode;
  hasKids: boolean;
  isCollapsed: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddSub: () => void;
  onAddBank: () => void;
  hoveredSystem: string | null;
  setHoveredSystem: (v: string | null) => void;
}) {
  const { t, locale, direction } = useI18n();
  const CollapseIcon = direction === "rtl" ? ChevronLeft : ChevronRight;
  const indent = account.level * 20;

  return (
    <tr className="border-b border-border bg-white hover:bg-slate-50/60 transition">
      {/* رقم الحساب */}
      <td className="px-3 py-2.5">
        <span className="text-foreground">{account.code}</span>
      </td>

      {/* اسم الحساب */}
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2" style={{ paddingInlineStart: `${indent}px` }}>
          {hasKids && (
            <button
              onClick={onToggle}
              className="text-muted-foreground hover:text-foreground shrink-0"
              aria-label={isCollapsed ? t("توسيع الحساب") : t("طي الحساب")}
              title={isCollapsed ? t("توسيع الحساب") : t("طي الحساب")}
            >
              {isCollapsed ? (
                <CollapseIcon className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
          )}
          <span className="text-foreground">{getAccountDisplayName(account, locale)}</span>

          {account.currencyBadge && (
            <span className="inline-flex items-center rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-bold text-green-700 border border-green-200">
              {account.currencyBadge}
            </span>
          )}

          {account.isSystem && (
            <div className="relative">
              <button
                onMouseEnter={() => setHoveredSystem(account.code)}
                onMouseLeave={() => setHoveredSystem(null)}
                className="text-muted-foreground"
                aria-label={t("معلومات الحساب")}
                title={t("معلومات الحساب")}
              >
                <Info className="h-3.5 w-3.5" />
              </button>
              {hoveredSystem === account.code && (
                <div className="absolute z-50 top-full start-0 mt-1 w-64 rounded-lg border border-border bg-slate-800 text-white p-3 text-xs leading-relaxed shadow-lg">
                  {t("هذا الحساب مقيد ولا يمكن حذفه لأنه حساب نظامي تم إنشاؤه لمساعدتك على تنظيم حساباتك وربطها بالتقارير المناسبة.")}
                </div>
              )}
            </div>
          )}
        </div>
      </td>

      {/* نوع التدفق النقدي */}
      <td className="px-3 py-2.5 text-muted-foreground">
        {account.cashFlowType ? t(account.cashFlowType) : "—"}
      </td>

      {/* تفعيل عمليات الدفع */}
      <td className="px-3 py-2.5 text-muted-foreground">
        {account.enablePayments ? t("نعم") : "—"}
      </td>

      {/* إظهار في مطالبات المصروف */}
      <td className="px-3 py-2.5 text-muted-foreground">
        {account.showExpenseClaims ? t("نعم") : "—"}
      </td>

      {/* نوع الحساب */}
      <td className="px-3 py-2.5 text-muted-foreground">
        {account.accountType ? t(account.accountType) : "—"}
      </td>

      {/* Actions */}
      <td className="px-2 py-2.5">
        <AccountActionsMenu
          account={account}
          onEdit={onEdit}
          onDelete={onDelete}
          onAddSubAccount={onAddSub}
          onAddBankSubAccount={onAddBank}
        />
      </td>
    </tr>
  );
}
