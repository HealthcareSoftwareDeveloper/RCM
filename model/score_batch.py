# -*- coding: utf-8 -*-
"""
score_batch.py — تسجيل دفعي لملف طلبات موافقة كامل
ARCH Predict · ARCH Systems

يقرأ ملف طلبات موافقة (xlsx/csv) ويُخرج ملفاً مسجَّلاً جاهزاً للاستيراد في Power BI،
يحتوي لكل طلب على: التنبؤ، احتمالات الفئات، شريحة الخطر، الإيراد
المتوقّع، المبلغ المعرّض للخطر، أعلى ٣ عوامل SHAP، وأعلى ٣ أسباب رفض متوقّعة.

    python3 model/score_batch.py --data claims.xlsx --out scored.csv
    python3 model/score_batch.py --data claims.xlsx --out scored.xlsx --shap 5
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rcm_pipeline as P  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(HERE, "artifacts")

RISK_BANDS = [(0.65, "خطر مرتفع"), (0.45, "خطر متوسّط"), (0.0, "خطر منخفض")]

# تجميع الخصائص التقنية تحت مفاهيم تشغيلية (نفس تجميع الصفحة)
GROUPS = {
    "إجمالي الفاتورة": ["total", "log_total"],
    "عقد التأمين (شركة التأمين — Payer)": ["contract", "contract_hist_nfa", "contract_hist_ok", "contract_vol"],
    "المستشفى": ["hospital", "hosp_hist_nfa", "hosp_hist_ok", "hosp_vol"],
    "القسم / العيادة": ["clinic", "clinic_hist_nfa", "clinic_hist_ok", "clinic_vol"],
    "التشخيص ICD-10": ["icd_chapter", "icd_block"],
    "فحص الأهلية — نفيس": ["nphies_elig"],
    "نوع الزيارة": ["visit_type"],
    "درجة الطوارئ CTAS": ["triage"],
    "تصنيف المريض": ["patient_class"],
    "الجنسية": ["nationality"],
    "الجنس": ["gender"],
    "توقيت الزيارة": ["visit_hour", "visit_dow", "visit_month", "is_night", "is_weekend"],
    "سجل المريض السابق": ["prior_claims", "prior_reject_rate"],
}


def load_artifacts():
    """يحمّل النماذج من صيغة LightGBM النصّية والقواميس من JSON (لا pickle)."""
    import lightgbm as lgb

    need = ["approval_model.txt", "reason_model.txt", "vocab.json"]
    missing = [n for n in need if not os.path.exists(os.path.join(ART, n))]
    if missing:
        raise SystemExit(
            "لم يُعثر على ملفات النموذج: " + ", ".join(missing) +
            "\nشغّل أولاً:  python3 model/train_model.py --data <ملف البيانات>")
    model = lgb.Booster(model_file=os.path.join(ART, "approval_model.txt"))
    reason_model = lgb.Booster(model_file=os.path.join(ART, "reason_model.txt"))
    with open(os.path.join(ART, "vocab.json"), encoding="utf-8") as f:
        v = json.load(f)
    return model, reason_model, v["reason_labels"], v["vocab"], v["snapshot"]


def load_bundle_meta():
    """عتبة القرار ونسب التحصيل من حزمة النموذج."""
    mb = os.path.join(ART, "model_bundle.json")
    if not os.path.exists(mb):
        return 0.5, None
    with open(mb, encoding="utf-8") as f:
        b = json.load(f)
    return float(b["approval"].get("threshold", 0.5)), b.get("recovery")


def build_matrix(df, vocab, snap):
    X, _ = P.build_features(df, vocab)
    X = pd.concat([X, P.apply_entity_snapshot(df, snap)], axis=1)[P.ALL_FEATURES]
    return P.to_categorical(X, vocab)


def score(df, model, reason_model, reason_labels, vocab, snap,
          n_shap=3, n_reasons=3, recovery=None, threshold=0.5):
    """يُرجع إطاراً بالأعمدة المسجَّلة، بنفس فهرس df."""
    import shap

    Xc = build_matrix(df, vocab, snap)
    # الهدف ثنائي: Booster.predict يُرجع احتمال الفئة الموجبة كمتجه أحادي
    p_nfa = np.asarray(model.predict(Xc)).ravel()
    pred = (p_nfa >= threshold).astype(int)

    out = pd.DataFrame(index=df.index)
    out["pred_label"] = [P.CLASSES[i] for i in pred]
    out["pred_label_ar"] = [P.CLASS_AR[P.CLASSES[i]] for i in pred]
    out["confidence"] = np.maximum(p_nfa, 1 - p_nfa).round(4)
    out["p_approved"] = (1 - p_nfa).round(4)
    out["p_not_fully_approved"] = p_nfa.round(4)
    out["risk_band"] = [next(lbl for thr, lbl in RISK_BANDS if r >= thr) for r in p_nfa]

    # الأثر المالي المتوقّع
    rec = recovery or {P.CLASSES[0]: 0.93, P.CLASSES[1]: 0.25}
    total = pd.to_numeric(df.get("Total"), errors="coerce").fillna(0).clip(lower=0)
    ratio = (1 - p_nfa) * rec[P.CLASSES[0]] + p_nfa * rec[P.CLASSES[1]]
    out["billed_amount"] = total.round(2)
    out["expected_revenue"] = (total * ratio).round(2)
    out["amount_at_risk"] = (total * (1 - ratio)).round(2)

    # أعلى عوامل SHAP للفئة المتنبَّأ بها
    if n_shap:
        # قيم SHAP على مقياس logit الفئة الموجبة «موافقة غير كاملة»:
        # الموجب يرفع خطر عدم الموافقة الكاملة، والسالب يخفضه.
        sv = np.array(shap.TreeExplainer(model).shap_values(Xc))
        if sv.ndim == 3:
            sv = sv[:, :, 1]
        cols = list(Xc.columns)
        gidx = {g: [cols.index(c) for c in cs if c in cols] for g, cs in GROUPS.items()}
        gnames = list(gidx.keys())
        chosen = np.stack([sv[:, gidx[g]].sum(axis=1) for g in gnames], axis=1)   # (n,grp)
        order = np.argsort(-np.abs(chosen), axis=1)
        for k in range(n_shap):
            j = order[:, k]
            out[f"shap_top{k + 1}"] = [gnames[t] for t in j]
            out[f"shap_top{k + 1}_value"] = chosen[np.arange(len(df)), j].round(4)
            out[f"shap_top{k + 1}_dir"] = np.where(
                chosen[np.arange(len(df)), j] >= 0, "يرفع الخطر", "يخفض الخطر")

    # أسباب الرفض المتوقّعة
    if n_reasons:
        rp = np.asarray(reason_model.predict(Xc))
        ro = np.argsort(-rp, axis=1)
        for k in range(n_reasons):
            j = ro[:, k]
            codes = [reason_labels[t] for t in j]
            out[f"reason_top{k + 1}"] = [P.REASON_AR.get(c, c) for c in codes]
            out[f"reason_top{k + 1}_code"] = codes
            out[f"reason_top{k + 1}_p"] = rp[np.arange(len(df)), j].round(4)
        out["reason_top1_action"] = [P.REASON_ACTION.get(c, "")
                                     for c in out["reason_top1_code"]]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", help="ملف طلبات الموافقة المراد تسجيله (المخطط القانوني)")
    ap.add_argument("--approvals", help="تصدير الموافقات من CareWare — بديل --data")
    ap.add_argument("--eligibility", help="تصدير الأهلية من CareWare (اختياري)")
    ap.add_argument("--out", default="scored_claims.csv", help="ملف الإخراج (csv أو xlsx)")
    ap.add_argument("--shap", type=int, default=3, help="عدد عوامل SHAP المُخرجة (0 لتعطيلها)")
    ap.add_argument("--reasons", type=int, default=3, help="عدد أسباب الرفض المُخرجة")
    ap.add_argument("--keep", default="", help="أعمدة أصلية إضافية تُرحَّل، مفصولة بفاصلة")
    args = ap.parse_args()

    model, rmodel, rlabels, vocab, snap = load_artifacts()
    threshold, recovery = load_bundle_meta()

    df = P.load_any(args.data, args.approvals, args.eligibility)
    print(f"قراءة {len(df):,} طلب موافقة من {args.data or args.approvals}")

    scored = score(df, model, rmodel, rlabels, vocab, snap,
                   args.shap, args.reasons, recovery, threshold)

    keep = [c.strip() for c in args.keep.split(",") if c.strip()]
    lead = ["request_key", "Request No", "Insurance", "Approval Reject Reason"] if args.approvals else ["Mrn", "Episode No"]
    base_cols = [c for c in lead + [ "Visit Date", "Hospital Name",
                             "Clinic Name", "Contract Name", "Visit Type", "Total",
                             P.COL_TARGET] if c in df.columns]   # بصمة المريض (Mrn) لا تُكتب أبداً في وضع CareWare
    for c in keep:
        if c in df.columns and c not in base_cols:
            base_cols.append(c)
    result = pd.concat([df[base_cols], scored], axis=1)

    if args.out.lower().endswith((".xlsx", ".xlsm")):
        result.to_excel(args.out, index=False)
    else:
        result.to_csv(args.out, index=False, encoding="utf-8-sig")
    print(f"✔ كُتب {len(result):,} صفاً إلى {args.out}")

    print("\nتوزيع التنبؤات:")
    for k, v in result["pred_label_ar"].value_counts().items():
        print(f"  {k:16s} {v:7,}  ({100 * v / len(result):.1f}%)")
    print(f"\nإجمالي المبلغ المعرّض للخطر: {result['amount_at_risk'].sum():,.0f} ﷼")

    if P.COL_TARGET in df.columns:
        m = P.decided_mask(df)
        if m.any():
            # المقارنة تتم بعد تحويل الحالة الخام إلى الهدف الثنائي،
            # وإلا قورن "NotFullyApproved" بـ "Rejected" فبدا التطابق منخفضاً زوراً.
            truth = P.to_binary(df.loc[m, P.COL_TARGET]).values
            got = (result.loc[m, "pred_label"] == P.CLASSES[1]).astype(int).values
            acc = float((truth == got).mean())
            print(f"\nالتطابق مع القرارات المسجَّلة في هذا الملف: {acc:.4f}  (n={int(m.sum()):,})")
            print("  ⚠ هذا رقم داخل العيّنة إن كان الملف هو نفسه ملف التدريب — ليس دقّة النموذج.")
            print("  الدقّة المُعتمدة (على بيانات لم يرها النموذج) في model/artifacts/metrics.json")


if __name__ == "__main__":
    main()
