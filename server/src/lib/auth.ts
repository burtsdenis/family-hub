import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { db, id } from '../db/index.js';
import { env } from '../env.js';
import { log } from './log.js';

export const SESSION_COOKIE = 'hub_session';
const SESSION_DAYS = 90;

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'member' | 'kid';
  color: string;
  must_change_password: number;
  /** Привязан ли Google — фронту хватает факта, сам sub наружу не ходит. */
  google_linked: number;
  password_login_disabled: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// ── Сессии ────────────────────────────────────────────────────────────────

export function createSession(userId: string, userAgent: string | undefined): string {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, user_agent)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id(), userId, hashToken(token), expires.toISOString(), userAgent ?? null);
  return token;
}

export function destroySession(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

export function destroyAllSessions(userId: string): void {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function userForToken(token: string): AuthUser | null {
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.role, u.color, u.must_change_password,
              (u.google_sub IS NOT NULL) AS google_linked, u.password_login_disabled
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?
          AND s.expires_at > ?
          AND u.disabled_at IS NULL`,
    )
    .get(hashToken(token), new Date().toISOString()) as AuthUser | undefined;
  return row ?? null;
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.secureCookies,
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

// ── Защита маршрутов ──────────────────────────────────────────────────────

const PUBLIC_PATHS = new Set([
  '/api/health',
  '/api/auth/login',
  '/api/auth/state',
  // Вход в демо: создаёт песочницу и сессию, живёт до них обеих
  '/api/auth/demo',
  // Вход через Google: начало и возврат живут до сессии.
  // Привязки (/google/link) здесь нет намеренно — она требует сессии.
  '/api/auth/google/start',
  '/api/auth/google/callback',
  // Онбординг: первичная настройка и вход по приглашению — до сессии
  '/api/auth/setup',
  '/api/auth/invite',
  '/api/auth/join',
]);

export async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.url.startsWith('/api')) return;
  const path = req.url.split('?')[0] ?? '';
  if (PUBLIC_PATHS.has(path)) return;

  const token = req.cookies[SESSION_COOKIE];
  const user = token ? userForToken(token) : null;
  if (!user) {
    return reply.code(401).send({ error: 'Нужно войти' });
  }

  // Пока пароль не сменён, доступен только сам метод смены
  if (user.must_change_password && path !== '/api/auth/change-password' && path !== '/api/auth/me') {
    return reply.code(403).send({ error: 'Сначала смените пароль', code: 'must_change_password' });
  }

  // Публичная песочница: смена паролей, состава семьи и загрузка файлов
  // отключены — остальное нарочно живое
  if (env.demoMode) {
    const { demoBlocked } = await import('./demo.js');
    if (demoBlocked(req.method, path)) {
      return reply.code(403).send({ error: 'Отключено в демо-режиме' });
    }
  }

  req.user = user;
}

export function requireAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  if (req.user?.role !== 'admin') {
    reply.code(403).send({ error: 'Раздел доступен только администратору' });
    return false;
  }
  return true;
}

// ── Первый запуск ─────────────────────────────────────────────────────────

/**
 * Пустая база — не повод писать пароли в журнал. Первую учётку человек
 * создаёт сам через браузер (экран первичной настройки), сервер лишь
 * подсказывает об этом в лог. Печать одноразового пароля администратора
 * ушла вместе со служебной учёткой: первый настроивший и есть администратор.
 */
export function announceSetupIfEmpty(): void {
  const count = (db.prepare('SELECT count(*) AS n FROM users').get() as { n: number }).n;
  if (count > 0) return;
  log.block([
    '',
    '─'.repeat(64),
    '  No users yet.',
    '  Open the hub in a browser — it will offer to create the first account.',
    '─'.repeat(64),
    '',
  ]);
}

/** Протухшие сессии убираем при старте, чтобы таблица не росла бесконечно. */
export function pruneSessions(): void {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
}
