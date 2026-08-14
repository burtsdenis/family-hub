import { randomUUID } from 'node:crypto';
import { db, now, today } from '../db/index.js';
import { hashPassword } from './password.js';

/*
  Demo mode (DEMO_MODE=true) — a public "try before installing" sandbox.

  The demo's content lives here: seeding of a plausible family (tasks,
  notes, calendar, money) and the list of restrictions. The lifecycle is
  in sandbox.ts: seeding fills the template database, and every visitor
  gets a fresh copy of it, so other people's garbage never appears in
  the demo by design.

  The restrictions got shorter than with a shared database: a visitor can
  only spoil the content for themselves. What stays closed: password and
  family membership changes (meaningless in a sandbox, and invite links
  mislead) and file uploads — the disk is shared, and a file dump is
  still a file dump.
*/

/** What the demo forbids. Checked in authenticate after login. */
export function demoBlocked(method: string, path: string): boolean {
  if (method === 'GET' || method === 'HEAD') return false;
  if (path.startsWith('/api/users')) return true;
  if (path.startsWith('/api/invites')) return true;
  if (path === '/api/auth/change-password') return true;
  if (path === '/api/auth/password-login') return true;
  if (path.startsWith('/api/auth/google')) return true;
  // All file uploads: note attachments and transaction receipts
  if (method === 'POST' && path.includes('/attachments')) return true;
  if (method === 'POST' && path.includes('/receipts')) return true;
  return false;
}

function id(): string {
  return randomUUID();
}

