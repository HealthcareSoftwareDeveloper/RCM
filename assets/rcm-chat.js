/*!
 * rcm-chat.js — استرجاع «مساند نماء الذكي» من لوائح مجلس الضمان الصحي (CHI)
 * ARCH Predict · ARCH Systems
 *
 * لا يولّد نصاً ولا يعيد صياغة النظام. يبحث في نصوص اللوائح المفهرسة
 * ويعرض المقطع كما ورد حرفياً، مع اسم المستند ورقم الصفحة وصورتها —
 * فكل إجابة قابلة للتحقّق من مصدرها، ولا مجال لهلوسة نصّ نظامي.
 *
 * الفهرسة تتم مسبقاً في chatbot/build_corpus.py؛ هذا الملف يقرأ الناتج فقط.
 */
(function (root) {
  "use strict";

  // ────────────────────────────────────────────────────────────────
  // 1. تطبيع النص العربي — نسخة مطابقة لدالة normalize في بايثون
  // ────────────────────────────────────────────────────────────────
  var DIAC = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
  var TATWEEL = /ـ+/g;
  // حروف وأرقام فقط: علامات الترقيم العربية (؟ ، ؛ ٪) تُستبعد كي لا تلتصق
  // بالكلمات فتصنع رموزاً وهمية. النطاق مطابق لنظيره في build_corpus.py.
  var NONWORD = /[^0-9A-Za-z_\u0621-\u063A\u0641-\u064A\u0660-\u0669\u066E-\u06D3\u06F0-\u06F9]+/g;
  var AR_NUM = /[٠-٩۰-۹]/g;
  var AR_NUM_MAP = { "٠":"0","١":"1","٢":"2","٣":"3","٤":"4","٥":"5","٦":"6","٧":"7","٨":"8","٩":"9",
                     "۰":"0","۱":"1","۲":"2","۳":"3","۴":"4","۵":"5","۶":"6","۷":"7","۸":"8","۹":"9" };

  function normalize(s) {
    if (!s) return "";
    s = String(s).normalize("NFKC").replace(DIAC, "").replace(TATWEEL, "");
    s = s.replace(/[أإآٱٲٳٵ]/g, "ا");
    s = s.replace(/ى/g, "ي").replace(/ئ/g, "ي")
         .replace(/ؤ/g, "و").replace(/ة/g, "ه")
         .replace(/ﻻ|ﻵ|ﻷ|ﻹ/g, "لا");
    s = s.replace(AR_NUM, function (d) { return AR_NUM_MAP[d]; });   // ٦٠ و 60 رمز واحد
    return s.replace(NONWORD, " ").replace(/\s+/g, " ").trim().toLowerCase();
  }

  var STOP = {};
  ("من في على عن الى إلى مع هذا هذه ذلك التي الذي التى او أو ثم قد كل بعض غير بين " +
   "كما حيث اذا إذا لم لن لا ما هو هي هم انه أنه وقد وان وإن يكون تكون كان كانت " +
   "عند لدى نحو دون سوى حتى منذ خلال بعد قبل امام أمام تحت فوق ضمن وفق وفقا طبقا " +
   "the of and or to in for on with a an is are be by as at from that this shall")
    .split(/\s+/).forEach(function (w) { STOP[normalize(w)] = 1; });


  // سوابق ولواحق عربية شائعة — تجذير خفيف مطابق لدالة stem في بايثون.
  // مثال: «للحمل» و«الحمل» و«حمل» تلتقي كلها عند جذر واحد.
  var PREF = ["وال", "فال", "بال", "كال", "لل", "ال", "و", "ف", "ب", "ك", "ل"];
  var SUFF = ["هما", "كما", "هم", "هن", "كم", "ها", "ات", "ون", "ين", "ية", "يه", "ه", "ي", "ا"];

  function stem(t) {
    for (var i = 0; i < PREF.length; i++) {
      if (t.indexOf(PREF[i]) === 0 && t.length - PREF[i].length >= 3) {
        t = t.slice(PREF[i].length); break;
      }
    }
    for (var j = 0; j < SUFF.length; j++) {
      var s = SUFF[j];
      if (t.length - s.length >= 3 && t.slice(-s.length) === s) {
        t = t.slice(0, -s.length); break;
      }
    }
    return t;
  }

  function tokenize(s) {
    return normalize(s).split(" ").filter(function (t) {
      return t.length > 1 && !STOP[t];
    }).map(stem);
  }

  // ────────────────────────────────────────────────────────────────
  // 2. الاسترجاع — BM25 مع مكافأة للعبارة الحرفية
  // ────────────────────────────────────────────────────────────────
  var K1 = 1.4, B = 0.72;

  function search(C, query, limit) {
    limit = limit || 6;
    var toks = tokenize(query);
    if (!toks.length) return [];

    var scores = {}, hitTokens = {};
    toks.forEach(function (t) {
      var post = C.idx[t];
      if (!post) return;
      var idf = Math.log(1 + (C.N - post.length + 0.5) / (post.length + 0.5));
      for (var i = 0; i < post.length; i++) {
        var pi = post[i][0], tf = post[i][1];
        var dl = C.len[pi] || 1;
        var s = idf * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * dl / C.avgdl));
        scores[pi] = (scores[pi] || 0) + s;
        (hitTokens[pi] = hitTokens[pi] || {})[t] = 1;
      }
    });

    var qn = normalize(query);
    var ids = Object.keys(scores);
    if (!ids.length) return [];

    ids.forEach(function (pi) {
      var p = C.passages[pi];
      var body = normalize(p.h + " " + p.t);
      // مكافأة العبارة الكاملة: مطابقة حرفية أقوى دلالةً من تفرّق الكلمات
      if (qn.length > 6 && body.indexOf(qn) >= 0) scores[pi] *= 1.9;
      // تغطية الاستعلام: نسبة كلماته الموجودة فعلاً في المقطع
      var cov = Object.keys(hitTokens[pi] || {}).length / toks.length;
      scores[pi] *= 0.55 + 0.75 * cov;
      // ترجيح خفيف للعناوين (المواد والبنود)
      if (p.h && normalize(p.h) && qn.split(" ").some(function (w) {
        return w.length > 2 && normalize(p.h).indexOf(w) >= 0;
      })) scores[pi] *= 1.15;
    });

    ids.sort(function (a, b) { return scores[b] - scores[a]; });

    var out = [], seen = {};
    for (var i = 0; i < ids.length && out.length < limit; i++) {
      var pi = +ids[i], p = C.passages[pi];
      var key = p.d + ":" + p.p;
      if (seen[key] && out.length > 2) continue;     // تنويع الصفحات
      seen[key] = 1;
      out.push({
        pi: pi, score: scores[pi], doc: C.docs[p.d], page: p.p,
        heading: p.h, text: p.t,
        matched: Object.keys(hitTokens[pi] || {}),
        coverage: Object.keys(hitTokens[pi] || {}).length / toks.length,
      });
    }
    return out;
  }

  /** تظليل كلمات الاستعلام داخل المقطع المعروض */
  function highlight(text, query) {
    var toks = tokenize(query).filter(function (t) { return t.length > 2; });
    if (!toks.length) return escapeHtml(text);
    var words = text.split(/(\s+)/);
    return words.map(function (w) {
      var n = normalize(w);
      for (var i = 0; i < toks.length; i++) {
        if (n && (n === toks[i] || n.indexOf(toks[i]) >= 0)) {
          return "<mark>" + escapeHtml(w) + "</mark>";
        }
      }
      return escapeHtml(w);
    }).join("");
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function pageImage(r) { return "chatbot/pages/d" + r.doc.id + "-p" + r.page + ".jpg"; }

  root.RCMChat = {
    normalize: normalize, stem: stem, tokenize: tokenize, search: search,
    highlight: highlight, pageImage: pageImage, escapeHtml: escapeHtml,
  };
})(typeof window !== "undefined" ? window : globalThis);

if (typeof module !== "undefined" && module.exports) module.exports = globalThis.RCMChat;
