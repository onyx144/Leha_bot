const fs = require('fs').promises;
const path = require('path');
const config = require('../../config');
const db = require('./index');

const PROMPTS_DIR = config.paths.prompts;

/**
 * Прочитать все .txt из prompts/ и записать в таблицу prompts по имени (имя файла без .txt)
 * Вызывать при старте приложения.
 */
async function syncPromptsFromFiles() {
  let files;
  try {
    files = await fs.readdir(PROMPTS_DIR);
  } catch (e) {
    console.warn('syncPrompts: папка prompts не найдена или недоступна', e.message);
    return;
  }

  const txtFiles = files.filter((f) => f.endsWith('.txt'));
  for (const file of txtFiles) {
    const name = file.replace(/\.txt$/, '');
    const filePath = path.join(PROMPTS_DIR, file);
    try {
      const content = (await fs.readFile(filePath, 'utf8')).trim();
      await db.upsertPrompt(name, content);
      console.log('syncPrompts: обновлён промпт', name);
    } catch (e) {
      console.warn('syncPrompts: не удалось прочитать/записать', file, e.message);
    }
  }
}

module.exports = { syncPromptsFromFiles };
