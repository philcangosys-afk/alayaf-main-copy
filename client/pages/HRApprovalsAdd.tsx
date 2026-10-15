import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Layout from "@/components/Layout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n";
import { hrRequestErrorText } from "@/lib/hrErrors";

const DEFAULT_REQUEST_TYPES = ["إجازة", "سلفة", "نقل", "استئذان", "عهدة", "مصروفات", "أخرى", "الرواتب"];
const ADD_REQUEST_TYPE = "__add_request_type__";

type Step = { order: number; approver: string; role: string };

const ACTIVE_CHAIN_EXISTS_MESSAGE = "توجد سلسلة موافقات فعالة لهذا النوع؛ عطّلها أولًا";

/** أخطاء حفظ سلسلة الموافقات: الفهرس الفريد (سلسلة فعالة واحدة لكل نوع) يرجع 23505 أو APPROVAL_CHAIN_ACTIVE_EXISTS */
const chainSaveErrorText = (error: unknown) =>
  (error as { code?: string } | null)?.code === "23505" ? ACTIVE_CHAIN_EXISTS_MESSAGE : hrRequestErrorText(error);

export default function HRApprovalsAdd() {
  const { t, direction } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // وضع التعديل: /hr/approvals/add?id=<id>
  const editId = searchParams.get("id");
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [loadingChain, setLoadingChain] = useState(Boolean(editId));

  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [active, setActive] = useState(true);
  const [type, setType] = useState("إجازة");
  const [requestTypes, setRequestTypes] = useState(DEFAULT_REQUEST_TYPES);
  const [addingRequestType, setAddingRequestType] = useState(false);
  const [customRequestType, setCustomRequestType] = useState("");
  const [managers, setManagers] = useState<{ id: string; name: string }[]>([]);
  const [steps, setSteps] = useState<Step[]>([{ order: 1, approver: "", role: "معتمد" }]);

  useEffect(() => {
    (async () => {
      const [employeesResult, chainsResult] = await Promise.all([
        supabase
          .from("employees")
          .select("id, name")
          .in("status", ["نشط", "فعال"])
          .order("name"),
        supabase.from("approval_chains").select("type"),
      ]);
      if (employeesResult.error) {
        toast({ title: t("تعذر تحميل قائمة الموظفين"), description: t(hrRequestErrorText(employeesResult.error)), variant: "destructive" });
      }
      setManagers((employeesResult.data ?? []).map((e: any) => ({ id: String(e.id), name: String(e.name) })));
      const savedTypes = (chainsResult.data ?? [])
        .map((chain: any) => String(chain.type ?? "").trim())
        .filter(Boolean);
      setRequestTypes((current) => [...new Set([...DEFAULT_REQUEST_TYPES, ...savedTypes, ...current])]);
    })();
  }, []);

  useEffect(() => {
    // الانتقال من ?id=X إلى إضافة جديدة بلا إعادة تركيب الصفحة: نموذج فارغ
    if (!editId) {
      setNameAr("");
      setNameEn("");
      setActive(true);
      setType("إجازة");
      setAddingRequestType(false);
      setCustomRequestType("");
      setSteps([{ order: 1, approver: "", role: "معتمد" }]);
      setStep(1);
      setLoadingChain(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingChain(true);
      const { data, error } = await supabase
        .from("approval_chains")
        .select("id, name, type, steps, status")
        .eq("id", editId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        toast({ title: t("تعذر تحميل سلسلة الموافقات"), description: error ? t(hrRequestErrorText(error)) : t("السلسلة غير موجودة"), variant: "destructive" });
        navigate("/hr/approvals/list");
        return;
      }
      const chainType = String(data.type ?? "").trim() || "إجازة";
      const savedSteps = Array.isArray(data.steps) ? data.steps : [];
      setNameAr(String(data.name ?? ""));
      setType(chainType);
      setRequestTypes((current) => (current.includes(chainType) ? current : [...current, chainType]));
      setActive(String(data.status ?? "").trim() === "فعال");
      setSteps(
        savedSteps.length > 0
          ? savedSteps.map((item: any, index: number) => ({
              order: index + 1,
              approver: String(item?.approver ?? ""),
              role: String(item?.role ?? "معتمد"),
            }))
          : [{ order: 1, approver: "", role: "معتمد" }],
      );
      setStep(1);
      setLoadingChain(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [editId]);

  const addCustomRequestType = () => {
    const customType = customRequestType.trim();
    if (!customType) {
      toast({ title: "أدخل اسم نوع الطلب", variant: "destructive" });
      return;
    }
    setRequestTypes((current) => current.includes(customType) ? current : [...current, customType]);
    setType(customType);
    setCustomRequestType("");
    setAddingRequestType(false);
  };

  const addStep = () => setSteps((prev) => [...prev, { order: prev.length + 1, approver: "", role: "معتمد" }]);
  const removeStep = (order: number) => setSteps((prev) => prev.filter((s) => s.order !== order).map((s, i) => ({ ...s, order: i + 1 })));
  const updateStep = (order: number, patch: Partial<Step>) => setSteps((prev) => prev.map((s) => (s.order === order ? { ...s, ...patch } : s)));

  const handleSave = async () => {
    if (!nameAr.trim()) {
      toast({ title: t("بيانات ناقصة"), description: t("أدخل اسم سلسلة الموافقات بالعربية"), variant: "destructive" });
      setStep(1);
      return;
    }
    const validSteps = steps.filter((s) => s.approver.trim());
    if (validSteps.length === 0) {
      toast({ title: t("بيانات ناقصة"), description: t("أضف خطوة اعتماد واحدة على الأقل"), variant: "destructive" });
      return;
    }

    const chainType = type.trim();
    if (!chainType) {
      toast({ title: t("بيانات ناقصة"), description: t("اختر نوع الطلب المرتبط"), variant: "destructive" });
      setStep(2);
      return;
    }

    setSaving(true);
    // سلسلة فعالة واحدة فقط لكل نوع طلب (المقارنة بعد حذف المسافات، كما في فهرس قاعدة البيانات)
    if (active) {
      const { data: activeChains, error: lookupError } = await supabase
        .from("approval_chains")
        .select("id, name, type")
        .eq("status", "فعال");
      if (lookupError) {
        setSaving(false);
        toast({ title: t("تعذر الحفظ"), description: t(hrRequestErrorText(lookupError)), variant: "destructive" });
        return;
      }
      const conflict = (activeChains ?? []).find(
        (chain: { id?: unknown; type?: unknown }) => String(chain.type ?? "").trim() === chainType && String(chain.id) !== String(editId ?? ""),
      ) as { name?: unknown } | undefined;
      if (conflict) {
        setSaving(false);
        toast({
          title: t("توجد سلسلة فعالة لنفس النوع"),
          description: `${t("عطّل السلسلة الحالية أولًا أو احفظ هذه كغير فعالة")}: ${String(conflict.name ?? "")}`,
          variant: "destructive",
        });
        return;
      }
    }

    const payload = {
      name: nameAr.trim(),
      type: chainType,
      steps: validSteps,
      status: active ? "فعال" : "غير فعال",
    };
    const { data: savedRows, error } = editId
      ? await supabase.from("approval_chains").update(payload).eq("id", editId).select("id")
      : await supabase.from("approval_chains").insert(payload).select("id");
    setSaving(false);
    if (error) {
      toast({ title: t("تعذر الحفظ"), description: t(chainSaveErrorText(error)), variant: "destructive" });
      return;
    }
    if (!savedRows || savedRows.length === 0) {
      toast({ title: t("لم يُحفظ شيء"), description: t("لا تملك صلاحية تعديل هذه السلسلة أو أنها حُذفت"), variant: "destructive" });
      return;
    }
    toast({ title: t("تم الحفظ"), description: t(editId ? "تم تحديث سلسلة الموافقات بنجاح" : "تم إنشاء سلسلة الموافقات بنجاح") });
    navigate("/hr/approvals/list");
  };

  return (
    <Layout>
      <div className="p-6 max-w-[1200px] mx-auto space-y-6" dir={direction}>
        <div className="bg-white p-6 rounded-lg border shadow-sm space-y-6">
          <div className="flex gap-2">
            {[1, 2, 3].map((n) => (
              <div key={n} className={`flex-1 h-1.5 rounded-full ${step >= n ? "bg-[#004e89]" : "bg-gray-200"}`} />
            ))}
          </div>

          {step === 1 && (
            <div className="space-y-6">
              <h2 className="text-lg font-bold text-gray-800 border-b pb-3">
                {t(editId ? "تعديل سلسلة الموافقات" : "بيانات سلسلة الموافقات")}
                {loadingChain && <span className="ms-2 text-sm font-normal text-gray-400">{t("جاري التحميل...")}</span>}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label className="text-gray-700">{t("الوصف بالعربية")} *</Label>
                  <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} className="bg-gray-50" />
                </div>
                <div className="space-y-2">
                  <Label className="text-gray-700">{t("الوصف بالإنجليزية")}</Label>
                  <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} className="bg-gray-50" dir="ltr" />
                </div>
                <div className="space-y-3 col-span-1 md:col-span-2">
                  <Label className="text-gray-700">{t("فعال")} *</Label>
                  <RadioGroup value={active ? "yes" : "no"} onValueChange={(v) => setActive(v === "yes")} className="flex gap-6 mt-2">
                    <div className="flex items-center space-x-2 space-x-reverse">
                      <RadioGroupItem value="yes" id="active_yes" />
                      <Label htmlFor="active_yes" className="font-normal cursor-pointer">{t("نعم")}</Label>
                    </div>
                    <div className="flex items-center space-x-2 space-x-reverse">
                      <RadioGroupItem value="no" id="active_no" />
                      <Label htmlFor="active_no" className="font-normal cursor-pointer">{t("لا")}</Label>
                    </div>
                  </RadioGroup>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <h2 className="text-lg font-bold text-gray-800 border-b pb-3">{t("مجال سلسلة الموافقات")}</h2>
              <div className="space-y-2 max-w-md">
                <Label className="text-gray-700">{t("نوع الطلب المرتبط")} *</Label>
                <select
                  value={type}
                  onChange={(e) => {
                    if (e.target.value === ADD_REQUEST_TYPE) {
                      setAddingRequestType(true);
                      return;
                    }
                    setType(e.target.value);
                    setAddingRequestType(false);
                  }}
                  className="w-full h-10 border border-gray-300 rounded-md px-3 bg-white text-sm"
                >
                  {requestTypes.map((requestType) => <option key={requestType} value={requestType}>{t(requestType)}</option>)}
                  <option value={ADD_REQUEST_TYPE}>{t("إضافة")}</option>
                </select>
                {addingRequestType && (
                  <div className="flex gap-2 pt-2">
                    <Input
                      value={customRequestType}
                      onChange={(event) => setCustomRequestType(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          addCustomRequestType();
                        }
                      }}
                      placeholder={t("اكتب نوع الطلب الجديد")}
                      autoFocus
                    />
                    <Button type="button" onClick={addCustomRequestType} className="bg-[#004e89] hover:bg-[#003d6d] text-white gap-1 shrink-0">
                      <Plus className="h-4 w-4" /> {t("إضافة")}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <div className="flex items-center justify-between border-b pb-3">
                <h2 className="text-lg font-bold text-gray-800">{t("تسلسل لجنة الموافقات")}</h2>
                <Button onClick={addStep} variant="outline" className="gap-2"><Plus className="h-4 w-4" /> {t("إضافة خطوة")}</Button>
              </div>
              <div className="space-y-3">
                {steps.map((st) => (
                  <div key={st.order} className="flex items-center gap-3 bg-gray-50 rounded-lg p-3">
                    <div className="w-8 h-8 rounded-full bg-[#004e89] text-white flex items-center justify-center text-sm shrink-0">{st.order}</div>
                    <select value={st.approver} onChange={(e) => updateStep(st.order, { approver: e.target.value })} className="flex-1 h-10 border border-gray-300 rounded-md px-3 bg-white text-sm">
                      <option value="">{t("اختر المعتمِد")}</option>
                      {st.approver && !managers.some((m) => m.name === st.approver) && <option value={st.approver}>{st.approver}</option>}
                      {managers.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
                    </select>
                    <select value={st.role} onChange={(e) => updateStep(st.order, { role: e.target.value })} className="w-40 h-10 border border-gray-300 rounded-md px-3 bg-white text-sm">
                      <option value="معتمد">{t("معتمد")}</option>
                      <option value="مراجع">{t("مراجع")}</option>
                      <option value="معتمد نهائي">{t("معتمد نهائي")}</option>
                    </select>
                    {steps.length > 1 && (
                      <button onClick={() => removeStep(st.order)} title={t("حذف")} aria-label={t("حذف")} className="p-2 text-red-500 hover:bg-red-50 rounded-lg"><Trash2 className="h-4 w-4" /></button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-start gap-2 pt-4 border-t">
            {step < 3 ? (
              <Button onClick={() => setStep((s) => s + 1)} className="bg-[#004e89] hover:bg-[#003d6d] text-white px-8">{t("التالي")}</Button>
            ) : (
              <Button onClick={handleSave} disabled={saving || loadingChain} className="bg-[#004e89] hover:bg-[#003d6d] text-white px-8">{saving ? t("جاري الحفظ...") : t("حفظ السلسلة")}</Button>
            )}
            <Button variant="outline" className="text-gray-500 px-8" disabled={step === 1} onClick={() => setStep((s) => Math.max(1, s - 1))}>{t("السابق")}</Button>
          </div>
        </div>
      </div>
    </Layout>
  );
}
