/*!
 * rcm-chat-ui.js — واجهة «مساند نماء الذكي» المساعد المرجعي
 * ARCH Predict · ARCH Systems
 */
(function () {
  "use strict";

  var C = window.CHI_CORPUS, S = window.RCMChat, R = window.RCMReason;
  var LLM = window.RCMLlm;
  var $ = function (id) { return document.getElementById(id); };

  var SUGGESTIONS = [
    "كم مدة الرد على طلب الموافقة المسبقة؟",
    "ماذا يجب عمله في الحالات الطارئة؟",
    "ما نسبة التحمل التي يدفعها المستفيد؟",
    "هل تشمل التغطية الحمل والولادة؟",
    "ما مدة سداد مستحقات مقدم الخدمة؟",
    "ما التزامات مقدم الخدمة في الطب الاتصالي؟",
  ];

  var MOD_CLASS = {
    obligation: "ob", prohibition: "pr", exception: "ex",
    condition: "cn", permission: "pm", coverage: "cv", definition: "df",
  };

  var ANS = 0;                       // ترقيم الإجابات كي تبقى معرّفات المراجع فريدة
  var HISTORY = [];                  // حوار الطبقة التوليدية — يبقى في الذاكرة وحدها
  var SOURCES = [];                  // المقاطع المسترجَعة، مرقّمة تراكمياً عبر الجلسة
  var CASE = window.RCMCase, CASE_ON = false;

  function esc(s) { return S.escapeHtml(s); }

  // ────────────────────────────────────────────────────────────────
  // مؤشّر الثقة: مبنيّ على تغطية كلمات السؤال وفارق الصدارة عن التالي.
  // يُصارح المستخدم حين تكون المطابقة ضعيفة بدل أن يقدّم نتيجة واثقة زوراً.
  // ────────────────────────────────────────────────────────────────
  function confidence(res) {
    if (!res.length) return { k: "lo", t: "لا مطابقة" };
    var top = res[0];
    var gap = res.length > 1 ? top.score / Math.max(res[1].score, 0.01) : 2;
    if (top.coverage >= 0.75 && top.score > 9) return { k: "hi", t: "مطابقة قوية" };
    if (top.coverage >= 0.5 || gap > 1.6) return { k: "md", t: "مطابقة جزئية" };
    return { k: "lo", t: "مطابقة ضعيفة" };
  }

  function hitHtml(r, i, query, aid) {
    var img = S.pageImage(r);
    var art = r.heading && r.heading.length > 3
      ? '<span class="art">' + esc(r.heading) + "</span>" : "";
    return '<div class="hit" id="' + aid + "-src" + (i + 1) + '">' +
      '<div class="src"><span class="rank">' + (i + 1) + "</span>" +
        '<span class="meta"><span class="doct">' + esc(r.doc.title) + "</span>" +
        '<span class="pageno">صفحة ' + r.page + " من " + r.doc.pages +
          (r.doc.ocr_pages ? " · نصّ مقروء ضوئياً" : "") + "</span></span></div>" +
      art +
      '<div class="quote">' + S.highlight(r.text, query) + "</div>" +
      '<a class="shot" href="' + img + '" data-cap="' + esc(r.doc.title) + " — صفحة " + r.page + '">' +
        '<img loading="lazy" src="' + img + '" alt="صورة صفحة ' + r.page + '">' +
        '<span class="cap">📄 صورة المصدر — صفحة ' + r.page + " · اضغط للتكبير</span></a>" +
      "</div>";
  }

  /** شارات المعطيات الرقمية المستخلصة — أسرع ما يبحث عنه القارئ */
  function factsHtml(facts, aid) {
    if (!facts.length) return "";
    var ICON = { duration: "⏱", pct: "٪", money: "﷼" };
    return '<div class="facts">' + facts.slice(0, 6).map(function (f) {
      return '<span class="fact ' + f.kind + '">' + (ICON[f.kind] || "•") + " " +
        esc(f.display) +
        (f.ctx ? '<em>' + esc(f.ctx) + "</em>" : "") +
        '<i>[' + f.ref + "]</i></span>";
    }).join("") + "</div>";
  }

  function refChips(refs, aid) {
    if (!refs || !refs.length) return "";
    return refs.map(function (n) {
      return '<a class="refchip" href="#' + aid + "-src" + n + '">[' + n + "]</a>";
    }).join("");
  }

  /**
   * لوحة التحليل: صياغة مبسّطة واستنتاج، مفصولة بصرياً عن النصّ الرسمي
   * ومربوطة به برقم المرجع — فلا تختلط قراءةُ المحرّر بنصّ النظام.
   */
  function analysisHtml(a, aid) {
    var h = '<div class="analysis">' +
      '<div class="ahead"><span class="tag">🧠 قراءة مبسّطة واستنتاج</span>' +
      '<span class="intent">' + esc(a.intent.label) + "</span></div>";

    h += factsHtml(a.facts, aid);

    if (a.statements.length) {
      h += '<ul class="stmts">';
      a.statements.forEach(function (st) {
        h += '<li class="' + (MOD_CLASS[st.modality] || "nu") + '">' +
          (st.modalityLabel ? '<span class="mod">' + esc(st.modalityLabel) + "</span>" : "") +
          '<span class="stx">' + esc(st.text) + "</span>" +
          '<a class="refchip" href="#' + aid + "-src" + st.ref + '">[' + st.ref + "]</a></li>";
      });
      h += "</ul>";
    }

    if (a.inferences.length) {
      h += '<div class="infer"><div class="ititle">ما يُستنتج من مجموع النصوص</div><ul>';
      a.inferences.forEach(function (it) {
        var direct = it.text.indexOf("الجواب المباشر") === 0;
        h += '<li class="' + (direct ? "direct" : "") + '">' +
          esc(it.text) + " " + refChips(it.refs, aid) + "</li>";
      });
      h += "</ul></div>";
    }

    if (a.gaps.length) {
      h += '<div class="gaps">' + a.gaps.map(function (g) {
        return "<div>⚠ " + esc(g) + "</div>";
      }).join("") + "</div>";
    }

    if (a.followups && a.followups.length) {
      h += '<div class="fups"><span class="ft">أسئلة تُكمل الصورة:</span>' +
        a.followups.map(function (f) {
          return '<button class="fup" data-q="' + esc(f.q) + '">' + esc(f.label) + "</button>";
        }).join("") + "</div>";
    }

    h += '<div class="disc">الصياغة أعلاه من إعداد المساعد بناءً على النصوص المرقّمة أدناه، ' +
      "وهي للتقريب لا للاستشهاد. <b>النصّ الرسمي المنقول حرفياً هو المرجع عند أي تعارض.</b></div>";
    return h + "</div>";
  }

  function render(query) {
    var aid = "a" + (++ANS);
    var res = S.search(C, query, 6);
    var chat = $("chat");

    var q = document.createElement("div");
    q.className = "msg q";
    q.innerHTML = '<div class="bubble">' + esc(query) + "</div>";
    chat.appendChild(q);

    var a = document.createElement("div");
    a.className = "msg";

    // توسيع بالمرادفات حين يعجز اللفظ المستخدَم عن ملاقاة لفظ اللائحة
    if (!res.length || (res[0] && res[0].coverage < 0.5)) {
      var alt = R.expansions(query);
      for (var e = 0; e < alt.length && (!res.length || res[0].coverage < 0.5); e++) {
        var more = S.search(C, query + " " + alt[e], 5);
        if (more.length && (!res.length || more[0].score > res[0].score)) res = more;
      }
    }

    if (!res.length) {
      a.innerHTML = '<div class="ans"><div class="hit">' +
        '<div class="quote">لم أجد نصّاً مطابقاً في المراجع المفهرسة. ' +
        "جرّب صياغة أقرب لمصطلحات اللائحة — مثل «الموافقة المسبقة» أو «الحالات الطارئة» " +
        "أو «التحديدات والاستثناءات» — أو ابحث برقم المادة.</div></div></div>";
      chat.appendChild(a);
      scrollTo(a);
      return;
    }

    var conf = confidence(res);
    // عمق التحليل = عدد المراجع المعروضة، وإلا أشار [4] إلى نصّ غير معروض
    var DEPTH = 4;
    var analysis = R.analyze(query, res, { depth: DEPTH });
    var main = res.slice(0, DEPTH), rest = res.slice(DEPTH);

    var h = '<div class="ans">' +
      '<div class="lead"><span>عُثر على <b>' + res.length +
        "</b> مقطعاً في <b>" + new Set(res.map(function (r) { return r.doc.id; })).size +
        " مستنداً</b></span>" +
      '<span class="conf ' + conf.k + '">' + conf.t + "</span></div>";

    h += analysisHtml(analysis, aid);
    h += '<div class="srchead">النصّ الرسمي — منقول حرفياً من المصدر</div>';
    main.forEach(function (r, i) { h += hitHtml(r, i, query, aid); });

    if (rest.length) {
      h += '<details class="more"><summary>مراجع إضافية (' + rest.length + ")</summary><ol>";
      rest.forEach(function (r) {
        h += "<li><b>" + esc(r.doc.title) + "</b> — صفحة " + r.page +
          '<br><a href="' + S.pageImage(r) + '" class="shotlink" ' +
          'data-cap="' + esc(r.doc.title) + " — صفحة " + r.page + '">عرض صورة الصفحة</a>' +
          " · " + esc(r.text.slice(0, 130)) + "…</li>";
      });
      h += "</ol></details>";
    }
    h += "</div>";
    a.innerHTML = h;
    chat.appendChild(a);
    scrollTo(a);
  }


  // ════════════════════════════════════════════════════════════════
  // الطبقة التوليدية — حوار مع النموذج، مقيَّد بما يسترجعه من الفهرس
  // ════════════════════════════════════════════════════════════════

  /** سياق الأداة: البحث محليّ، والترقيم تراكميّ ليثبت [n] عبر الحوار كلّه */
  var TOOL_CTX = {
    search: function (q, n) { return S.search(C, q, n); },
    addSource: function (h) {
      for (var i = 0; i < SOURCES.length; i++) {
        if (SOURCES[i].pi === h.pi) return i + 1;
      }
      SOURCES.push(h);
      return SOURCES.length;
    },
  };

  /**
   * تنسيق ردّ النموذج: تهريب أوّلاً ثم إعادة بناء التوكيد والقوائم —
   * فلا يصل وسمٌ من النصّ إلى الصفحة.
   */
  function fmtAnswer(text) {
    var h = esc(text);
    h = h.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
    h = h.replace(/\[(\d{1,2})\]/g, function (m, n) {
      var i = +n;
      if (i < 1 || i > SOURCES.length) return m;      // رقم لا يقابل مرجعاً: يُترك نصّاً
      return '<a class="refchip" href="#llm-src' + i + '">[' + i + "]</a>";
    });
    return h.split(/\n{2,}/).map(function (para) {
      var lines = para.split("\n").filter(function (l) { return l.trim(); });
      var isList = lines.length > 1 && lines.every(function (l) {
        return /^\s*(?:[-•*]|[0-9\u0660-\u0669]{1,2}[.)\u061F-])\s+/.test(l);
      });
      if (isList) {
        return "<ul>" + lines.map(function (l) {
          return "<li>" + l.replace(/^\s*(?:[-•*]|[0-9\u0660-\u0669]{1,2}[.)])\s+/, "") + "</li>";
        }).join("") + "</ul>";
      }
      // ما صرّح النموذج بأنه من معرفته العامة يُميَّز عن المنقول من اللائحة
      var gk = /^\s*(?:<b>)?\s*(?:💡\s*)?من المعرفة العامة/.test(para);
      return "<p" + (gk ? ' class="gk"' : "") + ">" + lines.join("<br>") + "</p>";
    }).join("");
  }

  /** بطاقات المصادر التي استشهد بها النموذج فعلاً */
  function sourcesHtml(from) {
    if (SOURCES.length <= from) return "";
    var h = '<div class="srchead">المراجع المسترجَعة — النصّ الرسمي</div>';
    for (var i = from; i < SOURCES.length; i++) {
      var r = SOURCES[i], n = i + 1, img = S.pageImage(r);
      h += '<div class="hit" id="llm-src' + n + '">' +
        '<div class="src"><span class="rank">' + n + "</span>" +
        '<span class="meta"><span class="doct">' + esc(r.doc.title) + "</span>" +
        '<span class="pageno">صفحة ' + r.page + " من " + r.doc.pages + "</span></span></div>" +
        (r.heading && r.heading.length > 3 ? '<span class="art">' + esc(r.heading) + "</span>" : "") +
        '<div class="quote">' + esc(r.text) + "</div>" +
        '<a class="shot" href="' + img + '" data-cap="' + esc(r.doc.title) + " — صفحة " + r.page + '">' +
        '<img loading="lazy" src="' + img + '" alt="صورة صفحة ' + r.page + '">' +
        '<span class="cap">📄 صورة المصدر — صفحة ' + r.page + " · اضغط للتكبير</span></a></div>";
    }
    return h;
  }

  function askLlm(query) {
    var cfg = LLM.loadCfg();
    var chat = $("chat");
    var srcFrom = SOURCES.length;

    var a = document.createElement("div");
    a.className = "msg";
    a.innerHTML = '<div class="ans"><div class="llmhead">' +
      '<span class="tag">✨ إجابة مولَّدة — ما نُقل من اللائحة مرقوم بمرجعه</span>' +
      '<span class="intent">' + esc(LLM.activeModel(cfg)) + '</span></div>' +
      '<div class="llmbody"><div class="typing"><i></i><i></i><i></i></div></div>' +
      '<div class="llmsrc"></div></div>';
    chat.appendChild(a);
    scrollTo(a);

    var bodyEl = a.querySelector(".llmbody");
    var srcEl = a.querySelector(".llmsrc");
    var acc = "", started = false;
    setBusy(true);

    var content = [{ type: "text", text: query }];
    if (CASE_ON && CASE) {
      var c = CASE.load();
      if (c) {
        content = [{ type: "text", text:
          "حالة من نموذج ARCH Predict:\n" + CASE.summarize(c) + "\n\nسؤال المستخدم: " + query }];
      }
    }
    HISTORY.push({ role: "user", content: content });

    LLM.ask(cfg, HISTORY, TOOL_CTX, {
      onText: function (t) {
        if (!started) { bodyEl.innerHTML = ""; started = true; }
        acc += t;
        bodyEl.textContent = acc;                    // بثّ خام أثناء الكتابة
        scrollTo(a);
      },
      onTool: function (q) {
        if (started) return;
        bodyEl.innerHTML = '<div class="searching">🔎 يبحث في اللوائح: ' +
          esc(q || "") + "</div>";
      },
      onStatus: function (msg) {
        if (started) return;
        bodyEl.innerHTML = '<div class="searching">⏳ ' + esc(msg) + "</div>";
      },
    }).then(function (res) {
      HISTORY = res.messages;
      if (res.modelUsed) {
        var badge = a.querySelector(".llmhead .intent");
        if (badge) badge.textContent = res.modelUsed + (res.fellBack ? " · احتياط" : "");
      }
      if (res.refused || (!acc && !res.text)) {
        bodyEl.innerHTML = '<p class="warnline">' +
          esc(res.text || "لم يصل ردّ. أعد المحاولة.") + "</p>";
      } else {
        bodyEl.innerHTML = fmtAnswer(res.text || acc);
      }
      srcEl.innerHTML = sourcesHtml(srcFrom);
      setBusy(false);
      scrollTo(a);
    }).catch(function (e) {
      bodyEl.innerHTML = '<p class="warnline">تعذّر توليد الإجابة: ' +
        esc(LLM.explain(e, cfg.provider)) + "</p>" +
        '<p class="disc">النتائج المرجعية من الفهرس المحلّي ما زالت تعمل — ' +
        "أطفئ الطبقة التوليدية من ⚙ الإعدادات للعودة إليها.</p>";
      setBusy(false);
      // الدور الفاشل لا يبقى في التاريخ فيُفسد ما بعده
      HISTORY.pop();
    });
  }

  function setBusy(on) {
    var b = $("send"), q = $("q");
    if (b) { b.disabled = on; b.textContent = on ? "…" : (LLM.ready() ? "اسأل" : "بحث"); }
    if (q) q.disabled = on;
  }

  // ════════════════════════════════════════════════════════════════
  // بطاقة الحالة القادمة من منصّة ARCH Predict
  // ════════════════════════════════════════════════════════════════
  function caseHtml(c) {
    var p = c.payload, claims = CASE.isClaims && CASE.isClaims(p);
    var risk = CASE.riskOf ? CASE.riskOf(p) : p.probabilities.notFullyApproved;
    var band = risk >= 0.65 ? "hi" : risk >= 0.45 ? "md" : "lo";
    var h = '<div class="casecard"><div class="chead">' +
      '<span class="tag">🔗 ' + (claims ? "مطالبة من ARCH Predict للمطالبات" : "حالة من منصّة ARCH Predict") + "</span>" +
      '<span class="conf ' + (band === "hi" ? "lo" : band === "md" ? "md" : "hi") + '">' +
      (claims ? "خطر عدم السداد الكامل " : "خطر عدم اكتمال الموافقة ") +
      (risk * 100).toFixed(1) + "٪</span></div>";
    if (p.topReasons && p.topReasons.length) {
      h += '<ul class="creasons">';
      p.topReasons.forEach(function (r) {
        h += "<li><b>" + esc(r.label) + "</b> <span class=\"rp\">" +
             (r.probability * 100).toFixed(0) + "٪</span><br><span class=\"ract\">" +
             esc(r.action) + "</span></li>";
      });
      h += "</ul>";
    }
    h += '<div class="cbtns">' +
      '<button id="caseAsk">🛠 كيف أحسّن هذا الطلب؟</button>' +
      '<button id="caseToggle" class="' + (CASE_ON ? "on" : "") + '">' +
      (CASE_ON ? "✓ الحالة مرفقة بالمحادثة" : "إرفاق الحالة بالمحادثة") + "</button>" +
      '<button id="caseDrop" class="ghost">إزالة</button></div>';
    return h + "</div>";
  }

  var CASE_PARAM_READ = false;

  function initCase() {
    var host = $("caseBox");
    if (!host || !CASE) return;
    var c = CASE.load();
    if (!c) { host.style.display = "none"; return; }
    // القدوم من زرّ «اسأل مساند نماء الذكي» يُرفق الحالة تلقائياً — قبل أوّل رسم لا بعده
    if (!CASE_PARAM_READ) {
      CASE_PARAM_READ = true;
      if (new URLSearchParams(location.search).get("case")) CASE_ON = true;
    }
    host.style.display = "";
    host.innerHTML = caseHtml(c);
    $("caseToggle").onclick = function () { CASE_ON = !CASE_ON; initCase(); };
    $("caseDrop").onclick = function () { CASE.clear(); CASE_ON = false; initCase(); };
    $("caseAsk").onclick = function () {
      CASE_ON = true; initCase();
      var empty = $("chat").querySelector(".empty");
      if (empty) empty.remove();
      var claims = CASE.isClaims && CASE.isClaims(c.payload);
      ask(claims
        ? "بناءً على هذه المطالبة، ما الذي ينبغي إرفاقه أو تصحيحه أو التحقّق منه " +
          "قبل تقديمها حتى ترتفع فرصة سدادها كاملة؟"
        : "بناءً على هذه الحالة، ما الذي ينبغي إرفاقه أو تصحيحه أو التحقّق منه " +
          "قبل إرسال الطلب حتى ترتفع فرصة الموافقة الكاملة؟");
    };
  }

  /** خطة تحسين الطلب بلا نموذج لغوي — استرجاع وتصنيف محليّان */
  function renderCasePlan() {
    var c = CASE && CASE.load();
    if (!c) return false;
    var chat = $("chat"), aid = "a" + (++ANS);
    var claims = CASE.isClaims && CASE.isClaims(c.payload);
    var items = CASE.plan(c, C, S, R);
    var q = document.createElement("div");
    q.className = "msg q";
    q.innerHTML = '<div class="bubble">' +
      (claims ? "خطة تحسين المطالبة — قبل تقديمها" : "خطة تحسين الطلب — لهذه الحالة") + "</div>";
    chat.appendChild(q);

    var a = document.createElement("div");
    a.className = "msg";
    var h = '<div class="ans"><div class="lead"><span>لكل ' +
      (claims ? "رمز رفض متوقَّع" : "سبب متوقَّع") + ": ما يوجبه النظام، " +
      "وسؤال تحقّق قبل " + (claims ? "التقديم" : "الإرسال") + "</span></div>";
    var n = 0;
    items.forEach(function (it) {
      h += '<div class="planitem"><div class="ptitle"><span class="pn">' +
        (++n) + '</span>' + esc(it.label) +
        '<span class="pp">' + (it.probability * 100).toFixed(0) + "٪</span></div>" +
        '<div class="pcheck">❓ ' + esc(it.check) + "</div>" +
        '<div class="paction">🛠 ' + esc(it.action) + "</div>";
      if (it.analysis && it.analysis.statements.length) {
        h += '<ul class="stmts">';
        it.analysis.statements.slice(0, 2).forEach(function (st) {
          h += '<li class="' + (MOD_CLASS[st.modality] || "nu") + '">' +
            (st.modalityLabel ? '<span class="mod">' + esc(st.modalityLabel) + "</span>" : "") +
            '<span class="stx">' + esc(st.text) + "</span>" +
            '<a class="refchip" href="#' + aid + "-p" + n + "-s" + st.ref + '">[' + st.ref + "]</a></li>";
        });
        h += "</ul>";
      }
      it.hits.forEach(function (r, i) {
        h += '<div class="psrc" id="' + aid + "-p" + n + "-s" + (i + 1) + '">' +
          '<span class="rank">' + (i + 1) + "</span> " + esc(r.doc.title) + " — صفحة " + r.page +
          ' · <a class="shotlink" href="' + S.pageImage(r) + '" data-cap="' +
          esc(r.doc.title) + " — صفحة " + r.page + '">صورة الصفحة</a>' +
          '<div class="quote">' + esc(r.text.slice(0, 340)) + (r.text.length > 340 ? "…" : "") +
          "</div></div>";
      });
      h += "</div>";
    });
    h += '<div class="disc">الخطة مبنيّة على أسباب النموذج المتوقَّعة والنصوص المسترجَعة لكلٍّ منها. ' +
      "<b>النصّ الرسمي هو المرجع عند أي تعارض.</b></div></div>";
    a.innerHTML = h;
    chat.appendChild(a);
    scrollTo(a);
    return true;
  }

  // ════════════════════════════════════════════════════════════════
  // إعدادات الطبقة التوليدية
  // ════════════════════════════════════════════════════════════════
  function initSettings() {
    var cfg = LLM.loadCfg();
    var box = $("llmBox");

    function paint() {
      $("llmEnabled").checked = cfg.enabled;
      $("llmProvider").value = cfg.provider;
      $("llmMode").value = cfg.mode;
      $("llmKey").value = cfg.apiKey;
      $("llmEndpoint").value = cfg.endpoint;
      $("llmModel").value = cfg.model;
      $("llmEffort").value = cfg.effort;
      $("llmGeminiKey").value = cfg.geminiKey;
      $("llmGeminiModel").value = cfg.geminiModel;

      var gem = cfg.provider === "gemini";
      $("rowMode").style.display = gem ? "none" : "";
      $("rowKey").style.display = !gem && cfg.mode === "direct" ? "" : "none";
      $("rowEndpoint").style.display = !gem && cfg.mode === "proxy" ? "" : "none";
      $("rowModel").style.display = gem ? "none" : "";
      $("rowEffort").style.display = gem ? "none" : "";
      $("rowGeminiKey").style.display = gem ? "" : "none";
      $("rowGeminiModel").style.display = gem ? "" : "none";

      $("llmState").textContent = !cfg.enabled ? "مُطفأة — الإجابات من الفهرس المحلّي"
        : LLM.ready(cfg) ? "مفعّلة — " + LLM.activeModel(cfg) : "مفعّلة لكن الإعداد ناقص";
      $("llmState").className = "llmstate " + (!cfg.enabled ? "off"
        : LLM.ready(cfg) ? "on" : "warn");
      setBusy(false);
    }

    $("llmModel").innerHTML = LLM.MODELS.map(function (m) {
      return '<option value="' + m.id + '">' + esc(m.label) + "</option>";
    }).join("");
    $("llmGeminiModel").innerHTML = LLM.GEMINI_MODELS.map(function (m) {
      return '<option value="' + m.id + '">' + esc(m.label) + "</option>";
    }).join("");

    function bind(id, key) {
      $(id).onchange = function () {
        cfg[key] = $(id).type === "checkbox" ? $(id).checked : $(id).value;
        LLM.saveCfg(cfg); paint();
      };
    }
    ["llmEnabled|enabled", "llmProvider|provider", "llmMode|mode", "llmKey|apiKey",
     "llmEndpoint|endpoint", "llmModel|model", "llmEffort|effort",
     "llmGeminiKey|geminiKey", "llmGeminiModel|geminiModel"]
      .forEach(function (pair) { var p = pair.split("|"); bind(p[0], p[1]); });

    $("llmForget").onclick = function () {
      LLM.clearCfg(); cfg = LLM.loadCfg(); paint();
    };
    $("llmGear").onclick = function () {
      box.style.display = box.style.display === "none" ? "" : "none";
    };
    paint();
    box.style.display = "none";
  }

  function scrollTo(el) {
    setTimeout(function () {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 40);
  }

  // ── معاينة صورة الصفحة ──
  function initLightbox() {
    var lb = $("lb"), img = lb.querySelector("img"), cap = lb.querySelector(".lbcap");
    document.addEventListener("click", function (e) {
      var a = e.target.closest(".shot, .shotlink");
      if (a) {
        e.preventDefault();
        img.src = a.getAttribute("href");
        cap.textContent = a.getAttribute("data-cap") || "";
        lb.classList.add("on");
        return;
      }
      if (e.target.closest("#lb")) lb.classList.remove("on");
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") lb.classList.remove("on");
    });
  }

  function initRefs() {
    $("refsSub").textContent =
      C.docs.length + " مستنداً · " +
      C.docs.reduce(function (a, d) { return a + d.pages; }, 0) + " صفحة · " +
      C.N + " مقطعاً مفهرساً · حُدِّث في " + C.generated_at;
    $("refsList").innerHTML = C.docs.map(function (d) {
      return "<li>" + esc(d.title) +
        '<span class="n">' + d.pages + " صفحة" +
        (d.ocr_pages ? " · " + d.ocr_pages + " مقروءة ضوئياً" : "") + "</span></li>";
    }).join("");
  }

  // ── جمل ترحيبية يفتتح بها المساعد المحادثة — تُختار عشوائياً في كل زيارة ──
  var GREETINGS = [
    "أهلاً بك في «مساند نماء الذكي» 👋 أنا مرجعك للوائح مجلس الضمان الصحي: " +
      "اسألني عن أي مادة أو مدة أو نسبة، وأجيبك بالنصّ الرسمي ورقم صفحته وصورتها.",
    "حيّاك الله! أنا «مساند نماء الذكي» — أقرأ لوائح الضمان الصحي، وأستخرج لك " +
      "المدد والنسب، وأستنتج ما يترتّب عليها. جرّب سؤالاً من المقترحات أدناه أو اكتب سؤالك.",
    "مرحباً بك 🌱 هنا «مساند نماء الذكي». سل عن الموافقات المسبقة أو المطالبات أو " +
      "التغطية والاستثناءات — كل جملة أقولها مسنودة إلى نصّها الرسمي.",
    "أهلاً وسهلاً! معك «مساند نماء الذكي» — نستبق القرار لنقود النمو: اسألني قبل " +
      "أن تُرسل طلبك، أوفّر عليك استئنافاً بعد الرفض.",
  ];
  var GREETINGS_CASE = [
    "أهلاً بك 👋 وصلتني حالتك من ARCH Predict — اضغط «كيف أحسّن هذا الطلب؟» في " +
      "البطاقة أعلاه لأبني لك خطة تحسين مبنية على اللوائح، أو اسألني عن أي شيء فيها.",
    "حيّاك الله! قرأتُ نتيجة تنبّؤك من ARCH Predict، وجاهز أحوّل كل سبب متوقَّع " +
      "إلى بند عمل بنصّه النظامي — ابدأ من زرّ «كيف أحسّن هذا الطلب؟» أعلاه.",
  ];

  function greeting() {
    var hasCase = !!(CASE && CASE.load());
    var pool = hasCase ? GREETINGS_CASE : GREETINGS;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function initEmpty() {
    $("chat").innerHTML =
      '<div class="msg"><div class="greet">' + esc(greeting()) + "</div></div>" +
      '<div class="empty">اطرح سؤالك عن اللوائح والأنظمة — يقرأ المساعد النصوص المنطبقة،' +
      " يصوغ خلاصتها، ويستنتج منها، ثم يعرض النصّ الرسمي وصورة صفحته للتحقّق." +
      '<div class="sugg">' + SUGGESTIONS.map(function (s) {
        return "<button>" + esc(s) + "</button>";
      }).join("") + "</div></div>";
    $("chat").querySelectorAll(".sugg button").forEach(function (b) {
      b.onclick = function () { ask(b.textContent); };
    });
  }

  function ask(text) {
    text = (text || $("q").value || "").trim();
    if (!text) return;
    var empty = $("chat").querySelector(".empty");
    if (empty) empty.remove();
    $("q").value = "";

    if (LLM && LLM.ready()) {
      var chat = $("chat");
      var q = document.createElement("div");
      q.className = "msg q";
      q.innerHTML = '<div class="bubble">' + esc(text) +
        (CASE_ON ? '<span class="qcase">مع الحالة</span>' : "") + "</div>";
      chat.appendChild(q);
      askLlm(text);
      return;
    }

    // بلا طبقة توليدية: استرجاع + صياغة واستنتاج محليّان
    render(text);
    if (CASE_ON) renderCasePlan();
  }

  function boot() {
    if (!C || !C.passages || !C.passages.length) {
      $("boot").innerHTML = '<div class="note warn"><b>تعذّر تحميل المراجع.</b><br><br>' +
        "الملف المطلوب: <code>chatbot/data/corpus.js</code><br>لتوليده:<br>" +
        "<code>python3 chatbot/build_corpus.py --src &lt;مجلد ملفات PDF&gt;</code></div>";
      return;
    }
    initRefs();
    initEmpty();
    initLightbox();
    if (LLM) initSettings();
    initCase();
    $("send").onclick = function () { ask(); };
    $("chat").addEventListener("click", function (e) {
      var b = e.target.closest(".fup");
      if (b) ask(b.getAttribute("data-q"));
    });
    $("q").addEventListener("keydown", function (e) {
      if (e.key === "Enter") ask();
    });
    $("boot").style.display = "none";
    $("app").style.display = "block";
    setBusy(false);

    var pre = new URLSearchParams(location.search).get("q");
    if (pre) { $("q").value = pre; ask(pre); }
    window.RCMCHAT = {
      search: function (q) { return S.search(C, q, 8); },
      corpus: C,
      reset: function () { HISTORY = []; SOURCES = []; },
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
