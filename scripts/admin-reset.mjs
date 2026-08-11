#!/usr/bin/env node
/**
 * Выдача нового пароля администратору.
 *
 * Пароль хранится хешем, и восстановить его нельзя — только заменить.
 * До этого скрипта единственным способом попасть в систему при потерянном
 * пароле было удаление базы, то есть потеря всего.
 *
 * Запуск: npm run admin:reset
 *         npm run admin:reset -- denis@hub.local
 * В Docker: docker compose exec app node scripts/admin-reset.mjs
 */
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const dist = resolve(import.meta.dirname, '..', 'server', 'dist', 'lib', 'password.js');
if (!existsSync(dist)) {
  console.error('Сервер не собран. Сначала: npm run build');
  process.exit(1);
}
const { generatePassword, hashPassword } = await import(dist);

const dataDir = resolve(process.env.DATA_DIR ?? join(homedir(), '.family-hub'));
const dbPath = join(dataDir, 'hub.db');

if (!existsSync(dbPath)) {
  console.error(`Базы нет: ${dbPath}`);
  console.error('Запустите приложение хотя бы раз — оно создаст базу и напечатает пароль само.');
  process.exit(1);
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const wanted = process.argv[2];
const user = wanted
  ? db.prepare('SELECT id, email, name, role FROM users WHERE lower(email) = ?').get(wanted.toLowerCase())
  : db.prepare("SELECT id, email, name, role FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1").get();

if (!user) {
  const all = db.prepare('SELECT email, role FROM users ORDER BY role, email').all();
  console.error(wanted ? `Учётки ${wanted} нет.` : 'Администратора в базе нет.');
  if (all.length > 0) {
    console.error('Есть такие учётки:');
    for (const u of all) console.error(`  ${u.email} · ${u.role}`);
  } else {
    console.error('В базе вообще нет пользователей — удалите hub.db и запустите приложение заново.');
  }
  process.exit(1);
}

const password = generatePassword();
const hash = await hashPassword(password);

db.prepare(
  'UPDATE users SET password_hash = ?, must_change_password = 1, disabled_at = NULL WHERE id = ?',
).run(hash, user.id);

// Прежние сессии закрываем: если пароль сбрасывают, доверять им нельзя
const closed = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id).changes;
db.close();

const line = '─'.repeat(64);
const out = [
  '',
  line,
  `  Новый пароль для ${user.name} (${user.email})`,
  '',
  `    Логин:  ${user.email}`,
  `    Пароль: ${password}`,
  '',
  '  Пароль показан один раз и требует смены при первом входе.',
];
if (closed > 0) {
  out.push(`  Прежние сессии закрыты: ${closed} — войти придётся заново везде.`);
}
out.push(line, '');
console.log(out.join('\n'));
