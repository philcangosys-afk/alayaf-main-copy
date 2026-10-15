export type PermissionLevel = boolean | "read" | "manage";
export type PermissionMap = Record<string, PermissionLevel>;

export type UserSession = {
  id: string;
  email: string;
  empId: string;
  name: string;
  role: string;
  permissions: PermissionMap;
  portal: "business" | "employee";
  accountType?: "employee" | "special";
};

export function readUserSession(): UserSession | null {
  try {
    const value = localStorage.getItem("user_session");
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<UserSession>;
    if (!parsed.id || !parsed.portal) return null;
    return {
      id: parsed.id,
      email: parsed.email ?? "",
      empId: parsed.empId ?? "",
      name: parsed.name ?? "",
      role: parsed.role ?? "",
      permissions: parsed.permissions ?? {},
      portal: parsed.portal,
      accountType: parsed.accountType ?? "employee",
    };
  } catch {
    return null;
  }
}

/** Check a permission key against a live permissions map fetched from DB. */
export function checkPerm(liveMap: PermissionMap, ...keys: string[]): boolean {
  if (liveMap["*"] === true || liveMap["*"] === "read" || liveMap["*"] === "manage") return true;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(liveMap, key)) continue;
    const value = liveMap[key];
    return value === true || value === "read" || value === "manage";
  }
  return false;
}

export function canManagePerm(
  liveMap: PermissionMap,
  ...keys: string[]
): boolean {
  if (liveMap["*"] === true || liveMap["*"] === "manage") return true;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(liveMap, key)) continue;
    const value = liveMap[key];
    return value === true || value === "manage";
  }
  return false;
}

export function permissionLevel(
  liveMap: PermissionMap,
  ...keys: string[]
): "none" | "read" | "manage" {
  if (!checkPerm(liveMap, ...keys)) return "none";
  return canManagePerm(liveMap, ...keys) ? "manage" : "read";
}

// ── Legacy helpers kept for non-sidebar code ─────────────────────────────────
export function hasPermission(
  session: UserSession | null,
  ...keys: string[]
): boolean {
  if (!session) return false;
  return checkPerm(session.permissions, ...keys);
}

export function hasFullAccess(session: UserSession | null): boolean {
  if (!session) return false;
  const perms = session.permissions;
  const keys = Object.keys(perms);
  if (perms["*"] === true || perms["*"] === "manage") return true;
  if (keys.length === 0) return false;
  return keys.every((k) => perms[k] === true || perms[k] === "manage");
}

// ── Path → permission key helpers ────────────────────────────────────────────
export function permissionForMainPath(path: string): string | null {
  if (path === "/") return null;
  if (path.startsWith("/sales")) return "module.sales";
  if (path.startsWith("/purchases")) return "module.purchases";
  if (path.startsWith("/hr")) return "module.hr";
  if (path.startsWith("/crm")) return "module.crm";
  if (path.startsWith("/expenses")) return "module.accounting";
  if (path.startsWith("/inventory")) return "module.inventory";
  if (path.startsWith("/users") || path.startsWith("/admin")) return "module.users";
  if (path.startsWith("/fleet")) return "module.fleet";
  if (path.startsWith("/ai")) return "module.ai";
  if (path.startsWith("/zatca")) return "module.settings";
  if (path.startsWith("/settings")) return "module.settings";
  return null;
}

