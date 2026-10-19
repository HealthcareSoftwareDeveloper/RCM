# بوّابة «مساند نماء الذكي» لمفتاح Gemini — ثلاث طرق نشر مجانية

الهدف: **كل من يفتح رابط المنصّة يستطيع استخدام التوليد اللغوي، ولا يستطيع أحد قراءة
المفتاح** — لأنه لا يغادر خادم البوّابة أصلاً.

> **لماذا لا يوضع المفتاح في الموقع نفسه «مشفَّراً»؟**
> المنصّة صفحات ثابتة تُرسل بحذافيرها إلى متصفّح كل زائر، والمستودع علنيّ. أي تشفير
> داخل الموقع يُرفق معه ما يفكّه ليعمل — فيفكّه كل زائر بالطريقة نفسها. (كما أن
> GitHub وGoogle يمسحان المستودعات العلنية ويعطّلان آلياً أي مفتاح يظهر فيها.)
> التشفير الحقيقي يكون حيث لا يصل الزائر: **مخزن أسرار المنصّة الخادمية** — يخزّن
> المفتاح مشفَّراً ولا يعرضه بعد حفظه، ويقرأه الخادم وقت التنفيذ فقط.

---

## ⚠️ قبل كل شيء: أنشئ مفتاحاً جديداً

