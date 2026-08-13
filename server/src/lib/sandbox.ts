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
  Demo-mode sandboxes: every visitor gets their own copy of the database.

  All demo visitors used to live in one database: the first prankster
  filled it with garbage (or simply deleted everything), and the rest saw
  that until the nightly reset. Now demo login copies a template database —
  the visitor gets a fresh example and can do anything with it: nobody
  but them will ever see it.

  How it works:
  — the template is built at startup (migrations + seeding) and rebuilt
    once a day, because demo data is dated relative to "today";
  — copying the template is milliseconds and hundreds of kilobytes, the
    sandbox is created right in the login handler;
  — lifecycle: idle past TTL, file size overrun or registry overflow
    (LRU) — the sandbox is closed and its file deleted. The directory is
    wiped entirely at startup: restart = clean slate.
*/

export const SANDBOX_COOKIE = 'hub_sandbox';

const TTL_MS = 2 * 60 * 60_000; // two hours idle
const SWEEP_MS = 10 * 60_000;
const TEMPLATE_REBUILD_MS = 24 * 60 * 60_000;
const MAX_SANDBOXES = 100;
// An emergency brake against one sandbox ballooning from a write loop.
// The template weighs hundreds of kilobytes; honest poking around
// will never accumulate that much.
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
  // Orphaned files from the previous run are useless: the registry lives in memory
  rmSync(demoDir, { recursive: true, force: true });
  mkdirSync(sandboxesDir, { recursive: true });

  await buildTemplate();

  setInterval(sweep, SWEEP_MS).unref();
  setInterval(() => {
    buildTemplate().catch((err) => log.error('demo: template rebuild failed', err));
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
 * The template is built into a temp file and swapped in atomically: a
 * sandbox created mid-rebuild copies either the old template or the new
 * one — never a half-built one.
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
    // close() flushes the WAL into the main file — the copy will be whole
    template.close();
  }
  renameSync(tmp, templatePath);
  log.info('demo: template built');
}

export function createSandbox(): Sandbox {
  if (sandboxes.size >= MAX_SANDBOXES) evictOldest();

  // The identifier is effectively the second half of authorization, hence
  // unpredictable. Only the value generated here goes into the file path;
  // the visitor's cookie is looked up strictly as a registry key.
  const id = randomBytes(16).toString('base64url');
  const file = join(sandboxesDir, `${id}.db`);
  copyFileSync(templatePath, file);

  const sandbox: Sandbox = { id, db: openDatabase(file), file, lastSeen: Date.now() };
  sandboxes.set(id, sandbox);
  log.info(`demo: sandbox created (${sandboxes.size} active)`);
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
    log.warn('demo: sandbox database failed to close', err);
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
