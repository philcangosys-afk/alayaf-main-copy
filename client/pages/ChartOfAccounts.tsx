import Layout from "@/components/Layout";
import ChartOfAccountsTree from "@/components/chart-of-accounts/ChartOfAccountsTree";
import { useI18n } from "@/i18n";

export default function ChartOfAccounts() {
  const { t, direction } = useI18n();

  return (
    <Layout>
      <main className="space-y-5" dir={direction}>
        <header className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <h1 className="text-2xl font-bold text-slate-900">{t("شجرة الحسابات")}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {t("إدارة الحسابات الرئيسية والفرعية وقواعد الترحيل المحاسبي من مصدر واحد.")}
          </p>
        </header>
        <ChartOfAccountsTree />
      </main>
    </Layout>
  );
}
