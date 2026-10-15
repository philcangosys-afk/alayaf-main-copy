import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { purchasesFeatures } from "./Purchases";
import {
  Plus,
  Search,
  X,
  Trash2,
  Eye,
  Edit,
  Printer,
  FileText,
  Ban,
  ClipboardList,
  ChevronDown,
  ArrowLeftRight,
  MoreVertical,
  Save,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabaseClient";
import {
  PageHeader,
  FilterBar,
  FilterInput,
  FilterSelect,
  FilterActions,
  DataTable,
  ActionBtn,
} from "@/components/SalesPageUI";

type PurchaseRequestRow = {
  id: string;
  date: string;
  type: string;
  department: string;
  requester: string;
  section: string;
  total: string;
  status: string;
  approval: string;
  statusColor: string;
  approvalColor: string;
};

const statusColors: Record<string, string> = {
  "مغلقة": "bg-green-600 text-white",
  "قيد المراجعة": "bg-cyan-500 text-white",
};

const approvalColors: Record<string, string> = {
  "موافق": "bg-green-600 text-white",
  "بانتظار": "bg-amber-500 text-white",
};

const initialRequests: PurchaseRequestRow[] = [];

export default function PurchaseRequests() {
  const [view, setView] = useState<"list" | "create">("list");
  const [requests, setRequests] = useState<PurchaseRequestRow[]>(initialRequests);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const loadRequests = async () => {
      const { data, error } = await supabase
        .from("purchase_requests")
        .select("*")
        .order("date", { ascending: false });

      if (!error && data) {
        setRequests(
          data.map((row) => ({
            id: row.id ?? "",
            date: row.date ?? "",
            type: row.type ?? "",
            department: row.department ?? "",
            requester: row.requester ?? "",
            section: row.section ?? "",
            total: row.total ?? "",
            status: row.status ?? "",
            approval: row.approval ?? "",
            statusColor:
              statusColors[row.status ?? ""] ?? "bg-slate-500 text-white",
            approvalColor:
              approvalColors[row.approval ?? ""] ?? "bg-slate-500 text-white",
          }))
        );
      }
    };

    loadRequests();
  }, [refreshKey]);

  const handleSaved = () => {
    setRefreshKey((k) => k + 1);
    setView("list");
  };

  return (
    <Layout subMenu={{ title: "المشتريات", items: purchasesFeatures }}>
      <div className="mx-auto max-w-7xl">
        {view === "list" ? (
          <RequestsList
            onCreateClick={() => setView("create")}
            requests={requests}
          />
        ) : (
          <RequestForm onBack={() => setView("list")} onSaved={handleSaved} />
        )}
      </div>
    </Layout>
  );
}

