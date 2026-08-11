import Database from 'better-sqlite3';
import { AsyncLocalStorage } from 'node:async_hooks';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { env, legacyDataDir, paths } from '../env.js';
import { log } from '../lib/log.js';

/**
 * Однократный перенос данных из старого ./data в новое место.
 *
 * Простым копированием файлов это делать нельзя: база работает в режиме WAL,
 * и последние записи лежат не в hub.db, а в соседнем hub.db-wal. Скопировав
 * один hub.db, получишь базу без свежих изменений — и без пароля, который
 * человек только что задал.
 *
 * Поэтому открываем базу как базу и выгружаем цельным файлом: SQLite при
 * открытии учитывает журнал, и на выходе получается согласованная копия.
 * Исходное не удаляем — если что-то пойдёт не так, оно останется на месте.
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
    `  Данные перенесены из ${legacyDataDir}`,
    `  в ${env.dataDir} — теперь они не зависят от обновлений кода.`,
    '  Старая копия оставлена на месте, её можно удалить.',
    '',
  ]);
}

adoptLegacyData();

mkdirSync(dirname(paths.db), { recursive: true });
mkdirSync(paths.attachments, { recursive: true });
mkdirSync(paths.backups, { recursive: true });

/**
 * Открытие базы вынесено в функцию, потому что баз может быть больше одной:
 * демо-режим держит по песочнице на посетителя, и каждая должна получить
 * те же pragma и те же зарегистрированные функции, что и основная, —
 * иначе запросы с ci_contains будут падать только в песочницах.
 */
export function openDatabase(file: string): Database.Database {
  const d = new Database(file);

  // WAL — параллельное чтение во время записи, важно для стенда,
  // который опрашивает дашборд, пока кто-то редактирует заметку.
  d.pragma('journal_mode = WAL');
  d.pragma('foreign_keys = ON');
  d.pragma('synchronous = NORMAL');
  d.pragma('busy_timeout = 5000');

  // Встроенные lower() и LIKE в SQLite регистронезависимы только для латиницы:
  // «Справка» по запросу «справ» не находится. Регистрируем свою функцию,
  // которая приводит регистр средствами JavaScript и потому знает все алфавиты.
  d.function('ci_contains', (haystack: unknown, needle: unknown) => {
    if (typeof haystack !== 'string' || typeof needle !== 'string') return 0;
    return haystack.toLocaleLowerCase().includes(needle.toLocaleLowerCase()) ? 1 : 0;
  });

  return d;
}

const mainDb = openDatabase(paths.db);

/*
  Какая база обслуживает текущий запрос.

  В обычном режиме база одна, и контекст всегда пуст — работает mainDb.
  В демо-режиме каждый посетитель живёт в своей песочнице: хук в index.ts
  кладёт её базу в AsyncLocalStorage на время запроса, и весь код ниже —
  роуты, auth, миграции, сидинг — прозрачно работает с ней через
  экспортируемый Proxy. Ни один роут о песочницах не знает.

  Это осознанный прототип будущего hosted-режима «база на семью»:
  слой уже умеет направлять запрос в свою базу, останется заменить
  источник соответствия (кука песочницы → постоянная семья).
*/
const dbContext = new AsyncLocalStorage<Database.Database>();

export function currentDb(): Database.Database {
  return dbContext.getStore() ?? mainDb;
}

/** Выполнить fn (в т.ч. async) так, чтобы весь код внутри видел базу d. */
export function runWithDb<T>(d: Database.Database, fn: () => T): T {
  return dbContext.run(d, fn);
}

/*
  Тот же интерфейс better-sqlite3, но методы всегда уходят в базу текущего
  запроса. Statements нигде в проекте не кэшируются на уровне модулей
  (проверено), поэтому позднего связывания на уровне вызова достаточно.
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
 * Дата «сегодня» по местным часам процесса (TZ), а не по UTC.
 *
 * toISOString() даёт дату по Гринвичу: между полуночью и +01/+02 она ещё
 * вчерашняя, и дашборд с регулярными операциями жили бы во «вчера».
 * Фронт (web/src/lib/tasks.ts) считает «сегодня» так же — по местным часам,
 * сервер обязан быть с ним согласован.
 */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}
