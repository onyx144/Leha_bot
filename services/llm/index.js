const fs = require('fs').promises;
const path = require('path');
const OpenAI = require('openai');
const config = require('../../config');
const chatMemory = require('../memory/chatMemory');
const db = require('../db');

const PROMPTS_DIR = config.paths.prompts;

/**
 * Загрузить промпт по имени из БД, при отсутствии — из файла
 */
async function getPromptByName(name) {
  const fromDb = await db.getPrompt(name);
  if (fromDb) return fromDb;
  const fileName = name.includes('.') ? name : `${name}.txt`;
  try {
    const content = (await fs.readFile(path.join(PROMPTS_DIR, fileName), 'utf8')).trim();
    return content;
  } catch {
    return null;
  }
}

/**
 * Социальный контекст: из БД (динамический) или fallback на файл
 */
async function getSocialContext() {
  try {
    return await db.getSocialContext();
  } catch (e) {
    const fromFile = await getPromptByName('social_context_prompt');
    return fromFile || 'Люди в твоей жизни: неизвестны.';
  }
}

/**
 * Цитаты о Лёше и о christofferlacour — дополнение к характеру (самообучение)
 */
async function getCharacterQuotesBlock() {
  try {
    const rows = await db.getCharacterQuotes(80);
    if (!rows.length) return '';
    const lesha = rows.filter((r) => r.about === 'lesha').map((r) => r.quote);
    const christoffer = rows.filter((r) => r.about === 'christofferlacour').map((r) => r.quote);
    let block = '';
    if (lesha.length) {
      block += 'Что о тебе говорят (учитывай это в образе):\n' + lesha.map((q) => `- ${q}`).join('\n') + '\n\n';
    }
    if (christoffer.length) {
      block += 'Что говорят о @christofferlacour:\n' + christoffer.map((q) => `- ${q}`).join('\n') + '\n\n';
    }
    return block ? block.trim() : '';
  } catch {
    return '';
  }
}

/**
 * Собрать системное сообщение для Лёши: промпты из БД + социальный контекст + цитаты о нём
 */
async function buildSystemMessage() {
  const systemPrompt = await getPromptByName('system_prompt');
  const rulesPrompt = await getPromptByName('rules_prompt');
  const social = await getSocialContext();
  const quotesBlock = await getCharacterQuotesBlock();

  const parts = [
    systemPrompt || 'Ты Лёша.',
    rulesPrompt || '',
    'Социальный контекст:\n' + social,
  ];
  if (quotesBlock) {
    parts.push('---\n\n' + quotesBlock);
  }
  return parts.filter(Boolean).join('\n\n---\n\n');
}

/**
 * Сгенерировать ответ Лёши по истории чата.
 * currentUser — { telegramId, username, displayName } того, кому отвечаем: подставляем факты о нём из БД в контекст.
 */
async function generateLeshaReply(chatId, currentUser = null) {
  const openai = new OpenAI({ apiKey: config.openaiApiKey });
  const systemContent = await buildSystemMessage();
  const chatHistory = await chatMemory.getContext(chatId);
  const userContent = chatHistory || 'Начало разговора.';

  let aboutUserBlock = '';
  if (currentUser && currentUser.telegramId) {
    const facts = await db.getUserFacts(currentUser.telegramId);
    const name = currentUser.displayName || (currentUser.username ? `@${currentUser.username}` : 'собеседник');
    if (facts.length > 0) {
      aboutUserBlock = `Сейчас тебе пишет: ${name}. Что ты о нём помнишь (используй в ответе по ситуации):\n${facts.map((f) => `— ${f.fact}${f.label ? ` (${f.label})` : ''}`).join('\n')}\n\n`;
      console.log('[ИИ] Факты о собеседнике (' + name + '):', facts.length, '—', facts.map((f) => f.fact).join('; '));
    }
  }

  const messages = [
    { role: 'system', content: systemContent },
    { role: 'user', content: `${aboutUserBlock}Текущий диалог (последние реплики):\n\n${userContent}\n\nОтветь как Лёша. Пиши развёрнуто, как живой человек: можно несколько предложений, отвлечься, пошутить, пожаловаться, вспомнить что-то. Не одной шаблонной фразой — пусть чувствуется мысль и характер. Без кавычек и пояснений от автора.` },
  ];

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages,
    max_tokens: 450,
    temperature: 0.88,
  });

  const reply = (completion.choices[0]?.message?.content || 'хрю').trim();
  return reply;
}

