-- Таблица пользователей (кто существует в мире Лёши)
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  telegram_id BIGINT UNIQUE NOT NULL,
  username VARCHAR(255) DEFAULT NULL,
  display_name VARCHAR(255) DEFAULT NULL,
  role ENUM('lover', 'friend', 'human', 'ai_suspect', 'ex', 'enemy') DEFAULT 'human',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_telegram_id (telegram_id),
  INDEX idx_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- История сообщений (для анализа, обучения стилю, восстановления контекста)
CREATE TABLE IF NOT EXISTS messages (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Субъективные воспоминания о людях (telegram_id — для аналитики и подтягивания по id)
CREATE TABLE IF NOT EXISTS user_facts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  telegram_id BIGINT NULL,
  fact TEXT NOT NULL,
  label VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_id (user_id),
  INDEX idx_telegram_id (telegram_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Социальные связи (кто друг, почему, с какого момента)
CREATE TABLE IF NOT EXISTS friend_list (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Промпты (подгружаются по name при старте из файлов, потом берутся из БД)
CREATE TABLE IF NOT EXISTS prompts (
  name VARCHAR(128) PRIMARY KEY,
  content TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Цитаты о Лёше или о @christofferlacour из диалогов (самообучение характера)
CREATE TABLE IF NOT EXISTS character_quotes (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
