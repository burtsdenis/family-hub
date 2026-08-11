-- Лимиты по категориям и регулярные операции.

/*
  Лимит задаётся на категорию в конкретной валюте.
  month IS NULL — постоянный лимит, действует каждый месяц.
  month = 'ГГГГ-ММ' — исключение на один месяц, перебивает постоянный.
  Так «в декабре на подарки больше» не требует переписывать общий лимит.
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
  Регулярная операция — это шаблон, а не запись в истории.
  Фактические операции создаются из него по датам правила повтора.

  auto_create = 1 — создавать самостоятельно (аренда: списывают в срок).
  auto_create = 0 — предлагать к подтверждению (зарплата: приходит с
  задержкой, и автоматическая запись испортила бы остаток именно в тот
  момент, когда на него смотрят).
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

-- Пропущенный экземпляр: «в этом месяце платежа не было».
-- Само правило при этом остаётся.
CREATE TABLE recurring_skips (
  recurring_id TEXT NOT NULL REFERENCES recurring_transactions(id) ON DELETE CASCADE,
  occurred_on  TEXT NOT NULL,
  PRIMARY KEY (recurring_id, occurred_on)
);

ALTER TABLE transactions ADD COLUMN recurring_id TEXT
  REFERENCES recurring_transactions(id) ON DELETE SET NULL;
-- Дата экземпляра серии, из которого создана операция
ALTER TABLE transactions ADD COLUMN recurring_on TEXT;

-- Гарантия идемпотентности: один экземпляр серии — не более одной операции.
-- Без этого повторный запуск создателя задваивал бы аренду.
CREATE UNIQUE INDEX idx_tx_recurring_once
  ON transactions(recurring_id, recurring_on)
  WHERE recurring_id IS NOT NULL;
