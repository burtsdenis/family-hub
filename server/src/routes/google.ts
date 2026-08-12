import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { db } from '../db/index.js';
import { env } from '../env.js';
import { createSession, setSessionCookie } from '../lib/auth.js';
import { log } from '../lib/log.js';

/*
  Вход через Google — обычный OIDC authorization code flow с PKCE,
  руками через два fetch: тяжёлые SDK здесь не нужны.

  Правила, которые держит этот модуль:

  — Учётки по Google НЕ создаются. Вход пускает только тех, у кого
    google_sub уже привязан; любой другой гугл-аккаунт получает отказ.
    Хаб семейный, состав известен, самозапись не предусмотрена.

  — Привязка — только явным действием из настроек, из-под живой сессии.
    Никакой привязки «по совпадению email»: почту в Google можно сменить,
    а у местных учёток она вида user@hub.local и не гуглится вовсе.

  — Идентификация по claim `sub` — постоянному ID гугл-аккаунта.
*/

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

/** Сколько живёт начатый, но не завершённый заход через Google. */
const STATE_TTL_MS = 10 * 60_000;

/*
  Кука привязывает state к браузеру, который начал флоу. Без неё чужой
  callback-URL, подсунутый жертве, тихо завершал бы флоу атакующего в её
  браузере (login CSRF). Теперь возврат от Google принимается только в том
  браузере, где вход начинался.
*/
const OAUTH_COOKIE = 'hub_oauth';

interface PendingState {
  verifier: string;
  mode: 'login' | 'link';
  /** Для привязки — кому привязываем. */
  userId?: string;
  expires: number;
}

// В памяти: процесс один, а незавершённый флоу и должен умирать с рестартом
const pending = new Map<string, PendingState>();

function prunePending(): void {
  const now = Date.now();
  for (const [key, value] of pending) {
    if (value.expires < now) pending.delete(key);
  }
}

function configured(): boolean {
  return Boolean(env.googleClientId && env.googleClientSecret && env.publicUrl);
}

function redirectUri(): string {
  return `${env.publicUrl}/api/auth/google/callback`;
}

/** PKCE: verifier остаётся у нас, challenge уезжает в Google. */
function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function startFlow(reply: FastifyReply, mode: 'login' | 'link', userId?: string): void {
  prunePending();
  const state = randomBytes(24).toString('base64url');
  const { verifier, challenge } = pkcePair();
  pending.set(state, { verifier, mode, userId, expires: Date.now() + STATE_TTL_MS });

  reply.setCookie(OAUTH_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax', // Lax пропускает куку на top-level редиректе от Google
    secure: env.secureCookies,
    path: '/api/auth/google',
    maxAge: STATE_TTL_MS / 1000,
  });

  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', env.googleClientId);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  // Всегда показывать выбор аккаунта: в семье на одном устройстве
  // может быть несколько гугл-аккаунтов
  url.searchParams.set('prompt', 'select_account');

  void reply.redirect(url.toString());
}

/** Обмен кода на токен и получение sub. Ошибки — наружу исключением. */
async function fetchGoogleSub(code: string, verifier: string): Promise<{ sub: string; email: string | null }> {
  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.googleClientId,
      client_secret: env.googleClientSecret,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  if (!tokenRes.ok) {
    throw new Error(`Google token endpoint: ${tokenRes.status} ${await tokenRes.text()}`);
  }
  const token = (await tokenRes.json()) as { access_token?: string };
  if (!token.access_token) throw new Error('Google не вернул access_token');

  const infoRes = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!infoRes.ok) {
    throw new Error(`Google userinfo: ${infoRes.status} ${await infoRes.text()}`);
  }
  const info = (await infoRes.json()) as { sub?: string; email?: string };
  if (!info.sub) throw new Error('Google не вернул sub');
  return { sub: info.sub, email: info.email ?? null };
}

export async function registerGoogleRoutes(app: FastifyInstance): Promise<void> {
  // Начало входа. Публичный маршрут: сессии ещё нет.
  app.get('/api/auth/google/start', (req, reply) => {
    if (!configured()) {
      return reply.code(501).send({ error: 'Вход через Google не настроен' });
    }
    return startFlow(reply, 'login');
  });

  // Начало привязки. Закрыт общей аутентификацией: без сессии сюда не дойти.
  app.get('/api/auth/google/link', (req, reply) => {
    if (!configured()) {
      return reply.code(501).send({ error: 'Вход через Google не настроен' });
    }
    return startFlow(reply, 'link', req.user?.id);
  });

  // Возврат от Google. Публичный маршрут; свои и чужие state различаем сами.
  app.get('/api/auth/google/callback', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;

    // Пользователь передумал на экране Google — не ошибка, просто назад
    if (q.error) {
      return reply.redirect(q.error === 'access_denied' ? '/' : '/?google=error');
    }

    prunePending();
    const state = q.state ? pending.get(q.state) : undefined;
    // state должен совпасть с кукой, поставленной на старте флоу:
    // возврат принимается только в браузере, который вход начинал
    if (!state || !q.code || req.cookies[OAUTH_COOKIE] !== q.state) {
      // Чужой, протухший или повторно использованный state
      return reply.redirect('/?google=error');
    }
    pending.delete(q.state!); // одноразовый
    reply.clearCookie(OAUTH_COOKIE, { path: '/api/auth/google' });

    let sub: string;
    let email: string | null;
    try {
      ({ sub, email } = await fetchGoogleSub(q.code, state.verifier));
    } catch (err) {
      log.error('обмен кода Google не удался', err);
      return reply.redirect('/?google=error');
    }

    if (state.mode === 'link') {
      if (!state.userId) return reply.redirect('/?google=error');

      const taken = db
        .prepare('SELECT id FROM users WHERE google_sub = ? AND id != ?')
        .get(sub, state.userId);
      if (taken) {
        // Один гугл-аккаунт — одна учётка
        return reply.redirect('/settings?google=taken');
      }

      db.prepare('UPDATE users SET google_sub = ? WHERE id = ?').run(sub, state.userId);
      log.info(`google привязан: пользователь ${state.userId}, ${email ?? 'email скрыт'} с ${req.ip}`);
      return reply.redirect('/settings?google=linked');
    }

    // mode === 'login'
    const user = db
      .prepare('SELECT id, email FROM users WHERE google_sub = ? AND disabled_at IS NULL')
      .get(sub) as { id: string; email: string } | undefined;

    if (!user) {
      // Валидный гугл-аккаунт, но не наш. Учётку не создаём — отказ.
      log.warn(`вход google отклонён: ${email ?? sub} не привязан, с ${req.ip}`);
      return reply.redirect('/?google=not_linked');
    }

    setSessionCookie(reply, createSession(user.id, req.headers['user-agent']));
    log.info(`вход google: ${user.email} с ${req.ip}`);
    return reply.redirect('/');
  });
}
