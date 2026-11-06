/*!
 * rcm-trees.js — تبويب «أشجار النموذج»: إحصاءات الأشجار وعرض تفاعلي لكل شجرة
 * ARCH Predict · ARCH Systems
 *
 * يقرأ الأشجار من حزمة النموذج نفسها (window.RCM_BUNDLE) — نفس الأشجار التي
 * ينفّذها المحرّك للتنبؤ — ويرسمها SVG خالصاً دون أي مكتبة خارجية.
 */
(function () {
  "use strict";

  var B = window.RCM_BUNDLE, $ = function (id) { return document.getElementById(id); };
  if (!B || !B.approval) return;

  var SV = "http://www.w3.org/2000/svg";
  var LEAF = 2;
  // الصفحة المضيفة قد تسمّي النموذجين باسمها (صفحة المطالبات مثلاً)
  var NAMES = window.RCM_TREES_LABELS || {};
  var POS_AR = (B.classes_ar && B.classes_ar[1]) || "موافقة غير كاملة";
  var MODELS = {
    approval: { key: "approval", name: NAMES.approval || "نموذج الموافقة", trees: B.approval.trees },
    reason:   { key: "reason",   name: NAMES.reason || "نموذج أسباب عدم الموافقة",
                trees: (B.reason && B.reason.trees) || [] },
  };
  var CUR = { model: "approval", idx: 0 };

  // ── إحصاءات شجرة واحدة ──
  function treeStats(t) {
    var leaves = 0, depth = 0, st = [[0, 0]];
    while (st.length) {
      var p = st.pop(), n = p[0], d = p[1];
      if (d > depth) depth = d;
      if (t.k[n] === LEAF) leaves++;
      else { st.push([t.l[n], d + 1]); st.push([t.r[n], d + 1]); }
    }
    return { leaves: leaves, depth: depth, nodes: t.k.length };
  }

  function modelStats(trees) {
    var leaves = 0, nodes = 0, maxDepth = 0;
    for (var i = 0; i < trees.length; i++) {
      var s = treeStats(trees[i]);
      leaves += s.leaves; nodes += s.nodes;
      if (s.depth > maxDepth) maxDepth = s.depth;
    }
    return { count: trees.length, leaves: leaves, nodes: nodes, maxDepth: maxDepth };
  }

  // ── تسمية الخصائص والشروط ──
  function featName(f) {
    var key = B.features[f];
    return (B.feature_ar && B.feature_ar[key]) || key;
  }

  // خريطة عكسية: رمز الفئة ← اسمها، لكل خاصية فئوية لها قائمة خيارات
  var CODE2LABEL = {};
  Object.keys(B.options || {}).forEach(function (col) {
    var m = {};
    (B.options[col] || []).forEach(function (o) { m[o.i] = o.l || o.v; });
    CODE2LABEL[col] = m;
  });

  function catSetLabel(t, node) {
    var key = B.features[t.f[node]];
    var codes = t.s[t.v[node]] || [];
    var m = CODE2LABEL[key] || {};
    var names = codes.slice(0, 4).map(function (c) { return m[c] || ("#" + c); });
    var txt = names.join("، ");
    if (codes.length > 4) txt += "، … (+" + (codes.length - 4) + ")";
    return { count: codes.length, list: txt };
  }

  function fmtThr(v) {
    if (Math.abs(v) >= 1000) return v.toFixed(0);
    if (Math.abs(v) >= 10) return v.toFixed(2).replace(/\.?0+$/, "");
    return (+v.toFixed(4)).toString();
  }

  // ── تخطيط الشجرة: الأوراق بترتيبها الأفقي، وكل عقدة فوق منتصف أبنائها ──
  function layout(t) {
    var DX = 96, DY = 78, leafI = 0, pos = {};
    (function walk(n, depth) {
      if (t.k[n] === LEAF) { pos[n] = { x: leafI++ * DX, y: depth * DY }; return; }
      walk(t.l[n], depth + 1); walk(t.r[n], depth + 1);
      pos[n] = { x: (pos[t.l[n]].x + pos[t.r[n]].x) / 2, y: depth * DY };
    })(0, 0);
    var s = treeStats(t);
    return { pos: pos, w: (s.leaves - 1) * DX + 260, h: s.depth * DY + 120 };
  }

  function el(tag, attrs, text) {
    var n = document.createElementNS(SV, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }

  function css(name, fb) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fb;
  }

  // ── رسم شجرة واحدة SVG ──
  function drawTree(host, t) {
    host.innerHTML = "";
    var L = layout(t), OX = 80, OY = 46;
    var svg = el("svg", { viewBox: "0 0 " + (L.w + OX) + " " + (L.h + OY),
      width: L.w + OX, height: L.h + OY });
    svg.style.fontFamily = "inherit";
    svg.style.direction = "ltr";

    var cText = css("--text", "#12384F"), cMut = css("--muted2", "#456076"),
        cBord = css("--border", "#d5e2ec"), cCard = css("--card", "#ffffff"),
        cRed = css("--red", "#c4362f"), cGreen = css("--green", "#0b7a5e"),
        cAcc = css("--accent", "#2f6fd8");

    function X(n) { return L.pos[n].x + OX / 2 + 110; }
    function Y(n) { return L.pos[n].y + OY / 2 + 14; }

    // الحواف أولاً (تحت العقد)
    (function edges(n) {
      if (t.k[n] === LEAF) return;
      [t.l[n], t.r[n]].forEach(function (c, side) {
        var x1 = X(n), y1 = Y(n) + 18, x2 = X(c), y2 = Y(c) - (t.k[c] === LEAF ? 12 : 18);
        var mid = (y1 + y2) / 2;
        svg.appendChild(el("path", {
          d: "M" + x1 + " " + y1 + " C" + x1 + " " + mid + " " + x2 + " " + mid + " " + x2 + " " + y2,
          fill: "none", stroke: cBord, "stroke-width": 1.4,
        }));
        // «نعم» يسار الشرط، «لا» يمينه — والنجمة للاتجاه الافتراضي عند غياب القيمة
        var isDefault = t.k[n] === 0 && ((t.d[n] === 1) === (side === 0));
        svg.appendChild(el("text", { x: (x1 + x2) / 2, y: mid - 3, "text-anchor": "middle",
          "font-size": 9.5, fill: cMut }, (side === 0 ? "نعم" : "لا") + (isDefault ? " ★" : "")));
      });
      edges(t.l[n]); edges(t.r[n]);
    })(0);

    // العقد
    for (var n = 0; n < t.k.length; n++) {
      var x = X(n), y = Y(n);
      var g = el("g", {});
      if (t.k[n] === LEAF) {
        var v = t.v[n], pos = v > 0;
        var w = 66, r = el("rect", { x: x - w / 2, y: y - 12, width: w, height: 24, rx: 6,
          fill: pos ? "rgba(196,54,47,.12)" : "rgba(11,122,94,.12)",
          stroke: pos ? cRed : cGreen, "stroke-width": 1.2 });
        g.appendChild(r);
        g.appendChild(el("text", { x: x, y: y + 4, "text-anchor": "middle", "font-size": 10.5,
          "font-weight": 700, fill: pos ? cRed : cGreen }, (v > 0 ? "+" : "") + v.toFixed(3)));
        g.appendChild(el("title", {}, "ورقة: القيمة " + v.toFixed(5) +
          " (موجبة ترفع الدرجة، سالبة تخفضها)\nتغطية التدريب: " + Math.round(t.w[n]).toLocaleString("en") + " صفاً"));
      } else {
        var name = featName(t.f[n]), cond, tip;
        if (t.k[n] === 1) {
          var cs = catSetLabel(t, n);
          cond = "∈ مجموعة من " + cs.count;
          tip = name + " ضمن: " + cs.list;
        } else {
          cond = "≤ " + fmtThr(t.v[n]);
          tip = name + " ≤ " + t.v[n];
        }
        var bw = Math.max(110, name.length * 7.5 + 16);
        g.appendChild(el("rect", { x: x - bw / 2, y: y - 18, width: bw, height: 36, rx: 7,
          fill: cCard, stroke: n === 0 ? cAcc : cBord, "stroke-width": n === 0 ? 1.8 : 1.2 }));
        g.appendChild(el("text", { x: x, y: y - 3, "text-anchor": "middle", "font-size": 10.5,
          "font-weight": 700, fill: cText }, name));
        g.appendChild(el("text", { x: x, y: y + 11, "text-anchor": "middle", "font-size": 9.5,
          fill: cMut }, cond));
        g.appendChild(el("title", {}, tip +
          "\nتغطية التدريب: " + Math.round(t.w[n]).toLocaleString("en") + " صفاً" +
          "\n«نعم» يساراً و«لا» يميناً — ★ اتجاه القيمة المفقودة"));
      }
      svg.appendChild(g);
    }
    host.appendChild(svg);
  }

  // ── الواجهة ──
  function chips(stats, extra) {
    var h = "";
    h += '<span class="chip">عدد الأشجار <b>' + stats.count.toLocaleString("en") + "</b></span>";
    h += '<span class="chip">مجموع الأوراق <b>' + stats.leaves.toLocaleString("en") + "</b></span>";
    h += '<span class="chip">مجموع العقد <b>' + stats.nodes.toLocaleString("en") + "</b></span>";
    h += '<span class="chip">أقصى عمق <b>' + stats.maxDepth + "</b></span>";
    if (extra) h += extra;
    return h;
  }

  function classOfTree(idx) {
    if (CUR.model !== "reason" || !B.reason) return "";
    var t = MODELS.reason.trees[idx];
    var code = B.reason.labels[t.c];
    return B.reason.labels_ar[code] || code;
  }

  function renderViewer() {
    var trees = MODELS[CUR.model].trees;
    if (!trees.length) { $("treeCanvas").innerHTML = ""; return; }
    if (CUR.idx < 0) CUR.idx = 0;
    if (CUR.idx >= trees.length) CUR.idx = trees.length - 1;
    $("treeNum").value = CUR.idx + 1;
    $("treeTotal").textContent = "من " + trees.length.toLocaleString("en");
    var t = trees[CUR.idx], s = treeStats(t);
    var meta = s.leaves + " ورقة · عمق " + s.depth;
    var cls = classOfTree(CUR.idx);
    if (cls) meta += " · تتنبّأ بفئة: " + cls;
    $("treeMeta").textContent = meta;
    drawTree($("treeCanvas"), t);
  }

  function render() {
    var host = $("treesBody");
    var sa = modelStats(MODELS.approval.trees);
    var sr = modelStats(MODELS.reason.trees);

    var h = '<div class="card">';
    h += '<div class="sec-label">🌳 غابة النموذج — الأشجار التي تُنفَّذ فعلياً داخل متصفّحك</div>';
    h += '<p style="font-size:13px;color:var(--muted2);line-height:1.9;margin:0 0 10px">' +
      "النموذج المعتمد <b>أشجار قرار معزَّزة بالتدرّج (LightGBM)</b>: كل شجرة تصحّح ما أخطأت " +
      "فيه سابقاتها، ودرجة الطلب النهائية هي <b>مجموع أوراق كل الأشجار</b> التي يهبط إليها — " +
      "وهذا المجموع نفسه هو ما تفكّكه قيم SHAP في تبويب التفسير.</p>";

    h += '<div class="kv-row" style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:6px">';
    h += '<div style="flex:1;min-width:260px"><div style="font-size:12.5px;font-weight:700;color:var(--text);margin-bottom:6px">' +
      MODELS.approval.name + '</div><div class="chips" style="justify-content:flex-start">' + chips(sa) + "</div></div>";
    h += '<div style="flex:1;min-width:260px"><div style="font-size:12.5px;font-weight:700;color:var(--text);margin-bottom:6px">' +
      MODELS.reason.name + '</div><div class="chips" style="justify-content:flex-start">' +
      chips(sr, '<span class="chip">' + (B.reason ? B.reason.labels.length : 0) + " فئة × " +
        (B.reason ? Math.round(sr.count / B.reason.labels.length) : 0) + " دورة</span>") + "</div></div>";
    h += "</div>";

    h += '<div class="note info" style="margin-top:8px"><b>المجموع الكلّي ' +
      (sa.count + sr.count).toLocaleString("en") + " شجرة:</b> " +
      sa.count.toLocaleString("en") + " شجرة للقرار الثنائي (شجرة واحدة لكل دورة تدريب)، و" +
      sr.count.toLocaleString("en") + " شجرة للأسباب (" +
      (B.reason ? B.reason.labels.length : 0) + " فئة لكل دورة).</div>";
    h += "</div>";

    // عارض الشجرة
    h += '<div class="card">';
    h += '<div class="sec-label">🔍 استعراض شجرة</div>';
    h += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">';
    h += '<select id="treeModel" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;' +
      'background:var(--card);color:var(--text);font-family:inherit;font-size:13px">' +
      '<option value="approval">' + MODELS.approval.name + "</option>" +
      '<option value="reason">' + MODELS.reason.name + "</option></select>";
    h += '<button class="btn ghost" id="treePrev" style="width:auto;padding:8px 14px">◀ السابقة</button>';
    h += '<input type="number" id="treeNum" min="1" value="1" style="width:86px;padding:8px;border:1px solid var(--border);' +
      'border-radius:8px;background:var(--card);color:var(--text);font-family:inherit;font-size:13px;text-align:center">';
    h += '<span id="treeTotal" style="font-size:12px;color:var(--muted2)"></span>';
    h += '<button class="btn ghost" id="treeNext" style="width:auto;padding:8px 14px">التالية ▶</button>';
    h += '<span id="treeMeta" style="font-size:12px;color:var(--muted2);margin-inline-start:auto"></span>';
    h += "</div>";
    h += '<p style="font-size:12px;color:var(--muted2);margin:0 0 8px">كل عقدة شرطٌ على خاصية واحدة: ' +
      "تحقُّقه يهبط بالطلب يساراً («نعم») وإلا يميناً («لا»)، و★ يعلّم اتجاه القيمة المفقودة. " +
      'الأوراق قيمُ الدرجة: <b style="color:var(--red)">الموجبة ترفع</b> احتمال «' + POS_AR + "» " +
      'و<b style="color:var(--green)">السالبة تخفضه</b>. مرّر المؤشّر فوق أي عقدة لتفاصيلها.</p>';
    h += '<div id="treeCanvas" style="overflow:auto;border:1px solid var(--border);border-radius:10px;' +
      'background:var(--bg);max-height:640px"></div>';
    h += "</div>";

    host.innerHTML = h;

    $("treeModel").onchange = function () { CUR.model = this.value; CUR.idx = 0; renderViewer(); };
    $("treePrev").onclick = function () { CUR.idx--; renderViewer(); };
    $("treeNext").onclick = function () { CUR.idx++; renderViewer(); };
    $("treeNum").onchange = function () { CUR.idx = (parseInt(this.value, 10) || 1) - 1; renderViewer(); };
    renderViewer();
  }

  // يُرسم عند أول فتح للتبويب (الرسم الأول فقط — بعده يبقى حيّاً)
  var drawn = false;
  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest('[data-p="trees"]');
    if (t && !drawn) { drawn = true; render(); }
  });
  // وإن فُتحت الصفحة على التبويب مباشرة
  if (document.querySelector('[data-p="trees"].active')) { drawn = true; render(); }
})();
