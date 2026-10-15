import { SAUDI_VAT_NUMBER_PATTERN } from "@/lib/utils";
import Layout from "@/components/Layout";
import CrmReports from "@/components/crm/CrmReports";
import { Plus, Search, RotateCcw, Eye, Pencil, Trash2, Save, X } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { selectAllRows } from "@/lib/ledgerData";
import { normalizePartyName, partyErrorText } from "@/lib/partyErrors";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n";
import { checkPerm } from "@/lib/authSession";
import { useRolePermissions } from "@/hooks/useRolePermissions";

type PartyRow = {
  id: string;
  number: string;
  name: string;
  type: string;
  email: string;
  phone: string;
  openingBalance: string;
  creditLimit: string;
  status: string;
  country: string;
  taxRegistrationMode: "not_registered" | "registered_sa" | "non_resident";
  taxNumber: string;
  commercialRegistration: string;
  city: string;
  street: string;
  buildingNumber: string;
  district: string;
  postalCode: string;
  invoiceRef: string;
  currency: string;
  paymentTerms: string;
  businessType: string;
  licenseNumber: string;
  createdAt: string;
  createdBy: string;
  creatorName: string;
};

type PartyForm = {
  id?: string;
  name: string;
  type: string;
  email: string;
  phone: string;
  openingBalance: string;
  creditLimit: string;
  status: string;
  country: string;
  taxRegistrationMode: "not_registered" | "registered_sa" | "non_resident";
  taxNumber: string;
  commercialRegistration: string;
  city: string;
  street: string;
  buildingNumber: string;
  district: string;
  postalCode: string;
  invoiceRef: string;
  invoiceEmail: string;
  invoicePhone: string;
  currency: string;
  paymentTerms: string;
  businessType: string;
  licenseNumber: string;
};

type ViewModalData = PartyRow | null;

const customers: PartyRow[] = [];
const vendors: PartyRow[] = [];

const mapPartyRow = (row: Record<string, unknown>): PartyRow => ({
  id: String(row.id ?? ""),
  number: String(
    row.customer_number ?? row.vendor_number ?? row.id ?? "",
  ),
  name: String(row.name ?? ""),
  type: String(row.type ?? ""),
  email: String(row.email ?? ""),
  phone: String(row.phone ?? ""),
  openingBalance: String(row.opening_balance ?? row.openingBalance ?? "0.00"),
  creditLimit: String(row.credit_limit ?? row.creditLimit ?? "0.00"),
  status: String(row.status ?? "نشط"),
  country: String(row.country ?? ""),
  taxRegistrationMode:
    row.tax_registration_mode === "registered_sa"
      ? "registered_sa"
      : row.tax_registration_mode === "non_resident"
        ? "non_resident"
        : "not_registered",
  taxNumber: String(row.tax_number ?? ""),
  commercialRegistration: String(row.commercial_registration ?? ""),
  city: String(row.city ?? ""),
  street: String(row.street ?? ""),
  buildingNumber: String(row.building_number ?? ""),
  district: String(row.district ?? ""),
  postalCode: String(row.postal_code ?? ""),
  invoiceRef: String(row.invoice_ref ?? ""),
  currency: String(row.currency ?? "SAR"),
  paymentTerms: String(row.payment_terms ?? ""),
  businessType: String(row.business_type ?? ""),
  licenseNumber: String(row.license_number ?? ""),
  createdAt: String(row.created_at ?? ""),
  createdBy: String(row.created_by ?? ""),
  creatorName: "—",
});


