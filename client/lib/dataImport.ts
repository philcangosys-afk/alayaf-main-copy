/**
 * استيراد البيانات من إكسل: قالب لكل شاشة بأعمدة قليلة أساسية، وقراءة الملف، والتحقق من كل صف قبل الحفظ،
 * وملف بالصفوف المرفوضة وسبب كل صف لتصحيحها وإعادة رفعها.
 * الحفظ يمر بدوال الحفظ نفسها التي تستخدمها الشاشة (spec.save)، فتسري الصلاحيات والترقيم والتحقق في القاعدة كما هي.
 * الأعمدة تُعرف بعناوينها لا بترتيبها: يُقبل عنوان القالب بالعربية أو الإنجليزية وعناوين شائعة في الأنظمة الأخرى.
 */
import { PLATFORM_NAME_AR } from "@/lib/companyProfile";
import { englishText } from "@/i18n";

export type ImportColumn = {
  key: string;
  /** عنوان العمود في القالب (نص عربي يُترجم) */
  label: string;
  required?: boolean;
  /** وصف قصير في ورقة التعليمات وفي نافذة الاستيراد (نص عربي يُترجم) */
  hint: string;
  /** مثال في ورقة التعليمات (لا يُترجم) */
  example?: string;
  /** عناوين بديلة تُقبل للعمود نفسه (من أنظمة أخرى، بالعربية والإنجليزية) */
  aliases?: string[];
  /** قائمة منسدلة في القالب */
  options?: string[];
  /** القائمة بيانات من النظام (أسماء الأنواع والمسميات): تبقى كما هي ولا تُترجم */
  dataOptions?: boolean;
  /** text: يحفظ الصفر في بداية الأرقام (الجوال والهوية)، date: تاريخ */
  kind?: "text" | "number" | "date";
  width?: number;
};

/** قيم الصف بمفاتيح الأعمدة، نصوصًا منظّفة */
export type ImportValues = Record<string, string>;

/**
 * نتيجة التحقق من صف: القيمة الجاهزة للحفظ (مع تنبيه اختياري لا يمنع الحفظ)، أو سبب الرفض.
 * key: مفتاح التكرار داخل الملف أو أكثر (الصف الثاني بأحد المفاتيح نفسها يُرفض)
 */
export type ParseResult<T> = { value: T; warning?: string; key?: string | string[] | null } | { error: string };

export type ImportSpec<T, C = unknown> = {
  id: string;
  /** اسم الشاشة في العنوان (نص عربي يُترجم)، مثل «العملاء» */
  title: string;
  /** اسم ملف القالب بلا امتداد (نص عربي يُترجم) */
  fileName: string;
  columns: ImportColumn[];
  /** تعليمات إضافية تظهر في النافذة وفي القالب (نصوص عربية تُترجم) */
  notes?: string[];
  /** أقصى عدد صفوف في الملف الواحد */
  maxRows?: number;
  /** بيانات النظام اللازمة للتحقق (الموجود مسبقًا والقوائم)، تُقرأ عند اختيار الملف */
  prepare?: () => Promise<C>;
  /** يتحقق من الصف ويحوّله؛ رسائله مترجمة */
  parse: (values: ImportValues, ctx: C) => ParseResult<T>;
  /** يحفظ صفًا: null عند النجاح، وإلا رسالة الخطأ مترجمة */
  save: (value: T, ctx: C) => Promise<string | null>;
  /** إدراج دفعة واحدة (أسرع)؛ إن فشلت تُحفظ صفوفها صفًا صفًا لمعرفة سبب كل صف */
  saveBatch?: (values: T[], ctx: C) => Promise<string | null>;
};

export type ImportRow<T> = {
  /** رقم الصف في ورقة إكسل */
  line: number;
  values: ImportValues;
  status: "ready" | "warning" | "error";
  message: string;
  value?: T;
};

export type ImportFileData = {
  sheetName: string;
  rows: Array<{ line: number; values: ImportValues }>;
  /** عناوين في الملف لم يُعرف عمودها (تُهمل) */
  unknownHeaders: string[];
  /** عناوين ثانية للعمود نفسه (يُقرأ الأقرب لعنوان القالب ويُهمل الباقي) */
  ignoredHeaders: string[];
};

