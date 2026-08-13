-- One reconciliation per day: a repeat on the same day updates the previous one.
--
-- Previously every reconciliation added a row, and a second one that day
-- created a twin with the same date. The "latest reconciliation" query
-- ordered only by checked_on; on equal dates SQLite returned whichever came
-- first — usually the old one. From the outside it looked like the
-- "Reconcile" button works once and is then ignored.
--
-- Multiple reconciliations of one account on one day carry no meaning:
-- what matters is the actual balance on a date, not the history of attempts
-- to enter it.

-- Remove existing twins, keeping the last one entered
DELETE FROM reconciliations
 WHERE rowid NOT IN (
   SELECT max(rowid) FROM reconciliations GROUP BY account_id, checked_on
 );

CREATE UNIQUE INDEX idx_reconciliations_day ON reconciliations(account_id, checked_on);
