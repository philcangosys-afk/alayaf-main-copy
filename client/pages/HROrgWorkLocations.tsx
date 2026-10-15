import { useState, useEffect } from "react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Edit, Save, X, Printer, FileText, MapPin, Navigation } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import WorkLocationMap from "@/components/hr/WorkLocationMap";
import { useI18n } from "@/i18n";
import { exportReportExcel, printReport, type ReportColumn } from "@/lib/reportExport";

type LocationRow = {
  id: string;
  name: string;
  nameEn: string;
  address: string;
  city: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  isDefault: boolean;
};

export default function HROrgWorkLocations() {
  const { t, direction, formatNumber } = useI18n();
  const [rows, setRows] = useState<LocationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formNameEn, setFormNameEn] = useState("");
  const [formAddress, setFormAddress] = useState("");
  const [formCity, setFormCity] = useState("");
  const [formStatus, setFormStatus] = useState("فعال");
  const [formLatitude, setFormLatitude] = useState("");
  const [formLongitude, setFormLongitude] = useState("");

  const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-400 outline-none";

  const loadData = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from("hr_work_locations").select("*").order("name");
      if (error) throw error;
      if (data) setRows(data.map((r: any) => ({
        id: String(r.id), name: String(r.name ?? ""), nameEn: String(r.name_en ?? ""),
        address: String(r.address ?? ""), city: String(r.city ?? ""), status: String(r.status ?? "فعال"),
        latitude: r.latitude == null ? null : Number(r.latitude),
        longitude: r.longitude == null ? null : Number(r.longitude),
        isDefault: Boolean(r.is_company_default),
      })));
    } catch (error: any) {
      setRows([]);
      toast({
        title: t("تعذر تحميل مواقع العمل"),
        description: error?.message || t("تحقق من صلاحيات قراءة مواقع العمل"),
        variant: "destructive",
      });
    } finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, []);

  const handleDelete = async (loc: LocationRow) => {
    if (loc.isDefault) {
      toast({ title: t("لا يمكن حذف الموقع الرئيسي"), description: t("غيّر الموقع الرئيسي من صفحة التحضير أولاً"), variant: "destructive" });
      return;
    }
    if (!confirm(`${t("حذف موقع")} "${loc.name}"؟`)) return;
    const { error } = await supabase.rpc("delete_hr_work_location", {
      p_id: loc.id,
    });
    if (error) {
      toast({
        title: t("تعذر حذف الموقع"),
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== loc.id));
    toast({ title: t("تم الحذف") });
  };

  const handleSave = async () => {
    if (!formName.trim()) { toast({ title: t("خطأ"), description: t("اسم موقع العمل مطلوب"), variant: "destructive" }); return; }
    const latitude = formLatitude.trim() ? Number(formLatitude) : null;
    const longitude = formLongitude.trim() ? Number(formLongitude) : null;
    if (
      (latitude == null) !== (longitude == null) ||
      (latitude != null && (
        !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
        latitude < -90 || latitude > 90 || Number(longitude) < -180 || Number(longitude) > 180
      ))
    ) {
      toast({ title: t("إحداثيات غير صحيحة"), description: t("أدخل خط العرض وخط الطول ضمن النطاق الصحيح"), variant: "destructive" });
      return;
    }
    const result = await supabase.rpc("save_hr_work_location", {
      p_id: editingId,
      p_name: formName,
      p_name_en: formNameEn,
      p_address: formAddress,
      p_city: formCity,
      p_status: formStatus,
      p_latitude: latitude,
      p_longitude: longitude,
    });
    if (result.error) {
      toast({ title: t("تعذر حفظ الموقع"), description: result.error.message, variant: "destructive" });
      return;
    }
    toast({ title: editingId ? t("تم التعديل") : t("تمت الإضافة") });
    resetForm(); loadData();
  };

  const startEdit = (loc: LocationRow) => {
    setEditingId(loc.id); setFormName(loc.name); setFormNameEn(loc.nameEn); setFormAddress(loc.address); setFormCity(loc.city); setFormStatus(loc.status);
    setFormLatitude(loc.latitude == null ? "" : String(loc.latitude));
    setFormLongitude(loc.longitude == null ? "" : String(loc.longitude));
    setShowForm(true);
  };

  const captureLocation = () => {
    if (!navigator.geolocation) {
      toast({ title: t("الجهاز لا يدعم تحديد الموقع"), variant: "destructive" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setFormLatitude(position.coords.latitude.toFixed(7));
        setFormLongitude(position.coords.longitude.toFixed(7));
        toast({ title: t("تم التقاط الموقع الحالي") });
      },
      () => toast({ title: t("يرجى السماح بالوصول إلى الموقع"), variant: "destructive" }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  // الطباعة والتصدير لمواقع العمل المعروضة
  const locationReport = () => {
    const columns: ReportColumn[] = [{ key: "name", label: t("اسم الموقع"), width: 24 }, { key: "nameEn", label: t("الاسم بالإنجليزية"), width: 24 }, { key: "city", label: t("المدينة"), width: 14 }, { key: "address", label: t("العنوان"), width: 30 }, { key: "coordinates", label: t("إحداثيات الحضور"), width: 26 }, { key: "status", label: t("الحالة"), width: 12 }];
    const reportRows = rows.map((row) => ({ name: row.name, nameEn: row.nameEn, city: row.city, address: row.address, coordinates: row.latitude != null && row.longitude != null ? `${row.latitude}, ${row.longitude}${row.isDefault ? ` (${t("الرئيسي")})` : ""}` : t("غير محدد"), status: t(row.status) }));
    return { title: t("مواقع العمل"), columns, rows: reportRows, fileName: "work-locations", landscape: true, summary: [{ label: t("إجمالي"), value: rows.length }] };
  };
  const printLocations = () => {
    if (!printReport(locationReport())) toast({ title: t("تعذر فتح نافذة الطباعة"), description: t("اسمح بالنوافذ المنبثقة لهذا الموقع"), variant: "destructive" });
  };
  const exportLocations = () => exportReportExcel(locationReport());

  const resetForm = () => { setShowForm(false); setEditingId(null); setFormName(""); setFormNameEn(""); setFormAddress(""); setFormCity(""); setFormStatus("فعال"); setFormLatitude(""); setFormLongitude(""); };

  return (
    <Layout>
      <div className="p-6 max-w-[1200px] mx-auto space-y-5" dir={direction}>
        <div className="flex justify-between items-center bg-white p-4 rounded-lg border shadow-sm">
          <div className="flex gap-2">
            <Button variant="outline" size="icon" onClick={printLocations} disabled={!rows.length} title={t("طباعة")} aria-label={t("طباعة")}><Printer className="h-4 w-4 text-blue-600" /></Button>
            <Button variant="outline" size="icon" onClick={exportLocations} disabled={!rows.length} title={t("تصدير")} aria-label={t("تصدير")}><FileText className="h-4 w-4 text-blue-600" /></Button>
            <Button className="bg-[#004e89] hover:bg-[#003d6d] text-white gap-1" onClick={() => { resetForm(); setShowForm(true); }}>
              <Plus className="h-4 w-4" /> {t("إضافة موقع")}
            </Button>
          </div>
          <h1 className="font-bold text-xl text-[#004e89] flex items-center gap-2"><MapPin className="h-5 w-5" /> {t("مواقع العمل")}</h1>
        </div>

        {showForm && (
          <div className="bg-white rounded-lg border shadow-sm p-6 space-y-4">
            <h3 className="font-bold text-lg">{editingId ? t("تعديل موقع") : t("إضافة موقع عمل جديد")}</h3>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium mb-1">{t("اسم الموقع")} *</label><input value={formName} onChange={(e) => setFormName(e.target.value)} className={inputCls} /></div>
              <div><label className="block text-sm font-medium mb-1">{t("اسم الموقع بالإنجليزية")}</label><input value={formNameEn} onChange={(e) => setFormNameEn(e.target.value)} className={inputCls} /></div>
              <div><label className="block text-sm font-medium mb-1">{t("العنوان")}</label><input value={formAddress} onChange={(e) => setFormAddress(e.target.value)} className={inputCls} /></div>
              <div><label className="block text-sm font-medium mb-1">{t("المدينة")}</label><input value={formCity} onChange={(e) => setFormCity(e.target.value)} className={inputCls} /></div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("الحالة")}</label>
                <select value={formStatus} onChange={(e) => setFormStatus(e.target.value)} className={inputCls}>
                  <option value="فعال">{t("فعال")}</option><option value="غير فعال">{t("غير فعال")}</option>
                </select>
              </div>
              <div><label className="block text-sm font-medium mb-1">{t("خط العرض")}</label><input type="number" step="any" value={formLatitude} onChange={(e) => setFormLatitude(e.target.value)} className={inputCls} placeholder="21.3891" /></div>
              <div><label className="block text-sm font-medium mb-1">{t("خط الطول")}</label><input type="number" step="any" value={formLongitude} onChange={(e) => setFormLongitude(e.target.value)} className={inputCls} placeholder="39.8579" /></div>
              <div className="flex items-end"><Button type="button" variant="outline" onClick={captureLocation} className="w-full gap-2"><Navigation className="h-4 w-4" /> {t("استخدام موقعي الحالي")}</Button></div>
            </div>
            <WorkLocationMap
              latitude={formLatitude}
              longitude={formLongitude}
              initialSearch={formAddress}
              onLocationChange={(latitude, longitude) => {
                setFormLatitude(latitude);
                setFormLongitude(longitude);
              }}
              onPlaceSelected={(address, city) => {
                setFormAddress(address);
                if (city) setFormCity(city);
              }}
            />
            <p className="text-xs text-slate-500">{t("الموقع الذي يحتوي على إحداثيات يمكن تعيينه للموظفين كنطاق حضور بمسافة 10 أمتار.")}</p>
            <div className="flex gap-2">
              <Button onClick={handleSave} className="bg-[#004e89] hover:bg-[#003d6d] text-white gap-1"><Save className="h-4 w-4" /> {t("حفظ")}</Button>
              <Button variant="outline" onClick={resetForm} className="gap-1"><X className="h-4 w-4" /> {t("إلغاء")}</Button>
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
          <table className="w-full text-sm text-start">
            <thead className="bg-[#004e89] text-white">
              <tr>
                <th className="py-3 px-4">#</th>
                <th className="py-3 px-4">{t("اسم الموقع")}</th>
                <th className="py-3 px-4">{t("الاسم بالإنجليزية")}</th>
                <th className="py-3 px-4">{t("المدينة")}</th>
                <th className="py-3 px-4">{t("العنوان")}</th>
                <th className="py-3 px-4">{t("إحداثيات الحضور")}</th>
                <th className="py-3 px-4 text-center">{t("الحالة")}</th>
                <th className="py-3 px-4 text-center w-24">{t("الإجراءات")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading ? (
                <tr><td colSpan={8} className="text-center py-8 text-gray-400">{t("جاري التحميل...")}</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-8 text-gray-400">{t("لا توجد مواقع عمل")}</td></tr>
              ) : rows.map((row, i) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="py-3 px-4">{i + 1}</td>
                  <td className="py-3 px-4 font-medium">{row.name}</td>
                  <td className="py-3 px-4 text-gray-600">{row.nameEn}</td>
                  <td className="py-3 px-4">{row.city}</td>
                  <td className="py-3 px-4 text-gray-600">{row.address}</td>
                  <td className="py-3 px-4 text-xs font-mono text-gray-600">
                    {row.latitude != null && row.longitude != null ? `${row.latitude}, ${row.longitude}` : t("غير محدد")}
                    {row.isDefault && <span className="ms-2 rounded bg-violet-100 px-2 py-0.5 font-sans text-violet-700">{t("الرئيسي")}</span>}
                  </td>
                  <td className="py-3 px-4 text-center"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${row.status === "فعال" ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-600"}`}>{t(row.status)}</span></td>
                  <td className="py-3 px-4">
                    <div className="flex justify-center gap-2">
                      <button onClick={() => startEdit(row)} title={t("تعديل")} aria-label={t("تعديل")} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg"><Edit className="h-4 w-4" /></button>
                      <button onClick={() => handleDelete(row)} title={t("حذف")} aria-label={t("حذف")} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-gray-500">{t("إجمالي")}: {formatNumber(rows.length)} {t("مواقع العمل")}</p>
      </div>
    </Layout>
  );
}
