-- Family mail (#30/#31): the household paperwork inbox.
--
-- One shared mailbox per family. Inbound messages are ingested from a
-- source adapter (v1: IMAP polling of an external mailbox) and live
-- here; replies sent from the hub are rows too (kind='out'), so a
-- thread reads in one place.

CREATE TABLE mail_messages (
  id            TEXT PRIMARY KEY,
  -- RFC 5322 Message-ID. Ingest is idempotent by it: a re-poll or a
  -- restart never duplicates a message.
  message_id    TEXT,
  kind          TEXT NOT NULL DEFAULT 'in' CHECK (kind IN ('in', 'out')),
  from_address  TEXT NOT NULL,
  from_name     TEXT,
  to_address    TEXT,
  subject       TEXT NOT NULL DEFAULT '',
  -- v1 renders the plain-text part only; HTML sanitization is its own
  -- fight (see the epic) and raw HTML never reaches the client.
  body_text     TEXT NOT NULL DEFAULT '',
  sent_at       TEXT,
  received_at   TEXT NOT NULL,
  read_at       TEXT,
  -- The one-click "make it a task" link
  task_id       TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  -- For kind='out': which inbound message this replies to, and who wrote it
  in_reply_to   TEXT REFERENCES mail_messages(id) ON DELETE SET NULL,
  sent_by       TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX idx_mail_message_id ON mail_messages(message_id)
  WHERE message_id IS NOT NULL;
CREATE INDEX idx_mail_received ON mail_messages(received_at);

-- The family mailbox connection — a single row. The password cannot be
-- hashed (the hub must present it to IMAP/SMTP verbatim), so the
-- database file is the trust boundary, same as for session material.
-- The API never returns it; the UI only writes it.
CREATE TABLE mail_account (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  address       TEXT NOT NULL,
  imap_host     TEXT NOT NULL,
  imap_port     INTEGER NOT NULL DEFAULT 993,
  smtp_host     TEXT NOT NULL,
  smtp_port     INTEGER NOT NULL DEFAULT 465,
  username      TEXT NOT NULL,
  password      TEXT NOT NULL,
  -- Which IMAP folder to poll. INBOX by default; a dedicated label
  -- (e.g. Gmail filter -> "FamilyHub") lets a personal mailbox host the
  -- family inbox without the poller touching personal mail.
  folder        TEXT NOT NULL DEFAULT 'INBOX',
  last_sync_at  TEXT,
  last_error    TEXT
);

-- Mail attachments ride the existing pipeline and storage budget
ALTER TABLE attachments ADD COLUMN mail_message_id TEXT REFERENCES mail_messages(id) ON DELETE CASCADE;
CREATE INDEX idx_attachments_mail ON attachments(mail_message_id);