/**
 * Анализ последних реплик экстрактором памяти; возвращает { save, about, fact, label } или { save: false }
 * authorInfo — { telegramId, username, displayName } автора последнего сообщения: если человек говорит о себе, about должен быть его telegramId (строка) или username.
 */
async function runMemoryExtractor(chatId, lastUserMessage, leshaReply, authorInfo = null) {
  const openai = new OpenAI({ apiKey: config.openaiApiKey });
  const memoryExtractorPrompt = await getPromptByName('memory_extractor_prompt');
  if (!memoryExtractorPrompt) return { save: false };

  const recent = await chatMemory.getContext(chatId, 15);
  const dialog = recent + `\n[user] ${lastUserMessage}\n[lesha] ${leshaReply}`;

  const authorNote = authorInfo
    ? `\nАвтор последнего сообщения: ${authorInfo.displayName || authorInfo.username || 'пользователь'}${authorInfo.username ? ' (@' + authorInfo.username + ')' : ''}. Для фактов о нём укажи about: "${String(authorInfo.telegramId)}" (его id) или "${authorInfo.username || ''}".`
    : '';

  const messages = [
    { role: 'system', content: memoryExtractorPrompt },
    { role: 'user', content: `Проанализируй этот фрагмент диалога и верни только JSON.${authorNote}\n\nДиалог:\n${dialog}` },
  ];

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages,
    max_tokens: 200,
    temperature: 0.2,
  });

  const raw = (completion.choices[0]?.message?.content || '{}').trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { save: false };
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      save: !!parsed.save,
      about: parsed.about || null,
      fact: parsed.fact || null,
      label: parsed.label || null,
    };
  } catch {
    return { save: false };
  }
}

/** Обращение к Лёше: по тексту и по reply к боту */
function isAddressedToLesha(text, replyToMessage, botUserId) {
  if (!text) return false;
  const lower = text.toLowerCase();
  const leshaMentions = /\b(лёша|леша|лёши|леши|лёше|леше|лёшу|лешу|лёхой|лехой)\b/i.test(lower);
  if (leshaMentions) return true;
  if (replyToMessage && replyToMessage.from && replyToMessage.from.id === botUserId) return true;
  return false;
}

/** Username того, кого Лёша считает нейросетью — на него всегда откликается */
const AI_SUSPECT_USERNAME = 'christofferlacour';

/** Проверка: в тексте есть упоминание бота (@username) — обязан ответить */
function isBotMentioned(text, botUsername) {
  if (!text || !botUsername) return false;
  return text.toLowerCase().includes('@' + botUsername.toLowerCase());
}

/**
 * Решить, нужно ли Лёше отвечать.
 * Логика: личка — всегда; отметили (@бот) или по имени/ответ — обязан; в беседе пишет christofferlacour — отреагировать; иначе в группе — по характеру (общительный, но не на каждое сообщение).
 */
async function shouldLeshaRespond(chatId, text, msg, botUserId, botUsername = null) {
  if (msg.chat && msg.chat.type === 'private') {
    console.log('[ИИ] Решение: отвечать (личный чат)');
    return true;
  }

  if (isAddressedToLesha(text, msg.reply_to_message, botUserId)) {
    console.log('[ИИ] Решение: отвечать (обращение по имени или ответ на меня)');
    return true;
  }
  if (isBotMentioned(text, botUsername)) {
    console.log('[ИИ] Решение: отвечать (отметили — обязан ответить)');
    return true;
  }

  if (msg.chat && (msg.chat.type === 'group' || msg.chat.type === 'supergroup')) {
    const authorUsername = (msg.from && msg.from.username || '').toLowerCase();
    const authorName = (msg.from && (msg.from.first_name || '') + ' ' + (msg.from.last_name || '')).trim() || authorUsername;
    if (authorUsername === AI_SUSPECT_USERNAME) {
      console.log('[ИИ] Решение: отвечать (написал christofferlacour — отреагировать)');
      return true;
    }

    // В беседе не отметили и не christofferlacour — решаем по характеру: общительный, но не на каждое сообщение
    const openai = new OpenAI({ apiKey: config.openaiApiKey });
    const recent = await chatMemory.getContext(chatId, 10);
    const prompt = `Ты решаешь, вступит ли Лёша в переписку в групповом чате. Он общительный, но отвечает не на каждое сообщение.

Правила:
— Отвечать (yes): тема ему заходит (еда, выпить, усталость, шутка, конфликт, кто-то зацепил); открытый вопрос к чату; реплика в тему, к которой он может приложиться; общий разговор, куда логично вставить своё.
— Не отвечать (no): сугубо личный обмен двумя людьми мимо него; скучная/нейтральная тема, не цепляет; он только что уже ответил и нечего добавить; одна короткая реплика без повода ответить.

Контекст (последние сообщения в беседе):
${recent || '(пусто)'}

Только что написал: ${authorName || 'участник'}. Текст: "${text}"

Лёша довольно общительный — при сомнении склоняйся к yes. Один ответ: yes или no.`;

    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 10,
        temperature: 0.4,
      });
      const answer = (completion.choices[0]?.message?.content || '').trim().toLowerCase();
      const should = answer.startsWith('yes');
      console.log('[ИИ] Решение по характеру:', answer, '→', should ? 'отвечать' : 'молчать');
      return should;
    } catch (e) {
      console.warn('[ИИ] Ошибка shouldLeshaRespond:', e.message);
      return false;
    }
  }

  return false;
}

