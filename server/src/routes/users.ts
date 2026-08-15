import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, now } from '../db/index.js';
import { destroyAllSessions, requireAdmin } from '../lib/auth.js';
import { generatePassword, hashPassword } from '../lib/password.js';

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

  // Manual account creation is gone on purpose: invitation links cover
  // every case (for a kid without a device, the parent opens the link
  // themselves), and one path into the family beats two half-used ones.
  // Reset-password below still issues one-time passwords — that is
  // recovery, not creation.

  app.patch('/api/users/:id', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { id: userId } = z.object({ id: z.string().uuid() }).parse(req.params);
    const parsed = z
      .object({
        name: z.string().min(1).max(100).optional(),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Check the fields' });

    const fields: [string, string][] = [];
    if (parsed.data.name !== undefined) fields.push(['name', parsed.data.name.trim()]);
    if (parsed.data.color !== undefined) fields.push(['color', parsed.data.color]);
    if (fields.length === 0) return reply.code(400).send({ error: 'Nothing to change' });

    const result = db
      .prepare(`UPDATE users SET ${fields.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`)
      .run(...fields.map(([, v]) => v), userId);
    if (result.changes === 0) return reply.code(404).send({ error: 'Member not found' });

    return db
      .prepare('SELECT id, email, name, role, color FROM users WHERE id = ?')
      .get(userId);
  });

  app.post('/api/users/:id/reset-password', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { id: userId } = z.object({ id: z.string().uuid() }).parse(req.params);

    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) return reply.code(404).send({ error: 'Member not found' });

    const password = generatePassword();
    // A reset is also the recovery path for a dead Google account,
    // so password login gets switched back on
    db.prepare(
      `UPDATE users SET password_hash = ?, must_change_password = 1,
              password_login_disabled = 0 WHERE id = ?`,
    ).run(await hashPassword(password), userId);
    // A password reset kicks the user off every device
    destroyAllSessions(userId);

    return { password };
  });

  app.post('/api/users/:id/toggle', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { id: userId } = z.object({ id: z.string().uuid() }).parse(req.params);

    if (userId === req.user?.id) {
      return reply.code(400).send({ error: 'You cannot disable yourself' });
    }

    const user = db.prepare('SELECT disabled_at FROM users WHERE id = ?').get(userId) as
      | { disabled_at: string | null }
      | undefined;
    if (!user) return reply.code(404).send({ error: 'Member not found' });

    const disabled = user.disabled_at ? null : now();
    db.prepare('UPDATE users SET disabled_at = ? WHERE id = ?').run(disabled, userId);
    if (disabled) destroyAllSessions(userId);

    return { disabled: Boolean(disabled) };
  });
}
