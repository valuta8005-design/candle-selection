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
    const s = String(p || "")
      .trim()
      .replace(/\\/g, "/");
    if (!s) return "";
    if (/^https?:\/\//i.test(s)) return s;
    if (s.startsWith("images/")) return s;
    if (s.includes("/")) return s;
    return "images/" + s;
  }

  function normalizeRaw(p) {
    if (!p || typeof p !== "object") return null;
    const images = Array.isArray(p.images)
      ? p.images.map(normalizeImagePath).filter(Boolean)
      : [];
    const descPlain = stripHtml(p.description || "");
    return {
      id: String(p.id || "").trim(),
      name: String(p.name || "").trim(),
      sku: String(p.sku || "").trim(),
      price: p.price != null && p.price !== "" ? String(p.price) : "",
      category: String(p.category || "").trim(),
      descriptionPlain: descPlain,
      shortPlain: excerpt(descPlain, 220),
      images: images,
      image: images[0] || "",
      url: String(p.url || "").trim(),
    };
  }

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

  function matchSituation(situationName, userAnswers, keywordMap, limit) {
    const max = limit || 24;
    const joined = (userAnswers || []).join(" ");
    const scored = state.products
      .map(function (p) {
        return { p: p, s: scoreForSituation(situationName, joined, p, keywordMap) };
      })
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
    return scored;
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

  global.CandleCatalog = {
    load: load,
    matchSituation: matchSituation,
    matchByText: matchByText,
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
      return {
        id: p.id,
        name: p.name,
        category: p.category,
        shortDescription: p.shortPlain,
        fullDescription: p.descriptionPlain,
        situation: "",
        situations: [],
        benefits: [],
        usage: "",
        buyLink: p.url,
        image: p.image || "",
        price: p.price ? Number(p.price) : null,
        _catalog: true,
        _images: p.images,
      };
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
