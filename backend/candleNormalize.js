/**
 * Единая нормализация записи свечи из candles.json.
 * Поддерживает:
 *   — новую схему: id, name, category, image, shortDescription, description,
 *     situations[], recommendation, price, buyLink
 *   — старую схему бота: salesPitch, benefits, usage, upsell
 *
 * Используется в backend/server.js и в bot/bot.js (через require).
 */

/**
 * Разбор поля «ситуации»: массив строк ИЛИ одна строка через запятую.
 */
function parseSituations(c) {
  if (Array.isArray(c.situations)) {
    return c.situations.map(s => String(s).trim()).filter(Boolean);
  }
  if (typeof c.situation === "string" && c.situation.trim()) {
    return c.situation
      .split(/[,;]+/)
      .map(s => s.trim().replace(/\.$/, ""))
      .filter(Boolean);
  }
  return [];
}

/**
 * Абсолютный URL картинки для Telegram (sendPhoto).
 * Локальные пути images/... требуют PUBLIC_BASE_URL (например https://ваш-сайт.ru).
 */
function resolveImageUrlForTelegram(image) {
  const s = String(image == null ? "" : image).trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  if (!base) return s.startsWith("/") ? s : `/${s.replace(/^\.\//, "")}`;
  return base + (s.startsWith("/") ? s : `/${s.replace(/^\.\//, "")}`);
}

/**
 * URL для браузера: относительные пути оставляем как есть (от корня сайта).
 */
function resolveImageUrlForWeb(image) {
  const s = String(image == null ? "" : image).trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  return s.replace(/^\.\//, "");
}

function deriveBenefits(c, situations) {
  if (Array.isArray(c.benefits) && c.benefits.length) return c.benefits.map(String);
  if (situations.length) return situations.slice(0, 8);
  const text = c.description || c.salesPitch || c.fullDescription || "";
  return text
    .split(/(?<=[.!?])\s+/)
    .map(x => x.trim())
    .filter(x => x.length > 12)
    .slice(0, 4);
}

/**
 * Нормализация для Telegram-бота (поля salesPitch, benefits, usage, image URL).
 */
function normalizeForBot(c) {
  if (!c || typeof c !== "object") return null;
  const situations = parseSituations(c);
  const description =
    c.description != null && c.description !== ""
      ? String(c.description)
      : c.salesPitch || c.fullDescription || "";
  const recommendation =
    c.recommendation != null && c.recommendation !== ""
      ? String(c.recommendation)
      : c.usage || "";
  const benefits = deriveBenefits(c, situations);
  const salesPitch = c.salesPitch && c.salesPitch !== "" ? String(c.salesPitch) : description;
  const image = resolveImageUrlForTelegram(c.image);
  return {
    ...c,
    id: c.id || "",
    name: c.name || "",
    category: c.category || "",
    shortDescription: c.shortDescription || "",
    salesPitch,
    benefits,
    usage: recommendation,
    buyLink: c.buyLink || c.link || "",
    image,
    price: c.price != null ? c.price : null,
    upsell: Array.isArray(c.upsell) ? c.upsell : [],
    situations,
  };
}

/**
 * Нормализация для веб-приложения (текущий UI: situation строкой, fullDescription, usage, benefits).
 */
function normalizeForWeb(c) {
  if (!c || typeof c !== "object") return null;
  const situations = parseSituations(c);
  const description =
    c.description != null && c.description !== ""
      ? String(c.description)
      : c.salesPitch || c.fullDescription || "";
  const recommendation =
    c.recommendation != null && c.recommendation !== ""
      ? String(c.recommendation)
      : c.usage || "";
  const benefits = deriveBenefits(c, situations);
  const situationStr = situations.join(", ");
  return {
    id: c.id || "",
    name: c.name || "",
    category: c.category || "",
    shortDescription: c.shortDescription || "",
    fullDescription: description,
    situation: situationStr,
    situations,
    benefits,
    usage: recommendation,
    buyLink: c.buyLink || c.link || "",
    image: resolveImageUrlForWeb(c.image),
    price: c.price != null ? Number(c.price) : null,
    upsell: Array.isArray(c.upsell) ? c.upsell : [],
  };
}

module.exports = {
  parseSituations,
  normalizeForBot,
  normalizeForWeb,
  resolveImageUrlForTelegram,
  resolveImageUrlForWeb,
};
