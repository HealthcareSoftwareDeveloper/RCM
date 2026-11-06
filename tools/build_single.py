# -*- coding: utf-8 -*-
"""
build_single.py — يبني نسخة «ملف HTML واحد» من ARCH Predict تعمل دون خادم ودون إنترنت.

    python3 tools/build_single.py [--fonts <مجلد woff2>] [--out dist]

يُخرج:
    dist/ARCH_Predict.html          الموافقات المسبقة (+ تصديرا CareWare، قائمة التدخل، المراقبة، دليل ACO)
    dist/ARCH_Predict_Claims.html   المطالبات

كل السكربتات (المحرك، الحزمة، SheetJS) والصور والخطوط تُضمَّن داخل الملف.
سجلّ الاستجابة السحابي (Google Sheets) يُعطَّل في هذه النسخة: كل شيء يبقى على الجهاز.
«مساند نماء الذكي» ودليل الاستخدام لا يُضمّنان (صور اللوائح وحدها ~100 ميغابايت).
"""
from __future__ import annotations

import argparse
import base64
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGES = {"predict.html": "ARCH_Predict.html", "claims.html": "ARCH_Predict_Claims.html"}
MIME = {".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2"}


def data_uri(p: pathlib.Path) -> str:
    return f"data:{MIME[p.suffix]};base64," + base64.b64encode(p.read_bytes()).decode()


def safe_js(txt: str) -> str:
    # لا يجوز أن يظهر </script داخل سكربت مضمَّن
    return re.sub(r"</(script)", r"<\\/\1", txt, flags=re.I)


SITE_OVERRIDE = """
/* نسخة الملف الواحد: لا اتصال خارجي — سجلّ الاستجابة يبقى محلياً على الجهاز */
window.NAMAA_AUDIT = { url: "" };
window.SADEED_SITE_LLM = { enabled: false };
"""


def font_css(fonts: pathlib.Path | None) -> str:
    if not fonts or not fonts.exists():
        return ""
    css = []
    for w in (400, 500, 600, 700):
        for sub, rng in (("arabic", "U+0600-06FF,U+0750-077F,U+08A0-08FF,U+FB50-FDFF,U+FE70-FEFF"),
                         ("latin", "U+0000-00FF,U+2000-206F,U+20AC,U+2122")):
            f = fonts / f"ibm-plex-sans-arabic-{sub}-{w}-normal.woff2"
            if f.exists():
                css.append("@font-face{font-family:'IBM Plex Sans Arabic';font-style:normal;font-weight:%d;"
                           "font-display:swap;src:url(%s) format('woff2');unicode-range:%s}" % (w, data_uri(f), rng))
    return "<style>" + "".join(css) + "</style>\n" if css else ""


def build(page: str, out: pathlib.Path, fonts: pathlib.Path | None) -> pathlib.Path:
    html = (ROOT / page).read_text(encoding="utf-8")
    xlsx = safe_js((ROOT / "assets/vendor/xlsx.full.min.js").read_text(encoding="utf-8"))

    def inline_script(m):
        src = m.group(1)
        p = ROOT / src
        js = p.read_text(encoding="utf-8")
        if src.endswith("site-config.js"):
            js += SITE_OVERRIDE
        return f"<script>/* {src} */\n{safe_js(js)}\n</script>"

    html = re.sub(r'<script src="([^"]+)"></script>', inline_script, html)
    # SheetJS أولاً حتى يجدها التبويب جاهزة (loadXLSX يتحقق من window.XLSX)
    html = html.replace("</head>", font_css(fonts) + f"<script>/* assets/vendor/xlsx.full.min.js */\n{xlsx}\n</script>\n</head>", 1)

    def inline_asset(m):
        attr, src = m.group(1), m.group(2)
        p = ROOT / src
        return f'{attr}="{data_uri(p)}"' if p.exists() and p.suffix in MIME else m.group(0)

    html = re.sub(r'(src|href)="(assets/[^"]+\.(?:svg|png|jpg))"', inline_asset, html)
    # الشعار المستضاف الاختياري يُضمَّن أيضاً حتى يعمل ARCH_ORG.logo = "assets/logo.png"
    logo = ROOT / "assets/logo.png"
    if logo.exists():
        html = html.replace('logo: "assets/logo.png"', 'logo: "' + data_uri(logo) + '"')
    # الروابط بين الصفحتين ← الملفين الشقيقين؛ ما لا يُضمَّن يُزال
    html = html.replace('href="claims.html"', 'href="ARCH_Predict_Claims.html"').replace('href="predict.html"', 'href="ARCH_Predict.html"')
    html = re.sub(r'<a class="chip guide-link" href="(?:chatbot|guide)\.html[^"]*">.*?</a>', "", html)
    html = re.sub(r'<a href="index\.html" id="homeFab".*?</a>', "", html, flags=re.S)
    html = re.sub(r'<link rel="(?:preconnect|stylesheet)" href="https://fonts[^>]+>\s*', "", html)
    leftovers = re.findall(r'(?:src|href)="(?!data:|https?:|#|ARCH_Predict)([^"]+)"', html)
    out.mkdir(parents=True, exist_ok=True)
    dst = out / PAGES[page]
    dst.write_text(html, encoding="utf-8")
    print(f"{dst}  {dst.stat().st_size / 1024 / 1024:.1f} MB" + (f"  (روابط محلية متبقية: {leftovers})" if leftovers else ""))
    return dst


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--fonts", help="مجلد ملفات woff2 لخط IBM Plex Sans Arabic (fontsource) — اختياري")
    ap.add_argument("--out", default=str(ROOT / "dist"))
    a = ap.parse_args()
    for pg in PAGES:
        build(pg, pathlib.Path(a.out), pathlib.Path(a.fonts) if a.fonts else None)
