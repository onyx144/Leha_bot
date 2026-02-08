const telegram = require('./services/telegram/bot');
const db = require('./services/db');
const syncPrompts = require('./services/db/syncPrompts');

async function main() {
  process.on('SIGINT', async () => {
    console.log('Останавливаюсь...');
    await telegram.stop();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    await telegram.stop();
    process.exit(0);
  });

  try {
    await db.ensureSchema();
    console.log('[старт] Таблицы БД проверены.');
  } catch (e) {
    console.error('Ошибка инициализации БД:', e.message);
    process.exit(1);
  }

  try {
    await db.seedInitialData();
  } catch (e) {
    console.warn('Сид начальных данных:', e.message);
  }

  try {
    await syncPrompts.syncPromptsFromFiles();
    console.log('[старт] Промпты синхронизированы из папки prompts/.');
  } catch (e) {
    console.warn('Синхронизация промптов:', e.message);
  }

  telegram.start();
}

main().catch((err) => {
  console.error('Startup error:', err);
  process.exit(1);
});
