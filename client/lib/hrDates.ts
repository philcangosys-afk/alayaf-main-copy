// تواريخ الموارد البشرية بتوقيت الرياض وبدون إزاحة يوم.
// القاعدة: التاريخ نص "YYYY-MM-DD" دائمًا، ولا يُستخدم toISOString() على تاريخ محلي.

/** تاريخ اليوم في الرياض "YYYY-MM-DD" */
export const riyadhToday = (): string => {
  // formatToParts لا يتأثر بتغيّر شكل التاريخ بين إصدارات المتصفح
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};

/** الشهر الحالي في الرياض "YYYY-MM" */
export const riyadhMonth = (): string => riyadhToday().slice(0, 7);

const toUtc = (dateKey: string) => Date.parse(`${dateKey}T00:00:00Z`);
const fromUtc = (time: number) => new Date(time).toISOString().slice(0, 10);

/** يضيف أيامًا إلى تاريخ نصي */
export const addDays = (dateKey: string, days: number): string => fromUtc(toUtc(dateKey) + days * 86400000);

/** كل الأيام من البداية إلى النهاية شاملة (نصوص YYYY-MM-DD) */
export const eachDate = (from: string, to: string): string[] => {
  if (!from || !to || to < from) return [];
  const out: string[] = [];
  for (let time = toUtc(from); time <= toUtc(to); time += 86400000) out.push(fromUtc(time));
  return out;
};

/** عدد الأيام شاملة البداية والنهاية (0 إن كانت النهاية قبل البداية) */
export const daysInclusive = (from: string, to: string): number =>
  from && to && to >= from ? Math.round((toUtc(to) - toUtc(from)) / 86400000) + 1 : 0;

/** أول وآخر يوم في شهر "YYYY-MM" */
export const monthRange = (month: string): { from: string; to: string } => {
  const [year, monthNumber] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
};

/** عطلة نهاية الأسبوع في المملكة: الجمعة والسبت */
export const isWeekend = (dateKey: string): boolean => {
  const day = new Date(toUtc(dateKey)).getUTCDay();
  return day === 5 || day === 6;
};

/** سنوات الخدمة (بالكسور) من تاريخ التعيين حتى تاريخ معين.
 * السنوات الكاملة تُعد بذكرى التعيين (يوم الذكرى = سنة كاملة)، والكسر من آخر ذكرى إلى التالية. */
export const serviceYears = (hireDate: string, asOf: string = riyadhToday()): number => {
  const hire = String(hireDate ?? "").slice(0, 10);
  const until = String(asOf ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hire) || !/^\d{4}-\d{2}-\d{2}$/.test(until) || until < hire) return 0;
  const [hy, hm, hd] = hire.split("-").map(Number);
  const [ay, am, ad] = until.split("-").map(Number);
  let full = ay - hy;
  if (am < hm || (am === hm && ad < hd)) full -= 1;
  // ذكرى 29 فبراير في سنة غير كبيسة = 28 فبراير
  const anniversary = (year: number) => {
    const lastDay = new Date(Date.UTC(year, hm, 0)).getUTCDate();
    return `${year}-${String(hm).padStart(2, "0")}-${String(Math.min(hd, lastDay)).padStart(2, "0")}`;
  };
  const from = anniversary(hy + full);
  const to = anniversary(hy + full + 1);
  return full + (toUtc(until) - toUtc(from)) / (toUtc(to) - toUtc(from));
};
