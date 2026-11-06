# -*- coding: utf-8 -*-
"""
train_claims.py — تدريب نموذج التنبؤ بسداد المطالبات وأسباب رفضها
ARCH Predict · ARCH Systems

الاستخدام:
  python3 model/train_claims.py --data path/to/RCM_Claims_Cleaned.xlsx

نفس منهجية نموذج الموافقات حرفياً:
  • تقسيم زمني (تدريب على الأقدم، اختبار على الأحدث) — لا تقسيم عشوائي
  • العتبة تُختار على شريحة تحقّق من نهاية فترة التدريب، لا على الاختبار
  • التقييم النهائي بوضع النشر: جدول اللقطة الذي تستخدمه الصفحة فعلاً
  • استبعاد كل عمود لا يُعرف إلا بعد قرار شركة التأمين
"""
from __future__ import annotations

import argparse
import os
import sys
import time

import numpy as np
import pandas as pd
import lightgbm as lgb
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (accuracy_score, average_precision_score,
                             confusion_matrix, classification_report, f1_score,
                             log_loss, precision_score, recall_score,
                             roc_auc_score)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import claims_pipeline as P

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(HERE, "artifacts")
os.makedirs(ART, exist_ok=True)

FINAL_PARAMS = dict(
    objective="binary", n_estimators=400, learning_rate=0.05,
    num_leaves=31, min_child_samples=30, subsample=0.85, subsample_freq=1,
    colsample_bytree=0.85, reg_lambda=2.0, max_cat_to_onehot=8, cat_smooth=25,
    min_data_per_group=50, n_jobs=-1, random_state=42, verbose=-1,
)
REASON_PARAMS = dict(
    objective="multiclass", n_estimators=50, learning_rate=0.25, num_leaves=16,
    min_child_samples=40, subsample=0.85, subsample_freq=1, colsample_bytree=0.85,
    reg_lambda=3.0, max_cat_to_onehot=8, cat_smooth=25, min_data_per_group=40,
    n_jobs=-1, random_state=42, verbose=-1,
)
VAL_FRACTION = 0.15


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


VOCAB = {}


def as_cat(d):
    return P.to_categorical(d, VOCAB)


# ──────────────────────────────────────────────────────────────────────
def prepare(path):
    log(f"قراءة البيانات: {path}")
    raw = P.load_raw(path)
    log(f"إجمالي المطالبات (أحدث محاولة لكل زيارة): {len(raw):,}")

    df = raw[P.decided_mask(raw)].copy()
    df = df.sort_values("_sd", kind="mergesort").reset_index(drop=True)
    log(f"المطالبات المفصولة (سداد/رفض/جزئي): {len(df):,}")

    X, vocab = P.build_features(df)
    X = pd.concat([X, P.build_entity_history(df)], axis=1)[P.ALL_FEATURES]
    y = P.to_binary(df[P.COL_STATUS]).values
    return raw, df, X, y, vocab


def choose_threshold(model, Xval, yval):
    """مؤشر يودن (استرجاع الفئتين معاً) بدل F1 الماكرو.

    نسبة «عدم السداد الكامل» تنجرف بقوة بين الشهور (76% ← 93% ← 80%)،
    وF1 يتأثر بنسبة الفئات في شريحة التحقّق فينهار اختياره إلى حدّ الشبكة
    حين تقع الشريحة في شهر متطرّف. مؤشر يودن J = استرجاع(سداد كامل) +
    استرجاع(غير كامل) لا يتأثر بنسبة الفئات إطلاقاً، فيبقى الاختيار
    صالحاً مهما اختلف مزيج الفترة القادمة.
    """
    p1 = model.predict_proba(Xval)[:, 1]
    grid = np.arange(0.20, 0.91, 0.01)
    scores = [recall_score(yval, (p1 >= t).astype(int), pos_label=0)
              + recall_score(yval, (p1 >= t).astype(int), pos_label=1)
              for t in grid]
    return round(float(grid[int(np.argmax(scores))]), 2), float(max(scores))


