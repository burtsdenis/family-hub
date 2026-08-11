-- Календарь: доработки к исходной схеме.

ALTER TABLE events ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
-- За сколько дней поднимать событие в сводку. NULL — не предупреждать.
ALTER TABLE events ADD COLUMN remind_days_before INTEGER;
-- Для дней рождения: позволяет показать возраст.
ALTER TABLE events ADD COLUMN birth_year INTEGER;

CREATE TABLE event_participants (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, user_id)
);

-- Отменённые экземпляры повторяющейся серии: «в эту пятницу тренировки нет».
-- Сама серия при этом остаётся.
CREATE TABLE event_exceptions (
  event_id      TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  excluded_date TEXT NOT NULL,
  PRIMARY KEY (event_id, excluded_date)
);

CREATE INDEX idx_events_project ON events(project_id);

-- Календарь по умолчанию: событию всегда есть куда лечь
INSERT INTO calendars (id, name, color, owner_id, shared, position) VALUES
  ('00000000-0000-4000-8000-000000000201', 'Общий', '#1F6E8C', NULL, 1, 0);