function RequestsList({
  onCreateClick,
  requests,
}: {
  onCreateClick: () => void;
  requests: PurchaseRequestRow[];
}) {
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ClipboardList}
        title="طلبات الشراء"
        subtitle="إدارة وتتبع جميع طلبات الشراء"
        actionLabel="إنشاء طلب شراء جديد"
        onAction={onCreateClick}
        gradient="from-amber-600 to-orange-700"
      />

      <FilterBar>
        <FilterInput placeholder="البحث برقم الطلب أو المقدم..." />
        <FilterSelect label="النوع">
          <option>الكل</option>
        </FilterSelect>
        <FilterSelect label="الجهة">
          <option>الكل</option>
        </FilterSelect>
        <FilterSelect label="الحالة">
          <option>الكل</option>
        </FilterSelect>
        <FilterActions onReset={() => {}} onSearch={() => {}} />
      </FilterBar>

      <DataTable
        headers={["الإجراءات", "الاعتماد", "الحالة", "المجموع", "القسم", "مقدم الطلب", "الجهة", "النوع", "التاريخ", "رقم الطلب"]}
        gradient="from-amber-800 to-orange-900"
      >
        {requests.map((request) => (
          <tr key={request.id} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
            <td className="px-5 py-3.5 align-middle">
              <div className="flex items-center gap-1 flex-wrap">
                <ActionBtn icon={Eye} label="عرض" color="blue" />
                <ActionBtn icon={Edit} label="تعديل" color="emerald" />
                <ActionBtn icon={Trash2} label="حذف" color="red" />
              </div>
            </td>
            <td className="px-5 py-3.5 align-middle">
              <span className={cn("inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold", request.approvalColor)}>
                {request.approval}
              </span>
            </td>
            <td className="px-5 py-3.5 align-middle">
              <span className={cn("inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold", request.statusColor)}>
                {request.status}
              </span>
            </td>
            <td className="px-5 py-3.5 align-middle font-medium whitespace-nowrap">{request.total}</td>
            <td className="px-5 py-3.5 align-middle">{request.section}</td>
            <td className="px-5 py-3.5 align-middle">{request.requester}</td>
            <td className="px-5 py-3.5 align-middle">{request.department}</td>
            <td className="px-5 py-3.5 align-middle">{request.type}</td>
            <td className="px-5 py-3.5 align-middle text-muted-foreground">{request.date}</td>
            <td className="px-5 py-3.5 align-middle font-semibold text-amber-600 hover:underline cursor-pointer">
              {request.id}
            </td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}

function RequestForm({
  onBack,
  onSaved,
}: {
  onBack: () => void;
  onSaved: () => void;
}) {
  const today = new Date().toISOString().split("T")[0];

  const [form, setForm] = useState({
    date: today,
    type: "مواد",
    priority: "عادية",
    referenceNo: "",
    requesterName: "",
    department: "",
    position: "",
    costCenter: "بدون مركز تكلفة",
    costType: "نوع تكلفة افتراضي",
    budget: "0.00",
    notes: "",
  });

  const [items, setItems] = useState([
    {
      id: 1,
      description: "",
      unitPriceText: "",
      quantity: 1,
      price: 0,
      discount: 0,
      taxPercent: 15,
    },
  ]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setField = (field: keyof typeof form, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      {
        id: Date.now(),
        description: "",
        unitPriceText: "",
        quantity: 1,
        price: 0,
        discount: 0,
        taxPercent: 15,
      },
    ]);
  };

  const updateItem = (id: number, changes: Partial<(typeof items)[number]>) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...changes } : item))
    );
  };

  const removeItem = (id: number) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const totals = items.reduce(
    (acc, item) => {
      const lineSubtotal = item.quantity * item.price - item.discount;
      const tax = (lineSubtotal * item.taxPercent) / 100;
      const lineTotal = lineSubtotal + tax;
      return {
        subtotal: acc.subtotal + lineSubtotal,
        discount: acc.discount + item.discount,
        tax: acc.tax + tax,
        total: acc.total + lineTotal,
      };
    },
    { subtotal: 0, discount: 0, tax: 0, total: 0 }
  );

  const handleSave = async () => {
    if (!form.date) {
      setError("يرجى إدخال تاريخ الطلب");
      return;
    }
    setSaving(true);
    setError(null);

    const { error: insertError } = await supabase
      .from("purchase_requests")
      .insert([
        {
          date: form.date,
          type: form.type,
          priority: form.priority,
          reference_no: form.referenceNo || null,
          requester: form.requesterName,
          department: form.department,
          position: form.position,
          cost_center: form.costCenter,
          cost_type: form.costType,
          budget: parseFloat(form.budget) || 0,
          notes: form.notes || null,
          total: totals.total.toFixed(2),
          status: "قيد المراجعة",
          approval: "بانتظار",
          section: form.department,
          items: items.map((item) => ({
            description: item.description,
            quantity: item.quantity,
            price: item.price,
            discount: item.discount,
            tax_percent: item.taxPercent,
            unit_price_text: item.unitPriceText,
          })),
        },
      ]);

    setSaving(false);

    if (insertError) {
      setError("حدث خطأ أثناء الحفظ: " + insertError.message);
      return;
    }

    onSaved();
  };

  return (
    <div className="space-y-6 bg-slate-50 min-h-screen pb-12">
      {/* Header */}
      <div className="flex justify-between items-center bg-white p-4 border-b border-slate-200 shadow-sm">
        <div className="flex gap-2">
          <button
            onClick={onBack}
            disabled={saving}
            className="px-4 py-2 bg-slate-500 text-white text-sm font-medium rounded hover:bg-slate-600 transition-colors flex items-center gap-1 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
            إلغاء
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded flex items-center gap-2 hover:bg-blue-700 transition-colors disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {saving ? "جارٍ الحفظ..." : "حفظ طلب الشراء"}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-slate-800">
            إنشاء طلب شراء جديد
          </h1>
          <ClipboardList className="h-5 w-5 text-blue-600" />
        </div>
        <button
          onClick={onBack}
          disabled={saving}
          className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-sm font-medium rounded hover:bg-slate-50 transition-colors flex items-center gap-2 disabled:opacity-50"
        >
          العودة للقائمة
          <ArrowLeftRight className="h-4 w-4" />
        </button>
      </div>

      {error && (
        <div className="mx-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm text-right">
          {error}
        </div>
      )}

      <div className="p-4 space-y-6">
        {/* Basic Info */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex items-center justify-end gap-2">
            <h2 className="font-semibold text-slate-800">
              معلومات طلب الشراء الأساسية
            </h2>
            <svg
              className="h-5 w-5 text-slate-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700 text-right block">
                تاريخ الطلب <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setField("date", e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-right focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700 text-right block">
                نوع الطلب
              </label>
              <select
                value={form.type}
                onChange={(e) => setField("type", e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-right focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none appearance-none bg-white"
              >
                <option>مواد</option>
                <option>خدمات</option>
                <option>أصول</option>
                <option>أخرى</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700 text-right block">
                أولوية الطلب
              </label>
              <select
                value={form.priority}
                onChange={(e) => setField("priority", e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-right focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none appearance-none bg-white"
              >
                <option>عادية</option>
                <option>عاجلة</option>
                <option>حرجة</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700 text-right block">
                رقم الطلب المرجع
              </label>
              <input
                type="text"
                value={form.referenceNo}
                onChange={(e) => setField("referenceNo", e.target.value)}
                placeholder="رقم مرجع اختياري"
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-right focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              />
            </div>
          </div>
        </div>

        {/* Requester Section */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex items-center justify-end gap-2">
            <h2 className="font-semibold text-slate-800">مقدم الطلب</h2>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700 text-right block">
                اسم مقدم الطلب
              </label>
              <input
                type="text"
                value={form.requesterName}
                onChange={(e) => setField("requesterName", e.target.value)}
                placeholder="اسم مقدم الطلب"
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-right focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700 text-right block">
                الجهة
              </label>
              <input
                type="text"
                value={form.department}
                onChange={(e) => setField("department", e.target.value)}
                placeholder="الجهة أو القسم"
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-right focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700 text-right block">
                الوظيفة
              </label>
              <input
                type="text"
                value={form.position}
                onChange={(e) => setField("position", e.target.value)}
                placeholder="المسمى الوظيفي"
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-right focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              />
            </div>
          </div>
        </div>

        {/* Financial Section */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex items-center justify-end gap-2">
            <h2 className="font-semibold text-slate-800">البيانات المالية</h2>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700 text-right block">
                مركز التكلفة
              </label>
              <select
                value={form.costCenter}
                onChange={(e) => setField("costCenter", e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-right focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none appearance-none bg-white"
              >
                <option>بدون مركز تكلفة</option>
                <option>مركز التكلفة الرئيسي</option>
                <option>مركز التكلفة الفرعي</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700 text-right block">
                نوع التكلفة
              </label>
              <select
                value={form.costType}
                onChange={(e) => setField("costType", e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-right focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none appearance-none bg-white"
              >
                <option>نوع تكلفة افتراضي</option>
                <option>تشغيلي</option>
                <option>رأسمالي</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700 text-right block">
                الميزانية
              </label>
              <input
                type="number"
                value={form.budget}
                onChange={(e) => setField("budget", e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-right focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700 text-right block">
                المبلغ المتبقي
              </label>
              <input
                type="text"
                readOnly
                value={(parseFloat(form.budget) - totals.total).toFixed(2)}
                className="w-full px-3 py-2 border border-slate-200 bg-slate-100 rounded text-sm text-right outline-none"
              />
            </div>
          </div>
        </div>

        {/* Items */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <button
              onClick={handleAddItem}
              className="bg-[#1b8c56] text-white px-3 py-1 rounded text-sm font-medium hover:bg-[#157347] flex items-center gap-1"
            >
              <Plus className="h-4 w-4" />
              إضافة بند
            </button>
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-slate-800">بنود طلب الشراء</h2>
              <svg
                className="h-5 w-5 text-slate-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 10h16M4 14h16M4 18h16"
                />
              </svg>
            </div>
          </div>
          <div className="p-4 overflow-x-auto">
            <table className="w-full text-sm text-right mb-4">
              <thead>
                <tr className="text-slate-600 border-b border-slate-200">
                  <th className="pb-2 font-medium w-16 text-center"></th>
                  <th className="pb-2 font-medium w-24">المجموع</th>
                  <th className="pb-2 font-medium w-24">الضريبة %</th>
                  <th className="pb-2 font-medium w-20">خصم</th>
                  <th className="pb-2 font-medium w-24">السعر *</th>
                  <th className="pb-2 font-medium w-28">سعر الوحدة</th>
                  <th className="pb-2 font-medium w-20">الكمية *</th>
                  <th className="pb-2 font-medium">وصف البند</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const lineSubtotal =
                    item.quantity * item.price - item.discount;
                  const lineTax = (lineSubtotal * item.taxPercent) / 100;
                  const lineTotal = lineSubtotal + lineTax;

                  return (
                    <tr key={item.id}>
                      <td className="pt-4 align-top">
                        <div className="flex items-center justify-center gap-1 h-10">
                          <button
                            onClick={() => removeItem(item.id)}
                            className="w-7 h-7 flex items-center justify-center bg-red-500 text-white rounded hover:bg-red-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                      <td className="pt-4 px-1 align-top">
                        <input
                          type="text"
                          value={lineTotal.toFixed(2)}
                          disabled
                          className="w-full px-2 py-2 border border-slate-200 bg-slate-100 rounded text-sm text-right outline-none h-10"
                        />
                      </td>
                      <td className="pt-4 px-1 align-top">
                        <input
                          type="number"
                          value={item.taxPercent}
                          onChange={(event) =>
                            updateItem(item.id, {
                              taxPercent: Number(event.target.value) || 0,
                            })
                          }
                          className="w-full px-2 py-2 border border-slate-300 rounded text-sm text-right focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none h-10"
                        />
                      </td>
                      <td className="pt-4 px-1 align-top">
                        <input
                          type="number"
                          value={item.discount}
                          onChange={(event) =>
                            updateItem(item.id, {
                              discount: Number(event.target.value) || 0,
                            })
                          }
                          className="w-full px-2 py-2 border border-slate-300 rounded text-sm text-right focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none h-10"
                        />
                      </td>
                      <td className="pt-4 px-1 align-top">
                        <input
                          type="number"
                          value={item.price}
                          onChange={(event) =>
                            updateItem(item.id, {
                              price: Number(event.target.value) || 0,
                            })
                          }
                          className="w-full px-2 py-2 border border-slate-300 rounded text-sm text-right focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none h-10"
                        />
                      </td>
                      <td className="pt-4 px-1 align-top">
                        <input
                          type="text"
                          value={item.unitPriceText}
                          onChange={(event) =>
                            updateItem(item.id, {
                              unitPriceText: event.target.value,
                            })
                          }
                          placeholder="اختياري"
                          className="w-full px-2 py-2 border border-slate-300 rounded text-sm text-right focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none h-10"
                        />
                      </td>
                      <td className="pt-4 px-1 align-top">
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={(event) =>
                            updateItem(item.id, {
                              quantity: Number(event.target.value) || 0,
                            })
                          }
                          className="w-full px-2 py-2 border border-slate-300 rounded text-sm text-right focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none h-10"
                        />
                      </td>
                      <td className="pt-4 pl-1 align-top min-w-[320px]">
                        <textarea
                          rows={3}
                          value={item.description}
                          onChange={(event) =>
                            updateItem(item.id, {
                              description: event.target.value,
                            })
                          }
                          placeholder="اكتب وصف البند (اختياري)..."
                          className="w-full px-2 py-2 border border-slate-300 rounded text-sm text-right focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none min-h-[88px] resize-y"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Totals */}
            <div className="border-t border-slate-200 pt-4 mt-4 flex justify-end">
              <div className="w-80 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="font-semibold text-slate-800">
                    {totals.subtotal.toFixed(2)} ريال
                  </span>
                  <span className="text-slate-600">المجموع الفرعي</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="font-semibold text-slate-800">
                    {totals.discount.toFixed(2)} ريال
                  </span>
                  <span className="text-slate-600">الخصم</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="font-semibold text-slate-800">
                    {totals.tax.toFixed(2)} ريال
                  </span>
                  <span className="text-slate-600">الضريبة</span>
                </div>
                <div className="flex justify-between text-sm border-t border-slate-200 pt-2">
                  <span className="font-bold text-blue-600 text-base">
                    {totals.total.toFixed(2)} ريال
                  </span>
                  <span className="font-bold text-slate-800">المجموع الكلي</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex items-center justify-end gap-2">
            <h2 className="font-semibold text-slate-800">ملاحظات</h2>
          </div>
          <div className="p-4">
            <textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setField("notes", e.target.value)}
              placeholder="أي ملاحظات إضافية..."
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-right focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-y"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
