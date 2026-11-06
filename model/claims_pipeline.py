# -*- coding: utf-8 -*-
"""
claims_pipeline.py — تنظيف بيانات المطالبات وهندسة خصائصها وتسميات أسباب الرفض
ARCH Predict · ARCH Systems

مرحلة المطالبات (Claims) اللاحقة لتقديم الخدمة — تكملة لمنصّة الموافقات:
الهدف الثنائي «سداد كامل» مقابل «سداد غير كامل» (المرفوضة والمسدَّدة جزئياً)،
ونموذج ثانٍ يتنبّأ برمز الرفض NPHIES المرجَّح.
"""
from __future__ import annotations

import re

import numpy as np
import pandas as pd

# ──────────────────────────────────────────────────────────────────────
# الأعمدة والهدف
# ──────────────────────────────────────────────────────────────────────
SHEET = "Claims_Current"
COL_STATUS = "Claim Status"          # approved / partial / rejected (بعد الفصل)
COL_DENIAL = "Denial Code"

CLASSES = ["Paid", "NotFullyPaid"]
CLASS_AR = {"Paid": "سداد كامل", "NotFullyPaid": "سداد غير كامل"}

# أعمدة لا تُعرف إلا بعد قرار شركة التأمين — تُستبعد كلياً من الخصائص
LEAKY = [
    "Request Status", "Claim Status", "RCM Status", "Reason", "Denial Code",
    "Denial Category", "Denial Category (AR)", "Denial Meaning (AR)",
    "Denial Description", "Claim Comment (Disposition)", "Response Time",
    "Approved Amount", "Rejected Amount", "Variance (Claim-Approved-Rejected)",
    "Total Attempts",   # يتضمّن محاولات لاحقة لقرار هذه المحاولة
]

# ──────────────────────────────────────────────────────────────────────
# أدوات تطبيع
# ──────────────────────────────────────────────────────────────────────
_WS = re.compile(r"\s+")


def norm_text(x) -> str:
    if pd.isna(x):
        return "unknown"
    s = _WS.sub(" ", str(x)).strip().lower()
    return s if s else "unknown"


def _top_n_map(series: pd.Series, n: int, other: str = "OTHER") -> dict:
    top = series.value_counts().head(n).index
    return {v: v for v in top}


def norm_visit_type(x) -> str:
    s = norm_text(x)
    if "in" in s and "patient" in s:
        return "ip"
    if "out" in s and "patient" in s:
        return "opd"
    return s


def norm_id_type(x) -> str:
    s = norm_text(x)
    if "national" in s:
        return "national_id"
    if "iqama" in s:
        return "iqama"
    if "passport" in s or "other" in s:
        return "passport_other"
    return "unknown"


def icd_chapter(x) -> str:
    s = str(x).strip().upper() if pd.notna(x) else ""
    m = re.match(r"^([A-Z])", s)
    return m.group(1) if m else "UNK"


def icd_block(x) -> str:
    s = str(x).strip().upper() if pd.notna(x) else ""
    m = re.match(r"^([A-Z][0-9]{2})", s)
    return m.group(1) if m else "UNK"


# ──────────────────────────────────────────────────────────────────────
# رموز الرفض NPHIES: المعنى العربي والإجراء التصحيحي
# (المعاني الرسمية من ملف التدريب حيث وردت، والباقي ترجمة لوصف NPHIES)
# ──────────────────────────────────────────────────────────────────────
DENIAL_AR = {
    "CV-1-1": "مقدّم الخدمة خارج شبكة المستفيد",
    "BE-1-3": "التقديم غير متوافق مع الاتفاقية التعاقدية مع شركة التأمين",
    "AD-2-5": "انتهاء المهلة النظامية لتقديم المطالبة",
    "BE-1-4": "الإذن المسبق مطلوب ولم يتم الحصول عليه",
    "SE-1-6": "نتيجة الفحوصات ناقصة أو غير كافية",
    "BE-1-1": "الخصم (Co-pay) لم يتم تحصيله من المستفيد",
    "CV-1-4": "الخدمة أو الإجراء غير مغطى",
    "MN-1-1": "الخدمة غير مبرّرة سريرياً وفق الأدلة العلاجية",
    "CV-4-5": "الدواء غير مدرج في قائمة الأدوية المعتمدة",
    "BE-1-6": "فرق حسابي في مبالغ المطالبة",
    "CV-1-5": "لا تنطبق معايير الطوارئ على الخدمة",
    "BE-1-5": "معلومات المطالبة غير متوافقة مع الإذن المسبق",
}

