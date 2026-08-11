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
  destroySession,
  hashToken,
  setSessionCookie,
} from '../lib/auth.js';

/*
  Тормоз на подбор пароля — в двух измерениях.

  По логину: пять неверных попыток запирают его на 15 минут, откуда бы
  попытки ни шли. По адресу: двадцать неверных попыток с одного IP запирают
  адрес — это ловит перебор по словарю логинов, где каждый логин пробуется
  по разу и по-логинный счётчик не набирается. Порог по адресу выше,
  чтобы семья за одним домашним NAT не заперла друг друга случайно.

  Счётчики в памяти: перезапуск их сбрасывает, но снаружи сервер прикрыт
  ещё и общим лимитом частоты, а на самом маршруте входа — жёстким
  (см. rateLimit ниже), так что даже со сбросом темп перебора мизерный.
*/
const attempts = new Map<string, { count: number; until: number }>();
const MAX_ATTEMPTS_LOGIN = 5;
const MAX_ATTEMPTS_IP = 20;
const LOCK_MS = 15 * 60_000;

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
  new_password: z.string().min(10, 'Пароль должен быть не короче 10 символов').max(500),
});

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  /** Есть ли вообще пользователи — чтобы фронт знал, что показывать. */
  app.get('/api/auth/state', () => {
    const n = (db.prepare('SELECT count(*) AS n FROM users').get() as { n: number }).n;
    return {
      initialized: n > 0,
      // Есть ли смысл показывать кнопку «Войти через Google»
      google: Boolean(env.googleClientId && env.googleClientSecret && env.publicUrl),
      demo: env.demoMode,
    };
  });

  // Жёсткий лимит частоты именно на входе, поверх общего: скрипту,
  // подбирающему пароль, не даём даже стучаться быстро
  const loginRateLimit = {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  };

  app.post('/api/auth/login', loginRateLimit, async (req, reply) => {
    const parsed = loginInput.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Введите логин и пароль' });
    }
    const email = parsed.data.email.trim().toLowerCase();

    if (throttled(email, MAX_ATTEMPTS_LOGIN) || throttled(`ip:${req.ip}`, MAX_ATTEMPTS_IP)) {
      log.warn(`вход заблокирован тормозом: ${email} с ${req.ip}`);
      return reply
        .code(429)
        .send({ error: 'Слишком много попыток. Попробуйте через 15 минут' });
    }

    const user = db
      .prepare('SELECT * FROM users WHERE lower(email) = ? AND disabled_at IS NULL')
      .get(email) as
      | { id: string; password_hash: string; password_login_disabled: number }
      | undefined;

    // Сравнение выполняем даже когда пользователя нет: иначе по времени ответа
    // видно, какие логины существуют.
    const hash = user?.password_hash ?? 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA';
    const ok = await verifyPassword(parsed.data.password, hash);

    // Отключённый парольный вход отвечает так же, как неверный пароль:
    // снаружи не видно, у кого какой режим. Проверка после verifyPassword —
    // чтобы и по времени ответа режим был неразличим.
    if (user && ok && user.password_login_disabled) {
      log.warn(`вход по паролю при отключённом пароле: ${email} с ${req.ip}`);
      return reply.code(401).send({ error: 'Неверный логин или пароль' });
    }

    if (!user || !ok) {
      registerFailure(email);
      registerFailure(`ip:${req.ip}`);
      log.warn(`неверный вход: ${email} с ${req.ip}`);
      return reply.code(401).send({ error: 'Неверный логин или пароль' });
    }

    attempts.delete(email);
    // След входа с адресом: если появится что расследовать — будет от чего
    // оттолкнуться. На уровне warn и выше не шумит, виден начиная с info.
    log.info(`вход: ${email} с ${req.ip}`);
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

  app.post('/api/auth/logout', (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) destroySession(token);
    clearSessionCookie(reply);
    return { ok: true };
  });

  // Токен уже проверен в authenticate, пользователь лежит в запросе.
  app.get('/api/auth/me', (req) => req.user);

  /*
    Переключатель парольного входа. Два инварианта, оба серверные:

    — отключить пароль можно только при привязанном Google, иначе учётка
      замуровывается;
    — администратору отключать пароль нельзя никогда. Его пароль — аварийный
      вход: если Google недоступен, привязка сломалась или протух секрет,
      админ входит по паролю и чинит. SSO-only без запасного выхода —
      классический способ потерять доступ ко всему разом.
  */
  app.post('/api/auth/password-login', (req, reply) => {
    const parsed = z.object({ enabled: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Некорректный запрос' });
    const user = req.user!;

    if (!parsed.data.enabled) {
      if (user.role === 'admin') {
        return reply
          .code(400)
          .send({ error: 'Администратору пароль отключить нельзя: это аварийный вход' });
      }
      if (!user.google_linked) {
        return reply.code(400).send({ error: 'Сначала привяжите Google — иначе входить будет нечем' });
      }
    }

    db.prepare('UPDATE users SET password_login_disabled = ? WHERE id = ?').run(
      parsed.data.enabled ? 0 : 1,
      user.id,
    );
    log.info(`вход по паролю ${parsed.data.enabled ? 'включён' : 'отключён'}: ${user.email}`);
    return { ok: true };
  });

  // Отвязка Google. Зеркальный инвариант: нельзя отвязать единственный
  // оставшийся способ входа.
  app.post('/api/auth/google/unlink', (req, reply) => {
    const user = req.user!;
    if (user.password_login_disabled) {
      return reply
        .code(400)
        .send({ error: 'Сначала включите вход по паролю — иначе входить будет нечем' });
    }
    db.prepare('UPDATE users SET google_sub = NULL WHERE id = ?').run(user.id);
    log.info(`google отвязан: ${user.email}`);
    return { ok: true };
  });

  app.post('/api/auth/change-password', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return reply.code(401).send({ error: 'Нужно войти' });

    const parsed = changeInput.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: parsed.error.issues[0]?.message ?? 'Проверьте введённые пароли' });
    }

    const session = db
      .prepare(
        `SELECT u.id, u.password_hash FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = ? AND s.expires_at > ?`,
      )
      .get(hashToken(token), new Date().toISOString()) as
      | { id: string; password_hash: string }
      | undefined;

    if (!session) return reply.code(401).send({ error: 'Нужно войти' });

    if (!(await verifyPassword(parsed.data.current_password, session.password_hash))) {
      return reply.code(400).send({ error: 'Текущий пароль указан неверно' });
    }

    db.prepare(
      `UPDATE users SET password_hash = ?, must_change_password = 0, password_changed_at = ?
        WHERE id = ?`,
    ).run(await hashPassword(parsed.data.new_password), now(), session.id);

    // Смена пароля разлогинивает все устройства, включая текущее
    destroyAllSessions(session.id);
    clearSessionCookie(reply);

    return { ok: true };
  });
}
