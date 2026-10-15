import { useEffect, useMemo, useState } from "react";
import Layout from "@/components/Layout";
import { Eye, FileText, Plus, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n";
import { hrRequestErrorText } from "@/lib/hrErrors";
import { riyadhToday } from "@/lib/hrDates";

type Employee = {
  id: string;
  empId: string;
  name: string;
  department: string;
};

type Option = {
  id: string;
  name: string;
};

type Investigation = {
  id: string;
  empId: string;
  empName: string;
  department: string;
  date: string;
  sentAt: string;
  senderName: string;
  groupName: string;
  typeName: string;
  subject: string;
  message: string;
  status: string;
};

// يُحسب تاريخ اليوم عند إنشاء النموذج أو تفريغه، لا مرة واحدة عند تحميل الملف
const createEmptyForm = () => ({
  employeeId: "",
  date: riyadhToday(),
  groupId: "",
  typeId: "",
  subject: "",
  message: "السلام عليكم ورحمة الله وبركاته\nنحيطكم علماً بوجود مخالفة تتطلب إفادتكم، ونرجو توضيح أسباب الواقعة وإرسال الرد للإدارة.",
});

export default function HRPenaltiesInvestigations() {
  const { t, direction } = useI18n();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [groups, setGroups] = useState<Option[]>([]);
  const [types, setTypes] = useState<Option[]>([]);
  const [investigations, setInvestigations] = useState<Investigation[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);
  // عرض مساءلة مرسلة: للقراءة فقط، لا يلمس نموذج المسودة ولا يتيح إعادة الإرسال
  const [viewItem, setViewItem] = useState<Investigation | null>(null);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(createEmptyForm);

  const loadData = async () => {
    setLoading(true);
    try {
      const [employeesResult, groupsResult, typesResult, investigationsResult] = await Promise.all([
        supabase
          .from("employees")
          .select("id, emp_id, name, department, status")
          .order("name"),
        supabase.from("penalty_groups").select("id, name").order("name"),
        supabase.from("penalty_types").select("id, name_ar, status").order("name_ar"),
        supabase.from("penalty_investigations").select("*").order("sent_at", { ascending: false }),
      ]);

      if (employeesResult.error) throw employeesResult.error;
      if (groupsResult.error) throw groupsResult.error;
      if (typesResult.error) throw typesResult.error;
      if (investigationsResult.error) throw investigationsResult.error;

      const employeeRows: Employee[] = (employeesResult.data ?? []).map((row: any) => ({
        id: String(row.id),
        empId: String(row.emp_id ?? row.id),
        name: String(row.name ?? ""),
        department: String(row.department ?? ""),
      }));

      setEmployees(employeeRows);
      setGroups((groupsResult.data ?? []).map((row: any) => ({ id: String(row.id), name: String(row.name ?? "") })));
      setTypes((typesResult.data ?? []).map((row: any) => ({ id: String(row.id), name: String(row.name_ar ?? "") })));
      setInvestigations(
        (investigationsResult.data ?? []).map((row: any) => ({
          id: String(row.id),
          empId: String(row.emp_id ?? ""),
          empName: String(row.emp_name ?? ""),
          department: employeeRows.find((employee) => employee.empId === String(row.emp_id))?.department ?? "",
          date: String(row.investigation_date ?? ""),
          sentAt: String(row.sent_at ?? ""),
          senderName: String(row.sender_name ?? "الإدارة"),
          groupName: String(row.penalty_group_name ?? ""),
          typeName: String(row.penalty_type_name ?? ""),
          subject: String(row.subject ?? ""),
          message: String(row.message ?? ""),
          status: String(row.status ?? "مرسلة"),
        }))
      );
    } catch (error) {
      toast({
        title: t("تعذر تحميل المساءلات"),
        description: error instanceof Error ? error.message : t("حدث خطأ غير متوقع"),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const selectedEmployee = employees.find((employee) => employee.id === form.employeeId);
  const selectedGroup = groups.find((group) => group.id === form.groupId);
  const selectedType = types.find((type) => type.id === form.typeId);

  const validateForm = () => {
    if (!selectedEmployee || !form.date || !selectedGroup || !selectedType || !form.subject.trim() || !form.message.trim()) {
      toast({ title: t("أكمل الحقول المطلوبة"), description: t("الموظف والتاريخ والمخالفة والموضوع ونص المساءلة مطلوبة"), variant: "destructive" });
      return false;
    }
    return true;
  };

  const handlePreview = () => {
    if (validateForm()) setPreviewOpen(true);
  };

  const handleSave = async () => {
    if (!validateForm() || !selectedEmployee || !selectedGroup || !selectedType) return;

    setSaving(true);
    try {
      const session = JSON.parse(localStorage.getItem("user_session") || "{}");
      const { error } = await supabase.from("penalty_investigations").insert({
        emp_id: selectedEmployee.empId,
        emp_name: selectedEmployee.name,
        employee_record_id: selectedEmployee.id,
        investigation_date: form.date,
        penalty_group_id: selectedGroup.id,
        penalty_group_name: selectedGroup.name,
        penalty_type_id: selectedType.id,
        penalty_type_name: selectedType.name,
        subject: form.subject.trim(),
        message: form.message.trim(),
        status: "مرسلة",
        sender_name: session.name || "الإدارة",
      });

      if (error) throw error;

      toast({ title: t("تم إرسال المساءلة"), description: `${t("تم إرسال المساءلة إلى")} ${selectedEmployee.name}` });
      setForm(createEmptyForm());
      setPreviewOpen(false);
      setShowForm(false);
      await loadData();
    } catch (error) {
      toast({
        title: t("تعذر إرسال المساءلة"),
        description: t(hrRequestErrorText(error)),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const filtered = useMemo(() => {
    const keyword = search.trim();
    if (!keyword) return investigations;
    return investigations.filter((item) =>
      [item.empName, item.department, item.groupName, item.typeName, item.subject, item.status].some((value) => value.includes(keyword))
    );
  }, [investigations, search]);

  return (
    <Layout>
      <div className="w-full p-4 space-y-5" dir={direction}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t("المساءلات")}</h1>
            <p className="mt-1 text-sm text-gray-500">{t("إنشاء مساءلة وإرسالها مباشرة إلى لوحة الموظف")}</p>
          </div>
          <Button
            onClick={() => setShowForm((current) => !current)}
            className="bg-[#004e89] hover:bg-[#003d6d] text-white"
          >
            {showForm ? <X className="h-4 w-4 ml-2" /> : <Plus className="h-4 w-4 ml-2" />}
            {showForm ? t("إغلاق النموذج") : t("إرسال مساءلة")}
          </Button>
        </div>

        {showForm && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-900">{t("إرسال مساءلة")}</h2>
            </div>

            <div className="p-5 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <Field label={t("الموظف")} required>
                  <select
                    value={form.employeeId}
                    onChange={(event) => setForm((current) => ({ ...current, employeeId: event.target.value }))}
                    className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-[#004e89]"
                  >
                    <option value="">{t("اختر الموظف")}</option>
                    {employees.map((employee) => (
                      <option key={employee.id} value={employee.id}>{employee.name}</option>
                    ))}
                  </select>
                </Field>

                <Field label={t("التاريخ")} required>
                  <Input type="date" value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} />
                </Field>

                <Field label={t("مجموعات المخالفات")} required>
                  <select
                    value={form.groupId}
                    onChange={(event) => setForm((current) => ({ ...current, groupId: event.target.value }))}
                    className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-[#004e89]"
                  >
                    <option value="">{t("اختر مجموعة المخالفات")}</option>
                    {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                  </select>
                </Field>

                <Field label={t("المخالفة")} required>
                  <select
                    value={form.typeId}
                    onChange={(event) => setForm((current) => ({ ...current, typeId: event.target.value }))}
                    className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-[#004e89]"
                  >
                    <option value="">{t("اختر المخالفة")}</option>
                    {types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
                  </select>
                </Field>

                <div className="md:col-span-2">
                  <Field label={t("الموضوع")} required>
                    <Input
                      value={form.subject}
                      onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))}
                      placeholder={t("اكتب عنوان المساءلة")}
                    />
                  </Field>
                </div>

                <div className="md:col-span-2">
                  <Field label={t("نص المساءلة")} required>
                    <textarea
                      value={form.message}
                      onChange={(event) => setForm((current) => ({ ...current, message: event.target.value }))}
                      rows={5}
                      className="w-full rounded-md border border-gray-300 px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-[#004e89] resize-y"
                    />
                  </Field>
                </div>
              </div>

              <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
                <Button variant="outline" onClick={handlePreview}><Eye className="h-4 w-4 ml-2" /> {t("معاينة")}</Button>
                <Button onClick={handleSave} disabled={saving} className="bg-[#004e89] hover:bg-[#003d6d] text-white">
                  {saving ? t("جاري الإرسال...") : t("حفظ وإرسال")}
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-3">
            <h2 className="font-bold text-gray-900">{t("سجل المساءلات")} ({filtered.length})</h2>
            <div className="relative w-full sm:w-80">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("بحث في المساءلات")} className="pr-9" />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px] text-sm text-right">
              <thead className="bg-[#004e89] text-white">
                <tr>
                  <th className="py-3 px-4">{t("رقم المساءلة")}</th>
                  <th className="py-3 px-4">{t("التاريخ")}</th>
                  <th className="py-3 px-4">{t("اسم الموظف")}</th>
                  <th className="py-3 px-4">{t("الإدارة")}</th>
                  <th className="py-3 px-4">{t("المخالفة")}</th>
                  <th className="py-3 px-4">{t("الموضوع")}</th>
                  <th className="py-3 px-4">{t("الحالة")}</th>
                  <th className="py-3 px-4 text-center">{t("عرض")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr><td colSpan={8} className="py-10 text-center text-gray-400">{t("جاري التحميل...")}</td></tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-gray-500">
                      <FileText className="h-10 w-10 mx-auto mb-2 text-gray-300" />
                      {t("لا توجد مساءلات مرسلة")}
                    </td>
                  </tr>
                ) : filtered.map((item, index) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="py-3 px-4 font-medium">{String(filtered.length - index).padStart(4, "0")}</td>
                    <td className="py-3 px-4">{item.date}</td>
                    <td className="py-3 px-4 font-medium">{item.empName}</td>
                    <td className="py-3 px-4">{item.department || "—"}</td>
                    <td className="py-3 px-4">{item.typeName || "—"}</td>
                    <td className="py-3 px-4">{item.subject}</td>
                    <td className="py-3 px-4"><span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs text-blue-700">{t(item.status)}</span></td>
                    <td className="py-3 px-4 text-center">
                      <button
                        type="button"
                        onClick={() => setViewItem(item)}
                        className="text-[#004e89] hover:text-[#003d6d]"
                        aria-label={`${t("عرض مساءلة")} ${item.empName}`}
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {viewItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir={direction}>
            <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl overflow-hidden">
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
                <h3 className="text-xl font-bold text-gray-900">{t("عرض مساءلة")}</h3>
                <button type="button" onClick={() => setViewItem(null)} className="text-gray-500 hover:text-gray-900"><X className="h-5 w-5" /></button>
              </div>
              <div className="p-6 space-y-5">
                <div className="text-center border-b border-gray-100 pb-4">
                  <h4 className="text-2xl font-bold text-[#004e89]">{t("مساءلة إدارية")}</h4>
                  <p className="mt-1 text-sm text-gray-500">{t("التاريخ")}: {viewItem.date || "—"}</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  <PreviewItem label={t("الموظف")} value={viewItem.empName || "—"} />
                  <PreviewItem label={t("مجموعة المخالفة")} value={viewItem.groupName || "—"} />
                  <PreviewItem label={t("المخالفة")} value={viewItem.typeName || "—"} />
                  <PreviewItem label={t("الموضوع")} value={viewItem.subject || "—"} />
                  <PreviewItem label={t("الحالة")} value={t(viewItem.status)} />
                  <PreviewItem label={t("المرسل")} value={viewItem.senderName || "—"} />
                </div>
                <div className="rounded-lg bg-gray-50 p-4 whitespace-pre-wrap leading-7 text-gray-800">{viewItem.message}</div>
              </div>
              <div className="flex justify-end gap-3 border-t border-gray-100 px-5 py-4">
                <Button variant="outline" onClick={() => setViewItem(null)}>{t("إغلاق")}</Button>
              </div>
            </div>
          </div>
        )}

        {previewOpen && !viewItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir={direction}>
            <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl overflow-hidden">
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
                <h3 className="text-xl font-bold text-gray-900">{t("معاينة المساءلة")}</h3>
                <button type="button" onClick={() => setPreviewOpen(false)} className="text-gray-500 hover:text-gray-900"><X className="h-5 w-5" /></button>
              </div>
              <div className="p-6 space-y-5">
                <div className="text-center border-b border-gray-100 pb-4">
                  <h4 className="text-2xl font-bold text-[#004e89]">{t("مساءلة إدارية")}</h4>
                  <p className="mt-1 text-sm text-gray-500">{t("التاريخ")}: {form.date}</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  <PreviewItem label={t("الموظف")} value={selectedEmployee?.name || "—"} />
                  <PreviewItem label={t("مجموعة المخالفة")} value={selectedGroup?.name || "—"} />
                  <PreviewItem label={t("المخالفة")} value={selectedType?.name || "—"} />
                  <PreviewItem label={t("الموضوع")} value={form.subject || "—"} />
                </div>
                <div className="rounded-lg bg-gray-50 p-4 whitespace-pre-wrap leading-7 text-gray-800">{form.message}</div>
              </div>
              <div className="flex justify-end gap-3 border-t border-gray-100 px-5 py-4">
                <Button variant="outline" onClick={() => setPreviewOpen(false)}>{t("رجوع")}</Button>
                <Button onClick={handleSave} disabled={saving} className="bg-[#004e89] hover:bg-[#003d6d] text-white">
                  {saving ? t("جاري الإرسال...") : t("حفظ وإرسال للموظف")}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-gray-700">{label}{required && <span className="text-red-600"> *</span>}</span>
      {children}
    </label>
  );
}

function PreviewItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block text-xs text-gray-500 mb-1">{label}</span>
      <span className="font-medium text-gray-900">{value}</span>
    </div>
  );
}
