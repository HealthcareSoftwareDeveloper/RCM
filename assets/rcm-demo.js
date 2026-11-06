/*!
 * rcm-demo.js — مولّد بيانات تجريبية غير محدودة
 * ARCH Predict · ARCH Systems
 *
 * يولّد طلبات موافقة عشوائية واقعية الشكل من قوائم حزمة النموذج نفسها:
 * الاختيار الفئوي موزون بتكرار كل قيمة الفعلي في بيانات التدريب، والمبالغ
 * على توزيع لوغاريتمي يشبه توزيع الفواتير الحقيقي. تستعمله صفحة التنبؤ
 * (زر البيانات التجريبية) وتبويب التنبؤ بالملفات (مولّد الملفات التجريبية).
 */
(function () {
  "use strict";

  var B = window.RCM_BUNDLE;
  if (!B || !B.options) return;

  // ── اختيار موزون بتكرار القيمة في بيانات التدريب ──
  function weightedPick(opts) {
    var sum = 0, i;
    for (i = 0; i < opts.length; i++) sum += (opts[i].n || 0) + 1;
    var r = Math.random() * sum;
    for (i = 0; i < opts.length; i++) {
      r -= (opts[i].n || 0) + 1;
      if (r <= 0) return opts[i].v;
    }
    return opts[opts.length - 1].v;
  }

  function pickFrom(col) { return weightedPick(B.options[col] || []); }

  // مبلغ على توزيع لوغاريتمي منحرف — أغلب الفواتير صغيرة وقليلها كبير جداً
  function randomTotal() {
    var lo = Math.log(40), hi = Math.log(18000);
    var v = Math.exp(lo + Math.random() * (hi - lo));
    return Math.round(v * 100) / 100;
  }

  // درجة CTAS موزونة كواقع أقسام الطوارئ: غير العاجل أكثر والحرج أندر
  function randomTriage() {
    var r = Math.random();
    return r < 0.35 ? 5 : r < 0.65 ? 4 : r < 0.85 ? 3 : r < 0.96 ? 2 : 1;
  }

  // تاريخ عشوائي خلال آخر ستة أشهر، بساعة موزونة نحو ساعات النهار
  function randomDate() {
    var d = new Date(Date.now() - Math.random() * 183 * 24 * 3600 * 1000);
    var hour = Math.random() < 0.8
      ? 8 + Math.floor(Math.random() * 14)          // 8ص–10م غالباً
      : Math.floor(Math.random() * 24);
    d.setHours(hour, Math.floor(Math.random() * 60), 0, 0);
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
           " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  // رمز ICD-10 كامل من كتلة حقيقية في قوائم النموذج (تُستبعد أخرى/غير محدد)
  var ICD_BLOCKS = (B.options.icd_block || []).filter(function (o) {
    return /^[A-Z][0-9]{2}$/.test(o.v);
  });
  function randomIcd() {
    if (!ICD_BLOCKS.length) return "J06.9";
    return weightedPick(ICD_BLOCKS) + "." + Math.floor(Math.random() * 10);
  }

  /**
   * طلب موافقة عشوائي واحد — بالمفاتيح الآلية نفسها المستعملة في قالب
   * التنبؤ بالملفات. prior_reject_rate كسر 0-1 (صيغة الملف)؛ صفحة التنبؤ
   * تحوّله إلى نسبة مئوية عند التعبئة.
   */
  function randomCase() {
    var priorClaims = Math.random() < 0.7 ? 0 : 1 + Math.floor(Math.random() * 8);
    return {
      total: randomTotal(),
      visit_date: randomDate(),
      visit_type: pickFrom("visit_type"),
      hospital: pickFrom("hospital"),
      clinic: pickFrom("clinic"),
      contract: pickFrom("contract"),
      icd: randomIcd(),
      nphies: pickFrom("nphies_elig"),
      triage: randomTriage(),
      gender: pickFrom("gender"),
      nationality: pickFrom("nationality"),
      patient_class: pickFrom("patient_class"),
      prior_claims: priorClaims,
      prior_reject_rate: priorClaims === 0 ? "" : Math.round(Math.random() * 100) / 100,
    };
  }

  window.RCMDemo = { randomCase: randomCase };
})();