export type Translate = (value: string) => string;

export const DEFAULT_MAX_ROWS = 2000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** صفوف القالب التي تحمل القوائم المنسدلة */
const TEMPLATE_ROWS = 500;

/* ═══════════ تنظيف النصوص ═══════════ */

/** رموز الاتجاه والعلامات الخفية التي تضيفها الأنظمة (تُحذف)؛ الوصل وعدم الوصل (200C و200D) يبقيان لأنهما من الكتابة */
const INVISIBLE = /[\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF\u00AD]/g;
/** المسافة الصفرية فاصل كلمات: تصير مسافة */
const ZERO_WIDTH_SPACE = /\u200B/g;

/** الأرقام العربية والفارسية إلى لاتينية */
export const latinDigits = (value: string) =>
  value
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));

/**
 * نص الخلية كما كُتب بعد التنظيف: بلا رموز اتجاه خفية ولا مسافات زائدة ولا الفاصلة العليا التي تجعل الرقم نصًا.
 * للأسماء والنصوص: الأرقام تبقى كما هي (الاسم «مؤسسة ٣ نجوم» لا يتغير).
 */
export const cleanText = (value: string) =>
  String(value ?? "")
    .replace(INVISIBLE, "")
    .replace(ZERO_WIDTH_SPACE, " ")
    .replace(/^'+/, "")
    .replace(/\s+/g, " ")
    .trim();

/** نص الخلية للأرقام والرموز (الجوال والهوية والرقم الضريبي والرموز): كـ cleanText والأرقام لاتينية */
export const cleanCell = (value: string) => latinDigits(cleanText(value));

/** خطأ «المفتاح الأساسي مكرر» عند إعادة إدراج السجل نفسه بمعرّفه بعد انقطاع: السجل محفوظ من المحاولة الأولى */
export const alreadySaved = (error: { code?: string; message?: string; details?: string | null } | null | undefined) =>
  Boolean(error && error.code === "23505" && /_pkey/.test(`${error.message ?? ""} ${error.details ?? ""}`));

/** صيغة موحدة للمقارنة: حروف عربية موحدة (أإآ ة ى ؤ ئ)، بلا تشكيل ولا تطويل ولا رموز، وحروف صغيرة */
export const normalizeKey = (value: string) =>
  cleanCell(value)
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[^\p{L}\p{N}]+/gu, "");

/** عنوان العمود للمقارنة: بلا النجمة ولا ما بين الأقواس */
const normalizeHeader = (value: string) => normalizeKey(String(value ?? "").replace(/\*/g, "").replace(/\([^)]*\)/g, ""));

/* ═══════════ مساعدات التحقق للقوالب ═══════════ */

type Options<T extends string> = ReadonlyArray<{ value: T; labels: string[] }>;
const optionMaps = new WeakMap<object, Map<string, string>>();

/**
 * يطابق قيمة بإحدى الخيارات بعد التوحيد: القيمة وأسماؤها البديلة وترجمتها الإنجليزية
 * (فيُقبل خيار قالب نُزّل بالإنجليزية في الواجهة العربية والعكس). الخيارات تُوحَّد مرة لكل قائمة.
 */
export function pickOption<T extends string>(value: string, options: Options<T>): T | null {
  const key = normalizeKey(value);
  if (!key) return null;
  let map = optionMaps.get(options);
  if (!map) {
    map = new Map();
    for (const option of options) {
      for (const label of [option.value, ...option.labels, englishText(option.value), ...option.labels.map(englishText)]) {
        const normalized = normalizeKey(label);
        if (normalized && !map.has(normalized)) map.set(normalized, option.value);
      }
    }
    optionMaps.set(options, map);
  }
  return (map.get(key) as T | undefined) ?? null;
}

/** وقت في آخر التاريخ (2026-11-05 00:00:00 أو 05/11/2026 2:30 PM) يُحذف */
const TRAILING_TIME = /[\sT]+\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?(\s*[AaPp][Mm])?$/;

