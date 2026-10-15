// أُوقفت هذه الدالة: كانت تولّد خصومات تجعل صافي راتب الموظف السعودي 1000 ريال،
// بأسباب لا تستند إلى سجلات حضور أو جزاءات، ورسائل إقرار باسم الموظفين بتواريخ سابقة.
// البيانات التي وُلّدت سابقًا لم تُحذف وتبقى للمراجعة. الكود الأصلي محفوظ خارج المستودع للمراجعة القانونية.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return new Response(
    JSON.stringify({ success: false, error: "الخصم الآلي موقوف؛ الخصومات تُسجَّل من الحضور والجزاءات ومسير الرواتب فقط" }),
    { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
