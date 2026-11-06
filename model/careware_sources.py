# -*- coding: utf-8 -*-
"""
careware_sources.py — طبقة مصادر البيانات (Source Adapter) لـ ARCH Predict
ARCH Predict · ARCH Systems

تعتمد المنصّة هيكلية تصديرَي CareWare كما يخرجان من النظام دون تعديل:

1) ملف الموافقات (APPROVALS) — صف لكل **خدمة** داخل طلب الموافقة:
   اسم المستشفى · رقم الطلب · تاريخ الزيارة · نوع الزيارة · اسم العيادة ·
   اسم شركة التأمين · اسم شركة المطالبات · كود التشخيص الأولي · مبلغ الفاتورة ·
   حالة رفع طلب الموافقة · أسباب المرفوضات على مستوى المطالبة · حالة الموافقة للخدمة ·
   Encounter Number · رقم المريض …
2) ملف الأهلية (ELIGIBILITY) — صف لكل **فحص أهلية** للزيارة:
   Encounter Number · Contract Name · Insurance Co · Tpa · Visit Nphies Eligibility Check ·
   Requeststatustext · Disposition · Chi Check Result · Patient Category …

الحبيبات (Grain) والمفاتيح:
   • طلب الموافقة = (اسم المستشفى + رقم الطلب) — رقم الطلب وحده يتكرر بين المستشفيات.
     كل حقول الرأس ثابتة داخل الطلب (تحقّقنا على 66,375 سطراً / 11,216 طلباً).
   • الربط مع الأهلية بـ Encounter Number (أحدث فحص للزيارة، والمكتمل مقدَّم على الخطأ).

يُخرج إطاراً **بالمخطط القانوني** الذي يفهمه rcm_pipeline (Approval Status, Total,
Visit Date, Visit Type, Hospital Name, Clinic Name, Nationality, Contract Name,
Nphies Eligibility Check, Icd 10, Patient Classification, Mrn …) — فلا يتغيّر منطق
الخصائص بين التدريب والتنبؤ.

الخصوصية: تُحذف عند القراءة الأسماء وأرقام الهوية ومعرّفات المريض وأسماء الأطباء
والمستخدمين. رقم المريض يُستبدل ببصمة SHA-256 مملّحة تُستخدم فقط لحساب سجل
المريض السابق (prior_claims) ثم لا تُكتب في أي مخرَج.
"""
from __future__ import annotations

import hashlib
import re

import numpy as np
import pandas as pd

# ── أعمدة الهوية الشخصية: لا تدخل المنصّة إطلاقاً ──
PHI_COLS = [
    "اسم المريض", "رقم هوية المريض", "Patient Id", "اسم الطبيب المعالج", "اسم المستخدم",
    "English Name", "Arabic Name", "Patient Identifier", "Visit User Name", "Mrn", "رقم المريض",
    "Episode No",
]

APPROVAL_SIGNATURE = ["رقم الطلب", "حالة رفع طلب الموافقة", "مبلغ الفاتورة", "Encounter Number"]
ELIG_SIGNATURE = ["Encounter Number", "Visit Nphies Eligibility Check", "Requeststatustext"]

VISIT_TYPE = {"طوارئ": "er", "عيادات": "opd", "تنويم": "ip",
              "emergeny": "er", "emergency": "er", "outpatient": "opd", "inpatient": "ip",
              "er": "er", "opd": "opd", "ip": "ip"}

STATUS_DECIDED = {"Approved", "Partially Approved", "Rejected"}
STATUS_QUEUE = {"Pending", "Sent"}          # بانتظار القرار ← قائمة الفحص قبل/أثناء الإرسال


