/**
 * Telegram-бот «Волшебный огонь» — мини-консультант и продавец свечей.
 *
 * Возможности:
 *  - /start — приветствие + меню категорий
 *  - /start <candleId> — глубокая ссылка из приложения: сразу карточка свечи
 *  - выбор категории → карточка рекомендованной свечи (фото + текст + кнопки)
 *  - подсветка «с этой свечой берут» (upsell)
 *  - кнопка «Купить» ведёт на сайт магазина
 *  - кнопка «Оставить заявку» — собирает имя/контакт/комментарий пошагово
 *  - все важные события дублируются админу в Telegram
 *
 * Запуск: npm run bot  (или из корня — node bot/bot.js)
 */

const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const fs = require("fs");
const TelegramBot = require("node-telegram-bot-api");

const ROOT = path.join(__dirname, "..");
const CANDLES_FILE = path.join(ROOT, "candles.json");
const LEADS_FILE = path.join(ROOT, "leads.json");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const ADMIN_CHAT = process.env.TELEGRAM_CHAT_ID || "";

if (!TOKEN) {
  console.error("❌ TELEGRAM_BOT_TOKEN не задан в .env. Бот не запущен.");
  process.exit(1);
}

let DATA = loadData();

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(CANDLES_FILE, "utf8"));
  } catch (e) {
    console.error("Не удалось прочитать candles.json:", e.message);
    return { candles: [], categories: [], messages: {} };
  }
}

function getCandle(id) {
  return (DATA.candles || []).find(c => c.id === id) || null;
}

function getCategoryByKey(key) {
  return (DATA.categories || []).find(c => c.key === key) || null;
}