# ──────────────────────────────────────────────────────────────────────
def bakeoff(X, y, cut):
    log("── مفاضلة الخوارزميات (تقسيم زمني 80/20) ──")
    Xtr, Xte, ytr, yte = X.iloc[:cut], X.iloc[cut:], y[:cut], y[cut:]
    Xtrf, Xtef = Xtr.fillna(-999), Xte.fillna(-999)
    Xtrc, Xtec = as_cat(Xtr), as_cat(Xte)
    rows = []
    majority = float(max(np.mean(yte == 0), np.mean(yte == 1)))

    def ev(name, proba, note=""):
        p1 = proba[:, 1]
        pred = (p1 >= 0.5).astype(int)
        acc = float(accuracy_score(yte, pred))
        r = dict(
            model=name, accuracy=round(acc, 4),
            lift_over_majority=round(acc - majority, 4),
            f1_macro=round(float(f1_score(yte, pred, average="macro")), 4),
            roc_auc=round(float(roc_auc_score(yte, p1)), 4),
            pr_auc=round(float(average_precision_score(yte, p1)), 4),
            recall_nfp=round(float(recall_score(yte, pred, pos_label=1)), 4),
            precision_nfp=round(float(precision_score(yte, pred, pos_label=1, zero_division=0)), 4),
            log_loss=round(float(log_loss(yte, p1, labels=[0, 1])), 4),
            note=note,
        )
        rows.append(r)
        log(f"  {name:26s} acc={r['accuracy']:.4f}  رفع={r['lift_over_majority']:+.4f}  "
            f"AUC={r['roc_auc']:.4f}  استرجاع={r['recall_nfp']:.4f}")
        return r

    ev("Baseline (نسبة أساسية)",
       DummyClassifier(strategy="prior").fit(Xtr, ytr).predict_proba(Xte),
       "توقّع الفئة الأكثر شيوعاً")
    mu, sd = Xtrf.mean(), Xtrf.std() + 1e-9
    ev("Logistic Regression",
       LogisticRegression(max_iter=2000).fit((Xtrf - mu) / sd, ytr).predict_proba((Xtef - mu) / sd),
       "نموذج خطي مرجعي")
    ev("Random Forest",
       RandomForestClassifier(n_estimators=500, min_samples_leaf=3, n_jobs=-1,
                              random_state=42).fit(Xtrf, ytr).predict_proba(Xtef),
       "غابة عشوائية")
    best = ev("LightGBM (المُعتمد)",
              lgb.LGBMClassifier(**FINAL_PARAMS).fit(Xtrc, ytr).predict_proba(Xtec),
              "أشجار معزَّزة + دعم أصلي للفئات")

    proba = rows and lgb.LGBMClassifier(**FINAL_PARAMS).fit(Xtrc, ytr).predict_proba(Xtec)
    pred = (proba[:, 1] >= 0.5).astype(int)
    best["confusion_matrix"] = confusion_matrix(yte, pred).tolist()
    best["per_class"] = classification_report(
        yte, pred, target_names=[P.CLASS_AR[c] for c in P.CLASSES],
        output_dict=True, zero_division=0)
    best["majority_baseline"] = round(majority, 4)
    return rows, best


# ──────────────────────────────────────────────────────────────────────
def deployment_eval(df, X, y, cut, threshold, snap):
    """التقييم كما ستعمل الصفحة فعلاً: خصائص اللقطة + العتبة المختارة."""
    log("── التقييم بوضع النشر (جدول لقطة + العتبة المختارة) ──")
    dtr = df.iloc[:cut]
    snap_tr = P.build_entity_snapshot(dtr)
    Xd = X.copy()
    Xs = P.apply_entity_snapshot(df, snap_tr)
    for c in P.ENTITY_FEATURES:
        Xd[c] = Xs[c]
    m = lgb.LGBMClassifier(**FINAL_PARAMS).fit(as_cat(X.iloc[:cut]), y[:cut])
    p1 = m.predict_proba(as_cat(Xd.iloc[cut:]))[:, 1]
    yte = y[cut:]
    pred = (p1 >= threshold).astype(int)
    maj = float(max(np.mean(yte == 0), np.mean(yte == 1)))
    dep = dict(
        accuracy=round(float(accuracy_score(yte, pred)), 4),
        threshold=threshold,
        majority_baseline=round(maj, 4),
        lift_over_majority=round(float(accuracy_score(yte, pred)) - maj, 4),
        f1_macro=round(float(f1_score(yte, pred, average="macro")), 4),
        roc_auc=round(float(roc_auc_score(yte, p1)), 4),
        pr_auc=round(float(average_precision_score(yte, p1)), 4),
        log_loss=round(float(log_loss(yte, p1, labels=[0, 1])), 4),
        recall_nfp=round(float(recall_score(yte, pred, pos_label=1)), 4),
        precision_nfp=round(float(precision_score(yte, pred, pos_label=1, zero_division=0)), 4),
        recall_paid=round(float(recall_score(yte, pred, pos_label=0)), 4),
        balanced_accuracy=round(float((recall_score(yte, pred, pos_label=0)
                                       + recall_score(yte, pred, pos_label=1)) / 2), 4),
        confusion_matrix=confusion_matrix(yte, pred).tolist(),
    )
    log(f"  الدقّة={dep['accuracy']}  أساس={dep['majority_baseline']}  رفع={dep['lift_over_majority']:+}  "
        f"AUC={dep['roc_auc']}  استرجاع «غير كامل»={dep['recall_nfp']}  دقّتها={dep['precision_nfp']}")
    return dep


