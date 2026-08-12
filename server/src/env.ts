import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * По умолчанию данные живут вне папки проекта.
 *
 * Раньше база лежала в ./data — то есть внутри каталога, который целиком
 * заменяется при обновлении. Finder на macOS при замене папки не сливает
 * содержимое, а удаляет старую вместе со всем внутри, и база исчезала.
 * Каталог с данными не должен зависеть от того, как обновляют код.
 *
 * В Docker переменная DATA_DIR задана явно и указывает на том.
 */
const DEFAULT_DATA_DIR = join(homedir(), '.family-hub');

/** Старое расположение — из него данные переносятся при первом запуске. */
export const legacyDataDir = resolve('./data');

/**
 * Числа и флаги из окружения проверяются на месте: опечатка в значении
 * должна останавливать старт или быть видимой, а не молча превращаться
 * в NaN («слушаем порт NaN») или в false («флаг вроде включён, но нет»).
 */
function intFrom(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name}=${raw} — ожидается целое положительное число`);
  }
  return value;
}

function boolFrom(name: string): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '' || raw === 'false') return false;
  if (raw === 'true') return true;
  throw new Error(`${name}=${raw} — ожидается true или false`);
}

export const env = {
  port: intFrom('PORT', 8787),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir: resolve(process.env.DATA_DIR ?? DEFAULT_DATA_DIR),
  webDist: resolve(process.env.WEB_DIST ?? '../web/dist'),
  isProd: process.env.NODE_ENV === 'production',
  // Включать только после того, как заработал HTTPS (scripts/setup-https.sh).
  // Если включить раньше, браузер не примет куку и вход перестанет работать.
  secureCookies: boolFrom('SECURE_COOKIES'),
  // Включается, когда приложение стоит за обратным прокси (Caddy на VPS):
  // адрес клиента тогда берётся из X-Forwarded-For, иначе все запросы
  // выглядят пришедшими с адреса прокси — и лимиты по IP банят самих себя.
  // В открытой установке без прокси включать нельзя: заголовок подделывается.
  trustProxy: boolFrom('TRUST_PROXY'),
  // ── Вход через Google ───────────────────────────────────────────────────
  // Оба значения выдаёт Google Cloud Console (OAuth client, Web application).
  // Пустой clientId выключает возможность целиком: кнопки на входе нет,
  // маршруты отвечают, что вход через Google не настроен.
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  // Адрес, по которому хаб виден из браузера, — из него собирается
  // redirect URI для Google. Для прода: https://hub.example.com
  publicUrl: (process.env.PUBLIC_URL ?? '').replace(/\/$/, ''),
  // Публичная песочница: база-однодневка на посетителя.
  // См. server/src/lib/sandbox.ts и lib/demo.ts
  demoMode: boolFrom('DEMO_MODE'),
  // debug | info | warn | error | silent. По умолчанию warn:
  // в обычной работе интересны только предупреждения и ошибки.
  logLevel: process.env.LOG_LEVEL ?? 'warn',
} as const;

export const paths = {
  db: resolve(env.dataDir, 'hub.db'),
  attachments: resolve(env.dataDir, 'attachments'),
  backups: resolve(env.dataDir, 'backups'),
} as const;
