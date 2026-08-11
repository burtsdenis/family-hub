-- Деньги: счета, категории, операции.

/*
  Суммы хранятся в минорных единицах целым числом: 1234.56 → 123456.
  Числа с плавающей точкой для денег дают ошибки округления, которые
  копятся в суммах и в итоге расходятся с банком на копейки, а потом
  на рубли. Обратно в рубли и евро переводим только при отображении.

  Валюта живёт на счёте. Валюты между собой не связаны: курса нет,
  общего итога нет, суммируем строго внутри одной валюты.
*/

CREATE TABLE accounts (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  currency        TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'card'
                  CHECK (kind IN ('cash', 'card', 'savings')),
  opening_balance INTEGER NOT NULL DEFAULT 0,
  -- owner_id пусто + shared=1 → общий счёт; owner_id задан + shared=0 → личный
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
  Одна таблица на траты, доходы и переводы.

  expense:  account_id, amount            → остаток account_id уменьшается
  income:   account_id, amount            → остаток account_id увеличивается
  transfer: account_id, amount + to_account_id, to_amount

  У перевода две суммы, а не одна: счета могут быть в разных валютах,
  и курса у нас нет. Сколько ушло и сколько пришло — вводится руками.
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

  -- Перевод обязан иметь вторую сторону, трата и доход — не должны
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

-- Сверка: фактический остаток из банка на дату. Расхождение считается на лету.
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

-- Чеки прикладываются к операции той же машинерией, что вложения к заметкам
ALTER TABLE attachments ADD COLUMN transaction_id TEXT REFERENCES transactions(id) ON DELETE CASCADE;
CREATE INDEX idx_attachments_transaction ON attachments(transaction_id);
