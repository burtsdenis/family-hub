#!/usr/bin/env node
/**
 * Загрузка данных из архива на новом устройстве.
 *
 * Перед подменой проверяет целостность базы и сходится ли содержимое
 * с описью. Существующие данные не трогает без явного разрешения:
 * молча переписать чужую базу — самый дорогой из возможных сюрпризов.
 *
 * Запуск: npm run import -- путь/к/family-hub-2026-08-03.tar.gz
 *         npm run import -- архив.tar.gz --force
 */
import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const force = args.includes('--force');
const archive = args.find((a) => !a.startsWith('--'));

if (!archive) {
  console.error('Укажите архив: npm run import -- путь/к/family-hub-ГГГГ-ММ-ДД.tar.gz');
  process.exit(1);
}
if (!existsSync(archive)) {
  console.error(`Архива нет: ${resolve(archive)}`);
  process.exit(1);
}

const dataDir = resolve(process.env.DATA_DIR ?? join(homedir(), '.family-hub'));
const existingDb = join(dataDir, 'hub.db');
const staging = mkdtempSync(join(tmpdir(), 'hub-import-'));

try {
  execFileSync('tar', ['-xzf', resolve(archive), '-C', staging], { stdio: 'inherit' });

  const incomingDb = join(staging, 'hub.db');
  if (!existsSync(incomingDb)) {
    console.error('В архиве нет hub.db — это не выгрузка Дома.');
    process.exit(1);
  }

  const manifest = existsSync(join(staging, 'manifest.json'))
    ? JSON.parse(readFileSync(join(staging, 'manifest.json'), 'utf8'))
    : null;

  // Проверяем до подмены: битую базу лучше не ставить вовсе
  const incoming = new Database(incomingDb, { readonly: true });
  const integrity = incoming.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') {
    console.error(`База в архиве повреждена: ${integrity}`);
    process.exit(1);
  }

  const mismatches = [];
  if (manifest?.counts) {
    for (const [table, expected] of Object.entries(manifest.counts)) {
      if (expected === null) continue;
      try {
        const actual = incoming.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
        if (actual !== expected) mismatches.push(`${table}: в описи ${expected}, в базе ${actual}`);
      } catch {
        mismatches.push(`${table}: таблицы нет`);
      }
    }
  }
  const applied = incoming
    .prepare('SELECT name FROM _migrations ORDER BY name')
    .all()
    .map((r) => r.name);
  incoming.close();

  if (mismatches.length > 0) {
    console.error('Содержимое не сходится с описью:');
    for (const line of mismatches) console.error(`  ${line}`);
    process.exit(1);
  }

  // Существующие данные
  const occupied = existsSync(existingDb);
  if (occupied && !force) {
    console.error('');
    console.error(`В ${dataDir} уже есть база.`);
    console.error('Загрузка перезапишет её. Если это то, что нужно, добавьте --force:');
    console.error(`  npm run import -- ${archive} --force`);
    console.error('');
    console.error('Прежняя база будет отложена в сторону, а не удалена.');
    process.exit(1);
  }

  mkdirSync(dataDir, { recursive: true });

  if (occupied) {
    const backup = join(dataDir, `hub-before-import-${new Date().toISOString().slice(0, 10)}.db`);
    renameSync(existingDb, backup);
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(existingDb + suffix)) rmSync(existingDb + suffix);
    }
    console.log(`Прежняя база отложена: ${backup}`);
  }

  cpSync(incomingDb, existingDb);

  const incomingAttachments = join(staging, 'attachments');
  if (existsSync(incomingAttachments)) {
    cpSync(incomingAttachments, join(dataDir, 'attachments'), { recursive: true });
  }
  mkdirSync(join(dataDir, 'backups'), { recursive: true });

  // Считаем именно файлы: recursive перечисляет и подкаталоги по месяцам
  const attachmentsDir = join(dataDir, 'attachments');
  const files = existsSync(attachmentsDir)
    ? readdirSync(attachmentsDir, { recursive: true, withFileTypes: true }).filter((e) =>
        e.isFile(),
      ).length
    : 0;

  console.log('');
  console.log(`Данные загружены в ${dataDir}`);
  console.log(`Миграций в базе: ${applied.length}, последняя ${applied.at(-1) ?? '—'}`);
  if (manifest) {
    const rows = Object.entries(manifest.counts)
      .filter(([, n]) => n)
      .map(([table, n]) => `${table}: ${n}`);
    console.log(`Содержимое: ${rows.join(', ')}`);
    console.log(`Выгружено: ${manifest.exported_at}`);
  }
  console.log(`Файлов вложений на диске: ${files}`);
  console.log('');
  console.log('Дальше:');
  console.log('  1. npm run dev  — или docker compose up -d --build');
  console.log('  2. Пароли и учётки перенеслись, первичная настройка не нужна');
  console.log('  3. Если был HTTPS: ./scripts/setup-https.sh — сертификат нужен свой');
  console.log('  4. sudo pmset repeat wakeorpoweron MTWRFSU 06:30:00');
} finally {
  rmSync(staging, { recursive: true, force: true });
}
