-- Заметки: доработки к исходной схеме.

-- Заметка может быть шаблоном; поле template_id из первой версии схемы
-- не пригодилось — шаблон применяется при создании, а не привязывается навсегда.
ALTER TABLE notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_notes_owner ON notes(owner_id);
CREATE INDEX idx_notes_visibility ON notes(visibility);
CREATE INDEX idx_notes_template ON notes(is_template) WHERE is_template = 1;

-- Пара шаблонов на старте, чтобы механика была видна сразу.
-- На английском: язык данных свежего инсталла. Заметка дня ищет свой
-- шаблон по названию 'Day' (и 'День' — для баз, живших до перевода).
INSERT INTO notes (id, title, body_md, visibility, is_template) VALUES
  (
    '00000000-0000-4000-8000-000000000101',
    'Document',
    '## What it is

## Where the original lives

## Valid until

## What renewal requires
',
    'shared',
    1
  ),
  (
    '00000000-0000-4000-8000-000000000102',
    'Day',
    '## Today

## Notes

## Sort out later
',
    'shared',
    1
  );
