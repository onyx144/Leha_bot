-- Пример начальных пользователей (можно адаптировать под реальные telegram_id)
-- Сначала нужно вставить пользователей через приложение или миграции после первого контакта.
-- Здесь — шаблон для ручного добавления известных людей.

-- Пример: добавить пользователя с username Jenevra28 как lover (после того как у нас есть её telegram_id)
-- INSERT INTO users (telegram_id, username, display_name, role) VALUES (123456789, 'Jenevra28', 'Девушка', 'lover');

-- Пример: нейросеть-подозреваемый
-- INSERT INTO users (telegram_id, username, display_name, role) VALUES (987654321, 'christofferlacour', 'Кристофер', 'ai_suspect');

-- Вика (ex), Вова (enemy) — добавляются когда появятся в системе с их telegram_id