/**
 * تاريخ بصيغة yyyy-mm-dd من: 2026-11-05 أو 2026/11/05 أو 05/11/2026 (يوم/شهر/سنة) أو 5-11-2026،
 * ويُقبل وقت بعده ويُهمل
 */
export function parseDateText(value: string): string | null {
  const text = cleanCell(value).replace(TRAILING_TIME, "");
  let year: number;
  let month: number;
  let day: number;
  let match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (match) {
    [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (!match) return null;
    [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** تاريخ يبدو بصيغة شهر/يوم/سنة الأمريكية (الجزء الثاني أكبر من 12): لا يُخمَّن، ويُطلب تصحيحه */
export function looksMonthFirst(value: string): boolean {
  const match = cleanCell(value).replace(TRAILING_TIME, "").match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  return Boolean(match && Number(match[1]) >= 1 && Number(match[1]) <= 12 && Number(match[2]) > 12 && Number(match[2]) <= 31);
}

/** مبلغ موجب بخانتين على الأكثر (تُحذف الفواصل ورمز العملة)؛ null إن لم يصح */
export function parseAmount(value: string): number | null {
  // الفاصلة العشرية العربية «٫» نقطة، وفاصل الآلاف «٬» أو «,» يُحذف
  const text = cleanCell(value).replace(/٫/g, ".").replace(/[,٬]/g, "").replace(/(ر\.?\s*س\.?|ريال|sar)/gi, "").trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(text)) return null;
  return Number(text);
}

/** عدد صحيح بين حدين؛ null إن لم يصح */
export function parseInteger(value: string, min: number, max: number): number | null {
  const text = cleanCell(value).replace(/\.0+$/, "");
  if (!/^\d{1,9}$/.test(text)) return null;
  const number = Number(text);
  return number >= min && number <= max ? number : null;
}

/**
 * رقم الجوال بصيغة النظام: بلا مسافات ولا شرطات، و5xxxxxxxx أو 9665xxxxxxxx (السعودي) يصير 05xxxxxxxx،
 * و00 في البداية تصير +
 */
export function normalizePhone(value: string): string {
  let text = cleanCell(value).replace(/[\s\-().]/g, "");
  if (text.startsWith("00")) text = `+${text.slice(2)}`;
  const saudi = text.match(/^\+?966(5\d{8})$/);
  if (saudi) return `0${saudi[1]}`;
  if (/^5\d{8}$/.test(text)) return `0${text}`;
  return text;
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* ═══════════ قراءة الملف ═══════════ */

type XlsxModule = typeof import("xlsx");
const loadXlsx = async (): Promise<XlsxModule> => {
  const mod = (await import("xlsx")) as unknown as XlsxModule & { default?: XlsxModule };
  return (typeof mod.read === "function" ? mod : mod.default) as XlsxModule;
};

/**
 * قيمة الخلية نصًا حسب نوع العمود. raw: القيمة، shown: النص المعروض في إكسل.
 * التاريخ من رقم إكسل التسلسلي (ونظام 1904 لملفات ماك القديمة)، والعمود النصي يأخذ النص المعروض إن كان أرقامًا
 * (رقم مخزّن بتنسيق يُظهر الصفر في البداية مثل 0501234567 أو باركود 0123...)
 */
function cellText(raw: unknown, shown: unknown, column: ImportColumn, xlsx: XlsxModule, date1904: boolean): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "number") {
    if (column.kind === "date" && raw > 0 && raw < 2958466) {
      const parts = xlsx.SSF.parse_date_code(raw, { date1904 });
      if (parts?.y) return `${parts.y}-${String(parts.m).padStart(2, "0")}-${String(parts.d).padStart(2, "0")}`;
    }
    if (column.kind === "text" && typeof shown === "string" && /^\d+$/.test(shown.trim())) return shown.trim();
    // عدد صحيح كبير (هوية أو رقم ضريبي) بلا فاصلة عشرية ولا صيغة أسية
    return Number.isSafeInteger(raw) ? BigInt(raw).toString() : String(raw);
  }
  if (raw instanceof Date) {
    return `${raw.getFullYear()}-${String(raw.getMonth() + 1).padStart(2, "0")}-${String(raw.getDate()).padStart(2, "0")}`;
  }
  if (typeof raw === "boolean") return raw ? "1" : "0";
  return cleanText(String(raw));
}

/** يقرأ CSV نصًا: UTF-8، وإلا ترميز ويندوز العربي (ملفات إكسل القديمة «CSV» بلا UTF-8) */
function decodeCsv(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1256").decode(buffer);
  }
}

/**
 * يقرأ الملف (xlsx أو xls أو csv): يختار ورقة البيانات، ويجد صف العناوين في أول عشرة صفوف، ويربط كل عنوان بعموده.
 * يرمي خطأ مترجمًا إن لم يصلح الملف (لا عناوين، أو عمود مطلوب ناقص، أو صفوف أكثر من الحد).
 */
export async function readImportFile(file: File, spec: ImportSpec<any, any>, t: Translate): Promise<ImportFileData> {
  if (file.size > MAX_FILE_BYTES) throw new Error(t("حجم الملف أكبر من 5 ميجابايت؛ قسّمه إلى أكثر من ملف"));
  if (!/\.(xlsx|xlsm|xls|csv)$/i.test(file.name)) throw new Error(t("اختر ملف إكسل (xlsx أو xls) أو CSV"));
  const xlsx = await loadXlsx();
  let workbook: ReturnType<XlsxModule["read"]>;
  try {
    if (/\.csv$/i.test(file.name)) {
      // CSV نصًا كما هو (raw) فلا يضيع الصفر في بداية الجوال والهوية
      workbook = xlsx.read(decodeCsv(await file.arrayBuffer()), { type: "string", raw: true });
    } else {
      workbook = xlsx.read(await file.arrayBuffer(), { type: "array", cellDates: false });
    }
  } catch {
    throw new Error(t("تعذر قراءة الملف؛ تأكد أنه ملف إكسل سليم"));
  }
  const date1904 = Boolean((workbook as { Workbook?: { WBProps?: { date1904?: boolean } } }).Workbook?.WBProps?.date1904);

  // عناوين كل عمود: عنوان القالب (بالعربية وبلغة الواجهة وبالإنجليزية) أولى من العناوين البديلة
  const headerKeys = new Map<string, { column: ImportColumn; rank: number }>();
  const addHeader = (label: string, column: ImportColumn, rank: number) => {
    const key = normalizeHeader(label);
    const current = key ? headerKeys.get(key) : undefined;
    if (key && (!current || rank < current.rank)) headerKeys.set(key, { column, rank });
  };
  spec.columns.forEach((column) => [column.label, t(column.label), englishText(column.label)].forEach((label) => addHeader(label, column, 0)));
  spec.columns.forEach((column) => (column.aliases ?? []).forEach((label) => addHeader(label, column, 1)));
  const matchHeader = (header: unknown) => {
    const key = normalizeHeader(String(header ?? ""));
    return key ? headerKeys.get(key) ?? null : null;
  };

  // ورقة البيانات: أكثر الأوراق تطابقًا مع عناوين القالب في أول عشرة صفوف (تُتخطى ورقة القوائم)
  let best: { sheet: string; rows: unknown[][]; headerIndex: number; matches: number } | null = null;
  for (const sheetName of workbook.SheetNames) {
    if (/^(lists|القوائم)$/i.test(sheetName)) continue;
    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: "", blankrows: true }) as unknown[][];
    for (let index = 0; index < Math.min(rows.length, 10); index += 1) {
      const keys = new Set((rows[index] ?? []).map((cell) => matchHeader(cell)?.column.key).filter(Boolean));
      if (keys.size > 0 && (!best || keys.size > best.matches)) best = { sheet: sheetName, rows, headerIndex: index, matches: keys.size };
    }
  }
  if (!best) throw new Error(t("لم يُعثر على عناوين الأعمدة في الملف؛ نزّل القالب واملأه أو اجعل عناوين أعمدتك كعناوينه"));

  // كل عمود من أقرب عنوان لعنوان القالب؛ العنوان الثاني للعمود نفسه يُهمل ويُذكر
  const header = best.rows[best.headerIndex] ?? [];
  const chosen = new Map<string, { index: number; rank: number }>();
  const unknownHeaders: string[] = [];
  header.forEach((cell, index) => {
    const match = matchHeader(cell);
    if (!match) {
      if (cleanText(String(cell ?? ""))) unknownHeaders.push(cleanText(String(cell)));
      return;
    }
    const current = chosen.get(match.column.key);
    if (!current || match.rank < current.rank) chosen.set(match.column.key, { index, rank: match.rank });
  });
  const mapping = new Map<number, ImportColumn>();
  const ignoredHeaders: string[] = [];
  header.forEach((cell, index) => {
    const match = matchHeader(cell);
    if (!match) return;
    if (chosen.get(match.column.key)?.index === index) mapping.set(index, match.column);
    else ignoredHeaders.push(`${cleanText(String(cell))} (${t(match.column.label)})`);
  });
  const mapped = new Set([...mapping.values()].map((column) => column.key));
  const missing = spec.columns.filter((column) => column.required && !mapped.has(column.key));
  if (missing.length) {
    throw new Error(`${t("أعمدة مطلوبة غير موجودة في الملف")}: ${missing.map((column) => t(column.label)).join("، ")}`);
  }

  // النص المعروض للأعمدة النصية (الصفر في البداية)، ورقم الصف في إكسل من بداية نطاق الورقة
  const sheet = workbook.Sheets[best.sheet];
  const hasText = [...mapping.values()].some((column) => column.kind === "text");
  const shownRows = hasText ? (xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "", blankrows: true }) as unknown[][]) : [];
  const firstRow = sheet["!ref"] ? xlsx.utils.decode_range(sheet["!ref"]).s.r : 0;

  const rows: ImportFileData["rows"] = [];
  for (let index = best.headerIndex + 1; index < best.rows.length; index += 1) {
    const raw = best.rows[index] ?? [];
    const shown = shownRows[index] ?? [];
    const values: ImportValues = Object.fromEntries(spec.columns.map((column) => [column.key, ""]));
    let filled = false;
    mapping.forEach((column, cellIndex) => {
      const text = cellText(raw[cellIndex], shown[cellIndex], column, xlsx, date1904);
      values[column.key] = text;
      if (text) filled = true;
    });
    if (filled) rows.push({ line: firstRow + index + 1, values });
  }
  const maxRows = spec.maxRows ?? DEFAULT_MAX_ROWS;
  if (rows.length === 0) throw new Error(t("لا صفوف بيانات تحت العناوين في الملف"));
  if (rows.length > maxRows) {
    throw new Error(`${t("عدد الصفوف أكبر من الحد في المرة الواحدة؛ قسّم الملف")}: ${rows.length} / ${maxRows}`);
  }
  return { sheetName: best.sheet, rows, unknownHeaders, ignoredHeaders };
}

