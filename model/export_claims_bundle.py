# -*- coding: utf-8 -*-
"""
export_claims_bundle.py — تحويل نموذج المطالبات إلى حزمة JSON يقرأها المتصفح
ARCH Predict · ARCH Systems

الحزمة (window.RCM_CLAIMS_BUNDLE) بنفس شكل حزمة الموافقات — نفس مفاتيح
approval/reason — فيعمل عليها محرّك rcm-engine.js ومستعرض الأشجار كما هما.

عتبات الانقسام وقيم الأوراق تُصدَّر بدقّتها الكاملة دون تقريب: التقريب
يقلب قراراً حدّياً حين تساوي قيمةُ الخاصية العتبةَ المقرَّبة فتفسد قيم SHAP.
"""
from __future__ import annotations

import json
import os
import re
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import claims_pipeline as P
from export_bundle import NATIONALITY_AR, ICD_CHAPTER_AR

R4 = lambda x: round(float(x), 4)


# ──────────────────────────────────────────────────────────────────────
# 1. تحويل الأشجار — دقّة كاملة
# ──────────────────────────────────────────────────────────────────────
def _flatten_tree(node):
    k, f, v, l, r, d, w, mt, sets = [], [], [], [], [], [], [], [], []
    MT = {"None": 0, "Zero": 1, "NaN": 2}

    def add(n):
        i = len(k)
        k.append(0); f.append(-1); v.append(0.0); l.append(-1); r.append(-1)
        d.append(0); w.append(0.0); mt.append(0)
        if "leaf_value" in n:
            k[i], f[i] = 2, -1
            v[i] = float(n["leaf_value"])
            w[i] = float(n.get("leaf_count", n.get("leaf_weight", 1)))
            return i
        w[i] = float(n["internal_count"])
        f[i] = int(n["split_feature"])
        if n["decision_type"] == "==":
            k[i] = 1
            sets.append([int(x) for x in str(n["threshold"]).split("||")])
            v[i] = len(sets) - 1
        else:
            k[i] = 0
            v[i] = float(n["threshold"])
        d[i] = 1 if n.get("default_left") else 0
        mt[i] = MT.get(str(n.get("missing_type", "None")), 0)
        l[i] = add(n["left_child"])
        r[i] = add(n["right_child"])
        return i

    add(node)
    return dict(k=k, f=f, v=v, l=l, r=r, d=d, w=w, m=mt, s=sets)


def _expected_value(t):
    def rec(i):
        if t["k"][i] == 2:
            return t["v"][i]
        li, ri = t["l"][i], t["r"][i]
        tot = t["w"][li] + t["w"][ri]
        return 0.0 if tot <= 0 else (t["w"][li] * rec(li) + t["w"][ri] * rec(ri)) / tot
    return rec(0)


def convert_model(model):
    dump = model.booster_.dump_model()
    n_out = int(dump.get("num_class", 1))
    obj = str(dump.get("objective", ""))
    binary = obj.startswith("binary")
    sig = 1.0
    m = re.search(r"sigmoid:([0-9.eE+-]+)", obj)
    if m:
        sig = float(m.group(1))
    trees, base = [], [0.0] * n_out
    for info in dump["tree_info"]:
        t = _flatten_tree(info["tree_structure"])
        cls = int(info["tree_index"]) % n_out
        t["c"] = cls
        base[cls] += _expected_value(t)
        trees.append(t)
    meta = dict(task="binary" if binary else "multiclass", sigmoid=float(sig), outputs=n_out)
    return trees, [float(b) for b in base], meta


# ──────────────────────────────────────────────────────────────────────
# 2. التسميات العربية
# ──────────────────────────────────────────────────────────────────────
VISIT_AR = {"opd": "عيادات خارجية (Outpatient)", "ip": "تنويم (Inpatient)", "unknown": "غير محدد"}
IDTYPE_AR = {"national_id": "هوية وطنية", "iqama": "إقامة", "passport_other": "جواز / أخرى (حجاج ومعتمرون)",
             "unknown": "غير محدد"}

