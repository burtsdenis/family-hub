-- Sign-in with Google.
--
-- google_sub — the permanent Google account identifier (claim `sub`).
-- Linking goes by it alone: a Google email can change, sub never does.
-- No accounts are created via Google: the hub is for a family, membership
-- is known, a foreign account is refused at sign-in.
--
-- password_login_disabled — voluntary opt-out of password login after
-- linking Google. The server holds the invariants: password can be disabled
-- only with Google linked and never for the admin (their password is the
-- emergency entrance for when Google is down or the link is broken).
-- An admin password reset turns password login back on.

ALTER TABLE users ADD COLUMN google_sub TEXT;
ALTER TABLE users ADD COLUMN password_login_disabled INTEGER NOT NULL DEFAULT 0;

-- One Google account — one user account
CREATE UNIQUE INDEX idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL;
