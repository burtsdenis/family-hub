import Database from 'better-sqlite3';
import { AsyncLocalStorage } from 'node:async_hooks';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { env, legacyDataDir, paths } from '../env.js';
import { log } from '../lib/log.js';

/**
 * One-time move of data from the old ./data to the new place.
 *
 * Plain file copying won't do: the database runs in WAL mode, and the
 * latest writes live not in hub.db but in the adjacent hub.db-wal. Copy
 * hub.db alone and you get a database without the fresh changes — and
 * without the password the person just set.
 *
 * So we open the database as a database and export it as a whole file:
 * SQLite honors the journal on open, and the output is a consistent copy.
 * The original is not deleted — if anything goes wrong, it stays put.
 */
function adoptLegacyData(): void {
  if (existsSync(paths.db)) return;
  if (legacyDataDir === env.dataDir) return;

  const legacyDb = join(legacyDataDir, 'hub.db');
  if (!existsSync(legacyDb)) return;

  mkdirSync(env.dataDir, { recursive: true });

  const source = new Database(legacyDb);
  try {
    source.exec(`VACUUM INTO '${paths.db.replace(/'/g, "''")}'`);
  } finally {
    source.close();
  }

  for (const dir of ['attachments', 'backups']) {
    const from = join(legacyDataDir, dir);
    if (existsSync(from)) cpSync(from, join(env.dataDir, dir), { recursive: true });
  }

  log.block([
    '',
    `  Data moved from ${legacyDataDir}`,
    `  to ${env.dataDir} — it no longer depends on code updates.`,
    '  The old copy is left in place; it is safe to delete.',
    '',
  ]);
}

adoptLegacyData();

mkdirSync(dirname(paths.db), { recursive: true });
mkdirSync(paths.attachments, { recursive: true });
mkdirSync(paths.backups, { recursive: true });

/**
 * Opening the database is a function because there can be more than one:
 * demo mode keeps a sandbox per visitor, and each must get the same
 * pragmas and the same registered functions as the main one — otherwise
 * queries using ci_contains would fail only inside sandboxes.
 */
export function openDatabase(file: string): Database.Database {
  const d = new Database(file);

  // WAL — concurrent reads during writes, matters for the wall display
  // polling the dashboard while someone is editing a note.
  d.pragma('journal_mode = WAL');
  d.pragma('foreign_keys = ON');
  d.pragma('synchronous = NORMAL');
  d.pragma('busy_timeout = 5000');

  // SQLite's built-in lower() and LIKE are case-insensitive only for Latin:
  // «Справка» is not found by the query «справ». We register our own function
  // that folds case in JavaScript and therefore knows every alphabet.
  d.function('ci_contains', (haystack: unknown, needle: unknown) => {
    if (typeof haystack !== 'string' || typeof needle !== 'string') return 0;
    return haystack.toLocaleLowerCase().includes(needle.toLocaleLowerCase()) ? 1 : 0;
  });

  return d;
}

const mainDb = openDatabase(paths.db);

/*
  Which database serves the current request.

  In normal mode there is one database and the context is always empty —
  mainDb does the work. In demo mode every visitor lives in their own
  sandbox: the hook in index.ts puts its database into AsyncLocalStorage
  for the duration of the request, and all code below — routes, auth,
  migrations, seeding — transparently works with it through the exported
  Proxy. No route knows about sandboxes.

  This is a deliberate prototype of the future hosted "database per
  family" mode: the layer can already route a request to its database,
  only the mapping source needs replacing (sandbox cookie → permanent
  family).
*/
const dbContext = new AsyncLocalStorage<Database.Database>();

export function currentDb(): Database.Database {
  return dbContext.getStore() ?? mainDb;
}

/** Run fn (async included) so that all code inside sees database d. */
export function runWithDb<T>(d: Database.Database, fn: () => T): T {
  return dbContext.run(d, fn);
}

/*
  The same better-sqlite3 interface, but methods always go to the current
  request's database. Statements are not cached at module level anywhere
  in the project (verified), so late binding at call time is enough.
*/
export const db: Database.Database = new Proxy({} as Database.Database, {
  get(_target, prop) {
    const d = currentDb();
    const value = Reflect.get(d, prop) as unknown;
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(d) : value;
  },
});

export function id(): string {
  return crypto.randomUUID();
}

export function now(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Today's date by the process's local clock (TZ), not UTC.
 *
 * toISOString() gives the Greenwich date: between midnight and +01/+02 it
 * is still yesterday's, and the dashboard and recurring transactions would
 * live in "yesterday". The frontend (web/src/lib/tasks.ts) computes
 * "today" the same way — by the local clock; the server must agree.
 */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}
