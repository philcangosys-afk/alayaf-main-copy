export type FieldType =
  | "text"
  | "number"
  | "date"
  | "time"
  | "select"
  | "textarea"
  | "radio"
  | "table"
  | "info"
  | "file";

export interface FormField {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: { label: string; value: string }[];
  colSpan?: 1 | 2;
  placeholder?: string;
  tableColumns?: string[];
  infoContent?: React.ReactNode;
}

export interface FormSchema {
  id: string;
  title: string;
  fields: FormField[];
}

export const requestFormSchemas: Record<string, FormSchema> = {
  accommodation: {
    id: "accommodation",
    title: "استئذان",
    fields: [
      {
        name: "type",
        label: "نوع الاستئذان",
        type: "select",
        required: true,
        options: [
          { label: "شخصي", value: "personal" },
          { label: "عمل", value: "work" },
        ],
      },
      { name: "date", label: "تاريخ الاستئذان", type: "date", required: true },
      { name: "from_time", label: "من الساعة", type: "time", required: true },
      { name: "to_time", label: "إلى الساعة", type: "time", required: true },
      {
        name: "reason",
        label: "السبب",
        type: "textarea",
        required: true,
        colSpan: 2,
      },
    ],
  },
  advance: {
    id: "advance",
    title: "السلف",
    fields: [
      {
        name: "advance_type",
        label: "أنواع السلف",
        type: "select",
        required: false,
        options: [
          { label: "سلفة شخصية", value: "personal" },
          { label: "سلفة طارئة", value: "emergency" },
          { label: "سلفة سكن", value: "housing" },
          { label: "سلفة زواج", value: "marriage" },
          { label: "سلفة علاجية", value: "medical" },
          { label: "سلفة تعليمية", value: "education" },
          { label: "سلفة أخرى", value: "other" },
        ],
      },
      {
        name: "currency",
        label: "عملة",
        type: "select",
        required: true,
        options: [
          { label: "ريال سعودي (SAR)", value: "SAR" },
          { label: "دولار (USD)", value: "USD" },
        ],
      },
      { name: "amount", label: "قيمة القرض", type: "number", required: true },
      {
        name: "payment_method",
        label: "طريقة السداد",
        type: "select",
        required: false,
        options: [
          { label: "اقتطاع من الراتب", value: "salary" },
          { label: "تحويل بنكي", value: "bank" },
          { label: "نقداً", value: "cash" },
        ],
      },
      {
        name: "start_date",
        label: "تاريخ بداية الاستقطاع",
        type: "date",
        required: true,
      },
      {
        name: "installments",
        label: "عدد الأقساط الشهرية",
        type: "number",
        required: true,
      },
      {
        name: "installment_amount",
        label: "قيمة القسط الشهري",
        type: "number",
        required: false,
      },
      {
        name: "guarantor",
        label: "الكفيل",
        type: "select",
        options: [
          { label: "بدون كفيل", value: "none" },
          { label: "كفيل داخلي", value: "internal" },
          { label: "كفيل خارجي", value: "external" },
        ],
      },
      { name: "phone", label: "رقم الهاتف", type: "text", required: true },
      { name: "notes", label: "ملاحظات", type: "textarea", colSpan: 2 },
    ],
  },
  disbursement: {
    id: "disbursement",
    title: "الصرف",
    fields: [
      { name: "type", label: "نوع الصرف", type: "select", required: true },
      {
        name: "beneficiary_type",
        label: "نوع صاحب الاستحقاق",
        type: "radio",
        required: true,
        options: [
          { label: "داخلي", value: "internal" },
          { label: "خارجي", value: "external" },
        ],
      },
      {
        name: "beneficiary_name",
        label: "اسم الجهة المستفيدة",
        type: "text",
        required: true,
      },
      {
        name: "invoice_number",
        label: "رقم الفاتورة",
        type: "text",
        required: true,
      },
      { name: "amount", label: "المبلغ", type: "number", required: true },
      {
        name: "currency",
        label: "عملة",
        type: "select",
        required: true,
        options: [{ label: "SAR", value: "SAR" }],
      },
      {
        name: "purpose",
        label: "الغرض",
        type: "textarea",
        required: true,
        colSpan: 2,
      },
    ],
  },
  custody: {
    id: "custody",
    title: "عهدة",
    fields: [
      {
        name: "previous",
        label: "العهد السابقة التي استلمتها",
        type: "table",
        tableColumns: [
          "رقم العهدة",
          "تاريخ التسليم",
          "العدد",
          "العهدة",
          "الوصف",
          "ملفات",
        ],
        colSpan: 2,
      },
      {
        name: "type",
        label: "نوع العهدة",
        type: "text",
        required: true,
        colSpan: 2,
      },
      {
        name: "reason",
        label: "السبب",
        type: "textarea",
        required: true,
        colSpan: 2,
      },
    ],
  },
  transfer: {
    id: "transfer",
    title: "نقل",
    fields: [
      {
        name: "employee",
        label: "الموظف",
        type: "select",
        required: true,
        colSpan: 2,
      },
      { name: "new_branch", label: "الفرع", type: "select", required: true },
      { name: "new_dept", label: "القسم", type: "select", required: true },
      {
        name: "new_management",
        label: "الإدارة",
        type: "select",
        required: true,
      },
      {
        name: "new_manager",
        label: "المدير المباشر",
        type: "select",
        required: true,
      },
      {
        name: "new_location",
        label: "مكان العمل",
        type: "select",
        required: true,
      },
      {
        name: "transfer_date",
        label: "تاريخ النقل",
        type: "date",
        required: true,
      },
      { name: "work_time", label: "وقت العمل", type: "select", required: true },
      { name: "notes", label: "ملاحظات", type: "textarea", colSpan: 2 },
    ],
  },
  training: {
    id: "training",
    title: "دورة تدريبية",
    fields: [
      {
        name: "previous",
        label: "الدورات التدريبية الخاصة بي",
        type: "table",
        tableColumns: [
          "اسم الدورة",
          "مؤسسة التدريب",
          "تاريخ البداية",
          "تاريخ الانتهاء",
          "التكلفة التقديرية",
          "ملاحظات",
          "تأكيد الاستلام",
        ],
        colSpan: 2,
      },
      {
        name: "in_plan",
        label: "مدرجة ضمن الخطة التدريبية",
        type: "select",
        required: true,
      },
      {
        name: "requesting_entity",
        label: "الجهة الطالبة",
        type: "text",
        required: true,
      },
      {
        name: "course_name",
        label: "اسم الدورة",
        type: "text",
        required: true,
      },
      {
        name: "proposed_date",
        label: "الموعد المقترح",
        type: "date",
        required: true,
      },
      {
        name: "end_date",
        label: "تاريخ الانتهاء",
        type: "date",
        required: true,
      },
      {
        name: "estimated_cost",
        label: "التكلفة التقديرية",
        type: "number",
        required: true,
      },
      {
        name: "currency",
        label: "عملة",
        type: "select",
        required: true,
        options: [{ label: "SAR", value: "SAR" }],
      },
      {
        name: "reason",
        label: "سبب طلب الدورة",
        type: "textarea",
        required: true,
        colSpan: 2,
      },
    ],
  },
  overtime: {
    id: "overtime",
    title: "عمل إضافي",
    fields: [
      { name: "employee", label: "الموظف", type: "select", required: true },
      { name: "date", label: "التاريخ", type: "date", required: true },
      {
        name: "type",
        label: "نوع الساعات الإضافية",
        type: "select",
        required: true,
      },
      { name: "from_time", label: "من الساعة", type: "time", required: true },
      { name: "to_time", label: "إلى الساعة", type: "time", required: true },
      {
        name: "tasks",
        label: "وذلك لإنجاز المهام التالية",
        type: "text",
        colSpan: 2,
      },
    ],
  },
  purchase: {
    id: "purchase",
    title: "شراء",
    fields: [
      {
        name: "items",
        label: "الأصناف",
        type: "table",
        tableColumns: [
          "الصنف",
          "سعر الصنف",
          "الكمية",
          "وصف الصنف",
          "ملاحظات",
          "الأمر",
        ],
        colSpan: 2,
      },
    ],
  },
  maintenance: {
    id: "maintenance",
    title: "صيانة",
    fields: [
      { name: "title", label: "عنوان الطلب", type: "text", required: true },
      { name: "cost", label: "التكلفة", type: "text" },
      {
        name: "details",
        label: "تفاصيل",
        type: "textarea",
        required: true,
        colSpan: 2,
      },
    ],
  },
  secondment: {
    id: "secondment",
    title: "انتداب",
    fields: [
      { name: "entity", label: "الجهة الطالبة", type: "text", required: true },
      { name: "type", label: "نوع الانتداب", type: "select", required: true },
      { name: "mission", label: "مهمة الانتداب", type: "text", required: true },
      {
        name: "location",
        label: "موقع الانتداب",
        type: "text",
        required: true,
      },
      {
        name: "start_date",
        label: "تاريخ الذهاب",
        type: "date",
        required: true,
      },
      { name: "end_date", label: "تاريخ العودة", type: "date", required: true },
      { name: "duration", label: "المدة", type: "text", required: true },
      {
        name: "details",
        label: "تفاصيل",
        type: "textarea",
        required: true,
        colSpan: 2,
      },
    ],
  },
  return_work: {
    id: "return_work",
    title: "مباشرة العمل",
    fields: [
      {
        name: "return_date",
        label: "تاريخ المباشرة بعد العودة من الإجازة",
        type: "date",
        required: true,
        colSpan: 2,
      },
      {
        name: "notes",
        label: "ملاحظات",
        type: "textarea",
        required: true,
        colSpan: 2,
      },
    ],
  },
  clearance: {
    id: "clearance",
    title: "إخلاء طرف",
    fields: [
      {
        name: "reason",
        label: "سبب الإخلاء",
        type: "select",
        required: true,
        colSpan: 2,
      },
      { name: "notes", label: "الملاحظات", type: "textarea", colSpan: 2 },
    ],
  },
  resignation: {
    id: "resignation",
    title: "استقالة",
    fields: [
      {
        name: "last_day",
        label: "تاريخ اخر يوم عمل",
        type: "date",
        required: true,
        colSpan: 2,
      },
      {
        name: "reason",
        label: "السبب",
        type: "textarea",
        required: true,
        colSpan: 2,
      },
    ],
  },
  vacancy: {
    id: "vacancy",
    title: "وظيفة شاغرة",
    fields: [
      {
        name: "entity",
        label: "الجهة الطالبة",
        type: "select",
        required: true,
      },
      { name: "job", label: "الوظيفة", type: "select", required: true },
      { name: "count", label: "عدد", type: "number", required: true },
      { name: "work_time", label: "وقت العمل", type: "select", required: true },
      {
        name: "salary_after",
        label: "الراتب المقترح بعد الفترة التجريبية",
        type: "text",
      },
      { name: "salary", label: "الراتب المقترح", type: "text", required: true },
      {
        name: "start_date",
        label: "تاريخ مباشرة العمل المقترح",
        type: "date",
        required: true,
      },
      { name: "currency", label: "عملة", type: "select", required: true },
      {
        name: "candidate",
        label: "هل لديك مرشح مقترح",
        type: "select",
        required: true,
      },
      {
        name: "allowance",
        label: "إضافة بدل",
        type: "radio",
        options: [
          { label: "نعم", value: "yes" },
          { label: "لا", value: "no" },
        ],
      },
      { name: "plan", label: "خطة الاحتياج الوظيفي", type: "select" },
      {
        name: "tasks",
        label: "المهام",
        type: "text",
        required: true,
        colSpan: 2,
      },
      {
        name: "justification",
        label: "مبررات التوظيف",
        type: "textarea",
        required: true,
        colSpan: 2,
      },
    ],
  },
  termination: {
    id: "termination",
    title: "إقالة موظف",
    fields: [
      {
        name: "employee",
        label: "إقالة الموظف",
        type: "select",
        required: true,
        colSpan: 2,
      },
      {
        name: "last_day",
        label: "تاريخ اخر يوم عمل",
        type: "date",
        required: true,
        colSpan: 2,
      },
      {
        name: "reason",
        label: "سبب الإقالة",
        type: "textarea",
        required: true,
        colSpan: 2,
      },
    ],
  },
  disburse_bonus: {
    id: "disburse_bonus",
    title: "صرف امتياز مالي",
    fields: [
      { name: "employee", label: "الموظف", type: "select", required: true },
      {
        name: "bonus_type",
        label: "نوع الامتياز",
        type: "select",
        required: true,
      },
      {
        name: "amount",
        label: "قيمة الامتياز",
        type: "number",
        required: true,
      },
      { name: "currency", label: "عملة", type: "select", required: true },
      { name: "start_date", label: "تاريخ البداية", type: "date" },
      { name: "end_date", label: "تاريخ الانتهاء", type: "date" },
      { name: "notes", label: "ملاحظات", type: "textarea", colSpan: 2 },
    ],
  },
  salary_adj: {
    id: "salary_adj",
    title: "تعديل راتب",
    fields: [
      {
        name: "employee",
        label: "الموظف",
        type: "select",
        required: true,
        colSpan: 2,
      },
      {
        name: "adj_type",
        label: "نوع التعديل",
        type: "radio",
        options: [
          { label: "زيادة راتب", value: "increase" },
          { label: "تخفيض راتب", value: "decrease" },
        ],
        required: true,
      },
      {
        name: "new_salary",
        label: "الراتب الأساسي",
        type: "number",
        required: true,
      },
      {
        name: "new_title",
        label: "المسمى الوظيفي الجديد",
        type: "select",
        required: true,
      },
      {
        name: "start_date",
        label: "تاريخ بدأ الزيادة",
        type: "date",
        required: true,
      },
      {
        name: "reason",
        label: "سبب الزيادة",
        type: "textarea",
        required: true,
        colSpan: 2,
      },
    ],
  },
  mission: {
    id: "mission",
    title: "مهمة عمل",
    fields: [
      { name: "from_date", label: "من", type: "date", required: true },
      { name: "to_date", label: "إلى", type: "date", required: true },
      { name: "days", label: "عدد الأيام", type: "number", required: true },
      { name: "location", label: "مكان المهمة", type: "text", required: true },
      {
        name: "summary",
        label: "تلخيص ما تم إنجازه",
        type: "text",
        colSpan: 2,
      },
    ],
  },
  commission: {
    id: "commission",
    title: "صرف عمولة",
    fields: [
      { name: "year", label: "السنة", type: "select", required: true },
      { name: "month", label: "شهر", type: "select", required: true },
      {
        name: "employee",
        label: "الموظف",
        type: "select",
        required: true,
        colSpan: 2,
      },
      { name: "amount", label: "المبلغ", type: "number", required: true },
      { name: "currency", label: "عملة", type: "select", required: true },
      { name: "details", label: "تفاصيل", type: "text", colSpan: 2 },
    ],
  },
  leave_dues: {
    id: "leave_dues",
    title: "صرف مستحقات إجازة",
    fields: [
      { name: "employee", label: "الموظف", type: "select", required: true },
      {
        name: "balance",
        label: "الرصيد المطلوب صرفه",
        type: "number",
        required: true,
      },
      { name: "amount", label: "المبلغ", type: "number" },
      { name: "date", label: "تاريخ الصرف", type: "date", required: true },
      { name: "notes", label: "ملاحظات", type: "textarea", colSpan: 2 },
    ],
  },
};
