-- attachments.task_id was never written or read by any route: uploads only
-- ever attach to a note (see attachments.ts), and no endpoint exists to
-- attach a file to a task. The schema is our only source of truth for what
-- the app can actually do, so a dead column here reads as a capability that
-- doesn't exist — drop it, along with its now-pointless index.
--
-- SQLite has supported DROP COLUMN natively since 3.35 (2021); the
-- better-sqlite3 build we bundle ships a much newer SQLite, so this is a
-- plain in-place ALTER, no table-rebuild dance needed.
DROP INDEX IF EXISTS idx_attachments_task;
ALTER TABLE attachments DROP COLUMN task_id;
