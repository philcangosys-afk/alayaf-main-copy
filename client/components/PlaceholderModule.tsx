import Layout from "./Layout";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface PlaceholderModuleProps {
  title: string;
  description: string;
  icon: LucideIcon;
  features: { label: string; href?: string }[] | string[];
}

export default function PlaceholderModule({
  title,
  description,
  icon: Icon,
  features,
}: PlaceholderModuleProps) {
  const formattedFeatures = features.map((f) =>
    typeof f === "string" ? { label: f } : f
  );

  const gradientMap: Record<string, string> = {
    "إدارة المبيعات": "from-blue-600 to-indigo-700",
    "إدارة المشتريات": "from-violet-600 to-purple-700",
    "إدارة الموارد البشرية": "from-emerald-600 to-teal-700",
    "إدارة الضرائب": "from-rose-600 to-pink-700",
    "إدارة العملاء والموردين": "from-amber-600 to-orange-700",
  };

  const gradient = gradientMap[title] || "from-slate-600 to-slate-700";

  return (
    <Layout subMenu={{ title, items: formattedFeatures }}>
      <div className="mx-auto max-w-5xl">
        {/* Header Section */}
        <div className={cn(
          "relative overflow-hidden rounded-2xl bg-gradient-to-bl p-8 text-white shadow-lg animate-fade-in-up mb-8",
          gradient
        )}>
          <div className="pointer-events-none absolute -top-12 -left-12 h-48 w-48 rounded-full bg-white/[0.07] blur-2xl" />
          <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 backdrop-blur-sm shadow-lg">
                <Icon className="h-7 w-7" />
              </div>
              <div>
                <h1 className="text-3xl font-bold">{title}</h1>
                <p className="text-sm text-white/80 mt-1">{description}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Content Area */}
        <div className="grid gap-8 lg:grid-cols-3">
          {/* Main Panel */}
          <div className="lg:col-span-2">
            <div className="rounded-2xl bg-white border border-border/50 shadow-sm overflow-hidden animate-fade-in-up">
              <div className="py-16 text-center">
                <div className="mb-6 flex justify-center">
                  <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200">
                    <Icon className="h-12 w-12 text-muted-foreground/40" />
                  </div>
                </div>
                <h3 className="text-2xl font-bold text-foreground">
                  {title} قريباً
                </h3>
                <p className="mt-3 text-muted-foreground max-w-sm mx-auto">
                  هذه الميزة قيد التطوير حالياً. تابعنا للتحديثات الجديدة.
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  يمكنك أن تطلب المزيد من الميزات من خلال فريق الدعم الفني.
                </p>
              </div>
            </div>

            {/* Features Grid */}
            {formattedFeatures.length > 0 && (
              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                {formattedFeatures.map((feature, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      "rounded-xl border border-border/50 bg-white p-4 hover:shadow-md transition-all animate-fade-in-up",
                      { "opacity-75": !feature.href }
                    )}
                    style={{ animationDelay: `${idx * 50}ms` }}
                  >
                    <div className="flex items-start gap-3">
                      <div className={cn(
                        "mt-0.5 h-2 w-2 rounded-full flex-shrink-0",
                        gradient.includes("blue") ? "bg-blue-500" :
                        gradient.includes("violet") ? "bg-violet-500" :
                        gradient.includes("emerald") ? "bg-emerald-500" :
                        gradient.includes("rose") ? "bg-rose-500" :
                        "bg-slate-500"
                      )} />
                      <p className="text-sm font-medium text-foreground">
                        {feature.label}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="flex flex-col gap-6">
            {/* Info Box */}
            <div className={cn(
              "rounded-xl border-l-4 p-4 bg-white border border-border/50 shadow-sm animate-fade-in-up",
              gradient.includes("blue") ? "border-l-blue-500 bg-blue-50/30" :
              gradient.includes("violet") ? "border-l-violet-500 bg-violet-50/30" :
              gradient.includes("emerald") ? "border-l-emerald-500 bg-emerald-50/30" :
              gradient.includes("rose") ? "border-l-rose-500 bg-rose-50/30" :
              "border-l-slate-500 bg-slate-50/30"
            )}>
              <h4 className="font-semibold text-foreground text-right">💡 نصيحة</h4>
              <p className="mt-2 text-sm text-muted-foreground text-right">
                اضغط على {title} في الشريط الجانبي لعرض قائمة الخيارات والعمليات المتاحة.
              </p>
            </div>

            {/* Stats Box */}
            <div className="rounded-xl bg-white border border-border/50 p-4 shadow-sm animate-fade-in-up" style={{ animationDelay: "100ms" }}>
              <div className="text-center">
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">الميزات المتاحة</p>
                <p className="text-3xl font-bold mt-2 bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">
                  {formattedFeatures.length}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
