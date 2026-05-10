/**
 * Backend «Волшебный огонь».
 *
 * Назначение:
 *  - принимает заявку от фронтенда (POST /api/send-telegram)
 *  - отправляет уведомление в Telegram админу
 *  - сохраняет заявку в leads.json (локальный CRM-минимум)
 *  - отдаёт публичные данные (категории/свечи/конфиг) для фронта
 *  - сервит статику с веб-приложением подбора свечи
 *
 * Запуск: npm run server  (или из корня — node backend/server.js)
 */

const path = require("path");

// .env лежит в корне проекта (на уровень выше /backend)
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const fs = require("fs");
const express = require("express");
const cors = require("cors");
const { normalizeForWeb } = require("./candleNormalize");

const ROOT = path.join(__dirname, "..");
const CANDLES_FILE = path.join(ROOT, "candles.json");
const LEADS_FILE = path.join(ROOT, "leads.json");
const EVENTS_FILE = path.join(ROOT, "events.json");

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TG_CHAT = process.env.TELEGRAM_CHAT_ID || "";
const TG_BOT_USERNAME = (process.env.TELEGRAM_BOT_USERNAME || "").replace(/^@/, "");
const PORT = parseInt(process.env.PORT || "3000", 10);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

const app = express();
app.use(express.json({ limit: "12mb" }));
app.use(
  cors({
    origin: ALLOWED_ORIGIN === "*" ? true : ALLOWED_ORIGIN.split(",").map(s => s.trim()),
  })
);

/* ---------- helpers ---------- */

function loadCandles() {
  try {
    return JSON.parse(fs.readFileSync(CANDLES_FILE, "utf8"));
  } catch (e) {
    console.error("Не удалось прочитать candles.json:", e.message);
    return { candles: [], categories: [], messages: {}, brand: {} };
  }
}

/** Сохранить весь объект candles.json (brand, messages, categories, candles). */
function saveCandlesData(data) {
  fs.writeFileSync(CANDLES_FILE, JSON.stringify(data, null, 2), "utf8");
}

/** Слияние массива свечей по id (новые добавляются, существующие перезаписываются). */
function mergeCandles(existingList, incomingList) {
  const map = new Map();
  (existingList || []).forEach(c => {
    if (c && c.id) map.set(c.id, { ...c });
  });
  (incomingList || []).forEach(c => {
    if (c && c.id) map.set(c.id, { ...map.get(c.id), ...c });
  });
  return Array.from(map.values());
}

function escapeHtml(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function appendJsonFile(file, item) {
  try {
    let arr = [];
    if (fs.existsSync(file)) {
      arr = JSON.parse(fs.readFileSync(file, "utf8") || "[]");
      if (!Array.isArray(arr)) arr = [];
    }
    arr.push(item);
    fs.writeFileSync(file, JSON.stringify(arr, null, 2), "utf8");
  } catch (e) {
    console.error("Файл лога не записан:", file, e.message);
  }
}

async function sendTelegramMessage(text, opts = {}) {
  if (!TG_TOKEN || !TG_CHAT) {
    console.warn("[telegram] TOKEN/CHAT_ID не заданы — сообщение пропущено.");
    return { ok: false, skipped: true };
  }
  const url = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
  const body = {
    chat_id: TG_CHAT,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: opts.disable_web_page_preview !== false,
  };
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return await r.json();
  } catch (e) {
    console.error("[telegram] sendMessage error:", e.message);
    return { ok: false, error: e.message };
  }
}

/* ---------- public endpoints ---------- */

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "candle-selection-backend", time: new Date().toISOString() });
});

app.get("/api/config", (req, res) => {
  const data = loadCandles();
  res.json({
    brand: data.brand || {},
    botLink: TG_BOT_USERNAME ? `https://t.me/${TG_BOT_USERNAME}` : null,
    botUsername: TG_BOT_USERNAME || null,
    categories: data.categories || [],
  });
});

/** Каталог для веб-приложения: нормализованные поля + цена. */
app.get("/api/candles", (req, res) => {
  const data = loadCandles();
  const list = (data.candles || []).map(c => normalizeForWeb(c)).filter(Boolean);
  res.json({ candles: list });
});

