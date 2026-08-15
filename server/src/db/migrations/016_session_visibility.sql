-- Session visibility (the Devices list in Settings).
--
-- Sessions accumulate silently: every sign-in inserts a row, and a
-- re-login in the same browser overwrites the cookie while the old row
-- stays valid for the full 90 days — an orphan nobody can reach or
-- see. last_seen_at makes live and orphaned sessions distinguishable
-- (and lets the pruner retire idle ones); ip helps a person recognise
-- "which device is this" in the list.
ALTER TABLE sessions ADD COLUMN last_seen_at TEXT;
ALTER TABLE sessions ADD COLUMN ip TEXT;
