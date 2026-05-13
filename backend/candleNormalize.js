/**
 * Единая нормализация записи свечи из candles.json.
 * Поддерживает:
 *   — новую схему: id, name, category, image, shortDescription, description,
 *     situations[], recommendation, price, buyLink
 *   — старую схему бота: salesPitch, benefits, usage, upsell
 *
 * Используется в backend/server.js и в bot/bot.js (через require).
 */

const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");

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
 * Источник картинки для Telegram (sendPhoto).
 *  — http(s)-URL пропускаем как есть;
 *  — относительный путь images/... превращаем в полный URL, если задан PUBLIC_BASE_URL,
 *    иначе пытаемся отдать абсолютный путь к файлу на диске —
 *    node-telegram-bot-api загрузит его как файл.
 */
function resolveImageUrlForTelegram(image) {
  const s = normalizeRelativeImagePath(image);
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  const rel = s.replace(/^\.?\/+/, "");
  if (base) {
    return base + "/" + rel;
  }
  const abs = path.join(ROOT, rel);
  if (fs.existsSync(abs)) return abs;
  return rel;
}

/**
 * Локальный путь к картинке для браузера: http(s) без изменений;
 * схлопывание images/images/…; при отсутствии префикса images/ — добавить для файлов из каталога.
 */
function normalizeRelativeImagePath(s) {
  let t = String(s == null ? "" : s).trim().replace(/\\/g, "/");
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t;
  t = t.replace(/^\.?\/*/, "");
  while (/^images\/images\//i.test(t)) {
    t = t.replace(/^images\/images\//i, "images/");
  }
  if (/^images\//i.test(t)) return t;
  if (t.includes("/")) return t;
  return "images/" + t.replace(/^\/+/, "");
}

/**
 * URL для браузера: относительные пути нормализуем под статику с корня сайта.
 */
function resolveImageUrlForWeb(image) {
  return normalizeRelativeImagePath(image);
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
  const rawImg =
    (c.image && String(c.image).trim()) ||
    (Array.isArray(c.images) && c.images.length ? String(c.images[0]).trim() : "");
  const image = resolveImageUrlForTelegram(rawImg);
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
  const rawImg =
    (c.image && String(c.image).trim()) ||
    (Array.isArray(c.images) && c.images.length ? String(c.images[0]).trim() : "");
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
    image: resolveImageUrlForWeb(rawImg),
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
