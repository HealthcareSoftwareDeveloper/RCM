# -*- coding: utf-8 -*-
"""
powerbi_script.py — تشغيل النموذج داخل Power BI مباشرةً
ARCH Predict · ARCH Systems

الاستخدام في Power BI Desktop:
    Home ← Get Data ← More… ← Other ← Python script
ثم ألصق محتوى هذا الملف بعد تعديل المسارين في قسم «الإعدادات» أدناه،
واختر جدول «scored» عند ظهور نافذة المعاينة.

متطلّبات بيئة Python التي يشير إليها Power BI
(Options ← Python scripting ← Detected Python home directory):
    pip install pandas numpy lightgbm shap openpyxl

يُخرج الجدول التالي:
    scored     طلبات الموافقة + التنبؤ الثنائي (موافقة كاملة / موافقة غير كاملة)
               + احتمال عدم التحصيل + شريحة الخطر + المبلغ المعرّض للخطر
               + أعلى ٣ عوامل SHAP + أعلى ٣ أسباب متوقّعة
               + أعمدة *_Key المطبَّعة لبناء روابط صفحة التنبؤ في DAX
"""
import os
import sys

import pandas as pd

# ══════════════════════════════════════════════════════════════════════
# الإعدادات — عدّل هذين المسارين فقط
# ══════════════════════════════════════════════════════════════════════
REPO_DIR = r"C:\RCM"                                     # مجلّد المستودع
DATA_FILE = r"C:\RCM\data\ALL_GUARANTORS_FINAL.xlsx"     # ملف طلبات الموافقة

# عدد عوامل SHAP وأسباب عدم الموافقة المُخرجة لكل طلب
N_SHAP = 3
N_REASONS = 3

# صفر = تسجيل كل الصفوف. ضع رقماً (مثلاً 20000) لتسريع التطوير.
ROW_LIMIT = 0
# ══════════════════════════════════════════════════════════════════════

MODEL_DIR = os.path.join(REPO_DIR, "model")
sys.path.insert(0, MODEL_DIR)

import rcm_pipeline as P          # noqa: E402
import score_batch as SB          # noqa: E402

SB.ART = os.path.join(MODEL_DIR, "artifacts")

# ── تحميل النموذج والبيانات ──
model, reason_model, reason_labels, vocab, snapshot = SB.load_artifacts()
threshold, recovery = SB.load_bundle_meta()

df = P.load_raw(DATA_FILE)
if ROW_LIMIT:
    df = df.head(ROW_LIMIT)

# ── التسجيل ──
pred = SB.score(df, model, reason_model, reason_labels, vocab, snapshot,
                n_shap=N_SHAP, n_reasons=N_REASONS, recovery=recovery,
                threshold=threshold)

# ── أعمدة مطبَّعة تُستخدم لبناء رابط صفحة التنبؤ في DAX ──
#    (نفس التطبيع الذي يتوقّعه النموذج والصفحة)
keys = pd.DataFrame(index=df.index)
keys["Hospital Key"] = df["Hospital Name"].map(P.norm_text)
keys["Clinic Key"] = df["Clinic Name"].map(P.norm_text)
keys["Contract Key"] = df["Contract Name"].map(P.norm_contract)
keys["Nationality Key"] = df["Nationality"].map(P.norm_text)
keys["Visit Type Key"] = df["Visit Type"].map(P.norm_text)
keys["Nphies Key"] = df["Nphies Eligibility Check"].map(P.norm_nphies)
keys["Patient Class Key"] = df["Patient Classification"].map(P.norm_patient_class)
keys["Triage Num"] = df["Triage Category"].map(P.norm_triage)
keys["Icd Chapter"] = df["Icd 10"].map(P.icd_chapter)
keys["Icd Block"] = df["Icd 10"].map(P.icd_block)

# ── الجدول النهائي ──
drop = [c for c in ["English Name", "Arabic Name", "Id No", "Mrn"] if c in df.columns]
scored = pd.concat([df.drop(columns=drop), keys, pred], axis=1)

# Power BI يلتقط أي DataFrame معرَّف في النطاق العام.
# احذف المتغيّرات الوسيطة حتى لا تظهر كجداول إضافية في نافذة الاختيار.
del keys, pred, df, drop
