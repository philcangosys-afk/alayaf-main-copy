/**
 * استيراد العملاء والموردين من إكسل: الاسم، والنوع، والجوال، والبريد، والرقم الضريبي.
 * الحفظ كما في شاشة العملاء والموردين (إدراج في الجدول، والقاعدة تمنع تكرار الاسم وتولّد الرقم).
 */
import { supabase } from "@/lib/supabaseClient";
import { selectAllRows } from "@/lib/ledgerData";
import { normalizePartyName, partyErrorText } from "@/lib/partyErrors";
import { SAUDI_VAT_NUMBER_PATTERN } from "@/lib/utils";
import { EMAIL_PATTERN, alreadySaved, cleanCell, cleanText, normalizePhone, pickOption, type ImportSpec, type Translate } from "@/lib/dataImport";

type PartyRow = Record<string, unknown>;
type PartyContext = { names: Set<string>; taxNumbers: Map<string, string> };

const CUSTOMER_TYPES = ["شركة", "فرد", "جهة حكومية"];
const VENDOR_TYPES = ["مورد محلي", "مورد دولي", "مورد خدمات"];

const TYPE_ALIASES: Record<string, string[]> = {
  "شركة": ["company", "business", "منشأة", "مؤسسة", "b2b"],
  "فرد": ["individual", "person", "شخص", "b2c"],
  "جهة حكومية": ["government", "حكومي", "حكومية"],
  "مورد محلي": ["local", "local vendor", "محلي"],
  "مورد دولي": ["international", "foreign", "دولي", "خارجي", "international vendor"],
  "مورد خدمات": ["services", "service", "خدمات", "service vendor"],
};

