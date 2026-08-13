-- Money: accounts, categories, transactions.

/*
  Amounts are stored as integers in minor units: 1234.56 → 123456.
  Floating point for money produces rounding errors that accumulate
  across sums and eventually drift from the bank by cents, then by
  whole units. Conversion back to major units happens only on display.

  Currency lives on the account. Currencies are unrelated: no exchange
  rate, no grand total, sums are computed strictly within one currency.
*/

CREATE TABLE accounts (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  currency        TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'card'
                  CHECK (kind IN ('cash', 'card', 'savings')),
  opening_balance INTEGER NOT NULL DEFAULT 0,
  -- owner_id empty + shared=1 → shared account; owner_id set + shared=0 → personal
  owner_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
  shared          INTEGER NOT NULL DEFAULT 1,
  color           TEXT NOT NULL DEFAULT '#1F6E8C',
  position        REAL NOT NULL DEFAULT 0,
  archived_at     TEXT,
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_accounts_owner ON accounts(owner_id);

CREATE TABLE categories (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('expense', 'income')),
  color       TEXT NOT NULL DEFAULT '#5A6A74',
  position    REAL NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_categories_kind ON categories(kind);

/*
  One table for expenses, income and transfers.

  expense:  account_id, amount            → account_id balance decreases
  income:   account_id, amount            → account_id balance increases
  transfer: account_id, amount + to_account_id, to_amount

  A transfer has two amounts, not one: the accounts may be in different
  currencies, and we have no exchange rate. What left and what arrived
  is entered by hand.
*/
CREATE TABLE transactions (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'transfer')),
  occurred_on     TEXT NOT NULL,
  account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  amount          INTEGER NOT NULL CHECK (amount > 0),
  to_account_id   TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  to_amount       INTEGER,
  category_id     TEXT REFERENCES categories(id) ON DELETE SET NULL,
  note            TEXT,
  place           TEXT,
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),

  -- A transfer must have a second side, expense and income must not
  CHECK (
    (kind = 'transfer' AND to_account_id IS NOT NULL AND to_amount > 0)
    OR (kind <> 'transfer' AND to_account_id IS NULL AND to_amount IS NULL)
  ),
  CHECK (kind <> 'transfer' OR account_id <> to_account_id)
);
CREATE INDEX idx_tx_date ON transactions(occurred_on DESC);
CREATE INDEX idx_tx_account ON transactions(account_id);
CREATE INDEX idx_tx_to_account ON transactions(to_account_id);
CREATE INDEX idx_tx_category ON transactions(category_id);

-- Reconciliation: actual bank balance on a date. The discrepancy is computed on the fly.
CREATE TABLE reconciliations (
  id             TEXT PRIMARY KEY,
  account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  checked_on     TEXT NOT NULL,
  actual_balance INTEGER NOT NULL,
  note           TEXT,
  created_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_reconciliations_account ON reconciliations(account_id, checked_on DESC);

-- Receipts attach to a transaction via the same machinery as note attachments
ALTER TABLE attachments ADD COLUMN transaction_id TEXT REFERENCES transactions(id) ON DELETE CASCADE;
CREATE INDEX idx_attachments_transaction ON attachments(transaction_id);
