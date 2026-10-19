/*!
 * site-config.js — إعدادات المنصّة المشتركة (يحرّرها مسؤول المنصّة فقط)
 * منصّة مُتَنَبِّئ نماء · تجمع مكة المكرمة الصحي · إدارة أداء تنمية الإيرادات
 *
 * ما يوضع هنا يسري على كل زوّار المنصّة كإعداد افتراضي، ويبقى لكل مستخدم
 * أن يغيّره لنفسه من ⚙ الإعدادات (تفضيلاته المحلية تغلب هذه القيم).
 *
 * تفعيل التوليد اللغوي للجميع بلا مفاتيح في المتصفّح:
 *   1) انشر البوّابة (الدليل: gateway/README.md — ثلاث منصات مجانية: Deno Deploy
 *      لصقاً في المتصفّح، أو Vercel بربط المستودع، أو Cloudflare)
 *      وضع مفتاح Gemini في أسرارها — المفتاح لا يوضع هنا أبداً، فهذا الملف
 *      علنيّ ككل ملفات الموقع.
 *   2) أزل التعليق عن الأسطر أدناه وضع رابط بوّابتك، ثم ادفع التغيير.
 */
window.SADEED_SITE_LLM = {
  // enabled: true,
  // provider: "gemini",
  // geminiModel: "gemini-flash-lite-latest",
  // geminiBase: "https://<بوابتك>/v1beta/models/",   // Vercel: https://<مشروعك>.vercel.app/api/gemini/v1beta/models/
};

/*
 * تتبّع السلوك والاستجابة (Audit Trail) — سجلّ تراكمي في Google Sheets:
 *   1) انشر audit/Code.gs تطبيقَ ويب على Google Apps Script (الدليل: audit/README.md)
 *   2) ▼▼ ضع رابط Web App URL هنا (ينتهي بـ /exec) ▼▼ — ما دام فارغاً تبقى الميزة صامتة
 * اختيارياً: token يطابق SHARED_TOKEN في Code.gs، وpinHash لتغيير الرقم السري
 * للوحة القيادة (الافتراضي Admin2026 — ولّد بصمة رقم جديد من Console بالأمر:
 *   RCMAudit.hash("رقمك").then(console.log)
 */
window.NAMAA_AUDIT = {
  url: "https://script.google.com/macros/s/AKfycbyY2Qo-afn8iBF8LHWaTrAEWbQGIaULCkW9PIhC0K2BQvvWIG_Ney7O0gNaG6-UsCyNCg/exec",
  // token: "",
  // pinHash: "",
};

/*
 * «برهان نماء» — بحث مُسنَد يقوده Claude ويغذّيه Parallel (burhan.html):
 *   1) انشر gateway/burhan-gateway.js (Deno Deploy أو Cloudflare) أو اربط المستودع بـ Vercel
 *      وضع في أسرارها ANTHROPIC_API_KEY وPARALLEL_API_KEY — لا يوضع أي مفتاح هنا أبداً.
 *   2) ضع رابط البوّابة أدناه (Vercel: https://<مشروعك>.vercel.app/api/burhan)، ثم ادفع التغيير.
 * ما دام الرابط فارغاً يستطيع كل مستخدم وضع بوّابته أو مفتاحَيه من ⚙ الإعدادات في الصفحة.
 */
window.NAMAA_BURHAN = {
  gateway: "",                 // https://<بوابتك>
  model: "claude-opus-5-5",    // claude-opus-5-5 | claude-sonnet-5-5 | claude-haiku-5-5
  depth: "deep",               // quick | deep
};
