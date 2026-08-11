#!/usr/bin/env node
/**
 * Выгрузка всех данных в один переносимый архив.
 *
 * Копировать hub.db файловым способом нельзя: база работает в режиме WAL,
 * и свежие записи лежат в соседнем журнале. Поэтому база открывается как
 * база и выгружается через VACUUM INTO — на выходе один согласованный файл,
 * и это безопасно даже при работающем сервере.
 *
 * Запуск: npm run export
 *         npm run export -- ~/Desktop
 */
import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const dataDir = resolve(process.env.DATA_DIR ?? join(homedir(), '.family-hub'));
const outDir = resolve(process.argv[2] ?? process.cwd());
const dbPath = join(dataDir, 'hub.db');

if (!existsSync(dbPath)) {
  console.error(`Базы нет: ${dbPath}`);
  console.error('Проверьте DATA_DIR или запустите приложение хотя бы раз.');
  process.exit(1);
}

const stamp = new Date().toISOString().slice(0, 10);
const archive = join(outDir, `family-hub-${stamp}.tar.gz`);
const staging = mkdtempSync(join(tmpdir(), 'hub-export-'));

function countRows(db, table) {
  try {
    return db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
  } catch {
    return null;
  }
}

function dirSize(dir) {
  if (!existsSync(dir)) return { files: 0, bytes: 0 };
  let files = 0;
  let bytes = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    files += 1;
    bytes += statSync(join(entry.parentPath ?? entry.path, entry.name)).size;
  }
  return { files, bytes };
}

try {
  const source = new Database(dbPath, { readonly: true });

  // Согласованный снимок одним файлом, журнал сворачивается внутрь
  source.exec(`VACUUM INTO '${join(staging, 'hub.db').replace(/'/g, "''")}'`);

  const manifest = {
    exported_at: new Date().toISOString(),
    source_data_dir: dataDir,
    migrations: source
      .prepare('SELECT name FROM _migrations ORDER BY name')
      .all()
      .map((r) => r.name),
    counts: Object.fromEntries(
      [
        'users',
        'projects',
        'tasks',
        'notes',
        'note_versions',
        'folders',
        'calendars',
        'events',
        'accounts',
        'categories',
        'transactions',
        'budgets',
        'recurring_transactions',
        'attachments',
        'settings',
      ].map((table) => [table, countRows(source, table)]),
    ),
  };
  source.close();

  const attachments = join(dataDir, 'attachments');
  if (existsSync(attachments)) {
    cpSync(attachments, join(staging, 'attachments'), { recursive: true });
  } else {
    mkdirSync(join(staging, 'attachments'), { recursive: true });
  }
  manifest.attachments = dirSize(join(staging, 'attachments'));

  writeFileSync(join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  mkdirSync(outDir, { recursive: true });
  execFileSync('tar', ['-czf', archive, '-C', staging, '.'], { stdio: 'inherit' });

  const size = statSync(archive).size;
  const rows = Object.entries(manifest.counts)
    .filter(([, n]) => n)
    .map(([table, n]) => `${table}: ${n}`);

  console.log('');
  console.log(`Архив: ${archive}`);
  console.log(`Размер: ${(size / 1024 / 1024).toFixed(1)} МБ`);
  console.log(`Вложений: ${manifest.attachments.files} на ${(manifest.attachments.bytes / 1024 / 1024).toFixed(1)} МБ`);
  console.log(`Содержимое: ${rows.join(', ')}`);
  console.log('');
  console.log('Внутри всё, включая приватные заметки и личные счета.');
  console.log('Передавайте по AirDrop или кабелем, не почтой.');
  console.log('');
  console.log('На новом устройстве: npm install && npm run import -- путь/к/архиву');
} finally {
  rmSync(staging, { recursive: true, force: true });
}
