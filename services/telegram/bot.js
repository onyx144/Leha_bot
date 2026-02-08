const TelegramBot = require('node-telegram-bot-api');
const config = require('../../config');
const chatMemory = require('../memory/chatMemory');
const db = require('../db');
const llm = require('../llm');

let bot = null;
let botUserId = null;
let botUsername = null;

function getBot() {
  if (!bot) {
    if (!config.botToken) throw new Error('BOT_TOKEN is required');
    bot = new TelegramBot(config.botToken, {
      polling: {
        params: { allowed_updates: ['message'] },
      },
    });
  }
  return bot;
}

/**
 * Обработка входящего сообщения от любого участника: запись в память; ответ только если обращение к Лёше или уместно по характеру
 */
async function handleMessage(msg) {
  if (!msg.from) {
    console.warn('[пропуск] Сообщение без отправителя (chat_id:', msg.chat?.id, ')');
    return;
  }
  if (msg.from.is_bot) return;

  const chatId = msg.chat.id;
  const from = msg.from;
  const text = (msg.text || '').trim();
  if (!text) return;

  const telegramId = from.id;
  const username = from.username || null;
  const displayName = [from.first_name, from.last_name].filter(Boolean).join(' ').trim() || username;
  const chatLabel = msg.chat.type === 'group' || msg.chat.type === 'supergroup' ? `[группа ${msg.chat.title || chatId}]` : '';

  console.log('[сообщение]', chatLabel, displayName || username || telegramId, '→', text);

  try {
    const user = await db.ensureUser(telegramId, username, displayName);

    await chatMemory.append(chatId, 'user', `${displayName || username || telegramId}: ${text}`);
    await db.saveMessage(chatId, user.id, telegramId, 'user', text);

    // Цитаты о Лёше / christofferlacour — в отдельную таблицу для самообучения (независимо от ответа)
    llm.runCharacterQuoteExtractor(chatId, text, user.id, username).catch((e) => console.warn('[characterQuoteExtractor]', e.message));

    const shouldRespond = await llm.shouldLeshaRespond(chatId, text, msg, botUserId, botUsername);
    console.log('[ИИ] Отвечать?', shouldRespond ? 'да' : 'нет');

    if (!shouldRespond) return;

    const reply = await llm.generateLeshaReply(chatId, {
      telegramId,
      username,
      displayName: displayName || username || String(telegramId),
    });
    console.log('[ИИ] Ответ Лёши:', reply);

    await chatMemory.append(chatId, 'lesha', reply);
    await db.saveMessage(chatId, null, 0, 'lesha', reply);

    const extractResult = await llm.runMemoryExtractor(chatId, text, reply, {
      telegramId,
      username,
      displayName: displayName || username || String(telegramId),
    });
    if (extractResult.save && extractResult.about && extractResult.fact) {
      await db.saveUserFact(extractResult.about, extractResult.fact, extractResult.label);
      console.log('[ИИ] Сохранён факт о', extractResult.about, '→', extractResult.fact);
    }

    const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
    const outText = isGroup && username ? `@${username} ${reply}` : reply;
    await getBot().sendMessage(chatId, outText);
  } catch (err) {
    console.error('[ошибка] handleMessage:', err);
    try {
      await getBot().sendMessage(chatId, 'мее... что-то сломалось, спать хочу');
    } catch (_) {}
  }
}

async function start() {
  const b = getBot();
  try {
    const me = await b.getMe();
    botUserId = me.id;
    botUsername = (me.username || '').toLowerCase();
    console.log('[старт] Бот id:', botUserId, '@' + (me.username || ''));
  } catch (e) {
    console.warn('[старт] getMe не удался, ответ на «ответ боту» может не срабатывать:', e.message);
  }
  b.on('message', handleMessage);

  // Как только бота добавили в группу — уже слушаем, /start в беседе не нужен
  b.on('new_chat_members', (msg) => {
    const added = msg.new_chat_members || [];
    const meAdded = added.some((u) => u.id === botUserId);
    if (meAdded) {
      console.log('[группа] Бота добавили в беседу, chat_id:', msg.chat.id, msg.chat.title || '');
      getBot().sendMessage(msg.chat.id, 'хрю').catch(() => {});
    }
  });

  console.log('[старт] Лёша бот запущен (polling). В группах /start не нужен — читаю сообщения сразу.');
}

function stop() {
  if (bot) {
    bot.stopPolling();
    bot = null;
  }
  return db.closePool();
}

module.exports = {
  getBot,
  start,
  stop,
  handleMessage,
};
