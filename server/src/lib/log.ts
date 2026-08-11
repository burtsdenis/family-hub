/**
 * Свой журнал вместо pino.
 *
 * Fastify по умолчанию пишет строку JSON на каждый запрос, включая pid и
 * hostname. На домашнем сервере, который опрашивается стендом раз в минуту,
 * это гигабайты бесполезного вывода и полная невозможность заметить в нём
 * настоящую ошибку.
 *
 * Уровень задаётся переменной LOG_LEVEL, по умолчанию warn.
 */

declare module 'fastify' {
  interface FastifyRequest {
    /** Обработчик ошибок уже записал строку — хук ответа не дублирует. */
    errorLogged?: boolean;
  }
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

function resolveLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? 'warn').toLowerCase();
  return raw in ORDER ? (raw as LogLevel) : 'warn';
}

export const logLevel = resolveLevel();
const threshold = ORDER[logLevel];

function stamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

function write(level: Exclude<LogLevel, 'silent'>, label: string, parts: unknown[]): void {
  if (ORDER[level] < threshold) return;
  const line = `${stamp()} ${label} ${parts.map(render).join(' ')}`;
  if (level === 'error') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

function render(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export const log = {
  debug: (...parts: unknown[]) => write('debug', 'DEBUG', parts),
  info: (...parts: unknown[]) => write('info', 'INFO ', parts),
  warn: (...parts: unknown[]) => write('warn', 'WARN ', parts),
  error: (...parts: unknown[]) => write('error', 'ERROR', parts),

  /**
   * Сообщения, которые печатаются независимо от уровня.
   *
   * Только для разовых событий, без которых система непригодна к
   * использованию: выданный при первом запуске пароль администратора
   * восстановить нельзя, а применённые миграции — единственный след того,
   * что база изменилась. Обычным сообщениям здесь места нет.
   */
  notice: (...parts: unknown[]) => {
    process.stdout.write(`${stamp()} ${parts.map(render).join(' ')}\n`);
  },

  /** Многострочный блок без метки времени — для приветственных сообщений. */
  block: (lines: string[]) => {
    process.stdout.write(`${lines.join('\n')}\n`);
  },
};
