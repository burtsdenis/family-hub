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
  /** Whether Google is linked — the fact is enough for the frontend, the sub itself never leaves. */
  google_linked: number;
  password_login_disabled: number;
  /** Whether TOTP is confirmed — the fact only; the secret never leaves. */
  totp_enabled: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// ── Sessions ──────────────────────────────────────────────────────────────

/** UTC wall stamp in the same shape created_at uses — one format, plain string ordering. */
function utcStamp(date = new Date()): string {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

export function createSession(userId: string, userAgent: string | undefined, ip?: string): string {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, user_agent, last_seen_at, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id(), userId, hashToken(token), expires.toISOString(), userAgent ?? null, utcStamp(), ip ?? null);
  return token;
}

export function destroySession(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

/**
 * The "stolen phone" button: kills every session of the user except the
 * one making the request. Combined with the client wiping its offline
 * caches on the next 401, the lost device loses both the session and
 * the cached family data as soon as it touches the network.
 */
export function destroyOtherSessions(userId: string, currentToken: string): number {
  const result = db
    .prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?')
    .run(userId, hashToken(currentToken));
  return result.changes;
}

export function destroyAllSessions(userId: string): void {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function userForToken(token: string): AuthUser | null {
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.role, u.color, u.must_change_password,
              (u.google_sub IS NOT NULL) AS google_linked, u.password_login_disabled,
              (u.totp_confirmed_at IS NOT NULL) AS totp_enabled
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

// ── Route protection ──────────────────────────────────────────────────────

const PUBLIC_PATHS = new Set([
  '/api/health',
  '/api/auth/login',
  // The TOTP step of sign-in: the session does not exist yet, the
  // short-lived ticket from /login is the authorization
  '/api/auth/mfa',
  '/api/auth/state',
  // Demo login: creates the sandbox and the session, so it predates both
  '/api/auth/demo',
  // Google sign-in: start and callback predate the session.
  // Linking (/google/link) is deliberately absent — it requires a session.
  '/api/auth/google/start',
  '/api/auth/google/callback',
  // Onboarding: initial setup and invite login — before any session
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
    return reply.code(401).send({ error: 'Sign in required' });
  }
  touchSession(token!, req.ip);

  // Until the password is changed, only the change endpoint is available
  if (user.must_change_password && path !== '/api/auth/change-password' && path !== '/api/auth/me') {
    return reply.code(403).send({ error: 'Change your password first', code: 'must_change_password' });
  }

  // Public sandbox: password changes, family membership and file uploads
  // are disabled — everything else is deliberately live
  if (env.demoMode) {
    const { demoBlocked } = await import('./demo.js');
    if (demoBlocked(req.method, path)) {
      return reply.code(403).send({ error: 'Disabled in the demo' });
    }
  }

  req.user = user;
}

export function requireAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  if (req.user?.role !== 'admin') {
    reply.code(403).send({ error: 'This section is for the administrator only' });
    return false;
  }
  return true;
}

// ── First start ───────────────────────────────────────────────────────────

/**
 * An empty database is no reason to write passwords into the log. The
 * person creates the first account themselves in the browser (the initial
 * setup screen); the server only hints at it in the log. Printing a
 * one-time admin password left together with the service account:
 * whoever sets up first is the admin.
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

/** Expired sessions are removed at startup so the table doesn't grow forever. */
export function pruneSessions(): void {
  const now = new Date();
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now.toISOString());
  // Idle sessions retire long before the hard 90-day expiry: a session
  // nobody used for a month is an orphaned cookie (re-login in the same
  // browser replaced it) or an abandoned device — either way, dead
  // weight in the Devices list. Everything here is the same
  // 'YYYY-MM-DD HH:MM:SS' UTC shape, so plain string comparison holds;
  // rows from before last_seen_at existed fall back to created_at.
  const idleCutoff = utcStamp(new Date(now.getTime() - 30 * 86_400_000));
  db.prepare(
    `DELETE FROM sessions WHERE coalesce(last_seen_at, created_at) <= ?`,
  ).run(idleCutoff);
}

/**
 * Activity stamp for the Devices list, throttled to one write per
 * session per 5 minutes — the dashboard polling once a minute must not
 * turn every request into an UPDATE.
 */
export function touchSession(token: string, ip: string | undefined): void {
  const cutoff = utcStamp(new Date(Date.now() - 5 * 60_000));
  db.prepare(
    `UPDATE sessions SET last_seen_at = ?, ip = ?
      WHERE token_hash = ? AND (last_seen_at IS NULL OR last_seen_at < ?)`,
  ).run(utcStamp(), ip ?? null, hashToken(token), cutoff);
}
