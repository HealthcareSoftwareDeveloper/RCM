/*!
 * rcm-app.js — واجهة صفحة التنبؤ بالموافقة التأمينية
 * ARCH Predict · ARCH Systems
 */
(function () {
  "use strict";

  var B = window.RCM_BUNDLE, E = window.RCMEngine;
  var LAST = null, LAST_INPUT = null, ACTIVE_CLASS = 2;   // 2 = مرفوضة
  var $ = function (id) { return document.getElementById(id); };

  // فئتان: 0 = موافقة كاملة، 1 = موافقة غير كاملة
  /**
   * ألوان الرسوم تُقرأ من متغيّرات CSS لا من قيم مثبّتة، فتتبع لوحة الهوية
   * تلقائياً عند أي تغيير في السمة دون تعديل شيفرة الرسوم.
   */
  var _cssCache = {};
  function C(name, fallback) {
    if (_cssCache[name] === undefined) {
      var v = getComputedStyle(document.documentElement).getPropertyValue("--" + name);
      _cssCache[name] = (v || "").trim() || fallback;
    }
    return _cssCache[name];
  }

  // فئتان: 0 = موافقة كاملة، 1 = موافقة غير كاملة
  function COLORS_() { return [C("green", "#0B7A5E"), C("red", "#C4362F")]; }
  var CLS_KEY = ["approved", "rejected"];
  var CLS_ICON = ["✅", "⚠️"];
  var NFA = 1;                       // فهرس فئة «موافقة غير كاملة»

  // الحقول الفئوية المعروضة كقوائم منسدلة
  var DD = ["visit_type", "hospital", "clinic", "nationality",
            "contract", "nphies_elig", "gender", "icd_chapter", "icd_block",
            "patient_class", "triage"];

  // خريطة مفاتيح رابط URL ← حقول الإدخال (للتكامل مع Power BI)
  var URLKEYS = {
    total: "in_total", visitDate: "in_visitDate", icd: "in_icdCode",
    priorClaims: "in_priorClaims", priorRejectRate: "in_priorRejectRate",
    visitType: "visit_type", hospital: "hospital", clinic: "clinic",
    nationality: "nationality", contract: "contract",
    nphies: "nphies_elig", gender: "gender", icdChapter: "icd_chapter",
    icdBlock: "icd_block", patientClass: "patient_class", triage: "triage",
  };

  function fmt(n, d) { d = d == null ? 0 : d;
    return (isFinite(n) ? n : 0).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function pct(x, d) { return fmt(x * 100, d == null ? 1 : d) + "%"; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g,
    function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // ══════════════════════════════════════════════════════════════
  // 1. القوائم المنسدلة
  // ══════════════════════════════════════════════════════════════
  var STATE = {};   // القيمة المختارة لكل حقل فئوي

  function triageOptions() {
    return [5, 4, 3, 2, 1].map(function (v) {
      return { v: String(v), l: B.triage_ar[String(v)] || ("CTAS " + v), n: 0, r: -1 };
    });
  }

  function optionsFor(col) {
    if (col === "triage") return triageOptions();
    return (B.options[col] || []).map(function (o) {
      return { v: o.v, l: o.l, n: o.n, r: o.r };
    });
  }

  function rrClass(r) { return r < 30 ? "rr-lo" : r < 55 ? "rr-md" : "rr-hi"; }

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
        ? '<span class="rr ' + rrClass(o.r) + '" title="نسبة عدم الموافقة الكاملة تاريخياً · ' + fmt(o.n) + ' طلب">'
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
  // 2. قراءة المدخلات
  // ══════════════════════════════════════════════════════════════
  function readInput() {
    var pr = $("in_priorRejectRate").value;
    return {
      total: $("in_total").value,
      visitDate: $("in_visitDate").value,
      triage: STATE.triage ? +STATE.triage : null,
      visitType: STATE.visit_type, hospital: STATE.hospital, clinic: STATE.clinic,
      nationality: STATE.nationality,
      contract: STATE.contract, nphies: STATE.nphies_elig, gender: STATE.gender,
      icdChapter: STATE.icd_chapter, icdBlock: STATE.icd_block,
      patientClass: STATE.patient_class,
      priorClaims: $("in_priorClaims").value === "" ? null : +$("in_priorClaims").value,
      priorRejectRate: pr === "" ? null : +pr / 100,
    };
  }

  // رمز ICD-10 ← فصل + كتلة
  function syncIcd() {
    var v = ($("in_icdCode").value || "").trim().toUpperCase().replace(/\s/g, "");
    var mCh = v.match(/^([A-Z])/), mBl = v.match(/^([A-Z][0-9]{2})/);
    if (mCh) selectByValue("icd_chapter", mCh[1]);
    if (mBl) selectByValue("icd_block", mBl[1]);
  }

  // ══════════════════════════════════════════════════════════════
  // 3. الرسوم البيانية (SVG خالص)
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
    s.style.direction = "ltr";      // الأرقام السالبة تُعرض بعلامتها يساراً
    return s;
  }

  /** مخطط الشلال: من القيمة الأساسية إلى درجة الطلب */
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

    // النطاق التراكمي
    var cum = base, pts = [base];
    head.forEach(function (d) { cum += d.value; pts.push(cum); });
    var lo = Math.min.apply(null, pts), hi = Math.max.apply(null, pts);
    var span = (hi - lo) || 1, mrg = span * 0.12;
    lo -= mrg; hi += mrg;
    var X = function (v) { return plotL + (v - lo) / (hi - lo) * (plotR - plotL); };

    var svg = svgRoot(W, H), y = PAD;

    // صف القيمة الأساسية
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

    // صف النتيجة
    svg.appendChild(el("line", { x1: X(run), y1: PAD + 4, x2: X(run), y2: y + 2,
      stroke: COLORS_()[clsIdx], "stroke-width": 1.2, "stroke-dasharray": "3 3", opacity: .8 }));
    svg.appendChild(el("text", { x: LW, y: y + 15, "text-anchor": "end", "font-size": 12,
      fill: COLORS_()[clsIdx], "font-weight": 700 }, "درجة الطلب"));
    svg.appendChild(el("circle", { cx: X(run), cy: y + 11, r: 4.5, fill: COLORS_()[clsIdx] }));
    svg.appendChild(el("text", { x: plotR + 6, y: y + 15, "font-size": 11.5,
      fill: COLORS_()[clsIdx], "font-weight": 700 }, run.toFixed(3)));
    y += ROW;

    svg.appendChild(el("text", { x: plotL, y: y + 10, "font-size": 10.5, fill: C("accent", "#1B6FA8") },
      "\u2190 يخفض الاحتمال"));
    svg.appendChild(el("text", { x: plotR, y: y + 10, "text-anchor": "end", "font-size": 10.5,
      fill: C("red", "#C4362F") }, "يرفع الاحتمال \u2192"));
    host.appendChild(svg);
  }

  function clip(txt, w) {
    var n = Math.max(3, Math.floor(w / 7.2));
    return txt.length <= n ? txt : txt.slice(0, n - 1) + "…";
  }

  /** مخطط القوى */
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
    var t = el("text", { x: W - PAD, y: 18, "text-anchor": "end", "font-size": 11.5,
      fill: C("red", "#C4362F"), "font-weight": 600 }, "+" + sp.toFixed(2) + "  قوى نحو الفئة");
    svg.appendChild(t);

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

  /** أشرطة أفقية عامة */
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
    var out = E.predict(B, input);
    var reasons = E.predictReasons(B, input, out.proba[NFA]);
    LAST = out; LAST_INPUT = input; LAST.reasons = reasons;
    ACTIVE_CLASS = out.predIndex;

    renderResult(out, input);
    renderShap(out);
    renderReasons(out, reasons);
    postToParent(out, reasons, input);
    saveCase(out, reasons, input);
    if (window.RCMAudit) window.RCMAudit.onPredict("approvals", out.proba[NFA],
      parseFloat(input.total), out.threshold);
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
      // ارتفاع خطر عدم التحصيل سيّئ، وارتفاع القبول جيّد
      $(id).style.color = (k === NFA ? diff > 0 : diff < 0) ? "var(--red)" : "var(--green)";
    });

    // الأثر المالي المتوقّع
    var total = parseFloat(input.total);
    if (isFinite(total) && total > 0) {
      var rec = B.recovery, keys = B.classes;
      var expv = total * (p[0] * rec[keys[0]] + p[1] * rec[keys[1]]);
      $("mExp").textContent = fmt(expv, 0) + " ﷼";
      $("mRisk").textContent = fmt(total - expv, 0) + " ﷼";
      $("moneyBox").style.display = "grid";
    } else {
      $("moneyBox").style.display = "none";
    }

    // في وضع التضمين لا توجد تبويبات، فتُذكر الأسباب بموضعها الفعلي أدناه.
    var where = document.body.classList.contains("embed")
      ? "القائمة أدناه" : "تبويب «أسباب عدم الموافقة»";
    var risk = p[NFA], tip, cls;
    if (risk >= 0.65) {
      cls = "warn";
      tip = "<strong>خطر مرتفع لعدم الموافقة الكاملة.</strong> راجع الأسباب المرجّحة في " +
            where + " وعالجها قبل الإرسال — التصحيح المسبق أرخص بكثير من الاستئناف.";
    } else if (risk >= 0.45) {
      cls = "";
      tip = "<strong>خطر متوسّط.</strong> تحقّق من اكتمال المستندات ومطابقة الترميز وحدود " +
            "التغطية في العقد قبل الإرسال — الأسباب المرجّحة في " + where + ".";
    } else {
      cls = "ok";
      tip = "<strong>مؤشّرات إيجابية.</strong> احتمال الموافقة الكاملة مرتفع؛ تأكّد فقط من " +
            "اكتمال البيانات الأساسية.";
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

  /** في وضع التضمين لا توجد تبويبات، فتُعرض أهم الأسباب مع النتيجة مباشرةً. */
  function renderEmbedReasons() {
    var host = $("embedReasons");
    if (!host || !document.body.classList.contains("embed")) return;
    var rs = (LAST && LAST.reasons) || [];
    if (!rs.length) { host.style.display = "none"; return; }
    host.style.display = "block";
    host.innerHTML =
      '<div class="chart-title">أرجح أسباب عدم الموافقة الكاملة</div>' +
      '<div class="chart-sub">احتمال عدم الموافقة الكاملة ' +
        pct(LAST.proba[NFA]) + "</div>" +
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
      "ولا عيّنات عشوائية. الفارق أعلاه ناتج عن تدوير الأرقام العشرية فقط.</div>";
  }

  function renderReasons(out, reasons) {
    $("reasonEmpty").style.display = "none";
    $("reasonBody").style.display = "block";
    $("reasonSub").innerHTML =
      "احتمال عدم الموافقة الكاملة لهذا الطلب <b>" + pct(out.proba[NFA]) + "</b>. " +
      "النسب أدناه مشروطة بحدوث ذلك، ومرتّبة من الأرجح. " +
      "دقّة النموذج في وضع السبب الصحيح ضمن أعلى ثلاثة: <b>" +
      pct(B.metrics.reason_model.top3_accuracy) + "</b>.";

    var host = $("reasonList");
    host.innerHTML = "";
    reasons.slice(0, 6).forEach(function (r, i) {
      var d = document.createElement("div");
      d.className = "reason";
      d.style.borderInlineStartColor = i === 0 ? C("red", "#C4362F") : i < 3 ? C("amber", "#96590F") : C("muted", "#5A7085");
      d.innerHTML =
        '<div class="top"><span class="rk">' + (i + 1) + "</span>" +
        '<span class="nm">' + esc(r.label) + "</span>" +
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
    var m = B.metrics, ds = m.dataset || {}, cm = m.confusion_matrix || [];
    var h = [];
    h.push('<div class="card"><div class="sec-label">📈 أداء النموذج</div><div class="kv">');
    h.push(kv("الدقة الإجمالية", pct(m.accuracy), "على بيانات لم يرها النموذج"));
    h.push(kv("الرفع فوق الأساس", "+" + pct(m.lift_over_majority),
              "أساس التخمين " + pct(m.majority_baseline)));
    h.push(kv("AUC", m.roc_auc.toFixed(3), "قدرة الفصل — لا تتأثر بتوزيع الفئات"));
    h.push(kv("F1 (ماكرو)", m.f1_macro.toFixed(3), "متوسّط متوازن على الفئتين"));
    h.push("</div>");

    h.push('<div class="chart-sub">أداء الفئة الحرجة «موافقة غير كاملة» — وهي ما يهمّ ' +
      "تنمية الإيرادات فعلاً:</div><div class=\"kv\">");
    h.push(kv("الاسترجاع", pct(m.recall_nfa), "نسبة الحالات الخاسرة التي يلتقطها"));
    h.push(kv("الدقة", pct(m.precision_nfa), "نسبة الإنذارات الصحيحة"));
    h.push("</div>");
    h.push('<div class="note"><b>عتبة القرار ' + m.threshold + "</b> — اختيرت بتعظيم F1 " +
      "الماكرو على شريحة تحقّق مقتطعة من نهاية فترة التدريب، لا على بيانات الاختبار. " +
      "خُفِّضت دون 0.5 عمداً: تفويت حالة خاسرة أغلى من إنذار زائد يُراجَع في دقيقة.</div></div>");

    // مصفوفة الالتباس
    if (cm.length) {
      h.push('<div class="card"><div class="sec-label">🎯 مصفوفة الالتباس</div>');
      h.push('<div class="chart-sub">الصفوف = النتيجة الفعلية، الأعمدة = تنبّؤ النموذج.</div>');
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

    // مقارنة الخوارزميات
    if (m.comparison && m.comparison.length) {
      // يُميَّز النموذج المُعتمد فعلاً، لا صاحب أعلى رقم — فقد تتفوّق خوارزمية
      // أخرى بفارق ضمن هامش الخطأ بينما يُختار المعتمد لاعتبارات أخرى.
      var best = m.comparison.filter(function (r) { return r.model.indexOf("المُعتمد") >= 0; })[0];
      h.push('<div class="card"><div class="sec-label">🔬 مقارنة الخوارزميات</div>');
      h.push('<div class="chart-sub">دُرِّبت كل الخوارزميات على نفس الخصائص وقُيِّمت بتقسيم ' +
        "<b>زمني</b> — التدريب على الفترة الأقدم والاختبار على الأحدث، وهو التقييم الأمين " +
        "لنموذج سيعمل على طلبات موافقة مستقبلية. الصف المميّز هو النموذج المُعتمد.</div>");
      h.push('<div class="tbl-wrap"><table><tr><th>الخوارزمية</th><th>الدقة</th>' +
        "<th>الرفع</th><th>AUC</th><th>استرجاع الخطر</th></tr>");
      m.comparison.forEach(function (r) {
        h.push('<tr class="' + (r === best ? "best" : "") + '"><td>' + esc(r.model) + "</td><td>" +
          r.accuracy.toFixed(4) + "</td><td>" + (r.lift_over_majority >= 0 ? "+" : "") +
          r.lift_over_majority.toFixed(4) + "</td><td>" + r.roc_auc.toFixed(4) + "</td><td>" +
          r.recall_nfa.toFixed(4) + "</td></tr>");
      });
      h.push("</table></div>");
      h.push('<div class="note"><b>«الرفع» = الدقة ناقص نسبة فئة الأغلبية.</b> وهو المقياس ' +
        "الوحيد القابل للمقارنة بين صياغات مختلفة للهدف: دمج فئتين يرفع سقف «التخمين الغبي» " +
        "فترتفع الدقة الظاهرية دون تحسّن حقيقي.<br><br>" +
        "<b>لماذا LightGBM؟</b> أعلى AUC بين كل الخوارزميات المجرَّبة (0.808 مقابل 0.802 " +
        "للغابة العشوائية)، ودقّة تعادلها عملياً — الفارق 0.001 على 8,209 صفوف اختبار، " +
        "أي ضمن هامش الخطأ الإحصائي. كما يدعم الخصائص الفئوية عالية التعدّد (7,354 عقداً و659 عيادة) " +
        "بشكل أصلي دون توسيع one-hot، ويُصدَّر إلى المتصفح بحجم صغير مع إمكانية حساب SHAP " +
        "بدقّة تامة.</div></div>");
    }

    // الخصائص
    h.push('<div class="card"><div class="sec-label">🧩 الخصائص وأهميتها</div>');
    h.push('<div class="chart" id="mdlGlobal"></div>');
    h.push('<div class="note"><b>منع تسريب البيانات:</b> استُبعدت كل الأعمدة التي لا تُعرف إلا ' +
      "بعد صدور قرار شركة التأمين — المبلغ المغطّى، صافي النقد، رقم الموافقة المرجعي، ونص سبب الرفض. " +
      "أمّا معدّلات الرفض التاريخية للعقد والمستشفى والعيادة فتُحسب أثناء التدريب بنافذة " +
      "<b>متوسّعة زمنياً</b> (من الطلبات السابقة فقط) حتى لا يتسرّب المستقبل إلى الماضي.</div></div>");

    // البيانات
    h.push('<div class="card"><div class="sec-label">🗄️ بيانات التدريب</div><div class="kv">');
    h.push(kv("إجمالي السجلات", fmt(ds.rows_total), "قبل التصفية"));
    h.push(kv("طلبات ذات قرار نهائي", fmt(ds.rows_decided), "المستخدمة في التدريب"));
    h.push("</div>");
    h.push('<div class="chart-sub">الفترة: ' + esc(ds.date_from) + " → " + esc(ds.date_to) +
      " · فاصل التدريب/الاختبار: " + esc(ds.split_date) + "</div>");
    h.push('<div class="tbl-wrap"><table><tr><th>الفئة</th><th>عدد الطلبات</th><th>النسبة</th></tr>');
    var tot = 0;
    Object.keys(ds.class_distribution || {}).forEach(function (k) { tot += ds.class_distribution[k]; });
    Object.keys(ds.class_distribution || {}).forEach(function (k) {
      h.push("<tr><td>" + esc(k) + "</td><td>" + fmt(ds.class_distribution[k]) + "</td><td>" +
        pct(ds.class_distribution[k] / (tot || 1)) + "</td></tr>"); });
    h.push("</table></div></div>");

    // أسباب الرفض
    var rm = m.reason_model || {};
    h.push('<div class="card"><div class="sec-label">⚠️ نموذج أسباب عدم الموافقة</div><div class="kv">');
    h.push(kv("دقّة أعلى ٣ أسباب", pct(rm.top3_accuracy), "السبب الصحيح ضمن أعلى ثلاثة"));
    h.push(kv("دقّة السبب الأول", pct(rm.top1_accuracy), "مقابل أساس " + pct(rm.baseline)));
    h.push("</div>");
    h.push('<div class="chart-sub">صُنِّفت ' + fmt(rm.n_rows) + " ردّاً نصّياً حرّاً من شركات التأمين إلى " +
      rm.n_classes + " سبباً معيارياً باستخدام قواعد نمطية، ثم دُرِّب نموذج منفصل للتنبؤ بالسبب.</div>");
    h.push('<div class="tbl-wrap"><table><tr><th>السبب</th><th>عدد الحالات</th></tr>');
    var cd = rm.class_distribution || {};
    Object.keys(cd).sort(function (a, b) { return cd[b] - cd[a]; }).forEach(function (k) {
      h.push("<tr><td>" + esc(B.reason.labels_ar[k] || k) + "</td><td>" + fmt(cd[k]) + "</td></tr>"); });
    h.push("</table></div></div>");

    h.push('<div class="card"><div class="sec-label">⚖️ حدود الاستخدام</div>' +
      '<div class="note">' +
      "• النموذج <b>مساعد قرار</b> لفريق تنمية الإيرادات، وليس بديلاً عن المراجعة الطبية أو التأمينية.<br>" +
      "• فئة «الموافقة الجزئية» أصعب تنبّؤاً (12.5% من البيانات) ودقّتها أدنى من الفئتين الأخريين.<br>" +
      "• لا يستخدم النموذج اسم المريض ولا رقم هويته ولا أي معرّف شخصي.<br>" +
      "• يتدهور الأداء عند تغيّر سياسات شركات التأمين — يُنصح بإعادة التدريب كل ربع سنة.<br>" +
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
  // 6. تكامل Power BI
  // ══════════════════════════════════════════════════════════════
  function buildUrl(embed) {
    var base = location.href.split("?")[0].split("#")[0];
    var q = [];
    if ($("in_total").value) q.push("total=" + encodeURIComponent($("in_total").value));
    if ($("in_visitDate").value) q.push("visitDate=" + encodeURIComponent($("in_visitDate").value));
    if ($("in_icdCode").value) q.push("icd=" + encodeURIComponent($("in_icdCode").value));
    if ($("in_priorClaims").value) q.push("priorClaims=" + encodeURIComponent($("in_priorClaims").value));
    if ($("in_priorRejectRate").value) q.push("priorRejectRate=" + encodeURIComponent($("in_priorRejectRate").value));
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
    h.push('<div class="chart-sub">الصفحة مصمَّمة لتعمل داخل Power BI بثلاث طرق — اختر ما يناسب حالتك.</div>');

    h.push('<div class="chart-title" style="margin-top:14px">الطريقة ١ — تضمين تفاعلي (الأسهل)</div>');
    h.push('<ol class="steps">' +
      "<li>في Power BI Desktop افتح <b>Insert ← Web content</b>.</li>" +
      "<li>ألصق كود التضمين أدناه، ثم <b>OK</b>.</li>" +
      "<li>حجّم المربّع ليملأ الصفحة — الوضع المضغوط <code>embed=1</code> يخفي الترويسة والتبويبات.</li>" +
      "</ol>");
    h.push("<pre>" + esc('<iframe src="' + url + '?embed=1" width="100%" height="900" frameborder="0"></iframe>') + "</pre>");

    h.push('<div class="chart-title" style="margin-top:18px">الطريقة ٢ — تمرير بيانات الطلب المحدّد (ديناميكي)</div>');
    h.push('<div class="chart-sub">أنشئ مقياساً (Measure) يبني الرابط من الصف المختار في اللوحة، ' +
      "ثم اعرضه في <b>مرئي HTML Content</b> أو كزرّ <b>Web URL</b>. عند اختيار المستخدم لطلب " +
      "في أي جدول، تُحدَّث الصفحة تلقائياً وتشغّل التنبؤ.</div>");
    h.push("<pre>" + esc(
'رابط_التنبؤ = \n' +
'VAR BaseUrl = "' + url + '"\n' +
'VAR Q =\n' +
'    "?embed=1&auto=1"\n' +
'    & "&total="      & COALESCE( SELECTEDVALUE(Claims[Total]), 0 )\n' +
'    & "&visitType="  & SELECTEDVALUE(Claims[Visit Type])\n' +
'    & "&hospital="   & SELECTEDVALUE(Claims[Hospital Key])\n' +
'    & "&clinic="     & SELECTEDVALUE(Claims[Clinic Key])\n' +
'    & "&contract="   & SELECTEDVALUE(Claims[Contract Key])\n' +
'    & "&nphies="     & SELECTEDVALUE(Claims[Nphies Key])\n' +
'    & "&icd="        & SELECTEDVALUE(Claims[Icd 10])\n' +
'    & "&triage="     & SELECTEDVALUE(Claims[Triage Num])\n' +
'    & "&gender="     & SELECTEDVALUE(Claims[Gender])\n' +
'    & "&nationality="& SELECTEDVALUE(Claims[Nationality Key])\n' +
'    & "&patientClass=" & SELECTEDVALUE(Claims[Patient Class Key])\n' +
'RETURN BaseUrl & Q') + "</pre>");
    h.push('<div class="note">أعمدة <code>*_Key</code> هي القيم المطبَّعة التي يتوقّعها النموذج ' +
      "(حروف صغيرة، مسافات موحّدة). يولّدها سكربت <code>powerbi/powerbi_script.py</code> جاهزةً " +
      "ضمن جدول الطلبات المسجَّل، فلا حاجة لبنائها يدوياً في Power Query.</div>");

    h.push('<div class="chart-title" style="margin-top:18px">الطريقة ٣ — تسجيل دفعي لكل الطلبات (الأقوى للوحات)</div>');
    h.push('<div class="chart-sub">لعرض التنبؤات كأعمدة في جداول ومرئيات Power BI العادية ' +
      "(بدل صفحة ويب مضمّنة)، شغّل النموذج داخل Power BI مباشرةً:</div>");
    h.push('<ol class="steps">' +
      "<li><b>Home ← Get Data ← More… ← Other ← Python script</b>.</li>" +
      "<li>ألصق محتوى <code>powerbi/powerbi_script.py</code> بعد تعديل مسار ملف البيانات.</li>" +
      "<li>اختر جدول <b>scored</b> — يحتوي على احتمال عدم الموافقة الكاملة، التنبؤ، شريحة " +
      "الخطر، المبلغ المعرّض للخطر، أعلى ٣ عوامل SHAP، وأعلى ٣ أسباب متوقّعة لكل طلب.</li>" +
      "<li>حدّث البيانات دورياً عبر <b>Personal Gateway</b>.</li></ol>");
    h.push('<div class="note"><b>الأعمدة الناتجة:</b> <code>pred_label</code>، <code>p_approved</code>، ' +
      "<code>p_not_fully_approved</code>، <code>risk_band</code>، " +
      "<code>expected_revenue</code>، <code>amount_at_risk</code>، <code>shap_top1..3</code>، " +
      "<code>reason_top1..3</code>. هذه الأعمدة كافية لبناء لوحة كاملة: تصفية حسب شريحة الخطر، " +
      "تجميع المبلغ المعرّض للخطر حسب شركة التأمين أو المستشفى، وترتيب أسباب عدم الموافقة المتوقّعة.</div>");
    h.push("</div>");

    h.push('<div class="card"><div class="sec-label">🔗 مولّد الرابط</div>');
    h.push('<div class="chart-sub">يبني رابطاً يحمل القيم المُدخلة حالياً في تبويب التنبؤ — ' +
      "مفيد للاختبار قبل بناء المقياس في DAX.</div>");
    h.push('<div class="btn-row" style="justify-content:flex-start">' +
      '<button class="btn ghost" id="btnUrl">🔗 توليد الرابط</button>' +
      '<button class="btn ghost" id="btnCopy">📋 نسخ</button>' +
      '<button class="btn ghost" id="btnOpen">↗ فتح في وضع التضمين</button>' +
      '<button class="btn ghost" id="btnJson">⬇ تصدير النتيجة JSON</button></div>');
    h.push('<div class="url-box" id="urlBox" style="margin-top:10px">اضغط «توليد الرابط».</div></div>');

    h.push('<div class="card"><div class="sec-label">📡 استقبال النتيجة برمجياً</div>');
    h.push('<div class="chart-sub">بعد كل تنبّؤ ترسل الصفحة النتيجة إلى الإطار الأب عبر ' +
      "<code>postMessage</code> — يفيد في المرئيات المخصّصة أو تطبيقات الويب التي تضمّن الصفحة.</div>");
    h.push("<pre>" + esc(
"window.addEventListener('message', function (e) {\n" +
"  if (e.data && e.data.type === 'rcm-prediction') {\n" +
"    var r = e.data.payload;\n" +
"    console.log(r.prediction, r.probabilities, r.topReasons, r.shap);\n" +
"  }\n" +
"});") + "</pre></div>");

    h.push('<div class="card"><div class="sec-label">🧭 معاملات الرابط المدعومة</div>');
    h.push('<div class="tbl-wrap"><table><tr><th>المعامل</th><th>الوصف</th><th>مثال</th></tr>' +
      "<tr><td><code>total</code></td><td>إجمالي الفاتورة</td><td>1250</td></tr>" +
      "<tr><td><code>visitType</code></td><td>نوع الزيارة</td><td>er / opd / ip</td></tr>" +
      "<tr><td><code>hospital</code></td><td>اسم المستشفى المطبَّع</td><td>al noor specialist hospital</td></tr>" +
      "<tr><td><code>clinic</code></td><td>اسم العيادة المطبَّع</td><td>emergency</td></tr>" +
      "<tr><td><code>contract</code></td><td>اسم العقد المطبَّع</td><td>hajj1447</td></tr>" +
      "<tr><td><code>nphies</code></td><td>نتيجة فحص الأهلية</td><td>eligible</td></tr>" +
      "<tr><td><code>icd</code></td><td>رمز ICD-10 كاملاً</td><td>J06.9</td></tr>" +
      "<tr><td><code>triage</code></td><td>CTAS من 1 إلى 5</td><td>3</td></tr>" +
      "<tr><td><code>gender</code></td><td>الجنس</td><td>Male / Female</td></tr>" +
      "<tr><td><code>nationality</code></td><td>الجنسية المطبَّعة</td><td>saudi</td></tr>" +
      "<tr><td><code>patientClass</code></td><td>تصنيف المريض</td><td>hajj / umrah / saudi</td></tr>" +
      "<tr><td><code>visitDate</code></td><td>تاريخ ووقت الزيارة</td><td>2026-08-18T14:30</td></tr>" +
      "<tr><td><code>embed</code></td><td>الوضع المضغوط للتضمين</td><td>1</td></tr>" +
      "<tr><td><code>auto</code></td><td>تشغيل التنبؤ فور التحميل</td><td>1</td></tr>" +
      "</table></div>");
    h.push('<div class="note">القيم المطبَّعة (المستشفى، العيادة، العقد، الجنسية) مكتوبة بحروف ' +
      "صغيرة ومسافات موحّدة. تجدها كاملةً في <code>model/artifacts/model_bundle.json</code> " +
      "تحت <code>options</code>، ويولّدها سكربت Power BI تلقائياً.</div></div>");

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
    return {
      prediction: B.classes[out.predIndex],
      prediction_ar: B.classes_ar[out.predIndex],
      confidence: out.proba[out.predIndex],
      probabilities: { approved: out.proba[0], notFullyApproved: out.proba[NFA] },
      riskBand: out.proba[NFA] >= 0.65 ? "high" : out.proba[NFA] >= 0.45 ? "medium" : "low",
      threshold: out.threshold,
      shap: out.groups[out.predIndex].slice(0, 8).map(function (g) {
        return { feature: g.key, label: g.label, value: +g.value.toFixed(5) }; }),
      shapBase: out.base[out.predIndex],
      topReasons: (reasons || []).slice(0, 3).map(function (r) {
        return { code: r.code, label: r.label, probability: +r.p.toFixed(4), action: r.action }; }),
      input: input,
      modelVersion: B.generated_at,
    };
  }

  var CASE_KEY = "sadeed.case.v1";

  /**
   * حفظ الحالة الأخيرة محلياً ليقرأها المساعد المرجعي «مساند نماء الذكي» في الصفحة الأخرى.
   * التخزين على الجهاز وحده (localStorage)، ولا يُرسَل شيء إلى أي خادم من هنا.
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
        window.parent.postMessage({ type: "rcm-prediction", payload: resultPayload(out, reasons, input) }, "*");
      }
    } catch (e) { /* الإطار الأب من أصل مختلف — تُتجاهل بأمان */ }
  }

  function exportJson() {
    if (!LAST) { alert("شغّل تنبّؤاً أولاً."); return; }
    var blob = new Blob([JSON.stringify(resultPayload(LAST, LAST.reasons, LAST_INPUT), null, 2)],
      { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "rcm-prediction.json";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // ══════════════════════════════════════════════════════════════
  // 7. الإقلاع
  // ══════════════════════════════════════════════════════════════
  function applyUrlParams() {
    var q = new URLSearchParams(location.search);
    if (q.get("embed") === "1") document.body.classList.add("embed");
    // الخلفية صلبة افتراضياً؛ &bg=transparent لتبنّي خلفية مربّع Power BI
    if (q.get("bg") === "transparent") document.body.style.background = "transparent";
    ["total", "visitDate", "priorClaims", "priorRejectRate"].forEach(function (k) {
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
    $("in_visitDate").value = d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
      "T" + p(d.getHours()) + ":" + p(d.getMinutes());
    // القيم الأكثر شيوعاً في البيانات كنقطة انطلاق
    ["visit_type", "hospital", "clinic", "nationality", "contract",
     "nphies_elig", "gender", "icd_chapter", "icd_block", "patient_class"].forEach(function (c) {
      var o = optionsFor(c)[0];
      if (o) select(c, o.v, o.l);
    });
    select("triage", "3", B.triage_ar["3"]);
  }

  // مولّد بيانات تجريبية غير محدود: كل ضغطة تملأ النموذج بطلب عشوائي جديد
  // من قوائم النموذج نفسها (rcm-demo.js) وتُشغّل التنبؤ فوراً.
  function loadSample() {
    var D = window.RCMDemo;
    if (!D) return;
    var c = D.randomCase();
    $("in_total").value = c.total;
    $("in_visitDate").value = c.visit_date.replace(" ", "T");
    $("in_icdCode").value = c.icd;
    syncIcd();
    selectByValue("visit_type", c.visit_type);
    selectByValue("hospital", c.hospital);
    selectByValue("clinic", c.clinic);
    selectByValue("contract", c.contract);
    selectByValue("nphies_elig", c.nphies);
    selectByValue("gender", c.gender);
    selectByValue("nationality", c.nationality);
    selectByValue("patient_class", c.patient_class);
    selectByValue("triage", String(c.triage));
    $("in_priorClaims").value = c.prior_claims;
    // الحقل في النموذج نسبة مئوية، والمولّد يعيد كسراً 0-1
    $("in_priorRejectRate").value = c.prior_reject_rate === "" ? "" : Math.round(c.prior_reject_rate * 100);
    runPredict();
  }

  function resetForm() {
    ["in_total", "in_icdCode", "in_priorClaims", "in_priorRejectRate"].forEach(function (id) { $(id).value = ""; });
    setDefaults();
    $("result").className = "result";
    $("quickShap").style.display = "none";
    $("shapBody").style.display = "none"; $("shapEmpty").style.display = "block";
    $("reasonBody").style.display = "none"; $("reasonEmpty").style.display = "block";
    LAST = null;
  }

  function renderHeadChips() {
    var m = B.metrics;
    $("headChips").innerHTML =
      '<span class="chip">دقّة النموذج <b>' + pct(m.accuracy) + "</b></span>" +
      '<span class="chip">رفع فوق الأساس <b>+' + pct(m.lift_over_majority) + "</b></span>" +
      '<span class="chip">AUC <b>' + m.roc_auc.toFixed(3) + "</b></span>" +
      '<span class="chip">التقاط الخطر <b>' + pct(m.recall_nfa) + "</b></span>" +
      '<span class="chip">مُدرَّب على <b>' + fmt(m.dataset.rows_decided) + "</b> طلب موافقة</span>";
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
      $("boot").innerHTML = '<div class="err"><b>تعذّر تحميل حزمة النموذج.</b><br><br>' +
        "الملف المطلوب: <code>model/artifacts/model_bundle.js</code><br><br>" +
        "لتوليده شغّل:<br><code>python3 model/train_model.py --data &lt;ملف البيانات&gt;</code></div>";
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
    var ask = $("btnAskSanad");
    if (ask) {
      ask.onclick = function () {
        if (!LAST) { alert("شغّل تنبّؤاً أولاً."); return; }
        saveCase(LAST, LAST.reasons, LAST_INPUT);
        // بيئات الاستضافة الداخلية كثيراً ما تحجب النوافذ المنبثقة (سياسات
        // المتصفح المؤسسية، أو iframe بلا allow-popups) فيعود window.open
        // بـ null بلا أي رسالة — عندها ننتقل في نفس التبويب بدلاً من الصمت.
        var w = null;
        try { w = window.open("chatbot.html?case=1", "_blank"); } catch (e) { /* sandbox */ }
        if (!w) window.location.href = "chatbot.html?case=1";
      };
    }
    $("btnReset").onclick = resetForm;
    $("btnSample").onclick = loadSample;

    var auto = applyUrlParams();
    $("boot").style.display = "none";
    $("app").style.display = "block";
    if (auto) setTimeout(runPredict, 30);

    // استقبال المدخلات من الإطار الأب (Power BI / تطبيق مضيف)
    window.addEventListener("message", function (e) {
      if (!e.data || e.data.type !== "rcm-input" || !e.data.payload) return;
      var p = e.data.payload;
      if (p.total != null) $("in_total").value = p.total;
      if (p.icd) { $("in_icdCode").value = p.icd; syncIcd(); }
      Object.keys(URLKEYS).forEach(function (k) {
        var f = URLKEYS[k];
        if (DD.indexOf(f) >= 0 && p[k] != null) selectByValue(f, String(p[k]));
      });
      runPredict();
    });

    window.RCM = { predict: runPredict, engine: E, bundle: B, last: function () { return LAST; } };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
