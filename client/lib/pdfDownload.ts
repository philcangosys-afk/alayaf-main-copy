/**
 * S18: تحميل المستند ملف PDF مباشرة إلى الجهاز، دون نافذة الطباعة.
 *
 * المستندات (الفواتير والعروض والأوامر والمرتجعات) تبني HTML الطباعة وتكتبه في نافذة ثم تستدعي print().
 * openDocumentOutput("download") يعيد بدل النافذة «نافذة» إطار مخفي حقيقي: الكود نفسه يكتب فيه HTML الطباعة
 * كما هو، ونداء print() فيه يتحول إلى: رسم المستند بقياس صفحة A4 (من @page في القالب) ثم تحميل ملف PDF.
 * openDocumentOutput("print") = نافذة جديدة كما كان (زر الطباعة فقط).
 *
 * الرسم: html-to-image (MIT، منسوخة في lib/vendor، مع نسخ الأنماط المختلفة عن الافتراضي فقط) تنسخ المستند
 * مرة واحدة إلى SVG، ويُرسم في شرائح (عدة صفحات في كل شريحة) تُقص منها الصفحات، فتبقى دقة الصفحات ثابتة
 * مهما طال المستند. الملف: PDF بسيط بصور JPEG (بلا مكتبة).
 * المستند الأطول من الحد يُفتح للطباعة بدل التحميل (الحفظ PDF من نافذة الطباعة).
 */
import { toSvg } from "@/lib/vendor/html-to-image";
import { toast } from "@/hooks/use-toast";

export type DocumentOutputMode = "print" | "download";

const PX_PER_MM = 96 / 25.4;
const PT_PER_MM = 72 / 25.4;
const RENDER_SCALE = 2;
// حد اللوحة في Safari نحو 16.7 مليون نقطة: الشريحة صفحات كاملة ضمن هذا الحد
const MAX_STRIP_PIXELS = 16_000_000;
// أطول من هذا: الطباعة بدل التحميل (الوقت والذاكرة على الأجهزة الضعيفة)
const MAX_PAGES = 80;
const MAX_ELEMENTS = 25_000;
// تنبيه التقدم للمستند الذي يتأخر تجهيزه فقط
const PROGRESS_DELAY_MS = 800;
// صورة شفافة بدل صورة تعذّر جلبها (الشعار مثلًا)، فلا يفشل الملف كله
const TRANSPARENT_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const isEnglish = () => (document.documentElement.lang || "").toLowerCase().startsWith("en");
const text = (ar: string, en: string) => (isEnglish() ? en : ar);

