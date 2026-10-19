/*!
 * verify_burhan.mjs — تحقّق من «برهان نماء»: البوّابة ومحرّك الوكيل
 *
 *   ١. البوّابة بصيغتيها (Deno/Cloudflare وVercel): قفل المصدر، رمز الفريق،
 *      حصر المسارات والنماذج، حقن المفتاحين خادمياً، سقف max_tokens وعدد الروابط.
 *   ٢. المحرّك: حلقة الأدوات كاملةً على Claude مُصطنَع (بثّ SSE) وParallel مُصطنَع —
 *      الترقيم التراكمي للمصادر، إزالة التكرار، التوازي، سقف الجولات، الأخطاء.
 *
 *     node tests/verify_burhan.mjs
 */
import gateway, { handle } from "../gateway/burhan-gateway.js";
import vercelHandler from "../api/burhan/[...path].js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const B = require("../assets/burhan.js");

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; return; }
  fail++; console.log(`  ✗ ${name}${detail ? "\n      " + detail : ""}`);
};

const ORIGIN = "https://hanihalsulami.github.io";
const ENV = { ANTHROPIC_API_KEY: "sk-ant-server", PARALLEL_API_KEY: "par-server" };

// ── ١. البوّابة ────────────────────────────────────────────────────
let upstream = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  upstream.push({ url: String(url), headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
  return new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } });
};

const TARGETS = [
  { name: "Deno/Cloudflare", base: "https://gw.example.dev", prefix: "",
    call: (req, env) => gateway.fetch(req, env) },
  { name: "Vercel", base: "https://namaa.vercel.app", prefix: "/api/burhan",
    call: async (req, env) => {
      const keys = ["ANTHROPIC_API_KEY", "PARALLEL_API_KEY", "ACCESS_TOKEN", "ALLOWED_ORIGINS"];
      const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
      keys.forEach((k) => { if (env[k] !== undefined) process.env[k] = env[k]; else delete process.env[k]; });
      try { return await vercelHandler(req); }
      finally { keys.forEach((k) => { if (saved[k] !== undefined) process.env[k] = saved[k]; else delete process.env[k]; }); }
    } },
];

