-- Вход через Google.
--
-- google_sub — постоянный идентификатор гугл-аккаунта (claim `sub`).
-- Привязка только по нему: email у Google можно сменить, sub — никогда.
-- Учётки по Google не создаются: хаб семейный, состав известен,
-- чужой аккаунт при входе получает отказ.
--
-- password_login_disabled — добровольный отказ от парольного входа после
-- привязки Google. Инварианты держит сервер: отключить пароль можно только
-- при привязанном Google и никогда — администратору (его пароль — аварийный
-- вход на случай, когда Google недоступен или привязка сломалась).
-- Сброс пароля администратором включает парольный вход обратно.

ALTER TABLE users ADD COLUMN google_sub TEXT;
ALTER TABLE users ADD COLUMN password_login_disabled INTEGER NOT NULL DEFAULT 0;

-- Один гугл-аккаунт — одна учётка
CREATE UNIQUE INDEX idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL;
