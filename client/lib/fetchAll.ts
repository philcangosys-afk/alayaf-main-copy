// جلب كل الصفوف على دفعات لتجاوز حد Supabase الافتراضي (1000 صف لكل طلب).
// الاستخدام: await fetchAllRows((from, to) => supabase.from("attendance").select("*").gte("date", a).lte("date", b).order("date").range(from, to))
// يجب أن يكون الترتيب على مفتاح فريد (مثل id) حتى لا تتكرر الصفوف بين الدفعات.
type PageResult<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

export async function fetchAllRows<T>(page: (from: number, to: number) => PageResult<T>, pageSize = 1000, maxRows = 200000): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw error;
    const chunk = data ?? [];
    if (chunk.length === 0) return rows;
    // لا نرجع نتيجة ناقصة بصمت: الأرقام الناقصة أسوأ من رسالة خطأ
    if (rows.length + chunk.length > maxRows) throw new Error(`عدد السجلات تجاوز ${maxRows}؛ ضيّق الفترة أو الفلتر`);
    rows.push(...chunk);
    // نتقدم بعدد ما وصل فعلًا ونتوقف عند أول دفعة فارغة،
    // حتى لا نتوقف مبكرًا إن كان حد الخادم أقل من pageSize
    from += chunk.length;
  }
}