/** ISO date offset from today, local time — as everywhere in the hub. */
function day(offset: number): string {
  const base = new Date(`${today()}T00:00:00`);
  base.setDate(base.getDate() + offset);
  const y = base.getFullYear();
  const m = String(base.getMonth() + 1).padStart(2, '0');
  const d = String(base.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Fills the current context's database with an example family. Expects an empty database. */
export async function seedDemo(): Promise<void> {
  const n = (db.prepare('SELECT count(*) AS n FROM users').get() as { n: number }).n;
  if (n > 0) return;

  // Demo login is automatic (POST /api/auth/demo), the password is never
  // told to anyone — hence random. The hardcoded demo1234 was shorter
  // than the hub's own minimum and lived in two places in the code.
  const passwordHash = await hashPassword(randomUUID());
  const alex = id();
  const sam = id();

  const seed = db.transaction(() => {
    // ── Family ──
    db.prepare(
      `INSERT INTO users (id, email, name, role, password_hash, color, created_at) VALUES
       (?, 'alex@family.hub', 'Alex', 'admin', ?, '#2E6F8E', ?),
       (?, 'sam@family.hub', 'Sam', 'member', ?, '#B4654A', ?)`,
    ).run(alex, passwordHash, now(), sam, passwordHash, now());

    // ── Projects and tasks ──
    const home = id();
    const trip = id();
    db.prepare(
      `INSERT INTO projects (id, title, description, color, position, created_by) VALUES
       (?, 'Home improvement', 'Everything the house keeps asking for', '#4A7A5A', 1, ?),
       (?, 'Summer trip', 'Two weeks along the coast', '#B4654A', 2, ?)`,
    ).run(home, alex, trip, alex);

    const paint = id();
    db.prepare(
      `INSERT INTO tasks (id, project_id, level, title, status, priority, due_date, assignee_id, position, created_by) VALUES
       (?, ?, 0, 'Repaint the hallway', 'in_progress', 'normal', ?, ?, 1, ?),
       (?, ?, 1, 'Pick the colour together', 'done', 'normal', NULL, ?, 2, ?),
       (?, ?, 1, 'Buy paint and tape', 'todo', 'high', ?, ?, 3, ?),
       (?, ?, 0, 'Fix the dripping tap', 'todo', 'urgent', ?, ?, 4, ?),
       (?, ?, 0, 'Book the ferry', 'todo', 'high', ?, ?, 5, ?),
       (?, ?, 0, 'Renew passports', 'backlog', 'normal', NULL, NULL, 6, ?)`,
    ).run(
      paint, home, day(5), alex, alex,
      id(), home, sam, alex,
      id(), home, day(2), alex, alex,
      id(), home, day(0), sam, sam,
      id(), trip, day(12), sam, sam,
      id(), trip, alex,
    );
    // Showcases the expected-finish date (#7): the due date is past, but
    // the repair is known to take a week — the task is not overdue
    db.prepare(
      `INSERT INTO tasks (id, project_id, level, title, status, priority, due_date, expected_date,
                          assignee_id, position, created_by)
       VALUES (?, ?, 0, 'Coffee machine in repair', 'in_progress', 'normal', ?, ?, ?, 7, ?)`,
    ).run(id(), home, day(-3), day(4), alex, alex);
    // Nesting: "buy paint" goes under the repaint story
    db.prepare(
      `UPDATE tasks SET parent_id = ?, level = 1 WHERE title IN ('Pick the colour together', 'Buy paint and tape')`,
    ).run(paint);

    // ── Notes ──
    const recipes = id();
    db.prepare(
      `INSERT INTO folders (id, name, position) VALUES (?, 'Recipes', 1)`,
    ).run(recipes);
    db.prepare(
      `INSERT INTO notes (id, title, body_md, folder_id, owner_id, pinned) VALUES
       (?, 'Shopping list', '- Milk\n- Eggs\n- Coffee beans\n- Paint tape (see [[Repaint the hallway]])\n- Something nice for Friday', NULL, ?, 1),
       (?, 'Pizza dough', '**500 g** flour · 325 ml water · 10 g salt · 3 g yeast\n\nKnead, rest overnight in the fridge, bake as hot as the oven goes.', ?, ?, 0),
       (?, 'House rules for guests', 'Wi-Fi: *familyhub / pizzafriday*\n\nCoffee machine: one scoop, button, patience.', NULL, ?, 0)`,
    ).run(id(), alex, id(), recipes, sam, id(), alex);

    // ── Calendar ──
    const shared = '00000000-0000-4000-8000-000000000201'; // the seeded shared calendar from the migration
    const gym = id();
    const dentist = id();
    const birthday = id();
    db.prepare(
      `INSERT INTO events (id, calendar_id, title, location, starts_at, ends_at, all_day, recurrence_rule, remind_days_before, created_by) VALUES
       (?, ?, 'Gym', 'Iron Temple', ?, ?, 0, 'FREQ=WEEKLY;INTERVAL=1', NULL, ?),
       (?, ?, 'Dentist', 'Dr. Molar', ?, ?, 0, NULL, 1, ?),
       (?, ?, 'Grandma''s birthday', NULL, ?, ?, 1, 'FREQ=YEARLY;INTERVAL=1', 7, ?)`,
    ).run(
      gym, shared, `${day(1)}T18:30`, `${day(1)}T20:00`, alex,
      dentist, shared, `${day(3)}T11:00`, `${day(3)}T11:45`, sam,
      birthday, shared, day(9), day(9), alex,
    );
    db.prepare(
      `INSERT INTO event_participants (event_id, user_id) VALUES (?, ?), (?, ?), (?, ?)`,
    ).run(gym, alex, gym, sam, dentist, sam);

    // ── Money ──
    const card = id();
    const cash = id();
    db.prepare(
      `INSERT INTO accounts (id, name, currency, kind, opening_balance, shared, color, position, created_by) VALUES
       (?, 'Joint card', 'EUR', 'card', 250000, 1, '#1F6E8C', 1, ?),
       (?, 'Cash', 'EUR', 'cash', 12000, 1, '#4A7A5A', 2, ?)`,
    ).run(card, alex, cash, alex);

    const groceries = id();
    const eatingOut = id();
    const household = id();
    const salary = id();
    db.prepare(
      `INSERT INTO categories (id, name, kind, color, position) VALUES
       (?, 'Groceries', 'expense', '#4A7A5A', 1),
       (?, 'Eating out', 'expense', '#B4654A', 2),
       (?, 'Household', 'expense', '#5A6A74', 3),
       (?, 'Salary', 'income', '#2E6F8E', 4)`,
    ).run(groceries, eatingOut, household, salary);

    db.prepare(
      `INSERT INTO transactions (id, kind, occurred_on, account_id, amount, to_account_id, to_amount, category_id, note, place, created_by) VALUES
       (?, 'income',  ?, ?, 210000, NULL, NULL, ?, 'Salary', NULL, ?),
       (?, 'expense', ?, ?, 6470,  NULL, NULL, ?, NULL, 'Lidl', ?),
       (?, 'expense', ?, ?, 3890,  NULL, NULL, ?, NULL, 'Market', ?),
       (?, 'expense', ?, ?, 5200,  NULL, NULL, ?, 'Pizza night', 'Napoli', ?),
       (?, 'expense', ?, ?, 2340,  NULL, NULL, ?, 'Paint rollers', 'DIY store', ?),
       (?, 'transfer', ?, ?, 10000, ?, 10000, NULL, 'Pocket cash', NULL, ?)`,
    ).run(
      id(), day(-9), card, salary, alex,
      id(), day(-6), card, groceries, sam,
      id(), day(-3), cash, groceries, alex,
      id(), day(-2), card, eatingOut, sam,
      id(), day(-1), card, household, alex,
      id(), day(-5), card, cash, alex,
    );

    db.prepare(
      `INSERT INTO budgets (id, category_id, currency, month, amount) VALUES
       (?, ?, 'EUR', NULL, 40000),
       (?, ?, 'EUR', NULL, 15000)`,
    ).run(id(), groceries, id(), eatingOut);

    db.prepare(
      `INSERT INTO recurring_transactions (id, title, kind, start_on, recurrence_rule, account_id, amount, category_id, auto_create, active) VALUES
       (?, 'Rent', 'expense', ?, 'FREQ=MONTHLY;INTERVAL=1', ?, 95000, ?, 1, 1),
       (?, 'Salary', 'income', ?, 'FREQ=MONTHLY;INTERVAL=1', ?, 210000, ?, 0, 1)`,
    ).run(id(), day(-40), card, household, id(), day(-40), card, salary);

    // ── Dashboard ──
    db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES
       ('move.label', 'Trip countdown', ?),
       ('move.target_date', ?, ?),
       ('savings.label', 'Saved for the trip', ?),
       ('savings.goal_eur', '3000', ?),
       ('savings.amount_eur', '1250', ?),
       ('money.default_currency', 'EUR', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(now(), day(45), now(), now(), now(), now(), now());
  });

  seed();
}
