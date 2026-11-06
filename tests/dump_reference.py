# -*- coding: utf-8 -*-
"""
dump_reference.py — توليد مرجع التحقّق من محرّك المتصفح
ARCH Predict · ARCH Systems

يُخرج عيّنة صفوف مع مخرجات LightGBM ومكتبة shap في بايثون، ليقارنها
tests/verify_engine.js بمخرجات محرّك JavaScript.

    python3 tests/dump_reference.py --data data/ALL_GUARANTORS_FINAL.xlsx
    node tests/verify_engine.js
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import warnings

warnings.filterwarnings("ignore")

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "model"))

import rcm_pipeline as P      # noqa: E402
import score_batch as SB      # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--n", type=int, default=60, help="عدد صفوف العيّنة")
    ap.add_argument("--out", default=os.path.join(HERE, "reference.json"))
    args = ap.parse_args()

    import shap

    model, reason_model, reason_labels, vocab, snap = SB.load_artifacts()

    raw = P.load_raw(args.data)
    df = raw[P.decided_mask(raw)].copy()
    df = df.sample(min(args.n, len(df)), random_state=7)

    Xc = SB.build_matrix(df, vocab, snap)

    def as2d(a):
        """يوحّد شكل المخرجات: الهدف الثنائي يُرجع متجهاً أحادياً، ومتعدّد الفئات مصفوفة."""
        a = np.asarray(a, dtype=float)
        return a.reshape(a.shape[0], -1)

    margin = as2d(model.predict(Xc, raw_score=True))          # (n, outputs)
    p_pos = np.asarray(model.predict(Xc), dtype=float).ravel()
    proba = np.column_stack([1 - p_pos, p_pos]) if margin.shape[1] == 1 \
        else as2d(model.predict(Xc))

    expl = shap.TreeExplainer(model)
    sv = np.asarray(expl.shap_values(Xc), dtype=float)
    if sv.ndim == 2:                       # (n, f) → (1, n, f)
        sv = sv[None, :, :]
    elif sv.shape[0] != margin.shape[1]:   # (n, f, c) → (c, n, f)
        sv = np.transpose(sv, (2, 0, 1))

    ev = np.atleast_1d(np.asarray(expl.expected_value, dtype=float))
    if len(ev) == 2 and margin.shape[1] == 1:
        ev = ev[1:]                        # الفئة الموجبة فقط في الهدف الثنائي

    def clean(v):
        return None if (isinstance(v, float) and np.isnan(v)) else float(v)

    ref = dict(
        task="binary" if margin.shape[1] == 1 else "multiclass",
        features=list(Xc.columns),
        X=[[clean(z) for z in row] for row in Xc.to_numpy(dtype=float)],
        margin=margin.tolist(),
        proba=proba.tolist(),
        shap=sv.tolist(),
        expected=ev.tolist(),
        reason_margin=as2d(reason_model.predict(Xc, raw_score=True)).tolist(),
    )
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(ref, f)
    print(f"✔ كُتب مرجع من {len(df)} صفاً ({ref['task']}) إلى {args.out}")


if __name__ == "__main__":
    main()