/** يتحقق من صفوف الملف بقواعد الشاشة، ويرفض المكرر داخل الملف */
export function validateRows<T, C>(spec: ImportSpec<T, C>, data: ImportFileData, ctx: C, t: Translate): ImportRow<T>[] {
  const seen = new Map<string, number>();
  return data.rows.map(({ line, values }) => {
    let result: ParseResult<T>;
    try {
      result = spec.parse(values, ctx);
    } catch (error) {
      result = { error: error instanceof Error ? error.message : t("تعذر قراءة الصف") };
    }
    if ("error" in result) return { line, values, status: "error", message: result.error };
    const keys = (Array.isArray(result.key) ? result.key : [result.key]).filter((key): key is string => Boolean(key));
    const first = keys.map((key) => seen.get(key)).find((found) => found !== undefined);
    if (first !== undefined) return { line, values, status: "error", message: `${t("مكرر في الملف مع الصف")} ${first}` };
    keys.forEach((key) => seen.set(key, line));
    return { line, values, status: result.warning ? "warning" : "ready", message: result.warning ?? "", value: result.value };
  });
}

/* ═══════════ القالب وملف المرفوض ═══════════ */

type ExcelModule = typeof import("exceljs");
const loadExcel = async () => {
  const mod = (await import("exceljs")) as unknown as { default?: ExcelModule } & ExcelModule;
  return (mod.default ?? mod) as ExcelModule;
};

