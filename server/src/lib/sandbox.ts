import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openDatabase, runWithDb } from '../db/index.js';
import { migrate } from '../db/migrate.js';
import { env } from '../env.js';
import { seedDemo } from './demo.js';
import { log } from './log.js';

/*
  Песочницы демо-режима: у каждого посетителя — своя копия базы.

  Раньше все посетители демо жили в одной базе: первый же шутник заполнял
  её мусором (или просто всё удалял), и остальные видели это до ночного
  сброса. Теперь при входе в демо копируется шаблонная база — посетитель
  получает свежий пример и может делать с ним что угодно: кроме него самого
  этого никто не увидит.

  Устройство:
  — шаблон собирается при старте (миграции + сидинг) и пересобирается раз
    в сутки, потому что демо-данные датируются относительно «сегодня»;
  — копия шаблона — миллисекунды и сотни килобайт, песочница создаётся
    прямо в обработчике входа;
  — жизненный цикл: простой дольше TTL, превышение размера файла или
    переполнение реестра (LRU) — песочница закрывается и файл удаляется.
    Каталог целиком зачищается при старте: рестарт = чистый лист.
*/

export const SANDBOX_COOKIE = 'hub_sandbox';

const TTL_MS = 2 * 60 * 60_000; // два часа простоя
const SWEEP_MS = 10 * 60_000;
const TEMPLATE_REBUILD_MS = 24 * 60 * 60_000;
const MAX_SANDBOXES = 100;
// Стоп-кран против раздувания одной песочницы записью в цикле.
// Шаблон весит сотни килобайт, честное «потыкать» столько не наберёт.
const MAX_DB_BYTES = 50 * 1024 * 1024;

const demoDir = join(env.dataDir, 'demo');
const templatePath = join(demoDir, 'template.db');
const sandboxesDir = join(demoDir, 'sandboxes');

interface Sandbox {
  id: string;
  db: Database.Database;
  file: string;
  lastSeen: number;
}

const sandboxes = new Map<string, Sandbox>();

export async function initDemo(): Promise<void> {
  // Осиротевшие файлы прошлого запуска бесполезны: реестр живёт в памяти
  rmSync(demoDir, { recursive: true, force: true });
  mkdirSync(sandboxesDir, { recursive: true });

  await buildTemplate();

  setInterval(sweep, SWEEP_MS).unref();
  setInterval(() => {
    buildTemplate().catch((err) => log.error('демо: пересборка шаблона не удалась', err));
  }, TEMPLATE_REBUILD_MS).unref();

  log.block([
    '',
    '─'.repeat(64),
    '  DEMO MODE: every visitor gets a fresh throwaway sandbox.',
    `  Idle sandboxes are dropped after ${TTL_MS / 60_000} minutes.`,
    '─'.repeat(64),
    '',
  ]);
}

/**
 * Шаблон строится во временный файл и подменяется атомарно: создание
 * песочницы в момент пересборки скопирует либо старый шаблон, либо новый —
 * но никогда полусобранный.
 */
async function buildTemplate(): Promise<void> {
  const tmp = `${templatePath}.new`;
  rmSync(tmp, { force: true });

  const template = openDatabase(tmp);
  try {
    await runWithDb(template, async () => {
      migrate();
      await seedDemo();
    });
  } finally {
    // close() выкатывает WAL в основной файл — копия будет цельной
    template.close();
  }
  renameSync(tmp, templatePath);
  log.info('демо: шаблон собран');
}

export function createSandbox(): Sandbox {
  if (sandboxes.size >= MAX_SANDBOXES) evictOldest();

  // Идентификатор — фактически вторая часть авторизации, поэтому
  // непредсказуемый. В пути файла участвует только сгенерированное здесь
  // значение, кука посетителя ищется исключительно как ключ реестра.
  const id = randomBytes(16).toString('base64url');
  const file = join(sandboxesDir, `${id}.db`);
  copyFileSync(templatePath, file);

  const sandbox: Sandbox = { id, db: openDatabase(file), file, lastSeen: Date.now() };
  sandboxes.set(id, sandbox);
  log.info(`демо: песочница создана (${sandboxes.size} активных)`);
  return sandbox;
}

export function getSandbox(id: string): Sandbox | null {
  const sandbox = sandboxes.get(id);
  if (!sandbox) return null;
  sandbox.lastSeen = Date.now();
  return sandbox;
}

export function destroySandbox(id: string): void {
  const sandbox = sandboxes.get(id);
  if (!sandbox) return;
  sandboxes.delete(id);
  try {
    sandbox.db.close();
  } catch (err) {
    log.warn('демо: база песочницы не закрылась', err);
  }
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(`${sandbox.file}${suffix}`, { force: true });
  }
}

function evictOldest(): void {
  let oldest: Sandbox | null = null;
  for (const sandbox of sandboxes.values()) {
    if (!oldest || sandbox.lastSeen < oldest.lastSeen) oldest = sandbox;
  }
  if (oldest) destroySandbox(oldest.id);
}

function sweep(): void {
  const now = Date.now();
  for (const sandbox of [...sandboxes.values()]) {
    const idle = now - sandbox.lastSeen > TTL_MS;
    const oversized = existsSync(sandbox.file) && statSync(sandbox.file).size > MAX_DB_BYTES;
    if (idle || oversized) destroySandbox(sandbox.id);
  }
}
