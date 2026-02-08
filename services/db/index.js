const mysql = require('mysql2/promise');
const config = require('../../config');

let pool = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool(config.db);
  }
  return pool;
}

/** DDL для всех таблиц — выполняется при старте, если таблиц ещё нет */
const SCHEMA_DDL = [
  `CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    telegram_id BIGINT UNIQUE NOT NULL,
    username VARCHAR(255) DEFAULT NULL,
    display_name VARCHAR(255) DEFAULT NULL,
    role ENUM('lover', 'friend', 'human', 'ai_suspect', 'ex', 'enemy') DEFAULT 'human',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_telegram_id (telegram_id),
    INDEX idx_username (username)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    chat_id BIGINT NOT NULL,
    user_id INT NULL,
    telegram_id BIGINT NOT NULL,
    role ENUM('user', 'lesha') NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_chat_id (chat_id),
    INDEX idx_user_id (user_id),
    INDEX idx_created (created_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS user_facts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    telegram_id BIGINT NULL,
    fact TEXT NOT NULL,
    label VARCHAR(255) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id),
    INDEX idx_telegram_id (telegram_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS friend_list (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    related_user_id INT NOT NULL,
    relation_type VARCHAR(100) DEFAULT NULL,
    reason TEXT DEFAULT NULL,
    since TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_relation (user_id, related_user_id),
    INDEX idx_user_id (user_id),
    INDEX idx_related (related_user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (related_user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS prompts (
    name VARCHAR(128) PRIMARY KEY,
    content TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS character_quotes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    about ENUM('lesha', 'christofferlacour') NOT NULL,
    quote TEXT NOT NULL,
    said_by_user_id INT NULL,
    said_by_username VARCHAR(255) DEFAULT NULL,
    chat_id BIGINT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_about (about),
    INDEX idx_chat_id (chat_id),
    FOREIGN KEY (said_by_user_id) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

/**
 * Создать все таблицы при старте (единоразово). Безопасно вызывать каждый запуск — CREATE TABLE IF NOT EXISTS.
 */
async function ensureSchema() {
  const p = getPool();
  for (const sql of SCHEMA_DDL) {
    await p.query(sql);
  }
  try {
    await p.query('ALTER TABLE user_facts ADD COLUMN telegram_id BIGINT NULL AFTER user_id, ADD INDEX idx_telegram_id (telegram_id)');
  } catch (e) {
    if (e.code !== 'ER_DUP_FIELDNAME' && e.code !== 'ER_DUP_KEYNAME') throw e;
  }
}

/** Начальные пользователи из твоего мира (Вика, Вова, Jenevra28, christofferlacour). telegram_id отрицательные, чтобы не пересекаться с реальными. */
const SEED_USERS = [
  { telegram_id: -1, username: 'Jenevra28', display_name: 'Девушка', role: 'lover' },
  { telegram_id: -2, username: 'christofferlacour', display_name: 'Кристофер', role: 'ai_suspect' },
  { telegram_id: -3, username: null, display_name: 'Вика', role: 'ex' },
  { telegram_id: -4, username: null, display_name: 'Вова', role: 'enemy' },
];

/**
 * Заполнить БД начальными данными при первом старте: промпты уже синхронизируются отдельно; здесь — пользователи (Вика, Вова и т.д.).
 */
async function seedInitialData() {
  const p = getPool();
  for (const u of SEED_USERS) {
    const [existing] = await p.execute('SELECT id FROM users WHERE telegram_id = ?', [u.telegram_id]);
    if (existing.length > 0) continue;
    await p.execute(
      'INSERT INTO users (telegram_id, username, display_name, role) VALUES (?, ?, ?, ?)',
      [u.telegram_id, u.username, u.display_name, u.role]
    );
    console.log('seed: добавлен пользователь', u.display_name || u.username, `(${u.role})`);
  }
}

/** Username'ы, для которых при первом контакте подменяем seed-запись на реальный telegram_id */
const LINKABLE_USERNAMES = ['jenevra28', 'christofferlacour'];

/**
 * Найти или создать пользователя по telegram_id. При взаимодействии с Jenevra28 или christofferlacour по username обновляем их seed-запись на реальный telegram_id.
 */
async function ensureUser(telegramId, username = null, displayName = null) {
  const p = getPool();
  const [rows] = await p.execute(
    'SELECT id, telegram_id, username, display_name, role FROM users WHERE telegram_id = ?',
    [telegramId]
  );
  if (rows.length > 0) {
    if (username !== null || displayName !== null) {
      await p.execute(
        'UPDATE users SET username = COALESCE(?, username), display_name = COALESCE(?, display_name), updated_at = NOW() WHERE telegram_id = ?',
        [username || rows[0].username, displayName || rows[0].display_name, telegramId]
      );
    }
    return rows[0];
  }

  const unameLower = (username || '').toLowerCase();
  if (LINKABLE_USERNAMES.includes(unameLower)) {
    const [seed] = await p.execute(
      'SELECT id, telegram_id, username, display_name, role FROM users WHERE LOWER(username) = ? AND telegram_id < 0 LIMIT 1',
      [unameLower]
    );
    if (seed.length > 0) {
      await p.execute(
        'UPDATE users SET telegram_id = ?, display_name = COALESCE(?, display_name), updated_at = NOW() WHERE id = ?',
        [telegramId, displayName || seed[0].display_name, seed[0].id]
      );
      console.log('[БД] Привязан реальный telegram_id к', seed[0].username || seed[0].display_name);
      return {
        id: seed[0].id,
        telegram_id: telegramId,
        username: username || seed[0].username,
        display_name: displayName || seed[0].display_name,
        role: seed[0].role,
      };
    }
  }

  const [insert] = await p.execute(
    'INSERT INTO users (telegram_id, username, display_name, role) VALUES (?, ?, ?, ?)',
    [telegramId, username || null, displayName || null, 'human']
  );
  return {
    id: insert.insertId,
    telegram_id: telegramId,
    username: username || null,
    display_name: displayName || null,
    role: 'human',
  };
}

/**
 * Сохранить сообщение в БД
 */
async function saveMessage(chatId, userId, telegramId, role, content) {
  const p = getPool();
  await p.execute(
    'INSERT INTO messages (chat_id, user_id, telegram_id, role, content) VALUES (?, ?, ?, ?, ?)',
    [chatId, userId, telegramId, role, content]
  );
}

/**
 * Сформировать социальный контекст из БД: список людей и их ролей/фактов
 */
async function getSocialContext() {
  const p = getPool();
  const [users] = await p.execute(
    'SELECT telegram_id, username, display_name, role FROM users ORDER BY role, username'
  );
  const [facts] = await p.execute(
    `SELECT u.username, u.display_name, uf.fact, uf.label
     FROM user_facts uf
     JOIN users u ON u.id = uf.user_id
     ORDER BY uf.created_at DESC
     LIMIT 50`
  );

  const roleLabels = {
    lover: '— твоя девушка/парень. Ты её/его любишь. Можешь быть ревнивым.',
    friend: '— друг. Меньше токсичности.',
    human: '— человек.',
    ai_suspect: '— нейросеть. Ты ей не доверяешь.',
    ex: '— бывший/бывшая. Иногда вспоминаешь.',
    enemy: '— неприятен. Не любишь.',
  };

  let text = 'Люди в твоей жизни:\n\n';
  for (const u of users) {
    const name = u.display_name || (u.username ? `@${u.username}` : `id${u.telegram_id}`);
    text += `${name} ${roleLabels[u.role] || roleLabels.human}\n`;
  }
  if (facts.length > 0) {
    text += '\nФакты из памяти:\n';
    for (const f of facts) {
      const who = f.display_name || (f.username ? `@${f.username}` : 'кто-то');
      text += `- ${who}: ${f.fact}${f.label ? ` (${f.label})` : ''}\n`;
    }
  }
  text += '\n⚠️ Модель НЕ меняет роли, она только живёт внутри этого мира.';
  return text;
}

/**
 * Получить факты о пользователе по telegram_id (для подстановки в контекст перед ответом)
 */
async function getUserFacts(telegramId, limit = 40) {
  const p = getPool();
  const [users] = await p.execute('SELECT id FROM users WHERE telegram_id = ?', [telegramId]);
  if (!users.length) return [];
  const [rows] = await p.execute(
    'SELECT fact, label FROM user_facts WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
    [users[0].id, limit]
  );
  return rows;
}

/**
 * Сохранить факт о пользователе (по username или telegram_id). В запись добавляется telegram_id пользователя для аналитики и подтягивания по id.
 */
async function saveUserFact(aboutIdentifier, fact, label) {
  const p = getPool();
  let userId = null;
  let telegramId = null;
  if (String(Number(aboutIdentifier)) === String(aboutIdentifier)) {
    const [rows] = await p.execute('SELECT id, telegram_id FROM users WHERE telegram_id = ?', [Number(aboutIdentifier)]);
    if (rows.length) {
      userId = rows[0].id;
      telegramId = rows[0].telegram_id;
    }
  }
  if (!userId && aboutIdentifier) {
    const uname = aboutIdentifier.replace(/^@/, '');
    const [rows] = await p.execute('SELECT id, telegram_id FROM users WHERE username = ?', [uname]);
    if (rows.length) {
      userId = rows[0].id;
      telegramId = rows[0].telegram_id;
    }
  }
  if (!userId) return false;
  await p.execute(
    'INSERT INTO user_facts (user_id, telegram_id, fact, label) VALUES (?, ?, ?, ?)',
    [userId, telegramId, fact, label || null]
  );
  return true;
}

/**
 * Промпты по имени (из БД)
 */
async function getPrompt(name) {
  const p = getPool();
  const [rows] = await p.execute('SELECT content FROM prompts WHERE name = ?', [name]);
  return rows.length ? rows[0].content : null;
}

/**
 * Записать или обновить промпт по имени
 */
async function upsertPrompt(name, content) {
  const p = getPool();
  await p.execute(
    'INSERT INTO prompts (name, content) VALUES (?, ?) ON DUPLICATE KEY UPDATE content = VALUES(content), updated_at = NOW()',
    [name, content]
  );
}

/**
 * Сохранить цитату о Лёше или о christofferlacour (для самообучения)
 */
async function saveCharacterQuote(about, quote, saidByUserId, saidByUsername, chatId) {
  const p = getPool();
  await p.execute(
    'INSERT INTO character_quotes (about, quote, said_by_user_id, said_by_username, chat_id) VALUES (?, ?, ?, ?, ?)',
    [about, quote, saidByUserId || null, saidByUsername || null, chatId]
  );
}

/**
 * Получить последние цитаты о Лёше и о christofferlacour для дополнения к характеру
 */
async function getCharacterQuotes(limit = 80) {
  const p = getPool();
  const [rows] = await p.execute(
    `SELECT about, quote, said_by_username, created_at
     FROM character_quotes
     ORDER BY created_at DESC
     LIMIT ?`,
    [limit]
  );
  return rows;
}

/**
 * Закрыть пул (для graceful shutdown)
 */
async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  getPool,
  ensureSchema,
  seedInitialData,
  ensureUser,
  saveMessage,
  getSocialContext,
  getUserFacts,
  saveUserFact,
  getPrompt,
  upsertPrompt,
  saveCharacterQuote,
  getCharacterQuotes,
  closePool,
};
