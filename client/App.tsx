import "./global.css";

import { Toaster } from "@/components/ui/toaster";
import { createRoot } from "react-dom/client";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { Boxes } from "lucide-react";
import Dashboard from "./pages/Dashboard";
import Sales from "./pages/Sales";
import Quotations from "./pages/Quotations";
import SalesOrders from "./pages/SalesOrders";
import SalesInvoices from "./pages/SalesInvoices";
import SalesCreditNote from "./pages/SalesCreditNote";
import Purchases from "./pages/Purchases";
import PurchaseOrders from "./pages/PurchaseOrders";
import PurchaseInvoices from "./pages/PurchaseInvoices";
import PurchaseCashExpenses from "./pages/PurchaseCashExpenses";
import PurchaseDebitNotes from "./pages/PurchaseDebitNotes";
import PurchaseCreditRequests from "./pages/PurchaseCreditRequests";
import CustomsDeclarations from "./pages/CustomsDeclarations";
import PurchaseReports from "./pages/PurchaseReports";
import InventoryReports from "./pages/InventoryReports";
import InventoryProducts from "./pages/InventoryProducts";
import InventoryWarehouses from "./pages/InventoryWarehouses";
import InventoryReceipts from "./pages/InventoryReceipts";
import InventoryIssues from "./pages/InventoryIssues";
import InventoryTransfers from "./pages/InventoryTransfers";
import InventoryCounts from "./pages/InventoryCounts";
import InventoryAdjustments from "./pages/InventoryAdjustments";
import InventoryManufacturing from "./pages/InventoryManufacturing";
import InventoryAssembly from "./pages/InventoryAssembly";
import InventoryOpeningBalances from "./pages/InventoryOpeningBalances";
import HR from "./pages/HR";
import HRDashboard from "./pages/HRDashboard";
import HREmployees from "./pages/HREmployees";
import HRCertificates from "./pages/HRCertificates";
import HRReports from "./pages/HRReports";
import HREmployeeFullReport from "./pages/HREmployeeFullReport";
import HRSettings from "./pages/HRSettings";
import HRDeductionsEmails from "./pages/HRDeductionsEmails";
import HREmployeesCooperative from "./pages/HREmployeesCooperative";
import HREmployeesInactive from "./pages/HREmployeesInactive";
import HRUserLogs from "./pages/HRUserLogs";
import HRRequestsSend from "./pages/HRRequestsSend";
import HRRequestsIncoming from "./pages/HRRequestsIncoming";
import HRRequestsSent from "./pages/HRRequestsSent";
import HRRequestFormSettings from "./pages/HRRequestFormSettings";
import HRAttendanceCalculate from "./pages/HRAttendanceCalculate";
import HRAttendanceOvertime from "./pages/HRAttendanceOvertime";
import HRAttendanceReport from "./pages/HRAttendanceReport";
import HRAttendancePreparation from "./pages/HRAttendancePreparation";
import HRAttendanceMonthlyReport from "./pages/HRAttendanceMonthlyReport";
import HRAttendanceSchedules from "./pages/HRAttendanceSchedules";
import Login from "./pages/Login";
import EmployeeLogin from "./pages/EmployeeLogin";
import EmployeePortal from "./pages/EmployeePortal";
import HRPayrollStatement from "./pages/HRPayrollStatement";
import HRPayrollFullReport from "./pages/HRPayrollFullReport";
import HRPayrollArchive from "./pages/HRPayrollArchive";
import HRPayrollFinancialData from "./pages/HRPayrollFinancialData";
import HRPayrollTransfer from "./pages/HRPayrollTransfer";
import HRPayrollAdvances from "./pages/HRPayrollAdvances";
import HRPayrollSettings from "./pages/HRPayrollSettings";
import HRPenaltiesInvestigations from "./pages/HRPenaltiesInvestigations";
import HRPenaltiesArchive from "./pages/HRPenaltiesArchive";
import HRPenaltiesWarnings from "./pages/HRPenaltiesWarnings";
import HRPenaltiesTypes from "./pages/HRPenaltiesTypes";
import HRPenaltiesGroups from "./pages/HRPenaltiesGroups";
import HRPenaltiesDecisions from "./pages/HRPenaltiesDecisions";
import HRPenaltiesSettings from "./pages/HRPenaltiesSettings";
import HRLeavesEmployees from "./pages/HRLeavesEmployees";
import HRLeavesTypes from "./pages/HRLeavesTypes";
import HRLeavesAnnualBalance from "./pages/HRLeavesAnnualBalance";
import HRLeavesOtherBalance from "./pages/HRLeavesOtherBalance";
import HRLeavesChart from "./pages/HRLeavesChart";
import HRLeavesHolidays from "./pages/HRLeavesHolidays";
import HRTerminationDues from "./pages/HRTerminationDues";
import HRTerminationEmployees from "./pages/HRTerminationEmployees";
import HRTerminationClearance from "./pages/HRTerminationClearance";
import HRTerminationEvacuation from "./pages/HRTerminationEvacuation";
import HRTerminationReasons from "./pages/HRTerminationReasons";
import HRTerminationSettings from "./pages/HRTerminationSettings";
import HRTerminationInterviewSetup from "./pages/HRTerminationInterviewSetup";
import HRInsuranceSocial from "./pages/HRInsuranceSocial";
import HRInsuranceList from "./pages/HRInsuranceList";
import HRInsuranceMedical from "./pages/HRInsuranceMedical";
import HRApprovalsList from "./pages/HRApprovalsList";
import HRApprovalsAdd from "./pages/HRApprovalsAdd";
import HRApprovalsPolicies from "./pages/HRApprovalsPolicies";
import HROrgTree from "./pages/HROrgTree";
import HROrgBranches from "./pages/HROrgBranches";
import HROrgDepartments from "./pages/HROrgDepartments";
import HROrgSections from "./pages/HROrgSections";
import HROrgUnits from "./pages/HROrgUnits";
import HROrgSubunits from "./pages/HROrgSubunits";
import HROrgJobs from "./pages/HROrgJobs";
import HROrgWorkLocations from "./pages/HROrgWorkLocations";
import HROrgWorkSchedules from "./pages/HROrgWorkSchedules";
import HRFinancialAllowances from "./pages/HRFinancialAllowances";
import HRFinancialOvertime from "./pages/HRFinancialOvertime";
import HRFinancialDeductions from "./pages/HRFinancialDeductions";
import HRFinancialPrivileges from "./pages/HRFinancialPrivileges";
import HRFinancialLoans from "./pages/HRFinancialLoans";
import HRFinancialEmployeeCategories from "./pages/HRFinancialEmployeeCategories";
import HRFinancialAccountSettings from "./pages/HRFinancialAccountSettings";
import HRSuccessionPositions from "./pages/HRSuccessionPositions";
import HRSuccessionCandidates from "./pages/HRSuccessionCandidates";
import HRSuccessionDevelopmentPlans from "./pages/HRSuccessionDevelopmentPlans";
import HRSuccessionTrackingReport from "./pages/HRSuccessionTrackingReport";
import HRPermissionsRoles from "./pages/HRPermissionsRoles";
import HRPermissionsAddRole from "./pages/HRPermissionsAddRole";
import HRSpecialUser from "./pages/HRSpecialUser";
import CRM from "./pages/CRM";
import ExpenseManagement from "./pages/ExpenseManagement";
import ChartOfAccounts from "./pages/ChartOfAccounts";
import ManualJournals from "./pages/ManualJournals";
import BulkReclassification from "./pages/BulkReclassification";
import AccountingSettings from "./pages/AccountingSettings";
import FixedAssets from "./pages/FixedAssets";
import Tax from "./pages/Tax";
import BankAccounts from "./pages/BankAccounts";
import TaxReports from "./pages/TaxReports";
import AccountingReports from "./pages/AccountingReports";
import AccountantWorkspace from "./pages/AccountantWorkspace";
import AIAssistant from "./pages/AIAssistant";
import Settings from "./pages/Settings";
import Subscription from "./pages/Subscription";
import SubscriptionErrorDialog from "./components/subscription/SubscriptionErrorDialog";
import ZATCASettings from "./pages/ZATCASettings";
import NotFound from "./pages/NotFound";
import TasksProjects from "./pages/TasksProjects";
import RequireAuth from "./components/RequireAuth";
import RequireSession from "./components/RequireSession";
import CompanySignup from "./pages/CompanySignup";
import ResetPassword from "./pages/ResetPassword";
import RegisterCompany from "./pages/RegisterCompany";
import CompanyStatus from "./pages/CompanyStatus";
import { CompanyProvider } from "./lib/companyContext";
import PlaceholderModule from "./components/PlaceholderModule";
import FleetOverview from "./pages/fleet/FleetOverview";
import FleetVehicles from "./pages/fleet/FleetVehicles";
import FleetDrivers from "./pages/fleet/FleetDrivers";
import FleetMaintenance from "./pages/fleet/FleetMaintenance";
import FleetDocuments from "./pages/fleet/FleetDocuments";
import FleetTrips from "./pages/fleet/FleetTrips";
import FleetFuel from "./pages/fleet/FleetFuel";
import { I18nProvider } from "./i18n";
import AppErrorBoundary from "./components/AppErrorBoundary";
import { installGlobalErrorHandlers } from "./lib/errorReporter";