FEATURE_AR = {
    "amount": "إجمالي المطالبة", "log_amount": "إجمالي المطالبة (لوغاريتمي)",
    "submit_lag": "الأيام بين الزيارة والتقديم", "submit_attempt": "رقم محاولة التقديم",
    "has_approval": "وجود موافقة مسبقة", "visit_dow": "يوم أسبوع الزيارة",
    "visit_month": "شهر الزيارة", "submit_month": "شهر التقديم",
    "visit_type": "نوع الزيارة", "hospital": "المستشفى",
    "insurance": "شركة التأمين (Payer)", "tpa": "مدير المطالبات (TPA)",
    "nationality": "الجنسية", "id_type": "نوع الهوية", "physician": "الطبيب المعالج",
    "icd_chapter": "فصل التشخيص ICD-10", "icd_block": "كتلة التشخيص ICD-10",
    "ins_hist_nfp": "سجل شركة التأمين — نسبة عدم السداد الكامل",
    "ins_hist_ok": "سجل شركة التأمين — نسبة السداد الكامل",
    "ins_vol": "حجم مطالبات شركة التأمين",
    "hosp_hist_nfp": "سجل المستشفى — نسبة عدم السداد الكامل",
    "hosp_hist_ok": "سجل المستشفى — نسبة السداد الكامل",
    "hosp_vol": "حجم مطالبات المستشفى",
    "doc_hist_nfp": "سجل الطبيب — نسبة عدم السداد الكامل",
    "doc_hist_ok": "سجل الطبيب — نسبة السداد الكامل",
    "doc_vol": "حجم مطالبات الطبيب",
}

SHAP_GROUPS = {
    "insurance": dict(label="شركة التأمين (Payer)",
                      cols=["insurance", "ins_hist_nfp", "ins_hist_ok", "ins_vol"]),
    "hospital": dict(label="المستشفى", cols=["hospital", "hosp_hist_nfp", "hosp_hist_ok", "hosp_vol"]),
    "physician": dict(label="الطبيب المعالج", cols=["physician", "doc_hist_nfp", "doc_hist_ok", "doc_vol"]),
    "amount": dict(label="قيمة المطالبة", cols=["amount", "log_amount"]),
    "timing": dict(label="توقيت الزيارة والتقديم",
                   cols=["submit_lag", "visit_dow", "visit_month", "submit_month"]),
    "approval": dict(label="الموافقة المسبقة", cols=["has_approval"]),
    "attempt": dict(label="رقم المحاولة", cols=["submit_attempt"]),
    "icd": dict(label="التشخيص ICD-10", cols=["icd_chapter", "icd_block"]),
    "tpa": dict(label="مدير المطالبات (TPA)", cols=["tpa"]),
    "nationality": dict(label="الجنسية", cols=["nationality"]),
    "id_type": dict(label="نوع الهوية", cols=["id_type"]),
    "visit_type": dict(label="نوع الزيارة", cols=["visit_type"]),
}


def _pretty(col, val):
    if val == "OTHER":
        return "أخرى / غير مدرج"
    if val in ("unknown", "UNK"):
        return "غير محدد"
    if col == "visit_type":
        return VISIT_AR.get(val, val)
    if col == "id_type":
        return IDTYPE_AR.get(val, val)
    if col == "nationality":
        return NATIONALITY_AR.get(val, val.title())
    if col == "icd_chapter":
        return ICD_CHAPTER_AR.get(val, val)
    if col in ("hospital", "insurance", "tpa", "physician"):
        return val.title()
    return val


def build_options(df, X, y, vocab):
    """قوائم الخيارات مع إحصاءات كل خيار الفعلية (n، نسبة عدم السداد)."""
    options = {}
    for col in P.CAT_FEATURES:
        cats = vocab["cats_" + col]
        stats = pd.DataFrame({"c": X[col].values, "y": y}).groupby("c")["y"].agg(["count", "mean"])
        items = []
        for i, v in enumerate(cats):
            n = int(stats.loc[i, "count"]) if i in stats.index else 0
            r = float(stats.loc[i, "mean"]) * 100 if i in stats.index else -1
            items.append(dict(i=i, v=v, l=_pretty(col, v), n=n,
                              r=round(r, 1), a=round(100 - r, 1) if r >= 0 else -1))
        items.sort(key=lambda o: -o["n"])
        options[col] = items
    return options


