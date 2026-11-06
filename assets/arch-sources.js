/*!
 * arch-sources.js — طبقة مصادر البيانات في المتصفح (مطابقة لـ model/careware_sources.py)
 * ARCH Predict · ARCH Systems
 *
 * تقبل تصدير CareWare للموافقات (سطر لكل خدمة) وتصدير الأهلية (سطر لكل فحص) كما
 * يخرجان من النظام، وتحوّلهما إلى «طلب موافقة» واحد بأعمدة قالب المنصّة:
 *   • الطلب = اسم المستشفى + رقم الطلب (رقم الطلب يتكرر بين المستشفيات).
 *   • الربط مع الأهلية بـ Encounter Number — المكتمل أولاً ثم الأحدث.
 *   • سجل المريض السابق يُحسب من الملف نفسه (بلا تسريب: من الطلبات الأسبق فقط).
 * الخصوصية: أعمدة الاسم والهوية ورقم المريض والطبيب والمستخدم لا تُنسخ إلى أي مخرَج.
 */
(function () {
  "use strict";

  var APPROVAL_SIG = ["رقم الطلب", "حالة رفع طلب الموافقة", "مبلغ الفاتورة", "Encounter Number"];
  var ELIG_SIG = ["Encounter Number", "Visit Nphies Eligibility Check", "Requeststatustext"];
  var PHI = ["اسم المريض", "رقم هوية المريض", "Patient Id", "اسم الطبيب المعالج", "اسم المستخدم",
             "English Name", "Arabic Name", "Patient Identifier", "Visit User Name", "Mrn", "رقم المريض", "Episode No"];
  var VISIT_TYPE = { "طوارئ": "er", "عيادات": "opd", "تنويم": "ip", emergeny: "er", emergency: "er",
                     outpatient: "opd", inpatient: "ip", er: "er", opd: "opd", ip: "ip" };
  var DECIDED = { "Approved": 1, "Partially Approved": 1, "Rejected": 1 };
  var PRIOR_NFA = 0.5674, PRIOR_K = 5;   // مطابق لـ rcm_pipeline._patient_history

  function clean(h) { return String(h == null ? "" : h).replace(/\s+/g, " ").trim(); }
  function index(heads) { var m = {}; heads.forEach(function (h, i) { var c = clean(h); if (m[c] === undefined) m[c] = i; }); return m; }

  function kind(heads) {
    var m = index(heads || []);
    if (APPROVAL_SIG.every(function (c) { return m[c] !== undefined; })) return "approvals";
    if (ELIG_SIG.every(function (c) { return m[c] !== undefined; })) return "eligibility";
    return null;
  }

  function eligStatus(req, disp) {
    req = String(req || "").trim().toLowerCase(); disp = String(disp || "").trim().toLowerCase();
    if (/not in-?force|not active/.test(disp)) return "not_active";
    if (/outside/.test(disp) && /network/.test(disp)) return "out_network";
    if (/not covered/.test(disp)) return "not_covered";
    if (req === "error") return "error";
    if (req === "complete") return "eligible";
    return "unknown";
  }
  function patientClass(v) {
    var s = String(v || "").trim().toLowerCase();
    if (!s) return "unknown";
    if (/hajj from outside|حجاج الخارج/.test(s)) return "hajj_outside";
    if (/haj|حاج/.test(s)) return "hajj";
    if (/tamer|umrah|moatamer|معتمر/.test(s)) return "umrah";
    if (/citizen|مواطن/.test(s) || s === "saudi") return "saudi";
    if (/resident|مقيم/.test(s)) return "resident";
    if (/employee|موظف/.test(s)) return "employee";
    if (/normal|eligible for treatment/.test(s)) return "normal";
    return "other";
  }
  function normContract(v) {
    var s = String(v == null ? "" : v).normalize("NFKC").trim().toLowerCase().replace(/[‎‏]/g, "").replace(/\s+/g, " ");
    if (!s) return "";
    s = s.replace(/\b(19|20)\d{2}\b/g, "").replace(/\b(branch|فرع|co|ltd|company|corporation|group|شركة)\b/g, " ");
    return s.replace(/\s+/g, " ").trim();
  }
  function toDate(v) {
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    if (v == null || v === "") return null;
    var d = new Date(String(v).trim().replace(" ", "T"));
    return isNaN(d.getTime()) ? null : d;
  }

  function reduceElig(aoa) {
    var m = index(aoa[0]), best = {};
    var col = function (r, c) { return m[c] === undefined ? "" : r[m[c]]; };
    for (var i = 1; i < aoa.length; i++) {
      var r = aoa[i], enc = String(col(r, "Encounter Number") || "").trim();
      if (!enc) continue;
      var st = eligStatus(col(r, "Requeststatustext"), col(r, "Disposition"));
      var d = toDate(col(r, "Chi Check Date")), rank = st === "eligible" ? 0 : 1;
      var cur = best[enc];
      if (!cur || rank < cur.rank || (rank === cur.rank && d && (!cur.d || d > cur.d)))
        best[enc] = { rank: rank, d: d, st: st, contract: col(r, "Contract Name"), pclass: col(r, "Patient Category"),
                      checked: col(r, "Visit Nphies Eligibility Check"), disp: col(r, "Disposition") };
    }
    return best;
  }

  /** apprAoa / eligAoa: مصفوفات SheetJS (الصف الأول عناوين). cols: أعمدة قالب الصفحة. */
  function build(apprAoa, eligAoa, cols) {
    var m = index(apprAoa[0]);
    var col = function (r, c) { return m[c] === undefined ? "" : r[m[c]]; };
    var elig = eligAoa ? reduceElig(eligAoa) : null;
    var reqs = {}, order = [], lines = 0;
    for (var i = 1; i < apprAoa.length; i++) {
      var r = apprAoa[i];
      if (!r || !r.some(function (v) { return v !== "" && v != null; })) continue;
      lines++;
      var key = clean(col(r, "اسم المستشفى")) + "|" + clean(col(r, "رقم الطلب"));
      var q = reqs[key];
      if (!q) {
        var amt = parseFloat(col(r, "مبلغ الفاتورة"));
        q = reqs[key] = {
          key: key, req: clean(col(r, "رقم الطلب")), hospital: clean(col(r, "اسم المستشفى")),
          vd: toDate(col(r, "تاريخ الزيارة")), vt: VISIT_TYPE[clean(col(r, "نوع الزيارة")).toLowerCase()] || "",
          clinic: clean(col(r, "اسم العيادة")), nat: clean(col(r, "الجنسية")),
          ins: clean(col(r, "اسم شركة التأمين")), tpa: clean(col(r, "اسم شركة المطالبات التي تتبع لها شركة التأمين")),
          icd: clean(col(r, "كود التشخيص الأولي")), total: isFinite(amt) && amt > 0 ? amt : "",
          status: clean(col(r, "حالة رفع طلب الموافقة")), reason: clean(col(r, "أسباب المرفوضات على مستوى المطالبة")),
          enc: clean(col(r, "Encounter Number")), mrn: clean(col(r, "رقم المريض")), n: 0, rej: 0,
        };
        order.push(key);
      }
      q.n++;
      if (clean(col(r, "حالة الموافقة للخدمة")) === "Rejected") q.rej++;
    }
    // سجل المريض السابق — من الطلبات الأسبق للمريض نفسه فقط
    var byMrn = {};
    order.forEach(function (k) { var q = reqs[k]; if (q.mrn) (byMrn[q.mrn] = byMrn[q.mrn] || []).push(q); });
    Object.keys(byMrn).forEach(function (mk) {
      var list = byMrn[mk].sort(function (a, b) { return (a.vd ? a.vd.getTime() : 0) - (b.vd ? b.vd.getTime() : 0); });
      var n = 0, dec = 0, rej = 0;
      list.forEach(function (q) {
        q.priorN = n; q.priorRate = dec > 0 ? (rej + PRIOR_K * PRIOR_NFA) / (dec + PRIOR_K) : "";
        n++; if (DECIDED[q.status]) { dec++; if (q.status !== "Approved") rej++; }
      });
    });

    var heads = cols.map(function (c) { return c.head; }).concat(
      ["معرّف الطلب", "شركة التأمين — المصدر", "شركة المطالبات TPA — المصدر", "عدد الخدمات", "خدمات مرفوضة",
       "حالة الأهلية — المصدر", "حالة الموافقة Approval Status", "سبب الرفض — المصدر"]);
    var out = [heads], st = { lines: lines, requests: order.length, decided: 0, queue: 0, eligMatched: 0,
                              amountMissing: 0, garbled: 0, status: {}, phi: PHI.filter(function (c) { return m[clean(c)] !== undefined; }) };
    order.forEach(function (k) {
      var q = reqs[k], e = elig && q.enc ? elig[q.enc] : null;
      if (e) st.eligMatched++;
      if (q.total === "") st.amountMissing++;
      var garbled = /\?{3}/.test(q.ins) || (e && /\?{3}/.test(String(e.contract || "")));
      if (garbled) st.garbled++;
      st.status[q.status || "—"] = (st.status[q.status || "—"] || 0) + 1;
      if (DECIDED[q.status]) st.decided++; else if (q.status === "Pending" || q.status === "Sent") st.queue++;
      var v = {
        total: q.total, visit_date: q.vd || "", visit_type: q.vt, hospital: q.hospital.toLowerCase(),
        clinic: q.clinic.toLowerCase(), contract: normContract(e && e.contract ? e.contract : q.ins),
        icd: q.icd, nphies: e ? e.st : "unknown", triage: "", gender: "", nationality: q.nat.toLowerCase(),
        patient_class: patientClass(e ? e.pclass : ""), prior_claims: q.priorN == null ? "" : q.priorN,
        prior_reject_rate: q.priorRate == null ? "" : q.priorRate,
      };
      out.push(cols.map(function (c) { return v[c.key] === undefined ? "" : v[c.key]; }).concat(
        [q.key, /\?{3}/.test(q.ins) && q.tpa ? q.tpa : q.ins, q.tpa, q.n, q.rej, e ? e.st : "لا يوجد فحص", q.status, q.reason]));
    });
    return { aoa: out, report: st };
  }

  function reportHtml(st, eligName) {
    var f = function (n) { return (n || 0).toLocaleString("en"); };
    var s = Object.keys(st.status).map(function (k) { return k + " " + f(st.status[k]); }).join(" · ");
    return '<div class="note info" style="margin-top:10px"><b>تعرّفت المنصّة على تصدير CareWare للموافقات' +
      (eligName ? " + تصدير الأهلية" : "") + ".</b> " + f(st.lines) + " سطر خدمة ← <b>" + f(st.requests) +
      "</b> طلب موافقة (المفتاح: المستشفى + رقم الطلب). " +
      "قرار نهائي " + f(st.decided) + " · بانتظار القرار " + f(st.queue) + "<br>الحالات: " + s +
      "<br>الربط مع الأهلية (Encounter Number): " + (eligName ? f(st.eligMatched) + " طلب (" +
        Math.round(st.eligMatched / Math.max(1, st.requests) * 100) + "%)" : "لم يُرفع ملف الأهلية — نتيجة الأهلية والعقد تُؤخذ افتراضياً") +
      " · مبلغ الفاتورة غير متاح (صفر) في " + f(st.amountMissing) + " طلب — عومل كقيمة مفقودة." +
      (st.garbled ? "<br>⚠ " + f(st.garbled) + " طلب يحمل اسم عقد/شركة تأمين عربياً تالفاً في التصدير نفسه (؟؟؟) — يُعرض اسم TPA بدلاً منه؛ يُصلح من إعدادات الترميز في CareWare." : "") +
      (st.phi.length ? "<br>🔒 حُذفت عند القراءة أعمدة الهوية: " + st.phi.join("، ") + " — لا تظهر في أي نتيجة أو تنزيل." : "") +
      "</div>";
  }

  window.ARCHSources = { kind: kind, build: build, reportHtml: reportHtml, eligStatus: eligStatus };
})();