/** اسم ملف صالح لكل الأنظمة، بامتداد .pdf */
export function pdfFileName(name: string): string {
  const base = String(name ?? "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return `${base || "document"}.pdf`;
}

/**
 * نافذة إخراج المستند: «print» نافذة طباعة جديدة، و«download» إطار مخفي يُحمَّل منه ملف PDF عند print().
 * null إن منع المتصفح النافذة (الطباعة فقط).
 */
export function openDocumentOutput(mode: DocumentOutputMode, fileName: string): Window | null {
  if (mode === "print") return window.open("", "_blank");
  return createPdfDownloadWindow(pdfFileName(fileName));
}

type ToastHandle = {
  id: string;
  dismiss: () => void;
  update: (props: { id: string; title?: string; description?: string; duration?: number }) => void;
};

/** تنبيه «جارٍ التجهيز» يظهر إن تأخر التجهيز، ويُحدَّث بعدد الصفحات */
function progressReporter() {
  let handle: ToastHandle | null = null;
  let latest = text("جارٍ رسم المستند…", "Rendering the document…");
  let finished = false;
  const show = () => {
    if (finished) return;
    const props = {
      title: text("جارٍ تجهيز ملف PDF", "Preparing the PDF"),
      description: latest,
      duration: 10 * 60 * 1000,
    };
    if (handle) handle.update({ id: handle.id, ...props });
    else handle = toast(props) as unknown as ToastHandle;
  };
  const timer = window.setTimeout(show, PROGRESS_DELAY_MS);
  return {
    report(done: number, total: number) {
      latest = text(`الصفحة ${done} من ${total}`, `Page ${done} of ${total}`);
      if (handle) show();
    },
    finish() {
      finished = true;
      window.clearTimeout(timer);
      handle?.dismiss();
    },
  };
}

function createPdfDownloadWindow(fileName: string): Window | null {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.title = "pdf";
  // خارج الشاشة لكن بتخطيط حقيقي (العرض يُضبط من @page قبل الرسم)
  frame.style.cssText =
    "position:fixed;left:-20000px;top:0;width:794px;height:1123px;border:0;opacity:0;pointer-events:none;z-index:-1;";
  document.body.appendChild(frame);
  const frameWindow = frame.contentWindow;
  if (!frameWindow) {
    frame.remove();
    return null;
  }
  // طباعة الإطار نفسه (المستند الطويل): تُحفظ قبل استبدالها
  const nativePrint = frameWindow.print.bind(frameWindow);
  let started = false;
  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    window.setTimeout(() => frame.remove(), 500);
  };
  const start = () => {
    if (started) return;
    started = true;
    const progress = progressReporter();
    void renderFrameToPdf(frame, progress.report)
      .then((result) => {
        progress.finish();
        if (result.kind === "too-long") {
          // نافذة الطباعة للإطار نفسه؛ يُزال بعد إغلاقها
          toast({
            title: text("المستند طويل للتحميل المباشر", "The document is too long to download directly"),
            description: text(
              `نحو ${result.pages} صفحة. فُتحت نافذة الطباعة: اختر «حفظ بتنسيق PDF». إن لم تظهر فاستخدم زر «طباعة».`,
              `About ${result.pages} pages. The print dialog was opened: choose "Save as PDF". If it did not appear, use the Print button.`,
            ),
          });
          frameWindow.addEventListener("afterprint", remove, { once: true });
          window.setTimeout(remove, 10 * 60 * 1000);
          // بعد ظهور التنبيه (نافذة الطباعة توقف الصفحة حتى تُغلق)
          window.setTimeout(() => {
            try {
              nativePrint();
            } catch (error) {
              console.error("PDF print fallback failed", error);
              remove();
            }
          }, 400);
          return;
        }
        saveFile(result.bytes, fileName);
        remove();
        if (result.missingImages) {
          toast({
            title: text("حُمّل الملف دون بعض الصور", "PDF downloaded without some images"),
            description: text(
              "تعذّر تضمين صورة (كالشعار) من مصدرها. اطبع المستند لتظهر فيه.",
              "An image (such as the logo) could not be embedded from its source. Print the document to include it.",
            ),
          });
        }
      })
      .catch((error) => {
        progress.finish();
        remove();
        console.error("PDF download failed", error);
        toast({
          title: text("تعذّر تجهيز ملف PDF", "Could not prepare the PDF"),
          description: text("استخدم «طباعة» واختر «حفظ بتنسيق PDF» بدلًا منه.", 'Use Print and choose "Save as PDF" instead.'),
          variant: "destructive",
        });
      });
  };
  const patch = () => {
    try {
      Object.defineProperty(frameWindow, "print", { configurable: true, writable: true, value: start });
      // إغلاق النافذة قبل الطباعة (فشل تحميل البيانات مثلًا) يزيل الإطار
      Object.defineProperty(frameWindow, "close", {
        configurable: true,
        writable: true,
        value: () => {
          if (!started) remove();
        },
      });
      Object.defineProperty(frameWindow, "focus", { configurable: true, writable: true, value: () => undefined });
    } catch {
      // لا شيء: نافذة الإطار من الأصل نفسه دائمًا
    }
  };
  patch();
  // document.write يفتح المستند من جديد؛ بعض المتصفحات القديمة تعيد خصائص النافذة، فتُعاد بعد كل كتابة
  const frameDocument = frameWindow.document;
  const originalWrite = frameDocument.write.bind(frameDocument);
  const originalClose = frameDocument.close.bind(frameDocument);
  try {
    Object.defineProperty(frameDocument, "write", {
      configurable: true,
      writable: true,
      value: (...parts: string[]) => {
        originalWrite(...parts);
        patch();
      },
    });
    Object.defineProperty(frameDocument, "close", {
      configurable: true,
      writable: true,
      value: () => {
        originalClose();
        patch();
      },
    });
  } catch {
    // لا شيء
  }
  return frameWindow;
}

