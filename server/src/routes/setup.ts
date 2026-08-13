import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, id, now } from '../db/index.js';
import { createSession, setSessionCookie } from '../lib/auth.js';
import { hashPassword } from '../lib/password.js';
import { log } from '../lib/log.js';

/*
  Initial setup and invites — onboarding without reading logs.

  Empty database: the hub, when opened, offers to create the first
  account — it becomes the admin. No passwords in the server log.

  Family members are then added by links: the admin creates a one-time
  link, the person opens it and fills in their own name, login and
  password. The link lives a week, is shown to its creator once
  (only the hash is stored) and goes dark after use.
*/

const INVITE_TTL_MS = 7 * 24 * 60 * 60_000;

const nameField = z.string().trim().min(1, 'Имя не может быть пустым').max(80);
const emailField = z.string().trim().toLowerCase().email('Некорректный логин-адрес').max(120);
const passwordField = z.string().min(10, 'Пароль — от 10 символов').max(200);

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

interface InviteRow {
  id: string;
  role: 'member' | 'kid';
  expires_at: string;
  used_at: string | null;
}

/** A live invite by token: not used and not expired. */
function liveInvite(token: string): InviteRow | null {
  const row = db
    .prepare('SELECT id, role, expires_at, used_at FROM invites WHERE token_hash = ?')
    .get(hashToken(token)) as InviteRow | undefined;
  if (!row || row.used_at || row.expires_at <= new Date().toISOString()) return null;
  return row;
}

export async function registerSetupRoutes(app: FastifyInstance): Promise<void> {
  // A strict limit on the public onboarding endpoints — same as on login
  const strictRate = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  /*
    Initial setup. Works exactly once — while the database has no users
    at all. Afterwards it answers 403 forever: a race of two simultaneous
    setups is settled by the uniqueness of the moment, the check and the
    insert run in one transaction.
  */
  app.post('/api/auth/setup', strictRate, async (req, reply) => {
    const parsed = z
      .object({ name: nameField, email: emailField, password: passwordField })
      .safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Проверьте поля' });
    }

    const passwordHash = await hashPassword(parsed.data.password);
    const userId = id();

    const created = db.transaction(() => {
      const n = (db.prepare('SELECT count(*) AS n FROM users').get() as { n: number }).n;
      if (n > 0) return false;
      db.prepare(
        `INSERT INTO users (id, email, name, role, password_hash, must_change_password, created_at)
         VALUES (?, ?, ?, 'admin', ?, 0, ?)`,
      ).run(userId, parsed.data.email, parsed.data.name, passwordHash, now());
      return true;
    })();

    if (!created) {
      return reply.code(403).send({ error: 'Хаб уже настроен' });
    }

    log.info(`initial setup: admin ${parsed.data.email} created from ${req.ip}`);
    setSessionCookie(reply, createSession(userId, req.headers['user-agent']));
    return reply.code(201).send({ ok: true });
  });

  // ── Invites: the admin side ────────────────────────────────────────────

  app.post('/api/invites', (req, reply) => {
    if (req.user?.role !== 'admin') {
      return reply.code(403).send({ error: 'Только администратор' });
    }
    const parsed = z
      .object({ role: z.enum(['member', 'kid']).default('member') })
      .safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Некорректный запрос' });

    const token = randomBytes(24).toString('base64url');
    const inviteId = id();
    db.prepare(
      `INSERT INTO invites (id, token_hash, role, created_by, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      inviteId,
      hashToken(token),
      parsed.data.role,
      req.user.id,
      now(),
      new Date(Date.now() + INVITE_TTL_MS).toISOString().replace('T', ' ').slice(0, 19),
    );

    // The token leaves the server exactly once — from then on only the hash lives
    return reply.code(201).send({ id: inviteId, path: `/join?token=${token}` });
  });

  app.get('/api/invites', (req, reply) => {
    if (req.user?.role !== 'admin') {
      return reply.code(403).send({ error: 'Только администратор' });
    }
    return db
      .prepare(
        `SELECT i.id, i.role, i.created_at, i.expires_at,
                (i.used_at IS NOT NULL) AS used,
                u.name AS used_by_name
           FROM invites i
           LEFT JOIN users u ON u.id = i.used_by
          ORDER BY i.created_at DESC
          LIMIT 20`,
      )
      .all();
  });

  app.delete('/api/invites/:id', (req, reply) => {
    if (req.user?.role !== 'admin') {
      return reply.code(403).send({ error: 'Только администратор' });
    }
    const { id: inviteId } = z.object({ id: z.string().uuid() }).parse(req.params);
    // Used ones stay untouched — that's history now, not an invite
    db.prepare('DELETE FROM invites WHERE id = ? AND used_at IS NULL').run(inviteId);
    return { ok: true };
  });

  // ── Invites: the invitee side (public) ─────────────────────────────────

  // Whoever opens the link learns whether it is alive before filling the form
  app.get('/api/auth/invite', strictRate, (req, reply) => {
    const { token } = z.object({ token: z.string().min(1) }).parse(req.query);
    const invite = liveInvite(token);
    if (!invite) {
      return reply.code(404).send({ error: 'Ссылка не действует: истекла или уже использована' });
    }
    return { valid: true };
  });

  app.post('/api/auth/join', strictRate, async (req, reply) => {
    const parsed = z
      .object({
        token: z.string().min(1),
        name: nameField,
        email: emailField,
        password: passwordField,
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Проверьте поля' });
    }

    const invite = liveInvite(parsed.data.token);
    if (!invite) {
      return reply.code(404).send({ error: 'Ссылка не действует: истекла или уже использована' });
    }

    const exists = db
      .prepare('SELECT id FROM users WHERE lower(email) = ?')
      .get(parsed.data.email);
    if (exists) {
      return reply.code(409).send({ error: 'Пользователь с таким адресом уже есть' });
    }

    const passwordHash = await hashPassword(parsed.data.password);
    const userId = id();

    // A race of two visits via one link is settled by the transaction:
    // the second one sees used_at and gets refused
    const joined = db.transaction(() => {
      const fresh = db
        .prepare('SELECT used_at FROM invites WHERE id = ?')
        .get(invite.id) as { used_at: string | null };
      if (fresh.used_at) return false;
      db.prepare(
        `INSERT INTO users (id, email, name, role, password_hash, must_change_password, created_at)
         VALUES (?, ?, ?, ?, ?, 0, ?)`,
      ).run(userId, parsed.data.email, parsed.data.name, invite.role, passwordHash, now());
      db.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE id = ?').run(
        userId,
        now(),
        invite.id,
      );
      return true;
    })();

    if (!joined) {
      return reply.code(404).send({ error: 'Ссылка не действует: истекла или уже использована' });
    }

    log.info(`invite join: ${parsed.data.email} (${invite.role}) from ${req.ip}`);
    setSessionCookie(reply, createSession(userId, req.headers['user-agent']));
    return reply.code(201).send({ ok: true });
  });
}