أي مفتاح مرّ في محادثة أو رسالة أو لقطة شاشة يُعدّ مكشوفاً. أنشئ مفتاحاً جديداً من
[Google AI Studio](https://aistudio.google.com/apikey) واحذف القديم، وضع **الجديد وحده**
في أسرار البوّابة. المفتاح لا يوضع في هذا المستودع أبداً.

---

## الطريقة ١ — Deno Deploy: لصقٌ في المتصفّح (الأسهل، بلا أدوات)

1. سجّل مجاناً في [dash.deno.com](https://dash.deno.com) (يقبل الدخول بحساب GitHub).
2. **New Playground** ← احذف الشيفرة الافتراضية والصق محتوى
   [`gateway/worker.js`](worker.js) كاملاً — الملف يشغّل نفسه على Deno تلقائياً —
   ثم **Save & Deploy**.
3. من إعدادات المشروع: **Settings ← Environment Variables ← Add**:
   `GEMINI_API_KEY` = مفتاحك الجديد.
4. رابط بوّابتك: `https://<اسم-المشروع>.deno.dev`

## الطريقة ٢ — Vercel: ربط المستودع بلا لصق ولا أوامر

الدالة جاهزة في هذا المستودع: [`api/gemini/[...path].js`](../api/gemini/%5B...path%5D.js)

1. سجّل في [vercel.com](https://vercel.com) **بحساب GitHub** ← **Add New ← Project**
   ← اختر مستودع `RCM` ← **Deploy** (الإعدادات الافتراضية تكفي).
2. **Settings ← Environment Variables**: أضف `GEMINI_API_KEY` بنوع **Sensitive**
   (مشفَّر ولا يُعرض بعد حفظه)، ثم **Redeploy**.
3. رابط بوّابتك: `https://<مشروعك>.vercel.app/api/gemini`

## الطريقة ٣ — Cloudflare Workers

كما في الطريقة ١ لكن على [dash.cloudflare.com](https://dash.cloudflare.com):
**Workers & Pages ← Create Worker ← Edit code** ← الصق `worker.js` ← **Deploy**،
ثم **Settings ← Variables and Secrets**: أضف `GEMINI_API_KEY` بنوع **Secret**.
(أو بسطر الأوامر: `cd gateway && wrangler deploy && wrangler secret put GEMINI_API_KEY`)

---

## الربط بالمنصّة (خطوة واحدة أياً كانت الطريقة)

افتح [`assets/site-config.js`](../assets/site-config.js)، أزل التعليق وضع رابطك:

```js
window.SADEED_SITE_LLM = {
  enabled: true,
  provider: "gemini",
  geminiModel: "gemini-flash-lite-latest",   // الموصى به — الأخفّ والأكثر توفّراً
  // Deno:       https://<مشروعك>.deno.dev/v1beta/models/
  // Vercel:     https://<مشروعك>.vercel.app/api/gemini/v1beta/models/
  // Cloudflare: https://<اسم-العامل>.<حسابك>.workers.dev/v1beta/models/
  geminiBase: "https://<بوابتك>/v1beta/models/",
};
```

ادفع التغيير (أو أعطِ الرابط لمساعد النشر ليضعه). من تلك اللحظة يجد كل زائر التوليد
**مفعّلاً تلقائياً بلا أي مفتاح**، وإن اختار نموذجاً أقوى وتعذّر أو لم يولّد إجابة
**تحوّلت الإجابة تلقائياً إلى Flash Lite**. وتبقى لكل مستخدم غلبةُ الإيقاف أو وضع
مفتاحه الخاص من ⚙ الإعدادات.

## التحقّق

```bash
curl -sS "https://<بوابتك>/v1beta/models/gemini-flash-lite-latest:generateContent" \
  -H 'Origin: https://hanihalsulami.github.io' -H 'Content-Type: application/json' \
  -d '{"contents":[{"parts":[{"text":"قل: مرحبا"}]}]}'
```

ردّ JSON فيه نصّ = البوّابة تعمل والمفتاح يُحقن خادمياً.
(لمسار Vercel أدرج `/api/gemini` قبل `/v1beta/…`)

## حدود الحماية — بصراحة

- **قفل المصدر (Origin)**: البوّابة لا تخدم إلا طلبات متصفّح قادمة من موقع المنصّة —
  يصدّ تضمينها في مواقع أخرى، لكنه لا يمنع من يستدعيها مباشرةً من خارج متصفّح منتحلاً
  الترويسة. المفتاح محميّ دائماً؛ **حصّته** سقف ضررها الخطط المجانية لدى Google والمنصّة.
- **نماذج ومسارات محصورة وحجم مسقوف** — فلا تصير البوّابة وكيلاً عاماً.
- لميزانية يومية صارمة أو رمز دخول للفريق: إضافة صغيرة على البوّابة — اطلبها.

---

# بوّابة «برهان نماء» — مفتاحا Claude وParallel

صفحة [`burhan.html`](../burhan.html) محرّك بحث مُسنَد: **Claude** يخطّط ويقرّر ما يُبحث عنه،
و**Parallel** يجلب المقاطع من الويب الحيّ ويقرأ الصفحات كاملة، ثم يكتب Claude إجابة يحمل
كل سطر فيها رقم مصدره. البوّابة [`burhan-gateway.js`](burhan-gateway.js) تحمل المفتاحين
في مخزن الأسرار وتحقنهما خادمياً، فلا يصل أيّهما إلى أي متصفّح.

| المسار | الوجهة |
|---|---|
| `POST /v1/messages` | `api.anthropic.com/v1/messages` — بثّ SSE، نماذج محصورة، `max_tokens` ≤ 16000 |
| `POST /v1/search` | `api.parallel.ai/v1/search` |
| `POST /v1/extract` | `api.parallel.ai/v1/extract` — حتى ٥ روابط |
| `GET /health` | هل المفتاحان مضبوطان؟ (بلا كشف لهما) |

## النشر — الملف نفسه على ثلاث منصّات

- **Deno Deploy:** Playground جديد ← الصق `gateway/burhan-gateway.js` ← Save & Deploy.
- **Cloudflare Workers:** Create Worker ← الصق الملف ← Deploy.
- **Vercel:** اربط المستودع (الدالة جاهزة في [`api/burhan/[...path].js`](../api/burhan/)) —
  رابطها `https://<مشروعك>.vercel.app/api/burhan`.

ثم في متغيرات البيئة/الأسرار:

| المتغيّر | |
|---|---|
| `ANTHROPIC_API_KEY` | **إلزامي** — من [console.anthropic.com](https://console.anthropic.com) |
| `PARALLEL_API_KEY` | **إلزامي** — من [platform.parallel.ai](https://platform.parallel.ai) |
| `ACCESS_TOKEN` | اختياري — رمز دخول للفريق؛ يُكتب في ⚙ إعدادات الصفحة |
| `ALLOWED_ORIGINS` | اختياري — الافتراضي `https://hanihalsulami.github.io` |
| `ALLOWED_MODELS` | اختياري — الافتراضي `claude-opus-5-5,claude-sonnet-5-5,claude-haiku-5-5` |

## الربط

ضع الرابط في `window.NAMAA_BURHAN.gateway` داخل [`assets/site-config.js`](../assets/site-config.js)
وادفع التغيير — فيجد كل زائر برهان نماء جاهزاً. أو يضعه كل مستخدم لنفسه من ⚙ الإعدادات.

```bash
curl -sS https://<بوابتك>/health -H 'Origin: https://hanihalsulami.github.io'
# {"ok":true,"claude":true,"parallel":true,...}
```

> **لماذا `ACCESS_TOKEN`؟** بخلاف Gemini المجاني، كل سؤال في برهان يستهلك رصيداً مدفوعاً
> لدى Anthropic وParallel. قفل المصدر يصدّ المواقع الأخرى لكنه لا يصدّ من يستدعي البوّابة
> من خارج متصفّح — رمز الفريق يغلق هذا الباب. منطق البوّابة مُختبَر في `tests/verify_burhan.mjs`.
