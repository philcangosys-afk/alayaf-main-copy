import { useEffect, useMemo, useState } from "react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown, Loader2, Save, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import type { PermissionLevel, PermissionMap } from "@/lib/authSession";
import AccessSelector from "@/components/permissions/AccessSelector";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { hrRequestErrorText } from "@/lib/hrErrors";

type Permission = { key: string; label: string };
type PermissionGroup = { title: string; permissions: Permission[] };
type ModuleNode = { key: string; label: string; children: Permission[] };
type AccessLevel = "none" | "read" | "manage";

const MODULE_TREE: ModuleNode[] = [
  { key: "module.sales", label: "المبيعات", children: [
    { key: "sales.quotations", label: "عروض الأسعار" }, { key: "sales.orders", label: "أوامر البيع" },
    { key: "sales.invoices", label: "فواتير المبيعات" }, { key: "sales.credit_notes", label: "الإشعارات الدائنة" },
    { key: "sales.delivery_notes", label: "إشعارات التسليم" }, { key: "sales.receipts", label: "سندات القبض والصرف" },
  ] },
  { key: "module.purchases", label: "المشتريات", children: [
    { key: "purchases.invoices", label: "فواتير المشتريات" }, { key: "purchases.cash_expenses", label: "المصروفات النقدية" },
    { key: "purchases.debit_notes", label: "طلبات إشعار دائن من المورد" }, { key: "purchases.credit_notes", label: "الإشعارات الدائنة" },
    { key: "purchases.payments", label: "مدفوعات الموردين" }, { key: "purchases.orders", label: "أوامر الشراء" },
    { key: "purchases.reports", label: "تقارير المشتريات الشاملة" }, { key: "purchases.returns", label: "مرتجعات المشتريات" },
  ] },
  { key: "module.hr", label: "الموارد البشرية", children: [
    { key: "hr.employees", label: "الموظفون" }, { key: "hr.requests", label: "الطلبات" },
    { key: "hr.attendance", label: "الحضور والانصراف" }, { key: "hr.payroll", label: "الرواتب" },
    { key: "hr.reports", label: "تقارير الموارد البشرية" }, { key: "hr.penalties", label: "المساءلات والإنذارات" },
    { key: "hr.leaves", label: "الإجازات" }, { key: "hr.termination", label: "إنهاء الخدمة" },
    { key: "hr.insurance", label: "التأمينات" }, { key: "hr.approvals", label: "الموافقات" },
    { key: "hr.finance_setup", label: "تهيئة المعلومات المالية" }, { key: "hr.succession", label: "التعاقب الوظيفي" },
    { key: "hr.certificates", label: "شهادات الخبرة" }, { key: "hr.org", label: "الهيكل التنظيمي" },
    { key: "hr.permissions", label: "الأدوار والصلاحيات" }, { key: "hr.settings", label: "إعدادات الموارد البشرية" },
  ] },
  { key: "module.crm", label: "العملاء والموردون", children: [
    { key: "crm.customers", label: "العملاء" }, { key: "crm.vendors", label: "الموردون" }, { key: "crm.reports", label: "تقارير العملاء والموردين" },
  ] },
  { key: "module.accounting", label: "المحاسبة والمالية", children: [
    { key: "accounting.accounts", label: "شجرة الحسابات" }, { key: "accounting.reports", label: "التقارير المحاسبية" },
    { key: "accounting.manual_journals", label: "القيود اليدوية" }, { key: "accounting.settings", label: "إعدادات المحاسبة" },
    { key: "accounting.fixed_assets", label: "الأصول الثابتة" }, { key: "accounting.reclassification", label: "إعادة التصنيف" },
    { key: "accounting.tax", label: "حساب الضرائب" }, { key: "accounting.tax_reports", label: "التقارير الضريبية" },
    { key: "accounting.expenses", label: "المصروفات" },
  ] },
  { key: "module.inventory", label: "المستودعات والمخازن", children: [
    { key: "inventory.items", label: "الأصناف" }, { key: "inventory.warehouses", label: "المستودعات" },
    { key: "inventory.movements", label: "حركات المخزون" }, { key: "inventory.reports", label: "تقارير المخزون" },
  ] },
  { key: "module.fleet", label: "الأسطول والسيارات", children: [
    { key: "fleet.vehicles", label: "السيارات والمركبات" }, { key: "fleet.drivers", label: "السائقون" },
    { key: "fleet.maintenance", label: "صيانة المركبات" }, { key: "fleet.insurance", label: "التأمين والفحص" },
    { key: "fleet.trips", label: "سجل الحركة والرحلات" }, { key: "fleet.fuel", label: "الوقود" },
    { key: "fleet.reports", label: "لوحة الأسطول والتقارير" },
  ] },
  { key: "module.users", label: "المستخدمون والصلاحيات", children: [
    { key: "users.list", label: "المستخدمون" }, { key: "users.roles", label: "الأدوار والصلاحيات" }, { key: "users.audit", label: "سجل النشاط" },
  ] },
  { key: "module.ai", label: "الذكاء الاصطناعي", children: [{ key: "ai.assistant", label: "المساعد الذكي" }] },
  { key: "module.settings", label: "الإعدادات", children: [
    { key: "settings.company", label: "إعدادات الشركة" }, { key: "settings.system", label: "إعدادات النظام" }, { key: "settings.integrations", label: "التكاملات" },
  ] },
];