const crmTranslations: Record<string, string> = {
  "العملاء والموردين": "Customers and vendors",
  "العملاء": "Customers",
  "الموردين": "Vendors",
  "التقارير": "Reports",
  "ملخصات وتقارير العملاء والموردين في مكان واحد.": "Customer and vendor summaries and reports in one place.",
  "إدارة بيانات الموردين ومتابعة الحالة المالية.": "Manage vendor data and monitor financial status.",
  "إدارة قاعدة بيانات العملاء ومتابعة الحالة المالية.": "Manage the customer database and monitor financial status.",
  "توليد تقرير جديد": "Generate new report",
  "إضافة مورد جديد": "Add new vendor",
  "إضافة عميل جديد": "Add new customer",
  "رقم المورد": "Vendor number",
  "رقم العميل": "Customer number",
  "نوع المورد": "Vendor type",
  "نوع العميل": "Customer type",
  "ابحث بالاسم أو رقم المورد": "Search by name or vendor number",
  "ابحث بالاسم أو رقم العميل": "Search by name or customer number",
  "مورد محلي": "Local vendor",
  "مورد دولي": "International vendor",
  "مورد خدمات": "Service vendor",
  "شركة": "Company",
  "فرد": "Individual",
  "جهة حكومية": "Government entity",
  "نشط": "Active",
  "غير نشط": "Inactive",
  "تنبيهات": "alerts",
  "تنبيه": "Alert",
  "أدخل الاسم": "Enter a name",
  "رقم ضريبي غير صالح": "Invalid VAT number",
  "الرقم الضريبي السعودي 15 رقمًا يبدأ وينتهي بالرقم 3":
    "The Saudi VAT number has 15 digits and starts and ends with 3",
  "سجل تجاري غير صالح": "Invalid commercial registration",
  "السجل التجاري يجب أن يتكون من 10 إلى 15 رقمًا":
    "The commercial registration must contain 10 to 15 digits",
  "العنوان الوطني غير صالح": "Invalid national address",
  "رقم المبنى 4 أرقام والرمز البريدي 5 أرقام":
    "The building number must be 4 digits and the postal code 5 digits",
  "تم التحديث": "Updated",
  "تم تحديث بيانات المورد": "Vendor data updated",
  "تم تحديث بيانات العميل": "Customer data updated",
  "فشل التحديث": "Update failed",
  "تعذر الاتصال بقاعدة البيانات": "Unable to connect to the database",
  "تعذر تحديث البيانات": "Unable to update data",
  "تم الحفظ": "Saved",
  "تمت إضافة المورد": "Vendor added",
  "تمت إضافة العميل": "Customer added",
  "فشل الحفظ": "Save failed",
  "تعذر الاتصال بقاعدة البيانات، تحقق من الاتصال": "Unable to connect to the database; check the connection",
  "تعذر حفظ البيانات": "Unable to save data",
  "هل متأكد من حذف المورد؟": "Are you sure you want to delete the vendor?",
  "هل متأكد من حذف العميل؟": "Are you sure you want to delete the customer?",
  "تم الحذف": "Deleted",
  "تم حذف المورد": "Vendor deleted",
  "تم حذف العميل": "Customer deleted",
  "تم تعطيل العميل": "Customer deactivated",
  "لا يمكن حذف عميل مرتبط بفواتير، لذلك تم تحويله إلى غير نشط":
    "A customer linked to invoices cannot be deleted, so it was marked inactive",
  "فشل الحذف": "Delete failed",
  "تعذر حذف البيانات": "Unable to delete data",
  "تعديل بيانات المورد": "Edit vendor data",
  "تعديل بيانات العميل": "Edit customer data",
  "المنشأة والتسجيل الضريبي مطلوب": "Establishment and tax registration are required",
  "اسم المورد": "Vendor name",
  "اسم العميل": "Customer name",
  "اسم المنشأة *": "Establishment name *",
  "اختياري": "Optional",
  "المملكة العربية السعودية": "Saudi Arabia",
  "الإمارات العربية المتحدة": "United Arab Emirates",
  "قطر": "Qatar",
  "الكويت": "Kuwait",
  "البلد": "Country",
  "غير مسجل في ضريبة القيمة المضافة": "Not registered for VAT",
  "جهة اتصال مسجلة في ضريبة القيمة المضافة في السعودية": "Contact registered for VAT in Saudi Arabia",
  "التسجيل في ضريبة القيمة المضافة *": "VAT registration *",
  "رقم التسجيل الضريبي": "Tax registration number",
  "رقم السجل التجاري للعميل": "Customer commercial registration",
  "العنوان اختياري": "Address (optional)",
  "المدينة": "City",
  "الشارع": "Street",
  "رقم المبنى": "Building number",
  "الحي": "District",
  "الرمز البريدي": "Postal code",
  "بيانات الفوترة اختياري": "Billing data (optional)",
  "المعرّف": "Identifier",
  "البريد الإلكتروني": "Email",
  "الهاتف": "Phone",
  "العملة": "Currency",
  "شروط الدفع": "Payment terms",
  "تحديد": "Select",
  "فوري": "Immediate",
  "15 يوم": "15 days",
  "30 يوم": "30 days",
  "رقم الترخيص": "License number",
  "نوع ورقم ترخيص جهة الاتصال": "Contact license type and number",
  "الرصيد الافتتاحي": "Opening balance",
  "حد الائتمان": "Credit limit",
  "جاري الحفظ...": "Saving...",
  "حفظ": "Save",
  "إلغاء": "Cancel",
  "التدقيق والمتابعة": "Audit and follow-up",
  "تحكم": "Control",
  "إعدادات نُظم الضريبة": "Tax system settings",
  "فواتير المبيعات المستحقة": "Due sales invoices",
  "تقارير أعمار المديونية": "Receivables aging reports",
  "مؤشرات الأداء (KPIs)": "Key performance indicators (KPIs)",
  "تقارير الموردين (AP)": "Vendor reports (AP)",
  "قيد التطوير": "Under development",
  "تقرير أعمار الموردين": "Vendor aging report",
  "تقرير أرصدة الموردين (AP Aging)": "Vendor balance report (AP Aging)",
  "تقييمات المستحقات المتأخرة": "Overdue receivables assessments",
  "تقارير العملاء (AR)": "Customer reports (AR)",
  "نشطة": "Active",
  "تقرير أعمار العملاء": "Customer aging report",
  "تقرير أرصدة العملاء (AR Aging)": "Customer balance report (AR Aging)",
  "حالات التحصيل": "Collection statuses",
  "تنبيهات التأخر في الدفع": "Late payment alerts",
  "ملخصات عامة للتقارير": "General report summaries",
  "إجمالي المديونية": "Total receivables",
  "المدفوعات الأخيرة": "Recent payments",
  "المستحقات المتأخرة": "Overdue receivables",
  "تنبيهات المتابعة": "Follow-up alerts",
  "5 تنبيهات": "5 alerts",
  "تصفية متقدمة": "Advanced filtering",
  "الرياض": "Riyadh",
  "جدة": "Jeddah",
  "الدمام": "Dammam",
  "الحالة": "Status",
  "الاسم": "Name",
  "الإجراءات": "Actions",
  "ريال": "SAR",
  "عرض التفاصيل": "View details",
  "تعديل": "Edit",
  "حذف": "Delete",
  "تفاصيل المورد": "Vendor details",
  "تفاصيل العميل": "Customer details",
  "الرقم": "Number",
  "إغلاق": "Close",
  "لا يمكن تغيير اسم المورد لأن له فواتير أو سندات أو قيودًا؛ الاسم مرتبط بكشف حسابه في الدفاتر.":
    "The vendor name cannot be changed because it has invoices, payments or journal entries; the name links its ledger statement.",
  "لا يمكن تغيير اسم العميل لأن له فواتير أو سندات أو قيودًا؛ الاسم مرتبط بكشف حسابه في الدفاتر.":
    "The customer name cannot be changed because it has invoices, receipts or journal entries; the name links its ledger statement.",
  "يوجد مورد آخر بنفس الاسم.": "Another vendor has the same name.",
  "يوجد عميل آخر بنفس الاسم.": "Another customer has the same name.",
  "الرقم الضريبي مسجل لمورد آخر. هل هو فرع أو جهة من نفس المجموعة الضريبية وتريد المتابعة؟":
    "This VAT number is registered to another vendor. Is it a branch or a member of the same VAT group, and do you want to continue?",
  "الرقم الضريبي مسجل لعميل آخر. هل هو فرع أو جهة من نفس المجموعة الضريبية وتريد المتابعة؟":
    "This VAT number is registered to another customer. Is it a branch or a member of the same VAT group, and do you want to continue?",
  "لا تملك صلاحية تنفيذ هذا الإجراء.": "You do not have permission to perform this action.",
  "العنوان الوطني مطلوب للعميل المسجل ضريبيًا": "National address is required for a VAT-registered customer",
  "أكمل رقم المبنى والشارع والحي والمدينة والرمز البريدي؛ الفاتورة الضريبية القياسية لا تصدر بدونها.":
    "Complete the building number, street, district, city and postal code; a standard tax invoice cannot be issued without them.",
  "العنوان الوطني (مطلوب للعميل المسجل ضريبيًا)": "National address (required for a VAT-registered customer)",
  "الرصيد الافتتاحي لا يُعدَّل من هنا: الأرصدة الافتتاحية للعملاء والموردين تُسجَّل بقيد محاسبي حتى تظهر في الدفاتر وكشوف الحساب.":
    "The opening balance is not edited here: customer and vendor opening balances are recorded with a journal entry so they appear in the books and statements.",
  "حد الائتمان (للعلم فقط)": "Credit limit (for reference only)",
  "لا يمنع الفوترة عند تجاوزه.": "It does not block invoicing when exceeded.",
  "يُثبَّت الاسم بعد أول فاتورة أو سند لأنه مرتبط بكشف الحساب.": "The name is locked after the first invoice or payment because it links the account statement.",
  "الرقم الضريبي": "VAT number",
  "كل الأنواع": "All types",
  "كل المدن": "All cities",
  "كل الحالات": "All statuses",
  "إعادة ضبط": "Reset",
  "غير مسجل في الدفاتر": "Not recorded in the books",
  "العنوان الوطني": "National address",
  "تم تعطيل المورد": "Vendor deactivated",
  "لا يمكن حذف مورد مرتبط بفواتير، لذلك تم تحويله إلى غير نشط":
    "A vendor linked to invoices cannot be deleted, so it was marked inactive",
  "لا يمكن حذف مورد مرتبط بمستندات، لذلك تم تحويله إلى غير نشط":
    "A vendor linked to documents cannot be deleted, so it was marked inactive",
  "لا يمكن حذف عميل مرتبط بمستندات، لذلك تم تحويله إلى غير نشط":
    "A customer linked to documents cannot be deleted, so it was marked inactive",
  "لم يتم الحفظ — تحقق من الصلاحيات": "Not saved — check your permissions",
  "لم يتم الحذف — تحقق من الصلاحيات": "Not deleted — check your permissions",
  "لم يتم التعديل — تحقق من الصلاحيات": "Not updated — check your permissions",
  "أنشئ بواسطة": "Created by",
  "حد الائتمان يجب أن يكون رقمًا موجبًا": "The credit limit must be a positive number",
  "من تاريخ": "From date",
  "إلى تاريخ": "To date",
};

