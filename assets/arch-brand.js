/*!
 * arch-brand.js — هوية ARCH Predict واسم الجهة المستضيفة
 * ARCH Predict · ARCH Systems
 * اسم الجهة وشعارها يُضبطان مرة واحدة في assets/site-config.js (window.ARCH_ORG)
 * فتظهر في الرأس والتذييل وصفحات دليل ACO. ما لم يُضبطا تظهر هوية ARCH Systems وحدها.
 */
(function () {
  "use strict";
  function apply() {
    var o = window.ARCH_ORG || {};
    document.querySelectorAll("[data-arch-org-logo]").forEach(function (img) {
      if (o.logo) { img.src = o.logo; img.alt = o.name || ""; img.hidden = false; } else img.hidden = true;
    });
    document.querySelectorAll("[data-arch-org-unit]").forEach(function (el) {
      if (o.unit || o.name) el.textContent = o.unit || o.name;
    });
    document.querySelectorAll("[data-arch-org-line]").forEach(function (el) {
      el.textContent = [o.name, o.unit].filter(Boolean).join(" · ") || "ARCH Systems";
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply); else apply();
})();
