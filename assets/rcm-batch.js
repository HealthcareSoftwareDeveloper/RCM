/*!
 * rcm-batch.js — تبويب «التنبؤ بالملفات»: رفع Excel/CSV وتسجيله دفعياً داخل المتصفح
 * ARCH Predict · ARCH Systems
 *
 * يقرأ الملف ويُسجِّله بنفس محرّك التنبؤ (RCMEngine) دون إرسال أي بيانات لأي خادم،
 * ويُصدِّر النتائج ملف Excel أو CSV، مع قالب Excel جاهز للتعبئة.
 * قراءة/كتابة الملفات عبر مكتبة SheetJS المضمّنة محلّياً (assets/vendor) —
 * تُحمَّل عند أول استخدام للتبويب فقط.
 */
(function () {
  "use strict";

  var B = window.RCM_BUNDLE, E = window.RCMEngine,
      $ = function (id) { return document.getElementById(id); };
  if (!B || !B.approval || !E) return;

  var NFA = 1;
  var THRESHOLD = B.approval.threshold || 0.5;

  // ── الأعمدة: المفتاح اللاتيني بين قوسين هو ما يُطابَق عليه عند القراءة ──
  var COLS = [
    { key: "total",            head: "إجمالي الفاتورة (total)",                 ex: [320, 900, 2600] },
    { key: "visit_date",       head: "تاريخ الزيارة (visit_date)",              ex: ["2026-08-18 14:30", "2026-08-18 14:30", "2026-08-18 14:30"] },
    { key: "visit_type",       head: "نوع الزيارة (visit_type)",                dd: "visit_type", ex: ["opd", "er", "er"] },
    { key: "hospital",         head: "المستشفى (hospital)",                     dd: "hospital", ex: ["khalais general hospital", "ajyad emergency hospital", "field hospital in mina"] },
    { key: "clinic",           head: "القسم / العيادة (clinic)",                dd: "clinic", ex: ["OTHER", "emergeny dept", "emergency department"] },
    { key: "contract",         head: "عقد التأمين (contract)",                  dd: "contract", ex: ["OTHER", "hajj1447", "hajj1447"] },
    { key: "icd",              head: "رمز التشخيص ICD-10 (icd)",                ex: ["E11.9", "S61.9", "R51"] },
    { key: "nphies",           head: "فحص الأهلية نفيس (nphies)",               dd: "nphies_elig", ex: ["eligible", "eligible", "error"] },
    { key: "triage",           head: "درجة الطوارئ CTAS 1-5 (triage)",          ex: [4, 4, 5] },
    { key: "gender",           head: "الجنس (gender)",                          dd: "gender", ex: ["", "", ""] },
    { key: "nationality",      head: "الجنسية (nationality)",                   dd: "nationality", ex: ["", "", ""] },
    { key: "patient_class",    head: "تصنيف المريض (patient_class)",            dd: "patient_class", ex: ["", "hajj", "hajj"] },
    { key: "prior_claims",     head: "عدد الطلبات السابقة للمريض (prior_claims)", ex: ["", "", ""] },
    { key: "prior_reject_rate", head: "نسبة عدم الاكتمال السابقة 0-1 (prior_reject_rate)", ex: ["", "", ""] },
  ];

  // خرائط قيمة/تسمية ← القيمة الآلية، لكل حقل قوائم
  var VALUE_MAPS = {};
  COLS.forEach(function (c) {
    if (!c.dd) return;
    var m = {};
    (B.options[c.dd] || []).forEach(function (o) {
      m[String(o.v).trim().toLowerCase()] = o.v;
      if (o.l) m[String(o.l).trim().toLowerCase()] = o.v;
    });
    VALUE_MAPS[c.key] = m;
  });

  // الحقل الفارغ يأخذ القيمة الأكثر شيوعاً — نفس نقطة انطلاق النموذج في الصفحة،
  // حتى يتطابق تسجيل الملف مع ما يعطيه إدخال الطلب نفسه يدوياً.
  var DD_DEFAULT = {};
  COLS.forEach(function (c) {
    if (!c.dd) return;
    var first = (B.options[c.dd] || [])[0];
    DD_DEFAULT[c.key] = first ? first.v : "";
  });

  // مرادفات عناوين الأعمدة — للمطابقة الذكية حين تختلف التسمية أو الترتيب
  var SYN = {
    total:            ["total", "amount", "bill total", "invoice total", "المبلغ", "القيمه", "اجمالي الفاتوره", "قيمه الفاتوره", "المبلغ الاجمالي", "اجمالي الطلب"],
    visit_date:       ["visit date", "service date", "admission date", "encounter date", "تاريخ الزياره", "تاريخ الخدمه", "تاريخ الدخول"],
    visit_type:       ["visit type", "encounter type", "patient type", "نوع الزياره", "نوع الحاله"],
    hospital:         ["hospital", "facility", "provider", "center", "المستشفي", "المنشاه", "مقدم الخدمه", "المركز"],
    clinic:           ["clinic", "department", "specialty", "العياده", "القسم", "التخصص"],
    contract:         ["contract", "insurance", "payer", "insurer", "policy", "عقد التامين", "العقد", "شركه التامين", "التامين", "جهه التامين", "الضامن"],
    icd:              ["icd", "icd10", "diagnosis", "dx", "diagnosis code", "التشخيص", "رمز التشخيص"],
    nphies:           ["nphies", "eligibility", "elig", "نفيس", "الاهليه", "فحص الاهليه"],
    triage:           ["triage", "ctas", "درجه الطوارئ", "الفرز"],
    gender:           ["gender", "sex", "الجنس", "النوع"],
    nationality:      ["nationality", "الجنسيه"],
    patient_class:    ["patient class", "class", "تصنيف المريض", "فئه المريض"],
    prior_claims:     ["prior claims", "previous claims", "الطلبات السابقه", "عدد الطلبات السابقه"],
    prior_reject_rate:["prior reject", "reject rate", "نسبه الرفض السابقه", "نسبه عدم الاكتمال"],
  };

  function normCat(key, raw) {
    if (raw == null || raw === "") return DD_DEFAULT[key] || "";
    var s = String(raw).trim();
    var m = VALUE_MAPS[key];
    return (m && m[s.toLowerCase()] !== undefined) ? m[s.toLowerCase()] : s;
  }

  // ── تحميل مكتبة SheetJS المضمّنة محلياً عند الحاجة ──
  var xlsxReady = null;
  function loadXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (xlsxReady) return xlsxReady;
    xlsxReady = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = "assets/vendor/xlsx.full.min.js";
      s.onload = function () { res(window.XLSX); };
      s.onerror = function () { rej(new Error("تعذّر تحميل assets/vendor/xlsx.full.min.js")); };
      document.head.appendChild(s);
    });
    return xlsxReady;
  }

  // ── القالب ──
  function buildTemplate(XLSX) {
    var wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };

    // ورقة الطلبات: صف العناوين + ثلاثة أمثلة جاهزة للاستبدال
    var rows = [COLS.map(function (c) { return c.head; })];
    for (var i = 0; i < 3; i++) rows.push(COLS.map(function (c) { return c.ex[i]; }));
    var ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = COLS.map(function (c) { return { wch: Math.max(18, c.head.length + 2) }; });
    XLSX.utils.book_append_sheet(wb, ws, "الطلبات");

    // ورقة القيم المسموحة: عمودان (القيمة الآلية، الاسم المعروض) لكل حقل قوائم
    var av = [["الحقل", "القيمة (تُكتب في القالب)", "الاسم المعروض"]];
    COLS.forEach(function (c) {
      if (!c.dd) return;
      (B.options[c.dd] || []).forEach(function (o) {
        av.push([c.head, o.v, o.l || ""]);
      });
      av.push(["", "", ""]);
    });
    av.push(["درجة الطوارئ CTAS 1-5 (triage)", "1 إلى 5", "1 حرج جداً … 5 غير عاجل"]);
    var ws2 = XLSX.utils.aoa_to_sheet(av);
    ws2["!cols"] = [{ wch: 40 }, { wch: 36 }, { wch: 36 }];
    XLSX.utils.book_append_sheet(wb, ws2, "القيم المسموحة");

    // ورقة التعليمات
    var inst = [
      ["تعليمات تعبئة القالب — منصّة ARCH Predict"],
      [""],
      ["1. عبّئ ورقة «الطلبات»: كل صف طلب موافقة واحد. الصفوف الثلاثة الموجودة أمثلة — احذفها أو استبدلها."],
      ["2. المطابقة ذكية: يقبل الرفع أي ترتيب أعمدة وأي تسمية قريبة (عربية أو إنجليزية)، والحقل غير الموجود يأخذ افتراضات الصفحة — وستظهر لك خريطة الأعمدة بعد الرفع."],
      ["3. حقول القوائم (نوع الزيارة، المستشفى، العقد…) تقبل القيمة الآلية أو الاسم المعروض كما في ورقة «القيم المسموحة»."],
      ["4. أي قيمة خارج القوائم تُعامل «أخرى / غير مدرج». حقل القوائم الفارغ يأخذ القيمة الأكثر شيوعاً (نفس نقطة انطلاق الصفحة)، والحقول الرقمية الفارغة تُعامل قيماً مفقودة."],
      ["5. رمز التشخيص ICD-10 يُشتقّ منه الفصل والكتلة تلقائياً (مثال: E11.9)."],
      ["6. التاريخ بصيغة 2026-08-18 14:30 أو خلية تاريخ في Excel."],
      ["7. ارفع الملف في تبويب «التنبؤ بالملفات» — تُعالَج البيانات داخل متصفّحك ولا تُرسل لأي خادم."],
    ];
    var ws3 = XLSX.utils.aoa_to_sheet(inst);
    ws3["!cols"] = [{ wch: 110 }];
    XLSX.utils.book_append_sheet(wb, ws3, "تعليمات");
    return wb;
  }

  function saveBlob(blob, name) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }

  function stamp() {
    var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes());
  }

  function downloadTemplate() {
    loadXLSX().then(function (XLSX) {
      XLSX.writeFile(buildTemplate(XLSX), "namaa-template.xlsx");
    }).catch(showErr);
  }

  // ── مولّد ملفات تجريبية غير محدود: صفوف عشوائية بصيغة القالب نفسها ──
  var GEN_MAX = 50000;
  function buildDemoAoa(n) {
    var D = window.RCMDemo;
    var aoa = [COLS.map(function (c) { return c.head; })];
    for (var i = 0; i < n; i++) {
      var r = D.randomCase();
      aoa.push(COLS.map(function (c) { return r[c.key]; }));
    }
    return aoa;
  }

  function genCount() {
    var n = parseInt($("genCount").value, 10);
    if (!isFinite(n) || n < 1) n = 100;
    if (n > GEN_MAX) n = GEN_MAX;
    $("genCount").value = n;
    return n;
  }

  function downloadDemo(asCsv) {
    if (!window.RCMDemo) return;
    var n = genCount();
    loadXLSX().then(function (XLSX) {
      var aoa = buildDemoAoa(n);
      var ws = XLSX.utils.aoa_to_sheet(aoa);
      if (asCsv) {
        var csv = "\ufeff" + XLSX.utils.sheet_to_csv(ws);   // BOM ليقرأ Excel العربية UTF-8
        saveBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), "namaa-demo-" + n + "-" + stamp() + ".csv");
      } else {
        var wb = XLSX.utils.book_new();
        wb.Workbook = { Views: [{ RTL: true }] };
        ws["!cols"] = COLS.map(function (c) { return { wch: Math.max(18, c.head.length + 2) }; });
        XLSX.utils.book_append_sheet(wb, ws, "الطلبات");
        XLSX.writeFile(wb, "namaa-demo-" + n + "-" + stamp() + ".xlsx");
      }
    }).catch(showErr);
  }

  // ── قراءة الملف المرفوع ──
  function headerKey(h) {
    if (h == null) return null;
    var s = String(h).trim();
    var m = s.match(/\(([a-z][a-z0-9_]*)\)\s*$/i);
    if (m) return m[1].toLowerCase();
    var low = s.toLowerCase();
    for (var i = 0; i < COLS.length; i++) if (COLS[i].key === low) return COLS[i].key;
    return null;
  }

  function toInput(rec) {
    var icd = (rec.icd == null ? "" : String(rec.icd)).trim().toUpperCase().replace(/\s/g, "");
    var mCh = icd.match(/^([A-Z])/), mBl = icd.match(/^([A-Z][0-9]{2})/);
    var vd = rec.visit_date;
    if (vd instanceof Date && !isNaN(vd.getTime())) {
      var p = function (n) { return (n < 10 ? "0" : "") + n; };
      vd = vd.getFullYear() + "-" + p(vd.getMonth() + 1) + "-" + p(vd.getDate()) +
           "T" + p(vd.getHours()) + ":" + p(vd.getMinutes());
    } else if (vd != null && vd !== "") {
      vd = String(vd).trim().replace(" ", "T");
    } else vd = "";
    var triage = (rec.triage == null || rec.triage === "") ? 3 : rec.triage;
    return {
      total: rec.total, visitDate: vd, triage: triage,
      priorClaims: rec.prior_claims, priorRejectRate: rec.prior_reject_rate,
      visitType: normCat("visit_type", rec.visit_type),
      hospital: normCat("hospital", rec.hospital),
      clinic: normCat("clinic", rec.clinic),
      nationality: normCat("nationality", rec.nationality),
      contract: normCat("contract", rec.contract),
      nphies: normCat("nphies", rec.nphies),
      gender: normCat("gender", rec.gender),
      patientClass: normCat("patient_class", rec.patient_class),
      icdChapter: mCh ? mCh[1] : "", icdBlock: mBl ? mBl[1] : "",
    };
  }

  // تسجيل صف واحد — بدون SHAP (يبقى التسجيل سريعاً للملفات الكبيرة)
  var RL = (B.reason && B.reason.labels) || [];
  // تسمية كل سبب ← إجراؤه المقترح (للملخّص المحوري)
  var ACTION_BY_LABEL = {};
  RL.forEach(function (code) {
    ACTION_BY_LABEL[B.reason.labels_ar[code] || code] = B.reason.actions[code] || "";
  });
  function scoreRow(rec) {
    var input = toInput(rec);
    E.prepare(B.approval.trees);
    var x = E.encode(B, input);
    var proba = E.toProba(E.rawScores(B.approval.trees, x, 1), B.approval);
    var pNFA = proba[NFA];
    var predIdx = pNFA >= THRESHOLD ? 1 : 0;
    var band = pNFA >= 0.65 ? "خطر مرتفع" : pNFA >= 0.45 ? "خطر متوسّط" : "خطر منخفض";

    var total = parseFloat(rec.total);
    var expv = "", risk = "";
    if (isFinite(total) && total > 0) {
      var rc = B.recovery, keys = B.classes;
      var e = total * (proba[0] * rc[keys[0]] + proba[1] * rc[keys[1]]);
      expv = Math.round(e * 100) / 100;
      risk = Math.round((total - e) * 100) / 100;
    }

    var reasons = [];
    if (RL.length) {
      E.prepare(B.reason.trees);
      var rp = E.toProba(E.rawScores(B.reason.trees, x, RL.length), B.reason);
      reasons = RL.map(function (code, i) { return { code: code, p: rp[i] }; })
        .sort(function (a, b) { return b.p - a.p; }).slice(0, 3)
        .map(function (r) {
          return { label: B.reason.labels_ar[r.code] || r.code, p: r.p,
                   action: B.reason.actions[r.code] || "" };
        });
    }
    return { proba: proba, predIdx: predIdx, band: band, expv: expv, risk: risk, reasons: reasons };
  }

  var OUT_HEADS = [
    "التنبؤ (prediction)", "احتمال الموافقة الكاملة (p_approved)",
    "احتمال عدم الموافقة الكاملة (p_not_fully_approved)", "نطاق الخطر (risk_band)",
    "الإيراد المتوقّع تحصيله (expected_revenue)", "المبلغ المعرّض للخطر (amount_at_risk)",
    "السبب المرجّح 1 (reason_1)", "نسبته (reason_1_p)", "الإجراء المقترح (reason_1_action)",
    "السبب المرجّح 2 (reason_2)", "نسبته (reason_2_p)", "إجراؤه المقترح (reason_2_action)",
    "السبب المرجّح 3 (reason_3)", "نسبته (reason_3_p)", "إجراؤه المقترح (reason_3_action)",
  ];

  function outRow(s) {
    var r = s.reasons;
    return [
      B.classes_ar[s.predIdx],
      Math.round(s.proba[0] * 10000) / 10000,
      Math.round(s.proba[1] * 10000) / 10000,
      s.band, s.expv, s.risk,
      r[0] ? r[0].label : "", r[0] ? Math.round(r[0].p * 1000) / 1000 : "", r[0] ? r[0].action : "",
      r[1] ? r[1].label : "", r[1] ? Math.round(r[1].p * 1000) / 1000 : "", r[1] ? r[1].action : "",
      r[2] ? r[2].label : "", r[2] ? Math.round(r[2].p * 1000) / 1000 : "", r[2] ? r[2].action : "",
    ];
  }

  var RESULT = null;   // { aoa, name, counts }
  var MAP_REPORT = null;

  // ── مفاتيح مطابقة الصفوف لتتبّع الملفات وقياس الاستنقاذ (rcm-audit.js) ──
  // عمود معرّف اختياري إن وُجد في الملف، وإلا بصمة من الحقول التي لا تتغيّر
  // عند المعالجة (تاريخ الزيارة، المستشفى، العقد، المبلغ).
  function idColIndex(heads) {
    for (var i = 0; i < heads.length; i++) {
      var h = String(heads[i] == null ? "" : heads[i]);
      if (headerKey(h) == null && /معر|claim[ _-]?id|\bid\b|\(id\)|^ref|reference/i.test(h)) return i;
    }
    return -1;
  }
  function auditDate(v) {
    if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 16);
    return String(v == null ? "" : v).trim();
  }
  function auditKey(rec, rawRow, idIdx, seen) {
    var nrm = function (v) { return String(v == null ? "" : v).trim().toLowerCase(); };
    var idv = idIdx >= 0 ? nrm(rawRow[idIdx]) : "";
    var base = idv ? "id:" + idv :
      auditDate(rec.visit_date) + "|" + nrm(rec.hospital) + "|" + nrm(rec.contract) + "|" + nrm(rec.total);
    var n = seen[base] = (seen[base] || 0) + 1;
    return n > 1 ? base + "#" + n : base;
  }

  // ── ARCH Predict: تصديرا CareWare (الموافقات + الأهلية) يُقبلان كما هما ──
  // يمكن رفع الملفين معاً، أو ملف الأهلية أولاً ثم ملف الموافقات.
  var ELIG = null, SRC_NOTE = "";
  function readAoa(XLSX, file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onerror = function () { rej(new Error("تعذّرت قراءة الملف " + file.name)); };
      fr.onload = function () {
        try {
          var wb = XLSX.read(fr.result, { type: "array", cellDates: true, codepage: 65001 });
          res(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" }));
        } catch (e) { rej(e); }
      };
      fr.readAsArrayBuffer(file);
    });
  }
  function processFiles(files) {
    files = Array.prototype.slice.call(files || []);
    if (!files.length) return;
    var S = window.ARCHSources;
    if (files.length === 1 && !S) return processFile(files[0]);
    $("batchStatus").innerHTML = '<div class="loading" style="padding:16px"><div class="spin"></div>جارٍ قراءة الملفات…</div>';
    loadXLSX().then(function (XLSX) {
      return Promise.all(files.map(function (f) { return readAoa(XLSX, f); })).then(function (aoas) {
        var appr = null, apprName = "", plain = null;
        aoas.forEach(function (aoa, i) {
          var k = S ? S.kind(aoa[0] || []) : null;
          if (k === "eligibility") ELIG = { aoa: aoa, name: files[i].name };
          else if (k === "approvals") { appr = aoa; apprName = files[i].name; }
          else plain = plain || files[i];
        });
        if (appr) {
          var b = S.build(appr, ELIG ? ELIG.aoa : null, COLS);
          SRC_NOTE = S.reportHtml(b.report, ELIG && ELIG.name);
          return handleAoa(XLSX, { name: apprName }, false, b.aoa);
        }
        if (plain) { SRC_NOTE = ""; return processFile(plain); }
        if (ELIG) $("batchStatus").innerHTML = '<div class="note info" style="margin-top:10px"><b>حُمّل ملف الأهلية «' +
          ELIG.name + "» (" + (ELIG.aoa.length - 1).toLocaleString("en") + " فحص).</b> ارفع الآن ملف الموافقات من CareWare " +
          "وسيُربط به تلقائياً بـ Encounter Number.</div>";
      });
    }).catch(showErr);
  }

  function processFile(file) {
    var isCsv = /\.csv$/i.test(file.name);
    SRC_NOTE = "";
    $("batchStatus").innerHTML = '<div class="loading" style="padding:16px"><div class="spin"></div>جارٍ قراءة الملف…</div>';
    loadXLSX().then(function (XLSX) {
      var fr = new FileReader();
      fr.onerror = function () { showErr(new Error("تعذّرت قراءة الملف")); };
      fr.onload = function () {
        try {
          var wb = XLSX.read(fr.result, { type: "array", cellDates: true, codepage: 65001 });
          var ws = wb.Sheets[wb.SheetNames[0]];
          var aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
          if (!aoa.length) throw new Error("الملف فارغ");
          var S = window.ARCHSources, k = S ? S.kind(aoa[0] || []) : null;
          if (k) { processFiles([file]); return; }
          handleAoa(XLSX, file, isCsv, aoa);
        } catch (e) { showErr(e); }
      };
      fr.readAsArrayBuffer(file);
    }).catch(showErr);
  }

  function handleAoa(XLSX, file, isCsv, aoa) {
        try {

          // صف العناوين → فهرس كل مفتاح
          var heads = aoa[0];
          var sm = window.RCMBatchTools.smartMap(COLS, SYN, heads, headerKey);
          var idx = sm.idx;
          MAP_REPORT = sm.report;
          if (Object.keys(idx).length < 2)
            throw new Error("لم أتعرّف على أعمدة كافية — تأكد أن الصف الأول يحوي عناوين الأعمدة (مثل: المبلغ، عقد التأمين، المستشفى…) بأي تسمية قريبة");

          var body = aoa.slice(1).filter(function (r) {
            return r.some(function (v) { return v !== "" && v != null; });
          });
          if (!body.length) throw new Error("لا توجد صفوف بيانات بعد صف العناوين");
          if (body.length > 50000) throw new Error("الحد الأقصى 50,000 صف (طلب) في الملف الواحد");

          scoreAll(XLSX, file, isCsv, heads, idx, body, idColIndex(heads));
        } catch (e) { showErr(e); }
  }

  function scoreAll(XLSX, file, isCsv, heads, idx, body, idIdx) {
    var out = [heads.concat(OUT_HEADS)];
    var counts = { hi: 0, md: 0, lo: 0, nfa: 0, riskSum: 0 };
    var auditRows = [], seen = {}, pivotRows = [];
    // ARCH Predict — صفوف قائمة التدخل ومراقبة النموذج (assets/arch-aco.js)
    var acoRows = [], outIdx = window.ARCHACO ? ARCHACO.outcomeIndex(heads) : -1;
    var insIdx = heads.indexOf("شركة التأمين — المصدر");   // تصدير CareWare: اسم الدافع كما في المصدر
    var pv = function (v) { v = String(v == null ? "" : v).trim(); return v || "غير محدد"; };
    var i = 0, CHUNK = 400;

    function step() {
      var end = Math.min(i + CHUNK, body.length);
      for (; i < end; i++) {
        var rec = {};
        Object.keys(idx).forEach(function (k) { rec[k] = body[i][idx[k]]; });
        var s = scoreRow(rec);
        if (s.proba[NFA] >= 0.65) counts.hi++;
        else if (s.proba[NFA] >= 0.45) counts.md++;
        else counts.lo++;
        if (s.predIdx === 1) counts.nfa++;
        if (s.risk !== "") counts.riskSum += s.risk;
        var amt = parseFloat(rec.total);
        auditRows.push({ k: auditKey(rec, body[i], idIdx, seen),
                         p: s.proba[NFA], a: isFinite(amt) ? amt : 0 });
        pivotRows.push({ dims: { contract: pv(rec.contract), hospital: pv(rec.hospital),
                                 clinic: pv(rec.clinic), band: s.band,
                                 code: s.reasons[0] ? s.reasons[0].label : "—" },
                         amount: isFinite(amt) ? amt : 0, p: s.proba[NFA],
                         risk: s.risk === "" ? 0 : s.risk, hi: s.proba[NFA] >= 0.65 });
        acoRows.push({ k: auditRows[auditRows.length - 1].k, p: s.proba[NFA], a: isFinite(amt) ? amt : 0,
                        risk: s.risk === "" ? 0 : s.risk, r1: s.reasons[0] ? s.reasons[0].label : "",
                        act1: s.reasons[0] ? s.reasons[0].action : "", elig: rec.nphies ? String(rec.nphies) : "", dims: { payer: pv(insIdx >= 0 ? body[i][insIdx] : rec.contract), hospital: pv(rec.hospital), unit: pv(rec.clinic) },
                        month: window.ARCHACO ? ARCHACO.month(rec.visit_date) : "",
                        y: outIdx >= 0 && window.ARCHACO ? ARCHACO.outcome(body[i][outIdx]) : null });
        out.push(body[i].concat(outRow(s)));
      }
      if (i < body.length) {
        $("batchStatus").innerHTML = '<div class="loading" style="padding:16px"><div class="spin"></div>' +
          "جارٍ التسجيل… " + i.toLocaleString("en") + " / " + body.length.toLocaleString("en") + "</div>";
        setTimeout(step, 0);
      } else {
        RESULT = { aoa: out, base: file.name.replace(/\.(xlsx|xls|csv)$/i, ""), isCsv: isCsv, counts: counts, n: body.length,
                   aco: acoRows, audit: { stage: "approvals", noun: "طلب", threshold: THRESHOLD, rows: auditRows },
                   pivot: { rows: pivotRows, hiLabel: "عالية الخطورة", moneyLabel: "المبلغ المعرّض للخطر",
                            actions: ACTION_BY_LABEL,
                            dims: [ { key: "band", label: "نطاق الخطر" },
                                    { key: "contract", label: "عقد التأمين" },
                                    { key: "hospital", label: "المستشفى" },
                                    { key: "clinic", label: "القسم / العيادة" },
                                    { key: "code", label: "السبب المرجّح" } ] } };
        renderResult();
      }
    }
    step();
  }

  function renderResult() {
    var c = RESULT.counts, n = RESULT.n;
    var h = '<div class="note info" style="margin-top:10px"><b>اكتمل تسجيل ' + n.toLocaleString("en") + " طلباً.</b> " +
      'التنبؤ «موافقة غير كاملة» لـ <b>' + c.nfa.toLocaleString("en") + "</b> طلباً (" +
      (n ? Math.round(c.nfa / n * 100) : 0) + "%). النطاقات: " +
      '<b style="color:var(--red)">' + c.hi.toLocaleString("en") + " مرتفع</b> · " +
      '<b style="color:var(--yellow,#96590f)">' + c.md.toLocaleString("en") + " متوسّط</b> · " +
      '<b style="color:var(--green)">' + c.lo.toLocaleString("en") + " منخفض</b>" +
      (c.riskSum ? " · إجمالي المبلغ المعرّض للخطر <b>" + Math.round(c.riskSum).toLocaleString("en") + " ﷼</b>" : "") +
      "</div>";
    h += '<div class="btn-row">' +
      '<button class="btn" id="dlXlsx" style="width:auto;padding:11px 22px">⬇️ تنزيل النتائج Excel</button>' +
      '<button class="btn ghost" id="dlCsv" style="width:auto;padding:11px 22px">⬇️ تنزيل النتائج CSV</button></div>';

    // معاينة أول 10 صفوف: أعمدة النتائج الأهم فقط
    var aoa = RESULT.aoa, nIn = aoa[0].length - OUT_HEADS.length;
    var showCols = [nIn, nIn + 2, nIn + 3, nIn + 5, nIn + 6];
    h += '<div class="tw" style="overflow-x:auto;margin-top:12px"><table><tr>' +
      "<th>#</th>" + showCols.map(function (ci) {
        return "<th>" + String(aoa[0][ci]).replace(/\s*\([a-z0-9_]+\)\s*$/i, "") + "</th>";
      }).join("") + "</tr>";
    for (var r = 1; r < Math.min(11, aoa.length); r++) {
      h += "<tr><td>" + r + "</td>" + showCols.map(function (ci) {
        var v = aoa[r][ci];
        if (typeof v === "number" && ci === nIn + 2) v = (v * 100).toFixed(1) + "%";
        return "<td>" + (v == null ? "" : v) + "</td>";
      }).join("") + "</tr>";
    }
    h += "</table></div>";
    if (aoa.length > 11) h += '<p style="font-size:11.5px;color:var(--muted2)">المعاينة لأول 10 صفوف — الملف الكامل في التنزيل.</p>';
    if (SRC_NOTE) h += SRC_NOTE;
    else if (MAP_REPORT) h += window.RCMBatchTools.mapReportHtml(MAP_REPORT);
    h += '<div id="batchPivot"></div>';
    $("batchStatus").innerHTML = h;
    if (RESULT.pivot) window.RCMBatchTools.pivotUI("batchPivot", RESULT.pivot);

    $("dlXlsx").onclick = function () {
      loadXLSX().then(function (XLSX) {
        var wb = XLSX.utils.book_new();
        wb.Workbook = { Views: [{ RTL: true }] };
        var ws = XLSX.utils.aoa_to_sheet(RESULT.aoa);
        XLSX.utils.book_append_sheet(wb, ws, "النتائج");
        if (RESULT.pivot) {
          var pw = XLSX.utils.aoa_to_sheet(window.RCMBatchTools.pivotAoa(RESULT.pivot));
          pw["!cols"] = [{ wch: 30 }, { wch: 16 }, { wch: 11 }, { wch: 12 },
            { wch: 24 }, { wch: 8 }, { wch: 24 }, { wch: 8 }, { wch: 24 }, { wch: 8 },
            { wch: 44 }, { wch: 8 }, { wch: 44 }, { wch: 8 }, { wch: 44 }, { wch: 8 }, { wch: 24 }];
          XLSX.utils.book_append_sheet(wb, pw, "الملخص المحوري");
        }
        XLSX.writeFile(wb, RESULT.base + "-scored-" + stamp() + ".xlsx");
      }).catch(showErr);
    };
    $("dlCsv").onclick = function () {
      loadXLSX().then(function (XLSX) {
        var ws = XLSX.utils.aoa_to_sheet(RESULT.aoa);
        var csv = "\ufeff" + XLSX.utils.sheet_to_csv(ws);   // BOM ليقرأ Excel العربية UTF-8
        saveBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), RESULT.base + "-scored-" + stamp() + ".csv");
      }).catch(showErr);
    };

    if (window.RCMAudit && RCMAudit.onBatch) RCMAudit.onBatch(RESULT.audit);
    if (window.ARCHACO) ARCHACO.onBatch({ stage: RESULT.audit.stage, noun: RESULT.audit.noun, threshold: THRESHOLD, file: RESULT.base, rows: RESULT.aco });
  }

  function showErr(e) {
    $("batchStatus").innerHTML = '<div class="err" style="margin-top:10px"><b>تعذّرت المعالجة:</b> ' +
      (e && e.message ? e.message : e) + "</div>";
  }

  // ── بناء التبويب ──
  function render() {
    var host = $("batchBody");
    var h = '<div class="card">';
    h += '<div class="sec-label">📂 التنبؤ بواسطة ملف Excel أو CSV</div>';
    h += '<p style="font-size:13px;color:var(--muted2);line-height:1.9;margin:0 0 12px">' +
      "نزّل القالب وعبّئ كل طلب في صف، ثم ارفع الملف — تُسجَّل كل الصفوف بنفس نموذج " +
      "المنصّة وتنزل النتائج ملف Excel أو CSV. <b>تتم المعالجة كاملةً داخل متصفّحك: " +
      "لا يُرسل الملف ولا أي بيانات إلى أي خادم.</b></p>";
    h += '<div class="btn-row" style="justify-content:flex-start;align-items:center">' +
      '<button class="btn ghost" id="dlTemplate" style="width:auto;padding:11px 22px">📄 تنزيل قالب Excel</button>' +
      '<span style="border-inline-start:1px solid var(--border);align-self:stretch"></span>' +
      '<label style="font-size:12.5px;color:var(--muted2)">مولّد ملفات تجريبية:</label>' +
      '<input type="number" id="genCount" value="100" min="1" max="' + GEN_MAX + '" ' +
        'style="width:92px;padding:9px;border:1px solid var(--border);border-radius:8px;background:var(--card);' +
        'color:var(--text);font-family:inherit;font-size:13px;text-align:center" title="عدد الصفوف (حتى ' + GEN_MAX.toLocaleString("en") + ')">' +
      '<button class="btn ghost" id="genXlsx" style="width:auto;padding:11px 18px">🎲 ملف Excel تجريبي</button>' +
      '<button class="btn ghost" id="genCsv" style="width:auto;padding:11px 18px">🎲 ملف CSV تجريبي</button></div>';
    h += '<p style="font-size:11.5px;color:var(--muted2);margin:6px 0 0">المولّد غير محدود: كل ضغطة تنتج ملفاً جديداً ' +
      "بصفوف عشوائية واقعية الشكل من قوائم النموذج نفسها — جاهزاً للرفع هنا مباشرةً لتجربة التسجيل الدفعي.</p>";
    h += '<div id="dropZone" style="margin-top:12px;border:2px dashed var(--border);border-radius:12px;' +
      'padding:34px 16px;text-align:center;color:var(--muted2);font-size:13.5px;cursor:pointer">' +
      '<div style="font-size:30px;margin-bottom:6px">⬆️</div>' +
      "اسحب ملف <b>Excel (.xlsx)</b> أو <b>CSV</b> هنا (أو تصديرَي CareWare معاً)، أو اضغط للاختيار" +
      '<input type="file" id="batchFile" accept=".xlsx,.xls,.csv" multiple style="display:none"></div>' +
      '<p style="font-size:11.5px;color:var(--muted2);margin:6px 0 0"><b>تصديرا CareWare مقبولان كما هما:</b> ارفع ملف الموافقات ' +
      "(سطر لكل خدمة) وحده أو مع ملف الأهلية معاً — تُجمَّع الخدمات في طلب واحد (المستشفى + رقم الطلب)، ويُربط فحص الأهلية " +
      "بـ Encounter Number، وتُحذف أعمدة الهوية عند القراءة. الطلبات ذات القرار تغذّي «مراقبة النموذج» تلقائياً.</p>";
    h += '<div id="batchStatus"></div>';
    h += "</div>";
    host.innerHTML = h;

    $("dlTemplate").onclick = downloadTemplate;
    $("genXlsx").onclick = function () { downloadDemo(false); };
    $("genCsv").onclick = function () { downloadDemo(true); };
    var dz = $("dropZone"), fi = $("batchFile");
    dz.onclick = function () { fi.click(); };
    fi.onchange = function () { if (fi.files.length) { processFiles(fi.files); fi.value = ""; } };
    dz.ondragover = function (e) { e.preventDefault(); dz.style.borderColor = "var(--accent)"; };
    dz.ondragleave = function () { dz.style.borderColor = "var(--border)"; };
    dz.ondrop = function (e) {
      e.preventDefault(); dz.style.borderColor = "var(--border)";
      if (e.dataTransfer.files && e.dataTransfer.files.length) processFiles(e.dataTransfer.files);
    };
  }

  var drawn = false;
  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest('[data-p="batch"]');
    if (t && !drawn) { drawn = true; render(); }
  });
  if (document.querySelector('[data-p="batch"].active')) { drawn = true; render(); }
})();