const levelOf = (value: PermissionLevel | undefined): AccessLevel => value === "read" ? "read" : value === true || value === "manage" ? "manage" : "none";


const CRUD_ACTION_LABELS: Record<string, string> = {
  view: "استعراض",
  add: "إضافة",
  edit: "تعديل",
  delete: "حذف",
  export: "تصدير",
};

function translatePermissionLabel(label: string, t: (source: string) => string): string {
  const separatorIndex = label.indexOf("::");
  if (separatorIndex === -1) return t(label);
  const action = label.slice(0, separatorIndex);
  const item = label.slice(separatorIndex + 2);
  const actionLabel = CRUD_ACTION_LABELS[action];
  return actionLabel ? `${t(actionLabel)} ${t(item)}` : t(label);
}

const PERMISSION_GROUPS: Record<string, PermissionGroup[]> = {
  "الوصول للأقسام": [
    {
      title: "الأقسام الرئيسية للنظام",
      permissions: [
        { key: "module.sales", label: "المبيعات" },
        { key: "module.purchases", label: "المشتريات" },
        { key: "module.hr", label: "الموارد البشرية" },
        { key: "module.crm", label: "العملاء والموردين" },
        { key: "module.accounting", label: "المحاسبة والمالية" },
        { key: "module.users", label: "المستخدمين والصلاحيات" },
        { key: "module.ai", label: "الذكاء الاصطناعي" },
        { key: "module.settings", label: "الإعدادات" },
    { key: "module.fleet", label: "الأسطول والسيارات" },
    { key: "module.expenses", label: "المصروفات" },
        { key: "module.inventory", label: "المستودعات والمخازن" },
      ],
    },
    {
      title: "أقسام الموارد البشرية",
      permissions: [
        { key: "hr.employees", label: "الموظفون" },
        { key: "hr.attendance", label: "الحضور والانصراف" },
        { key: "hr.payroll", label: "الرواتب" },
        { key: "hr.leaves", label: "الإجازات" },
        { key: "hr.penalties", label: "المساءلات والإنذارات" },
        { key: "hr.reports", label: "التقارير" },
        { key: "hr.termination", label: "إنهاء الخدمة" },
        { key: "hr.succession", label: "التعاقب الوظيفي" },
        { key: "hr.certificates", label: "شهادات الخبرة" },
        { key: "hr.settings", label: "إعدادات الموارد البشرية" },
        { key: "hr.permissions", label: "الأدوار والصلاحيات" },
        { key: "hr.org", label: "الهيكل التنظيمي" },
      ],
    },
    {
      title: "أقسام المبيعات",
      permissions: [
        { key: "sales.quotations", label: "عروض الأسعار" },
        { key: "sales.orders", label: "أوامر البيع" },
        { key: "sales.invoices", label: "الفواتير" },
        { key: "sales.returns", label: "مرتجعات المبيعات" },
        { key: "sales.reports", label: "تقارير المبيعات" },
      ],
    },
    {
      title: "أقسام المشتريات",
      permissions: [
        { key: "purchases.requests", label: "طلبات الشراء" },
        { key: "purchases.orders", label: "أوامر الشراء" },
        { key: "purchases.invoices", label: "فواتير الموردين" },
        { key: "purchases.debit_notes", label: "طلبات إشعار دائن من المورد" },
        { key: "purchases.credit_notes", label: "الإشعارات الدائنة" },
        { key: "purchases.payments", label: "مدفوعات الموردين" },
        { key: "purchases.receipts", label: "استلام البضاعة" },
        { key: "purchases.returns", label: "مرتجعات المشتريات" },
      ],
    },
  ],
  "البيانات التجارية": [
    {
      title: "صلاحيات عرض المبيعات والمشتريات",
      permissions: [
        { key: "sales.invoices.view_all", label: "عرض جميع فواتير المبيعات" },
        { key: "sales.invoices.view_branch", label: "عرض فواتير مبيعات الفرع" },
        { key: "purchases.invoices.view_all", label: "عرض جميع فواتير المشتريات" },
        { key: "purchases.invoices.view_branch", label: "عرض فواتير مشتريات الفرع" },
      ],
    },
    {
      title: "صلاحيات عرض العملاء والموردين",
      permissions: [
        { key: "crm.customers.view_all", label: "عرض جميع العملاء" },
        { key: "crm.customers.view_branch", label: "عرض عملاء الفرع" },
        { key: "crm.vendors.view_all", label: "عرض جميع الموردين" },
        { key: "crm.vendors.view_branch", label: "عرض موردي الفرع" },
        { key: "audit.creator_columns", label: "عرض منشئ السجلات ومصدر الفواتير" },
        { key: "users.special.manage", label: "إدارة المستخدمين الخاصين" },
      ],
    },
  ],
};

