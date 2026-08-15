-- Two-factor authentication for password sign-in (TOTP, RFC 6238).
--
-- The gap it closes: family members can route around passwords via
-- Google (with Google's own MFA behind it), but the administrator's
-- password sign-in can never be disabled — it is the emergency
-- entrance, and until now a single secret guarded it.
--
-- totp_secret is written at setup time and only trusted once
-- totp_confirmed_at is set (the person proved the authenticator works
-- by entering a valid code) — an abandoned setup never locks anyone
-- out. The secret is stored readably for the same reason the mail
-- password is: the server must compute codes from it, and the database
-- file is the trust boundary.
ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_confirmed_at TEXT;
