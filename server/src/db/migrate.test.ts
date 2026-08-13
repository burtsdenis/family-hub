import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openDatabase, runWithDb } from './index.js';
import { migrate } from './migrate.js';

/*
  A smoke test of the whole schema: every migration must apply on an empty
  database with foreign_keys enabled. This used to be checked by hand
  before every schema change — now the run is part of CI.
*/

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

describe('migrations', () => {
  it('all apply on an empty database and exactly once', () => {
    const db = openDatabase(':memory:');
    runWithDb(db, () => migrate());

    const applied = db.prepare('SELECT name FROM _migrations ORDER BY name').all() as {
      name: string;
    }[];
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

    expect(applied.map((r) => r.name)).toEqual(files);

    // A repeat run is idempotent: nothing re-applies and nothing crashes
    runWithDb(db, () => migrate());
    const again = db.prepare('SELECT count(*) AS n FROM _migrations').get() as { n: number };
    expect(again.n).toBe(files.length);
    db.close();
  });

  it('creates the key tables and the seeded rows', () => {
    const db = openDatabase(':memory:');
    runWithDb(db, () => migrate());

    const tables = new Set(
      (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as {
        name: string;
      }[]).map((r) => r.name),
    );
    for (const table of [
      'users', 'sessions', 'invites',
      'projects', 'tasks', 'folders', 'notes', 'attachments',
      'calendars', 'events',
      'accounts', 'categories', 'transactions', 'budgets', 'recurring_transactions',
      'settings',
    ]) {
      expect(tables, `missing table ${table}`).toContain(table);
    }

    // Seeded entities with fixed ids — the client depends on them
    const inbox = db
      .prepare('SELECT id FROM projects WHERE id = ?')
      .get('00000000-0000-4000-8000-000000000001');
    expect(inbox, 'missing the Inbox project').toBeTruthy();
    const shared = db
      .prepare('SELECT id FROM calendars WHERE id = ?')
      .get('00000000-0000-4000-8000-000000000201');
    expect(shared, 'missing the shared calendar').toBeTruthy();
    db.close();
  });
});
