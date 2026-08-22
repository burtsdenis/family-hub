-- The loudest widget on the board was one family's house move: a
-- countdown to a single hardcoded event and a savings bar hardcoded to
-- euros. Same widget, general names — any goal with a date, an amount,
-- or both.
--
-- Untouched seeds get the new neutral wording; a family that renamed the
-- board keeps its own words (the rule from migration 013).

UPDATE settings SET value = 'Goal' WHERE key = 'move.label' AND value = 'Countdown';

-- Amounts join every other amount in this database: minor units. Via REAL
-- because the old goal field was a plain number input — "3000.50" was
-- accepted there, and CAST(... AS INTEGER) would drop the fifty cents.
UPDATE settings
   SET value = CAST(CAST(ROUND(CAST(value AS REAL) * 100) AS INTEGER) AS TEXT)
 WHERE key IN ('savings.amount_eur', 'savings.goal_eur');

-- PATCH /api/settings accepts arbitrary keys, so a goal.* row could in
-- principle already exist and collide with the rename below. It meant
-- nothing before this migration; the widget's own rows win.
DELETE FROM settings
 WHERE key IN ('goal.title', 'goal.date', 'goal.saved_label', 'goal.saved', 'goal.target');

UPDATE settings SET key = 'goal.title'       WHERE key = 'move.label';
UPDATE settings SET key = 'goal.date'        WHERE key = 'move.target_date';
UPDATE settings SET key = 'goal.saved_label' WHERE key = 'savings.label';
UPDATE settings SET key = 'goal.saved'       WHERE key = 'savings.amount_eur';
UPDATE settings SET key = 'goal.target'      WHERE key = 'savings.goal_eur';

-- The goal holds its own currency: currencies are never converted here,
-- so an amount whose currency follows a setting somewhere else would be
-- silently reinterpreted the day that setting changes. Empty is an
-- explicit "whatever the default currency is".
INSERT OR IGNORE INTO settings (key, value) VALUES ('goal.currency', '');
