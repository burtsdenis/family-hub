-- Вход и сессии.

-- Сгенерированный при первом запуске пароль администратора попадает в лог
-- контейнера, поэтому его нужно сменить при первом входе.
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN password_changed_at TEXT;
ALTER TABLE users ADD COLUMN last_login_at TEXT;

-- В таблице хранится sha256 от токена, а не сам токен.
-- Прочитавший базу не сможет выдать себя за другого пользователя.
ALTER TABLE sessions ADD COLUMN token_hash TEXT;
CREATE INDEX idx_sessions_token ON sessions(token_hash);
