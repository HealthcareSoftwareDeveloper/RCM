/*!
 * arch-aco.js — مواءمة ARCH Predict مع متطلبات ACO Gate 3 (3RCM)
 * ARCH Predict · ARCH Systems
 *
 * ثلاثة تبويبات مشتركة بين صفحتي الموافقات والمطالبات:
 *   📋 قائمة التدخل    — الطلبات عالية الخطر من «التنبؤ بالملفات» مرتبة بالمبلغ المعرّض للخطر،
 *                        مع حالة التدخل والمسؤول والملاحظة (3RCM5.5.2: intervention process).
 *   📡 مراقبة النموذج — حين يحمل الملف المرفوع القرار الفعلي (Approval Status / Claim Status):
 *                        AUC والاسترجاع والدقة الفعلية مقابل بطاقة النموذج، شهرياً، مع الانجراف (PSI)
 *                        وأثر التدخل، ومحفّزات إعادة التدريب (3RCM5.2.5).
 *   📄 دليل ACO        — صفحات A4 مؤرخة لكل متطلب، بأرقام حيّة من الجهاز نفسه.
 *
 * التخزين: localStorage في متصفّح المستخدم فقط — لا يُرسل شيء إلى أي خادم.
 * لا يُخزَّن أي معرّف شخصي: مفتاح الطلب (رقمه أو بصمة الحقول) والأرقام فقط.
 */