DENIAL_ACTION = {
    "CV-1-1": "تحقّق قبل تقديم الخدمة من شمول المنشأة والطبيب في شبكة عقد التأمين، أو حوّل المستفيد لمقدّم داخل الشبكة.",
    "BE-1-3": "طابق المطالبة على بنود العقد — الأسعار المتعاقد عليها ورموز الخدمات ومتطلبات التقديم — قبل الإرسال.",
    "AD-2-5": "قدّم المطالبة ضمن المهلة التعاقدية، وراقب أعمار الزيارات غير المفوترة حتى لا تتقادم.",
    "BE-1-4": "احصل على الموافقة المسبقة قبل تقديم الخدمة — صفحة تنبؤ الموافقات في ARCH Predict تساعد على تجهيز الطلب.",
    "SE-1-6": "أرفق نتائج التحاليل والأشعة والفحوصات الداعمة للتشخيص قبل تقديم المطالبة.",
    "BE-1-1": "حصّل نسبة التحمّل من المستفيد عند تقديم الخدمة ووثّق التحصيل في المطالبة.",
    "CV-1-4": "راجع جدول المنافع في الوثيقة قبل تقديم الخدمة، وأبلغ المستفيد بما هو خارج التغطية.",
    "MN-1-1": "أرفق مبرّراً طبياً مفصّلاً يربط الخدمة بحالة المريض ودلائل الممارسة السريرية.",
    "CV-4-5": "صِف بديلاً من قائمة الأدوية المعتمدة، أو اطلب استثناءً موثّقاً قبل الصرف.",
    "BE-1-6": "راجع احتساب المبالغ والخصومات ومطابقتها لقائمة الأسعار قبل الإرسال.",
    "CV-1-5": "وثّق مؤشّرات الحالة الطارئة (العلامات الحيوية وتصنيف الفرز) لإثبات صفة الطوارئ.",
    "BE-1-5": "طابق خدمات المطالبة ومبالغها ورموزها مع ما صدر في الموافقة المسبقة حرفياً.",
}

DENIAL_CAT_AR = {
    "CV": "التغطية التأمينية",
    "BE": "إجراءات إدارية ومالية",
    "AD": "التشخيص والإجراءات",
    "SE": "التوثيق والسجلات",
    "MN": "الضرورة الطبية",
}

MIN_REASON_ROWS = 150

# ──────────────────────────────────────────────────────────────────────
# التحميل
# ──────────────────────────────────────────────────────────────────────
def load_raw(path: str) -> pd.DataFrame:
    df = pd.read_excel(path, sheet_name=SHEET)
    df["_vd"] = pd.to_datetime(df["Visit Date"], errors="coerce")
    df["_sd"] = pd.to_datetime(df["Submission Date Time"], errors="coerce")
    return df


def decided_mask(df: pd.DataFrame) -> pd.Series:
    return df[COL_STATUS].isin(["approved", "partial", "rejected"])


def to_binary(status) -> pd.Series:
    """approved → 0 (سداد كامل)  |  partial / rejected → 1 (سداد غير كامل)"""
    return (pd.Series(status).astype(str).str.strip() != "approved").astype(int)


# ──────────────────────────────────────────────────────────────────────
# هندسة الخصائص
# ──────────────────────────────────────────────────────────────────────
NUM_FEATURES = [
    "amount", "log_amount", "submit_lag", "submit_attempt", "has_approval",
    "visit_dow", "visit_month", "submit_month",
]
CAT_FEATURES = [
    "visit_type", "hospital", "insurance", "tpa", "nationality",
    "id_type", "physician", "icd_chapter", "icd_block",
]
ENTITY_FEATURES = [
    "ins_hist_nfp", "ins_hist_ok", "ins_vol",
    "hosp_hist_nfp", "hosp_hist_ok", "hosp_vol",
    "doc_hist_nfp", "doc_hist_ok", "doc_vol",
]
ALL_FEATURES = NUM_FEATURES + CAT_FEATURES + ENTITY_FEATURES

TOP_N = {"insurance": 30, "tpa": 15, "nationality": 40, "physician": 120, "icd_block": 120}


def build_features(df: pd.DataFrame, vocab: dict | None = None) -> tuple[pd.DataFrame, dict]:
    out = pd.DataFrame(index=df.index)
    fit = vocab is None
    vocab = vocab if vocab is not None else {}

    amount = pd.to_numeric(df["Claim Amount"], errors="coerce")
    out["amount"] = amount
    out["log_amount"] = np.log1p(amount.clip(lower=0))

    lag = (df["_sd"] - df["_vd"]).dt.days
    out["submit_lag"] = lag.clip(lower=0)
    out["submit_attempt"] = pd.to_numeric(df["Submission Attempt"], errors="coerce").clip(1, 5)
    ap = df["Approval Number"]
    out["has_approval"] = (ap.notna() & (ap.astype(str).str.strip() != "")).astype(float)

    out["visit_dow"] = df["_vd"].dt.dayofweek
    out["visit_month"] = df["_vd"].dt.month
    out["submit_month"] = df["_sd"].dt.month

    cats = {
        "visit_type": df["Visit Type"].map(norm_visit_type),
        "hospital": df["Hospital"].map(norm_text),
        "insurance": df["Insurance Company"].map(norm_text),
        "tpa": df["TPA Company"].map(norm_text),
        "nationality": df["Nationality"].map(norm_text),
        "id_type": df["ID Type"].map(norm_id_type),
        "physician": df["Attending Physician"].map(norm_text),
        "icd_chapter": df["Primary Diagnosis"].map(icd_chapter),
        "icd_block": df["Primary Diagnosis"].map(icd_block),
    }
    for col, s in cats.items():
        s = s.fillna("unknown")
        if col in TOP_N:
            key = "rare_" + col
            if fit:
                vocab[key] = sorted(s.value_counts().head(TOP_N[col]).index.tolist())
            keep = set(vocab[key])
            s = s.where(s.isin(keep), "OTHER")
        key = "cats_" + col
        if fit:
            vocab[key] = sorted(s.astype(str).unique().tolist())
        idx = {v: i for i, v in enumerate(vocab[key])}
        out[col] = s.astype(str).map(idx).fillna(-1).astype(np.int32)
    return out, vocab


