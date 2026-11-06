/*!
 * gateway/worker.js — بوّابة «مساند نماء الذكي» لمفتاح Gemini (Cloudflare Worker)
 * ARCH Predict · ARCH Systems
 *
 * لماذا بوّابة؟ المنصّة موقع ثابت (GitHub Pages) بلا خادم، وأي مفتاح يوضع
 * في صفحاتها — ولو «مشفَّراً» — يستطيع كل زائر استخراجه، لأن المتصفّح الذي
 * سيفكّ التشفير بيد الزائر نفسه. هذه البوّابة تحمل المفتاح في مخزن أسرار
 * Cloudflare (مشفَّر لديهم، ولا يُعرض حتى لصاحب الحساب بعد حفظه)، وتُلحقه
 * بالطلب في الخادم — فلا يصل المفتاح إلى أي متصفّح إطلاقاً.
 *
 * ما تفعله:
 *   المتصفّح ──▶ البوّابة (تتحقق من المصدر والمسار، وتحقن المفتاح)
 *            ──▶ generativelanguage.googleapis.com ──▶ بثّ الردّ كما هو
 *
 * حدود الحماية بصراحة: قفل Origin يصدّ الاستعمال من مواقع أخرى، لكنه لا
 * يمنع من يستدعي البوّابة مباشرةً من خارج متصفّح. الحصّة المجانية لدى
 * Google وCloudflare هي سقف الضرر؛ لميزانية صارمة أضف عدّاداً لاحقاً.
 *
 * النشر (gateway/README.md): الملف نفسه يعمل لصقاً كما هو على منصّتين —
 *   • Deno Deploy (dash.deno.com ← Playground): الصق والصق المفتاح في Env.
 *   • Cloudflare Workers: الصق في المحرّر وضع المفتاح سرّاً.
 * ولمستخدمي Vercel: الدالة الجاهزة في api/gemini/[...path].js تُنشر بربط
 * المستودع فقط، بلا لصق.
 *
 * الأسرار والمتغيرات (Settings ← Variables):
 *   GEMINI_API_KEY   (Secret — إلزامي) مفتاح Gemini. لا يوضع في الشيفرة أبداً.
 *   ALLOWED_ORIGINS  (اختياري) مصادر مسموحة مفصولة بفواصل.
 *                    الافتراضي: موقع المنصّة على GitHub Pages.
 *   ALLOWED_MODELS   (اختياري) نماذج مسموحة مفصولة بفواصل.
 */

const DEFAULT_ORIGINS = "https://hanihalsulami.github.io";
const DEFAULT_MODELS =
  "gemini-flash-latest,gemini-pro-latest,gemini-flash-lite-latest";
const UPSTREAM = "https://generativelanguage.googleapis.com";
const MAX_BODY_BYTES = 300_000;          // يتّسع للتاريخ والأدوات، ويصدّ الإغراق

function json(status, message, cors) {
  return new Response(
    JSON.stringify({ error: { code: status, message } }),
    { status, headers: { "content-type": "application/json", ...cors } },
  );
}

const gateway = {
  async fetch(request, env) {
    const allowedOrigins = (env.ALLOWED_ORIGINS || DEFAULT_ORIGINS)
      .split(",").map((s) => s.trim()).filter(Boolean);
    const origin = request.headers.get("Origin") || "";
    const originOk = allowedOrigins.includes(origin);

    const cors = {
      "Access-Control-Allow-Origin": originOk ? origin : allowedOrigins[0],
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "POST") {
      return json(405, "POST فقط", cors);
    }
    if (!originOk) {
      return json(403, "المصدر غير مسموح لهذه البوّابة", cors);
    }
    if (!env.GEMINI_API_KEY) {
      return json(500, "GEMINI_API_KEY غير مضبوط في أسرار البوّابة", cors);
    }

    const len = Number(request.headers.get("content-length") || "0");
    if (len > MAX_BODY_BYTES) {
      return json(413, "حجم الطلب أكبر من المسموح", cors);
    }

    // المسار المسموح: نداءا التوليد فقط، ولنماذج معلومة فقط
    const url = new URL(request.url);
    const m = url.pathname.match(
      /^\/v1beta\/models\/([A-Za-z0-9._-]+):(generateContent|streamGenerateContent)$/,
    );
    if (!m) {
      return json(404, "المسار غير مدعوم في هذه البوّابة", cors);
    }
    const allowedModels = (env.ALLOWED_MODELS || DEFAULT_MODELS)
      .split(",").map((s) => s.trim()).filter(Boolean);
    if (!allowedModels.includes(m[1])) {
      return json(403, "النموذج غير مسموح في هذه البوّابة", cors);
    }

    const upstream = await fetch(UPSTREAM + url.pathname + url.search, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // المفتاح يُحقن هنا — في الخادم — ولا يمرّ بأي متصفّح
        "x-goog-api-key": env.GEMINI_API_KEY,
      },
      body: request.body,
    });

    // تمرير الردّ (بثّاً كان أو JSON) كما هو، بترويسات CORS
    const headers = new Headers(cors);
    headers.set("content-type",
      upstream.headers.get("content-type") || "application/json");
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};

export default gateway;

// على Deno Deploy يُشغَّل الملف نفسه مباشرةً؛ على Cloudflare هذا الفرع لا يعمل
if (typeof Deno !== "undefined" && Deno.serve) {
  Deno.serve((req) => gateway.fetch(req, Deno.env.toObject()));
}
