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
  // Встроенный журнал выключен целиком: он пишет строку JSON на каждый запрос,
  // и на домашнем сервере это шум, в котором не видно настоящих ошибок.
  // При logger: false отдельно отключать запись запросов не нужно.
  logger: false,
  trustProxy: env.trustProxy,
});

/*
  Пишем сами и только то, что стоит внимания:
  ошибки сервера — на уровне error, отказы клиента — warn,
  всё остальное — debug и по умолчанию не показывается.
*/
app.addHook('onResponse', (req, reply, done) => {
  // Обработчик ошибок уже написал подробную строку — не повторяемся
  if (req.errorLogged) return done();

  const status = reply.statusCode;
  const line = `${status} ${req.method} ${req.url}`;
  if (status >= 500) log.error(line);
  else if (status >= 400) log.warn(line);
  else log.debug(line, `${Math.round(reply.elapsedTime)}ms`);
  done();
});

app.setErrorHandler((err: FastifyError, req, reply) => {
  req.errorLogged = true;

  // Некорректные параметры в пути или строке запроса — это ошибка клиента.
  // Раньше такое падало пятисоткой и попадало в журнал как ошибка сервера.
  if (err instanceof ZodError) {
    log.warn(`400 ${req.method} ${req.url}`, err.issues[0]?.message ?? '');
    return reply.code(400).send({ error: 'Некорректные параметры запроса' });
  }

  const status = err.statusCode ?? 500;
  if (status >= 500) log.error(`${req.method} ${req.url}`, err);
  else log.warn(`${status} ${req.method} ${req.url}`, err.message);

  return reply.code(status).send({
    error: status < 500 ? err.message : 'Внутренняя ошибка сервера',
  });
});

migrate();
pruneSessions();
if (env.demoMode) {
  const { seedDemoIfEmpty } = await import('./lib/demo.js');
  await seedDemoIfEmpty();
} else {
  announceSetupIfEmpty();
}

await app.register(fastifyCookie);
await app.register(fastifyMultipart, {
  limits: { fileSize: MAX_FILE_BYTES, files: 10 },
});

/*
  Заголовки безопасности. CSP строгий, потому что можем себе позволить:
  фронт собран Vite в свои файлы, внешних шрифтов и скриптов нет.
  'unsafe-inline' только для стилей — React ставит inline-атрибуты style
  (цвета проектов, аватарки), без него они перестанут применяться.
  HSTS не включаем сами: за него отвечает прокси, который и терминирует TLS.
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
  Общий предохранитель по частоте запросов — только для API. Порог щедрый:
  семья из нескольких человек в него не упрётся никогда, а вот сканеру
  и скрипту, молотящему API, он обрубает темп. Ключ — IP клиента
  (с trustProxy это настоящий адрес, а не адрес Caddy). У входа свой,
  куда более жёсткий лимит — задан на самом маршруте в auth.ts.

  Мимо лимита проходят:
  — статика и страницы приложения: интерфейс из десятков файлов не должен
    конкурировать с API за бюджет, а ошибка лимита на самой странице
    выглядит как поломка всего хаба;
  — чтение вложений: картинки в заметках ходят через /api/attachments,
    заметка с полусотней фотографий чеков — это полсотни запросов разом,
    и честное листание семейного архива выедало бы бюджет мгновенно.
    Вложения прикрыты авторизацией и кэшируются браузером навсегда.
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

// Выход и подобные методы вызываются без тела. Fastify по умолчанию
// отвечает на это 400 — разрешаем пустое тело явно.
app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
  const raw = (body as string).trim();
  if (raw === '') return done(null, {});
  try {
    done(null, JSON.parse(raw));
  } catch {
    done(Object.assign(new Error('Тело запроса не разобрать как JSON'), { statusCode: 400 }), undefined);
  }
});

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

// Регулярные платежи, помеченные «создавать самостоятельно», догоняются
// при старте: мак мог спать, и пара дат могла пройти без нас
const createdOnBoot = runAutoCreate();
if (createdOnBoot > 0) log.info(`регулярные операции: создано ${createdOnBoot}`);
await registerRoutes(app);

// В деве фронт живёт на Vite. Чтобы заход на порт API не выглядел поломкой:
if (!env.isProd) {
  app.get('/', (_req, reply) =>
    reply
      .type('text/plain; charset=utf-8')
      .send('API работает. Интерфейс в режиме разработки: http://localhost:5173'),
  );
}

// В проде тот же процесс раздаёт собранный фронт.
// В деве фронт живёт на Vite и проксирует /api сюда.
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
  log.notice(`Дом слушает http://${env.host}:${env.port} · журнал: ${logLevel}`);
} catch (err) {
  log.error('Не удалось занять порт', err);
  process.exit(1);
}

// Необработанное падение должно быть видно при любом уровне журнала
process.on('unhandledRejection', (reason) => log.error('Необработанное отклонение', reason));
process.on('uncaughtException', (err) => {
  log.error('Необработанное исключение', err);
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