type PageSetup = { widthMm: number; heightMm: number; marginMm: number };

/** حجم الصفحة وهامشها من @page في القالب (الافتراضي A4 عمودي بهامش 10مم) */
function readPageSetup(doc: Document): PageSetup {
  let landscape = false;
  let marginMm = 10;
  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules ?? [])) {
      // CSSRule.PAGE_RULE = 6
      if (rule.type !== 6) continue;
      const style = (rule as CSSPageRule).style;
      const size = (style.getPropertyValue("size") || "").toLowerCase();
      if (size.includes("landscape")) landscape = true;
      const margin = (style.getPropertyValue("margin") || style.getPropertyValue("margin-top") || "").trim();
      const match = /^([\d.]+)\s*mm/.exec(margin) ?? /^([\d.]+)\s*cm/.exec(margin);
      if (match) {
        const value = Number(match[1]) * (margin.includes("cm") && !margin.includes("mm") ? 10 : 1);
        if (Number.isFinite(value) && value >= 0 && value <= 40) marginMm = value;
      }
    }
  }
  return landscape ? { widthMm: 297, heightMm: 210, marginMm } : { widthMm: 210, heightMm: 297, marginMm };
}

/** قواعد @media print تُطبَّق على الشاشة أيضًا (الرسم يتم بوسائط الشاشة) */
function applyPrintStyles(doc: Document): HTMLStyleElement {
  const collected: string[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules ?? [])) {
      // CSSRule.MEDIA_RULE = 4
      if (rule.type !== 4) continue;
      const media = (rule as CSSMediaRule).media.mediaText.toLowerCase();
      if (!media.includes("print") || media.includes("not print")) continue;
      for (const inner of Array.from((rule as CSSMediaRule).cssRules)) collected.push(inner.cssText);
    }
  }
  const style = doc.createElement("style");
  // عرض الصفحة يحدده الإطار (منطقة الطباعة)؛ عرض html/body بقياس الورقة في قواعد الطباعة يُلغى
  style.textContent = `${collected.join("\n")}
html, body { width: auto !important; min-width: 0 !important; max-width: none !important; min-height: 0 !important; height: auto !important; margin: 0 !important; overflow: visible !important; background: #ffffff; }
.no-print, .print-hide, .noprint { display: none !important; }`;
  (doc.head ?? doc.documentElement).appendChild(style);
  return style;
}

async function waitForAssets(doc: Document) {
  const view = doc.defaultView;
  if (doc.readyState !== "complete" && view) {
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      view.addEventListener("load", done, { once: true });
      window.setTimeout(done, 3000);
    });
  }
  const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts;
  if (fonts?.ready) {
    await Promise.race([fonts.ready, new Promise((resolve) => window.setTimeout(resolve, 3000))]);
  }
  await Promise.all(
    Array.from(doc.images).map((image) =>
      image.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            image.addEventListener("load", () => resolve(), { once: true });
            image.addEventListener("error", () => resolve(), { once: true });
            window.setTimeout(resolve, 4000);
          }),
    ),
  );
}

const nextFrame = () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

type Layout = { points: number[]; atomic: Array<[number, number]>; contentBottom: number };

/**
 * نقاط القطع بين الصفحات: حدود الصفوف والفقرات والكتل وأسطر النص، بشرط ألا تقع داخل كتلة صغيرة
 * (صف، صورة، رمز الاستجابة، كتلة الإجماليات...) ولا داخل سطر نص، فلا يُقطع شيء منها بين صفحتين.
 * contentBottom: نهاية آخر محتوى (لا صفحة أخيرة فارغة من الهامش السفلي وحده).
 */
