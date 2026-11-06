/**
 * Code.gs — الواجهة الخلفية لسجلّ تتبّع السلوك والاستجابة (Audit Trail)
 * ARCH Predict · ARCH Systems
 *
 * يعمل كتطبيق ويب على Google Apps Script مربوطاً بملف Google Sheets:
 *   • POST : يستقبل حدثاً واحداً (تنبؤ / تطبيق الإجراء / تجاهل) ويلحقه صفاً جديداً.
 *   • GET  : يعيد كل الصفوف المتراكمة بصيغة JSON للوحة القيادة.
 *
 * خطوات النشر كاملةً في audit/README.md — باختصار:
 *   1) أنشئ Google Sheet جديداً، ومن Extensions ← Apps Script ألصق هذا الملف.
 *   2) Deploy ← New deployment ← Web app:
 *        Execute as: Me   ·   Who has access: Anyone
 *   3) انسخ رابط Web app URL وضعه في assets/site-config.js بالمنصّة.
 *
 * ملاحظتان مهمّتان:
 *   • الواجهة الأمامية تُرسل POST بترويسة text/plain عمداً — هذا يجعل الطلب
 *     «بسيطاً» فلا يحتاج CORS preflight الذي لا تدعمه تطبيقات Apps Script.
 *   • SHARED_TOKEN حماية خفيفة اختيارية: إن وضعت قيمة هنا فضع القيمة نفسها
 *     في site-config.js — كل ما في المتصفح قابل للقراءة، فهذه لصدّ العبث
 *     العابر لا أكثر. لا تُسجَّل هنا أي بيانات مرضى أو معرّفات شخصية.
 */

var SHEET_NAME = "AuditTrail";
var SHARED_TOKEN = "";                 // اختياري — اتركه فارغاً لتعطيل الفحص

var HEADERS = [
  "التاريخ والوقت",                    // يُختم من الخادم وقت الاستلام
  "الرقم المرجعي",                     // رقم الجلسة المولَّد في المتصفح (NA-xxxxxx)
  "المرحلة",                           // approvals / claims
  "الخطر الأولي %",                    // احتمال عدم الاكتمال عند أول تنبؤ للجلسة
  "الخطر النهائي %",                   // الاحتمال عند تسجيل الاستجابة
  "قيمة الفاتورة",                     // بالريال
  "نوع الاستجابة",                     // prediction / applied / ignored
  "معرف الجهاز",                       // معرّف عشوائي ثابت للمتصفح (بلا هوية شخصية)
];

// ──────────────────────────────────────────────────────────────────────
// أدوات مشتركة
// ──────────────────────────────────────────────────────────────────────
function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** يعيد ورقة السجل، ويُنشئها بصف العناوين إن لم توجد. */
function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
    sh.setFrozenRows(1);
  }
  return sh;
}

function num_(v) {
  var n = Number(v);
  return isFinite(n) ? n : "";
}

function clean_(v, maxLen) {
  return String(v == null ? "" : v).replace(/[\n\r\t]/g, " ").slice(0, maxLen || 64);
}

// ──────────────────────────────────────────────────────────────────────
// POST — حفظ حدث جديد صفاً في الشيت
// جسم الطلب JSON:
// { token?, ref, stage, initialRisk, finalRisk, amount, response, device }
// ──────────────────────────────────────────────────────────────────────
function doPost(e) {
  // قفل يمنع تسابق الكتابة حين يرسل جهازان في اللحظة نفسها
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var body;
    try {
      body = JSON.parse(e && e.postData && e.postData.contents || "{}");
    } catch (err) {
      return jsonOut_({ ok: false, error: "invalid_json" });
    }

    if (SHARED_TOKEN && body.token !== SHARED_TOKEN) {
      return jsonOut_({ ok: false, error: "bad_token" });
    }

    var response = clean_(body.response, 16);
    if (["prediction", "applied", "ignored"].indexOf(response) < 0) {
      return jsonOut_({ ok: false, error: "bad_response_type" });
    }

    sheet_().appendRow([
      new Date(),                       // التاريخ والوقت — ختم الخادم
      clean_(body.ref, 24),             // الرقم المرجعي
      clean_(body.stage, 16),           // المرحلة
      num_(body.initialRisk),           // الخطر الأولي %
      num_(body.finalRisk),             // الخطر النهائي %
      num_(body.amount),                // قيمة الفاتورة
      response,                         // نوع الاستجابة
      clean_(body.device, 24),          // معرف الجهاز
    ]);

    return jsonOut_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

// ──────────────────────────────────────────────────────────────────────
// GET — قراءة كل الصفوف المتراكمة JSON للوحة القيادة
// اختيارياً: ?token=... حين يكون SHARED_TOKEN مضبوطاً
// ──────────────────────────────────────────────────────────────────────
function doGet(e) {
  if (SHARED_TOKEN && (!e || !e.parameter || e.parameter.token !== SHARED_TOKEN)) {
    return jsonOut_({ ok: false, error: "bad_token" });
  }

  var sh = sheet_();
  var last = sh.getLastRow();
  if (last < 2) return jsonOut_({ ok: true, rows: [] });

  var values = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  var rows = values.map(function (r) {
    return {
      ts: r[0] instanceof Date ? r[0].toISOString() : String(r[0]),
      ref: String(r[1]),
      stage: String(r[2]),
      initialRisk: Number(r[3]) || 0,
      finalRisk: Number(r[4]) || 0,
      amount: Number(r[5]) || 0,
      response: String(r[6]),
      device: String(r[7]),
    };
  });

  return jsonOut_({ ok: true, count: rows.length, rows: rows });
}
