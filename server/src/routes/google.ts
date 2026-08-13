import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { db } from '../db/index.js';
import { env } from '../env.js';
import { createSession, setSessionCookie } from '../lib/auth.js';
import { log } from '../lib/log.js';

/*
  Sign-in with Google — a plain OIDC authorization code flow with PKCE,
  by hand via two fetches: heavy SDKs are not needed here.

  The rules this module upholds:

  — Accounts are NOT created via Google. Login admits only those whose
    google_sub is already linked; any other Google account is refused.
    The hub is a family one, the roster is known, self-signup is not
    a thing.

  — Linking happens only by explicit action from settings, under a live
    session. No linking "by matching email": the email in Google can be
    changed, and local accounts have ones like user@hub.local that don't
    google at all.

  — Identification is by the `sub` claim — the Google account's
    permanent ID.
*/

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

/** How long a started but unfinished Google sign-in lives. */
const STATE_TTL_MS = 10 * 60_000;

/*
  The cookie ties the state to the browser that started the flow. Without
  it, a foreign callback URL slipped to the victim would quietly complete
  the attacker's flow in her browser (login CSRF). Now the return from
  Google is accepted only in the browser where the sign-in began.
*/
const OAUTH_COOKIE = 'hub_oauth';

interface PendingState {
  verifier: string;
  mode: 'login' | 'link';
  /** For linking — who we are linking to. */
  userId?: string;
  expires: number;
}

// In memory: there is one process, and an unfinished flow should die with a restart anyway
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

/** PKCE: the verifier stays with us, the challenge travels to Google. */
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
    sameSite: 'lax', // Lax lets the cookie through on the top-level redirect from Google
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
  // Always show the account chooser: a family device may hold
  // several Google accounts
  url.searchParams.set('prompt', 'select_account');

  void reply.redirect(url.toString());
}

/** Exchange the code for a token and fetch the sub. Errors escape as exceptions. */
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
  if (!token.access_token) throw new Error('Google returned no access_token');

  const infoRes = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!infoRes.ok) {
    throw new Error(`Google userinfo: ${infoRes.status} ${await infoRes.text()}`);
  }
  const info = (await infoRes.json()) as { sub?: string; email?: string };
  if (!info.sub) throw new Error('Google returned no sub');
  return { sub: info.sub, email: info.email ?? null };
}

export async function registerGoogleRoutes(app: FastifyInstance): Promise<void> {
  // Login start. A public route: there is no session yet.
  app.get('/api/auth/google/start', (req, reply) => {
    if (!configured()) {
      return reply.code(501).send({ error: 'Google sign-in is not configured' });
    }
    return startFlow(reply, 'login');
  });

  // Linking start. Closed by the general authentication: no session, no entry.
  app.get('/api/auth/google/link', (req, reply) => {
    if (!configured()) {
      return reply.code(501).send({ error: 'Google sign-in is not configured' });
    }
    return startFlow(reply, 'link', req.user?.id);
  });

  // The return from Google. A public route; we tell our states from foreign ones ourselves.
  app.get('/api/auth/google/callback', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;

    // The user changed their mind on the Google screen — not an error, just go back
    if (q.error) {
      return reply.redirect(q.error === 'access_denied' ? '/' : '/?google=error');
    }

    prunePending();
    const state = q.state ? pending.get(q.state) : undefined;
    // The state must match the cookie set at flow start: the return is
    // accepted only in the browser that began the sign-in
    if (!state || !q.code || req.cookies[OAUTH_COOKIE] !== q.state) {
      // A foreign, expired or reused state
      return reply.redirect('/?google=error');
    }
    pending.delete(q.state!); // single-use
    reply.clearCookie(OAUTH_COOKIE, { path: '/api/auth/google' });

    let sub: string;
    let email: string | null;
    try {
      ({ sub, email } = await fetchGoogleSub(q.code, state.verifier));
    } catch (err) {
      log.error('Google code exchange failed', err);
      return reply.redirect('/?google=error');
    }

    if (state.mode === 'link') {
      if (!state.userId) return reply.redirect('/?google=error');

      const taken = db
        .prepare('SELECT id FROM users WHERE google_sub = ? AND id != ?')
        .get(sub, state.userId);
      if (taken) {
        // One Google account — one user account
        return reply.redirect('/settings?google=taken');
      }

      db.prepare('UPDATE users SET google_sub = ? WHERE id = ?').run(sub, state.userId);
      log.info(`google linked: user ${state.userId}, ${email ?? 'email hidden'} from ${req.ip}`);
      return reply.redirect('/settings?google=linked');
    }

    // mode === 'login'
    const user = db
      .prepare('SELECT id, email FROM users WHERE google_sub = ? AND disabled_at IS NULL')
      .get(sub) as { id: string; email: string } | undefined;

    if (!user) {
      // A valid Google account, but not ours. No account is created — refuse.
      log.warn(`google login refused: ${email ?? sub} is not linked, from ${req.ip}`);
      return reply.redirect('/?google=not_linked');
    }

    setSessionCookie(reply, createSession(user.id, req.headers['user-agent']));
    log.info(`google login: ${user.email} from ${req.ip}`);
    return reply.redirect('/');
  });
}
