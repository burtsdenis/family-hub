import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, id, now } from '../db/index.js';

/** Русское склонение: 1 задача, 2 задачи, 5 задач. */
function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}

export const INBOX_ID = '00000000-0000-4000-8000-000000000001';

const projectInput = z.object({
  title: z.string().min(1, 'Укажите название проекта').max(200),
  description: z.string().max(2000).nullable().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Цвет задаётся в формате #1F6E8C')
    .optional(),
  icon: z.string().max(16).nullable().optional(),
});

export async function registerProjectRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/projects', (req) => {
    const { archived } = z
      .object({ archived: z.enum(['true', 'false']).optional() })
      .parse(req.query);

    const clause = archived === 'true' ? 'IS NOT NULL' : 'IS NULL';
    return db
      .prepare(
        `SELECT p.*,
                (SELECT count(*) FROM tasks t
                  WHERE t.project_id = p.id AND t.status NOT IN ('done','cancelled')) AS open_tasks,
                (SELECT count(*) FROM tasks t WHERE t.project_id = p.id) AS total_tasks
           FROM projects p
          WHERE p.archived_at ${clause}
          ORDER BY p.position, p.created_at`,
      )
      .all();
  });

  app.post('/api/projects', (req, reply) => {
    const parsed = projectInput.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Проверьте поля' });
    }
    const projectId = id();
    db.prepare(
      `INSERT INTO projects (id, title, description, color, icon, position, created_by)
       VALUES (?, ?, ?, ?, ?, (SELECT coalesce(max(position), 0) + 1 FROM projects), ?)`,
    ).run(
      projectId,
      parsed.data.title,
      parsed.data.description ?? null,
      parsed.data.color ?? '#2E6F8E',
      parsed.data.icon ?? null,
      req.user?.id ?? null,
    );
    return reply.code(201).send(db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId));
  });

  app.patch('/api/projects/:id', (req, reply) => {
    const { id: projectId } = z.object({ id: z.string().uuid() }).parse(req.params);
    const parsed = projectInput.partial().safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Проверьте поля' });
    }

    const fields = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
    if (fields.length === 0) return reply.code(400).send({ error: 'Нечего менять' });

    const set = fields.map(([k]) => `${k} = ?`).join(', ');
    const result = db
      .prepare(`UPDATE projects SET ${set}, updated_at = ? WHERE id = ?`)
      .run(...fields.map(([, v]) => v as string | null), now(), projectId);

    if (result.changes === 0) return reply.code(404).send({ error: 'Проект не найден' });
    return db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  });

  app.post('/api/projects/:id/archive', (req, reply) => {
    const { id: projectId } = z.object({ id: z.string().uuid() }).parse(req.params);
    if (projectId === INBOX_ID) {
      return reply.code(400).send({ error: 'Входящие нельзя архивировать' });
    }

    const project = db.prepare('SELECT archived_at FROM projects WHERE id = ?').get(projectId) as
      | { archived_at: string | null }
      | undefined;
    if (!project) return reply.code(404).send({ error: 'Проект не найден' });

    const archived = project.archived_at ? null : now();
    db.prepare('UPDATE projects SET archived_at = ?, updated_at = ? WHERE id = ?').run(
      archived,
      now(),
      projectId,
    );
    return { archived: Boolean(archived) };
  });

  app.delete('/api/projects/:id', (req, reply) => {
    const { id: projectId } = z.object({ id: z.string().uuid() }).parse(req.params);
    if (projectId === INBOX_ID) {
      return reply.code(400).send({ error: 'Входящие удалить нельзя' });
    }

    const open = (
      db
        .prepare(`SELECT count(*) AS n FROM tasks WHERE project_id = ?`)
        .get(projectId) as { n: number }
    ).n;
    if (open > 0) {
      return reply.code(409).send({
        error:
          `В проекте ${open} ${plural(open, 'задача', 'задачи', 'задач')}. ` +
          'Удаление проекта удалит и задачи — сначала уберите проект в архив или перенесите их',
      });
    }

    const result = db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
    if (result.changes === 0) return reply.code(404).send({ error: 'Проект не найден' });
    return { ok: true };
  });

  /** Кому можно назначать задачи. Доступно всем, это не админский раздел. */
  app.get('/api/household', () =>
    db
      .prepare(
        `SELECT id, name, color FROM users
          WHERE disabled_at IS NULL AND role IN ('member','admin')
          ORDER BY name`,
      )
      .all(),
  );
}
