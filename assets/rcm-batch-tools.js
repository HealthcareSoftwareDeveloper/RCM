/*!
 * rcm-batch-tools.js — أدوات مشتركة لتبويبي «التنبؤ بالملفات» في المنصّتين
 * ARCH Predict · ARCH Systems
 *
 * ١) المطابقة الذكية للأعمدة: يقبل الملف بأي ترتيب أعمدة وبأي تسمية قريبة
 *    (عربية أو إنجليزية)، عبر تطبيع النص وقواميس مرادفات لكل حقل — والحقل
 *    غير الموجود يأخذ افتراضات الصفحة نفسها. مع تقرير خريطة أعمدة صريح
 *    يُري المستخدم ما طوبق وما لم يوجد.
 * ٢) الملخّص المحوري: تجميع النتائج حسب بُعد يختاره المستخدم (جدول محوري)
 *    مع مخطط أشرطة SVG بهوية المنصّة، وورقة «الملخص المحوري» في ملف Excel.
 */
(function () {
  "use strict";

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g,
    function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function fmt(n, d) { d = d == null ? 0 : d;
    return (isFinite(n) ? n : 0).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); }

  // ── تطبيع نص العنوان: يوحّد الهمزات والتاء المربوطة ويزيل التشكيل والرموز ──
  function norm(h) {
    return String(h == null ? "" : h)
      .toLowerCase()
      .replace(/[ً-ْـ]/g, "")     // تشكيل وتطويل
      .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه")
      .replace(/ى/g, "ي").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
      .replace(/[()[\]{}\/\\_\-.,:;؟?؛،#*"']+/g, " ")
      .replace(/\s+/g, " ").trim();
  }

  /**
   * المطابقة الذكية: cols=[{key,head},…] · syns={key:[مرادفات]} ·
   * headerKeyFn = مُطابق الصفحة الدقيق (المفتاح اللاتيني بين القوسين).
   * تُعيد { idx: {key: رقم العمود}, report: [{key, head, matched, via}] }
   */
  function smartMap(cols, syns, heads, headerKeyFn) {
    var idx = {}, used = {}, report = [];
    var nheads = heads.map(function (h) { return norm(h); });

    // المرحلة ١ — مطابقة الصفحة الدقيقة (المفتاح اللاتيني بين القوسين أو نصّه)
    heads.forEach(function (h, i) {
      var k = headerKeyFn(h);
      if (k && idx[k] === undefined) { idx[k] = i; used[i] = "exact"; }
    });

    // المرحلة ٢ — المرادفات: تساوٍ بعد التطبيع، ثم احتواء (الأطول أولاً)
    cols.forEach(function (c) {
      if (idx[c.key] !== undefined) return;
      var list = (syns[c.key] || []).concat([norm(c.head)]).map(norm)
        .filter(function (x) { return x.length >= 2; })
        .sort(function (a, b) { return b.length - a.length; });
      var best = -1, bestScore = 0;
      nheads.forEach(function (nh, i) {
        if (used[i] || !nh) return;
        for (var j = 0; j < list.length; j++) {
          var syn = list[j], score = 0;
          if (nh === syn) score = 3;
          else if (syn.length >= 3 && nh.indexOf(syn) >= 0) score = 2;
          else if (nh.length >= 3 && syn.indexOf(nh) >= 0) score = 1;
          if (score > bestScore) { bestScore = score; best = i; }
          if (score === 3) break;
        }
      });
      if (best >= 0 && bestScore > 0) { idx[c.key] = best; used[best] = bestScore === 3 ? "name" : "fuzzy"; }
    });

    cols.forEach(function (c) {
      var i = idx[c.key];
      report.push({
        key: c.key, head: c.head,
        matched: i === undefined ? null : String(heads[i]),
        via: i === undefined ? "default" : used[i],
      });
    });
    return { idx: idx, report: report };
  }

  /** بطاقة «خريطة الأعمدة» تحت النتائج — صراحةً: ما طوبق وكيف، وما أخذ الافتراضي */
  function mapReportHtml(report) {
    var mapped = report.filter(function (r) { return r.matched; });
    var missing = report.filter(function (r) { return !r.matched; });
    var via = { exact: "مطابقة دقيقة", name: "تطابق الاسم", fuzzy: "تشابه الاسم" };
    var h = '<details style="margin-top:10px;font-size:12px"><summary style="cursor:pointer;color:var(--accent);font-weight:600">' +
      "🗂 خريطة الأعمدة: طوبق " + mapped.length + " من " + report.length + " حقلاً" +
      (missing.length ? " — والبقية أخذت افتراضات الصفحة" : "") + "</summary>" +
      '<div class="tbl-wrap" style="margin-top:8px"><table>' +
      "<tr><th>حقل المنصّة</th><th>العمود في ملفك</th><th>المطابقة</th></tr>";
    report.forEach(function (r) {
      var name = String(r.head).replace(/\s*\([a-z0-9_]+\)\s*$/i, "");
      h += "<tr><td>" + esc(name) + "</td><td>" +
        (r.matched ? esc(r.matched) : '<span style="color:var(--muted)">—</span>') + "</td><td>" +
        (r.matched ? esc(via[r.via] || r.via)
                   : '<span style="color:var(--yellow,#96590f)">غير موجود ← الافتراضي</span>') +
        "</td></tr>";
    });
    h += "</table></div></details>";
    return h;
  }

  // ── الملخّص المحوري ──────────────────────────────────────────
  /** rows: [{dims:{k:v}, amount, p, risk, hi}] → صفوف مجمَّعة حسب dimKey */
  function pivotAgg(rows, dimKey, maxRows) {
    var g = {};
    rows.forEach(function (r) {
      var v = r.dims[dimKey];
      v = (v == null || v === "") ? "غير محدد" : String(v);
      var o = g[v] || (g[v] = { value: v, n: 0, hi: 0, sumP: 0, amount: 0, risk: 0, codes: {} });
      o.n++; if (r.hi) o.hi++;
      o.sumP += r.p;
      if (isFinite(r.amount)) o.amount += r.amount;
      if (isFinite(r.risk)) o.risk += r.risk;
      var c = r.dims.code;
      if (c && c !== "—") o.codes[c] = (o.codes[c] || 0) + 1;
    });
    var list = Object.keys(g).map(function (k) { return g[k]; });
    list.sort(function (a, b) { return b.risk - a.risk || b.n - a.n; });
    maxRows = maxRows || 12;
    if (list.length > maxRows) {
      var rest = list.slice(maxRows - 1);
      var o = { value: "أخرى (" + rest.length + ")", n: 0, hi: 0, sumP: 0, amount: 0, risk: 0, codes: {} };
      rest.forEach(function (r) { o.n += r.n; o.hi += r.hi; o.sumP += r.sumP; o.amount += r.amount; o.risk += r.risk;
        Object.keys(r.codes || {}).forEach(function (c) { o.codes[c] = (o.codes[c] || 0) + r.codes[c]; }); });
      list = list.slice(0, maxRows - 1).concat([o]);
    }
    return list;
  }

  /** أرجح ثلاثة أسباب داخل مجموعة (بحسب السبب الأول لكل صف) */
  function topCodes(o) {
    return Object.keys(o.codes || {})
      .map(function (c) { return { c: c, n: o.codes[c] }; })
      .sort(function (a, b) { return b.n - a.n; })
      .slice(0, 3);
  }

  /** مخطط أشرطة أفقي بلون واحد (مقدار) — تسميات مباشرة وتلميح لكل شريط */
  function hbarSvg(items, valueOf, labelOf, titleOf) {
    if (!items.length) return "";
    var max = 0;
    items.forEach(function (r) { max = Math.max(max, valueOf(r)); });
    if (max <= 0) return "";
    var rowH = 30, w = 1000, labelW = 300, valW = 110, pad = 6;
    var barMax = w - labelW - valW - 20;
    var h = items.length * rowH + 8;
    var svg = '<svg viewBox="0 0 ' + w + " " + h + '" style="width:100%;height:auto;direction:ltr" role="img">';
    items.forEach(function (r, i) {
      var y = 4 + i * rowH, bw = Math.max(3, (valueOf(r) / max) * barMax);
      var x0 = w - labelW - bw;
      svg += "<g><title>" + esc(titleOf(r)) + "</title>" +
        '<rect x="' + x0 + '" y="' + (y + pad) + '" width="' + bw + '" height="' + (rowH - 2 * pad) +
          '" rx="4" fill="var(--accent,#1B6FA8)"></rect>' +
        '<text x="' + (w - labelW + 8) + '" y="' + (y + rowH / 2 + 4) +
          '" font-size="13" fill="var(--text,#12384F)" text-anchor="start" direction="rtl">' +
          esc(labelOf(r)) + "</text>" +
        '<text x="' + (x0 - 8) + '" y="' + (y + rowH / 2 + 4) +
          '" font-size="12.5" font-weight="700" fill="var(--muted2,#456076)" text-anchor="end">' +
          esc(fmt(valueOf(r))) + "</text></g>";
    });
    svg += "</svg>";
    return svg;
  }

  /**
   * يبني قسم «الملخّص المحوري» داخل hostId ويحدّثه عند تغيير البُعد.
   * cfg = { rows, dims: [{key,label}], hiLabel, moneyLabel }
   */
  function pivotUI(hostId, cfg) {
    var host = document.getElementById(hostId);
    if (!host || !cfg.rows.length) return;
    var h = '<div class="sec-label" style="margin-top:16px">📊 الملخّص المحوري — جدول ومخطط تفاعليان</div>' +
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">' +
      '<label style="font-size:12px;color:var(--muted2)">جمّع حسب:</label>' +
      '<select id="' + hostId + 'Dim" style="background:var(--surface);border:1px solid var(--border);color:var(--text);' +
      'font-family:inherit;font-size:12.5px;padding:7px 12px;border-radius:8px;outline:none">' +
      cfg.dims.map(function (d, i) {
        return '<option value="' + esc(d.key) + '"' + (i === 0 ? " selected" : "") + ">" + esc(d.label) + "</option>";
      }).join("") + "</select></div>" +
      '<div id="' + hostId + 'Body"></div>';
    host.innerHTML = h;

    function render(dimKey) {
      var dim = cfg.dims.filter(function (d) { return d.key === dimKey; })[0] || cfg.dims[0];
      var agg = pivotAgg(cfg.rows, dim.key);
      var acts = cfg.actions || {};
      var b = '<div class="tbl-wrap"><table>' +
        "<tr><th>" + esc(dim.label) + "</th><th>" + esc(cfg.moneyLabel) + " ﷼</th>" +
        "<th>السبب المرجّح ١</th><th>السبب المرجّح ٢</th><th>السبب المرجّح ٣</th>" +
        "<th>الإجراء المقترح ١</th><th>الإجراء المقترح ٢</th><th>الإجراء المقترح ٣</th></tr>";
      agg.forEach(function (r) {
        var tc = topCodes(r);
        b += "<tr><td><b>" + esc(r.value) + "</b><div style='font-size:10.5px;color:var(--muted)'>" +
          fmt(r.n) + " صفاً · " + esc(cfg.hiLabel) + " " + fmt(r.hi) + "</div></td>" +
          "<td><b>" + fmt(r.risk) + "</b></td>";
        for (var j = 0; j < 3; j++)
          b += "<td>" + (tc[j] ? esc(tc[j].c) + ' <span style="color:var(--muted);font-size:10.5px">(' + fmt(tc[j].n) + ")</span>" : "—") + "</td>";
        for (j = 0; j < 3; j++)
          b += '<td style="font-size:11px;color:var(--muted2)">' + (tc[j]
            ? esc(acts[tc[j].c] || "—") + ' <span style="color:var(--muted);font-size:10.5px">(' + fmt(tc[j].n) + ")</span>"
            : "—") + "</td>";
        b += "</tr>";
      });
      b += "</table></div>";
      b += '<div style="margin-top:12px;font-size:12px;color:var(--muted2)">' + esc(cfg.moneyLabel) +
        " حسب " + esc(dim.label) + " (الأعلى أولاً):</div>" +
        hbarSvg(agg.filter(function (r) { return r.risk > 0; }),
          function (r) { return r.risk; },
          function (r) { return r.value.length > 30 ? r.value.slice(0, 29) + "…" : r.value; },
          function (r) { return r.value + " — " + esc(cfg.moneyLabel) + ": " + fmt(r.risk) + " ﷼ · صفوف: " + fmt(r.n) + " · عالية الخطورة: " + fmt(r.hi); });
      document.getElementById(hostId + "Body").innerHTML = b;
    }
    render(cfg.dims[0].key);
    document.getElementById(hostId + "Dim").onchange = function () { render(this.value); };
  }

  /** ورقة «الملخص المحوري» في Excel: كل الأبعاد مقاطع متتالية في ورقة واحدة */
  function pivotAoa(cfg) {
    var aoa = [["الملخص المحوري — من ARCH Predict"], [""]];
    cfg.dims.forEach(function (d) {
      var acts = cfg.actions || {};
      aoa.push(["حسب: " + d.label]);
      aoa.push([d.label, cfg.moneyLabel, "عدد الصفوف", cfg.hiLabel,
                "السبب المرجّح 1", "تكراره", "السبب المرجّح 2", "تكراره", "السبب المرجّح 3", "تكراره",
                "الإجراء المقترح 1", "تكراره", "الإجراء المقترح 2", "تكراره", "الإجراء المقترح 3", "تكراره",
                "المخطط ▓ (" + cfg.moneyLabel + ")"]);
      var agg2 = pivotAgg(cfg.rows, d.key, 25);
      var maxRisk = 0;
      agg2.forEach(function (r) { maxRisk = Math.max(maxRisk, r.risk); });
      agg2.forEach(function (r) {
        var tc = topCodes(r), row = [r.value, Math.round(r.risk * 100) / 100, r.n, r.hi];
        for (var j = 0; j < 3; j++) { row.push(tc[j] ? tc[j].c : ""); row.push(tc[j] ? tc[j].n : ""); }
        for (j = 0; j < 3; j++) { row.push(tc[j] ? (acts[tc[j].c] || "") : ""); row.push(tc[j] ? tc[j].n : ""); }
        var bars = maxRisk > 0 ? Math.round((r.risk / maxRisk) * 20) : 0;
        row.push(bars > 0 ? new Array(bars + 1).join("█") : "");
        aoa.push(row);
      });
      aoa.push(["ملاحظة: عمود المخطط أشرطة نصية داخل الخلايا — طول الشريط يمثل " + cfg.moneyLabel + " نسبةً إلى أعلى مجموعة في هذا المقطع."]);
      aoa.push([""]);
    });
    return aoa;
  }

  window.RCMBatchTools = { norm: norm, smartMap: smartMap, mapReportHtml: mapReportHtml,
    pivotAgg: pivotAgg, pivotUI: pivotUI, pivotAoa: pivotAoa, hbarSvg: hbarSvg };
})();
