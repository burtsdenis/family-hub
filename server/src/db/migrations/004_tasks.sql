-- Default project: quick-add must always have somewhere to put a task,
-- even when no projects have been created yet.
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
