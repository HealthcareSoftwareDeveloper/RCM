/*!
 * rcm-reason.js — طبقة الاستنتاج في «مساند نماء الذكي» المساعد المرجعي
 * ARCH Predict · ARCH Systems
 *
 * تأخذ مقاطع اللوائح التي استرجعها rcm-chat.js وتُخرج إجابة مُركَّبة:
 *   • إعادة صياغة النصّ النظامي بلغة تشغيلية مبسّطة
 *   • استخلاص المعطيات الرقمية (مدد، نسب، مبالغ) من النصّ نفسه
 *   • فرز الأحكام: إلزام · إجازة · حظر · شرط · استثناء · تعريف
 *   • استنتاجات منطقية مبنيّة على قواعد صريحة (لا توليد لغويّ حرّ)
 *
 * قاعدة صارمة: كل جملة تُخرجها هذه الطبقة تحمل مرجعها [n]، ولا تُذكر
 * معلومة لا أصل لها في مقطع مسترجَع. الصياغة اجتهادٌ في العرض،
 * والنصّ الرسميّ يبقى معروضاً حرفياً أسفل كل إجابة للتحقّق.
 */
(function (root) {
  "use strict";

  var S = root.RCMChat || (typeof require !== "undefined" ? require("./rcm-chat.js") : null);

  // ────────────────────────────────────────────────────────────────
  // 0. تنظيف النصّ المستخرَج من PDF/OCR
  // ────────────────────────────────────────────────────────────────
  var AR_DIGITS = /[٠-٩]/g;
  var AR_MAP = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
                 "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9" };

  function digits(s) {
    return String(s || "").replace(AR_DIGITS, function (d) { return AR_MAP[d]; });
  }

  /**
   * المسح الضوئي يترك بقايا لاتينية مشوّشة داخل الجُمل العربية
   * («‎gh!‏ افقة»). نُسقط الكتل اللاتينية المتناثرة ونُبقي المصطلحات
   * الإنجليزية الحقيقية (كلمة كاملة بحروف متّصلة وطول معقول).
   */
  function clean(text) {
    var s = String(text || "").replace(/[‎‏­]/g, " ");
    s = s.replace(/[A-Za-z][A-Za-z.'|)(\-]{0,2}(?=\s|$)/g, " ");   // شظايا قصيرة
    s = s.replace(/\s[^؀-ۿ\w\s]{2,}\s/g, " ");           // رموز متتابعة
    s = s.replace(/[!¡]/g, " ");                        // أثر مسح لا علامة تعجّب
    // المسح يقرأ الفاصلة العربية همزةً؛ الهمزة بعد هذه الحروف مستحيلة إملائياً
    s = s.replace(/([تةنمرسقكهحجخصضعغثذ])ء(?=\s|$)/g, "$1،");
    s = s.replace(/\)([0-9]{1,3})\(/g, "($1)");          // أقواس معكوسة الاتجاه
    s = s.replace(/\s{2,}/g, " ").replace(/\s+([،.؛:])/g, "$1");
    return s.trim();
  }

  /** تقطيع إلى جُمل مع الحفاظ على الأرقام العشرية وأرقام المواد */
  function sentences(text) {
    var s = clean(text);
    // نحمي الفاصلة العشرية قبل التقطيع بدل استعمال lookbehind — فهو غير مدعوم
    // في متصفّحات قديمة، وخطؤه خطأ تحليل يُسقط الملف كلّه لا مجرّد الدالة.
    // البند المرقّم («1. عمل سياسة…») جملة قائمة بذاتها وإن لم تسبقه نقطة
    s = s.replace(/\s(?=[0-9\u0660-\u0669]{1,2}[.)]\s+[ء-ي])/g, "\n");
    var parts = s.replace(/([0-9])\.([0-9])/g, "$1\u0000$2")
                 .split(/[.؟]\s+|\s*[؛\n]+\s*/)
                 .map(function (x) { return x.replace(/\u0000/g, "."); });
    var out = [];
    parts.forEach(function (p) {
      p = (p || "").trim().replace(/^[،.\-–—:]\s*/, "");
      if (p.length >= 25) out.push(p);
      else if (out.length && p.length) out[out.length - 1] += " " + p;
    });
    return out;
  }

  // ────────────────────────────────────────────────────────────────
  // 1. نيّة السؤال — تحدّد شكل الإجابة وما يُستخلص منها
  // ────────────────────────────────────────────────────────────────
  var INTENTS = [
    { k: "duration",  label: "مدة نظامية",
      re: /(?:^|[^ء-ي])(كم\s*(مدة|المدة|يوم|ساعة)|مدة|المدة|متى|خلال كم|مهلة|الفترة|موعد|توقيت|تأخر|تأخير)(?![ء-ي])/ },
    { k: "amount",    label: "نسبة أو مبلغ",
      re: /(?:^|[^ء-ي])(نسبة|النسبة|كم\s*(تبلغ|قيمة|مبلغ)|مبلغ|قيمة|تحمل|التحمل|خصم|حد أقصى|سقف|رسوم|تكلفة|سعر)(?![ء-ي])/ },
    { k: "coverage",  label: "تغطية واستحقاق",
      re: /(?:^|[^ء-ي])(هل\s*(يغطي|تغطي|يشمل|تشمل)|تغطية|مغطى|مشمول|يشمل|استحقاق|منفعة|منافع|مستثنى|استثناء|محدودات)(?![ء-ي])/ },
    { k: "obligation",label: "التزام ومسؤولية",
      re: /(?:^|[^ء-ي])(يجب|يلتزم|التزام|مسؤولية|من المسؤول|واجب|ملزم|على من)(?![ء-ي])/ },
    { k: "procedure", label: "إجراء وخطوات",
      re: /(?:^|[^ء-ي])(كيف|إجراء|إجراءات|خطوات|آلية|طريقة|كيفية|يتم|تقديم طلب|رفع طلب)(?![ء-ي])/ },
    { k: "definition",label: "تعريف نظامي",
      re: /(?:^|[^ء-ي])(ما\s*(هو|هي|المقصود|معنى)|تعريف|يقصد|المقصود|معنى|مفهوم)(?![ء-ي])/ },
    { k: "penalty",   label: "مخالفة وجزاء",
      re: /(?:^|[^ء-ي])(مخالفة|مخالفات|عقوبة|عقوبات|غرامة|جزاء|جزاءات|إيقاف|شطب|تظلم|اعتراض|شكوى)(?![ء-ي])/ },
    { k: "document",  label: "مستندات ومتطلبات",
      re: /(?:^|[^ء-ي])(مستند|مستندات|وثيقة|وثائق|نموذج|بيانات مطلوبة|متطلبات|مرفقات|إرفاق)(?![ء-ي])/ },
  ];

  function detectIntent(query) {
    var q = " " + String(query || "") + " ";
    for (var i = 0; i < INTENTS.length; i++) {
      if (INTENTS[i].re.test(q)) return { k: INTENTS[i].k, label: INTENTS[i].label };
    }
    return { k: "general", label: "استفسار عام" };
  }

  // ────────────────────────────────────────────────────────────────
  // 2. توسيع الاستعلام — مرادفات اللائحة مقابل لغة الاستخدام اليومي
  // ────────────────────────────────────────────────────────────────
  var SYN = [
    ["الموافقة المسبقة", "طلب الموافقة", "التصريح المسبق", "الموافقة على تقديم العلاج"],
    ["الرفض", "عدم الموافقة", "الاعتذار عن الطلب"],
    ["السداد", "الدفع", "المستحقات", "التسوية", "المطالبات المالية"],
    ["الطوارئ", "الحالات الطارئة", "الحالة الإسعافية"],
    ["التحمل", "المشاركة بالدفع", "نسبة التحمل"],
    ["التنويم", "الإقامة بالمستشفى", "الدخول للمستشفى"],
    ["المستفيد", "المؤمن له", "المريض"],
    ["مقدم الخدمة", "المرفق الصحي", "المنشأة الصحية"],
    ["شركة التأمين", "المؤمّن", "شركة التأمين المؤهلة"],
    ["الحمل والولادة", "الأمومة", "الوضع"],
    ["الأسنان", "طب الأسنان", "علاج الأسنان"],
    ["الاحتيال", "سوء الاستخدام", "الإهمال"],
    ["عن بعد", "الطب الاتصالي", "الرعاية الصحية عن بعد"],
  ];

  /** يُعيد استعلامات إضافية مشتقّة من مرادفات وردت في السؤال */
  function expansions(query) {
    var qn = S.normalize(query), out = [];
    SYN.forEach(function (grp) {
      var hit = grp.some(function (t) { return qn.indexOf(S.normalize(t)) >= 0; });
      if (!hit) return;
      grp.forEach(function (t) {
        if (qn.indexOf(S.normalize(t)) < 0) out.push(t);
      });
    });
    return out.slice(0, 3);
  }

  // ────────────────────────────────────────────────────────────────
  // 3. استخلاص المعطيات الرقمية من النصّ
  // ────────────────────────────────────────────────────────────────
  var UNIT_AR = {
    "دقيقة": "دقيقة", "دقائق": "دقيقة", "ساعة": "ساعة", "ساعات": "ساعة",
    "يوم": "يوم", "يوما": "يوم", "يوماً": "يوم", "أيام": "يوم", "ايام": "يوم",
    "أسبوع": "أسبوع", "اسبوع": "أسبوع", "أسابيع": "أسبوع",
    "شهر": "شهر", "شهرا": "شهر", "شهراً": "شهر", "أشهر": "شهر", "اشهر": "شهر",
    "سنة": "سنة", "سنوات": "سنة", "عام": "سنة", "أعوام": "سنة",
  };
  var UNIT_RE = Object.keys(UNIT_AR).join("|");

  // دور المهلة وصنف الحالة — يُستخرجان من جوار الرقم، فالمدة العارية بلا
  // سياقها تُقرأ خطأً: «٦٠ دقيقة» للردّ غير «٢٤ ساعة» للإبلاغ في الطوارئ.
  var DUR_ROLES = [
    { re: /إعادة التقييم/, label: "مهلة الردّ على إعادة التقييم" },
    { re: /بالإجابة|بالرد|الرد على|للرد|الردّ/, label: "مهلة الردّ" },
    // «خلال س من وقت استلام الطلب» = مهلة للردّ تبدأ من الاستلام
    { re: /استلام الطلب|تلقي الطلب|إستلام الطلب/, label: "مهلة الردّ من وقت استلام الطلب" },
    { re: /إرسال طلب|بإرسال|تقديم طلب|رفع (?:طلب|الحالة|المطالب)/, label: "مهلة الإرسال" },
    { re: /إبلاغ|إشعار|إخطار/, label: "مهلة الإبلاغ" },
    { re: /سداد|تسوية|تARCH Predict/, label: "مهلة السداد" },
    { re: /شكوى|تظلم|اعتراض/, label: "مهلة الاعتراض" },
  ];
  var DUR_CASES = [
    { re: /غير المستعجلة/, label: "للحالات غير المستعجلة" },
    { re: /المستعجلة/, label: "للحالات المستعجلة" },
    { re: /الطارئة|الطوارئ|الإسعافية|استقبال الحالة/, label: "للحالات الطارئة" },
  ];

  function durationCtx(text, idx, len) {
    // ما بعد الرقم أدلّ من ما قبله («٢٤ ساعة للحالات المستعجلة»)،
    // ويُقصّ عند أول رقم تالٍ حتى لا يتسرّب سياق مدّة أخرى.
    var after = text.slice(idx + len, idx + len + 60).split(/[0-9٠-٩]/)[0];
    var before = text.slice(Math.max(0, idx - 130), idx);
    var parts = [];
    for (var i = 0; i < DUR_ROLES.length; i++) {
      if (DUR_ROLES[i].re.test(after) || DUR_ROLES[i].re.test(before)) {
        parts.push(DUR_ROLES[i].label); break;
      }
    }
    for (var j = 0; j < DUR_CASES.length; j++) {
      if (DUR_CASES[j].re.test(after) || DUR_CASES[j].re.test(before)) {
        parts.push(DUR_CASES[j].label); break;
      }
    }
    return parts.join("، ");
  }

  var RE_DURATION = new RegExp(
    "(?:خلال|مدة|مدته|مدتها|لمدة|بحد أقصى|كحد أقصى|لا تتجاوز|لا يتجاوز|أقصاها|اقصاها|في مدة|بعد|قبل|كل)\\s*" +
    "([0-9]{1,4}(?:[.,][0-9]+)?)\\s*(" + UNIT_RE + ")", "g");
  var RE_DURATION_POST = new RegExp(
    "([0-9]{1,4})\\s*(" + UNIT_RE + ")\\s*(?:كحد أقصى|بحد أقصى|على الأكثر|كأقصى حد)", "g");
  var RE_BARE_DURATION = new RegExp("([0-9]{1,4})\\s*(" + UNIT_RE + ")(?![ء-ي])", "g");
  var RE_PCT = /([0-9]{1,3}(?:[.,][0-9]+)?)\s*(?:%|٪|بالمائة|في المائة|بالمئة)/g;
  var RE_MONEY = /([0-9][0-9,،.]{0,12})\s*(?:ريال|ر\.?س|SAR|ريالاً|ريالا)/g;

  // سقوف واقعية لكل وحدة: ما تجاوزها فهو أثر تشويش في الاستخراج لا حكم نظامي
  var UNIT_MAX = { "دقيقة": 600, "ساعة": 168, "يوم": 400, "أسبوع": 60, "شهر": 60, "سنة": 50 };

  function plausible(f) {
    if (f.kind !== "duration") return true;
    if (/^0[0-9]/.test(f.value)) return false;               // صفر بادئ = رقم مقلوب
    var v = parseFloat(f.value);
    return v > 0 && v <= (UNIT_MAX[f.unit] || 1000);
  }

  // مفرد · مثنّى · جمع — العدد العربي يُطابق معدودَه
  var UNIT_FORMS = {
    "دقيقة": ["دقيقة", "دقيقتان", "دقائق"], "ساعة": ["ساعة", "ساعتان", "ساعات"],
    "يوم": ["يوم", "يومان", "أيام"], "أسبوع": ["أسبوع", "أسبوعان", "أسابيع"],
    "شهر": ["شهر", "شهران", "أشهر"], "سنة": ["سنة", "سنتان", "سنوات"],
  };

  function countPhrase(value, unit) {
    var f = UNIT_FORMS[unit];
    if (!f) return value + " " + unit;
    var n = parseFloat(value);
    if (n === 1) return f[0] + " واحد";
    if (n === 2) return f[1];
    if (n >= 3 && n <= 10) return value + " " + f[2];
    return value + " " + f[0];
  }

  function collect(re, text, build) {
    var out = [], m;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) out.push(build(m));
    return out;
  }

  function extractFacts(text) {
    var t = digits(clean(text)), facts = [];
    function durFact(m) {
      return { kind: "duration", value: m[1], unit: UNIT_AR[m[2]] || m[2],
               display: countPhrase(m[1], UNIT_AR[m[2]] || m[2]),
               ctx: durationCtx(t, m.index, m[0].length), raw: m[0] };
    }
    collect(RE_DURATION, t, durFact).forEach(function (f) { facts.push(f); });
    collect(RE_DURATION_POST, t, durFact).forEach(function (f) { facts.push(f); });
    collect(RE_BARE_DURATION, t, durFact).forEach(function (f) { facts.push(f); });
    collect(RE_PCT, t, function (m) {
      return { kind: "pct", value: m[1], display: m[1] + "٪", raw: m[0] };
    }).forEach(function (f) { facts.push(f); });
    collect(RE_MONEY, t, function (m) {
      return { kind: "money", value: m[1], display: m[1] + " ريال", raw: m[0] };
    }).forEach(function (f) { facts.push(f); });

    var seen = {};
    return facts.filter(function (f) {
      if (!plausible(f)) return false;
      var k = f.kind + ":" + f.display + ":" + (f.ctx || "");
      if (seen[k]) return false; seen[k] = 1; return true;
    });
  }

  // ────────────────────────────────────────────────────────────────
  // 4. تصنيف الحكم داخل الجملة
  // ────────────────────────────────────────────────────────────────
  var MODALS = [
    { k: "prohibition", label: "حظر",   plain: "لا يجوز",
      re: /(?:^|[^ء-ي])(لا يجوز|لا يحق|يُحظر|يحظر|يمنع|يُمنع|لا يُسمح|لا يسمح|غير مسموح)(?![ء-ي])/ },
    { k: "exception",   label: "استثناء", plain: "يُستثنى",
      re: /(?:^|[^ء-ي])(يستثنى|يُستثنى|باستثناء|فيما عدا|عدا|لا يشمل|غير مشمول|مستثناة|الاستثناءات|التحديدات)(?![ء-ي])/ },
    { k: "condition",   label: "شرط",   plain: "بشرط",
      re: /(?:^|[^ء-ي])(يشترط|يُشترط|بشرط|شريطة|في حال|في حالة|إذا|متى ما|ما لم)(?![ء-ي])/ },
    { k: "obligation",  label: "إلزام", plain: "يجب",
      re: /(?:^|[^ء-ي])(يجب|يلتزم|تلتزم|يتعين|يتعيّن|على شركة|على مقدم|على المرفق|ملزم|تتحمل|يتحمل|يقوم كل|يدفع|يسدد|تُسدَّد|يُسدَّد|تُحصَّل)(?![ء-ي])/ },
    { k: "permission",  label: "إجازة", plain: "يجوز",
      re: /(?:^|[^ء-ي])(يجوز|يحق|له الحق|يمكن|تستطيع)(?![ء-ي])/ },
    { k: "definition",  label: "تعريف", plain: "يقصد بـ",
      re: /(?:^|[^ء-ي])(يقصد ب|المقصود ب|يُعرّف|تعني|ويعني|هو عبارة عن)(?![ء-ي])/ },
    { k: "coverage",    label: "تغطية", plain: "تُغطّى",
      re: /(?:^|[^ء-ي])(تغطى|تُغطى|يغطي|تغطي|يشمل|تشمل|مشمول|ضمن التغطية|المنافع)(?![ء-ي])/ },
  ];

  function modality(sentence) {
    for (var i = 0; i < MODALS.length; i++) {
      if (MODALS[i].re.test(sentence)) return MODALS[i];
    }
    return null;
  }

  var ACTORS = [
    { re: /شرك(ات|ة) التأمين|المؤمّ?ن(?![ء-ي])/, name: "شركة التأمين" },
    { re: /مقدم(و|ي)? الخدمة|المرافق الصحية|المرفق الصحي|المنشأة الصحية/, name: "مقدم الخدمة" },
    { re: /المستفيد|المؤمن له|المريض/, name: "المستفيد" },
    { re: /صاحب العمل|جهة العمل/, name: "صاحب العمل" },
    { re: /المجلس|مجلس الضمان/, name: "مجلس الضمان الصحي" },
    { re: /الطبيب المعالج|الطبيب/, name: "الطبيب المعالج" },
  ];

  // مَن يقع عليه الحكم هو مَن يلي أداة الإلزام («يجب على…»)، لا أوّل جهة
  // تُذكر في الجملة — فالجملة كثيراً ما تذكر الطرف الآخر قبل المخاطَب بها.
  var DUTY_CUE = /(?:يجب على|يتعين على|يتعيّن على|على أن يقوم|يلتزم|تلتزم|يحق ل|يجوز ل|يُمنع على|لا يجوز ل)\s*/;

  function actor(sentence) {
    function earliest(text) {
      var best = null, at = Infinity;
      for (var i = 0; i < ACTORS.length; i++) {
        var hit = ACTORS[i].re.exec(text);
        if (hit && hit.index < at) { at = hit.index; best = ACTORS[i].name; }
      }
      return best;
    }
    var m = DUTY_CUE.exec(sentence);
    if (m) {
      var from = m.index + m[0].length;
      var who = earliest(sentence.slice(from, from + 60));
      if (who) return who;
    }
    var byCue = /(?:من قبل|بواسطة)\s+/.exec(sentence);
    if (byCue) {
      var from2 = byCue.index + byCue[0].length;
      var who2 = earliest(sentence.slice(from2, from2 + 45));
      if (who2) return who2;
    }
    return earliest(sentence);
  }

  // حشو نظامي لا يضيف معنى تشغيلياً — يُقتطع عند إعادة الصياغة
  var BOILER = [
    /^مع مراعاة[^،.]{0,60}[،.]\s*/, /^دون الإخلال[^،.]{0,60}[،.]\s*/,
    /^استناداً إلى[^،.]{0,60}[،.]\s*/, /^بناءً على[^،.]{0,60}[،.]\s*/,
    /^وفقاً لما ورد[^،.]{0,60}[،.]\s*/, /^مع عدم الإخلال[^،.]{0,60}[،.]\s*/,
    /^المادة\s*\([^)]{1,12}\)\s*:?\s*/, /^البند\s*\([^)]{1,12}\)\s*:?\s*/,
    /^\(?[0-9]{1,2}\)?[-.]\s*/,
    /^(?:ضمان\s+)?مجلس الضمان الصحي(?:\s+التعاوني)?\s*[0-9]*\s*/,
    /^المملكة العربية السعودية\s*/, /^الأمانة العامة\s*/,
    /^صفحة\s*[0-9]+\s*(?:من\s*[0-9]+)?\s*/, /^[0-9]{1,3}\s+(?=[ء-ي])/,
  ];

  function trimBoiler(s) {
    var t = s;
    BOILER.forEach(function (re) { t = t.replace(re, ""); });
    return t.trim();
  }

  var LATIN_RUN = /[A-Za-z][A-Za-z0-9.'’|()\-]*(?:\s+[A-Za-z][A-Za-z0-9.'’|()\-]*)*/g;
  var LEAD_JUNK = /^[^ء-ي]+/;

  /**
   * تنقية سطر التحليل: يُكتب بالعربية وحدها، فبقايا ترويسات المستندات
   * اللاتينية («Council of Health Insurance») تشويش لا معنى له هنا.
   * المصطلح الإنجليزي الأصلي يبقى معروضاً في النصّ الرسمي أسفل الإجابة.
   */
  function arabicOnly(s) {
    return String(s || "").replace(LATIN_RUN, " ").replace(/[©®™¦^~`]+/g, " ")
      .replace(/\s{2,}/g, " ").replace(LEAD_JUNK, "").trim();
  }

  /** قصّ عند حدّ جملة طبيعي بدل البتر في منتصف الكلمة */
  function cut(s, max) {
    if (s.length <= max) return s;
    var slice = s.slice(0, max);
    var at = Math.max(slice.lastIndexOf("، "), slice.lastIndexOf(" و"), slice.lastIndexOf(" "));
    return (at > max * 0.55 ? slice.slice(0, at) : slice).trim() + "…";
  }

  /**
   * إعادة صياغة: تُعيد بناء الجملة بصيغة تشغيلية «من يفعل ماذا»
   * انطلاقاً من الفاعل والحكم المستخرجَين، مع إسقاط الحشو النظامي.
   * ليست ترجمة حرّة — كل مكوّناتها مأخوذة من النصّ نفسه.
   */
  function rephrase(sentence, heading) {
    var body = arabicOnly(clean(sentence));
    if (heading) {
      var hd = arabicOnly(clean(heading));
      if (hd.length > 6 && body.indexOf(hd) === 0) body = body.slice(hd.length).trim();
    }
    body = trimBoiler(body);
    if (!body) return "";
    var mod = modality(body), who = actor(body);
    var facts = extractFacts(body);
    var core = cut(body, 190);

    var lead = "";
    if (mod && who) {
      if (mod.k === "obligation") lead = "على " + who + ": ";
      else if (mod.k === "permission") lead = "يجوز لـ" + who + ": ";
      else if (mod.k === "prohibition") lead = "يُمنع على " + who + ": ";
      else if (mod.k === "condition") lead = "شرط على " + who + ": ";
      else if (mod.k === "exception") lead = "استثناء يخصّ " + who + ": ";
      else if (mod.k === "coverage") lead = "التغطية بشأن " + who + ": ";
      else if (mod.k === "definition") lead = "تعريف يخصّ " + who + ": ";
    } else if (mod) {
      lead = { obligation: "حكم إلزاميّ: ", permission: "حكم جوازيّ: ",
               prohibition: "حكم مانع: ", condition: "شرط: ",
               exception: "استثناء: ", coverage: "تغطية: ",
               definition: "تعريف: " }[mod.k] || "";
    }

    return {
      text: lead + core,
      modality: mod ? mod.k : null,
      modalityLabel: mod ? mod.label : null,
      actor: who,
      facts: facts,
    };
  }

  // ────────────────────────────────────────────────────────────────
  // 5. اختيار الجُمل الأوثق صلة بالسؤال
  // ────────────────────────────────────────────────────────────────
  function arabicRatio(s) {
    var body = String(s || "").replace(/\s+/g, "");
    if (!body.length) return 0;
    return (body.match(/[ء-ي]/g) || []).length / body.length;
  }

  function isNoise(s) {
    if (arabicRatio(s) < 0.62) return true;                  // رموز وأرقام أكثر من حروف
    var lone = (s.match(/(?:^|\s)[0-9]{1,3}(?=\s|$)/g) || []).length;
    return lone >= 4;                                        // سطر فهرس أو جدول محتويات
  }

  function relevance(sentence, qtoks, intent) {
    if (isNoise(sentence)) return 0;
    var toks = S.tokenize(sentence);
    if (!toks.length) return 0;
    var set = {}; toks.forEach(function (t) { set[t] = 1; });
    var hit = qtoks.filter(function (t) { return set[t]; }).length;
    var score = hit / Math.max(qtoks.length, 1);

    var mod = modality(sentence);
    if (mod) score += 0.12;                                  // الأحكام أثمن من السرد
    var f = extractFacts(sentence);
    if (intent.k === "duration" && f.some(function (x) { return x.kind === "duration"; })) score += 0.55;
    if (intent.k === "amount" && f.some(function (x) { return x.kind === "pct" || x.kind === "money"; })) score += 0.55;
    if (intent.k === "coverage" && mod && (mod.k === "coverage" || mod.k === "exception")) score += 0.35;
    if (intent.k === "obligation" && mod && mod.k === "obligation") score += 0.35;
    if (intent.k === "definition" && mod && mod.k === "definition") score += 0.6;
    if (intent.k === "penalty" && /مخالف|عقوب|غرام|جزاء|إيقاف/.test(sentence)) score += 0.4;

    var len = sentence.length;
    if (len < 45) score *= 0.7;                              // شظايا
    if (len > 420) score *= 0.85;                            // فقرات مكدّسة
    return score;
  }

  // ────────────────────────────────────────────────────────────────
  // 6. الاستنتاج — قواعد صريحة فوق ما استُخرج
  // ────────────────────────────────────────────────────────────────
  var DEEMED = /(يتم التعامل معه[ا]? على أساس الموافقة|تعتبر موافقة|تُعدّ? موافقة|في حكم الموافقة|موافقة ضمنية)/;

  function infer(query, intent, picked, facts) {
    var out = [];
    var all = picked.map(function (p) { return p.raw; }).join(" ");

    // (٠) الجواب المباشر — للقارئ المستعجل، من أوثق جملة تحمل المعطى المطلوب
    if (intent.k === "duration" || intent.k === "amount") {
      var want = intent.k === "duration"
        ? function (f) { return f.kind === "duration"; }
        : function (f) { return f.kind === "pct" || f.kind === "money"; };
      for (var di = 0; di < picked.length; di++) {
        var hitf = (picked[di].facts || []).filter(want)[0];
        if (!hitf) continue;
        var line = "الجواب المباشر: " + hitf.display +
          (hitf.ctx ? " — " + hitf.ctx : "") +
          (picked[di].actor ? "، والالتزام على " + picked[di].actor : "") + ".";
        out.push({ text: line, refs: [picked[di].ref] });
        break;
      }
    }

    // (١) تباين المدد بين المراجع — إشارة عملية مهمّة قبل الاحتجاج بنصّ
    if (intent.k === "duration") {
      var durs = {};
      facts.forEach(function (f) {
        if (f.kind !== "duration") return;
        (durs[f.display] = durs[f.display] || []).push(f.ref);
      });
      var keys = Object.keys(durs);
      if (keys.length === 1) {
        out.push({ text: "المدة النظامية المنطبقة هي " + keys[0] +
          "، ولم يرد في المراجع المسترجَعة مدة مخالفة لها.", refs: uniq(durs[keys[0]]) });
      } else if (keys.length > 1) {
        // لكل مدّة نطاقها المستخرَج من جوارها — فلا تُقرأ المدد كأنها بدائل
        var ctxOf = {};
        facts.forEach(function (f) {
          if (f.kind === "duration" && f.ctx && !ctxOf[f.display]) ctxOf[f.display] = f.ctx;
        });
        var lines = keys.map(function (k) {
          return k + (ctxOf[k] ? " (" + ctxOf[k] + ")" : "");
        });
        var known = keys.filter(function (k) { return ctxOf[k]; }).length;
        var tail = known < keys.length
          ? " — وما لم يُذكر نطاقه فارجع إلى نصّه المرقوم لتحديد ما ينطبق على حالتك."
          : " — اعتمد المدّة التي يطابق نطاقُها حالتك.";
        out.push({ text: "المدد الواردة ليست بدائل بل لكلٍّ نطاقه: " +
          lines.join("؛ ") + tail,
          refs: uniq([].concat.apply([], keys.map(function (k) { return durs[k]; }))) });
      }
    }

    // (٢) الموافقة الضمنية عند انقضاء المهلة
    if (DEEMED.test(all)) {
      out.push({ text: "يترتّب على انقضاء المهلة دون ردّ اعتبارُ الطلب موافقاً عليه ضمناً — " +
        "أي أن سكوت شركة التأمين يُحسب لصالح مقدّم الخدمة، فيصحّ تقديم الخدمة على أساسها.",
        refs: refsMatching(picked, DEEMED) });
    }

    // (٣) الأصل والاستثناء معاً — أهمّ ما يُغفل عند القراءة السريعة
    var oblig = picked.filter(function (p) { return p.modality === "obligation" || p.modality === "coverage"; });
    var exc = picked.filter(function (p) { return p.modality === "exception"; });
    if (oblig.length && exc.length) {
      out.push({ text: "الحكم هنا ذو شقّين: أصلٌ عامّ يقرّره النصّ، ثم استثناء يخرج عنه. " +
        "الاستشهاد بالأصل وحده دون استثنائه يُنتج نتيجة خاطئة عند التطبيق.",
        refs: uniq(oblig.slice(0, 1).map(r(0)).concat(exc.slice(0, 1).map(r(0)))) });
    }

    // (٤) الشروط المقترنة — عدم استيفائها سببٌ مباشر لعدم قبول الطلب
    var conds = picked.filter(function (p) { return p.modality === "condition"; });
    var condLeading = picked.slice(0, 2).some(function (p) { return p.modality === "condition"; });
    if (conds.length && condLeading) {
      out.push({ text: "الحكم مشروط: تخلّف أيّ من الشروط الواردة يُسقط الاستحقاق، " +
        "ويكون سبباً نظامياً كافياً لعدم قبول الطلب أو تخفيضه.",
        refs: uniq(conds.slice(0, 2).map(r(0))) });
    }

    // (٥) نسب التحمّل — أثرها المالي المباشر
    var pcts = facts.filter(function (f) { return f.kind === "pct"; });
    if (intent.k === "amount" && pcts.length) {
      out.push({ text: "النسبة الواردة (" + uniqStr(pcts.map(function (f) { return f.display; })).join(" / ") +
        ") تُطبَّق على قيمة الخدمة المشمولة، فتُخفِّض المبلغ المستحق لمقدّم الخدمة بمقدارها؛ " +
        "وتحصيلها من المستفيد عند تقديم الخدمة يمنع نشوء فرق غير محصّل لاحقاً.",
        refs: uniq(pcts.map(function (f) { return f.ref; })) });
    }

    // (٦) الحظر — لا يُعالَج بالتفويض ولا بالاتفاق
    var prohib = picked.filter(function (p) { return p.modality === "prohibition"; });
    if (prohib.length) {
      out.push({ text: "ما ورد بصيغة المنع حكمٌ آمر: لا يصحّ الاتفاق على خلافه بين الأطراف، " +
        "ومخالفته تُعرّض المخالف للمساءلة النظامية.", refs: uniq(prohib.slice(0, 2).map(r(0))) });
    }

    // (٧) ازدواج أثر المخالفة حين يجتمع الجزاء النظامي بالحقّ التعاقدي
    if (/(?:إخلال(?:اً|ا)? جوهري|إلغاء (?:ال)?عقد|فسخ (?:ال)?عقد|إنهاء (?:ال)?عقد)/.test(all) &&
        /(?:عقوبة|غرامة|السجن|سجن|مساءلة|جزاء)/.test(all)) {
      out.push({ text: "للمخالفة هنا أثران متمايزان لا يُغني أحدهما عن الآخر: جزاء نظاميّ " +
        "يوقَّع على المخالف، وحقّ تعاقديّ للطرف المتضرّر في إنهاء العلاقة — فالتسوية الودّية " +
        "لا تُسقط الجزاء، وتوقيع الجزاء لا يُلزم باستمرار التعاقد.",
        refs: refsMatching(picked, /(?:إخلال|إلغاء|فسخ|إنهاء|عقوبة|غرامة|مساءلة)/) });
    }

    // (٧ب) الإحالة إلى مادة أخرى: الحكم المُحال إليه جزء من الحكم
    var xrefSeen = {};
    picked.forEach(function (p) {
      crossRefs(p.raw).forEach(function (x) {
        var k = x.num + "|" + x.target;
        if (xrefSeen[k]) return;
        xrefSeen[k] = 1;
        out.push({ text: "النصّ يحيل إلى المادة (" + x.num + ") من " + x.target +
          " — والحكم لا يكتمل دون قراءتها؛ اسأل عنها من زرّ المتابعة أدناه.",
          refs: [p.ref], xref: x });
      });
    });

    // (٨) ربط تشغيليّ بنموذج التنبّؤ في المنصّة
    if (/موافق|رفض|طلب|تصريح/.test(query)) {
      out.push({ text: "تشغيلياً: هذه الاشتراطات النظامية هي ذاتها التي يقيس نموذج «ARCH Predict» " +
        "أثرها إحصائياً على احتمال عدم اكتمال الموافقة — فاستيفاؤها قبل الإرسال " +
        "هو الإجراء التصحيحي الأرخص.", refs: [] });
    }

    return out;
  }

  // «وفقاً للمادة (96) من اللائحة التنفيذية…» — الحكم لا يكتمل دون المُحال إليه
  var RE_XREF = /لل?ماد[ةه]\s*\(?\s*([0-9\u0660-\u0669]{1,3})\s*\)?\s*من\s+([^،.؛:()\n]{3,45})/g;

  function crossRefs(text) {
    var out = [], m;
    RE_XREF.lastIndex = 0;
    while ((m = RE_XREF.exec(text)) !== null) {
      var target = clean(m[2]).replace(/^(هذه|هذا)\s+/, "").trim();
      // قصّ ذيل الجملة الملتصق باسم المُحال إليه («…نظام الضمان الصحي على ذلك»)
      target = target.split(/\s+(?:على|وذلك|بما|حيث|فإن|إذا|وفي|ويكون|وعلى)\s+/)[0].trim();
      if (/^(اللائحة|النظام|القسم|الفصل|الملحق)$/.test(target)) continue;  // إحالة ذاتية مبهمة
      out.push({ num: digits(m[1]), target: target });
    }
    return out;
  }

  function r(i) { return function (p) { return p.ref; }; }
  function uniq(a) { var s = {}; return a.filter(function (x) {
    if (x == null || s[x]) return false; s[x] = 1; return true; }); }
  function uniqStr(a) { var s = {}; return a.filter(function (x) {
    if (s[x]) return false; s[x] = 1; return true; }); }

  function refsMatching(picked, re) {
    return uniq(picked.filter(function (p) { return re.test(p.raw); })
                      .map(function (p) { return p.ref; }));
  }

  // ────────────────────────────────────────────────────────────────
  // 7. التركيب النهائي
  // ────────────────────────────────────────────────────────────────
  function analyze(query, results, opts) {
    opts = opts || {};
    var intent = detectIntent(query);
    var qtoks = S.tokenize(query);
    var pool = [];

    results.slice(0, opts.depth || 4).forEach(function (res, ri) {
      var head = res.heading && res.text.indexOf(res.heading.slice(0, 24)) !== 0
        ? res.heading + ". " : "";
      sentences(head + res.text).forEach(function (sn) {
        var sc = relevance(sn, qtoks, intent);
        if (sc <= 0.08) return;
        pool.push({ raw: sn, score: sc * (1 - ri * 0.08), ref: ri + 1, head: res.heading });
      });
    });

    pool.sort(function (a, b) { return b.score - a.score; });

    // عتبة نسبية: ما نزل كثيراً عن أفضل جملة ليس إجابة بل جوارٌ موضوعيّ
    var floor = pool.length ? pool[0].score * 0.42 : 0;

    var picked = [], norms = [], perRef = {};
    for (var i = 0; i < pool.length && picked.length < 5; i++) {
      var it = pool[i];
      if (it.score < floor) break;
      var nz = S.normalize(it.raw);
      // إسقاط المكرّر والمحتوى داخل جملة سابقة (العناوين تتكرّر داخل متونها)
      var dup = norms.some(function (n) {
        return n === nz || n.indexOf(nz) >= 0 || nz.indexOf(n) >= 0;
      });
      if (dup) continue;
      perRef[it.ref] = (perRef[it.ref] || 0) + 1;
      if (perRef[it.ref] > 2) continue;                       // توزيع على المراجع
      var rp = rephrase(it.raw, it.head);
      if (!rp || !rp.text) continue;
      norms.push(nz);
      picked.push({ ref: it.ref, raw: it.raw, text: rp.text, modality: rp.modality,
                    modalityLabel: rp.modalityLabel, actor: rp.actor, facts: rp.facts });
    }

    var facts = [];
    picked.forEach(function (p) {
      p.facts.forEach(function (f) {
        facts.push({ kind: f.kind, display: f.display, ctx: f.ctx, ref: p.ref });
      });
    });
    var fseen = {};
    facts = facts.filter(function (f) {
      var k = f.kind + f.display + (f.ctx || "");
      if (fseen[k]) return false; fseen[k] = 1; return true;
    });
    // النسخة عديمة السياق من معطى له نسخة بسياق لا تضيف شيئاً
    var hasCtx = {};
    facts.forEach(function (f) { if (f.ctx) hasCtx[f.kind + f.display] = 1; });
    facts = facts.filter(function (f) { return f.ctx || !hasCtx[f.kind + f.display]; });

    var gaps = [];
    var top = results[0];
    if (top && top.coverage < 0.6) {
      var covered = {};
      results.slice(0, 3).forEach(function (res) {
        (res.matched || []).forEach(function (t) { covered[t] = 1; });
      });
      var missing = qtoks.filter(function (t) { return !covered[t]; });
      if (missing.length) {
        gaps.push("لم أجد في المراجع المفهرسة نصّاً يتناول: " + missing.join("، ") +
                  " — قد يكون خارج نطاق الوثائق المحمَّلة.");
      }
    }
    if (!picked.length) {
      gaps.push("النصوص المسترجَعة ذات صلة بالموضوع لكنها لا تحمل حكماً صريحاً يجيب عن السؤال مباشرة.");
    }

    var inferences = infer(query, intent, picked, facts);

    // أسئلة متابعة: من الإحالات المكتشفة أولاً، ثم سؤال منطقي يلي هذا الصنف
    // من الأسئلة عادةً. تُعرض أزراراً فيُستكمل الحكم بضغطة.
    var followups = [];
    inferences.forEach(function (inf) {
      if (inf.xref && followups.length < 2) {
        followups.push({ label: "اقرأ المادة (" + inf.xref.num + ") من " + inf.xref.target,
                         q: "المادة " + inf.xref.num + " " + inf.xref.target });
      }
    });
    var NEXT_Q = {
      duration: { label: "ماذا لو انقضت المهلة دون ردّ؟",
                  q: "عدم الرد على طلب الموافقة خلال المدة المحددة" },
      coverage: { label: "ما التحديدات والاستثناءات؟",
                  q: "التحديدات والاستثناءات المنافع غير المغطاة" },
      amount:   { label: "متى يُستثنى المستفيد من التحمّل؟",
                  q: "استثناء الحالات الطارئة والتنويم من مبلغ التحمل" },
      penalty:  { label: "كيف يُتظلَّم من القرار؟",
                  q: "التظلم والاعتراض لجنة النظر في المخالفات" },
      obligation: { label: "ما الجزاء عند الإخلال بهذه الالتزامات؟",
                    q: "مخالفة الالتزامات الجزاءات والعقوبات" },
    };
    if (NEXT_Q[intent.k] && followups.length < 3) followups.push(NEXT_Q[intent.k]);

    return {
      intent: intent,
      statements: picked,
      facts: facts,
      inferences: inferences,
      gaps: gaps,
      expansions: expansions(query),
      followups: followups,
    };
  }

  root.RCMReason = {
    digits: digits, clean: clean, sentences: sentences,
    detectIntent: detectIntent, expansions: expansions,
    extractFacts: extractFacts, modality: modality, actor: actor,
    rephrase: rephrase, analyze: analyze,
    durationCtx: durationCtx, crossRefs: crossRefs,
  };
})(typeof window !== "undefined" ? window : globalThis);

if (typeof module !== "undefined" && module.exports) module.exports = globalThis.RCMReason;
