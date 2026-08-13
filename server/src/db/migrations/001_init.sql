-- Family Hub — initial schema
-- All timestamps are stored as ISO-8601 UTC (TEXT), dates as YYYY-MM-DD.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'member', 'kid')),
  password_hash TEXT NOT NULL,
  color         TEXT NOT NULL DEFAULT '#2E6F8E',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  disabled_at   TEXT
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- ── Tasks ───────────────────────────────────────────────────────────────

CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  color       TEXT NOT NULL DEFAULT '#2E6F8E',
  icon        TEXT,
  position    REAL NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tasks (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id   TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  -- 0 = story, 1 = task, 2 = subtask. No deeper nesting.
  level       INTEGER NOT NULL DEFAULT 0 CHECK (level BETWEEN 0 AND 2),
  title       TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'todo'
              CHECK (status IN ('backlog','todo','in_progress','done','cancelled')),
  priority    TEXT NOT NULL DEFAULT 'normal'
              CHECK (priority IN ('low','normal','high','urgent')),
  due_date    TEXT,
  assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  position    REAL NOT NULL DEFAULT 0,
  -- RRULE subset, e.g. FREQ=WEEKLY;INTERVAL=2
  recurrence_rule       TEXT,
  recurrence_parent_id  TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  completed_at TEXT,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_parent ON tasks(parent_id);
CREATE INDEX idx_tasks_due ON tasks(due_date) WHERE due_date IS NOT NULL;
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_assignee ON tasks(assignee_id);

-- ── Notes ───────────────────────────────────────────────────────────────

CREATE TABLE folders (
  id         TEXT PRIMARY KEY,
  parent_id  TEXT REFERENCES folders(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  position   REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_folders_parent ON folders(parent_id);

CREATE TABLE notes (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL DEFAULT 'Без названия',
  body_md     TEXT NOT NULL DEFAULT '',
  folder_id   TEXT REFERENCES folders(id) ON DELETE SET NULL,
  visibility  TEXT NOT NULL DEFAULT 'shared' CHECK (visibility IN ('shared','private')),
  owner_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  is_template INTEGER NOT NULL DEFAULT 0,
  -- daily note: one per date
  daily_date  TEXT UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_notes_folder ON notes(folder_id);
CREATE INDEX idx_notes_updated ON notes(updated_at DESC);

CREATE TABLE note_versions (
  id         TEXT PRIMARY KEY,
  note_id    TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  body_md    TEXT NOT NULL,
  author_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_note_versions_note ON note_versions(note_id, created_at DESC);

-- [[wiki-links]]. A link may point to a note that doesn't exist yet,
-- so we store the target title as text too.
CREATE TABLE note_links (
  source_note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  target_note_id TEXT REFERENCES notes(id) ON DELETE CASCADE,
  target_title   TEXT NOT NULL,
  PRIMARY KEY (source_note_id, target_title)
);
CREATE INDEX idx_note_links_target ON note_links(target_note_id);

CREATE TABLE task_note_links (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, note_id)
);
CREATE INDEX idx_task_note_links_note ON task_note_links(note_id);

CREATE TABLE attachments (
  id           TEXT PRIMARY KEY,
  filename     TEXT NOT NULL,
  mime         TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  note_id      TEXT REFERENCES notes(id) ON DELETE CASCADE,
  task_id      TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  uploaded_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_attachments_note ON attachments(note_id);
CREATE INDEX idx_attachments_task ON attachments(task_id);

-- ── Calendar ────────────────────────────────────────────────────────────

CREATE TABLE calendars (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  color    TEXT NOT NULL DEFAULT '#2E6F8E',
  owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  shared   INTEGER NOT NULL DEFAULT 1,
  position REAL NOT NULL DEFAULT 0
);

CREATE TABLE events (
  id              TEXT PRIMARY KEY,
  calendar_id     TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT,
  location        TEXT,
  starts_at       TEXT NOT NULL,
  ends_at         TEXT NOT NULL,
  all_day         INTEGER NOT NULL DEFAULT 0,
  recurrence_rule TEXT,
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_events_range ON events(starts_at, ends_at);
CREATE INDEX idx_events_calendar ON events(calendar_id);

-- ── System ──────────────────────────────────────────────────────────────

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  entity     TEXT NOT NULL,
  entity_id  TEXT NOT NULL,
  action     TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_created ON audit_log(created_at DESC);

-- Dashboard widget defaults. Neutral on purpose: each family sets
-- its own event name and labels in settings.
INSERT INTO settings (key, value) VALUES
  ('savings.amount_eur', '0'),
  ('savings.goal_eur', '0'),
  ('savings.label', 'Saved'),
  ('move.target_date', ''),
  ('move.label', 'Countdown');
