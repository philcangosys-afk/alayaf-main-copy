import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { purchasesFeatures } from "./Purchases";
import {
  Plus,
  Search,
  X,
  Trash2,
  ArrowLeftRight,
  Edit,
  Eye,
  Save,
  Loader2,
  RotateCcw,
  Printer,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
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

/* ── Types ── */
type ReturnItem = {
  id: number;
  description: string;
  originalQty: number;
  returnedQty: number;
  price: number;
  costCenter: string;
  taxPercent: number;
};

type PurchaseReturn = {
  id: string;
  vendor: string;
  date: string;
  dueDate: string;
  address: string;
  poNumber: string;
  returnReason: string;
  warehouse: string;
  warehouseName: string;
  notes: string;
  status: string;
  statusColor: string;
  subtotal: string;
  vat: string;
  total: string;
  items: ReturnItem[];
};

const statusColors: Record<string, string> = {
  "مفتوح": "bg-cyan-500 text-white",
  "معتمد": "bg-green-600 text-white",
  "ملغي": "bg-red-500 text-white",
  "قيد المراجعة": "bg-yellow-500 text-white",
};

function mapRow(row: Record<string, unknown>): PurchaseReturn {
  const status = (row.status as string) ?? "مفتوح";
  return {
    id: (row.id as string) ?? "",
    vendor: (row.vendor as string) ?? "",
    date: (row.date as string) ?? "",
    dueDate: (row.due_date as string) ?? "",
    address: (row.address as string) ?? "",
    poNumber: (row.po_number as string) ?? "",
    returnReason: (row.return_reason as string) ?? "",
    warehouse: (row.warehouse as string) ?? "",
    warehouseName: (row.warehouse_name as string) ?? "",
    notes: (row.notes as string) ?? "",
    status,
    statusColor: statusColors[status] ?? "bg-slate-500 text-white",
    subtotal: (row.subtotal as string) ?? "0.00",
    vat: (row.vat as string) ?? "0.00",
    total: (row.total as string) ?? "0.00",
    items: Array.isArray(row.items) ? (row.items as ReturnItem[]) : [],
  };
}

function calcTotals(items: ReturnItem[]) {
  return items.reduce(
    (acc, item) => {
      const lineTotal = item.returnedQty * item.price;
      const tax = (lineTotal * item.taxPercent) / 100;
      return {
        subtotal: acc.subtotal + lineTotal,
        vat: acc.vat + tax,
        total: acc.total + lineTotal + tax,
      };
    },
    { subtotal: 0, vat: 0, total: 0 }
  );
}

/* ── Main Page ── */
export default function PurchaseReturns() {
  const [view, setView] = useState<"list" | "create" | "details" | "edit">("list");
  const [returns, setReturns] = useState<PurchaseReturn[]>([]);
  const [selected, setSelected] = useState<PurchaseReturn | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const load = async () => {
      try {
        const { data, error } = await supabase
          .from("purchase_returns")
          .select("*")
          .order("date", { ascending: false });
        if (!error && data) setReturns(data.map(mapRow));
      } catch (e) {
        console.warn("purchase_returns table not found or network error:", e);
      }
    };
    load();
  }, [refreshKey]);

  const handleDelete = async (id: string) => {
    if (!confirm("هل تريد حذف هذا المردود؟")) return;
    const { error } = await supabase.from("purchase_returns").delete().eq("id", id);
    if (!error) {
      setReturns((prev) => prev.filter((r) => r.id !== id));
      toast({ title: "تم الحذف", description: `المردود: ${id}` });
    } else {
      toast({ title: "تعذّر الحذف", description: error.message });
    }
  };

  const handlePrintPdf = (ret: PurchaseReturn) => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    const items = ret.items.length > 0
      ? ret.items
      : [{ id: 1, description: "-", originalQty: 1, returnedQty: 1, price: Number(ret.total) || 0, costCenter: "", taxPercent: 0 }];

    const rows = items.map((item) => {
      const lineTotal = item.returnedQty * item.price;
      const tax = (lineTotal * item.taxPercent) / 100;
      return `<tr>
        <td>${item.description || "-"}</td>
        <td>${item.originalQty}</td>
        <td>${item.returnedQty}</td>
        <td>${item.price.toFixed(2)}</td>
        <td>${item.taxPercent}%</td>
        <td>${item.costCenter || "-"}</td>
        <td>${(lineTotal + tax).toFixed(2)}</td>
      </tr>`;
    }).join("");

    printWindow.document.write(`
      <html dir="rtl" lang="ar">
        <head><title>مردود مشتريات ${ret.id}</title><meta charset="utf-8"/>
        <style>body{font-family:Arial,sans-serif;padding:24px;color:#0f172a}
        .header{display:flex;justify-content:space-between;border-bottom:2px solid #dc2626;padding-bottom:12px;margin-bottom:16px}
        .title{font-size:22px;font-weight:700;color:#dc2626}
        .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px}
        .card{border:1px solid #e2e8f0;padding:10px;border-radius:6px}
        .label{color:#64748b;font-size:12px}.value{font-weight:700;font-size:14px;margin-top:2px}
        table{width:100%;border-collapse:collapse;font-size:13px}
        th,td{border:1px solid #e2e8f0;padding:8px;text-align:right}
        th{background:#fef2f2;font-weight:600}</style></head>
        <body>
        <div class="header"><div class="title">مردود مشتريات</div><div>رقم المردود: <strong>${ret.id.slice(0, 8)}</strong></div></div>
        <div class="grid">
          <div class="card"><div class="label">المورد</div><div class="value">${ret.vendor || "-"}</div></div>
          <div class="card"><div class="label">التاريخ</div><div class="value">${ret.date}</div></div>
          <div class="card"><div class="label">رقم أمر الشراء</div><div class="value">${ret.poNumber || "-"}</div></div>
          <div class="card"><div class="label">سبب الإرجاع</div><div class="value">${ret.returnReason || "-"}</div></div>
          <div class="card"><div class="label">الإجمالي</div><div class="value">${ret.total} ريال</div></div>
          <div class="card"><div class="label">الحالة</div><div class="value">${ret.status}</div></div>
        </div>
        <table><thead><tr><th>الوصف</th><th>الكمية الأصلية</th><th>تم إرجاعها</th><th>السعر</th><th>الضريبة</th><th>مركز التكلفة</th><th>الإجمالي</th></tr></thead>
        <tbody>${rows}</tbody></table>
        ${ret.notes ? `<p style="margin-top:16px;font-size:13px"><strong>ملاحظات:</strong> ${ret.notes}</p>` : ""}
        </body></html>`);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  return (
    <Layout subMenu={{ title: "المشتريات", items: purchasesFeatures }}>
      <div className="mx-auto max-w-7xl">
        {view === "list" && (
          <ReturnsList
            returns={returns}
            onCreateClick={() => setView("create")}
            onView={(r) => { setSelected(r); setView("details"); }}
            onEdit={(r) => { setSelected(r); setView("edit"); }}
            onDelete={handleDelete}
            onPrintPdf={handlePrintPdf}
          />
        )}
        {view === "create" && (
          <ReturnForm
            onBack={() => setView("list")}
            onSaved={(r) => {
              setReturns((prev) => [r, ...prev]);
              toast({ title: "تم حفظ المردود", description: `المردود: ${r.id.slice(0, 8)}` });
              setView("list");
            }}
          />
        )}
        {view === "details" && selected && (
          <ReturnDetails
            ret={selected}
            onBack={() => setView("list")}
            onEdit={() => setView("edit")}
            onPrintPdf={handlePrintPdf}
          />
        )}
        {view === "edit" && selected && (
          <ReturnEdit
            ret={selected}
            onBack={() => setView("list")}
            onUpdated={(updated) => {
              setReturns((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
              setSelected(updated);
              toast({ title: "تم تحديث المردود" });
              setRefreshKey((k) => k + 1);
              setView("list");
            }}
          />
        )}
      </div>
    </Layout>
  );
}

/* ── List ── */
function ReturnsList({
  returns, onCreateClick, onView, onEdit, onDelete, onPrintPdf,
}: {
  returns: PurchaseReturn[];
  onCreateClick: () => void;
  onView: (r: PurchaseReturn) => void;
  onEdit: (r: PurchaseReturn) => void;
  onDelete: (id: string) => void;
  onPrintPdf: (r: PurchaseReturn) => void;
}) {
  return (
    <div className="space-y-6">
      <PageHeader
        icon={RotateCcw}
        title="مردودات المشتريات"
        subtitle="إدارة وتتبع جميع المردودات"
        actionLabel="إنشاء مردود جديد"
        onAction={onCreateClick}
        gradient="from-rose-600 to-red-700"
      />

      <FilterBar>
        <FilterInput placeholder="رقم المردود، المورد، سبب الإرجاع..." />
        <FilterSelect label="المورد">
          <option>الكل</option>
        </FilterSelect>
        <FilterSelect label="الحالة">
          <option>الكل</option>
        </FilterSelect>
        <FilterActions onReset={() => {}} onSearch={() => {}} />
      </FilterBar>

      <DataTable
        headers={["الإجراءات", "الحالة", "الإجمالي", "السبب", "أمر الشراء", "المورد", "التاريخ", "رقم المردود"]}
        gradient="from-rose-800 to-red-900"
      >
        {returns.map((ret) => (
          <tr key={ret.id} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
            <td className="px-5 py-3.5 align-middle">
              <div className="flex items-center gap-1">
                <ActionBtn icon={Eye} label="عرض" color="blue" onClick={() => onView(ret)} />
                <ActionBtn icon={Edit} label="تعديل" color="emerald" onClick={() => onEdit(ret)} />
                <ActionBtn icon={Trash2} label="حذف" color="red" onClick={() => onDelete(ret.id)} />
                <button
                  title="PDF"
                  onClick={() => onPrintPdf(ret)}
                  className="px-2.5 py-1.5 text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors text-xs font-semibold"
                >
                  PDF
                </button>
              </div>
            </td>
            <td className="px-5 py-3.5 align-middle">
              <span className={cn("inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold", ret.statusColor)}>
                {ret.status}
              </span>
            </td>
            <td className="px-5 py-3.5 align-middle font-semibold text-red-600 whitespace-nowrap">{ret.total} ريال</td>
            <td className="px-5 py-3.5 align-middle text-muted-foreground">{ret.returnReason || "-"}</td>
            <td className="px-5 py-3.5 align-middle text-rose-600">{ret.poNumber || "-"}</td>
            <td className="px-5 py-3.5 align-middle">{ret.vendor}</td>
            <td className="px-5 py-3.5 align-middle text-muted-foreground">{ret.date}</td>
            <td
              className="px-5 py-3.5 align-middle font-semibold text-rose-600 hover:underline cursor-pointer"
              onClick={() => onView(ret)}
            >
              {ret.id.slice(0, 8)}...
            </td>
          </tr>
        ))}
        {returns.length === 0 && (
          <tr>
            <td colSpan={8} className="px-5 py-12 text-center text-muted-foreground">
              لا يوجد مردودات مشتريات
            </td>
          </tr>
        )}
      </DataTable>
    </div>
  );
}

/* ── Details ── */
function ReturnDetails({ ret, onBack, onEdit, onPrintPdf }: {
  ret: PurchaseReturn; onBack: () => void; onEdit: () => void; onPrintPdf: (r: PurchaseReturn) => void;
}) {
  const items = ret.items.length > 0 ? ret.items
    : [{ id: 1, description: "-", originalQty: 1, returnedQty: 1, price: Number(ret.total) || 0, costCenter: "", taxPercent: 0 }];
  const totals = calcTotals(items);

  return (
    <div className="space-y-6 bg-slate-50 min-h-screen pb-12">
      <div className="flex justify-between items-center bg-white p-4 border-b border-slate-200 shadow-sm">
        <button onClick={onBack} className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-sm rounded hover:bg-slate-50 flex items-center gap-2">العودة للقائمة <ArrowLeftRight className="h-4 w-4" /></button>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-slate-800">تفاصيل مردود المشتريات</h1>
          <RotateCcw className="h-5 w-5 text-red-600" />
        </div>
        <div className="flex gap-2">
          <button onClick={() => onPrintPdf(ret)} className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-sm rounded hover:bg-slate-50 flex items-center gap-2"><Printer className="h-4 w-4" /> طباعة PDF</button>
          <button onClick={onEdit} className="px-4 py-2 bg-emerald-600 text-white text-sm rounded hover:bg-emerald-700 flex items-center gap-2"><Edit className="h-4 w-4" /> تعديل</button>
        </div>
      </div>

      <div className="p-4 flex gap-6 items-start">
        {/* Summary panel */}
        <div className="w-56 shrink-0 space-y-4">
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-slate-700 text-white px-4 py-2 text-right text-sm font-semibold">ملخص المردود</div>
            <div className="p-4 space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">المجموع الفرعي</span><span className="font-semibold">{totals.subtotal.toFixed(2)} ريال</span></div>
              <div className="flex justify-between"><span className="text-slate-500">ضريبة القيمة المضافة</span><span className="font-semibold">{totals.vat.toFixed(2)}</span></div>
              <div className="flex justify-between border-t border-slate-200 pt-2"><span className="font-bold text-slate-800">الإجمالي</span><span className="font-bold text-red-600">{totals.total.toFixed(2)} ريال</span></div>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 space-y-6">
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-red-600 text-white px-4 py-2 text-right font-semibold">بيانات المردود</div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                { label: "المورد", value: ret.vendor },
                { label: "التاريخ", value: ret.date },
                { label: "تاريخ الاستحقاق", value: ret.dueDate || "-" },
                { label: "رقم أمر الشراء", value: ret.poNumber || "-" },
                { label: "سبب الإرجاع", value: ret.returnReason || "-" },
                { label: "المخزن", value: ret.warehouse || "-" },
                { label: "اسم المخزن", value: ret.warehouseName || "-" },
                { label: "الحالة", value: ret.status },
              ].map(({ label, value }) => (
                <div key={label} className="space-y-1">
                  <div className="text-xs text-slate-500 text-right">{label}</div>
                  <div className="text-sm font-semibold text-right">{value}</div>
                </div>
              ))}
              {ret.notes && (
                <div className="md:col-span-3 space-y-1">
                  <div className="text-xs text-slate-500 text-right">ملاحظات</div>
                  <div className="text-sm text-right">{ret.notes}</div>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-amber-400 text-slate-800 px-4 py-2 text-right font-semibold">بنود المردود</div>
            <div className="p-4 overflow-x-auto">
              <table className="w-full text-sm text-right">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="px-3 py-2 border border-slate-200">#</th>
                    <th className="px-3 py-2 border border-slate-200">الوصف</th>
                    <th className="px-3 py-2 border border-slate-200">الكمية الأصلية</th>
                    <th className="px-3 py-2 border border-slate-200">تم إرجاعها</th>
                    <th className="px-3 py-2 border border-slate-200">السعر</th>
                    <th className="px-3 py-2 border border-slate-200">ضريبة%</th>
                    <th className="px-3 py-2 border border-slate-200">مركز التكلفة</th>
                    <th className="px-3 py-2 border border-slate-200">الإجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => {
                    const lineTotal = item.returnedQty * item.price;
                    const tax = (lineTotal * item.taxPercent) / 100;
                    return (
                      <tr key={idx}>
                        <td className="px-3 py-2 border border-slate-200">{idx + 1}</td>
                        <td className="px-3 py-2 border border-slate-200">{item.description}</td>
                        <td className="px-3 py-2 border border-slate-200">{item.originalQty}</td>
                        <td className="px-3 py-2 border border-slate-200 text-red-600 font-medium">{item.returnedQty}</td>
                        <td className="px-3 py-2 border border-slate-200">{item.price.toFixed(2)}</td>
                        <td className="px-3 py-2 border border-slate-200">{item.taxPercent}%</td>
                        <td className="px-3 py-2 border border-slate-200">{item.costCenter || "-"}</td>
                        <td className="px-3 py-2 border border-slate-200 font-medium text-red-600">{(lineTotal + tax).toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Shared Form Hook ── */
function useReturnForm(initial?: Partial<PurchaseReturn>) {
  const today = new Date().toISOString().split("T")[0];
  const [form, setForm] = useState({
    vendor: initial?.vendor ?? "",
    date: initial?.date ?? today,
    dueDate: initial?.dueDate ?? "",
    address: initial?.address ?? "",
    poNumber: initial?.poNumber ?? "",
    returnReason: initial?.returnReason ?? "",
    warehouse: initial?.warehouse ?? "",
    warehouseName: initial?.warehouseName ?? "",
    notes: initial?.notes ?? "",
    status: initial?.status ?? "مفتوح",
  });

  const [items, setItems] = useState<ReturnItem[]>(
    initial?.items && initial.items.length > 0
      ? initial.items.map((item, idx) => ({ ...item, id: idx + 1 }))
      : []
  );

  const setField = (field: keyof typeof form, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const addItem = () =>
    setItems((prev) => [...prev, { id: Date.now(), description: "", originalQty: 1, returnedQty: 1, price: 0, costCenter: "", taxPercent: 15 }]);

  const updateItem = (id: number, changes: Partial<ReturnItem>) =>
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...changes } : item)));

  const removeItem = (id: number) =>
    setItems((prev) => prev.filter((item) => item.id !== id));

  const totals = calcTotals(items);

  return { form, setField, items, addItem, updateItem, removeItem, totals };
}

/* ── Form Layout Component ── */
function ReturnFormLayout({
  title,
  icon,
  onBack,
  onSave,
  saving,
  error,
  form,
  setField,
  items,
  addItem,
  updateItem,
  removeItem,
  totals,
  accentBg = "bg-red-600",
  saveLabel = "حفظ المردود",
  saveBg = "bg-red-600 hover:bg-red-700",
}: {
  title: string;
  icon: React.ReactNode;
  onBack: () => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
  form: ReturnType<typeof useReturnForm>["form"];
  setField: ReturnType<typeof useReturnForm>["setField"];
  items: ReturnItem[];
  addItem: () => void;
  updateItem: (id: number, changes: Partial<ReturnItem>) => void;
  removeItem: (id: number) => void;
  totals: ReturnType<typeof useReturnForm>["totals"];
  accentBg?: string;
  saveLabel?: string;
  saveBg?: string;
}) {
  const inputClass = "w-full px-3 py-2 border border-slate-300 rounded text-sm text-right focus:border-red-400 focus:ring-1 focus:ring-red-400 outline-none";

  return (
    <div className="space-y-0 bg-slate-50 min-h-screen pb-12">
      {/* Header */}
      <div className="flex justify-between items-center bg-white p-4 border-b border-slate-200 shadow-sm">
        <div className="flex gap-2">
          <button onClick={onBack} disabled={saving} className="px-4 py-2 bg-slate-500 text-white text-sm rounded hover:bg-slate-600 flex items-center gap-1 disabled:opacity-50">
            <X className="h-4 w-4" /> إلغاء
          </button>
          <button onClick={onSave} disabled={saving} className={`px-4 py-2 text-white text-sm rounded flex items-center gap-2 disabled:opacity-60 ${saveBg}`}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? "جارٍ الحفظ..." : saveLabel}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-slate-800">{title}</h1>
          {icon}
        </div>
        <button onClick={onBack} disabled={saving} className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-sm rounded hover:bg-slate-50 flex items-center gap-2 disabled:opacity-50">
          العودة للقائمة <ArrowLeftRight className="h-4 w-4" />
        </button>
      </div>

      {error && <div className="mx-4 mt-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm text-right">{error}</div>}

      <div className="p-4 flex gap-4 items-start">
        {/* Left: Summary Panel */}
        <div className="w-52 shrink-0 space-y-4 sticky top-4">
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-slate-700 text-white px-4 py-2 text-right text-sm font-semibold">ملخص المردود</div>
            <div className="p-4 space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-slate-500 text-xs">المجموع الفرعي</span><span className="font-semibold">{totals.subtotal.toFixed(2)} ريال</span></div>
              <div className="flex justify-between"><span className="text-slate-500 text-xs">ضريبة القيمة المضافة</span><span className="font-semibold">{totals.vat.toFixed(2)}</span></div>
              <div className="flex justify-between border-t border-slate-200 pt-2"><span className="font-bold text-slate-800 text-xs">الإجمالي</span><span className="font-bold text-red-600">{totals.total.toFixed(2)} ريال</span></div>
            </div>
          </div>
          <button onClick={onSave} disabled={saving} className={`w-full py-2 text-white text-sm rounded flex items-center justify-center gap-2 disabled:opacity-60 ${saveBg}`}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? "جارٍ الحفظ..." : saveLabel}
          </button>
        </div>

        {/* Right: Form */}
        <div className="flex-1 space-y-4">
          {/* Header info */}
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
            <div className={`${accentBg} text-white px-4 py-2 text-right font-semibold`}>بيانات الفاتورة</div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-slate-600 text-right block">المورد <span className="text-red-500">*</span></label>
                <input value={form.vendor} onChange={(e) => setField("vendor", e.target.value)} placeholder="اسم المورد" className={inputClass} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600 text-right block">تاريخ الفاتورة</label>
                <input type="date" value={form.date} onChange={(e) => setField("date", e.target.value)} className={inputClass} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600 text-right block">تاريخ الاستحقاق</label>
                <input type="date" value={form.dueDate} onChange={(e) => setField("dueDate", e.target.value)} className={inputClass} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600 text-right block">العنوان</label>
                <input value={form.address} onChange={(e) => setField("address", e.target.value)} placeholder="العنوان" className={inputClass} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600 text-right block">رقم أمر الشراء</label>
                <input value={form.poNumber} onChange={(e) => setField("poNumber", e.target.value)} placeholder="PO-..." className={inputClass} />
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-slate-600 text-right block">سبب الإرجاع</label>
                <input value={form.returnReason} onChange={(e) => setField("returnReason", e.target.value)} placeholder="سبب الإرجاع..." className={inputClass} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600 text-right block">المخزن</label>
                <input value={form.warehouse} onChange={(e) => setField("warehouse", e.target.value)} placeholder="اسم المخزن" className={inputClass} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600 text-right block">اسم المخزن</label>
                <input value={form.warehouseName} onChange={(e) => setField("warehouseName", e.target.value)} placeholder="اسم مخزن إضافي" className={inputClass} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600 text-right block">الحالة</label>
                <select value={form.status} onChange={(e) => setField("status", e.target.value)} className={`${inputClass} appearance-none bg-white`}>
                  <option>مفتوح</option>
                  <option>قيد المراجعة</option>
                  <option>معتمد</option>
                  <option>ملغي</option>
                </select>
              </div>
              <div className="space-y-1 md:col-span-4">
                <label className="text-xs font-medium text-slate-600 text-right block">ملاحظات إضافية / توضيحات من المستخدم</label>
                <textarea value={form.notes} onChange={(e) => setField("notes", e.target.value)} rows={2} placeholder="أدخل أي ملاحظات أو توضيحات إضافية..." className={`${inputClass} resize-none`} />
              </div>
              <div className="space-y-1 md:col-span-4">
                <label className="text-xs font-medium text-slate-600 text-right block">مرفقات الفاتورة الأصلية</label>
                <div className="w-full px-3 py-3 border border-dashed border-slate-300 rounded text-sm text-right text-slate-400 bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors">
                  اضغط لرفع مرفق أو اسحب الملف هنا...
                </div>
              </div>
            </div>
          </div>

          {/* Items */}
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-amber-400 text-slate-800 px-4 py-2 flex items-center justify-between">
              <button onClick={addItem} className="bg-white text-amber-700 px-3 py-1 rounded text-sm font-medium hover:bg-amber-50 flex items-center gap-1">
                <Plus className="h-4 w-4" /> إضافة بند
              </button>
              <h2 className="font-semibold">بنود المردود</h2>
            </div>
            <div className="p-4 overflow-x-auto">
              {items.length === 0 ? (
                <div className="h-16 border border-dashed border-slate-300 rounded flex items-center justify-center text-slate-400 text-sm">
                  اضغط "إضافة بند" لإضافة بنود المردود
                </div>
              ) : (
                <table className="w-full text-sm text-right mb-2">
                  <thead>
                    <tr className="text-slate-600 border-b border-slate-200">
                      <th className="pb-2 font-medium w-10"></th>
                      <th className="pb-2 font-medium w-24">الإجمالي</th>
                      <th className="pb-2 font-medium w-32">مركز التكلفة</th>
                      <th className="pb-2 font-medium w-20">السعر</th>
                      <th className="pb-2 font-medium w-20">قيمة الإرجاع</th>
                      <th className="pb-2 font-medium w-24">تم إرجاعها</th>
                      <th className="pb-2 font-medium w-24">الكمية الأصلية</th>
                      <th className="pb-2 font-medium">الوصف</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, idx) => {
                      const lineTotal = item.returnedQty * item.price;
                      const tax = (lineTotal * item.taxPercent) / 100;
                      return (
                        <tr key={`ret-item-${idx}`}>
                          <td className="pt-3 align-top">
                            <div className="flex items-center justify-center h-10">
                              <button onClick={() => removeItem(item.id)} className="w-7 h-7 flex items-center justify-center bg-red-500 text-white rounded hover:bg-red-600">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                          <td className="pt-3 px-1 align-top">
                            <input type="text" value={(lineTotal + tax).toFixed(2)} disabled className="w-full px-2 py-2 border border-slate-200 bg-slate-100 rounded text-sm text-right outline-none h-10" />
                          </td>
                          <td className="pt-3 px-1 align-top">
                            <input type="text" value={item.costCenter} onChange={(e) => updateItem(item.id, { costCenter: e.target.value })} placeholder="مركز التكلفة" className="w-full px-2 py-2 border border-slate-300 rounded text-sm text-right focus:border-red-400 focus:ring-1 focus:ring-red-400 outline-none h-10" />
                          </td>
                          <td className="pt-3 px-1 align-top">
                            <input type="number" value={item.price} onChange={(e) => updateItem(item.id, { price: Number(e.target.value) || 0 })} className="w-full px-2 py-2 border border-slate-300 rounded text-sm text-right focus:border-red-400 focus:ring-1 focus:ring-red-400 outline-none h-10" />
                          </td>
                          <td className="pt-3 px-1 align-top">
                            <input type="text" value={lineTotal.toFixed(2)} disabled className="w-full px-2 py-2 border border-slate-200 bg-slate-100 rounded text-sm text-right outline-none h-10" />
                          </td>
                          <td className="pt-3 px-1 align-top">
                            <input type="number" value={item.returnedQty} onChange={(e) => updateItem(item.id, { returnedQty: Number(e.target.value) || 0 })} className="w-full px-2 py-2 border border-slate-300 rounded text-sm text-right focus:border-red-400 focus:ring-1 focus:ring-red-400 outline-none h-10" />
                          </td>
                          <td className="pt-3 px-1 align-top">
                            <input type="number" value={item.originalQty} onChange={(e) => updateItem(item.id, { originalQty: Number(e.target.value) || 0 })} className="w-full px-2 py-2 border border-slate-300 rounded text-sm text-right focus:border-red-400 focus:ring-1 focus:ring-red-400 outline-none h-10" />
                          </td>
                          <td className="pt-3 pl-1 align-top min-w-[160px]">
                            <input type="text" value={item.description} onChange={(e) => updateItem(item.id, { description: e.target.value })} placeholder="وصف البند..." className="w-full px-2 py-2 border border-slate-300 rounded text-sm text-right focus:border-red-400 focus:ring-1 focus:ring-red-400 outline-none h-10" />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Create Form ── */
function ReturnForm({ onBack, onSaved }: { onBack: () => void; onSaved: (r: PurchaseReturn) => void }) {
  const { form, setField, items, addItem, updateItem, removeItem, totals } = useReturnForm();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!form.date) { setError("يرجى إدخال تاريخ الفاتورة"); return; }
    setSaving(true);
    setError(null);

    const newId = crypto.randomUUID();
    const payload = {
      id: newId,
      vendor: form.vendor,
      date: form.date,
      due_date: form.dueDate || null,
      address: form.address || null,
      po_number: form.poNumber || null,
      return_reason: form.returnReason || null,
      warehouse: form.warehouse || null,
      warehouse_name: form.warehouseName || null,
      notes: form.notes || null,
      status: form.status,
      subtotal: totals.subtotal.toFixed(2),
      vat: totals.vat.toFixed(2),
      total: totals.total.toFixed(2),
      items: items.map((item) => ({
        id: item.id, description: item.description, originalQty: item.originalQty,
        returnedQty: item.returnedQty, price: item.price, costCenter: item.costCenter, taxPercent: item.taxPercent,
      })),
    };

    const { error: insertError } = await supabase.from("purchase_returns").insert([payload]);
    setSaving(false);

    if (insertError) { setError("حدث خطأ أثناء الحفظ: " + insertError.message); return; }

    onSaved({
      id: newId, ...form,
      subtotal: totals.subtotal.toFixed(2),
      vat: totals.vat.toFixed(2),
      total: totals.total.toFixed(2),
      statusColor: statusColors[form.status] ?? "bg-slate-500 text-white",
      items,
    });
  };

  return (
    <ReturnFormLayout
      title="إنشاء مردود مشتريات جديد"
      icon={<RotateCcw className="h-5 w-5 text-red-600" />}
      onBack={onBack} onSave={handleSave} saving={saving} error={error}
      form={form} setField={setField} items={items} addItem={addItem}
      updateItem={updateItem} removeItem={removeItem} totals={totals}
      saveLabel="حفظ المردود" saveBg="bg-red-600 hover:bg-red-700"
    />
  );
}

/* ── Edit Form ── */
function ReturnEdit({ ret, onBack, onUpdated }: { ret: PurchaseReturn; onBack: () => void; onUpdated: (r: PurchaseReturn) => void }) {
  const { form, setField, items, addItem, updateItem, removeItem, totals } = useReturnForm(ret);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    const { error: updateError } = await supabase
      .from("purchase_returns")
      .update({
        vendor: form.vendor, date: form.date, due_date: form.dueDate || null,
        address: form.address || null, po_number: form.poNumber || null,
        return_reason: form.returnReason || null, warehouse: form.warehouse || null,
        warehouse_name: form.warehouseName || null, notes: form.notes || null,
        status: form.status,
        subtotal: totals.subtotal.toFixed(2), vat: totals.vat.toFixed(2), total: totals.total.toFixed(2),
        items: items.map((item) => ({
          id: item.id, description: item.description, originalQty: item.originalQty,
          returnedQty: item.returnedQty, price: item.price, costCenter: item.costCenter, taxPercent: item.taxPercent,
        })),
      })
      .eq("id", ret.id);

    setSaving(false);
    if (!updateError) {
      onUpdated({
        ...ret, ...form,
        subtotal: totals.subtotal.toFixed(2), vat: totals.vat.toFixed(2), total: totals.total.toFixed(2),
        statusColor: statusColors[form.status] ?? "bg-slate-500 text-white",
        items,
      });
    } else {
      setError("تعذّر التحديث: " + updateError.message);
    }
  };

  return (
    <ReturnFormLayout
      title="تعديل مردود المشتريات"
      icon={<Edit className="h-5 w-5 text-emerald-600" />}
      onBack={onBack} onSave={handleSave} saving={saving} error={error}
      form={form} setField={setField} items={items} addItem={addItem}
      updateItem={updateItem} removeItem={removeItem} totals={totals}
      accentBg="bg-emerald-600" saveLabel="حفظ التعديلات" saveBg="bg-emerald-600 hover:bg-emerald-700"
    />
  );
}
