import Fastify, { type FastifyError } from 'fastify';
import { ZodError } from 'zod';
import fastifyStatic from '@fastify/static';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyMultipart from '@fastify/multipart';
import fastifyRateLimit from '@fastify/rate-limit';
import { existsSync } from 'node:fs';
import { env } from './env.js';
import { migrate } from './db/migrate.js';
import { registerRoutes } from './routes/index.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerGoogleRoutes } from './routes/google.js';
import { registerSetupRoutes } from './routes/setup.js';
import { registerUserRoutes } from './routes/users.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerTaskRoutes } from './routes/tasks.js';
import { registerNoteRoutes } from './routes/notes.js';
import { MAX_FILE_BYTES, registerAttachmentRoutes } from './routes/attachments.js';
import { registerCalendarRoutes } from './routes/calendar.js';
import { registerMoneyRoutes } from './routes/money.js';
import { registerBudgetRoutes, runAutoCreate } from './routes/budgets.js';
import { authenticate, announceSetupIfEmpty, pruneSessions } from './lib/auth.js';
import { log, logLevel } from './lib/log.js';

const app = Fastify({
  // The built-in logger is off entirely: it writes a JSON line per request,
  // and on a home server that is noise drowning out real errors.
  // With logger: false there is no need to disable request logging separately.
  logger: false,
  trustProxy: env.trustProxy,
});

/*
  Query parameter values never reach the log: that is where secrets live —
  the invite token (?token=), the OAuth callback code and state.
  A failed invite check is a 404 at warn level, and without masking
  the secret ended up in the log by default. Parameter names are kept:
  for diagnostics "which parameter came in" matters, not "with which value".
*/
export function redactUrl(url: string): string {
  const q = url.indexOf('?');
  if (q === -1) return url;
  const params = new URLSearchParams(url.slice(q + 1));
  const names = [...new Set([...params.keys()])];
  return names.length ? `${url.slice(0, q)}?${names.map((n) => `${n}=…`).join('&')}` : url.slice(0, q);
}

/*
  We log ourselves and only what deserves attention:
  server errors at error level, client rejections at warn,
  everything else at debug, hidden by default.
*/
app.addHook('onResponse', (req, reply, done) => {
  // The error handler already wrote a detailed line — don't repeat it
  if (req.errorLogged) return done();

  const status = reply.statusCode;
  const line = `${status} ${req.method} ${redactUrl(req.url)}`;
  if (status >= 500) log.error(line);
  else if (status >= 400) log.warn(line);
  else log.debug(line, `${Math.round(reply.elapsedTime)}ms`);
  done();
});

app.setErrorHandler((err: FastifyError, req, reply) => {
  req.errorLogged = true;

  // Bad parameters in the path or query string are a client error.
  // This used to blow up as a 500 and land in the log as a server error.
  if (err instanceof ZodError) {
    log.warn(`400 ${req.method} ${redactUrl(req.url)}`, err.issues[0]?.message ?? '');
    return reply.code(400).send({ error: 'Некорректные параметры запроса' });
  }

  const status = err.statusCode ?? 500;
  if (status >= 500) log.error(`${req.method} ${redactUrl(req.url)}`, err);
  else log.warn(`${status} ${req.method} ${redactUrl(req.url)}`, err.message);

  return reply.code(status).send({
    error: status < 500 ? err.message : 'Внутренняя ошибка сервера',
  });
});

migrate();
pruneSessions();

// Production without Secure cookies is almost certainly a forgotten flag,
// not intent: the session cookie would then travel over plaintext too
if (env.isProd && !env.secureCookies && !env.demoMode) {
  log.warn('NODE_ENV=production without SECURE_COOKIES=true — enable it once HTTPS is set up');
}
if (env.demoMode) {
  const { initDemo } = await import('./lib/sandbox.js');
  await initDemo();
} else {
  announceSetupIfEmpty();
}

await app.register(fastifyCookie);

/*
  Demo: route the request into the visitor's sandbox. The hook sits right
  after cookie parsing and wraps the rest of the handling in that sandbox's
  database context (AsyncLocalStorage, see db/index.ts) — from there all
  code, session check included, transparently works with that sandbox's
  database. A cookie without a live sandbox (expired, evicted, restart) —
  no context is set, the session won't be found in the main database,
  the client gets an honest 401 and returns to the login screen
  for a fresh sandbox.
*/
if (env.demoMode) {
  const { SANDBOX_COOKIE, getSandbox } = await import('./lib/sandbox.js');
  const { runWithDb } = await import('./db/index.js');
  app.addHook('onRequest', (req, _reply, done) => {
    const sandboxId = req.cookies[SANDBOX_COOKIE];
    const sandbox = sandboxId ? getSandbox(sandboxId) : null;
    if (sandbox) return runWithDb(sandbox.db, done);
    done();
  });
}
await app.register(fastifyMultipart, {
  limits: { fileSize: MAX_FILE_BYTES, files: 10 },
});

