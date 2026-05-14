/**
 * Загрузка data/candles.json и подбор товаров по category + description (plain text).
 * Подключается перед основным скриптом в Подбор свечи.html; экспортирует window.CandleCatalog.
 */
(function (global) {
  "use strict";

  const state = {
    products: [],
    loaded: false,
    error: null,
  };

  function stripHtml(html) {
    if (!html) return "";
    const s = String(html)
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ");
    const tmp = typeof document !== "undefined" ? document.createElement("div") : null;
    if (tmp) {
      tmp.innerHTML = s;
      return (tmp.textContent || tmp.innerText || "").replace(/\s+/g, " ").trim();
    }
    return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }

  function excerpt(text, maxLen) {
    const t = (text || "").trim();
    if (!t) return "";
    if (t.length <= maxLen) return t;
    const cut = t.slice(0, maxLen);
    const lastSpace = cut.lastIndexOf(" ");
    return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim() + "…";
  }

  function normalizeImagePath(p) {
    let s = String(p || "")
      .trim()
      .replace(/\\/g, "/");
    if (!s) return "";
    if (/^https?:\/\//i.test(s)) return s;
    s = s.replace(/^\.?\/*/, "");
    while (/^images\/images\//i.test(s)) {
      s = s.replace(/^images\/images\//i, "images/");
    }
    if (/^images\//i.test(s)) return s;
    if (s.includes("/")) return s;
    return "images/" + s;
  }

  function normalizeRaw(p) {
    if (!p || typeof p !== "object") return null;
    if (p.hidden === true) return null;
    const fromArray = Array.isArray(p.images)
      ? p.images.map(normalizeImagePath).filter(Boolean)
      : [];
    const single = p.image ? [normalizeImagePath(String(p.image))] : [];
    const images = fromArray.length ? fromArray : single;
    const descHtml = String(p.description || "").trim();
    const descPlain = stripHtml(descHtml);
    const link = String(p.url || p.buyLink || "").trim();
    const situations = Array.isArray(p.situations)
      ? p.situations.map(function (s) {
          return String(s || "").trim();
        }).filter(Boolean)
      : [];
    const benefits = Array.isArray(p.benefits)
      ? p.benefits.map(function (s) {
          return String(s || "").trim();
        }).filter(Boolean)
      : [];
    const recommendation = String(p.recommendation || "").trim();
    return {
      id: String(p.id || "").trim(),
      name: String(p.name || "").trim(),
      sku: String(p.sku || "").trim(),
      price: p.price != null && p.price !== "" ? String(p.price) : "",
      category: String(p.category || "").trim(),
      descriptionPlain: descPlain,
      descriptionHtml: descHtml,
      shortPlain: excerpt(descPlain, 220),
      images: images,
      image: images[0] || "",
      url: link,
      buyLink: link,
      situations: situations,
      benefits: benefits,
      recommendation: recommendation,
    };
  }

  /**
   * Нормализация текста для поиска «целых слов» (токены через пробелы).
   */
  function normalizeTokensBlob(text) {
    return (
      " " +
      String(text || "")
        .toLowerCase()
        .replace(/<[^>]+>/g, " ")
        .replace(/[^a-zа-яё0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim() +
      " "
    );
  }

  function hasAnyToken(normBlob, tokens) {
    for (var i = 0; i < tokens.length; i++) {
      var t = String(tokens[i] || "").toLowerCase().trim();
      if (!t) continue;
      if (normBlob.indexOf(" " + t + " ") !== -1) return true;
    }
    return false;
  }

  /** Токен целиком или префиксом (для «финансовый», «удачливый»). */
  function blobHasKeyword(normBlob, kw) {
    var k = String(kw || "").toLowerCase().trim();
    if (!k) return false;
    if (hasAnyToken(normBlob, [k])) return true;
    if (k.length < 4) return false;
    var parts = normBlob.trim().split(/\s+/).filter(Boolean);
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].indexOf(k) === 0) return true;
    }
    return false;
  }

  function anyTokenStartsWithPrefixes(normBlob, prefixes) {
    var parts = normBlob.trim().split(/\s+/).filter(Boolean);
    for (var i = 0; i < parts.length; i++) {
      var tok = parts[i];
      for (var j = 0; j < prefixes.length; j++) {
        var pre = String(prefixes[j] || "").toLowerCase();
        if (pre && tok.indexOf(pre) === 0) return true;
      }
    }
    return false;
  }

  /** Карточные ситуации: строгая двухфазная логика (situations → ключевые слова). */
  var STRICT_SITUATION_CANON = {
    деньги: "Деньги",
    любовь: "Любовь",
    защита: "Защита",
    "очищение дома": "Очищение дома",
    очищение: "Очищение дома",
    здоровье: "Здоровье",
    удача: "Удача",
    обучение: "Обучение",
  };

  function canonSituationName(selected) {
    var s = String(selected || "").trim().toLowerCase();
    if (!s) return "";
    if (STRICT_SITUATION_CANON[s]) return STRICT_SITUATION_CANON[s];
    return String(selected || "").trim();
  }

  function isStrictCardSituation(selected) {
    var s = String(selected || "").trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(STRICT_SITUATION_CANON, s);
  }

  /**
   * Тег в situations совпадает с выбором пользователя (учёт «Очищение» / «Очищение дома»).
   */
  function situationTagMatchesSelection(tag, selectedRaw) {
    var t = String(tag || "").trim().toLowerCase();
    var sel = String(selectedRaw || "").trim().toLowerCase();
    if (!t || !sel) return false;
    if (t === sel) return true;
    var canon = canonSituationName(selectedRaw).toLowerCase();
    if (t === canon) return true;
    if (canon === "очищение дома") {
      if (t === "очищение дома" || t === "очищение") return true;
      if (sel === "очищение" && t.indexOf("очищен") === 0) return true;
    }
    return false;
  }

  function productHasSituationTag(p, selectedRaw) {
    var sits = Array.isArray(p.situations) ? p.situations : [];
    for (var i = 0; i < sits.length; i++) {
      if (situationTagMatchesSelection(sits[i], selectedRaw)) return true;
    }
    return false;
  }

  var SITUATION_MATCH_CONFIG = {
    Деньги: {
      keywords: [
        "деньги",
        "денег",
        "денежн",
        "финанс",
        "финансов",
        "прибыль",
        "доход",
        "дохода",
        "доходов",
        "богатство",
        "богатства",
        "заработок",
        "зарплат",
        "успех",
        "успешн",
        "капитал",
        "торговл",
        "инвест",
      ],
      excludeTokens: [
        "любовь",
        "любви",
        "любовью",
        "отношения",
        "отношений",
        "романт",
        "брак",
        "семья",
        "семьи",
        "супруг",
        "здоровье",
        "здоровья",
        "болезнь",
        "болезни",
        "исцеление",
        "самочувств",
        "целитель",
      ],
    },
    Любовь: {
      keywords: [
        "любовь",
        "любви",
        "любим",
        "отношения",
        "отношений",
        "романт",
        "страст",
        "брак",
        "семья",
        "семьи",
        "супруг",
        "партнёр",
        "партнер",
        "влюбл",
        "свидани",
      ],
      excludeTokens: [
        "деньги",
        "денег",
        "деньгам",
        "деньгами",
        "денежн",
        "финанс",
        "прибыль",
        "доход",
        "дохода",
        "богатство",
        "зарплат",
        "кредит",
        "долг",
        "капитал",
        "инвест",
      ],
    },
    Здоровье: {
      keywords: [
        "здоровье",
        "здоровья",
        "здоровым",
        "здоровый",
        "здоровая",
        "здоровое",
        "здоровы",
        "здоров",
        "оздоров",
        "болезнь",
        "болезни",
        "болезнью",
        "исцеление",
        "исцеления",
        "целитель",
        "целителя",
        "энергия",
        "энергии",
        "энергию",
        "силы",
        "сила",
        "восстановление",
        "восстановления",
        "самочувствие",
        "самочувствия",
      ],
      excludeTokens: [
        "любовь",
        "любви",
        "любовью",
        "отношения",
        "отношений",
        "брак",
        "брака",
        "браке",
        "влюблен",
        "свадьб",
        "деньги",
        "денег",
        "деньгам",
        "деньгами",
        "денежн",
        "финанс",
        "финансов",
        "прибыль",
        "доход",
        "дохода",
        "богатство",
        "заработок",
      ],
    },
    Защита: {
      keywords: [
        "защит",
        "оберег",
        "сглаз",
        "порч",
        "негатив",
        "опасн",
        "угроз",
        "тревог",
        "спокойств",
        "безопас",
      ],
      excludeTokens: [],
    },
    "Очищение дома": {
      keywords: [
        "очищен",
        "очистк",
        "пространств",
        "квартир",
        "энергетик",
        "атмосфер",
        "гармон",
      ],
      excludeTokens: [],
    },
    Удача: {
      keywords: [
        "удач",
        "везен",
        "шанс",
        "фортун",
        "совпаден",
        "благополуч",
        "судьб",
      ],
      excludeTokens: [],
    },
    Обучение: {
      keywords: [
        "обучен",
        "учёба",
        "учеба",
        "экзамен",
        "знани",
        "школ",
        "университет",
        "концентрац",
        "памят",
        "успеваем",
      ],
      excludeTokens: [],
    },
  };

  function getSituationConfigKey(selectedRaw) {
    return canonSituationName(selectedRaw);
  }

  function productSearchBlob(p) {
    var ben = Array.isArray(p.benefits) ? p.benefits.join(" ") : "";
    return [p.name, p.category, p.descriptionPlain, ben, p.recommendation].join(" ");
  }

  function shouldExcludeForSituation(sitKey, normFull) {
    var cfg = SITUATION_MATCH_CONFIG[sitKey];
    if (!cfg) return false;
    if (cfg.excludeTokens && cfg.excludeTokens.length && hasAnyToken(normFull, cfg.excludeTokens)) {
      return true;
    }
    if (sitKey === "Здоровье") {
      return anyTokenStartsWithPrefixes(normFull, [
        "деньг",
        "любов",
        "отношен",
        "финанс",
        "прибыл",
        "доход",
        "богат",
        "кредит",
        "долг",
        "капитал",
        "инвест",
        "влюб",
        "свадьб",
      ]);
    }
    if (sitKey === "Любовь") {
      return anyTokenStartsWithPrefixes(normFull, [
        "деньг",
        "финанс",
        "прибыл",
        "доход",
        "богат",
        "зарплат",
        "кредит",
        "долг",
        "капитал",
        "инвест",
      ]);
    }
    if (sitKey === "Деньги") {
      return anyTokenStartsWithPrefixes(normFull, [
        "любов",
        "отношен",
        "роман",
        "брак",
        "семь",
        "здоров",
        "болезн",
        "исцел",
        "самочувств",
        "целител",
      ]);
    }
    return false;
  }

  function scoreProductStrict(sitKey, p, answersJoined, phase, reasons) {
    var cfg = SITUATION_MATCH_CONFIG[sitKey];
    if (!cfg) return { score: 0, reasons: reasons || [] };
    var r = reasons || [];
    var score = 0;
    var catN = normalizeTokensBlob(p.category || "");
    var descN = normalizeTokensBlob(p.descriptionPlain || "");
    var nameN = normalizeTokensBlob(p.name || "");
    var ansN = normalizeTokensBlob(answersJoined || "");
    var fullN = normalizeTokensBlob(productSearchBlob(p));

    if (phase === "situations") {
      score += 10000;
      r.push('situations: точное совпадение тега «' + sitKey + '»');
    }

    var kw = cfg.keywords || [];
    var i;
    for (i = 0; i < kw.length; i++) {
      var w = kw[i];
      if (blobHasKeyword(catN, w)) {
        score += 100;
        r.push("category: «" + w + "»");
      }
    }
    for (i = 0; i < kw.length; i++) {
      w = kw[i];
      if (blobHasKeyword(descN, w)) {
        score += 10;
        r.push("description: «" + w + "»");
      }
    }
    for (i = 0; i < kw.length; i++) {
      w = kw[i];
      if (blobHasKeyword(nameN, w)) {
        score += 50;
        r.push("name: «" + w + "»");
      }
    }
    for (i = 0; i < kw.length; i++) {
      w = kw[i];
      if (blobHasKeyword(ansN, w)) {
        score += 1;
        r.push("answers: «" + w + "»");
      }
    }

    if (shouldExcludeForSituation(sitKey, fullN)) {
      r.push("исключён: найдены маркеры другой темы");
      return { score: -1, reasons: r };
    }

    if (phase === "keywords") {
      var hasKw = false;
      for (i = 0; i < kw.length; i++) {
        w = kw[i];
        if (blobHasKeyword(catN, w) || blobHasKeyword(descN, w) || blobHasKeyword(nameN, w)) {
          hasKw = true;
          break;
        }
      }
      if (!hasKw) {
        return { score: 0, reasons: r.concat(["нет ключевых слов в category/description/name"]) };
      }
    }

    return { score: score, reasons: r };
  }

  function matchSituationStrict(situationName, answersJoined, maxOut) {
    var sitKey = getSituationConfigKey(situationName);
    var cfg = SITUATION_MATCH_CONFIG[sitKey];
    if (!cfg) return [];

    var joined = String(answersJoined || "");
    var scored = [];
    var withWrongTags = [];

    state.products.forEach(function (p) {
      var sits = Array.isArray(p.situations) ? p.situations : [];
      var hasAnyTag = sits.length > 0;
      var tagHit = productHasSituationTag(p, situationName);

      if (hasAnyTag && !tagHit) {
        withWrongTags.push(p.id);
        return;
      }

      if (tagHit) {
        var normFull = normalizeTokensBlob(productSearchBlob(p));
        if (shouldExcludeForSituation(sitKey, normFull)) return;
        var sr = scoreProductStrict(sitKey, p, joined, "situations", []);
        if (sr.score >= 10000) {
          scored.push({ p: p, s: sr.score, reasons: sr.reasons });
        }
        return;
      }

      if (!hasAnyTag) {
        var normFull2 = normalizeTokensBlob(productSearchBlob(p));
        if (shouldExcludeForSituation(sitKey, normFull2)) return;
        var sr2 = scoreProductStrict(sitKey, p, joined, "keywords", []);
        if (sr2.score > 0 && sr2.score !== -1) {
          scored.push({ p: p, s: sr2.score, reasons: sr2.reasons });
        }
      }
    });

    scored.sort(function (a, b) {
      return b.s - a.s;
    });
    var top = scored.slice(0, maxOut);

    console.log("[CandleMatch] выбранная ситуация:", situationName, "→ канон:", sitKey);
    console.log("[CandleMatch] режим: строгий; кандидатов после фильтра:", scored.length, "; лимит:", maxOut);
    if (withWrongTags.length) {
      console.log("[CandleMatch] отброшены товары с другим situations (не показываем):", withWrongTags.length, "шт.");
    }
    top.forEach(function (row) {
      console.log(
        "[CandleMatch] товар:",
        row.p.name,
        "| id:",
        row.p.id,
        "| score:",
        row.s,
        "| причина:",
        (row.reasons || []).join("; ")
      );
    });

    return top.map(function (x) {
      return x.p;
    });
  }

  /** Нестрогие карточки (кастомные ситуации): по карте keywordMap из HTML. */
  function matchSituationLoose(situationName, answersJoined, keywordMap, maxOut) {
    var joined = String(answersJoined || "").toLowerCase();
    var blobBase = function (p) {
      return ((p.category || "") + " " + (p.descriptionPlain || "") + " " + (p.name || "")).toLowerCase();
    };
    var map = keywordMap && typeof keywordMap === "object" ? keywordMap : {};
    var roots = map[situationName] || [situationName];
    var arr = Array.isArray(roots) ? roots : [situationName];

    var scored = state.products
      .map(function (p) {
        var blob = blobBase(p);
        var s = 0;
        arr.forEach(function (root) {
          var r = String(root || "").toLowerCase();
          if (r.length >= 3 && blob.indexOf(r) !== -1) s += 8;
          if (r.length >= 3 && joined.indexOf(r) !== -1) s += 3;
        });
        var sit = String(situationName || "").toLowerCase();
        if (sit.length >= 3 && blob.indexOf(sit) !== -1) s += 5;
        return { p: p, s: s, reasons: s > 0 ? ["loose: keywordMap + текст"] : [] };
      })
      .filter(function (x) {
        return x.s > 0;
      })
      .sort(function (a, b) {
        return b.s - a.s;
      })
      .slice(0, maxOut);

    console.log("[CandleMatch] выбранная ситуация (loose):", situationName);
    scored.forEach(function (row) {
      console.log("[CandleMatch] товар:", row.p.name, "| score:", row.s, "| причина:", (row.reasons || []).join("; "));
    });

    return scored.map(function (x) {
      return x.p;
    });
  }

  function matchSituation(situationName, userAnswers, keywordMap, limit) {
    var max = Math.min(Math.max(Number(limit) || 6, 1), 6);
    var joined = (userAnswers || []).join(" ");
    if (isStrictCardSituation(situationName)) {
      return matchSituationStrict(situationName, joined, max);
    }
    return matchSituationLoose(situationName, joined, keywordMap, max);
  }

  /** @deprecated оставлено для совместимости; не используется в подборе по карточкам. */
  function scoreForSituation(situationName, answersJoined, product, keywordMap) {
    const blob = ((product.category || "") + " " + product.descriptionPlain).toLowerCase();
    const extra = (answersJoined || "").toLowerCase();
    let score = 0;
    const map = keywordMap && typeof keywordMap === "object" ? keywordMap : {};
    const roots = map[situationName] || [situationName];
    (Array.isArray(roots) ? roots : [situationName]).forEach(function (root) {
      const r = String(root || "").toLowerCase();
      if (r.length >= 3 && blob.includes(r)) score += 8;
      if (r.length >= 3 && extra.includes(r)) score += 3;
    });
    const sit = String(situationName || "").toLowerCase();
    if (sit.length >= 3 && blob.includes(sit)) score += 5;
    return score;
  }

  function matchByText(userText, keywordMap, limit) {
    const max = limit || 20;
    const text = String(userText || "").toLowerCase().trim();
    if (!text) return [];
    const tokens = text.split(/[^a-zа-яё0-9]+/i).filter(function (w) {
      return w.length >= 4;
    });
    const map = keywordMap && typeof keywordMap === "object" ? keywordMap : {};

    const scored = state.products.map(function (p) {
      let score = 0;
      const blob = (
        (p.name || "") +
        " " +
        (p.category || "") +
        " " +
        (p.descriptionPlain || "")
      ).toLowerCase();

      Object.keys(map).forEach(function (sit) {
        const roots = map[sit] || [];
        (Array.isArray(roots) ? roots : []).forEach(function (root) {
          const r = String(root || "").toLowerCase();
          if (r.length >= 3 && text.includes(r) && blob.includes(r)) score += 6;
        });
        const sl = String(sit).toLowerCase();
        if (sl.length >= 4 && text.includes(sl) && blob.includes(sl)) score += 4;
      });

      tokens.forEach(function (t) {
        if (blob.includes(t)) score += 1;
      });

      return { p: p, s: score };
    });

    return scored
      .filter(function (x) {
        return x.s > 0;
      })
      .sort(function (a, b) {
        return b.s - a.s;
      })
      .slice(0, max)
      .map(function (x) {
        return x.p;
      });
  }

  /** Всегда путь от корня сайта, чтобы fetch работал с любой страницы (в т.ч. /Подбор свечи.html). */
  function defaultCatalogUrl() {
    if (typeof window === "undefined" || !window.location) return "/data/candles.json";
    var origin = window.location.origin;
    if (!origin || origin === "null") return "data/candles.json";
    try {
      return new URL("/data/candles.json", origin).href;
    } catch (e) {
      return "/data/candles.json";
    }
  }

  function load(jsonUrl) {
    state.error = null;
    const url = jsonUrl || defaultCatalogUrl();
    return fetch(url, { credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        const arr = Array.isArray(data) ? data : [];
        state.products = arr.map(normalizeRaw).filter(Boolean);
        state.loaded = true;
        state.error = null;
        return state.products;
      })
      .catch(function (e) {
        state.loaded = false;
        state.products = [];
        state.error = e.message || String(e);
        throw e;
      });
  }

  function findProductById(id) {
    const sid = String(id || "").trim();
    if (!sid) return null;
    for (let i = 0; i < state.products.length; i++) {
      if (state.products[i].id === sid) return state.products[i];
    }
    return null;
  }

  function reload(jsonUrl) {
    state.loaded = false;
    state.products = [];
    state.error = null;
    return load(jsonUrl);
  }

  global.CandleCatalog = {
    load: load,
    reload: reload,
    matchSituation: matchSituation,
    matchByText: matchByText,
    findById: findProductById,
    get products() {
      return state.products.slice();
    },
    get loaded() {
      return state.loaded;
    },
    get error() {
      return state.error;
    },
    toLegacyCandle: function (p) {
      if (!p) return null;
      const imgs = Array.isArray(p.images) && p.images.length ? p.images : p.image ? [p.image] : [];
      const normImgs = imgs.map(function (x) {
        return normalizeImagePath(x);
      }).filter(Boolean);
      return {
        id: p.id,
        name: p.name,
        category: p.category,
        shortDescription: p.shortPlain || excerpt(p.descriptionPlain || "", 220),
        fullDescription: p.descriptionPlain || stripHtml(p.descriptionHtml || ""),
        situation: Array.isArray(p.situations) ? p.situations.join(", ") : "",
        situations: Array.isArray(p.situations) ? p.situations.slice() : [],
        benefits: Array.isArray(p.benefits) ? p.benefits.slice() : [],
        usage: p.recommendation || "",
        buyLink: p.url || p.buyLink || "",
        image: normalizeImagePath(p.image || normImgs[0] || ""),
        price: p.price ? Number(p.price) : null,
        _catalog: true,
        _images: normImgs,
      };
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
