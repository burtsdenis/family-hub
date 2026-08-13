-- Category budgets and recurring transactions.

/*
  A budget is set per category in a specific currency.
  month IS NULL — standing budget, applies every month.
  month = 'YYYY-MM' — one-month exception, overrides the standing one.
  This way "more for gifts in December" doesn't require rewriting the standing budget.
*/
CREATE TABLE budgets (
  id          TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  currency    TEXT NOT NULL,
  month       TEXT,
  amount      INTEGER NOT NULL CHECK (amount > 0),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_budget_unique
  ON budgets(category_id, currency, coalesce(month, ''));

/*
  A recurring transaction is a template, not a history entry.
  Actual transactions are created from it on the recurrence rule's dates.

  auto_create = 1 — create on its own (rent: charged on schedule).
  auto_create = 0 — offer for confirmation (salary: arrives late, and an
  automatic entry would corrupt the balance at exactly the moment
  someone is looking at it).
*/
CREATE TABLE recurring_transactions (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'transfer')),
  start_on        TEXT NOT NULL,
  recurrence_rule TEXT NOT NULL,
  account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  amount          INTEGER NOT NULL CHECK (amount > 0),
  to_account_id   TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  to_amount       INTEGER,
  category_id     TEXT REFERENCES categories(id) ON DELETE SET NULL,
  note            TEXT,
  place           TEXT,
  auto_create     INTEGER NOT NULL DEFAULT 0,
  active          INTEGER NOT NULL DEFAULT 1,
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_recurring_active ON recurring_transactions(active);

-- A skipped instance: "no payment this month".
-- The rule itself stays.
CREATE TABLE recurring_skips (
  recurring_id TEXT NOT NULL REFERENCES recurring_transactions(id) ON DELETE CASCADE,
  occurred_on  TEXT NOT NULL,
  PRIMARY KEY (recurring_id, occurred_on)
);

ALTER TABLE transactions ADD COLUMN recurring_id TEXT
  REFERENCES recurring_transactions(id) ON DELETE SET NULL;
-- Date of the series instance the transaction was created from
ALTER TABLE transactions ADD COLUMN recurring_on TEXT;

-- Idempotency guarantee: one series instance — at most one transaction.
-- Without it, re-running the creator would double the rent.
CREATE UNIQUE INDEX idx_tx_recurring_once
  ON transactions(recurring_id, recurring_on)
  WHERE recurring_id IS NOT NULL;
