import { Link } from "react-router-dom";
import {
  FileText,
  ShoppingCart,
  Users,
  DollarSign,
  CreditCard,
  TrendingUp,
  ArrowRight,
  CheckCircle2,
  Zap,
  Shield,
  BarChart3,
} from "lucide-react";
import { COMPANY_PROFILE } from "@/lib/companyProfile";

export default function Home() {
  const features = [
    {
      icon: FileText,
      title: "إدارة الفواتير",
      description: "نظام فواتير متكامل متوافق مع معايير ZATCA",
    },
    {
      icon: ShoppingCart,
      title: "إدارة المبيعات والمشتريات",
      description: "تتبع شامل لجميع عمليات البيع والشراء",
    },
    {
      icon: Users,
      title: "إدارة الموارد البشرية",
      description: "نظام متكامل لإدارة الموظفين والرواتب",
    },
    {
      icon: DollarSign,
      title: "إدارة الضرائب",
      description: "حساب وتطبيق الضرائب تلقائياً",
    },
    {
      icon: CreditCard,
      title: "إدارة العملاء",
      description: "قاعدة بيانات وتحليل سلوك العملاء",
    },
    {
      icon: BarChart3,
      title: "التقارير والتحليلات",
      description: "لوحة تحكم متقدمة مع مؤشرات الأداء الرئيسية",
    },
  ];

  const highlights = [
    {
      icon: Shield,
      title: "متوافق مع ZATCA",
      description: "يتبع متطلبات هيئة الزكاة والضريبة والجمارك بالكامل",
    },
    {
      icon: Zap,
      title: "سريع وموثوق",
      description: "بنية تحتية حديثة قائمة على السحابة",
    },
    {
      icon: TrendingUp,
      title: "قابل للتوسع",
      description: "ينمو مع احتياجات عملك",
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary-50 via-background to-background">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">
              نظ
            </div>
            <span className="text-lg font-semibold text-foreground">
              {COMPANY_PROFILE.companyNameAr}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary-700 hover:shadow-lg"
            >
              دخول النظام
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative overflow-hidden px-6 py-20 sm:py-32">
        <div className="absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute top-0 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-primary-100/30 blur-3xl" />
          <div className="absolute top-40 right-0 h-80 w-80 rounded-full bg-accent-50/20 blur-3xl" />
        </div>

        <div className="mx-auto max-w-4xl text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-accent-50 px-4 py-2">
            <Zap className="h-4 w-4 text-accent" />
            <span className="text-sm font-medium text-accent-foreground">
              الحل الأول المتكامل للفواتير الإلكترونية في السعودية
            </span>
          </div>

          <h1 className="mb-6 text-4xl font-bold tracking-tight text-foreground sm:text-5xl md:text-6xl">
            نظام فواتير متكامل
            <span className="block text-primary">متوافق مع ZATCA</span>
          </h1>

          <p className="mb-8 text-lg text-muted-foreground sm:text-xl">
            حل شامل لإدارة عمليات البيع والشراء والموارد البشرية والضرائب بكفاءة
            عالية وتوافق كامل مع متطلبات هيئة الزكاة والضريبة والجمارك
          </p>

          <div className="flex flex-col gap-4 sm:flex-row sm:justify-center">
            <Link
              to="/dashboard"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-8 py-3.5 text-base font-semibold text-primary-foreground transition-all hover:bg-primary-700 hover:shadow-lg"
            >
              ابدأ الآن
              <ArrowRight className="h-5 w-5" />
            </Link>
            <a
              href="#features"
              className="inline-flex items-center justify-center rounded-lg border border-border bg-card px-8 py-3.5 text-base font-semibold text-foreground transition-all hover:bg-secondary"
            >
              تعرف على المزيد
            </a>
          </div>

          {/* Stats */}
          <div className="mt-16 grid grid-cols-2 gap-8 sm:grid-cols-3">
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">7+</div>
              <p className="text-sm text-muted-foreground">وحدات رئيسية</p>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">100%</div>
              <p className="text-sm text-muted-foreground">توافق ZATCA</p>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">24/7</div>
              <p className="text-sm text-muted-foreground">دعم فني متاح</p>
            </div>
          </div>
        </div>
      </section>

      {/* Highlights Section */}
      <section className="border-t border-border bg-card px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <div className="mb-16 text-center">
            <h2 className="text-3xl font-bold text-foreground sm:text-4xl">
              لماذا نختار هذا النظام؟
            </h2>
          </div>

          <div className="grid gap-8 sm:grid-cols-3">
            {highlights.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.title}
                  className="erp-card flex flex-col items-center text-center"
                >
                  <div className="mb-4 rounded-lg bg-primary-100 p-3">
                    <Icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="mb-2 font-semibold text-foreground">
                    {item.title}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {item.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <div className="mb-16 text-center">
            <h2 className="text-3xl font-bold text-foreground sm:text-4xl">
              الميزات الرئيسية
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              كل ما تحتاجه لإدارة عملك بكفاءة وفعالية
            </p>
          </div>

          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => {
              const Icon = feature.icon;
              return (
                <div key={feature.title} className="erp-card group">
                  <div className="mb-4 inline-flex rounded-lg bg-primary-100 p-3">
                    <Icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="mb-2 font-semibold text-foreground group-hover:text-primary transition-colors">
                    {feature.title}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {feature.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="border-t border-border bg-primary px-6 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold text-primary-foreground sm:text-4xl">
            جاهز للبدء؟
          </h2>
          <p className="mt-4 text-lg text-primary-foreground/90">
            انضم إلى مئات الشركات التي تثق بنظامنا لإدارة فواتيرها
          </p>
          <Link
            to="/dashboard"
            className="mt-8 inline-flex items-center justify-center gap-2 rounded-lg bg-primary-foreground px-8 py-3.5 text-base font-semibold text-primary transition-all hover:bg-white hover:shadow-lg"
          >
            ادخل لوحة التحكم
            <ArrowRight className="h-5 w-5" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-card px-6 py-12">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 flex flex-col items-center justify-between gap-4 sm:flex-row">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">
                نظ
              </div>
              <span className="font-semibold text-foreground">
                {COMPANY_PROFILE.companyNameAr}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              نظام فواتير متكامل متوافق مع معايير ZATCA
            </p>
          </div>
          <div className="border-t border-border pt-8 text-center text-sm text-muted-foreground">
            <p>© 2024 {COMPANY_PROFILE.companyNameAr}. جميع الحقوق محفوظة.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
