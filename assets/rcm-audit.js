/*!
 * rcm-audit.js — تتبّع السلوك والاستجابة (Audit Trail) + لوحة القيادة (Admin)
 * ARCH Predict · ARCH Systems
 *
 * وحدة مشتركة لصفحتي الموافقات والمطالبات:
 *   • تسجّل جلسات التنبؤ عالية الخطر واستجابة المستخدم (تطبيق الإجراء / تجاهل)
 *     في Google Sheets عبر تطبيق ويب Google Apps Script (audit/Code.gs).
 *   • تضيف تبويب «🛡 لوحة القيادة» محمياً برقم سري يعرض المقاييس التراكمية
 *     من جميع الأجهزة.
 *
 * ▸ أين أضع رابط Web App؟ في assets/site-config.js:
 *     window.NAMAA_AUDIT = { url: "https://script.google.com/macros/s/XXXX/exec" };
 *   ما دام الرابط فارغاً تبقى الميزة صامتة تماماً (لا أزرار ولا إرسال).
 *
 * الخصوصية: لا يُرسَل أي معرّف شخصي — فقط أرقام الخطر وقيمة الفاتورة ونوع
 * الاستجابة ومعرّف جهاز عشوائي. والرقم السري للوحة حاجز تنظيمي لا حماية
 * حقيقية: كل ما في موقع ثابت قابل للقراءة، فلا تضع في الشيت ما هو سرّي فعلاً.
 */
