import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, id, now } from '../db/index.js';
import { createSession, setSessionCookie } from '../lib/auth.js';
import { hashPassword } from '../lib/password.js';
import { log } from '../lib/log.js';

/*
  Первичная настройка и приглашения — онбординг без чтения логов.

  Пустая база: хаб при открытии предлагает создать первую учётку —
  она становится администратором. Никаких паролей в журнале сервера.

  Дальше домочадцы добавляются ссылками: администратор создаёт
  одноразовую ссылку, человек открывает её и сам заполняет имя, логин
  и пароль. Ссылка живёт неделю, показывается создателю один раз
  (хранится только хэш) и гаснет после использования.
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

/** Живое приглашение по токену: не использовано и не протухло. */
function liveInvite(token: string): InviteRow | null {
  const row = db
    .prepare('SELECT id, role, expires_at, used_at FROM invites WHERE token_hash = ?')
    .get(hashToken(token)) as InviteRow | undefined;
  if (!row || row.used_at || row.expires_at <= new Date().toISOString()) return null;
  return row;
}

export async function registerSetupRoutes(app: FastifyInstance): Promise<void> {
  // Жёсткий лимит на публичные точки онбординга — как на входе
  const strictRate = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  /*
    Первичная настройка. Работает ровно один раз — пока в базе нет ни одного
    пользователя. Дальше отвечает 403 навсегда: гонку двух одновременных
    настройщиков решает уникальность момента, проверка и вставка идут
    в одной транзакции.
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

    log.info(`первичная настройка: создан администратор ${parsed.data.email} с ${req.ip}`);
    setSessionCookie(reply, createSession(userId, req.headers['user-agent']));
    return reply.code(201).send({ ok: true });
  });

  // ── Приглашения: административная сторона ─────────────────────────────

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

    // Токен наружу отдаётся единственный раз — дальше живёт только хэш
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
    // Использованные не трогаем — это уже история, а не приглашение
    db.prepare('DELETE FROM invites WHERE id = ? AND used_at IS NULL').run(inviteId);
    return { ok: true };
  });

  // ── Приглашения: сторона приглашённого (публичная) ────────────────────

  // Открывший ссылку узнаёт, жива ли она, до заполнения формы
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

    // Гонку двух заходов по одной ссылке решает транзакция:
    // второй увидит used_at и получит отказ
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

    log.info(`вход по приглашению: ${parsed.data.email} (${invite.role}) с ${req.ip}`);
    setSessionCookie(reply, createSession(userId, req.headers['user-agent']));
    return reply.code(201).send({ ok: true });
  });
}
