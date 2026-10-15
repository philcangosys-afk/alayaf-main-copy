export type ReportFilterType = "select" | "date" | "number" | "text";

export interface ReportFilter {
  id: string;
  label: string;
  type: ReportFilterType;
  options?: string[]; // For select types
  required?: boolean;
}

export interface ReportSchema {
  id: string;
  title: string;
  filters: ReportFilter[];
  tableColumns: string[]; // Usually standard: Name, Job Title, Department, Management, Branch
}

const COMMON_COLUMNS = ["الاسم", "المسمى الوظيفي", "القسم", "الإدارة", "الفرع"];

export const reportSchemas: Record<string, ReportSchema> = {
  "إجازات": {
    id: "leaves",
    title: "إجازات",
    tableColumns: COMMON_COLUMNS,
    filters: [
      { id: "report_type", label: "نوع التقرير", type: "select", options: ["تقرير تفصيلي", "تقرير إجمالي"], required: true },
      { id: "leave_type", label: "نوع الإجازة", type: "select", options: ["الكل", "سنوية", "مرضية"] },
      { id: "branch", label: "الفرع", type: "select", options: ["الكل", "الفرع الرئيسي"] },
      { id: "management", label: "الإدارة", type: "select", options: ["الكل", "إدارة الموارد البشرية"] },
      { id: "department", label: "القسم", type: "select", options: ["الكل", "فندق منى كونكورد"] },
      { id: "work_location", label: "مكان العمل", type: "select", options: ["الكل"] },
      { id: "paid_leave", label: "إجازة مدفوعة الأجر", type: "select", options: ["الكل", "نعم", "لا"] },
      { id: "from_date", label: "من تاريخ", type: "date" },
      { id: "to_date", label: "إلى تاريخ", type: "date" },
    ]
  },
  "المساءلات والإنذارات": {
    id: "penalties_warnings",
    title: "المساءلات والإنذارات",
    tableColumns: COMMON_COLUMNS,
    filters: [
      { id: "report_type", label: "نوع التقرير", type: "select", options: ["تقرير المساءلات", "تقرير الإنذارات"], required: true },
      { id: "branch", label: "الفرع", type: "select", options: ["الكل"] },
      { id: "management", label: "الإدارة", type: "select", options: ["الكل"] },
      { id: "department", label: "القسم", type: "select", options: ["الكل"] },
      { id: "work_location", label: "مكان العمل", type: "select", options: ["الكل"] },
      { id: "penalty_group", label: "مجموعات المخالفات", type: "select", options: ["الكل"] },
      { id: "penalty_type", label: "المخالفة", type: "select", options: ["الكل"] },
      { id: "from_date", label: "من تاريخ", type: "date" },
      { id: "to_date", label: "إلى تاريخ", type: "date" },
    ]
  },
  "مصروفات الرواتب": {
    id: "payroll_expenses",
    title: "مصروفات الرواتب",
    tableColumns: COMMON_COLUMNS,
    filters: [
      { id: "report_type", label: "نوع التقرير", type: "select", options: ["تقرير مصروفات رواتب الموظفين ملخص"], required: true },
      { id: "branch", label: "الفرع", type: "select", options: ["الكل"] },
      { id: "management", label: "الإدارة", type: "select", options: ["الكل"] },
      { id: "department", label: "القسم", type: "select", options: ["الكل"] },
      { id: "work_location", label: "مكان العمل", type: "select", options: ["الكل"] },
      { id: "employee_category", label: "فئة الموظفين", type: "select", options: ["الكل"] },
      { id: "currency", label: "عملة", type: "select", options: ["SAR (عملة النظام)"] },
      { id: "from_date", label: "من تاريخ", type: "date" },
      { id: "to_date", label: "إلى تاريخ", type: "date" },
    ]
  },
  "بيانات مالية": {
    id: "financial_data",
    title: "بيانات مالية",
    tableColumns: COMMON_COLUMNS,
    filters: [
      { id: "branch", label: "الفرع", type: "select", options: ["الكل"] },
      { id: "management", label: "الإدارة", type: "select", options: ["الكل"] },
      { id: "department", label: "القسم", type: "select", options: ["الكل"] },
      { id: "work_location", label: "مكان العمل", type: "select", options: ["الكل"] },
      { id: "from_date", label: "من تاريخ", type: "date" },
      { id: "to_date", label: "إلى تاريخ", type: "date" },
    ]
  },
  "تقارير الصرف": {
    id: "disbursement_reports",
    title: "تقارير الصرف",
    tableColumns: COMMON_COLUMNS,
    filters: [
      { id: "report_type", label: "نوع التقرير", type: "select", options: ["تقرير تفصيلي"], required: true },
      { id: "branch", label: "الفرع", type: "select", options: ["الكل"] },
      { id: "management", label: "الإدارة", type: "select", options: ["الكل"] },
      { id: "department", label: "القسم", type: "select", options: ["الكل"] },
      { id: "disbursement_type", label: "نوع الصرف", type: "select", options: ["الكل"] },
      { id: "currency", label: "عملة", type: "select", options: ["SAR (عملة النظام)"] },
      { id: "from_date", label: "من تاريخ", type: "date" },
      { id: "to_date", label: "إلى تاريخ", type: "date" },
    ]
  },
  "حركات النقل": {
    id: "transfer_movements",
    title: "حركات النقل",
    tableColumns: COMMON_COLUMNS,
    filters: [
      { id: "branch", label: "الفرع", type: "select", options: ["الكل"] },
      { id: "management", label: "الإدارة", type: "select", options: ["الكل"] },
      { id: "department", label: "القسم", type: "select", options: ["الكل"] },
      { id: "from_date", label: "من تاريخ", type: "date" },
      { id: "to_date", label: "إلى تاريخ", type: "date" },
    ]
  },
  "دورات تدريبية": {
    id: "training_courses",
    title: "دورات تدريبية",
    tableColumns: COMMON_COLUMNS,
    filters: [
      { id: "report_type", label: "نوع التقرير", type: "select", options: ["البرامج والاحتياجات التدريبية"], required: true },
      { id: "branch", label: "الفرع", type: "select", options: ["الكل"] },
      { id: "management", label: "الإدارة", type: "select", options: ["الكل"] },
      { id: "department", label: "القسم", type: "select", options: ["الكل"] },
      { id: "from_date", label: "من تاريخ", type: "date" },
      { id: "to_date", label: "إلى تاريخ", type: "date" },
    ]
  },
  "عهد": {
    id: "custody",
    title: "عهد",
    tableColumns: COMMON_COLUMNS,
    filters: [
      { id: "branch", label: "الفرع", type: "select", options: ["الكل"] },
      { id: "management", label: "الإدارة", type: "select", options: ["الكل"] },
      { id: "department", label: "القسم", type: "select", options: ["الكل"] },
      { id: "from_date", label: "من تاريخ", type: "date" },
      { id: "to_date", label: "إلى تاريخ", type: "date" },
    ]
  },
  "تفاصيل شخصية": {
    id: "personal_details",
    title: "تفاصيل شخصية",
    tableColumns: COMMON_COLUMNS,
    filters: [
      { id: "branch", label: "الفرع", type: "select", options: ["الكل"] },
      { id: "management", label: "الإدارة", type: "select", options: ["الكل"] },
      { id: "department", label: "القسم", type: "select", options: ["الكل"] },
      { id: "work_location", label: "مكان العمل", type: "select", options: ["الكل"] },
    ]
  },
  "الحسابات البنكية": {
    id: "bank_accounts",
    title: "الحسابات البنكية",
    tableColumns: COMMON_COLUMNS,
    filters: [
      { id: "branch", label: "الفرع", type: "select", options: ["الكل"] },
      { id: "management", label: "الإدارة", type: "select", options: ["الكل"] },
      { id: "department", label: "القسم", type: "select", options: ["الكل"] },
      { id: "work_location", label: "مكان العمل", type: "select", options: ["الكل"] },
    ]
  },
  "الموظفين الجدد": {
    id: "new_employees",
    title: "الموظفين الجدد",
    tableColumns: COMMON_COLUMNS,
    filters: [
      { id: "branch", label: "الفرع", type: "select", options: ["الكل"] },
      { id: "management", label: "الإدارة", type: "select", options: ["الكل"] },
      { id: "department", label: "القسم", type: "select", options: ["الكل"] },
      { id: "work_location", label: "مكان العمل", type: "select", options: ["الكل"] },
      { id: "new_period", label: "الموظفين الذين تم تعيينهم حديثا لمدت", type: "select", options: ["60 يوم", "30 يوم", "90 يوم"] },
    ]
  },
  "قياس الأداء": {
    id: "performance_measurement",
    title: "قياس الأداء",
    tableColumns: COMMON_COLUMNS,
    filters: [
      { id: "branch", label: "الفرع", type: "select", options: ["الكل"] },
      { id: "management", label: "الإدارة", type: "select", options: ["الكل"] },
      { id: "department", label: "القسم", type: "select", options: ["الكل"] },
      { id: "year", label: "السنة", type: "select", options: ["2026 ميلادي"] },
      { id: "from_month", label: "من شهر", type: "select", options: ["يناير"] },
      { id: "to_month", label: "إلى شهر", type: "select", options: ["مارس"] },
    ]
  },
  "الإنتبدابات": {
    id: "secondments",
    title: "الإنتبدابات",
    tableColumns: COMMON_COLUMNS,
    filters: [
      { id: "branch", label: "الفرع", type: "select", options: ["الكل"] },
      { id: "management", label: "الإدارة", type: "select", options: ["الكل"] },
      { id: "department", label: "القسم", type: "select", options: ["الكل"] },
      { id: "work_location", label: "مكان العمل", type: "select", options: ["الكل"] },
      { id: "from_date", label: "من تاريخ", type: "date" },
      { id: "to_date", label: "إلى تاريخ", type: "date" },
    ]
  },
  "الحضور و الانصراف": {
    id: "attendance_departure",
    title: "الحضور و الانصراف",
    tableColumns: COMMON_COLUMNS,
    filters: [
      { id: "report_type", label: "نوع التقرير", type: "select", options: ["الحضور والانصراف"], required: true },
      { id: "branch", label: "الفرع", type: "select", options: ["الكل"] },
      { id: "management", label: "الإدارة", type: "select", options: ["الكل"] },
      { id: "department", label: "القسم", type: "select", options: ["الكل"] },
      { id: "work_location", label: "مكان العمل", type: "select", options: ["الكل"] },
      { id: "from_date", label: "من تاريخ", type: "date" },
      { id: "to_date", label: "إلى تاريخ", type: "date" },
    ]
  },
  "تقارير الاستئذانات": {
    id: "permissions_reports",
    title: "تقارير الاستئذانات",
    tableColumns: COMMON_COLUMNS,
    filters: [
      { id: "report_type", label: "نوع التقرير", type: "select", options: ["تقرير تفصيلي", "تقرير إجمالي"], required: true },
      { id: "branch", label: "الفرع", type: "select", options: ["الكل"] },
      { id: "management", label: "الإدارة", type: "select", options: ["الكل"] },
      { id: "department", label: "القسم", type: "select", options: ["الكل"] },
      { id: "work_location", label: "مكان العمل", type: "select", options: ["الكل"] },
      { id: "permission_type", label: "نوع الاستئذان", type: "select", options: ["الكل"] },
      { id: "from_date", label: "من تاريخ", type: "date" },
      { id: "to_date", label: "إلى تاريخ", type: "date" },
    ]
  },
  "مباشرة العمل": {
    id: "return_to_work",
    title: "مباشرة العمل",
    tableColumns: COMMON_COLUMNS,
    filters: [
      { id: "branch", label: "الفرع", type: "select", options: ["الكل"] },
      { id: "management", label: "الإدارة", type: "select", options: ["الكل"] },
      { id: "department", label: "القسم", type: "select", options: ["الكل"] },
      { id: "request_type", label: "نوع الطلب", type: "select", options: ["الكل"] },
      { id: "from_date", label: "من تاريخ", type: "date" },
      { id: "to_date", label: "إلى تاريخ", type: "date" },
    ]
  },
  "أرصدة الإجازات": {
    id: "leave_balances",
    title: "أرصدة الإجازات",
    tableColumns: COMMON_COLUMNS,
    filters: [
      { id: "report_type", label: "نوع التقرير", type: "select", options: ["أرصدة الإجازة السنوية", "أرصدة الإجازات الأخرى"], required: true },
      { id: "branch", label: "الفرع", type: "select", options: ["الكل"] },
      { id: "management", label: "الإدارة", type: "select", options: ["الكل"] },
      { id: "department", label: "القسم", type: "select", options: ["الكل"] },
    ]
  },
  "التأمينات الاجتماعية": {
    id: "social_insurance",
    title: "التأمينات الاجتماعية",
    tableColumns: COMMON_COLUMNS,
    filters: [
      { id: "branch", label: "الفرع", type: "select", options: ["الكل"] },
      { id: "management", label: "الإدارة", type: "select", options: ["الكل"] },
      { id: "department", label: "القسم", type: "select", options: ["الكل"] },
      { id: "work_location", label: "مكان العمل", type: "select", options: ["الكل"] },
    ]
  },
  "تقارير إنهاء الخدمة": {
    id: "end_of_service",
    title: "تقارير إنهاء الخدمة",
    tableColumns: COMMON_COLUMNS,
    filters: [
      { id: "report_type", label: "نوع التقرير", type: "select", options: ["الكل"], required: true },
      { id: "branch", label: "الفرع", type: "select", options: ["الكل"] },
      { id: "management", label: "الإدارة", type: "select", options: ["الكل"] },
      { id: "department", label: "القسم", type: "select", options: ["الكل"] },
      { id: "work_location", label: "مكان العمل", type: "select", options: ["الكل"] },
      { id: "from_date", label: "من تاريخ", type: "date" },
      { id: "to_date", label: "إلى تاريخ", type: "date" },
    ]
  },
  "قياس الرضا الوظيفي": {
    id: "job_satisfaction",
    title: "قياس الرضا الوظيفي",
    tableColumns: COMMON_COLUMNS,
    filters: [
      { id: "report_type", label: "نوع التقرير", type: "select", options: ["تحليل استبيان الرضا الوظيفي"], required: true },
      { id: "branch", label: "الفرع", type: "select", options: ["الكل"] },
      { id: "management", label: "الإدارة", type: "select", options: ["الكل"] },
      { id: "department", label: "القسم", type: "select", options: ["الكل"] },
      { id: "work_location", label: "مكان العمل", type: "select", options: ["الكل"] },
      { id: "year", label: "السنة", type: "select", options: ["2026 ميلادي"] },
    ]
  },
  "تقارير السلف": {
    id: "advances_reports",
    title: "تقارير السلف",
    tableColumns: COMMON_COLUMNS,
    filters: [
      { id: "branch", label: "الفرع", type: "select", options: ["الكل"] },
      { id: "management", label: "الإدارة", type: "select", options: ["الكل"] },
      { id: "department", label: "القسم", type: "select", options: ["الكل"] },
      { id: "work_location", label: "مكان العمل", type: "select", options: ["الكل"] },
      { id: "from_date", label: "من تاريخ", type: "date" },
      { id: "to_date", label: "إلى تاريخ", type: "date" },
    ]
  },
  "تقارير العمولات": {
    id: "commissions_reports",
    title: "تقارير العمولات",
    tableColumns: COMMON_COLUMNS,
    filters: [
      { id: "branch", label: "الفرع", type: "select", options: ["الكل"] },
      { id: "management", label: "الإدارة", type: "select", options: ["الكل"] },
      { id: "department", label: "القسم", type: "select", options: ["الكل"] },
      { id: "work_location", label: "مكان العمل", type: "select", options: ["الكل"] },
      { id: "year", label: "السنة", type: "select", options: ["الكل"] },
      { id: "month", label: "شهر", type: "select", options: ["كل الشهور"] },
    ]
  },
  "تقارير العمل الإضافي": {
    id: "overtime_reports",
    title: "تقارير العمل الإضافي",
    tableColumns: COMMON_COLUMNS,
    filters: [
      { id: "branch", label: "الفرع", type: "select", options: ["الكل"] },
      { id: "management", label: "الإدارة", type: "select", options: ["الكل"] },
      { id: "department", label: "القسم", type: "select", options: ["الكل"] },
      { id: "work_location", label: "مكان العمل", type: "select", options: ["الكل"] },
      { id: "from_date", label: "من تاريخ", type: "date" },
      { id: "to_date", label: "إلى تاريخ", type: "date" },
    ]
  }
};