export function permissionForMainSubPath(path: string): string[] {
  const rules: Array<[string, string, string]> = [
    ["/sales/quotations", "sales.quotations", "module.sales"],
    ["/sales/orders", "sales.orders", "module.sales"],
    ["/sales/invoices", "sales.invoices", "module.sales"],
    ["/sales/credit-note", "sales.credit_notes", "module.sales"],
    ["/sales/delivery-note", "sales.delivery_notes", "module.sales"],
    ["/purchases/invoices", "purchases.invoices", "module.purchases"],
    ["/purchases/cash-expenses", "purchases.cash_expenses", "module.purchases"],
    ["/purchases/debit-notes", "purchases.debit_notes", "module.purchases"],
    ["/purchases/credit-notes", "purchases.credit_notes", "module.purchases"],
    ["/purchases/customs-declarations", "purchases.invoices", "module.purchases"],
    ["/purchases/orders", "purchases.orders", "module.purchases"],
    ["/purchases/reports", "purchases.reports", "module.purchases"],
    ["/inventory/products", "inventory.items", "module.inventory"],
    ["/inventory/receipts", "inventory.movements", "module.inventory"],
    ["/inventory/issues", "inventory.movements", "module.inventory"],
    ["/inventory/delivery-notes", "inventory.movements", "module.inventory"],
    ["/inventory/transfers", "inventory.movements", "module.inventory"],
    ["/inventory/counts", "inventory.movements", "module.inventory"],
    ["/inventory/adjustments", "inventory.movements", "module.inventory"],
    ["/inventory/manufacturing", "inventory.movements", "module.inventory"],
    ["/inventory/assembly", "inventory.movements", "module.inventory"],
    ["/inventory/opening-balances", "inventory.movements", "module.inventory"],
    ["/inventory/warehouses", "inventory.warehouses", "module.inventory"],
    ["/inventory/reports", "inventory.reports", "module.inventory"],
    ["/crm/customers", "crm.customers", "module.crm"],
    ["/crm/vendors", "crm.vendors", "module.crm"],
    ["/crm/reports", "crm.reports", "module.crm"],
    ["/expenses/reports", "accounting.reports", "module.accounting"],
    ["/expenses/tax-reports", "accounting.tax_reports", "module.accounting"],
    ["/expenses/tax", "accounting.tax", "module.accounting"],
    ["/expenses/reclassification", "accounting.reclassification", "module.accounting"],
    ["/expenses/manual-journals", "accounting.manual_journals", "module.accounting"],
    ["/expenses/settings", "accounting.settings", "module.accounting"],
    ["/expenses/fixed-assets", "accounting.fixed_assets", "module.accounting"],
    ["/expenses", "accounting.accounts", "module.accounting"],
    ["/fleet/vehicles", "fleet.vehicles", "module.fleet"],
    ["/fleet/drivers", "fleet.drivers", "module.fleet"],
    ["/fleet/maintenance", "fleet.maintenance", "module.fleet"],
    ["/fleet/insurance", "fleet.insurance", "module.fleet"],
    ["/fleet/trips", "fleet.trips", "module.fleet"],
    ["/fleet/fuel", "fleet.fuel", "module.fleet"],
    ["/fleet/reports", "fleet.reports", "module.fleet"],
    ["/fleet", "fleet.reports", "module.fleet"],
    ["/users/roles", "users.roles", "module.users"],
    ["/users/audit", "users.audit", "module.users"],
    ["/users", "users.list", "module.users"],
    ["/ai", "ai.assistant", "module.ai"],
  ];
  const match = rules.find(([prefix]) => path.startsWith(prefix));
  return match ? [match[1], match[2]] : [permissionForMainPath(path) ?? ""];
}

export function permissionForHRPath(path: string): string[] {
  if (path === "/hr" || path === "/hr/dashboard") return ["module.hr"];
  // سجل النشاط: لمن يملك سجل المستخدمين (users.audit) أو إدارة الموظفين، كما تسمح قاعدة البيانات
  if (path.startsWith("/hr/user-logs")) return ["users.audit", "module.users", "hr.employees", "module.hr"];
  const groups: Array<[string, string]> = [
    ["/hr/employees", "hr.employees"],
    ["/hr/requests", "hr.requests"],
    ["/hr/attendance", "hr.attendance"],
    ["/hr/payroll", "hr.payroll"],
    ["/hr/reports", "hr.reports"],
    ["/hr/penalties", "hr.penalties"],
    ["/hr/leaves", "hr.leaves"],
    ["/hr/termination", "hr.termination"],
    ["/hr/insurance", "hr.insurance"],
    ["/hr/approvals", "hr.approvals"],
    ["/hr/financial-setup", "hr.finance_setup"],
    ["/hr/succession", "hr.succession"],
    ["/hr/certificates", "hr.certificates"],
    ["/hr/organization", "hr.org"],
    ["/hr/permissions", "hr.permissions"],
    ["/hr/settings", "hr.settings"],
  ];
  const group = groups.find(([prefix]) => path.startsWith(prefix));
  if (!group) return ["module.hr"];
  const suffix = path
    .slice(group[0].length)
    .replace(/^\//, "")
    .replace(/\//g, ".");
  return suffix
    ? [`${group[1]}.${suffix}`, group[1], "module.hr"]
    : [group[1], "module.hr"];
}
