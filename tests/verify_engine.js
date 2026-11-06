/*!
 * verify_engine.js — التحقّق من مطابقة محرّك المتصفح لمخرجات بايثون
 * ARCH Predict · ARCH Systems
 *
 * يقارن نتائج assets/rcm-engine.js بنتائج LightGBM ومكتبة shap في بايثون.
 * يعمل مع الهدف الثنائي ومتعدّد الفئات على السواء.
 *
 *     python3 tests/dump_reference.py --data <ملف البيانات>
 *     node tests/verify_engine.js
 *
 * ينتهي برمز خروج 1 إذا تجاوز أي فارق العتبة المسموحة.
 */
const fs = require("fs");
const path = require("path");

const TOL = { margin: 1e-3, proba: 1e-4, shap: 1e-3, additivity: 1e-5 };

// `node tests/verify_engine.js` يفحص حزمة الموافقات (الافتراضي)،
// و`node tests/verify_engine.js claims` يفحص حزمة المطالبات بنفس المنطق.
const CLAIMS = process.argv[2] === "claims";

global.window = global;
require(path.join(__dirname, "..", "model", "artifacts",
  CLAIMS ? "claims_bundle.js" : "model_bundle.js"));
const E = require(path.join(__dirname, "..", "assets", "rcm-engine.js"));

const B = CLAIMS ? global.RCM_CLAIMS_BUNDLE : global.RCM_BUNDLE;
const refPath = path.join(__dirname, CLAIMS ? "claims_reference.json" : "reference.json");
if (!fs.existsSync(refPath)) {
  console.error("لم يُعثر على reference.json — شغّل tests/dump_reference.py أولاً.");
  process.exit(1);
}
const R = JSON.parse(fs.readFileSync(refPath, "utf8"));

if (JSON.stringify(B.features) !== JSON.stringify(R.features)) {
  console.error("✗ ترتيب الخصائص في الحزمة يخالف ترتيبها في المرجع.");
  process.exit(1);
}
if (B.approval.task !== R.task) {
  console.error(`✗ نوع المهمّة مختلف: الحزمة ${B.approval.task} والمرجع ${R.task}.`);
  process.exit(1);
}

E.prepare(B.approval.trees);
E.prepare(B.reason.trees);

const nOut = B.approval.outputs;           // 1 للثنائي، عدد الفئات لغيره
const nR = B.reason.outputs;
const nF = B.features.length;
let maxMargin = 0, maxProba = 0, maxShap = 0, maxAdd = 0, maxReason = 0, maxBase = 0;

for (let k = 0; k < nOut; k++) {
  maxBase = Math.max(maxBase, Math.abs(B.approval.base[k] - R.expected[k]));
}

for (let i = 0; i < R.X.length; i++) {
  const x = Float64Array.from(R.X[i].map((v) => (v === null ? NaN : v)));
  const m = E.rawScores(B.approval.trees, x, nOut);
  const p = E.toProba(m, B.approval);
  const phi = E.shapValues(B.approval.trees, x, nOut, nF);
  const rm = E.rawScores(B.reason.trees, x, nR);

  for (let k = 0; k < nOut; k++) {
    maxMargin = Math.max(maxMargin, Math.abs(m[k] - R.margin[i][k]));
    let sum = B.approval.base[k];
    for (let f = 0; f < nF; f++) {
      sum += phi[k][f];
      maxShap = Math.max(maxShap, Math.abs(phi[k][f] - R.shap[k][i][f]));
    }
    maxAdd = Math.max(maxAdd, Math.abs(sum - m[k]));
  }
  for (let c = 0; c < p.length; c++) {
    maxProba = Math.max(maxProba, Math.abs(p[c] - R.proba[i][c]));
  }
  for (let c = 0; c < nR; c++) {
    maxReason = Math.max(maxReason, Math.abs(rm[c] - R.reason_margin[i][c]));
  }
}

const rows = [
  ["قيمة أساس SHAP مقابل shap.expected_value", maxBase, TOL.shap],
  ["الدرجة الخام (نموذج الموافقة)", maxMargin, TOL.margin],
  ["الاحتمالات", maxProba, TOL.proba],
  ["قيم SHAP مقابل مكتبة shap", maxShap, TOL.shap],
  ["جمعية SHAP: الأساس + Σφ = الدرجة", maxAdd, TOL.additivity],
  ["الدرجة الخام (نموذج الأسباب)", maxReason, TOL.margin],
];

console.log(`\nمقارنة محرّك JavaScript بمخرجات بايثون — ${R.X.length} صفاً · مهمّة ${R.task}\n`);
let ok = true;
for (const [name, val, tol] of rows) {
  const pass = val <= tol;
  ok = ok && pass;
  console.log(`  ${pass ? "✓" : "✗"} ${name.padEnd(44)} ${val.toExponential(3)}  (الحد ${tol.toExponential(0)})`);
}

const t0 = Date.now();
const N = 20;
for (let k = 0; k < N; k++) {
  const x = Float64Array.from(R.X[k % R.X.length].map((v) => (v === null ? NaN : v)));
  E.shapValues(B.approval.trees, x, nOut, nF);
}
console.log(`\n  زمن حساب SHAP للتنبّؤ الواحد: ${((Date.now() - t0) / N).toFixed(1)} مللي ثانية`);
console.log(ok ? "\n✓ اجتاز التحقّق\n" : "\n✗ فشل التحقّق\n");
process.exit(ok ? 0 : 1);
