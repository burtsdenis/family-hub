import type { FastifyInstance } from 'fastify';
import { log } from '../lib/log.js';
import { z } from 'zod';
import { db, now } from '../db/index.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { env } from '../env.js';
import {
  SESSION_COOKIE,
  clearSessionCookie,
  createSession,
  destroyAllSessions,
  destroyOtherSessions,
  destroySession,
  hashToken,
  setSessionCookie,
} from '../lib/auth.js';

/*
  A brake on password guessing — in two dimensions.

  Per login: five wrong attempts lock it for 15 minutes, wherever the
  attempts come from. Per address: twenty wrong attempts from one IP lock
  the address — this catches a dictionary sweep of logins, where each
  login is tried once and the per-login counter never accumulates. The
  address threshold is higher so a family behind one home NAT doesn't
  lock each other out by accident.

  Counters live in memory: a restart resets them, but from outside the
  server is also covered by the general rate limit, and the login route
  has a strict one of its own (see rateLimit below), so even with resets
  the guessing tempo is negligible.
*/
const attempts = new Map<string, { count: number; until: number }>();
const MAX_ATTEMPTS_LOGIN = 5;
const MAX_ATTEMPTS_IP = 20;
const LOCK_MS = 15 * 60_000;

// Stale keys used to be removed only on a repeat hit of the same login/IP —
// sweeping unique keys grew the Map without bound
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attempts) {
    if (now > entry.until) attempts.delete(key);
  }
}, LOCK_MS).unref();

function throttled(key: string, limit: number): boolean {
  const entry = attempts.get(key);
  if (!entry) return false;
  if (Date.now() > entry.until) {
    attempts.delete(key);
    return false;
  }
  return entry.count >= limit;
}

function registerFailure(key: string): void {
  const entry = attempts.get(key) ?? { count: 0, until: Date.now() + LOCK_MS };
  entry.count += 1;
  entry.until = Date.now() + LOCK_MS;
  attempts.set(key, entry);
}

const loginInput = z.object({
  email: z.string().min(1).max(200),
  password: z.string().min(1).max(500),
});

