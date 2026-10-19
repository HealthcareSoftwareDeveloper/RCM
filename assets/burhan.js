/*!
 * burhan.js — محرّك «برهان نماء»: بحث مُسنَد يقوده Claude ويغذّيه Parallel
 * منصّة نماء · تجمع مكة المكرمة الصحي · إدارة أداء تنمية الإيرادات
 *
 * كيف تُبنى الإجابة:
 *   ١. يتلقّى Claude السؤال ومعه أداتان: parallel_search وparallel_extract.
 *   ٢. يخطّط ويبحث (قد يكرّر البحث بزوايا مختلفة، ويقرأ صفحة بعينها كاملة).
 *   ٣. تُنفَّذ الأداتان عبر Parallel، وتُرقَّم المصادر ترقيماً تراكمياً [n].
 *   ٤. يكتب Claude الإجابة، وكل جملة مبنيّة على مصدر تحمل رقمه.
 *
 * وضعان للاتصال:
 *   • البوّابة (الموصى به) — المفتاحان في أسرار خادم البوّابة، ولا مفتاح في
 *     المتصفّح. رابطها في assets/site-config.js أو من ⚙ الإعدادات.
 *   • مباشر — بمفتاحَي المستخدم المحفوظين في متصفّحه وحده.
 *
 * الملف بلا DOM؛ تستعمله burhan.html وتختبره tests/verify_burhan.mjs.
 */
