import { useEffect, useMemo, useState } from "react";
import { Edit3, Plus, Search, Trash2, UserRound } from "lucide-react";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import { permissionLevelAny } from "@/lib/authSession";
import { ID_TYPES, hotelErrorText, loadGuests, nationalAddress, optionLabel, type HotelGuest, type Option } from "@/lib/hotel";
import GuestFormModal, { loadCustomerOptions } from "@/components/hotel/GuestFormModal";
import { ErrorNote, HotelButton, HotelConfirm, HotelHeader, useHotelDate } from "@/components/hotel/HotelUi";
import { DataImportButton } from "@/components/DataImportDialog";
import { hotelGuestsImportSpec } from "@/lib/imports/hotel";

/** النزلاء: بياناتهم وهويتهم وعنوانهم الوطني (للفاتورة)، والربط الاختياري بشركة من العملاء */
export default function HotelGuests() {
  const { t, direction, formatNumber, locale } = useI18n();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const importSpec = useMemo(() => hotelGuestsImportSpec(t), [locale]);
  const formatDate = useHotelDate();
  const { permissions } = useRolePermissions();
  const canManage = permissionLevelAny(permissions, ["hotel.reservations", "module.hotel"]) === "manage";
  const [guests, setGuests] = useState<HotelGuest[]>([]);
  const [customers, setCustomers] = useState<Option[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<HotelGuest | null | undefined>(undefined);
  const [removing, setRemoving] = useState<HotelGuest | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const [result, customerList] = await Promise.all([loadGuests(), loadCustomerOptions()]);
    setLoading(false);
    setGuests(result.data);
    setCustomers(customerList);
    setError(result.error ? hotelErrorText(result.error.message, t) : "");
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? guests.filter((g) => `${g.fullName} ${g.phone} ${g.idNumber} ${g.email}`.toLowerCase().includes(q)) : guests;
  }, [guests, search]);
  const customerName = (id: string) => customers.find((c) => c.value === id)?.label ?? "";

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    const { error: removeError } = await supabase.rpc("hotel_delete_guest", { p_id: removing.id });
    setBusy(false);
    if (removeError) { toast({ title: t("تعذر حذف النزيل"), description: hotelErrorText(removeError.message, t), variant: "destructive" }); return; }
    toast({ title: t("حُذف النزيل") });
    setRemoving(null);
    await load();
  };

  return (
    <Layout>
      <main dir={direction} className="space-y-5">
        <HotelHeader
          icon={UserRound}
          title="النزلاء"
          description="سجل النزلاء. الهوية مطلوبة عند تسجيل الدخول، والعنوان الوطني الكامل يظهر في فاتورة المغادرة."
          actions={canManage ? (
            <>
              <DataImportButton spec={importSpec} onDone={() => void load()} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50" />
              <HotelButton onClick={() => setEditing(null)}><Plus className="h-4 w-4" />{t("نزيل جديد")}</HotelButton>
            </>
          ) : undefined}
        />
        <ErrorNote message={error} />
        <section className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-slate-50 px-4 py-3">
            <div className="relative w-full max-w-sm">
              <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("ابحث بالاسم أو الجوال أو الهوية")} className="h-9 w-full rounded-lg border bg-white ps-9 pe-3 text-sm" />
            </div>
            <span className="text-xs text-slate-500">{formatNumber(visible.length)} {t("نزيل")}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="p-3 text-start">{t("الاسم")}</th><th className="p-3">{t("الجوال")}</th><th className="p-3">{t("الهوية")}</th>
                  <th className="p-3">{t("الجنسية")}</th><th className="p-3">{t("العنوان الوطني")}</th><th className="p-3">{t("الشركة")}</th>
                  <th className="p-3">{t("أُضيف")}</th><th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {loading ? <tr><td colSpan={8} className="py-14 text-center text-slate-500">{t("جاري التحميل...")}</td></tr>
                  : visible.length === 0 ? <tr><td colSpan={8} className="py-14 text-center text-slate-400">{t("لا يوجد نزلاء")}</td></tr>
                  : visible.map((g) => (
                    <tr key={g.id} className="border-t">
                      <td className="p-3 font-semibold text-slate-900">{g.fullName}</td>
                      <td className="p-3 text-center" dir="ltr">{g.phone || "—"}</td>
                      <td className="p-3 text-center">{g.idNumber ? <><span className="block text-xs text-slate-500">{t(optionLabel(ID_TYPES, g.idType))}</span><span className="font-mono">{g.idNumber}</span></> : <span className="text-xs text-amber-700">{t("غير مسجلة")}</span>}</td>
                      <td className="p-3 text-center">{g.nationality || "—"}</td>
                      <td className="p-3 text-center text-xs">{nationalAddress(g) ? <span className="text-emerald-700">{t("مكتمل")}</span> : <span className="text-slate-400">{t("غير مكتمل")}</span>}</td>
                      <td className="p-3 text-center text-xs">{g.customerId ? customerName(g.customerId) || "✓" : "—"}</td>
                      <td className="p-3 text-center text-xs text-slate-500">{g.createdAt ? formatDate(g.createdAt, { dateStyle: "medium" }) : "—"}</td>
                      <td className="p-3">
                        {canManage && (
                          <div className="flex justify-center gap-1">
                            <button onClick={() => setEditing(g)} className="rounded border p-2 text-[#7a2450]" title={t("تعديل")}><Edit3 className="h-4 w-4" /></button>
                            <button onClick={() => setRemoving(g)} className="rounded border p-2 text-red-600" title={t("حذف")}><Trash2 className="h-4 w-4" /></button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>

        {editing !== undefined && (
          <GuestFormModal guest={editing} customers={customers} onClose={() => setEditing(undefined)}
            onSaved={() => { setEditing(undefined); toast({ title: t("حُفظ النزيل") }); void load(); }} />
        )}
        {removing && (
          <HotelConfirm
            title="حذف نزيل"
            message={`${t("حذف")} «${removing.fullName}»؟ ${t("النزيل الذي له حجوزات لا يُحذف.")}`}
            confirmLabel="حذف النزيل"
            danger
            busy={busy}
            onClose={() => setRemoving(null)}
            onConfirm={() => void remove()}
          />
        )}
      </main>
    </Layout>
  );
}