const changeInput = z.object({
  current_password: z.string().min(1).max(500),
  new_password: z.string().min(10, 'Password must be at least 10 characters').max(500),
});

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  /** Whether any users exist at all — so the frontend knows what to show. */
  app.get('/api/auth/state', () => {
    // In demo the answer is fixed: the main database is empty (life
    // happens in sandboxes), but the initial setup screen must not be
    // shown, and there is one way in — the "Try the demo" button.
    if (env.demoMode) return { initialized: true, google: false, demo: true };
    const n = (db.prepare('SELECT count(*) AS n FROM users').get() as { n: number }).n;
    return {
      initialized: n > 0,
      // Whether showing the "Sign in with Google" button makes sense
      google: Boolean(env.googleClientId && env.googleClientSecret && env.publicUrl),
      demo: false,
    };
  });

  // A strict rate limit specifically on login, on top of the general one:
  // a password-guessing script doesn't even get to knock fast
  const loginRateLimit = {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  };

  app.post('/api/auth/login', loginRateLimit, async (req, reply) => {
    // Demo is entered only through a sandbox: visitors have no passwords,
    // and a public stand has no use for guessing at other people's accounts
    if (env.demoMode) {
      return reply.code(403).send({ error: 'Disabled in demo mode' });
    }
    const parsed = loginInput.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Enter a login and password' });
    }
    const email = parsed.data.email.trim().toLowerCase();

    if (throttled(email, MAX_ATTEMPTS_LOGIN) || throttled(`ip:${req.ip}`, MAX_ATTEMPTS_IP)) {
      log.warn(`login blocked by the brake: ${email} from ${req.ip}`);
      return reply
        .code(429)
        .send({ error: 'Too many attempts. Try again in 15 minutes' });
    }

    const user = db
      .prepare('SELECT * FROM users WHERE lower(email) = ? AND disabled_at IS NULL')
      .get(email) as
      | { id: string; password_hash: string; password_login_disabled: number }
      | undefined;

    // The comparison runs even when the user doesn't exist: otherwise
    // response timing reveals which logins do.
    const hash = user?.password_hash ?? 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA';
    const ok = await verifyPassword(parsed.data.password, hash);

    // Disabled password login answers exactly like a wrong password:
    // from outside nobody can tell who has which mode. The check comes
    // after verifyPassword so the mode is indistinguishable by timing too.
    if (user && ok && user.password_login_disabled) {
      log.warn(`password login attempt while password is disabled: ${email} from ${req.ip}`);
      return reply.code(401).send({ error: 'Wrong login or password' });
    }

    if (!user || !ok) {
      registerFailure(email);
      registerFailure(`ip:${req.ip}`);
      log.warn(`failed login: ${email} from ${req.ip}`);
      return reply.code(401).send({ error: 'Wrong login or password' });
    }

    attempts.delete(email);
    // A login trace with the address: if something ever needs
    // investigating, there is a starting point. Silent at warn and above,
    // visible from info onward.
    log.info(`login: ${email} from ${req.ip}`);
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now(), user.id);

    setSessionCookie(reply, createSession(user.id, req.headers['user-agent']));

    return db
      .prepare(
        `SELECT id, email, name, role, color, must_change_password,
                (google_sub IS NOT NULL) AS google_linked, password_login_disabled
           FROM users WHERE id = ?`,
      )
      .get(user.id);
  });

  app.post('/api/auth/logout', async (req, reply) => {
    // In demo, logout buries the sandbox too: nobody is coming back to it,
    // and a fresh visit via the button gets a clean copy of the template
    if (env.demoMode) {
      const { SANDBOX_COOKIE, destroySandbox } = await import('../lib/sandbox.js');
      const sandboxId = req.cookies[SANDBOX_COOKIE];
      if (sandboxId) destroySandbox(sandboxId, 'logout');
      reply.clearCookie(SANDBOX_COOKIE, { path: '/' });
      clearSessionCookie(reply);
      return { ok: true };
    }
    const token = req.cookies[SESSION_COOKIE];
    if (token) destroySession(token);
    clearSessionCookie(reply);
    return { ok: true };
  });

  /*
    Demo login. Creates the visitor a personal sandbox (a copy of the
    template database) and an admin session inside it — no login or
    password: a throwaway sandbox has nobody to ask a password of and no
    reason to. The rate limit is strict: every sandbox is a file on disk,
    and generosity here would be a hole.
  */
  if (env.demoMode) {
    const { SANDBOX_COOKIE, createSandbox } = await import('../lib/sandbox.js');
    const { runWithDb } = await import('../db/index.js');

    app.post(
      '/api/auth/demo',
      { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
      (req, reply) => {
        // The client sends document.referrer along — the only place the
        // "how did they find the demo" answer exists. Anything unparseable
        // is simply an absent referrer, never an error.
        const parsed = z
          .object({ referrer: z.string().max(500).nullish() })
          .safeParse(req.body);
        const sandbox = createSandbox({
          referrer: parsed.success ? (parsed.data.referrer ?? null) : null,
          userAgent: req.headers['user-agent'] ?? null,
        });
        return runWithDb(sandbox.db, () => {
          const admin = db
            .prepare(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`)
            .get() as { id: string };

          setSessionCookie(reply, createSession(admin.id, req.headers['user-agent']));
          reply.setCookie(SANDBOX_COOKIE, sandbox.id, {
            httpOnly: true,
            sameSite: 'lax',
            secure: env.secureCookies,
            path: '/',
            // Longer than the sandbox TTL: the server decides the lifetime, not the cookie
            maxAge: 24 * 60 * 60,
          });
          return db
            .prepare(
              `SELECT id, email, name, role, color, must_change_password,
                      (google_sub IS NOT NULL) AS google_linked, password_login_disabled
                 FROM users WHERE id = ?`,
            )
            .get(admin.id);
        });
      },
    );
  }

  // The token was already checked in authenticate; the user sits on the request.
  app.get('/api/auth/me', (req) => req.user);

  /** How many devices hold a live session — feeds the Settings row. */
  app.get('/api/auth/sessions', (req) => {
    const { n } = db
      .prepare('SELECT count(*) AS n FROM sessions WHERE user_id = ? AND expires_at > ?')
      .get(req.user!.id, new Date().toISOString()) as { n: number };
    return { count: n };
  });

  /*
    The "stolen phone" button: signs the user out everywhere except the
    device pressing it. Unlike the admin's reset-password this keeps the
    password — for the case where the credential is fine and only a
    device went missing.
  */
  app.post('/api/auth/sessions/revoke-others', (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return reply.code(401).send({ error: 'Sign in required' });
    const removed = destroyOtherSessions(req.user!.id, token);
    if (removed > 0) log.info(`sessions: ${req.user!.email} revoked ${removed} other session(s)`);
    return { removed };
  });

  /*
    The password-login switch. Two invariants, both server-side:

    — the password can be disabled only with Google linked, otherwise the
      account bricks itself;
    — the admin may never disable the password. Their password is the
      emergency entrance: if Google is down, the link broke or the secret
      expired, the admin logs in by password and fixes things. SSO-only
      with no back door is the classic way to lose access to everything
      at once.
  */
  app.post('/api/auth/password-login', (req, reply) => {
    const parsed = z.object({ enabled: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request' });
    const user = req.user!;

    if (!parsed.data.enabled) {
      if (user.role === 'admin') {
        return reply
          .code(400)
          .send({ error: 'The administrator cannot disable the password: it is the emergency entrance' });
      }
      if (!user.google_linked) {
        return reply.code(400).send({ error: 'Link Google first — otherwise there is no way left to sign in' });
      }
    }

    db.prepare('UPDATE users SET password_login_disabled = ? WHERE id = ?').run(
      parsed.data.enabled ? 0 : 1,
      user.id,
    );
    log.info(`password login ${parsed.data.enabled ? 'enabled' : 'disabled'}: ${user.email}`);
    return { ok: true };
  });

  // Google unlink. The mirror invariant: the last remaining way in
  // cannot be unlinked.
  app.post('/api/auth/google/unlink', (req, reply) => {
    const user = req.user!;
    if (user.password_login_disabled) {
      return reply
        .code(400)
        .send({ error: 'Enable password sign-in first — otherwise there is no way left to sign in' });
    }
    db.prepare('UPDATE users SET google_sub = NULL WHERE id = ?').run(user.id);
    log.info(`google unlinked: ${user.email}`);
    return { ok: true };
  });

  app.post('/api/auth/change-password', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return reply.code(401).send({ error: 'Sign in required' });

    const parsed = changeInput.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: parsed.error.issues[0]?.message ?? 'Check the entered passwords' });
    }

    const session = db
      .prepare(
        `SELECT u.id, u.password_hash FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled_at IS NULL`,
      )
      .get(hashToken(token), new Date().toISOString()) as
      | { id: string; password_hash: string }
      | undefined;

    if (!session) return reply.code(401).send({ error: 'Sign in required' });

    if (!(await verifyPassword(parsed.data.current_password, session.password_hash))) {
      return reply.code(400).send({ error: 'The current password is incorrect' });
    }

    db.prepare(
      `UPDATE users SET password_hash = ?, must_change_password = 0, password_changed_at = ?
        WHERE id = ?`,
    ).run(await hashPassword(parsed.data.new_password), now(), session.id);

    // A password change signs out every device, the current one included
    destroyAllSessions(session.id);
    clearSessionCookie(reply);

    return { ok: true };
  });
}
