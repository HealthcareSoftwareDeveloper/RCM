/*!
 * api/gemini/[...path].js — بوّابة «مساند نماء الذكي» لمفتاح Gemini (دالة Vercel Edge)
 * ARCH Predict · ARCH Systems
 *
 * النسخة نفسها من بوّابة gateway/worker.js بصيغة Vercel: تُنشر بربط هذا
 * المستودع بحساب Vercel (تسجيل دخول بحساب GitHub، بلا أي أدوات أو لصق) —
 * الدليل في gateway/README.md.
 *
 * المفتاح يوضع في Vercel ← Settings ← Environment Variables باسم
 * GEMINI_API_KEY (النوع Sensitive — مشفَّر ولا يُعرض بعد حفظه)، ويُحقن هنا
 * في الخادم فلا يصل إلى أي متصفّح. لا يوضع المفتاح في هذا الملف أبداً.
 *
 * رابط البوّابة الناتج لملف assets/site-config.js:
 *   https://<مشروعك>.vercel.app/api/gemini/v1beta/models/
 */

export const config = { runtime: "edge" };

const DEFAULT_ORIGINS = "https://hanihalsulami.github.io";
const DEFAULT_MODELS =
  "gemini-flash-lite-latest,gemini-flash-latest,gemini-pro-latest";
const UPSTREAM = "https://generativelanguage.googleapis.com";
const MAX_BODY_BYTES = 300_000;

function json(status, message, cors) {
  return new Response(
    JSON.stringify({ error: { code: status, message } }),
    { status, headers: { "content-type": "application/json", ...cors } },
  );
}

export default async function handler(request) {
  const env = typeof process !== "undefined" ? process.env : {};
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
  if (request.method !== "POST") return json(405, "POST فقط", cors);
  if (!originOk) return json(403, "المصدر غير مسموح لهذه البوّابة", cors);
  if (!env.GEMINI_API_KEY) {
    return json(500, "GEMINI_API_KEY غير مضبوط في متغيرات البيئة", cors);
  }

  const len = Number(request.headers.get("content-length") || "0");
  if (len > MAX_BODY_BYTES) return json(413, "حجم الطلب أكبر من المسموح", cors);

  // المسار بعد بادئة الدالة /api/gemini — نداءا التوليد فقط ولنماذج معلومة
  const url = new URL(request.url);
  const sub = url.pathname.replace(/^\/api\/gemini/, "");
  const m = sub.match(
    /^\/v1beta\/models\/([A-Za-z0-9._-]+):(generateContent|streamGenerateContent)$/,
  );
  if (!m) return json(404, "المسار غير مدعوم في هذه البوّابة", cors);

  const allowedModels = (env.ALLOWED_MODELS || DEFAULT_MODELS)
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (!allowedModels.includes(m[1])) {
    return json(403, "النموذج غير مسموح في هذه البوّابة", cors);
  }

  const upstream = await fetch(UPSTREAM + sub + url.search, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // المفتاح يُحقن هنا — في الخادم — ولا يمرّ بأي متصفّح
      "x-goog-api-key": env.GEMINI_API_KEY,
    },
    body: request.body,
  });

  const headers = new Headers(cors);
  headers.set("content-type",
    upstream.headers.get("content-type") || "application/json");
  return new Response(upstream.body, { status: upstream.status, headers });
}
