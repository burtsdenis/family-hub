-- Invite links.
--
-- Instead of "the admin created an account and dictated a one-time
-- password": the admin creates a link, the person opens it and fills in
-- their own name, login and password. The link is single-use and lives a week.
--
-- The token is stored hashed — like session tokens: a database leak must
-- not hand out working invites.

CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'kid')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  -- Filled in on use; used invites are kept for history
  used_by TEXT REFERENCES users(id),
  used_at TEXT
);
