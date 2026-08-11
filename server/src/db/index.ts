import Database from 'better-sqlite3';
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

export const db = new Database(paths.db);

// WAL — параллельное чтение во время записи, важно для стенда,
// который опрашивает дашборд, пока кто-то редактирует заметку.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');

// Встроенные lower() и LIKE в SQLite регистронезависимы только для латиницы:
// «Справка» по запросу «справ» не находится. Регистрируем свою функцию,
// которая приводит регистр средствами JavaScript и потому знает все алфавиты.
db.function('ci_contains', (haystack: unknown, needle: unknown) => {
  if (typeof haystack !== 'string' || typeof needle !== 'string') return 0;
  return haystack.toLocaleLowerCase().includes(needle.toLocaleLowerCase()) ? 1 : 0;
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
