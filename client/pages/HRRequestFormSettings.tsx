import { useState, useEffect } from "react";
import { companyStorageKey } from "@/lib/companyProfile";
import Layout from "@/components/Layout";
import { ArrowLeft, ArrowRight, Plus, Trash2, Edit2, Save, ChevronDown, ChevronUp } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { requestFormSchemas } from "@/components/hr/formSchemas";
import type { FormSchema, FormField } from "@/components/hr/formSchemas";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useI18n } from "@/i18n";

const FIELD_TYPES = [
  { value: "text", label: "نص" },
  { value: "number", label: "رقم" },
  { value: "date", label: "تاريخ" },
  { value: "time", label: "وقت" },
  { value: "select", label: "قائمة منسدلة" },
  { value: "textarea", label: "نص طويل" },
  { value: "radio", label: "اختيار واحد" },
];

/** مفتاح المتصفح خاص بالمنشأة الحالية */
const storageKey = () => companyStorageKey("hr_request_form_customizations");

type SchemasMap = Record<string, FormSchema>;

function loadSchemas(): SchemasMap {
  try {
    const raw = localStorage.getItem(storageKey());
    if (raw) {
      const parsed = JSON.parse(raw) as SchemasMap;
      // Merge with defaults (defaults win for new schemas, custom wins for existing)
      const merged: SchemasMap = { ...requestFormSchemas };
      Object.keys(parsed).forEach((key) => {
        merged[key] = parsed[key];
      });
      return merged;
    }
  } catch {}
  return { ...requestFormSchemas };
}

function saveSchemas(schemas: SchemasMap) {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(schemas));
  } catch {}
}

