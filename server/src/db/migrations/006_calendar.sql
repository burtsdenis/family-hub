-- Calendar: refinements to the initial schema.

ALTER TABLE events ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
-- How many days ahead to surface the event in the digest. NULL — no warning.
ALTER TABLE events ADD COLUMN remind_days_before INTEGER;
-- For birthdays: allows showing the age.
ALTER TABLE events ADD COLUMN birth_year INTEGER;

CREATE TABLE event_participants (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, user_id)
);

-- Cancelled instances of a recurring series: "no practice this Friday".
-- The series itself stays.
CREATE TABLE event_exceptions (
  event_id      TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  excluded_date TEXT NOT NULL,
  PRIMARY KEY (event_id, excluded_date)
);

CREATE INDEX idx_events_project ON events(project_id);

-- Default calendar: an event always has somewhere to land
INSERT INTO calendars (id, name, color, owner_id, shared, position) VALUES
  ('00000000-0000-4000-8000-000000000201', 'Общий', '#1F6E8C', NULL, 1, 0);