# ──────────────────────────────────────────────────────────────────────
def train_reason_model(df, vocab, snap):
    """نموذج رمز الرفض NPHIES — يُدرَّب على المرفوضة والمسدَّدة جزئياً فقط،
    وهي بالضبط الفئة الموجبة في نموذج السداد: النموذجان متّسقان تماماً."""
    log("── نموذج رموز الرفض NPHIES ──")
    d = df[P.to_binary(df[P.COL_STATUS]).astype(bool).values].copy()
    d["_code"] = d[P.COL_DENIAL].astype(str).str.strip().str.upper()
    d = d[d["_code"].str.match(r"^[A-Z]{2}-\d+-\d+$", na=False)]

    counts = d["_code"].value_counts()
    keep = counts[counts >= P.MIN_REASON_ROWS].index.tolist()
    d = d[d["_code"].isin(keep)]
    labels = sorted(keep)
    log(f"  صفوف: {len(d):,}   رموز الرفض: {len(labels)}")

    Xr, _ = P.build_features(d, vocab)
    Xr = pd.concat([Xr, P.apply_entity_snapshot(d, snap)], axis=1)[P.ALL_FEATURES]
    yr = d["_code"].map({c: i for i, c in enumerate(labels)}).values

    order = np.argsort(d["_sd"].values)
    Xr, yr = Xr.iloc[order], yr[order]
    cut = int(len(d) * 0.8)

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
    ap.add_argument("--data", required=True)
    ap.add_argument("--skip-bakeoff", action="store_true")
    args = ap.parse_args()

    raw, df, X, y, vocab = prepare(args.data)
    VOCAB.update(vocab)
    n = len(df)
    cut = int(n * 0.8)
    split_date = str(df["_sd"].iloc[cut])[:10]

    comparison, best = ([], {}) if args.skip_bakeoff else bakeoff(X, y, cut)

    log("── اختيار عتبة القرار على شريحة تحقّق داخل فترة التدريب ──")
    vcut = int(cut * (1 - VAL_FRACTION))
    inner = lgb.LGBMClassifier(**FINAL_PARAMS).fit(as_cat(X.iloc[:vcut]), y[:vcut])
    threshold, f1v = choose_threshold(inner, as_cat(X.iloc[vcut:cut]), y[vcut:cut])
    log(f"  العتبة المختارة={threshold:.2f}  (مؤشر يودن على التحقّق={f1v:.4f}، {cut - vcut:,} صفاً)")

    snap_full = P.build_entity_snapshot(df)
    dep = deployment_eval(df, X, y, cut, threshold, snap_full)

    log("── تدريب النموذج النهائي على كامل البيانات ──")
    model = lgb.LGBMClassifier(**FINAL_PARAMS).fit(as_cat(X), y)

    reason_model, reason_labels, reason_metrics = train_reason_model(df, vocab, snap_full)

    metrics = dict(
        generated_at=time.strftime("%Y-%m-%d %H:%M"),
        dataset=dict(
            rows_total=int(len(raw)),
            rows_decided=int(n),
            date_from=str(df["_vd"].min())[:10],
            date_to=str(df["_sd"].max())[:10],
            split_date=split_date,
            class_distribution={P.CLASS_AR[P.CLASSES[i]]: int((y == i).sum()) for i in (0, 1)},
            raw_distribution={k: int(v) for k, v in
                              df[P.COL_STATUS].value_counts().items()},
        ),
        comparison=comparison,
        selected=dict(best, threshold=0.5, deployment=dep) if best else dict(deployment=dep),
        reason_model=reason_metrics,
    )

    import export_claims_bundle
    export_claims_bundle.export(model, reason_model, reason_labels, vocab,
                                snap_full, df, X, y, metrics, threshold, ART)
    log("✔ تم")


if __name__ == "__main__":
    main()
