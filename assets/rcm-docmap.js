/*!
 * rcm-docmap.js — الربط المحلي الخاص بين رموز الأطباء وأسمائهم الحقيقية
 * ARCH Predict · ARCH Systems
 *
 * حماية البيانات الشخصية: حزمة النموذج المنشورة لا تحوي أي اسم طبيب —
 * فقط رموزاً مستعارة (doc-001…). ملف الربط «الرمز ← الاسم» يوزَّع داخلياً
 * على الفريق ولا يُنشر في الموقع ولا المستودع أبداً؛ يحمّله كل مستخدم مرة
 * واحدة فيُحفظ في متصفحه وحده (localStorage) ويُستخدم محلياً في:
 *   • إظهار اسم الطبيب بجانب رمزه في قوائم الإدخال اليدوي والبحث فيها
 *   • ترجمة أسماء الأطباء في ملفات Excel/CSV المرفوعة إلى رموزها
 * بلا الملف تعمل المنصّة طبيعياً، وتُعامل الأسماء غير المعروفة «أخرى».
 */
(function () {
  "use strict";

  var KEY = "namaa.docmap";

  function norm(s) {
    return String(s == null ? "" : s)
      .toLowerCase()
      .replace(/[ً-ْـ]/g, "")
      .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه")
      .replace(/ى/g, "ي").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
      .replace(/[()[\]{}\/\\_\-.,:;؟?؛،#*"'?]+/g, " ")
      .replace(/\s+/g, " ").trim();
  }

  function get() {
    try {
      var m = JSON.parse(localStorage.getItem(KEY) || "null");
      return m && m.byCode ? m : null;
    } catch (e) { return null; }
  }

  function save(byCode) {
    var byName = {};
    Object.keys(byCode).forEach(function (c) { byName[norm(byCode[c])] = c; });
    try { localStorage.setItem(KEY, JSON.stringify({ byCode: byCode, byName: byName })); }
    catch (e) { return false; }
    return true;
  }

  /** يقرأ صفوف الملف الخاص (aoa): يكتشف عمود الرمز (doc-###) وعمود الاسم */
  function loadFromRows(aoa) {
    var byCode = {};
    aoa.forEach(function (row) {
      if (!row) return;
      var code = null, name = null;
      row.forEach(function (cell) {
        var s = String(cell == null ? "" : cell).trim();
        if (/^doc-\d{2,4}$/i.test(s)) code = s.toLowerCase();
        else if (s && !/^طبيب\b/.test(s) && /[a-zA-Z؀-ۿ]{3,}/.test(s) && name === null) name = s;
      });
      if (code && name) byCode[code] = name;
    });
    var n = Object.keys(byCode).length;
    if (n && save(byCode)) return n;
    return 0;
  }

  function codeFor(name) {
    var m = get();
    if (!m) return null;
    var s = String(name == null ? "" : name).trim();
    if (/^doc-\d{2,4}$/i.test(s)) return s.toLowerCase();
    return m.byName[norm(s)] || null;
  }

  function nameFor(code) {
    var m = get();
    return m ? (m.byCode[String(code).toLowerCase()] || null) : null;
  }

  function clear() { try { localStorage.removeItem(KEY); } catch (e) { /* */ } }

  function count() { var m = get(); return m ? Object.keys(m.byCode).length : 0; }

  window.RCMDocMap = { get: get, loadFromRows: loadFromRows, codeFor: codeFor,
                       nameFor: nameFor, clear: clear, count: count, norm: norm };
})();