function escapeHtml(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function appendLead(item) {
  try {
    let arr = [];
    if (fs.existsSync(LEADS_FILE)) {
      arr = JSON.parse(fs.readFileSync(LEADS_FILE, "utf8") || "[]");
      if (!Array.isArray(arr)) arr = [];
    }
    arr.push(item);
    fs.writeFileSync(LEADS_FILE, JSON.stringify(arr, null, 2), "utf8");
  } catch (e) {
    console.error("leads.json write error:", e.message);
  }
}

const bot = new TelegramBot(TOKEN, { polling: true });

console.log("🟢 Бот запущен (long polling).");

/* ---------- клавиатуры ---------- */

function categoriesKeyboard() {
  const rows = [];
  const cats = DATA.categories || [];
  for (let i = 0; i < cats.length; i += 2) {
    rows.push(
      cats.slice(i, i + 2).map(c => ({ text: c.label, callback_data: `cat:${c.key}` }))
    );
  }
  rows.push([{ text: "🔥 Подбор свечи", callback_data: "help" }]);
  rows.push([{ text: "📝 Оставить заявку", callback_data: "lead:start" }]);
  return { inline_keyboard: rows };
}

function candleKeyboard(candle) {
  const rows = [
    [{ text: "🛒 Купить свечу", url: candle.buyLink }],
    [{ text: "✨ С этой свечой берут", callback_data: `upsell:${candle.id}` }],
    [{ text: "📝 Оставить заявку", callback_data: `lead:start:${candle.id}` }],
    [{ text: "🔥 Подобрать ещё", callback_data: "menu" }],
  ];
  return { inline_keyboard: rows };
}

function upsellKeyboard(candle) {
  const ids = (candle.upsell || []).slice(0, 3);
  const rows = ids
    .map(id => getCandle(id))
    .filter(Boolean)
    .map(c => [
      { text: `🕯 ${c.name}`, callback_data: `card:${c.id}` },
      { text: "🛒 Купить", url: c.buyLink },
    ]);
  rows.push([{ text: "🔥 Подобрать ещё", callback_data: "menu" }]);
  return { inline_keyboard: rows };
}

/* ---------- сообщения ---------- */

function buildCandleCaption(candle) {
  const intro = (DATA.messages.categoryIntro || "✨ Для темы «{category}» рекомендуем:")
    .replace("{category}", candle.category || "");

  const benefits = (candle.benefits || []).map(b => `— ${b}`).join("\n");

  return (
    `${intro}\n\n` +
    `🕯 <b>${escapeHtml(candle.name)}</b>\n\n` +
    `${escapeHtml(candle.shortDescription || "")}\n\n` +
    (benefits ? `<b>Что помогает:</b>\n${escapeHtml(benefits)}\n\n` : "") +
    (candle.salesPitch ? `${escapeHtml(candle.salesPitch)}` : "")
  ).trim();
}

async function sendCandleCard(chatId, candle) {
  const caption = buildCandleCaption(candle);
  const keyboard = candleKeyboard(candle);

  // Telegram: caption ≤ 1024 симв. Если длиннее — отправляем фото без текста, потом текст отдельно.
  if (candle.image && caption.length <= 1024) {
    return bot.sendPhoto(chatId, candle.image, {
      caption,
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  }
  if (candle.image) {
    await bot.sendPhoto(chatId, candle.image, {}).catch(() => {});
  }
  return bot.sendMessage(chatId, caption, {
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: keyboard,
  });
}

async function sendUpsell(chatId, candle) {
  const text =
    (DATA.messages.upsellTitle || "✨ С этой свечой часто выбирают:") +
    "\n\n" +
    (candle.upsell || [])
      .map(id => getCandle(id))
      .filter(Boolean)
      .map(c => `— <b>${escapeHtml(c.name)}</b> — ${escapeHtml(c.shortDescription || "")}`)
      .join("\n");

  return bot.sendMessage(chatId, text, {
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: upsellKeyboard(candle),
  });
}

async function notifyAdmin(text) {
  if (!ADMIN_CHAT) return;
  try {
    await bot.sendMessage(ADMIN_CHAT, text, { parse_mode: "HTML", disable_web_page_preview: true });
  } catch (e) {
    console.error("notifyAdmin error:", e.message);
  }
}

function userTag(user) {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
  const handle = user.username ? `@${user.username}` : `id:${user.id}`;
  return `${escapeHtml(name)} (${escapeHtml(handle)})`;
}

/* ---------- состояние диалога заявки ---------- */
/**
 * leadDialogs[chatId] = {
 *   step: "name" | "contact" | "comment" | "done",
 *   candleId: string,
 *   data: { name, contact, comment }
 * }
 */
const leadDialogs = {};

function startLead(chatId, candleId = "") {
  leadDialogs[chatId] = { step: "name", candleId, data: {} };
  return bot.sendMessage(chatId, "Как вас зовут?", {
    reply_markup: { force_reply: true, selective: false },
  });
}

async function handleLeadInput(msg) {
  const chatId = msg.chat.id;
  const dlg = leadDialogs[chatId];
  if (!dlg) return false;

  const text = (msg.text || "").trim();
  if (!text) return true;

  if (dlg.step === "name") {
    dlg.data.name = text.slice(0, 200);
    dlg.step = "contact";
    await bot.sendMessage(chatId, "Оставьте телефон или Telegram/WhatsApp для связи:", {
      reply_markup: { force_reply: true },
    });
    return true;
  }

  if (dlg.step === "contact") {
    dlg.data.contact = text.slice(0, 200);
    dlg.step = "comment";
    await bot.sendMessage(chatId, "Коротко опишите ситуацию или вопрос (или напишите «-», если без комментария):", {
      reply_markup: { force_reply: true },
    });
    return true;
  }

  if (dlg.step === "comment") {
    dlg.data.comment = (text === "-" ? "" : text).slice(0, 2000);
    const candle = dlg.candleId ? getCandle(dlg.candleId) : null;

    const lead = {
      id: "L-" + Date.now().toString(36),
      name: dlg.data.name || "",
      phone: "",
      contact: dlg.data.contact || "",
      situation: candle ? candle.category : "",
      recommendedCandle: candle ? candle.name : "",
      recommendedCandleId: candle ? candle.id : "",
      comment: dlg.data.comment || "",
      source: "telegram-bot",
      tgUser: userTag(msg.from),
      createdAt: new Date().toISOString(),
    };
    appendLead(lead);

    const adminText =
      "🔥 <b>Новый клиент (из бота)</b>\n\n" +
      `👤 <b>Имя:</b> ${escapeHtml(lead.name)}\n` +
      `💬 <b>Контакт:</b> ${escapeHtml(lead.contact)}\n` +
      `🌙 <b>Ситуация:</b> ${escapeHtml(lead.situation || "—")}\n` +
      `🕯 <b>Интерес:</b> ${escapeHtml(lead.recommendedCandle || "—")}\n` +
      `💭 <b>Комментарий:</b> ${escapeHtml(lead.comment || "—")}\n\n` +
      `🧑‍💼 TG: ${lead.tgUser}\n` +
      `🆔 ${escapeHtml(lead.id)}`;
    await notifyAdmin(adminText);

    delete leadDialogs[chatId];
    await bot.sendMessage(chatId, DATA.messages.thanks || "Спасибо! Заявка получена.", {
      reply_markup: categoriesKeyboard(),
    });
    return true;
  }

  return false;
}

/* ---------- /start ---------- */

bot.onText(/^\/start(?:\s+(.+))?$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const startParam = (match[1] || "").trim();

  // diagnostic helper: если админ прописывает /start — он увидит chat_id в логах
  console.log(`[/start] chat_id=${chatId}, param="${startParam}", user=${userTag(msg.from)}`);

  // Глубокая ссылка с id свечи: переход прямо из приложения
  if (startParam) {
    const candle = getCandle(startParam);
    if (candle) {
      await sendCandleCard(chatId, candle);
      await sendUpsell(chatId, candle);
      await notifyAdmin(
        `📥 <b>Переход из приложения</b>\n` +
          `${userTag(msg.from)}\n` +
          `Интерес: ${escapeHtml(candle.name)}`
      );
      return;
    }
  }

  await bot.sendMessage(chatId, DATA.messages.welcome || "Добро пожаловать!", {
    parse_mode: "HTML",
    reply_markup: categoriesKeyboard(),
  });

  await notifyAdmin(`👋 Новый чат с ботом: ${userTag(msg.from)}`);
});

bot.onText(/^\/menu$/, msg => {
  bot.sendMessage(msg.chat.id, "Выберите тему:", { reply_markup: categoriesKeyboard() });
});

bot.onText(/^\/cancel$/, msg => {
  delete leadDialogs[msg.chat.id];
  bot.sendMessage(msg.chat.id, "Окей, отменили. Главное меню:", { reply_markup: categoriesKeyboard() });
});

/* ---------- callback кнопок ---------- */

bot.on("callback_query", async q => {
  const chatId = q.message.chat.id;
  const data = q.data || "";
  bot.answerCallbackQuery(q.id).catch(() => {});

  if (data === "menu" || data === "help") {
    await bot.sendMessage(chatId, "Выберите тему — подберу свечу:", {
      reply_markup: categoriesKeyboard(),
    });
    return;
  }

  if (data.startsWith("cat:")) {
    const key = data.slice(4);
    const cat = getCategoryByKey(key);
    if (!cat) return;
    const candle = getCandle(cat.candleId);
    if (!candle) {
      await bot.sendMessage(chatId, DATA.messages.noCandle || "Пока нет рекомендации.");
      return;
    }
    await sendCandleCard(chatId, candle);
    await sendUpsell(chatId, candle);
    await notifyAdmin(`🌙 Категория «${escapeHtml(cat.name)}» — ${userTag(q.from)}`);
    return;
  }

  if (data.startsWith("card:")) {
    const candle = getCandle(data.slice(5));
    if (candle) await sendCandleCard(chatId, candle);
    return;
  }

  if (data.startsWith("upsell:")) {
    const candle = getCandle(data.slice(7));
    if (candle) await sendUpsell(chatId, candle);
    return;
  }

  if (data.startsWith("lead:start")) {
    const parts = data.split(":");
    const candleId = parts[2] || "";
    await startLead(chatId, candleId);
    return;
  }
});

/* ---------- свободный текст пользователя ---------- */

bot.on("message", async msg => {
  if (!msg.text) return;
  if (msg.text.startsWith("/")) return; // команды обрабатываются отдельно

  // 1) Если активен диалог заявки — продолжаем его
  const handled = await handleLeadInput(msg);
  if (handled) return;

  // 2) Простейший подбор по тексту: ищем категорию по совпадению с её названием
  const text = msg.text.toLowerCase();
  const matched = (DATA.categories || []).find(c =>
    text.includes(c.name.toLowerCase()) || text.includes(c.label.replace(/[^а-яa-zё]/gi, "").toLowerCase())
  );
  if (matched) {
    const candle = getCandle(matched.candleId);
    if (candle) {
      await sendCandleCard(msg.chat.id, candle);
      await sendUpsell(msg.chat.id, candle);
      await notifyAdmin(
        `💬 Сообщение от ${userTag(msg.from)}:\n«${escapeHtml(msg.text.slice(0, 300))}»\nПодобрана: ${escapeHtml(candle.name)}`
      );
      return;
    }
  }

  // 3) Иначе — пересылаем админу + показываем меню пользователю
  await notifyAdmin(`💬 Сообщение от ${userTag(msg.from)}:\n«${escapeHtml(msg.text.slice(0, 500))}»`);

  await bot.sendMessage(
    msg.chat.id,
    "Я мини-консультант. Выберите тему ниже или напишите коротко: «деньги», «защита», «здоровье»…",
    { reply_markup: categoriesKeyboard() }
  );
});

/* ---------- горячая перезагрузка candles.json ---------- */

fs.watchFile(CANDLES_FILE, { interval: 2000 }, () => {
  try {
    DATA = loadData();
    console.log("🔄 candles.json перезагружен");
  } catch (e) {
    console.error("reload error:", e.message);
  }
});

bot.on("polling_error", e => console.error("polling_error:", e.message));
