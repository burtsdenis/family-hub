-- Проект по умолчанию: у быстрого добавления всегда должно быть куда положить
-- задачу, даже когда ни одного проекта ещё не завели.
INSERT INTO projects (id, title, description, color, icon, position)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'Входящие',
  'Всё, что пока не разложено по проектам',
  '#5A6A74',
  'inbox',
  -1
);

CREATE INDEX idx_tasks_recurrence_parent ON tasks(recurrence_parent_id);
