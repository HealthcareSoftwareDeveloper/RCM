/*!
 * rcm-claims-app.js — واجهة صفحة التنبؤ بسداد المطالبات (مرحلة Claims)
 * ARCH Predict · ARCH Systems
 *
 * تكملة منصّة الموافقات إلى المرحلة اللاحقة لتقديم الخدمة: هل ستُسدَّد
 * المطالبة كاملةً؟ وما رمز الرفض NPHIES المرجَّح إن لم تُسدَّد؟
 * تقرأ حزمة نموذج المطالبات (window.RCM_CLAIMS_BUNDLE) وتشغّل نفس محرّك
 * rcm-engine.js عبر ترميز خصائص خاص بالمطالبات.
 */
(function () {
  "use strict";

  var B = window.RCM_CLAIMS_BUNDLE, E = window.RCMEngine;
  var LAST = null, LAST_INPUT = null, ACTIVE_CLASS = 1;
  var $ = function (id) { return document.getElementById(id); };

  var _cssCache = {};
  function C(name, fallback) {
    if (_cssCache[name] === undefined) {
      var v = getComputedStyle(document.documentElement).getPropertyValue("--" + name);
      _cssCache[name] = (v || "").trim() || fallback;
    }
    return _cssCache[name];
  }

  // فئتان: 0 = سداد كامل، 1 = سداد غير كامل
  function COLORS_() { return [C("green", "#0B7A5E"), C("red", "#C4362F")]; }
  var CLS_KEY = ["approved", "rejected"];
  var CLS_ICON = ["✅", "⚠️"];
  var NFP = 1;

  var DD = ["visit_type", "hospital", "insurance", "tpa", "nationality",
            "id_type", "physician", "icd_chapter", "icd_block",
            "has_approval", "submit_attempt"];

  var URLKEYS = {
    amount: "in_amount", visitDate: "in_visitDate", submitDate: "in_submitDate",
    icd: "in_icdCode",
    visitType: "visit_type", hospital: "hospital", insurance: "insurance",
    tpa: "tpa", nationality: "nationality", idType: "id_type",
    physician: "physician", icdChapter: "icd_chapter", icdBlock: "icd_block",
    hasApproval: "has_approval", attempt: "submit_attempt",
  };

  function fmt(n, d) { d = d == null ? 0 : d;
    return (isFinite(n) ? n : 0).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function pct(x, d) { return fmt(x * 100, d == null ? 1 : d) + "%"; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g,
    function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // ══════════════════════════════════════════════════════════════
  // 1. القوائم المنسدلة
  // ══════════════════════════════════════════════════════════════
  var STATE = {};

  function optionsFor(col) {
    if (col === "has_approval") {
      return [{ v: "1", l: "نعم — يوجد رقم موافقة مسبقة", n: 0, r: -1 },
              { v: "0", l: "لا — بلا موافقة مسبقة", n: 0, r: -1 }];
    }
    if (col === "submit_attempt") {
      return ["1", "2", "3", "4", "5"].map(function (v) {
        return { v: v, l: v === "1" ? "الأولى" : "إعادة تقديم رقم " + v, n: 0, r: -1 };
      });
    }
    return (B.options[col] || []).map(function (o) {
      var l = o.l;
      // الربط المحلي الخاص: اسم الطبيب يظهر بجانب رمزه على هذا الجهاز فقط
      if (col === "physician" && o.v !== "OTHER" && window.RCMDocMap) {
        var nm = RCMDocMap.nameFor(o.v);
        if (nm) l = o.l + " — " + nm;
      }
      return { v: o.v, l: l, n: o.n, r: o.r };
    });
  }

  function rrClass(r) { return r < 55 ? "rr-lo" : r < 80 ? "rr-md" : "rr-hi"; }

  function buildDropdown(col) {
    var host = document.querySelector('[data-dd="' + col + '"]');
    if (!host) return;
    var opts = optionsFor(col);
    var wrap = document.createElement("div");
    wrap.className = "search-wrap";
    wrap.innerHTML =
      '<input class="search-input" id="disp_' + col + '" readonly placeholder="اختر…">' +
      '<span class="search-arrow">▼</span>' +
      '<div class="dropdown-panel" id="dd_' + col + '">' +
        '<div class="dropdown-search"><input type="text" placeholder="بحث…"></div>' +
        '<div class="dropdown-list" id="dl_' + col + '"></div></div>';
    host.appendChild(wrap);

    var list = wrap.querySelector("#dl_" + col);
    opts.forEach(function (o) {
      var d = document.createElement("div");
      d.className = "dropdown-item";
      d.dataset.val = o.v;
      d.dataset.txt = (o.l + " " + o.v).toLowerCase();
      var badge = o.r >= 0
        ? '<span class="rr ' + rrClass(o.r) + '" title="نسبة عدم السداد الكامل تاريخياً · ' + fmt(o.n) + ' مطالبة">'
          + fmt(o.r, 0) + "%</span>" : "";
      d.innerHTML = '<span class="nm">' + esc(o.l) + "</span>" + badge;
      d.onclick = function () { select(col, o.v, o.l); };
      list.appendChild(d);
    });

    wrap.querySelector(".search-input").onclick = function (e) { e.stopPropagation(); toggle(col); };
    wrap.querySelector(".dropdown-search input").oninput = function () {
      var q = this.value.toLowerCase();
      list.querySelectorAll(".dropdown-item").forEach(function (it) {
        it.classList.toggle("hidden", it.dataset.txt.indexOf(q) < 0);
      });
    };
  }

  function toggle(col) {
    var p = $("dd_" + col), open = p.classList.contains("open");
    closeAll();
    if (!open) { p.classList.add("open"); p.querySelector("input").focus(); }
  }
  function closeAll() {
    document.querySelectorAll(".dropdown-panel").forEach(function (p) { p.classList.remove("open"); });
  }
  function select(col, val, label) {
    STATE[col] = val;
    var disp = $("disp_" + col);
    if (disp) disp.value = label != null ? label : val;
    var list = $("dl_" + col);
    if (list) list.querySelectorAll(".dropdown-item").forEach(function (it) {
      it.classList.toggle("selected", it.dataset.val === val);
    });
    closeAll();
  }
  function selectByValue(col, val) {
    if (val == null || val === "") return;
    var o = optionsFor(col).filter(function (x) { return x.v === val; })[0];
    if (o) select(col, o.v, o.l);
  }
  document.addEventListener("click", function (e) {
    if (!e.target.closest(".search-wrap")) closeAll();
  });

  // ══════════════════════════════════════════════════════════════
  // 2. قراءة المدخلات وترميزها — خصائص المطالبات
  // ══════════════════════════════════════════════════════════════
  function readInput() {
    return {
      amount: $("in_amount").value,
      visitDate: $("in_visitDate").value,
      submitDate: $("in_submitDate").value,
      visitType: STATE.visit_type, hospital: STATE.hospital,
      insurance: STATE.insurance, tpa: STATE.tpa,
      nationality: STATE.nationality, idType: STATE.id_type,
      physician: STATE.physician,
      icdChapter: STATE.icd_chapter, icdBlock: STATE.icd_block,
      hasApproval: STATE.has_approval, attempt: STATE.submit_attempt,
    };
  }

  function catIndex(col, value) {
    var opts = B.options[col] || [], i;
    for (i = 0; i < opts.length; i++) if (opts[i].v === value) return opts[i].i;
    for (i = 0; i < opts.length; i++) if (opts[i].v === "OTHER") return opts[i].i;
    for (i = 0; i < opts.length; i++) if (opts[i].v === "unknown" || opts[i].v === "UNK") return opts[i].i;
    return -1;
  }

  function normKey(name) {
    return (name == null ? "" : String(name)).trim().toLowerCase().replace(/\s+/g, " ");
  }

  function entityLookup(key, name) {
    var e = B.entity_snapshot[key];
    if (!e) return [0, 0, 0];
    return e.table[normKey(name)] || e.default;
  }

  /** يبني متجه الخصائص بنفس ترتيب تدريب نموذج المطالبات. */
  function claimsEncode(input) {
    var idx = {}, i;
    for (i = 0; i < B.features.length; i++) idx[B.features[i]] = i;
    var x = new Float64Array(B.features.length);
    for (i = 0; i < x.length; i++) x[i] = NaN;
    function setNum(name, v) {
      if (idx[name] !== undefined) x[idx[name]] = (v === null || v === undefined || v === "") ? NaN : +v;
    }
    function setCat(name, v) { if (idx[name] !== undefined) x[idx[name]] = catIndex(name, v); }

    var amount = (input.amount === "" || input.amount == null) ? NaN
      : Math.max(0, Math.min(1000000, +input.amount));
    setNum("amount", amount);
    setNum("log_amount", Math.log1p(isNaN(amount) ? 0 : amount));

    var vd = input.visitDate ? new Date(input.visitDate) : new Date();
    if (isNaN(vd.getTime())) vd = new Date();
    var sd = input.submitDate ? new Date(input.submitDate) : new Date();
    if (isNaN(sd.getTime())) sd = new Date();
    setNum("visit_dow", (vd.getDay() + 6) % 7);          // الاثنين=0 مثل pandas
    setNum("visit_month", vd.getMonth() + 1);
    setNum("submit_month", sd.getMonth() + 1);
    setNum("submit_lag", Math.max(0, Math.round((sd - vd) / 86400000)));

    setNum("submit_attempt", Math.max(1, Math.min(5, +(input.attempt || 1))));
    setNum("has_approval", input.hasApproval === "1" ? 1 : 0);

    setCat("visit_type", input.visitType);
    setCat("hospital", input.hospital);
    setCat("insurance", input.insurance);
    setCat("tpa", input.tpa);
    setCat("nationality", input.nationality);
    setCat("id_type", input.idType);
    setCat("physician", input.physician);
    setCat("icd_chapter", input.icdChapter);
    setCat("icd_block", input.icdBlock);

    // سجل الجهات التاريخي من جدول اللقطة
    var pairs = [["ins", input.insurance], ["hosp", input.hospital], ["doc", input.physician]];
    for (i = 0; i < pairs.length; i++) {
      var v = entityLookup(pairs[i][0], pairs[i][1]);
      setNum(pairs[i][0] + "_hist_nfp", v[0]);
      setNum(pairs[i][0] + "_hist_ok", v[1]);
      setNum(pairs[i][0] + "_vol", v[2]);
    }
    return x;
  }

  function syncIcd() {
    var v = ($("in_icdCode").value || "").trim().toUpperCase().replace(/\s/g, "");
    var mCh = v.match(/^([A-Z])/), mBl = v.match(/^([A-Z][0-9]{2})/);
    if (mCh) selectByValue("icd_chapter", mCh[1]);
    if (mBl) selectByValue("icd_block", mBl[1]);
  }

  // ══════════════════════════════════════════════════════════════
  // 3. الرسوم البيانية (SVG خالص) — نفس رسوم صفحة الموافقات
  // ══════════════════════════════════════════════════════════════
  var SV = "http://www.w3.org/2000/svg";
  function el(tag, attrs, text) {
    var n = document.createElementNS(SV, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }
  function svgRoot(w, h) {
    var s = el("svg", { viewBox: "0 0 " + w + " " + h, width: "100%",
      height: h, preserveAspectRatio: "xMidYMin meet" });
    s.style.fontFamily = "inherit";
    s.style.direction = "ltr";
    return s;
  }

  function drawWaterfall(host, groups, base, margin, clsIdx) {
    host.innerHTML = "";
    var TOP = 9;
    var g = groups.slice();
    var head = g.slice(0, TOP), tail = g.slice(TOP);
    if (tail.length) {
      var s = tail.reduce(function (a, x) { return a + x.value; }, 0);
      head.push({ key: "_rest", label: "عوامل أخرى (" + tail.length + ")", value: s });
    }
    var LW = 200, RW = 66, PAD = 14, ROW = 30;
    var W = 720, H = PAD * 2 + ROW * (head.length + 2) + 22;
    var plotL = LW + 8, plotR = W - RW - 8;
    var cum = base, pts = [base];
    head.forEach(function (d) { cum += d.value; pts.push(cum); });
    var lo = Math.min.apply(null, pts), hi = Math.max.apply(null, pts);
    var span = (hi - lo) || 1, mrg = span * 0.12;
    lo -= mrg; hi += mrg;
    var X = function (v) { return plotL + (v - lo) / (hi - lo) * (plotR - plotL); };
    var svg = svgRoot(W, H), y = PAD;

    svg.appendChild(el("text", { x: LW, y: y + 15, "text-anchor": "end", "font-size": 11.5,
      fill: C("muted2", "#456076") }, "القيمة الأساسية"));
    svg.appendChild(el("line", { x1: X(base), y1: y + 4, x2: X(base), y2: H - PAD - 18,
      stroke: C("border-strong", "#C3D4E2"), "stroke-width": 1, "stroke-dasharray": "3 3" }));
    svg.appendChild(el("text", { x: plotR + 6, y: y + 15, "font-size": 11, fill: C("muted", "#5A7085") },
      base.toFixed(3)));
    y += ROW;

    var run = base;
    head.forEach(function (d) {
      var from = run, to = run + d.value; run = to;
      var x1 = X(Math.min(from, to)), x2 = X(Math.max(from, to));
      var w = Math.max(Math.abs(x2 - x1), 2);
      var pos = d.value >= 0;
      var col = pos ? C("red", "#C4362F") : C("accent", "#1B6FA8");
      svg.appendChild(el("text", { x: LW, y: y + 15, "text-anchor": "end", "font-size": 11.5,
        fill: C("text", "#12384F") }, d.label));
      svg.appendChild(el("rect", { x: x1, y: y + 3, width: w, height: 17, rx: 2.5,
        fill: col, opacity: .9 }));
      svg.appendChild(el("text", { x: plotR + 6, y: y + 15, "font-size": 11,
        fill: col, "font-weight": 600 }, (pos ? "+" : "") + d.value.toFixed(3)));
      y += ROW;
    });

    svg.appendChild(el("line", { x1: X(run), y1: PAD + 4, x2: X(run), y2: y + 2,
      stroke: COLORS_()[clsIdx], "stroke-width": 1.2, "stroke-dasharray": "3 3", opacity: .8 }));
    svg.appendChild(el("text", { x: LW, y: y + 15, "text-anchor": "end", "font-size": 12,
      fill: COLORS_()[clsIdx], "font-weight": 700 }, "درجة المطالبة"));
    svg.appendChild(el("circle", { cx: X(run), cy: y + 11, r: 4.5, fill: COLORS_()[clsIdx] }));
    svg.appendChild(el("text", { x: plotR + 6, y: y + 15, "font-size": 11.5,
      fill: COLORS_()[clsIdx], "font-weight": 700 }, run.toFixed(3)));
    y += ROW;

    svg.appendChild(el("text", { x: plotL, y: y + 10, "font-size": 10.5, fill: C("accent", "#1B6FA8") },
      "← يخفض الاحتمال"));
    svg.appendChild(el("text", { x: plotR, y: y + 10, "text-anchor": "end", "font-size": 10.5,
      fill: C("red", "#C4362F") }, "يرفع الاحتمال →"));
    host.appendChild(svg);
  }

  function clip(txt, w) {
    var n = Math.max(3, Math.floor(w / 7.2));
    return txt.length <= n ? txt : txt.slice(0, n - 1) + "…";
  }

  function drawForce(host, groups, base, margin, clsIdx) {
    host.innerHTML = "";
    var W = 720, H = 108, PAD = 20;
    var pos = groups.filter(function (d) { return d.value > 0; });
    var neg = groups.filter(function (d) { return d.value < 0; });
    var sp = pos.reduce(function (a, x) { return a + x.value; }, 0);
    var sn = -neg.reduce(function (a, x) { return a + x.value; }, 0);
    var tot = (sp + sn) || 1;
    var barW = W - PAD * 2, split = PAD + (sn / tot) * barW, y = 40;
    var svg = svgRoot(W, H);
    svg.appendChild(el("text", { x: PAD, y: 18, "font-size": 11.5, fill: C("accent", "#1B6FA8"),
      "font-weight": 600 }, "قوى ضد الفئة  −" + sn.toFixed(2)));
    svg.appendChild(el("text", { x: W - PAD, y: 18, "text-anchor": "end", "font-size": 11.5,
      fill: C("red", "#C4362F"), "font-weight": 600 }, "+" + sp.toFixed(2) + "  قوى نحو الفئة"));
    var x = PAD;
    neg.slice().sort(function (a, b) { return a.value - b.value; }).forEach(function (d) {
      var w = (-d.value / tot) * barW;
      svg.appendChild(el("rect", { x: x, y: y, width: Math.max(w - 1, .5), height: 26, rx: 2,
        fill: C("accent", "#1B6FA8"), opacity: .85 })).appendChild(
        el("title", {}, d.label + " : " + d.value.toFixed(4)));
      if (w > 60) svg.appendChild(el("text", { x: x + w / 2, y: y + 17, "text-anchor": "middle",
        "font-size": 9.5, fill: C("chart-on-fill", "#FFFFFF"), "font-weight": 700 }, clip(d.label, w)));
      x += w;
    });
    pos.slice().sort(function (a, b) { return b.value - a.value; }).forEach(function (d) {
      var w = (d.value / tot) * barW;
      svg.appendChild(el("rect", { x: x, y: y, width: Math.max(w - 1, .5), height: 26, rx: 2,
        fill: C("red", "#C4362F"), opacity: .85 })).appendChild(
        el("title", {}, d.label + " : +" + d.value.toFixed(4)));
      if (w > 60) svg.appendChild(el("text", { x: x + w / 2, y: y + 17, "text-anchor": "middle",
        "font-size": 9.5, fill: C("chart-on-fill", "#FFFFFF"), "font-weight": 700 }, clip(d.label, w)));
      x += w;
    });
    svg.appendChild(el("line", { x1: split, y1: y - 7, x2: split, y2: y + 33,
      stroke: C("text", "#12384F"), "stroke-width": 1.6 }));
    svg.appendChild(el("text", { x: split, y: y + 48, "text-anchor": "middle", "font-size": 10.5,
      fill: C("muted2", "#456076") }, "الأساس " + base.toFixed(2) + "  →  الدرجة " + margin.toFixed(2)));
    host.appendChild(svg);
  }

  function drawBars(host, items, color, unit) {
    host.innerHTML = "";
    var LW = 200, RW = 58, ROW = 25, PAD = 8;
    var W = 720, H = PAD * 2 + ROW * items.length;
    var mx = Math.max.apply(null, items.map(function (d) { return Math.abs(d.value); })) || 1;
    var plotL = LW + 8, plotR = W - RW;
    var svg = svgRoot(W, H), y = PAD;
    items.forEach(function (d) {
      var w = Math.abs(d.value) / mx * (plotR - plotL);
      var c = typeof color === "function" ? color(d) : color;
      svg.appendChild(el("text", { x: LW, y: y + 14, "text-anchor": "end", "font-size": 11.5,
        fill: C("text", "#12384F") }, d.label));
      svg.appendChild(el("rect", { x: plotL, y: y + 4, width: Math.max(w, 2), height: 14, rx: 2.5,
        fill: c, opacity: .88 }));
      svg.appendChild(el("text", { x: plotR + 5, y: y + 14, "font-size": 10.5, fill: C("muted2", "#456076") },
        d.text != null ? d.text : (d.value.toFixed(3) + (unit || ""))));
      y += ROW;
    });
    host.appendChild(svg);
  }

  // ══════════════════════════════════════════════════════════════
  // 4. تشغيل التنبؤ وعرض النتائج
  // ══════════════════════════════════════════════════════════════
  function runPredict() {
    var input = readInput();
    var x = claimsEncode(input);
    var out = E.predictX(B, x);
    var reasons = E.predictReasonsX(B, x, out.proba[NFP]);
    LAST = out; LAST_INPUT = input; LAST.reasons = reasons;
    ACTIVE_CLASS = out.predIndex;

    renderResult(out, input);
    renderShap(out);
    renderReasons(out, reasons);
    postToParent(out, reasons, input);
    saveCase(out, reasons, input);
    if (window.RCMAudit) window.RCMAudit.onPredict("claims", out.proba[NFP],
      parseFloat(input.amount), out.threshold);
    return out;
  }

  function renderResult(out, input) {
    var i = out.predIndex, p = out.proba;
    var card = $("result");
    card.className = "result show " + CLS_KEY[i];
    $("rIcon").textContent = CLS_ICON[i];
    $("rValue").textContent = B.classes_ar[i];
    $("rValue").className = "r-value " + CLS_KEY[i];
    $("rPct").textContent = pct(p[i]);
    $("rBar").style.width = (p[i] * 100) + "%";
    $("rBar").style.background = COLORS_()[i];
    ["pA", "pR"].forEach(function (id, k) { $(id).textContent = pct(p[k]); });
    ["bA", "bR"].forEach(function (id, k) {
      var diff = p[k] - B.prior[k];
      $(id).textContent = (diff >= 0 ? "▲ " : "▼ ") + pct(Math.abs(diff), 0) + " عن المتوسّط";
      $(id).style.color = (k === NFP ? diff > 0 : diff < 0) ? "var(--red)" : "var(--green)";
    });

    // الأثر المالي المتوقّع من نسب التحصيل الفعلية في بيانات المطالبات
    var amount = parseFloat(input.amount);
    if (isFinite(amount) && amount > 0) {
      var rec = B.recovery, keys = B.classes;
      var expv = amount * (p[0] * rec[keys[0]] + p[1] * rec[keys[1]]);
      $("mExp").textContent = fmt(expv, 0) + " ﷼";
      $("mRisk").textContent = fmt(amount - expv, 0) + " ﷼";
      $("moneyBox").style.display = "grid";
    } else {
      $("moneyBox").style.display = "none";
    }

    var where = document.body.classList.contains("embed")
      ? "القائمة أدناه" : "تبويب «أسباب الرفض المتوقّعة»";
    var risk = p[NFP], tip, cls, thr = out.threshold;
    if (risk >= Math.max(thr, 0.85)) {
      cls = "warn";
      tip = "<strong>خطر مرتفع جداً لعدم السداد الكامل.</strong> راجع رموز الرفض المرجّحة في " +
            where + " وعالج أسبابها قبل التقديم — أو صحّح وأعد التقديم إن كانت مقدَّمة ورُدَّت.";
    } else if (risk >= thr) {
      cls = "warn";
      tip = "<strong>فوق عتبة الإنذار.</strong> احتمال عدم السداد الكامل أعلى من عتبة القرار (" +
            pct(thr, 0) + ") — راجع الأسباب المرجّحة في " + where + " قبل التقديم.";
    } else if (risk >= 0.6) {
      cls = "";
      tip = "<strong>تحت العتبة لكن الخطر ليس هيّناً.</strong> أغلب مطالبات هذه الفترة لا تُسدَّد " +
            "كاملة — تحقّق من الموافقة المسبقة ومطابقة العقد قبل التقديم.";
    } else {
      cls = "ok";
      tip = "<strong>مؤشّرات إيجابية نسبياً.</strong> احتمال السداد الكامل أعلى بوضوح من متوسّط " +
            "المطالبات؛ تأكّد فقط من اكتمال التوثيق والمرفقات.";
    }
    $("rTip").className = "tip " + cls;
    $("rTip").innerHTML = tip;

    renderEmbedReasons();
    $("quickShap").style.display = "block";
    drawBars($("quickChart"), out.groups[i].slice(0, 6).map(function (d) {
      return { label: d.label, value: d.value,
               text: (d.value >= 0 ? "+" : "") + d.value.toFixed(3) };
    }), function (d) { return d.value >= 0 ? COLORS_()[i] : C("accent", "#1B6FA8"); });

    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function renderEmbedReasons() {
    var host = $("embedReasons");
    if (!host || !document.body.classList.contains("embed")) return;
    var rs = (LAST && LAST.reasons) || [];
    if (!rs.length) { host.style.display = "none"; return; }
    host.style.display = "block";
    host.innerHTML =
      '<div class="chart-title">أرجح رموز الرفض المتوقّعة</div>' +
      '<div class="chart-sub">احتمال عدم السداد الكامل ' + pct(LAST.proba[NFP]) + "</div>" +
      rs.slice(0, 3).map(function (r, i) {
        return '<div class="reason" style="border-inline-start-color:' +
          (i === 0 ? C("red", "#C4362F") : C("amber", "#96590F")) + '">' +
          '<div class="top"><span class="rk">' + (i + 1) + "</span>" +
          '<span class="nm">' + esc(r.label) + "</span>" +
          '<span class="pc">' + pct(r.p) + "</span></div>" +
          '<div class="act">' + esc(r.action) + "</div></div>";
      }).join("");
  }

  function renderShap(out) {
    $("shapEmpty").style.display = "none";
    $("shapBody").style.display = "block";

    var sw = $("clsSwitch");
    sw.innerHTML = "";
    B.classes_ar.forEach(function (nm, k) {
      var b = document.createElement("button");
      b.className = "cls-btn" + (k === ACTIVE_CLASS ? " active" : "");
      b.textContent = CLS_ICON[k] + " " + nm + " · " + pct(out.proba[k], 0);
      b.onclick = function () { ACTIVE_CLASS = k; renderShap(LAST); };
      sw.appendChild(b);
    });

    var c = ACTIVE_CLASS;
    drawWaterfall($("waterfall"), out.groups[c], out.base[c], out.margin[c], c);
    drawForce($("force"), out.groups[c], out.base[c], out.margin[c], c);

    var gs = Object.keys(B.global_shap).map(function (k) {
      return { label: B.global_shap[k].label, value: B.global_shap[k].pct,
               text: B.global_shap[k].pct.toFixed(1) + "%" };
    }).sort(function (a, b) { return b.value - a.value; });
    drawBars($("globalChart"), gs, C("accent", "#1B6FA8"));

    var sum = out.groups[c].reduce(function (a, x) { return a + x.value; }, 0);
    $("shapCheck").innerHTML =
      '<div class="tbl-wrap"><table><tr><th>البند</th><th>القيمة (log-odds)</th></tr>' +
      "<tr><td>القيمة الأساسية للفئة «" + esc(B.classes_ar[c]) + "»</td><td>" + out.base[c].toFixed(6) + "</td></tr>" +
      "<tr><td>مجموع قيم SHAP</td><td>" + (sum >= 0 ? "+" : "") + sum.toFixed(6) + "</td></tr>" +
      "<tr class='best'><td>المجموع = درجة النموذج</td><td>" + out.margin[c].toFixed(6) + "</td></tr>" +
      "<tr><td>فارق التحقّق</td><td>" + out.shapError.toExponential(2) + "</td></tr></table></div>" +
      '<div class="note">القيم محسوبة بخوارزمية <b>TreeSHAP</b> المسارية بدقّة تامة — لا تقريب ' +
      "ولا عيّنات عشوائية.</div>";
  }

  function renderReasons(out, reasons) {
    $("reasonEmpty").style.display = "none";
    $("reasonBody").style.display = "block";
    $("reasonSub").innerHTML =
      "احتمال عدم السداد الكامل لهذه المطالبة <b>" + pct(out.proba[NFP]) + "</b>. " +
      "الرموز أدناه رموز رفض <b>NPHIES</b> الرسمية، والنسب مشروطة بعدم السداد الكامل " +
      "ومرتّبة من الأرجح. دقّة النموذج في وضع الرمز الصحيح ضمن أعلى ثلاثة: <b>" +
      pct(B.metrics.reason_model.top3_accuracy) + "</b>.";

    var host = $("reasonList");
    host.innerHTML = "";
    reasons.slice(0, 6).forEach(function (r, i) {
      var d = document.createElement("div");
      d.className = "reason";
      d.style.borderInlineStartColor = i === 0 ? C("red", "#C4362F") : i < 3 ? C("amber", "#96590F") : C("muted", "#5A7085");
      var cat = (B.reason.cats_ar || {})[r.code];
      d.innerHTML =
        '<div class="top"><span class="rk">' + (i + 1) + "</span>" +
        '<span class="nm">' + esc(r.label) + (cat ? ' <span style="font-size:10.5px;color:var(--muted2)">· ' + esc(cat) + "</span>" : "") + "</span>" +
        '<span class="pc">' + pct(r.p) + "</span></div>" +
        '<div class="mini"><i style="width:' + (r.p * 100).toFixed(1) + "%;background:" +
          (i === 0 ? C("red", "#C4362F") : i < 3 ? C("amber", "#96590F") : C("muted", "#5A7085")) + '"></i></div>' +
        '<div class="act"><b>الإجراء المقترح:</b> ' + esc(r.action) + "</div>" +
        (r.drivers.length ? '<div class="drv">' + r.drivers.map(function (g) {
          return "<span>" + esc(g.label) + "</span>"; }).join("") + "</div>" : "");
      host.appendChild(d);
    });

    drawBars($("reasonChart"), reasons.slice(0, 10).map(function (r) {
      return { label: r.label.length > 34 ? r.label.slice(0, 33) + "…" : r.label,
               value: r.p, text: pct(r.p) };
    }), function (d) { return d.value > 0.15 ? C("red", "#C4362F") : d.value > 0.08 ? C("amber", "#96590F") : C("muted", "#5A7085"); });
  }

  // ══════════════════════════════════════════════════════════════
  // 5. تبويب النموذج
  // ══════════════════════════════════════════════════════════════
  function renderModelTab() {
    var m = B.metrics, d = m.deployment, ds = m.dataset || {}, cm = d.confusion_matrix || [];
    var h = [];
    h.push('<div class="card"><div class="sec-label">📈 أداء النموذج</div><div class="kv">');
    h.push(kv("الدقة المتوازنة", pct(d.balanced_accuracy),
              "متوسّط استرجاع الفئتين — المقياس الأمين مع فئات غير متوازنة"));
    h.push(kv("AUC", d.roc_auc.toFixed(3), "قدرة الفصل — لا تتأثر بتوزيع الفئات"));
    h.push(kv("الدقة الإجمالية", pct(d.accuracy), "أساس فئة الأغلبية " + pct(d.majority_baseline)));
    h.push(kv("F1 (ماكرو)", d.f1_macro.toFixed(3), "متوسّط متوازن على الفئتين"));
    h.push("</div>");

    h.push('<div class="chart-sub">أداء الفئة الحرجة «سداد غير كامل»:</div><div class="kv">');
    h.push(kv("الاسترجاع", pct(d.recall_nfp), "نسبة المطالبات غير المسدَّدة التي يلتقطها"));
    h.push(kv("دقّة الإنذار", pct(d.precision_nfp), "نسبة الإنذارات الصحيحة"));
    h.push(kv("استرجاع «سداد كامل»", pct(d.recall_paid), "التقاط المطالبات السليمة"));
    h.push("</div>");
    h.push('<div class="note"><b>عتبة القرار ' + d.threshold + "</b> — اختيرت بتعظيم " +
      "<b>مؤشّر يودن</b> (مجموع استرجاعَي الفئتين) على شريحة تحقّق من نهاية فترة التدريب، " +
      "لا على بيانات الاختبار. اختير هذا المعيار تحديداً لأن نسبة «عدم السداد الكامل» تنجرف " +
      "بقوة بين الشهور (76% ← 93% ← 80%) ومؤشّر يودن لا يتأثر بنسبة الفئات — فيبقى الاختيار " +
      "صالحاً مهما تغيّر مزيج الفترة القادمة. لاحظ أن نحو 80% من المطالبات المفصولة " +
      "في هذه البيانات لم تُسدَّد كاملة، فالدقة الإجمالية وحدها مقياس مضلّل هنا.</div></div>");

    if (cm.length) {
      h.push('<div class="card"><div class="sec-label">🎯 مصفوفة الالتباس</div>');
      h.push('<div class="chart-sub">الصفوف = النتيجة الفعلية، الأعمدة = تنبّؤ النموذج (فترة الاختبار الزمنية).</div>');
      h.push('<div class="tbl-wrap"><table><tr><th>فعلي \\ متوقّع</th>');
      B.classes_ar.forEach(function (c) { h.push("<th>" + esc(c) + "</th>"); });
      h.push("<th>الاسترجاع</th></tr>");
      cm.forEach(function (row, i) {
        var tot = row.reduce(function (a, b) { return a + b; }, 0) || 1;
        h.push("<tr><td><b>" + esc(B.classes_ar[i]) + "</b></td>");
        row.forEach(function (v, j) {
          h.push('<td style="' + (i === j ? "color:var(--green);font-weight:700" : "color:var(--muted)") +
            '">' + fmt(v) + "</td>");
        });
        h.push("<td>" + pct(row[i] / tot, 0) + "</td></tr>");
      });
      h.push("</table></div></div>");
    }

    if (m.comparison && m.comparison.length) {
      var best = m.comparison.filter(function (r) { return r.model.indexOf("المُعتمد") >= 0; })[0];
      h.push('<div class="card"><div class="sec-label">🔬 مقارنة الخوارزميات</div>');
      h.push('<div class="chart-sub">كل الخوارزميات على نفس الخصائص وبتقسيم <b>زمني</b> ' +
        "وبعتبة 0.5 الموحّدة للمقارنة المتكافئة. الصف المميّز هو النموذج المُعتمد.</div>");
      h.push('<div class="tbl-wrap"><table><tr><th>الخوارزمية</th><th>الدقة</th>' +
        "<th>AUC</th><th>PR-AUC</th><th>استرجاع عدم السداد</th></tr>");
      m.comparison.forEach(function (r) {
        h.push('<tr class="' + (r === best ? "best" : "") + '"><td>' + esc(r.model) + "</td><td>" +
          r.accuracy.toFixed(4) + "</td><td>" + r.roc_auc.toFixed(4) + "</td><td>" +
          r.pr_auc.toFixed(4) + "</td><td>" + r.recall_nfp.toFixed(4) + "</td></tr>");
      });
      h.push("</table></div>");
      h.push('<div class="note"><b>لماذا LightGBM؟</b> أعلى AUC بين المجرَّب (0.764 مقابل 0.739 ' +
        "للغابة العشوائية)، مع دعم أصلي للخصائص الفئوية عالية التعدّد (121 طبيباً و31 شركة تأمين) " +
        "وإمكانية التصدير للمتصفح مع SHAP بدقّة تامة — نفس اعتبارات نموذج الموافقات.</div></div>");
    }

    h.push('<div class="card"><div class="sec-label">🧩 الخصائص وأهميتها</div>');
    h.push('<div class="chart" id="mdlGlobal"></div>');
    h.push('<div class="note"><b>منع تسريب البيانات:</b> استُبعد كل عمود لا يُعرف إلا بعد قرار ' +
      "شركة التأمين — المبلغ المعتمد والمرفوض، نص سبب الرفض ورمزه، حالة المطالبة، وزمن الاستجابة، " +
      "وحتى «إجمالي المحاولات» لأنه يتضمّن محاولات لاحقة. أمّا سجلات شركة التأمين والمستشفى " +
      "والطبيب فتُحسب أثناء التدريب بنافذة <b>متوسّعة زمنياً</b> من المطالبات السابقة فقط.</div></div>");

    h.push('<div class="card"><div class="sec-label">🗄️ بيانات التدريب</div><div class="kv">');
    h.push(kv("إجمالي المطالبات", fmt(ds.rows_total), "أحدث محاولة لكل زيارة"));
    h.push(kv("مطالبات مفصولة", fmt(ds.rows_decided), "المستخدمة في التدريب"));
    h.push("</div>");
    h.push('<div class="chart-sub">الفترة: ' + esc(ds.date_from) + " → " + esc(ds.date_to) +
      " · فاصل التدريب/الاختبار: " + esc(ds.split_date) + "</div>");
    h.push('<div class="tbl-wrap"><table><tr><th>الفئة</th><th>عدد المطالبات</th><th>النسبة</th></tr>');
    var tot = 0;
    Object.keys(ds.class_distribution || {}).forEach(function (k) { tot += ds.class_distribution[k]; });
    Object.keys(ds.class_distribution || {}).forEach(function (k) {
      h.push("<tr><td>" + esc(k) + "</td><td>" + fmt(ds.class_distribution[k]) + "</td><td>" +
        pct(ds.class_distribution[k] / (tot || 1)) + "</td></tr>"); });
    var rd = ds.raw_distribution || {};
    if (rd.partial != null) {
      h.push("<tr><td style='color:var(--muted2)'>· منها مسدَّدة جزئياً</td><td style='color:var(--muted2)'>" +
        fmt(rd.partial) + "</td><td style='color:var(--muted2)'>" + pct(rd.partial / (tot || 1)) + "</td></tr>");
    }
    h.push("</table></div></div>");

    var rm = m.reason_model || {};
    h.push('<div class="card"><div class="sec-label">⚠️ نموذج رموز الرفض NPHIES</div><div class="kv">');
    h.push(kv("دقّة أعلى ٣ رموز", pct(rm.top3_accuracy), "الرمز الصحيح ضمن أعلى ثلاثة"));
    h.push(kv("دقّة الرمز الأول", pct(rm.top1_accuracy), "مقابل أساس " + pct(rm.baseline)));
    h.push("</div>");
    h.push('<div class="chart-sub">دُرِّب على ' + fmt(rm.n_rows) + " مطالبة مرفوضة أو مسدَّدة جزئياً " +
      "برمز رفض NPHIES موثَّق، للتنبّؤ بـ" + rm.n_classes + " رمزاً (ما تجاوز 150 حالة).</div>");
    h.push('<div class="tbl-wrap"><table><tr><th>رمز الرفض</th><th>عدد الحالات</th></tr>');
    var cd = rm.class_distribution || {};
    Object.keys(cd).sort(function (a, b) { return cd[b] - cd[a]; }).forEach(function (k) {
      h.push("<tr><td>" + esc(B.reason.labels_ar[k] || k) + "</td><td>" + fmt(cd[k]) + "</td></tr>"); });
    h.push("</table></div></div>");

    h.push('<div class="card"><div class="sec-label">⚖️ حدود الاستخدام</div>' +
      '<div class="note">' +
      "• النموذج <b>مساعد قرار</b> لفريق تنمية الإيرادات، وليس بديلاً عن المراجعة الطبية أو التأمينية.<br>" +
      "• نحو 80% من المطالبات المفصولة في بيانات التدريب لم تُسدَّد كاملة — فترة استثنائية الصعوبة؛ " +
      "أعد التدريب كلما توفّرت بيانات أحدث وأكثر توازناً.<br>" +
      "• «السداد الجزئي» مدموج في «سداد غير كامل»؛ النموذج لا يقدّر حجم الخصم.<br>" +
      "• لا يستخدم النموذج اسم المريض ولا رقم هويته ولا أي معرّف شخصي.<br>" +
      "• تاريخ توليد النموذج: <b>" + esc(B.generated_at) + "</b>" +
      "</div></div>");

    $("modelBody").innerHTML = h.join("");
    var gs = Object.keys(B.global_shap).map(function (k) {
      return { label: B.global_shap[k].label, value: B.global_shap[k].pct,
               text: B.global_shap[k].pct.toFixed(1) + "%" };
    }).sort(function (a, b) { return b.value - a.value; });
    drawBars($("mdlGlobal"), gs, C("accent", "#1B6FA8"));
  }

  function kv(k, v, s) {
    return '<div class="box"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) +
      '</div><div class="s">' + esc(s || "") + "</div></div>";
  }

  // ══════════════════════════════════════════════════════════════
  // 6. تبويب التكامل (تضمين + رابط + postMessage)
  // ══════════════════════════════════════════════════════════════
  function buildUrl(embed) {
    var base = location.href.split("?")[0].split("#")[0];
    var q = [];
    if ($("in_amount").value) q.push("amount=" + encodeURIComponent($("in_amount").value));
    if ($("in_visitDate").value) q.push("visitDate=" + encodeURIComponent($("in_visitDate").value));
    if ($("in_submitDate").value) q.push("submitDate=" + encodeURIComponent($("in_submitDate").value));
    if ($("in_icdCode").value) q.push("icd=" + encodeURIComponent($("in_icdCode").value));
    Object.keys(URLKEYS).forEach(function (k) {
      var f = URLKEYS[k];
      if (DD.indexOf(f) >= 0 && STATE[f]) q.push(k + "=" + encodeURIComponent(STATE[f]));
    });
    if (embed) q.push("embed=1");
    q.push("auto=1");
    return base + "?" + q.join("&");
  }

  function renderPbiTab() {
    var url = location.href.split("?")[0].split("#")[0];
    var h = [];
    h.push('<div class="card"><div class="sec-label">📈 دمج الصفحة في لوحة Power BI</div>');
    h.push('<div class="chart-sub">نفس أسلوب صفحة الموافقات: تضمين عبر <b>Insert ← Web content</b> ' +
      "بالوضع المضغوط، أو تمرير المطالبة المحدّدة عبر معاملات الرابط من مقياس DAX.</div>");
    h.push("<pre>" + esc('<iframe src="' + url + '?embed=1" width="100%" height="900" frameborder="0"></iframe>') + "</pre>");
    h.push("</div>");

    h.push('<div class="card"><div class="sec-label">🔗 مولّد الرابط</div>');
    h.push('<div class="chart-sub">يبني رابطاً يحمل القيم المُدخلة حالياً — يفتح الصفحة ويشغّل التنبؤ تلقائياً.</div>');
    h.push('<div class="btn-row" style="justify-content:flex-start">' +
      '<button class="btn ghost" id="btnUrl">🔗 توليد الرابط</button>' +
      '<button class="btn ghost" id="btnCopy">📋 نسخ</button>' +
      '<button class="btn ghost" id="btnOpen">↗ فتح في وضع التضمين</button>' +
      '<button class="btn ghost" id="btnJson">⬇ تصدير النتيجة JSON</button></div>');
    h.push('<div class="url-box" id="urlBox" style="margin-top:10px">اضغط «توليد الرابط».</div></div>');

    h.push('<div class="card"><div class="sec-label">🧭 معاملات الرابط المدعومة</div>');
    h.push('<div class="tbl-wrap"><table><tr><th>المعامل</th><th>الوصف</th><th>مثال</th></tr>' +
      "<tr><td><code>amount</code></td><td>إجمالي المطالبة</td><td>1250</td></tr>" +
      "<tr><td><code>visitDate</code></td><td>تاريخ الزيارة</td><td>2026-06-15</td></tr>" +
      "<tr><td><code>submitDate</code></td><td>تاريخ التقديم</td><td>2026-07-01</td></tr>" +
      "<tr><td><code>visitType</code></td><td>نوع الزيارة</td><td>opd / ip</td></tr>" +
      "<tr><td><code>hospital</code></td><td>المستشفى المطبَّع</td><td>al noor specialist hospital</td></tr>" +
      "<tr><td><code>insurance</code></td><td>شركة التأمين المطبَّعة</td><td>bupa</td></tr>" +
      "<tr><td><code>tpa</code></td><td>مدير المطالبات</td><td>tcs</td></tr>" +
      "<tr><td><code>physician</code></td><td>الطبيب المعالج المطبَّع</td><td>—</td></tr>" +
      "<tr><td><code>icd</code></td><td>رمز ICD-10 كاملاً</td><td>R51</td></tr>" +
      "<tr><td><code>nationality</code></td><td>الجنسية المطبَّعة</td><td>saudi</td></tr>" +
      "<tr><td><code>idType</code></td><td>نوع الهوية</td><td>national_id / iqama / passport_other</td></tr>" +
      "<tr><td><code>hasApproval</code></td><td>وجود موافقة مسبقة</td><td>1 / 0</td></tr>" +
      "<tr><td><code>attempt</code></td><td>رقم محاولة التقديم</td><td>1</td></tr>" +
      "<tr><td><code>embed</code></td><td>الوضع المضغوط للتضمين</td><td>1</td></tr>" +
      "<tr><td><code>auto</code></td><td>تشغيل التنبؤ فور التحميل</td><td>1</td></tr>" +
      "</table></div>");
    h.push('<div class="note">القيم المطبَّعة كاملةً في <code>model/artifacts/claims_bundle.json</code> ' +
      "تحت <code>options</code>. وبعد كل تنبّؤ تُرسل الصفحة النتيجة إلى الإطار الأب عبر " +
      "<code>postMessage</code> بنوع <code>rcm-claims-prediction</code>.</div></div>");

    $("pbiBody").innerHTML = h.join("");
    $("btnUrl").onclick = function () { $("urlBox").textContent = buildUrl(true); };
    $("btnCopy").onclick = function () {
      var u = buildUrl(true);
      $("urlBox").textContent = u;
      if (navigator.clipboard) navigator.clipboard.writeText(u);
      this.textContent = "✓ نُسخ";
      var b = this; setTimeout(function () { b.textContent = "📋 نسخ"; }, 1600);
    };
    $("btnOpen").onclick = function () { window.open(buildUrl(true), "_blank"); };
    $("btnJson").onclick = exportJson;
  }

  function resultPayload(out, reasons, input) {
    var top = (reasons || []).slice(0, 3).map(function (r) {
      return { code: r.code, label: r.label, probability: +r.p.toFixed(4), action: r.action }; });
    return {
      stage: "claims",
      prediction: B.classes[out.predIndex],
      prediction_ar: B.classes_ar[out.predIndex],
      confidence: out.proba[out.predIndex],
      probabilities: { paid: out.proba[0], notFullyPaid: out.proba[NFP] },
      threshold: out.threshold,
      shap: out.groups[out.predIndex].slice(0, 8).map(function (g) {
        return { feature: g.key, label: g.label, value: +g.value.toFixed(5) }; }),
      shapBase: out.base[out.predIndex],
      topDenialCodes: top,
      topReasons: top,   // نفس القائمة بالاسم الذي يقرأه جسر «مساند نماء الذكي»
      input: input,
      modelVersion: B.generated_at,
    };
  }

  var CASE_KEY = "sadeed.case.v1";

  /**
   * حفظ حالة المطالبة محلياً ليقرأها المساعد المرجعي «مساند نماء الذكي»، بنفس مفتاح
   * حالة الموافقات — أحدث حالة من أي منصّة هي المعروضة هناك، والحقل
   * stage يميّزها. التخزين على الجهاز وحده ولا يُرسَل شيء لأي خادم.
   */
  function saveCase(out, reasons, input) {
    try {
      localStorage.setItem(CASE_KEY, JSON.stringify({
        savedAt: new Date().toISOString(),
        payload: resultPayload(out, reasons, input),
      }));
      var b = $("btnAskSanad");
      if (b) b.style.display = "";
    } catch (e) { /* التخزين ممتلئ أو محظور — الميزة اختيارية فلا نُعطّل التنبؤ */ }
  }

  function postToParent(out, reasons, input) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: "rcm-claims-prediction",
          payload: resultPayload(out, reasons, input) }, "*");
      }
    } catch (e) { /* الإطار الأب من أصل مختلف — تُتجاهل بأمان */ }
  }

  function exportJson() {
    if (!LAST) { alert("شغّل تنبّؤاً أولاً."); return; }
    var blob = new Blob([JSON.stringify(resultPayload(LAST, LAST.reasons, LAST_INPUT), null, 2)],
      { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "rcm-claims-prediction.json";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // ══════════════════════════════════════════════════════════════
  // 7. مولّد بيانات تجريبية غير محدود (خاص بالمطالبات)
  // ══════════════════════════════════════════════════════════════
  function wpick(opts) {
    var sum = 0, i;
    for (i = 0; i < opts.length; i++) sum += (opts[i].n || 0) + 1;
    var r = Math.random() * sum;
    for (i = 0; i < opts.length; i++) {
      r -= (opts[i].n || 0) + 1;
      if (r <= 0) return opts[i].v;
    }
    return opts[opts.length - 1].v;
  }

  function loadSample() {
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    var vd = new Date(Date.now() - Math.random() * 150 * 24 * 3600 * 1000);
    var sd = new Date(vd.getTime() + (2 + Math.random() * 40) * 24 * 3600 * 1000);
    if (sd > new Date()) sd = new Date();
    var iso = function (d) { return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); };

    var lo = Math.log(30), hi = Math.log(20000);
    $("in_amount").value = Math.round(Math.exp(lo + Math.random() * (hi - lo)) * 100) / 100;
    $("in_visitDate").value = iso(vd);
    $("in_submitDate").value = iso(sd);

    var blocks = (B.options.icd_block || []).filter(function (o) { return /^[A-Z][0-9]{2}$/.test(o.v); });
    var icd = blocks.length ? wpick(blocks) + "." + Math.floor(Math.random() * 10) : "R51";
    $("in_icdCode").value = icd;
    syncIcd();

    ["visit_type", "hospital", "insurance", "tpa", "nationality", "id_type", "physician"]
      .forEach(function (c) { selectByValue(c, wpick(B.options[c] || [])); });
    selectByValue("has_approval", Math.random() < 0.66 ? "1" : "0");
    var r = Math.random();
    selectByValue("submit_attempt", r < 0.8 ? "1" : r < 0.97 ? "2" : "3");
    runPredict();
  }

  // ══════════════════════════════════════════════════════════════
  // 8. الإقلاع
  // ══════════════════════════════════════════════════════════════
  function applyUrlParams() {
    var q = new URLSearchParams(location.search);
    if (q.get("embed") === "1") document.body.classList.add("embed");
    if (q.get("bg") === "transparent") document.body.style.background = "transparent";
    ["amount", "visitDate", "submitDate"].forEach(function (k) {
      if (q.get(k) != null) $(URLKEYS[k]).value = q.get(k);
    });
    if (q.get("icd")) { $("in_icdCode").value = q.get("icd"); syncIcd(); }
    Object.keys(URLKEYS).forEach(function (k) {
      var f = URLKEYS[k];
      if (DD.indexOf(f) >= 0 && q.get(k) != null) selectByValue(f, String(q.get(k)));
    });
    return q.get("auto") === "1";
  }

  function setDefaults() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, "0"); };
    var iso = d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
    $("in_submitDate").value = iso;
    var v = new Date(d.getTime() - 19 * 24 * 3600 * 1000);   // وسيط مهلة التقديم في البيانات
    $("in_visitDate").value = v.getFullYear() + "-" + p(v.getMonth() + 1) + "-" + p(v.getDate());
    ["visit_type", "hospital", "insurance", "tpa", "nationality",
     "id_type", "physician", "icd_chapter", "icd_block"].forEach(function (c) {
      var o = optionsFor(c)[0];
      if (o) select(c, o.v, o.l);
    });
    selectByValue("has_approval", "1");
    selectByValue("submit_attempt", "1");
  }

  function resetForm() {
    ["in_amount", "in_icdCode"].forEach(function (id) { $(id).value = ""; });
    setDefaults();
    $("result").className = "result";
    $("quickShap").style.display = "none";
    $("shapBody").style.display = "none"; $("shapEmpty").style.display = "block";
    $("reasonBody").style.display = "none"; $("reasonEmpty").style.display = "block";
    LAST = null;
  }

  function renderHeadChips() {
    var d = B.metrics.deployment, ds = B.metrics.dataset;
    $("headChips").innerHTML =
      '<span class="chip">دقّة متوازنة <b>' + pct(d.balanced_accuracy) + "</b></span>" +
      '<span class="chip">AUC <b>' + d.roc_auc.toFixed(3) + "</b></span>" +
      '<span class="chip">التقاط عدم السداد <b>' + pct(d.recall_nfp) + "</b></span>" +
      '<span class="chip">دقّة الإنذار <b>' + pct(d.precision_nfp) + "</b></span>" +
      '<span class="chip">مُدرَّب على <b>' + fmt(ds.rows_decided) + "</b> مطالبة</span>";
  }

  function initTabs() {
    document.querySelectorAll(".tab").forEach(function (t) {
      t.onclick = function () {
        document.querySelectorAll(".tab").forEach(function (x) { x.classList.remove("active"); });
        document.querySelectorAll(".panel").forEach(function (x) { x.classList.remove("active"); });
        t.classList.add("active");
        $("p-" + t.dataset.p).classList.add("active");
      };
    });
  }

  function boot() {
    if (!B || !B.approval) {
      $("boot").innerHTML = '<div class="err"><b>تعذّر تحميل حزمة نموذج المطالبات.</b><br><br>' +
        "الملف المطلوب: <code>model/artifacts/claims_bundle.js</code><br><br>" +
        "لتوليده شغّل:<br><code>python3 model/train_claims.py --data &lt;ملف المطالبات&gt;</code></div>";
      return;
    }
    DD.forEach(buildDropdown);
    initTabs();
    renderHeadChips();
    renderModelTab();
    renderPbiTab();
    setDefaults();

    $("in_icdCode").addEventListener("input", syncIcd);
    $("btnPredict").onclick = runPredict;
    $("btnReset").onclick = resetForm;
    $("btnSample").onclick = loadSample;
    var ask = $("btnAskSanad");
    if (ask) {
      ask.onclick = function () {
        if (!LAST) { alert("شغّل تنبّؤاً أولاً."); return; }
        saveCase(LAST, LAST.reasons, LAST_INPUT);
        // نفس معالجة صفحة الموافقات: حجب المنبثقات في البيئات الداخلية
        // يعيد null بصمت — فننتقل في نفس التبويب.
        var w = null;
        try { w = window.open("chatbot.html?case=1", "_blank"); } catch (e) { /* sandbox */ }
        if (!w) window.location.href = "chatbot.html?case=1";
      };
    }

    var auto = applyUrlParams();
    $("boot").style.display = "none";
    $("app").style.display = "block";
    if (auto) setTimeout(runPredict, 30);

    window.RCM_CLAIMS = { predict: runPredict, engine: E, bundle: B,
      encode: claimsEncode,   // يستعمله تبويب «التنبؤ بالملفات» — ترميز واحد للصفحة والملفات
      last: function () { return LAST; } };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
