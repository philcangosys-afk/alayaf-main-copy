export type AccountNode = {
  code: string;
  nameAr: string;
  nameEn: string;
  cashFlowType: string;
  enablePayments: boolean;
  showExpenseClaims: boolean;
  accountType: string;
  level: number;
  isMainCategory?: boolean;
  categoryColor?: string;
  currencyBadge?: string;
  isSystem?: boolean;
  parentCode: string;
};

export const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  assets: { bg: "bg-blue-600", text: "text-white", border: "border-blue-600" },
  liabilities: { bg: "bg-orange-500", text: "text-white", border: "border-orange-500" },
  equity: { bg: "bg-purple-600", text: "text-white", border: "border-purple-600" },
  revenue: { bg: "bg-green-600", text: "text-white", border: "border-green-600" },
  expenses: { bg: "bg-red-500", text: "text-white", border: "border-red-500" },
};

export const CASH_FLOW_TYPES = ["التشغيليات", "الاستثمارات", "التمويليات", "نقد"] as const;

export const ACCOUNT_TYPES = ["التشغيليات", "الاستثمارات", "التمويليات"] as const;

export const defaultAccounts: AccountNode[] = [
  // ===== 1 - الأصول =====
  { code: "1", nameAr: "الأصول", nameEn: "Assets", cashFlowType: "", enablePayments: false, showExpenseClaims: false, accountType: "التشغيليات", level: 0, isMainCategory: true, categoryColor: "assets", isSystem: true, parentCode: "" },
  { code: "11", nameAr: "الأصول المتداولة", nameEn: "Current Assets", cashFlowType: "التشغيليات", enablePayments: false, showExpenseClaims: false, accountType: "التشغيليات", level: 1, isSystem: true, parentCode: "1" },
  { code: "111", nameAr: "النقد وما يعادله", nameEn: "Cash and Equivalents", cashFlowType: "نقد", enablePayments: false, showExpenseClaims: false, accountType: "التشغيليات", level: 2, parentCode: "11" },
  { code: "1111", nameAr: "الخزينة", nameEn: "Treasury", cashFlowType: "نقد", enablePayments: true, showExpenseClaims: false, accountType: "التشغيليات", level: 3, currencyBadge: "SAR", parentCode: "111" },
  { code: "1112", nameAr: "النقد وما يعادله", nameEn: "Cash Equivalents", cashFlowType: "نقد", enablePayments: true, showExpenseClaims: false, accountType: "التشغيليات", level: 3, parentCode: "111" },
  { code: "1113", nameAr: "الحساب البنكي", nameEn: "Bank Account", cashFlowType: "نقد", enablePayments: true, showExpenseClaims: false, accountType: "التشغيليات", level: 3, currencyBadge: "SAR", parentCode: "111" },
  { code: "112", nameAr: "الذمم", nameEn: "Receivables", cashFlowType: "التشغيليات", enablePayments: false, showExpenseClaims: false, accountType: "التشغيليات", level: 2, parentCode: "11" },
  { code: "113", nameAr: "سلف الموظفين", nameEn: "Employee Advances", cashFlowType: "التشغيليات", enablePayments: false, showExpenseClaims: false, accountType: "التشغيليات", level: 2, parentCode: "11" },
  { code: "114", nameAr: "مصروفات مدفوعة مقدماً", nameEn: "Prepaid Expenses", cashFlowType: "التشغيليات", enablePayments: false, showExpenseClaims: false, accountType: "التشغيليات", level: 2, parentCode: "11" },
  { code: "115", nameAr: "إدارة المخزون", nameEn: "Inventory Management", cashFlowType: "التشغيليات", enablePayments: false, showExpenseClaims: false, accountType: "التشغيليات", level: 2, parentCode: "11" },
  { code: "1151", nameAr: "المشروع الرئيسي", nameEn: "Main Project", cashFlowType: "التشغيليات", enablePayments: false, showExpenseClaims: false, accountType: "التشغيليات", level: 3, parentCode: "115" },
  { code: "12", nameAr: "الأصول غير المتداولة", nameEn: "Non-Current Assets", cashFlowType: "الاستثمارات", enablePayments: false, showExpenseClaims: false, accountType: "الاستثمارات", level: 1, isSystem: true, parentCode: "1" },
  { code: "121", nameAr: "الأصول الثابتة", nameEn: "Fixed Assets", cashFlowType: "الاستثمارات", enablePayments: false, showExpenseClaims: false, accountType: "الاستثمارات", level: 2, parentCode: "12" },
  { code: "1211", nameAr: "المعدات والأجهزة", nameEn: "Equipment", cashFlowType: "الاستثمارات", enablePayments: false, showExpenseClaims: false, accountType: "الاستثمارات", level: 3, parentCode: "121" },
  { code: "1212", nameAr: "مجمع الإهلاك التراكمي", nameEn: "Accumulated Depreciation", cashFlowType: "الاستثمارات", enablePayments: false, showExpenseClaims: false, accountType: "الاستثمارات", level: 3, parentCode: "121" },

  // ===== 2 - الإلتزامات =====
  { code: "2", nameAr: "الإلتزامات", nameEn: "Liabilities", cashFlowType: "", enablePayments: false, showExpenseClaims: false, accountType: "التشغيليات", level: 0, isMainCategory: true, categoryColor: "liabilities", isSystem: true, parentCode: "" },
  { code: "21", nameAr: "الإلتزامات المتداولة", nameEn: "Current Liabilities", cashFlowType: "التشغيليات", enablePayments: false, showExpenseClaims: false, accountType: "التشغيليات", level: 1, isSystem: true, parentCode: "2" },
  { code: "2111", nameAr: "ضريبة القيمة المضافة على الحسابات الدائنة", nameEn: "VAT on Payables", cashFlowType: "التشغيليات", enablePayments: false, showExpenseClaims: false, accountType: "التشغيليات", level: 2, parentCode: "21" },
  { code: "2112", nameAr: "ذمم مستحقة الدفع", nameEn: "Accounts Payable", cashFlowType: "التشغيليات", enablePayments: false, showExpenseClaims: false, accountType: "التشغيليات", level: 2, parentCode: "21" },
  { code: "213", nameAr: "إيرادات غير مكتسبة", nameEn: "Unearned Revenue", cashFlowType: "التشغيليات", enablePayments: false, showExpenseClaims: false, accountType: "التشغيليات", level: 2, parentCode: "21" },
  { code: "214", nameAr: "رواتب مستحقة غير مدفوعة", nameEn: "Accrued Salaries", cashFlowType: "التشغيليات", enablePayments: false, showExpenseClaims: false, accountType: "التشغيليات", level: 2, parentCode: "21" },
  { code: "215", nameAr: "إكراميات ومكافآت نهاية الخدمة", nameEn: "End of Service Benefits", cashFlowType: "التشغيليات", enablePayments: false, showExpenseClaims: false, accountType: "التشغيليات", level: 2, parentCode: "21" },
  { code: "216", nameAr: "قروض من بنوك", nameEn: "Bank Loans", cashFlowType: "التمويليات", enablePayments: false, showExpenseClaims: false, accountType: "التمويليات", level: 2, parentCode: "21" },
  { code: "2151", nameAr: "تعويضات الموظفين", nameEn: "Employee Compensation", cashFlowType: "التشغيليات", enablePayments: false, showExpenseClaims: false, accountType: "التشغيليات", level: 3, parentCode: "215" },
  { code: "218", nameAr: "القروض المستحقة", nameEn: "Due Loans", cashFlowType: "التمويليات", enablePayments: false, showExpenseClaims: false, accountType: "التمويليات", level: 2, parentCode: "21" },
  { code: "219", nameAr: "ضريبة المبيعات الاحتياطية المستحقة", nameEn: "Accrued Sales Tax", cashFlowType: "التشغيليات", enablePayments: false, showExpenseClaims: false, accountType: "التشغيليات", level: 2, parentCode: "21" },
  { code: "22", nameAr: "الإلتزامات غير المتداولة", nameEn: "Non-Current Liabilities", cashFlowType: "التمويليات", enablePayments: false, showExpenseClaims: false, accountType: "التمويليات", level: 1, isSystem: true, parentCode: "2" },

  // ===== 3 - حقوق ملكية =====
  { code: "3", nameAr: "حقوق ملكية من رصيد افتتاحي", nameEn: "Owner's Equity", cashFlowType: "", enablePayments: false, showExpenseClaims: false, accountType: "التمويليات", level: 0, isMainCategory: true, categoryColor: "equity", isSystem: true, parentCode: "" },
  { code: "31", nameAr: "حقوق ملكية", nameEn: "Equity", cashFlowType: "التمويليات", enablePayments: false, showExpenseClaims: false, accountType: "التمويليات", level: 1, parentCode: "3" },
  { code: "311", nameAr: "إعادة الغرض الإسلامي", nameEn: "Islamic Purpose Reserve", cashFlowType: "التمويليات", enablePayments: false, showExpenseClaims: false, accountType: "التمويليات", level: 2, parentCode: "31" },
  { code: "32", nameAr: "حقوق ملكية اخرى", nameEn: "Other Equity", cashFlowType: "التمويليات", enablePayments: false, showExpenseClaims: false, accountType: "التمويليات", level: 1, parentCode: "3" },
  { code: "321", nameAr: "رأس المال", nameEn: "Capital", cashFlowType: "التمويليات", enablePayments: false, showExpenseClaims: false, accountType: "التمويليات", level: 2, parentCode: "32" },
  { code: "322", nameAr: "المسحوبات", nameEn: "Drawings", cashFlowType: "التمويليات", enablePayments: false, showExpenseClaims: false, accountType: "التمويليات", level: 2, parentCode: "32" },
  { code: "33", nameAr: "الأرباح المحتجزة", nameEn: "Retained Earnings", cashFlowType: "التمويليات", enablePayments: false, showExpenseClaims: false, accountType: "التمويليات", level: 1, parentCode: "3" },
  { code: "331", nameAr: "الأرباح المحتجزة", nameEn: "Retained Earnings", cashFlowType: "التمويليات", enablePayments: false, showExpenseClaims: false, accountType: "التمويليات", level: 2, parentCode: "33" },

  // ===== 4 - الإيرادات =====
  { code: "4", nameAr: "الإيرادات", nameEn: "Revenue", cashFlowType: "", enablePayments: false, showExpenseClaims: false, accountType: "التشغيليات", level: 0, isMainCategory: true, categoryColor: "revenue", isSystem: true, parentCode: "" },
  { code: "41", nameAr: "الإيرادات", nameEn: "Revenue", cashFlowType: "التشغيليات", enablePayments: false, showExpenseClaims: false, accountType: "التشغيليات", level: 1, parentCode: "4" },
  { code: "411", nameAr: "إيرادات المبيعات والخدمات", nameEn: "Sales and Services Revenue", cashFlowType: "التشغيليات", enablePayments: false, showExpenseClaims: false, accountType: "التشغيليات", level: 2, parentCode: "41" },
  { code: "42", nameAr: "الدخل الآخر", nameEn: "Other Income", cashFlowType: "التشغيليات", enablePayments: false, showExpenseClaims: false, accountType: "التشغيليات", level: 1, parentCode: "4" },
  { code: "421", nameAr: "أرباح وخسائر غير محققة", nameEn: "Unrealized Gains/Losses", cashFlowType: "التشغيليات", enablePayments: false, showExpenseClaims: false, accountType: "التشغيليات", level: 2, parentCode: "42" },
  { code: "45", nameAr: "رأس أموال إضافي المدفوع", nameEn: "Additional Paid-in Capital", cashFlowType: "التشغيليات", enablePayments: false, showExpenseClaims: false, accountType: "التشغيليات", level: 1, parentCode: "4" },

  // ===== 5 - المصروفات =====
  { code: "5", nameAr: "المصروفات", nameEn: "Expenses", cashFlowType: "", enablePayments: false, showExpenseClaims: false, accountType: "التشغيليات", level: 0, isMainCategory: true, categoryColor: "expenses", isSystem: true, parentCode: "" },
  { code: "51", nameAr: "المصروفات", nameEn: "Expenses", cashFlowType: "التشغيليات", enablePayments: false, showExpenseClaims: true, accountType: "التشغيليات", level: 1, parentCode: "5" },
  { code: "511", nameAr: "الحسابات الأخرى", nameEn: "Other Accounts", cashFlowType: "التشغيليات", enablePayments: false, showExpenseClaims: true, accountType: "التشغيليات", level: 2, parentCode: "51" },
  { code: "512", nameAr: "إيرادات أخرى", nameEn: "Other Revenue", cashFlowType: "التشغيليات", enablePayments: false, showExpenseClaims: true, accountType: "التشغيليات", level: 2, parentCode: "51" },
  { code: "513", nameAr: "إيرادات عبد المواهب", nameEn: "Abdul Mawahib Revenue", cashFlowType: "التشغيليات", enablePayments: false, showExpenseClaims: true, accountType: "التشغيليات", level: 2, parentCode: "51" },
  { code: "514", nameAr: "إيرادات أخرى", nameEn: "Other Revenue", cashFlowType: "التشغيليات", enablePayments: false, showExpenseClaims: true, accountType: "التشغيليات", level: 2, parentCode: "51" },
  { code: "52", nameAr: "إيرادات أخرى", nameEn: "Other Revenue", cashFlowType: "التشغيليات", enablePayments: false, showExpenseClaims: false, accountType: "التشغيليات", level: 1, parentCode: "5" },
];
