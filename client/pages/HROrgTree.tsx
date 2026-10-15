import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ZoomIn, ZoomOut, Maximize } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/i18n";

type Dept = { id: string; name: string; manager: string };
type Branch = { id: string; name: string };

export default function HROrgTree() {
  const { t, direction } = useI18n();
  const [zoom, setZoom] = useState(100);
  const [departments, setDepartments] = useState<Dept[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data: depts } = await supabase.from("departments").select("id, name, manager").order("name");
        const { data: brns } = await supabase.from("branches").select("id, name").order("name");
        if (depts) setDepartments(depts.map((d: any) => ({ id: String(d.id), name: d.name ?? "", manager: d.manager ?? "" })));
        if (brns) setBranches(brns.map((b: any) => ({ id: String(b.id), name: b.name ?? "" })));
      } catch {} finally { setLoading(false); }
    })();
  }, []);

  const TreeNode = ({ title, subtitle }: { title: string; subtitle?: string }) => (
    <div className="flex flex-col items-center">
      <div className="bg-[#004e89] text-white p-2 rounded min-w-[120px] text-center shadow-sm">
        <div className="font-medium text-sm">{title}</div>
        {subtitle && <div className="text-xs text-blue-200 mt-1">{subtitle}</div>}
      </div>
    </div>
  );

  const mainBranch = branches.length > 0 ? branches[0].name : t("الفرع الرئيسي");

  return (
    <Layout>
      <div className="p-6 max-w-[1600px] mx-auto space-y-6" dir={direction}>
        <div className="flex justify-between items-center bg-white p-4 rounded-lg border shadow-sm">
          <div className="flex items-center gap-2">
            <Checkbox id="show_all" />
            <Label htmlFor="show_all" className="text-sm font-medium cursor-pointer">{t("عرض إدارات (كل الفروع) بشكل منفصل")}</Label>
          </div>
          <h1 className="text-lg font-bold text-[#004e89]">{t("الهيكل التنظيمي")}</h1>
        </div>

        <div className="bg-white rounded-lg border shadow-sm h-[600px] relative overflow-hidden flex flex-col">
          <div className="absolute right-6 bottom-6 flex flex-col gap-2 z-10 bg-white p-2 rounded-lg border shadow-sm">
            <Button variant="ghost" size="icon" onClick={() => setZoom((prev) => Math.min(prev + 10, 200))}><ZoomIn className="h-5 w-5 text-gray-600" /></Button>
            <Button variant="ghost" size="icon" onClick={() => setZoom((prev) => Math.max(prev - 10, 50))}><ZoomOut className="h-5 w-5 text-gray-600" /></Button>
            <Button variant="ghost" size="icon" onClick={() => setZoom(100)}><Maximize className="h-5 w-5 text-gray-600" /></Button>
          </div>

          <div className="flex-1 overflow-auto bg-gray-50 flex items-center justify-center p-10">
            {loading ? (
              <span className="text-gray-400">{t("جاري التحميل...")}</span>
            ) : (
              <div style={{ transform: `scale(${zoom / 100})`, transition: "transform 0.2s" }} className="flex flex-col items-center">
                {/* Root */}
                <TreeNode title={mainBranch} />
                <div className="w-px h-8 bg-[#004e89]" />

                {/* Horizontal connector */}
                {departments.length > 0 && (
                  <div className="relative flex justify-center" style={{ width: Math.max(departments.length * 180, 200) }}>
                    <div className="absolute top-0 left-[10%] right-[10%] h-px bg-[#004e89]" />
                  </div>
                )}

                {/* Departments */}
                <div className="flex gap-6 mt-0 flex-wrap justify-center">
                  {departments.map((dept) => (
                    <div key={dept.id} className="flex flex-col items-center">
                      <div className="w-px h-6 bg-[#004e89]" />
                      <TreeNode title={dept.name} subtitle={dept.manager || undefined} />
                    </div>
                  ))}
                </div>

                {departments.length === 0 && (
                  <div className="text-gray-400 mt-8">{t("لا توجد إدارات مسجلة")}</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
