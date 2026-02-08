const fs = require('fs').promises;
const path = require('path');
const config = require('../../config');

const MEMORY_DIR = config.paths.chatMemory;
const MAX_LINES = config.chatMemoryMaxLines || 28;

function chatFilePath(chatId) {
  return path.join(MEMORY_DIR, `chat_${chatId}.txt`);
}

/**
 * Добавить реплику в краткосрочную память чата
 * Формат: [user] текст или [lesha] текст
 */
async function append(chatId, speaker, text) {
  await fs.mkdir(MEMORY_DIR, { recursive: true });
  const filePath = chatFilePath(chatId);
  const line = `[${speaker}] ${(text || '').trim().replace(/\n/g, ' ')}\n`;
  try {
    await fs.appendFile(filePath, line);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    await fs.writeFile(filePath, line);
  }
  await trimToMaxLines(chatId);
}

/**
 * Прочитать последние MAX_LINES реплик (весь файл, если меньше)
 */
async function getRecent(chatId) {
  const filePath = chatFilePath(chatId);
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.split('\n').filter((l) => l.trim());
    const from = Math.max(0, lines.length - MAX_LINES);
    return lines.slice(from).join('\n');
  } catch (e) {
    if (e.code === 'ENOENT') return '';
    throw e;
  }
}

/**
 * Оставить в файле только последние MAX_LINES строк
 */
async function trimToMaxLines(chatId) {
  const filePath = chatFilePath(chatId);
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.split('\n').filter((l) => l.trim());
    if (lines.length <= MAX_LINES) return;
    const kept = lines.slice(-MAX_LINES);
    await fs.writeFile(filePath, kept.join('\n') + '\n');
  } catch (e) {
    if (e.code === 'ENOENT') return;
    throw e;
  }
}

/**
 * Получить последние N реплик в виде строки для контекста (то же что getRecent, но с лимитом)
 */
async function getContext(chatId, maxLines = MAX_LINES) {
  const filePath = chatFilePath(chatId);
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.split('\n').filter((l) => l.trim());
    const from = Math.max(0, lines.length - maxLines);
    return lines.slice(from).join('\n');
  } catch (e) {
    if (e.code === 'ENOENT') return '';
    throw e;
  }
}

module.exports = {
  append,
  getRecent,
  getContext,
  chatFilePath,
};