# ──────────────────────────────────────────────────────────────────────
# 3. التصدير
# ──────────────────────────────────────────────────────────────────────
def export(model, reason_model, reason_labels, vocab, snap, df, X, y,
           metrics, threshold, art_dir):
    trees, base, meta = convert_model(model)
    rtrees, rbase, rmeta = convert_model(reason_model)

    # قيم SHAP العالمية على عيّنة
    import shap
    Xc = P.to_categorical(X, vocab)
    samp = Xc.sample(min(3000, len(Xc)), random_state=42)
    sv = np.asarray(shap.TreeExplainer(model).shap_values(samp), dtype=float)
    if sv.ndim == 3:
        sv = sv[..., 1] if sv.shape[-1] == 2 else sv[1]
    imp = np.abs(sv).mean(axis=0)
    col_imp = dict(zip(P.ALL_FEATURES, imp))
    gs, total = {}, float(imp.sum()) or 1.0
    for key, g in SHAP_GROUPS.items():
        val = sum(col_imp.get(c, 0.0) for c in g["cols"])
        gs[key] = dict(label=g["label"], value=round(val, 5), pct=round(val / total * 100, 2))
    gs = dict(sorted(gs.items(), key=lambda kv: -kv[1]["value"]))
    for k, v in gs.items():
        print(f"  {v['label']:32s} {v['pct']}%", flush=True)

    # نسب التحصيل الفعلية من مبالغ المطالبات نفسها
    ca = pd.to_numeric(df["Claim Amount"], errors="coerce")
    ap = pd.to_numeric(df["Approved Amount"], errors="coerce")
    ok = (ca > 0) & ca.notna() & ap.notna()
    def ratio(mask):
        s = ca[ok & mask].sum()
        return R4(ap[ok & mask].sum() / s) if s > 0 else 0.0
    st = df[P.COL_STATUS].astype(str)
    recovery = {
        "Paid": ratio(st == "approved"),
        "NotFullyPaid": ratio(st.isin(["rejected", "partial"])),
        "_detail": {"approved": ratio(st == "approved"),
                    "partial": ratio(st == "partial"),
                    "rejected": ratio(st == "rejected")},
    }

    defaults = {c: R4(X[c].median()) for c in P.NUM_FEATURES if X[c].notna().any()}

    labels_ar = {c: c + " — " + P.DENIAL_AR.get(c, c) for c in reason_labels}
    actions = {c: P.DENIAL_ACTION.get(c, "") for c in reason_labels}
    cats_ar = {c: P.DENIAL_CAT_AR.get(c.split("-")[0], "") for c in reason_labels}

    prior = [R4((y == i).mean()) for i in (0, 1)]

    bundle = dict(
        schema_version=1,
        generated_at=metrics["generated_at"],
        stage="claims",
        classes=P.CLASSES,
        classes_ar=[P.CLASS_AR[c] for c in P.CLASSES],
        class_icon=["✅", "⚠️"],
        features=P.ALL_FEATURES,
        num_features=P.NUM_FEATURES,
        cat_features=P.CAT_FEATURES,
        entity_features=P.ENTITY_FEATURES,
        feature_ar=FEATURE_AR,
        shap_groups={k: dict(label=g["label"], cols=g["cols"]) for k, g in SHAP_GROUPS.items()},
        global_shap=gs,
        defaults=defaults,
        prior=prior,
        recovery=recovery,
        approval=dict(task=meta["task"], sigmoid=meta["sigmoid"], outputs=meta["outputs"],
                      trees=trees, base=base, threshold=threshold),
        reason=dict(task=rmeta["task"], sigmoid=rmeta["sigmoid"], outputs=rmeta["outputs"],
                    trees=rtrees, base=rbase, labels=reason_labels,
                    labels_ar=labels_ar, actions=actions, cats_ar=cats_ar),
        options=build_options(df, X, y, vocab),
        entity_snapshot=snap,
        entity_cols={"ins": "insurance", "hosp": "hospital", "doc": "physician"},
        metrics=dict(
            dataset=metrics["dataset"],
            deployment=metrics["selected"]["deployment"],
            comparison=metrics.get("comparison", []),
            reason_model=metrics["reason_model"],
        ),
    )

    # ── حماية البيانات الشخصية: ترميز الأطباء بأسماء مستعارة قبل النشر ──
    # كل الملفات المنشورة (bundle/vocab) تخرج برموز doc-### بدل الأسماء،
    # وخريطة «الاسم ← الرمز» تُكتب في model/private/ (مستبعد في .gitignore)
    # لتوزَّع داخلياً فقط. الترميز مستقر: بترتيب حجم المطالبات ثم أبجدياً.
    doc_tbl = snap["doc"]["table"]
    all_doc_names = (set(doc_tbl)
                     | {o["v"] for o in bundle["options"]["physician"] if o["v"] != "OTHER"}
                     | {n for n in vocab.get("cats_physician", []) if n != "OTHER"}
                     | set(vocab.get("rare_physician", [])))
    doc_names = sorted(all_doc_names,
                       key=lambda n: (-(doc_tbl.get(n, [0, 0, -1])[2]), n))
    doc_map = {n: f"doc-{i + 1:03d}" for i, n in enumerate(doc_names)}
    snap["doc"]["table"] = {doc_map[n]: v for n, v in doc_tbl.items()}
    for o in bundle["options"]["physician"]:
        if o["v"] != "OTHER":
            o["l"] = "طبيب " + doc_map[o["v"]][4:]
            o["v"] = doc_map[o["v"]]
    for key in ("cats_physician", "rare_physician"):
        if key in vocab:
            vocab[key] = [n if n == "OTHER" else doc_map.get(n, n) for n in vocab[key]]
    private_dir = os.path.join(os.path.dirname(art_dir), "private")
    os.makedirs(private_dir, exist_ok=True)
    with open(os.path.join(private_dir, "claims_docmap.csv"), "w", encoding="utf-8-sig") as f:
        f.write("code,physician\n")
        for n, c in doc_map.items():
            f.write(f'{c},"{n}"\n')
    print(f"[export] رُمِّز {len(doc_map)} طبيباً — الخريطة الخاصة في model/private/ (لا تُنشر)",
          flush=True)

    js_path = os.path.join(art_dir, "claims_bundle.js")
    json_path = os.path.join(art_dir, "claims_bundle.json")
    payload = json.dumps(bundle, ensure_ascii=False, separators=(",", ":"))
    with open(js_path, "w", encoding="utf-8") as f:
        f.write("/* حزمة نموذج المطالبات — مولَّدة آلياً من train_claims.py */\n")
        f.write("window.RCM_CLAIMS_BUNDLE=" + payload + ";\n")
    with open(json_path, "w", encoding="utf-8") as f:
        f.write(payload)

    model.booster_.save_model(os.path.join(art_dir, "claims_model.txt"))
    reason_model.booster_.save_model(os.path.join(art_dir, "claims_reason_model.txt"))
    with open(os.path.join(art_dir, "claims_metrics.json"), "w", encoding="utf-8") as f:
        json.dump(dict(metrics, global_shap=gs, recovery=recovery),
                  f, ensure_ascii=False, indent=1)
    with open(os.path.join(art_dir, "claims_vocab.json"), "w", encoding="utf-8") as f:
        json.dump(dict(vocab=vocab, snapshot=snap, reason_labels=reason_labels),
                  f, ensure_ascii=False)

    mb = os.path.getsize(js_path) / 1e6
    print(f"[export] claims_bundle.js/.json — {mb:.2f} MB، "
          f"{len(trees)} شجرة سداد + {len(rtrees)} شجرة أسباب", flush=True)