(function () {
  "use strict";

  var CLAIMS = !!window.RCM_CLAIMS_BUNDLE;
  var B = CLAIMS ? window.RCM_CLAIMS_BUNDLE : window.RCM_BUNDLE;
  var STAGE = CLAIMS ? "claims" : "approvals";
  var NOUN = CLAIMS ? "مطالبة" : "طلب موافقة";
  var KEY = "arch.aco." + STAGE;
  var MAX_ITEMS = 3000;
  var $ = function (id) { return document.getElementById(id); };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g,
    function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function f0(n) { return (isFinite(n) ? Math.round(n) : 0).toLocaleString("en-US"); }
  function f2(n) { return (isFinite(n) ? n : 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  // القيم المحفوظة في JSON تعود null بدل NaN — فالتحقق بالنوع لا بـ isFinite وحدها
  function num(x) { return typeof x === "number" && isFinite(x); }
  function pc(x, d) { return num(x) ? (x * 100).toFixed(d == null ? 1 : d) + "%" : "—"; }
  function d3(x) { return num(x) ? x.toFixed(3) : "—"; }
  function today() { return new Date().toISOString().slice(0, 10); }
  function nowS() { var d = new Date(); return d.toISOString().slice(0, 10) + " " + d.toTimeString().slice(0, 5); }

  // ══════════════════════ مرجع بطاقة النموذج ══════════════════════
  function card() {
    var m = B.metrics || {}, dep = CLAIMS ? (m.deployment || {}) : m, ds = m.dataset || {};
    return {
      auc: dep.roc_auc, recall: CLAIMS ? dep.recall_nfp : dep.recall_nfa,
      precision: CLAIMS ? dep.precision_nfp : dep.precision_nfa,
      threshold: (B.approval && B.approval.threshold) || dep.threshold || 0.5,
      generated: B.generated_at || "", from: ds.date_from, to: ds.date_to, split: ds.split_date,
      n: ds.rows_decided, comparison: m.comparison || [],
    };
  }

  // ══════════════════════ التخزين ══════════════════════
  function load() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { s = null; }
    s = s || {};
    s.items = s.items || {}; s.runs = s.runs || []; s.monitor = s.monitor || []; s.log = s.log || [];
    s.user = s.user || ""; s.capacity = s.capacity || 50;
    return s;
  }
  var ST = load();
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(ST)); }
    catch (e) {   // امتلاء التخزين: أسقط أقل الطلبات خطراً غير المراجعة
      var ks = Object.keys(ST.items).filter(function (k) { return ST.items[k].status === "new"; })
        .sort(function (a, b) { return ST.items[a].risk - ST.items[b].risk; });
      ks.slice(0, Math.ceil(ks.length / 4)).forEach(function (k) { delete ST.items[k]; });
      try { localStorage.setItem(KEY, JSON.stringify(ST)); } catch (e2) { /* */ }
    }
  }
  function logEv(action, detail) {
    ST.log.push({ ts: nowS(), user: ST.user || "غير محدد", action: action, detail: detail || "" });
    if (ST.log.length > 500) ST.log = ST.log.slice(-500);
  }

  // ══════════════════════ أدوات القرار الفعلي ══════════════════════
  var OUT_RE = /approval status|claim status|request status|حاله رفع طلب الموافقه|حالة رفع طلب الموافقة|حالة الموافقة|حالة المطالبة|القرار الفعلي|actual outcome/i;
  function outcomeIndex(heads) {
    for (var i = 0; i < (heads || []).length; i++) {
      var h = String(heads[i] == null ? "" : heads[i]);
      if (OUT_RE.test(h) && !/للخدمة|service/i.test(h)) return i;
    }
    return -1;
  }
  /** القرار ← 0 قُبل كاملاً | 1 لم يُقبل كاملاً (مرفوض أو جزئي) | null لم يصدر قرار */
  function outcome(v) {
    var s = String(v == null ? "" : v).trim().toLowerCase();
    if (!s) return null;
    if (/partial|جزئي|reject|مرفوض|denied|not approved/.test(s)) return 1;
    if (/^approved$|^accepted$|^paid$|مقبول|موافقة كاملة|سداد كامل/.test(s)) return 0;
    return null;     // pending / sent / queued / canceled
  }
  function month(v) {
    if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 7);
    var m = String(v == null ? "" : v).match(/(20\d{2})[-\/](\d{1,2})/);
    return m ? m[1] + "-" + (m[2].length < 2 ? "0" : "") + m[2] : "";
  }

  // ══════════════════════ مقاييس ══════════════════════
  function aucOf(rows) {
    var pos = 0, neg = 0, a = rows.slice().sort(function (x, y) { return x.p - y.p; });
    var rank = 0, sumPos = 0, i = 0;
    while (i < a.length) {
      var j = i; while (j + 1 < a.length && a[j + 1].p === a[i].p) j++;
      var r = (i + j) / 2 + 1;
      for (var t = i; t <= j; t++) { if (a[t].y === 1) { pos++; sumPos += r; } else neg++; }
      i = j + 1;
    }
    return pos && neg ? (sumPos - pos * (pos + 1) / 2) / (pos * neg) : NaN;
  }
  function evaluate(rows, thr) {
    var tp = 0, fp = 0, fn = 0, tn = 0, brier = 0, sp = 0, sy = 0;
    rows.forEach(function (r) {
      var f = r.p >= thr; brier += (r.p - r.y) * (r.p - r.y); sp += r.p; sy += r.y;
      if (f && r.y) tp++; else if (f) fp++; else if (r.y) fn++; else tn++;
    });
    var n = rows.length;
    return { n: n, auc: aucOf(rows), recall: tp / Math.max(1, tp + fn), precision: tp / Math.max(1, tp + fp),
             brier: brier / Math.max(1, n), base: sy / Math.max(1, n), meanP: sp / Math.max(1, n),
             accuracy: (tp + tn) / Math.max(1, n), flagged: (tp + fp) / Math.max(1, n) };
  }
  function hist(rows) {
    var h = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    rows.forEach(function (r) { h[Math.min(9, Math.floor(r.p * 10))]++; });
    var n = rows.length || 1; return h.map(function (v) { return v / n; });
  }
  function psi(a, b) {
    var s = 0; for (var i = 0; i < 10; i++) { var x = Math.max(a[i], 1e-4), y = Math.max(b[i], 1e-4); s += (x - y) * Math.log(x / y); }
    return s;
  }

  // ══════════════════════ استقبال نتائج الملف ══════════════════════
  function onBatch(o) {
    var rows = o.rows || [], thr = o.threshold, ts = nowS();
    var decided = rows.filter(function (r) { return r.y === 0 || r.y === 1; });
    var open = rows.filter(function (r) { return r.y == null; });
    var added = 0, updated = 0, outcomes = 0;
    // ١) القرار الفعلي لطلبات سبق إدراجها في قائمة التدخل
    decided.forEach(function (r) {
      var it = ST.items[r.k];
      if (it && it.y == null) { it.y = r.y; it.yTs = ts; outcomes++; }
    });
    // ٢) الطلبات المفتوحة عالية الخطر ← قائمة التدخل
    open.filter(function (r) { return r.p >= thr; }).forEach(function (r) {
      var it = ST.items[r.k];
      if (it) { it.p = r.p; it.risk = r.risk; it.seen = ts; updated++; return; }
      ST.items[r.k] = { k: r.k, p: r.p, a: r.a, risk: r.risk, r1: r.r1, act1: r.act1, elig: r.elig || "",
                        dims: r.dims, month: r.month, file: o.file, added: ts, seen: ts,
                        status: "new", owner: "", note: "", stTs: "", y: null };
      added++;
    });
    var keys = Object.keys(ST.items);
    if (keys.length > MAX_ITEMS) {
      keys.filter(function (k) { return ST.items[k].status === "new" && ST.items[k].y == null; })
        .sort(function (a, b) { return ST.items[a].risk - ST.items[b].risk; })
        .slice(0, keys.length - MAX_ITEMS).forEach(function (k) { delete ST.items[k]; });
    }
    // ٣) مراقبة النموذج على الطلبات ذات القرار
    var run = { ts: ts, file: o.file, n: rows.length, open: open.length, decided: decided.length,
                flagged: rows.filter(function (r) { return r.p >= thr; }).length, added: added, outcomes: outcomes,
                hist: hist(rows), m0: "", m1: "" };
    rows.forEach(function (r) { if (!r.month) return; if (!run.m0 || r.month < run.m0) run.m0 = r.month; if (!run.m1 || r.month > run.m1) run.m1 = r.month; });
    if (!ST.ref) ST.ref = { ts: ts, file: o.file, hist: run.hist };
    run.psi = psi(run.hist, ST.ref.hist);
    ST.runs.push(run); if (ST.runs.length > 200) ST.runs = ST.runs.slice(-200);
    var pos = decided.filter(function (r) { return r.y === 1; }).length;
    if (decided.length >= 100 && pos >= 20 && decided.length - pos >= 20) {
      var ev = evaluate(decided, thr), c = card(), byM = {};
      decided.forEach(function (r) { (byM[r.month || "—"] = byM[r.month || "—"] || []).push(r); });
      ev.months = Object.keys(byM).sort().map(function (mo) {
        var g = byM[mo], e = evaluate(g, thr); return { m: mo, n: g.length, base: e.base, meanP: e.meanP,
          auc: g.length >= 60 ? e.auc : NaN, recall: e.recall };
      });
      // التفصيل بالجهة الدافعة (أعلى 8 حجماً)
      var byP = {};
      decided.forEach(function (r) { var k = (r.dims && r.dims.payer) || "—"; (byP[k] = byP[k] || []).push(r); });
      ev.payers = Object.keys(byP).sort(function (a, b) { return byP[b].length - byP[a].length; }).slice(0, 8)
        .map(function (k) { var e = evaluate(byP[k], thr); return { k: k, n: byP[k].length, base: e.base, meanP: e.meanP,
          auc: byP[k].length >= 60 ? e.auc : NaN }; });
      // الأهلية (الموافقات فقط)
      var byE = {};
      decided.forEach(function (r) { if (r.elig) (byE[r.elig] = byE[r.elig] || []).push(r); });
      ev.elig = Object.keys(byE).map(function (k) { var e = evaluate(byE[k], thr); return { k: k, n: byE[k].length, base: e.base }; })
        .sort(function (a, b) { return b.n - a.n; });
      ev.ts = ts; ev.file = o.file; ev.psi = run.psi; ev.threshold = thr;
      ev.cardAuc = c.auc; ev.dAuc = num(c.auc) && num(ev.auc) ? ev.auc - c.auc : NaN; ev.model = c.generated;
      ev.alerts = [];
      if (num(ev.dAuc) && ev.dAuc <= -0.05) ev.alerts.push("انخفض AUC بـ " + Math.abs(ev.dAuc).toFixed(3) + " عن بطاقة النموذج (الحد 0.05)");
      if (run.psi >= 0.25) ev.alerts.push("انجراف كبير في توزيع الدرجات PSI=" + run.psi.toFixed(2) + " (الحد 0.25)");
      if (num(c.recall) && ev.recall < c.recall - 0.10) ev.alerts.push("انخفض التقاط الحالات الخاسرة إلى " + pc(ev.recall) + " مقابل " + pc(c.recall));
      ST.monitor.push(ev); if (ST.monitor.length > 60) ST.monitor = ST.monitor.slice(-60);
      run.evaluated = true;
      logEv("مراقبة النموذج", o.file + ": AUC " + d3(ev.auc) + " على " + f0(ev.n) + " " + NOUN + (ev.alerts.length ? " — تنبيه: " + ev.alerts.join("؛ ") : ""));
    }
    logEv("تسجيل ملف", o.file + ": " + f0(rows.length) + " " + NOUN + " · فوق العتبة " + f0(run.flagged) +
          " · أُضيف للقائمة " + f0(added) + (outcomes ? " · قرارات فعلية لطلبات في القائمة " + f0(outcomes) : ""));
    save();
    banner(run);
  }

  function banner(run) {
    var host = $("batchStatus"); if (!host) return;
    var d = document.createElement("div");
    d.className = "note info"; d.style.marginTop = "10px";
    d.innerHTML = "<b>ARCH Predict — المتابعة:</b> أُضيف <b>" + f0(run.added) + "</b> " + NOUN +
      " عالي الخطر إلى «📋 قائمة التدخل»" + (run.outcomes ? "، وسُجّل القرار الفعلي لـ " + f0(run.outcomes) + " طلباً سبق التدخل فيه" : "") +
      (run.evaluated ? "، وقيس أداء النموذج على " + f0(run.decided) + " " + NOUN + " ذات قرار — انظر «📡 مراقبة النموذج»" : "") + ".";
    host.insertBefore(d, host.firstChild);
  }

  // ══════════════════════ التبويبات ══════════════════════
  var STATUS = { "new": "لم يُراجع", fixed: "صُحح قبل الإرسال", asis: "أُرسل كما هو", referred: "أُحيل للطبيب/الترميز", cancel: "أُلغي/لا يلزم" };
  var REQS = CLAIMS ? ["3RCM5.5.1", "3RCM5.5.2", "3RCM7.2.2", "3RCM5.1.5", "3RCM5.2.5"]
                    : ["3RCM5.3.4", "3RCM5.5.2", "3RCM5.1.5", "3RCM5.2.5", "3RCM5.2.3"];

  function addTabs() {
    var tabs = $("tabs"), app = $("app");
    if (!tabs || !app) return;
    [["aco-work", "📋 قائمة التدخل", renderWork], ["aco-mon", "📡 مراقبة النموذج", renderMon], ["aco-ev", "📄 دليل ACO", renderEv]]
      .forEach(function (t) {
        var btn = document.createElement("button");
        btn.className = "tab"; btn.dataset.p = t[0]; btn.textContent = t[1];
        tabs.appendChild(btn);
        var panel = document.createElement("div");
        panel.className = "panel"; panel.id = "p-" + t[0];
        panel.innerHTML = '<div id="' + t[0] + 'Body"></div>';
        app.appendChild(panel);
        btn.addEventListener("click", function () {
          document.querySelectorAll(".tab").forEach(function (x) { x.classList.remove("active"); });
          document.querySelectorAll(".panel").forEach(function (x) { x.classList.remove("active"); });
          btn.classList.add("active"); panel.classList.add("active");
          ST = load(); t[2]($(t[0] + "Body"));
        });
      });
    var css = document.createElement("style");
    css.textContent =
      ".aco td{direction:rtl;text-align:right;vertical-align:top}.aco td.n,.aco th.n{direction:ltr;text-align:left}" +
      ".aco select,.aco input{font-family:inherit;font-size:12px;padding:5px 6px;border:1px solid var(--border);border-radius:7px;background:var(--card);color:var(--text)}" +
      ".aco-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:12px}" +
      ".aco-kpi{background:var(--surface);border:1px solid var(--border);border-radius:11px;padding:11px 13px}" +
      ".aco-kpi b{display:block;font-size:20px;color:var(--text);font-variant-numeric:tabular-nums}.aco-kpi span{font-size:11.5px;color:var(--muted)}" +
      ".aco-pill{display:inline-block;font-size:11px;border-radius:10px;padding:1px 8px;border:1px solid var(--border)}" +
      ".aco-pill.bad{color:var(--red);border-color:var(--red)}.aco-pill.ok{color:var(--green);border-color:var(--green)}" +
      ".aco-tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0}" +
      ".aco-tools .btn{width:auto;padding:9px 16px}.aco-tools label{font-size:12px;color:var(--muted2);display:inline-flex;gap:6px;align-items:center}" +
      ".aco-wl{min-width:1080px}.aco-wl td.ref{min-width:150px;font-size:11px;word-break:break-word}.aco-wl td.rsn{min-width:230px}.aco-wl td.who{min-width:150px;font-size:11.5px}" +
      ".ev-page{background:#fff;color:#12384f;width:210mm;max-width:100%;min-height:297mm;margin:0 auto 18px;padding:16mm 15mm;box-shadow:var(--shadow);border:1px solid var(--border);position:relative}" +
      ".ev-page h2{font-size:17px;margin:4px 0 2px}.ev-page h3{font-size:13px;margin:14px 0 6px;color:#1b6fa8}" +
      ".ev-page .meta{font-size:11px;color:#456076;border-bottom:2px solid #1b6fa8;padding-bottom:8px;margin-bottom:10px;line-height:1.9}" +
      ".ev-page td,.ev-page th{text-align:right;direction:rtl}.ev-page td.n,.ev-page th.n{text-align:left;direction:ltr}.ev-page table{font-size:11px}.ev-page p,.ev-page li{font-size:12px;line-height:1.9}" +
      ".ev-page .foot{position:absolute;bottom:10mm;left:15mm;right:15mm;font-size:10px;color:#5a7085;border-top:1px solid #d6e2ed;padding-top:6px;display:flex;justify-content:space-between}" +
      ".ev-code{font-family:Menlo,Consolas,monospace;direction:ltr;unicode-bidi:isolate;background:#e8f1f8;border-radius:5px;padding:1px 7px}" +
      "@media print{body.aco-print .wrap>*:not(#app),body.aco-print #app>*:not(.panel.active),body.aco-print .tabs,body.aco-print .footer,body.aco-print #homeFab{display:none!important}" +
      "body.aco-print{background:#fff;padding:0}body.aco-print .aco-tools,body.aco-print .card.noprint{display:none!important}" +
      ".ev-page{box-shadow:none;border:0;margin:0;page-break-after:always;width:auto;min-height:auto;height:281mm}}" +
      "@media (max-width:600px){.ev-page{padding:8mm 6mm}.aco table{font-size:11px}}";
    document.head.appendChild(css);
  }

  // ── 📋 قائمة التدخل ──
  var W = { status: "open", payer: "", q: "", page: 0 };
  function renderWork(host) {
    var items = Object.keys(ST.items).map(function (k) { return ST.items[k]; });
    if (!items.length) {
      host.innerHTML = '<div class="card"><div class="sec-label">📋 قائمة التدخل</div><div class="note">' +
        "لا توجد " + NOUN + "ات عالية الخطر بعد. ارفع ملفاً في <b>«📂 التنبؤ بالملفات»</b>" +
        (CLAIMS ? "" : " — أو تصدير CareWare للموافقات مع ملف الأهلية") +
        "، فتُدرج هنا تلقائياً كل " + NOUN + " لم يصدر فيه قرار وتجاوز عتبة الخطر (" + card().threshold + ")، مرتبة بالمبلغ المعرّض للخطر.</div></div>";
      return;
    }
    var cnt = {}; Object.keys(STATUS).forEach(function (s) { cnt[s] = 0; });
    var riskOpen = 0;
    items.forEach(function (it) { cnt[it.status] = (cnt[it.status] || 0) + 1; if (it.status === "new") riskOpen += it.risk || 0; });
    var payers = {}; items.forEach(function (it) { var p = (it.dims && it.dims.payer) || "—"; payers[p] = (payers[p] || 0) + 1; });
    var list = items.filter(function (it) {
      if (W.status === "open" && it.status !== "new") return false;
      if (W.status !== "open" && W.status !== "all" && it.status !== W.status) return false;
      if (W.payer && ((it.dims && it.dims.payer) || "—") !== W.payer) return false;
      if (W.q && (it.k + " " + it.r1 + " " + JSON.stringify(it.dims)).toLowerCase().indexOf(W.q.toLowerCase()) < 0) return false;
      return true;
    }).sort(function (a, b) { return (b.risk || 0) - (a.risk || 0) || b.p - a.p; });
    var page = list.slice(W.page * 100, W.page * 100 + 100);
    var withY = items.filter(function (it) { return it.y != null; });

    var h = '<div class="card aco"><div class="sec-label">📋 قائمة التدخل — ' + NOUN + "ات عالية الخطر قبل الإرسال</div>" +
      '<div class="aco-kpis">' +
      kpi(f0(items.length), "في القائمة") + kpi(f0(cnt["new"]), "لم يُراجع بعد") + kpi(f0(cnt.fixed), "صُحح قبل الإرسال") +
      kpi(f0(cnt.asis), "أُرسل كما هو") + kpi(f0(cnt.referred), "أُحيل") + kpi(f0(riskOpen) + " ﷼", "معرّض للخطر — غير مُراجع") +
      kpi(f0(withY.length), "وصل قرارها الفعلي") + "</div>" +
      '<div class="aco-tools"><label>المستخدم <input id="awUser" value="' + esc(ST.user) + '" placeholder="اسمك (يظهر في السجل)" style="width:150px"></label>' +
      '<label>طاقة المراجعة اليومية <input id="awCap" type="number" min="5" max="1000" value="' + ST.capacity + '" style="width:70px"></label>' +
      '<label>الحالة <select id="awSt"><option value="open">لم يُراجع</option><option value="all">الكل</option>' +
      Object.keys(STATUS).filter(function (s) { return s !== "new"; }).map(function (s) { return '<option value="' + s + '">' + STATUS[s] + "</option>"; }).join("") +
      '</select></label><label>الجهة الدافعة <select id="awPay" style="max-width:220px"><option value="">الكل</option>' +
      Object.keys(payers).sort(function (a, b) { return payers[b] - payers[a]; }).slice(0, 40)
        .map(function (p) { return '<option ' + (p === W.payer ? "selected" : "") + ">" + esc(p) + "</option>"; }).join("") +
      '</select></label><input id="awQ" placeholder="بحث" value="' + esc(W.q) + '" style="width:120px">' +
      '<button class="btn ghost" id="awXlsx">⬇️ تصدير Excel</button><button class="btn ghost" id="awClear">مسح المُغلق</button></div>' +
      '<p style="font-size:11.5px;color:var(--muted2);margin-bottom:8px">أعلى <b>' + ST.capacity + "</b> " + NOUN +
      " في هذه القائمة هي حصّة اليوم حسب طاقة الفريق (العتبة لا تكفي وحدها لتحديد العبء). غيّر الحالة بعد مراجعة كل " + NOUN +
      "؛ تُسجَّل الحالة باسمك ووقتها، وحين يصل قرار الدافع في ملف لاحق يُقاس أثر التدخل تلقائياً.</p>" +
      '<div style="overflow-x:auto"><table class="aco-wl"><tr><th>#</th><th>المرجع</th><th class="n">الخطر</th><th class="n">المبلغ</th><th class="n">معرّض للخطر</th>' +
      "<th>السبب المرجّح والإجراء</th><th>الجهة / المنشأة</th><th>الحالة</th><th>ملاحظة</th><th>القرار الفعلي</th></tr>";
    page.forEach(function (it, i) {
      var n = W.page * 100 + i + 1;
      h += "<tr" + (n <= ST.capacity && it.status === "new" ? ' style="background:var(--accent-dim)"' : "") + "><td class=\"n\">" + n + "</td>" +
        '<td class="ref">' + esc(String(it.k).replace(/^id:/, "")) + "</td>" +
        '<td class="n"><b style="color:' + (it.p >= 0.65 ? "var(--red)" : "var(--yellow)") + '">' + pc(it.p, 0) + "</b></td>" +
        '<td class="n">' + f2(it.a) + '</td><td class="n">' + f2(it.risk) + "</td>" +
        '<td class="rsn"><b>' + esc(it.r1) + '</b><br><span style="font-size:11px;color:var(--muted2)">' + esc(it.act1) + "</span></td>" +
        '<td class="who">' + esc(it.dims && it.dims.payer) + "<br>" + esc(it.dims && it.dims.hospital) + "</td>" +
        '<td><select data-k="' + esc(it.k) + '" class="awS">' + Object.keys(STATUS).map(function (s) {
          return '<option value="' + s + '"' + (s === it.status ? " selected" : "") + ">" + STATUS[s] + "</option>"; }).join("") + "</select>" +
        (it.owner ? '<br><span style="font-size:10.5px;color:var(--muted)">' + esc(it.owner) + " · " + esc(it.stTs) + "</span>" : "") + "</td>" +
        '<td><input data-k="' + esc(it.k) + '" class="awN" value="' + esc(it.note) + '" style="width:120px"></td>' +
        "<td>" + (it.y == null ? '<span style="color:var(--muted)">بانتظار</span>' :
          it.y ? '<span class="aco-pill bad">لم يُقبل كاملاً</span>' : '<span class="aco-pill ok">قُبل كاملاً</span>') + "</td></tr>";
    });
    h += "</table></div>";
    if (list.length > 100) h += '<div class="aco-tools">' + (W.page ? '<button class="btn ghost" id="awPrev">السابق</button>' : "") +
      "<span>" + f0(W.page * 100 + 1) + "–" + f0(Math.min(list.length, W.page * 100 + 100)) + " من " + f0(list.length) + "</span>" +
      ((W.page + 1) * 100 < list.length ? '<button class="btn ghost" id="awNext">التالي</button>' : "") + "</div>";
    h += "</div>";
    host.innerHTML = h;
    $("awSt").value = W.status;
    $("awUser").onchange = function () { ST.user = this.value.trim(); save(); };
    $("awCap").onchange = function () { ST.capacity = Math.max(5, Math.min(1000, +this.value || 50)); save(); renderWork(host); };
    $("awSt").onchange = function () { W.status = this.value; W.page = 0; renderWork(host); };
    $("awPay").onchange = function () { W.payer = this.value; W.page = 0; renderWork(host); };
    $("awQ").onchange = function () { W.q = this.value.trim(); W.page = 0; renderWork(host); };
    if ($("awPrev")) $("awPrev").onclick = function () { W.page--; renderWork(host); };
    if ($("awNext")) $("awNext").onclick = function () { W.page++; renderWork(host); };
    host.querySelectorAll(".awS").forEach(function (s) {
      s.onchange = function () {
        var it = ST.items[s.dataset.k]; if (!it) return;
        if (!ST.user) { alertInline(host, "اكتب اسمك في خانة «المستخدم» أولاً — كل تغيير حالة يُسجَّل باسم من نفّذه."); s.value = it.status; return; }
        var old = it.status; it.status = s.value; it.owner = ST.user; it.stTs = nowS();
        logEv("تغيير حالة التدخل", String(it.k).replace(/^id:/, "") + ": " + STATUS[old] + " ← " + STATUS[it.status]);
        save(); renderWork(host);
      };
    });
    host.querySelectorAll(".awN").forEach(function (n) {
      n.onchange = function () { var it = ST.items[n.dataset.k]; if (!it) return; it.note = n.value.slice(0, 300); save(); };
    });
    $("awXlsx").onclick = exportWork;
    $("awClear").onclick = function () {
      var n = 0;
      Object.keys(ST.items).forEach(function (k) { var it = ST.items[k]; if (it.status !== "new" && it.y != null && it.yTs && it.yTs.slice(0, 7) < today().slice(0, 7)) { delete ST.items[k]; n++; } });
      logEv("مسح المُغلق", n + " " + NOUN + " (حالة نهائية وقرار فعلي من شهر سابق)"); save(); renderWork(host);
    };
  }
  function kpi(v, l) { return '<div class="aco-kpi"><b>' + v + "</b><span>" + l + "</span></div>"; }
  function alertInline(host, msg) {
    var d = document.createElement("div"); d.className = "err"; d.style.margin = "8px 0"; d.textContent = msg;
    host.querySelector(".card").insertBefore(d, host.querySelector(".card").children[1]);
    setTimeout(function () { d.remove(); }, 5000);
  }
  function loadXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise(function (res, rej) {
      var s = document.createElement("script"); s.src = "assets/vendor/xlsx.full.min.js";
      s.onload = function () { res(window.XLSX); }; s.onerror = function () { rej(new Error("تعذّر تحميل SheetJS")); };
      document.head.appendChild(s);
    });
  }
  function exportWork() {
    loadXLSX().then(function (XLSX) {
      var rows = [["المرجع", "احتمال عدم القبول الكامل", "المبلغ", "المعرّض للخطر", "السبب المرجّح", "الإجراء المقترح", "الجهة الدافعة",
                   "المنشأة", "القسم/النوع", "الحالة", "المسؤول", "وقت الحالة", "ملاحظة", "القرار الفعلي", "تاريخ الإدراج", "الملف"]];
      Object.keys(ST.items).map(function (k) { return ST.items[k]; }).sort(function (a, b) { return b.risk - a.risk; }).forEach(function (it) {
        rows.push([String(it.k).replace(/^id:/, ""), Math.round(it.p * 1000) / 1000, it.a, it.risk, it.r1, it.act1,
          it.dims && it.dims.payer, it.dims && it.dims.hospital, it.dims && it.dims.unit, STATUS[it.status], it.owner, it.stTs, it.note,
          it.y == null ? "بانتظار" : it.y ? "لم يُقبل كاملاً" : "قُبل كاملاً", it.added, it.file]);
      });
      var wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] };
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "قائمة التدخل");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["الوقت", "المستخدم", "الإجراء", "التفاصيل"]].concat(
        ST.log.map(function (l) { return [l.ts, l.user, l.action, l.detail]; }))), "سجل التدقيق");
      XLSX.writeFile(wb, "ARCH-Predict-" + STAGE + "-worklist-" + today() + ".xlsx");
    });
  }

  // ── أثر التدخل: نسبة عدم القبول الفعلية حسب حالة التدخل ──
  function impact() {
    var g = {};
    Object.keys(ST.items).forEach(function (k) {
      var it = ST.items[k]; if (it.y == null) return;
      var v = g[it.status] || (g[it.status] = { n: 0, bad: 0, p: 0, risk: 0 });
      v.n++; v.bad += it.y; v.p += it.p; v.risk += it.risk || 0;
    });
    return Object.keys(STATUS).filter(function (s) { return g[s]; }).map(function (s) {
      var v = g[s]; return { s: s, ar: STATUS[s], n: v.n, rate: v.bad / v.n, meanP: v.p / v.n };
    });
  }

  // ── 📡 مراقبة النموذج ──
  function renderMon(host) {
    var c = card(), last = ST.monitor[ST.monitor.length - 1], imp = impact(), lastRun = ST.runs[ST.runs.length - 1];
    var h = '<div class="card aco"><div class="sec-label">📡 مراقبة النموذج بعد النشر</div>' +
      '<p style="font-size:12.5px;color:var(--muted2);line-height:1.9;margin-bottom:10px">كل ملف يُرفع في «التنبؤ بالملفات» ويحمل عمود القرار الفعلي ' +
      "(<code>" + (CLAIMS ? "Claim Status" : "Approval Status / حالة رفع طلب الموافقة") + "</code>) يُقاس عليه النموذج: هل ما زال يميّز " +
      NOUN + "ات الخاسرة كما وعدت بطاقته؟ الأرقام تُحسب على جهازك ولا تغادره.</p>";
    h += '<table><tr><th>المقياس</th><th class="n">بطاقة النموذج</th><th class="n">آخر قياس فعلي</th><th class="n">الفرق</th></tr>' +
      monRow("AUC (التمييز)", c.auc, last && last.auc, true) +
      monRow("التقاط غير المقبول كاملاً (Recall) عند العتبة " + c.threshold, c.recall, last && last.recall) +
      monRow("دقة الإنذار (Precision)", c.precision, last && last.precision) +
      monRow("نسبة عدم القبول الفعلية", NaN, last && last.base) +
      monRow("متوسط الاحتمال المتوقع (المعايرة)", NaN, last && last.meanP) +
      "</table>";
    h += '<p style="font-size:11.5px;color:var(--muted);margin-top:6px">إصدار النموذج: ' + esc(c.generated) + " · فترة التدريب " +
      esc(c.from || "—") + " → " + esc(c.to || "—") + " · " + f0(c.n) + " " + NOUN + " ذات قرار" +
      (last ? " · آخر قياس " + esc(last.ts) + " على " + f0(last.n) + " " + NOUN + " (" + esc(last.file) + ")" : "") + "</p>";
    if (!last) h += '<div class="note">لا يوجد قياس فعلي بعد. ارفع ملفاً فيه ' + NOUN + "ات صدر فيها القرار (100 على الأقل، منها 20 من كل فئة).</div>";
    else {
      h += last.alerts.length ? '<div class="err" style="margin-top:10px"><b>⚠ محفّز إعادة التدريب:</b> ' + last.alerts.map(esc).join("؛ ") +
        ". اتبع إجراء إعادة التدريب أدناه.</div>" :
        '<div class="note" style="border-color:var(--green)"><b style="color:var(--green)">✔ الأداء ضمن الحدود.</b> لا يلزم إعادة تدريب الآن.</div>';
      h += "<h4 style=\"margin:14px 0 6px;font-size:13px\">الأداء حسب الشهر (آخر قياس)</h4>" + table(["الشهر", "العدد", "نسبة عدم القبول", "متوسط المتوقع", "AUC"],
        last.months.map(function (r) { return [r.m, f0(r.n), pc(r.base), pc(r.meanP), d3(r.auc)]; }));
      h += "<h4 style=\"margin:14px 0 6px;font-size:13px\">حسب الجهة الدافعة (أعلى 8 حجماً)</h4>" + table(["الجهة", "العدد", "الفعلي", "المتوقع", "AUC"],
        last.payers.map(function (r) { return [r.k, f0(r.n), pc(r.base), pc(r.meanP), d3(r.auc)]; }));
      if (last.elig && last.elig.length) h += "<h4 style=\"margin:14px 0 6px;font-size:13px\">نتيجة فحص الأهلية مقابل القرار الفعلي</h4>" +
        table(["حالة الأهلية", "العدد", "نسبة عدم القبول"], last.elig.map(function (r) { return [eligAr(r.k), f0(r.n), pc(r.base)]; }));
    }
    h += "<h4 style=\"margin:14px 0 6px;font-size:13px\">أثر التدخل — القرار الفعلي حسب ما فعله الفريق</h4>" +
      (imp.length ? table(["حالة التدخل", "وصل قرارها", "متوسط الخطر المتوقع", "لم يُقبل كاملاً فعلياً"],
        imp.map(function (r) { return [r.ar, f0(r.n), pc(r.meanP), pc(r.rate)]; })) +
        '<p style="font-size:11.5px;color:var(--muted)">المقارنة الأمينة بين «صُحح» و«أُرسل كما هو» لطلبات بخطر متوقع متقارب. الفرق مؤشر لا برهان سببي، ويقوى مع تراكم الأشهر.</p>' :
        '<div class="note">يظهر حين يصل قرار الدافع لطلبات سبق إدراجها في «قائمة التدخل» (ارفع ملف الشهر التالي).</div>');
    h += "<h4 style=\"margin:14px 0 6px;font-size:13px\">انجراف البيانات (PSI لتوزيع الدرجات)</h4>" +
      (lastRun ? "<p style=\"font-size:12px\">آخر ملف مقابل المرجع (" + esc(ST.ref.file) + " · " + esc(ST.ref.ts) + "): <b>PSI = " + d3(lastRun.psi) +
        "</b> — " + (!num(lastRun.psi) ? "—" : lastRun.psi < 0.1 ? "مستقر" : lastRun.psi < 0.25 ? "تغيّر متوسط — راقب" : "انجراف كبير") +
        ' <button class="btn ghost" id="amRef" style="width:auto;padding:5px 12px">اجعل آخر ملف هو المرجع</button></p>' : '<p style="font-size:12px">لم يُرفع ملف بعد.</p>');
    h += "<h4 style=\"margin:14px 0 6px;font-size:13px\">سجل القياسات</h4>" + (ST.monitor.length ? table(["الوقت", "الملف", "العدد", "AUC", "Recall", "PSI", "تنبيه"],
      ST.monitor.slice().reverse().map(function (m) { return [m.ts, m.file, f0(m.n), d3(m.auc), pc(m.recall), d3(m.psi), m.alerts.length ? "⚠ " + m.alerts.length : "—"]; })) : "<p style=\"font-size:12px\">—</p>");
    h += '<div class="note" style="margin-top:12px"><b>حوكمة إعادة التدريب (Model Governance):</b><ol class="steps" style="margin-top:6px">' +
      "<li><b>المحفّزات:</b> انخفاض AUC ≥ 0.05 عن البطاقة، أو PSI ≥ 0.25، أو انخفاض الالتقاط 10 نقاط، أو مرور ربع سنة على آخر تدريب.</li>" +
      "<li><b>البيانات:</b> تصدير CareWare للموافقات + الأهلية لآخر 6–9 أشهر، مباشرةً دون تعديل: <code dir=\"ltr\">python3 model/train_model.py --approvals APPROVALS.xlsx --eligibility ELIGIBILITY.xlsx</code></li>" +
      "<li><b>القبول:</b> تقسيم زمني، ونموذج جديد لا يقل AUC فيه عن الحالي على نفس فترة الاختبار، ومطابقة محرّك المتصفح لبايثون.</li>" +
      "<li><b>النشر:</b> نسخة مؤرخة من الحزمة الحالية للتراجع، ثم استبدال <code>model/artifacts/*_bundle.js</code>، وتسجيل الإصدار هنا.</li>" +
      "<li><b>المالك:</b> محلل بيانات RCM، والاعتماد من مدير دورة الإيراد.</li></ol></div>";
    h += "</div>";
    host.innerHTML = h;
    if ($("amRef")) $("amRef").onclick = function () { ST.ref = { ts: lastRun.ts, file: lastRun.file, hist: lastRun.hist }; logEv("تغيير مرجع الانجراف", lastRun.file); save(); renderMon(host); };
  }
  function eligAr(k) {
    return { eligible: "مؤهل (مكتمل)", error: "خطأ في الفحص", unknown: "لم يُفحص / غير مربوط", not_active: "التغطية غير سارية",
             out_network: "خارج الشبكة", not_covered: "غير مغطى", other: "أخرى", not_direct_billing: "فوترة غير مباشرة" }[k] || k;
  }
  function monRow(l, a, b, isAuc) {
    var fmt = isAuc ? d3 : function (x) { return pc(x); }, dd = num(a) && num(b) ? b - a : NaN;
    return "<tr><td>" + l + '</td><td class="n">' + fmt(a) + '</td><td class="n">' + fmt(b) +
      '</td><td class="n" style="color:' + (dd < -0.03 ? "var(--red)" : "inherit") + '">' + (num(dd) ? (dd >= 0 ? "+" : "") + (isAuc ? dd.toFixed(3) : (dd * 100).toFixed(1) + " نقطة") : "—") + "</td></tr>";
  }
  function table(heads, rows) {
    return '<div style="overflow-x:auto"><table><tr>' + heads.map(function (x, i) { return "<th" + (i ? ' class="n"' : "") + ">" + x + "</th>"; }).join("") + "</tr>" +
      rows.map(function (r) { return "<tr>" + r.map(function (v, i) { return "<td" + (i ? ' class="n"' : "") + ">" + esc(v) + "</td>"; }).join("") + "</tr>"; }).join("") + "</table></div>";
  }

  // ── 📄 دليل ACO ──
  var REQ = {
    "3RCM5.3.4": { en: "Pre-Authorization and Service Validation Automation", ar: "أتمتة الموافقة المسبقة والتحقق من الخدمة",
      ev: "4.A Pre-Authorization Integration: Early integration of payer authorization APIs into the pre-authorization and service validation processes." },
    "3RCM5.5.2": { en: "Denial Prevention and Management — Predictive Denial Analytics", ar: "منع الرفض وإدارته — التحليلات التنبؤية للرفض",
      ev: "2.A Predictive Denial Analytics: implementation of predictive analytics to identify high-risk claims, with a basic intervention process in place." },
    "3RCM5.1.5": { en: "Denial Prevention and Appeals Management", ar: "منع الرفض وإدارة الاعتراضات",
      ev: "5.A Denial Prevention Documentation: Records showing denial prevention measures being implemented, with predictive analytics used for identifying trends." },
    "3RCM5.2.5": { en: "Early Analytics Integration", ar: "دمج التحليلات التنبؤية مبكراً",
      ev: "5.A Predictive Analytics Trials: Documentation showing use of predictive analytics for denial prevention and revenue forecasting." },
    "3RCM5.2.3": { en: "Automation Introduction", ar: "إدخال الأتمتة",
      ev: "3.A Automation Records: Evidence of the introduction of automated claims management and denial prevention workflows, with basic system reports." },
    "3RCM5.5.1": { en: "Claim Submission — Basic Claims Scrubbing", ar: "تقديم المطالبات — الفحص الآلي قبل الإرسال",
      ev: "1.A Basic Claims Scrubbing Tools: deployment of machine learning tools for claims scrubbing, with documentation showing error reduction." },
    "3RCM7.2.2": { en: "Claim Review Pilot Leveraging Technology", ar: "مراجعة المطالبات بالتقنية — تجريبي",
      ev: "2. Claim Review Data: Claim reviews reports, showing accuracy rates and identifying issues for improvement." },
  };
  function org() {
    var o = window.ARCH_ORG || {};
    return { name: o.name || "", unit: o.unit || "" };
  }
  var EVSEL = null;
  function renderEv(host) {
    EVSEL = EVSEL || REQS[0];
    var h = '<div class="card noprint aco"><div class="sec-label">📄 صفحات دليل ACO — بأرقام هذا الجهاز</div>' +
      '<div class="aco-tools">' + REQS.map(function (r) {
        return '<button class="btn ' + (r === EVSEL ? "" : "ghost") + '" data-r="' + r + '"><span class="ev-code">' + r + "</span></button>"; }).join("") +
      '<button class="btn ghost" data-r="all">الكل</button><button class="btn" id="evPrint">🖨 طباعة / حفظ PDF</button></div>' +
      '<p style="font-size:11.5px;color:var(--muted2)">كل صفحة مؤرخة وتحمل رمز المتطلب ونص الدليل حرفياً ومصدر الأرقام. لا تظهر فيها أي بيانات مريض. ' +
      (org().name ? "" : "اسم الجهة يُضبط في <code>assets/site-config.js</code> ← <code>ARCH_ORG</code>.") + "</p></div>" +
      '<div id="evPages">' + (EVSEL === "all" ? REQS : [EVSEL]).map(page).join("") + "</div>";
    host.innerHTML = h;
    host.querySelectorAll("[data-r]").forEach(function (b) { b.onclick = function () { EVSEL = b.dataset.r; renderEv(host); }; });
    $("evPrint").onclick = function () {
      document.body.classList.add("aco-print");
      setTimeout(function () { window.print(); }, 50);
    };
  }
  window.addEventListener("afterprint", function () { document.body.classList.remove("aco-print"); });

  function page(code) {
    var R = REQ[code], c = card(), o = org(), items = Object.keys(ST.items).map(function (k) { return ST.items[k]; });
    var last = ST.monitor[ST.monitor.length - 1], imp = impact();
    var runs = ST.runs, m0 = "", m1 = "";
    runs.forEach(function (r) { if (r.m0 && (!m0 || r.m0 < m0)) m0 = r.m0; if (r.m1 && (!m1 || r.m1 > m1)) m1 = r.m1; });
    var period = m0 ? (m0 === m1 ? m0 : m0 + " → " + m1) : "—";
    var nScored = runs.reduce(function (s, r) { return s + r.n; }, 0), nFlag = runs.reduce(function (s, r) { return s + r.flagged; }, 0);
    var cnt = {}; items.forEach(function (it) { cnt[it.status] = (cnt[it.status] || 0) + 1; });
    var reviewed = items.length - (cnt["new"] || 0);
    var reasons = {}; items.forEach(function (it) { if (!it.r1) return; var v = reasons[it.r1] || (reasons[it.r1] = { n: 0, risk: 0, act: it.act1 }); v.n++; v.risk += it.risk || 0; });
    var topR = Object.keys(reasons).sort(function (a, b) { return reasons[b].risk - reasons[a].risk; }).slice(0, 6);
    var h = '<div class="ev-page" dir="rtl"><div class="meta"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px">' +
      '<div><b style="font-size:14px;color:#12384f" dir="ltr">ARCH Predict</b> · ' + (CLAIMS ? "مرحلة المطالبات" : "مرحلة الموافقات المسبقة") + "</div>" +
      '<span class="ev-code" style="font-size:13px">' + code + "</span></div>" +
      "<h2 dir=\"ltr\" style=\"text-align:left\">" + R.en + "</h2><div style=\"font-size:13px;font-weight:700\">" + R.ar + "</div>" +
      (o.name ? "الجهة: <b>" + esc(o.name) + "</b>" + (o.unit ? " — " + esc(o.unit) : "") + " · " : "") +
      "فترة البيانات (أشهر الزيارة): " + esc(period) + " · الملفات المعالجة: " + f0(runs.length) + " · تاريخ التوليد: " + nowS() + " · إصدار النموذج: " + esc(c.generated) + "</div>" +
      '<p dir="ltr" style="text-align:left;font-size:11px;background:#f6f9fc;border:1px solid #d6e2ed;border-radius:6px;padding:7px 9px"><b>Evidence:</b> ' + esc(R.ev) + "</p>";
    var flow = "<ol style=\"padding-right:18px\"><li>تصدير CareWare (" + (CLAIMS ? "المطالبات" : "الموافقات + الأهلية") + ") يُرفع كما هو؛ تُحذف أعمدة الهوية عند القراءة.</li>" +
      "<li>يُقدَّر لكل " + NOUN + " احتمال عدم القبول الكامل وأرجح 3 أسباب مع إجراء تصحيحي (LightGBM + SHAP).</li>" +
      "<li>ما تجاوز العتبة (" + c.threshold + ") ولم يصدر فيه قرار يدخل «قائمة التدخل» مرتباً بالمبلغ المعرّض للخطر، بحصة يومية = طاقة الفريق (" + ST.capacity + ").</li>" +
      "<li>المراجع يصحّح أو يرسل كما هو أو يحيل، وتُسجَّل الحالة باسمه ووقتها.</li>" +
      "<li>قرار الدافع في الملف اللاحق يقيس أثر التدخل وأداء النموذج، ويطلق إعادة التدريب عند الحاجة.</li></ol>";
    var kp = table(["المؤشر", "القيمة"], [
      [NOUN + "ات سُجّلت بالنموذج", f0(nScored)], ["فوق عتبة الخطر", f0(nFlag) + (nScored ? " (" + pc(nFlag / nScored) + ")" : "")],
      ["في قائمة التدخل", f0(items.length)], ["رُوجعت (أي حالة غير «لم يُراجع»)", f0(reviewed) + (items.length ? " (" + pc(reviewed / items.length) + ")" : "")],
      ["صُححت قبل الإرسال", f0(cnt.fixed || 0)], ["عدد الملفات المعالجة", f0(runs.length)]]);
    var mon = last ? table(["المقياس", "بطاقة النموذج", "الفعلي بعد النشر"], [
      ["AUC", d3(c.auc), d3(last.auc)], ["Recall «غير مقبول كاملاً»", pc(c.recall), pc(last.recall)], ["Precision", pc(c.precision), pc(last.precision)],
      ["نسبة عدم القبول الفعلية", "—", pc(last.base)], [NOUN + "ات القياس", f0(c.n), f0(last.n) + " (" + esc(last.ts.slice(0, 10)) + ")"]]) +
      (last.alerts.length ? '<p style="color:#c4362f"><b>تنبيه مفتوح:</b> ' + last.alerts.map(esc).join("؛ ") + " — إعادة التدريب مُجدولة وفق إجراء الحوكمة.</p>" : "") :
      "<p>لم يُسجَّل قياس فعلي بعد على هذا الجهاز — يُضاف عند رفع أول ملف يحمل القرار الفعلي.</p>";
    var impT = imp.length ? table(["حالة التدخل", "وصل قرارها", "الخطر المتوقع", "لم يُقبل كاملاً فعلياً"], imp.map(function (r) { return [r.ar, f0(r.n), pc(r.meanP), pc(r.rate)]; })) :
      "<p>يُقاس حين يصل قرار الدافع لطلبات القائمة (الملف اللاحق).</p>";
    var reasonT = topR.length ? table(["السبب المرجّح", "العدد", "المعرّض للخطر ﷼", "الإجراء الوقائي"], topR.map(function (k) { return [k, f0(reasons[k].n), f0(reasons[k].risk), reasons[k].act]; })) : "<p>—</p>";
    var trend = last ? table(["الشهر", "العدد", "عدم القبول الفعلي", "المتوقع"], last.months.map(function (r) { return [r.m, f0(r.n), pc(r.base), pc(r.meanP)]; })) : "";
    var algos = (c.comparison || []).slice(0, 8).map(function (r) { return [r.model, d3(r.roc_auc), pc(r.recall_nfa != null ? r.recall_nfa : r.recall_nfp)]; });

    if (code === "3RCM5.5.2" || code === "3RCM5.5.1") {
      h += "<h3>كيف يعمل التحديد والتدخل</h3>" + flow + "<h3>مؤشرات الفترة</h3>" + kp + "<h3>أثر التدخل</h3>" + impT +
        (code === "3RCM5.5.1" ? "<h3>أنماط الأخطاء الأعلى أثراً (للتصحيح قبل الإرسال)</h3>" + reasonT : "");
    } else if (code === "3RCM5.3.4") {
      h += "<h3>التحقق من الطلب قبل إرساله للدافع</h3><p>كل طلب موافقة يُقيَّم قبل الإرسال عبر NPHIES: احتمال عدم الموافقة الكاملة، وأرجح سبب (أهلية، شبكة، تغطية، مبرر طبي، تسعير/ترميز…) مع إجراء التصحيح. الربط مع فحص الأهلية يتم بـ Encounter Number من تصدير الأهلية.</p>" +
        (last && last.elig && last.elig.length ? "<h3>نتيجة فحص الأهلية مقابل قرار الدافع</h3>" + table(["حالة الأهلية", "العدد", "لم يُقبل كاملاً"], last.elig.map(function (r) { return [eligAr(r.k), f0(r.n), pc(r.base)]; })) : "") +
        "<h3>مؤشرات الفترة</h3>" + kp +
        '<p style="font-size:11px;color:#456076"><b>حدود الدليل:</b> المنصّة طبقة تحقق قبل الإرسال؛ الإرسال الفعلي وتبادل الرد مع الدافع يتم عبر تكامل CareWare–NPHIES (FHIR). يُرفق مع هذه الصفحة دليل التكامل من تقنية المعلومات.</p>';
    } else if (code === "3RCM5.1.5") {
      h += "<h3>إجراءات منع الرفض المطبّقة</h3>" + flow + "<h3>الأسباب المتوقعة الأعلى أثراً والإجراء الوقائي</h3>" + reasonT +
        (trend ? "<h3>الاتجاه الشهري (الفعلي مقابل المتوقع)</h3>" + trend : "");
    } else if (code === "3RCM5.2.5" || code === "3RCM7.2.2") {
      h += "<h3>النموذج ومقارنة الخوارزميات (تقسيم زمني)</h3>" + (algos.length ? table(["الخوارزمية", "AUC", "Recall"], algos) : "") +
        "<p style=\"font-size:11px\">فترة التدريب " + esc(c.from || "—") + " → " + esc(c.to || "—") + " · " + f0(c.n) + " " + NOUN + " ذات قرار · العتبة " + c.threshold + "</p>" +
        "<h3>الدقة بعد النشر (مراقبة)</h3>" + mon + (code === "3RCM7.2.2" ? "<h3>المشكلات المتكررة للتحسين</h3>" + reasonT : "") +
        "<h3>حوكمة النموذج</h3><p>محفزات إعادة التدريب: انخفاض AUC ≥ 0.05، PSI ≥ 0.25، أو كل ربع سنة. الإصدارات السابقة محفوظة للتراجع، والتدريب بتصدير CareWare مباشرةً.</p>";
    } else if (code === "3RCM5.2.3") {
      h += "<h3>سير العمل المؤتمت</h3>" + flow + "<h3>سجل التشغيل (آخر 12 ملفاً)</h3>" +
        table(["الوقت", "الملف", "العدد", "فوق العتبة", "أُضيف للقائمة", "قياس"], runs.slice(-12).reverse().map(function (r) {
          return [r.ts, r.file, f0(r.n), f0(r.flagged), f0(r.added), r.evaluated ? "✔" : "—"]; })) +
        "<h3>سجل التدقيق (آخر 10 إجراءات)</h3>" + table(["الوقت", "المستخدم", "الإجراء"], ST.log.slice(-10).reverse().map(function (l) { return [l.ts, l.user, l.action]; }));
    }
    h += '<div class="foot"><span>مصدر الأرقام: ملفات CareWare المعالجة على هذا الجهاز (' + f0(runs.length) + " ملف) · لا بيانات مريض في هذه الصفحة</span>" +
      '<span dir="ltr">ARCH Predict · ARCH Systems · Built and Developed by: Hani Alsulami</span></div></div>';
    return h;
  }

  window.ARCHACO = { onBatch: onBatch, outcomeIndex: outcomeIndex, outcome: outcome, month: month,
                     _state: function () { return ST; }, _evaluate: evaluate, _auc: aucOf };

  function boot() { if ($("tabs") && $("app")) addTabs(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
