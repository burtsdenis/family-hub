-- Login and sessions.

-- The admin password generated on first launch ends up in the container
-- log, so it must be changed on first login.
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN password_changed_at TEXT;
ALTER TABLE users ADD COLUMN last_login_at TEXT;

-- The table stores a sha256 of the token, not the token itself.
-- Whoever reads the database can't impersonate another user.
ALTER TABLE sessions ADD COLUMN token_hash TEXT;
CREATE INDEX idx_sessions_token ON sessions(token_hash);