(function (root) {
  "use strict";

  var CFG_KEY = "namaa.burhan.v1";
  var ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
  var PARALLEL_URL = "https://api.parallel.ai";
  var API_VERSION = "2023-06-01";

  var MODELS = [
    { id: "claude-opus-5-5", label: "Claude Opus 5.5 — الأعمق تحليلاً" },
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 — متوازن وأسرع" },
    { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 — الأسرع والأقلّ كلفة" },
  ];

  /** عمق البحث: يحدّد عدد الجولات ونمط Parallel وحجم المقاطع */
  var DEPTHS = {
    quick: { label: "سريع", rounds: 4, mode: "fast", maxResults: 6, maxChars: 14000, effort: "medium" },
    deep: { label: "معمّق", rounds: 10, mode: "advanced", maxResults: 8, maxChars: 24000, effort: "high" },
  };

  var DEFAULTS = {
    mode: "gateway",          // gateway | direct
    gateway: "",
    token: "",
    anthropicKey: "",
    parallelKey: "",
    model: "claude-opus-5-5",
    depth: "deep",
  };

  // ────────────────────────────────────────────────────────────────
  // الإعدادات: إعداد المنصّة افتراضٌ مشترك، وتفضيل المستخدم يغلبه
  // ────────────────────────────────────────────────────────────────
  function store() {
    try { return root.localStorage || null; } catch (e) { return null; }
  }

  function loadCfg() {
    var c = {};
    var s = store();
    try { c = JSON.parse((s && s.getItem(CFG_KEY)) || "{}") || {}; } catch (e) { c = {}; }
    var site = (root.NAMAA_BURHAN && typeof root.NAMAA_BURHAN === "object") ? root.NAMAA_BURHAN : {};
    var out = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      var v = c[k] !== undefined && c[k] !== "" ? c[k]
            : site[k] !== undefined && site[k] !== "" ? site[k]
            : DEFAULTS[k];
      out[k] = v;
    });
    if (!DEPTHS[out.depth]) out.depth = DEFAULTS.depth;
    return out;
  }

  function saveCfg(c) {
    var s = store();
    try { s && s.setItem(CFG_KEY, JSON.stringify(c)); } catch (e) { /* محظور */ }
  }

  function clearCfg() {
    var s = store();
    try { s && s.removeItem(CFG_KEY); } catch (e) { /* محظور */ }
  }

  function gatewayBase(cfg) {
    return String(cfg.gateway || "").trim().replace(/\/+$/, "");
  }

  function ready(cfg) {
    cfg = cfg || loadCfg();
    return cfg.mode === "direct"
      ? !!(cfg.anthropicKey && cfg.parallelKey)
      : !!gatewayBase(cfg);
  }

  // ────────────────────────────────────────────────────────────────
  // التعليمات
  // ────────────────────────────────────────────────────────────────
  function systemPrompt(today) {
    return [
      "أنت «برهان نماء»، محرّك البحث والإجابة في منصّة نماء — تجمع مكة المكرمة الصحي،",
      "إدارة أداء تنمية الإيرادات. تجيب عن أي سؤال، ومجال خبرتك الأعمق: دورة الإيرادات",
      "الصحية (RCM)، والتأمين الصحي في المملكة العربية السعودية، ولوائح مجلس الضمان الصحي (CHI)،",
      "ومنصّة نفيس (NPHIES)، والترميز الطبي، والتمويل والتقنية المالية الصحية.",
      "",
      "تاريخ اليوم: " + today + ". ما تعرفه من تدريبك قد يكون قديماً؛ الويب الحيّ هو المرجع.",
      "",
      "قواعد ملزِمة:",
      "١. ابحث قبل أن تجيب. لكل سؤال يتضمّن معلومة واقعية استعمل parallel_search أولاً،",
      "   وكرّر البحث بزوايا وصياغات مختلفة (عربية وإنجليزية) حتى تغطّي كل جزء من السؤال.",
      "   وإن احتجت نصّ صفحة بعينها كاملاً (لائحة، تعميم، جدول) فاقرأها بـ parallel_extract.",
      "٢. أسنِد كل جملة مبنيّة على مصدر برقمه بين معقوفين مثل [3]، بالأرقام التي تُعيدها",
      "   الأدوات حرفياً. لا تخترع رقماً ولا مصدراً، ولا تنسب لمصدر ما لم يرد فيه.",
      "٣. ما تضيفه من معرفتك دون مصدر ميّزه صراحةً بعبارة «من المعرفة العامة:».",
      "٤. قدّم المصادر الرسمية والأولية (الجهات الحكومية، المجالس، الناشرين الأصليين) على",
      "   المجمّعات والمنتديات. وفي الشأن السعودي: chi.gov.sa وnphies.sa وmoh.gov.sa وspa.gov.sa",
      "   وغيرها من النطاقات الحكومية مقدَّمة. اذكر تاريخ المعلومة حين يكون للحداثة أثر.",
      "٥. إن تعارضت المصادر فاعرض التعارض بأمانة ومن قال ماذا، ولا تختر بصمت.",
      "٦. إن لم تجد جواباً موثوقاً فقل ذلك صراحة، واذكر ما وجدته وما ينقص.",
      "٧. الأرقام والنسب والمدد والمبالغ تُنقل كما وردت بلا تقريب.",
      "٨. أعِد الصياغة بلغتك؛ لا تنسخ فقرات من المصادر، والاقتباس الحرفي قصير ونادر.",
      "",
      "شكل الإجابة:",
      "• أجب بلغة السؤال (العربية الفصحى افتراضياً).",
      "• ابدأ بالخلاصة في سطر أو سطرين، ثم التفصيل بعناوين ## قصيرة وقوائم حين تفيد.",
      "• لا تكتب قائمة المصادر في آخر الإجابة — الواجهة تعرضها تلقائياً من أرقامك.",
      "• لست رأياً قانونياً أو مالياً؛ نبّه إلى ذلك حين يكون السؤال من هذا النوع.",
    ].join("\n");
  }

  var TOOLS = [
    {
      name: "parallel_search",
      description:
        "يبحث في الويب الحيّ عبر Parallel ويُعيد أوثق النتائج صلةً مع مقاطع نصية كثيفة من كل صفحة، " +
        "مرقّمةً [n] للإسناد. استعمله قبل كل إجابة تتضمّن معلومة واقعية، وأرسل استدعاءات متعدّدة " +
        "متوازية حين يتشعّب السؤال إلى أجزاء مستقلة.",
      input_schema: {
        type: "object",
        properties: {
          objective: {
            type: "string",
            description: "وصف طبيعي كامل لما تبحث عنه وسببه، مع أي تفضيل للمصادر أو الحداثة.",
          },
          search_queries: {
            type: "array",
            items: { type: "string" },
            description: "من ١ إلى ٣ استعلامات كلمات مفتاحية قصيرة (٣–٦ كلمات)، متنوّعة الزوايا واللغة.",
          },
        },
        required: ["objective", "search_queries"],
        additionalProperties: false,
      },
    },
    {
      name: "parallel_extract",
      description:
        "يقرأ صفحة أو أكثر (حتى ٣ روابط) عبر Parallel ويُعيد المقاطع المتعلّقة بالهدف، مرقّمةً للإسناد. " +
        "استعمله حين لا تكفي مقاطع البحث: نصّ لائحة كاملة، جدول، تعميم، أو تفصيل دقيق.",
      input_schema: {
        type: "object",
        properties: {
          urls: { type: "array", items: { type: "string" }, description: "روابط الصفحات (١–٣)." },
          objective: { type: "string", description: "ما الذي تريد استخراجه من هذه الصفحات." },
        },
        required: ["urls", "objective"],
        additionalProperties: false,
      },
    },
  ];

  // ────────────────────────────────────────────────────────────────
  // سجلّ المصادر — ترقيم تراكمي عبر المحادثة، وإزالة التكرار بالرابط
  // ────────────────────────────────────────────────────────────────
  function normUrl(u) {
    return String(u || "").trim().replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();
  }

  function hostOf(u) {
    try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; }
  }

  function isOfficial(host) {
    return /(^|\.)gov\.sa$|(^|\.)nphies\.sa$|(^|\.)edu\.sa$|(^|\.)gov$|(^|\.)who\.int$|(^|\.)gov\.[a-z]{2}$/i.test(host || "");
  }

  function Sources() {
    this.items = [];
    this.byUrl = {};
  }
  Sources.prototype.add = function (r) {
    var key = normUrl(r.url);
    if (!key) return null;
    var s = this.byUrl[key];
    if (!s) {
      var host = hostOf(r.url);
      s = { n: this.items.length + 1, url: r.url, title: r.title || host || r.url,
            date: r.publish_date || null, host: host, official: isOfficial(host), excerpts: [] };
      this.items.push(s);
      this.byUrl[key] = s;
    } else {
      if (!s.date && r.publish_date) s.date = r.publish_date;
      if ((!s.title || s.title === s.host) && r.title) s.title = r.title;
    }
    (r.excerpts || []).forEach(function (x) {
      if (x && s.excerpts.indexOf(x) < 0 && s.excerpts.length < 6) s.excerpts.push(x);
    });
    return s;
  };
  Sources.prototype.get = function (n) { return this.items[n - 1] || null; };

  // ────────────────────────────────────────────────────────────────
  // النقل
  // ────────────────────────────────────────────────────────────────
  function HttpError(status, text) {
    var e = new Error(text || ("HTTP " + status));
    e.status = status;
    e.bodyText = text || "";
    return e;
  }

  function gatewayHeaders(cfg) {
    var h = { "content-type": "application/json" };
    if (cfg.token) h["x-namaa-token"] = cfg.token;
    return h;
  }

  function claudeRequest(cfg) {
    if (cfg.mode === "direct") {
      return {
        url: ANTHROPIC_URL,
        headers: {
          "content-type": "application/json",
          "x-api-key": cfg.anthropicKey,
          "anthropic-version": API_VERSION,
          // إقرار صريح بأن الطلب من متصفّح؛ بدونه يمنعه CORS
          "anthropic-dangerous-direct-browser-access": "true",
        },
      };
    }
    return { url: gatewayBase(cfg) + "/v1/messages", headers: gatewayHeaders(cfg) };
  }

  function parallelRequest(cfg, path) {
    if (cfg.mode === "direct") {
      return { url: PARALLEL_URL + path,
               headers: { "content-type": "application/json", "x-api-key": cfg.parallelKey } };
    }
    return { url: gatewayBase(cfg) + path, headers: gatewayHeaders(cfg) };
  }

  function postJson(req, payload, fetchImpl) {
    return fetchImpl(req.url, {
      method: "POST", headers: req.headers, body: JSON.stringify(payload),
    }).then(function (res) {
      return res.text().then(function (t) {
        if (!res.ok) throw HttpError(res.status, t);
        try { return JSON.parse(t); } catch (e) { throw HttpError(502, "ردّ غير مفهوم من الخدمة"); }
      });
    }, function (e) {
      var err = new Error(e && e.message || "Failed to fetch");
      err.network = true;
      throw err;
    });
  }

  var RETRYABLE = { 429: 1, 500: 1, 502: 1, 503: 1, 529: 1 };
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function withRetry(fn, hooks, baseMs) {
    function attempt(n) {
      return fn().catch(function (e) {
        if (!RETRYABLE[e.status] || n >= 3) throw e;
        hooks.onStatus && hooks.onStatus("الخدمة مزدحمة — إعادة المحاولة (" + n + "/3)…");
        return wait((baseMs || 1500) * Math.pow(2, n - 1)).then(function () { return attempt(n + 1); });
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
        var ev;
        try { ev = JSON.parse(raw); } catch (e) { return; }
        onEvent(ev);
      });
    }
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) { if (buf.trim()) feed(buf); return; }
        buf += dec.decode(r.value, { stream: true });
        var parts = buf.split(/\r?\n\r?\n/);
        buf = parts.pop();
        parts.forEach(feed);
        return pump();
      });
    }
    return pump();
  }

  function requestBody(cfg, messages, today) {
    var d = DEPTHS[cfg.depth] || DEPTHS.deep;
    var b = {
      model: cfg.model,
      max_tokens: 12000,
      stream: true,
      system: [{ type: "text", text: systemPrompt(today), cache_control: { type: "ephemeral" } }],
      tools: TOOLS,
      messages: messages,
      thinking: { type: "adaptive" },
    };
    if (!/haiku/.test(cfg.model)) b.output_config = { effort: d.effort };
    return b;
  }

  /** كتلة نظيفة صالحة لإعادة الإرسال في التاريخ */
  function cleanBlock(b) {
    if (b.type === "text") return { type: "text", text: b.text || "" };
    if (b.type === "thinking") return { type: "thinking", thinking: b.thinking || "", signature: b.signature || "" };
    if (b.type === "redacted_thinking") return { type: "redacted_thinking", data: b.data };
    if (b.type === "tool_use") return { type: "tool_use", id: b.id, name: b.name, input: b.input || {} };
    return null;
  }

  /** دور واحد مع Claude ببثّ SSE. يُعيد {content, stopReason, stopDetails} */
  function claudeTurn(cfg, messages, hooks, fetchImpl, today) {
    var req = claudeRequest(cfg);
    return fetchImpl(req.url, {
      method: "POST", headers: req.headers, body: JSON.stringify(requestBody(cfg, messages, today)),
    }).then(function (res) {
      if (!res.ok) return res.text().then(function (t) { throw HttpError(res.status, t); });

      var blocks = [], stopReason = null, stopDetails = null, streamErr = null;
      return readStream(res, function (ev) {
        if (ev.type === "content_block_start") {
          var cb = ev.content_block || {};
          if (cb.type === "tool_use") {
            blocks[ev.index] = { type: "tool_use", id: cb.id, name: cb.name, _json: "", input: {} };
          } else if (cb.type === "redacted_thinking") {
            blocks[ev.index] = { type: "redacted_thinking", data: cb.data };
          } else {
            blocks[ev.index] = { type: cb.type, text: cb.text || "", thinking: cb.thinking || "" };
            if (cb.type === "thinking") hooks.onThinking && hooks.onThinking();
          }
        } else if (ev.type === "content_block_delta") {
          var b = blocks[ev.index]; if (!b) return;
          var d = ev.delta || {};
          if (d.type === "text_delta") { b.text += d.text; hooks.onText && hooks.onText(d.text); }
          else if (d.type === "thinking_delta") b.thinking += d.thinking || "";
          else if (d.type === "signature_delta") b.signature = d.signature;
          else if (d.type === "input_json_delta") b._json += d.partial_json || "";
        } else if (ev.type === "content_block_stop") {
          var bb = blocks[ev.index];
          if (bb && bb.type === "tool_use") {
            try { bb.input = JSON.parse(bb._json || "{}"); } catch (e) { bb.input = {}; }
            delete bb._json;
          }
        } else if (ev.type === "message_delta" && ev.delta) {
          if (ev.delta.stop_reason) stopReason = ev.delta.stop_reason;
          if (ev.delta.stop_details) stopDetails = ev.delta.stop_details;
        } else if (ev.type === "error") {
          streamErr = new Error((ev.error && ev.error.message) || "انقطع البثّ");
          streamErr.status = ev.error && ev.error.type === "overloaded_error" ? 529 : 0;
        }
      }).then(function () {
        if (streamErr) throw streamErr;
        return {
          content: blocks.filter(Boolean).map(cleanBlock).filter(Boolean),
          stopReason: stopReason, stopDetails: stopDetails,
        };
      });
    });
  }

  // ────────────────────────────────────────────────────────────────
  // الأداتان — تنفيذهما عبر Parallel وتحويل النتائج إلى نصّ مرقّم
  // ────────────────────────────────────────────────────────────────
  function formatResults(results, sources, maxExcerptChars) {
    var lines = [];
    (results || []).forEach(function (r) {
      var s = sources.add(r);
      if (!s) return;
      var ex = (r.excerpts || []).join("\n…\n");
      if (maxExcerptChars && ex.length > maxExcerptChars) ex = ex.slice(0, maxExcerptChars) + " …";
      lines.push("[" + s.n + "] " + (s.title || s.host) + "\nالرابط: " + s.url +
        (s.date ? "\nتاريخ النشر: " + s.date : "") + "\n" + (ex || "(لا مقاطع)"));
    });
    return lines.join("\n\n---\n\n");
  }

  function runSearch(cfg, input, sources, fetchImpl, sessionId, hooks) {
    var d = DEPTHS[cfg.depth] || DEPTHS.deep;
    var queries = (input.search_queries || []).map(String).filter(Boolean).slice(0, 3);
    var objective = String(input.objective || "").trim();
    if (!queries.length && objective) queries = [objective.slice(0, 80)];
    if (!queries.length) return Promise.resolve({ text: "استعلام فارغ.", isError: true });
    var payload = {
      objective: objective || queries.join(" — "),
      search_queries: queries,
      mode: d.mode,
      max_chars_total: d.maxChars,
      advanced_settings: { max_results: d.maxResults },
      session_id: sessionId,
      client_model: cfg.model,
    };
    return withRetry(function () {
      return postJson(parallelRequest(cfg, "/v1/search"), payload, fetchImpl);
    }, hooks, cfg.retryBaseMs).then(function (r) {
      var res = r.results || [];
      if (!res.length) {
        return { text: "لا نتائج لهذا البحث. جرّب صياغة أو لغة أخرى.", count: 0 };
      }
      return { text: formatResults(res, sources, 4000), count: res.length };
    });
  }

  function runExtract(cfg, input, sources, fetchImpl, sessionId, hooks) {
    var urls = (input.urls || []).map(String).filter(function (u) { return /^https?:\/\//i.test(u); }).slice(0, 3);
    if (!urls.length) return Promise.resolve({ text: "لا روابط صالحة.", isError: true });
    var payload = { urls: urls, objective: String(input.objective || ""), session_id: sessionId,
                    client_model: cfg.model };
    return withRetry(function () {
      return postJson(parallelRequest(cfg, "/v1/extract"), payload, fetchImpl);
    }, hooks, cfg.retryBaseMs).then(function (r) {
      var res = (r.results || []).map(function (x) {
        if ((!x.excerpts || !x.excerpts.length) && x.full_content) {
          x = Object.assign({}, x, { excerpts: [String(x.full_content).slice(0, 12000)] });
        }
        return x;
      });
      var errs = (r.errors || []).map(function (e) {
        return (e.url || "") + ": " + (e.error_type || e.content || "تعذّرت القراءة");
      });
      var text = res.length ? formatResults(res, sources, 9000) : "";
      if (errs.length) text += (text ? "\n\n" : "") + "تعذّرت قراءة: " + errs.join("؛ ");
      return { text: text || "لم يُستخرج شيء من الروابط.", count: res.length, isError: !res.length };
    });
  }

  // ────────────────────────────────────────────────────────────────
  // جلسة بحث: تحفظ التاريخ والمصادر عبر أسئلة متتابعة
  // ────────────────────────────────────────────────────────────────
  function randomId() {
    var s = "";
    for (var i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
    return "burhan_" + s;
  }

  function Session(opts) {
    opts = opts || {};
    this.history = [];
    this.sources = new Sources();
    this.sessionId = randomId();
    this.fetch = opts.fetch || (root.fetch ? root.fetch.bind(root) : null);
    this.today = opts.today || new Date().toISOString().slice(0, 10);
  }

  /**
   * يطرح سؤالاً ويُدير حلقة الأدوات.
   * hooks: onText(delta) · onTurnStart() · onTurnDiscard(text) · onThinking()
   *        onTool({kind, label, queries|urls}) · onToolDone({kind, count, error})
   *        onStatus(msg)
   * يُعيد {text, cited:[n], refused, truncated}
   */
  Session.prototype.ask = function (question, cfg, hooks) {
    var self = this;
    hooks = hooks || {};
    cfg = cfg || loadCfg();
    var depth = DEPTHS[cfg.depth] || DEPTHS.deep;
    var messages = this.history.concat([{ role: "user", content: question }]);
    var rounds = 0;

    function finish(text, extra) {
      self.history = messages;
      var cited = citedNumbers(text).filter(function (n) { return !!self.sources.get(n); });
      return Object.assign({ text: text, cited: cited }, extra || {});
    }

    function step() {
      rounds++;
      var lastRound = rounds > depth.rounds;
      if (lastRound) {
        // بلغ سقف الجولات: نطلب الإجابة بما جُمع دون مزيد من البحث
        messages.push({ role: "user", content: [{ type: "text",
          text: "بلغتَ حدّ جولات البحث. اكتب الإجابة الآن بما جمعته من مصادر، مع الإسناد، وبيّن ما بقي غير مؤكَّد." }] });
      }
      hooks.onTurnStart && hooks.onTurnStart();
      return withRetry(function () {
        return claudeTurn(cfg, messages, hooks, self.fetch, self.today);
      }, hooks, cfg.retryBaseMs).then(function (r) {
        if (r.stopReason === "refusal") {
          return finish("اعتذر النموذج عن معالجة هذا الطلب.", { refused: true });
        }
        messages.push({ role: "assistant", content: r.content });
        var text = r.content.filter(function (b) { return b.type === "text"; })
                            .map(function (b) { return b.text; }).join("");
        var uses = r.content.filter(function (b) { return b.type === "tool_use"; });

        if (r.stopReason !== "tool_use" || !uses.length || lastRound) {
          if (lastRound && uses.length) {
            // أداة طُلبت بعد السقف: نغلقها بنتيجة فارغة حفاظاً على صحة التاريخ
            messages.push({ role: "user", content: uses.map(function (b) {
              return { type: "tool_result", tool_use_id: b.id, content: "تجاوز حدّ الجولات.", is_error: true };
            }) });
          }
          return finish(text, { truncated: r.stopReason === "max_tokens" });
        }

        if (text.trim()) hooks.onTurnDiscard && hooks.onTurnDiscard(text);

        // الأدوات المتعدّدة تُنفَّذ بالتوازي، ونتائجها في رسالة مستخدم واحدة
        return Promise.all(uses.map(function (b) {
          var isSearch = b.name === "parallel_search";
          var info = isSearch
            ? { kind: "search", label: b.input.objective || "", queries: b.input.search_queries || [] }
            : { kind: "extract", label: b.input.objective || "", urls: b.input.urls || [] };
          hooks.onTool && hooks.onTool(info);
          var p = isSearch
            ? runSearch(cfg, b.input || {}, self.sources, self.fetch, self.sessionId, hooks)
            : b.name === "parallel_extract"
              ? runExtract(cfg, b.input || {}, self.sources, self.fetch, self.sessionId, hooks)
              : Promise.resolve({ text: "أداة غير معروفة: " + b.name, isError: true });
          return p.catch(function (e) {
            return { text: "تعذّر تنفيذ الأداة: " + explain(e, "parallel"), isError: true, fatal: e };
          }).then(function (out) {
            hooks.onToolDone && hooks.onToolDone({ kind: info.kind, count: out.count || 0, error: !!out.isError });
            return { block: { type: "tool_result", tool_use_id: b.id, content: out.text, is_error: !!out.isError },
                     fatal: out.fatal };
          });
        })).then(function (outs) {
          messages.push({ role: "user", content: outs.map(function (o) { return o.block; }) });
          // عطل اتصال أو مفتاح لدى Parallel في كل الأدوات: لا فائدة من الاستمرار
          var fatal = outs.filter(function (o) { return o.fatal; });
          if (fatal.length === outs.length && isConfigError(fatal[0].fatal)) {
            throw Object.assign(fatal[0].fatal, { provider: "parallel" });
          }
          return step();
        });
      });
    }

    return step();
  };

  Session.prototype.reset = function () {
    this.history = [];
    this.sources = new Sources();
    this.sessionId = randomId();
  };

  function isConfigError(e) {
    return !!(e && (e.network || e.status === 401 || e.status === 403));
  }

  /** أرقام الإسناد الواردة في نصّ: [3] و[1, 4] و[2][5] */
  function citedNumbers(text) {
    var seen = {}, out = [];
    String(text || "").replace(/\[(\d{1,3}(?:\s*[,،]\s*\d{1,3})*)\]/g, function (m, g) {
      g.split(/[,،]/).forEach(function (x) {
        var n = parseInt(x, 10);
        if (n && !seen[n]) { seen[n] = 1; out.push(n); }
      });
      return m;
    });
    return out;
  }

  /** رسالة خطأ مفهومة بدل نصّ JSON خام */
  function explain(e, provider) {
    var t = (e && (e.bodyText || e.message)) || "";
    var who = provider === "parallel" ? "Parallel" : "Claude";
    if (e && e.network) {
      return "تعذّر الوصول إلى خدمة " + who + " من المتصفّح. " +
        (provider === "parallel"
          ? "خدمة Parallel قد لا تقبل الطلبات المباشرة من المتصفّحات — استعمل وضع «البوّابة» (gateway/README.md)."
          : "تحقّق من اتصالك، أو من رابط البوّابة في ⚙ الإعدادات.");
    }
    if (e && e.status === 401) {
      return /رمز دخول/.test(t) ? "رمز دخول الفريق غير صحيح. راجعه في ⚙ الإعدادات."
        : "مفتاح " + who + " غير صالح أو منتهٍ.";
    }
    if (e && e.status === 403) {
      if (/المصدر غير مسموح/.test(t)) return "البوّابة لا تقبل الطلبات من هذا الموقع (ALLOWED_ORIGINS).";
      if (/النموذج غير مسموح/.test(t)) return "النموذج المختار غير مسموح في البوّابة — اختر غيره.";
      return "لا صلاحية لهذا الطلب لدى " + who + ".";
    }
    if (e && e.status === 404) return "المسار أو النموذج غير متاح — راجع رابط البوّابة والنموذج.";
    if (e && e.status === 429) return "تجاوزتَ حدّ الطلبات لدى " + who + ". انتظر دقيقة ثم أعد المحاولة.";
    if (e && (e.status === 503 || e.status === 529)) return "خدمة " + who + " مزدحمة حالياً — أعد المحاولة بعد قليل.";
    if (e && e.status >= 500) {
      var j0 = null; try { j0 = JSON.parse(t); } catch (x) { /* */ }
      if (j0 && j0.error && /غير مضبوط/.test(j0.error.message || "")) return j0.error.message;
      return "عطل مؤقّت لدى " + who + ". أعد المحاولة بعد لحظات.";
    }
    try {
      var j = JSON.parse(t);
      if (j.error && j.error.message) return j.error.message;
    } catch (x) { /* ليست JSON */ }
    return String(t).slice(0, 300) || "خطأ غير معروف.";
  }

  /** فحص البوّابة: هل المفتاحان مضبوطان؟ */
  function checkGateway(cfg, fetchImpl) {
    fetchImpl = fetchImpl || root.fetch.bind(root);
    var h = {};
    if (cfg.token) h["x-namaa-token"] = cfg.token;
    return fetchImpl(gatewayBase(cfg) + "/health", { headers: h }).then(function (res) {
      return res.text().then(function (t) {
        if (!res.ok) throw HttpError(res.status, t);
        return JSON.parse(t);
      });
    });
  }

  root.NamaaBurhan = {
    MODELS: MODELS, DEPTHS: DEPTHS, DEFAULTS: DEFAULTS, TOOLS: TOOLS,
    systemPrompt: systemPrompt,
    loadCfg: loadCfg, saveCfg: saveCfg, clearCfg: clearCfg, ready: ready,
    Session: Session, Sources: Sources,
    citedNumbers: citedNumbers, explain: explain, checkGateway: checkGateway,
    isOfficial: isOfficial, hostOf: hostOf,
  };
})(typeof window !== "undefined" ? window : globalThis);

if (typeof module !== "undefined" && module.exports) module.exports = globalThis.NamaaBurhan;
