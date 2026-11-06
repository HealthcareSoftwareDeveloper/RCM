/*!
 * rcm-llm.js — طبقة التوليد اللغوي في «مساند نماء الذكي»
 * ARCH Predict · ARCH Systems
 *
 * طبقة اختيارية فوق الاسترجاع المحلّي. تُدير حواراً متعدّد الأدوار مع
 * Claude عبر Messages API، وتمنحه أداةً واحدة: البحث في فهرس لوائح CHI
 * المحمَّل في هذه الصفحة. فلا يجيب من ذاكرته، بل من نصّ اللائحة المسترجَع.
 *
 * ثلاثة قيود مبنيّة في التصميم:
 *   ١. لا نصّ نظاميّ إلا من الأداة — والنموذج ملزَم بذكر رقم المرجع [n].
 *   ٢. المفتاح يبقى على جهاز المستخدم (localStorage) ولا يُرسَل إلا لمزوّده.
 *   ٣. الطبقة مُطفأة افتراضياً؛ الأداة كاملة الوظيفة بدونها.
 *
 * وضعان للاتصال مع Anthropic:
 *   • مباشر  — المتصفّح ← api.anthropic.com بمفتاح المستخدم.
 *   • وسيط   — المتصفّح ← بوّابة المنشأة، فلا يوجد مفتاح في المتصفّح أصلاً.
 *              وهو الوضع الموصى به عند التعميم على أكثر من مستخدم.
 * ومزوّد بديل: Google Gemini عبر Generative Language API — بالقيود نفسها:
 * أداة البحث المحليّة وحدها، والإسناد الإلزامي، والمفتاح على جهاز المستخدم.
 */
