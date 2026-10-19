/*!
 * gateway/burhan-gateway.js — بوّابة «برهان نماء» لمفتاحَي Claude وParallel
 * منصّة نماء · تجمع مكة المكرمة الصحي · إدارة أداء تنمية الإيرادات
 *
 * «برهان نماء» محرّك بحث وإجابة: Claude يقرّر ما يُبحث عنه، وParallel يجلب
 * المقاطع من الويب الحيّ، ثم يكتب Claude إجابة مُسنَدة برقم المصدر.
 * المنصّة موقع ثابت (GitHub Pages) — فالمفتاحان لا يجوز أن يصلا إلى أي
 * متصفّح. هذه البوّابة تحملهما في مخزن الأسرار وتحقنهما خادمياً.
 *
 *   المتصفّح ──▶ البوّابة ──┬─▶ api.anthropic.com/v1/messages   (Claude)
 *                          ├─▶ api.parallel.ai/v1/search       (بحث)
 *                          └─▶ api.parallel.ai/v1/extract      (قراءة صفحة)
 *
 * الملف قائم بذاته: يُلصق كما هو على Deno Deploy أو Cloudflare Workers،
 * ويستورده api/burhan/[...path].js على Vercel. الدليل: gateway/README.md.
 *
 * الأسرار والمتغيرات (Settings ← Variables):
 *   ANTHROPIC_API_KEY  (Secret — إلزامي) مفتاح Claude.
 *   PARALLEL_API_KEY   (Secret — إلزامي) مفتاح Parallel.
 *   ACCESS_TOKEN       (Secret — اختياري) رمز دخول للفريق؛ إن ضُبط فلا تُخدم
 *                      إلا الطلبات التي تحمله في ترويسة x-namaa-token.
 *   ALLOWED_ORIGINS    (اختياري) مصادر مسموحة مفصولة بفواصل.
 *   ALLOWED_MODELS     (اختياري) نماذج Claude المسموحة مفصولة بفواصل.
 */

const DEFAULT_ORIGINS = "https://hanihalsulami.github.io";
const DEFAULT_MODELS = "claude-opus-5-5,claude-sonnet-5-5,claude-haiku-5-5";
const ANTHROPIC = "https://api.anthropic.com/v1/messages";
const PARALLEL = "https://api.parallel.ai";
const MAX_BODY_BYTES = 1_500_000;   // تاريخ الحوار ونتائج البحث تكبر — مع سقف يصدّ الإغراق
const MAX_TOKENS_CAP = 16000;
const MAX_EXTRACT_URLS = 5;

function list(v, d) {
  return String(v || d).split(",").map((s) => s.trim()).filter(Boolean);
}

function json(status, payload, cors) {
  return new Response(JSON.stringify(payload), {
    status, headers: { "content-type": "application/json", ...cors },
  });
}
const fail = (status, message, cors) =>
  json(status, { type: "error", error: { code: status, message } }, cors);

/** يقرأ الجسم نصّاً بسقف حجم حقيقي (لا يكتفي بترويسة content-length) */
async function readBody(request) {
  const len = Number(request.headers.get("content-length") || "0");
  if (len > MAX_BODY_BYTES) return { tooLarge: true };
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return { tooLarge: true };
  try { return { data: JSON.parse(text) }; } catch { return { bad: true }; }
}

/**
 * المُعالج الموحّد. prefix: بادئة المسار (Vercel: "/api/burhan").
 */
export async function handle(request, env, prefix = "") {
  env = env || {};
  const allowedOrigins = list(env.ALLOWED_ORIGINS, DEFAULT_ORIGINS);
  const origin = request.headers.get("Origin") || "";
  const originOk = allowedOrigins.includes(origin);

  const cors = {
    "Access-Control-Allow-Origin": originOk ? origin : allowedOrigins[0],
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-namaa-token",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (!originOk) return fail(403, "المصدر غير مسموح لهذه البوّابة", cors);

  if (env.ACCESS_TOKEN && request.headers.get("x-namaa-token") !== env.ACCESS_TOKEN) {
    return fail(401, "رمز دخول الفريق غير صحيح أو مفقود", cors);
  }

  const url = new URL(request.url);
  const path = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : url.pathname;

  // فحص الجاهزية — لا يكشف شيئاً من المفاتيح، فقط وجودها
  if (path === "/health" || path === "/health/") {
    if (request.method !== "GET") return fail(405, "GET فقط", cors);
    return json(200, {
      ok: !!(env.ANTHROPIC_API_KEY && env.PARALLEL_API_KEY),
      claude: !!env.ANTHROPIC_API_KEY,
      parallel: !!env.PARALLEL_API_KEY,
      models: list(env.ALLOWED_MODELS, DEFAULT_MODELS),
      team_token: !!env.ACCESS_TOKEN,
    }, cors);
  }

  if (request.method !== "POST") return fail(405, "POST فقط", cors);

  const route = {
    "/v1/messages": "claude",
    "/v1/search": "search",
    "/v1/extract": "extract",
  }[path];
  if (!route) return fail(404, "المسار غير مدعوم في هذه البوّابة", cors);

  const body = await readBody(request);
  if (body.tooLarge) return fail(413, "حجم الطلب أكبر من المسموح", cors);
  if (body.bad || !body.data || typeof body.data !== "object") {
    return fail(400, "جسم الطلب ليس JSON صالحاً", cors);
  }
  const data = body.data;

  let upstream;
  if (route === "claude") {
    if (!env.ANTHROPIC_API_KEY) return fail(500, "ANTHROPIC_API_KEY غير مضبوط في أسرار البوّابة", cors);
    if (!list(env.ALLOWED_MODELS, DEFAULT_MODELS).includes(data.model)) {
      return fail(403, "النموذج غير مسموح في هذه البوّابة", cors);
    }
    // لا تصير البوّابة وكيلاً عاماً: لا خوادم MCP ولا أدوات خادمية مستترة
    if (data.mcp_servers || data.container) {
      return fail(403, "حقول غير مسموحة في هذه البوّابة", cors);
    }
    data.max_tokens = Math.min(Number(data.max_tokens) || 4096, MAX_TOKENS_CAP);
    upstream = await fetch(ANTHROPIC, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,          // يُحقن هنا ولا يمرّ بأي متصفّح
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(data),
    });
  } else {
    if (!env.PARALLEL_API_KEY) return fail(500, "PARALLEL_API_KEY غير مضبوط في أسرار البوّابة", cors);
    if (route === "extract") {
      if (!Array.isArray(data.urls) || !data.urls.length) return fail(400, "urls مطلوبة", cors);
      if (data.urls.length > MAX_EXTRACT_URLS) data.urls = data.urls.slice(0, MAX_EXTRACT_URLS);
    } else if (!Array.isArray(data.search_queries) || !data.search_queries.length) {
      return fail(400, "search_queries مطلوبة", cors);
    }
    upstream = await fetch(PARALLEL + path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": env.PARALLEL_API_KEY },
      body: JSON.stringify(data),
    });
  }

  // تمرير الردّ (بثّاً كان أو JSON) كما هو، بترويسات CORS
  const headers = new Headers(cors);
  headers.set("content-type", upstream.headers.get("content-type") || "application/json");
  return new Response(upstream.body, { status: upstream.status, headers });
}

const gateway = { fetch: (request, env) => handle(request, env, "") };
export default gateway;

// على Deno Deploy يُشغَّل الملف نفسه مباشرةً؛ على Cloudflare هذا الفرع لا يعمل
if (typeof Deno !== "undefined" && Deno.serve) {
  Deno.serve((req) => handle(req, Deno.env.toObject(), ""));
}