function measureLayout(doc: Document, pageHeight: number): Layout {
  const top = doc.body.getBoundingClientRect().top;
  const points = new Set<number>();
  const atomic: Array<[number, number]> = [];
  let contentBottom = 0;
  doc.body.querySelectorAll("*").forEach((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.height <= 0) return;
    const from = rect.top - top;
    const to = rect.bottom - top;
    points.add(Math.round(from));
    points.add(Math.round(to));
    if (to > contentBottom) contentBottom = to;
    // الكتلة الأقصر من ربع الصفحة لا تُقسم (الجداول والحاويات الكبيرة تُقسم بين صفوفها)
    if (rect.height < pageHeight * 0.25) atomic.push([from, to]);
  });
  // أسطر النص: السطر لا يُقسم، والقطع في منتصف الفراغ بين سطرين (فقرة طويلة تُقسم بين أسطرها،
  // ونقاط الحروف النازلة تحت السطر تبقى معه)
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const range = doc.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.nodeValue || !node.nodeValue.trim()) continue;
    range.selectNodeContents(node);
    // أجزاء السطر الواحد (النص ثنائي الاتجاه) تُجمع في سطر واحد
    const lines: Array<[number, number]> = [];
    const rects = Array.from(range.getClientRects())
      .filter((rect) => rect.height > 0 && rect.width > 0)
      .map((rect) => [rect.top - top, rect.bottom - top] as [number, number])
      .sort((a, b) => a[0] - b[0]);
    for (const [from, to] of rects) {
      const line = lines[lines.length - 1];
      if (line && Math.abs(from - line[0]) < 1) line[1] = Math.max(line[1], to);
      else lines.push([from, to]);
    }
    lines.forEach(([from, to], index) => {
      if (to > contentBottom) contentBottom = to;
      if (to - from < pageHeight * 0.5) atomic.push([from, to]);
      const next = lines[index + 1];
      if (next && next[0] >= to - 0.5) points.add(Math.round((to + next[0]) / 2));
    });
  }
  range.detach();
  atomic.sort((a, b) => a[0] - b[0]);
  return { points: Array.from(points).sort((a, b) => a - b), atomic, contentBottom };
}

/** هل النقطة داخل كتلة لا تُقسم؟ (الكتل مرتبة ببدايتها: البحث يتوقف عند أول كتلة تبدأ عند النقطة أو بعدها) */
function insideAtomic(point: number, atomic: Array<[number, number]>) {
  for (const [from, to] of atomic) {
    if (from >= point - 0.5) return false;
    if (point + 0.5 < to) return true;
  }
  return false;
}

/** الصفحات: كل صفحة بارتفاع منطقة الطباعة، والقطع عند أقرب حد لا يقسم صفًا أو كتلة صغيرة أو سطرًا */
function paginate(layout: Layout, end: number, pageHeight: number): Array<[number, number]> {
  const { points, atomic } = layout;
  const slices: Array<[number, number]> = [];
  let start = 0;
  while (start < end - 1) {
    const limit = start + pageHeight;
    if (limit >= end) {
      slices.push([start, end]);
      break;
    }
    const minimum = start + pageHeight * 0.5;
    let cut = limit;
    for (let index = points.length - 1; index >= 0; index -= 1) {
      const point = points[index];
      if (point > limit) continue;
      if (point <= minimum) break;
      if (!insideAtomic(point, atomic)) {
        cut = point;
        break;
      }
    }
    slices.push([start, Math.floor(cut)]);
    start = Math.floor(cut);
  }
  return slices;
}

/** صور المستند غير المضمّنة (ليست data:) التي يرفض مصدرها النسخ (CORS): تُستبدل بصورة شفافة في الملف */
async function countBlockedImages(doc: Document): Promise<number> {
  const sources = Array.from(
    new Set(
      Array.from(doc.images)
        .map((image) => image.currentSrc || image.src)
        .filter((source) => source && !source.startsWith("data:") && !source.startsWith("blob:")),
    ),
  );
  const results = await Promise.all(
    sources.map((source) =>
      fetch(source, { mode: "cors", cache: "force-cache" })
        .then((response) => response.ok)
        .catch(() => false),
    ),
  );
  return results.filter((ok) => !ok).length;
}

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "sync";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });

function whiteCanvas(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas context");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  return { canvas, context };
}

const releaseCanvas = (canvas: HTMLCanvasElement) => {
  canvas.width = 0;
  canvas.height = 0;
};

