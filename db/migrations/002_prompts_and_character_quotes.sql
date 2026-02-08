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