/**
 * Извлечь из сообщения цитаты о Лёше или о @christofferlacour; сохранить в БД только если не противоречат характеру
 */
async function runCharacterQuoteExtractor(chatId, userMessage, saidByUserId, saidByUsername) {
  if (!userMessage || !userMessage.trim()) return;

  console.log('[ИИ] Проверяю сообщение на факты о Лёше / christofferlacour:', userMessage.slice(0, 60) + (userMessage.length > 60 ? '…' : ''));

  const openai = new OpenAI({ apiKey: config.openaiApiKey });
  const prompt = `Данные о Лёше сохраняются только из слов других пользователей (это сообщение от юзера). То, что Лёша сам пишет о себе в своих ответах — никогда не сохраняй.

В этом сообщении люди могут говорить О Лёше / о @christofferlacour — либо о СЕБЕ (я, мне).

Важно:
— Сохраняй в character_quotes ТОЛЬКО то, что в сообщении пользователя сказано О Лёше (ты не любишь, тебе нравится, Лёша такой-то) или О christofferlacour. quote — от третьего лица.
— Если человек говорит о СЕБЕ (я люблю, я не устал) — это не про Лёшу, верни [].

Сообщение: "${userMessage}"

Извлеки только факты именно о Лёше или о christofferlacour. contradicts_character = true только если ломает образ ("ты бот", "нейросеть").
Верни JSON-массив: [{"about": "lesha"|"christofferlacour", "quote": "короткий факт", "contradicts_character": true|false}]
Если ничего про Лёшу/christofferlacour нет — верни []. Только JSON.`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 300,
      temperature: 0.2,
    });
    const raw = (completion.choices[0]?.message?.content || '[]').trim();
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.log('[ИИ] Цитаты о Лёше: экстрактор не вернул массив, пропуск.');
      return;
    }
    const items = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(items)) {
      console.log('[ИИ] Цитаты о Лёше: не массив, пропуск.');
      return;
    }
    if (items.length > 0) {
      console.log('[ИИ] Цитаты о Лёше: экстрактор вернул', items.length, 'факт(ов).');
    }
    let saved = 0;
    for (const it of items) {
      if (!it.quote || it.contradicts_character) {
        if (it.quote) console.log('[ИИ] Цитаты о Лёше: отброшен (противоречит характеру) —', it.quote.slice(0, 50));
        continue;
      }
      const about = it.about === 'christofferlacour' ? 'christofferlacour' : 'lesha';
      await db.saveCharacterQuote(about, it.quote.trim(), saidByUserId, saidByUsername, chatId);
      saved++;
      console.log('[БД] Запись о Лёше (характер):', about, '→', it.quote.trim());
    }
    if (saved > 0) {
      console.log('[ИИ] Цитаты о персонажах: в БД сохранено', saved);
    } else if (items.length === 0) {
      console.log('[ИИ] Цитаты о персонажах: подходящих фактов нет.');
    } else {
      console.log('[ИИ] Цитаты о персонажах: в БД сохранено 0 (все отброшены).');
    }
  } catch (e) {
    console.warn('[characterQuoteExtractor]', e.message);
  }
}

module.exports = {
  getPromptByName,
  buildSystemMessage,
  getSocialContext,
  getCharacterQuotesBlock,
  generateLeshaReply,
  runMemoryExtractor,
  shouldLeshaRespond,
  runCharacterQuoteExtractor,
};