def to_categorical(X: pd.DataFrame, vocab: dict) -> pd.DataFrame:
    """dtype فئوي بمدى ثابت وكامل (0..n-1) — نفس أسلوب منصّة الموافقات حرفياً:
    تثبيت المدى يضمن أن الرمز المُصدَّر إلى المتصفح هو الرمز الذي تعلّمه النموذج."""
    Xc = X.copy()
    for col in CAT_FEATURES:
        if col not in Xc.columns:
            continue
        n = len(vocab["cats_" + col])
        Xc[col] = pd.Categorical(Xc[col], categories=list(range(n)))
    return Xc


# ──────────────────────────────────────────────────────────────────────
# معدّلات التاريخ للجهات — نافذة متوسّعة أثناء التدريب، لقطة عند التنبؤ
# ──────────────────────────────────────────────────────────────────────
_ENTITY_COLS = {"ins": "insurance", "hosp": "hospital", "doc": "physician"}


def build_entity_history(df: pd.DataFrame) -> pd.DataFrame:
    """يفترض df مرتّباً زمنياً بتاريخ التقديم. القيم من الصفوف السابقة فقط."""
    y = to_binary(df[COL_STATUS]).values
    out = pd.DataFrame(index=df.index)
    keys = {
        "ins": df["Insurance Company"].map(norm_text).values,
        "hosp": df["Hospital"].map(norm_text).values,
        "doc": df["Attending Physician"].map(norm_text).values,
    }
    for tag, vals in keys.items():
        nfp = np.full(len(df), np.nan)
        ok = np.full(len(df), np.nan)
        vol = np.zeros(len(df))
        seen: dict = {}
        for i, k in enumerate(vals):
            n, s = seen.get(k, (0, 0))
            if n > 0:
                nfp[i] = s / n
                ok[i] = 1 - s / n
            vol[i] = np.log1p(n)
            seen[k] = (n + 1, s + int(y[i]))
        out[tag + "_hist_nfp"] = nfp
        out[tag + "_hist_ok"] = ok
        out[tag + "_vol"] = vol
    return out


def build_entity_snapshot(df: pd.DataFrame) -> dict:
    """جدول اللقطة النهائي — يُشحن مع الحزمة ويُقرأ وقت التنبؤ."""
    y = to_binary(df[COL_STATUS]).values
    snap = {}
    keys = {
        "ins": df["Insurance Company"].map(norm_text),
        "hosp": df["Hospital"].map(norm_text),
        "doc": df["Attending Physician"].map(norm_text),
    }
    overall = float(np.mean(y))
    for tag, s in keys.items():
        g = pd.DataFrame({"k": s.values, "y": y}).groupby("k")["y"].agg(["mean", "count"])
        table = {}
        for k, row in g.iterrows():
            if row["count"] >= 5:
                table[k] = [round(float(row["mean"]), 5),
                            round(1 - float(row["mean"]), 5),
                            round(float(np.log1p(row["count"])), 4)]
        snap[tag] = {
            "table": table,
            "default": [round(overall, 5), round(1 - overall, 5), 0.0],
        }
    return snap


def apply_entity_snapshot(df: pd.DataFrame, snap: dict) -> pd.DataFrame:
    out = pd.DataFrame(index=df.index)
    keys = {
        "ins": df["Insurance Company"].map(norm_text),
        "hosp": df["Hospital"].map(norm_text),
        "doc": df["Attending Physician"].map(norm_text),
    }
    for tag, s in keys.items():
        e = snap[tag]
        rows = [e["table"].get(k, e["default"]) for k in s]
        arr = np.array(rows, dtype=float)
        out[tag + "_hist_nfp"] = arr[:, 0]
        out[tag + "_hist_ok"] = arr[:, 1]
        out[tag + "_vol"] = arr[:, 2]
    return out
