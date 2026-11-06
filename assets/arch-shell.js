/*!
 * arch-shell.js — يلبس صفحة ARCH Predict هيكل واجهة ARCH الموحّد
 * ARCH Predict · ARCH Systems
 * لا يغيّر منطق الصفحة: ينقل شريط التبويبات (#tabs) كما هو إلى القائمة الجانبية،
 * ويضيف الشريط العلوي وعنوان الصفحة والتذييل الموحّد. التبويبات المضافة لاحقاً
 * (لوحة القيادة، قائمة التدخل…) تُلتقط تلقائياً.
 */
(function () {
  "use strict";
  if (/[?&]embed=1/.test(location.search)) return;          // وضع Power BI يبقى كما هو

  var CLAIMS = !!window.RCM_CLAIMS_BUNDLE;
  var I = function (d) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + d + "</svg>"; };
  var ICON = {
    predict: I('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.2-4.2M8.5 11l1.8 1.8 3.2-3.6"/>'),
    shap:    I('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
    reasons: I('<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17h.01"/>'),
    trees:   I('<circle cx="12" cy="5" r="2.2"/><circle cx="6" cy="17" r="2.2"/><circle cx="18" cy="17" r="2.2"/><path d="M12 7.2v3.3M12 10.5L6 14.8M12 10.5l6 4.3"/>'),
    batch:   I('<path d="M4 6h6l2 2h8v11H4z"/><path d="M12 11v5M9.5 13.5L12 11l2.5 2.5"/>'),
    model:   I('<path d="M3 17l5-6 4 4 8-9"/><path d="M14 6h6v6"/>'),
    pbi:     I('<rect x="4" y="11" width="3.5" height="9" rx="1"/><rect x="10.25" y="7" width="3.5" height="13" rx="1"/><rect x="16.5" y="3" width="3.5" height="17" rx="1"/>'),
    admin:   I('<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/>'),
    "aco-work": I('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M3.5 6l1.2 1.2L7 5M3.5 12l1.2 1.2L7 11M3.5 18l1.2 1.2L7 17"/>'),
    "aco-mon":  I('<path d="M3 12h4l3-7 4 14 3-7h4"/>'),
    "aco-ev":   I('<path d="M6 2h9l5 5v15H6z"/><path d="M15 2v5h5M9 13h7M9 17h5"/>'),
    link:    I('<path d="M10 14l10-10M14 4h6v6"/><path d="M20 14v6H4V4h6"/>'),
  };
  var SUB = {
    predict: CLAIMS ? "قدّر خطر عدم السداد ورمز الرفض المرجّح لمطالبة واحدة قبل تقديمها" : "قدّر احتمال الموافقة الكاملة لطلب واحد وأسبابه قبل إرساله",
    shap: "ما الذي رفع خطر هذا التنبؤ أو خفضه — قيم SHAP محسوبة بدقة داخل المتصفح",
    reasons: CLAIMS ? "رموز رفض NPHIES المرجّحة مع إجراء تصحيحي لكل رمز" : "أسباب عدم الموافقة المرجّحة مع إجراء تصحيحي لكل سبب",
    trees: "أشجار النموذج كما تُنفَّذ فعلاً",
    batch: CLAIMS ? "سجّل ملف مطالبات كاملاً داخل المتصفح" : "سجّل ملفاً كاملاً — أو تصديرَي CareWare للموافقات والأهلية كما هما",
    model: "بطاقة النموذج: البيانات والخوارزميات والدقة والحدود",
    pbi: "تضمين التنبؤ في Power BI",
    admin: "مقاييس الاستجابة التراكمية",
    "aco-work": "الطلبات عالية الخطر قبل الإرسال، مرتبة بالمبلغ المعرّض للخطر",
    "aco-mon": "أداء النموذج على القرار الفعلي بعد النشر، والانجراف، وأثر التدخل",
    "aco-ev": "صفحات A4 مؤرخة لكل متطلب ACO",
  };
  var ACO = CLAIMS ? ["3RCM5.5.1", "3RCM5.5.2", "3RCM7.2.2", "3RCM5.1.5", "3RCM5.2.5"]
                   : ["3RCM5.3.4", "3RCM5.5.2", "3RCM5.1.5", "3RCM5.2.5", "3RCM5.2.3"];
  var MARK = '<path d="M8 44V22a16 16 0 0 1 32 0v22" fill="none" stroke="currentColor" stroke-width="4.5"/><rect x="20" y="3" width="8" height="10" rx="1.5" fill="#C8962E"/>';
  var $ = function (id) { return document.getElementById(id); };
  function label(t) { return String(t || "").replace(/^[^\p{L}\p{N}]+/u, "").trim(); }

  function decorate(btn) {
    if (btn.dataset.archDone) return;
    var txt = label(btn.textContent);
    btn.innerHTML = (ICON[btn.dataset.p] || ICON.model) + "<span>" + txt + "</span>";
    btn.dataset.archDone = "1"; btn.dataset.title = txt;
  }
  function setMenu(open) {
    document.body.classList.toggle("menu-open", open);
    $("menuScrim").hidden = !open;
    var b = $("menuBtn"); b.setAttribute("aria-expanded", open); b.setAttribute("aria-label", open ? "إغلاق القائمة" : "فتح القائمة");
    if (open) { var on = document.querySelector("#tabs .tab.active"); if (on) on.focus(); }
  }
  function syncTitle() {
    var on = document.querySelector("#tabs .tab.active");
    if (!on) return;
    var t = on.dataset.title || label(on.textContent);
    $("archTitle").textContent = t; $("tbPage").textContent = t;
    $("archSub").textContent = SUB[on.dataset.p] || "";
    document.body.classList.toggle("arch-home", on.dataset.p === "predict");
  }

  function build() {
    var tabs = $("tabs"), wrap = document.querySelector(".wrap");
    if (!tabs || !wrap || document.body.classList.contains("arch")) return;
    document.body.classList.add("arch");
    var org = (window.ARCH_ORG && window.ARCH_ORG.name) || "";
    var cloud = window.NAMAA_AUDIT && window.NAMAA_AUDIT.url;
    var sub = CLAIMS ? "مطالبات" : "تنبؤ";

    var top = document.createElement("div");
    top.className = "arch-topbar noprint";
    top.innerHTML = '<button id="menuBtn" type="button" aria-label="فتح القائمة" aria-expanded="false" aria-controls="sideMenu">' +
      '<svg class="bars" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg><svg class="x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
      '<div class="tb-brand"><svg viewBox="0 0 48 48" aria-hidden="true">' + MARK + '</svg><b dir="ltr">ARCH Predict</b><span>' + sub + "</span></div>" +
      '<span class="tb-page" id="tbPage"></span>';
    var scrim = document.createElement("div"); scrim.id = "menuScrim"; scrim.hidden = true;
    var side = document.createElement("header");
    side.className = "arch-side"; side.id = "sideMenu";
    side.innerHTML = '<div class="pname-wrap"><svg class="mark" viewBox="0 0 48 48" aria-hidden="true">' + MARK +
      '<path d="M17 44V25a7 7 0 0 1 14 0v19" fill="none" stroke="currentColor" stroke-width="3" opacity=".45"/></svg>' +
      '<div class="pname"><b dir="ltr">ARCH Predict</b><span>' + sub + "</span></div></div>" +
      '<p class="psub">' + (CLAIMS ? "التنبؤ بسداد المطالبات ورموز الرفض قبل التقديم" : "التنبؤ بالموافقة المسبقة وأسبابها قبل الإرسال") +
      (org ? "<br><span>" + org.replace(/[<>&]/g, "") + "</span>" : "") + "</p>";
    side.appendChild(tabs);
    var other = document.querySelector('.header a.guide-link[href*="claims"], .header a.guide-link[href*="Claims"], .header a.guide-link[href*="predict"], .header a.guide-link[href*="ARCH_Predict.html"]');
    if (other) {
      var g = document.createElement("div"); g.className = "group"; g.textContent = "المرحلة الأخرى"; side.appendChild(g);
      var a = document.createElement("a"); a.className = "arch-link"; a.href = other.getAttribute("href");
      a.innerHTML = ICON.link + "<span>" + (CLAIMS ? "الموافقات المسبقة" : "المطالبات") + "</span>"; side.appendChild(a);
    }
    var foot = document.createElement("div"); foot.className = "side-foot";
    foot.innerHTML = '<div class="aco"><span>متطلبات ACO المخدومة</span><div>' +
      ACO.map(function (c) { return '<bdi class="badge-code">' + c + "</bdi>"; }).join("") + "</div></div>" +
      '<span class="maker" dir="ltr">ARCH Systems</span>';
    side.appendChild(foot);

    var head = document.createElement("div");
    head.className = "arch-pagehead noprint";
    head.innerHTML = '<h1 id="archTitle"></h1><p id="archSub"></p>';
    var chips = $("headChips");
    document.body.insertBefore(side, document.body.firstChild);
    document.body.insertBefore(scrim, side);
    document.body.insertBefore(top, scrim);
    wrap.insertBefore(head, wrap.firstChild);
    if (chips) head.parentNode.insertBefore(chips, head.nextSibling);

    var sig = document.createElement("footer"); sig.className = "sig";
    sig.innerHTML = '<span dir="ltr">ARCH Predict · ARCH Systems</span> — ' +
      (cloud ? "التنبؤ يجري داخل المتصفح." : "تعمل داخل المتصفح ولا تُرسل البيانات إلى أي خادم.") +
      ' <span dir="ltr">Built and Developed by: Hani Alsulami</span>';
    wrap.parentNode.insertBefore(sig, wrap.nextSibling);

    tabs.querySelectorAll(".tab").forEach(decorate);
    new MutationObserver(function () { tabs.querySelectorAll(".tab").forEach(decorate); syncTitle(); })
      .observe(tabs, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    $("menuBtn").onclick = function () { setMenu(!document.body.classList.contains("menu-open")); };
    scrim.onclick = function () { setMenu(false); };
    tabs.addEventListener("click", function (e) {
      if (e.target.closest(".tab")) setTimeout(function () { syncTitle(); setMenu(false); window.scrollTo(0, 0); }, 0);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && document.body.classList.contains("menu-open")) { setMenu(false); $("menuBtn").focus(); }
    });
    syncTitle();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build); else build();
})();
