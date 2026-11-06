# -*- coding: utf-8 -*-
"""
dump_claims_reference.py — توليد مرجع التحقّق لمحرّك المتصفح (نموذج المطالبات)
ARCH Predict · ARCH Systems

    python3 tests/dump_claims_reference.py --data RCM_Claims_Cleaned.xlsx
    node tests/verify_engine.js claims
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
import lightgbm as lgb

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "model"))

import claims_pipeline as P   # noqa: E402

ART = os.path.join(HERE, "..", "model", "artifacts")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--n", type=int, default=60)
    ap.add_argument("--out", default=os.path.join(HERE, "claims_reference.json"))
    args = ap.parse_args()

    import shap

    model = lgb.Booster(model_file=os.path.join(ART, "claims_model.txt"))
    reason = lgb.Booster(model_file=os.path.join(ART, "claims_reason_model.txt"))
    va = json.load(open(os.path.join(ART, "claims_vocab.json"), encoding="utf-8"))
    vocab, snap = va["vocab"], va["snapshot"]

    raw = P.load_raw(args.data)
    df = raw[P.decided_mask(raw)].copy()
    df = df.sample(min(args.n, len(df)), random_state=7)

    X, _ = P.build_features(df, vocab)
    X = pd.concat([X, P.apply_entity_snapshot(df, snap)], axis=1)[P.ALL_FEATURES]
    Xc = P.to_categorical(X, vocab)

    def as2d(a):
        a = np.asarray(a, dtype=float)
        return a.reshape(a.shape[0], -1)

    margin = as2d(model.predict(Xc, raw_score=True))
    p_pos = np.asarray(model.predict(Xc), dtype=float).ravel()
    proba = np.column_stack([1 - p_pos, p_pos])

    expl = shap.TreeExplainer(model)
    sv = np.asarray(expl.shap_values(Xc), dtype=float)
    if sv.ndim == 2:
        sv = sv[None, :, :]
    elif sv.shape[0] != margin.shape[1]:
        sv = np.transpose(sv, (2, 0, 1))
    ev = np.atleast_1d(np.asarray(expl.expected_value, dtype=float))
    if len(ev) == 2 and margin.shape[1] == 1:
        ev = ev[1:]

    def clean(v):
        return None if (isinstance(v, float) and np.isnan(v)) else float(v)

    ref = dict(
        task="binary",
        features=list(Xc.columns),
        X=[[clean(z) for z in row] for row in Xc.to_numpy(dtype=float)],
        margin=margin.tolist(),
        proba=proba.tolist(),
        shap=sv.tolist(),
        expected=ev.tolist(),
        reason_margin=as2d(reason.predict(Xc, raw_score=True)).tolist(),
    )
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(ref, f)
    print(f"✔ كُتب مرجع المطالبات من {len(df)} صفاً إلى {args.out}")


if __name__ == "__main__":
    main()