/**
 * POST /api/admin/candle — добавить или обновить одну свечу в candles.json.
 * body: объект свечи в канонической схеме (см. candles-import-template.json).
 */
app.post("/api/admin/candle", (req, res) => {
  try {
    const incoming = req.body;
    if (!incoming || !incoming.id) {
      return res.status(400).json({ ok: false, error: "Поле id обязательно." });
    }
    const data = loadCandles();
    const list = data.candles || [];
    const idx = list.findIndex(c => c.id === incoming.id);
    if (idx >= 0) list[idx] = { ...list[idx], ...incoming };
    else list.push(incoming);
    data.candles = list;
    saveCandlesData(data);
    res.json({ ok: true, count: list.length });
  } catch (e) {
    console.error("[/api/admin/candle]", e);
    res.status(500).json({ ok: false, error: String(e.message) });
  }
});

/**
 * POST /api/admin/import — массовый импорт свечей из JSON.
 * body: { "candles": [ {...}, ... ], "mode": "merge" | "replace" }
 *   merge    — объединить по id с текущим каталогом (по умолчанию)
 *   replace  — полностью заменить массив candles (brand/messages/categories не трогаем)
 */
app.post("/api/admin/import", (req, res) => {
  try {
    const { candles: incoming = [], mode = "merge" } = req.body || {};
    if (!Array.isArray(incoming) || !incoming.length) {
      return res.status(400).json({ ok: false, error: "Ожидается { candles: [ ... ] }." });
    }
    const data = loadCandles();
    if (mode === "replace") {
      data.candles = incoming;
    } else {
      data.candles = mergeCandles(data.candles, incoming);
    }
    saveCandlesData(data);
    res.json({ ok: true, total: (data.candles || []).length, mode });
  } catch (e) {
    console.error("[/api/admin/import]", e);
    res.status(500).json({ ok: false, error: String(e.message) });
  }
});

/** Скачать шаблон JSON для массового импорта. */
app.get("/api/candles-import-template.json", (req, res) => {
  const p = path.join(ROOT, "candles-import-template.json");
  if (fs.existsSync(p)) {
    return res.sendFile(p);
  }
  res.status(404).json({ ok: false, error: "Шаблон не найден" });
});

/**
 * DELETE /api/admin/candle/:id — удалить свечу из candles.json.
 */
app.delete("/api/admin/candle/:id", (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ ok: false, error: "Нужен id." });
    const data = loadCandles();
    const before = (data.candles || []).length;
    data.candles = (data.candles || []).filter(c => c && c.id !== id);
    if (data.candles.length === before) {
      return res.status(404).json({ ok: false, error: "Свеча не найдена." });
    }
    saveCandlesData(data);
    res.json({ ok: true, count: data.candles.length });
  } catch (e) {
    console.error("[DELETE /api/admin/candle]", e);
    res.status(500).json({ ok: false, error: String(e.message) });
  }
});

/**
 * POST /api/send-telegram
 * body: { name, phone, contact, situation, recommendedCandle, recommendedCandleId, comment, source }
 */
