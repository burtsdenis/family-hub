-- Приглашения по ссылке.
--
-- Вместо «администратор завёл учётку и продиктовал одноразовый пароль»:
-- администратор создаёт ссылку, человек открывает её и сам заполняет имя,
-- логин и пароль. Ссылка одноразовая и живёт неделю.
--
-- Токен хранится хэшем — как и токены сессий: утечка базы не должна
-- отдавать действующие приглашения.

CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'kid')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  -- Заполняются при использовании; использованные храним для истории
  used_by TEXT REFERENCES users(id),
  used_at TEXT
);