export function partiesImportSpec(kind: "customer" | "vendor", t: Translate): ImportSpec<PartyRow, PartyContext> {
  const isVendor = kind === "vendor";
  const table = isVendor ? "vendors" : "customers";
  const types = isVendor ? VENDOR_TYPES : CUSTOMER_TYPES;
  const typeOptions = types.map((type) => ({ value: type, labels: [t(type), ...(TYPE_ALIASES[type] ?? [])] }));

  return {
    id: table,
    title: isVendor ? "الموردون" : "العملاء",
    fileName: isVendor ? "قالب استيراد الموردين" : "قالب استيراد العملاء",
    columns: [
      {
        key: "name", label: "الاسم", required: true, width: 32,
        hint: isVendor ? "اسم المورد كما يظهر في فواتيره، ولا يتكرر" : "اسم العميل أو المنشأة كما يظهر في الفاتورة، ولا يتكرر",
        example: isVendor ? "مؤسسة التوريدات الحديثة" : "شركة النخبة التجارية",
        aliases: isVendor
          ? ["اسم المورد", "المورد", "vendor", "vendor name", "supplier", "supplier name", "name"]
          : ["اسم العميل", "العميل", "customer", "customer name", "client", "client name", "name", "اسم المنشأة"],
      },
      {
        key: "type", label: "النوع", options: types,
        hint: isVendor ? "مورد محلي أو مورد دولي أو مورد خدمات؛ الافتراضي مورد محلي" : "شركة أو فرد أو جهة حكومية؛ الافتراضي شركة إن وُجد رقم ضريبي، وإلا فرد",
        example: isVendor ? "مورد محلي" : "شركة",
        aliases: ["type", "category", "التصنيف", isVendor ? "نوع المورد" : "نوع العميل"],
      },
      {
        key: "phone", label: "الجوال", kind: "text",
        hint: "رقم الجوال أو الهاتف، ويُقبل بلا صفر البداية أو بمفتاح الدولة", example: "0501234567",
        aliases: ["رقم الجوال", "الهاتف", "رقم الهاتف", "جوال", "هاتف", "phone", "mobile", "mobile number", "phone number", "tel", "telephone"],
      },
      {
        key: "email", label: "البريد الإلكتروني", width: 28,
        hint: "اختياري", example: "info@example.com",
        aliases: ["البريد", "الايميل", "الإيميل", "email", "e-mail", "mail", "email address"],
      },
      {
        key: "vat", label: "الرقم الضريبي", kind: "text",
        hint: "للمسجل في ضريبة القيمة المضافة: 15 رقمًا يبدأ وينتهي بالرقم 3، وإلا اتركه فارغًا", example: "300000000000003",
        aliases: ["رقم التسجيل الضريبي", "الرقم الضريبي للعميل", "رقم ضريبي", "vat", "vat number", "vat no", "tax number", "tax id", "trn"],
      },
    ],
    notes: isVendor
      ? ["المورد الدولي غير المقيم تُكمل دولته وتسجيله من شاشة المورد بعد الاستيراد.", "الرصيد الافتتاحي يُسجَّل بقيد محاسبي، لا من الاستيراد."]
      : ["العميل المسجل ضريبيًا يحتاج العنوان الوطني لإصدار فاتورة ضريبية له؛ يُكمل من شاشة العميل بعد الاستيراد.", "الرصيد الافتتاحي يُسجَّل بقيد محاسبي، لا من الاستيراد."],

    prepare: async () => {
      const result = await selectAllRows((from, to) => supabase.from(table).select("name, tax_number").order("id").range(from, to));
      if (result.error) throw new Error(t(partyErrorText(result.error.message, isVendor)));
      const names = new Set<string>();
      const taxNumbers = new Map<string, string>();
      (result.data as Array<{ name?: string | null; tax_number?: string | null }>).forEach((row) => {
        names.add(normalizePartyName(String(row.name ?? "")));
        const tax = String(row.tax_number ?? "").trim();
        if (tax) taxNumbers.set(tax, String(row.name ?? ""));
      });
      return { names, taxNumbers };
    },

    parse: (values, ctx) => {
      // الاسم كما في الملف (الأرقام لا تتغير)، ويُقارن بالموجود بتوحيد القاعدة نفسه (المسافات وحالة الأحرف)
      const name = cleanText(values.name);
      if (name.length < 2) return { error: t("الاسم مطلوب (حرفان على الأقل)") };
      if (name.length > 200) return { error: t("الاسم أطول من 200 حرف") };
      const normalized = normalizePartyName(name);
      if (ctx.names.has(normalized)) return { error: t(isVendor ? "يوجد مورد بالاسم نفسه في النظام" : "يوجد عميل بالاسم نفسه في النظام") };

      const vat = cleanCell(values.vat).replace(/\s/g, "");
      if (vat && !SAUDI_VAT_NUMBER_PATTERN.test(vat)) return { error: t("الرقم الضريبي السعودي 15 رقمًا يبدأ وينتهي بالرقم 3") };

      let type = isVendor ? "مورد محلي" : vat ? "شركة" : "فرد";
      if (cleanCell(values.type)) {
        const picked = pickOption(values.type, typeOptions);
        if (!picked) return { error: `${t("النوع غير معروف")}: ${cleanCell(values.type)} — ${types.map((item) => t(item)).join(" / ")}` };
        type = picked;
      }

      const phone = normalizePhone(values.phone);
      if (phone && !/^\+?\d{7,15}$/.test(phone)) return { error: t("رقم الجوال غير صحيح") };
      const email = cleanCell(values.email).toLowerCase();
      if (email && !EMAIL_PATTERN.test(email)) return { error: t("البريد الإلكتروني غير صحيح") };

      const warnings: string[] = [];
      if (vat && ctx.taxNumbers.has(vat)) warnings.push(`${t("الرقم الضريبي مسجل أيضًا لـ")} ${ctx.taxNumbers.get(vat)}`);
      if (!isVendor && vat) warnings.push(t("مسجل ضريبيًا: أكمل عنوانه الوطني من شاشة العميل قبل إصدار فاتورة ضريبية له"));
      if (isVendor && type === "مورد دولي") warnings.push(t("مورد دولي: أكمل دولته وتسجيله الضريبي من شاشة المورد"));

      return {
        key: `name:${normalized}`,
        warning: warnings.join(" — ") || undefined,
        value: {
          id: crypto.randomUUID(),
          name,
          type,
          email,
          phone,
          // الأرصدة الافتتاحية للأطراف تُسجَّل بقيد محاسبي
          opening_balance: "0",
          credit_limit: "0",
          status: "نشط",
          country: vat ? "المملكة العربية السعودية" : "",
          tax_registration_mode: vat ? "registered_sa" : "not_registered",
          tax_number: vat,
          commercial_registration: "",
          city: "",
          street: "",
          building_number: "",
          district: "",
          postal_code: "",
          invoice_ref: "",
          currency: "SAR",
          payment_terms: "",
          business_type: "",
          license_number: "",
        },
      };
    },

    save: async (row) => {
      const { error } = await supabase.from(table).insert([row]);
      // إعادة الصف بعد انقطاع والسجل نفسه (بمعرّفه) محفوظ من الدفعة: نجاح
      if (alreadySaved(error)) return null;
      return error ? t(partyErrorText(error.message, isVendor)) : null;
    },
    saveBatch: async (rows) => {
      const { error } = await supabase.from(table).insert(rows);
      return error ? t(partyErrorText(error.message, isVendor)) : null;
    },
  };
}
