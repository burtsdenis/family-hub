import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, id, now } from '../db/index.js';
import { destroyAllSessions, requireAdmin } from '../lib/auth.js';
import { generatePassword, hashPassword } from '../lib/password.js';

/**
 * Аватар — первая буква имени, поэтому людей различает цвет.
 * Одинаковый цвет по умолчанию делал бы «Денис» и «Дочка» неотличимыми.
 */
const USER_COLORS = ['#1F6E8C', '#C4842B', '#6B8F5E', '#8C4A6B', '#7A5C9E', '#4A6B8C'];

function nextColor(): string {
  const used = (
    db.prepare('SELECT color FROM users').all() as { color: string }[]
  ).map((r) => r.color.toLowerCase());
  return (
    USER_COLORS.find((c) => !used.includes(c.toLowerCase())) ??
    USER_COLORS[used.length % USER_COLORS.length]!
  );
}

const createInput = z.object({
  email: z.string().email('Укажите адрес вида имя@hub.local').max(200),
  name: z.string().min(1, 'Укажите имя').max(100),
  role: z.enum(['admin', 'member', 'kid']),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});

export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/users', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return db
      .prepare(
        `SELECT id, email, name, role, color, created_at, last_login_at,
                disabled_at, must_change_password
           FROM users ORDER BY role, name`,
      )
      .all();
  });

  app.post('/api/users', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;

    const parsed = createInput.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Проверьте поля' });
    }
    const email = parsed.data.email.trim().toLowerCase();

    const exists = db.prepare('SELECT 1 FROM users WHERE lower(email) = ?').get(email);
    if (exists) return reply.code(409).send({ error: 'Пользователь с таким адресом уже есть' });

    const password = generatePassword();
    const userId = id();
    db.prepare(
      `INSERT INTO users (id, email, name, role, color, password_hash, must_change_password, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    ).run(
      userId,
      email,
      parsed.data.name,
      parsed.data.role,
      parsed.data.color ?? nextColor(),
      await hashPassword(password),
      now(),
    );

    // Пароль возвращается ровно один раз — показать и передать человеку.
    return reply.code(201).send({
      user: db
        .prepare('SELECT id, email, name, role, color FROM users WHERE id = ?')
        .get(userId),
      password,
    });
  });

  app.patch('/api/users/:id', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { id: userId } = z.object({ id: z.string().uuid() }).parse(req.params);
    const parsed = z
      .object({
        name: z.string().min(1).max(100).optional(),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Проверьте поля' });

    const fields: [string, string][] = [];
    if (parsed.data.name !== undefined) fields.push(['name', parsed.data.name.trim()]);
    if (parsed.data.color !== undefined) fields.push(['color', parsed.data.color]);
    if (fields.length === 0) return reply.code(400).send({ error: 'Нечего менять' });

    const result = db
      .prepare(`UPDATE users SET ${fields.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`)
      .run(...fields.map(([, v]) => v), userId);
    if (result.changes === 0) return reply.code(404).send({ error: 'Пользователь не найден' });

    return db
      .prepare('SELECT id, email, name, role, color FROM users WHERE id = ?')
      .get(userId);
  });

  app.post('/api/users/:id/reset-password', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { id: userId } = z.object({ id: z.string().uuid() }).parse(req.params);

    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) return reply.code(404).send({ error: 'Пользователь не найден' });

    const password = generatePassword();
    // Сброс — это и путь восстановления при умершем гугл-аккаунте,
    // поэтому парольный вход включается обратно
    db.prepare(
      `UPDATE users SET password_hash = ?, must_change_password = 1,
              password_login_disabled = 0 WHERE id = ?`,
    ).run(await hashPassword(password), userId);
    // Сброс пароля выкидывает пользователя со всех устройств
    destroyAllSessions(userId);

    return { password };
  });

  app.post('/api/users/:id/toggle', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { id: userId } = z.object({ id: z.string().uuid() }).parse(req.params);

    if (userId === req.user?.id) {
      return reply.code(400).send({ error: 'Нельзя отключить самого себя' });
    }

    const user = db.prepare('SELECT disabled_at FROM users WHERE id = ?').get(userId) as
      | { disabled_at: string | null }
      | undefined;
    if (!user) return reply.code(404).send({ error: 'Пользователь не найден' });

    const disabled = user.disabled_at ? null : now();
    db.prepare('UPDATE users SET disabled_at = ? WHERE id = ?').run(disabled, userId);
    if (disabled) destroyAllSessions(userId);

    return { disabled: Boolean(disabled) };
  });
}