/*
  Security headers. CSP is strict because we can afford it:
  the frontend is built by Vite into its own files, no external fonts
  or scripts. 'unsafe-inline' only for styles — React sets inline style
  attributes (project colors, avatars), without it they stop applying.
  HSTS is not set here: the proxy that terminates TLS owns it.
*/
await app.register(fastifyHelmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  hsts: false,
});

/*
  A general rate-limit fuse — API only. The threshold is generous:
  a family of a few people will never hit it, but it cuts the tempo
  of a scanner or a script hammering the API. Key — client IP
  (with trustProxy that is the real address, not Caddy's). Login has
  its own, much stricter limit — set on the route itself in auth.ts.

  Exempt from the limit:
  — static files and app pages: an interface of dozens of files must not
    compete with the API for budget, and a rate-limit error on the page
    itself looks like the whole hub is broken;
  — attachment reads: note images go through /api/attachments,
    a note with fifty receipt photos is fifty requests at once,
    and honest browsing of the family archive would eat the budget
    instantly. Attachments sit behind auth and are cached by the
    browser forever.
*/
await app.register(fastifyRateLimit, {
  max: 300,
  timeWindow: '1 minute',
  allowList: (req) =>
    !req.url.startsWith('/api') ||
    (req.method === 'GET' && req.url.startsWith('/api/attachments/')),
  errorResponseBuilder: (_req, context) => ({
    statusCode: 429,
    error: 'Too Many Requests',
    message: `Слишком много запросов. Подождите ${Math.ceil(context.ttl / 1000)} с.`,
  }),
});

// Logout and similar methods are called without a body. Fastify answers
// that with a 400 by default — allow an empty body explicitly.
app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
  const raw = (body as string).trim();
  if (raw === '') return done(null, {});
  try {
    done(null, JSON.parse(raw));
  } catch {
    done(Object.assign(new Error('Тело запроса не разобрать как JSON'), { statusCode: 400 }), undefined);
  }
});

/*
  A CSRF barrier on top of SameSite=Lax: on a cross-site request the
  browser must send Origin, and it won't match our Host. A request
  without the header (curl, apps, same-origin GET) passes — that is not
  the cross-site browser scenario we defend against. Only hosts are
  compared: behind the proxy only Caddy knows the scheme.

  Production only: the Vite dev proxy rewrites Host to the API address
  (localhost:8787) while Origin stays the frontend's (localhost:5173) —
  the check would cut every legitimate dev request. In production Host
  arrives untouched both on direct access and via Caddy.
*/
if (env.isProd) {
  app.addHook('onRequest', (req, reply, done) => {
    if (req.method === 'GET' || req.method === 'HEAD') return done();
    if (!req.url.startsWith('/api')) return done();
    const origin = req.headers.origin;
    if (!origin || origin === 'null') return done();
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return reply.code(403).send({ error: 'Запрос с чужого сайта отклонён' });
    }
    if (originHost !== req.headers.host) {
      return reply.code(403).send({ error: 'Запрос с чужого сайта отклонён' });
    }
    done();
  });
}

app.addHook('preHandler', authenticate);

await registerAuthRoutes(app);
await registerGoogleRoutes(app);
await registerSetupRoutes(app);
await registerUserRoutes(app);
await registerProjectRoutes(app);
await registerTaskRoutes(app);
await registerNoteRoutes(app);
await registerAttachmentRoutes(app);
await registerCalendarRoutes(app);
await registerMoneyRoutes(app);
await registerBudgetRoutes(app);

// Recurring payments marked "create automatically" catch up at startup:
// the Mac may have been asleep, and a couple of dates may have passed us by
const createdOnBoot = runAutoCreate();
if (createdOnBoot > 0) log.info(`recurring transactions: created ${createdOnBoot}`);
await registerRoutes(app);

// In dev the frontend lives on Vite. So hitting the API port doesn't look broken:
if (!env.isProd) {
  app.get('/', (_req, reply) =>
    reply
      .type('text/plain; charset=utf-8')
      .send('API работает. Интерфейс в режиме разработки: http://localhost:5173'),
  );
}

// In production the same process serves the built frontend.
// In dev the frontend lives on Vite and proxies /api here.
if (env.isProd && existsSync(env.webDist)) {
  await app.register(fastifyStatic, { root: env.webDist });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api')) {
      return reply.code(404).send({ error: 'Такого метода нет' });
    }
    return reply.sendFile('index.html');
  });
}

try {
  await app.listen({ port: env.port, host: env.host });
  log.notice(`Hub listening on http://${env.host}:${env.port} · log level: ${logLevel}`);
} catch (err) {
  log.error('Failed to bind the port', err);
  process.exit(1);
}

// An unhandled crash must be visible at any log level
process.on('unhandledRejection', (reason) => log.error('Unhandled rejection', reason));
process.on('uncaughtException', (err) => {
  log.error('Uncaught exception', err);
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    // An explicit close runs a WAL checkpoint: the database stays a single
    // file, no -wal/-shm next to it — safer to copy and move around
    try {
      const { currentDb } = await import('./db/index.js');
      currentDb().close();
    } catch {
      // The database is already closed or never opened — not an error on exit
    }
    process.exit(0);
  });
}
