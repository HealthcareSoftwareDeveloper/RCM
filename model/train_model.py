# -*- coding: utf-8 -*-
"""
train_model.py — تدريب واختيار أفضل نموذج للتنبؤ بنتيجة الموافقة التأمينية
ARCH Predict · ARCH Systems

المخرجات (في model/artifacts/):
  model_bundle.json   حزمة النموذج المضغوطة (أشجار + قواميس + جداول اللقطة) للمتصفح
  metrics.json        نتائج مقارنة كل الخوارزميات + مقاييس النموذج النهائي
  model_card.md       بطاقة النموذج (توثيق)
  approval_model.txt  نموذج الموافقة بصيغة LightGBM النصّية (للتسجيل الدفعي)
  reason_model.txt    نموذج أسباب الرفض
  vocab.json          قواميس الترميز + جداول اللقطة + أصناف الأسباب

صيغة LightGBM النصّية و JSON مقصودتان بدل pickle: فهما مستقرّتان عبر إصدارات
المكتبات وقابلتان للقراءة والمراجعة.

التشغيل:
  python3 model/train_model.py --data path/to/ALL_GUARANTORS_FINAL.xlsx
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import warnings

warnings.filterwarnings("ignore")

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rcm_pipeline as P  # noqa: E402

from sklearn.dummy import DummyClassifier  # noqa: E402
from sklearn.ensemble import (  # noqa: E402
    ExtraTreesClassifier, HistGradientBoostingClassifier, RandomForestClassifier,
)
from sklearn.linear_model import LogisticRegression  # noqa: E402
from sklearn.metrics import (  # noqa: E402
    accuracy_score, average_precision_score, classification_report,
    confusion_matrix, f1_score, log_loss, precision_score, recall_score,
    roc_auc_score,
)

import lightgbm as lgb  # noqa: E402
import xgboost as xgb  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(HERE, "artifacts")
os.makedirs(ART, exist_ok=True)

# معاملات النموذج النهائي — مختارة من مفاضلة الحجم/الدقة في السجل أدناه
FINAL_PARAMS = dict(
    objective="binary", n_estimators=400, learning_rate=0.05,
    num_leaves=31, min_child_samples=30, subsample=0.85, subsample_freq=1,
    colsample_bytree=0.85, reg_lambda=2.0, max_cat_to_onehot=8, cat_smooth=25,
    min_data_per_group=50, n_jobs=-1, random_state=42, verbose=-1,
)

# نسبة بيانات التدريب المحجوزة لاختيار عتبة القرار.
# العتبة تُختار على هذه الشريحة وحدها — لا على بيانات الاختبار — وإلا صار
# الرقم المُعلن متفائلاً لأنه ضُبط على ما يُقاس به.
VAL_FRACTION = 0.15
REASON_PARAMS = dict(
    objective="multiclass", n_estimators=50, learning_rate=0.25, num_leaves=16,
    min_child_samples=40, subsample=0.85, subsample_freq=1, colsample_bytree=0.85,
    reg_lambda=3.0, max_cat_to_onehot=8, cat_smooth=25, min_data_per_group=40,
    n_jobs=-1, random_state=42, verbose=-1,
)

# تجميع الخصائص التقنية تحت مفاهيم تشغيلية يفهمها فريق تنمية الإيرادات
SHAP_GROUPS = {
    "total":         ("إجمالي الفاتورة",            ["total", "log_total"]),
    "contract":      ("عقد التأمين (شركة التأمين — Payer)", ["contract", "contract_hist_nfa", "contract_hist_ok", "contract_vol"]),
    "hospital":      ("المستشفى",                   ["hospital", "hosp_hist_nfa", "hosp_hist_ok", "hosp_vol"]),
    "clinic":        ("القسم / العيادة",            ["clinic", "clinic_hist_nfa", "clinic_hist_ok", "clinic_vol"]),
    "icd":           ("التشخيص ICD-10",             ["icd_chapter", "icd_block"]),
    "nphies_elig":   ("فحص الأهلية — نفيس",         ["nphies_elig"]),
    "visit_type":    ("نوع الزيارة",                ["visit_type"]),
    "triage":        ("درجة الطوارئ CTAS",          ["triage"]),
    "patient_class": ("تصنيف المريض",               ["patient_class"]),
    "nationality":   ("الجنسية",                    ["nationality"]),
    "gender":        ("الجنس",                      ["gender"]),
    "visit_time":    ("توقيت الزيارة",              ["visit_hour", "visit_dow", "visit_month", "is_night", "is_weekend"]),
    "history":       ("سجل المريض السابق",          ["prior_claims", "prior_reject_rate"]),
}


def pick_threshold(model, Xval, yval):
    """
    يختار عتبة القرار التي تُعظّم F1 الماكرو على شريحة تحقّق مقتطعة من
    نهاية فترة التدريب. عتبة 0.5 ليست مثلى هنا لأن توزيع الفئتين متقارب
    وتكلفة تفويت حالة خاسرة أعلى من تكلفة إنذار زائد.
    """
    p1 = model.predict_proba(Xval)[:, 1]
    grid = np.arange(0.30, 0.71, 0.01)
    scores = [f1_score(yval, (p1 >= t).astype(int), average="macro") for t in grid]
    return float(grid[int(np.argmax(scores))]), float(max(scores))


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ──────────────────────────────────────────────────────────────────────
def prepare(path, approvals=None, eligibility=None):
    log(f"قراءة البيانات: {approvals or path}" + (f" + الأهلية: {eligibility}" if eligibility else ""))
    raw = P.load_any(path, approvals, eligibility)
    if DROP_AMOUNT[0]:
        log("تجاهل مبلغ الفاتورة (--drop-amount)")
        raw["Total"] = np.nan
    log(f"إجمالي الصفوف: {len(raw):,}")

    df = raw[P.decided_mask(raw)].copy()
    df["_vd"] = pd.to_datetime(df["Visit Date"], errors="coerce")
    df = df.sort_values("_vd", kind="mergesort").reset_index(drop=True)
    log(f"طلبات الموافقة ذات القرار النهائي: {len(df):,}")

    X, vocab = P.build_features(df)
    X = pd.concat([X, P.build_entity_history(df)], axis=1)[P.ALL_FEATURES]
    y = P.to_binary(df[P.COL_TARGET]).values
    return raw, df, X, y, vocab


VOCAB = {}
DROP_AMOUNT = [False]


def as_cat(d):
    """dtype فئوي بمدى ثابت — انظر rcm_pipeline.to_categorical."""
    return P.to_categorical(d, VOCAB)


# ──────────────────────────────────────────────────────────────────────
def bakeoff(X, y, cut):  # noqa: C901
    """مقارنة الخوارزميات على تقسيم زمني (تدريب على الماضي، اختبار على المستقبل)."""
    log("── مفاضلة الخوارزميات (تقسيم زمني 80/20) ──")
    Xtr, Xte, ytr, yte = X.iloc[:cut], X.iloc[cut:], y[:cut], y[cut:]
    Xtrf, Xtef = Xtr.fillna(-999), Xte.fillna(-999)
    Xtrc, Xtec = as_cat(Xtr), as_cat(Xte)
    cat_idx = [X.columns.get_loc(c) for c in P.CAT_FEATURES]
    rows = []

    # نسبة فئة الأغلبية — سقف «التخمين الغبي». الفارق بينها وبين الدقة هو
    # الرفع الحقيقي، وهو المقياس الوحيد القابل للمقارنة عبر صياغات مختلفة للهدف.
    majority = float(max(np.mean(yte == 0), np.mean(yte == 1)))

    def ev(name, proba, note=""):
        p1 = proba[:, 1]
        pred = (p1 >= 0.5).astype(int)
        acc = float(accuracy_score(yte, pred))
        r = dict(
            model=name,
            accuracy=round(acc, 4),
            lift_over_majority=round(acc - majority, 4),
            f1_macro=round(float(f1_score(yte, pred, average="macro")), 4),
            f1_weighted=round(float(f1_score(yte, pred, average="weighted")), 4),
            roc_auc=round(float(roc_auc_score(yte, p1)), 4),
            pr_auc=round(float(average_precision_score(yte, p1)), 4),
            recall_nfa=round(float(recall_score(yte, pred, pos_label=1)), 4),
            precision_nfa=round(float(precision_score(yte, pred, pos_label=1, zero_division=0)), 4),
            log_loss=round(float(log_loss(yte, p1, labels=[0, 1])), 4),
            note=note,
        )
        rows.append(r)
        log(f"  {name:26s} acc={r['accuracy']:.4f}  رفع={r['lift_over_majority']:+.4f}  "
            f"f1M={r['f1_macro']:.4f}  AUC={r['roc_auc']:.4f}  استرجاع={r['recall_nfa']:.4f}")
        return r

    ev("Baseline (نسبة أساسية)", DummyClassifier(strategy="prior").fit(Xtr, ytr).predict_proba(Xte),
       "توقّع الفئة الأكثر شيوعاً")

    mu, sd = Xtrf.mean(), Xtrf.std() + 1e-9
    ev("Logistic Regression",
       LogisticRegression(max_iter=2000).fit((Xtrf - mu) / sd, ytr).predict_proba((Xtef - mu) / sd),
       "نموذج خطي مرجعي")
    ev("Random Forest",
       RandomForestClassifier(n_estimators=500, min_samples_leaf=3, n_jobs=-1,
                              random_state=42).fit(Xtrf, ytr).predict_proba(Xtef),
       "النموذج المستخدم سابقاً")
    ev("Extra Trees",
       ExtraTreesClassifier(n_estimators=500, min_samples_leaf=3, n_jobs=-1,
                            random_state=42).fit(Xtrf, ytr).predict_proba(Xtef))
    # عمود فارغ كلياً (مثل درجة الطوارئ حين لا يحملها مصدر البيانات) يُسقط من هذه
    # الخوارزمية وحدها — sklearn يرفض تقسيم عمود بلا أي قيمة.
    hcols = [c for c in X.columns if Xtr[c].notna().any()]
    hcat = [c in P.CAT_FEATURES for c in hcols]
    ev("HistGradientBoosting",
       HistGradientBoostingClassifier(max_iter=500, learning_rate=0.05, max_leaf_nodes=31,
                                      l2_regularization=2.0, min_samples_leaf=40,
                                      categorical_features=hcat, random_state=42,
                                      early_stopping=False).fit(Xtr[hcols], ytr).predict_proba(Xte[hcols]))
    ev("XGBoost",
       xgb.XGBClassifier(n_estimators=800, learning_rate=0.04, max_depth=6, subsample=0.85,
                         colsample_bytree=0.8, reg_lambda=3.0, min_child_weight=10,
                         objective="binary:logistic", tree_method="hist",
                         n_jobs=-1, random_state=42).fit(Xtrf, ytr).predict_proba(Xtef))

    final = lgb.LGBMClassifier(**FINAL_PARAMS).fit(Xtrc, ytr)
    best = ev("LightGBM (المُعتمد)", final.predict_proba(Xtec), "أشجار معزَّزة + دعم أصلي للفئات")
    best["_model"] = final

    # مقاييس تفصيلية للنموذج المعتمد
    proba = final.predict_proba(Xtec)
    pred = (proba[:, 1] >= 0.5).astype(int)
    best["confusion_matrix"] = confusion_matrix(yte, pred).tolist()
    best["per_class"] = classification_report(
        yte, pred, target_names=[P.CLASS_AR[c] for c in P.CLASSES],
        output_dict=True, zero_division=0)
    best["majority_baseline"] = round(majority, 4)
    return rows, best


# ──────────────────────────────────────────────────────────────────────
def train_reason_model(raw, vocab, snap):
    """
    نموذج التنبؤ بسبب عدم القبول الكامل.
    يُدرَّب على الطلبات المرفوضة والمقبولة جزئياً — وهي بالضبط الفئة
    الموجبة في نموذج الموافقة، فيصبح النموذجان متّسقين تماماً.
    """
    log("── نموذج أسباب عدم القبول الكامل ──")
    st = raw[P.COL_TARGET].astype(str).str.strip()
    d = raw[st.isin(["Rejected", "Partially Approved"])].copy()
    d["_code"] = d[P.COL_REASON].map(P.classify_reason)
    d = d[~d["_code"].isin(["NONE"])]

    counts = d["_code"].value_counts()
    keep = counts[counts >= 150].index.tolist()
    d = d[d["_code"].isin(keep)]
    labels = sorted(keep)
    log(f"  صفوف: {len(d):,}   أصناف الأسباب: {len(labels)}")

    Xr, _ = P.build_features(d, vocab)
    Xr = pd.concat([Xr, P.apply_entity_snapshot(d, snap)], axis=1)[P.ALL_FEATURES]
    yr = d["_code"].map({c: i for i, c in enumerate(labels)}).values

    n = len(d)
    cut = int(n * 0.8)
    order = np.argsort(pd.to_datetime(d["Visit Date"], errors="coerce").values)
    Xr, yr = Xr.iloc[order], yr[order]

    params = dict(REASON_PARAMS, num_class=len(labels))
    m = lgb.LGBMClassifier(**params).fit(as_cat(Xr.iloc[:cut]), yr[:cut])
    pr = m.predict_proba(as_cat(Xr.iloc[cut:]))
    yt = yr[cut:]
    top1 = float(accuracy_score(yt, pr.argmax(1)))
    top3 = float(np.mean([t in np.argsort(-p)[:3] for t, p in zip(yt, pr)]))
    base = float(pd.Series(yt).value_counts(normalize=True).iloc[0])
    log(f"  Top-1={top1:.4f}  Top-3={top3:.4f}  (الأساس={base:.4f})")

    final = lgb.LGBMClassifier(**params).fit(as_cat(Xr), yr)
    metrics = dict(top1_accuracy=round(top1, 4), top3_accuracy=round(top3, 4),
                   baseline=round(base, 4), n_rows=int(len(d)), n_classes=len(labels),
                   class_distribution={k: int(v) for k, v in counts[keep].items()})
    return final, labels, metrics


# ──────────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", help="ملف البيانات بالمخطط القانوني (xlsx/csv)")
    ap.add_argument("--approvals", help="تصدير الموافقات من CareWare (سطر لكل خدمة) — بديل --data")
    ap.add_argument("--eligibility", help="تصدير الأهلية من CareWare (يُربط بـ Encounter Number)")
    ap.add_argument("--out-dir", help="مجلد مخرجات بديل (للتجربة دون استبدال النموذج المنشور)")
    ap.add_argument("--skip-bakeoff", action="store_true")
    ap.add_argument("--drop-amount", action="store_true",
                    help="تجاهل مبلغ الفاتورة (حين يُملأ بعد القرار في المصدر — خطر تسريب)")
    args = ap.parse_args()
    if args.out_dir:
        global ART
        ART = os.path.abspath(args.out_dir)
        os.makedirs(ART, exist_ok=True)

    DROP_AMOUNT[0] = bool(args.drop_amount)
    raw, df, X, y, vocab = prepare(args.data, args.approvals, args.eligibility)
    VOCAB.update(vocab)
    cut = int(len(df) * 0.80)
    split_date = str(df["_vd"].iloc[cut])[:10]

    rows, best = ([], {}) if args.skip_bakeoff else bakeoff(X, y, cut)

    # ── تقييم بوضع النشر الحقيقي ──
    # أثناء التدريب تُحسب معدّلات الجهات بنافذة متوسّعة، لكن الصفحة وقت التنبؤ
    # تقرأها من جدول لقطة ثابت. هذا الاختبار يقيس الأداء بالطريقة التي ستعمل بها
    # فعلاً: نموذج مُدرَّب على النافذة المتوسّعة، ومُقيَّم بلقطة مبنيّة من فترة
    # التدريب وحدها. هذا هو الرقم المُعتمد والمعروض في الصفحة.
    if not args.skip_bakeoff:
        log("── اختيار عتبة القرار على شريحة تحقّق داخل فترة التدريب ──")
        vcut = int(cut * (1 - VAL_FRACTION))
        inner = lgb.LGBMClassifier(**FINAL_PARAMS).fit(as_cat(X.iloc[:vcut]), y[:vcut])
        thr, vf1 = pick_threshold(inner, as_cat(X.iloc[vcut:cut]), y[vcut:cut])
        log(f"  العتبة المختارة={thr:.2f}  (F1 ماكرو على التحقّق={vf1:.4f}، "
            f"{cut - vcut:,} صفاً)")
        best["threshold"] = round(thr, 3)

        log("── التقييم بوضع النشر (جدول لقطة + العتبة المختارة) ──")
        snap_tr = P.build_entity_snapshot(df.iloc[:cut])
        Xs = pd.concat([X[P.FEATURES], P.apply_entity_snapshot(df, snap_tr)], axis=1)[P.ALL_FEATURES]
        ps = best["_model"].predict_proba(as_cat(Xs.iloc[cut:]))[:, 1]
        yte = y[cut:]
        pred_s = (ps >= thr).astype(int)
        acc_s = float(accuracy_score(yte, pred_s))
        maj = float(max(np.mean(yte == 0), np.mean(yte == 1)))
        best["deployment"] = dict(
            accuracy=round(acc_s, 4),
            threshold=round(thr, 3),
            majority_baseline=round(maj, 4),
            lift_over_majority=round(acc_s - maj, 4),
            f1_macro=round(float(f1_score(yte, pred_s, average="macro")), 4),
            roc_auc=round(float(roc_auc_score(yte, ps)), 4),
            pr_auc=round(float(average_precision_score(yte, ps)), 4),
            log_loss=round(float(log_loss(yte, ps, labels=[0, 1])), 4),
            recall_nfa=round(float(recall_score(yte, pred_s, pos_label=1)), 4),
            precision_nfa=round(float(precision_score(yte, pred_s, pos_label=1, zero_division=0)), 4),
            recall_approved=round(float(recall_score(yte, pred_s, pos_label=0)), 4),
            confusion_matrix=confusion_matrix(yte, pred_s).tolist(),
        )
        d = best["deployment"]
        log(f"  الدقّة={d['accuracy']:.4f}  أساس={d['majority_baseline']:.4f}  "
            f"رفع={d['lift_over_majority']:+.4f}  AUC={d['roc_auc']:.4f}  "
            f"استرجاع «لم تُقبل»={d['recall_nfa']:.4f}  دقّتها={d['precision_nfa']:.4f}")
        best.pop("_model", None)

    # ── النموذج النهائي: يُعاد تدريبه على كامل البيانات ذات القرار ──
    log("── تدريب النموذج النهائي على كامل البيانات ──")
    model = lgb.LGBMClassifier(**FINAL_PARAMS).fit(as_cat(X), y)

    snap = P.build_entity_snapshot(raw)
    reason_model, reason_labels, reason_metrics = train_reason_model(raw, vocab, snap)

    # ── أهمية الخصائص عالمياً (SHAP) ──
    log("── حساب قيم SHAP العالمية ──")
    import shap
    expl = shap.TreeExplainer(model)
    sample = as_cat(X.sample(min(4000, len(X)), random_state=42))
    sv = np.array(expl.shap_values(sample))
    if sv.ndim == 3:                                       # (n, f, 2) → الفئة الموجبة
        sv = sv[:, :, 1]
    mean_abs = np.abs(sv).mean(axis=0)                    # (features,)
    glob = {}
    for gk, (gar, cols) in SHAP_GROUPS.items():
        idx = [X.columns.get_loc(c) for c in cols if c in X.columns]
        glob[gk] = dict(label=gar, value=round(float(mean_abs[idx].sum()), 5))
    tot = sum(v["value"] for v in glob.values()) or 1.0
    for v in glob.values():
        v["pct"] = round(100 * v["value"] / tot, 2)
    glob = dict(sorted(glob.items(), key=lambda kv: -kv[1]["value"]))
    for k, v in glob.items():
        log(f"  {v['label']:28s} {v['pct']:5.2f}%")

    # ── حفظ ──
    model.booster_.save_model(os.path.join(ART, "approval_model.txt"))
    reason_model.booster_.save_model(os.path.join(ART, "reason_model.txt"))
    with open(os.path.join(ART, "vocab.json"), "w", encoding="utf-8") as f:
        json.dump({"vocab": vocab, "snapshot": snap, "reason_labels": reason_labels},
                  f, ensure_ascii=False)

    metrics = dict(
        generated_at=time.strftime("%Y-%m-%d %H:%M"),
        dataset=dict(rows_total=int(len(raw)), rows_decided=int(len(df)),
                     date_from=str(df["_vd"].min())[:10], date_to=str(df["_vd"].max())[:10],
                     split_date=split_date,
                     class_distribution={P.CLASS_AR[c]: int((y == i).sum())
                                         for i, c in enumerate(P.CLASSES)},
                     raw_distribution={k: int(v) for k, v in
                                       df[P.COL_TARGET].astype(str).str.strip()
                                       .value_counts().items()}),
        comparison=rows, selected=best, reason_model=reason_metrics,
        global_shap=glob, features=P.ALL_FEATURES,
    )
    with open(os.path.join(ART, "metrics.json"), "w", encoding="utf-8") as f:
        json.dump(metrics, f, ensure_ascii=False, indent=2)
    log(f"✔ metrics.json")

    # ── تصدير حزمة المتصفح ──
    import export_bundle
    export_bundle.export(model, reason_model, reason_labels, vocab, snap, raw,
                         metrics, glob, SHAP_GROUPS, ART)
    log("✔ تم")


if __name__ == "__main__":
    main()