const PERMISSION_TABS = Object.keys(PERMISSION_GROUPS);

export default function HRPermissionsAddRole() {
  const navigate = useNavigate();
  const { t, direction, formatNumber } = useI18n();
  const { roleId } = useParams();
  const isEditing = Boolean(roleId);
  const [activeTab, setActiveTab] = useState(PERMISSION_TABS[0]);
  const [loading, setLoading] = useState(false);
  const [loadingRole, setLoadingRole] = useState(isEditing);
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [status, setStatus] = useState("فعال");
  const [permissions, setPermissions] = useState<PermissionMap>({});
  const [expandedModules, setExpandedModules] = useState<Set<string>>(() => new Set(["module.sales"]));

  useEffect(() => {
    if (!roleId) return;
    let active = true;
    async function loadRole() {
      const { data, error } = await supabase.from("user_roles").select("*").eq("id", roleId).single();
      if (!active) return;
      if (error) {
        toast.error(`${t("تعذر تحميل الدور")}: ${error.message}`);
        navigate("/hr/permissions/roles");
      } else {
        setNameAr(String(data.name_ar ?? ""));
        setNameEn(String(data.name_en ?? ""));
        setStatus(String(data.status ?? "فعال"));
        setPermissions((data.permissions as PermissionMap) ?? {});
      }
      setLoadingRole(false);
    }
    loadRole();
    return () => { active = false; };
  }, [roleId, navigate]);

  const activePermissions = useMemo(
    () => activeTab === "الوصول للأقسام"
      ? MODULE_TREE.flatMap((module) => [{ key: module.key, label: module.label }, ...module.children])
      : PERMISSION_GROUPS[activeTab].flatMap((group) => group.permissions),
    [activeTab],
  );
  const allActiveSelected = activePermissions.length > 0 && activePermissions.every((permission) => levelOf(permissions[permission.key]) === "manage");

  const handlePermissionChange = (key: string, value: boolean) => {
    setPermissions((previous) => ({ ...previous, [key]: value }));
  };

  const setAccessLevel = (node: ModuleNode, key: string, level: AccessLevel, cascade = false) => {
    setPermissions((previous) => {
      const next = { ...previous };
      next[key] = level === "none" ? false : level;
      if (cascade) node.children.forEach((child) => { next[child.key] = level === "none" ? false : level; });
      return next;
    });
  };

  const toggleModule = (key: string) => setExpandedModules((previous) => {
    const next = new Set(previous);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const toggleCurrentTab = (checked: boolean) => {
    setPermissions((previous) => {
      const next = { ...previous };
      activePermissions.forEach((permission) => { next[permission.key] = checked ? "manage" : false; });
      return next;
    });
  };

  const handleSave = async () => {
    if (!nameAr.trim() || !nameEn.trim()) {
      toast.error(t("يجب ملء اسم الدور بالعربية والإنجليزية"));
      return;
    }
    setLoading(true);
    const payload = {
      name_ar: nameAr.trim(),
      name_en: nameEn.trim(),
      status,
      permissions,
      permissions_version: 2,
      updated_at: new Date().toISOString(),
    };
    try {
      const result = isEditing
        ? await supabase.from("user_roles").update(payload).eq("id", roleId!).select("id").single()
        : await supabase.from("user_roles").insert(payload).select("id").single();
      if (result.error) throw result.error;
      toast.success(t(isEditing ? "تم تحديث الدور والصلاحيات" : "تم إضافة الدور والصلاحيات"));
      navigate("/hr/permissions/roles");
    } catch (error) {
      toast.error(`${t("تعذر حفظ الدور")}: ${t(hrRequestErrorText(error, "خطأ غير معروف"))}`);
    } finally {
      setLoading(false);
    }
  };

  if (loadingRole) {
    return <Layout><div className="h-[60vh] flex items-center justify-center" dir={direction}><Loader2 className="h-7 w-7 animate-spin text-[#004e89]" /><span className="mr-3">{t("جاري تحميل الدور...")}</span></div></Layout>;
  }

  return (
    <Layout>
      <div className="p-6 max-w-[1600px] mx-auto space-y-6" dir={direction}>
        <div className="flex flex-wrap justify-between items-center gap-3 bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
          <h2 className="text-xl font-bold text-[#004e89]">{t(isEditing ? "تعديل الدور والصلاحيات" : "إضافة دور جديد")}</h2>
          <div className="flex items-center gap-3">
            <Button onClick={() => navigate("/hr/permissions/roles")} variant="outline" className="px-6"><X className="h-4 w-4 ml-1" /> {t("إلغاء")}</Button>
            <Button onClick={handleSave} disabled={loading} className="bg-[#004e89] hover:bg-[#003865] px-8">
              {loading ? <Loader2 className="h-4 w-4 ml-1 animate-spin" /> : <Save className="h-4 w-4 ml-1" />}
              {loading ? t("جاري الحفظ...") : t("حفظ")}
            </Button>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden p-6 space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2"><Label>{t("الاسم بالعربية")} <span className="text-red-500">*</span></Label><Input value={nameAr} onChange={(event) => setNameAr(event.target.value)} placeholder={t("مثال: مدير الموارد البشرية")} /></div>
            <div className="space-y-2"><Label>{t("الاسم بالإنجليزية")} <span className="text-red-500">*</span></Label><Input value={nameEn} onChange={(event) => setNameEn(event.target.value)} placeholder={t("e.g. HR Manager")} /></div>
            <div className="space-y-2"><Label>{t("حالة الدور")}</Label><select value={status} onChange={(event) => setStatus(event.target.value)} className="h-10 w-full rounded-md border border-gray-300 px-3 text-sm"><option value="فعال">{t("فعال")}</option><option value="غير فعال">{t("غير فعال")}</option></select></div>
          </div>

          <div className="space-y-5">
            <div className="flex gap-2 border-b border-gray-200 pb-2 overflow-x-auto whitespace-nowrap">
              {PERMISSION_TABS.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={tab === "الوصول للأقسام"
                    ? `px-4 py-2 text-sm font-bold rounded-lg transition-colors flex items-center gap-1.5 ${activeTab === tab ? "bg-emerald-600 text-white" : "text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200"}`
                    : cnTab(activeTab === tab)
                  }
                >
                  {tab === "الوصول للأقسام" && <span className="text-base">{t("الأقسام")}</span>}
                  {t(tab)}
                </button>
              ))}
            </div>

            <div className="flex justify-between items-center bg-gray-50 border rounded-lg px-4 py-3">
              <div><p className="font-semibold text-gray-800">{t("صلاحيات")} {t(activeTab)}</p><p className="text-xs text-gray-500">{t("يتم حفظ جميع الخيارات المحددة مع الدور")}</p></div>
              <div className="flex items-center gap-2"><Label htmlFor="selectAll" className="cursor-pointer">{t("اختيار الكل")}</Label><Checkbox id="selectAll" checked={allActiveSelected} onCheckedChange={(value) => toggleCurrentTab(value === true)} /></div>
            </div>

            {activeTab === "الوصول للأقسام" ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                  <strong>{t("قراءة فقط")}:</strong> {t("يسمح بعرض البيانات والبحث والطباعة دون الإضافة أو التعديل أو الحذف")}. <strong>{t("إدارة كاملة")}:</strong> {t("تسمح بجميع العمليات")}.
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  {t("مستوى القسم الفرعي يحسم إن حُدد، وإلا يسري مستوى القسم الرئيسي عليه. مثال: الموارد البشرية «إدارة كاملة» والرواتب «لا وصول» = لا يفتح صفحات الرواتب ولا يعدّلها ولا يعتمدها، ويبقى ما تعرضه تقارير الموارد البشرية لمن له التقارير.")}{" "}
                  {t("لا يمنح أحد دورًا صلاحية أعلى من صلاحياته هو، ولا يُسند لموظف دورًا فوق صلاحياته؛ ذلك لمدير النظام.")}
                </div>
                {MODULE_TREE.map((module) => {
                  const expanded = expandedModules.has(module.key);
                  const moduleLevel = levelOf(permissions[module.key]);
                  return (
                    <div key={module.key} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                      <div className="flex flex-wrap items-center gap-3 bg-gradient-to-l from-emerald-50 to-white p-3">
                        <button type="button" onClick={() => toggleModule(module.key)} className="flex min-w-[220px] flex-1 items-center gap-3 text-right">
                          <ChevronDown className={`h-5 w-5 text-emerald-700 transition-transform ${expanded ? "rotate-180" : ""}`} />
                          <span className="font-bold text-gray-900">{t(module.label)}</span>
                          <span className="rounded-full bg-white px-2 py-0.5 text-xs text-gray-500">{formatNumber(module.children.length)} {t("قسم")}</span>
                        </button>
                        <AccessSelector value={moduleLevel} onChange={(level) => setAccessLevel(module, module.key, level, true)} />
                      </div>
                      {expanded && (
                        <div className="grid grid-cols-1 gap-3 border-t border-emerald-100 bg-gray-50/60 p-4 lg:grid-cols-2">
                          {module.children.map((child) => (
                            <div key={child.key} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-3">
                              <span className="text-sm font-medium text-gray-800">{t(child.label)}</span>
                              <AccessSelector value={levelOf(permissions[child.key] ?? permissions[module.key])} onChange={(level) => setAccessLevel(module, child.key, level)} />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : PERMISSION_GROUPS[activeTab].map((group) => (
              <div key={group.title} className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b font-bold bg-gray-50 text-gray-800">{t(group.title)}</div>
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-0">
                  {group.permissions.map((permission) => (
                    <div key={permission.key} className="flex items-center justify-between border-b border-gray-100 py-3 gap-4">
                      <Label htmlFor={permission.key} className="text-sm cursor-pointer">{translatePermissionLabel(permission.label, t)}</Label>
                      <Checkbox id={permission.key} checked={levelOf(permissions[permission.key]) === "manage"} onCheckedChange={(value) => handlePermissionChange(permission.key, value === true)} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Layout>
  );
}

function cnTab(active: boolean) {
  return `px-4 py-2 text-sm font-medium rounded-lg transition-colors ${active ? "bg-[#004e89] text-white" : "text-gray-600 hover:bg-gray-100"}`;
}
