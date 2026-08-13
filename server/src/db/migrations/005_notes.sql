-- Notes: refinements to the initial schema.

-- A note can be a template; the template_id field from the first schema
-- version proved useless — a template is applied at creation, not bound forever.
ALTER TABLE notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_notes_owner ON notes(owner_id);
CREATE INDEX idx_notes_visibility ON notes(visibility);
CREATE INDEX idx_notes_template ON notes(is_template) WHERE is_template = 1;

-- A couple of starter templates so the mechanic is visible right away.
-- In English: the data language of a fresh install. The daily note looks up
-- its template by title 'Day' (and 'День' — for databases predating the translation).
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