type RenderResult =
  | { kind: "pdf"; bytes: Uint8Array; missingImages: boolean }
  | { kind: "too-long"; pages: number };

async function renderFrameToPdf(
  frame: HTMLIFrameElement,
  onProgress: (done: number, total: number) => void,
): Promise<RenderResult> {
  const doc = frame.contentDocument;
  if (!doc?.body) throw new Error("empty document");
  await waitForAssets(doc);
  const page = readPageSetup(doc);
  const printStyle = applyPrintStyles(doc);

  const contentWidthPx = Math.round((page.widthMm - page.marginMm * 2) * PX_PER_MM);
  const contentHeightPx = (page.heightMm - page.marginMm * 2) * PX_PER_MM;
  frame.style.width = `${contentWidthPx}px`;
  await nextFrame();
  const measure = () => Math.ceil(Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight, 1));
  frame.style.height = `${measure()}px`;
  await nextFrame();
  const totalHeight = measure();

  // المستند الطويل جدًا: الطباعة بدل التحميل (أنماط الرسم تُزال فتعمل قواعد الطباعة وحدها)
  const estimatedPages = Math.ceil(totalHeight / contentHeightPx);
  if (estimatedPages > MAX_PAGES || doc.body.getElementsByTagName("*").length > MAX_ELEMENTS) {
    printStyle.remove();
    frame.style.width = "794px";
    frame.style.height = "1123px";
    return { kind: "too-long", pages: estimatedPages };
  }

  const layout = measureLayout(doc, contentHeightPx);
  const end = Math.max(1, Math.min(totalHeight, Math.ceil(layout.contentBottom) + 2));
  const slices = paginate(layout, end, contentHeightPx);
  const blockedImages = await countBlockedImages(doc);

  // نسخة SVG واحدة للمستند كله (الأنماط والخطوط والصور مضمّنة)
  const svgUrl = await toSvg(doc.body, {
    width: contentWidthPx,
    height: totalHeight,
    backgroundColor: "#ffffff",
    imagePlaceholder: TRANSPARENT_PIXEL,
    cacheBust: false,
    // ما يختلف عن الافتراضي فقط (تعديل في النسخة المنسوخة): SVG أصغر بكثير للمستند الطويل
    skipDefaultStyles: true,
    style: { margin: "0" },
    // عقد الإطار من نافذة أخرى: الفحص بالاسم لا بـ instanceof
    filter: (node) => {
      const element = node as unknown as Element;
      if (!element || element.nodeType !== 1) return true;
      return element.tagName !== "SCRIPT" && !element.classList?.contains("no-print");
    },
  });
  // صورة واحدة للمستند (تحليل واحد) بقياس الرسم المطلوب: يُستبدل وسم svg الأول دون فك ترميز النص كله
  const comma = svgUrl.indexOf(",");
  const body = svgUrl.slice(comma + 1);
  const firstTagEnd = body.indexOf("%3E");
  if (comma < 0 || firstTagEnd < 0) throw new Error("svg");
  const rootTag = `<svg xmlns="http://www.w3.org/2000/svg" width="${contentWidthPx * RENDER_SCALE}" height="${totalHeight * RENDER_SCALE}" viewBox="0 0 ${contentWidthPx} ${totalHeight}">`;
  // عنوان data: لا blob: (صورة SVG بـ foreignObject من blob تمنع تصدير اللوحة)
  const documentImage = await loadImage(
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(rootTag)}${body.slice(firstTagEnd + 3)}`,
  );

  const pageWidthPt = page.widthMm * PT_PER_MM;
  const pageHeightPt = page.heightMm * PT_PER_MM;
  const marginPt = page.marginMm * PT_PER_MM;
  const contentWidthPt = pageWidthPt - marginPt * 2;
  const canvasWidth = Math.round(contentWidthPx * RENDER_SCALE);
  const maxStripHeight = Math.max(1, Math.floor(MAX_STRIP_PIXELS / canvasWidth));
  const pages: PdfImagePage[] = [];
  // الشريحة: صفحات متتالية تُرسم من الـ SVG مرة واحدة، ثم تُقص منها الصفحات (رسم لوحة من لوحة سريع)
  let index = 0;
  while (index < slices.length) {
    const stripFrom = slices[index][0];
    let last = index;
    while (last + 1 < slices.length && (slices[last + 1][1] - stripFrom) * RENDER_SCALE <= maxStripHeight) last += 1;
    const stripTo = slices[last][1];
    const stripHeight = Math.max(1, Math.round((stripTo - stripFrom) * RENDER_SCALE));
    const strip = whiteCanvas(canvasWidth, stripHeight);
    strip.context.drawImage(
      documentImage,
      0, stripFrom * RENDER_SCALE, canvasWidth, stripHeight,
      0, 0, canvasWidth, stripHeight,
    );
    for (let pageIndex = index; pageIndex <= last; pageIndex += 1) {
      const [from, to] = slices[pageIndex];
      const sliceHeight = Math.max(1, to - from);
      const pixelHeight = Math.max(1, Math.round(sliceHeight * RENDER_SCALE));
      const target = whiteCanvas(canvasWidth, pixelHeight);
      target.context.drawImage(
        strip.canvas,
        0, Math.round((from - stripFrom) * RENDER_SCALE), canvasWidth, pixelHeight,
        0, 0, canvasWidth, pixelHeight,
      );
      const jpeg = dataUrlToBytes(target.canvas.toDataURL("image/jpeg", 0.92));
      releaseCanvas(target.canvas);
      const heightPt = contentWidthPt * (sliceHeight / contentWidthPx);
      pages.push({
        jpeg,
        pixelWidth: canvasWidth,
        pixelHeight,
        pageWidthPt,
        pageHeightPt,
        x: marginPt,
        y: pageHeightPt - marginPt - heightPt,
        width: contentWidthPt,
        height: heightPt,
      });
      onProgress(pages.length, slices.length);
    }
    releaseCanvas(strip.canvas);
    index = last + 1;
    // يتنفس المتصفح بين الشرائح (التنبيه والواجهة)
    await nextFrame();
  }
  documentImage.src = "";
  return { kind: "pdf", bytes: buildPdf(pages), missingImages: blockedImages > 0 };
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

type PdfImagePage = {
  jpeg: Uint8Array;
  pixelWidth: number;
  pixelHeight: number;
  pageWidthPt: number;
  pageHeightPt: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

const num = (value: number) => (Math.round(value * 100) / 100).toFixed(2);

/** PDF 1.4: صفحة لكل صورة JPEG (DCTDecode)، بجدول xref صحيح */
function buildPdf(pages: PdfImagePage[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (data: Uint8Array | string) => {
    const bytes = typeof data === "string" ? encoder.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const objectCount = 2 + pages.length * 3;
  const beginObject = (id: number) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
  };

  push("%PDF-1.4\n");
  // سطر تعليق ثنائي (يعرّف الملف ثنائيًا لبرامج النقل)
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  beginObject(1);
  push("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  const pageIds = pages.map((_, index) => 3 + index * 3);
  beginObject(2);
  push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>\nendobj\n`);
  pages.forEach((page, index) => {
    const pageId = 3 + index * 3;
    const imageId = pageId + 1;
    const contentId = pageId + 2;
    beginObject(pageId);
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(page.pageWidthPt)} ${num(page.pageHeightPt)}] ` +
        `/Resources << /XObject << /Im${index} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`,
    );
    beginObject(imageId);
    push(
      `<< /Type /XObject /Subtype /Image /Width ${page.pixelWidth} /Height ${page.pixelHeight} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
    );
    push(page.jpeg);
    push("\nendstream\nendobj\n");
    const content = `q ${num(page.width)} 0 0 ${num(page.height)} ${num(page.x)} ${num(page.y)} cm /Im${index} Do Q\n`;
    beginObject(contentId);
    push(`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream\nendobj\n`);
  });
  const xrefOffset = length;
  let xref = `xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= objectCount; id += 1) xref += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const output = new Uint8Array(length);
  let position = 0;
  for (const chunk of chunks) {
    output.set(chunk, position);
    position += chunk.length;
  }
  return output;
}

function saveFile(bytes: Uint8Array, fileName: string) {
  const blob = new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}
