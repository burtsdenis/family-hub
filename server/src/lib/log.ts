/**
 * Our own logger instead of pino.
 *
 * Fastify writes a JSON line per request by default, pid and hostname
 * included. On a home server polled by a dashboard once a minute, that is
 * gigabytes of useless output and no chance of spotting a real error in it.
 *
 * The level comes from the LOG_LEVEL variable, default warn.
 */

declare module 'fastify' {
  interface FastifyRequest {
    /** The error handler already wrote a line — the response hook won't duplicate it. */
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
   * Messages printed regardless of the level.
   *
   * Only for one-off events the system is unusable without: the admin
   * password issued on first start cannot be recovered, and applied
   * migrations are the only trace that the database changed.
   * Ordinary messages have no place here.
   */
  notice: (...parts: unknown[]) => {
    process.stdout.write(`${stamp()} ${parts.map(render).join(' ')}\n`);
  },

  /** A multi-line block without a timestamp — for welcome messages. */
  block: (lines: string[]) => {
    process.stdout.write(`${lines.join('\n')}\n`);
  },
};