for (const T of TARGETS) {
  console.log(`البوّابة — ${T.name}`);
  const req = (path, opts = {}) => new Request(T.base + T.prefix + path, {
    method: opts.method || "POST",
    headers: { "content-type": "application/json", Origin: opts.origin ?? ORIGIN, ...(opts.headers || {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  upstream = [];
  let r = await T.call(req("/v1/messages", { body: { model: "claude-opus-5-5", max_tokens: 99999, messages: [] } }), ENV);
  ok("Claude: 200", r.status === 200, r.status);
  ok("Claude: الوجهة api.anthropic.com", upstream[0]?.url === "https://api.anthropic.com/v1/messages", upstream[0]?.url);
  ok("Claude: المفتاح يُحقن خادمياً", upstream[0]?.headers["x-api-key"] === "sk-ant-server");
  ok("Claude: إصدار الواجهة", upstream[0]?.headers["anthropic-version"] === "2023-06-01");
  ok("Claude: سقف max_tokens", upstream[0]?.body.max_tokens === 16000, upstream[0]?.body.max_tokens);
  ok("CORS: المصدر مُعاد", r.headers.get("access-control-allow-origin") === ORIGIN);

  upstream = [];
  r = await T.call(req("/v1/search", { body: { objective: "x", search_queries: ["a"] } }), ENV);
  ok("بحث: 200", r.status === 200);
  ok("بحث: الوجهة Parallel", upstream[0]?.url === "https://api.parallel.ai/v1/search", upstream[0]?.url);
  ok("بحث: مفتاح Parallel يُحقن", upstream[0]?.headers["x-api-key"] === "par-server");

  upstream = [];
  r = await T.call(req("/v1/extract", { body: { urls: ["1", "2", "3", "4", "5", "6", "7"], objective: "x" } }), ENV);
  ok("قراءة: سقف الروابط ٥", upstream[0]?.body.urls.length === 5);
  ok("قراءة: الوجهة", upstream[0]?.url === "https://api.parallel.ai/v1/extract");

  upstream = [];
  r = await T.call(req("/v1/messages", { origin: "https://evil.example", body: { model: "claude-opus-5-5" } }), ENV);
  ok("مصدر غريب: 403 ولا نداء", r.status === 403 && upstream.length === 0);

  r = await T.call(req("/v1/messages", { body: { model: "claude-3-opus" } }), ENV);
  ok("نموذج غير مسموح: 403", r.status === 403);

  r = await T.call(req("/v1/messages", { body: { model: "claude-opus-5-5", mcp_servers: [{}] } }), ENV);
  ok("mcp_servers مرفوض", r.status === 403);

  r = await T.call(req("/v1/models"), ENV);
  ok("مسار غير مدعوم: 404", r.status === 404);

  r = await T.call(req("/v1/search", { body: {} }), ENV);
  ok("بحث بلا استعلامات: 400", r.status === 400);

  r = await T.call(req("/v1/messages", { body: { model: "claude-opus-5-5" } }), { PARALLEL_API_KEY: "p" });
  ok("مفتاح Claude مفقود: 500", r.status === 500);

  const TEAM = { ...ENV, ACCESS_TOKEN: "team-123" };
  upstream = [];
  r = await T.call(req("/v1/search", { body: { search_queries: ["a"] } }), TEAM);
  ok("رمز الفريق مفقود: 401 ولا نداء", r.status === 401 && upstream.length === 0);
  r = await T.call(req("/v1/search", { body: { search_queries: ["a"] }, headers: { "x-namaa-token": "team-123" } }), TEAM);
  ok("رمز الفريق صحيح: 200", r.status === 200);

  r = await T.call(req("/health", { method: "GET" }), ENV);
  const h = await r.json();
  ok("الجاهزية: ok", r.status === 200 && h.ok === true && h.claude && h.parallel);
  ok("الجاهزية لا تكشف المفاتيح", !JSON.stringify(h).includes("server"));

  r = await T.call(req("/v1/messages", { method: "OPTIONS" }), ENV);
  ok("OPTIONS: 204", r.status === 204);
}

const big = new Request("https://gw.example.dev/v1/messages", {
  method: "POST", headers: { Origin: ORIGIN, "content-type": "application/json" },
  body: JSON.stringify({ model: "claude-opus-5-5", pad: "x".repeat(1_600_000) }),
});
ok("سقف الحجم: 413", (await handle(big, ENV, "")).status === 413);

// ── ٢. المحرّك ────────────────────────────────────────────────────
console.log("المحرّك");

function sse(events) {
  const body = events.map((e) => "event: " + e.type + "\ndata: " + JSON.stringify(e) + "\n\n").join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}
function claudeReply(blocks, stop) {
  const ev = [{ type: "message_start", message: {} }];
  blocks.forEach((b, i) => {
    if (b.type === "text") {
      ev.push({ type: "content_block_start", index: i, content_block: { type: "text", text: "" } });
      // تقطيع النصّ لاختبار تجميع البثّ
      for (let k = 0; k < b.text.length; k += 7) {
        ev.push({ type: "content_block_delta", index: i, delta: { type: "text_delta", text: b.text.slice(k, k + 7) } });
      }
    } else if (b.type === "thinking") {
      ev.push({ type: "content_block_start", index: i, content_block: { type: "thinking", thinking: "" } });
      ev.push({ type: "content_block_delta", index: i, delta: { type: "thinking_delta", thinking: "أفكّر" } });
      ev.push({ type: "content_block_delta", index: i, delta: { type: "signature_delta", signature: "sig-1" } });
    } else {
      ev.push({ type: "content_block_start", index: i, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } });
      const j = JSON.stringify(b.input);
      ev.push({ type: "content_block_delta", index: i, delta: { type: "input_json_delta", partial_json: j.slice(0, 10) } });
      ev.push({ type: "content_block_delta", index: i, delta: { type: "input_json_delta", partial_json: j.slice(10) } });
    }
    ev.push({ type: "content_block_stop", index: i });
  });
  ev.push({ type: "message_delta", delta: { stop_reason: stop } });
  ev.push({ type: "message_stop" });
  return sse(ev);
}

function makeFetch(script) {
  const calls = [];
  const f = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, headers: init.headers, body });
    const handler = script.shift();
    if (!handler) throw new Error("نداء غير متوقَّع: " + url);
    return handler(url, body);
  };
  return { f, calls };
}

const searchResp = (results) => async () =>
  new Response(JSON.stringify({ search_id: "s", session_id: "x", results }), { status: 200 });

const CFG = { mode: "gateway", gateway: "https://gw.example.dev/", token: "t1",
              model: "claude-opus-5-5", depth: "quick", retryBaseMs: 1 };

{
  // سؤال: بحثان متوازيان ← قراءة صفحة ← إجابة
  const { f, calls } = makeFetch([
    async () => claudeReply([
      { type: "thinking" },
      { type: "text", text: "سأبحث أولاً." },
      { type: "tool_use", id: "tu1", name: "parallel_search", input: { objective: "تعاميم CHI", search_queries: ["CHI circular preauth"] } },
      { type: "tool_use", id: "tu2", name: "parallel_search", input: { objective: "NPHIES", search_queries: ["NPHIES claims"] } },
    ], "tool_use"),
    searchResp([
      { url: "https://chi.gov.sa/a", title: "تعميم أ", publish_date: "2026-09-01", excerpts: ["نصّ أ"] },
      { url: "https://news.example.com/b", title: "خبر ب", excerpts: ["نصّ ب"] },
    ]),
    searchResp([
      { url: "https://chi.gov.sa/a/", title: "تعميم أ", excerpts: ["نصّ أ٢"] },   // تكرار بشرطة مائلة
      { url: "https://nphies.sa/c", title: "نفيس ج", excerpts: ["نصّ ج"] },
    ]),
    async () => claudeReply([
      { type: "tool_use", id: "tu3", name: "parallel_extract", input: { urls: ["https://nphies.sa/c"], objective: "التفاصيل" } },
    ], "tool_use"),
    async () => new Response(JSON.stringify({ results: [{ url: "https://nphies.sa/c", title: "نفيس ج", excerpts: ["تفصيل"] }], errors: [] })),
    async () => claudeReply([{ type: "text", text: "## الخلاصة\nالموافقة مطلوبة [1] ونفيس يشترط ذلك [3، 1]. وهذا رقم وهمي [9]." }], "end_turn"),
  ]);

  const s = new B.Session({ fetch: f, today: "2026-10-20" });
  const seen = { text: "", tools: [], done: [], discards: [] };
  const res = await s.ask("ما متطلبات الموافقة المسبقة؟", CFG, {
    onText: (t) => { seen.text += t; },
    onTool: (i) => seen.tools.push(i.kind),
    onToolDone: (d) => seen.done.push(d),
    onTurnDiscard: (t) => seen.discards.push(t),
  });

  ok("عدد النداءات ٦", calls.length === 6, calls.length);
  ok("Claude عبر البوّابة", calls[0].url === "https://gw.example.dev/v1/messages", calls[0].url);
  ok("رمز الفريق يُرسَل", calls[0].headers["x-namaa-token"] === "t1");
  ok("لا مفتاح في طلبات البوّابة", !calls.some((c) => c.headers["x-api-key"]));
  ok("البحث عبر البوّابة", calls[1].url === "https://gw.example.dev/v1/search");
  ok("نمط البحث السريع fast", calls[1].body.mode === "fast" && calls[1].body.advanced_settings.max_results === 6);
  ok("معرّف الجلسة ثابت", calls[1].body.session_id === calls[2].body.session_id && calls[1].body.session_id.startsWith("burhan_"));
  ok("الأدوات وُصفت لـ Claude", calls[0].body.tools.map((t) => t.name).join() === "parallel_search,parallel_extract");
  ok("تاريخ اليوم في التعليمات", calls[0].body.system[0].text.includes("2026-10-20"));
  ok("التفكير المتكيّف", calls[0].body.thinking.type === "adaptive" && calls[0].body.output_config.effort === "medium");
  ok("التوازي: نتيجتا الأداتين في رسالة واحدة",
     calls[3].body.messages.at(-1).content.length === 2 &&
     calls[3].body.messages.at(-1).content.every((b) => b.type === "tool_result"));
  const asst = calls[3].body.messages[1].content;
  ok("كتلة التفكير تُعاد بتوقيعها", asst[0].type === "thinking" && asst[0].signature === "sig-1");
  ok("مدخلات الأداة مُجمَّعة من البثّ", asst[2].input.search_queries[0] === "CHI circular preauth");
  ok("لا حقول زائدة في الكتل", asst.every((b) => !("_json" in b)) && !("thinking" in asst[1]));
  ok("المصادر بلا تكرار (٣)", s.sources.items.length === 3, s.sources.items.length);
  ok("تكرار الرابط يدمج المقاطع", s.sources.get(1).excerpts.length === 2);
  ok("الترقيم في نتيجة الأداة",
     calls[3].body.messages.at(-1).content[1].content.startsWith("[1]") &&
     calls[3].body.messages.at(-1).content[1].content.includes("[3]"));
  ok("الجهة الرسمية مميَّزة", s.sources.get(1).official && s.sources.get(3).official && !s.sources.get(2).official);
  ok("نصّ ما قبل الأداة يُفصل عن الإجابة", seen.discards[0] === "سأبحث أولاً.");
  ok("الإجابة النهائية", res.text.startsWith("## الخلاصة"));
  ok("أرقام الإسناد الصحيحة فقط [1،3]", JSON.stringify(res.cited) === "[1,3]", JSON.stringify(res.cited));
  ok("تسلسل الأدوات", seen.tools.join() === "search,search,extract");
  ok("نتائج الأدوات مُبلَّغ عنها", seen.done.length === 3 && seen.done[0].count === 2);
  ok("التاريخ محفوظ للمتابعة", s.history.length === 6 && s.history.at(-1).role === "assistant");
}

{
  // الوضع المباشر + نموذج Haiku: لا output_config، والمفتاحان في الترويسات
  const { f, calls } = makeFetch([
    async () => claudeReply([{ type: "tool_use", id: "a", name: "parallel_search", input: { objective: "x", search_queries: ["y"] } }], "tool_use"),
    searchResp([]),
    async () => claudeReply([{ type: "text", text: "لم أجد مصادر." }], "end_turn"),
  ]);
  const s = new B.Session({ fetch: f });
  const res = await s.ask("سؤال", { mode: "direct", anthropicKey: "k1", parallelKey: "k2",
    model: "claude-haiku-5-5", depth: "deep", retryBaseMs: 1 }, {});
  ok("مباشر: Anthropic", calls[0].url === "https://api.anthropic.com/v1/messages" && calls[0].headers["x-api-key"] === "k1");
  ok("مباشر: ترويسة المتصفّح", calls[0].headers["anthropic-dangerous-direct-browser-access"] === "true");
  ok("مباشر: Parallel", calls[1].url === "https://api.parallel.ai/v1/search" && calls[1].headers["x-api-key"] === "k2");
  ok("معمّق: نمط advanced", calls[1].body.mode === "advanced" && calls[1].body.advanced_settings.max_results === 8);
  ok("Haiku بلا effort", !("output_config" in calls[0].body));
  ok("لا نتائج: نصّ صريح للنموذج", calls[2].body.messages.at(-1).content[0].content.includes("لا نتائج"));
  ok("إجابة بلا إسناد", res.text === "لم أجد مصادر." && res.cited.length === 0);
}

{
  // سقف الجولات: بعد ٤ جولات سريعة يُطلب الإجابة، وأداة لاحقة تُغلق
  const tool = (id) => async () => claudeReply([{ type: "tool_use", id, name: "parallel_search", input: { objective: "x", search_queries: ["y"] } }], "tool_use");
  const script = [];
  for (let i = 0; i < 4; i++) { script.push(tool("t" + i)); script.push(searchResp([{ url: "https://e.com/" + i, title: "e" + i, excerpts: ["z"] }])); }
  script.push(tool("t9"));
  const { f, calls } = makeFetch(script);
  const s = new B.Session({ fetch: f });
  const res = await s.ask("سؤال", CFG, {});
  const last = calls.at(-1).body.messages.at(-1);
  ok("سقف الجولات: طلب الإجابة", last.role === "user" && last.content[0].text.includes("حدّ جولات البحث"));
  ok("سقف الجولات: إغلاق الأداة المعلّقة", s.history.at(-1).content[0].type === "tool_result");
  ok("سقف الجولات: لا بحث خامس", calls.filter((c) => c.url.endsWith("/v1/search")).length === 4);
  ok("سقف الجولات: النتيجة تُعاد", typeof res.text === "string");
}

{
  // مفتاح Parallel خاطئ: يتوقّف بخطأ مفهوم، والتاريخ لا يتلوّث
  const { f } = makeFetch([
    async () => claudeReply([{ type: "tool_use", id: "a", name: "parallel_search", input: { objective: "x", search_queries: ["y"] } }], "tool_use"),
    async () => new Response('{"type":"error","error":{"message":"bad key"}}', { status: 401 }),
  ]);
  const s = new B.Session({ fetch: f });
  let err = null;
  try { await s.ask("سؤال", CFG, {}); } catch (e) { err = e; }
  ok("مفتاح Parallel خاطئ: خطأ", err && err.status === 401 && err.provider === "parallel");
  ok("الرسالة مفهومة", B.explain(err, "parallel").includes("Parallel"));
  ok("التاريخ لم يتلوّث", s.history.length === 0);
}

{
  // إعادة المحاولة عند الازدحام ثم النجاح
  const { f, calls } = makeFetch([
    async () => new Response('{"error":{"message":"overloaded"}}', { status: 529 }),
    async () => claudeReply([{ type: "text", text: "تم." }], "end_turn"),
  ]);
  const s = new B.Session({ fetch: f });
  const res = await s.ask("سؤال", CFG, {});
  ok("إعادة المحاولة عند 529", calls.length === 2 && res.text === "تم.");
}

{
  // الرفض
  const { f } = makeFetch([async () => claudeReply([], "refusal")]);
  const res = await new B.Session({ fetch: f }).ask("سؤال", CFG, {});
  ok("الرفض يُعاد بوضوح", res.refused === true);
}

// أدوات مساعدة
ok("استخراج الإسناد", JSON.stringify(B.citedNumbers("أ [1] ب [2, 3] ج [2][4] د [١]")) === "[1,2,3,4]");
ok("الجاهزية: بوّابة", B.ready({ mode: "gateway", gateway: "https://x" }) && !B.ready({ mode: "gateway", gateway: "" }));
ok("الجاهزية: مباشر يتطلّب المفتاحين", !B.ready({ mode: "direct", anthropicKey: "a" }));
ok("رسمي", B.isOfficial("www.moh.gov.sa") && B.isOfficial("nphies.sa") && !B.isOfficial("example.com"));

globalThis.fetch = realFetch;
console.log(`\n${fail ? "✗" : "✓"} برهان نماء: ${pass} ناجح، ${fail} فاشل`);
process.exit(fail ? 1 : 0);
