-- English-first, stage C: seeded rows switch to English (issue #6).
--
-- Every UPDATE guards on the exact original Russian value: a row renamed
-- by the user keeps their name — only untouched seeds are migrated.
-- The client translates the English originals back for Russian devices
-- (projectTitle / calendarName helpers, keyed by the fixed ids).

UPDATE projects
   SET title = 'Inbox',
       description = 'Everything not yet sorted into a project'
 WHERE id = '00000000-0000-4000-8000-000000000001'
   AND title = 'Входящие';

UPDATE calendars
   SET name = 'Shared'
 WHERE id = '00000000-0000-4000-8000-000000000201'
   AND name = 'Общий';

-- The daily-note template on databases seeded before the templates went
-- English. The client already looks it up by either title.
UPDATE notes
   SET title = 'Day'
 WHERE is_template = 1
   AND title = 'День';
