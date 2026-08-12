import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openDatabase, runWithDb } from './index.js';
import { migrate } from './migrate.js';

/*
  Смоук всей схемы: каждая миграция обязана применяться на пустой базе
  с включёнными foreign_keys. Раньше это проверялось руками перед каждым
  изменением схемы — теперь прогон входит в CI.
*/

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

describe('миграции', () => {
  it('все применяются на пустой базе и ровно один раз', () => {
    const db = openDatabase(':memory:');
    runWithDb(db, () => migrate());

    const applied = db.prepare('SELECT name FROM _migrations ORDER BY name').all() as {
      name: string;
    }[];
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

    expect(applied.map((r) => r.name)).toEqual(files);

    // Повторный прогон — идемпотентен: ничего не применяется заново и не падает
    runWithDb(db, () => migrate());
    const again = db.prepare('SELECT count(*) AS n FROM _migrations').get() as { n: number };
    expect(again.n).toBe(files.length);
    db.close();
  });

  it('создаёт ключевые таблицы и служебные строки', () => {
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
      expect(tables, `нет таблицы ${table}`).toContain(table);
    }

    // Засеянные сущности с фиксированными id — на них завязан клиент
    const inbox = db
      .prepare('SELECT id FROM projects WHERE id = ?')
      .get('00000000-0000-4000-8000-000000000001');
    expect(inbox, 'нет проекта «Входящие»').toBeTruthy();
    const shared = db
      .prepare('SELECT id FROM calendars WHERE id = ?')
      .get('00000000-0000-4000-8000-000000000201');
    expect(shared, 'нет общего календаря').toBeTruthy();
    db.close();
  });
});