function useCrmI18n() {
  const i18n = useI18n();
  return {
    ...i18n,
    t: (value: string) =>
      i18n.locale === "en" ? crmTranslations[value] ?? i18n.t(value) : i18n.t(value),
  };
}

const emptyForm = (isVendor: boolean): PartyForm => ({
  id: undefined,
  name: "",
  type: isVendor ? "مورد محلي" : "شركة",
  email: "",
  phone: "",
  openingBalance: "0",
  creditLimit: "0",
  status: "نشط",
  country: "",
  taxRegistrationMode: "not_registered",
  taxNumber: "",
  commercialRegistration: "",
  city: "",
  street: "",
  buildingNumber: "",
  district: "",
  postalCode: "",
  invoiceRef: "",
  invoiceEmail: "",
  invoicePhone: "",
  currency: "SAR",
  paymentTerms: "",
  businessType: "",
  licenseNumber: "",
});

export default function CRM() {
  const { t, direction, formatNumber } = useCrmI18n();
  const { permissions } = useRolePermissions();
  const canViewCreator = checkPerm(permissions, "audit.creator_columns");
  const location = useLocation();
  const isVendors = location.pathname.includes("/crm/vendors");
  const isReports = location.pathname.includes("/crm/reports");

  const [customerRows, setCustomerRows] = useState<PartyRow[]>(customers);
  const [vendorRows, setVendorRows] = useState<PartyRow[]>(vendors);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState<PartyForm>(emptyForm(false));
  const [viewModal, setViewModal] = useState<ViewModalData>(null);
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  useEffect(() => {
    const loadTable = async (
      tableName: "customers" | "vendors",
      setter: (rows: PartyRow[]) => void
    ) => {
      try {
        // كل الصفوف بترقيم صفحات (بدون حد 1000)، الأحدث أولًا حسب رقم العميل/المورد
        const numberColumn = tableName === "customers" ? "customer_number" : "vendor_number";
        const { data, error } = await selectAllRows((from, to) =>
          supabase
            .from(tableName)
            .select("*")
            .order(numberColumn, { ascending: false })
            .order("id")
            .range(from, to),
        );

        if (!error && data) {
          const mapped = data.map((row) => mapPartyRow(row as Record<string, unknown>));
          if (canViewCreator) {
            const ids = Array.from(new Set(mapped.map((item) => item.createdBy).filter(Boolean)));
            if (ids.length > 0) {
              const { data: labels } = await supabase.rpc("business_user_labels", { p_user_ids: ids });
              const names = new Map<string, string>((labels ?? []).map((item) => [String(item.user_id), String(item.display_name)] as [string, string]));
              mapped.forEach((item) => { item.creatorName = names.get(item.createdBy) ?? "—"; });
            }
          }
          setter(mapped);
        } else {
          setter([]);
        }
      } catch (e) {
        setter([]);
      }
    };

    void Promise.allSettled([
      loadTable("customers", setCustomerRows),
      loadTable("vendors", setVendorRows),
    ]);
  }, [canViewCreator]);

  useEffect(() => {
    // عند التنقل بين العملاء والموردين والتقارير يُغلق النموذج وتُصفّر الفلاتر
    setForm(emptyForm(isVendors));
    setIsFormOpen(false);
    setSearch("");
    setFromDate("");
    setToDate("");
    setTypeFilter("");
    setCityFilter("");
    setStatusFilter("");
  }, [isVendors, isReports]);

  const title = t(isReports ? "التقارير" : isVendors ? "الموردين" : "العملاء");
  const description = t(
    isReports
      ? "ملخصات وتقارير العملاء والموردين في مكان واحد."
      : isVendors
        ? "إدارة بيانات الموردين ومتابعة الحالة المالية."
        : "إدارة قاعدة بيانات العملاء ومتابعة الحالة المالية."
  );
  const actionLabel = t(
    isReports ? "توليد تقرير جديد" : isVendors ? "إضافة مورد جديد" : "إضافة عميل جديد"
  );
  const currentRows = isVendors ? vendorRows : customerRows;
  const tableData = currentRows.filter((row) => {
    const matchesSearch = !search.trim() || `${row.number} ${row.name} ${row.taxNumber}`.toLowerCase().includes(search.trim().toLowerCase());
    const date = row.createdAt.slice(0, 10);
    return matchesSearch
      && (!fromDate || date >= fromDate) && (!toDate || date <= toDate)
      && (!typeFilter || row.type === typeFilter)
      && (!cityFilter || row.city.trim() === cityFilter)
      && (!statusFilter || row.status === statusFilter);
  });
  const cityOptions = Array.from(new Set(currentRows.map((row) => row.city.trim()).filter(Boolean))).sort((first, second) => first.localeCompare(second));
  const resetFilters = () => {
    setSearch("");
    setFromDate("");
    setToDate("");
    setTypeFilter("");
    setCityFilter("");
    setStatusFilter("");
  };
  const idLabel = t(isVendors ? "رقم المورد" : "رقم العميل");
  const typeLabel = t(isVendors ? "نوع المورد" : "نوع العميل");
  const searchPlaceholder = t(
    isVendors ? "ابحث بالاسم أو رقم المورد" : "ابحث بالاسم أو رقم العميل"
  );
  const formatAmount = (value: string) =>
    `${formatNumber(Number.parseFloat(value) || 0, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} ${t("ريال")}`;

  const typeOptions = isVendors
    ? ["مورد محلي", "مورد دولي", "مورد خدمات"]
    : ["شركة", "فرد", "جهة حكومية"];

  const openCreateForm = () => {
    if (isReports) return;
    if (isFormOpen && !form.id) {
      setIsFormOpen(false);
      return;
    }
    setForm(emptyForm(isVendors));
    setIsFormOpen(true);
  };

  const handleSave = async () => {
    if (saving) return;
    if (!form.name.trim()) {
      toast({ title: t("تنبيه"), description: t("أدخل الاسم"), variant: "destructive" });
      return;
    }
    if (
      form.taxRegistrationMode === "registered_sa" &&
      !SAUDI_VAT_NUMBER_PATTERN.test(form.taxNumber.trim())
    ) {
      toast({
        title: t("رقم ضريبي غير صالح"),
        description: t("الرقم الضريبي السعودي 15 رقمًا يبدأ وينتهي بالرقم 3"),
        variant: "destructive",
      });
      return;
    }
    if (
      form.commercialRegistration.trim() &&
      !/^\d{10,15}$/.test(form.commercialRegistration.trim())
    ) {
      toast({
        title: t("سجل تجاري غير صالح"),
        description: t("السجل التجاري يجب أن يتكون من 10 إلى 15 رقمًا"),
        variant: "destructive",
      });
      return;
    }
    if (
      (form.buildingNumber.trim() && !/^\d{4}$/.test(form.buildingNumber.trim())) ||
      (form.postalCode.trim() && !/^\d{5}$/.test(form.postalCode.trim()))
    ) {
      toast({
        title: t("العنوان الوطني غير صالح"),
        description: t("رقم المبنى 4 أرقام والرمز البريدي 5 أرقام"),
        variant: "destructive",
      });
      return;
    }
    // المورد غير المقيم (بلا منشأة في المملكة): الدولة إلزامية وليست السعودية — عليه يُبنى الاحتساب العكسي
    if (
      isVendors &&
      form.taxRegistrationMode === "non_resident" &&
      (!form.country.trim() || /سعود|saudi|^ksa$|^sa$/i.test(form.country.trim()))
    ) {
      toast({
        title: t("دولة المورد غير المقيم مطلوبة"),
        description: t("المورد غير المقيم منشأته خارج المملكة؛ اكتب دولته"),
        variant: "destructive",
      });
      return;
    }
    if (form.creditLimit && !(Number(form.creditLimit) >= 0)) {
      toast({ title: t("فشل الحفظ"), description: t("حد الائتمان يجب أن يكون رقمًا موجبًا"), variant: "destructive" });
      return;
    }
    // العميل المسجل ضريبيًا تصدر له فاتورة قياسية، وهي تتطلب العنوان الوطني كاملًا
    if (
      !isVendors &&
      form.taxRegistrationMode === "registered_sa" &&
      [form.buildingNumber, form.street, form.district, form.city, form.postalCode].some((value) => !value.trim())
    ) {
      toast({
        title: t("العنوان الوطني مطلوب للعميل المسجل ضريبيًا"),
        description: t("أكمل رقم المبنى والشارع والحي والمدينة والرمز البريدي؛ الفاتورة الضريبية القياسية لا تصدر بدونها."),
        variant: "destructive",
      });
      return;
    }

    // منع التكرار قبل الإرسال (القاعدة تفرضه أيضًا): الاسم بعد توحيد المسافات وحالة الأحرف، والرقم الضريبي
    const normalizedName = normalizePartyName(form.name);
    const taxNumber = form.taxRegistrationMode === "registered_sa" ? form.taxNumber.trim() : "";
    const others = currentRows.filter((row) => row.id !== form.id);
    if (others.some((row) => normalizePartyName(row.name) === normalizedName)) {
      toast({ title: t("فشل الحفظ"), description: t(isVendors ? "يوجد مورد آخر بنفس الاسم." : "يوجد عميل آخر بنفس الاسم."), variant: "destructive" });
      return;
    }
    // الرقم الضريبي المكرر مسموح (فروع المنشأة ومجموعات الضريبة) لكن بتأكيد صريح
    if (
      taxNumber &&
      others.some((row) => row.taxNumber.trim() === taxNumber) &&
      !confirm(t(isVendors
        ? "الرقم الضريبي مسجل لمورد آخر. هل هو فرع أو جهة من نفس المجموعة الضريبية وتريد المتابعة؟"
        : "الرقم الضريبي مسجل لعميل آخر. هل هو فرع أو جهة من نفس المجموعة الضريبية وتريد المتابعة؟"))
    ) {
      return;
    }

    const tableName = isVendors ? "vendors" : "customers";

    // الاسم مفتاح كشف الحساب في القيود: لا يتغير بعد أول فاتورة (القاعدة تفرض ذلك على كل المستندات والقيود)
    const original = form.id ? currentRows.find((row) => row.id === form.id) : undefined;
    // إن لم يتغير الاسم فعليًا (فرق مسافات طرفية فقط) نرسله كما هو محفوظ حتى لا يُعد تغييرًا
    const nameToSave = original && original.name.trim() === form.name.trim() ? original.name : form.name.trim();
    // يبدأ الحفظ قبل أي انتظار حتى لا يُرسل النموذج مرتين عند النقر المزدوج
    setSaving(true);
    if (original && original.name !== nameToSave) {
      const { count } = await supabase
        .from(isVendors ? "purchase_invoices" : "sales_invoices")
        .select("id", { count: "exact", head: true })
        .eq(isVendors ? "vendor_id" : "customer_id", form.id);
      if ((count ?? 0) > 0) {
        toast({ title: t("فشل التحديث"), description: t(partyErrorText("PARTY_RENAME_BLOCKED", isVendors)), variant: "destructive" });
        setSaving(false);
        return;
      }
    }

    if (form.id) {
      // Update existing — الرصيد الافتتاحي لا يُرسل (لا يُعدَّل من هذه الشاشة)
      const payload = {
        name: nameToSave,
        type: form.type,
        email: form.invoiceEmail.trim(),
        phone: form.invoicePhone.trim(),
        credit_limit: form.creditLimit || "0",
        status: form.status,
        country: form.country,
        tax_registration_mode: form.taxRegistrationMode,
        // الرقم الضريبي يُحفظ لمن هو مسجل ضريبيًا (وللمورد غير المقيم رقمه في بلده للتوثيق)
        tax_number:
          form.taxRegistrationMode === "registered_sa" || (isVendors && form.taxRegistrationMode === "non_resident")
            ? form.taxNumber.trim()
            : "",
        commercial_registration: form.commercialRegistration.trim(),
        city: form.city.trim(),
        street: form.street.trim(),
        building_number: form.buildingNumber.trim(),
        district: form.district.trim(),
        postal_code: form.postalCode.trim(),
        invoice_ref: form.invoiceRef.trim(),
        currency: form.currency,
        payment_terms: form.paymentTerms,
        business_type: form.businessType.trim(),
        license_number: form.licenseNumber.trim(),
      };

      let result: any = { error: null, failed: false };
      try {
        const res = await supabase
          .from(tableName)
          .update(payload)
          .eq("id", form.id)
          .select("*");
        result = { ...res, failed: false };
        if (res.error) result.error = res.error;
        // التحديث الذي تمنعه الصلاحيات يعود بلا خطأ وبلا صفوف: نعامله كفشل لا كنجاح
        else if (!res.data?.length) result.error = new Error(t("لم يتم الحفظ — تحقق من الصلاحيات"));
      } catch (e) {
        result = { error: new Error("fetch_failed"), failed: true };
      }

      if (!result.error) {
        // الصف كما حفظته القاعدة (يحافظ على الرقم وتاريخ الإنشاء واسم المنشئ)
        const updatedRow = {
          ...mapPartyRow(result.data[0] as Record<string, unknown>),
          creatorName: original?.creatorName ?? "—",
        };
        if (isVendors) {
          setVendorRows((prev) =>
            prev.map((row) => (row.id === form.id ? updatedRow : row))
          );
        } else {
          setCustomerRows((prev) =>
            prev.map((row) => (row.id === form.id ? updatedRow : row))
          );
        }

        setIsFormOpen(false);
        toast({
          title: t("تم التحديث"),
          description: t(isVendors ? "تم تحديث بيانات المورد" : "تم تحديث بيانات العميل"),
        });
      } else {
        toast({
          title: t("فشل التحديث"),
          description: t(
            result.failed
              ? "تعذر الاتصال بقاعدة البيانات"
              : partyErrorText(result.error?.message ?? "", isVendors) || "تعذر تحديث البيانات"
          ),
          variant: "destructive",
        });
      }
    } else {
      // Create new
      const payload = {
        id: crypto.randomUUID(),
        name: form.name.trim(),
        type: form.type,
        email: form.invoiceEmail.trim(),
        phone: form.invoicePhone.trim(),
        // الأرصدة الافتتاحية للأطراف تُسجَّل بقيد محاسبي، لا من هذه الشاشة
        opening_balance: "0",
        credit_limit: form.creditLimit || "0",
        status: form.status,
        country: form.country,
        tax_registration_mode: form.taxRegistrationMode,
        // الرقم الضريبي يُحفظ لمن هو مسجل ضريبيًا (وللمورد غير المقيم رقمه في بلده للتوثيق)
        tax_number:
          form.taxRegistrationMode === "registered_sa" || (isVendors && form.taxRegistrationMode === "non_resident")
            ? form.taxNumber.trim()
            : "",
        commercial_registration: form.commercialRegistration.trim(),
        city: form.city.trim(),
        street: form.street.trim(),
        building_number: form.buildingNumber.trim(),
        district: form.district.trim(),
        postal_code: form.postalCode.trim(),
        invoice_ref: form.invoiceRef.trim(),
        currency: form.currency,
        payment_terms: form.paymentTerms,
        business_type: form.businessType.trim(),
        license_number: form.licenseNumber.trim(),
      };

      let result: any = { error: null, failed: false };
      try {
        const res = await supabase
          .from(tableName)
          .insert([payload])
          .select("*")
          .single();
        result = { ...res, failed: false };
        if (res.error) result.error = res.error;
      } catch (e) {
        result = { error: new Error("fetch_failed"), failed: true };
      }

      if (!result.error) {
        const newRow = mapPartyRow(
          (result.data ?? payload) as unknown as Record<string, unknown>,
        );
        if (isVendors) {
          setVendorRows((prev) => [newRow, ...prev]);
        } else {
          setCustomerRows((prev) => [newRow, ...prev]);
        }

        setIsFormOpen(false);
        toast({
          title: t("تم الحفظ"),
          description: t(isVendors ? "تمت إضافة المورد" : "تمت إضافة العميل"),
        });
      } else {
        toast({
          title: t("فشل الحفظ"),
          description: t(
            result.failed
              ? "تعذر الاتصال بقاعدة البيانات، تحقق من الاتصال"
              : partyErrorText(result.error?.message ?? "", isVendors) || "تعذر حفظ البيانات"
          ),
          variant: "destructive",
        });
      }
    }

    setSaving(false);
  };

  const handleView = (row: PartyRow) => {
    setViewModal(row);
  };

  const handleEdit = (row: PartyRow) => {
    setForm({
      ...emptyForm(isVendors),
      id: row.id,
      name: row.name,
      type: row.type,
      email: row.email,
      phone: row.phone,
      // حقلا البريد والهاتف الظاهران في النموذج هما حقلا الفوترة
      invoiceEmail: row.email,
      invoicePhone: row.phone,
      openingBalance: row.openingBalance,
      creditLimit: row.creditLimit,
      status: row.status,
      country: row.country,
      taxRegistrationMode: row.taxRegistrationMode,
      taxNumber: row.taxNumber,
      commercialRegistration: row.commercialRegistration,
      city: row.city,
      street: row.street,
      buildingNumber: row.buildingNumber,
      district: row.district,
      postalCode: row.postalCode,
      invoiceRef: row.invoiceRef,
      currency: row.currency,
      paymentTerms: row.paymentTerms,
      businessType: row.businessType,
      licenseNumber: row.licenseNumber,
    });
    setIsFormOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t(isVendors ? "هل متأكد من حذف المورد؟" : "هل متأكد من حذف العميل؟"))) {
      return;
    }

    const tableName = isVendors ? "vendors" : "customers";
    setDeleting(true);

    // العميل أو المورد المرتبط بمستندات لا يُحذف بل يُعطَّل (حفاظًا على المستندات والقيود)
    const deactivate = async (message: string) => {
      const { data: deactivatedRows, error: deactivateError } = await supabase
        .from(tableName)
        .update({ status: "غير نشط" })
        .eq("id", id)
        .select("id");
      if (!deactivateError && deactivatedRows?.length) {
        const markInactive = (rows: PartyRow[]) =>
          rows.map((row) => (row.id === id ? { ...row, status: "غير نشط" } : row));
        if (isVendors) {
          setVendorRows((prev) => markInactive(prev));
        } else {
          setCustomerRows((prev) => markInactive(prev));
        }
        toast({ title: t(isVendors ? "تم تعطيل المورد" : "تم تعطيل العميل"), description: t(message) });
      } else {
        toast({
          title: t("فشل الحذف"),
          description: t(deactivateError ? partyErrorText(deactivateError.message, isVendors) : "لم يتم التعديل — تحقق من الصلاحيات"),
          variant: "destructive",
        });
      }
    };

    const { count, error: invoiceLookupError } = await supabase
      .from(isVendors ? "purchase_invoices" : "sales_invoices")
      .select("id", { count: "exact", head: true })
      .eq(isVendors ? "vendor_id" : "customer_id", id);
    if (invoiceLookupError) {
      toast({ title: t("فشل الحذف"), description: t(partyErrorText(invoiceLookupError.message, isVendors)), variant: "destructive" });
      setDeleting(false);
      return;
    }
    if ((count ?? 0) > 0) {
      await deactivate(isVendors
        ? "لا يمكن حذف مورد مرتبط بفواتير، لذلك تم تحويله إلى غير نشط"
        : "لا يمكن حذف عميل مرتبط بفواتير، لذلك تم تحويله إلى غير نشط");
      setDeleting(false);
      return;
    }

    let result: any = { error: null, failed: false };
    try {
      const res = await supabase
        .from(tableName)
        .delete()
        .eq("id", id)
        .select("id");
      result = { ...res, failed: false };
      if (res.error) result.error = res.error;
      // الحذف الذي تمنعه الصلاحيات يعود بلا خطأ وبلا صفوف: نعامله كفشل لا كنجاح
      else if (!res.data?.length) result.error = new Error("لم يتم الحذف — تحقق من الصلاحيات");
    } catch (e) {
      result = { error: new Error("fetch_failed"), failed: true };
    }

    if (!result.error) {
      if (isVendors) {
        setVendorRows((prev) => prev.filter((row) => row.id !== id));
      } else {
        setCustomerRows((prev) => prev.filter((row) => row.id !== id));
      }
      toast({
        title: t("تم الحذف"),
        description: t(isVendors ? "تم حذف المورد" : "تم حذف العميل"),
      });
    } else if (result.error?.code === "23503") {
      // مرتبط بمستندات أخرى (سندات قبض أو صرف، استلام أو تسليم مخزون) لا تظهر في فحص الفواتير
      await deactivate(isVendors
        ? "لا يمكن حذف مورد مرتبط بمستندات، لذلك تم تحويله إلى غير نشط"
        : "لا يمكن حذف عميل مرتبط بمستندات، لذلك تم تحويله إلى غير نشط");
    } else {
      toast({
        title: t("فشل الحذف"),
        description: t(
          result.failed ? "تعذر الاتصال بقاعدة البيانات" : partyErrorText(result.error?.message ?? "", isVendors) || "تعذر حذف البيانات"
        ),
        variant: "destructive",
      });
    }

    setDeleting(false);
  };

  return (
    <Layout
      subMenu={{
        title: t("العملاء والموردين"),
        items: [
          { label: t("العملاء"), href: "/crm/customers" },
          { label: t("الموردين"), href: "/crm/vendors" },
          { label: t("التقارير"), href: "/crm/reports" },
        ],
      }}
    >
      <div className="space-y-6" dir={direction}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{description}</p>
          </div>
          <button
            onClick={openCreateForm}
            disabled={isReports}
            className="inline-flex items-center gap-2 rounded-lg bg-success px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-success/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="h-4 w-4" />
            {actionLabel}
          </button>
        </div>

        {!isReports && isFormOpen ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-6">
            <h3 className="text-2xl font-semibold text-slate-900 text-end">
              {t(
                form.id
                  ? isVendors
                    ? "تعديل بيانات المورد"
                    : "تعديل بيانات العميل"
                  : isVendors
                    ? "إضافة مورد جديد"
                    : "إضافة عميل جديد"
              )}
            </h3>

            <div className="space-y-5">
              <div className="rounded-md bg-slate-100 px-4 py-2 text-sm text-slate-700 text-end">
                {t("المنشأة والتسجيل الضريبي مطلوب")}
              </div>

              <div className="grid gap-4 md:grid-cols-2 items-center">
                <input
                  value={form.name ?? ""}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-end placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
                  placeholder={t(isVendors ? "اسم المورد" : "اسم العميل")}
                />
                <label className="text-sm font-medium text-slate-700 text-end">{t("اسم المنشأة *")}</label>
              </div>
              {form.id && (
                <p className="text-xs text-slate-500 text-end">{t("يُثبَّت الاسم بعد أول فاتورة أو سند لأنه مرتبط بكشف الحساب.")}</p>
              )}

              <div className="grid gap-4 md:grid-cols-2 items-center">
                {isVendors ? (
                  <>
                    <input
                      list="vendor-country-options"
                      value={form.country ?? ""}
                      onChange={(e) => setForm((prev) => ({ ...prev, country: e.target.value }))}
                      className="w-full h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-end placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
                      placeholder={t(form.taxRegistrationMode === "non_resident" ? "مطلوب للمورد غير المقيم" : "اختياري")}
                    />
                    <datalist id="vendor-country-options">
                      {["المملكة العربية السعودية", "الإمارات العربية المتحدة", "قطر", "الكويت", "البحرين", "عُمان", "مصر", "الأردن", "الصين", "الهند", "تركيا", "الولايات المتحدة", "المملكة المتحدة", "ألمانيا"].map((country) => (
                        <option key={country} value={country} />
                      ))}
                    </datalist>
                  </>
                ) : (
                  <select
                    value={form.country ?? ""}
                    onChange={(e) => setForm((prev) => ({ ...prev, country: e.target.value }))}
                    className="w-full h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-end focus:border-slate-400 focus:outline-none"
                  >
                    <option value="">{t("اختياري")}</option>
                    <option value="المملكة العربية السعودية">{t("المملكة العربية السعودية")}</option>
                    <option value="الإمارات العربية المتحدة">{t("الإمارات العربية المتحدة")}</option>
                    <option value="قطر">{t("قطر")}</option>
                    <option value="الكويت">{t("الكويت")}</option>
                  </select>
                )}
                <label className="text-sm font-medium text-slate-700 text-end">{t(isVendors && form.taxRegistrationMode === "non_resident" ? "البلد *" : "البلد")}</label>
              </div>

              <div className="grid gap-4 md:grid-cols-2 items-start">
                <div className="space-y-2 text-end">
                  <label className="flex items-center justify-end gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      checked={form.taxRegistrationMode === "not_registered"}
                      onChange={() => setForm((prev) => ({ ...prev, taxRegistrationMode: "not_registered" }))}
                    />
                    {t("غير مسجل في ضريبة القيمة المضافة")}
                  </label>
                  <label className="flex items-center justify-end gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      checked={form.taxRegistrationMode === "registered_sa"}
                      onChange={() => setForm((prev) => ({ ...prev, taxRegistrationMode: "registered_sa" }))}
                    />
                    {t("جهة اتصال مسجلة في ضريبة القيمة المضافة في السعودية")}
                  </label>
                  {isVendors && (
                    <label className="flex items-center justify-end gap-2 text-sm text-slate-700">
                      <input
                        type="radio"
                        checked={form.taxRegistrationMode === "non_resident"}
                        onChange={() => setForm((prev) => ({ ...prev, taxRegistrationMode: "non_resident" }))}
                      />
                      {t("مورد غير مقيم (منشأته خارج المملكة)")}
                    </label>
                  )}
                </div>
                <label className="text-sm font-medium text-slate-700 text-end">{t("التسجيل في ضريبة القيمة المضافة *")}</label>
              </div>

              <div className="grid gap-4 md:grid-cols-2 items-center">
                <input
                  value={form.taxNumber ?? ""}
                  onChange={(e) => setForm((prev) => ({ ...prev, taxNumber: e.target.value }))}
                  className="w-full h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-end placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
                  placeholder={t("اختياري")}
                />
                <label className="text-sm font-medium text-slate-700 text-end">{t("رقم التسجيل الضريبي")}</label>
              </div>

              <div className="grid gap-4 md:grid-cols-2 items-center">
                <input
                  value={form.commercialRegistration ?? ""}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      commercialRegistration: e.target.value
                        .replace(/\D/g, "")
                        .slice(0, 15),
                    }))
                  }
                  className="w-full h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-end placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
                  placeholder={t("اختياري")}
                />
                <label className="text-sm font-medium text-slate-700 text-end">
                  {t("رقم السجل التجاري للعميل")}
                </label>
              </div>

              <details open className="space-y-3">
                <summary className="cursor-pointer rounded-md bg-slate-100 px-4 py-2 text-sm text-slate-700 text-end">{t(!isVendors && form.taxRegistrationMode === "registered_sa" ? "العنوان الوطني (مطلوب للعميل المسجل ضريبيًا)" : "العنوان اختياري")}</summary>
                <div className="space-y-3 pt-2">
                  <div className="grid gap-4 md:grid-cols-2 items-center">
                    <input value={form.city ?? ""} onChange={(e) => setForm((prev) => ({ ...prev, city: e.target.value }))} className="w-full h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-end" placeholder={t("اختياري")} />
                    <label className="text-sm font-medium text-slate-700 text-end">{t("المدينة")}</label>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 items-center">
                    <input value={form.street ?? ""} onChange={(e) => setForm((prev) => ({ ...prev, street: e.target.value }))} className="w-full h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-end" placeholder={t("اختياري")} />
                    <label className="text-sm font-medium text-slate-700 text-end">{t("الشارع")}</label>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 items-center">
                    <input value={form.buildingNumber ?? ""} onChange={(e) => setForm((prev) => ({ ...prev, buildingNumber: e.target.value }))} className="w-full h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-end" placeholder={t("اختياري")} />
                    <label className="text-sm font-medium text-slate-700 text-end">{t("رقم المبنى")}</label>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 items-center">
                    <input value={form.district ?? ""} onChange={(e) => setForm((prev) => ({ ...prev, district: e.target.value }))} className="w-full h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-end" placeholder={t("اختياري")} />
                    <label className="text-sm font-medium text-slate-700 text-end">{t("الحي")}</label>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 items-center">
                    <input value={form.postalCode ?? ""} onChange={(e) => setForm((prev) => ({ ...prev, postalCode: e.target.value }))} className="w-full h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-end" placeholder={t("اختياري")} />
                    <label className="text-sm font-medium text-slate-700 text-end">{t("الرمز البريدي")}</label>
                  </div>
                </div>
              </details>

              <details open className="space-y-3">
                <summary className="cursor-pointer rounded-md bg-slate-100 px-4 py-2 text-sm text-slate-700 text-end">{t("بيانات الفوترة اختياري")}</summary>
                <div className="space-y-3 pt-2">
                  <div className="grid gap-4 md:grid-cols-2 items-center">
                    <input value={form.invoiceRef ?? ""} onChange={(e) => setForm((prev) => ({ ...prev, invoiceRef: e.target.value }))} className="w-full h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-end" placeholder={t("اختياري")} />
                    <label className="text-sm font-medium text-slate-700 text-end">{t("المعرّف")}</label>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 items-center">
                    <input value={form.invoiceEmail ?? ""} onChange={(e) => setForm((prev) => ({ ...prev, invoiceEmail: e.target.value }))} className="w-full h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-end" placeholder={t("اختياري")} />
                    <label className="text-sm font-medium text-slate-700 text-end">{t("البريد الإلكتروني")}</label>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 items-center">
                    <input value={form.invoicePhone ?? ""} onChange={(e) => setForm((prev) => ({ ...prev, invoicePhone: e.target.value }))} className="w-full h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-end" placeholder={t("اختياري")} />
                    <label className="text-sm font-medium text-slate-700 text-end">{t("الهاتف")}</label>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 items-center">
                    <select value={form.currency ?? ""} onChange={(e) => setForm((prev) => ({ ...prev, currency: e.target.value }))} className="w-full h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-end">
                      <option value="SAR">SAR</option>
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                      {isVendors && ["GBP", "AED", "CNY"].map((code) => (
                        <option key={code} value={code}>{code}</option>
                      ))}
                    </select>
                    <label className="text-sm font-medium text-slate-700 text-end">{t("العملة")}</label>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 items-center">
                    <select value={form.paymentTerms ?? ""} onChange={(e) => setForm((prev) => ({ ...prev, paymentTerms: e.target.value }))} className="w-full h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-end">
                      <option value="">{t("تحديد")}</option>
                      <option value="فوري">{t("فوري")}</option>
                      <option value="15 يوم">{t("15 يوم")}</option>
                      <option value="30 يوم">{t("30 يوم")}</option>
                    </select>
                    <label className="text-sm font-medium text-slate-700 text-end">{t("شروط الدفع")}</label>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3 items-center">
                    <input value={form.licenseNumber ?? ""} onChange={(e) => setForm((prev) => ({ ...prev, licenseNumber: e.target.value }))} className="w-full h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-end" placeholder={t("رقم الترخيص")} />
                    <select value={form.businessType ?? ""} onChange={(e) => setForm((prev) => ({ ...prev, businessType: e.target.value }))} className="w-full h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-end">
                      <option value="">{t("تحديد")}</option>
                      <option value="فرد">{t("فرد")}</option>
                      <option value="شركة">{t("شركة")}</option>
                    </select>
                    <label className="text-sm font-medium text-slate-700 text-end">{t("نوع ورقم ترخيص جهة الاتصال")}</label>
                  </div>
                </div>
              </details>

              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="text-sm font-medium text-slate-700 text-end block">{typeLabel}</label>
                  <select value={form.type} onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value }))} className="mt-1 w-full h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-end">
                    {typeOptions.map((option) => (
                      <option key={option} value={option}>{t(option)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700 text-end block">{t("الرصيد الافتتاحي")}</label>
                  <input type="text" value={form.openingBalance || "0"} disabled readOnly className="mt-1 w-full h-11 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-end text-slate-500" />
                  <p className="mt-1 text-[11px] text-slate-500 text-end">{t("الرصيد الافتتاحي لا يُعدَّل من هنا: الأرصدة الافتتاحية للعملاء والموردين تُسجَّل بقيد محاسبي حتى تظهر في الدفاتر وكشوف الحساب.")}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700 text-end block">{t("حد الائتمان (للعلم فقط)")}</label>
                  <input type="number" min="0" step="0.01" value={form.creditLimit ?? "0"} onChange={(e) => setForm((prev) => ({ ...prev, creditLimit: e.target.value }))} className="mt-1 w-full h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-end" />
                  <p className="mt-1 text-[11px] text-slate-500 text-end">{t("لا يمنع الفوترة عند تجاوزه.")}</p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-success px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-success/90 disabled:opacity-60"
              >
                <Save className="h-4 w-4" />
                {t(saving ? "جاري الحفظ..." : "حفظ")}
              </button>

              <button
                onClick={() => setIsFormOpen(false)}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700"
              >
                <X className="h-4 w-4" />
                {t("إلغاء")}
              </button>
            </div>
          </div>
        ) : null}

        {isReports ? (
          <CrmReports />
        ) : (
          <div className="erp-card">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <div className="relative w-full max-w-xs">
                <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={searchPlaceholder}
                  className="w-full rounded-lg border border-border bg-background px-9 py-2 text-sm"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <label className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm"><span>{t("من تاريخ")}</span><input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
                <label className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm"><span>{t("إلى تاريخ")}</span><input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
                <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
                  <option value="">{t("كل الأنواع")}</option>
                  {typeOptions.map((option) => (
                    <option key={option} value={option}>{t(option)}</option>
                  ))}
                </select>
                <select value={cityFilter} onChange={(event) => setCityFilter(event.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
                  <option value="">{t("كل المدن")}</option>
                  {cityOptions.map((city) => (
                    <option key={city} value={city}>{city}</option>
                  ))}
                </select>
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
                  <option value="">{t("كل الحالات")}</option>
                  <option value="نشط">{t("نشط")}</option>
                  <option value="غير نشط">{t("غير نشط")}</option>
                </select>
                <button onClick={resetFilters} className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground">
                  <RotateCcw className="h-4 w-4" />
                  {t("إعادة ضبط")}
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-900 text-white">
                    <th className="px-4 py-3 text-end font-semibold">{idLabel}</th>
                    <th className="px-4 py-3 text-end font-semibold">{t("الاسم")}</th>
                    <th className="px-4 py-3 text-end font-semibold">{typeLabel}</th>
                    <th className="px-4 py-3 text-end font-semibold">
                      {t("البريد الإلكتروني")}
                    </th>
                    <th className="px-4 py-3 text-end font-semibold">{t("الهاتف")}</th>
                    <th className="px-4 py-3 text-end font-semibold">
                      {t("الرقم الضريبي")}
                    </th>
                    <th className="px-4 py-3 text-end font-semibold">
                      {t("حد الائتمان")}
                    </th>
                    <th className="px-4 py-3 text-end font-semibold">{t("الحالة")}</th>
                    {canViewCreator && <th className="px-4 py-3 text-end font-semibold">{t("أنشئ بواسطة")}</th>}
                    <th className="px-4 py-3 text-end font-semibold">{t("الإجراءات")}</th>
                  </tr>
                </thead>
                <tbody>
                  {tableData.map((customer) => (
                    <tr
                      key={customer.id}
                      className="border-b border-border hover:bg-muted/40"
                    >
                      <td className="px-4 py-3 font-medium text-primary">
                        {customer.number}
                      </td>
                      <td className="px-4 py-3 text-foreground">
                        {customer.name}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                          {t(customer.type)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {customer.email}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {customer.phone}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground font-mono">
                        {customer.taxNumber || "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatAmount(customer.creditLimit)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${customer.status === "نشط" ? "bg-success/10 text-success" : "bg-slate-100 text-slate-500"}`}>
                          {t(customer.status)}
                        </span>
                      </td>
                      {canViewCreator && <td className="px-4 py-3 whitespace-nowrap">{customer.creatorName || "—"}</td>}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleView(customer)}
                            title={t("عرض التفاصيل")}
                            className="rounded-lg border border-border p-1.5 text-muted-foreground hover:text-primary transition"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleEdit(customer)}
                            title={t("تعديل")}
                            className="rounded-lg border border-border p-1.5 text-muted-foreground hover:text-primary transition"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(customer.id)}
                            disabled={deleting}
                            title={t("حذف")}
                            className="rounded-lg border border-border p-1.5 text-muted-foreground hover:text-destructive transition disabled:opacity-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {viewModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="rounded-xl border border-border bg-card p-6 w-full max-w-md space-y-4 max-h-[90vh] overflow-y-auto">
              <h3 className="text-lg font-semibold text-foreground">
                {t(isVendors ? "تفاصيل المورد" : "تفاصيل العميل")}
              </h3>

              <div className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground">{t("الرقم")}</p>
                  <p className="text-sm font-medium text-foreground">{viewModal.number}</p>
                </div>

                <div>
                  <p className="text-xs text-muted-foreground">{t("الاسم")}</p>
                  <p className="text-sm font-medium text-foreground">{viewModal.name}</p>
                </div>

                <div>
                  <p className="text-xs text-muted-foreground">{typeLabel}</p>
                  <p className="text-sm font-medium text-foreground">{viewModal.type}</p>
                </div>

                <div>
                  <p className="text-xs text-muted-foreground">{t("البريد الإلكتروني")}</p>
                  <p className="text-sm font-medium text-foreground">{viewModal.email || "—"}</p>
                </div>

                <div>
                  <p className="text-xs text-muted-foreground">{t("الهاتف")}</p>
                  <p className="text-sm font-medium text-foreground">{viewModal.phone || "—"}</p>
                </div>

                <div>
                  <p className="text-xs text-muted-foreground">{t("الرقم الضريبي")}</p>
                  <p className="text-sm font-medium text-foreground font-mono">{viewModal.taxNumber || "—"}</p>
                </div>

                <div>
                  <p className="text-xs text-muted-foreground">{t("العنوان الوطني")}</p>
                  <p className="text-sm font-medium text-foreground">
                    {[viewModal.buildingNumber, viewModal.street, viewModal.district, viewModal.city, viewModal.postalCode].map((value) => value.trim()).filter(Boolean).join("، ") || "—"}
                  </p>
                </div>

                {(Number.parseFloat(viewModal.openingBalance) || 0) !== 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground">{t("الرصيد الافتتاحي")} ({t("غير مسجل في الدفاتر")})</p>
                    <p className="text-sm font-medium text-foreground">{formatAmount(viewModal.openingBalance)}</p>
                  </div>
                )}

                <div>
                  <p className="text-xs text-muted-foreground">{t("حد الائتمان (للعلم فقط)")}</p>
                  <p className="text-sm font-medium text-foreground">{formatAmount(viewModal.creditLimit)}</p>
                </div>

                <div>
                  <p className="text-xs text-muted-foreground">{t("الحالة")}</p>
                  <p className="text-sm">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${viewModal.status === "نشط" ? "bg-success/10 text-success" : "bg-slate-100 text-slate-500"}`}>
                      {t(viewModal.status)}
                    </span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  onClick={() => {
                    handleEdit(viewModal);
                    setViewModal(null);
                  }}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary/90"
                >
                  <Pencil className="h-4 w-4" />
                  {t("تعديل")}
                </button>

                <button
                  onClick={() => setViewModal(null)}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground"
                >
                  <X className="h-4 w-4" />
                  {t("إغلاق")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