type Format = { t: Translate; direction: "rtl" | "ltr" };

const HEADER_REQUIRED = "FF087B68";
const HEADER_OPTIONAL = "FF4B5D6B";
const WHITE = "FFFFFFFF";

function downloadBuffer(buffer: ArrayBuffer, name: string) {
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const safeFileName = (value: string) => value.replace(/[\\/:*?"<>|]+/g, "-").trim() || "template";

/** ورقة البيانات بعناوين القالب وقوائمه المنسدلة؛ extra: أعمدة إضافية بعدها (مثل «سبب الرفض») */
function addDataSheet(
  workbook: InstanceType<ExcelModule["Workbook"]>,
  spec: ImportSpec<any, any>,
  { t, direction }: Format,
  extra: Array<{ header: string; width: number }> = [],
) {
  const sheet = workbook.addWorksheet(t("البيانات"), { views: [{ state: "frozen", ySplit: 1, rightToLeft: direction === "rtl" }] });
  sheet.columns = [
    ...spec.columns.map((column) => ({
      header: `${t(column.label)}${column.required ? " *" : ""}`,
      key: column.key,
      width: column.width ?? 24,
      // الجوال والهوية نصوص (لا يضيع الصفر في البداية)، والتاريخ بصيغة واحدة
      style: column.kind === "text" ? { numFmt: "@" } : column.kind === "date" ? { numFmt: "yyyy-mm-dd" } : {},
    })),
    ...extra.map((column, index) => ({ header: column.header, key: `__extra${index}`, width: column.width })),
  ];
  const header = sheet.getRow(1);
  header.height = 30;
  header.eachCell((cell, columnNumber) => {
    const column = spec.columns[columnNumber - 1];
    cell.font = { bold: true, color: { argb: WHITE } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: column?.required ? HEADER_REQUIRED : column ? HEADER_OPTIONAL : "FFB42318" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });

  // القوائم القصيرة في الخلية مباشرة، والطويلة من ورقة مخفية
  let lists: ReturnType<typeof workbook.addWorksheet> | null = null;
  let listColumn = 0;
  spec.columns.forEach((column, index) => {
    if (!column.options?.length) return;
    const options = column.dataOptions ? column.options : column.options.map((option) => t(option));
    const inline = options.join(",");
    let formula: string;
    if (inline.length <= 240 && !options.some((option) => option.includes(",") || option.includes("\""))) {
      formula = `"${inline}"`;
    } else {
      if (!lists) {
        lists = workbook.addWorksheet("Lists");
        lists.state = "veryHidden";
      }
      listColumn += 1;
      options.forEach((option, row) => { lists!.getCell(row + 1, listColumn).value = option; });
      const letter = lists.getColumn(listColumn).letter;
      formula = `'Lists'!$${letter}$1:$${letter}$${options.length}`;
    }
    for (let row = 2; row <= TEMPLATE_ROWS + 1; row += 1) {
      sheet.getCell(row, index + 1).dataValidation = {
        type: "list",
        allowBlank: !column.required,
        formulae: [formula],
        showErrorMessage: true,
        errorStyle: "warning",
        errorTitle: t(column.label),
        error: t("اختر من القائمة"),
      };
    }
  });
  return sheet;
}

/** ورقة التعليمات: الأعمدة ووصفها ومثال، ثم الملاحظات العامة */
function addInstructionsSheet(workbook: InstanceType<ExcelModule["Workbook"]>, spec: ImportSpec<any, any>, { t, direction }: Format) {
  const sheet = workbook.addWorksheet(t("التعليمات"), { views: [{ rightToLeft: direction === "rtl" }] });
  sheet.columns = [{ width: 26 }, { width: 12 }, { width: 70 }, { width: 28 }];
  sheet.mergeCells(1, 1, 1, 4);
  const title = sheet.getCell(1, 1);
  title.value = `${t("قالب استيراد")} ${t(spec.title)} — ${t(PLATFORM_NAME_AR)}`;
  title.font = { bold: true, size: 15, color: { argb: WHITE } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF12324A" } };
  title.alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(1).height = 32;

  const header = sheet.getRow(3);
  header.values = [t("العمود"), t("مطلوب"), t("الوصف"), t("مثال")];
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: WHITE } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_REQUIRED } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  spec.columns.forEach((column, index) => {
    const row = sheet.getRow(4 + index);
    row.values = [t(column.label), column.required ? t("نعم") : t("لا"), t(column.hint), column.example ?? ""];
    row.alignment = { vertical: "middle", wrapText: true };
    if (column.required) row.getCell(2).font = { bold: true, color: { argb: HEADER_REQUIRED } };
  });

  const notes = [
    "املأ ورقة «البيانات» بدءًا من الصف الثاني: صف لكل سجل.",
    "الأعمدة المعلّمة بـ * مطلوبة، والباقي اختياري ويمكن إكماله لاحقًا من شاشة السجل.",
    "لا تغيّر عناوين الأعمدة. يمكن تغيير ترتيبها، أو لصق ملف من نظام آخر بالعناوين نفسها.",
    "السجل الموجود في النظام مسبقًا لا يتكرر: يُرفض ويُذكر سببه.",
    ...(spec.notes ?? []),
  ];
  let rowNumber = 5 + spec.columns.length;
  sheet.getCell(rowNumber, 1).value = t("ملاحظات");
  sheet.getCell(rowNumber, 1).font = { bold: true };
  notes.forEach((note) => {
    rowNumber += 1;
    sheet.mergeCells(rowNumber, 1, rowNumber, 4);
    const cell = sheet.getCell(rowNumber, 1);
    cell.value = `• ${t(note)}`;
    cell.alignment = { wrapText: true, vertical: "top" };
    sheet.getRow(rowNumber).height = 30;
  });
  return sheet;
}

/** ينزّل قالب الشاشة: ورقة البيانات بالعناوين والقوائم، وورقة التعليمات */
export async function downloadTemplate(spec: ImportSpec<any, any>, format: Format) {
  const ExcelJS = await loadExcel();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = PLATFORM_NAME_AR;
  workbook.created = new Date();
  addDataSheet(workbook, spec, format);
  addInstructionsSheet(workbook, spec, format);
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBuffer(buffer as ArrayBuffer, `${safeFileName(format.t(spec.fileName))}.xlsx`);
}

/** ينزّل الصفوف المرفوضة بعناوين القالب نفسها وعمود «سبب الرفض»: تُصحَّح ويُعاد رفع الملف كما هو */
export async function downloadRejected(
  spec: ImportSpec<any, any>,
  rejected: Array<{ line: number; values: ImportValues; reason: string }>,
  format: Format,
) {
  const ExcelJS = await loadExcel();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = PLATFORM_NAME_AR;
  workbook.created = new Date();
  const sheet = addDataSheet(workbook, spec, format, [{ header: format.t("سبب الرفض"), width: 48 }, { header: format.t("الصف في الملف الأصلي"), width: 14 }]);
  rejected.forEach((item, index) => {
    const row = sheet.getRow(index + 2);
    row.values = [...spec.columns.map((column) => item.values[column.key] ?? ""), item.reason, item.line];
    const reason = row.getCell(spec.columns.length + 1);
    reason.font = { color: { argb: "FFB42318" } };
    reason.alignment = { wrapText: true, vertical: "top" };
  });
  addInstructionsSheet(workbook, spec, format);
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBuffer(buffer as ArrayBuffer, `${safeFileName(`${format.t(spec.fileName)} - ${format.t("المرفوض")}`)}.xlsx`);
}