// S16: الأخطاء غير الملتقطة والوعود المرفوضة تُسجَّل في سجل أخطاء النظام
installGlobalErrorHandlers();

/** S16: خطأ في صفحة يعرض شاشة الخطأ برقمه، والانتقال لصفحة أخرى يعيد العرض */
function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  return (
    <AppErrorBoundary area="page" resetKey={location.pathname}>
      {children}
    </AppErrorBoundary>
  );
}

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <I18nProvider>
      <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <CompanyProvider>
        <RouteErrorBoundary>
        <Routes>
          {/* Public Routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/employee/login" element={<EmployeeLogin />} />
          <Route path="/signup" element={<CompanySignup />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          {/* Signed in, company not active yet: registration / status */}
          <Route element={<RequireSession />}>
            <Route path="/register-company" element={<RegisterCompany />} />
            <Route path="/company-status" element={<CompanyStatus />} />
          </Route>

          {/* Protected routes — require a Supabase Auth session */}
          <Route element={<RequireAuth />}>

          {/* Employee Routes */}
          <Route path="/employee/dashboard" element={<EmployeePortal />} />
          <Route path="/employee/app" element={<EmployeePortal />} />
          <Route path="/hr/employee-dashboard" element={<EmployeePortal />} />

          {/* Admin - Employee Registration */}

          {/* Admin Routes */}
          <Route path="/" element={<Dashboard />} />
          <Route path="/sales" element={<Navigate to="/sales/quotations" replace />} />
          <Route path="/sales/quotations" element={<Quotations />} />
          <Route path="/sales/orders" element={<SalesOrders />} />
          <Route path="/sales/invoices" element={<SalesInvoices />} />
          <Route path="/sales/credit-note" element={<SalesCreditNote />} />
          {/* إشعار التسليم الفعلي هو سند الصرف في المخزون (يخصم الكمية ويقيّد التكلفة)؛ الصفحة القديمة كانت تحفظ في المتصفح فقط */}
          <Route path="/sales/delivery-note" element={<Navigate to="/inventory/delivery-notes" replace />} />
          <Route path="/purchases" element={<Navigate to="/purchases/invoices" replace />} />
          <Route path="/purchases/orders" element={<PurchaseOrders />} />
          <Route path="/purchases/invoices" element={<PurchaseInvoices />} />
          <Route path="/purchases/cash-expenses" element={<PurchaseCashExpenses />} />
          {/* الإشعار المدين للمورد صار طلب إشعار دائن لا يُرحَّل */}
          <Route path="/purchases/debit-notes" element={<PurchaseCreditRequests />} />
          {/* الإشعارات المدينة المرحّلة قبل التحويل: عرض فقط */}
          <Route path="/purchases/debit-notes/archive" element={<PurchaseDebitNotes key="debit-archive" noteType="purchase_debit" />} />
          <Route
            path="/purchases/credit-notes"
            element={<PurchaseDebitNotes key="purchase-credit" noteType="purchase_credit" />}
          />
          <Route path="/purchases/customs-declarations" element={<CustomsDeclarations />} />
          <Route path="/purchases/reports" element={<PurchaseReports />} />
          <Route path="/hr" element={<Navigate to="/hr/dashboard" replace />} />
          <Route path="/hr/dashboard" element={<HRDashboard />} />
          <Route path="/hr/employees" element={<HREmployees />} />
          <Route path="/hr/employees/new" element={<HREmployees />} />
          <Route path="/hr/employees/cooperative" element={<HREmployeesCooperative />} />
          <Route path="/hr/employees/inactive" element={<HREmployeesInactive />} />
          <Route path="/hr/user-logs" element={<HRUserLogs />} />
          <Route path="/hr/requests/send" element={<HRRequestsSend />} />
          <Route path="/hr/requests/incoming" element={<HRRequestsIncoming />} />
          <Route path="/hr/requests/sent" element={<HRRequestsSent />} />
          <Route path="/hr/requests/form-settings" element={<HRRequestFormSettings />} />
          <Route path="/hr/payroll" element={<Navigate to="/hr/payroll/statement" replace />} />
          <Route path="/hr/payroll/statement" element={<HRPayrollStatement />} />
          <Route path="/hr/payroll/statement/full-report" element={<HRPayrollFullReport />} />
          <Route path="/hr/payroll/archive" element={<HRPayrollArchive />} />
          <Route path="/hr/payroll/financial-data" element={<HRPayrollFinancialData />} />
          <Route path="/hr/payroll/transfer" element={<HRPayrollTransfer />} />
          <Route path="/hr/payroll/advances" element={<HRPayrollAdvances />} />
          <Route path="/hr/payroll/settings" element={<HRPayrollSettings />} />
          <Route path="/hr/attendance" element={<Navigate to="/hr/attendance/calculate" replace />} />
          <Route path="/hr/attendance/calculate" element={<HRAttendanceCalculate />} />
          <Route path="/hr/attendance/overtime" element={<HRAttendanceOvertime />} />
          <Route path="/hr/attendance/report" element={<HRAttendanceReport />} />
          <Route path="/hr/attendance/individual-group" element={<HRAttendancePreparation />} />
          <Route path="/hr/attendance/monthly" element={<HRAttendanceMonthlyReport />} />
          <Route path="/hr/attendance/schedules" element={<HRAttendanceSchedules />} />
          <Route path="/hr/penalties" element={<Navigate to="/hr/penalties/investigations" replace />} />
          <Route path="/hr/penalties/investigations" element={<HRPenaltiesInvestigations />} />
          <Route path="/hr/penalties/archive" element={<HRPenaltiesArchive />} />
          <Route path="/hr/penalties/warnings" element={<HRPenaltiesWarnings />} />
          <Route path="/hr/penalties/types" element={<HRPenaltiesTypes />} />
          <Route path="/hr/penalties/groups" element={<HRPenaltiesGroups />} />
          <Route path="/hr/penalties/decisions" element={<HRPenaltiesDecisions />} />
          <Route path="/hr/penalties/settings" element={<HRPenaltiesSettings />} />
          <Route path="/hr/leaves" element={<Navigate to="/hr/leaves/employees" replace />} />
          <Route path="/hr/leaves/employees" element={<HRLeavesEmployees />} />
          <Route path="/hr/leaves/types" element={<HRLeavesTypes />} />
          <Route path="/hr/leaves/annual-balance" element={<HRLeavesAnnualBalance />} />
          <Route path="/hr/leaves/other-balance" element={<HRLeavesOtherBalance />} />
          <Route path="/hr/leaves/chart" element={<HRLeavesChart />} />
          <Route path="/hr/leaves/holidays" element={<HRLeavesHolidays />} />
          <Route path="/hr/termination" element={<Navigate to="/hr/termination/dues-report" replace />} />
          <Route path="/hr/termination/dues-report" element={<HRTerminationDues />} />
          <Route path="/hr/termination/employees" element={<HRTerminationEmployees />} />
          <Route path="/hr/termination/clearance" element={<HRTerminationClearance />} />
          <Route path="/hr/termination/evacuation" element={<HRTerminationEvacuation />} />
          <Route path="/hr/termination/reasons" element={<HRTerminationReasons />} />
          <Route path="/hr/termination/settings" element={<HRTerminationSettings />} />
          <Route path="/hr/termination/interview-setup" element={<HRTerminationInterviewSetup />} />
          <Route path="/hr/insurance" element={<Navigate to="/hr/insurance/social" replace />} />
          <Route path="/hr/insurance/social" element={<HRInsuranceSocial />} />
          <Route path="/hr/insurance/overtime" element={<Navigate to="/hr/insurance/social" replace />} />
          <Route path="/hr/insurance/list" element={<HRInsuranceList />} />
          <Route path="/hr/insurance/medical" element={<HRInsuranceMedical />} />
          <Route path="/hr/approvals" element={<Navigate to="/hr/approvals/list" replace />} />
          <Route path="/hr/approvals/list" element={<HRApprovalsList />} />
          <Route path="/hr/approvals/add" element={<HRApprovalsAdd />} />
          <Route path="/hr/approvals/policies" element={<HRApprovalsPolicies />} />
          <Route path="/hr/organization" element={<Navigate to="/hr/organization/tree" replace />} />
          <Route path="/hr/organization/tree" element={<HROrgTree />} />
          <Route path="/hr/organization/branches" element={<HROrgBranches />} />
          <Route path="/hr/organization/departments" element={<HROrgDepartments />} />
          <Route path="/hr/organization/sections" element={<HROrgSections />} />
          <Route path="/hr/organization/units" element={<HROrgUnits />} />
          <Route path="/hr/organization/subunits" element={<HROrgSubunits />} />
          <Route path="/hr/organization/jobs" element={<HROrgJobs />} />
          <Route path="/hr/organization/work-locations" element={<HROrgWorkLocations />} />
          <Route path="/hr/organization/work-schedules" element={<HROrgWorkSchedules />} />
          <Route path="/hr/financial-setup" element={<Navigate to="/hr/financial-setup/allowances" replace />} />
          <Route path="/hr/financial-setup/allowances" element={<HRFinancialAllowances />} />
          <Route path="/hr/financial-setup/overtime" element={<HRFinancialOvertime />} />
          <Route path="/hr/financial-setup/deductions" element={<HRFinancialDeductions />} />
          <Route path="/hr/financial-setup/privileges" element={<HRFinancialPrivileges />} />
          <Route path="/hr/financial-setup/loans" element={<HRFinancialLoans />} />
          <Route path="/hr/financial-setup/employee-categories" element={<HRFinancialEmployeeCategories />} />
          <Route path="/hr/financial-setup/account-settings" element={<HRFinancialAccountSettings />} />
          <Route path="/hr/succession" element={<Navigate to="/hr/succession/positions" replace />} />
          <Route path="/hr/succession/positions" element={<HRSuccessionPositions />} />
          <Route path="/hr/succession/candidates" element={<HRSuccessionCandidates />} />
          <Route path="/hr/succession/development-plans" element={<HRSuccessionDevelopmentPlans />} />
          <Route path="/hr/succession/tracking-report" element={<HRSuccessionTrackingReport />} />
          <Route path="/hr/permissions" element={<Navigate to="/hr/permissions/roles" replace />} />
          <Route path="/hr/permissions/roles" element={<HRPermissionsRoles />} />
          <Route path="/hr/permissions/add-role" element={<HRPermissionsAddRole />} />
          <Route path="/hr/permissions/edit-role/:roleId" element={<HRPermissionsAddRole />} />
          <Route path="/hr/permissions/special-user" element={<HRSpecialUser />} />
          <Route path="/hr/deductions-emails" element={<HRDeductionsEmails />} />
          <Route path="/hr/structure" element={<HRDashboard />} />
          <Route path="/hr/certificates" element={<HRCertificates />} />
          <Route path="/hr/reports" element={<HRReports />} />
          <Route path="/hr/reports/full-employee" element={<HREmployeeFullReport />} />
          <Route path="/hr/settings" element={<HRSettings />} />
          <Route path="/inventory" element={<Navigate to="/inventory/products" replace />} />
          <Route path="/inventory/products" element={<InventoryProducts />} />
          <Route path="/inventory/receipts" element={<InventoryReceipts />} />
          <Route path="/inventory/issues" element={<InventoryIssues />} />
          <Route path="/inventory/delivery-notes" element={<InventoryIssues />} />
          <Route path="/inventory/transfers" element={<InventoryTransfers />} />
          <Route path="/inventory/counts" element={<InventoryCounts />} />
          <Route path="/inventory/adjustments" element={<InventoryAdjustments />} />
          <Route path="/inventory/manufacturing" element={<InventoryManufacturing />} />
          <Route path="/inventory/assembly" element={<InventoryAssembly />} />
          <Route path="/inventory/opening-balances" element={<InventoryOpeningBalances />} />
          <Route path="/inventory/warehouses" element={<InventoryWarehouses />} />
          <Route path="/inventory/reports" element={<InventoryReports />} />
          <Route path="/inventory/*" element={<PlaceholderModule title="المخزون" description="إدارة المنتجات والخدمات والمستودعات وعمليات المخزون." icon={Boxes} features={["عمليات جرد المخزون", "تسويات المخزون", "أوامر التصنيع", "أوامر التركيب", "إشعارات تسليم"]} />} />
          <Route path="/fleet" element={<FleetOverview />} />
          <Route path="/fleet/reports" element={<FleetOverview />} />
          <Route path="/fleet/vehicles" element={<FleetVehicles />} />
          <Route path="/fleet/drivers" element={<FleetDrivers />} />
          <Route path="/fleet/maintenance" element={<FleetMaintenance />} />
          <Route path="/fleet/insurance" element={<FleetDocuments />} />
          <Route path="/fleet/trips" element={<FleetTrips />} />
          <Route path="/fleet/fuel" element={<FleetFuel />} />
          <Route path="/fleet/*" element={<Navigate to="/fleet" replace />} />
          <Route path="/crm" element={<CRM />} />
          <Route path="/crm/customers" element={<CRM />} />
          <Route path="/crm/vendors" element={<CRM />} />
          <Route path="/crm/reports" element={<CRM />} />
          <Route path="/expenses" element={<ChartOfAccounts />} />
          <Route path="/expenses/bank-accounts" element={<BankAccounts />} />
          <Route path="/expenses/manual-journals" element={<ManualJournals />} />
          <Route path="/expenses/reclassification" element={<BulkReclassification />} />
          <Route path="/expenses/fixed-assets" element={<FixedAssets />} />
          <Route path="/expenses/settings" element={<AccountingSettings />} />
          {/* S13: ترحيل الرواتب من المحاسبة لصاحب «ترحيل الرواتب» (accounting.payroll_posting) بلا صلاحيات الموارد البشرية */}
          <Route path="/expenses/payroll-posting" element={<HRPayrollTransfer />} />
          <Route path="/expenses/vouchers" element={<ExpenseManagement />} />
          <Route path="/expenses/petty-cash" element={<ExpenseManagement />} />
          <Route path="/expenses/reports" element={<AccountingReports />} />
          <Route path="/expenses/accountant" element={<AccountantWorkspace />} />
          <Route path="/expenses/tax" element={<Tax />} />
          <Route path="/expenses/tax-reports" element={<TaxReports />} />
          {/* إدارة المستخدمين والأدوار وسجل النشاط في الموارد البشرية فقط */}
          <Route path="/users" element={<Navigate to="/hr/permissions/special-user" replace />} />
          <Route path="/users/roles" element={<Navigate to="/hr/permissions/roles" replace />} />
          <Route path="/users/audit" element={<Navigate to="/hr/user-logs" replace />} />
          <Route path="/ai" element={<AIAssistant />} />
          <Route path="/ai/assistant" element={<AIAssistant />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/subscription" element={<Subscription />} />
          <Route path="/zatca/settings" element={<ZATCASettings />} />
          <Route path="/tasks-projects" element={<TasksProjects />} />

          </Route>
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
        </RouteErrorBoundary>
        <SubscriptionErrorDialog />
        </CompanyProvider>
      </BrowserRouter>
      </TooltipProvider>
    </I18nProvider>
  </QueryClientProvider>
);

const container = document.getElementById("root");
if (container) {
  const root =
    (container as { __root?: ReturnType<typeof createRoot> }).__root ??
    createRoot(container);
  (container as { __root?: ReturnType<typeof createRoot> }).__root = root;
  root.render(
    <AppErrorBoundary area="root">
      <App />
    </AppErrorBoundary>,
  );
}