(function (root) {
  "use strict";

  var CFG_KEY = "sadeed.llm.v1";
  var DEFAULT_ENDPOINT = "https://api.anthropic.com/v1/messages";
  var API_VERSION = "2023-06-01";
  var FALLBACK_BETA = "server-side-fallback-2026-07-01";

  var MODELS = [
    { id: "claude-opus-5", label: "Claude Opus 5 — الأدقّ" },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5 — أسرع وأقلّ كلفة" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 — الأسرع" },
  ];

  var GEMINI_MODELS = [
    { id: "gemini-flash-lite-latest", label: "Gemini Flash Lite — الموصى به (الأخفّ والأكثر توفّراً)" },
    { id: "gemini-flash-latest", label: "Gemini Flash — أقوى، ويتحوّل لـ Lite تلقائياً عند التعذّر" },
    { id: "gemini-pro-latest", label: "Gemini Pro — الأدقّ، ويتحوّل لـ Lite تلقائياً عند التعذّر" },
  ];
  // نموذج الاحتياط: الأخفّ حملاً والأقل ازدحاماً — إليه يُتحوَّل تلقائياً
  // حين يفشل النموذج المختار أو لا يولّد إجابة.
  var GEMINI_FALLBACK = "gemini-flash-lite-latest";
  var GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

  var DEFAULTS = {
    enabled: false,
    provider: "anthropic",          // anthropic | gemini
    mode: "direct",                 // direct | proxy (لمزوّد Anthropic)
    endpoint: DEFAULT_ENDPOINT,
    apiKey: "",
    model: "claude-opus-5",
    effort: "high",
    geminiKey: "",
    geminiModel: "gemini-flash-lite-latest",
    geminiBase: "",                 // فارغ = خدمة Google؛ يُوجَّه لبوّابة منشأة عند الحاجة
  };

  function loadCfg() {
    var c = {};
    try { c = JSON.parse(localStorage.getItem(CFG_KEY) || "{}"); } catch (e) { c = {}; }
    // إعدادات المنصّة (site-config.js) افتراضٌ مشترك لكل الزوّار،
    // وتفضيلات المستخدم المحفوظة محلياً تغلبها.
    var site = (root.SADEED_SITE_LLM && typeof root.SADEED_SITE_LLM === "object")
      ? root.SADEED_SITE_LLM : {};
    var out = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      out[k] = c[k] !== undefined ? c[k]
             : site[k] !== undefined ? site[k]
             : DEFAULTS[k];
    });
    return out;
  }

  function saveCfg(c) {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch (e) { /* محظور */ }
  }

  function clearCfg() {
    try { localStorage.removeItem(CFG_KEY); } catch (e) { /* محظور */ }
  }

  function ready(c) {
    c = c || loadCfg();
    if (!c.enabled) return false;
    if (c.provider === "gemini") return !!(c.geminiKey || c.geminiBase);
    return c.mode === "proxy" ? !!c.endpoint : !!c.apiKey;
  }

  function activeModel(c) {
    c = c || loadCfg();
    return c.provider === "gemini" ? c.geminiModel : c.model;
  }

  // ────────────────────────────────────────────────────────────────
  // 1. التعليمات — حدود صارمة على ما يجوز للنموذج قوله
  // ────────────────────────────────────────────────────────────────
  var SYSTEM = [
    "أنت «مساند نماء الذكي»، المساعد المرجعي في منصّة «ARCH Predict» لدى الجهة المستضيفة.",
    "مجالك: لوائح وأنظمة وسياسات مجلس الضمان الصحي",
    "السعودي (CHI)، وتطبيقها العملي على طلبات الموافقة المسبقة (Pre-Authorization).",
    "",
    "قواعد ملزِمة:",
    "١. لكل سؤال يمسّ حكماً نظامياً، ابحث أولاً بأداة search_regulations قبل",
    "   الإجابة، وكرّر البحث بصياغات مختلفة إن لم تجد. اذكر رقم المرجع [n] بعد",
    "   كل جملة مبنيّة على نصّ مسترجَع، بالأرقام التي تُعيدها الأداة — ولا تخترع",
    "   أرقاماً لم ترد.",
    "٢. لك أن تجيب من معرفتك العامة فيما يتجاوز الفهرس — شرحاً وسياقاً وممارساتٍ",
    "   ومقارنات، أو حين لا يغطي الفهرس الموضوع — بشرطين: أن تميّز ذلك صراحةً",
    "   بعبارة «من المعرفة العامة:» في أول الجزء، وألّا تنسب إلى لوائح CHI حكماً",
    "   لم تسترجعه. وما وجدته في الفهرس مقدَّم على معرفتك عند التعارض.",
    "٣. ميّز دائماً بين ثلاث طبقات: ما ورد في النصّ («النصّ يوجب…» [n])، وما",
    "   استنتجتَه منه («يترتّب على ذلك…»)، وما جاء من معرفتك («من المعرفة العامة:»).",
    "٤. المدد والنسب والمبالغ المأخوذة من النصّ تُنقل حرفياً بلا تقريب ولا تحويل",
    "   وحدات. وأي رقم من معرفتك العامة نبّه إلى وجوب التحقق منه من مصدر رسمي.",
    "٥. أجب بالعربية الفصحى، بإيجاز تشغيليّ: خلاصة أولاً، ثم التفصيل.",
    "٦. لستَ رأياً قانونياً. عند التعارض، النصّ الرسمي المنشور من المجلس هو المعتمد.",
    "",
    "أسلوب العمل مع المستخدم:",
    "• حين تُرفَق حالة من نموذج ARCH Predict، اقرأ أسباب عدم اكتمال الموافقة المتوقَّعة،",
    "  وابحث عن النصّ النظامي المنطبق على كل سبب، ثم اعرض خطة عملية مرتّبة",
    "  بالأولوية: ما ينبغي إرفاقه أو تصحيحه أو التحقّق منه قبل الإرسال — ولك أن",
    "  تُثريها بخبرة عامة في دورة الإيرادات مع تمييزها كما سبق.",
    "• اسأل سؤالاً واحداً محدّداً في كل مرّة حين ينقصك معطى يغيّر الإجابة",
    "  (تاريخ الخدمة، نوع الوثيقة، هل الحالة طارئة…). ولا تُغرق المستخدم بأسئلة.",
    "• حين يكون الجواب قائمة تحقّق، اكتبها قائمةً مرقّمة قابلة للتنفيذ مباشرةً.",
    "• لا تَعِد بنتيجة. النموذج يقدّر احتمالاً، والقرار النهائي لشركة التأمين.",
  ].join("\n");

  var TOOLS = [{
    name: "search_regulations",
    description:
      "يبحث في فهرس لوائح وأنظمة وسياسات مجلس الضمان الصحي (CHI) المحمَّلة محلياً " +
      "ويُعيد المقاطع الأوثق صلة، مرقّمةً، مع اسم المستند ورقم الصفحة. " +
      "استعمله قبل كل إجابة تتضمّن حكماً نظامياً، وكرّره بصياغات مختلفة إن لم تجد بغيتك. " +
      "اكتب الاستعلام بمصطلحات اللائحة (مثل «الموافقة المسبقة»، «الحالات الطارئة»، " +
      "«مبلغ التحمل»، «الحد الأدنى للبيانات») لا بلغة الحديث اليومي.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "عبارة البحث بالعربية بمصطلحات اللائحة" },
        limit: { type: "integer", description: "عدد المقاطع المطلوبة (١–٦، والافتراضي ٤)" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    strict: true,
  }];

  // ────────────────────────────────────────────────────────────────
  // 2. تنفيذ الأداة محلياً — لا شبكة، الفهرس في الصفحة
  // ────────────────────────────────────────────────────────────────
  /**
   * ينفّذ البحث ويُعيد نصّاً مرقّماً للنموذج. الترقيم تراكمي عبر الجلسة
   * (sources) كي يشير [3] إلى المقطع نفسه في كل مواضع الحوار.
   */
  function runSearch(ctx, input) {
    var q = String((input && input.query) || "").trim();
    if (!q) return "استعلام فارغ.";
    var limit = Math.max(1, Math.min(6, (input && input.limit) || 4));
    // عتبة صلة: تسليم مقاطع ضعيفة المطابقة للنموذج يدفعه إلى بناء حكم على
    // نصّ لا يخصّ السؤال. الصمت هنا أصدق من نتيجة شكلية.
    var hits = ctx.search(q, limit).filter(function (h) {
      return h.coverage >= 0.5 || h.score >= 8;
    });
    if (!hits.length) {
      return "لا توجد مقاطع مطابقة لـ«" + q + "» في الفهرس. " +
             "جرّب مصطلحاً نظامياً آخر؛ فإن لم تجد فأجب من معرفتك العامة " +
             "مع تمييز ذلك صراحةً بعبارة «من المعرفة العامة:».";
    }
    return hits.map(function (h) {
      var n = ctx.addSource(h);
      return "[" + n + "] " + h.doc.title + " — صفحة " + h.page +
             (h.heading ? "\n" + h.heading : "") + "\n" + h.text;
    }).join("\n\n");
  }

  // ────────────────────────────────────────────────────────────────
  // 3. نقل الرسائل — بثّ SSE مع حلقة استعمال الأداة
  // ────────────────────────────────────────────────────────────────
  function headers(cfg) {
    var h = { "content-type": "application/json" };
    if (cfg.mode === "direct") {
      h["x-api-key"] = cfg.apiKey;
      h["anthropic-version"] = API_VERSION;
      // إقرار صريح بأن الطلب من متصفّح؛ بدونه يمنعه CORS
      h["anthropic-dangerous-direct-browser-access"] = "true";
    }
    return h;
  }

  function body(cfg, messages, withFallbacks) {
    var b = {
      model: cfg.model,
      max_tokens: 8000,
      stream: true,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: TOOLS,
      messages: messages,
      output_config: { effort: cfg.effort || "high" },
      thinking: { type: "adaptive" },
    };
    // إعادة التشغيل على نموذج بديل إن رفض المصنّف الطلب — نطلبها افتراضياً
    if (withFallbacks) b.fallbacks = "default";
    return b;
  }

  function betaHeader(cfg, withFallbacks) {
    var h = headers(cfg);
    if (withFallbacks && cfg.mode === "direct") h["anthropic-beta"] = FALLBACK_BETA;
    return h;
  }

  // أعطال عابرة تستحق إعادة المحاولة: ازدحام (503/529) وحدود المعدل (429)
  // وأعطال الخادم (500/502). القصر على أخطاء مستوى HTTP مقصود: انقطاع البثّ
  // في منتصفه لو أُعيد لكرّر النصّ المعروض للمستخدم.
  var RETRYABLE = { 429: 1, 500: 1, 502: 1, 503: 1, 529: 1 };

  function wait(ms) {
    return new Promise(function (res) { setTimeout(res, ms); });
  }

  function withRetry(doTurn, cfg, hooks) {
    var base = cfg.retryBaseMs || 1500;
    function attempt(n) {
      return doTurn().catch(function (e) {
        if (!RETRYABLE[e.status] || n >= 3) throw e;
        hooks.onStatus && hooks.onStatus(
          "خدمة المزوّد مزدحمة — إعادة المحاولة (" + n + "/3)…");
        return wait(base * Math.pow(2, n - 1)).then(function () {
          return attempt(n + 1);
        });
      });
    }
    return attempt(1);
  }

  /** يقرأ بثّ SSE ويُنادي onEvent لكل حدث */
  function readStream(res, onEvent) {
    var reader = res.body.getReader();
    var dec = new TextDecoder();
    var buf = "";

    function feed(chunk) {
      chunk.split(/\r?\n/).forEach(function (line) {
        if (line.indexOf("data:") !== 0) return;
        var raw = line.slice(5).trim();
        if (!raw || raw === "[DONE]") return;
        try { onEvent(JSON.parse(raw)); } catch (e) { /* جزء غير مكتمل */ }
      });
    }

    function pump() {
      return reader.read().then(function (r) {
        if (r.done) {
          // الفاصل الأخير قد لا يصل — ما تبقى في المخزن حدثٌ مكتمل
          if (buf.trim()) feed(buf);
          return;
        }
        buf += dec.decode(r.value, { stream: true });
        // فاصل الأحداث سطران فارغان — بأي صيغة لنهاية السطر (LF أو CRLF)
        var parts = buf.split(/\r?\n\r?\n/);
        buf = parts.pop();
        parts.forEach(feed);
        return pump();
      });
    }
    return pump();
  }

  /**
   * دور واحد: يُرسل الرسائل ويُجمّع كتل الرد.
   * يُعيد {content, stopReason, stopDetails}.
   */
  function turn(cfg, messages, hooks, withFallbacks) {
    return fetch(cfg.endpoint || DEFAULT_ENDPOINT, {
      method: "POST",
      headers: betaHeader(cfg, withFallbacks),
      body: JSON.stringify(body(cfg, messages, withFallbacks)),
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          var err = new Error(t || ("HTTP " + res.status));
          err.status = res.status;
          err.bodyText = t;
          throw err;
        });
      }

      var blocks = [], stopReason = null, stopDetails = null;

      return readStream(res, function (ev) {
        if (ev.type === "content_block_start") {
          var cb = ev.content_block;
          blocks[ev.index] = cb.type === "tool_use"
            ? { type: "tool_use", id: cb.id, name: cb.name, _json: "", input: {} }
            : { type: cb.type, text: cb.text || "", thinking: cb.thinking || "" };

        } else if (ev.type === "content_block_delta") {
          var b = blocks[ev.index]; if (!b) return;
          var d = ev.delta;
          if (d.type === "text_delta") {
            b.text = (b.text || "") + d.text;
            hooks.onText && hooks.onText(d.text);
          } else if (d.type === "thinking_delta") {
            b.thinking = (b.thinking || "") + (d.thinking || "");
          } else if (d.type === "input_json_delta") {
            b._json += d.partial_json || "";
          } else if (d.type === "signature_delta") {
            b.signature = d.signature;
          }

        } else if (ev.type === "content_block_stop") {
          var bb = blocks[ev.index];
          if (bb && bb.type === "tool_use") {
            // المدخلات قد تصل بترميز مختلف؛ التحليل بـ JSON لا بمطابقة نصّية
            try { bb.input = JSON.parse(bb._json || "{}"); } catch (e) { bb.input = {}; }
            delete bb._json;
          }

        } else if (ev.type === "message_delta") {
          if (ev.delta) {
            if (ev.delta.stop_reason) stopReason = ev.delta.stop_reason;
            if (ev.delta.stop_details) stopDetails = ev.delta.stop_details;
          }

        } else if (ev.type === "error") {
          var e = new Error((ev.error && ev.error.message) || "خطأ في البثّ");
          throw e;
        }
      }).then(function () {
        return {
          content: blocks.filter(Boolean),
          stopReason: stopReason,
          stopDetails: stopDetails,
        };
      });
    });
  }


  // ────────────────────────────────────────────────────────────────
  // 4. مزوّد Gemini — النقل والترجمة وحلقة الأداة
  // ────────────────────────────────────────────────────────────────
  // القيود نفسها المفروضة على مزوّد Anthropic: أداة البحث المحليّة وحدها،
  // والتعليمات ذاتها. يختلف الشكل السلكي فقط: contents/parts بدل messages،
  // وfunctionCall/functionResponse بدل tool_use/tool_result.
  //
  // النموذج مفكّر ويوقّع أجزاءه (thoughtSignature)، لذا تُحفظ أجزاء أدواره
  // كما وردت (على _gemini في الرسالة القياسية) وتُعاد حرفياً في الطلب التالي.

  var GEMINI_TOOLS = [{
    functionDeclarations: [{
      name: TOOLS[0].name,
      description: TOOLS[0].description,
      parameters: {
        type: "OBJECT",
        properties: {
          query: { type: "STRING", description: "عبارة البحث بالعربية بمصطلحات اللائحة" },
          limit: { type: "INTEGER", description: "عدد المقاطع المطلوبة (١–٦، والافتراضي ٤)" },
        },
        required: ["query"],
      },
    }],
  }];

  /** يترجم التاريخ القياسي (شكل Anthropic) إلى contents لـ Gemini */
  function toGeminiContents(messages) {
    var idName = {};                                  // معرّف الاستدعاء ← اسم الأداة
    var out = [];
    messages.forEach(function (m) {
      if (m.role === "assistant") {
        if (m._gemini && m._gemini.parts) {           // دور من Gemini — يُعاد بتوقيعه
          (m.content || []).forEach(function (b) {
            if (b.type === "tool_use") idName[b.id] = b.name;
          });
          out.push({ role: "model", parts: m._gemini.parts });
          return;
        }
        var parts = [];
        (typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content)
          .forEach(function (b) {
            if (b.type === "text" && b.text) parts.push({ text: b.text });
            else if (b.type === "tool_use") {
              idName[b.id] = b.name;
              parts.push({ functionCall: { id: b.id, name: b.name, args: b.input || {} } });
            }
          });
        if (parts.length) out.push({ role: "model", parts: parts });
        return;
      }
      // رسائل المستخدم: نصّ أو نتائج أدوات
      var uparts = [];
      (typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content)
        .forEach(function (b) {
          if (b.type === "text" && b.text) uparts.push({ text: b.text });
          else if (b.type === "tool_result") {
            uparts.push({ functionResponse: {
              id: b.tool_use_id,
              name: idName[b.tool_use_id] || TOOLS[0].name,
              response: { result: String(b.content == null ? "" : b.content) },
            } });
          }
        });
      if (uparts.length) out.push({ role: "user", parts: uparts });
    });
    return out;
  }

  /** دور واحد مع Gemini عبر بثّ SSE — يُعيد {rawParts, calls, text, finishReason, blocked} */
  function geminiTurn(cfg, contents, hooks) {
    // geminiBase غير معروض في الواجهة: لتوجيه الطلبات عبر بوّابة منشأة
    // تحمل المفتاح، أو لاختبار المسار على محاكٍ محليّ.
    var url = (cfg.geminiBase || GEMINI_BASE) + encodeURIComponent(cfg.geminiModel) +
              ":streamGenerateContent?alt=sse";
    var gheaders = { "content-type": "application/json" };
    if (cfg.geminiKey) gheaders["x-goog-api-key"] = cfg.geminiKey;   // البوّابة تحقنه بنفسها
    return fetch(url, {
      method: "POST",
      headers: gheaders,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        tools: GEMINI_TOOLS,
        contents: contents,
        generationConfig: { maxOutputTokens: 8192 },
      }),
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          var err = new Error(t || ("HTTP " + res.status));
          err.status = res.status;
          err.bodyText = t;
          throw err;
        });
      }

      var rawParts = [], calls = [], text = "", textSig = null;
      var finishReason = null, blocked = false;

      return readStream(res, function (ev) {
        if (ev.promptFeedback && ev.promptFeedback.blockReason) blocked = true;
        var cand = ev.candidates && ev.candidates[0];
        if (!cand) return;
        if (cand.finishReason) finishReason = cand.finishReason;
        var parts = (cand.content && cand.content.parts) || [];
        parts.forEach(function (pt) {
          if (pt.functionCall) {
            calls.push(pt.functionCall);
            rawParts.push(pt);                        // بتوقيعه كما ورد
          } else if (typeof pt.text === "string") {
            text += pt.text;
            if (pt.thoughtSignature) textSig = pt.thoughtSignature;
            hooks.onText && hooks.onText(pt.text);
          }
        });
      }).then(function () {
        if (text) {
          var tp = { text: text };
          if (textSig) tp.thoughtSignature = textSig;
          rawParts.push(tp);
        }
        return { rawParts: rawParts, calls: calls, text: text,
                 finishReason: finishReason, blocked: blocked };
      });
    });
  }

  /**
   * غلاف الاحتياط: إن اختير نموذج غير Flash Lite ثم فشل (بعد إعادات
   * المحاولة) أو أنهى دورته بلا أي نصّ، يُعاد السؤال كاملاً على Flash Lite.
   * لا يُتحوَّل عند اعتذار النموذج (فذاك قرار لا عطل)، ولا إن كان قد بثّ
   * نصاً فعلاً (فالإعادة تكرّر المعروض أمام المستخدم).
   */
  function askGeminiWithFallback(cfg, history, ctx, hooks) {
    var streamed = 0;
    var innerHooks = {
      onText: function (t) { streamed += t.length; hooks.onText && hooks.onText(t); },
      onTool: hooks.onTool,
      onStatus: hooks.onStatus,
    };

    function liteCfg() {
      var c = {};
      Object.keys(cfg).forEach(function (k) { c[k] = cfg[k]; });
      c.geminiModel = GEMINI_FALLBACK;
      return c;
    }

    function fallback(reasonMsg, originalErr) {
      hooks.onStatus && hooks.onStatus(reasonMsg);
      return askGemini(liteCfg(), history, ctx, hooks).then(function (r2) {
        r2.modelUsed = GEMINI_FALLBACK;
        r2.fellBack = true;
        return r2;
      }).catch(function () {
        // فشل الاحتياط أيضاً: الخطأ الأصلي هو الأصدق للعرض
        if (originalErr) throw originalErr;
        return { messages: history, text: "",
                 refused: true, modelUsed: GEMINI_FALLBACK };
      });
    }

    return askGemini(cfg, history, ctx, innerHooks).then(function (res) {
      res.modelUsed = cfg.geminiModel;
      var empty = !res.refused && !(res.text && res.text.trim());
      if (empty && cfg.geminiModel !== GEMINI_FALLBACK && !streamed) {
        return fallback("النموذج المختار لم يولّد إجابة — التحويل إلى Flash Lite…", null);
      }
      return res;
    }).catch(function (e) {
      if (cfg.geminiModel === GEMINI_FALLBACK || streamed) throw e;
      return fallback("تعذّر نموذج «" + cfg.geminiModel + "» — التحويل إلى Flash Lite…", e);
    });
  }

  function askGemini(cfg, history, ctx, hooks) {
    var messages = history.slice();
    var rounds = 0, seq = 0;

    function step() {
      if (++rounds > 6) {
        return Promise.resolve({ messages: messages, text: "", truncated: true });
      }
      return withRetry(function () {
        return geminiTurn(cfg, toGeminiContents(messages), hooks);
      }, cfg, hooks).then(function (r) {
        if (r.blocked || r.finishReason === "SAFETY" || r.finishReason === "PROHIBITED_CONTENT") {
          return { messages: messages, refused: true,
                   text: "اعتذر النموذج عن معالجة هذا الطلب." };
        }

        // الدور بصيغته القياسية للواجهة، وأجزاؤه الخام لإعادتها موقَّعةً
        var blocks = [];
        if (r.text) blocks.push({ type: "text", text: r.text });
        r.calls.forEach(function (c) {
          if (!c.id) c.id = "call_local_" + (++seq);
          blocks.push({ type: "tool_use", id: c.id, name: c.name, input: c.args || {} });
        });
        messages.push({ role: "assistant", content: blocks, _gemini: { parts: r.rawParts } });

        if (!r.calls.length) {
          return { messages: messages, text: r.text };
        }

        var results = r.calls.map(function (c) {
          hooks.onTool && hooks.onTool(c.args && c.args.query);
          var out, isErr = false;
          try {
            out = c.name === TOOLS[0].name ? runSearch(ctx, c.args)
                                           : "أداة غير معروفة: " + c.name;
          } catch (e) { out = "تعذّر تنفيذ البحث: " + e.message; isErr = true; }
          return { type: "tool_result", tool_use_id: c.id, content: out, is_error: isErr };
        });
        messages.push({ role: "user", content: results });
        return step();
      });
    }

    return step();
  }

  /**
   * حلقة الحوار: تُكرّر الأدوار ما دام النموذج يطلب أداةً، وتنفّذها محلياً.
   * hooks: {onText, onTool, onStatus}
   */
  function askAnthropic(cfg, history, ctx, hooks) {
    hooks = hooks || {};
    var messages = history.slice();
    var useFallbacks = cfg.mode === "direct";
    var rounds = 0;

    function step() {
      if (++rounds > 6) {
        return Promise.resolve({ messages: messages, text: "", truncated: true });
      }
      return withRetry(function () {
        return turn(cfg, messages, hooks, useFallbacks);
      }, cfg, hooks).catch(function (e) {
        // بيئات لا تُفعِّل تجربة الاحتياط: نُعيد المحاولة مرّةً بدونها
        if (useFallbacks && e.status === 400 &&
            /fallback|beta/i.test(e.bodyText || "")) {
          useFallbacks = false;
          return withRetry(function () {
            return turn(cfg, messages, hooks, false);
          }, cfg, hooks);
        }
        throw e;
      }).then(function (r) {
        if (r.stopReason === "refusal") {
          var cat = (r.stopDetails && r.stopDetails.category) || "";
          return {
            messages: messages, refused: true,
            text: "اعتذر النموذج عن معالجة هذا الطلب" + (cat ? " (" + cat + ")" : "") + ".",
          };
        }

        messages.push({ role: "assistant", content: r.content });

        if (r.stopReason !== "tool_use") {
          var txt = r.content.filter(function (b) { return b.type === "text"; })
                             .map(function (b) { return b.text; }).join("");
          return { messages: messages, text: txt };
        }

        // كل نتائج الأدوات في رسالة مستخدم واحدة — تفريقها يُثبّط الاستدعاء المتوازي
        var results = r.content.filter(function (b) { return b.type === "tool_use"; })
          .map(function (b) {
            hooks.onTool && hooks.onTool(b.input && b.input.query);
            var out, isErr = false;
            try {
              out = b.name === "search_regulations" ? runSearch(ctx, b.input)
                                                    : "أداة غير معروفة: " + b.name;
            } catch (e) { out = "تعذّر تنفيذ البحث: " + e.message; isErr = true; }
            return { type: "tool_result", tool_use_id: b.id, content: out, is_error: isErr };
          });
        messages.push({ role: "user", content: results });
        return step();
      });
    }

    return step();
  }

  /** الموزّع: يختار المزوّد المفعَّل بالقيود نفسها */
  function ask(cfg, history, ctx, hooks) {
    hooks = hooks || {};
    if (cfg.provider === "gemini") return askGeminiWithFallback(cfg, history, ctx, hooks);
    return askAnthropic(cfg, history, ctx, hooks);
  }

  /** رسالة خطأ مفهومة بدل نصّ JSON خام */
  function explain(e, provider) {
    var t = e.bodyText || e.message || "";
    // صيغة أخطاء Google: {error:{code,status,message}}
    if (/API_KEY_INVALID|API key not valid/i.test(t)) {
      return "مفتاح Gemini غير صالح. راجعه في الإعدادات.";
    }
    if (/RESOURCE_EXHAUSTED/.test(t)) {
      return "تجاوزتَ حصّة Gemini المتاحة. انتظر قليلاً ثم أعد المحاولة.";
    }
    if (e.status === 401) return "المفتاح غير صالح أو منتهٍ. راجعه في الإعدادات.";
    if (e.status === 403) return "المفتاح لا يملك صلاحية على هذا النموذج.";
    if (e.status === 404) return "النموذج المحدَّد غير متاح لهذا الحساب.";
    if (e.status === 429) return "تجاوزتَ حدّ الطلبات (أُعيدت المحاولة تلقائياً دون جدوى). " +
      "انتظر دقيقةً ثم أعد المحاولة.";
    if (e.status === 503 || e.status === 529) {
      return "خدمة المزوّد مزدحمة حالياً — أُعيدت المحاولة ثلاث مرات دون جدوى. " +
        "انتظر دقيقةً وأعد المحاولة، أو بدّل النموذج أو المزوّد من ⚙ الإعدادات.";
    }
    if (e.status >= 500) return "عطل مؤقّت لدى المزوّد — أُعيدت المحاولة تلقائياً دون جدوى. " +
      "أعد المحاولة بعد لحظات.";
    if (!e.status && /Failed to fetch|NetworkError|CORS/i.test(t + e.message)) {
      return provider === "gemini"
        ? "تعذّر الوصول إلى خدمة Google. تحقّق من اتصالك وأن نطاق " +
          "generativelanguage.googleapis.com غير محجوب في شبكتك."
        : "تعذّر الوصول إلى الخدمة. إن كنت خلف شبكة تحجب api.anthropic.com، " +
          "فاستعمل وضع «بوّابة المنشأة» في الإعدادات.";
    }
    try {
      var j = JSON.parse(t);
      if (j.error && j.error.message) return j.error.message;
    } catch (x) { /* ليست JSON */ }
    return t.slice(0, 300) || "خطأ غير معروف.";
  }

  root.RCMLlm = {
    MODELS: MODELS, GEMINI_MODELS: GEMINI_MODELS,
    DEFAULTS: DEFAULTS, SYSTEM: SYSTEM, TOOLS: TOOLS,
    loadCfg: loadCfg, saveCfg: saveCfg, clearCfg: clearCfg,
    ready: ready, activeModel: activeModel,
    ask: ask, explain: explain, runSearch: runSearch,
    toGeminiContents: toGeminiContents,
  };
})(typeof window !== "undefined" ? window : globalThis);

if (typeof module !== "undefined" && module.exports) module.exports = globalThis.RCMLlm;