export default function HRRequestFormSettings() {
  const navigate = useNavigate();
  const { t, direction, formatNumber } = useI18n();
  const BackIcon = direction === "rtl" ? ArrowRight : ArrowLeft;
  const [schemas, setSchemas] = useState<SchemasMap>(loadSchemas);
  const [activeSchemaId, setActiveSchemaId] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<number | null>(null);
  const [newField, setNewField] = useState<Partial<FormField>>({});
  const [showAddField, setShowAddField] = useState(false);

  const schemaList = Object.values(schemas);
  const activeSchema = activeSchemaId ? schemas[activeSchemaId] : null;

  // الحفظ معطّل: نماذج الطلبات الفعلية لا تقرأ هذه الإعدادات بعد، فلا نوهم المستخدم بأنها طُبّقت
  const SAVE_ENABLED = false;
  const handleSave = () => {
    if (!SAVE_ENABLED) {
      toast.error(t("هذه الإعدادات لا تُطبّق على النماذج بعد"));
      return;
    }
    saveSchemas(schemas);
    toast.success(t("تم حفظ إعدادات الحقول"));
  };

  const resetSchema = (id: string) => {
    if (!confirm(t("هل تريد إعادة تعيين هذا النموذج للإعدادات الافتراضية؟"))) return;
    setSchemas((prev) => ({ ...prev, [id]: requestFormSchemas[id] }));
    toast.success(t("تم إعادة تعيين النموذج"));
  };

  const updateField = (schemaId: string, fieldIndex: number, updates: Partial<FormField>) => {
    setSchemas((prev) => {
      const schema = prev[schemaId];
      if (!schema) return prev;
      const fields = [...schema.fields];
      fields[fieldIndex] = { ...fields[fieldIndex], ...updates };
      return { ...prev, [schemaId]: { ...schema, fields } };
    });
  };

  const removeField = (schemaId: string, fieldIndex: number) => {
    setSchemas((prev) => {
      const schema = prev[schemaId];
      if (!schema) return prev;
      const fields = schema.fields.filter((_, i) => i !== fieldIndex);
      return { ...prev, [schemaId]: { ...schema, fields } };
    });
  };

  const moveField = (schemaId: string, fieldIndex: number, dir: "up" | "down") => {
    setSchemas((prev) => {
      const schema = prev[schemaId];
      if (!schema) return prev;
      const fields = [...schema.fields];
      const swapIdx = dir === "up" ? fieldIndex - 1 : fieldIndex + 1;
      if (swapIdx < 0 || swapIdx >= fields.length) return prev;
      [fields[fieldIndex], fields[swapIdx]] = [fields[swapIdx], fields[fieldIndex]];
      return { ...prev, [schemaId]: { ...schema, fields } };
    });
  };

  const addField = (schemaId: string) => {
    if (!newField.name || !newField.label || !newField.type) {
      toast.error(t("يرجى تعبئة اسم الحقل، التسمية، والنوع"));
      return;
    }
    setSchemas((prev) => {
      const schema = prev[schemaId];
      if (!schema) return prev;
      const field: FormField = {
        name: newField.name!,
        label: newField.label!,
        type: newField.type as FormField["type"],
        required: newField.required ?? false,
        placeholder: newField.placeholder,
      };
      return { ...prev, [schemaId]: { ...schema, fields: [...schema.fields, field] } };
    });
    setNewField({});
    setShowAddField(false);
    toast.success(t("تم إضافة الحقل"));
  };

  return (
    <Layout>
      <div dir={direction} className="space-y-5">
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
          {t("هذه الإعدادات لا تُطبّق على النماذج بعد")}
        </div>
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <Edit2 className="h-5 w-5 text-blue-600" />
            {t("إعداد حقول الطلبات")}
          </h1>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={!SAVE_ENABLED}
              title={t("هذه الإعدادات لا تُطبّق على النماذج بعد")}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save className="h-4 w-4" />
              {t("حفظ التغييرات")}
            </button>
            <button
              onClick={() => navigate("/hr/requests/send")}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm hover:bg-gray-50 transition"
            >
              <BackIcon className="h-4 w-4" />
              {t("رجوع")}
            </button>
          </div>
        </div>

        <div className="flex gap-5 items-start">
          {/* ── Left: Schema List ── */}
          <div className="w-64 flex-shrink-0 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="bg-blue-700 px-4 py-2.5 text-white text-sm font-semibold">
              {t("نماذج الطلبات")} ({formatNumber(schemaList.length)})
            </div>
            <div className="divide-y divide-gray-100 max-h-[70vh] overflow-y-auto">
              {schemaList.map((schema) => (
                <button
                  key={schema.id}
                  onClick={() => { setActiveSchemaId(schema.id); setEditingField(null); setShowAddField(false); }}
                  className={cn(
                    "w-full text-start px-4 py-3 text-sm transition flex items-center justify-between",
                    activeSchemaId === schema.id
                      ? "bg-blue-50 text-blue-700 font-semibold"
                      : "text-gray-700 hover:bg-gray-50"
                  )}
                >
                  <span>{t(schema.title)}</span>
                  <span className="text-xs text-gray-400">{formatNumber(schema.fields.length)} {t("حقل")}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ── Right: Field Editor ── */}
          <div className="flex-1 min-w-0">
            {!activeSchema ? (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-16 text-center text-gray-400">
                {t("اختر نموذجاً من القائمة لتعديل حقوله")}
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                {/* Schema header */}
                <div className="bg-blue-700 px-5 py-3 flex items-center justify-between text-white">
                  <span className="font-semibold">{t("نموذج")}: {t(activeSchema.title)}</span>
                  <button
                    onClick={() => resetSchema(activeSchemaId!)}
                    className="text-xs px-3 py-1 rounded bg-white/20 hover:bg-white/30 transition"
                  >
                    {t("إعادة تعيين")}
                  </button>
                </div>

                {/* Fields Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-gray-200">
                        <th className="px-4 py-3 text-start font-semibold text-gray-600 whitespace-nowrap">{t("الترتيب")}</th>
                        <th className="px-4 py-3 text-start font-semibold text-gray-600 whitespace-nowrap">{t("اسم الحقل (عربي)")}</th>
                        <th className="px-4 py-3 text-start font-semibold text-gray-600 whitespace-nowrap">{t("المفتاح")}</th>
                        <th className="px-4 py-3 text-start font-semibold text-gray-600 whitespace-nowrap">{t("النوع")}</th>
                        <th className="px-4 py-3 text-center font-semibold text-gray-600 whitespace-nowrap">{t("إلزامي")}</th>
                        <th className="px-4 py-3 text-center font-semibold text-gray-600 whitespace-nowrap">{t("إجراءات")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeSchema.fields.map((field, idx) => (
                        <tr key={idx} className={cn("border-b border-gray-100 hover:bg-gray-50", editingField === idx && "bg-blue-50")}>
                          {editingField === idx ? (
                            <>
                              <td className="px-4 py-2 text-xs text-gray-400">{formatNumber(idx + 1)}</td>
                              <td className="px-4 py-2">
                                <input
                                  type="text"
                                  value={field.label}
                                  onChange={(e) => updateField(activeSchemaId!, idx, { label: e.target.value })}
                                  className="w-full border border-blue-300 rounded px-2 py-1 text-sm text-start focus:outline-none"
                                />
                              </td>
                              <td className="px-4 py-2">
                                <input
                                  type="text"
                                  value={field.name}
                                  onChange={(e) => updateField(activeSchemaId!, idx, { name: e.target.value })}
                                  className="w-full border border-blue-300 rounded px-2 py-1 text-sm text-start focus:outline-none font-mono"
                                />
                              </td>
                              <td className="px-4 py-2">
                                <select
                                  value={field.type}
                                  onChange={(e) => updateField(activeSchemaId!, idx, { type: e.target.value as FormField["type"] })}
                                  className="w-full border border-blue-300 rounded px-2 py-1 text-sm focus:outline-none"
                                >
                                  {FIELD_TYPES.map((fieldType) => (
                                    <option key={fieldType.value} value={fieldType.value}>{t(fieldType.label)}</option>
                                  ))}
                                </select>
                              </td>
                              <td className="px-4 py-2 text-center">
                                <input
                                  type="checkbox"
                                  checked={!!field.required}
                                  onChange={(e) => updateField(activeSchemaId!, idx, { required: e.target.checked })}
                                  className="w-4 h-4 rounded"
                                />
                              </td>
                              <td className="px-4 py-2">
                                <div className="flex items-center justify-center gap-1">
                                  <button
                                    onClick={() => setEditingField(null)}
                                    className="p-1 text-green-600 hover:bg-green-50 rounded"
                                    title={t("حفظ")}
                                  >
                                    <Save className="h-4 w-4" />
                                  </button>
                                </div>
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="px-4 py-3 text-gray-400 text-xs">
                                <div className="flex flex-col gap-0.5">
                                  <button onClick={() => moveField(activeSchemaId!, idx, "up")} disabled={idx === 0} className="disabled:opacity-30 hover:text-blue-600">
                                    <ChevronUp className="h-3.5 w-3.5" />
                                  </button>
                                  <button onClick={() => moveField(activeSchemaId!, idx, "down")} disabled={idx === activeSchema.fields.length - 1} className="disabled:opacity-30 hover:text-blue-600">
                                    <ChevronDown className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </td>
                              <td className="px-4 py-3 font-medium text-gray-800">{t(field.label)}</td>
                              <td className="px-4 py-3 font-mono text-gray-500 text-xs">{field.name}</td>
                              <td className="px-4 py-3 text-gray-600">
                                {t(FIELD_TYPES.find((fieldType) => fieldType.value === field.type)?.label ?? field.type)}
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span className={cn(
                                  "inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold border",
                                  field.required
                                    ? "bg-rose-50 text-rose-700 border-rose-200"
                                    : "bg-gray-100 text-gray-500 border-gray-200"
                                )}>
                                  {field.required ? t("إلزامي") : t("اختياري")}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center justify-center gap-1">
                                  <button
                                    onClick={() => setEditingField(idx)}
                                    className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                                    title={t("تعديل")}
                                  >
                                    <Edit2 className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    onClick={() => removeField(activeSchemaId!, idx)}
                                    className="p-1 text-rose-600 hover:bg-rose-50 rounded"
                                    title={t("حذف")}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Add field section */}
                <div className="border-t border-gray-100 p-4">
                  {!showAddField ? (
                    <button
                      onClick={() => setShowAddField(true)}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-dashed border-blue-400 text-blue-600 text-sm hover:bg-blue-50 transition"
                    >
                      <Plus className="h-4 w-4" />
                      {t("إضافة حقل جديد")}
                    </button>
                  ) : (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">{t("التسمية (عربي) *")}</label>
                        <input
                          type="text"
                          placeholder={t("مثال: رقم الطلب")}
                          value={newField.label || ""}
                          onChange={(e) => setNewField({ ...newField, label: e.target.value })}
                          className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm text-start focus:outline-none focus:border-blue-400"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">{t("المفتاح (إنجليزي) *")}</label>
                        <input
                          type="text"
                          placeholder={t("مثال: request_no")}
                          value={newField.name || ""}
                          onChange={(e) => setNewField({ ...newField, name: e.target.value.replace(/\s/g, "_") })}
                          className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-blue-400"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">{t("النوع *")}</label>
                        <select
                          value={newField.type || ""}
                          onChange={(e) => setNewField({ ...newField, type: e.target.value as FormField["type"] })}
                          className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-400"
                        >
                          <option value="">{t("-- اختر --")}</option>
                          {FIELD_TYPES.map((fieldType) => (
                            <option key={fieldType.value} value={fieldType.value}>{t(fieldType.label)}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-col gap-2">
                        <label className="flex items-center gap-2 text-sm mt-5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!!newField.required}
                            onChange={(e) => setNewField({ ...newField, required: e.target.checked })}
                            className="rounded"
                          />
                          {t("إلزامي")}
                        </label>
                      </div>
                      <div className="col-span-2 md:col-span-4 flex gap-2 justify-end">
                        <button
                          onClick={() => { setShowAddField(false); setNewField({}); }}
                          className="px-3 py-1.5 text-sm rounded border border-gray-300 bg-white hover:bg-gray-50"
                        >
                          {t("إلغاء")}
                        </button>
                        <button
                          onClick={() => addField(activeSchemaId!)}
                          className="px-4 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700"
                        >
                          {t("إضافة")}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