app.post("/api/send-telegram", async (req, res) => {
  try {
    const {
      name = "",
      phone = "",
      contact = "",
      situation = "",
      recommendedCandle = "",
      recommendedCandleId = "",
      comment = "",
      source = "frontend",
    } = req.body || {};

    if (!String(name).trim() || (!String(phone).trim() && !String(contact).trim())) {
      return res.status(400).json({
        ok: false,
        error: "Укажите имя и хотя бы один контакт (телефон или Telegram/WhatsApp).",
      });
    }

    // Сохраняем в leads.json
    const lead = {
      id: "L-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
      name: String(name).slice(0, 200),
      phone: String(phone).slice(0, 60),
      contact: String(contact).slice(0, 200),
      situation: String(situation).slice(0, 1000),
      recommendedCandle: String(recommendedCandle).slice(0, 200),
      recommendedCandleId: String(recommendedCandleId).slice(0, 80),
      comment: String(comment).slice(0, 2000),
      source: String(source).slice(0, 60),
      createdAt: new Date().toISOString(),
    };
    appendJsonFile(LEADS_FILE, lead);

    // Сообщение в Telegram админу
    const text =
      "🔥 <b>Новый клиент</b>\n\n" +
      `👤 <b>Имя:</b> ${escapeHtml(lead.name)}\n` +
      `📞 <b>Телефон:</b> ${escapeHtml(lead.phone || "—")}\n` +
      `💬 <b>Контакт:</b> ${escapeHtml(lead.contact || "—")}\n` +
      `🌙 <b>Ситуация:</b> ${escapeHtml(lead.situation || "—")}\n` +
      `🕯 <b>Интерес:</b> ${escapeHtml(lead.recommendedCandle || "—")}\n` +
      `💭 <b>Комментарий:</b> ${escapeHtml(lead.comment || "—")}\n\n` +
      `🆔 ${escapeHtml(lead.id)}\n` +
      `🕒 ${escapeHtml(new Date(lead.createdAt).toLocaleString("ru-RU"))}\n` +
      `📥 source: ${escapeHtml(lead.source)}`;

    const tg = await sendTelegramMessage(text);

    // Глубокая ссылка в бот: если есть рекомендованная свеча — передаём её id
    const start = lead.recommendedCandleId ? `?start=${encodeURIComponent(lead.recommendedCandleId)}` : "";
    const botLink = TG_BOT_USERNAME ? `https://t.me/${TG_BOT_USERNAME}${start}` : null;

    res.json({ ok: true, leadId: lead.id, telegram: tg.ok !== false, botLink });
  } catch (e) {
    console.error("[/api/send-telegram] error:", e);
    res.status(500).json({ ok: false, error: "Внутренняя ошибка сервера" });
  }
});

/**
 * POST /api/track
 * Произвольное событие (нажал «Купить», выбрал категорию и т.п.) — лог + опц. уведомление.
 * body: { type, candleId?, category?, name?, contact?, meta? }
 */
app.post("/api/track", async (req, res) => {
  try {
    const { type = "event", candleId = "", category = "", name = "", contact = "", meta = {} } = req.body || {};

    const event = {
      id: "E-" + Date.now().toString(36),
      type: String(type).slice(0, 60),
      candleId: String(candleId).slice(0, 80),
      category: String(category).slice(0, 80),
      name: String(name).slice(0, 200),
      contact: String(contact).slice(0, 200),
      meta,
      createdAt: new Date().toISOString(),
    };
    appendJsonFile(EVENTS_FILE, event);

    // Уведомляем админа только об интересных событиях
    if (["buy_click", "category_select", "lead_open_bot"].includes(event.type)) {
      const text =
        `📌 <b>Событие:</b> ${escapeHtml(event.type)}\n` +
        (event.candleId ? `🕯 Свеча: ${escapeHtml(event.candleId)}\n` : "") +
        (event.category ? `🌙 Категория: ${escapeHtml(event.category)}\n` : "") +
        (event.name ? `👤 ${escapeHtml(event.name)}\n` : "") +
        (event.contact ? `💬 ${escapeHtml(event.contact)}\n` : "") +
        `🕒 ${escapeHtml(new Date(event.createdAt).toLocaleString("ru-RU"))}`;
      await sendTelegramMessage(text);
    }

    res.json({ ok: true, eventId: event.id });
  } catch (e) {
    console.error("[/api/track] error:", e);
    res.status(500).json({ ok: false, error: "Внутренняя ошибка" });
  }
});

/* ---------- статический фронтенд ---------- */

app.use(express.static(ROOT, { index: ["index.html"] }));

// На корне приложения отдаём «Подбор свечи.html», если index.html пустой/отсутствует
app.get("/", (req, res, next) => {
  const indexPath = path.join(ROOT, "index.html");
  try {
    const stat = fs.statSync(indexPath);
    if (stat.size > 0) return next();
  } catch (e) {}
  res.sendFile(path.join(ROOT, "Подбор свечи.html"));
});

/* ---------- start ---------- */

app.listen(PORT, () => {
  console.log(`🟢 Backend запущен:        http://localhost:${PORT}`);
  console.log(`   API health:              http://localhost:${PORT}/api/health`);
  console.log(`   Telegram TOKEN:          ${TG_TOKEN ? "OK" : "❌ не задан в .env"}`);
  console.log(`   Telegram CHAT_ID:        ${TG_CHAT ? "OK" : "❌ не задан в .env"}`);
  console.log(`   Bot username:            ${TG_BOT_USERNAME || "(не задан)"}`);
});