def _clean_cols(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df.columns = [re.sub(r"\s+", " ", str(c)).strip() for c in df.columns]
    return df


def kind_of(df: pd.DataFrame) -> str | None:
    cols = set(_clean_cols(df.head(0)).columns)
    if all(c in cols for c in APPROVAL_SIGNATURE):
        return "approvals"
    if all(c in cols for c in ELIG_SIGNATURE):
        return "eligibility"
    return None


def _hash(v, salt: str) -> str:
    s = "" if v is None or (isinstance(v, float) and np.isnan(v)) else str(v).strip()
    return hashlib.sha256((salt + s).encode("utf-8")).hexdigest()[:16] if s else ""


def eligibility_status(row) -> str:
    """فحص الأهلية ← قيم الحقل الذي تعلّمه النموذج (Nphies Eligibility Check)."""
    req = str(row.get("Requeststatustext") or "").strip().lower()
    disp = str(row.get("Disposition") or "").strip().lower()
    if "not in-force" in disp or "not in force" in disp or "not active" in disp:
        return "not-active"
    if "outside" in disp and "network" in disp:
        return "out-network"
    if "not covered" in disp:
        return "not-covered"
    if req == "error":
        return "error"
    if req == "complete":
        return "eligible"
    return ""                                      # لم يُفحص ← unknown


def reduce_eligibility(el: pd.DataFrame) -> pd.DataFrame:
    """فحص واحد لكل زيارة: المكتمل أولاً ثم الأحدث تاريخاً."""
    el = _clean_cols(el)
    el = el.drop(columns=[c for c in PHI_COLS if c in el.columns and c != "Mrn"], errors="ignore")
    el["_elig"] = el.apply(eligibility_status, axis=1)
    el["_rank"] = el["_elig"].map({"eligible": 0}).fillna(1)
    el["_d"] = pd.to_datetime(el.get("Chi Check Date"), errors="coerce")
    el = el.sort_values(["Encounter Number", "_rank", "_d"], ascending=[True, True, False], kind="mergesort")
    el = el.drop_duplicates("Encounter Number", keep="first")
    keep = {"Encounter Number": "Encounter Number", "Contract Name": "Contract Name",
            "Insurance Co": "elig_insurance", "Tpa": "elig_tpa", "_elig": "Nphies Eligibility Check",
            "Disposition": "elig_disposition", "Chi Check Result": "chi_check",
            "Patient Category": "Patient Classification", "Visit Nphies Eligibility Check": "elig_checked"}
    return el[[c for c in keep if c in el.columns]].rename(columns=keep)


def build_requests(appr: pd.DataFrame, elig: pd.DataFrame | None = None,
                   salt: str = "arch-predict") -> pd.DataFrame:
    """سطور الخدمات ← طلب موافقة واحد بالمخطط القانوني، مع الربط بالأهلية."""
    a = _clean_cols(appr)
    a["Mrn"] = a["رقم المريض"].map(lambda v: _hash(v, salt)) if "رقم المريض" in a else ""
    a = a.drop(columns=[c for c in PHI_COLS if c in a.columns and c != "Mrn"], errors="ignore")
    a["request_key"] = a["اسم المستشفى"].astype(str).str.strip() + "|" + a["رقم الطلب"].astype(str).str.strip()

    svc = a.groupby("request_key", sort=False).agg(
        service_lines=("كود الخدمة", "size"),
        services_rejected=("حالة الموافقة للخدمة", lambda s: int((s.astype(str) == "Rejected").sum())),
    )
    head = a.drop_duplicates("request_key", keep="first").set_index("request_key")
    out = pd.DataFrame(index=head.index)
    out["Hospital Name"] = head["اسم المستشفى"]
    out["Request No"] = head["رقم الطلب"].astype(str)
    out["Visit Date"] = pd.to_datetime(head["تاريخ الزيارة"], errors="coerce")
    out["Visit Type"] = head["نوع الزيارة"].astype(str).str.strip().str.lower().map(VISIT_TYPE).fillna("unknown")
    out["Clinic Name"] = head["اسم العيادة"]
    out["Nationality"] = head["الجنسية"]
    out["Financial Class"] = head.get("الفئة المالية")
    out["Insurance"] = head.get("اسم شركة التأمين")
    out["TPA"] = head.get("اسم شركة المطالبات التي تتبع لها شركة التأمين")
    out["Icd 10"] = head.get("كود التشخيص الأولي")
    out["Total"] = pd.to_numeric(head["مبلغ الفاتورة"], errors="coerce")
    # «مبلغ الفاتورة» يبقى صفراً حتى تُصدر الفاتورة (42% من الطلبات في العيّنة) — والصفر ليس مبلغاً
    # حقيقياً بل غياب له، فيُعامل كقيمة مفقودة حتى لا يتعلّم النموذج «الصفر = رفض».
    out["amount_missing"] = out["Total"].fillna(0) <= 0
    out.loc[out["amount_missing"], "Total"] = np.nan
    out["Approval Status"] = head["حالة رفع طلب الموافقة"].astype(str).str.strip()
    out["Approval Reject Reason"] = head.get("أسباب المرفوضات على مستوى المطالبة")
    out["Submitted At"] = head.get("تاريخ إرسال الموافقة")
    out["Region"] = head.get("اسم التجمع")
    out["Encounter Number"] = head["Encounter Number"].astype(str)
    out["Mrn"] = head["Mrn"]
    out = out.join(svc)

    out["Contract Name"] = np.nan
    out["Nphies Eligibility Check"] = ""
    out["Patient Classification"] = ""
    if elig is not None and len(elig):
        e = reduce_eligibility(elig)
        e["Encounter Number"] = e["Encounter Number"].astype(str)
        m = out.reset_index().merge(e, on="Encounter Number", how="left", suffixes=("", "_e"))
        m = m.set_index("request_key")
        for c in ["Contract Name", "Nphies Eligibility Check", "Patient Classification"]:
            if c + "_e" in m:
                out[c] = m[c + "_e"].reindex(out.index)
        for c in ["elig_checked", "elig_disposition", "chi_check"]:
            if c in m:
                out[c] = m[c].reindex(out.index)
        out["elig_matched"] = m["elig_checked"].reindex(out.index).notna() if "elig_checked" in m else False
    else:
        out["elig_matched"] = False
    # بلا عقد في الأهلية ← شركة التأمين (أقرب بديل متاح في ملف الموافقات)
    out["Contract Name"] = out["Contract Name"].fillna(out["Insurance"])
    out["Nphies Eligibility Check"] = out["Nphies Eligibility Check"].fillna("")
    out["Patient Classification"] = out["Patient Classification"].fillna("")
    out["Gender"] = ""                       # غير متاح في التصديرين ← Unknown
    out["Triage Category"] = np.nan          # غير متاح ← قيمة النموذج الافتراضية
    out = out.reset_index()
    return out


def load_sources(approvals_path: str, eligibility_path: str | None = None) -> pd.DataFrame:
    a = pd.read_excel(approvals_path, sheet_name=0) if str(approvals_path).lower().endswith(("xlsx", "xls", "xlsm")) \
        else pd.read_csv(approvals_path)
    if kind_of(a) != "approvals":
        raise SystemExit("الملف ليس تصدير موافقات CareWare (أعمدة مفقودة: " +
                         ", ".join(c for c in APPROVAL_SIGNATURE if c not in _clean_cols(a.head(0)).columns) + ")")
    e = None
    if eligibility_path:
        e = pd.read_excel(eligibility_path, sheet_name=0) if str(eligibility_path).lower().endswith(("xlsx", "xls", "xlsm")) \
            else pd.read_csv(eligibility_path)
        if kind_of(e) != "eligibility":
            raise SystemExit("ملف الأهلية لا يطابق هيكلية تصدير الأهلية (Encounter Number, Visit Nphies Eligibility Check, Requeststatustext)")
    return build_requests(a, e)


def quality_report(df: pd.DataFrame) -> dict:
    st = df["Approval Status"].value_counts().to_dict()
    return {
        "requests": int(len(df)),
        "service_lines": int(df["service_lines"].sum()),
        "decided": int(df["Approval Status"].isin(STATUS_DECIDED).sum()),
        "queue": int(df["Approval Status"].isin(STATUS_QUEUE).sum()),
        "status": {k: int(v) for k, v in st.items()},
        "elig_matched": int(df["elig_matched"].sum()),
        "amount_missing": int(df["amount_missing"].sum()),
        "garbled_names": int(df["Insurance"].astype(str).str.contains(r"\?\?\?").sum()
                             + df["Contract Name"].astype(str).str.contains(r"\?\?\?").sum()),
        "date_from": str(df["Visit Date"].min())[:10], "date_to": str(df["Visit Date"].max())[:10],
    }


if __name__ == "__main__":
    import argparse
    import json
    ap = argparse.ArgumentParser(description="تحويل تصديرَي CareWare (الموافقات + الأهلية) إلى طلبات بالمخطط القانوني")
    ap.add_argument("--approvals", required=True)
    ap.add_argument("--eligibility")
    ap.add_argument("--out", help="حفظ الطلبات (xlsx/csv) — بلا أي بيانات هوية")
    a = ap.parse_args()
    d = load_sources(a.approvals, a.eligibility)
    print(json.dumps(quality_report(d), ensure_ascii=False, indent=1))
    if a.out:
        d2 = d.drop(columns=["Mrn"])
        (d2.to_excel if a.out.endswith("xlsx") else d2.to_csv)(a.out, index=False)
