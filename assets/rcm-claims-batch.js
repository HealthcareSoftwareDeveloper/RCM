/*!
 * rcm-claims-batch.js — تبويب «التنبؤ بالملفات» في ARCH Predict للمطالبات
 * ARCH Predict · ARCH Systems
 *
 * رفع Excel/CSV وتسجيل كل مطالبة بنفس نموذج الصفحة داخل المتصفح — بترميز
 * الصفحة نفسه (window.RCM_CLAIMS.encode) فتتطابق نتيجة الملف مع الإدخال
 * اليدوي تماماً. مع قالب Excel جاهز ومولّد ملفات تجريبية غير محدود.
 * لا يُرسل الملف ولا أي بيانات إلى أي خادم.
 */
(function () {
  "use strict";

  var B = window.RCM_CLAIMS_BUNDLE, E = window.RCMEngine,
      $ = function (id) { return document.getElementById(id); };
  if (!B || !B.approval || !E) return;

  var NFP = 1;
  var THRESHOLD = B.approval.threshold || 0.5;
  var RL = (B.reason && B.reason.labels) || [];
  // تسمية كل سبب ← إجراؤه المقترح (للملخّص المحوري)
  var ACTION_BY_LABEL = {};
  RL.forEach(function (code) {
    ACTION_BY_LABEL[B.reason.labels_ar[code] || code] = B.reason.actions[code] || "";
  });

  // ── الأعمدة: المفتاح اللاتيني بين قوسين هو ما يُطابَق عليه عند القراءة ──
  var COLS = [
    { key: "amount",       head: "إجمالي المطالبة (amount)",             ex: [180, 900, 2600] },
    { key: "visit_date",   head: "تاريخ الزيارة (visit_date)",           ex: ["2026-06-10", "2026-06-05", "2026-04-01"] },
    { key: "submit_date",  head: "تاريخ التقديم (submit_date)",          ex: ["2026-06-25", "2026-07-01", "2026-07-20"] },
    { key: "visit_type",   head: "نوع الزيارة (visit_type)",             dd: "visit_type", ex: ["opd", "opd", "ip"] },
    { key: "hospital",     head: "المستشفى (hospital)",                  dd: "hospital", ex: ["al noor specialist hospital", "ajyad emergency hospital", "hera general hospital"] },
    { key: "insurance",    head: "شركة التأمين (insurance)",             dd: "insurance", ex: ["bupa", "tcs-tawuiya- uomra", "OTHER"] },
    { key: "tpa",          head: "مدير المطالبات TPA (tpa)",             dd: "tpa", ex: ["bupa", "tcs", "OTHER"] },
    { key: "icd",          head: "رمز التشخيص ICD-10 (icd)",             ex: ["E11.9", "R51", "S72.0"] },
    { key: "physician",    head: "الطبيب المعالج (physician)",           dd: "physician", ex: ["OTHER", "OTHER", "OTHER"] },
    { key: "nationality",  head: "الجنسية (nationality)",                dd: "nationality", ex: ["saudi", "egyptian", ""] },
    { key: "id_type",      head: "نوع الهوية (id_type)",                 dd: "id_type", ex: ["national_id", "iqama", "passport_other"] },
    { key: "has_approval", head: "موافقة مسبقة؟ 1/0 (has_approval)",     ex: [1, 0, 1] },
    { key: "attempt",      head: "رقم محاولة التقديم 1-5 (attempt)",     ex: [1, 1, 2] },
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

  // الحقل الفارغ يأخذ نفس افتراضات الصفحة — فيتطابق تسجيل الملف مع الإدخال اليدوي
  var DD_DEFAULT = {};
  COLS.forEach(function (c) {
    if (!c.dd) return;
    var first = (B.options[c.dd] || [])[0];
    DD_DEFAULT[c.key] = first ? first.v : "";
  });

  // مرادفات عناوين الأعمدة — للمطابقة الذكية حين تختلف التسمية أو الترتيب
  var SYN = {
    amount:       ["amount", "total", "net amount", "gross amount", "claim amount", "المبلغ", "القيمه", "قيمه المطالبه", "اجمالي المطالبه", "اجمالي الفاتوره", "المبلغ الاجمالي", "صافي المبلغ"],
    visit_date:   ["visit date", "service date", "admission date", "encounter date", "تاريخ الزياره", "تاريخ الخدمه", "تاريخ الدخول"],
    submit_date:  ["submit date", "submission date", "claim date", "billing date", "تاريخ التقديم", "تاريخ الارسال", "تاريخ المطالبه", "تاريخ الفوتره"],
    visit_type:   ["visit type", "encounter type", "patient type", "نوع الزياره", "نوع الحاله", "نوع المريض"],
    hospital:     ["hospital", "facility", "provider", "center", "المستشفي", "المنشاه", "مقدم الخدمه", "المركز"],
    insurance:    ["insurance", "payer", "insurer", "insurance company", "شركه التامين", "التامين", "جهه التامين", "الشركه المؤمنه", "الضامن"],
    tpa:          ["tpa", "third party", "claims administrator", "مدير المطالبات", "اداره المطالبات"],
    icd:          ["icd", "icd10", "diagnosis", "dx", "diagnosis code", "التشخيص", "رمز التشخيص"],
    physician:    ["physician", "doctor", "practitioner", "الطبيب", "الطبيب المعالج", "الدكتور"],
    nationality:  ["nationality", "الجنسيه"],
    id_type:      ["id type", "identity type", "document type", "نوع الهويه", "نوع الوثيقه"],
    has_approval: ["approval", "pre auth", "preauth", "prior auth", "authorization", "موافقه مسبقه", "الموافقه المسبقه", "اذن مسبق", "رقم الموافقه"],
    attempt:      ["attempt", "submission count", "resubmission", "المحاوله", "رقم المحاوله", "محاوله التقديم"],
  };

  function normCat(key, raw) {
    if (raw == null || raw === "") return DD_DEFAULT[key] || "";
    if (key === "physician" && window.RCMDocMap) {
      var dc = RCMDocMap.codeFor(raw);
      if (dc) return dc;
    }
    var s = String(raw).trim();
    var m = VALUE_MAPS[key];
    return (m && m[s.toLowerCase()] !== undefined) ? m[s.toLowerCase()] : s;
  }

  function normBool(raw, dflt) {
    if (raw == null || raw === "") return dflt;
    var s = String(raw).trim().toLowerCase();
    if (["1", "نعم", "yes", "true", "y"].indexOf(s) >= 0) return "1";
    if (["0", "لا", "no", "false", "n"].indexOf(s) >= 0) return "0";
    return dflt;
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

    var rows = [COLS.map(function (c) { return c.head; })];
    for (var i = 0; i < 3; i++) rows.push(COLS.map(function (c) { return c.ex[i]; }));
    var ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = COLS.map(function (c) { return { wch: Math.max(18, c.head.length + 2) }; });
    XLSX.utils.book_append_sheet(wb, ws, "المطالبات");

    var av = [["الحقل", "القيمة (تُكتب في القالب)", "الاسم المعروض"]];
    COLS.forEach(function (c) {
      if (!c.dd) return;
      (B.options[c.dd] || []).forEach(function (o) {
        av.push([c.head, o.v, o.l || ""]);
      });
      av.push(["", "", ""]);
    });
    av.push(["موافقة مسبقة؟ (has_approval)", "1 أو 0", "1 = يوجد رقم موافقة مسبقة · 0 = لا يوجد"]);
    av.push(["رقم محاولة التقديم (attempt)", "1 إلى 5", "1 = الأولى، وما فوقها إعادة تقديم"]);
    var ws2 = XLSX.utils.aoa_to_sheet(av);
    ws2["!cols"] = [{ wch: 40 }, { wch: 36 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, ws2, "القيم المسموحة");

    var inst = [
      ["تعليمات تعبئة القالب — ARCH Predict للمطالبات"],
      [""],
      ["1. عبّئ ورقة «المطالبات»: كل صف مطالبة واحدة. الصفوف الثلاثة الموجودة أمثلة — احذفها أو استبدلها."],
      ["2. المطابقة ذكية: يقبل الرفع أي ترتيب أعمدة وأي تسمية قريبة (عربية أو إنجليزية)، والحقل غير الموجود يأخذ افتراضات الصفحة — وستظهر لك خريطة الأعمدة بعد الرفع."],
      ["3. حقول القوائم (المستشفى، شركة التأمين…) تقبل القيمة الآلية أو الاسم المعروض كما في ورقة «القيم المسموحة»."],
      ["4. أي قيمة خارج القوائم تُعامل «أخرى / غير مدرج»، والحقل الفارغ يأخذ نفس افتراضات الصفحة."],
      ["5. رمز التشخيص ICD-10 يُشتقّ منه الفصل والكتلة تلقائياً (مثال: E11.9)."],
      ["6. التاريخان بصيغة 2026-06-10 أو خليتي تاريخ في Excel — ومنهما تُحسب مهلة التقديم تلقائياً."],
      ["7. الطبيب المعالج: المنصّة تستخدم رموزاً مستعارة (doc-001…) حمايةً للبيانات الشخصية — اكتب الرمز، أو الاسم الحقيقي بعد تحميل ملف الرموز الخاص الموزَّع داخلياً (زر 🔒 في التبويب)."],
      ["8. ارفع الملف في تبويب «التنبؤ بالملفات» — تُعالَج البيانات داخل متصفّحك ولا تُرسل لأي خادم."],
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
      XLSX.writeFile(buildTemplate(XLSX), "namaa-claims-template.xlsx");
    }).catch(showErr);
  }

  // ── مولّد ملفات تجريبية غير محدود ──
  var GEN_MAX = 50000;

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

  function isoDate(d) {
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function randomClaim() {
    var vd = new Date(Date.now() - Math.random() * 150 * 24 * 3600 * 1000);
    var sd = new Date(vd.getTime() + (2 + Math.random() * 40) * 24 * 3600 * 1000);
    if (sd > new Date()) sd = new Date();
    var lo = Math.log(30), hi = Math.log(20000);
    var blocks = (B.options.icd_block || []).filter(function (o) { return /^[A-Z][0-9]{2}$/.test(o.v); });
    var r = Math.random();
    return {
      amount: Math.round(Math.exp(lo + Math.random() * (hi - lo)) * 100) / 100,
      visit_date: isoDate(vd),
      submit_date: isoDate(sd),
      visit_type: wpick(B.options.visit_type || []),
      hospital: wpick(B.options.hospital || []),
      insurance: wpick(B.options.insurance || []),
      tpa: wpick(B.options.tpa || []),
      icd: blocks.length ? wpick(blocks) + "." + Math.floor(Math.random() * 10) : "R51",
      physician: wpick(B.options.physician || []),
      nationality: wpick(B.options.nationality || []),
      id_type: wpick(B.options.id_type || []),
      has_approval: Math.random() < 0.66 ? 1 : 0,
      attempt: r < 0.8 ? 1 : r < 0.97 ? 2 : 3,
    };
  }

  function buildDemoAoa(n) {
    var aoa = [COLS.map(function (c) { return c.head; })];
    for (var i = 0; i < n; i++) {
      var r = randomClaim();
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
    var n = genCount();
    loadXLSX().then(function (XLSX) {
      var aoa = buildDemoAoa(n);
      var ws = XLSX.utils.aoa_to_sheet(aoa);
      if (asCsv) {
        var csv = "\ufeff" + XLSX.utils.sheet_to_csv(ws);   // BOM ليقرأ Excel العربية UTF-8
        saveBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), "namaa-claims-demo-" + n + "-" + stamp() + ".csv");
      } else {
        var wb = XLSX.utils.book_new();
        wb.Workbook = { Views: [{ RTL: true }] };
        ws["!cols"] = COLS.map(function (c) { return { wch: Math.max(18, c.head.length + 2) }; });
        XLSX.utils.book_append_sheet(wb, ws, "المطالبات");
        XLSX.writeFile(wb, "namaa-claims-demo-" + n + "-" + stamp() + ".xlsx");
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

  function cellDate(v) {
    if (v instanceof Date && !isNaN(v.getTime())) return isoDate(v);
    if (v == null || v === "") return "";
    return String(v).trim().split(" ")[0];
  }

  // ── مفاتيح مطابقة الصفوف لتتبّع الملفات وقياس الاستنقاذ (rcm-audit.js) ──
  // عمود معرّف اختياري إن وُجد في الملف، وإلا بصمة من الحقول التي لا تتغيّر
  // عند المعالجة (تاريخ الزيارة، الشركة، الطبيب، المبلغ).
  function idColIndex(heads) {
    for (var i = 0; i < heads.length; i++) {
      var h = String(heads[i] == null ? "" : heads[i]);
      if (headerKey(h) == null && /معر|claim[ _-]?id|\bid\b|\(id\)|^ref|reference/i.test(h)) return i;
    }
    return -1;
  }
  function auditKey(rec, rawRow, idIdx, seen) {
    var nrm = function (v) { return String(v == null ? "" : v).trim().toLowerCase(); };
    var idv = idIdx >= 0 ? nrm(rawRow[idIdx]) : "";
    var base = idv ? "id:" + idv :
      cellDate(rec.visit_date) + "|" + nrm(rec.insurance) + "|" + nrm(rec.physician) + "|" + nrm(rec.amount);
    var n = seen[base] = (seen[base] || 0) + 1;
    return n > 1 ? base + "#" + n : base;
  }

  /** يبني مدخل الصفحة نفسه ثم يرمّزه بترميز الصفحة (window.RCM_CLAIMS.encode) */
  function toInput(rec) {
    var icd = (rec.icd == null ? "" : String(rec.icd)).trim().toUpperCase().replace(/\s/g, "");
    var mCh = icd.match(/^([A-Z])/), mBl = icd.match(/^([A-Z][0-9]{2})/);
    var submit = cellDate(rec.submit_date) || isoDate(new Date());
    var visit = cellDate(rec.visit_date);
    if (!visit) {   // نفس افتراض الصفحة: الزيارة قبل التقديم بوسيط المهلة 19 يوماً
      var sd = new Date(submit);
      visit = isoDate(new Date(sd.getTime() - 19 * 24 * 3600 * 1000));
    }
    return {
      amount: rec.amount, visitDate: visit, submitDate: submit,
      visitType: normCat("visit_type", rec.visit_type),
      hospital: normCat("hospital", rec.hospital),
      insurance: normCat("insurance", rec.insurance),
      tpa: normCat("tpa", rec.tpa),
      nationality: normCat("nationality", rec.nationality),
      idType: normCat("id_type", rec.id_type),
      physician: normCat("physician", rec.physician),
      icdChapter: mCh ? mCh[1] : "", icdBlock: mBl ? mBl[1] : "",
      hasApproval: normBool(rec.has_approval, "1"),
      attempt: String(Math.max(1, Math.min(5, parseInt(rec.attempt, 10) || 1))),
    };
  }

  function band(p) {
    if (p >= Math.max(THRESHOLD, 0.85)) return "خطر مرتفع جداً";
    if (p >= THRESHOLD) return "فوق عتبة الإنذار";
    if (p >= 0.6) return "تحت العتبة — يستحق مراجعة";
    return "منخفض نسبياً";
  }

  function scoreRow(rec) {
    var x = window.RCM_CLAIMS.encode(toInput(rec));
    E.prepare(B.approval.trees);
    var proba = E.toProba(E.rawScores(B.approval.trees, x, 1), B.approval);
    var pNFP = proba[NFP];
    var predIdx = pNFP >= THRESHOLD ? 1 : 0;

    var amount = parseFloat(rec.amount);
    var expv = "", risk = "";
    if (isFinite(amount) && amount > 0) {
      var rc = B.recovery, keys = B.classes;
      var e = amount * (proba[0] * rc[keys[0]] + proba[1] * rc[keys[1]]);
      expv = Math.round(e * 100) / 100;
      risk = Math.round((amount - e) * 100) / 100;
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
    return { proba: proba, predIdx: predIdx, band: band(pNFP), expv: expv, risk: risk, reasons: reasons };
  }

  var OUT_HEADS = [
    "التنبؤ (prediction)", "احتمال السداد الكامل (p_paid)",
    "احتمال عدم السداد الكامل (p_not_fully_paid)", "نطاق الخطر (risk_band)",
    "الإيراد المتوقّع تحصيله (expected_revenue)", "المبلغ المعرّض للخطر (amount_at_risk)",
    "رمز الرفض المرجّح 1 (denial_1)", "نسبته (denial_1_p)", "الإجراء المقترح (denial_1_action)",
    "رمز الرفض المرجّح 2 (denial_2)", "نسبته (denial_2_p)", "إجراؤه المقترح (denial_2_action)",
    "رمز الرفض المرجّح 3 (denial_3)", "نسبته (denial_3_p)", "إجراؤه المقترح (denial_3_action)",
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

  var RESULT = null;
  var MAP_REPORT = null;

  function processFile(file) {
    var isCsv = /\.csv$/i.test(file.name);
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

          var heads = aoa[0];
          var sm = window.RCMBatchTools.smartMap(COLS, SYN, heads, headerKey);
          var idx = sm.idx;
          MAP_REPORT = sm.report;
          if (Object.keys(idx).length < 2)
            throw new Error("لم أتعرّف على أعمدة كافية — تأكد أن الصف الأول يحوي عناوين الأعمدة (مثل: المبلغ، شركة التأمين، تاريخ الزيارة…) بأي تسمية قريبة");

          var body = aoa.slice(1).filter(function (r) {
            return r.some(function (v) { return v !== "" && v != null; });
          });
          if (!body.length) throw new Error("لا توجد صفوف بيانات بعد صف العناوين");
          if (body.length > GEN_MAX) throw new Error("الحد الأقصى 50,000 صف في الملف الواحد");

          scoreAll(XLSX, file, isCsv, heads, idx, body, idColIndex(heads));
        } catch (e) { showErr(e); }
      };
      fr.readAsArrayBuffer(file);
    }).catch(showErr);
  }

  function scoreAll(XLSX, file, isCsv, heads, idx, body, idIdx) {
    var out = [heads.concat(OUT_HEADS)];
    var counts = { over: 0, nfp: 0, riskSum: 0 };
    var auditRows = [], seen = {}, pivotRows = [];
    // ARCH Predict — صفوف قائمة التدخل ومراقبة النموذج (assets/arch-aco.js)
    var acoRows = [], outIdx = window.ARCHACO ? ARCHACO.outcomeIndex(heads) : -1;
    var pv = function (v) { v = String(v == null ? "" : v).trim(); return v || "غير محدد"; };
    var i = 0, CHUNK = 400;

    function step() {
      var end = Math.min(i + CHUNK, body.length);
      for (; i < end; i++) {
        var rec = {};
        Object.keys(idx).forEach(function (k) { rec[k] = body[i][idx[k]]; });
        var s = scoreRow(rec);
        if (s.proba[NFP] >= THRESHOLD) counts.over++;
        if (s.predIdx === 1) counts.nfp++;
        if (s.risk !== "") counts.riskSum += s.risk;
        var amt = parseFloat(rec.amount);
        auditRows.push({ k: auditKey(rec, body[i], idIdx, seen),
                         p: s.proba[NFP], a: isFinite(amt) ? amt : 0 });
        pivotRows.push({ dims: { insurance: pv(rec.insurance), hospital: pv(rec.hospital),
                                 visit_type: pv(rec.visit_type), band: s.band,
                                 code: s.reasons[0] ? s.reasons[0].label : "—" },
                         amount: isFinite(amt) ? amt : 0, p: s.proba[NFP],
                         risk: s.risk === "" ? 0 : s.risk, hi: s.proba[NFP] >= THRESHOLD });
        acoRows.push({ k: auditRows[auditRows.length - 1].k, p: s.proba[NFP], a: isFinite(amt) ? amt : 0,
                        risk: s.risk === "" ? 0 : s.risk, r1: s.reasons[0] ? s.reasons[0].label : "",
                        act1: s.reasons[0] ? s.reasons[0].action : "", elig: "", dims: { payer: pv(rec.insurance), hospital: pv(rec.hospital), unit: pv(rec.visit_type) },
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
                   aco: acoRows, audit: { stage: "claims", noun: "مطالبة", threshold: THRESHOLD, rows: auditRows },
                   pivot: { rows: pivotRows, hiLabel: "عالية الخطورة", moneyLabel: "المبلغ المعرّض للخطر",
                            actions: ACTION_BY_LABEL,
                            dims: [ { key: "band", label: "نطاق الخطر" },
                                    { key: "insurance", label: "شركة التأمين" },
                                    { key: "hospital", label: "المستشفى" },
                                    { key: "code", label: "رمز الرفض المرجّح" },
                                    { key: "visit_type", label: "نوع الزيارة" } ] } };
        renderResult();
      }
    }
    step();
  }

  function renderResult() {
    var c = RESULT.counts, n = RESULT.n;
    var h = '<div class="note" style="margin-top:10px"><b>اكتمل تسجيل ' + n.toLocaleString("en") + " مطالبة.</b> " +
      'التنبؤ «سداد غير كامل» لـ <b style="color:var(--red)">' + c.nfp.toLocaleString("en") + "</b> مطالبة (" +
      (n ? Math.round(c.nfp / n * 100) : 0) + "%) عند العتبة " + THRESHOLD +
      (c.riskSum ? " · إجمالي المبلغ المعرّض للخطر <b>" + Math.round(c.riskSum).toLocaleString("en") + " ﷼</b>" : "") +
      "</div>";
    h += '<div class="btn-row">' +
      '<button class="btn" id="dlXlsx" style="width:auto;padding:11px 22px">⬇️ تنزيل النتائج Excel</button>' +
      '<button class="btn ghost" id="dlCsv" style="width:auto;padding:11px 22px">⬇️ تنزيل النتائج CSV</button></div>';

    var aoa = RESULT.aoa, nIn = aoa[0].length - OUT_HEADS.length;
    var showCols = [nIn, nIn + 2, nIn + 3, nIn + 5, nIn + 6];
    h += '<div class="tbl-wrap" style="margin-top:12px"><table><tr>' +
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
    if (MAP_REPORT) h += window.RCMBatchTools.mapReportHtml(MAP_REPORT);
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
      "نزّل القالب وعبّئ كل مطالبة في صف، ثم ارفع الملف — تُسجَّل كل الصفوف بنفس نموذج " +
      "المنصّة وترميزها، فتتطابق النتيجة مع الإدخال اليدوي تماماً، وتنزل النتائج ملف " +
      "Excel أو CSV. <b>تتم المعالجة كاملةً داخل متصفّحك: لا يُرسل الملف ولا أي بيانات " +
      "إلى أي خادم.</b></p>";
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
      "بمطالبات عشوائية واقعية الشكل من قوائم النموذج نفسها — جاهزاً للرفع هنا مباشرةً لتجربة التسجيل الدفعي.</p>";
    h += '<div id="docmapRow" style="margin-top:10px;padding:10px 12px;background:var(--surface);' +
      'border:1px solid var(--border);border-radius:10px;font-size:12px;color:var(--muted2);' +
      'display:flex;gap:10px;align-items:center;flex-wrap:wrap"></div>';
    h += '<div id="dropZone" style="margin-top:12px;border:2px dashed var(--border);border-radius:12px;' +
      'padding:34px 16px;text-align:center;color:var(--muted2);font-size:13.5px;cursor:pointer">' +
      '<div style="font-size:30px;margin-bottom:6px">⬆️</div>' +
      "اسحب ملف <b>Excel (.xlsx)</b> أو <b>CSV</b> هنا، أو اضغط للاختيار" +
      '<input type="file" id="batchFile" accept=".xlsx,.xls,.csv" style="display:none"></div>';
    h += '<div id="batchStatus"></div>';
    h += "</div>";
    host.innerHTML = h;

    $("dlTemplate").onclick = downloadTemplate;
    $("genXlsx").onclick = function () { downloadDemo(false); };
    $("genCsv").onclick = function () { downloadDemo(true); };
    renderDocmapRow();
    var dz = $("dropZone"), fi = $("batchFile");
    dz.onclick = function () { fi.click(); };
    fi.onchange = function () { if (fi.files[0]) { processFile(fi.files[0]); fi.value = ""; } };
    dz.ondragover = function (e) { e.preventDefault(); dz.style.borderColor = "var(--accent)"; };
    dz.ondragleave = function () { dz.style.borderColor = "var(--border)"; };
    dz.ondrop = function (e) {
      e.preventDefault(); dz.style.borderColor = "var(--border)";
      var f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) processFile(f);
    };
  }

  // ── الملف الخاص لرموز الأطباء: يُحمَّل محلياً ولا يغادر المتصفح ──
  function renderDocmapRow() {
    var row = $("docmapRow");
    if (!row || !window.RCMDocMap) { if (row) row.style.display = "none"; return; }
    var n = RCMDocMap.count();
    row.innerHTML =
      '<span>🔒 <b>ملف رموز الأطباء (خاص):</b> ' +
      (n ? "محمَّل — " + n + " طبيباً. أسماء الأطباء في ملفاتك ستُترجم لرموزها محلياً، وتظهر بجانب الرموز في قوائم الإدخال اليدوي بعد إعادة تحميل الصفحة."
         : "غير محمَّل — أسماء الأطباء الحقيقية في ملفاتك ستُعامل «أخرى». حمّل الملف الموزَّع داخلياً لتفعيل الترجمة.") +
      "</span>" +
      '<button class="btn ghost" id="docmapLoad" style="width:auto;padding:7px 14px">' +
        (n ? "استبدال الملف" : "تحميل الملف الخاص") + "</button>" +
      (n ? '<button class="btn ghost" id="docmapClear" style="width:auto;padding:7px 14px">إزالة</button>' : "") +
      '<input type="file" id="docmapFile" accept=".xlsx,.xls,.csv" style="display:none">' +
      '<span style="flex-basis:100%;font-size:11px;color:var(--muted)">يُحفظ في متصفحك وحده ولا يُرسَل لأي مكان — حمايةً لبيانات الأطباء لم تعد الأسماء تُنشر في المنصّة.</span>';
    $("docmapLoad").onclick = function () { $("docmapFile").click(); };
    if (n) $("docmapClear").onclick = function () { RCMDocMap.clear(); renderDocmapRow(); };
    $("docmapFile").onchange = function () {
      var f = this.files[0]; this.value = "";
      if (!f) return;
      loadXLSX().then(function (XLSX) {
        var fr = new FileReader();
        fr.onload = function () {
          try {
            var wb = XLSX.read(fr.result, { type: "array", codepage: 65001 });
            var aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" });
            var cnt = RCMDocMap.loadFromRows(aoa);
            if (!cnt) alert("لم أجد عمودي الرمز (doc-###) والاسم في الملف — تأكد أنه ملف الربط الخاص الموزَّع داخلياً.");
            renderDocmapRow();
          } catch (e) { alert("تعذّرت قراءة الملف: " + e.message); }
        };
        fr.readAsArrayBuffer(f);
      }).catch(showErr);
    };
  }

  var drawn = false;
  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest('[data-p="batch"]');
    if (t && !drawn) { drawn = true; render(); }
  });
  if (document.querySelector('[data-p="batch"].active')) { drawn = true; render(); }
})();
