/**
 * Локальный «эмоциональный» подбор свечей по свободному тексту (без внешних API).
 * Экспорт: window.AIEmotionalMatch
 */
(function (global) {
  "use strict";

  var CLUSTER_ORDER = [
    "trevoga",
    "ustalost",
    "lyubov",
    "dengi",
    "zashchita",
    "ochischenie",
    "udacha",
    "zdorovie",
    "sila",
  ];

  var CLUSTERS = {
    trevoga: {
      label: "Тревога и стресс",
      focus: "эмоциональный баланс",
      keywords: [
        "тревог",
        "страх",
        "стресс",
        "напряжен",
        "беспокой",
        "паник",
        "бессон",
      ],
    },
    ustalost: {
      label: "Усталость и выгорание",
      focus: "восстановление энергии",
      keywords: [
        "устал",
        "выгоран",
        "нет сил",
        "слабост",
        "истощен",
        "утомлен",
        "безысходн",
        "апати",
        "сонлив",
        "энергии нет",
        "не хочется",
      ],
    },
    lyubov: {
      label: "Отношения и чувства",
      focus: "гармония в отношениях",
      keywords: [
        "любов",
        "отношен",
        "чувств",
        "одиночеств",
        "семь",
        "партнер",
        "расставан",
        "ссор",
        "брак",
        "романт",
        "влюб",
        "измен",
      ],
    },
    dengi: {
      label: "Деньги и реализация",
      focus: "движение к доходу и целям",
      keywords: [
        "доход",
        "деньг",
        "работ",
        "прибыл",
        "бизнес",
        "долг",
        "клиент",
        "карьер",
        "финанс",
        "богат",
        "зарплат",
        "продаж",
        "монетиз",
      ],
    },
    zashchita: {
      label: "Защита и границы",
      focus: "защита пространства и спокойствия",
      keywords: [
        "защит",
        "негатив",
        "враг",
        "колдовств",
        "сглаз",
        "порч",
        "завист",
        "оберег",
        "опасен",
        "угроз",
        "злой",
        "токсич",
      ],
    },
    ochischenie: {
      label: "Очищение и лёгкость",
      focus: "очищение и обновление энергии",
      keywords: [
        "очищен",
        "чистк",
        "тяжест",
        "энергет",
        "пространств",
        "гармониз",
        "атмосфер",
        "застой",
        "захламлен",
      ],
    },
    udacha: {
      label: "Удача и возможности",
      focus: "удача и новые шансы",
      keywords: [
        "удач",
        "шанс",
        "успех",
        "побед",
        "возможност",
        "везен",
        "благополуч",
        "фортун",
        "судьб",
        "прорыв",
      ],
    },
    zdorovie: {
      label: "Здоровье и тело",
      focus: "поддержка здоровья и самочувствия",
      keywords: [
        "здоров",
        "болезн",
        "самочувств",
        "исцелен",
        "организм",
        "боль",
        "целител",
        "иммун",
        "восстановлен",
        "лечен",
      ],
    },
    sila: {
      label: "Сила и уверенность",
      focus: "внутренняя опора и уверенность",
      keywords: [
        "уверен",
        "смелост",
        "внутренн",
        "опор",
        "самоцен",
        "лидер",
        "решительн",
        "характер",
        "стойк",
        "силу воли",
        "сильн",
        "храбр",
      ],
    },
  };

  /** Если запрос явно про тему A, а товар «про» тему B без зацепок за A — ослабляем. */
  var TOPIC_MISMATCH = [
    { user: "zdorovie", userMin: 1.8, off: "lyubov", offMin: 2, onMax: 0.35, factor: 0.12 },
    { user: "lyubov", userMin: 1.8, off: "dengi", offMin: 2.5, onMax: 0.25, factor: 0.2 },
    { user: "dengi", userMin: 1.8, off: "lyubov", offMin: 2.5, onMax: 0.25, factor: 0.2 },
    { user: "zashchita", userMin: 1.5, off: "lyubov", offMin: 2.2, onMax: 0.2, factor: 0.18 },
    { user: "trevoga", userMin: 1.5, off: "dengi", offMin: 2.8, onMax: 0.15, factor: 0.25 },
    { user: "trevoga", userMin: 1.2, off: "lyubov", offMin: 2.5, onMax: 0.45, factor: 0.12 },
  ];

  var W = {
    situations: 5,
    benefits: 4,
    category: 3.5,
    title: 3,
    description: 2,
    recommendation: 1.5,
  };

  var LEX_STOP = {
    меня: 1,
    мне: 1,
    нас: 1,
    вас: 1,
    вам: 1,
    них: 1,
    этот: 1,
    эта: 1,
    это: 1,
    что: 1,
    как: 1,
    для: 1,
    при: 1,
    уже: 1,
    или: 1,
    еще: 1,
    ещё: 1,
    хочу: 1,
    надо: 1,
    нет: 1,
    есть: 1,
    постоянная: 1,
    постоянный: 1,
    просто: 1,
    очень: 1,
    всегда: 1,
    сейчас: 1,
  };

  function lower(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function joinArr(arr) {
    if (!Array.isArray(arr) || !arr.length) return "";
    return arr.join(" ");
  }

  function clusterStrengthInText(textLower, clusterId) {
    var c = CLUSTERS[clusterId];
    if (!c || !textLower) return 0;
    var sum = 0;
    for (var i = 0; i < c.keywords.length; i++) {
      var kw = c.keywords[i];
      if (!kw) continue;
      if (textLower.indexOf(kw) !== -1) sum += kw.length >= 5 ? 1.2 : 1;
    }
    return sum;
  }

  function scoreUserClusters(userText) {
    var t = lower(userText);
    var out = {};
    var maxV = 0;
    for (var i = 0; i < CLUSTER_ORDER.length; i++) {
      var id = CLUSTER_ORDER[i];
      var v = clusterStrengthInText(t, id);
      out[id] = v;
      if (v > maxV) maxV = v;
    }
    return { scores: out, max: maxV, textLower: t };
  }

  function productClusterVector(p) {
    var sit = lower(joinArr(p.situations));
    var ben = lower(joinArr(p.benefits));
    var cat = lower(p.category || "");
    var title = lower(p.name || "");
    var desc = lower(p.descriptionPlain || "");
    var rec = lower(p.recommendation || "");

    var vec = {};
    for (var i = 0; i < CLUSTER_ORDER.length; i++) {
      var id = CLUSTER_ORDER[i];
      vec[id] =
        W.situations * clusterStrengthInText(sit, id) +
        W.benefits * clusterStrengthInText(ben, id) +
        W.category * clusterStrengthInText(cat, id) +
        W.title * clusterStrengthInText(title, id) +
        W.description * clusterStrengthInText(desc, id) +
        W.recommendation * clusterStrengthInText(rec, id);
    }
    return vec;
  }

  function lexicalBonus(userTextLower, p) {
    var tokens = userTextLower.split(/[^a-zа-яё0-9]+/i).filter(function (w) {
      return w.length >= 4 && !LEX_STOP[w];
    });
    if (!tokens.length) return 0;
    var blob =
      " " +
      lower(
        joinArr(p.situations) +
          " " +
          joinArr(p.benefits) +
          " " +
          (p.category || "") +
          " " +
          (p.name || "") +
          " " +
          (p.descriptionPlain || "") +
          " " +
          (p.recommendation || "")
      ).replace(/\s+/g, " ") +
      " ";
    var n = 0;
    for (var i = 0; i < tokens.length; i++) {
      var tok = tokens[i];
      if (blob.indexOf(" " + tok + " ") !== -1) n += 0.35;
    }
    return Math.min(n, 4);
  }

  function applyMismatchPenalties(userScores, pVec, baseScore) {
    var s = baseScore;
    for (var i = 0; i < TOPIC_MISMATCH.length; i++) {
      var rule = TOPIC_MISMATCH[i];
      var u = userScores[rule.user] || 0;
      var off = pVec[rule.off] || 0;
      var on = pVec[rule.user] || 0;
      if (u >= rule.userMin && off >= rule.offMin && on <= rule.onMax) {
        s *= rule.factor;
      }
    }
    return s;
  }

  /** Доп. отсев: доминирующая «чужая» тема в карточке при узком запросе пользователя. */
  function applyTopicBalance(userScores, pVec, baseScore) {
    var s = baseScore;
    var uz = userScores.zdorovie || 0;
    if (uz >= 1.2) {
      var pl = pVec.lyubov || 0;
      var pz = pVec.zdorovie || 0;
      if (pl > pz + 1.5) s *= 0.06;
    }
    var ut = userScores.trevoga || 0;
    if (ut >= 1.2) {
      var pl2 = pVec.lyubov || 0;
      var pt = pVec.trevoga || 0;
      if (pl2 > pt + 2) s *= 0.08;
    }
    return s;
  }

  function dominantUserClusters(scores, maxV) {
    if (maxV <= 0) return CLUSTER_ORDER.slice();
    var thr = Math.max(0.6, maxV * 0.35);
    var dom = [];
    for (var i = 0; i < CLUSTER_ORDER.length; i++) {
      var id = CLUSTER_ORDER[i];
      if ((scores[id] || 0) >= thr) dom.push(id);
    }
    return dom.length ? dom : CLUSTER_ORDER.slice();
  }

  function mustMatchDominant(dom, pVec) {
    for (var i = 0; i < dom.length; i++) {
      if ((pVec[dom[i]] || 0) > 0.01) return 1;
    }
    return 0.12;
  }

  function buildNarrative(userAnalysis) {
    var scores = userAnalysis.scores;
    var ranked = CLUSTER_ORDER.map(function (id) {
      return { id: id, v: scores[id] || 0 };
    }).sort(function (a, b) {
      return b.v - a.v;
    });

    var picks = ranked.filter(function (x) {
      return x.v > 0;
    }).slice(0, 3);
    if (!picks.length) {
      return {
        html:
          "Ваш запрос нейтральный — мы подобрали свечи по общему смыслу описания и каталога.",
        pills: ["гармония", "поддержка", "намерение"],
      };
    }

    var parts = picks.map(function (x) {
      return CLUSTERS[x.id].focus;
    });
    var uniq = [];
    for (var i = 0; i < parts.length; i++) {
      if (uniq.indexOf(parts[i]) === -1) uniq.push(parts[i]);
    }

    var intro =
      picks[0].v >= (userAnalysis.max || 0) * 0.85
        ? "Сейчас вашему состоянию особенно важны"
        : "Ваш запрос связан с темами";

    var body =
      uniq.length === 1
        ? uniq[0] + "."
        : uniq.slice(0, -1).join(", ") + " и " + uniq[uniq.length - 1] + ".";

    var html = intro + ": " + body;

    var pills = picks.map(function (x) {
      return CLUSTERS[x.id].focus;
    });
    return { html: html, pills: pills };
  }

  function matchProducts(userText, products, opts) {
    var o = opts || {};
    var mainN = Math.min(Math.max(Number(o.mainN) || 3, 1), 8);
    var extraN = Math.min(Math.max(Number(o.extraN) || 3, 1), 8);

    var ua = scoreUserClusters(userText);
    var dom = dominantUserClusters(ua.scores, ua.max);
    var narrative = buildNarrative(ua);

    var rows = [];
    var list = Array.isArray(products) ? products : [];

    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      var pVec = productClusterVector(p);

      var dot = 0;
      for (var k = 0; k < CLUSTER_ORDER.length; k++) {
        var cid = CLUSTER_ORDER[k];
        var u = ua.scores[cid] || 0;
        if (u <= 0) continue;
        dot += u * (pVec[cid] || 0);
      }
      dot += lexicalBonus(ua.textLower, p);
      dot *= mustMatchDominant(dom, pVec);
      dot = applyMismatchPenalties(ua.scores, pVec, dot);
      dot = applyTopicBalance(ua.scores, pVec, dot);

      rows.push({ product: p, score: dot, pVec: pVec });
    }

    rows.sort(function (a, b) {
      return b.score - a.score;
    });

    var topS = rows.length && rows[0].score > 0 ? rows[0].score : 0;
    var floor = Math.max(1.2, topS * 0.07);
    var filtered = rows.filter(function (r) {
      return r.score >= floor;
    });

    if (!filtered.length && rows.length) {
      filtered = rows.filter(function (r) {
        return r.score > 0;
      });
    }
    if (!filtered.length) {
      return {
        main: [],
        extra: [],
        narrative: narrative,
        userAnalysis: ua,
        dominant: dom,
      };
    }

    var seen = {};
    var ordered = [];
    for (var f = 0; f < filtered.length; f++) {
      var id = String(filtered[f].product.id || "");
      if (!id || seen[id]) continue;
      seen[id] = 1;
      ordered.push(filtered[f].product);
    }

    var main = ordered.slice(0, mainN);
    var extra = ordered.slice(mainN, mainN + extraN);

    return {
      main: main,
      extra: extra,
      narrative: narrative,
      userAnalysis: ua,
      dominant: dom,
    };
  }

  global.AIEmotionalMatch = {
    CLUSTERS: CLUSTERS,
    CLUSTER_ORDER: CLUSTER_ORDER,
    scoreUserClusters: scoreUserClusters,
    matchProducts: matchProducts,
  };
})(typeof window !== "undefined" ? window : globalThis);
