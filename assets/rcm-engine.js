/*!
 * rcm-engine.js — محرّك التنبؤ والتفسير داخل المتصفح
 * ARCH Predict · ARCH Systems
 *
 * يقرأ حزمة نموذج LightGBM المصدَّرة (window.RCM_BUNDLE) وينفّذ:
 *   • تمرير الأشجار لحساب الاحتمالات (مطابق تماماً لمخرجات النموذج في بايثون)
 *   • خوارزمية TreeSHAP المسارية (Lundberg et al.) لحساب قيم شابلي بدقّة تامة
 *     — وليس تقريباً — بتعقيد O(أشجار × أوراق × عمق²)
 *   • ترتيب أسباب الرفض المتوقّعة
 *
 * لا يعتمد على أي مكتبة خارجية.
 */
(function (root) {
  "use strict";

  var NUM = 0, CAT = 1, LEAF = 2;   // أنواع العقد

  // ────────────────────────────────────────────────────────────────
  // 1. تمرير شجرة واحدة
  // ────────────────────────────────────────────────────────────────
  function childOf(t, i, x) {
    var f = t.f[i], v = x[f], mt = t.m ? t.m[i] : 0;   // 0=None 1=Zero 2=NaN

    if (t.k[i] === CAT) {
      // انقسام فئوي — مطابق لـ LightGBM::CategoricalDecision
      if (v !== v) {                                   // NaN
        if (mt === 2) return t.r[i];
        v = 0;
      }
      var iv = v | 0;
      if (iv < 0) return t.r[i];
      return t._s[t.v[i]].has(iv) ? t.l[i] : t.r[i];
    }

    // انقسام رقمي — مطابق لـ LightGBM::NumericalDecision
    if (v !== v && mt !== 2) v = 0;                    // المفقود يصير صفراً إن لم يكن نوعه NaN
    if ((mt === 1 && v === 0) || (mt === 2 && v !== v)) {
      return t.d[i] ? t.l[i] : t.r[i];                 // الاتجاه الافتراضي
    }
    return v <= t.v[i] ? t.l[i] : t.r[i];
  }

  function treeValue(t, x) {
    var i = 0;
    while (t.k[i] !== LEAF) i = childOf(t, i, x);
    return t.v[i];
  }

  function prepare(trees) {
    for (var i = 0; i < trees.length; i++) {
      var t = trees[i];
      if (t._s) continue;
      t._s = (t.s || []).map(function (a) { return new Set(a); });
      var d = 0, st = [[0, 0]];
      while (st.length) {                       // عمق الشجرة (لتخصيص مسار SHAP)
        var p = st.pop(), n = p[0], dep = p[1];
        if (dep > d) d = dep;
        if (t.k[n] !== LEAF) { st.push([t.l[n], dep + 1]); st.push([t.r[n], dep + 1]); }
      }
      t._d = d;
    }
    return trees;
  }

  /**
   * الدرجة الخام (log-odds) = مجموع أوراق الأشجار لكل فئة.
   * لا تُضاف إليها قيمة الأساس — فتلك مرجع SHAP فقط، وقد أدمج LightGBM
   * متوسط الانطلاق داخل أوراق الأشجار الأولى.
   */
  function rawScores(trees, x, nClass) {
    var out = new Array(nClass);
    for (var c = 0; c < nClass; c++) out[c] = 0;
    for (var i = 0; i < trees.length; i++) out[trees[i].c] += treeValue(trees[i], x);
    return out;
  }

  function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }

  /**
   * يحوّل الدرجات الخام إلى احتمالات حسب نوع المهمّة.
   *   binary     : مخرَج واحد → [1-p, p] عبر sigmoid بمعامل النموذج
   *   multiclass : مخرَج لكل فئة → softmax
   */
  function toProba(raw, spec) {
    if (spec && spec.task === "binary") {
      var p = sigmoid((spec.sigmoid || 1) * raw[0]);
      return [1 - p, p];
    }
    return softmax(raw);
  }

  function softmax(s) {
    var mx = -Infinity, i;
    for (i = 0; i < s.length; i++) if (s[i] > mx) mx = s[i];
    var sum = 0, e = new Array(s.length);
    for (i = 0; i < s.length; i++) { e[i] = Math.exp(s[i] - mx); sum += e[i]; }
    for (i = 0; i < s.length; i++) e[i] /= sum;
    return e;
  }

  // ────────────────────────────────────────────────────────────────
  // 2. TreeSHAP المساري — قيم شابلي دقيقة
  //    المرجع: Lundberg, Erion & Lee (2018),
  //    "Consistent Individualized Feature Attribution for Tree Ensembles"
  //    الخرج على مقياس اللوغاريتم الاحتمالي (margin)، ومجموعه يساوي بالضبط
  //    (درجة الفئة − قيمة الأساس).
  // ────────────────────────────────────────────────────────────────
  // المسار يُخزَّن في مخزن مسطّح واحد مُخصَّص مسبقاً؛ كل مستوى استدعاء
  // يحجز شريحة تبدأ عند off بطول depth+1 — يتفادى تخصيص الذاكرة داخل العودية.
  var _pd = null, _pz = null, _po = null, _pw = null, _cap = 0;

  function ensureBuffers(depth) {
    var need = ((depth + 2) * (depth + 3)) >> 1;
    if (need <= _cap) return;
    _cap = need;
    _pd = new Int32Array(need); _pz = new Float64Array(need);
    _po = new Float64Array(need); _pw = new Float64Array(need);
  }

  function copySlice(from, to, len) {
    for (var i = 0; i < len; i++) {
      _pd[to + i] = _pd[from + i]; _pz[to + i] = _pz[from + i];
      _po[to + i] = _po[from + i]; _pw[to + i] = _pw[from + i];
    }
  }

  function extend(o, depth, pz, po, pi) {
    _pd[o + depth] = pi; _pz[o + depth] = pz; _po[o + depth] = po;
    _pw[o + depth] = depth === 0 ? 1 : 0;
    for (var i = depth - 1; i >= 0; i--) {
      _pw[o + i + 1] += po * _pw[o + i] * (i + 1) / (depth + 1);
      _pw[o + i] = pz * _pw[o + i] * (depth - i) / (depth + 1);
    }
  }

  function unwind(o, depth, idx) {
    var one = _po[o + idx], zero = _pz[o + idx], next = _pw[o + depth], i, tmp;
    for (i = depth - 1; i >= 0; i--) {
      if (one !== 0) {
        tmp = _pw[o + i];
        _pw[o + i] = next * (depth + 1) / ((i + 1) * one);
        next = tmp - _pw[o + i] * zero * (depth - i) / (depth + 1);
      } else {
        _pw[o + i] = _pw[o + i] * (depth + 1) / (zero * (depth - i));
      }
    }
    for (i = idx; i < depth; i++) {
      _pd[o + i] = _pd[o + i + 1]; _pz[o + i] = _pz[o + i + 1]; _po[o + i] = _po[o + i + 1];
    }
  }

  function unwoundSum(o, depth, idx) {
    var one = _po[o + idx], zero = _pz[o + idx], next = _pw[o + depth], total = 0, i, tmp;
    if (one !== 0) {
      for (i = depth - 1; i >= 0; i--) {
        tmp = next * (depth + 1) / ((i + 1) * one);
        total += tmp;
        next = _pw[o + i] - tmp * zero * (depth - i) / (depth + 1);
      }
    } else {
      for (i = depth - 1; i >= 0; i--) total += _pw[o + i] / (zero * (depth - i) / (depth + 1));
    }
    return total;
  }

  function shapTree(t, x, phi) {
    ensureBuffers(t._d + 1);

    function recurse(node, parentOff, depth, pz, po, pi) {
      var o = parentOff + depth;          // شريحة هذا المستوى
      copySlice(parentOff, o, depth);
      extend(o, depth, pz, po, pi);
      depth += 1;

      if (t.k[node] === LEAF) {
        var lv = t.v[node];
        for (var i = 1; i < depth; i++) {
          phi[_pd[o + i]] += unwoundSum(o, depth - 1, i) * (_po[o + i] - _pz[o + i]) * lv;
        }
        return;
      }

      var hot = childOf(t, node, x);
      var cold = hot === t.l[node] ? t.r[node] : t.l[node];
      var wN = t.w[node] || 1, iz = 1, io = 1, sf = t.f[node], k = -1;

      for (var j = 1; j < depth; j++) if (_pd[o + j] === sf) { k = j; break; }
      if (k >= 0) { iz = _pz[o + k]; io = _po[o + k]; unwind(o, depth - 1, k); depth -= 1; }

      recurse(hot,  o, depth, iz * (t.w[hot]  / wN), io, sf);
      recurse(cold, o, depth, iz * (t.w[cold] / wN), 0,  sf);
    }

    recurse(0, 0, 0, 1, 1, -1);
  }

  /** قيم SHAP لكل فئة ولكل خاصية: phi[class][feature] */
  function shapValues(trees, x, nClass, nFeat) {
    var phi = [];
    for (var c = 0; c < nClass; c++) phi.push(new Float64Array(nFeat));
    for (var i = 0; i < trees.length; i++) shapTree(trees[i], x, phi[trees[i].c]);
    return phi;
  }

  // ────────────────────────────────────────────────────────────────
  // 3. ترميز مدخلات المستخدم إلى متجه الخصائص
  // ────────────────────────────────────────────────────────────────
  function catIndex(B, col, value) {
    var opts = B.options[col] || [];
    for (var i = 0; i < opts.length; i++) if (opts[i].v === value) return opts[i].i;
    for (i = 0; i < opts.length; i++) if (opts[i].v === "OTHER") return opts[i].i;
    return -1;
  }

  function entityLookup(B, key, name) {
    var e = B.entity_snapshot[key];
    if (!e) return [0, 0, 0];
    var k = (name == null ? "" : String(name)).trim().toLowerCase().replace(/\s+/g, " ");
    return e.table[k] || e.default;
  }

  /**
   * يبني متجه الخصائص بنفس الترتيب الذي دُرِّب عليه النموذج.
   * input: كائن بمفاتيح مقروءة (total, visitType, hospital, ...)
   */
  function encode(B, input) {
    var idx = {}, i;
    for (i = 0; i < B.features.length; i++) idx[B.features[i]] = i;
    var x = new Float64Array(B.features.length);
    for (i = 0; i < x.length; i++) x[i] = NaN;

    function setNum(name, v) { if (idx[name] !== undefined) x[idx[name]] = (v === null || v === undefined || v === "") ? NaN : +v; }
    function setCat(name, v) { if (idx[name] !== undefined) x[idx[name]] = catIndex(B, name, v); }

    var total = (input.total === "" || input.total == null) ? NaN : Math.max(0, Math.min(200000, +input.total));
    setNum("total", total);
    setNum("log_total", Math.log1p(isNaN(total) ? 0 : total));
    setNum("triage", input.triage);

    var dt = input.visitDate ? new Date(input.visitDate) : new Date();
    if (isNaN(dt.getTime())) dt = new Date();
    setNum("visit_hour", dt.getHours());
    setNum("visit_dow", (dt.getDay() + 6) % 7);          // الاثنين=0 مثل pandas
    setNum("visit_month", dt.getMonth() + 1);
    setNum("is_night", (dt.getHours() < 7 || dt.getHours() >= 22) ? 1 : 0);
    var dow = (dt.getDay() + 6) % 7;
    setNum("is_weekend", (dow === 4 || dow === 5) ? 1 : 0);   // الجمعة/السبت

    setNum("prior_claims", input.priorClaims);
    setNum("prior_reject_rate", input.priorRejectRate);

    setCat("visit_type", input.visitType);
    setCat("hospital", input.hospital);
    setCat("clinic", input.clinic);
    setCat("nationality", input.nationality);
    setCat("contract", input.contract);
    setCat("nphies_elig", input.nphies);
    setCat("gender", input.gender);
    setCat("icd_chapter", input.icdChapter);
    setCat("icd_block", input.icdBlock);
    setCat("patient_class", input.patientClass);

    // خصائص السجل التاريخي — تُشتقّ آلياً من جداول اللقطة
    var pairs = [["contract", input.contract],
                 ["hosp", input.hospital],
                 ["clinic", input.clinic]];
    for (i = 0; i < pairs.length; i++) {
      var v = entityLookup(B, pairs[i][0], pairs[i][1]);
      setNum(pairs[i][0] + "_hist_nfa", v[0]);
      setNum(pairs[i][0] + "_hist_ok", v[1]);
      setNum(pairs[i][0] + "_vol", v[2]);
    }
    return x;
  }

  // ────────────────────────────────────────────────────────────────
  // 4. تجميع قيم SHAP تحت مفاهيم تشغيلية
  // ────────────────────────────────────────────────────────────────
  function groupShap(B, phiClass) {
    var idx = {}, i;
    for (i = 0; i < B.features.length; i++) idx[B.features[i]] = i;
    var out = [];
    Object.keys(B.shap_groups).forEach(function (g) {
      var def = B.shap_groups[g], s = 0;
      def.cols.forEach(function (c) { if (idx[c] !== undefined) s += phiClass[idx[c]]; });
      out.push({ key: g, label: def.label, value: s });
    });
    out.sort(function (a, b) { return Math.abs(b.value) - Math.abs(a.value); });
    return out;
  }

  // ────────────────────────────────────────────────────────────────
  // 5. الواجهة العامة
  // ────────────────────────────────────────────────────────────────
  function predict(B, input) {
    return predictX(B, encode(B, input));
  }

  /** predict على متجه خصائص مشفَّر جاهز — تستعمله صفحة المطالبات التي
      تملك ترميزها الخاص، بنفس منطق العرض الثنائي حرفياً. */
  function predictX(B, x) {
    var A = B.approval;
    prepare(A.trees);
    var nOut = A.outputs || B.classes.length;
    var binary = A.task === "binary";

    var raw = rawScores(A.trees, x, nOut);
    var proba = toProba(raw, A);
    var phiRaw = shapValues(A.trees, x, nOut, B.features.length);

    // التحقق من صحة التفكيك على المخرَج الخام: الأساس + Σφ = الدرجة
    var check = 0, k, f, s;
    for (k = 0; k < nOut; k++) {
      s = A.base[k];
      for (f = 0; f < phiRaw[k].length; f++) s += phiRaw[k][f];
      check = Math.max(check, Math.abs(s - raw[k]));
    }

    // في الهدف الثنائي يوجد logit واحد يخصّ فئة «موافقة غير كاملة».
    // درجة الفئة المقابلة هي نفسها بإشارة معكوسة، وكذلك قيم شابلي —
    // فيبقى العرض لكل فئة صحيحاً ومتّسقاً.
    var margin, phi, base;
    if (binary) {
      margin = [-raw[0], raw[0]];
      base = [-A.base[0], A.base[0]];
      var neg = new Float64Array(phiRaw[0].length);
      for (f = 0; f < phiRaw[0].length; f++) neg[f] = -phiRaw[0][f];
      phi = [neg, phiRaw[0]];
    } else {
      margin = raw; base = A.base; phi = phiRaw;
    }

    var groups = [];
    for (k = 0; k < B.classes.length; k++) groups.push(groupShap(B, phi[k]));

    return {
      x: x, margin: margin, proba: proba, phi: phi, groups: groups,
      base: base, baseProba: toProba(A.base, A),
      binary: binary,
      shapError: check,
      threshold: binary ? (A.threshold || 0.5) : null,
      // في الهدف الثنائي يُحسم التصنيف بعتبة مُعايَرة على شريحة تحقّق،
      // لا بمقارنة الاحتمالين — لأن تفويت حالة خاسرة أغلى من إنذار زائد.
      predIndex: binary ? (proba[1] >= (A.threshold || 0.5) ? 1 : 0)
                        : proba.indexOf(Math.max.apply(null, proba)),
    };
  }

  function predictReasons(B, input, rejRisk) {
    return predictReasonsX(B, encode(B, input), rejRisk);
  }

  function predictReasonsX(B, x, rejRisk) {
    if (!B.reason || !B.reason.trees.length) return [];
    prepare(B.reason.trees);
    var L = B.reason.labels;
    var p = toProba(rawScores(B.reason.trees, x, L.length), B.reason);
    var phi = shapValues(B.reason.trees, x, L.length, B.features.length);
    var out = L.map(function (code, i) {
      return {
        code: code,
        label: B.reason.labels_ar[code] || code,
        action: B.reason.actions[code] || "",
        p: p[i],
        likelihood: p[i] * (rejRisk == null ? 1 : rejRisk),
        drivers: groupShap(B, phi[i]).filter(function (g) { return g.value > 0; }).slice(0, 3),
      };
    });
    out.sort(function (a, b) { return b.p - a.p; });
    return out;
  }

  root.RCMEngine = {
    predict: predict, predictX: predictX,
    predictReasons: predictReasons, predictReasonsX: predictReasonsX,
    encode: encode,
    softmax: softmax, sigmoid: sigmoid, toProba: toProba,
    shapValues: shapValues, rawScores: rawScores,
    groupShap: groupShap, prepare: prepare,
  };
})(typeof window !== "undefined" ? window : globalThis);

if (typeof module !== "undefined" && module.exports) module.exports = globalThis.RCMEngine;