(function () {
  "use strict";

  var CFG = window.NAMAA_AUDIT || {};
  var URL_ = (CFG.url || "").trim();
  var TOKEN = CFG.token || "";
  // SHA-256 للرقم السري (الافتراضي: Admin2026). لتغييره: نفّذ في Console
  //   RCMAudit.hash("رقمك الجديد").then(console.log)
  // وضع الناتج في site-config.js: window.NAMAA_AUDIT = { ..., pinHash: "..." }
  var PIN_HASH = CFG.pinHash || "059a50ce956b7ec61527c7ecc0c55b5a009dc54ab4acddce8852b46baa2aba30";

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g,
    function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function fmt(n, d) { d = d == null ? 0 : d;
    return (isFinite(n) ? n : 0).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); }

  // ══════════════════════════════════════════════════════════════
  // 1. الجلسة والجهاز
  // ══════════════════════════════════════════════════════════════
  function deviceId() {
    try {
      var id = localStorage.getItem("namaa.device");
      if (!id) {
        id = "D-" + Math.random().toString(36).slice(2, 10).toUpperCase();
        localStorage.setItem("namaa.device", id);
      }
      return id;
    } catch (e) { return "D-UNKNOWN"; }
  }

  // جلسة واحدة = حالة يعمل عليها المستخدم: تبدأ بأول تنبؤ وتنتهي بالاستجابة.
  var SESSION = null;

  function newRef() {
    return "NA-" + Date.now().toString(36).toUpperCase() +
           Math.random().toString(36).slice(2, 5).toUpperCase();
  }

  // ══════════════════════════════════════════════════════════════
  // 2. الإرسال — fetch إلى Web App URL بترويسة text/plain
  //    (طلب «بسيط» بلا CORS preflight، وهو ما تتطلبه تطبيقات Apps Script)
  //    الفشل لا يُفقد الحدث: يُصفّ في localStorage ويُعاد إرساله لاحقاً.
  // ══════════════════════════════════════════════════════════════
  var QKEY = "namaa.audit.queue";

  // مرآة محلية لكل حدث — احتياط يُبقي لوحة القيادة تعمل بلا خادم تتبّع
  // (تغطي أحداث هذا الجهاز وحده، وتُعرض مع تنبيه صريح بذلك)
  var LKEY = "namaa.audit.local";
  function localSave(payload) {
    try {
      var a = JSON.parse(localStorage.getItem(LKEY) || "[]");
      a.push({ ts: new Date().toISOString(), ref: payload.ref, stage: payload.stage,
               initialRisk: payload.initialRisk, finalRisk: payload.finalRisk,
               amount: Number(payload.amount) || 0, response: payload.response,
               device: payload.device });
      localStorage.setItem(LKEY, JSON.stringify(a.slice(-4000)));
    } catch (e) { /* التخزين ممتلئ — المرآة اختيارية */ }
  }
  function localRows() {
    try { return JSON.parse(localStorage.getItem(LKEY) || "[]"); } catch (e) { return []; }
  }

  function post(payload) {
    if (!URL_) return Promise.resolve(false);
    localSave(payload);
    payload.token = TOKEN || undefined;
    return fetch(URL_, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      redirect: "follow",
    }).then(function (r) { return r.ok; })
      .catch(function () { enqueue(payload); return false; });
  }

  function enqueue(payload) {
    try {
      var q = JSON.parse(localStorage.getItem(QKEY) || "[]");
      q.push(payload);
      localStorage.setItem(QKEY, JSON.stringify(q.slice(-50)));
    } catch (e) { /* التخزين ممتلئ — يُتجاوز */ }
  }

  function flushQueue() {
    if (!URL_) return;
    var q;
    try { q = JSON.parse(localStorage.getItem(QKEY) || "[]"); } catch (e) { return; }
    if (!q.length) return;
    try { localStorage.removeItem(QKEY); } catch (e) { /* */ }
    q.forEach(function (p) { post(p); });
  }

  function eventPayload(response) {
    return {
      ref: SESSION.ref,
      stage: SESSION.stage,
      initialRisk: Math.round(SESSION.initialRisk * 1000) / 10,   // نسبة مئوية
      finalRisk: Math.round(SESSION.finalRisk * 1000) / 10,
      amount: isFinite(SESSION.amount) ? Math.round(SESSION.amount * 100) / 100 : "",
      response: response,
      device: deviceId(),
    };
  }

  // ══════════════════════════════════════════════════════════════
  // 3. منطق التتبّع — تستدعيه صفحتا التنبؤ بعد كل تنبّؤ يدوي
  // ══════════════════════════════════════════════════════════════
  /**
   * onPredict(stage, risk, amount, threshold)
   *   stage: "approvals" | "claims" · risk: احتمال عدم الاكتمال 0..1
   * أول تنبؤ يفتح جلسة ويُسجَّل صفاً بنوع "prediction"؛ التنبؤات التالية
   * تحدّث الخطر النهائي فقط (المستخدم يحسّن مدخلاته قبل أن يستجيب).
   */
  function onPredict(stage, risk, amount, threshold) {
    if (!URL_) return;
    if (!SESSION || SESSION.stage !== stage || SESSION.responded) {
      SESSION = { ref: newRef(), stage: stage, initialRisk: risk,
                  finalRisk: risk, amount: amount, threshold: threshold, responded: false };
      post(eventPayload("prediction"));
    } else {
      SESSION.finalRisk = risk;
      if (isFinite(amount)) SESSION.amount = amount;
    }
    renderButtons(risk, threshold);
  }

  function respond(type) {
    if (!SESSION || SESSION.responded) return;
    SESSION.responded = true;
    post(eventPayload(type));
    var box = $("auditBox");
    if (box) box.innerHTML = '<div class="tip ok" style="margin-top:10px"><strong>' +
      (type === "applied" ? "✅ سُجِّل تطبيق الإجراء" : "✖ سُجِّل التجاهل") +
      "</strong> — شكراً، استجابتك تُحسِّن قياس أثر المنصّة.</div>";
  }

  /** أزرار الاستجابة تحت بطاقة النتيجة — تظهر فقط حين يتجاوز الخطر العتبة */
  function renderButtons(risk, threshold) {
    var card = $("result");
    if (!card) return;
    var box = $("auditBox");
    if (!box) {
      box = document.createElement("div");
      box.id = "auditBox";
      card.appendChild(box);
    }
    if (risk < (threshold || 0.5) || SESSION.responded) { box.innerHTML = ""; return; }
    box.innerHTML =
      '<div style="margin-top:12px;padding-top:12px;border-top:1px dashed var(--border)">' +
      '<div style="font-size:12px;color:var(--muted2);margin-bottom:8px">📋 <b>تتبّع الاستجابة:</b> ' +
      "ما قرارك حيال هذا الإنذار؟ (يُسجَّل مجهولاً لقياس أثر المنصّة)</div>" +
      '<div class="btn-row" style="margin-top:0">' +
      '<button class="btn ghost" id="auditApply" style="border-color:var(--green);color:var(--green)">✅ سأطبّق الإجراء المقترح</button>' +
      '<button class="btn ghost" id="auditIgnore">✖ تجاهُل والمتابعة كما هو</button>' +
      "</div></div>";
    $("auditApply").onclick = function () { respond("applied"); };
    $("auditIgnore").onclick = function () { respond("ignored"); };
  }

  // ══════════════════════════════════════════════════════════════
  // 3ب. تتبّع التنبؤ بالملفات + قياس الاستنقاذ الفعلي بإعادة الرفع
  //
  // جلسة لكل ملف (مرجع NB-…): رفع فيه صفوف عالية الخطورة يفتح الجلسة بحدث
  // prediction واحد مجمَّع، وزرّا الاستجابة يعملان على مستوى الملف كله.
  // قياس «الإيرادات المستنقَذة» للملفات يحتاج قبلاً وبعداً حقيقيين، لذا عند
  // اختيار «سأعالج» تُحفظ بصمة الصفوف عالية الخطورة محلياً (هذا المتصفح)،
  // وحين يُرفَع الملف المصحَّح لاحقاً في التبويب نفسه تُطابَق الصفوف
  // (بعمود معرّف إن وُجد، وإلا ببصمة الحقول الثابتة) ويُقاس انخفاض الخطر
  // فعلياً × قيمة كل مطالبة، ثم يُرسَل حدث applied محدَّث بالمرجع نفسه —
  // واللوحة تعتمد أحدث حدث استجابة لكل مرجع، فلا ازدواج في العدّ.
  // ══════════════════════════════════════════════════════════════
  var BKEY = "namaa.audit.batch";
  var B_MAX_ROWS = 10000;      // أقصى صفوف تُحفظ في بصمة الملف (الأكبر قيمةً أولاً)
  var B_KEEP = 3;              // بصمات محفوظة لكل مرحلة
  var B_TTL = 45 * 864e5;      // صلاحية البصمة: ٤٥ يوماً

  function loadBaselines() {
    try {
      var a = JSON.parse(localStorage.getItem(BKEY) || "[]");
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  }
  function saveBaselines(a) {
    try { localStorage.setItem(BKEY, JSON.stringify(a)); } catch (e) { /* */ }
  }

  function pct(p) { return Math.round(p * 1000) / 10; }

  function batchPayload(ref, stage, initP, finP, amount, response) {
    return { ref: ref, stage: stage + "-batch",
      initialRisk: pct(initP), finalRisk: pct(finP),
      amount: Math.round((amount || 0) * 100) / 100,
      response: response, device: deviceId() };
  }

  /** متوسط الخطر موزوناً بقيمة كل صف (فيصير المتوسط × المجموع = Σ خطر×قيمة تماماً) */
  function weighted(rows) {
    var sa = 0, spa = 0, sp = 0;
    rows.forEach(function (r) { var a = isFinite(r.a) ? r.a : 0; sa += a; spa += r.p * a; sp += r.p; });
    return { amount: sa, avg: sa > 0 ? spa / sa : (rows.length ? sp / rows.length : 0) };
  }

  /**
   * onBatch({stage, noun, threshold, n, rows})
   *   تستدعيها تبويبات «التنبؤ بالملفات» بعد اكتمال التسجيل.
   *   rows: كل الصفوف المسجَّلة [{k: مفتاح المطابقة, p: الخطر 0..1, a: القيمة}]
   */
  function onBatch(opts) {
    if (!URL_) return;
    var host = $("batchStatus");
    if (!host || !opts || !opts.rows || !opts.rows.length) return;
    var box = document.createElement("div");
    host.appendChild(box);
    var thr = opts.threshold || 0.5;
    var noun = opts.noun || "صف";

    // ١) هل هذا رفعٌ للملف نفسه بعد معالجته؟ (مطابقة على بصمة محفوظة)
    var newMap = {};
    opts.rows.forEach(function (r) { newMap[r.k] = r; });
    var best = null;
    loadBaselines().forEach(function (b) {
      if (b.stage !== opts.stage) return;
      var keys = Object.keys(b.rows), matched = [];
      keys.forEach(function (k) { if (newMap[k]) matched.push(k); });
      if (keys.length && matched.length / keys.length >= 0.5 &&
          (!best || matched.length > best.matched.length)) best = { b: b, matched: matched };
    });

    if (best) {
      var sa = 0, spa0 = 0, spa1 = 0, salvage = 0;
      best.matched.forEach(function (k) {
        var o = best.b.rows[k], a = o[1] || 0, p0 = o[0], p1 = newMap[k].p;
        sa += a; spa0 += p0 * a; spa1 += p1 * a;
        salvage += Math.max(0, p0 - p1) * a;
      });
      var p0avg = sa > 0 ? spa0 / sa : 0, p1avg = sa > 0 ? spa1 / sa : 0;
      post(batchPayload(best.b.ref, opts.stage, p0avg, p1avg, sa, "applied"));
      best.b.ts = Date.now();
      saveBaselines(loadBaselines().map(function (b) { return b.ref === best.b.ref ? best.b : b; }));
      box.innerHTML =
        '<div class="note" style="margin-top:10px;border-color:var(--green)">' +
        "<b>📈 قياس الاستنقاذ بعد المعالجة</b> — تعرّفتُ على هذا الملف: " +
        fmt(best.matched.length) + " من " + fmt(Object.keys(best.b.rows).length) +
        " " + esc(noun) + " عالي الخطورة من الرفعة السابقة (" + esc(best.b.ref) + ").<br>" +
        "متوسط الخطر: <b>" + fmt(pct(p0avg), 1) + "%</b> قبل ← <b>" + fmt(pct(p1avg), 1) + "%</b> بعد · " +
        'الإيراد المستنقَذ المقيس: <b style="color:var(--green)">' + fmt(salvage) + " ﷼</b>" +
        " — سُجِّل في لوحة القيادة (أحدث قياس للجلسة يحلّ محل السابق).</div>";
      return;
    }

    // ٢) ملف جديد — الجلسة تُفتح فقط حين توجد صفوف عالية الخطورة
    var hi = opts.rows.filter(function (r) { return r.p >= thr; });
    if (!hi.length) return;
    var w = weighted(hi);
    var ref = "NB-" + Date.now().toString(36).toUpperCase() +
              Math.random().toString(36).slice(2, 5).toUpperCase();
    post(batchPayload(ref, opts.stage, w.avg, w.avg, w.amount, "prediction"));

    box.innerHTML =
      '<div style="margin-top:12px;padding-top:12px;border-top:1px dashed var(--border)">' +
      '<div style="font-size:12px;color:var(--muted2);margin-bottom:8px">📋 <b>تتبّع الاستجابة:</b> ' +
      "في هذا الملف <b>" + fmt(hi.length) + "</b> " + esc(noun) + " عالي الخطورة بقيمة <b>" +
      fmt(w.amount) + " ﷼</b> — ما قرارك حيال القائمة؟ (يُسجَّل مجهولاً لقياس أثر المنصّة)</div>" +
      '<div class="btn-row" style="margin-top:0">' +
      '<button class="btn ghost" id="bAuditApply" style="border-color:var(--green);color:var(--green)">✅ سأعالج الصفوف عالية الخطورة قبل التقديم</button>' +
      '<button class="btn ghost" id="bAuditIgnore">✖ تجاهُل والمتابعة كما هو</button>' +
      "</div></div>";

    $("bAuditApply").onclick = function () {
      post(batchPayload(ref, opts.stage, w.avg, w.avg, w.amount, "applied"));
      // بصمة الصفوف عالية الخطورة لقياس التحسّن عند إعادة الرفع (محلياً فقط)
      var keep = hi.slice().sort(function (x, y) { return (y.a || 0) - (x.a || 0); }).slice(0, B_MAX_ROWS);
      var rowsMap = {};
      keep.forEach(function (r) { rowsMap[r.k] = [r.p, isFinite(r.a) ? r.a : 0]; });
      var bases = loadBaselines().filter(function (b) {
        return Date.now() - (b.ts || 0) < B_TTL;
      });
      bases.push({ ref: ref, stage: opts.stage, ts: Date.now(), rows: rowsMap });
      var mine = bases.filter(function (b) { return b.stage === opts.stage; });
      while (mine.length > B_KEEP) {
        var oldest = mine.reduce(function (x, y) { return x.ts < y.ts ? x : y; });
        bases = bases.filter(function (b) { return b !== oldest; });
        mine = mine.filter(function (b) { return b !== oldest; });
      }
      saveBaselines(bases);
      box.innerHTML = '<div class="note" style="margin-top:10px;border-color:var(--green)">' +
        "<b>✅ سُجِّل تطبيق الإجراء على الملف.</b> لقياس الاستنقاذ الفعلي: بعد معالجة " +
        "الصفوف عالية الخطورة <b>ارفع الملف المصحَّح هنا مجدداً</b> (من المتصفح نفسه) — " +
        "سأطابق الصفوف وأقيس انخفاض الخطر × قيمة كل " + esc(noun) + " تلقائياً.</div>";
    };
    $("bAuditIgnore").onclick = function () {
      post(batchPayload(ref, opts.stage, w.avg, w.avg, w.amount, "ignored"));
      box.innerHTML = '<div class="note" style="margin-top:10px"><b>✖ سُجِّل التجاهل.</b> ' +
        "شكراً — استجابتك تُحسِّن قياس أثر المنصّة.</div>";
    };
  }

  // ══════════════════════════════════════════════════════════════
  // 4. تبويب «لوحة القيادة» المحمي برقم سري
  // ══════════════════════════════════════════════════════════════
  function sha256(text) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
      .then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) {
          return b.toString(16).padStart(2, "0");
        }).join("");
      });
  }

  function addTab() {
    var tabs = $("tabs");
    if (!tabs) return;
    var btn = document.createElement("button");
    btn.className = "tab";
    btn.dataset.p = "admin";
    btn.textContent = "🛡 لوحة القيادة";
    tabs.appendChild(btn);

    var panel = document.createElement("div");
    panel.className = "panel";
    panel.id = "p-admin";
    panel.innerHTML = '<div id="adminBody"></div>';
    var app = $("app");
    if (app) app.appendChild(panel);

    btn.onclick = function () {
      document.querySelectorAll(".tab").forEach(function (x) { x.classList.remove("active"); });
      document.querySelectorAll(".panel").forEach(function (x) { x.classList.remove("active"); });
      btn.classList.add("active");
      panel.classList.add("active");
      renderAdmin();
    };
  }

  var AUTHED = false;
  try { AUTHED = sessionStorage.getItem("namaa.admin") === "1"; } catch (e) { /* */ }

  function renderAdmin() {
    var host = $("adminBody");
    if (!URL_) {
      host.innerHTML = '<div class="card"><div class="sec-label">🛡 لوحة القيادة</div>' +
        '<div class="note"><b>لم يُضبط رابط سجلّ التتبّع بعد.</b> انشر الواجهة الخلفية ' +
        "(<code>audit/Code.gs</code>) تطبيقَ ويب على Google Apps Script كما في " +
        "<code>audit/README.md</code>، ثم ضع الرابط في <code>assets/site-config.js</code>:<br><br>" +
        "<code>window.NAMAA_AUDIT = { url: \"https://script.google.com/macros/s/…/exec\" };</code></div></div>";
      return;
    }
    if (!AUTHED) { renderPin(host); return; }
    renderDashboard(host);
  }

  function renderPin(host) {
    host.innerHTML =
      '<div class="card" style="max-width:420px;margin:30px auto;text-align:center">' +
      '<div style="font-size:38px;margin-bottom:8px">🛡</div>' +
      '<div style="font-weight:700;font-size:15px;margin-bottom:4px">لوحة القيادة — الإدارة</div>' +
      '<div style="font-size:12px;color:var(--muted2);margin-bottom:14px">أدخل الرقم السري للاطّلاع على المقاييس التراكمية</div>' +
      '<input type="password" id="adminPin" placeholder="الرقم السري" autocomplete="off" ' +
        'style="width:100%;padding:11px;border:1px solid var(--border);border-radius:9px;background:var(--surface);' +
        'color:var(--text);font-family:inherit;font-size:14px;text-align:center;letter-spacing:2px">' +
      '<div id="pinErr" style="color:var(--red);font-size:12px;min-height:20px;margin-top:6px"></div>' +
      '<button class="btn" id="pinGo" style="margin-top:4px">دخول</button></div>';
    function tryPin() {
      var v = $("adminPin").value || "";
      sha256(v).then(function (h) {
        if (h === PIN_HASH) {
          AUTHED = true;
          try { sessionStorage.setItem("namaa.admin", "1"); } catch (e) { /* */ }
          renderDashboard($("adminBody"));
        } else {
          $("pinErr").textContent = "رقم سري غير صحيح";
          $("adminPin").value = "";
        }
      });
    }
    $("pinGo").onclick = tryPin;
    $("adminPin").addEventListener("keydown", function (e) { if (e.key === "Enter") tryPin(); });
    $("adminPin").focus();
  }

  // ── جلب البيانات وحساب المقاييس ──
  function fetchRows() {
    var u = URL_ + (TOKEN ? (URL_.indexOf("?") < 0 ? "?" : "&") + "token=" + encodeURIComponent(TOKEN) : "");
    return fetch(u, { redirect: "follow" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (j) {
        if (!j.ok) throw new Error(j.error || "استجابة غير متوقعة");
        return j.rows || [];
      })
      .catch(function (e) {
        // خادم التتبّع غير متاح — نعرض المرآة المحلية لهذا الجهاز بدل الفشل
        var loc = localRows();
        if (loc.length) { loc._localOnly = true; return loc; }
        throw e;
      });
  }

  function kpis(rows) {
    // استجابة الجلسة = أحدث حدث applied/ignored بمرجعها: جلسات الملفات تُرسل
    // applied محدَّثاً بعد قياس إعادة الرفع، وأحدث قياس هو المعتمد — بلا ازدواج.
    var predictions = 0, batchFiles = 0, salvaged = 0, atRiskIgnored = 0;
    var devices = {}, appliedRefs = {}, ignoredRefs = {};
    rows.forEach(function (r) {
      devices[r.device] = 1;
      if (r.response === "prediction") {
        predictions++;
        if (/-batch$/.test(String(r.stage))) batchFiles++;
      } else if (r.response === "applied") {
        appliedRefs[r.ref] = r; delete ignoredRefs[r.ref];
      } else if (r.response === "ignored") {
        ignoredRefs[r.ref] = r; delete appliedRefs[r.ref];
      }
    });
    var applied = 0, ignored = 0, ref;
    var salvByStage = {}, riskByStage = {}, daily = {};
    rows.forEach(function (r) {
      if (r.response === "prediction") {
        var d = String(r.ts).slice(0, 10);
        if (d) daily[d] = (daily[d] || 0) + 1;
      }
    });
    for (ref in appliedRefs) {
      applied++;
      // الإيراد المستنقذ: انخفاض الخطر بين أول تنبؤ وأحدث قياس × قيمة الفاتورة
      var r1 = appliedRefs[ref];
      var sv = Math.max(0, (r1.initialRisk - r1.finalRisk) / 100) * (r1.amount || 0);
      salvaged += sv;
      salvByStage[r1.stage] = (salvByStage[r1.stage] || 0) + sv;
    }
    for (ref in ignoredRefs) {
      ignored++;
      var r2 = ignoredRefs[ref];
      var ar = (r2.finalRisk / 100) * (r2.amount || 0);
      atRiskIgnored += ar;
      riskByStage[r2.stage] = (riskByStage[r2.stage] || 0) + ar;
    }
    var respTotal = applied + ignored;
    return {
      predictions: predictions, batchFiles: batchFiles,
      applied: applied, ignored: ignored,
      salvaged: salvaged, atRiskIgnored: atRiskIgnored,
      compliance: respTotal ? applied / respTotal : null,
      devices: Object.keys(devices).length,
      daily: daily, salvByStage: salvByStage, riskByStage: riskByStage,
    };
  }

  // ── مخططات اللوحة (SVG بهوية المنصّة — بلا أي مكتبة) ──────────
  /** أعمدة يومية: جلسات التنبؤ في آخر ١٤ يوماً */
  function chartDaily(daily) {
    var days = [], now = new Date();
    for (var i = 13; i >= 0; i--) {
      var d = new Date(now.getTime() - i * 864e5);
      var key = d.toISOString().slice(0, 10);
      days.push({ key: key, label: key.slice(5), n: daily[key] || 0 });
    }
    var max = Math.max.apply(null, days.map(function (d) { return d.n; }));
    if (max <= 0) return '<div class="note">لا جلسات في آخر ١٤ يوماً.</div>';
    var W2 = 700, H2 = 170, top = 22, bottom = 26, bw = 34, gap2 = (W2 - 40 - 14 * bw) / 13;
    var maxI = days.reduce(function (m, d, i) { return d.n > days[m].n ? i : m; }, 0);
    var svg = '<svg viewBox="0 0 ' + W2 + " " + H2 + '" style="width:100%;height:auto;direction:ltr" role="img">';
    days.forEach(function (d, i) {
      var x = 20 + i * (bw + gap2);
      var bh = d.n ? Math.max(3, (d.n / max) * (H2 - top - bottom)) : 0;
      var y = H2 - bottom - bh;
      svg += "<g><title>" + d.key + " — " + fmt(d.n) + " جلسة</title>";
      if (d.n) svg += '<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + bh +
        '" rx="4" fill="var(--accent,#1B6FA8)"></rect>';
      else svg += '<rect x="' + x + '" y="' + (H2 - bottom - 2) + '" width="' + bw +
        '" height="2" rx="1" fill="var(--border,#D6E2ED)"></rect>';
      if (d.n && (i === maxI || i === days.length - 1))
        svg += '<text x="' + (x + bw / 2) + '" y="' + (y - 6) + '" font-size="12" font-weight="700" ' +
          'fill="var(--muted2,#456076)" text-anchor="middle">' + fmt(d.n) + "</text>";
      if (i % 2 === 1)
        svg += '<text x="' + (x + bw / 2) + '" y="' + (H2 - 8) + '" font-size="10" ' +
          'fill="var(--muted,#5A7085)" text-anchor="middle">' + d.label + "</text>";
      svg += "</g>";
    });
    svg += "</svg>";
    return svg;
  }

  /** دائرة الاستجابة: تطبيق مقابل تجاهل (أخضر/أحمر بفاصل أبيض وتسميات نصية) */
  function chartDonut(applied, ignored) {
    var total = applied + ignored;
    if (!total) return '<div class="note">لا استجابات مسجَّلة بعد.</div>';
    var pctA = applied / total, R = 56, CX = 70, CY = 70, SW = 22;
    var C2 = 2 * Math.PI * R, gapLen = total > 0 && applied && ignored ? 3 : 0;
    var aLen = Math.max(0, C2 * pctA - gapLen), iLen = Math.max(0, C2 * (1 - pctA) - gapLen);
    var svg = '<svg viewBox="0 0 140 140" style="width:130px;height:130px;direction:ltr" role="img">' +
      '<g transform="rotate(-90 ' + CX + " " + CY + ')">' +
      '<circle cx="' + CX + '" cy="' + CY + '" r="' + R + '" fill="none" stroke="var(--green,#0B7A5E)" stroke-width="' + SW +
        '" stroke-dasharray="' + aLen + " " + (C2 - aLen) + '" stroke-linecap="butt"><title>تطبيق الإجراء: ' + fmt(applied) + "</title></circle>" +
      '<circle cx="' + CX + '" cy="' + CY + '" r="' + R + '" fill="none" stroke="var(--red,#C4362F)" stroke-width="' + SW +
        '" stroke-dasharray="0 ' + (aLen + gapLen) + " " + iLen + " " + gapLen +
        '" stroke-linecap="butt"><title>تجاهل: ' + fmt(ignored) + "</title></circle></g>" +
      '<text x="' + CX + '" y="' + (CY + 1) + '" font-size="22" font-weight="700" fill="var(--text,#12384F)" text-anchor="middle">' +
        fmt(pctA * 100, 0) + '%</text>' +
      '<text x="' + CX + '" y="' + (CY + 19) + '" font-size="9.5" fill="var(--muted,#5A7085)" text-anchor="middle">معدل الاستجابة</text></svg>';
    return '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">' + svg +
      '<div style="font-size:12.5px;line-height:2.1">' +
      '<div><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:var(--green,#0B7A5E);margin-inline-start:2px"></span> ✅ طبَّقوا الإجراء: <b>' + fmt(applied) + "</b></div>" +
      '<div><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:var(--red,#C4362F);margin-inline-start:2px"></span> ✖ تجاهلوا: <b>' + fmt(ignored) + "</b></div>" +
      "</div></div>";
  }

  /** أشرطة أفقية حسب المرحلة: المستنقَذ (أخضر) مقابل المتجاهَل المعرَّض (أحمر) */
  function chartStages(salvByStage, riskByStage) {
    var stages = {};
    Object.keys(salvByStage).forEach(function (k) { stages[k] = 1; });
    Object.keys(riskByStage).forEach(function (k) { stages[k] = 1; });
    var keys = Object.keys(stages);
    if (!keys.length) return '<div class="note">ستظهر المقارنة المالية بعد أول استجابة.</div>';
    var max = 0;
    keys.forEach(function (k) { max = Math.max(max, salvByStage[k] || 0, riskByStage[k] || 0); });
    if (max <= 0) return '<div class="note">لا مبالغ مسجَّلة بعد.</div>';
    var W3 = 680, rowH = 56, labelW = 170, valW = 90, barMax = W3 - labelW - valW - 20;
    var H3 = keys.length * rowH + 6;
    var svg = '<svg viewBox="0 0 ' + W3 + " " + H3 + '" style="width:100%;height:auto;direction:ltr" role="img">';
    keys.forEach(function (k, i) {
      var y = 3 + i * rowH;
      var pairs = [
        { v: salvByStage[k] || 0, c: "var(--green,#0B7A5E)", t: "مستنقَذ" },
        { v: riskByStage[k] || 0, c: "var(--red,#C4362F)", t: "متجاهَل معرَّض" },
      ];
      svg += '<text x="' + (W3 - 6) + '" y="' + (y + rowH / 2 + 2) + '" font-size="12.5" font-weight="700" ' +
        'fill="var(--text,#12384F)" text-anchor="end" direction="rtl">' + esc(STAGE_AR[k] || k) + "</text>";
      pairs.forEach(function (p, j) {
        var bw2 = p.v > 0 ? Math.max(3, (p.v / max) * barMax) : 0;
        var yy = y + 8 + j * 20, x0 = W3 - labelW - bw2;
        svg += "<g><title>" + esc(STAGE_AR[k] || k) + " — " + p.t + ": " + fmt(p.v) + " ﷼</title>";
        if (bw2) svg += '<rect x="' + x0 + '" y="' + yy + '" width="' + bw2 + '" height="14" rx="4" fill="' + p.c + '"></rect>' +
          '<text x="' + (x0 - 6) + '" y="' + (yy + 11.5) + '" font-size="11" fill="var(--muted2,#456076)" text-anchor="end">' + fmt(p.v) + "</text>";
        else svg += '<rect x="' + (W3 - labelW - 2) + '" y="' + (yy + 6) + '" width="2" height="2" fill="var(--border,#D6E2ED)"></rect>';
        svg += "</g>";
      });
    });
    svg += "</svg>";
    return '<div style="display:flex;gap:16px;font-size:11.5px;color:var(--muted2);margin-bottom:6px">' +
      '<span><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:var(--green,#0B7A5E)"></span> الإيرادات المستنقَذة ﷼</span>' +
      '<span><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:var(--red,#C4362F)"></span> قيمة المتجاهَل المعرَّضة ﷼</span>' +
      "</div>" + svg;
  }

  function kpiCard(k, v, s, color) {
    return '<div class="box"><div class="k">' + esc(k) + '</div>' +
      '<div class="v" style="' + (color ? "color:" + color : "") + '">' + v + "</div>" +
      '<div class="s">' + esc(s || "") + "</div></div>";
  }

  var RESP_AR = { prediction: "تنبؤ", applied: "تطبيق الإجراء", ignored: "تجاهل" };
  var STAGE_AR = { approvals: "موافقات", claims: "مطالبات",
                   "approvals-batch": "موافقات · 📂 ملف", "claims-batch": "مطالبات · 📂 ملف" };

  function renderDashboard(host) {
    host.innerHTML = '<div class="card"><div class="loading" style="padding:30px">' +
      '<div class="spin"></div>جارٍ جلب البيانات التراكمية من جميع الأجهزة…</div></div>';
    fetchRows().then(function (rows) {
      var localOnly = !!rows._localOnly;
      var K = kpis(rows);
      var h = '<div class="card"><div class="sec-label">🛡 لوحة القيادة — ' +
        (localOnly ? "بيانات هذا الجهاز" : "المقاييس التراكمية عبر جميع الأجهزة") + "</div>";
      if (localOnly) {
        h += '<div class="note" style="border-color:#c99b4e;background:#fdf6ee">⚠ <b>خادم التتبّع غير متاح</b> — ' +
          "تُعرض أحداث هذا الجهاز وحده من الذاكرة المحلية. عند توفّر الخادم تظهر البيانات التراكمية لكل الأجهزة تلقائياً.</div>";
      }
      h += '<div class="kv">';
      h += kpiCard("إجمالي التنبؤات المنفَّذة", fmt(K.predictions),
                   "جلسة تنبؤ عبر " + fmt(K.devices) + " جهازاً" +
                   (K.batchFiles ? " · منها " + fmt(K.batchFiles) + " ملفات 📂" : ""));
      h += kpiCard("الإيرادات المستنقَذة", fmt(K.salvaged) + " ﷼",
                   "انخفاض الخطر × قيمة الفاتورة للإجراءات المطبَّقة (أحدث قياس لكل جلسة)", "var(--green)");
      h += kpiCard("معدل الاستجابة العام", K.compliance == null ? "—" : fmt(K.compliance * 100, 1) + "%",
                   "تطبيق الإجراء ÷ (تطبيق + تجاهل)", "var(--accent)");
      h += kpiCard("الطلبات المتجاهَلة", fmt(K.ignored),
                   "قيمتها المعرّضة للخطر " + fmt(K.atRiskIgnored) + " ﷼", "var(--red)");
      h += "</div>";
      h += '<div class="btn-row" style="justify-content:flex-start">' +
        '<button class="btn ghost" id="adminRefresh">🔄 تحديث</button>' +
        '<button class="btn ghost" id="adminLogout">🚪 خروج</button></div>';
      h += "</div>";

      // قراءة بصرية — مخططات النتائج
      if (rows.length) {
        h += '<div class="card"><div class="sec-label">📊 قراءة بصرية للنتائج</div>';
        h += '<div style="font-size:12.5px;font-weight:700;color:var(--text);margin-bottom:6px">جلسات التنبؤ اليومية — آخر ١٤ يوماً</div>';
        h += chartDaily(K.daily);
        h += '<div style="display:grid;grid-template-columns:1fr 1.4fr;gap:18px;margin-top:18px;align-items:start">' +
          '<div><div style="font-size:12.5px;font-weight:700;color:var(--text);margin-bottom:6px">الاستجابة للإنذارات</div>' +
          chartDonut(K.applied, K.ignored) + "</div>" +
          '<div><div style="font-size:12.5px;font-weight:700;color:var(--text);margin-bottom:6px">الأثر المالي حسب المرحلة</div>' +
          chartStages(K.salvByStage, K.riskByStage) + "</div></div>";
        h += "</div>";
      }

      // أحدث الأحداث
      h += '<div class="card"><div class="sec-label">🕓 أحدث الأحداث (' + fmt(rows.length) + " حدثاً مسجَّلاً)</div>";
      if (!rows.length) {
        h += '<div class="note">لا أحداث بعد — ستظهر هنا فور أول تنبؤ أو استجابة من أي جهاز.</div>';
      } else {
        h += '<div class="tbl-wrap"><table><tr><th>الوقت</th><th>المرجع</th><th>المرحلة</th>' +
          "<th>الخطر الأولي</th><th>النهائي</th><th>الفاتورة</th><th>الاستجابة</th></tr>";
        rows.slice(-15).reverse().forEach(function (r) {
          var col = r.response === "applied" ? "var(--green)" : r.response === "ignored" ? "var(--red)" : "var(--muted2)";
          h += "<tr><td>" + esc(String(r.ts).replace("T", " ").slice(0, 16)) + "</td>" +
            "<td>" + esc(r.ref) + "</td><td>" + esc(STAGE_AR[r.stage] || r.stage) + "</td>" +
            "<td>" + fmt(r.initialRisk, 1) + "%</td><td>" + fmt(r.finalRisk, 1) + "%</td>" +
            "<td>" + fmt(r.amount) + "</td>" +
            '<td style="color:' + col + ';font-weight:700">' + esc(RESP_AR[r.response] || r.response) + "</td></tr>";
        });
        h += "</table></div>";
      }
      h += '<div class="note">' +
        (localOnly ? "المصدر: الذاكرة المحلية لهذا الجهاز (خادم التتبّع غير متاح)"
                   : "المصدر: سجل التتبّع المركزي") +
        " — البيانات مجهولة (لا أسماء ولا هويات)، والرقم السري حاجز تنظيمي لا حماية تقنية لبيانات حساسة.</div></div>";

      host.innerHTML = h;
      $("adminRefresh").onclick = function () { renderDashboard(host); };
      $("adminLogout").onclick = function () {
        AUTHED = false;
        try { sessionStorage.removeItem("namaa.admin"); } catch (e) { /* */ }
        renderAdmin();
      };
    }).catch(function (e) {
      host.innerHTML = '<div class="card"><div class="err"><b>تعذّر جلب البيانات:</b> ' + esc(e.message) +
        "<br><br>تحقّق من أن تطبيق الويب منشور بوصول <b>Anyone</b> وأن الرابط في " +
        "<code>assets/site-config.js</code> ينتهي بـ<code>/exec</code>.</div>" +
        '<div class="btn-row"><button class="btn ghost" id="adminRetry">🔄 إعادة المحاولة</button></div></div>';
      $("adminRetry").onclick = function () { renderDashboard(host); };
    });
  }

  // ══════════════════════════════════════════════════════════════
  // 5. الإقلاع
  // ══════════════════════════════════════════════════════════════
  function boot() {
    addTab();
    flushQueue();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.RCMAudit = { onPredict: onPredict, respond: respond, onBatch: onBatch,
                      hash: sha256, enabled: function () { return !!URL_; } };
})();
