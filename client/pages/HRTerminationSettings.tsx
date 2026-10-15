import { useEffect, useRef, useState } from "react";
import Layout from "@/components/Layout";
import { Plus, Printer, Download, Save, Trash2, Edit, X, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n";

const MAIN_SETTINGS_KEY = "termination_main_settings";
const MAIN_SETTINGS_DEFAULT = {
  autoApprove: "no",
  approver1: "",
  approver2: "",
  approver3: "",
  gratuityBase: "basic",
  calcLessThanYear: "no",
  rate5andBelow: "half",
  rateAbove5: "full",
  calcDayOfEnd: "no",
};

const CLEARANCE_KEY = "termination_clearance_template";
const RELEASE_KEY = "termination_release_template";

const CLEARANCE_DEFAULT = `<p>أقر بأني استلمت من / (company_name) جميع الأموال والمبالغ المستحقة لي عن مختلف الأنواع الناتجة عن عملي وحتى انتهاء فترة خدمتي من (joining_date) إلى (termination_date) سواء كان مصدرها الرواتب الأساسية أو الإضافية أو البدلات النقدية أو العينية أو ساعات العمل الإضافية أو مستحقات إجازات السنوية أو مستحقات نهاية الخدمة أو أي مصدر آخر عادي أو استثنائي.</p><p><br></p><p>ويعتبر موافقتي على نموذج مخالصة الذمة تامة ونهائية ولا يحق لي بموجبها إقامة أي دعوى متعلقة بعقد العمل في أي وقت لدى أي جهة قضائية أو شبه قضائية داخل المملكة العربية السعودية أو خارجها.</p><p><br></p><p>وفي حالة عودتي للعمل مجدداً للعمل فأنا بعد جديد كموظف جديد.</p>`;

const RELEASE_DEFAULT = `<p style="text-align:center"><strong>إقرار من شركة: (company_name)</strong></p><p><br></p><p>بأن الموظف: (employee_name) يحمل هوية/جواز سفر رقم (identity_no) تحت رقم قد كان يعمل لدى الشركة في وظيفة (job_title)</p><p>بداية من تاريخ (joining_date) وحتى تاريخ (termination_date) وقد سلم كافة عهدة الشركة التي كانت في حوزته وتم إصدار هذا النموذج بناءً على طلبه.</p>`;

type Reason = { id: string; reason: string };

function RichEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (html: string) => void;
}) {
  const { t, direction } = useI18n();
  const editorRef = useRef<HTMLDivElement>(null);
  const [wordCount, setWordCount] = useState(0);
  const [charCount, setCharCount] = useState(0);

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value;
    }
  }, []);

  const updateCounts = () => {
    const text = editorRef.current?.innerText ?? "";
    setCharCount(text.length);
    setWordCount(text.trim() ? text.trim().split(/\s+/).length : 0);
  };

  const execCmd = (command: string, value?: string) => {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
    handleInput();
  };

  const handleInput = () => {
    const html = editorRef.current?.innerHTML ?? "";
    onChange(html);
    updateCounts();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Tab") {
      e.preventDefault();
      execCmd("insertText", "\u00a0\u00a0\u00a0\u00a0");
    }
  };

  return (
    <div className="border border-gray-300 rounded-lg overflow-hidden" dir={direction}>
      {/* Toolbar */}
      <div className="flex flex-wrap gap-1 border-b border-gray-200 bg-gray-50 p-2">
        <ToolBtn title={t("رجوع")} onClick={() => execCmd("undo")}>↩</ToolBtn>
        <ToolBtn title={t("تقدم")} onClick={() => execCmd("redo")}>↪</ToolBtn>
        <div className="w-px bg-gray-300 mx-1 self-stretch" />
        <ToolBtn title={t("عريض")} onClick={() => execCmd("bold")}><strong>B</strong></ToolBtn>
        <ToolBtn title={t("مائل")} onClick={() => execCmd("italic")}><em>I</em></ToolBtn>
        <ToolBtn title={t("تسطير")} onClick={() => execCmd("underline")}><u>U</u></ToolBtn>
        <ToolBtn title={t("ضرب")} onClick={() => execCmd("strikeThrough")}><s>S</s></ToolBtn>
        <div className="w-px bg-gray-300 mx-1 self-stretch" />
        <ToolBtn title={t("محاذاة يمين")} onClick={() => execCmd("justifyRight")}>⮞</ToolBtn>
        <ToolBtn title={t("محاذاة وسط")} onClick={() => execCmd("justifyCenter")}>≡</ToolBtn>
        <ToolBtn title={t("محاذاة يسار")} onClick={() => execCmd("justifyLeft")}>⮜</ToolBtn>
        <ToolBtn title={t("ضبط")} onClick={() => execCmd("justifyFull")}>☰</ToolBtn>
        <div className="w-px bg-gray-300 mx-1 self-stretch" />
        <ToolBtn title={t("قائمة منقطة")} onClick={() => execCmd("insertUnorderedList")}>•≡</ToolBtn>
        <ToolBtn title={t("قائمة مرقمة")} onClick={() => execCmd("insertOrderedList")}>1≡</ToolBtn>
        <div className="w-px bg-gray-300 mx-1 self-stretch" />
        <select
          onChange={(e) => execCmd("fontSize", e.target.value)}
          className="h-7 text-xs border border-gray-300 rounded px-1 bg-white"
          defaultValue="3"
        >
          {[1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <select
          onChange={(e) => execCmd("formatBlock", e.target.value)}
          className="h-7 text-xs border border-gray-300 rounded px-1 bg-white"
          defaultValue="p"
        >
          <option value="p">{t("فقرة")}</option>
          <option value="h1">{t("عنوان 1")}</option>
          <option value="h2">{t("عنوان 2")}</option>
          <option value="h3">{t("عنوان 3")}</option>
        </select>
        <div className="w-px bg-gray-300 mx-1 self-stretch" />
        <ToolBtn title={t("إزالة التنسيق")} onClick={() => execCmd("removeFormat")}>✕</ToolBtn>
      </div>

      {/* Editable area */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        dir={direction}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        className="min-h-[200px] max-h-[380px] overflow-y-auto p-4 text-sm leading-7 outline-none"
        style={{ direction }}
      />

      {/* Footer word/char count */}
      <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-500">
        <span>POWERED BY JODIT</span>
        <span>{wordCount} {t("كلمة")} · {charCount} {t("حرف")}</span>
      </div>
    </div>
  );
}

function SettingsField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-800">{label}</label>
      {children}
    </div>
  );
}

function ToolBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="h-7 min-w-[28px] px-1.5 rounded text-sm border border-transparent hover:bg-gray-200 hover:border-gray-300 transition text-gray-700"
    >
      {children}
    </button>
  );
}

export default function HRTerminationSettings() {
  const { t, direction } = useI18n();
  const TABS = [
    { id: "main", label: t("إعدادات إنهاء الخدمة") },
    { id: "clearance", label: t("إعداد قالب إقرار مخالصة خدمة") },
    { id: "release", label: t("إعداد قالب إقرار إخلاء طرف") },
    { id: "reasons", label: t("أسباب إخلاء الطرف") },
  ];
  const [activeTab, setActiveTab] = useState("main");
  const [mainSettings, setMainSettings] = useState(MAIN_SETTINGS_DEFAULT);
  const [savingMain, setSavingMain] = useState(false);
  const [clearanceTemplate, setClearanceTemplate] = useState(CLEARANCE_DEFAULT);
  const [releaseTemplate, setReleaseTemplate] = useState(RELEASE_DEFAULT);
  const [reasons, setReasons] = useState<Reason[]>([]);
  const [reasonsLoading, setReasonsLoading] = useState(true);
  const [newReason, setNewReason] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [savingReason, setSavingReason] = useState(false);

  const saveMainSettings = async () => {
    setSavingMain(true);
    try {
      const { error } = await supabase.from("hr_settings").upsert(
        { setting_key: MAIN_SETTINGS_KEY, setting_value: mainSettings },
        { onConflict: "company_id,setting_key" }
      );
      if (error) throw error;
      toast({ title: t("تم حفظ الإعدادات بنجاح") });
    } catch (error) {
      toast({ title: t("تعذر الحفظ"), description: error instanceof Error ? error.message : "", variant: "destructive" });
    } finally {
      setSavingMain(false);
    }
  };

  useEffect(() => {
    const loadTemplates = async () => {
      const { data } = await supabase
        .from("hr_settings")
        .select("setting_key, setting_value")
        .in("setting_key", [CLEARANCE_KEY, RELEASE_KEY, MAIN_SETTINGS_KEY]);

      (data ?? []).forEach((row: any) => {
        if (row.setting_key === MAIN_SETTINGS_KEY && row.setting_value) {
          const val = typeof row.setting_value === "object" ? row.setting_value : JSON.parse(row.setting_value);
          setMainSettings((prev) => ({ ...prev, ...val }));
        }
        const val = typeof row.setting_value === "string" ? row.setting_value : JSON.stringify(row.setting_value);
        const clean = val.replace(/^"|"$/g, "").replace(/\\n/g, "\n");
        if (row.setting_key === CLEARANCE_KEY && clean) setClearanceTemplate(clean);
        if (row.setting_key === RELEASE_KEY && clean) setReleaseTemplate(clean);
      });
    };

    const loadReasons = async () => {
      setReasonsLoading(true);
      const { data, error } = await supabase.from("termination_release_reasons").select("*").order("created_at");
      if (!error && data) setReasons(data.map((r: any) => ({ id: String(r.id), reason: String(r.reason) })));
      setReasonsLoading(false);
    };

    loadTemplates();
    loadReasons();
  }, []);

  const saveTemplate = async (key: string, value: string) => {
    setSavingTemplate(true);
    try {
      const { error } = await supabase
        .from("hr_settings")
        .upsert({ setting_key: key, setting_value: value }, { onConflict: "company_id,setting_key" });
      if (error) throw error;
      toast({ title: t("تم حفظ القالب بنجاح") });
    } catch (error) {
      toast({ title: t("تعذر الحفظ"), description: error instanceof Error ? error.message : "", variant: "destructive" });
    } finally {
      setSavingTemplate(false);
    }
  };

  const restoreDefault = (tab: string) => {
    if (tab === "clearance") setClearanceTemplate(CLEARANCE_DEFAULT);
    else if (tab === "release") setReleaseTemplate(RELEASE_DEFAULT);
  };

  const addReason = async () => {
    if (!newReason.trim()) return;
    setSavingReason(true);
    try {
      const { data, error } = await supabase
        .from("termination_release_reasons")
        .insert({ reason: newReason.trim() })
        .select()
        .single();
      if (error) throw error;
      setReasons((prev) => [...prev, { id: String(data.id), reason: String(data.reason) }]);
      setNewReason("");
      toast({ title: t("تمت إضافة السبب") });
    } catch (error) {
      toast({ title: t("تعذر الإضافة"), description: error instanceof Error ? error.message : "", variant: "destructive" });
    } finally {
      setSavingReason(false);
    }
  };

  const updateReason = async (id: string) => {
    if (!editingText.trim()) return;
    try {
      const { error } = await supabase.from("termination_release_reasons").update({ reason: editingText.trim() }).eq("id", id);
      if (error) throw error;
      setReasons((prev) => prev.map((r) => (r.id === id ? { ...r, reason: editingText.trim() } : r)));
      setEditingId(null);
      toast({ title: t("تم التعديل") });
    } catch (error) {
      toast({ title: t("تعذر التعديل"), description: error instanceof Error ? error.message : "", variant: "destructive" });
    }
  };

  const deleteReason = async (id: string) => {
    if (!confirm(t("حذف هذا السبب؟"))) return;
    const { error } = await supabase.from("termination_release_reasons").delete().eq("id", id);
    if (error) { toast({ title: t("تعذر الحذف"), variant: "destructive" }); return; }
    setReasons((prev) => prev.filter((r) => r.id !== id));
    toast({ title: t("تم الحذف") });
  };

  return (
    <Layout>
      <div className="w-full p-4 space-y-4" dir={direction}>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {/* Tab bar */}
          <div className="flex border-b border-gray-200 overflow-x-auto">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`whitespace-nowrap px-5 py-3.5 text-sm font-medium border-b-2 transition ${
                  activeTab === tab.id
                    ? "border-[#004e89] text-white bg-[#004e89]"
                    : "border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Main settings tab */}
          {activeTab === "main" && (
            <div className="p-6 space-y-6" dir={direction}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">

                <div className="space-y-3 md:col-span-2">
                  <label className="text-sm font-medium text-gray-800">{t("الموافقة التلقائية لعملية إنهاء الخدمة")} *</label>
                  <div className="flex gap-6">
                    <label className="flex items-center gap-2 cursor-pointer"><input type="radio" name="autoApprove" value="yes" checked={mainSettings.autoApprove === "yes"} onChange={() => setMainSettings((s) => ({ ...s, autoApprove: "yes" }))} /><span className="text-sm">{t("نعم")}</span></label>
                    <label className="flex items-center gap-2 cursor-pointer"><input type="radio" name="autoApprove" value="no" checked={mainSettings.autoApprove === "no"} onChange={() => setMainSettings((s) => ({ ...s, autoApprove: "no" }))} /><span className="text-sm">{t("لا")}</span></label>
                  </div>
                </div>

                <SettingsField label={t("مستوى الموافقة الأول")}>
                  <input value={mainSettings.approver1} onChange={(e) => setMainSettings((s) => ({ ...s, approver1: e.target.value }))} className="h-10 w-full rounded-md border border-gray-300 px-3 text-sm outline-none focus:ring-2 focus:ring-[#004e89]" placeholder={t("اسم الموافق")} />
                </SettingsField>

                <SettingsField label={t("مستوى الموافقة الثاني")}>
                  <input value={mainSettings.approver2} onChange={(e) => setMainSettings((s) => ({ ...s, approver2: e.target.value }))} className="h-10 w-full rounded-md border border-gray-300 px-3 text-sm outline-none focus:ring-2 focus:ring-[#004e89]" placeholder={t("اسم الموافق")} />
                </SettingsField>

                <SettingsField label={t("مستوى الموافقة الثالث")}>
                  <input value={mainSettings.approver3} onChange={(e) => setMainSettings((s) => ({ ...s, approver3: e.target.value }))} className="h-10 w-full rounded-md border border-gray-300 px-3 text-sm outline-none focus:ring-2 focus:ring-[#004e89]" placeholder={t("اسم الموافق")} />
                </SettingsField>

                <SettingsField label={t("مكافأة إنهاء الخدمة تحتسب من")}>
                  <select value={mainSettings.gratuityBase} onChange={(e) => setMainSettings((s) => ({ ...s, gratuityBase: e.target.value }))} className="h-10 w-full rounded-md border border-gray-300 px-3 bg-white text-sm outline-none focus:ring-2 focus:ring-[#004e89]">
                    <option value="basic">{t("الراتب الأساسي")}</option>
                    <option value="total">{t("الراتب الإجمالي")}</option>
                  </select>
                </SettingsField>

                <div className="space-y-3">
                  <label className="text-sm font-medium text-gray-800">{t("هل تحسب المكافأة للموظفين الذين خدموا في الشركة لأقل من سنة")}</label>
                  <div className="flex gap-6">
                    <label className="flex items-center gap-2 cursor-pointer"><input type="radio" name="calcLessThanYear" value="yes" checked={mainSettings.calcLessThanYear === "yes"} onChange={() => setMainSettings((s) => ({ ...s, calcLessThanYear: "yes" }))} /><span className="text-sm">{t("نعم")}</span></label>
                    <label className="flex items-center gap-2 cursor-pointer"><input type="radio" name="calcLessThanYear" value="no" checked={mainSettings.calcLessThanYear === "no"} onChange={() => setMainSettings((s) => ({ ...s, calcLessThanYear: "no" }))} /><span className="text-sm">{t("لا")}</span></label>
                  </div>
                </div>

                <SettingsField label={t("مقدار المكافأة لكل سنة للموظفين الذين خدموا أقل أو ما يساوي خمس سنين")}>
                  <select value={mainSettings.rate5andBelow} onChange={(e) => setMainSettings((s) => ({ ...s, rate5andBelow: e.target.value }))} className="h-10 w-full rounded-md border border-gray-300 px-3 bg-white text-sm outline-none focus:ring-2 focus:ring-[#004e89]">
                    <option value="half">{t("نصف راتب لكل سنة")}</option>
                    <option value="full">{t("راتب شهر لكل سنة")}</option>
                  </select>
                </SettingsField>

                <SettingsField label={t("مقدار المكافأة لكل سنة للموظفين الذين خدموا أكثر من خمس سنين")}>
                  <select value={mainSettings.rateAbove5} onChange={(e) => setMainSettings((s) => ({ ...s, rateAbove5: e.target.value }))} className="h-10 w-full rounded-md border border-gray-300 px-3 bg-white text-sm outline-none focus:ring-2 focus:ring-[#004e89]">
                    <option value="full">{t("راتب شهر لكل سنة")}</option>
                    <option value="half">{t("نصف راتب لكل سنة")}</option>
                  </select>
                </SettingsField>

                <div className="space-y-3 md:col-span-2">
                  <label className="text-sm font-medium text-gray-800">{t("احتساب يوم انتهاء الخدمة ضمن مدة الخدمة")}</label>
                  <div className="flex gap-6">
                    <label className="flex items-center gap-2 cursor-pointer"><input type="radio" name="calcDayOfEnd" value="yes" checked={mainSettings.calcDayOfEnd === "yes"} onChange={() => setMainSettings((s) => ({ ...s, calcDayOfEnd: "yes" }))} /><span className="text-sm">{t("نعم")}</span></label>
                    <label className="flex items-center gap-2 cursor-pointer"><input type="radio" name="calcDayOfEnd" value="no" checked={mainSettings.calcDayOfEnd === "no"} onChange={() => setMainSettings((s) => ({ ...s, calcDayOfEnd: "no" }))} /><span className="text-sm">{t("لا")}</span></label>
                  </div>
                </div>

                <div className="md:col-span-2 bg-gray-50 rounded-lg p-4 text-sm text-gray-600 leading-7 border border-gray-200">
                  <p>{t("عند اختيار \u201cنعم\u201d يُحسب تاريخ انتهاء الخدمة (نفسه) ضمن احتساب مكافأة نهاية الخدمة في احتساب مدة الخدمة. هذا هو الوضع الافتراضي وفق مطابق لهذا السلوك السابق. وعند اختيار \u201cلا\u201d يُحسب مدة الخدمة بالفرق بين تاريخ المباشرة وتاريخ انتهاء الخدمة دون إضافة يوم. هذا ما يطابق حاسبة الموارد البشرية وتقارير وزارة الموارد البشرية لاحتساب جميع مستحقات نهاية الخدمة.")}</p>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <Button onClick={saveMainSettings} disabled={savingMain} className="bg-[#004e89] hover:bg-[#003d6d] text-white px-8">
                  {savingMain ? t("جاري الحفظ...") : t("حفظ")}
                </Button>
              </div>
            </div>
          )}

          {/* Clearance template tab */}
          {activeTab === "clearance" && (
            <div className="p-5 space-y-4">
              <RichEditor value={clearanceTemplate} onChange={setClearanceTemplate} />
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="outline" onClick={() => restoreDefault("clearance")}><RefreshCw className="h-4 w-4 ml-2" /> {t("استعادة الافتراضي")}</Button>
                <Button onClick={() => saveTemplate(CLEARANCE_KEY, clearanceTemplate)} disabled={savingTemplate} className="bg-[#004e89] hover:bg-[#003d6d] text-white">
                  {savingTemplate ? t("جاري الحفظ...") : t("حفظ")}
                </Button>
              </div>
            </div>
          )}

          {/* Release template tab */}
          {activeTab === "release" && (
            <div className="p-5 space-y-4">
              <RichEditor value={releaseTemplate} onChange={setReleaseTemplate} />
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="outline" onClick={() => restoreDefault("release")}><RefreshCw className="h-4 w-4 ml-2" /> {t("استعادة الافتراضي")}</Button>
                <Button onClick={() => saveTemplate(RELEASE_KEY, releaseTemplate)} disabled={savingTemplate} className="bg-[#004e89] hover:bg-[#003d6d] text-white">
                  {savingTemplate ? t("جاري الحفظ...") : t("حفظ")}
                </Button>
              </div>
            </div>
          )}

          {/* Reasons tab */}
          {activeTab === "reasons" && (
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-3 bg-[#004e89] text-white px-4 py-3 rounded-lg">
                <h2 className="font-bold">{t("أسباب إخلاء الطرف")}</h2>
                <div className="flex items-center gap-2">
                  <button className="p-1.5 hover:bg-white/10 rounded" title={t("طباعة")} aria-label={t("طباعة")}><Printer className="h-4 w-4" /></button>
                  <button className="p-1.5 hover:bg-white/10 rounded" title={t("تصدير")} aria-label={t("تصدير")}><Download className="h-4 w-4" /></button>
                  <select className="h-7 text-sm text-black rounded px-2 bg-white border-none">
                    <option>10</option>
                    <option>25</option>
                    <option>50</option>
                  </select>
                </div>
              </div>

              {/* Add reason */}
              <div className="flex gap-2">
                <Input
                  value={newReason}
                  onChange={(e) => setNewReason(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addReason(); }}
                  placeholder={t("أدخل سبب إخلاء الطرف الجديد")}
                  className="flex-1"
                />
                <Button onClick={addReason} disabled={savingReason || !newReason.trim()} className="bg-[#004e89] hover:bg-[#003d6d] text-white">
                  <Plus className="h-4 w-4 ml-1" /> {t("إضافة")}
                </Button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm text-right border border-gray-200 rounded-lg overflow-hidden">
                  <thead className="bg-gray-50 text-gray-700 border-b border-gray-200">
                    <tr>
                      <th className="py-3 px-4 font-medium w-20">{t("معرف")}</th>
                      <th className="py-3 px-4 font-medium">{t("سبب الإخلاء")}</th>
                      <th className="py-3 px-4 font-medium text-center w-28">{t("الأمر")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {reasonsLoading ? (
                      <tr><td colSpan={3} className="py-8 text-center text-gray-400">{t("جاري التحميل...")}</td></tr>
                    ) : reasons.length === 0 ? (
                      <tr><td colSpan={3} className="py-8 text-center text-gray-400">{t("لا توجد أسباب مضافة")}</td></tr>
                    ) : reasons.map((item, index) => (
                      <tr key={item.id} className="hover:bg-gray-50/50">
                        <td className="py-3 px-4">{index + 1}</td>
                        <td className="py-3 px-4">
                          {editingId === item.id ? (
                            <div className="flex gap-2">
                              <Input value={editingText} onChange={(e) => setEditingText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") updateReason(item.id); }} className="flex-1 h-8 text-sm" autoFocus />
                              <button onClick={() => updateReason(item.id)} title={t("حفظ")} aria-label={t("حفظ")} className="text-emerald-600 hover:text-emerald-800"><Save className="h-4 w-4" /></button>
                              <button onClick={() => setEditingId(null)} title={t("إلغاء")} aria-label={t("إلغاء")} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
                            </div>
                          ) : (
                            item.reason
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex justify-center items-center gap-3">
                            <button onClick={() => { setEditingId(item.id); setEditingText(item.reason); }} title={t("تعديل")} aria-label={t("تعديل")} className="text-gray-400 hover:text-[#004e89]"><Edit className="h-4 w-4" /></button>
                            <button onClick={() => deleteReason(item.id)} title={t("حذف")} aria-label={t("حذف")} className="text-red-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="text-xs text-gray-500 text-left">{t("يعرض")} {reasons.length} {t("سجل")}</div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
