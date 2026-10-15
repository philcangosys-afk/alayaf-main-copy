import { isApprovedStatus } from "@/lib/hrStatus";

// سلف الموظفين: مصدر واحد لمسير الرواتب وصفحة السلف.
// كل سلفة معتمدة يُخصم قسطها من شهر بدايتها: القسط = الأقل من قسطها ومتبقيها.
// المسدَّد يُعاد توزيعه شهرًا بشهر كما خُصم فعلًا: أقساط كل شهر تُوزَّع على السلف السارية فيه
// (الأقدم أولًا، ولكل سلفة حتى قسطها)، ثم الزائد إن وُجد على الأقدم حتى متبقيها.
// فإن خُفّض قسط شهر (حد نصف الأجر مثلًا) تأخر سداد الأحدث ولم يتغير قسط الأقدم.

export type AdvanceRecord = { id: string; employeeId: string; start: string; amount: number; installment: number; order: string };

const round2 = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** شهر بداية الخصم: start_month، وإلا شهر تاريخ الطلب، وإلا شهر الإنشاء (السجلات القديمة) */
export const advanceStartMonth = (row: Record<string, unknown>) =>
  String(row.start_month ?? "").slice(0, 7) || String(row.request_date ?? "").slice(0, 7) || String(row.created_at ?? "").slice(0, 7);

/** السلفة المعتمدة الصالحة للخصم، وإلا null (المعلقة والمرفوضة وبلا مبلغ أو قسط أو شهر بداية) */
export const parseApprovedAdvance = (row: Record<string, unknown>): AdvanceRecord | null => {
  if (!isApprovedStatus(row.status)) return null;
  const start = advanceStartMonth(row);
  const amount = round2(Number(row.amount ?? row.remaining_amount) || 0);
  const installment = round2(Number(row.monthly_installment) || 0);
  if (!MONTH.test(start) || amount <= 0 || installment <= 0) return null;
  return {
    id: String(row.id ?? ""),
    employeeId: String(row.employee_id ?? ""),
    start,
    amount,
    installment: Math.min(installment, amount),
    order: `${start}|${String(row.created_at ?? "")}|${String(row.id ?? "")}`,
  };
};

/**
 * المسدَّد من كل سلفة لموظف واحد، من أقساط كشوف الرواتب (الشهر ← مبلغ عمود advance_deduction).
 * الأشهر تُعاد بترتيبها؛ لا يُحتسب لسلفة قسط شهر قبل بدايتها.
 */
export const allocateAdvanceRepayments = (advances: AdvanceRecord[], deductionsByMonth: Map<string, number>): Map<string, number> => {
  const ordered = [...advances].sort((a, b) => a.order.localeCompare(b.order));
  const repaid = new Map<string, number>(ordered.map((advance) => [advance.id, 0]));
  const remaining = (advance: AdvanceRecord) => round2(advance.amount - (repaid.get(advance.id) ?? 0));
  [...deductionsByMonth.keys()].sort().forEach((month) => {
    let left = round2(Math.max(0, deductionsByMonth.get(month) ?? 0));
    if (left <= 0) return;
    const active = ordered.filter((advance) => advance.start <= month);
    // القسط المتفق عليه لكل سلفة سارية، الأقدم أولًا
    active.forEach((advance) => {
      const share = Math.min(advance.installment, remaining(advance), left);
      if (share <= 0) return;
      repaid.set(advance.id, round2((repaid.get(advance.id) ?? 0) + share));
      left = round2(left - share);
    });
    // زيادة على مجموع الأقساط (سداد معجّل): على الأقدم حتى متبقيها
    active.forEach((advance) => {
      const share = Math.min(remaining(advance), left);
      if (share <= 0) return;
      repaid.set(advance.id, round2((repaid.get(advance.id) ?? 0) + share));
      left = round2(left - share);
    });
  });
  return repaid;
};

/** القسط المستحق في شهر لموظف: مجموع الأقل من القسط والمتبقي لكل سلفة بدأت في الشهر أو قبله */
export const advanceInstallmentDue = (advances: AdvanceRecord[], repaid: Map<string, number>, period: string): number =>
  round2(advances.reduce((sum, advance) => {
    if (advance.start > period) return sum;
    const left = round2(advance.amount - (repaid.get(advance.id) ?? 0));
    return left > 0 ? sum + Math.min(advance.installment, left) : sum;
  }, 0));

/** حالات صف الرواتب التي لا تُعد خصمًا فعليًا (لا شيء غير الملغى: المعلق والمرفوض قد يُعاد إرسالهما بنفس المبلغ) */
export const isCancelledPayrollStatus = (status: unknown) => ["ملغي", "ملغى", "cancelled"].includes(String(status ?? "").trim());
